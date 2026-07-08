import {BackendBase, WorkerHandler} from "./base.js";
import {FlatPhysicsEngine} from "../simulation/flat_physics.js";
import {FlatSpatialTree} from "../simulation/flat_tree.js";
import {ITEM_SIZE} from "../utils/particles.js";
import {Particle_initializer} from "../simulation/particle_initializer.js";
import {AppSimulationSettings} from "../settings/app.js";

const SEGMENT_TUNE_CANDIDATES = [8, 16, 24, 32, 40, 48, 64, 96];
const SEGMENT_TUNE_SAMPLES_PER_CANDIDATE = 2;
const THREAD_CHOICES = [2, 4, 6, 8];

class SegmentSizeAutoTuner {
    constructor(settings) {
        this.enabled = !!settings.simulation.autoTuneSegmentSize;
        this.baseSize = settings.simulation.segmentMaxCount;
        this.particleCount = settings.physics.particleCount;
        this.candidates = this._buildCandidates(this.baseSize, this.particleCount);
        this.samplesPerCandidate = SEGMENT_TUNE_SAMPLES_PER_CANDIDATE;
        this.candidateIndex = 0;
        this.sampleIndex = 0;
        this.results = [];
        this.finished = !this.enabled || this.candidates.length <= 1;
        this.selectedSize = this.finished ? this.baseSize : this.candidates[0];
        this.lastStepTime = null;
        this.lastAverageTime = null;
    }

    get currentSize() {
        return this.finished ? this.selectedSize : this.candidates[this.candidateIndex];
    }

    record(stepTime) {
        if (!this.enabled || this.finished) {
            this.lastStepTime = stepTime;
            return;
        }

        const candidate = this.candidates[this.candidateIndex];
        let result = this.results[this.candidateIndex];
        if (!result) {
            result = {size: candidate, totalTime: 0, samples: 0, averageTime: null};
            this.results[this.candidateIndex] = result;
        }

        result.totalTime += stepTime;
        result.samples += 1;
        result.averageTime = result.totalTime / result.samples;
        this.lastStepTime = stepTime;
        this.lastAverageTime = result.averageTime;
        this.sampleIndex += 1;

        if (this.sampleIndex < this.samplesPerCandidate) {
            return;
        }

        this.sampleIndex = 0;
        this.candidateIndex += 1;

        if (this.candidateIndex >= this.candidates.length) {
            this._selectBest();
        }
    }

    _selectBest() {
        let best = this.results[0];
        for (let i = 1; i < this.results.length; i++) {
            const result = this.results[i];
            if (result && result.averageTime < best.averageTime) {
                best = result;
            }
        }

        this.selectedSize = best?.size ?? this.baseSize;
        this.lastAverageTime = best?.averageTime ?? null;
        this.finished = true;
    }

    _buildCandidates(baseSize, particleCount) {
        const maxCandidate = Math.max(1, Math.min(128, particleCount));
        const values = [...SEGMENT_TUNE_CANDIDATES, baseSize]
            .filter(v => Number.isFinite(v) && v >= 1 && v <= maxCandidate);
        return [...new Set(values)].sort((a, b) => a - b);
    }

    getStats(actualSize) {
        if (!this.enabled) {
            return {
                enabled: false,
                status: "off",
                actualSize,
                selectedSize: actualSize,
                candidateSize: actualSize,
                candidates: [],
                sample: 0,
                samplesPerCandidate: this.samplesPerCandidate,
                lastStepTime: this.lastStepTime,
                lastAverageTime: null,
            };
        }

        return {
            enabled: true,
            status: this.finished ? "done" : "tuning",
            actualSize,
            selectedSize: this.selectedSize,
            candidateSize: this.currentSize,
            candidates: this.candidates,
            sample: this.finished ? this.samplesPerCandidate : this.sampleIndex + 1,
            samplesPerCandidate: this.samplesPerCandidate,
            lastStepTime: this.lastStepTime,
            lastAverageTime: this.lastAverageTime,
        };
    }
}

export class WorkerMTBackend extends BackendBase {
    constructor() {
        super("./backend/worker_mt.js");
        this.displayName = "WorkerMTBackend";
    }
}

class SubworkerPool {
    constructor() {
        this.workers = [];
        this._requestId = 0;
        this._pending = new Map();
    }

    async init(settings, particlesBuffer, forceXBuffer, forceYBuffer, threadCount) {
        this.dispose();
        this._requestId = 0;
        this._pending = new Map();
        for (let i = 0; i < threadCount; i++) {
            const worker = new Worker(new URL("./worker_mt_task.js", import.meta.url), {type: "module"});
            worker.onmessage = (event) => this._handleMessage(worker, event.data);
            worker.onerror = (event) => {
                console.error("Worker MT subworker error", event.message || event);
            };
            this.workers.push(worker);
        }
        await Promise.all(this.workers.map(worker => this._sendInit(worker, "init", settings, particlesBuffer, forceXBuffer, forceYBuffer)));
    }

    async reconfigure(settings, particlesBuffer, forceXBuffer, forceYBuffer, threadCount) {
        if (this.workers.length !== threadCount) {
            await this.init(settings, particlesBuffer, forceXBuffer, forceYBuffer, threadCount);
            return;
        }
        await Promise.all(this.workers.map(worker => this._sendInit(worker, "reconfigure", settings, particlesBuffer, forceXBuffer, forceYBuffer)));
    }

    process(partitions) {
        const promises = [];
        for (let i = 0; i < this.workers.length; i++) {
            const partition = partitions[i];
            if (!partition || partition.leafCount === 0) {
                continue;
            }
            promises.push(this._processPartition(this.workers[i], partition));
        }
        return Promise.all(promises);
    }

    _sendInit(worker, type, settings, particlesBuffer, forceXBuffer, forceYBuffer) {
        return new Promise((resolve) => {
            const previous = worker.onmessage;
            worker.onmessage = (event) => {
                if (event.data?.type === "ready") {
                    worker.onmessage = previous;
                    resolve();
                } else {
                    previous?.(event);
                }
            };
            worker.postMessage({type, settings: settings.serialize(), particlesBuffer, forceXBuffer, forceYBuffer});
        });
    }

    _processPartition(worker, partition) {
        const requestId = ++this._requestId;
        return new Promise((resolve, reject) => {
            this._pending.set(requestId, {resolve, reject});
            worker.postMessage({
                type: "process",
                requestId,
                indicesBuffer: partition.indices.buffer,
                leafStartsBuffer: partition.leafStarts.buffer,
                leafCountsBuffer: partition.leafCounts.buffer,
                parentForceXBuffer: partition.parentForceX.buffer,
                parentForceYBuffer: partition.parentForceY.buffer,
            }, [
                partition.indices.buffer,
                partition.leafStarts.buffer,
                partition.leafCounts.buffer,
                partition.parentForceX.buffer,
                partition.parentForceY.buffer,
            ]);
        });
    }

    _handleMessage(_worker, data) {
        if (data?.type !== "done") {
            return;
        }
        const pending = this._pending.get(data.requestId);
        if (!pending) {
            return;
        }
        this._pending.delete(data.requestId);
        pending.resolve(data);
    }

    dispose() {
        for (const worker of this.workers) {
            worker.postMessage({type: "dispose"});
            worker.terminate();
        }
        this.workers = [];
        this._pending?.clear?.();
    }
}

class WorkerMTBackendImpl {
    constructor() {
        this.settings = null;
        this.physicalEngine = null;
        this.particles = null;
        this.forceX = null;
        this.forceY = null;
        this.buffers = [];
        this._particleForces = [];
        this._segmentTuner = null;
        this._actualSegmentSize = null;
        this._treeWorkspace = {};
        this._pool = new SubworkerPool();
        this._threadCount = 0;
        this._crossOriginIsolated = globalThis.crossOriginIsolated === true;
        this._sharedMemoryAvailable = typeof SharedArrayBuffer !== "undefined" && this._crossOriginIsolated;
        this._fallbackReason = null;
    }

    async init(settings, state) {
        this.settings = AppSimulationSettings.deserialize(settings);
        this._initSegmentTuner();
        this._initParticles();
        this._applyParticlesState(state);
        this._initBuffers();
        this._initDebugForceView();
        await this._configurePool();
    }

    async reconfigure(settings, state) {
        const newSettings = AppSimulationSettings.deserialize(settings);
        const particleCountChanged = !this.settings ||
            this.settings.physics.particleCount !== newSettings.physics.particleCount;
        this.settings = newSettings;
        this._initSegmentTuner();

        if (particleCountChanged || !this.particles) {
            this._initParticles();
            this._initBuffers();
        }
        this._applyParticlesState(state);
        this._initDebugForceView();
        await this._configurePool();
    }

    ack(buffer) {
        if (this.buffers.length < this.settings.simulation.bufferCount) {
            this.buffers.push(buffer);
        } else {
            console.error("Unexpected ack: buffers already fulfilled");
        }
    }

    async step(timestamp) {
        if (this.buffers.length === 0) {
            console.error("Unexpected step: buffer is not ready");
            return null;
        }

        if (!this._canUseMT()) {
            return this._singleThreadStep(timestamp);
        }

        this._applyTunedSegmentSize();
        const stepStart = performance.now();
        const profile = {
            forceTime: 0,
            integrateTime: 0,
            statsTime: 0,
            exportTime: 0,
            mt: null,
        };

        let t = performance.now();
        const tree = new FlatSpatialTree(this.particles,
            this.settings.simulation.segmentMaxCount,
            this.settings.simulation.segmentDivider,
            this.settings.simulation.segmentRandomness,
            this._treeWorkspace);
        const treeTime = performance.now() - t;

        if (this.settings.common.debugForce && this.forceX && this.forceY) {
            this.forceX.fill(0);
            this.forceY.fill(0);
        }

        t = performance.now();
        const tasks = [];
        this._collectLeafTasks(tree, tree.root, 0, 0, tasks);
        const taskBuildTime = performance.now() - t;

        t = performance.now();
        const partitions = this._buildPartitions(tree, tasks);
        const partitionTime = performance.now() - t;

        t = performance.now();
        const workerResults = await this._pool.process(partitions);
        const parallelTime = performance.now() - t;

        const forceTime = workerResults.reduce((max, item) => Math.max(max, item.forceTime || 0), 0);
        const integrateTime = workerResults.reduce((max, item) => Math.max(max, item.integrateTime || 0), 0);
        profile.forceTime = forceTime;
        profile.integrateTime = integrateTime;
        profile.mt = {
            enabled: true,
            sharedMemory: true,
            crossOriginIsolated: this._crossOriginIsolated,
            requestedThreads: this.settings.simulation.workerThreads,
            actualThreads: this._threadCount,
            taskCount: tasks.length,
            activeWorkers: workerResults.length,
            taskBuildTime,
            partitionTime,
            parallelWaitTime: parallelTime,
            forceTimeMax: forceTime,
            integrateTimeMax: integrateTime,
            forceTimeTotal: workerResults.reduce((sum, item) => sum + (item.forceTime || 0), 0),
            integrateTimeTotal: workerResults.reduce((sum, item) => sum + (item.integrateTime || 0), 0),
        };

        const stepCalcTime = performance.now() - stepStart;
        this._recordTuningSample(stepCalcTime);

        const buffer = this.buffers.shift();
        t = performance.now();
        buffer.set(this.particles);
        profile.exportTime = performance.now() - t;

        if (this.settings.common.stats) {
            t = performance.now();
            const treeStats = this._calcTreeStats(tree);
            profile.statsTime = performance.now() - t;
            return this._buildResult(timestamp, buffer, tree, treeTime, taskBuildTime + partitionTime + parallelTime, treeStats, profile);
        }

        return this._buildResult(timestamp, buffer, tree, treeTime, taskBuildTime + partitionTime + parallelTime, this._calcTreeStats(tree), profile);
    }

    _buildResult(timestamp, buffer, tree, treeTime, physicsTime, treeStats, profile) {
        return {
            timestamp,
            buffer,
            treeDebug: this.settings.common.debugTree ? tree.getDebugData() : [],
            forceDebug: this._getCalculatedForces(),
            stats: {
                physicsTime,
                treeTime,
                tree: treeStats,
                profile,
                actualSegmentSize: this._actualSegmentSize,
                segmentAutoTune: this._segmentTuner?.getStats(this._actualSegmentSize) ?? null
            }
        };
    }

    _canUseMT() {
        return this._sharedMemoryAvailable && this._threadCount > 1 && !this._fallbackReason;
    }

    _initParticles() {
        const length = this.settings.physics.particleCount * ITEM_SIZE;
        if (this._sharedMemoryAvailable) {
            this.particles = new Float32Array(new SharedArrayBuffer(length * Float32Array.BYTES_PER_ELEMENT));
        } else {
            this.particles = new Float32Array(length);
            this.physicalEngine = new FlatPhysicsEngine(this.settings);
            this._fallbackReason = this._buildSharedMemoryFallbackReason();
        }
        const objectParticles = Particle_initializer.initialize(this.settings);
        this._copyObjectsToBuffer(objectParticles, this.particles);
    }

    _copyObjectsToBuffer(particles, buffer) {
        const size = Math.min(particles.length, buffer.length / ITEM_SIZE);
        for (let i = 0; i < size; i++) {
            const particle = particles[i];
            const offset = i * ITEM_SIZE;
            buffer[offset] = particle.x;
            buffer[offset + 1] = particle.y;
            buffer[offset + 2] = particle.velX;
            buffer[offset + 3] = particle.velY;
            buffer[offset + 4] = particle.mass;
        }
    }

    _initBuffers() {
        this.buffers = new Array(this.settings.simulation.bufferCount);
        for (let i = 0; i < this.settings.simulation.bufferCount; i++) {
            this.buffers[i] = new Float32Array(this.settings.physics.particleCount * ITEM_SIZE);
        }
    }

    _initDebugForceView() {
        if (!this.settings.common.debugForce) {
            this._particleForces = [];
            this.forceX = null;
            this.forceY = null;
            return;
        }

        const count = this.settings.physics.particleCount;
        if (this._sharedMemoryAvailable) {
            this.forceX = new Float32Array(new SharedArrayBuffer(count * Float32Array.BYTES_PER_ELEMENT));
            this.forceY = new Float32Array(new SharedArrayBuffer(count * Float32Array.BYTES_PER_ELEMENT));
        } else {
            this.forceX = null;
            this.forceY = null;
        }
        if (this._particleForces.length !== count) {
            this._particleForces = new Array(count);
            for (let i = 0; i < count; i++) {
                this._particleForces[i] = {forceX: 0, forceY: 0};
            }
        }
    }

    async _configurePool() {
        this._threadCount = this._resolveThreadCount();
        if (!this._sharedMemoryAvailable) {
            this._fallbackReason = this._buildSharedMemoryFallbackReason();
            this._pool.dispose();
            return;
        }
        this._fallbackReason = null;
        await this._pool.reconfigure(this.settings, this.particles.buffer, this.forceX?.buffer ?? null, this.forceY?.buffer ?? null, this._threadCount);
    }


    _buildSharedMemoryFallbackReason() {
        if (!this._crossOriginIsolated) {
            return "cross-origin isolation unavailable";
        }
        if (typeof SharedArrayBuffer === "undefined") {
            return "SharedArrayBuffer unavailable";
        }
        return "shared memory unavailable";
    }

    _resolveThreadCount() {
        const configured = this.settings.simulation.workerThreads;
        if (configured !== "auto") {
            const parsed = Number.parseInt(configured, 10);
            return THREAD_CHOICES.includes(parsed) ? parsed : 4;
        }

        const hardwareConcurrency = Number.isFinite(globalThis.navigator?.hardwareConcurrency) ? globalThis.navigator.hardwareConcurrency : null;
        if (!hardwareConcurrency) {
            return 4;
        }

        const target = Math.max(2, Math.min(8, hardwareConcurrency - 1));
        let selected = THREAD_CHOICES[0];
        for (const value of THREAD_CHOICES) {
            if (value <= target) {
                selected = value;
            }
        }
        return selected;
    }

    _applyParticlesState(state) {
        if (!state || state.length === 0) {
            return;
        }

        if (state instanceof Float32Array) {
            const size = Math.min(state.length, this.particles.length);
            this.particles.set(state.subarray(0, size), 0);
            return;
        }

        const size = Math.min(state.length, this.settings.physics.particleCount);
        for (let i = 0; i < size; i++) {
            const item = state[i];
            const offset = i * ITEM_SIZE;
            if (Array.isArray(item)) {
                this.particles[offset] = item[0];
                this.particles[offset + 1] = item[1];
                this.particles[offset + 2] = item[2];
                this.particles[offset + 3] = item[3];
                this.particles[offset + 4] = item[4];
            } else if (item) {
                this.particles[offset] = item.x;
                this.particles[offset + 1] = item.y;
                this.particles[offset + 2] = item.velX;
                this.particles[offset + 3] = item.velY;
                this.particles[offset + 4] = item.mass;
            }
        }
    }

    _initSegmentTuner() {
        this._segmentTuner = new SegmentSizeAutoTuner(this.settings);
        this._actualSegmentSize = this._segmentTuner.currentSize;
        this._setSegmentMaxCount(this._actualSegmentSize);
    }

    _applyTunedSegmentSize() {
        if (!this._segmentTuner) {
            this._actualSegmentSize = this.settings.simulation.segmentMaxCount;
            return;
        }

        const nextSize = this._segmentTuner.currentSize;
        if (nextSize !== this._actualSegmentSize) {
            this._actualSegmentSize = nextSize;
            this._setSegmentMaxCount(nextSize);
        }
    }

    _recordTuningSample(stepTime) {
        if (!this._segmentTuner) {
            return;
        }

        this._segmentTuner.record(stepTime);
        const selectedSize = this._segmentTuner.currentSize;
        if (this._segmentTuner.finished && selectedSize !== this._actualSegmentSize) {
            this._actualSegmentSize = selectedSize;
            this._setSegmentMaxCount(selectedSize);
        }
    }

    _setSegmentMaxCount(size) {
        this.settings.simulation.config.segmentMaxCount = size;
    }

    _collectLeafTasks(tree, nodeId, pForceX, pForceY, tasks) {
        if (tree.nodeChildCount[nodeId] === 0) {
            tasks.push({
                nodeId,
                start: tree.nodeStart[nodeId],
                count: tree.nodeParticleCount[nodeId],
                indexBuffer: tree.nodeIndexBuffer[nodeId],
                forceX: pForceX,
                forceY: pForceY,
            });
            return;
        }

        const particleGravity = this.settings.physics.particleGravity;
        const minInteractionDistanceSq = this.settings.physics.minInteractionDistanceSq;
        const firstChild = tree.nodeFirstChild[nodeId];
        const childCount = tree.nodeChildCount[nodeId];

        for (let i = 0; i < childCount; i++) {
            const childId = firstChild + i;
            let forceX = pForceX;
            let forceY = pForceY;
            const childCenterX = tree.nodeCenterX[childId];
            const childCenterY = tree.nodeCenterY[childId];

            for (let j = 0; j < childCount; j++) {
                if (i === j) continue;
                const otherId = firstChild + j;
                const dx = childCenterX - tree.nodeCenterX[otherId];
                const dy = childCenterY - tree.nodeCenterY[otherId];
                const distSquare = dx * dx + dy * dy;
                if (distSquare >= minInteractionDistanceSq) {
                    const force = -(particleGravity * tree.nodeMass[otherId]) / distSquare;
                    forceX += dx * force;
                    forceY += dy * force;
                }
            }

            this._collectLeafTasks(tree, childId, forceX, forceY, tasks);
        }
    }

    _buildPartitions(tree, tasks) {
        const partitions = new Array(this._threadCount).fill(null).map(() => ({tasks: [], work: 0, particleCount: 0}));
        for (const task of tasks) {
            let bestIndex = 0;
            let bestWork = partitions[0].work;
            for (let i = 1; i < partitions.length; i++) {
                if (partitions[i].work < bestWork) {
                    bestIndex = i;
                    bestWork = partitions[i].work;
                }
            }
            const work = task.count * task.count;
            partitions[bestIndex].tasks.push(task);
            partitions[bestIndex].work += work;
            partitions[bestIndex].particleCount += task.count;
        }

        return partitions.map(partition => this._materializePartition(tree, partition));
    }

    _materializePartition(tree, partition) {
        const leafCount = partition.tasks.length;
        const indices = new Uint32Array(partition.particleCount);
        const leafStarts = new Uint32Array(leafCount);
        const leafCounts = new Uint32Array(leafCount);
        const parentForceX = new Float32Array(leafCount);
        const parentForceY = new Float32Array(leafCount);
        let cursor = 0;

        for (let i = 0; i < leafCount; i++) {
            const task = partition.tasks[i];
            const source = tree.indexBuffers[task.indexBuffer].subarray(task.start, task.start + task.count);
            indices.set(source, cursor);
            leafStarts[i] = cursor;
            leafCounts[i] = task.count;
            parentForceX[i] = task.forceX;
            parentForceY[i] = task.forceY;
            cursor += task.count;
        }

        return {indices, leafStarts, leafCounts, parentForceX, parentForceY, leafCount};
    }

    _calcTreeStats(tree) {
        const flopsPerOp = 14;
        let flops = 0;
        for (let nodeId = 0; nodeId < tree.nodeCount; nodeId++) {
            const childCount = tree.nodeChildCount[nodeId];
            if (childCount === 0) {
                flops += Math.pow(tree.nodeParticleCount[nodeId], 2) * flopsPerOp;
            } else {
                flops += Math.pow(childCount, 2) * flopsPerOp;
            }
        }

        return {
            flops,
            depth: tree.maxDepth,
            segmentCount: tree.nodeCount,
        };
    }

    _singleThreadStep(timestamp) {
        if (!this.physicalEngine) {
            this.physicalEngine = new FlatPhysicsEngine(this.settings);
        }

        this._applyTunedSegmentSize();
        const tuneStart = performance.now();
        const tree = this.physicalEngine.step(this.particles);
        const stepCalcTime = performance.now() - tuneStart;
        this._recordTuningSample(stepCalcTime);

        const buffer = this.buffers.shift();
        const profile = this.physicalEngine.stats.profile || {};
        const t = performance.now();
        buffer.set(this.particles);
        profile.exportTime = performance.now() - t;
        profile.mt = {
            enabled: false,
            sharedMemory: this._sharedMemoryAvailable,
            crossOriginIsolated: this._crossOriginIsolated,
            requestedThreads: this.settings.simulation.workerThreads,
            actualThreads: 1,
            fallbackReason: this._fallbackReason || "single-thread fallback",
        };

        return {
            timestamp,
            buffer,
            treeDebug: this.settings.common.debugTree ? tree.getDebugData() : [],
            forceDebug: this._getCalculatedForcesSingle(),
            stats: {
                physicsTime: this.physicalEngine.stats.physicsTime,
                treeTime: this.physicalEngine.stats.treeTime,
                tree: {
                    flops: this.physicalEngine.stats.tree.flops,
                    depth: this.physicalEngine.stats.tree.depth,
                    segmentCount: this.physicalEngine.stats.tree.segmentCount
                },
                profile,
                actualSegmentSize: this._actualSegmentSize,
                segmentAutoTune: this._segmentTuner?.getStats(this._actualSegmentSize) ?? null
            }
        };
    }

    _getCalculatedForcesSingle() {
        if (!this.settings.common.debugForce || !this.physicalEngine) {
            return this._particleForces;
        }
        const forceX = this.physicalEngine.forceX;
        const forceY = this.physicalEngine.forceY;
        for (let i = 0; i < this.settings.physics.particleCount; i++) {
            this._particleForces[i].forceX = forceX[i];
            this._particleForces[i].forceY = forceY[i];
        }
        return this._particleForces;
    }

    _getCalculatedForces() {
        if (!this.settings.common.debugForce || !this.forceX || !this.forceY) {
            return this._particleForces;
        }
        for (let i = 0; i < this.settings.physics.particleCount; i++) {
            this._particleForces[i].forceX = this.forceX[i];
            this._particleForces[i].forceY = this.forceY[i];
        }
        return this._particleForces;
    }

    dispose() {
        this._pool.dispose();
        this.buffers = null;
        this.particles = null;
        this.forceX = null;
        this.forceY = null;
        this._particleForces = null;
        this._segmentTuner = null;
        this.physicalEngine?.dispose();
        this.physicalEngine = null;
        this.settings = null;
        this._treeWorkspace = null;
    }
}

const Backend = new WorkerMTBackendImpl();
const WorkerHandlerInstance = new WorkerHandler(Backend);

onmessage = WorkerHandlerInstance.handleMessage.bind(WorkerHandlerInstance);

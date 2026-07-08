import {BackendBase, WorkerHandler} from "./base.js";
import {FlatPhysicsEngine} from "../simulation/flat_physics.js";
import {FlatSpatialTree} from "../simulation/flat_tree.js";
import {ITEM_SIZE} from "../utils/particles.js";
import {Particle_initializer} from "../simulation/particle_initializer.js";
import {AppSimulationSettings} from "../settings/app.js";

const SEGMENT_TUNE_CANDIDATES = [8, 16, 24, 32, 40, 48, 64, 96];
const SEGMENT_TUNE_SAMPLES_PER_CANDIDATE = 2;
const THREAD_CHOICES = [2, 4, 6, 8];
const BUFFER_A = 0;
const BUFFER_B = 1;
const PARALLEL_TREE_MAX_SPLIT_LEVELS = 3;
const AUTO_TREE_JOBS_PER_THREAD = 4;
const AUTO_TREE_JOBS_MIN = 8;
const AUTO_TREE_JOBS_MAX = 32;
const RECURSIVE_TREE_SEED_SPLIT_LEVELS = 1;
const RECURSIVE_TREE_SPLIT_BUDGET = 8;
const RECURSIVE_TREE_MIN_JOB_PARTICLES = 8192;
const WORKER_TREE_STRATEGY_STATIC = "static";
const WORKER_TREE_STRATEGY_DYNAMIC = "dynamic";
const WORKER_TREE_STRATEGY_RECURSIVE = "recursive";
const TREE_FLOPS_PER_OP = 14;
const EPSILON = 0.1e-6;

function estimateTreeJobWork(job) {
    const count = job?.count || 0;
    return count * Math.max(1, Math.log2(Math.max(2, count)));
}

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

    async init(settings, particlesBuffer, forceXBuffer, forceYBuffer, indexBufferA, indexBufferB, threadCount) {
        this.dispose();
        this._requestId = 0;
        this._pending = new Map();
        for (let i = 0; i < threadCount; i++) {
            const worker = new Worker(new URL("./worker_mt_task.js", import.meta.url), {type: "module"});
            worker._mtIndex = i;
            worker.onmessage = (event) => this._handleMessage(worker, event.data);
            worker.onerror = (event) => {
                console.error("Worker MT subworker error", event.message || event);
            };
            this.workers.push(worker);
        }
        await Promise.all(this.workers.map(worker => this._sendInit(worker, "init", settings, particlesBuffer, forceXBuffer, forceYBuffer, indexBufferA, indexBufferB)));
    }

    async reconfigure(settings, particlesBuffer, forceXBuffer, forceYBuffer, indexBufferA, indexBufferB, threadCount) {
        if (this.workers.length !== threadCount) {
            await this.init(settings, particlesBuffer, forceXBuffer, forceYBuffer, indexBufferA, indexBufferB, threadCount);
            return;
        }
        await Promise.all(this.workers.map(worker => this._sendInit(worker, "reconfigure", settings, particlesBuffer, forceXBuffer, forceYBuffer, indexBufferA, indexBufferB)));
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

    processTreePartitions(partitions) {
        const promises = [];
        for (let i = 0; i < this.workers.length; i++) {
            const partition = partitions[i];
            if (!partition || partition.jobCount === 0) {
                continue;
            }
            promises.push(this._processTreePartition(this.workers[i], partition));
        }
        return Promise.all(promises);
    }

    async processTreeJobsDynamic(jobs, materializePartition) {
        if (this.workers.length === 0 || jobs.length === 0) {
            return {results: [], dispatchTime: 0, spawnedJobCount: 0};
        }

        const queue = jobs.slice().sort((a, b) => estimateTreeJobWork(b) - estimateTreeJobWork(a));
        const results = [];
        let nextJobIndex = 0;
        let dispatchTime = 0;

        const runWorker = async (worker) => {
            while (nextJobIndex < queue.length) {
                const job = queue[nextJobIndex++];
                const t = performance.now();
                const partition = materializePartition({jobs: [job]});
                dispatchTime += performance.now() - t;
                if (!partition || partition.jobCount === 0) {
                    continue;
                }

                const result = await this._processTreePartition(worker, partition, "process-tree");
                result.descriptorBytes = partition.descriptorBytes || 0;
                result.indexCopyBytes = partition.indexCopyBytes || 0;
                results.push(result);
            }
        };

        await Promise.all(this.workers.map(worker => runWorker(worker)));
        return {results, dispatchTime, spawnedJobCount: 0};
    }

    async processTreeJobsRecursive(initialJobs, materializePartition, options = {}) {
        if (this.workers.length === 0 || initialJobs.length === 0) {
            return {results: [], dispatchTime: 0, spawnedJobCount: 0};
        }

        const queue = initialJobs.slice().sort((a, b) => estimateTreeJobWork(b) - estimateTreeJobWork(a));
        const idleWorkers = this.workers.slice();
        const results = [];
        let activeCount = 0;
        let dispatchTime = 0;
        let spawnedJobCount = 0;

        return await new Promise((resolve, reject) => {
            const pump = () => {
                while (idleWorkers.length > 0 && queue.length > 0) {
                    const worker = idleWorkers.shift();
                    const job = queue.shift();
                    activeCount += 1;

                    const t = performance.now();
                    const partition = materializePartition({jobs: [job]});
                    dispatchTime += performance.now() - t;

                    if (!partition || partition.jobCount === 0) {
                        activeCount -= 1;
                        idleWorkers.push(worker);
                        continue;
                    }

                    this._processTreePartition(worker, partition, "process-tree-recursive", options)
                        .then((result) => {
                            result.descriptorBytes = partition.descriptorBytes || 0;
                            result.indexCopyBytes = partition.indexCopyBytes || 0;
                            results.push(result);

                            if (Array.isArray(result.spawnedJobs) && result.spawnedJobs.length > 0) {
                                spawnedJobCount += result.spawnedJobs.length;
                                for (const spawnedJob of result.spawnedJobs) {
                                    queue.push(spawnedJob);
                                }
                                queue.sort((a, b) => estimateTreeJobWork(b) - estimateTreeJobWork(a));
                            }
                        })
                        .then(() => {
                            activeCount -= 1;
                            idleWorkers.push(worker);
                            pump();
                        })
                        .catch(reject);
                }

                if (activeCount === 0 && queue.length === 0) {
                    resolve({results, dispatchTime, spawnedJobCount});
                }
            };

            pump();
        });
    }


    _sendInit(worker, type, settings, particlesBuffer, forceXBuffer, forceYBuffer, indexBufferA, indexBufferB) {
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
            worker.postMessage({
                type,
                settings: settings.serialize(),
                particlesBuffer,
                forceXBuffer,
                forceYBuffer,
                indexBufferA,
                indexBufferB,
            });
        });
    }

    _processPartition(worker, partition) {
        const requestId = ++this._requestId;
        return new Promise((resolve, reject) => {
            this._pending.set(requestId, {resolve, reject});
            worker.postMessage({
                type: "process",
                requestId,
                leafStartsBuffer: partition.leafStarts.buffer,
                leafCountsBuffer: partition.leafCounts.buffer,
                leafIndexBuffersBuffer: partition.leafIndexBuffers.buffer,
                parentForceXBuffer: partition.parentForceX.buffer,
                parentForceYBuffer: partition.parentForceY.buffer,
            }, [
                partition.leafStarts.buffer,
                partition.leafCounts.buffer,
                partition.leafIndexBuffers.buffer,
                partition.parentForceX.buffer,
                partition.parentForceY.buffer,
            ]);
        });
    }

    _processTreePartition(worker, partition, type = "process-tree", options = {}) {
        const requestId = ++this._requestId;
        return new Promise((resolve, reject) => {
            this._pending.set(requestId, {resolve, reject});
            worker.postMessage({
                type,
                requestId,
                splitBudget: options.splitBudget,
                minJobParticles: options.minJobParticles,
                jobStartsBuffer: partition.jobStarts.buffer,
                jobCountsBuffer: partition.jobCounts.buffer,
                jobIndexBuffersBuffer: partition.jobIndexBuffers.buffer,
                jobDepthsBuffer: partition.jobDepths.buffer,
                jobLeftBuffer: partition.jobLeft.buffer,
                jobTopBuffer: partition.jobTop.buffer,
                jobRightBuffer: partition.jobRight.buffer,
                jobBottomBuffer: partition.jobBottom.buffer,
                jobParentForceXBuffer: partition.jobParentForceX.buffer,
                jobParentForceYBuffer: partition.jobParentForceY.buffer,
            }, [
                partition.jobStarts.buffer,
                partition.jobCounts.buffer,
                partition.jobIndexBuffers.buffer,
                partition.jobDepths.buffer,
                partition.jobLeft.buffer,
                partition.jobTop.buffer,
                partition.jobRight.buffer,
                partition.jobBottom.buffer,
                partition.jobParentForceX.buffer,
                partition.jobParentForceY.buffer,
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
        if (Number.isFinite(_worker?._mtIndex)) {
            data.workerIndex = _worker._mtIndex;
        }
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
        this._ensureTreeWorkspace();
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
        this._ensureTreeWorkspace();
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

        if (this.settings.simulation.segmentDivider === 2) {
            return this._parallelTreeStep(timestamp);
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
            partitionDescriptorBytes: partitions.reduce((sum, item) => sum + (item.descriptorBytes || 0), 0),
            indexCopyBytes: partitions.reduce((sum, item) => sum + (item.indexCopyBytes || 0), 0),
            sharedIndexBuffers: true,
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


    async _parallelTreeStep(timestamp) {
        this._applyTunedSegmentSize();
        const stepStart = performance.now();
        const profile = {
            forceTime: 0,
            integrateTime: 0,
            statsTime: 0,
            exportTime: 0,
            mt: null,
        };

        if (this.settings.common.debugForce && this.forceX && this.forceY) {
            this.forceX.fill(0);
            this.forceY.fill(0);
        }

        const strategy = this._getWorkerMtTreeStrategy();
        let t = performance.now();
        const treeJobs = strategy === WORKER_TREE_STRATEGY_RECURSIVE
            ? this._buildRecursiveTreeSeedJobs()
            : this._buildParallelTreeJobs();
        const topTreeTime = performance.now() - t;

        t = performance.now();
        const partitionPlan = this._buildDynamicTreeJobPlan(treeJobs.jobs);
        const partitionTime = performance.now() - t;

        t = performance.now();
        let schedulerResult;
        if (strategy === WORKER_TREE_STRATEGY_STATIC) {
            const partitions = this._buildTreeJobPartitions(partitionPlan.jobs);
            const results = await this._pool.processTreePartitions(partitions);
            schedulerResult = {
                results,
                dispatchTime: 0,
                spawnedJobCount: 0,
            };
            for (let i = 0; i < results.length; i++) {
                results[i].descriptorBytes = partitions[i]?.descriptorBytes || 0;
                results[i].indexCopyBytes = partitions[i]?.indexCopyBytes || 0;
            }
        } else if (strategy === WORKER_TREE_STRATEGY_RECURSIVE) {
            schedulerResult = await this._pool.processTreeJobsRecursive(
                partitionPlan.jobs,
                (partition) => this._materializeTreeJobPartition(partition),
                {
                    splitBudget: this._getRecursiveTreeSplitBudget(),
                    minJobParticles: this._getRecursiveTreeMinJobParticles(),
                }
            );
        } else {
            schedulerResult = await this._pool.processTreeJobsDynamic(
                partitionPlan.jobs,
                (partition) => this._materializeTreeJobPartition(partition)
            );
        }
        const parallelWaitTime = performance.now() - t;
        const workerResults = schedulerResult.results;
        const dispatchTime = schedulerResult.dispatchTime || 0;
        const workerTiming = this._aggregateDynamicWorkerTiming(workerResults);

        const maxWorkerTreeTime = workerTiming.treeTimeMax;
        const treeTime = topTreeTime + maxWorkerTreeTime;
        const forceTime = workerTiming.forceTimeMax;
        const integrateTime = workerTiming.integrateTimeMax;
        const workerCpuTime = workerTiming.workerCpuTime;
        const workerMaxTime = workerTiming.workerMaxTime;
        const dynamicPhysicsTime = Math.max(0, partitionTime + dispatchTime + parallelWaitTime - maxWorkerTreeTime);

        profile.forceTime = forceTime;
        profile.integrateTime = integrateTime;
        profile.mt = {
            enabled: true,
            sharedMemory: true,
            crossOriginIsolated: this._crossOriginIsolated,
            requestedThreads: this.settings.simulation.workerThreads,
            actualThreads: this._threadCount,
            taskCount: workerResults.reduce((sum, item) => sum + (item.leafCount || 0), 0),
            activeWorkers: workerTiming.activeWorkers,
            treeParallel: true,
            treeStrategy: strategy,
            treeJobCount: treeJobs.jobs.length,
            treeTargetJobs: treeJobs.targetJobs,
            treeSplitLevels: treeJobs.splitLevels,
            treeDynamicScheduling: strategy !== WORKER_TREE_STRATEGY_STATIC,
            treeRecursiveScheduling: strategy === WORKER_TREE_STRATEGY_RECURSIVE,
            treeSpawnedJobs: schedulerResult.spawnedJobCount || 0,
            recursiveSplitBudget: strategy === WORKER_TREE_STRATEGY_RECURSIVE ? this._getRecursiveTreeSplitBudget() : null,
            recursiveMinJobParticles: strategy === WORKER_TREE_STRATEGY_RECURSIVE ? this._getRecursiveTreeMinJobParticles() : null,
            topTreeTime,
            topTreeSplitTime: treeJobs.profile.populateTime,
            treeRootBoundsTime: treeJobs.profile.rootBoundsTime,
            treeResetTime: treeJobs.profile.resetTime,
            treeTimeMax: maxWorkerTreeTime,
            treeTimeTotal: workerTiming.treeTimeTotal,
            taskBuildTime: 0,
            partitionTime,
            dispatchTime,
            partitionDescriptorBytes: workerResults.reduce((sum, item) => sum + (item.descriptorBytes || 0), 0),
            indexCopyBytes: workerResults.reduce((sum, item) => sum + (item.indexCopyBytes || 0), 0),
            sharedIndexBuffers: true,
            parallelWaitTime,
            forceTimeMax: forceTime,
            integrateTimeMax: integrateTime,
            forceTimeTotal: workerTiming.forceTimeTotal,
            integrateTimeTotal: workerTiming.integrateTimeTotal,
            workerCpuTime,
            workerMaxTime,
        };

        const stepCalcTime = performance.now() - stepStart;
        this._recordTuningSample(stepCalcTime);

        const buffer = this.buffers.shift();
        t = performance.now();
        buffer.set(this.particles);
        profile.exportTime = performance.now() - t;

        const treeStats = this._mergeParallelTreeStats(treeJobs.stats, workerResults);
        const treeProfile = this._mergeParallelTreeProfile(treeJobs.profile, workerResults, workerTiming, treeJobs, dispatchTime, profile.mt);
        return this._buildParallelResult(timestamp, buffer, treeTime, dynamicPhysicsTime, treeStats, treeProfile, profile);
    }

    _buildParallelResult(timestamp, buffer, treeTime, physicsTime, treeStats, treeProfile, profile) {
        return {
            timestamp,
            buffer,
            treeDebug: [],
            forceDebug: this._getCalculatedForces(),
            stats: {
                physicsTime,
                treeTime,
                tree: treeStats,
                treeProfile,
                profile,
                actualSegmentSize: this._actualSegmentSize,
                segmentAutoTune: this._segmentTuner?.getStats(this._actualSegmentSize) ?? null
            }
        };
    }

    _mergeParallelTreeStats(topStats, workerResults) {
        return {
            flops: topStats.flops + workerResults.reduce((sum, item) => sum + (item.treeStats?.flops || 0), 0),
            depth: Math.max(topStats.depth, ...workerResults.map(item => item.treeStats?.depth || 0)),
            segmentCount: topStats.segmentCount + workerResults.reduce((sum, item) => sum + (item.treeStats?.segmentCount || 0), 0),
        };
    }

    _mergeParallelTreeProfile(topProfile, workerResults, workerTiming, treeJobs, dispatchTime, mtProfile = {}) {
        return {
            resetTime: topProfile.resetTime,
            rootBoundsTime: topProfile.rootBoundsTime,
            populateTime: topProfile.populateTime + workerTiming.treeTimeMax,
            aggregateTime: Math.max(0, ...workerResults.map(item => item.treeProfile?.aggregateTime || 0)),
            fastBucketPath: true,
            parallel: true,
            strategy: mtProfile.treeStrategy || WORKER_TREE_STRATEGY_DYNAMIC,
            dynamicScheduling: !!mtProfile.treeDynamicScheduling,
            recursiveScheduling: !!mtProfile.treeRecursiveScheduling,
            spawnedJobs: mtProfile.treeSpawnedJobs || 0,
            recursiveSplitBudget: mtProfile.recursiveSplitBudget ?? null,
            recursiveMinJobParticles: mtProfile.recursiveMinJobParticles ?? null,
            targetJobs: treeJobs.targetJobs,
            splitLevels: treeJobs.splitLevels,
            topPopulateTime: topProfile.populateTime,
            parallelPopulateTime: Math.max(0, ...workerResults.map(item => item.treeProfile?.populateTime || 0)),
            parallelAggregateTime: Math.max(0, ...workerResults.map(item => item.treeProfile?.aggregateTime || 0)),
            parallelTreeWaitTime: workerTiming.treeTimeMax,
            parallelTreeWorkerTotal: workerTiming.treeTimeTotal,
            parallelTreeJobs: workerResults.reduce((sum, item) => sum + (item.jobCount || 0), 0),
            dispatchTime,
        };
    }

    _buildParallelTreeJobs() {
        const count = this.settings.physics.particleCount;
        const source = this._treeWorkspace.indices;
        const identity = this._treeWorkspace.identityIndices;
        const profile = {
            resetTime: 0,
            rootBoundsTime: 0,
            populateTime: 0,
            aggregateTime: 0,
            fastBucketPath: true,
        };
        const stats = {flops: 0, depth: 1, segmentCount: 1};

        let t = performance.now();
        source.set(identity.subarray(0, count), 0);
        profile.resetTime = performance.now() - t;

        t = performance.now();
        const rootBounds = this._calculateBounds(source, 0, count);
        profile.rootBoundsTime = performance.now() - t;

        let nodes = [{
            start: 0,
            count,
            indexBuffer: BUFFER_A,
            depth: 1,
            left: rootBounds.left,
            top: rootBounds.top,
            right: rootBounds.right,
            bottom: rootBounds.bottom,
            parentForceX: 0,
            parentForceY: 0,
        }];

        const targetJobs = this._getWorkerMtTreeTargetJobs(count);
        let splitLevels = 0;
        t = performance.now();
        for (let level = 0; level < PARALLEL_TREE_MAX_SPLIT_LEVELS; level++) {
            if (nodes.length >= targetJobs) {
                break;
            }

            const next = [];
            let didSplit = false;
            nodes.sort((a, b) => b.count - a.count);
            for (const node of nodes) {
                if (next.length >= targetJobs) {
                    next.push(node);
                    continue;
                }
                if (node.count <= this.settings.simulation.segmentMaxCount || this._isParallelNodeTooSmall(node)) {
                    next.push(node);
                    continue;
                }
                const children = this._splitParallelNode(node, 1 - node.indexBuffer);
                if (children.length <= 1) {
                    next.push(node);
                    continue;
                }

                didSplit = true;
                stats.flops += Math.pow(children.length, 2) * TREE_FLOPS_PER_OP;
                stats.segmentCount += children.length;
                stats.depth = Math.max(stats.depth, ...children.map(item => item.depth));
                next.push(...children);
            }
            nodes = next;
            splitLevels = level + 1;
            if (!didSplit) {
                break;
            }
        }
        profile.populateTime = performance.now() - t;
        // The final job roots are built and counted inside subworkers. Keep the
        // coordinator segment count limited to the shallow internal nodes that
        // it actually materialized while partitioning the tree.
        stats.segmentCount = Math.max(0, stats.segmentCount - nodes.length);

        return {jobs: nodes, profile, stats, targetJobs, splitLevels};
    }

    _buildRecursiveTreeSeedJobs() {
        const count = this.settings.physics.particleCount;
        const source = this._treeWorkspace.indices;
        const identity = this._treeWorkspace.identityIndices;
        const profile = {
            resetTime: 0,
            rootBoundsTime: 0,
            populateTime: 0,
            aggregateTime: 0,
            fastBucketPath: true,
        };
        const stats = {flops: 0, depth: 1, segmentCount: 1};

        let t = performance.now();
        source.set(identity.subarray(0, count), 0);
        profile.resetTime = performance.now() - t;

        t = performance.now();
        const rootBounds = this._calculateBounds(source, 0, count);
        profile.rootBoundsTime = performance.now() - t;

        let nodes = [{
            start: 0,
            count,
            indexBuffer: BUFFER_A,
            depth: 1,
            left: rootBounds.left,
            top: rootBounds.top,
            right: rootBounds.right,
            bottom: rootBounds.bottom,
            parentForceX: 0,
            parentForceY: 0,
        }];

        const targetJobs = Math.max(4, this._threadCount);
        let splitLevels = 0;
        t = performance.now();
        for (let level = 0; level < RECURSIVE_TREE_SEED_SPLIT_LEVELS; level++) {
            const next = [];
            let didSplit = false;
            for (const node of nodes) {
                if (node.count <= this.settings.simulation.segmentMaxCount || this._isParallelNodeTooSmall(node)) {
                    next.push(node);
                    continue;
                }
                const children = this._splitParallelNode(node, 1 - node.indexBuffer);
                if (children.length <= 1) {
                    next.push(node);
                    continue;
                }
                didSplit = true;
                stats.flops += Math.pow(children.length, 2) * TREE_FLOPS_PER_OP;
                stats.segmentCount += children.length;
                stats.depth = Math.max(stats.depth, ...children.map(item => item.depth));
                next.push(...children);
            }
            nodes = next;
            splitLevels = level + 1;
            if (!didSplit || nodes.length >= targetJobs) {
                break;
            }
        }
        profile.populateTime = performance.now() - t;
        stats.segmentCount = Math.max(0, stats.segmentCount - nodes.length);

        return {jobs: nodes, profile, stats, targetJobs, splitLevels};
    }

    _getWorkerMtTreeStrategy() {
        const value = this.settings.simulation.workerMtTreeStrategy;
        if (value === WORKER_TREE_STRATEGY_STATIC || value === WORKER_TREE_STRATEGY_RECURSIVE) {
            return value;
        }
        return WORKER_TREE_STRATEGY_DYNAMIC;
    }

    _getRecursiveTreeSplitBudget() {
        return RECURSIVE_TREE_SPLIT_BUDGET;
    }

    _getRecursiveTreeMinJobParticles() {
        const tuned = this._actualSegmentSize || this.settings.simulation.segmentMaxCount || 32;
        return Math.max(RECURSIVE_TREE_MIN_JOB_PARTICLES, tuned * 64);
    }

    _splitParallelNode(node, targetBufferId) {
        const sourceIndices = this._treeWorkspace.indexBuffers[node.indexBuffer];
        const targetIndices = this._treeWorkspace.indexBuffers[targetBufferId];
        const particles = this.particles;
        const left = node.left;
        const top = node.top;
        const right = node.right;
        const bottom = node.bottom;
        const width = right - left;
        const height = bottom - top;
        const xMid = this._buildParallelMid(left, width);
        const yMid = this._buildParallelMid(top, height);
        const start = node.start;
        const end = start + node.count;
        const bucketCounts = new Int32Array(4);
        const bucketMass = new Float64Array(4);
        const bucketIds = this._treeWorkspace.bucketIds;
        let usedBuckets = 0;

        for (let i = start; i < end; i++) {
            const particleIndex = sourceIndices[i];
            const offset = particleIndex * ITEM_SIZE;
            const bucketIndex = (particles[offset] < xMid ? 0 : 2) + (particles[offset + 1] < yMid ? 0 : 1);
            bucketIds[i - start] = bucketIndex;
            if (bucketCounts[bucketIndex] === 0) {
                usedBuckets += 1;
            }
            bucketCounts[bucketIndex] += 1;
            bucketMass[bucketIndex] += particles[offset + 4];
        }

        if (usedBuckets <= 1 && this._parallelNodeHasSinglePoint(node, sourceIndices)) {
            return [node];
        }

        const bucketStarts = new Int32Array(4);
        const bucketWrites = new Int32Array(4);
        let writeStart = start;
        for (let i = 0; i < 4; i++) {
            bucketStarts[i] = writeStart;
            bucketWrites[i] = writeStart;
            writeStart += bucketCounts[i];
        }

        for (let i = start; i < end; i++) {
            const bucketIndex = bucketIds[i - start];
            targetIndices[bucketWrites[bucketIndex]++] = sourceIndices[i];
        }

        const children = [];
        for (let bucketIndex = 0; bucketIndex < 4; bucketIndex++) {
            const bucketCount = bucketCounts[bucketIndex];
            if (bucketCount === 0) {
                continue;
            }
            const x = bucketIndex >> 1;
            const y = bucketIndex & 1;
            const childLeft = x === 0 ? left : xMid;
            const childRight = x === 0 ? xMid : right + EPSILON;
            const childTop = y === 0 ? top : yMid;
            const childBottom = y === 0 ? yMid : bottom + EPSILON;
            children.push({
                start: bucketStarts[bucketIndex],
                count: bucketCount,
                indexBuffer: targetBufferId,
                depth: node.depth + 1,
                left: childLeft,
                top: childTop,
                right: childRight,
                bottom: childBottom,
                centerX: childLeft + (childRight - childLeft) / 2,
                centerY: childTop + (childBottom - childTop) / 2,
                mass: bucketMass[bucketIndex],
                parentForceX: node.parentForceX,
                parentForceY: node.parentForceY,
            });
        }

        const particleGravity = this.settings.physics.particleGravity;
        const minInteractionDistanceSq = this.settings.physics.minInteractionDistanceSq;
        for (let i = 0; i < children.length; i++) {
            const child = children[i];
            let forceX = child.parentForceX;
            let forceY = child.parentForceY;
            for (let j = 0; j < children.length; j++) {
                if (i === j) continue;
                const other = children[j];
                const dx = child.centerX - other.centerX;
                const dy = child.centerY - other.centerY;
                const distSquare = dx * dx + dy * dy;
                if (distSquare >= minInteractionDistanceSq) {
                    const force = -(particleGravity * other.mass) / distSquare;
                    forceX += dx * force;
                    forceY += dy * force;
                }
            }
            child.parentForceX = forceX;
            child.parentForceY = forceY;
        }

        return children;
    }


    _buildParallelMid(start, size) {
        const randomness = this.settings.simulation.segmentRandomness;
        const firstWeight = 1 + randomness * (Math.random() - 0.5);
        const secondWeight = 1 + randomness * (Math.random() - 0.5);
        return start + size * firstWeight / (firstWeight + secondWeight);
    }

    _buildDynamicTreeJobPlan(jobs) {
        return {
            jobs: jobs.slice().sort((a, b) => estimateTreeJobWork(b) - estimateTreeJobWork(a)),
        };
    }

    _aggregateDynamicWorkerTiming(workerResults) {
        const workerCount = Math.max(1, this._threadCount);
        const treeTimes = new Float64Array(workerCount);
        const forceTimes = new Float64Array(workerCount);
        const integrateTimes = new Float64Array(workerCount);
        const jobCounts = new Uint32Array(workerCount);

        let treeTimeTotal = 0;
        let forceTimeTotal = 0;
        let integrateTimeTotal = 0;
        for (const item of workerResults) {
            const workerIndex = Number.isFinite(item.workerIndex)
                ? Math.max(0, Math.min(workerCount - 1, item.workerIndex))
                : 0;
            const treeTime = item.treeTime || 0;
            const forceTime = item.forceTime || 0;
            const integrateTime = item.integrateTime || 0;
            treeTimes[workerIndex] += treeTime;
            forceTimes[workerIndex] += forceTime;
            integrateTimes[workerIndex] += integrateTime;
            jobCounts[workerIndex] += item.jobCount || 0;
            treeTimeTotal += treeTime;
            forceTimeTotal += forceTime;
            integrateTimeTotal += integrateTime;
        }

        let activeWorkers = 0;
        let treeTimeMax = 0;
        let forceTimeMax = 0;
        let integrateTimeMax = 0;
        let workerMaxTime = 0;
        for (let i = 0; i < workerCount; i++) {
            if (jobCounts[i] > 0) {
                activeWorkers += 1;
            }
            treeTimeMax = Math.max(treeTimeMax, treeTimes[i]);
            forceTimeMax = Math.max(forceTimeMax, forceTimes[i]);
            integrateTimeMax = Math.max(integrateTimeMax, integrateTimes[i]);
            workerMaxTime = Math.max(workerMaxTime, treeTimes[i] + forceTimes[i] + integrateTimes[i]);
        }

        return {
            activeWorkers,
            treeTimeMax,
            treeTimeTotal,
            forceTimeMax,
            integrateTimeMax,
            forceTimeTotal,
            integrateTimeTotal,
            workerCpuTime: treeTimeTotal + forceTimeTotal + integrateTimeTotal,
            workerMaxTime,
        };
    }

    _getWorkerMtTreeTargetJobs(particleCount) {
        const configured = this.settings.simulation.workerMtTreeJobs;
        if (configured && configured !== "auto") {
            const parsed = Number.parseInt(configured, 10);
            if (Number.isFinite(parsed)) {
                return Math.max(this._threadCount, Math.min(128, parsed));
            }
        }

        const autoTarget = this._threadCount * AUTO_TREE_JOBS_PER_THREAD;
        return Math.max(AUTO_TREE_JOBS_MIN, Math.min(AUTO_TREE_JOBS_MAX, autoTarget, Math.max(this._threadCount, particleCount)));
    }

    _buildTreeJobPartitions(jobs) {
        const partitions = new Array(this._threadCount).fill(null).map(() => ({jobs: [], work: 0, particleCount: 0}));
        for (const job of jobs) {
            let bestIndex = 0;
            let bestWork = partitions[0].work;
            for (let i = 1; i < partitions.length; i++) {
                if (partitions[i].work < bestWork) {
                    bestIndex = i;
                    bestWork = partitions[i].work;
                }
            }
            const work = estimateTreeJobWork(job);
            partitions[bestIndex].jobs.push(job);
            partitions[bestIndex].work += work;
            partitions[bestIndex].particleCount += job.count;
        }
        return partitions.map(partition => this._materializeTreeJobPartition(partition));
    }

    _materializeTreeJobPartition(partition) {
        const jobCount = partition.jobs.length;
        const jobStarts = new Uint32Array(jobCount);
        const jobCounts = new Uint32Array(jobCount);
        const jobIndexBuffers = new Uint8Array(jobCount);
        const jobDepths = new Uint16Array(jobCount);
        const jobLeft = new Float64Array(jobCount);
        const jobTop = new Float64Array(jobCount);
        const jobRight = new Float64Array(jobCount);
        const jobBottom = new Float64Array(jobCount);
        const jobParentForceX = new Float32Array(jobCount);
        const jobParentForceY = new Float32Array(jobCount);

        for (let i = 0; i < jobCount; i++) {
            const job = partition.jobs[i];
            jobStarts[i] = job.start;
            jobCounts[i] = job.count;
            jobIndexBuffers[i] = job.indexBuffer;
            jobDepths[i] = job.depth;
            jobLeft[i] = job.left;
            jobTop[i] = job.top;
            jobRight[i] = job.right;
            jobBottom[i] = job.bottom;
            jobParentForceX[i] = job.parentForceX;
            jobParentForceY[i] = job.parentForceY;
        }

        const descriptorBytes = jobStarts.byteLength + jobCounts.byteLength + jobIndexBuffers.byteLength +
            jobDepths.byteLength + jobLeft.byteLength + jobTop.byteLength + jobRight.byteLength +
            jobBottom.byteLength + jobParentForceX.byteLength + jobParentForceY.byteLength;

        return {
            jobStarts,
            jobCounts,
            jobIndexBuffers,
            jobDepths,
            jobLeft,
            jobTop,
            jobRight,
            jobBottom,
            jobParentForceX,
            jobParentForceY,
            jobCount,
            descriptorBytes,
            indexCopyBytes: 0,
        };
    }

    _calculateBounds(indices, start, count) {
        if (count <= 0) {
            return {left: 0, top: 0, right: 0, bottom: 0};
        }
        const firstOffset = indices[start] * ITEM_SIZE;
        let minX = this.particles[firstOffset];
        let maxX = minX;
        let minY = this.particles[firstOffset + 1];
        let maxY = minY;
        const end = start + count;
        for (let i = start + 1; i < end; i++) {
            const offset = indices[i] * ITEM_SIZE;
            const x = this.particles[offset];
            if (minX > x) minX = x;
            if (maxX < x) maxX = x;
            const y = this.particles[offset + 1];
            if (minY > y) minY = y;
            if (maxY < y) maxY = y;
        }
        return {left: minX, top: minY, right: maxX, bottom: maxY};
    }

    _isParallelNodeTooSmall(node) {
        return node.right - node.left <= EPSILON && node.bottom - node.top <= EPSILON;
    }

    _parallelNodeHasSinglePoint(node, indices) {
        if (node.count < 2) {
            return true;
        }
        const firstOffset = indices[node.start] * ITEM_SIZE;
        const x = this.particles[firstOffset];
        const y = this.particles[firstOffset + 1];
        const end = node.start + node.count;
        for (let i = node.start + 1; i < end; i++) {
            const offset = indices[i] * ITEM_SIZE;
            if (Math.abs(this.particles[offset] - x) > EPSILON || Math.abs(this.particles[offset + 1] - y) > EPSILON) {
                return false;
            }
        }
        return true;
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
                treeProfile: tree.profile ? {...tree.profile} : null,
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
        this._ensureTreeWorkspace();
        await this._pool.reconfigure(
            this.settings,
            this.particles.buffer,
            this.forceX?.buffer ?? null,
            this.forceY?.buffer ?? null,
            this._treeWorkspace.indices.buffer,
            this._treeWorkspace.scratchIndices.buffer,
            this._threadCount,
        );
    }

    _ensureTreeWorkspace() {
        const count = this.settings?.physics?.particleCount ?? 0;
        if (!count) {
            this._treeWorkspace = {};
            return;
        }

        if (!this._sharedMemoryAvailable) {
            if (!this._treeWorkspace || this._treeWorkspace.indices instanceof Int32Array && this._treeWorkspace.indices.buffer instanceof SharedArrayBuffer) {
                this._treeWorkspace = {};
            }
            return;
        }

        if (!this._treeWorkspace) {
            this._treeWorkspace = {};
        }

        const byteLength = count * Int32Array.BYTES_PER_ELEMENT;
        if (!(this._treeWorkspace.indices?.buffer instanceof SharedArrayBuffer) || this._treeWorkspace.indices.length < count) {
            this._treeWorkspace.indices = new Int32Array(new SharedArrayBuffer(byteLength));
            this._treeWorkspace.scratchIndices = new Int32Array(new SharedArrayBuffer(byteLength));
            this._treeWorkspace.identityIndices = new Int32Array(count);
            for (let i = 0; i < count; i++) {
                this._treeWorkspace.identityIndices[i] = i;
            }
        }

        if (!this._treeWorkspace.bucketIds || this._treeWorkspace.bucketIds.length < count) {
            this._treeWorkspace.bucketIds = new Int16Array(count);
        }
        this._treeWorkspace.indexBuffers = [this._treeWorkspace.indices, this._treeWorkspace.scratchIndices];
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

    _materializePartition(_tree, partition) {
        const leafCount = partition.tasks.length;
        const leafStarts = new Uint32Array(leafCount);
        const leafCounts = new Uint32Array(leafCount);
        const leafIndexBuffers = new Uint8Array(leafCount);
        const parentForceX = new Float32Array(leafCount);
        const parentForceY = new Float32Array(leafCount);

        for (let i = 0; i < leafCount; i++) {
            const task = partition.tasks[i];
            leafStarts[i] = task.start;
            leafCounts[i] = task.count;
            leafIndexBuffers[i] = task.indexBuffer;
            parentForceX[i] = task.forceX;
            parentForceY[i] = task.forceY;
        }

        const descriptorBytes = leafStarts.byteLength + leafCounts.byteLength +
            leafIndexBuffers.byteLength + parentForceX.byteLength + parentForceY.byteLength;

        return {
            leafStarts,
            leafCounts,
            leafIndexBuffers,
            parentForceX,
            parentForceY,
            leafCount,
            descriptorBytes,
            indexCopyBytes: 0,
        };
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
                treeProfile: this.physicalEngine.stats.treeProfile ? {...this.physicalEngine.stats.treeProfile} : null,
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

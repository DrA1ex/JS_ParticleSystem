import {BackendBase, WorkerHandler} from "./base.js";
import {FlatPhysicsEngine} from "../simulation/flat_physics.js";
import {FlatSpatialTree} from "../simulation/flat_tree.js";
import {ITEM_SIZE} from "../utils/particles.js";
import {BUILD_ID, WORKER_PROTOCOL_VERSION, assertWorkerRuntime, withBuildId} from "../utils/build.js";
import {Particle_initializer} from "../simulation/particle_initializer.js";
import {AppSimulationSettings} from "../settings/app.js";
import {SegmentSizeAutoTuner} from "./segment_size_tuner.js";

const THREAD_CHOICES = [2, 4, 6, 8, 12, 16, 20];
const BUFFER_A = 0;
const BUFFER_B = 1;
const HYBRID_SEED_TARGET_JOBS = 4;
const HYBRID_SPLIT_BUDGET = 1;
const HYBRID_MIN_JOB_PARTICLES = 32768;
const HYBRID_SEGMENT_MULTIPLIER = 256;
function forceKernelName() {
    return "pair-once-legacy-equivalent";
}
const TREE_FLOPS_PER_OP = 14;
const EPSILON = 0.1e-6;

function estimateTreeJobWork(job) {
    const count = job?.count || 0;
    return count * Math.max(1, Math.log2(Math.max(2, count)));
}

function estimateHybridJobWork(job) {
    const count = job?.count || 0;
    if (count <= 0) {
        return 0;
    }

    const treeCost = estimateTreeJobWork(job);
    const solveTailCost = count * Math.sqrt(Math.max(1, count));
    const depthBias = 1 + Math.min(0.5, Math.max(0, (job.depth || 0) - 1) * 0.025);
    return (treeCost + solveTailCost * 0.02) * depthBias;
}


export class WorkerMTBackend extends BackendBase {
    constructor() {
        super("./backend/worker_mt.js");
        this.expectedBuildId = BUILD_ID;
        this.expectedProtocolVersion = WORKER_PROTOCOL_VERSION;
        this.displayName = "WorkerMTBackend";
    }

    subscribe(dataFn, readyFn) {
        this._worker.onmessage = (event) => {
            let data = event.data;
            if (data?.type === "reconfigured") {
                try {
                    assertWorkerRuntime(data, "worker-mt coordinator");
                } catch (error) {
                    data = {type: "reconfigure-error", requestId: data.requestId, message: error.message};
                }
            }
            if (this._handleControlMessage(data)) {
                return;
            }
            switch (data.type) {
                case "data":
                    dataFn(data);
                    break;
                case "ready":
                    try {
                        assertWorkerRuntime(data, "worker-mt coordinator");
                        this._resolveInitialization(data);
                        readyFn(data);
                    } catch (error) {
                        this._rejectInitialization(error);
                    }
                    break;
                case "ready-error":
                    this._rejectInitialization(new Error(data.message || "worker-mt coordinator initialization failed"));
                    break;
            }
        };
    }
}

class SubworkerPool {
    constructor() {
        this.workers = [];
        this._requestId = 0;
        this._pending = new Map();
        this.runtimeMetadata = [];
    }

    async init(settings, particlesBuffer, forceXBuffer, forceYBuffer, indexBufferA, indexBufferB, threadCount) {
        this.dispose();
        this._requestId = 0;
        this._pending = new Map();
        for (let i = 0; i < threadCount; i++) {
            const worker = new Worker(withBuildId("./worker_mt_task.js", import.meta.url), {type: "module"});
            worker._mtIndex = i;
            worker.onmessage = (event) => this._handleMessage(worker, event.data);
            worker.onerror = (event) => {
                event.preventDefault?.();
                this._handleWorkerFailure(worker, new Error(event.message || `worker-mt task #${i} failed`));
            };
            worker.onmessageerror = () => {
                this._handleWorkerFailure(worker, new Error(`worker-mt task #${i} returned an unreadable message`));
            };
            this.workers.push(worker);
        }
        const metadata = await Promise.all(this.workers.map(worker => this._sendInit(worker, "init", settings, particlesBuffer, forceXBuffer, forceYBuffer, indexBufferA, indexBufferB)));
        this.runtimeMetadata = metadata;
    }

    async reconfigure(settings, particlesBuffer, forceXBuffer, forceYBuffer, indexBufferA, indexBufferB, threadCount) {
        if (this.workers.length !== threadCount) {
            await this.init(settings, particlesBuffer, forceXBuffer, forceYBuffer, indexBufferA, indexBufferB, threadCount);
            return;
        }
        const metadata = await Promise.all(this.workers.map(worker => this._sendInit(worker, "reconfigure", settings, particlesBuffer, forceXBuffer, forceYBuffer, indexBufferA, indexBufferB)));
        this.runtimeMetadata = metadata;
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

    processHybridSeedBounds(ranges) {
        return this._processHybridSeedPhase("hybrid-seed-bounds", ranges);
    }

    processHybridSeedCounts(ranges, xMid, yMid) {
        return this._processHybridSeedPhase("hybrid-seed-count", ranges, {xMid, yMid});
    }

    processHybridSeedScatter(ranges, xMid, yMid, bucketOffsets) {
        return this._processHybridSeedPhase("hybrid-seed-scatter", ranges, {xMid, yMid}, bucketOffsets);
    }

    updateSegmentMaxCount(segmentMaxCount) {
        if (this.workers.length === 0) {
            return Promise.resolve([]);
        }
        return Promise.all(this.workers.map(worker => this._processSimpleTask(worker, {
            type: "set-segment-max-count",
            segmentMaxCount,
        })));
    }

    async processHybridTreeJobs(initialJobs, materializePartition, options = {}) {
        if (this.workers.length === 0 || initialJobs.length === 0) {
            return {results: [], dispatchTime: 0, spawnedJobCount: 0};
        }

        const queue = initialJobs.slice().sort((a, b) => estimateHybridJobWork(b) - estimateHybridJobWork(a));
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

                    this._processTreePartition(worker, partition, options)
                        .then((result) => {
                            result.descriptorBytes = partition.descriptorBytes || 0;
                            result.indexCopyBytes = partition.indexCopyBytes || 0;
                            results.push(result);
                            if (Array.isArray(result.spawnedJobs) && result.spawnedJobs.length > 0) {
                                spawnedJobCount += result.spawnedJobs.length;
                                queue.push(...result.spawnedJobs);
                                queue.sort((a, b) => estimateHybridJobWork(b) - estimateHybridJobWork(a));
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
        return new Promise((resolve, reject) => {
            const previous = worker.onmessage;
            const onError = (event) => {
                cleanup();
                reject(new Error(event.message || `worker-mt task #${worker._mtIndex} initialization failed`));
            };
            const cleanup = () => {
                worker.removeEventListener("error", onError);
                worker.onmessage = previous;
            };

            worker.addEventListener("error", onError, {once: true});
            worker.onmessage = (event) => {
                if (event.data?.type === "ready") {
                    cleanup();
                    try {
                        assertWorkerRuntime(event.data, `worker-mt task #${worker._mtIndex}`);
                        resolve(event.data);
                    } catch (error) {
                        reject(error);
                    }
                } else if (event.data?.type === "init-error") {
                    cleanup();
                    reject(new Error(event.data.message || `worker-mt task #${worker._mtIndex} initialization failed`));
                } else {
                    previous?.(event);
                }
            };
            worker.postMessage({
                type,
                settings: settings.serialize(),
                expectedBuildId: BUILD_ID,
                expectedProtocolVersion: WORKER_PROTOCOL_VERSION,
                segmentMaxCount: settings.simulation.segmentMaxCount,
                particlesBuffer,
                forceXBuffer,
                forceYBuffer,
                indexBufferA,
                indexBufferB,
            });
        });
    }

    _processPartition(worker, partition) {
        const transfer = [
            partition.leafStarts.buffer,
            partition.leafCounts.buffer,
            partition.leafIndexBuffers.buffer,
            partition.parentForceX.buffer,
            partition.parentForceY.buffer,
        ];
        return this._postRequest(worker, {
            type: "process",
            leafStartsBuffer: partition.leafStarts.buffer,
            leafCountsBuffer: partition.leafCounts.buffer,
            leafIndexBuffersBuffer: partition.leafIndexBuffers.buffer,
            parentForceXBuffer: partition.parentForceX.buffer,
            parentForceYBuffer: partition.parentForceY.buffer,
        }, transfer);
    }

    _processTreePartition(worker, partition, options = {}) {
        const transfer = [
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
        ];
        return this._postRequest(worker, {
            type: "process-tree-hybrid",
            splitBudget: options.splitBudget,
            minJobParticles: options.minJobParticles,
            debugTree: options.debugTree === true,
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
        }, transfer);
    }


    _processHybridSeedPhase(type, ranges, sharedPayload = {}, bucketOffsets = null) {
        const promises = [];
        for (let i = 0; i < this.workers.length; i++) {
            const range = ranges[i];
            if (!range || range.end <= range.start) {
                continue;
            }
            promises.push(this._processSimpleTask(this.workers[i], {
                type,
                startParticle: range.start,
                endParticle: range.end,
                ...sharedPayload,
                bucketOffsets: bucketOffsets?.[i] || null,
            }));
        }
        return Promise.all(promises);
    }

    _processSimpleTask(worker, payload) {
        return this._postRequest(worker, payload);
    }

    _postRequest(worker, payload, transfer = []) {
        const requestId = ++this._requestId;
        return new Promise((resolve, reject) => {
            this._pending.set(requestId, {resolve, reject, worker});
            try {
                worker.postMessage({...payload, requestId}, transfer);
            } catch (error) {
                this._pending.delete(requestId);
                reject(error);
            }
        });
    }

    _handleWorkerFailure(_worker, error) {
        // A pool with one dead worker can no longer satisfy the scheduler's
        // assumptions. Fail the whole in-flight step instead of leaving future
        // jobs queued forever on a dead worker.
        this._rejectAllPending(error);
        for (const worker of this.workers) {
            worker.onmessage = null;
            worker.onerror = null;
            worker.onmessageerror = null;
            worker.terminate();
        }
        this.workers = [];
        this.runtimeMetadata = [];
    }

    _rejectAllPending(error) {
        for (const pending of this._pending.values()) {
            pending.reject(error);
        }
        this._pending.clear();
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
        if (data.error) {
            pending.reject(new Error(data.error));
        } else {
            pending.resolve(data);
        }
    }

    dispose() {
        this._rejectAllPending(new Error("worker-mt task pool disposed while work was pending"));
        for (const worker of this.workers) {
            worker.postMessage({type: "dispose"});
            worker.onmessage = null;
            worker.onerror = null;
            worker.onmessageerror = null;
            worker.terminate();
        }
        this.workers = [];
        this.runtimeMetadata = [];
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

    async init(settings, state, runtime = {}) {
        if (runtime.expectedBuildId && runtime.expectedBuildId !== BUILD_ID) {
            throw new Error(`worker-mt coordinator build mismatch: expected ${runtime.expectedBuildId}, got ${BUILD_ID}`);
        }
        if (runtime.expectedProtocolVersion && runtime.expectedProtocolVersion !== WORKER_PROTOCOL_VERSION) {
            throw new Error(`worker-mt coordinator protocol mismatch: expected ${runtime.expectedProtocolVersion}, got ${WORKER_PROTOCOL_VERSION}`);
        }
        this.settings = AppSimulationSettings.deserialize(settings);
        this._initSegmentTuner();
        this._initParticles();
        this._applyParticlesState(state);
        this._initBuffers();
        this._ensureTreeWorkspace();
        this._initDebugForceView();
        await this._configurePool();
    }


    getRuntimeMetadata() {
        return {
            buildId: BUILD_ID,
            protocolVersion: WORKER_PROTOCOL_VERSION,
            taskWorkerBuildIds: [...new Set((this._pool.runtimeMetadata || []).map(item => item.buildId).filter(Boolean))],
            taskWorkerProtocolVersions: [...new Set((this._pool.runtimeMetadata || []).map(item => item.protocolVersion).filter(Number.isFinite))],
        };
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
        } else if (this.physicalEngine) {
            // In the no-SharedArrayBuffer fallback, the physical engine keeps a
            // settings reference of its own. Live gravity/collision/tree changes
            // must be applied even when the particle count stays unchanged.
            this.physicalEngine.reconfigure(this.settings);
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

        await this._applyTunedSegmentSize();

        if (!this._canUseMT()) {
            return this._singleThreadStep(timestamp);
        }

        if (this.settings.simulation.segmentDivider === 2) {
            return this._parallelTreeStep(timestamp);
        }

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
            this._treeWorkspace,
            {massCentered: this.settings.simulation.massCenteredTree});
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
            forceKernel: forceKernelName(),
            forceKernelApplied: [...new Set(workerResults.map(item => item.forceKernel).filter(Boolean))],
            forceKernelConsistent: workerResults.some(item => item.forceKernel) && workerResults
                .filter(item => item.forceKernel)
                .every(item => item.forceKernel === forceKernelName()),
            forcePairChecks: workerResults.reduce((sum, item) => sum + (item.forcePairChecks || 0), 0),
            forceKernelTimeMax: Math.max(0, ...workerResults.map(item => item.forceKernelTime || 0)),
            forceKernelTimeTotal: workerResults.reduce((sum, item) => sum + (item.forceKernelTime || 0), 0),
            forceCollisionTimeMax: Math.max(0, ...workerResults.map(item => item.forceCollisionTime || 0)),
            forceCollisionTimeTotal: workerResults.reduce((sum, item) => sum + (item.forceCollisionTime || 0), 0),
            forceGatherTimeMax: Math.max(0, ...workerResults.map(item => item.forceGatherTime || 0)),
            forceGatherTimeTotal: workerResults.reduce((sum, item) => sum + (item.forceGatherTime || 0), 0),
            forcePairTimeMax: Math.max(0, ...workerResults.map(item => item.forcePairTime || 0)),
            forcePairTimeTotal: workerResults.reduce((sum, item) => sum + (item.forcePairTime || 0), 0),
            forceFlushTimeMax: Math.max(0, ...workerResults.map(item => item.forceFlushTime || 0)),
            forceFlushTimeTotal: workerResults.reduce((sum, item) => sum + (item.forceFlushTime || 0), 0),
            forceTimingSamples: workerResults.reduce((sum, item) => sum + (item.forceTimingSamples || 0), 0),
            workerBuildId: BUILD_ID,
            workerProtocolVersion: WORKER_PROTOCOL_VERSION,
            taskWorkerBuildIds: [...new Set((this._pool.runtimeMetadata || []).map(item => item.buildId).filter(Boolean))],
            taskWorkerProtocolVersions: [...new Set((this._pool.runtimeMetadata || []).map(item => item.protocolVersion).filter(Number.isFinite))],
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
        const stepStart = performance.now();
        const profile = {forceTime: 0, integrateTime: 0, statsTime: 0, exportTime: 0, mt: null};

        if (this.settings.common.debugForce && this.forceX && this.forceY) {
            this.forceX.fill(0);
            this.forceY.fill(0);
        }

        let t = performance.now();
        const treeJobs = await this._buildHybridTreeSeedJobs();
        const topTreeTime = performance.now() - t;

        t = performance.now();
        const partitionPlan = this._buildHybridTreeJobPlan(treeJobs.jobs);
        const partitionTime = performance.now() - t;

        t = performance.now();
        const schedulerResult = await this._pool.processHybridTreeJobs(
            partitionPlan.jobs,
            partition => this._materializeTreeJobPartition(partition),
            {
                splitBudget: HYBRID_SPLIT_BUDGET,
                minJobParticles: this._getHybridMinJobParticles(),
                debugTree: this.settings.common.debugTree === true,
            },
        );
        const parallelWaitTime = performance.now() - t;
        const workerResults = schedulerResult.results;
        const dispatchTime = schedulerResult.dispatchTime || 0;
        const workerTiming = this._aggregateDynamicWorkerTiming(workerResults);

        const maxWorkerTreeTime = workerTiming.treeTimeMax;
        const treeTime = topTreeTime + maxWorkerTreeTime;
        const forceTime = workerTiming.forceTimeMax;
        const integrateTime = workerTiming.integrateTimeMax;
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
            treeJobCount: treeJobs.jobs.length,
            treeTargetJobs: treeJobs.targetJobs,
            treeSplitLevels: treeJobs.splitLevels,
            treeHybridSeedBoundsTime: treeJobs.profile.seedBoundsTime || 0,
            treeHybridSeedCountTime: treeJobs.profile.seedCountTime || 0,
            treeHybridSeedScatterTime: treeJobs.profile.seedScatterTime || 0,
            treePartitionCountParticlesMax: Math.max(0, ...workerResults.map(item => (item.treeProfile?.partitionCountParticles || 0) + (item.recursivePartitionCountParticles || 0))),
            treePartitionCountParticlesTotal: workerResults.reduce((sum, item) => sum + (item.treeProfile?.partitionCountParticles || 0) + (item.recursivePartitionCountParticles || 0), 0),
            treePartitionScatterParticlesMax: Math.max(0, ...workerResults.map(item => (item.treeProfile?.partitionScatterParticles || 0) + (item.recursivePartitionScatterParticles || 0))),
            treePartitionScatterParticlesTotal: workerResults.reduce((sum, item) => sum + (item.treeProfile?.partitionScatterParticles || 0) + (item.recursivePartitionScatterParticles || 0), 0),
            treePartitionCountTimeMax: Math.max(0, ...workerResults.map(item => (item.treeProfile?.partitionCountTime || 0) + (item.recursivePartitionCountTime || 0))),
            treePartitionCountTimeTotal: workerResults.reduce((sum, item) => sum + (item.treeProfile?.partitionCountTime || 0) + (item.recursivePartitionCountTime || 0), 0),
            treePartitionScatterTimeMax: Math.max(0, ...workerResults.map(item => (item.treeProfile?.partitionScatterTime || 0) + (item.recursivePartitionScatterTime || 0))),
            treePartitionScatterTimeTotal: workerResults.reduce((sum, item) => sum + (item.treeProfile?.partitionScatterTime || 0) + (item.recursivePartitionScatterTime || 0), 0),
            treePartitionTimingSamples: workerResults.reduce((sum, item) => sum + (item.treeProfile?.partitionTimingSamples || 0) + (item.recursivePartitionTimingSamples || 0), 0),
            treeNodeInitCountMax: Math.max(0, ...workerResults.map(item => item.treeProfile?.nodeInitCount || 0)),
            treeNodeInitCountTotal: workerResults.reduce((sum, item) => sum + (item.treeProfile?.nodeInitCount || 0), 0),
            treeLeafCollectTimeMax: Math.max(0, ...workerResults.map(item => item.treeProfile?.leafCollectTime || 0)),
            treeLeafCollectTimeTotal: workerResults.reduce((sum, item) => sum + (item.treeProfile?.leafCollectTime || 0), 0),
            treeSpawnedJobs: schedulerResult.spawnedJobCount || 0,
            treeEarlySplitResults: workerResults.reduce((sum, item) => sum + (item.hybridEarlySplit ? 1 : 0), 0),
            treeEarlySplitJobs: workerResults.reduce((sum, item) => sum + (item.hybridEarlySplitJobs || 0), 0),
            recursiveSplitCount: workerResults.reduce((sum, item) => sum + (item.recursiveSplitCount || 0), 0),
            recursiveSplitTime: workerResults.reduce((sum, item) => sum + (item.recursiveSplitTime || 0), 0),
            recursiveSplitBudget: HYBRID_SPLIT_BUDGET,
            recursiveMinJobParticles: this._getHybridMinJobParticles(),
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
            forceKernel: forceKernelName(),
            forceKernelApplied: [...new Set(workerResults.map(item => item.forceKernel).filter(Boolean))],
            forceKernelConsistent: workerResults.some(item => item.forceKernel) && workerResults.filter(item => item.forceKernel).every(item => item.forceKernel === forceKernelName()),
            forcePairChecks: workerResults.reduce((sum, item) => sum + (item.forcePairChecks || 0), 0),
            forceKernelTimeMax: Math.max(0, ...workerResults.map(item => item.forceKernelTime || 0)),
            forceKernelTimeTotal: workerResults.reduce((sum, item) => sum + (item.forceKernelTime || 0), 0),
            forceCollisionTimeMax: Math.max(0, ...workerResults.map(item => item.forceCollisionTime || 0)),
            forceCollisionTimeTotal: workerResults.reduce((sum, item) => sum + (item.forceCollisionTime || 0), 0),
            forceGatherTimeMax: 0,
            forceGatherTimeTotal: 0,
            forcePairTimeMax: Math.max(0, ...workerResults.map(item => item.forcePairTime || 0)),
            forcePairTimeTotal: workerResults.reduce((sum, item) => sum + (item.forcePairTime || 0), 0),
            forceFlushTimeMax: 0,
            forceFlushTimeTotal: 0,
            forceTimingSamples: 0,
            workerBuildId: BUILD_ID,
            workerProtocolVersion: WORKER_PROTOCOL_VERSION,
            taskWorkerBuildIds: [...new Set((this._pool.runtimeMetadata || []).map(item => item.buildId).filter(Boolean))],
            taskWorkerProtocolVersions: [...new Set((this._pool.runtimeMetadata || []).map(item => item.protocolVersion).filter(Number.isFinite))],
            workerCpuTime: workerTiming.workerCpuTime,
            workerMaxTime: workerTiming.workerMaxTime,
        };

        const stepCalcTime = performance.now() - stepStart;
        this._recordTuningSample(stepCalcTime);
        const buffer = this.buffers.shift();
        t = performance.now();
        buffer.set(this.particles);
        profile.exportTime = performance.now() - t;

        const treeStats = this._mergeParallelTreeStats(treeJobs.stats, workerResults);
        const treeProfile = this._mergeParallelTreeProfile(treeJobs.profile, workerResults, workerTiming, treeJobs, dispatchTime, profile.mt);
        const treeDebug = this.settings.common.debugTree ? this._mergeParallelTreeDebug(treeJobs.debugData, workerResults) : [];
        return this._buildParallelResult(timestamp, buffer, treeTime, dynamicPhysicsTime, treeStats, treeProfile, profile, treeDebug);
    }


    _buildParallelResult(timestamp, buffer, treeTime, physicsTime, treeStats, treeProfile, profile, treeDebug = []) {
        return {
            timestamp,
            buffer,
            treeDebug,
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

    _mergeParallelTreeDebug(topDebugData, workerResults) {
        const result = Array.isArray(topDebugData) ? topDebugData.slice() : [];
        for (const item of workerResults) {
            if (Array.isArray(item.treeDebug) && item.treeDebug.length > 0) {
                result.push(...item.treeDebug);
            }
        }
        return result;
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
            seedBoundsTime: topProfile.seedBoundsTime || 0,
            seedCountTime: topProfile.seedCountTime || 0,
            seedScatterTime: topProfile.seedScatterTime || 0,
            partitionCountParticles: mtProfile.treePartitionCountParticlesMax || 0,
            partitionCountParticlesTotal: mtProfile.treePartitionCountParticlesTotal || 0,
            partitionScatterParticles: mtProfile.treePartitionScatterParticlesMax || 0,
            partitionScatterParticlesTotal: mtProfile.treePartitionScatterParticlesTotal || 0,
            partitionCountTime: mtProfile.treePartitionCountTimeMax || 0,
            partitionCountTimeTotal: mtProfile.treePartitionCountTimeTotal || 0,
            partitionScatterTime: mtProfile.treePartitionScatterTimeMax || 0,
            partitionScatterTimeTotal: mtProfile.treePartitionScatterTimeTotal || 0,
            partitionTimingSamples: mtProfile.treePartitionTimingSamples || 0,
            nodeInitCount: mtProfile.treeNodeInitCountMax || 0,
            nodeInitCountTotal: mtProfile.treeNodeInitCountTotal || 0,
            leafCollectTime: mtProfile.treeLeafCollectTimeMax || 0,
            leafCollectTimeTotal: mtProfile.treeLeafCollectTimeTotal || 0,
            spawnedJobs: mtProfile.treeSpawnedJobs || 0,
            earlySplitResults: mtProfile.treeEarlySplitResults || 0,
            earlySplitJobs: mtProfile.treeEarlySplitJobs || 0,
            recursiveSplitCount: mtProfile.recursiveSplitCount || 0,
            recursiveSplitTime: mtProfile.recursiveSplitTime || 0,
            recursiveSplitBudget: HYBRID_SPLIT_BUDGET,
            recursiveMinJobParticles: this._getHybridMinJobParticles(),
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
    async _buildHybridTreeSeedJobs() {
        const count = this.settings.physics.particleCount;
        const targetJobs = Math.min(HYBRID_SEED_TARGET_JOBS, Math.max(1, count));
        const profile = {
            resetTime: 0,
            rootBoundsTime: 0,
            populateTime: 0,
            aggregateTime: 0,
            fastBucketPath: true,
            parallelSeedBootstrap: true,
            seedBoundsTime: 0,
            seedCountTime: 0,
            seedScatterTime: 0,
        };
        const stats = {flops: 0, depth: 1, segmentCount: 1};
        const debugData = this.settings.common.debugTree ? [] : null;
        const ranges = this._buildHybridSeedRanges(count);

        let t = performance.now();
        const boundsResults = await this._pool.processHybridSeedBounds(ranges);
        profile.seedBoundsTime = performance.now() - t;
        profile.rootBoundsTime = profile.seedBoundsTime;
        const rootBounds = this._mergeHybridSeedBounds(boundsResults);
        const root = {
            start: 0, count, indexBuffer: BUFFER_A, depth: 1,
            left: rootBounds.left, top: rootBounds.top, right: rootBounds.right, bottom: rootBounds.bottom,
            parentForceX: 0, parentForceY: 0,
        };
        if (count <= this.settings.simulation.segmentMaxCount || this._isParallelNodeTooSmall(root)) {
            return {jobs: [root], profile, stats: {...stats, segmentCount: 0}, targetJobs, splitLevels: 0, debugData};
        }

        const xMid = this._buildParallelMid(root.left, root.right - root.left);
        const yMid = this._buildParallelMid(root.top, root.bottom - root.top);
        t = performance.now();
        const countResults = await this._pool.processHybridSeedCounts(ranges, xMid, yMid);
        profile.seedCountTime = performance.now() - t;
        const bucketData = this._mergeHybridSeedBucketData(countResults);
        const usedBuckets = bucketData.counts.reduce((sum, value) => sum + (value > 0 ? 1 : 0), 0);
        if (usedBuckets <= 1) {
            profile.populateTime = profile.seedCountTime;
            return {jobs: [root], profile, stats: {...stats, segmentCount: 0}, targetJobs, splitLevels: 0, debugData};
        }

        const bucketOffsets = this._buildHybridSeedWorkerOffsets(bucketData.countsByWorker, bucketData.counts);
        t = performance.now();
        await this._pool.processHybridSeedScatter(ranges, xMid, yMid, bucketOffsets);
        profile.seedScatterTime = performance.now() - t;
        const jobs = this._createParallelChildrenFromBuckets(
            root,
            BUFFER_B,
            xMid,
            yMid,
            bucketData.counts,
            bucketData.mass,
            bucketData.momentX,
            bucketData.momentY,
        );
        if (debugData) debugData.push(this._createTreeDebugEntry(root));
        stats.flops += jobs.length * Math.max(0, jobs.length - 1) * TREE_FLOPS_PER_OP;
        stats.depth = Math.max(stats.depth, ...jobs.map(item => item.depth));
        profile.populateTime = profile.seedCountTime + profile.seedScatterTime;
        return {jobs, profile, stats: {...stats, segmentCount: 1}, targetJobs, splitLevels: 1, debugData};
    }

    _buildHybridSeedRanges(count) {
        const ranges = new Array(this._threadCount);
        for (let i = 0; i < this._threadCount; i++) {
            const start = Math.floor(count * i / this._threadCount);
            const end = Math.floor(count * (i + 1) / this._threadCount);
            ranges[i] = {start, end};
        }
        return ranges;
    }

    _mergeHybridSeedBounds(results) {
        let left = Infinity;
        let top = Infinity;
        let right = -Infinity;
        let bottom = -Infinity;
        for (const result of results) {
            if (Number.isFinite(result.minX)) left = Math.min(left, result.minX);
            if (Number.isFinite(result.minY)) top = Math.min(top, result.minY);
            if (Number.isFinite(result.maxX)) right = Math.max(right, result.maxX);
            if (Number.isFinite(result.maxY)) bottom = Math.max(bottom, result.maxY);
        }
        if (!Number.isFinite(left)) {
            return {left: 0, top: 0, right: 0, bottom: 0};
        }
        return {left, top, right, bottom};
    }

    _mergeHybridSeedBucketData(results) {
        const counts = new Int32Array(4);
        const mass = new Float64Array(4);
        const momentX = new Float64Array(4);
        const momentY = new Float64Array(4);
        const countsByWorker = new Array(this._threadCount).fill(null).map(() => new Int32Array(4));
        for (const result of results) {
            const workerIndex = Number.isFinite(result.workerIndex) ? result.workerIndex : 0;
            const workerCounts = countsByWorker[workerIndex];
            for (let bucket = 0; bucket < 4; bucket++) {
                const count = result.bucketCounts?.[bucket] || 0;
                const bucketMass = result.bucketMass?.[bucket] || 0;
                workerCounts[bucket] = count;
                counts[bucket] += count;
                mass[bucket] += bucketMass;
                momentX[bucket] += result.bucketMomentX?.[bucket] || 0;
                momentY[bucket] += result.bucketMomentY?.[bucket] || 0;
            }
        }
        return {counts, mass, momentX, momentY, countsByWorker};
    }

    _buildHybridSeedWorkerOffsets(countsByWorker, counts) {
        const bucketStarts = new Int32Array(4);
        let start = 0;
        for (let bucket = 0; bucket < 4; bucket++) {
            bucketStarts[bucket] = start;
            start += counts[bucket];
        }

        const nextOffsets = Array.from(bucketStarts);
        const offsets = new Array(this._threadCount);
        for (let workerIndex = 0; workerIndex < this._threadCount; workerIndex++) {
            offsets[workerIndex] = nextOffsets.slice();
            for (let bucket = 0; bucket < 4; bucket++) {
                nextOffsets[bucket] += countsByWorker[workerIndex][bucket];
            }
        }
        return offsets;
    }

    _createTreeDebugEntry(node) {
        return {
            x: node.left,
            y: node.top,
            width: node.right - node.left,
            height: node.bottom - node.top,
            count: node.count,
            depth: node.depth,
        };
    }

    _createParallelChildrenFromBuckets(node, targetBufferId, xMid, yMid, bucketCounts, bucketMass, bucketMomentX, bucketMomentY) {
        const bucketStarts = new Int32Array(4);
        let writeStart = node.start;
        for (let i = 0; i < 4; i++) {
            bucketStarts[i] = writeStart;
            writeStart += bucketCounts[i];
        }

        const children = [];
        for (let bucketIndex = 0; bucketIndex < 4; bucketIndex++) {
            const bucketCount = bucketCounts[bucketIndex];
            if (bucketCount === 0) {
                continue;
            }
            const x = bucketIndex >> 1;
            const y = bucketIndex & 1;
            const childLeft = x === 0 ? node.left : xMid;
            const childRight = x === 0 ? xMid : node.right + EPSILON;
            const childTop = y === 0 ? node.top : yMid;
            const childBottom = y === 0 ? yMid : node.bottom + EPSILON;
            const mass = bucketMass[bucketIndex];
            const geometricCenterX = childLeft + (childRight - childLeft) / 2;
            const geometricCenterY = childTop + (childBottom - childTop) / 2;
            const massCenterX = mass !== 0 ? bucketMomentX[bucketIndex] / mass : NaN;
            const massCenterY = mass !== 0 ? bucketMomentY[bucketIndex] / mass : NaN;
            const useMassCenter = this.settings.simulation.massCenteredTree;
            children.push({
                start: bucketStarts[bucketIndex],
                count: bucketCount,
                indexBuffer: targetBufferId,
                depth: node.depth + 1,
                left: childLeft,
                top: childTop,
                right: childRight,
                bottom: childBottom,
                centerX: useMassCenter && Number.isFinite(massCenterX) ? massCenterX : geometricCenterX,
                centerY: useMassCenter && Number.isFinite(massCenterY) ? massCenterY : geometricCenterY,
                mass,
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
    _buildHybridTreeJobPlan(jobs) {
        return {jobs: jobs.slice().sort((a, b) => estimateHybridJobWork(b) - estimateHybridJobWork(a))};
    }


    _aggregateDynamicWorkerTiming(workerResults) {
        const workerCount = Math.max(1, this._threadCount);
        const treeTimes = new Float64Array(workerCount);
        const forceTimes = new Float64Array(workerCount);
        const integrateTimes = new Float64Array(workerCount);
        const workCounts = new Uint32Array(workerCount);

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
            workCounts[workerIndex] += (item.jobCount || 0) + (item.recursiveSplitCount || 0);
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
            const workerTime = treeTimes[i] + forceTimes[i] + integrateTimes[i];
            if (workCounts[i] > 0 || workerTime > 0) {
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

    _getHybridMinJobParticles() {
        const tuned = this._actualSegmentSize || this.settings.simulation.segmentMaxCount || 32;
        return Math.max(HYBRID_MIN_JOB_PARTICLES, tuned * HYBRID_SEGMENT_MULTIPLIER);
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

    _isParallelNodeTooSmall(node) {
        return node.right - node.left <= EPSILON && node.bottom - node.top <= EPSILON;
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
        this.physicalEngine?.dispose();
        this.physicalEngine = null;
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
        try {
            await this._pool.reconfigure(
                this.settings,
                this.particles.buffer,
                this.forceX?.buffer ?? null,
                this.forceY?.buffer ?? null,
                this._treeWorkspace.indices.buffer,
                this._treeWorkspace.scratchIndices.buffer,
                this._threadCount,
            );
        } catch (error) {
            this._pool.dispose();
            throw error;
        }
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

        const maxThreadChoice = THREAD_CHOICES[THREAD_CHOICES.length - 1];
        const target = Math.max(2, Math.min(maxThreadChoice, hardwareConcurrency - 1));
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

    async _applyTunedSegmentSize() {
        if (!this._segmentTuner) {
            this._actualSegmentSize = this.settings.simulation.segmentMaxCount;
            return;
        }

        const nextSize = this._segmentTuner.currentSize;
        if (nextSize === this._actualSegmentSize) {
            return;
        }

        this._actualSegmentSize = nextSize;
        this._setSegmentMaxCount(nextSize);
        if (this._sharedMemoryAvailable && this._pool.workers.length > 0) {
            await this._pool.updateSegmentMaxCount(nextSize);
        }
    }

    _recordTuningSample(stepTime) {
        if (!this._segmentTuner) {
            return;
        }

        // The next candidate (or the final winner) is synchronized with task
        // workers at the beginning of the next physics step. Keeping the size
        // used by this step intact also makes the reported actual size honest.
        this._segmentTuner.record(stepTime);
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
            const childCenterX = tree.nodeMassCenterX[childId];
            const childCenterY = tree.nodeMassCenterY[childId];

            for (let j = 0; j < childCount; j++) {
                if (i === j) continue;
                const otherId = firstChild + j;
                const dx = childCenterX - tree.nodeMassCenterX[otherId];
                const dy = childCenterY - tree.nodeMassCenterY[otherId];
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
                const particleCount = tree.nodeParticleCount[nodeId];
                const pairMultiplier = 0.5;
                flops += particleCount * Math.max(0, particleCount - 1) * pairMultiplier * flopsPerOp;
            } else {
                flops += childCount * Math.max(0, childCount - 1) * flopsPerOp;
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
            workerBuildId: BUILD_ID,
            workerProtocolVersion: WORKER_PROTOCOL_VERSION,
            taskWorkerBuildIds: [],
            taskWorkerProtocolVersions: [],
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

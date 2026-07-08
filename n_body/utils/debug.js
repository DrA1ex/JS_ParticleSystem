import {DataSmoother} from "./smoother.js";
import * as CommonUtils from "./common.js";
import {getCrossOriginIsolationStatus} from "./coi.js";

function getDisplayName(instance, fallback = "n/a") {
    return instance?.displayName || instance?.constructor?.displayName || instance?.constructor?.name || fallback;
}
import {getParticleCount, getParticleVelX, getParticleVelY, getParticleX, getParticleY} from "./particles.js";

export class Debug {
    depth = 0;
    segmentCount = 0;
    bufferCount = 0;
    interpolateFrames = 0;

    treeTime = 0;
    physicsTime = 0;
    renderTime = 0;
    treeDebugData = [];
    forceDebugData = [];
    profile = null;
    treeProfile = null;
    actualSegmentSize = null;
    segmentAutoTune = null;
    mainStats = {
        rafInterval: null,
        callbackTime: null,
        prepareStepTime: null,
        debugOverlayTime: null,
        statsDomTime: null,
        onDataTime: null,
        bufferSwitchTime: null,
        maxRafInterval: null,
        droppedRafFrames: 0,
        noAheadBufferCount: 0,
        missedAheadFrames: 0,
        dfriTargetFrameTime: null,
    };
    longTaskCount = 0;
    longTaskTime = 0;
    lastLongTaskTime = null;

    get elapsed() {
        return this.frameRateSmoother.smoothedValue;
    }

    get flops() {
        return this.flopsSmoother.smoothedValue;
    }

    get frameLatency() {
        return this.frameLatencySmoother.smoothedValue;
    }

    /**
     * @param {RendererBase} renderer
     * @param {BackendBase} backend
     * @param {AppSimulationSettings} settings
     */
    constructor(renderer, backend, settings) {
        this.renderer = renderer;
        this.backend = backend;
        this.settings = settings;

        this.frameRateSmoother = new DataSmoother(this.settings.world.fps, 3, true);
        this.rawFrameRateSmoother = new DataSmoother(Math.max(10, Math.min(120, this.settings.world.fps)), 3, false);
        this.frameLatencySmoother = new DataSmoother(this.settings.world.fps);
        this.flopsSmoother = new DataSmoother(this.settings.world.fps, 0, true);
        this._lastStatsDrawTime = 0;
        this._statsDrawInterval = 250;
        this._maxDebugVectors = 1000;

        this._longTaskObserver = null;
        if (this.settings.common.verboseStats && typeof PerformanceObserver !== "undefined") {
            try {
                this._longTaskObserver = new PerformanceObserver((list) => {
                    for (const entry of list.getEntries()) {
                        this.longTaskCount += 1;
                        this.longTaskTime += entry.duration || 0;
                        this.lastLongTaskTime = entry.duration || 0;
                    }
                });
                this._longTaskObserver.observe({entryTypes: ["longtask"]});
            } catch (_) {
                this._longTaskObserver = null;
            }
        }

        if (this.settings.common.stats) {
            const div = document.createElement("div");
            div.id = "stats";

            document.getElementById("root-content").appendChild(div);
            this.infoElem = div;
        }
    }

    dispose() {
        this.renderer = null;
        this.backend = null;
        this.settings = null;

        this.frameRateSmoother = null;
        this.rawFrameRateSmoother = null;
        this.frameLatencySmoother = null;
        this.flopsSmoother = null;

        this._longTaskObserver?.disconnect();
        this._longTaskObserver = null;

        this.infoElem?.remove();
        this.infoElem = null;
    }

    drawStats() {
        const now = performance.now();
        if (now - this._lastStatsDrawTime < this._statsDrawInterval) {
            return 0;
        }
        const drawStart = performance.now();
        this._lastStatsDrawTime = now;

        const lines = this.settings.common.verboseStats ? this._buildVerboseStatsLines() : this._buildCompactStatsLines();
        this.infoElem.innerText = lines.join("\n");

        return performance.now() - drawStart;
    }

    _buildCompactStatsLines() {
        const flops = CommonUtils.formatUnit(this.flops, "FLOPS");
        const profile = this.profile || {};
        const rendererStats = this.renderer.stats || {};
        const actualSegmentSize = this.actualSegmentSize ?? this.settings.simulation.segmentMaxCount;
        const physicsTotal = this._sumFinite(this.treeTime, this.physicsTime, profile.exportTime, profile.statsTime);

        return [
            `fps: ${(1000 / this.elapsed || 0).toFixed(1)}`,
            `interpolated: ${this.settings.render.enableDFRI ? `${this.interpolateFrames} frames` : "off"}`,
            `ahead buffers: ${this.bufferCount}`,
            `particles: ${this.settings.physics.particleCount}`,
            `segments: ${this.segmentCount}, depth: ${this.depth}`,
            `complexity: ${flops}`,
            `- physics: ${this._formatMs(physicsTotal)}`,
            `  - tree: ${this._formatMs(this.treeTime)} (${this._formatPercent(this._ratio(this.treeTime, physicsTotal))})`,
            `  - force: ${this._formatMs(profile.forceTime)}`,
            `- render: ${this._formatMs(this.renderTime)}`,
            `  - gpu draw: ${this._formatMs(rendererStats.gpuDrawTime)} (${rendererStats.gpuTimerStatus || "n/a"})`,
            `backend: ${getDisplayName(this.backend, "Backend")}, block size: ${actualSegmentSize}${this._formatWorkerMT(profile.mt)}`,
            `renderer: ${getDisplayName(this.renderer, "Renderer")} @ ${this.renderer.canvasWidth} × ${this.renderer.canvasHeight}`,
        ];
    }

    _buildVerboseStatsLines() {
        const flops = CommonUtils.formatUnit(this.flops, "FLOPS");
        const profile = this.profile || {};
        const rendererStats = this.renderer.stats || {};
        const actualSegmentSize = this.actualSegmentSize ?? this.settings.simulation.segmentMaxCount;
        const main = this.mainStats || {};
        const rawFrameTime = this.rawFrameRateSmoother?.smoothedValue;
        const rawFps = rawFrameTime > 0 ? 1000 / rawFrameTime : 0;

        // Keep the verbose stats layout stable: fields that may be temporarily
        // unknown are rendered as n/a instead of being added/removed between frames.
        return [
            `max depth: ${this.depth}`,
            `segments: ${this.segmentCount}`,
            `complexity: ${flops}`,
            `ahead buffers: ${this.bufferCount}`,
            `interpolated: ${this.settings.render.enableDFRI ? `${this.interpolateFrames} frames` : "off"}`,
            `fps: ${(1000 / this.elapsed || 0).toFixed(1)}`,
            `raw fps: ${rawFps ? rawFps.toFixed(1) : "n/a"}, raf: ${this._formatMs(main.rafInterval)}`,
            `- main frame: ${this._formatMs(main.callbackTime)}`,
            `  - prepare step: ${this._formatMs(main.prepareStepTime)}`,
            `  - buffer switch: ${this._formatMs(main.bufferSwitchTime)}`,
            `  - on data: ${this._formatMs(main.onDataTime)}`,
            `  - debug overlay: ${this._formatMs(main.debugOverlayTime)}`,
            `  - stats dom: ${this._formatMs(main.statsDomTime)}`,
            `  - max raf: ${this._formatMs(main.maxRafInterval)}`,
            `  - dropped raf frames: ${main.droppedRafFrames ?? 0}`,
            `  - long tasks: ${this.longTaskCount} / ${this._formatMs(this.longTaskTime)}`,
            `  - last long task: ${this._formatMs(this.lastLongTaskTime)}`,
            `- DFRI pacing`,
            `  - target frame: ${this._formatMs(main.dfriTargetFrameTime)}`,
            `  - no ahead buffer: ${main.noAheadBufferCount ?? 0}`,
            `  - missed ahead frames: ${main.missedAheadFrames ?? 0}`,
            `- tree building: ${this._formatMs(this.treeTime)} (${this._formatPercent(this._ratio(this.treeTime, this._sumFinite(this.treeTime, this.physicsTime, profile.exportTime, profile.statsTime)))})`,
            `  - reset: ${this._formatMs(this.treeProfile?.resetTime)}`,
            `  - root bounds: ${this._formatMs(this.treeProfile?.rootBoundsTime)}`,
            `  - populate: ${this._formatMs(this.treeProfile?.populateTime)}`,
            `  - aggregate: ${this._formatMs(this.treeProfile?.aggregateTime)}`,
            `  - fast buckets: ${this.treeProfile?.fastBucketPath ? "on" : "off"}`,
            `  - parallel: ${this.treeProfile?.parallel ? "on" : "off"}${this.treeProfile?.dynamicScheduling ? ", dynamic" : ""}`,
            `  - target jobs: ${this.treeProfile?.targetJobs ?? "n/a"}, actual jobs: ${this.treeProfile?.parallelTreeJobs ?? "n/a"}, split levels: ${this.treeProfile?.splitLevels ?? "n/a"}`,
            `  - top populate: ${this._formatMs(this.treeProfile?.topPopulateTime)}`,
            `  - parallel wait: ${this._formatMs(this.treeProfile?.parallelTreeWaitTime)}`,
            `  - dispatch: ${this._formatMs(this.treeProfile?.dispatchTime)}`,
            `- physics calc: ${this._formatMs(this.physicsTime)}`,
            `  - force solve: ${this._formatMs(profile.forceTime)}`,
            `  - integrate: ${this._formatMs(profile.integrateTime)}`,
            `  - export buffer: ${this._formatMs(profile.exportTime)}`,
            `  - stats: ${this._formatMs(profile.statsTime)}`,
            `- render: ${this._formatMs(this.renderTime)}`,
            `  - prepare data: ${this._formatMs(rendererStats.prepareDataTime)}`,
            `  - upload: ${this._formatMs(rendererStats.uploadTime)}`,
            `  - uploaded: ${this._formatBytes(rendererStats.uploadedBytes)}`,
            `  - preload: ${this._formatMs(rendererStats.preloadTime)} / ${this._formatBytes(rendererStats.preloadedBytes)}`,
            `  - upload queue: ${rendererStats.uploadQueue ?? 0}`,
            `  - draw call: ${this._formatMs(rendererStats.drawTime)}`,
            `  - gpu draw: ${this._formatMs(rendererStats.gpuDrawTime)} (${rendererStats.gpuTimerStatus || "n/a"})`,
            `  - color mode: ${rendererStats.colorMode || "n/a"}`,
            `  - upload mode: ${rendererStats.uploadMode || "n/a"}`,
            `  - low latency ctx: ${rendererStats.webglLowLatency ? "on" : "off"}`,
            `  - gpu interpolation: ${rendererStats.gpuInterpolation || "off"}`,
            `  - filter mode: ${rendererStats.filterMode || "off"}`,
            `renderer: ${getDisplayName(this.renderer, "Renderer")} @ ${this.renderer.canvasWidth} × ${this.renderer.canvasHeight}`,
            `backend: ${getDisplayName(this.backend, "Backend")}, block size: ${actualSegmentSize}`,
            `worker mt: ${this._formatWorkerMTVerbose(profile.mt)}`,
            `coi: ${this._formatCrossOriginIsolation()}`,
            `auto tune: ${this._formatAutoTune(this.segmentAutoTune)}`,
        ];
    }

    _sumFinite(...values) {
        let hasValue = false;
        let sum = 0;
        for (const value of values) {
            if (Number.isFinite(value)) {
                hasValue = true;
                sum += value;
            }
        }

        return hasValue ? sum : null;
    }

    _ratio(numerator, denominator) {
        return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0
            ? numerator / denominator
            : null;
    }

    _formatPercent(value) {
        return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "n/a";
    }

    _formatMs(value) {
        return Number.isFinite(value) ? `${value.toFixed(1)} ms` : "n/a";
    }

    _formatBytes(value) {
        if (!Number.isFinite(value)) {
            return "n/a";
        }
        if (value < 1024) {
            return `${value} B`;
        }
        const mb = value / 1024 / 1024;
        return `${mb.toFixed(2)} MB`;
    }



    _formatCrossOriginIsolation() {
        const status = getCrossOriginIsolationStatus();
        const isolated = status.crossOriginIsolated ? "isolated" : "not isolated";
        const sab = status.sharedArrayBuffer ? "sab" : "no sab";
        const sw = status.coiServiceWorkerControlled
            ? "coi sw"
            : (status.serviceWorkerControlled ? "other sw" : "no sw");
        return `${isolated}, ${sab}, ${sw}`;
    }

    _formatWorkerMT(state) {
        if (!state) {
            return "";
        }
        if (!state.enabled) {
            return state.fallbackReason ? `, mt fallback: ${state.fallbackReason}` : ", mt off";
        }
        return `, threads: ${state.actualThreads}`;
    }

    _formatWorkerMTVerbose(state) {
        if (!state) {
            return "n/a";
        }
        if (!state.enabled) {
            const reason = state.fallbackReason ? `, ${state.fallbackReason}` : "";
            return `off${reason}`;
        }
        const wait = this._formatMs(state.parallelWaitTime);
        const taskBuild = this._formatMs(state.taskBuildTime);
        const partition = this._formatMs(state.partitionTime);
        const descriptorBytes = this._formatBytes(state.partitionDescriptorBytes);
        const indexCopyBytes = this._formatBytes(state.indexCopyBytes);
        const tasks = Number.isFinite(state.taskCount) ? state.taskCount : "n/a";
        const active = Number.isFinite(state.activeWorkers) ? state.activeWorkers : "n/a";
        const sharedIndices = state.sharedIndexBuffers ? "shared indices" : "copied indices";
        const dispatch = this._formatMs(state.dispatchTime);
        const treeMode = state.treeStrategy || (state.treeDynamicScheduling ? "dynamic" : "static");
        const spawned = Number.isFinite(state.treeSpawnedJobs) ? `, spawned ${state.treeSpawnedJobs}` : "";
        const tree = state.treeParallel
            ? `tree ${treeMode}, top ${this._formatMs(state.topTreeTime)}, tree max ${this._formatMs(state.treeTimeMax)}, jobs ${state.treeJobCount ?? "n/a"}/${state.treeTargetJobs ?? "n/a"}${spawned}, levels ${state.treeSplitLevels ?? "n/a"}, `
            : "tree off, ";
        return `${state.actualThreads} threads, ${active} active, ${tree}tasks ${tasks}, wait ${wait}, ` +
            `build ${taskBuild}, partition ${partition}, dispatch ${dispatch}, descriptors ${descriptorBytes}, ` +
            `index copy ${indexCopyBytes}, ${sharedIndices}`;
    }

    _formatAutoTune(state) {
        if (!state || !state.enabled) {
            return "off";
        }

        if (state.status === "done") {
            const avg = Number.isFinite(state.lastAverageTime) ? `, avg ${state.lastAverageTime.toFixed(1)} ms` : "";
            return `done, selected ${state.selectedSize}${avg}`;
        }

        return `tuning ${state.candidateSize}, sample ${state.sample}/${state.samplesPerCandidate}`;
    }

    postFrameTime(elapsed) {
        this.frameRateSmoother.postValue(elapsed);
        this.rawFrameRateSmoother.postValue(elapsed);
    }

    postFlops(flops) {
        this.flopsSmoother.postValue(flops);
    }

    postFrameLatency(latency) {
        this.frameLatencySmoother.postValue(latency);
    }

    drawTreeDebug() {
        this.renderer.setDrawStyle("#00ff00", null)
        for (let i = 0; i < this.treeDebugData.length; i++) {
            const data = this.treeDebugData[i];
            this.renderer.drawWorldRect(data.x, data.y, data.width, data.height);
        }
    }

    drawVelocityDebug(particles) {
        const count = getParticleCount(particles);
        const step = Math.max(1, Math.ceil(count / this._maxDebugVectors));

        if (this.settings.common.debugVelocity) {
            this.renderer.setDrawStyle("#ff00e5", null);
            for (let i = 0; i < count; i += step) {
                const x = getParticleX(particles, i);
                const y = getParticleY(particles, i);
                const velX = getParticleVelX(particles, i);
                const velY = getParticleVelY(particles, i);
                this.renderer.drawWorldLine(x, y, x + velX * 5, y + velY * 5);
            }
        }

        if (this.settings.common.debugForce) {
            this.renderer.setDrawStyle("#ff9900", null);
            const forceCount = Math.min(this.forceDebugData.length, count);
            const forceStep = Math.max(1, Math.ceil(forceCount / this._maxDebugVectors));
            for (let i = 0; i < forceCount; i += forceStep) {
                const x = getParticleX(particles, i);
                const y = getParticleY(particles, i);
                const {forceX, forceY} = this.forceDebugData[i];
                this.renderer.drawWorldLine(x, y, x + forceX * 50, y + forceY * 50);
            }
        }
    }

    importMainStats(stats) {
        this.mainStats = Object.assign({}, this.mainStats, stats);
    }

    importPhysicsStats(physics) {
        this.physicsTime = physics.stats.physicsTime;
        this.treeTime = physics.stats.treeTime;
        this.depth = physics.stats.tree.depth;
        this.segmentCount = physics.stats.tree.segmentCount;
        this.profile = physics.stats.profile || null;
        this.treeProfile = physics.stats.treeProfile || null;
        this.actualSegmentSize = physics.stats.actualSegmentSize ?? null;
        this.segmentAutoTune = physics.stats.segmentAutoTune ?? null;

        this.postFlops(physics.stats.tree.flops);
    }

    importTreeDebugData(data) {
        this.treeDebugData = data;
    }

    importForceDebugData(data) {
        this.forceDebugData = data;
    }
}
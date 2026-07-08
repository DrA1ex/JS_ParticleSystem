import {getCrossOriginIsolationStatus} from "./coi.js";

function getDisplayName(instance, fallback = "n/a") {
    return instance?.displayName || instance?.constructor?.displayName || instance?.constructor?.name || fallback;
}

function finite(value) {
    return Number.isFinite(value) ? value : null;
}

function clampInt(value, fallback, min, max) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }
    return Math.max(min, Math.min(max, parsed));
}

function clampNumber(value, fallback, min, max) {
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }
    return Math.max(min, Math.min(max, parsed));
}

function frame() {
    return new Promise(resolve => requestAnimationFrame(resolve));
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function percentile(sortedValues, p) {
    if (sortedValues.length === 0) {
        return null;
    }
    if (sortedValues.length === 1) {
        return sortedValues[0];
    }

    const index = (sortedValues.length - 1) * p;
    const lo = Math.floor(index);
    const hi = Math.ceil(index);
    if (lo === hi) {
        return sortedValues[lo];
    }

    const weight = index - lo;
    return sortedValues[lo] * (1 - weight) + sortedValues[hi] * weight;
}

function summarize(values) {
    const filtered = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (filtered.length === 0) {
        return {count: 0, min: null, max: null, avg: null, p50: null, p95: null, p99: null};
    }

    let sum = 0;
    for (const value of filtered) {
        sum += value;
    }

    return {
        count: filtered.length,
        min: filtered[0],
        max: filtered[filtered.length - 1],
        avg: sum / filtered.length,
        p50: percentile(filtered, 0.5),
        p95: percentile(filtered, 0.95),
        p99: percentile(filtered, 0.99),
    };
}

function pickMetric(sample, path) {
    let current = sample;
    for (const key of path.split(".")) {
        if (!current || typeof current !== "object") {
            return null;
        }
        current = current[key];
    }

    return Number.isFinite(current) ? current : null;
}

function sumFinite(...values) {
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

function ratio(numerator, denominator) {
    return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0
        ? numerator / denominator
        : null;
}

function cloneWorkerMTState(state) {
    if (!state) {
        return null;
    }

    const actualThreads = finite(state.actualThreads);
    const activeWorkers = finite(state.activeWorkers);
    const taskCount = finite(state.taskCount);
    const taskBuildTime = finite(state.taskBuildTime);
    const partitionTime = finite(state.partitionTime);
    const dispatchTime = finite(state.dispatchTime);
    const parallelWaitTime = finite(state.parallelWaitTime);
    const forceTimeMax = finite(state.forceTimeMax);
    const integrateTimeMax = finite(state.integrateTimeMax);
    const forceTimeTotal = finite(state.forceTimeTotal);
    const integrateTimeTotal = finite(state.integrateTimeTotal);
    const coordinationTime = sumFinite(taskBuildTime, partitionTime, dispatchTime);
    const wallTime = sumFinite(coordinationTime, parallelWaitTime);
    const treeTimeMax = finite(state.treeTimeMax);
    const treeTimeTotal = finite(state.treeTimeTotal);
    const topTreeTime = finite(state.topTreeTime);
    const workerCpuTime = sumFinite(treeTimeTotal, forceTimeTotal, integrateTimeTotal);
    const workerMaxTime = sumFinite(treeTimeMax, forceTimeMax, integrateTimeMax);
    const activeWorkerTime = Number.isFinite(parallelWaitTime) && Number.isFinite(activeWorkers)
        ? parallelWaitTime * activeWorkers
        : null;

    return {
        enabled: !!state.enabled,
        sharedMemory: !!state.sharedMemory,
        crossOriginIsolated: !!state.crossOriginIsolated,
        requestedThreads: state.requestedThreads ?? null,
        actualThreads,
        activeWorkers,
        fallbackReason: state.fallbackReason || null,
        taskCount,
        treeParallel: !!state.treeParallel,
        treeDynamicScheduling: !!state.treeDynamicScheduling,
        treeJobCount: finite(state.treeJobCount),
        treeTargetJobs: finite(state.treeTargetJobs),
        treeSplitLevels: finite(state.treeSplitLevels),
        topTreeTime,
        topTreeSplitTime: finite(state.topTreeSplitTime),
        treeRootBoundsTime: finite(state.treeRootBoundsTime),
        treeResetTime: finite(state.treeResetTime),
        treeTimeMax,
        treeTimeTotal,
        taskBuildTime,
        partitionTime,
        dispatchTime,
        coordinationTime,
        partitionDescriptorBytes: finite(state.partitionDescriptorBytes),
        descriptorBytesPerTask: ratio(state.partitionDescriptorBytes, taskCount),
        indexCopyBytes: finite(state.indexCopyBytes),
        sharedIndexBuffers: !!state.sharedIndexBuffers,
        parallelWaitTime,
        wallTime,
        forceTimeMax,
        integrateTimeMax,
        forceTimeTotal,
        integrateTimeTotal,
        workerCpuTime,
        workerMaxTime,
        workerIdleRatio: ratio(
            Number.isFinite(activeWorkerTime) && Number.isFinite(workerCpuTime)
                ? Math.max(0, activeWorkerTime - workerCpuTime)
                : null,
            activeWorkerTime,
        ),
        parallelEfficiency: ratio(workerCpuTime, activeWorkerTime),
        parallelSpeedupEstimate: ratio(workerCpuTime, parallelWaitTime),
    };
}

const BLOCK_METRICS = {
    "collector.rafInterval": "collectorRafInterval",
    "fps.smoothed": "fps.smoothed",
    "fps.raw": "fps.raw",
    "main.frame": "main.frame",
    "main.prepareStep": "main.prepareStep",
    "main.bufferSwitch": "main.bufferSwitch",
    "main.onData": "main.onData",
    "main.debugOverlay": "main.debugOverlay",
    "main.statsDom": "main.statsDom",
    "render.total": "render.total",
    "render.prepareData": "render.prepareData",
    "render.upload": "render.upload",
    "render.drawCall": "render.drawCall",
    "render.gpuDraw": "render.gpuDraw",
    "render.uploadedBytes": "render.uploadedBytes",
    "render.preload": "render.preload",
    "render.preloadedBytes": "render.preloadedBytes",
    "render.uploadQueue": "render.uploadQueue",
    "physics.stepTotal": "physics.stepTotal",
    "physics.tree": "physics.tree",
    "physics.treeShare": "physics.treeShare",
    "physics.tree.reset": "physics.treeProfile.resetTime",
    "physics.tree.rootBounds": "physics.treeProfile.rootBoundsTime",
    "physics.tree.populate": "physics.treeProfile.populateTime",
    "physics.tree.aggregate": "physics.treeProfile.aggregateTime",
    "physics.total": "physics.total",
    "physics.force": "physics.force",
    "physics.integrate": "physics.integrate",
    "physics.exportBuffer": "physics.exportBuffer",
    "physics.stats": "physics.stats",
    "physics.mt.actualThreads": "physics.workerMT.actualThreads",
    "physics.mt.activeWorkers": "physics.workerMT.activeWorkers",
    "physics.mt.taskCount": "physics.workerMT.taskCount",
    "physics.mt.taskBuild": "physics.workerMT.taskBuildTime",
    "physics.mt.partition": "physics.workerMT.partitionTime",
    "physics.mt.dispatch": "physics.workerMT.dispatchTime",
    "physics.mt.coordination": "physics.workerMT.coordinationTime",
    "physics.mt.parallelWait": "physics.workerMT.parallelWaitTime",
    "physics.mt.wall": "physics.workerMT.wallTime",
    "physics.mt.topTree": "physics.workerMT.topTreeTime",
    "physics.mt.treeMax": "physics.workerMT.treeTimeMax",
    "physics.mt.treeTotal": "physics.workerMT.treeTimeTotal",
    "physics.mt.treeJobs": "physics.workerMT.treeJobCount",
    "physics.mt.treeTargetJobs": "physics.workerMT.treeTargetJobs",
    "physics.mt.treeSplitLevels": "physics.workerMT.treeSplitLevels",
    "physics.mt.forceMax": "physics.workerMT.forceTimeMax",
    "physics.mt.integrateMax": "physics.workerMT.integrateTimeMax",
    "physics.mt.forceTotal": "physics.workerMT.forceTimeTotal",
    "physics.mt.integrateTotal": "physics.workerMT.integrateTimeTotal",
    "physics.mt.workerCpu": "physics.workerMT.workerCpuTime",
    "physics.mt.workerMax": "physics.workerMT.workerMaxTime",
    "physics.mt.parallelEfficiency": "physics.workerMT.parallelEfficiency",
    "physics.mt.parallelSpeedupEstimate": "physics.workerMT.parallelSpeedupEstimate",
    "physics.mt.workerIdleRatio": "physics.workerMT.workerIdleRatio",
    "physics.mt.descriptorBytes": "physics.workerMT.partitionDescriptorBytes",
    "physics.mt.descriptorBytesPerTask": "physics.workerMT.descriptorBytesPerTask",
    "physics.mt.indexCopyBytes": "physics.workerMT.indexCopyBytes",
    "dfri.frame": "dfri.frame",
    "dfri.interpolateFrames": "dfri.interpolateFrames",
    "dfri.targetFrame": "dfri.targetFrame",
    "dfri.actualStep": "dfri.actualStep",
    "dfri.desiredFrame": "dfri.desiredFrame",
    "queue.aheadBuffers": "queue.aheadBuffers",
    "queue.pendingBuffers": "queue.pendingBuffers",
};

function snapshotSettings(app) {
    const settings = app.settings;
    return {
        common: {
            stats: settings.common.stats,
            verboseStats: settings.common.verboseStats,
            debug: settings.common.debug,
            debugTree: settings.common.debugTree,
            debugVelocity: settings.common.debugVelocity,
            debugForce: settings.common.debugForce,
        },
        world: {
            fps: settings.world.fps,
            width: settings.world.width,
            height: settings.world.height,
        },
        simulation: {
            backend: settings.simulation.backend,
            bufferCount: settings.simulation.bufferCount,
            segmentSize: settings.simulation.segmentSize,
            segmentMaxCount: settings.simulation.segmentMaxCount,
            segmentDivider: settings.simulation.segmentDivider,
            segmentRandomness: settings.simulation.segmentRandomness,
            autoTuneSegmentSize: settings.simulation.autoTuneSegmentSize,
            workerThreads: settings.simulation.workerThreads,
            workerMtTreeJobs: settings.simulation.workerMtTreeJobs,
        },
        physics: {
            particleCount: settings.physics.particleCount,
            gravity: settings.physics.gravity,
            particleGravity: settings.physics.particleGravity,
            minInteractionDistanceSq: settings.physics.minInteractionDistanceSq,
            collisionSizeSq: settings.physics.collisionSizeSq,
            particleMass: settings.physics.particleMass,
        },
        render: {
            render: settings.render.render,
            colorMode: settings.render.colorMode,
            bufferUploadMode: settings.render.bufferUploadMode,
            webglLowLatency: settings.render.webglLowLatency,
            maxSpeedUpdateMode: settings.render.maxSpeedUpdateMode,
            enableDFRI: settings.render.enableDFRI,
            DFRIMaxFrames: settings.render.DFRIMaxFrames,
            slowMotionRate: settings.render.slowMotionRate,
            enableFilter: settings.render.enableFilter,
            enableBlending: settings.render.enableBlending,
            useDpr: settings.render.useDpr,
            dprRate: settings.render.dprRate,
            fixedParticleSize: settings.render.fixedParticleSize,
            particleSizeScale: settings.render.particleSizeScale,
        },
    };
}

function snapshotEnvironment(app) {
    const canvas = app.renderer?.canvas;
    return {
        runtime: {
            renderer: getDisplayName(app.renderer, "Renderer"),
            backend: getDisplayName(app.backend, "Backend"),
        },
        userAgent: navigator.userAgent,
        hardwareConcurrency: navigator.hardwareConcurrency ?? null,
        deviceMemory: navigator.deviceMemory ?? null,
        devicePixelRatio: window.devicePixelRatio,
        screen: {
            width: screen.width,
            height: screen.height,
            availWidth: screen.availWidth,
            availHeight: screen.availHeight,
        },
        viewport: {
            innerWidth: window.innerWidth,
            innerHeight: window.innerHeight,
        },
        canvas: canvas ? {
            clientWidth: canvas.clientWidth,
            clientHeight: canvas.clientHeight,
            width: canvas.width,
            height: canvas.height,
        } : null,
        visibilityState: document.visibilityState,
        crossOriginIsolated: window.crossOriginIsolated ?? false,
        sharedArrayBuffer: typeof SharedArrayBuffer !== "undefined",
        crossOriginIsolation: getCrossOriginIsolationStatus(),
    };
}

function snapshotApp(app, collectorRafInterval, collectorTimestamp) {
    const debug = app.debug;
    const renderer = app.renderer;
    const rendererStats = renderer?.stats || {};
    const profile = debug?.profile || {};
    const main = app.mainStats || {};
    const dfri = app.dfriHelper;
    const rawFrameTime = debug?.rawFrameRateSmoother?.smoothedValue;
    const smoothedFrameTime = debug?.elapsed;
    const actualSegmentSize = debug?.actualSegmentSize ?? app.settings.simulation.segmentMaxCount;
    const physicsStepTotal = sumFinite(debug?.treeTime, debug?.physicsTime, profile.exportTime, profile.statsTime);

    return {
        timestamp: finite(collectorTimestamp),
        collectorRafInterval: finite(collectorRafInterval),
        fps: {
            smoothed: smoothedFrameTime > 0 ? finite(1000 / smoothedFrameTime) : null,
            raw: rawFrameTime > 0 ? finite(1000 / rawFrameTime) : null,
            appRafInterval: finite(main.rafInterval),
            maxRafInterval: finite(main.maxRafInterval),
            droppedRafFrames: finite(main.droppedRafFrames),
        },
        main: {
            frame: finite(main.callbackTime),
            prepareStep: finite(main.prepareStepTime),
            bufferSwitch: finite(main.bufferSwitchTime),
            onData: finite(main.onDataTime),
            debugOverlay: finite(main.debugOverlayTime),
            statsDom: finite(main.statsDomTime),
        },
        render: {
            total: finite(rendererStats.renderTime),
            prepareData: finite(rendererStats.prepareDataTime),
            upload: finite(rendererStats.uploadTime),
            uploadedBytes: finite(rendererStats.uploadedBytes),
            preload: finite(rendererStats.preloadTime),
            preloadedBytes: finite(rendererStats.preloadedBytes),
            uploadQueue: finite(rendererStats.uploadQueue),
            webglLowLatency: !!rendererStats.webglLowLatency,
            drawCall: finite(rendererStats.drawTime),
            gpuDraw: finite(rendererStats.gpuDrawTime),
            gpuTimerStatus: rendererStats.gpuTimerStatus || "n/a",
            colorMode: rendererStats.colorMode || app.settings.render.colorMode,
            uploadMode: rendererStats.uploadMode || app.settings.render.bufferUploadMode,
            gpuInterpolation: rendererStats.gpuInterpolation || "off",
            filterMode: rendererStats.filterMode || "off",
        },
        physics: {
            stepTotal: physicsStepTotal,
            tree: finite(debug?.treeTime),
            treeShare: ratio(debug?.treeTime, physicsStepTotal),
            treeProfile: debug?.treeProfile ? {...debug.treeProfile} : null,
            total: finite(debug?.physicsTime),
            force: finite(profile.forceTime),
            integrate: finite(profile.integrateTime),
            exportBuffer: finite(profile.exportTime),
            stats: finite(profile.statsTime),
            complexity: finite(debug?.flops),
            depth: finite(debug?.depth),
            segments: finite(debug?.segmentCount),
            actualSegmentSize: finite(actualSegmentSize),
            autoTune: debug?.segmentAutoTune ? {...debug.segmentAutoTune} : null,
            workerMT: cloneWorkerMTState(profile.mt),
        },
        dfri: {
            enabled: app.settings.render.enableDFRI,
            frame: finite(dfri?.frame),
            interpolateFrames: finite(dfri?.interpolateFrames),
            targetFrame: finite(main.dfriTargetFrameTime ?? dfri?.targetRenderTime),
            actualStep: finite(dfri?.actualTime),
            desiredFrame: finite(dfri?.desiredTime),
            noAheadBufferCount: finite(main.noAheadBufferCount),
            missedAheadFrames: finite(main.missedAheadFrames),
            interpolationFactor: finite(renderer?._interpolationFactor),
            gpuInterpolationInternal: !!dfri?._gpuInterpolation,
            hasNextParticles: !!renderer?._nextParticles,
        },
        queue: {
            aheadBuffers: finite(app.aheadBuffers?.length),
            pendingBuffers: finite(app.pendingBufferCount),
            hasCurrentFrame: !!app.hasCurrentFrame,
            retainedCurrentBuffer: !!app.currentBuffer,
            simulationState: app.simulationCtrl?.currentState ?? null,
        },
    };
}

function summarizeSlowFrames(samples, targetFrameTime) {
    const threshold = Number.isFinite(targetFrameTime) && targetFrameTime > 0
        ? targetFrameTime * 1.5
        : 25;

    return samples
        .filter(sample => Number.isFinite(sample.collectorRafInterval) && sample.collectorRafInterval >= threshold)
        .slice(0, 40)
        .map(sample => ({
            timestamp: finite(sample.timestamp),
            rafInterval: finite(sample.collectorRafInterval),
            mainFrame: finite(sample.main?.frame),
            bufferSwitch: finite(sample.main?.bufferSwitch),
            onData: finite(sample.main?.onData),
            statsDom: finite(sample.main?.statsDom),
            renderTotal: finite(sample.render?.total),
            prepareData: finite(sample.render?.prepareData),
            upload: finite(sample.render?.upload),
            uploadedBytes: finite(sample.render?.uploadedBytes),
            preload: finite(sample.render?.preload),
            preloadedBytes: finite(sample.render?.preloadedBytes),
            uploadQueue: finite(sample.render?.uploadQueue),
            gpuDraw: finite(sample.render?.gpuDraw),
            colorMode: sample.render?.colorMode || null,
            uploadMode: sample.render?.uploadMode || null,
            gpuInterpolation: sample.render?.gpuInterpolation || null,
            aheadBuffers: finite(sample.queue?.aheadBuffers),
            pendingBuffers: finite(sample.queue?.pendingBuffers),
            dfriFrame: finite(sample.dfri?.frame),
            dfriInterpolateFrames: finite(sample.dfri?.interpolateFrames),
            mtEnabled: !!sample.physics?.workerMT?.enabled,
            mtThreads: finite(sample.physics?.workerMT?.actualThreads),
            mtActiveWorkers: finite(sample.physics?.workerMT?.activeWorkers),
            mtTaskCount: finite(sample.physics?.workerMT?.taskCount),
            mtParallelWait: finite(sample.physics?.workerMT?.parallelWaitTime),
            mtCoordination: finite(sample.physics?.workerMT?.coordinationTime),
            mtEfficiency: finite(sample.physics?.workerMT?.parallelEfficiency),
        }));
}

function summarizeBlock(samples, blockLongTasks, countersStart, countersEnd, startTime, endTime, targetFrameTime) {
    const metrics = {};
    for (const [name, path] of Object.entries(BLOCK_METRICS)) {
        metrics[name] = summarize(samples.map(sample => pickMetric(sample, path)));
    }

    const firstTimestamp = samples[0]?.timestamp;
    const lastTimestamp = samples[samples.length - 1]?.timestamp;
    const measuredDuration = Number.isFinite(firstTimestamp) && Number.isFinite(lastTimestamp) ? lastTimestamp - firstTimestamp : null;
    const measuredFps = measuredDuration && measuredDuration > 0 && samples.length > 1 ? (samples.length - 1) * 1000 / measuredDuration : null;

    return {
        startTimeMs: finite(startTime),
        endTimeMs: finite(endTime),
        durationMs: finite(endTime - startTime),
        measuredDurationMs: finite(measuredDuration),
        frames: samples.length,
        measuredFps: finite(measuredFps),
        countersDelta: {
            noAheadBuffer: Math.max(0, (countersEnd.noAheadBufferCount || 0) - (countersStart.noAheadBufferCount || 0)),
            missedAheadFrames: Math.max(0, (countersEnd.missedAheadFrames || 0) - (countersStart.missedAheadFrames || 0)),
            droppedRafFrames: Math.max(0, (countersEnd.droppedRafFrames || 0) - (countersStart.droppedRafFrames || 0)),
        },
        longTasks: {
            count: blockLongTasks.length,
            totalMs: blockLongTasks.reduce((sum, task) => sum + (task.duration || 0), 0),
            maxMs: blockLongTasks.reduce((max, task) => Math.max(max, task.duration || 0), 0),
            entries: blockLongTasks.slice(0, 20),
            truncated: blockLongTasks.length > 20,
        },
        slowFrames: summarizeSlowFrames(samples, targetFrameTime),
        metrics,
        firstSample: samples[0] || null,
        lastSample: samples[samples.length - 1] || null,
    };
}

async function collectFrameBlock(app, blockIndex, frames, longTasks, includeSamples) {
    const startLongTaskIndex = longTasks.length;
    const startTime = performance.now();
    const countersStart = {
        noAheadBufferCount: app.mainStats?.noAheadBufferCount || 0,
        missedAheadFrames: app.mainStats?.missedAheadFrames || 0,
        droppedRafFrames: app.mainStats?.droppedRafFrames || 0,
    };
    const samples = [];
    let previousTimestamp = null;

    for (let i = 0; i < frames; i++) {
        const timestamp = await frame();
        const collectorRafInterval = previousTimestamp === null ? null : timestamp - previousTimestamp;
        previousTimestamp = timestamp;
        samples.push(snapshotApp(app, collectorRafInterval, timestamp));
    }

    const endTime = performance.now();
    const countersEnd = {
        noAheadBufferCount: app.mainStats?.noAheadBufferCount || 0,
        missedAheadFrames: app.mainStats?.missedAheadFrames || 0,
        droppedRafFrames: app.mainStats?.droppedRafFrames || 0,
    };
    const blockLongTasks = longTasks.slice(startLongTaskIndex).filter(task => task.startTime >= startTime && task.startTime <= endTime);
    const targetFrameTime = app.dfriHelper?.targetRenderTime || (1000 / app.settings.world.fps);
    const summary = summarizeBlock(samples, blockLongTasks, countersStart, countersEnd, startTime, endTime, targetFrameTime);

    return {
        index: blockIndex,
        ...summary,
        samples: includeSamples ? samples : undefined,
    };
}

function uniqueValues(values) {
    return [...new Set(values.filter(value => value !== null && value !== undefined && value !== ""))];
}

function pickBlockMetricAvg(block, name) {
    const value = block.metrics?.[name]?.avg;
    return Number.isFinite(value) ? value : null;
}

function summarizeAcrossBlocks(blocks, metricName) {
    return summarize(blocks.map(block => pickBlockMetricAvg(block, metricName)));
}

function summarizeWorkerMTBlocks(blocks) {
    const states = [];
    for (const block of blocks) {
        if (block.firstSample?.physics?.workerMT) {
            states.push(block.firstSample.physics.workerMT);
        }
        if (block.lastSample?.physics?.workerMT) {
            states.push(block.lastSample.physics.workerMT);
        }
    }

    return {
        enabled: states.some(state => state.enabled),
        fallbackReasons: uniqueValues(states.map(state => state.fallbackReason)),
        requestedThreads: uniqueValues(states.map(state => state.requestedThreads)),
        actualThreads: summarizeAcrossBlocks(blocks, "physics.mt.actualThreads"),
        activeWorkers: summarizeAcrossBlocks(blocks, "physics.mt.activeWorkers"),
        taskCount: summarizeAcrossBlocks(blocks, "physics.mt.taskCount"),
        wallTime: summarizeAcrossBlocks(blocks, "physics.mt.wall"),
        coordinationTime: summarizeAcrossBlocks(blocks, "physics.mt.coordination"),
        taskBuildTime: summarizeAcrossBlocks(blocks, "physics.mt.taskBuild"),
        partitionTime: summarizeAcrossBlocks(blocks, "physics.mt.partition"),
        dispatchTime: summarizeAcrossBlocks(blocks, "physics.mt.dispatch"),
        parallelWaitTime: summarizeAcrossBlocks(blocks, "physics.mt.parallelWait"),
        topTreeTime: summarizeAcrossBlocks(blocks, "physics.mt.topTree"),
        treeMax: summarizeAcrossBlocks(blocks, "physics.mt.treeMax"),
        treeTotal: summarizeAcrossBlocks(blocks, "physics.mt.treeTotal"),
        treeJobCount: summarizeAcrossBlocks(blocks, "physics.mt.treeJobs"),
        treeTargetJobs: summarizeAcrossBlocks(blocks, "physics.mt.treeTargetJobs"),
        treeSplitLevels: summarizeAcrossBlocks(blocks, "physics.mt.treeSplitLevels"),
        treeParallel: states.some(state => state.treeParallel),
        treeDynamicScheduling: states.some(state => state.treeDynamicScheduling),
        forceMax: summarizeAcrossBlocks(blocks, "physics.mt.forceMax"),
        integrateMax: summarizeAcrossBlocks(blocks, "physics.mt.integrateMax"),
        forceTotal: summarizeAcrossBlocks(blocks, "physics.mt.forceTotal"),
        integrateTotal: summarizeAcrossBlocks(blocks, "physics.mt.integrateTotal"),
        workerCpuTime: summarizeAcrossBlocks(blocks, "physics.mt.workerCpu"),
        parallelEfficiency: summarizeAcrossBlocks(blocks, "physics.mt.parallelEfficiency"),
        parallelSpeedupEstimate: summarizeAcrossBlocks(blocks, "physics.mt.parallelSpeedupEstimate"),
        workerIdleRatio: summarizeAcrossBlocks(blocks, "physics.mt.workerIdleRatio"),
        descriptorBytes: summarizeAcrossBlocks(blocks, "physics.mt.descriptorBytes"),
        descriptorBytesPerTask: summarizeAcrossBlocks(blocks, "physics.mt.descriptorBytesPerTask"),
        indexCopyBytes: summarizeAcrossBlocks(blocks, "physics.mt.indexCopyBytes"),
        sharedIndexBuffers: states.some(state => state.sharedIndexBuffers),
    };
}

function summarizeReportBlocks(blocks) {
    const measuredFps = summarize(blocks.map(block => block.measuredFps));
    const rafIntervals = summarize(blocks.flatMap(block => {
        const metric = block.metrics?.["collector.rafInterval"];
        return metric?.count ? [metric.avg, metric.p50, metric.p95, metric.max].filter(Number.isFinite) : [];
    }));
    const totalLongTasks = blocks.reduce((sum, block) => sum + block.longTasks.count, 0);
    const totalLongTaskTime = blocks.reduce((sum, block) => sum + block.longTasks.totalMs, 0);

    return {
        measuredFps,
        rafIntervals,
        physics: {
            stepTotal: summarizeAcrossBlocks(blocks, "physics.stepTotal"),
            tree: summarizeAcrossBlocks(blocks, "physics.tree"),
            treeShare: summarizeAcrossBlocks(blocks, "physics.treeShare"),
            treeReset: summarizeAcrossBlocks(blocks, "physics.tree.reset"),
            treeRootBounds: summarizeAcrossBlocks(blocks, "physics.tree.rootBounds"),
            treePopulate: summarizeAcrossBlocks(blocks, "physics.tree.populate"),
            treeAggregate: summarizeAcrossBlocks(blocks, "physics.tree.aggregate"),
            calc: summarizeAcrossBlocks(blocks, "physics.total"),
            force: summarizeAcrossBlocks(blocks, "physics.force"),
            integrate: summarizeAcrossBlocks(blocks, "physics.integrate"),
            exportBuffer: summarizeAcrossBlocks(blocks, "physics.exportBuffer"),
            stats: summarizeAcrossBlocks(blocks, "physics.stats"),
        },
        workerMT: summarizeWorkerMTBlocks(blocks),
        noAheadBuffer: blocks.reduce((sum, block) => sum + block.countersDelta.noAheadBuffer, 0),
        missedAheadFrames: blocks.reduce((sum, block) => sum + block.countersDelta.missedAheadFrames, 0),
        droppedRafFrames: blocks.reduce((sum, block) => sum + block.countersDelta.droppedRafFrames, 0),
        longTasks: {
            count: totalLongTasks,
            totalMs: totalLongTaskTime,
        },
        slowFrames: blocks.reduce((sum, block) => sum + (block.slowFrames?.length || 0), 0),
    };
}

function startLongTaskObserver(longTasks) {
    if (typeof PerformanceObserver === "undefined") {
        return null;
    }

    try {
        const observer = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
                longTasks.push({
                    name: entry.name,
                    startTime: finite(entry.startTime),
                    duration: finite(entry.duration),
                });
            }
        });
        observer.observe({entryTypes: ["longtask"]});
        return observer;
    } catch (_) {
        return null;
    }
}

async function copyReportText(text) {
    try {
        await navigator.clipboard?.writeText(text);
        return true;
    } catch (_) {
        return false;
    }
}

function buildReportFileName(report) {
    const date = (report.createdAt || new Date().toISOString())
        .replace(/[:.]/g, "-")
        .replace(/[^0-9A-Za-z_-]/g, "_");
    const key = report.comparisonKey || {};
    const backend = key.backend || "backend";
    const threads = key.workerThreads ? `-${key.workerThreads}` : "";
    const particles = Number.isFinite(key.particleCount) ? `-${key.particleCount}p` : "";
    return `n-body-perf-${backend}${threads}${particles}-${date}.json`;
}

function downloadReportText(text, report) {
    if (typeof document === "undefined" || typeof Blob === "undefined" || typeof URL === "undefined") {
        return false;
    }

    try {
        const blob = new Blob([text], {type: "application/json;charset=utf-8"});
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = buildReportFileName(report);
        link.style.display = "none";
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        return true;
    } catch (_) {
        return false;
    }
}

function fixed(value, digits = 1) {
    return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function fixedPercent(value, digits = 1) {
    return Number.isFinite(value) ? fixed(value * 100, digits) : null;
}

function metricAvg(report, path) {
    let current = report;
    for (const key of path.split(".")) {
        if (!current || typeof current !== "object") {
            return null;
        }
        current = current[key];
    }
    return Number.isFinite(current?.avg) ? current.avg : null;
}

function buildCompactSummaryRows(reports) {
    return reports.map((report, index) => ({
        report: index + 1,
        backend: report.comparisonKey?.backend || report.settings?.simulation?.backend || "n/a",
        threads: report.comparisonKey?.workerThreads || report.settings?.simulation?.workerThreads || "n/a",
        treeJobsTarget: report.comparisonKey?.workerMtTreeJobs || report.settings?.simulation?.workerMtTreeJobs || "n/a",
        actualThreads: fixed(metricAvg(report, "summary.workerMT.actualThreads"), 0),
        fps: fixed(metricAvg(report, "summary.measuredFps"), 1),
        rafP95: fixed(metricAvg(report, "summary.rafIntervals"), 1),
        step: fixed(metricAvg(report, "summary.physics.stepTotal"), 1),
        tree: fixed(metricAvg(report, "summary.physics.tree"), 1),
        treeShare: fixedPercent(metricAvg(report, "summary.physics.treeShare"), 1),
        treePopulate: fixed(metricAvg(report, "summary.physics.treePopulate"), 1),
        calc: fixed(metricAvg(report, "summary.physics.calc"), 1),
        force: fixed(metricAvg(report, "summary.physics.force"), 1),
        integrate: fixed(metricAvg(report, "summary.physics.integrate"), 1),
        mtWall: fixed(metricAvg(report, "summary.workerMT.wallTime"), 1),
        mtTree: fixed(metricAvg(report, "summary.workerMT.treeMax"), 1),
        mtTopTree: fixed(metricAvg(report, "summary.workerMT.topTreeTime"), 1),
        mtJobs: fixed(metricAvg(report, "summary.workerMT.treeJobCount"), 0),
        mtTargetJobs: fixed(metricAvg(report, "summary.workerMT.treeTargetJobs"), 0),
        mtSplitLevels: fixed(metricAvg(report, "summary.workerMT.treeSplitLevels"), 0),
        mtWait: fixed(metricAvg(report, "summary.workerMT.parallelWaitTime"), 1),
        mtDispatch: fixed(metricAvg(report, "summary.workerMT.dispatchTime"), 1),
        mtCoord: fixed(metricAvg(report, "summary.workerMT.coordinationTime"), 1),
        mtEff: fixed(metricAvg(report, "summary.workerMT.parallelEfficiency"), 2),
        mtSpeedup: fixed(metricAvg(report, "summary.workerMT.parallelSpeedupEstimate"), 2),
        indexCopyBytes: fixed(metricAvg(report, "summary.workerMT.indexCopyBytes"), 0),
        fallback: report.summary?.workerMT?.fallbackReasons?.join(", ") || "",
    }));
}

function collectReportsFromArguments(items) {
    const reports = items.length ? items : [window.nBodyLastReport];
    return reports.flat().filter(item => item && item.type === "n-body-performance-report");
}

export function comparePerformanceReports(...items) {
    const reports = collectReportsFromArguments(items);
    const rows = buildCompactSummaryRows(reports);
    console.table(rows);
    return rows;
}

/**
 * Collects render/physics pacing diagnostics from the live app without relying
 * on the visible stats overlay. A block samples several RAF callbacks; multiple
 * blocks separated by a delay make intermittent pacing issues visible.
 *
 * Console usage:
 *   await window.nBodyCollectReport({frames: 240, blocks: 4, intervalMs: 5000})
 */
export async function collectPerformanceReport(app, options = {}) {
    const frames = clampInt(options.frames, 240, 1, 5000);
    const blocks = clampInt(options.blocks, 4, 1, 20);
    const intervalMs = clampNumber(options.intervalMs, 5000, 0, 60000);
    const includeSamples = options.includeSamples === true;
    const downloadReport = options.download !== false;
    const copyToClipboard = options.copy === true;
    const longTasks = [];
    const observer = startLongTaskObserver(longTasks);

    const report = {
        type: "n-body-performance-report",
        version: 1,
        createdAt: new Date().toISOString(),
        options: {frames, blocks, intervalMs, includeSamples, download: downloadReport, copy: copyToClipboard},
        environment: snapshotEnvironment(app),
        settings: snapshotSettings(app),
        comparisonKey: {
            backend: app.settings.simulation.backend,
            workerThreads: app.settings.simulation.workerThreads,
            workerMtTreeJobs: app.settings.simulation.workerMtTreeJobs,
            particleCount: app.settings.physics.particleCount,
            segmentSize: app.settings.simulation.segmentSize,
            autoTuneSegmentSize: app.settings.simulation.autoTuneSegmentSize,
            bufferCount: app.settings.simulation.bufferCount,
            colorMode: app.settings.render.colorMode,
            bufferUploadMode: app.settings.render.bufferUploadMode,
            webglLowLatency: app.settings.render.webglLowLatency,
        },
        initialSnapshot: snapshotApp(app, null, performance.now()),
        blocks: [],
        summary: null,
    };

    try {
        for (let i = 0; i < blocks; i++) {
            console.info(`[n-body] collecting performance block ${i + 1}/${blocks} (${frames} frames)`);
            report.blocks.push(await collectFrameBlock(app, i + 1, frames, longTasks, includeSamples));

            if (i < blocks - 1 && intervalMs > 0) {
                console.info(`[n-body] waiting ${(intervalMs / 1000).toFixed(1)}s before next block`);
                await delay(intervalMs);
            }
        }
    } finally {
        observer?.disconnect();
    }

    report.finalSnapshot = snapshotApp(app, null, performance.now());
    report.summary = summarizeReportBlocks(report.blocks);

    console.table(buildCompactSummaryRows([report]));

    const text = JSON.stringify(report, null, 2);
    window.nBodyLastReport = report;
    window.nBodyLastReportText = text;
    console.log("[n-body] performance report", report);
    console.log("[n-body] performance report JSON\n" + text);

    if (downloadReport) {
        const downloaded = downloadReportText(text, report);
        console.info(downloaded ? "[n-body] report download started" : "[n-body] report download failed; use window.nBodyLastReportText");
    }

    if (copyToClipboard) {
        const copied = await copyReportText(text);
        console.info(copied ? "[n-body] report copied to clipboard" : "[n-body] clipboard copy failed; use window.nBodyLastReportText");
    }

    return report;
}

export function installPerformanceReportConsole(app) {
    window.nBodyApp = app;
    window.nBodyCollectReport = (options) => collectPerformanceReport(app, options);
    window.nBodyCollectStats = window.nBodyCollectReport;
    window.nBodyCompareReports = (...reports) => comparePerformanceReports(...reports);
    window.nBodyReportHelp = () => {
        const message = [
            "Collect a performance report:",
            "  await window.nBodyCollectReport({frames: 240, blocks: 4, intervalMs: 5000})",
            "Recommended worker / worker-mt comparison:",
            "  1) Run the same URL with backend=worker",
            "  2) Run backend=worker-mt&worker_threads=2",
            "  3) Run backend=worker-mt&worker_threads=4",
            "  4) Run backend=worker-mt&worker_threads=6",
            "  Use the same particles, segment size, render settings, and warmed-up auto-tune state.",
            "Options:",
            "  frames: RAF samples per block, default 240",
            "  blocks: number of blocks, default 4",
            "  intervalMs: delay between blocks, default 5000",
            "  includeSamples: include every per-frame sample, default false",
            "  download: download JSON file, default true",
            "  copy: copy JSON to clipboard, default false",
            "Physics fields:",
            "  summary.physics.treeShare / treePopulate / treeAggregate show how much of the step is tree-bound",
            "MT fields:",
            "  summary.workerMT.wallTime / parallelWaitTime / dispatchTime / coordinationTime / parallelEfficiency / parallelSpeedupEstimate",
            "  summary.workerMT.treeJobCount / treeTargetJobs / treeSplitLevels show dynamic tree scheduling",
            "  metrics.physics.mt.* inside each block",
            "Compare reports already loaded in this page:",
            "  window.nBodyCompareReports(reportWorker, reportMt2, reportMt4, reportMt6)",
            "Last report is also available as window.nBodyLastReport and window.nBodyLastReportText."
        ].join("\n");
        console.info(message);
        return message;
    };
}

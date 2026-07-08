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
    "physics.tree": "physics.tree",
    "physics.total": "physics.total",
    "physics.force": "physics.force",
    "physics.integrate": "physics.integrate",
    "physics.exportBuffer": "physics.exportBuffer",
    "physics.stats": "physics.stats",
    "physics.mtThreads": "physics.mtThreads",
    "physics.mtTaskBuild": "physics.mtTaskBuild",
    "physics.mtPartition": "physics.mtPartition",
    "physics.mtParallelWait": "physics.mtParallelWait",
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
            tree: finite(debug?.treeTime),
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
            workerMT: profile.mt ? {...profile.mt} : null,
            mtThreads: finite(profile.mt?.actualThreads),
            mtTaskBuild: finite(profile.mt?.taskBuildTime),
            mtPartition: finite(profile.mt?.partitionTime),
            mtPartitionDescriptorBytes: finite(profile.mt?.partitionDescriptorBytes),
            mtIndexCopyBytes: finite(profile.mt?.indexCopyBytes),
            mtSharedIndexBuffers: !!profile.mt?.sharedIndexBuffers,
            mtParallelWait: finite(profile.mt?.parallelWaitTime),
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
    const copyToClipboard = options.copy !== false;
    const longTasks = [];
    const observer = startLongTaskObserver(longTasks);

    const report = {
        type: "n-body-performance-report",
        version: 1,
        createdAt: new Date().toISOString(),
        options: {frames, blocks, intervalMs, includeSamples},
        environment: snapshotEnvironment(app),
        settings: snapshotSettings(app),
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

    const text = JSON.stringify(report, null, 2);
    window.nBodyLastReport = report;
    window.nBodyLastReportText = text;
    console.log("[n-body] performance report", report);
    console.log("[n-body] performance report JSON\n" + text);

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
    window.nBodyReportHelp = () => {
        const message = [
            "Collect a performance report:",
            "  await window.nBodyCollectReport({frames: 240, blocks: 4, intervalMs: 5000})",
            "Options:",
            "  frames: RAF samples per block, default 240",
            "  blocks: number of blocks, default 4",
            "  intervalMs: delay between blocks, default 5000",
            "  includeSamples: include every per-frame sample, default false",
            "  copy: copy JSON to clipboard, default true",
            "Last report is also available as window.nBodyLastReport and window.nBodyLastReportText."
        ].join("\n");
        console.info(message);
        return message;
    };
}

import {DFRIHelper} from "./utils/dfri.js";
import {SimulationController} from "./controllers/simulation.js";
import {SimulationStateEnum} from "./controllers/enums.js";
import {AppSimulationSettings} from "./settings/app.js";
import {Debug} from "./utils/debug.js";
import {InteractionHandler} from "./render/interactions.js";
import {RendererInitializer} from "./render/init.js";
import {BackendInitializer} from "./backend/init.js";
import {ComponentType} from "./settings/base.js";
import {ITEM_SIZE, exportParticleState, getParticleCount} from "./utils/particles.js";
import {ensureCrossOriginIsolationForWorkerMT} from "./utils/coi.js";

export class Application {
    /** @type{RendererBase} */
    renderer = null;
    /** @type{AppSimulationSettings} */
    settings = null;
    /** @type{Float32Array|null} */
    particles = null;
    currentBuffer = null;
    hasCurrentFrame = false;

    canvasInteraction = null;
    dfriHelper = null;
    debug = null;

    aheadBuffers = [];
    pendingBufferCount = 0;
    refreshTime;
    lastRenderTime;
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
    _lastNoAheadWarningTime = 0;
    _lastReloadPromptSignature = null;
    _backendReconfigureVersion = 0;
    physicsStepCount = 0;

    /**
     * @param {AppSimulationSettings} settings
     */
    constructor(settings) {
        this.settings = settings;
        this.refreshTime = 1000 / this.settings.world.fps;
        this.simulationCtrl = new SimulationController(document.body, this);
        this._renderFrame = this.render.bind(this);
    }

    reloadFromState(state) {
        const importedSettings = {...(state.settings || {})};
        const importedParticleCount = getParticleCount(state.particles);
        if (!Number.isInteger(importedParticleCount) || importedParticleCount < 2) {
            throw new Error("State file does not contain a valid particle array");
        }
        // The particle buffer is authoritative. A stale particle_count in
        // either the URL or an older state file must never prevent loading.
        importedSettings.particleCount = importedParticleCount;

        // Saved universe values override matching URL settings, while runtime
        // choices not stored in the file (backend, threads, tree tuning, debug,
        // upload mode, etc.) stay exactly as currently configured.
        const newSettings = this.settings.withImportedState(importedSettings);
        // Import changes the live universe only. Keep the address bar untouched:
        // a locally loaded file should not rewrite or expand the current link.
        this.reconfigure(newSettings, state.particles, state.renderer, {
            updateUrl: false
        });
    }

    reconfigure(newSettings, particles, renderer, {updateUrl = true, preserveStateParam = true, forceBackendRestart = false} = {}) {
        this.simulationCtrl.setState(SimulationStateEnum.reconfigure);

        let diff = this.settings.compare(newSettings);
        if (diff.reloadRequired?.size > 0) {
            // Keep the requested value in the URL so a user reload applies it,
            // but do not mutate live settings for browser-owned objects that
            // cannot be reconfigured safely after creation, such as WebGL
            // context attributes.
            if (updateUrl) this._updateUrl(newSettings, diff.changes, {preserveStateParam});
            this._maybeEnableCrossOriginIsolation(newSettings);
            this._notifyReloadRequired(diff.reloadRequired);
            newSettings = this._withCurrentReloadRequiredValues(newSettings);
            diff = this.settings.compare(newSettings);
        } else {
            if (updateUrl) this._updateUrl(newSettings, diff.changes, {preserveStateParam});
            this._maybeEnableCrossOriginIsolation(newSettings);
        }

        if (particles) {
            diff.affects.add(ComponentType.backend);
            this.renderer?.resetParticleColors?.();
        }

        if (forceBackendRestart) {
            // Benchmark runs restore the exact same particle snapshot before each
            // case. Restart the whole physics pipeline so no ahead buffers,
            // worker-local tree workspaces, auto-tune state or debug metadata can
            // leak from the previous case.
            diff.breaks.add(ComponentType.backend);
            diff.breaks.add(ComponentType.dfri);
            diff.breaks.add(ComponentType.debug);
        }

        if (diff.breaks.has(ComponentType.renderer) && !diff.breaks.has(ComponentType.particles) && !renderer && this.renderer) {
            renderer = {
                scale: this.renderer.scale / this.renderer.dpr,
                relativeOffset: this.renderer.centeredRelativeOffset()
            }
        }


        if (diff.breaks.has(ComponentType.dfri)) {
            this.dfriHelper.dispose();
            this.dfriHelper = null;
        }

        if (diff.breaks.has(ComponentType.renderer)) {
            this.canvasInteraction.dispose();
            this.canvasInteraction = null;

            this.renderer.dispose();
            this.renderer = null;
        }

        if (diff.breaks.has(ComponentType.backend)) {
            this._backendReconfigureVersion += 1;
            this.backend.dispose();
            this.backend = null;
        }

        if (diff.breaks.has(ComponentType.debug)) {
            this.debug.dispose();
            this.debug = null;
        }

        if (!particles && !diff.breaks.has(ComponentType.particles)) {
            particles = exportParticleState(this.particles, newSettings.physics.particleCount);
        }

        if (diff.affects.has(ComponentType.backend) && !diff.breaks.has(ComponentType.backend)) {
            this._discardAheadBuffersForReconfigure();
        }

        if (diff.breaks.has(ComponentType.renderer)) {
            const oldCanvas = document.getElementById("canvas");
            const newCanvas = oldCanvas.cloneNode(false);
            oldCanvas.parentNode.replaceChild(newCanvas, oldCanvas);
            oldCanvas.remove();
        }

        if (diff.breaks.has(ComponentType.backend)) {
            this.aheadBuffers = [];
            this.pendingBufferCount = 0;
            this.currentBuffer = null;
            this.hasCurrentFrame = false;
            this.particles = null;
        }

        this.settings = newSettings;
        this.init({particles, renderer}, diff);
    }


    _discardAheadBuffersForReconfigure() {
        for (const entry of this.aheadBuffers) {
            if (entry?.buffer) {
                this.backend.freeBuffer(entry.buffer);
            }
        }
        this.aheadBuffers = [];
        this.dfriHelper?.reset?.();
        this.renderer?.clearInterpolationFrame?.();
    }


    _withCurrentReloadRequiredValues(newSettings) {
        const serialized = newSettings.serialize();
        for (const [groupName, group] of Object.entries(newSettings.constructor.Types)) {
            for (const [name, prop] of Object.entries(group.type.Properties)) {
                if (prop.requiresReload) {
                    serialized[groupName][name] = this.settings[groupName][name];
                }
            }
        }

        return newSettings.constructor.deserialize(serialized);
    }

    _notifyReloadRequired(properties) {
        const names = [...properties]
            .map(prop => prop.name || prop.key)
            .filter(Boolean)
            .join(", ");
        const signature = names || "reload-required-settings";
        if (this._lastReloadPromptSignature === signature) {
            return;
        }

        this._lastReloadPromptSignature = signature;
        const shouldReload = window.confirm([
            `${names || "This setting"} requires a page reload to take effect.`,
            "The URL has already been updated with the new value.",
            "Reload the page now?"
        ].join("\n"));

        if (shouldReload) {
            window.location.reload();
        }
    }


    _maybeEnableCrossOriginIsolation(settings) {
        ensureCrossOriginIsolationForWorkerMT(settings).catch(error => {
            console.warn("Failed to enable worker-mt cross-origin isolation", error);
        });
    }

    _updateUrl(newSettings, changes, {preserveStateParam = true} = {}) {
        if (!changes || changes.length === 0) {
            return;
        }

        // Patch only settings that actually changed. Rebuilding the full query
        // from the in-memory configuration used to leak resolved defaults
        // (renderer, DPR, particle count) and values loaded from state files
        // into the URL when the user changed an unrelated option.
        const url = new URL(window.location.href);
        for (const {groupName, name, prop, newValue} of changes) {
            const defaultValue = newSettings.effectiveDefaultValue(groupName, name);
            if (newValue === defaultValue) {
                url.searchParams.delete(prop.key);
                continue;
            }

            let queryValue = newValue;
            if (prop.type === "enum") {
                queryValue = typeof newValue === "string"
                    ? newValue
                    : Object.entries(prop.enumType).find(([, value]) => value === newValue)?.[0];
            }

            if (queryValue === null || queryValue === undefined) {
                url.searchParams.delete(prop.key);
            } else {
                url.searchParams.set(prop.key, String(queryValue));
            }
        }

        if (!preserveStateParam) {
            url.searchParams.delete("state");
        }

        window.history.replaceState('', '', url);
    }

    init(state, diff) {
        if (!diff || diff.breaks.has(ComponentType.renderer)) {
            this.renderer = RendererInitializer.initRenderer(document.getElementById("canvas"), this.settings.render.render, this.settings);
            this.canvasInteraction = new InteractionHandler(this.renderer);
            this.canvasInteraction.enable();
        } else if (diff.affects.has(ComponentType.renderer)) {
            this.renderer.reconfigure(this.settings);
        }

        if (!diff || diff.breaks.has(ComponentType.backend)) {
            this.backend = BackendInitializer.initBackend(this.settings.simulation.backend);
        }

        if (!diff || diff.breaks.has(ComponentType.dfri)) {
            this.dfriHelper = this.dfriHelper ?? new DFRIHelper(this.renderer, this.settings);
        }

        if (!diff || diff.breaks.has(ComponentType.debug)) {
            this.debug = this.debug ?? new Debug(this.renderer, this.backend, this.settings);
        } else {
            this.debug.settings = this.settings;
        }

        if (state?.renderer) {
            if (state.renderer.scale) {
                this.renderer.scale = state.renderer.scale * this.renderer.dpr;
            }

            if (state.renderer.relativeOffset) {
                const {xCenterOffset: x, yCenterOffset: y} = state.renderer.relativeOffset;
                this.renderer.setCenterRelativeOffset(x, y);
            }
        } else if (diff && diff.breaks.has(ComponentType.particles)) {
            this.renderer.resetScale();
        }

        let backendInitPromise = null;
        let initializedBackend = null;
        let backendReconfigurePromise = null;
        let reconfiguredBackend = null;
        if (!diff || diff.breaks.has(ComponentType.backend)) {
            this.particles = new Float32Array(this.settings.physics.particleCount * ITEM_SIZE);

            initializedBackend = this.backend;
            backendInitPromise = this.backend.init(
                data => this.onData(data, initializedBackend),
                () => this.requestNextStep(initializedBackend),
                this.settings,
                state?.particles,
            );
        } else if (diff.affects.has(ComponentType.backend)) {
            reconfiguredBackend = this.backend;
            backendReconfigurePromise = this.backend.reconfigure(this.settings, state?.particles);
        }

        if (this.settings.render.enableDFRI) {
            if (!diff || diff.breaks.has(ComponentType.dfri)) {
                this.dfriHelper.enable();
            } else if (diff?.affects?.has(ComponentType.dfri)) {
                this.dfriHelper.reconfigure(this.settings);
                this.dfriHelper.reset();
            }
        } else {
            // Explicitly clear renderer interpolation state when DFRI is disabled.
            // This prevents a previously uploaded WebGL ahead frame from continuing
            // to affect direct renderer.render(...) calls after settings changes.
            this.dfriHelper.disable();
        }

        if (!diff || diff.breaks.has(ComponentType.backend)) {
            this.simulationCtrl.setState(SimulationStateEnum.loading);
            backendInitPromise?.catch(error => {
                if (this.backend !== initializedBackend) return;
                this.pendingBufferCount = 0;
                // Avoid an infinite loader after an initialization failure. The
                // global error handler still surfaces the actual failure.
                this.simulationCtrl.setState(SimulationStateEnum.active);
                setTimeout(() => { throw error; });
            });
        } else if (backendReconfigurePromise) {
            const version = ++this._backendReconfigureVersion;
            backendReconfigurePromise.then(() => {
                if (version !== this._backendReconfigureVersion || this.backend !== reconfiguredBackend) {
                    return;
                }
                // All old data messages are ordered before the worker's
                // reconfigured acknowledgement, so the old in-flight buffers
                // have already been returned at this point.
                this.pendingBufferCount = 0;
                this.simulationCtrl.setState(SimulationStateEnum.active);
                this.requestNextStepIfNeeded();
            }).catch(error => {
                if (version !== this._backendReconfigureVersion) {
                    return;
                }
                this.pendingBufferCount = 0;
                this.simulationCtrl.setState(SimulationStateEnum.active);
                setTimeout(() => { throw error; });
            });
        } else {
            this.simulationCtrl.setState(SimulationStateEnum.active);
        }

        this.lastRenderTime = performance.now() - this.refreshTime;
    }

    run() {
        requestAnimationFrame(this._renderFrame);
    }

    onData(data, sourceBackend = this.backend) {
        // A terminated/replaced worker can still have an already queued message
        // in the main-thread event loop. Never let that stale frame enter the
        // new backend's queue or acknowledge its transferred buffer to the wrong
        // worker instance.
        if (sourceBackend !== this.backend) {
            return;
        }

        const onDataStart = performance.now();
        if (this.simulationCtrl.currentState === SimulationStateEnum.reconfigure) {
            // A live backend reconfiguration is queued behind any already
            // requested physics steps. Drop those stale frames, but always
            // return their transferred buffers so the worker pool cannot run
            // dry before processing the new configuration.
            this.pendingBufferCount = Math.max(0, this.pendingBufferCount - 1);
            if (data?.buffer) {
                sourceBackend.freeBuffer(data.buffer);
            }
            return;
        }

        this.physicsStepCount += 1;

        const stepLatency = performance.now() - data.timestamp;
        this.dfriHelper.postStepTime(stepLatency);

        this.debug.postFrameLatency(Math.max(stepLatency, this.debug.elapsed));

        this.simulationCtrl.onNewBuffer(data.buffer);

        if (this.simulationCtrl.currentState === SimulationStateEnum.loading) {
            this.simulationCtrl.setState(SimulationStateEnum.active);
        }

        this.aheadBuffers.push({buffer: data.buffer, treeDebug: data.treeDebug, forceDebug: data.forceDebug});
        this.pendingBufferCount = Math.max(0, this.pendingBufferCount - 1);

        // GPU DFRI needs an actual ahead frame. Some backends, especially the
        // GPGPU backend, can deliver that frame after the current frame was
        // already switched. Refresh the renderer ahead-frame as soon as it
        // becomes available instead of waiting for the next switch.
        if (this.settings.render.enableDFRI && this.hasCurrentFrame) {
            const updated = this.dfriHelper.updateAheadFrame?.(this.particles, this.aheadBuffers[0]);
            if (updated) {
                this.renderer.preloadInterpolationFrame?.(this.aheadBuffers[0]?.buffer, 4);
            }
        }

        this.requestNextStepIfNeeded();

        if (this.settings.common.stats) this.debug.importPhysicsStats(data);
        this.mainStats.onDataTime = performance.now() - onDataStart;
    }

    prepareNextStep() {
        if (this.simulationCtrl.currentState === SimulationStateEnum.paused ||
            this.simulationCtrl.currentState === SimulationStateEnum.reconfigure) {
            return;
        }

        if (this.settings.render.enableDFRI && !this.dfriHelper.needNextFrame()) {
            return;
        }

        if (this.aheadBuffers.length === 0) {
            if (this.settings.render.enableDFRI) {
                this.mainStats.noAheadBufferCount += 1;
                this.mainStats.missedAheadFrames += 1;
                if (this.hasCurrentFrame && this.dfriHelper.frame > this.dfriHelper.interpolateFrames) {
                    this.dfriHelper.reportAheadBufferMiss?.();
                }
                this._warnNoAheadBufferIfNeeded();
            }
            return;
        }

        const bufferSwitchStart = performance.now();
        const previousBuffer = this.currentBuffer;
        const bufferEntry = this.aheadBuffers.shift();
        const data = bufferEntry.buffer;

        // With more than one worker buffer we keep the currently rendered buffer
        // and return the previous one only after the frame switches. With a
        // single buffer, copy the data so the backend can continue immediately.
        if (this.settings.simulation.bufferCount <= 1) {
            if (!this.particles) {
                this.particles = new Float32Array(data.length);
            }
            if (this.particles.length !== data.length) {
                this.particles = new Float32Array(data.length);
            }
            this.particles.set(data);
            this.currentBuffer = null;
            this.backend.freeBuffer(data);
        } else {
            this.currentBuffer = data;
            this.particles = data;

            if (previousBuffer) {
                this.backend.freeBuffer(previousBuffer);
            }
        }

        this.hasCurrentFrame = true;
        this.renderer.markParticlesDirty?.();

        if (this.settings.common.debugTree) this.debug.importTreeDebugData(bufferEntry.treeDebug);
        if (this.settings.common.debugForce) this.debug.importForceDebugData(bufferEntry.forceDebug);

        this.requestNextStepIfNeeded();

        if (this.settings.render.enableDFRI && this.dfriHelper.needNextFrame()) {
            this.dfriHelper.bufferSwitched(this.particles, this.aheadBuffers[0]);
            this.renderer.preloadInterpolationFrame?.(this.aheadBuffers[0]?.buffer || this.particles, 4);
        }

        this.mainStats.bufferSwitchTime = performance.now() - bufferSwitchStart;
    }

    requestNextStep(sourceBackend = this.backend) {
        if (!sourceBackend || sourceBackend !== this.backend) {
            return;
        }
        this.pendingBufferCount += 1;
        sourceBackend.requestNextStep();
    }

    _warnNoAheadBufferIfNeeded() {
        if (!this.settings.common.verboseStats) {
            return;
        }

        const now = performance.now();
        if (now - this._lastNoAheadWarningTime < 1000) {
            return;
        }

        this._lastNoAheadWarningTime = now;
        console.warn(`${now.toFixed(0)} Next buffer not ready. Frames may be dropped`);
    }

    _recordRafInterval(elapsed) {
        if (!Number.isFinite(elapsed) || elapsed <= 0) {
            return;
        }

        this.mainStats.maxRafInterval = Math.max(this.mainStats.maxRafInterval || 0, elapsed);
        const targetFrameTime = this.dfriHelper?.targetRenderTime || this.refreshTime;
        this.mainStats.dfriTargetFrameTime = targetFrameTime;

        if (Number.isFinite(targetFrameTime) && targetFrameTime > 0 && elapsed > targetFrameTime * 1.5) {
            this.mainStats.droppedRafFrames += Math.max(1, Math.round(elapsed / targetFrameTime) - 1);
        }
    }

    requestNextStepIfNeeded() {
        // A retained render buffer is not available to the worker, so the fill
        // target is reduced by one until that buffer is acknowledged.
        const retainedBufferCount = this.currentBuffer ? 1 : 0;
        const targetBufferCount = Math.max(1, this.settings.simulation.bufferCount - retainedBufferCount);
        if (this.aheadBuffers.length + this.pendingBufferCount < targetBufferCount) {
            this.requestNextStep();
        }
    }

    render(timestamp) {
        // Queue the next RAF as early as possible. If this callback performs a
        // costly buffer switch or stats update, registering at the end can make
        // the browser miss the next high-refresh display slot more easily.
        requestAnimationFrame(this._renderFrame);

        const callbackStart = performance.now();
        const elapsed = timestamp - this.lastRenderTime;
        this.mainStats.rafInterval = elapsed;
        this._recordRafInterval(elapsed);

        if (this.simulationCtrl.currentState === SimulationStateEnum.loading) {
            this.lastRenderTime = timestamp;
            this.mainStats.callbackTime = performance.now() - callbackStart;
            return;
        }

        const prepareStart = performance.now();
        this.prepareNextStep();
        this.mainStats.prepareStepTime = performance.now() - prepareStart;

        if (this.settings.render.enableDFRI && this.simulationCtrl.currentState !== SimulationStateEnum.paused) {
            this.dfriHelper.render(this.particles);
        } else {
            this.renderer.render(this.particles);
        }

        const debugStart = performance.now();
        if (this.settings.common.debugTree) this.debug.drawTreeDebug();
        if (this.settings.common.debugForce || this.settings.common.debugVelocity) this.debug.drawVelocityDebug(this.particles);
        this.mainStats.debugOverlayTime = performance.now() - debugStart;

        this.dfriHelper.postRenderTime(elapsed);
        this.debug.postFrameTime(elapsed);

        let statsDomTime = 0;
        if (this.settings.common.stats) {
            this.debug.renderTime = this.renderer.stats.renderTime;
            this.debug.bufferCount = this.aheadBuffers.length;
            this.debug.interpolateFrames = this.dfriHelper.interpolateFrames;
            this.debug.dfriPacing = this.dfriHelper.pacingDiagnostics ?? null;
            this.debug.importMainStats(this.mainStats);
            statsDomTime = this.debug.drawStats();
            this.mainStats.statsDomTime = statsDomTime;
        }

        this.lastRenderTime = timestamp;
        this.mainStats.callbackTime = performance.now() - callbackStart;
    }
}
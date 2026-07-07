import {DFRIHelper} from "./utils/dfri.js";
import {SimulationController} from "./controllers/simulation.js";
import {SimulationStateEnum} from "./controllers/enums.js";
import {AppSimulationSettings} from "./settings/app.js";
import {Debug} from "./utils/debug.js";
import {InteractionHandler} from "./render/interactions.js";
import {RendererInitializer} from "./render/init.js";
import {BackendInitializer} from "./backend/init.js";
import {ComponentType} from "./settings/base.js";
import {ITEM_SIZE, exportParticleState} from "./utils/particles.js";

export class Application {
    /** @type{RendererBase} */
    renderer = null;
    /** @type{AppSimulationSettings} */
    settings = null;
    /** @type{Float32Array|null} */
    particles = null;
    currentBuffer = null;

    canvasInteraction = null;
    dfriHelper = null;
    debug = null;

    aheadBuffers = [];
    pendingBufferCount = 0;
    refreshTime;
    lastRenderTime;

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
        const newSettings = AppSimulationSettings.import(state.settings);
        this.reconfigure(newSettings, state.particles, state.renderer);
    }

    reconfigure(newSettings, particles, renderer) {
        this.simulationCtrl.setState(SimulationStateEnum.reconfigure);
        this._updateUrl(newSettings);

        const diff = this.settings.compare(newSettings);
        if (particles) {
            diff.affects.add(ComponentType.backend);
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
            this.particles = null;
        }

        this.settings = newSettings;
        this.init({particles, renderer}, diff);
    }

    _updateUrl(newSettings) {
        const params = newSettings.toQueryParams();
        const url = new URL(window.location.pathname, window.location.origin);
        for (const param of params) {
            url.searchParams.set(param.key, param.value ?? "");
        }

        const urlSearchParams = new URLSearchParams(window.location.search);
        const existingParams = Object.fromEntries(urlSearchParams.entries());
        if (existingParams.state) {
            url.searchParams.set("state", existingParams.state);
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

        if (!diff || diff.breaks.has(ComponentType.backend)) {
            this.particles = new Float32Array(this.settings.physics.particleCount * ITEM_SIZE);

            this.backend.init(this.onData.bind(this), this.requestNextStep.bind(this), this.settings, state?.particles);
        } else if (diff.affects.has(ComponentType.backend)) {
            this.backend.reconfigure(this.settings, state?.particles);
        }

        if ((!diff || diff.breaks.has(ComponentType.dfri)) && this.settings.render.enableDFRI) {
            this.dfriHelper.enable();
        } else if (diff?.affects?.has(ComponentType.dfri)) {
            this.dfriHelper.reconfigure(this.settings);
            this.dfriHelper.reset();
        }

        if (!diff || diff.breaks.has(ComponentType.backend)) {
            this.simulationCtrl.setState(SimulationStateEnum.loading);
        } else {
            this.simulationCtrl.setState(SimulationStateEnum.active);
        }

        this.lastRenderTime = performance.now() - this.refreshTime;
    }

    run() {
        requestAnimationFrame(this._renderFrame);
    }

    onData(data) {
        if (this.simulationCtrl.currentState === SimulationStateEnum.reconfigure) {
            return;
        }

        const stepLatency = performance.now() - data.timestamp;
        this.dfriHelper.postStepTime(stepLatency);

        this.debug.postFrameLatency(Math.max(stepLatency, this.debug.elapsed));

        this.simulationCtrl.onNewBuffer(data.buffer);

        if (this.simulationCtrl.currentState === SimulationStateEnum.loading) {
            this.simulationCtrl.setState(SimulationStateEnum.active);
        }

        this.aheadBuffers.push({buffer: data.buffer, treeDebug: data.treeDebug, forceDebug: data.forceDebug});
        this.pendingBufferCount -= 1;

        this.requestNextStepIfNeeded();

        if (this.settings.common.stats) this.debug.importPhysicsStats(data);
    }

    prepareNextStep() {
        if (this.simulationCtrl.currentState === SimulationStateEnum.paused) {
            return;
        }

        if (this.settings.render.enableDFRI && !this.dfriHelper.needNextFrame()) {
            return;
        }

        if (this.aheadBuffers.length === 0) {
            if (this.settings.render.enableDFRI) {
                console.warn(`${performance.now().toFixed(0)} Next buffer not ready. Frames may be dropped`);
            }
            return;
        }

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

        if (this.settings.common.debugTree) this.debug.importTreeDebugData(bufferEntry.treeDebug);
        if (this.settings.common.debugForce) this.debug.importForceDebugData(bufferEntry.forceDebug);

        this.requestNextStepIfNeeded();

        if (this.settings.render.enableDFRI && this.dfriHelper.needNextFrame()) {
            this.dfriHelper.bufferSwitched(this.particles, this.aheadBuffers[0]);
        }
    }

    requestNextStep() {
        this.pendingBufferCount += 1;
        this.backend.requestNextStep();
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
        if (this.simulationCtrl.currentState === SimulationStateEnum.loading) {
            this.lastRenderTime = timestamp;
            requestAnimationFrame(this._renderFrame);
            return;
        }

        this.prepareNextStep();
        if (this.settings.render.enableDFRI && this.simulationCtrl.currentState !== SimulationStateEnum.paused) {
            this.dfriHelper.render(this.particles);
        } else {
            this.renderer.render(this.particles);
        }

        if (this.settings.common.debugTree) this.debug.drawTreeDebug();
        if (this.settings.common.debugForce || this.settings.common.debugVelocity) this.debug.drawVelocityDebug(this.particles);

        const elapsed = timestamp - this.lastRenderTime;
        this.dfriHelper.postRenderTime(elapsed);
        this.debug.postFrameTime(elapsed);

        if (this.settings.common.stats) {
            this.debug.renderTime = this.renderer.stats.renderTime;
            this.debug.bufferCount = this.aheadBuffers.length;
            this.debug.interpolateFrames = this.dfriHelper.interpolateFrames;
            this.debug.drawStats();
        }

        this.lastRenderTime = timestamp;
        requestAnimationFrame(this._renderFrame);
    }
}
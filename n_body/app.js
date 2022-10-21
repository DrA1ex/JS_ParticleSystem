import {DFRIHelper} from "./utils/dfri.js";
import {ITEM_SIZE} from "./backend/base.js";
import {SimulationController} from "./controllers/simulation.js";
import {SimulationStateEnum} from "./controllers/enums.js";
import {AppSimulationSettings} from "./settings/app.js";
import {Debug} from "./utils/debug.js";
import {InteractionHandler} from "./render/interactions.js";
import {RendererInitializer} from "./render/init.js";
import {BackendInitializer} from "./backend/init.js";

export class Application {
    /** @type{RendererBase} */
    renderer = null;
    /** @type{AppSimulationSettings} */
    settings = null;
    /** @type{Particle[]} */
    particles = null;

    canvasInteraction = null;
    dfriHelper = null;
    debug = null;

    aheadBuffers = [];
    pendingBufferCount = 0;
    refreshTime;
    lastRenderTime;
    ready = false;

    /**
     * @param {AppSimulationSettings} settings
     */
    constructor(settings) {
        this.settings = settings;
        this.refreshTime = 1000 / this.settings.world.fps;
        this.simulationCtrl = new SimulationController(document.body, this);
    }

    reloadFromState(state) {
        const newSettings = AppSimulationSettings.import(state.settings);

        this.reconfigure(newSettings, state.particles, state.renderer);
    }

    reconfigure(newSettings, particles, renderer) {
        this.simulationCtrl.setState(SimulationStateEnum.reconfigure);

        const rendererChanged = newSettings.render.render !== this.settings.render.render;
        const particleCountChanged = newSettings.physics.particleCount !== this.settings.physics.particleCount;
        const particleInitChanged = newSettings.physics.particleInitType !== this.settings.physics.particleInitType;
        const backendChanged = newSettings.simulation.backend !== this.settings.simulation.backend ||
            newSettings.simulation.bufferCount !== this.settings.simulation.bufferCount;
        const debugChanged = newSettings.common.debug !== this.settings.common.debug;

        if (!renderer && this.renderer && rendererChanged) {
            renderer = {
                scale: this.renderer.scale / this.renderer.dpr,
                relativeOffset: this.renderer.centeredRelativeOffset()
            }
        }


        if (particleCountChanged || rendererChanged) {
            this.dfriHelper.dispose();
            this.dfriHelper = null;
        }

        if (rendererChanged) {
            this.canvasInteraction.dispose();
            this.canvasInteraction = null;

            this.renderer.dispose();
            this.renderer = null;
        }

        if (backendChanged || particleCountChanged || particleInitChanged) {
            this.backend.dispose();
            this.backend = null;
        }

        if (debugChanged || rendererChanged || backendChanged) {
            this.debug.dispose();
            this.debug = null;
        }

        if (!particles && (backendChanged || particleCountChanged) && !particleInitChanged) {
            particles = this.particles.slice(0, newSettings.physics.particleCount).map(p => [p.x, p.y, p.velX, p.velY, p.mass]);
        }

        if (rendererChanged) {
            const oldCanvas = document.getElementById("canvas");
            const newCanvas = oldCanvas.cloneNode(false);
            oldCanvas.parentNode.replaceChild(newCanvas, oldCanvas);
            oldCanvas.remove();
        }

        if (backendChanged) {
            this.aheadBuffers = [];
            this.pendingBufferCount = 0;
        }

        this.settings = newSettings;
        this.init({
            particles,
            renderer
        });
    }

    init(state = null) {
        const initBackend = this.backend === null || this.particles === null;
        const initRenderer = this.renderer === null;
        const initDfri = this.dfriHelper === null;
        const initInteractions = this.canvasInteraction === null;

        if (initRenderer) {
            this.renderer = RendererInitializer.initRenderer(document.getElementById("canvas"), this.settings.render.render, this.settings);
        } else {
            this.renderer.reconfigure(this.settings);
        }

        this.backend = this.backend ?? BackendInitializer.initBackend(this.settings.simulation.backend);
        this.debug = this.debug ?? new Debug(this.renderer, this.backend, this.settings);
        this.dfriHelper = this.dfriHelper ?? new DFRIHelper(this.renderer, this.settings);
        this.canvasInteraction = this.canvasInteraction ?? new InteractionHandler(this.renderer);

        if (state?.renderer?.scale) {
            this.renderer.scale = state.renderer.scale * this.renderer.dpr;
        }

        if (state?.renderer?.relativeOffset) {
            const {xCenterOffset: x, yCenterOffset: y} = state.renderer.relativeOffset;
            this.renderer.setCenterRelativeOffset(x, y);
        }

        if (initBackend) {
            this.particles = new Array(this.settings.physics.particleCount);
            for (let i = 0; i < this.settings.physics.particleCount; i++) {
                this.particles[i] = {x: 0, y: 0, velX: 0, velY: 0, mass: 0};
            }

            this.backend.init(this.onData.bind(this), this.requestNextStep.bind(this), this.settings, state?.particles);
        } else {
            this.backend.reconfigure(this.settings);
        }

        this.lastRenderTime = performance.now() - this.refreshTime;
        if (initInteractions || initRenderer) {
            this.canvasInteraction.enable();
        }

        if (initDfri && this.settings.render.enableDFRI) {
            this.dfriHelper.enable();
        } else {
            this.dfriHelper.reset();
        }

        if (initBackend) {
            this.simulationCtrl.setState(SimulationStateEnum.loading);
        } else {
            this.simulationCtrl.setState(SimulationStateEnum.active);
        }
    }

    run() {
        requestAnimationFrame(this.render.bind(this));
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

        if (this.aheadBuffers.length + this.pendingBufferCount < this.settings.simulation.bufferCount) {
            this.requestNextStep();
        }

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

        const bufferEntry = this.aheadBuffers.shift();
        const data = bufferEntry.buffer;
        for (let i = 0; i < this.settings.physics.particleCount; i++) {
            this.particles[i].x = data[i * ITEM_SIZE];
            this.particles[i].y = data[i * ITEM_SIZE + 1];
            this.particles[i].velX = data[i * ITEM_SIZE + 2];
            this.particles[i].velY = data[i * ITEM_SIZE + 3];
            this.particles[i].mass = data[i * ITEM_SIZE + 4];
        }

        if (this.settings.common.debugTree) this.debug.importTreeDebugData(bufferEntry.treeDebug);
        if (this.settings.common.debugForce) this.debug.importForceDebugData(bufferEntry.forceDebug);

        this.backend.freeBuffer(data);
        this.requestNextStep();

        if (this.settings.render.enableDFRI && this.dfriHelper.needNextFrame()) {
            this.dfriHelper.bufferSwitched(this.particles, this.aheadBuffers[0]);
        }
    }

    requestNextStep() {
        this.pendingBufferCount += 1;
        this.backend.requestNextStep();
    }

    render(timestamp) {
        if (this.simulationCtrl.currentState === SimulationStateEnum.loading) {
            this.lastRenderTime = timestamp;
            requestAnimationFrame(this.render.bind(this));
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
        requestAnimationFrame(this.render.bind(this));
    }
}
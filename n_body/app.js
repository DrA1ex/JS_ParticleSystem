import {Debug} from "./utils/debug.js";
import {DFRIHelper} from "./utils/dfri.js";
import {ITEM_SIZE} from "./backend/base.js";
import {SimulationController} from "./controllers/simulation.js";
import {SimulationStateEnum} from "./controllers/enums.js";
import {InteractionHandler} from "./render/interactions.js";

export class Application {
    renderer;
    settings;
    particles;

    _canvasInteraction;
    _dfriHelper;
    debug;

    aheadBuffers = [];
    pendingBufferCount = 0;
    refreshTime;
    lastRenderTime;
    ready = false;

    constructor(settings, renderer, backend) {
        this.settings = settings;
        this.renderer = renderer;
        this.backend = backend;

        this.refreshTime = 1000 / this.settings.fps;

        this.debug = new Debug(this.renderer, this.backend, this.settings);
        this._dfriHelper = new DFRIHelper(this.renderer, this.settings);
        this._canvasInteraction = new InteractionHandler(this.renderer, this.settings);

        this.simulationCtrl = new SimulationController(document.body, this);
    }

    init(state = null) {
        if (state?.renderer?.scale) {
            this.renderer.scale = state.renderer.scale * this.renderer.dpr;
        }

        if (state?.renderer?.relativeOffset) {
            const {xCenterOffset: x, yCenterOffset: y} = state.renderer.relativeOffset;
            this.renderer.setCenterRelativeOffset(x, y);
        }

        this.particles = new Array(this.settings.particleCount);
        for (let i = 0; i < this.settings.particleCount; i++) {
            this.particles[i] = {x: 0, y: 0, velX: 0, velY: 0, mass: 0};
        }

        this.backend.init(this.onData.bind(this), this.requestNextStep.bind(this), this.settings, state?.particles);

        this.lastRenderTime = performance.now() - this.refreshTime;
        this._canvasInteraction.enable();

        if (this.settings.enableDFRI) {
            this._dfriHelper.enable();
        }
    }

    run() {
        requestAnimationFrame(this.render.bind(this));
    }

    onData(data) {
        const stepLatency = performance.now() - data.timestamp;
        this._dfriHelper.postStepTime(stepLatency);

        this.debug.postFrameLatency(Math.max(stepLatency, this.debug.elapsed));

        this.simulationCtrl.onNewBuffer(data.buffer);

        if (this.simulationCtrl.currentState === SimulationStateEnum.unset) {
            this.simulationCtrl.setState(SimulationStateEnum.active);
        }

        this.aheadBuffers.push({buffer: data.buffer, treeDebug: data.treeDebug, forceDebug: data.forceDebug});
        this.pendingBufferCount -= 1;

        if (this.aheadBuffers.length + this.pendingBufferCount < this.settings.bufferCount) {
            this.requestNextStep();
        }

        if (this.settings.stats) this.debug.importPhysicsStats(data);
    }

    prepareNextStep() {
        if (this.simulationCtrl.currentState === SimulationStateEnum.paused) {
            return;
        }

        if (this.settings.enableDFRI && !this._dfriHelper.needNextFrame()) {
            return;
        }

        if (this.aheadBuffers.length === 0) {
            if (this.settings.enableDFRI) {
                console.warn(`${performance.now().toFixed(0)} Next buffer not ready. Frames may be dropped`);
            }
            return;
        }

        const bufferEntry = this.aheadBuffers.shift();
        const data = bufferEntry.buffer;
        for (let i = 0; i < this.settings.particleCount; i++) {
            this.particles[i].x = data[i * ITEM_SIZE];
            this.particles[i].y = data[i * ITEM_SIZE + 1];
            this.particles[i].velX = data[i * ITEM_SIZE + 2];
            this.particles[i].velY = data[i * ITEM_SIZE + 3];
            this.particles[i].mass = data[i * ITEM_SIZE + 4];
        }

        if (this.settings.debugTree) this.debug.importTreeDebugData(bufferEntry.treeDebug);
        if (this.settings.debugForce) this.debug.importForceDebugData(bufferEntry.forceDebug);

        this.backend.freeBuffer(data);
        this.requestNextStep();

        if (this.settings.enableDFRI && this._dfriHelper.needNextFrame()) {
            this._dfriHelper.bufferSwitched(this.particles, this.aheadBuffers[0]);
        }
    }

    requestNextStep() {
        this.pendingBufferCount += 1;
        this.backend.requestNextStep();
    }

    render(timestamp) {
        if (this.simulationCtrl.currentState === SimulationStateEnum.unset) {
            this.lastRenderTime = timestamp;
            requestAnimationFrame(this.render.bind(this));
            return;
        }

        this.prepareNextStep();
        if (this.settings.enableDFRI && this.simulationCtrl.currentState !== SimulationStateEnum.paused) {
            this._dfriHelper.render(this.particles);
        } else {
            this.renderer.render(this.particles);
        }

        if (this.settings.debugTree) this.debug.drawTreeDebug();
        if (this.settings.debugForce || this.settings.debugVelocity) this.debug.drawVelocityDebug(this.particles);

        const elapsed = timestamp - this.lastRenderTime;
        this._dfriHelper.postRenderTime(elapsed);
        this.debug.postFrameTime(elapsed);

        if (this.settings.stats) {
            this.debug.renderTime = this.renderer.stats.renderTime;
            this.debug.bufferCount = this.aheadBuffers.length;
            this.debug.interpolateFrames = this._dfriHelper.interpolateFrames;
            this.debug.drawStats();
        }

        this.lastRenderTime = timestamp;
        requestAnimationFrame(this.render.bind(this));
    }
}
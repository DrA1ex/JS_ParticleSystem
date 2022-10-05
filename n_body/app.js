import {InteractionHandler} from "./render/base.js";
import {Debug} from "./utils/debug.js";
import {DFRIHelper} from "./utils/dfri.js";
import {ITEM_SIZE} from "./backend/base.js";
import * as FileUtils from "./utils/file.js";

export class Application {
    renderer;
    settings;
    particles;

    _canvasInteraction;
    _dfriHelper;
    _debug;

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

        this._dfriHelper = new DFRIHelper(this.renderer, this.settings);
        this._debug = new Debug(this.renderer, this.backend, this.settings);
        this._canvasInteraction = new InteractionHandler(this.renderer, this.settings);
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

        document.getElementById("download_btn").onclick = this.exportState.bind(this);

        this.backend.init(this.onData.bind(this), this.requestNextStep.bind(this), this.settings, state?.particles);

        this.lastRenderTime = performance.now() - this.refreshTime;
        this._canvasInteraction.enable();
    }

    run() {
        requestAnimationFrame(this.render.bind(this));
    }

    onData(data) {
        this._dfriHelper.postStepTime(performance.now() - data.timestamp);

        if (!this.ready) {
            const e = document.getElementById("wait");
            e.style.display = "none";
            this.ready = true;
        }

        this.aheadBuffers.push({buffer: data.buffer, treeDebug: data.treeDebug, forceDebug: data.forceDebug});
        this.pendingBufferCount -= 1;

        if (this.aheadBuffers.length + this.pendingBufferCount < this.settings.bufferCount) {
            this.requestNextStep();
        }

        if (this.settings.stats) this._debug.importPhysicsStats(data);
    }

    prepareNextStep() {
        if (!this._dfriHelper.needSwitchBuffer()) {
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

        if (this.settings.debugTree) this._debug.importTreeDebugData(bufferEntry.treeDebug);
        if (this.settings.debugForce) this._debug.importForceDebugData(bufferEntry.forceDebug);

        this.backend.freeBuffer(data);
        this.requestNextStep();

        if (this.settings.enableDFRI && this._dfriHelper.needSwitchBuffer()) {
            this._dfriHelper.bufferSwitched(this.particles, this.aheadBuffers[0]);
        }
    }

    requestNextStep() {
        this.pendingBufferCount += 1;
        this.backend.requestNextStep();
    }

    render(timestamp) {
        if (!this.ready) {
            this.lastRenderTime = timestamp;
            requestAnimationFrame(this.render.bind(this));
            return;
        }

        this.prepareNextStep();
        if (this.settings.enableDFRI) {
            this._dfriHelper.render(this.particles);
        } else {
            this.renderer.render(this.particles);
        }

        if (this.settings.debugTree) this._debug.drawTreeDebug();
        if (this.settings.debugForce || this.settings.debugVelocity) this._debug.drawVelocityDebug(this.particles);

        const elapsed = timestamp - this.lastRenderTime;
        this._dfriHelper.postRenderTime(elapsed);
        if (this.settings.stats) {
            this._debug.renderTime = this.renderer.stats.renderTime;
            this._debug.bufferCount = this.aheadBuffers.length;
            this._debug.interpolateFrames = this._dfriHelper.interpolateFrames;
            this._debug.postFrameTime(elapsed);
            this._debug.drawStats();
        }

        this.lastRenderTime = timestamp;
        requestAnimationFrame(this.render.bind(this));
    }

    exportState() {
        const data = {
            settings: this.settings.serialize(),
            particles: this.particles.map(p => [p.x, p.y, p.velX, p.velY, p.mass]),
            renderer: {
                scale: this.renderer.scale / this.renderer.dpr,
                relativeOffset: this.renderer.centeredRelativeOffset()
            }
        }

        FileUtils.saveFile(JSON.stringify(data),
            `universe_state_${new Date().toISOString()}.json`, "application/json");
    }
}
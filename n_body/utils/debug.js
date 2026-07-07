import {DataSmoother} from "./smoother.js";
import * as CommonUtils from "./common.js";
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
        this.frameLatencySmoother = new DataSmoother(this.settings.world.fps);
        this.flopsSmoother = new DataSmoother(this.settings.world.fps, 0, true);
        this._lastStatsDrawTime = 0;
        this._statsDrawInterval = 250;
        this._maxDebugVectors = 1000;

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
        this.frameLatencySmoother = null;
        this.flopsSmoother = null;

        this.infoElem?.remove();
        this.infoElem = null;
    }

    drawStats() {
        const now = performance.now();
        if (now - this._lastStatsDrawTime < this._statsDrawInterval) {
            return;
        }
        this._lastStatsDrawTime = now;

        const flops = CommonUtils.formatUnit(this.flops, "FLOPS");

        const profile = this.profile;
        this.infoElem.innerText = [
            `max depth: ${this.depth}`,
            `segments: ${this.segmentCount}`,
            `complexity: ${flops}`,
            `ahead buffers: ${this.bufferCount}`,
            this.settings.render.enableDFRI ? `interpolated: ${this.interpolateFrames} frames` : "",
            `fps: ${(1000 / this.elapsed || 0).toFixed(1)}`,
            `- tree building: ${this.treeTime.toFixed(1)} ms`,
            `- physics calc: ${this.physicsTime.toFixed(1)} ms`,
            profile ? `  - force solve: ${profile.forceTime.toFixed(1)} ms` : "",
            profile ? `  - integrate: ${profile.integrateTime.toFixed(1)} ms` : "",
            profile ? `  - export buffer: ${profile.exportTime.toFixed(1)} ms` : "",
            profile ? `  - stats: ${profile.statsTime.toFixed(1)} ms` : "",
            `- render: ${this.renderTime.toFixed(1)} ms`,
            this.renderer.stats ? `  - prepare data: ${this.renderer.stats.prepareDataTime.toFixed(1)} ms` : "",
            this.renderer.stats ? `  - upload: ${this.renderer.stats.uploadTime.toFixed(1)} ms` : "",
            this.renderer.stats ? `  - draw call: ${this.renderer.stats.drawTime.toFixed(1)} ms` : "",
            `renderer: ${this.renderer.constructor.name} @ ${this.renderer.canvasWidth} × ${this.renderer.canvasHeight}`,
            `backend: ${this.backend.constructor.name}, block size: ${this.settings.simulation.segmentMaxCount}`,
        ].filter(v => v).join("\n");
    }

    postFrameTime(elapsed) {
        this.frameRateSmoother.postValue(elapsed)
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

    importPhysicsStats(physics) {
        this.physicsTime = physics.stats.physicsTime;
        this.treeTime = physics.stats.treeTime;
        this.depth = physics.stats.tree.depth;
        this.segmentCount = physics.stats.tree.segmentCount;
        this.profile = physics.stats.profile || null;

        this.postFlops(physics.stats.tree.flops);
    }

    importTreeDebugData(data) {
        this.treeDebugData = data;
    }

    importForceDebugData(data) {
        this.forceDebugData = data;
    }
}
import {DataSmoother} from "./smoother.js";
import * as CommonUtils from "./common.js";
import {BackendType} from "../settings/enum.js";

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

        if (this.settings.common.stats) {
            const div = document.createElement("div");
            div.id = "stats";

            document.body.appendChild(div);
            this.infoElem = div;
        }
    }

    drawStats() {
        const flops = CommonUtils.formatUnit(this.flops, "FLOPS");
        const blockSize = this.settings.simulation.backend === BackendType.gpgpu ?
            Math.pow(this.settings.simulation.segmentMaxCount, 2) : this.settings.simulation.segmentMaxCount;

        this.infoElem.innerText = [
            `max depth: ${this.depth}`,
            `segments: ${this.segmentCount}`,
            `complexity: ${flops}`,
            `ahead buffers: ${this.bufferCount}`,
            this.settings.render.enableDFRI ? `interpolated: ${this.interpolateFrames} frames` : "",
            `fps: ${(1000 / this.elapsed || 0).toFixed(1)}`,
            `- tree building: ${this.treeTime.toFixed(1)} ms`,
            `- physics calc: ${this.physicsTime.toFixed(1)} ms`,
            `- render: ${this.renderTime.toFixed(1)} ms`,
            `renderer: ${this.renderer.constructor.name} @ ${this.renderer.canvasWidth} × ${this.renderer.canvasHeight}`,
            `backend: ${this.backend.constructor.name}, block size: ${blockSize}`,
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
        if (this.settings.common.debugVelocity) {
            this.renderer.setDrawStyle("#ff00e5", null);
            for (let i = 0; i < this.settings.physics.particleCount; i++) {
                const p = particles[i];
                this.renderer.drawWorldLine(p.x, p.y, p.x + p.velX * 5, p.y + p.velY * 5);
            }
        }

        if (this.settings.common.debugForce) {
            this.renderer.setDrawStyle("#ff9900", null);
            for (let i = 0; i < this.forceDebugData.length; i++) {
                const p = particles[i];
                const {forceX, forceY} = this.forceDebugData[i];
                this.renderer.drawWorldLine(p.x, p.y, p.x + forceX * 50, p.y + forceY * 50);
            }
        }
    }

    importPhysicsStats(physics) {
        this.physicsTime = physics.stats.physicsTime;
        this.treeTime = physics.stats.treeTime;
        this.depth = physics.stats.tree.depth;
        this.segmentCount = physics.stats.tree.segmentCount;

        this.postFlops(physics.stats.tree.flops);
    }

    importTreeDebugData(data) {
        this.treeDebugData = data;
    }

    importForceDebugData(data) {
        this.forceDebugData = data;
    }
}
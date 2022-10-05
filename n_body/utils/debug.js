import {DataSmoother} from "./smoother.js";

export class Debug {
    depth = 0;
    segmentCount = 0;
    flops = 0;
    elapsed = 0;
    bufferCount = 0;
    interpolateFrames = 0;

    treeTime = 0;
    physicsTime = 0;
    renderTime = 0;
    treeDebugData = [];

    constructor(renderer, settings) {
        this.renderer = renderer;
        this.settings = settings;

        this.frameRateSmoother = new DataSmoother(this.settings.fps, 3, true);

        if (settings.stats) {
            const div = document.createElement("div");
            div.style.position = "absolute";
            div.style.bottom = "4px";
            div.style.left = "4px";
            div.style.color = "white";
            div.style.pointerEvents = "none";

            document.body.appendChild(div);
            this.infoElem = div;
        }
    }

    drawStats() {
        const flopsUnits = [
            {unit: "T", exp: 1e12},
            {unit: "G", exp: 1e9},
            {unit: "M", exp: 1e6},
            {unit: "K", exp: 1e3},
        ]
        let flopsUnit = "";
        let flops = this.flops;
        for (let i = 0; i < flopsUnits.length; i++) {
            if (flops >= flopsUnits[i].exp) {
                flops /= flopsUnits[i].exp;
                flopsUnit = flopsUnits[i].unit;
                break;
            }
        }

        this.infoElem.innerText = [
            `max depth: ${this.depth}`,
            `segments: ${this.segmentCount}`,
            `complexity: ${flops.toFixed(0)} ${flopsUnit}FLOPS`,
            `ahead buffers: ${this.bufferCount}`,
            this.settings.enableDFRI ? `interpolated: ${this.interpolateFrames} frames` : "",
            `fps: ${(1000 / this.elapsed || 0).toFixed(1)}`,
            `- tree building: ${this.treeTime.toFixed(1)} ms`,
            `- physics calc: ${this.physicsTime.toFixed(1)} ms`,
            `- render: ${this.renderTime.toFixed(1)} ms`,
            `renderer: ${this.renderer.constructor.name} @ ${this.renderer.canvasWidth} × ${this.renderer.canvasHeight}`,
        ].filter(v => v).join("\n");
    }

    postFrameTime(elapsed) {
        this.elapsed = this.frameRateSmoother.postValue(elapsed)
    }

    drawTreeDebug() {
        this.renderer.setDrawStyle("#00ff00", null)
        for (let i = 0; i < this.treeDebugData.length; i++) {
            const data = this.treeDebugData[i];
            this.renderer.drawWorldRect(data.x, data.y, data.width, data.height);
        }
    }

    drawVelocityDebug(particles) {
        this.renderer.setDrawStyle("#ff00e5", null);
        for (let i = 0; i < this.settings.particleCount; i++) {
            const p = particles[i];
            this.renderer.drawWorldLine(p.x, p.y, p.x + p.velX * 10, p.y + p.velY * 10);
        }
    }

    importPhysicsStats(physics) {
        this.physicsTime = physics.stats.physicsTime;
        this.treeTime = physics.stats.treeTime;
        this.flops = physics.stats.tree.flops;
        this.depth = physics.stats.tree.depth;
        this.segmentCount = physics.stats.tree.segmentCount;
    }

    importTreeDebugData(data) {
        this.treeDebugData = data;
    }
}
export class Debug {
    depth = 0;
    segmentCount = 0;
    flops = 0;
    elapsed = 0;
    bufferCount = 0;

    treeTime = 0;
    physicsTime = 0;
    renderTime = 0;
    treeDebugData = [];

    constructor(renderer, settings) {
        this.renderer = renderer;
        this.settings = settings;

        this._frameIndex = 0;
        this._frameTimes = [];

        if (settings.stats) {
            const div = document.createElement("div");
            div.style.position = "absolute";
            div.style.bottom = "4px";
            div.style.left = "4px";
            div.style.color = "white";

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
            `ready buffers: ${this.bufferCount}`,
            `fps: ${(1000 / this.elapsed).toFixed(1)}`,
            `  - tree building: ${this.treeTime.toFixed(1)} ms`,
            `  - physics calc: ${this.physicsTime.toFixed(1)} ms`,
            `  - render: ${this.renderTime.toFixed(1)} ms`,
        ].join("\n");
    }

    postFrameTime(elapsed) {
        const framesToSmooth = this.settings.fps;

        if (this._frameTimes.length < framesToSmooth) {
            this._frameTimes.push(elapsed);
        } else {
            this._frameTimes[this._frameIndex] = elapsed;
        }

        this._frameIndex = (this._frameIndex + 1) % framesToSmooth;
        this.elapsed = this._frameTimes.reduce((p, c) => p + c, 0) / this._frameTimes.length;
    }

    drawTreeDebug() {
        this.renderer.ctx.strokeStyle = "#00ff00";
        for (let i = 0; i < this.treeDebugData.length; i++) {
            const data = this.treeDebugData[i];
            this.renderer.drawWorldRect(data.x, data.y, data.width, data.height);
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
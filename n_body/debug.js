import {FPS, STATS} from "./settings.js";

export const DEBUG_DATA = {
    tree_time: 0,
    physics_time: 0,
    render_time: 0,
    elapsed: 0,
    _frameIndex: 0,
    _frameTimes: []
};

export function init() {
    if (STATS) {
        const div = document.createElement("div");
        div.style.position = "absolute";
        div.style.bottom = "4px";
        div.style.left = "4px";
        div.style.color = "white";

        document.body.appendChild(div);
        DEBUG_DATA.infoElem = div;
    }
}

export function drawTreeStructure(ctx, tree) {
    function _drawLeafStructure(parent) {
        for (let i = 0; i < parent.children.length; i++) {
            const leaf = parent.children[i];
            const rect = leaf.boundaryRect;

            ctx.beginPath()
            ctx.rect(rect.left, rect.top, rect.width, rect.height);
            ctx.stroke();

            _drawLeafStructure(leaf);
        }
    }

    ctx.strokeStyle = "#00ff00";
    _drawLeafStructure(tree.root);
}

export function calcStatistics(tree) {
    const flopsPerOp = 12;
    let flops = 0;

    function _processLeaf(parent) {
        if (parent.children.length === 0) {
            flops += Math.pow(parent.data.length * flopsPerOp, 2);
            return;
        }

        for (let i = 0; i < parent.children.length; i++) {
            _processLeaf(parent.children[i]);
        }

        flops += Math.pow(parent.children.length * flopsPerOp, 2);
    }

    _processLeaf(tree.root);

    DEBUG_DATA.flops = flops;
    DEBUG_DATA.depth = tree.maxDepth;
    DEBUG_DATA.segmentCount = tree._index;
}

export function postFrameTime(elapsed) {
    const framesToSmooth = FPS;

    if (DEBUG_DATA._frameTimes.length < framesToSmooth) {
        DEBUG_DATA._frameTimes.push(elapsed);
    } else {
        DEBUG_DATA._frameTimes[DEBUG_DATA._frameIndex] = elapsed;
    }

    DEBUG_DATA._frameIndex = (DEBUG_DATA._frameIndex + 1) % framesToSmooth;
    DEBUG_DATA.elapsed = DEBUG_DATA._frameTimes.reduce((p, c) => p + c, 0) / DEBUG_DATA._frameTimes.length;
}

export function drawStats() {
    const flopsUnits = [
        {unit: "T", exp: 1e12},
        {unit: "G", exp: 1e9},
        {unit: "M", exp: 1e6},
        {unit: "K", exp: 1e3},
    ]
    let flopsUnit = "";
    let flops = DEBUG_DATA.flops;
    for (let i = 0; i < flopsUnits.length; i++) {
        if (flops >= flopsUnits[i].exp) {
            flops /= flopsUnits[i].exp;
            flopsUnit = flopsUnits[i].unit;
            break;
        }
    }

    DEBUG_DATA.infoElem.innerText = [
        `max depth: ${DEBUG_DATA.depth}`,
        `segments: ${DEBUG_DATA.segmentCount}`,
        `complexity: ${flops.toFixed(0)} ${flopsUnit}FLOPS`,
        `fps: ${(1000 / DEBUG_DATA.elapsed).toFixed(1)}`,
        `  - tree building: ${DEBUG_DATA.tree_time.toFixed(1)} ms`,
        `  - physics calc: ${DEBUG_DATA.physics_time.toFixed(1)} ms`,
        `  - render: ${DEBUG_DATA.render_time.toFixed(1)} ms`,
    ].join("\n");
}
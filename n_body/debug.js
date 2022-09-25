import {STATS} from "./settings.js";

export const DEBUG_DATA = {};

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
    DEBUG_DATA.depth = 0;
    const flopsPerOp = 12;
    let flops = 0;

    function _processLeaf(parent) {
        if (parent.children.length === 0) {
            flops += Math.pow(parent.data.length * flopsPerOp, 2);

            if (parent.depth > DEBUG_DATA.depth) {
                DEBUG_DATA.depth = parent.depth;
            }

            return;
        }

        for (let i = 0; i < parent.children.length; i++) {
            _processLeaf(parent.children[i]);
        }

        flops += Math.pow(parent.children.length * flopsPerOp, 2);
    }

    _processLeaf(tree.root);

    DEBUG_DATA.flops = flops;
    DEBUG_DATA.segmentCount = tree._index;
}

export function drawStats(renderTime) {
    DEBUG_DATA.renderTime = DEBUG_DATA.renderTime !== undefined ?
        (DEBUG_DATA.renderTime + renderTime) / 2 : renderTime;

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
        `computations: ${flops.toFixed(2)} ${flopsUnit}FLOPS`,
        `render time: ${DEBUG_DATA.renderTime.toFixed(1)} ms`
    ].join("\n");
}
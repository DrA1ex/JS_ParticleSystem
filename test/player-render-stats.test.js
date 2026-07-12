import test from "node:test";
import assert from "node:assert/strict";
import {installBrowserStubs} from "../test-support/browser-env.js";

installBrowserStubs();
const {PlayerRenderStats} = await import("../n_body/player/render_stats.js");

function makeRoot() {
    const children = [];
    return {
        children,
        appendChild(element) { children.push(element); },
    };
}

function makeElement() {
    return {
        id: "",
        hidden: false,
        textContent: "",
        removed: false,
        remove() { this.removed = true; },
    };
}

test("player render statistics can be toggled and summarize renderer timings", () => {
    const originalCreateElement = document.createElement;
    document.createElement = () => makeElement();
    try {
        const root = makeRoot();
        const stats = new PlayerRenderStats(root);
        stats.setRenderer({
            stats: {
                renderTime: 4,
                prepareDataTime: 1,
                uploadTime: 2,
                drawTime: 1,
                gpuDrawTime: 0.5,
                gpuTimerStatus: "ready",
                uploadedBytes: 4096,
                preloadedBytes: 8192,
                preloadTime: 3,
                uploadQueue: 1,
                sourceLayout: "compact-position",
                compactPromotion: "hit",
                gpuInterpolation: "on",
                uploadMode: "stream",
                colorMode: "cluster",
                staticColorStatus: "ready",
                particleSprite: "glow",
            },
        });

        stats.setEnabled(true);
        stats.sample(0, {position: 0, maxPosition: 10, speed: 1});
        stats.sample(20, {position: 5, maxPosition: 10, speed: 2});
        stats.sample(300, {position: 10, maxPosition: 10, speed: 2});

        assert.equal(stats.element.hidden, false);
        assert.match(stats.element.textContent, /compact-position/);
        assert.match(stats.element.textContent, /promotion hit/);
        assert.match(stats.element.textContent, /preload: 3\.00 ms/);
        assert.match(stats.element.textContent, /100\.0%/);
        assert.match(stats.element.textContent, /cluster \(ready\)/);

        stats.setEnabled(false);
        assert.equal(stats.element.hidden, true);
        assert.equal(stats.element.textContent, "");
        const element = stats.element;
        stats.dispose();
        assert.equal(element.removed, true);
        assert.equal(stats.element, null);
    } finally {
        document.createElement = originalCreateElement;
    }
});

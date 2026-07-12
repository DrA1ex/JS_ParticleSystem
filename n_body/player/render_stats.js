import * as CommonUtils from "../utils/common.js";

const formatMs = value => Number.isFinite(value) ? `${value.toFixed(2)} ms` : "n/a";
const formatNumber = (value, digits = 1) => Number.isFinite(value) ? value.toFixed(digits) : "n/a";

export class PlayerRenderStats {
    constructor(root = document.body) {
        this.root = root;
        this.enabled = false;
        this.renderer = null;
        this._lastFrameTimestamp = null;
        this._smoothedFrameTime = null;
        this._lastDrawTimestamp = -Infinity;
        this._drawInterval = 250;

        this.element = document.createElement("div");
        this.element.id = "player-render-stats";
        this.element.hidden = true;
        this.root.appendChild(this.element);
    }

    setRenderer(renderer) {
        this.renderer = renderer;
    }

    setEnabled(enabled) {
        this.enabled = !!enabled;
        this.element.hidden = !this.enabled;
        if (!this.enabled) {
            this._lastFrameTimestamp = null;
            this._smoothedFrameTime = null;
            this.element.textContent = "";
        }
    }

    sample(timestamp, playback = {}) {
        if (!this.enabled || !this.renderer) {
            return;
        }

        if (Number.isFinite(this._lastFrameTimestamp)) {
            const elapsed = Math.max(0, timestamp - this._lastFrameTimestamp);
            if (elapsed > 0) {
                this._smoothedFrameTime = this._smoothedFrameTime === null
                    ? elapsed
                    : this._smoothedFrameTime * 0.85 + elapsed * 0.15;
            }
        }
        this._lastFrameTimestamp = timestamp;

        if (timestamp - this._lastDrawTimestamp < this._drawInterval) {
            return;
        }
        this._lastDrawTimestamp = timestamp;

        const stats = this.renderer.stats || {};
        const fps = this._smoothedFrameTime > 0 ? 1000 / this._smoothedFrameTime : null;
        const position = Number.isFinite(playback.position) ? playback.position : 0;
        const maxPosition = Number.isFinite(playback.maxPosition) ? playback.maxPosition : 0;
        const progress = maxPosition > 0 ? position / maxPosition * 100 : 100;

        this.element.textContent = [
            `presentation: ${formatNumber(fps)} FPS · interval ${formatMs(this._smoothedFrameTime)}`,
            `timeline: ${formatNumber(position, 2)} / ${formatNumber(maxPosition, 0)} · ${formatNumber(progress, 1)}% · ${formatNumber(playback.speed, 2)}×`,
            `render: ${formatMs(stats.renderTime)} · prepare ${formatMs(stats.prepareDataTime)} · upload ${formatMs(stats.uploadTime)} · draw ${formatMs(stats.drawTime)}`,
            `gpu: ${formatMs(stats.gpuDrawTime)} (${stats.gpuTimerStatus || "n/a"}) · uploaded ${CommonUtils.formatByteSize(stats.uploadedBytes || 0)}`,
            `preload: ${formatMs(stats.preloadTime)} · ${CommonUtils.formatByteSize(stats.preloadedBytes || 0)} · queue ${stats.uploadQueue || 0}`,
            `source: ${stats.sourceLayout || "n/a"} · promotion ${stats.compactPromotion || "off"} · interpolation ${stats.gpuInterpolation || "off"}`,
            `webgl: upload ${stats.uploadMode || "n/a"} · low latency ${stats.webglLowLatency ? "on" : "off"} · desynchronized ${stats.webglDesynchronized === null || stats.webglDesynchronized === undefined ? "unknown" : (stats.webglDesynchronized ? "on" : "off")}`,
            `color: ${stats.colorMode || "n/a"}${stats.staticColorStatus && stats.staticColorStatus !== "off" ? ` (${stats.staticColorStatus})` : ""} · sprite ${stats.particleSprite || "n/a"}`,
        ].join("\n");
    }

    dispose() {
        this.element?.remove();
        this.element = null;
        this.renderer = null;
        this.root = null;
    }
}

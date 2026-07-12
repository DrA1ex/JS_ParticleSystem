export class RendererBase {
    displayName = "Renderer";

    canvas;
    /** @type{AppSimulationSettings} */
    settings;
    dpr;

    canvasWidth;
    canvasHeight;

    scale;
    xOffset;
    yOffset;

    /**
     * @param {HTMLCanvasElement} canvas
     * @param {AppSimulationSettings} settings
     */
    constructor(canvas, settings) {
        this.coordinateTransformer = null;
        this.stats = {
            renderTime: 0,
            prepareDataTime: 0,
            uploadTime: 0,
            drawTime: 0,
            gpuDrawTime: null,
            gpuTimerStatus: "unsupported",
            colorMode: "n/a",
            uploadMode: "n/a",
            gpuInterpolation: "off",
            uploadedBytes: 0,
            preloadedBytes: 0,
            preloadTime: 0,
            uploadQueue: 0,
            sourceLayout: "n/a",
            compactPromotion: "off",
            filterMode: "off",
        };

        this.settings = settings;
        this.canvas = canvas;

        this._updateCanvasSize();
        this.resetScale();

        this._hueAngle = 0;

        this._resizeObserver = new ResizeObserver(this._handleResize.bind(this));
        this._resizeObserver.observe(this.canvas);
    }

    reconfigure(settings) {
        this.settings = settings;

        this.canvas.style.filter = null;
        this._handleResize();
    }

    reset() {
        this._hueAngle = 0;
    }

    resetScale() {
        const xDiff = this.canvasWidth / this.settings.world.worldWidth;
        const yDiff = this.canvasHeight / this.settings.world.worldHeight;

        this.scale = Math.min(xDiff, yDiff);
        this.setCenterRelativeOffset(0, 0);
    }

    scaleCentered(factor) {
        const newScale = Math.max(0.01, this.scale * factor);
        if (this.scale === newScale) {
            return;
        }

        const delta = newScale - this.scale;

        this.xOffset -= (this.canvasWidth / 2 - this.xOffset) / this.scale * delta;
        this.yOffset -= (this.canvasHeight / 2 - this.yOffset) / this.scale * delta;
        this.scale = newScale;
    }

    move(xDelta, yDelta) {
        this.xOffset += xDelta * this.dpr;
        this.yOffset += yDelta * this.dpr;
    }

    centeredRelativeOffset() {
        return {
            xCenterOffset: (this.xOffset - this.canvasWidth / 2 + this.settings.world.worldWidth * this.scale / 2) / this.canvasWidth,
            yCenterOffset: (this.yOffset - this.canvasHeight / 2 + this.settings.world.worldHeight * this.scale / 2) / this.canvasHeight
        };
    }

    setCenterRelativeOffset(x, y) {
        this.xOffset = (this.canvasWidth - this.settings.world.worldWidth * this.scale) / 2 + x * this.canvasWidth;
        this.yOffset = (this.canvasHeight - this.settings.world.worldHeight * this.scale) / 2 + y * this.canvasHeight;
    }

    /**
     *
     * @param {function(index: number, particle: Particle, out: PositionVector): void} fn
     */
    setCoordinateTransformer(fn) {
        this.coordinateTransformer = fn;
    }

    /**
     * WebGL renderers can interpolate between current and next flat particle
     * buffers directly in the vertex shader. Canvas and legacy renderers fall
     * back to the CPU coordinate transformer.
     */
    supportsGpuInterpolation() {
        return false;
    }

    supportsCompactPositionFrames() {
        return false;
    }

    renderPositionFrame(_positions, _previousPositions = null) {
        throw new Error("Compact position frames are not supported by this renderer");
    }

    promoteCompactPositionFrame(_positions, _previousPositions = null) {
        return false;
    }

    setInterpolationFrame(_particles) {}

    setInterpolationPositionFrame(_positions) {}

    setInterpolationFactor(_factor) {}

    markParticlesDirty() {}

    /**
     * @abstract
     * @param {Particle[]} particles
     * @return {void}
     */
    render(particles) {
        if (this.settings.render.enableFilter) {
            this.canvas.style.filter = `brightness(2) hue-rotate(${this._hueAngle % 360}deg)`;
            this._hueAngle += 0.2;
            this.stats.filterMode = "css";
        } else {
            this.canvas.style.filter = null;
            this.stats.filterMode = "off";
        }
    }

    /**
     * @abstract
     */
    clear() {
    }

    /**
     * @abstract
     * @return {CanvasRenderingContext2D}
     */
    getDebugDrawingContext() {
        throw new Error("Not implemented");
    }

    /**
     * @param {string|null} stroke
     * @param {string|null} fill
     * @return {void}
     */
    setDrawStyle(stroke, fill) {
        if (this._errorIfNotDebug()) return;
        const ctx = this.getDebugDrawingContext();

        if (stroke) {
            ctx.strokeStyle = stroke;
        }
        if (fill) {
            ctx.fillStyle = fill;
        }
    }

    /**
     * @param {number} x
     * @param {number} y
     * @param {number} width
     * @param {number} height
     * @return {void}
     */
    drawWorldRect(x, y, width, height) {
        if (this._errorIfNotDebug()) return;
        const ctx = this.getDebugDrawingContext();

        ctx.beginPath()
        ctx.rect(
            this.xOffset + x * this.scale, this.yOffset + y * this.scale,
            width * this.scale, height * this.scale
        );
        ctx.stroke();
    }

    /**
     * @param {number} x1
     * @param {number} y1
     * @param {number} x2
     * @param {number} y2
     * @return {void}
     */
    drawWorldLine(x1, y1, x2, y2) {
        if (this._errorIfNotDebug()) return;
        const ctx = this.getDebugDrawingContext();

        ctx.beginPath();
        ctx.moveTo(this.xOffset + x1 * this.scale, this.yOffset + y1 * this.scale);
        ctx.lineTo(this.xOffset + x2 * this.scale, this.yOffset + y2 * this.scale);
        ctx.stroke();
    }

    _errorIfNotDebug() {
        if (!this.settings.common.debug) {
            console.error("Allowed only in debug mode");
            return true;
        }

        return false;
    }

    _handleResize() {
        const oldWidth = this.canvasWidth;
        const oldHeight = this.canvasHeight;
        const oldPos = this.centeredRelativeOffset();

        this._updateCanvasSize();

        let resizeScale;
        if (this.canvasWidth !== oldWidth && this.canvasHeight === oldHeight) {
            resizeScale = this.canvasWidth / oldWidth;
        } else if (this.canvasWidth === oldWidth && this.canvasHeight !== oldHeight) {
            resizeScale = this.canvasHeight / oldHeight;
        } else {
            const xDiff = this.canvasWidth / oldWidth;
            const yDiff = this.canvasHeight / oldHeight;
            if (Math.abs(1 - xDiff) > Math.abs(1 - yDiff)) {
                resizeScale = xDiff;
            } else {
                resizeScale = yDiff
            }
        }

        this.scale *= resizeScale;
        this.setCenterRelativeOffset(oldPos.xCenterOffset, oldPos.yCenterOffset);
    }

    _updateCanvasSize() {
        this.dpr = this.settings.render.useDpr ? (this.settings.render.dprRate || window.devicePixelRatio) : 1;
        const rect = this.canvas.getBoundingClientRect();
        this.canvasWidth = rect.width * this.dpr;
        this.canvasHeight = rect.height * this.dpr;
        this.canvas.width = this.canvasWidth;
        this.canvas.height = this.canvasHeight;
    }

    dispose() {
        this._resizeObserver.disconnect();
        this._resizeObserver = null;

        this.coordinateTransformer = null;
        this.settings = null;

        this.canvas.style.filter = null;
        this.canvas = null;
    }
}


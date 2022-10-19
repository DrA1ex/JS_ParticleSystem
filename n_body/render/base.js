export class RendererBase {
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
        this.stats = {renderTime: 0};

        this.settings = settings;
        this.canvas = canvas;

        this._updateCanvasSize();

        const xDiff = this.canvasWidth / this.settings.world.worldWidth;
        const yDiff = this.canvasHeight / this.settings.world.worldHeight;

        this.scale = Math.min(xDiff, yDiff);
        this.setCenterRelativeOffset(0, 0);

        this._hueAngle = 0;

        this._resizeObserver = new ResizeObserver(this._handleResize.bind(this));
        this._resizeObserver.observe(document.body);
    }

    reset() {
        this._hueAngle = 0;
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
     * @abstract
     * @param {Particle[]} particles
     * @return {void}
     */
    render(particles) {
        if (this.settings.render.enableFilter) {
            this.canvas.style.filter = `brightness(2) hue-rotate(${this._hueAngle % 360}deg)`;
            this._hueAngle += 0.2;
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
        this._updateCanvasSize();
    }

    _updateCanvasSize() {
        this.dpr = this.settings.render.useDpr ? (this.settings.render.dprRate || window.devicePixelRatio) : 1;
        const rect = this.canvas.getBoundingClientRect();
        this.canvasWidth = rect.width * this.dpr;
        this.canvasHeight = rect.height * this.dpr;
        this.canvas.width = this.canvasWidth;
        this.canvas.height = this.canvasHeight;
    }
}


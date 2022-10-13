export class RendererBase {
    canvas;
    settings;
    dpr;

    canvasWidth;
    canvasHeight;

    scale;
    xOffset;
    yOffset;

    /**
     * @param {HTMLCanvasElement} canvas
     * @param {Settings} settings
     */
    constructor(canvas, settings) {
        this.coordinateTransformer = null;
        this.stats = {renderTime: 0};

        this.settings = settings;
        this.canvas = canvas;
        this.dpr = settings.useDpr ? (settings.dprRate || window.devicePixelRatio) : 1;

        const rect = this.canvas.getBoundingClientRect();

        this.canvasWidth = rect.width * this.dpr;
        this.canvasHeight = rect.height * this.dpr;

        const xDiff = this.canvasWidth / this.settings.worldWidth;
        const yDiff = this.canvasHeight / this.settings.worldHeight;

        this.scale = Math.min(xDiff, yDiff);
        this.setCenterRelativeOffset(0, 0);

        this.canvas.style.width = rect.width + "px";
        this.canvas.style.height = rect.height + "px";
        this.canvas.width = this.canvasWidth;
        this.canvas.height = this.canvasHeight;

        this._hueAngle = 0;
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
            xCenterOffset: (this.xOffset - this.canvasWidth / 2 + this.settings.worldWidth * this.scale / 2) / this.canvasWidth,
            yCenterOffset: (this.yOffset - this.canvasHeight / 2 + this.settings.worldHeight * this.scale / 2) / this.canvasHeight
        };
    }

    setCenterRelativeOffset(x, y) {
        this.xOffset = (this.canvasWidth - this.settings.worldWidth * this.scale) / 2 + x * this.canvasWidth;
        this.yOffset = (this.canvasHeight - this.settings.worldHeight * this.scale) / 2 + y * this.canvasHeight;
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
        if (this.settings.enableFilter) {
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
        if (!this.settings.debug) {
            console.error("Allowed only in debug mode");
            return true;
        }

        return false;
    }
}

export class InteractionHandler {
    _bindings = {
        onmousedown: this._onMouseDown.bind(this),
        onmouseup: this._onMouseUp.bind(this),
        onmousemove: this._onMouseMove.bind(this),
        onwheel: this._onMouseWheel.bind(this),

        ontouchstart: this._onTouchStart.bind(this),
        ontouchend: this._onTouchEnd.bind(this),
        ontouchmove: this._onTouchMove.bind(this),
    }

    constructor(renderer, settings) {
        this.renderer = renderer;
        this.settings = settings;

        this._pressed = false;
        this._pinched = false;
        this._initPos = {x: 0, y: 0};
        this._initDistance = 0;
    }

    enable() {
        for (const [key, value] of Object.entries(this._bindings)) {
            this.renderer.canvas[key] = value;
        }
    }

    disable() {
        for (const [key] of Object.entries(this._bindings)) {
            this.renderer.canvas[key] = null;
        }
    }

    _beginDragInteraction(point) {
        this._pressed = true;
        this._pinched = false;
        this._initPos = point;
    }

    _endDragInteraction() {
        this._pressed = false;
    }

    _interactionDrag(point) {
        this.renderer.move(point.x - this._initPos.x, point.y - this._initPos.y);
        this._initPos = point;
    }

    _beginPinchInteraction(point1, point2) {
        this._pinched = true;
        this._pressed = false;
        this._initPos = point1;
        this._initDistance = Math.sqrt(Math.pow(point1.x - point2.x, 2) + Math.pow(point1.y - point2.y, 2))
    }

    _endPinchInteraction() {
        this._pinched = false;
    }

    _interactionPinch(point1, point2) {
        const distance = Math.sqrt(Math.pow(point1.x - point2.x, 2) + Math.pow(point1.y - point2.y, 2));
        const diff = Math.max(-5, Math.min(5, (distance - this._initDistance) / 30));

        const factor = Math.pow(1.05, diff);
        this.renderer.scaleCentered(factor)

        this._initPos = point1;
        this._initDistance = distance;
    }

    _interactionScale(factor) {
        this.renderer.scaleCentered(factor);
    }

    _onMouseDown(e) {
        if (e.button !== 0) {
            return;
        }

        this._beginDragInteraction({x: e.clientX, y: e.clientY})
        e.preventDefault();
    }

    _onMouseUp(e) {
        if (e.button !== 0) {
            return;
        }

        this._endDragInteraction();
        e.preventDefault();
    }

    _onMouseMove(e) {
        if (!this._pressed) {
            return;
        }

        this._interactionDrag({x: e.clientX, y: e.clientY});
        e.preventDefault();
    }

    _onMouseWheel(e) {
        const delta = Math.max(-5, Math.min(5, e.deltaY / 10));
        const factor = Math.pow(1.02, delta);
        this._interactionScale(factor);
        e.preventDefault();
    }

    _onTouchStart(e) {
        const touches = e.touches;
        if (!touches) {
            return;
        }

        if (touches.length === 2) {
            this._beginPinchInteraction(
                {x: touches[0].clientX, y: touches[0].clientY},
                {x: touches[1].clientX, y: touches[1].clientY}
            )
        } else if (touches.length === 1) {
            this._beginDragInteraction({x: touches[0].clientX, y: touches[0].clientY});
        }

        e.preventDefault();
    }

    _onTouchEnd(e) {
        if (this._pressed) {
            this._endDragInteraction();
        } else if (this._pinched) {
            this._endPinchInteraction();
        }

        e.preventDefault();
    }

    _onTouchMove(e) {
        const touches = e.touches;
        if (this._pressed && touches.length === 2) {
            this._beginPinchInteraction(
                {x: touches[0].clientX, y: touches[0].clientY},
                {x: touches[1].clientX, y: touches[1].clientY}
            );
        } else if (this._pinched && touches.length === 1) {
            this._beginDragInteraction({x: touches[0].clientX, y: touches[0].clientY});
        } else if (this._pressed) {
            this._interactionDrag({x: touches[0].clientX, y: touches[0].clientY});
        } else if (this._pinched) {
            this._interactionPinch(
                {x: touches[0].clientX, y: touches[0].clientY},
                {x: touches[1].clientX, y: touches[1].clientY}
            );
        }

        e.preventDefault();
    }
}

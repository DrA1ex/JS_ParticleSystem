import {m4} from "../utils/m4.js";

export class RendererBase {
    canvas;
    settings;
    dpr;

    canvasWidth;
    canvasHeight;

    scale = 1;
    xOffset = 0;
    yOffset = 0;

    xRotation = 0;
    yRotation = 0;

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

        this.lastMatrix = null;
        this._hueAngle = 0;
    }

    /**
     * @param {number}  factor
     * @return {void}
     */
    scaleCentered(factor) {
        const newScale = Math.max(0.01, this.scale * factor);
        if (this.scale === newScale) {
            return;
        }

        this.scale = newScale;
    }

    /**
     * @param {number}  xDelta
     * @param {number}  yDelta
     * @return {void}
     */
    move(xDelta, yDelta) {
        this.xOffset += xDelta * this.dpr / this.scale;
        this.yOffset += yDelta * this.dpr / this.scale;
    }

    centeredRelativeOffset() {
        return {
            xCenterOffset: (this.xOffset - this.canvasWidth / 2 + this.settings.worldWidth * this.scale / 2) / this.canvasWidth,
            yCenterOffset: (this.yOffset - this.canvasHeight / 2 + this.settings.worldHeight * this.scale / 2) / this.canvasHeight
        };
    }

    setCenterRelativeOffset(x, y) {
        const newX = x * this.canvasWidth;
        const newY = y * this.canvasHeight;
        this.move(newX - this.xOffset, newY - this.yOffset);
    }

    /**
     *
     * @param {function(index: number, particle: Particle, out: PositionVector): void} fn
     */
    setCoordinateTransformer(fn) {
        this.coordinateTransformer = fn;
    }

    rotate(xDelta, yDelta) {
        let newX = this.xRotation + xDelta;
        if (Math.abs(newX) > Math.PI * 2) {
            newX -= Math.sign(newX) * Math.PI * 2;
        }
        this.xRotation = newX;

        if (Math.abs(newX) > Math.PI) {
            yDelta = -yDelta;
        }

        let newY = this.yRotation + yDelta;
        if (Math.abs(newX) > Math.PI * 2) {
            newY -= Math.sign(newY) * Math.PI * 2;
        }

        this.yRotation = newY;
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
     * @param {number} z
     * @param {number} width
     * @param {number} height
     * @param {number} depth
     * @return {void}
     */
    drawWorldRect(x, y, z, width, height, depth) {
        if (this._errorIfNotDebug()) return;
        const ctx = this.getDebugDrawingContext();

        const lines = this._drawBox(x, y, z, width, height, depth)
            .map(l => m4.transformPoint({x: l[0], y: l[1], z: l[2]}, this.lastMatrix))


        ctx.beginPath()
        ctx.moveTo(...lines[0]);
        for (let i = 1; i < lines.length; i++) {
            ctx.lineTo(...lines[i]);
        }
        ctx.stroke();
    }

    _drawBox(x, y, z, width, height, depth) {
        // @formatter:off
        return [
            [x,           y,             z,       ],  // START
            [x + width,   y,             z,       ],  // RIGHT
            [x + width,   y + height,    z,       ],  // DOWN
            [x,           y + height,    z,       ],  // LEFT
            [x,           y,             z,       ],  // UP
            [x,           y,             z + depth],  // FAR
            [x + width,   y,             z + depth],  // RIGHT
            [x + width,   y + height,    z + depth],  // DOWN
            [x,           y + height,    z + depth],  // LEFT
            [x,           y,             z + depth],  // UP
            [x + width,   y,             z + depth],  // RIGHT
            [x + width,   y,             z        ],  // NEAR
            [x + width,   y,             z + depth],  // FAR
            [x + width,   y + height,    z + depth],  // DOWN
            [x + width,   y + height,    z        ],  // NEAR
            [x + width,   y + height,    z + depth],  // FAR
            [x,           y + height,    z + depth],  // LEFT
            [x,           y + height,    z        ],  // NEAR
        ]
        // @formatter:on
    }

    /**
     * @param {number} x1
     * @param {number} x2
     * @param {number} y1
     * @param {number} y2
     * @param {number} z1
     * @param {number} z2
     * @return {void}
     */
    drawWorldLine(x1, x2, y1, y2, z1, z2) {
        if (this._errorIfNotDebug()) return;
        const ctx = this.getDebugDrawingContext();

        ctx.beginPath();
        ctx.moveTo(...m4.transformPoint({x: x1, y: y1, z: z1}, this.lastMatrix));
        ctx.lineTo(...m4.transformPoint({x: x2, y: y2, z: z2}, this.lastMatrix));
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
        oncontextmenu: () => false,
    }

    constructor(renderer, settings) {
        this.renderer = renderer;
        this.settings = settings;

        this._pressed = false;
        this._rotation = false;
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

    _beginRotationInteraction(point) {
        this._pressed = false;
        this._rotation = true;
        this._pinched = false;
        this._initPos = point;
    }

    _endRotationInteraction() {
        this._rotation = false;
    }

    _interactionRotate(point) {
        const xDiff = Math.PI * (point.x - this._initPos.x) / 360;
        const yDiff = Math.PI * (point.y - this._initPos.y) / 360;
        this.renderer.rotate(yDiff, xDiff);
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
        const point = {x: e.clientX, y: e.clientY};
        if (e.button === 0 && !e.ctrlKey) {
            this._beginDragInteraction(point);
        } else {
            this._beginRotationInteraction(point);
        }

        e.preventDefault();
        e.stopPropagation();
    }

    _onMouseUp(e) {
        if (this._pressed) this._endDragInteraction();
        if (this._rotation) this._endRotationInteraction();

        e.preventDefault();
        e.stopPropagation();
    }

    _onMouseMove(e) {
        const point = {x: e.clientX, y: e.clientY}
        if (this._pressed) {
            this._interactionDrag(point);
        } else if (this._rotation) {
            this._interactionRotate(point);
        }

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

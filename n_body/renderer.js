export class CanvasRenderer {
    constructor(canvas, settings) {
        this._hueAngle = 0;
        this._maxSpeed = 0;

        this.settings = settings;
        this.canvas = canvas;
        this.dpr = settings.useDpr ? window.devicePixelRatio : 1;

        const rect = canvas.getBoundingClientRect();

        this.canvasWidth = rect.width * this.dpr;
        this.canvasHeight = rect.height * this.dpr;

        const xDiff = this.canvasWidth / this.settings.worldWidth;
        const yDiff = this.canvasHeight / this.settings.worldHeight;

        this.scale = Math.min(xDiff, yDiff);

        this.xOffset = (this.canvasWidth - this.settings.worldWidth * this.scale) / 2;
        this.yOffset = (this.canvasHeight - this.settings.worldHeight * this.scale) / 2;

        canvas.style.width = rect.width + "px";
        canvas.style.height = rect.height + "px";
        canvas.width = this.canvasWidth;
        canvas.height = this.canvasHeight;

        this.ctx = canvas.getContext('2d');
        this.ctx.lineWidth = this.dpr;

        this.renderImageData = this.ctx.createImageData(this.canvasWidth, this.canvasHeight);
        this.pixels = new Uint32Array(this.renderImageData.data.buffer);
    }

    scaleCentered(factor) {
        const newScale = Math.max(0.01, this.scale * factor);
        if (this.scale === newScale) {
            return;
        }

        const delta = newScale - this.scale;
        this.xOffset -= (this.settings.worldWidth * delta) / 2;
        this.yOffset -= (this.settings.worldHeight * delta) / 2;
        this.scale = newScale;
    }

    move(xDelta, yDelta) {
        this.xOffset += xDelta * this.dpr;
        this.yOffset += yDelta * this.dpr;
    }

    render(particles) {
        this.ctx.clearRect(0, 0, this.canvasWidth, this.canvasHeight);
        for (let i = 0; i < this.pixels.length; i++) {
            this.pixels[i] = 0;
        }

        for (let i = 0; i < particles.length; i++) {
            const particle = particles[i];

            this._maxSpeed = Math.max(this._maxSpeed, Math.abs(particle.velX), Math.abs(particle.velY));

            const x = this.xOffset + particle.x * this.scale;
            const y = this.yOffset + particle.y * this.scale;

            if (x < 0 || x > this.canvasWidth || y < 0 || y > this.canvasHeight) {
                continue;
            }

            const xVelToColor = Math.floor(255 * (0.5 + particle.velX / this._maxSpeed / 2));
            const yVelToColor = Math.floor(255 * (0.5 + particle.velY / this._maxSpeed / 2));
            const index = (Math.floor(x) + Math.floor(y) * this.canvasWidth);
            this.pixels[index] = 0xff000010 | xVelToColor << 16 | yVelToColor << 8;
        }

        this.ctx.putImageData(this.renderImageData, 0, 0);

        if (this.settings.enableFilter) {
            this.canvas.style.filter = `contrast(2) brightness(2) hue-rotate(${this._hueAngle % 360}deg)`;
            this._hueAngle += 0.2;
        }
    }

    drawWorldRect(x, y, width, height) {
        this.ctx.beginPath()
        this.ctx.rect(
            this.xOffset + x * this.scale, this.yOffset + y * this.scale,
            width * this.scale, height * this.scale
        );
        this.ctx.stroke();
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
        this._initPos = {x: 0, y: 0};
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
        this._initPos = point;
    }

    _endDragInteraction() {
        this._pressed = false;
    }

    _interactionDrag(point) {
        this.renderer.move(point.x - this._initPos.x, point.y - this._initPos.y);
        this._initPos = point;
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
        const touch = e.touches && e.touches[0];
        if (!touch) {
            return;
        }

        this._beginDragInteraction({x: touch.clientX, y: touch.clientY});
        e.preventDefault();
    }

    _onTouchEnd(e) {
        this._endDragInteraction();
        e.preventDefault();
    }

    _onTouchMove(e) {
        if (!this._pressed) {
            return;
        }

        const touch = e.touches[0];
        this._interactionDrag({x: touch.clientX, y: touch.clientY});
        e.preventDefault();
    }
}

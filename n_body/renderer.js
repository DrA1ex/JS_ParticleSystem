export class CanvasRenderer {
    constructor(canvas, settings) {
        this._hueAngle = 0;
        this._maxSpeed = 0;
        this.stats = {renderTime: 0};

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

    render(particles, deltas, timeFactor) {
        const t = performance.now();
        this.ctx.clearRect(0, 0, this.canvasWidth, this.canvasHeight);
        for (let i = 0; i < this.pixels.length; i++) {
            this.pixels[i] = 0;
        }

        for (let i = 0; i < particles.length; i++) {
            const particle = particles[i];
            const delta = deltas[i];

            this._maxSpeed = Math.max(this._maxSpeed, Math.abs(particle.velX), Math.abs(particle.velY));

            const x = this.xOffset + (particle.x + delta.x * timeFactor) * this.scale;
            const y = this.yOffset + (particle.y + delta.y * timeFactor) * this.scale;

            if (x < 0 || x > this.canvasWidth || y < 0 || y > this.canvasHeight) {
                continue;
            }

            const xVelToColor = Math.floor(255 * (0.5 + particle.velX / this._maxSpeed / 2));
            const yVelToColor = Math.floor(255 * (0.5 + particle.velY / this._maxSpeed / 2));
            const index = (Math.floor(x) + Math.floor(y) * this.canvasWidth);
            const color = 0xff000088 | xVelToColor << 16 | yVelToColor << 8;

            if (this.settings.enableBlending && this.pixels[index]) {
                this.pixels[index] = this._blendColors(this.pixels[index], color);
            } else {
                this.pixels[index] = color;
            }
        }

        this.ctx.putImageData(this.renderImageData, 0, 0);

        if (this.settings.enableFilter) {
            this.canvas.style.filter = `brightness(2) hue-rotate(${this._hueAngle % 360}deg)`;
            this._hueAngle += 0.2;
        }

        this.stats.renderTime = performance.now() - t;
    }

    _blendColors(bottom, top) {
        const bottomR = bottom >> 16 & 0xff,
            bottomG = bottom >> 8 & 0xff,
            bottomB = bottom & 0xff;

        const topR = top >> 16 & 0xff,
            topG = top >> 8 & 0xff,
            topB = top & 0xff

        const r = Math.min(255, Math.max(0, Math.floor((topR < 128) ? (bottomR + 2 * topR - 255) : (bottomR + topR))));
        const g = Math.min(255, Math.max(0, Math.floor((topG < 128) ? (bottomG + 2 * topG - 255) : (bottomG + topG))));
        const b = Math.min(255, Math.max(0, Math.floor((topB < 128) ? (bottomB + 2 * topB - 255) : (bottomB + topB))));

        return 0xff000000 | r << 16 | g << 8 | ~~b;
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

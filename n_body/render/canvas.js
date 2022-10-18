import {RendererBase} from "./base.js";

export class CanvasRenderer extends RendererBase {
    _renderImageData = null;
    _pixels = null;

    /**
     * @param {HTMLCanvasElement} canvas
     * @param {Settings} settings
     */
    constructor(canvas, settings) {
        super(canvas, settings);
        this._maxSpeed = this.settings.gravity / 100;

        this.ctx = canvas.getContext('2d');
        this.ctx.lineWidth = this.dpr;

        this._initImageData();
    }

    reset() {
        super.reset();
        this._maxSpeed = this.settings.gravity / 100;
    }

    clear() {
        super.clear();

        this.canvas.clearRect(0, 0, this.canvasWidth, this.canvasHeight);
    }

    /**
     * @param {Particle[]} particles
     */
    render(particles) {
        const t = performance.now();
        super.render(particles);

        for (let i = 0; i < this._pixels.length; i++) {
            this._pixels[i] = 0;
        }

        const pos = {x: 0, y: 0};
        for (let i = 0; i < particles.length; i++) {
            const particle = particles[i];

            pos.x = particle.x;
            pos.y = particle.y;
            if (this.coordinateTransformer) {
                this.coordinateTransformer(i, particle, pos);
            }

            const x = this.xOffset + pos.x * this.scale;
            const y = this.yOffset + pos.y * this.scale;

            if (x < 0 || x > this.canvasWidth || y < 0 || y > this.canvasHeight) {
                continue;
            }

            this._maxSpeed = Math.max(this._maxSpeed, Math.abs(particle.velX), Math.abs(particle.velY));
            const mass = Math.floor(255 * (0.25 + particle.mass / (this.settings.particleMass + 1) * 0.25));
            const xVelToColor = Math.floor(255 * (0.5 + particle.velX / this._maxSpeed * 0.5));
            const yVelToColor = Math.floor(255 * (0.5 + particle.velY / this._maxSpeed * 0.5));
            const color = 0xff000000 | xVelToColor << 16 | mass << 8 | yVelToColor;

            const index = (Math.floor(x) + Math.floor(y) * this.canvasWidth);
            if (this.settings.enableBlending) {
                this._pixels[index] = this._blendColors(this._pixels[index], color);
            } else {
                this._pixels[index] = color;
            }
        }

        this.ctx.putImageData(this._renderImageData, 0, 0);

        this.stats.renderTime = performance.now() - t;
    }

    _blendColors(bottom, top) {
        const bottomR = bottom >> 16 & 0xff,
            bottomG = bottom >> 8 & 0xff,
            bottomB = bottom & 0xff;

        const topR = top >> 16 & 0xff,
            topG = top >> 8 & 0xff,
            topB = top & 0xff

        const r = Math.floor(Math.min(255, Math.max(0, topR * topR / 255 + bottomR)));
        const g = Math.floor(Math.min(255, Math.max(0, topG * topG / 255 + bottomG)));
        const b = Math.floor(Math.min(255, Math.max(0, topB * topB / 255 + bottomB)));

        return 0xff000000 | r << 16 | g << 8 | b;
    }

    getDebugDrawingContext() {
        return this.ctx;
    }

    _updateCanvasSize() {
        super._updateCanvasSize();
    }

    _handleResize() {
        super._handleResize();

        this.ctx.lineWidth = this.dpr;
        this._initImageData();
    }

    _initImageData() {
        this._renderImageData = this.ctx.createImageData(this.canvasWidth, this.canvasHeight);
        this._pixels = new Uint32Array(this._renderImageData.data.buffer);
    }
}
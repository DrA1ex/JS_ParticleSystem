import {RendererBase} from "./base.js";

export class CanvasRenderer extends RendererBase {
    /**
     * @param {HTMLCanvasElement} canvas
     * @param {Settings} settings
     */
    constructor(canvas, settings) {
        super(canvas, settings);
        this._hueAngle = 0;

        this.ctx = canvas.getContext('2d');
        this.ctx.lineWidth = this.dpr;

        this._renderImageData = this.ctx.createImageData(this.canvasWidth, this.canvasHeight);
        this._pixels = new Uint32Array(this._renderImageData.data.buffer);
    }

    /**
     * @param {Particle[]} particles
     */
    render(particles) {
        const t = performance.now();
        this.ctx.clearRect(0, 0, this.canvasWidth, this.canvasHeight);
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

            const mass = Math.floor(particle.mass / (this.settings.particleMass + 1) * 64) & 0xff;
            const xVelToColor = 192 + Math.sign(particle.velX) * 63;
            const yVelToColor = 192 + Math.sign(particle.velY) * 63;
            const color = 0xff000000 | xVelToColor << 16 | yVelToColor << 8 | mass;

            const index = (Math.floor(x) + Math.floor(y) * this.canvasWidth);
            if (this.settings.enableBlending && this._pixels[index]) {
                this._pixels[index] = this._blendColors(this._pixels[index], color);
            } else {
                this._pixels[index] = color;
            }
        }

        this.ctx.putImageData(this._renderImageData, 0, 0);

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
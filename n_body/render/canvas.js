import {RendererBase} from "./base.js";
import {m4} from "../utils/m4.js";

export class CanvasRenderer extends RendererBase {
    /**
     * @param {HTMLCanvasElement} canvas
     * @param {Settings} settings
     */
    constructor(canvas, settings) {
        super(canvas, settings);
        this._hueAngle = 0;
        this._maxSpeed = 0;

        this.ctx = canvas.getContext('2d');
        this.ctx.lineWidth = this.dpr;

        this._renderImageData = this.ctx.createImageData(this.canvasWidth, this.canvasHeight);
        this._pixels = new Uint32Array(this._renderImageData.data.buffer);

        this._matrix = null;
    }

    /**
     * @param {Particle[]} particles
     */
    render(particles) {
        const t = performance.now();
        super.render(particles);


        let matrix = m4.translation(this.canvasWidth / 2, this.canvasHeight / 2, 0);
        matrix = m4.scale(matrix, this.scale, this.scale, this.scale);
        matrix = m4.yRotate(matrix, -this.yRotation);
        matrix = m4.xRotate(matrix, this.xRotation);
        matrix = m4.translate(matrix, this.xOffset, this.yOffset, 0);
        matrix = m4.translate(matrix, -this.settings.worldWidth / 2, -this.settings.worldHeight / 2, 0);
        this.lastMatrix = matrix;


        for (let i = 0; i < this._pixels.length; i++) {
            this._pixels[i] = 0;
        }

        const pos = {x: 0, y: 0, z: 0};
        for (let i = 0; i < particles.length; i++) {
            const particle = particles[i];

            pos.x = particle.x;
            pos.y = particle.y;
            pos.z = particle.z;
            if (this.coordinateTransformer) {
                this.coordinateTransformer(i, particle, pos);
            }

            const [x, y, z, w] = m4.transformPoint(pos, matrix)
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
}
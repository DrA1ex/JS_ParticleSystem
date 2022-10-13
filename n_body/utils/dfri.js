import {ITEM_SIZE} from "../backend/base.js";
import {DataSmoother} from "./smoother.js";

export class DFRIHelperBase {

    /**
     * @abstract
     */
    get actualTime() {
        throw new Error("Not implemented");
    }

    /**
     * @abstract
     */
    get desiredTime() {
        throw new Error("Not implemented");
    }

    get maxCount() {
        return Number.MAX_SAFE_INTEGER;
    }

    constructor(renderer, particleCount) {
        this.renderer = renderer;
        this.particleCount = particleCount;

        this.frame = 0;
        this.interpolateFrames = 0;

        this._initialized = false;
        this._deltas = new Array(this.particleCount);
        for (let i = 0; i < this.particleCount; i++) {
            this._deltas[i] = {x: 0, y: 0};
        }
    }

    enable() {
        this.renderer.setCoordinateTransformer(this._transformParticlePosition.bind(this));
    }

    init() {
        this.interpolateFrames = this._getInterpolateFramesCount();
        this._initialized = true;
    }

    render(particles) {
        if (!this._initialized) {
            this.init();
        }

        this._currentFactor = this.getFactor();
        this.renderer.render(particles);

        this.frame += 1;
    }

    getFactor() {
        if (this.frame === 0) {
            return 0;
        } else if (this.frame > this.interpolateFrames) {
            const additionalFrames = this.frame - this.interpolateFrames + 1;
            return this.frame / (this.interpolateFrames + additionalFrames);
        }

        return this.frame / (this.interpolateFrames + 1);
    }

    needNextFrame() {
        return this.frame === 0 || this.frame > this.interpolateFrames;
    }

    reset() {
        this.frame = 0;
        this.interpolateFrames = this._getInterpolateFramesCount();
    }

    setNextFrame(particles, dataFn) {
        for (let i = 0; i < this.particleCount; i++) {
            const [nextX, nextY] = dataFn(i);
            this._deltas[i].x = nextX;
            this._deltas[i].y = nextY;
        }

        this.reset();
    }

    _getInterpolateFramesCount() {
        const interpolate = this.actualTime / this.desiredTime - 1;
        return Math.max(0, Math.min(this.maxCount, Math.ceil(interpolate * 1.1)));
    }

    _transformParticlePosition(index, particle, out) {
        out.x = particle.x + this._deltas[index].x * this._currentFactor;
        out.y = particle.y + this._deltas[index].y * this._currentFactor;
    }
}

export class SimpleDFRIHelper extends DFRIHelperBase {
    get actualTime() {
        return this._actualTime;
    }

    get desiredTime() {
        return this._desiredTime;
    }

    constructor(renderer, particlesCount, sourceFrameRate, desiredFramerate) {
        super(renderer, particlesCount);

        this._actualTime = 1000 / sourceFrameRate;
        this._desiredTime = 1000 / desiredFramerate;
    }
}

export class DFRIHelper extends DFRIHelperBase {
    constructor(renderer, settings) {
        super(renderer, settings.particleCount)

        this.settings = settings;

        this.stepTimeSmoother = new DataSmoother(this.settings.fps * 4, 1);
        this.renderTimeSmoother = new DataSmoother(this.settings.fps * 2, 5, true);
        this.renderTimeSmoother.postValue(1000 / this.settings.fps, true);
    }

    bufferSwitched(particles, aheadBufferEntry) {
        const buffer = aheadBufferEntry?.buffer;
        if (!buffer) {
            console.warn(`${performance.now().toFixed(0)} No available ahead buffer, interpolation may be inconsistent`);
        }

        this.setNextFrame(particles, (i) => {
            return [
                buffer ? buffer[i * ITEM_SIZE] - particles[i].x : particles[i].velX,
                buffer ? buffer[i * ITEM_SIZE + 1] - particles[i].y : particles[i].velY
            ]
        });
    }

    postStepTime(time, force = false) {
        this.stepTimeSmoother.postValue(time, force);
    }

    postRenderTime(time) {
        this.renderTimeSmoother.postValue(time);
    }

    get actualTime() {
        return this.stepTimeSmoother.smoothedValue;
    }

    get desiredTime() {
        return this.renderTimeSmoother.smoothedValue;
    }

    get maxCount() {
        return this.settings.DFRIMaxFrames;
    }
}
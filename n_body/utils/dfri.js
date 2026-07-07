import {DataSmoother} from "./smoother.js";
import {ITEM_SIZE, getParticleVelX, getParticleVelY, getParticleX, getParticleY} from "./particles.js";

export class DFRIHelperBase {

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

    /**
     * @abstract
     * @return {number}
     */
    get actualTime() {
        throw new Error("Not implemented");
    }

    /**
     * @abstract
     * @return {number}
     */
    get desiredTime() {
        throw new Error("Not implemented");
    }

    get maxCount() {
        return Number.MAX_SAFE_INTEGER;
    }

    reconfigure() {}

    enable() {
        this.renderer.setCoordinateTransformer(this._transformParticlePosition.bind(this));
    }

    init() {
        this.interpolateFrames = this._getInterpolateFramesCount();
        this._initialized = true;
    }

    render(particles, pause = false) {
        if (!this._initialized) {
            this.init();
        }

        this._currentFactor = this.getFactor();
        this.renderer.render(particles);

        if (!pause) {
            this.frame += 1;
        }
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

    setNextFrame(dataFn) {
        for (let i = 0; i < this.particleCount; i++) {
            dataFn(i, this._deltas[i]);
        }

        this.reset();
    }

    _getInterpolateFramesCount() {
        const interpolate = this.actualTime / this.desiredTime - 1;
        return Math.max(0, Math.min(this.maxCount, Math.ceil(interpolate)));
    }

    _transformParticlePosition(index, particle, out) {
        // Renderers pass particle objects in the legacy path and pre-filled
        // positions in the flat-buffer path. Read from whichever is available.
        const x = particle ? particle.x : out.x;
        const y = particle ? particle.y : out.y;
        out.x = x + this._deltas[index].x * this._currentFactor;
        out.y = y + this._deltas[index].y * this._currentFactor;
    }
}

export class SimpleDFRIHelper extends DFRIHelperBase {
    constructor(renderer, particlesCount, sourceFrameRate, desiredFramerate) {
        super(renderer, particlesCount);

        this.reconfigure(sourceFrameRate, desiredFramerate);
    }

    get actualTime() {
        return this._actualTime;
    }

    get desiredTime() {
        return this._desiredTime;
    }

    reconfigure(sourceFrameRate, desiredFramerate) {
        this._actualTime = 1000 / sourceFrameRate;
        this._desiredTime = 1000 / desiredFramerate;
    }
}

export class DFRIHelper extends DFRIHelperBase {
    /**
     * @param {RendererBase} renderer
     * @param {AppSimulationSettings} settings
     */
    constructor(renderer, settings) {
        super(renderer, settings.physics.particleCount)

        this.settings = settings;

        this.stepTimeSmoother = new DataSmoother(this.settings.world.fps * 4, 1);
        this.renderTimeSmoother = new DataSmoother(this.settings.world.fps * 2, 5, true);
        this.renderTimeSmoother.postValue(1000 / this.settings.world.fps, true);

        this.interpolateFramesSmoother = new DataSmoother(this.settings.world.fps);
    }

    get actualTime() {
        return this.stepTimeSmoother.smoothedValue;
    }

    get desiredTime() {
        return this.renderTimeSmoother.smoothedValue;
    }

    get maxCount() {
        return this.settings.render.DFRIMaxFrames;
    }

    bufferSwitched(particles, aheadBufferEntry) {
        const buffer = aheadBufferEntry?.buffer;
        if (!buffer) {
            console.warn(`${performance.now().toFixed(0)} No available ahead buffer, interpolation may be inconsistent`);
        }

        this.setNextFrame((i, out) => {
            out.x = buffer ? buffer[i * ITEM_SIZE] - getParticleX(particles, i) : getParticleVelX(particles, i);
            out.y = buffer ? buffer[i * ITEM_SIZE + 1] - getParticleY(particles, i) : getParticleVelY(particles, i);
        });
    }

    postStepTime(time, force = false) {
        this.stepTimeSmoother.postValue(time, force);
    }

    postRenderTime(time) {
        this.renderTimeSmoother.postValue(time);
    }

    reconfigure(settings) {
        this.settings = settings;
    }

    _getInterpolateFramesCount() {
        const value = super._getInterpolateFramesCount();
        this.interpolateFramesSmoother.postValue(Math.ceil(value));
        const count = (this.interpolateFramesSmoother.smoothedValue + 1) / this.settings.render.slowMotionRate - 1;
        return Math.round(count);
    }

    dispose() {
        this.renderer.setCoordinateTransformer(null);
        this.renderer = null;
        this._deltas = null;
    }
}
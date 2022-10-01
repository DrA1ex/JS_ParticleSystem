export class DataSmoother {
    constructor(count, dropFirstCount = 0, filter = false) {
        this.count = count;
        this.dropCount = dropFirstCount;
        this.filter = filter;
        this.smoothedValue = 0;

        this._historyIndex = 0;
        this._historyValues = [];
        this._historySum = 0;
    }

    postValue(value, force = false) {
        if (!force && this.dropCount > 0) {
            this.dropCount -= 1;
            return;
        }
        if (!force && this.filter && this._historyValues.length > 0) {
            value = this._filter(value);
        }

        this._historySum += value
        if (this._historyValues.length < this.count) {
            this._historyValues.push(value);
        } else {
            this._historySum -= this._historyValues[this._historyIndex];
            this._historyValues[this._historyIndex] = value;
        }

        this._historyIndex = (this._historyIndex + 1) % this.count;
        this.smoothedValue = this._historySum / this._historyValues.length;
        return this.smoothedValue;
    }

    _filter(value) {
        if (value > this.smoothedValue) {
            value = Math.min(value, this.smoothedValue * 2);
        } else if (value < this.smoothedValue) {
            value = Math.max(value, this.smoothedValue / 2);
        }

        return value;
    }
}

export class DFRIHelper {
    constructor(renderer, settings) {
        this.renderer = renderer;
        this.settings = settings;

        this.renderer.setCoordinateTransformer(this._transformParticlePosition.bind(this));

        this.frame = 0;
        this.interpolateFrames = 0;
        this.stepTimeSmoother = new DataSmoother(this.settings.fps * 4, 1);
        this.renderTimeSmoother = new DataSmoother(this.settings.fps * 2, 5, true);
        this.renderTimeSmoother.postValue(1000 / this.settings.fps, true);

        this._isFirstRender = true;
        this._currentFactor = 0;

        this._deltas = new Array(this.settings.particleCount);
        for (let i = 0; i < this.settings.particleCount; i++) {
            this._deltas[i] = {x: 0, y: 0};
        }
    }

    render(particles) {
        if (this._isFirstRender) {
            this.interpolateFrames = this._getInterpolateFramesCount();
            this._isFirstRender = false;
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

    _getInterpolateFramesCount() {
        const interpolate = this.stepTimeSmoother.smoothedValue / this.renderTimeSmoother.smoothedValue - 1;
        return Math.max(0, Math.min(this.settings.DFRIMaxFrames, Math.ceil(interpolate * 1.1)));
    }

    _transformParticlePosition(index, particle, out) {
        out.x = particle.x + this._deltas[index].x * this._currentFactor;
        out.y = particle.y + this._deltas[index].y * this._currentFactor;
    }

    needSwitchBuffer() {
        return this.frame === 0 || this.frame > this.interpolateFrames;
    }

    bufferSwitched(particles, aheadBufferEntry) {
        const buffer = aheadBufferEntry?.buffer;
        if (!buffer) {
            console.warn(`${performance.now().toFixed(0)} No available ahead buffer, interpolation may be inconsistent`);
        }

        for (let i = 0; i < this.settings.particleCount; i++) {
            this._deltas[i].x = buffer ? buffer[i * 4] - particles[i].x : particles[i].velX;
            this._deltas[i].y = buffer ? buffer[i * 4 + 1] - particles[i].y : particles[i].velY;
        }

        this.frame = 0;
        this.interpolateFrames = this._getInterpolateFramesCount();
    }

    postStepTime(time) {
        this.stepTimeSmoother.postValue(time);
    }

    postRenderTime(time) {
        this.renderTimeSmoother.postValue(time);
    }
}
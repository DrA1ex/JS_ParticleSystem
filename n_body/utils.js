export class DataSmoother {
    constructor(count) {
        this.count = count;
        this.smoothedValue = 0;

        this._historyIndex = 0;
        this._historyValues = [];
        this._historySum = 0;
    }

    postValue(value) {
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
}

export class DFRIHelper {
    constructor(renderer, settings) {
        this.renderer = renderer;
        this.settings = settings;

        this.desiredLatency = 1000 / this.settings.fps;
        this.frame = 0;
        this.frameTimeSmoother = new DataSmoother(this.settings.fps * 2);
        this.interpolateFrames = 0;
    }

    render(particles, deltas) {
        const factor = this.getFactor();
        this.renderer.render(particles, deltas, factor);

        this.frame += 1;
        if (this.frame > this.interpolateFrames) {
            this.frame = 0;

            const interpolate = Math.ceil(this.frameTimeSmoother.smoothedValue / this.desiredLatency) - 1;
            this.interpolateFrames = Math.max(0, Math.min(this.settings.DFRIMaxFrames, interpolate));
        }
    }

    getFactor() {
        if (this.frame === 0) {
            return 0;
        }

        return this.frame / (this.interpolateFrames + 1);
    }

    needSwitchBuffer() {
        return this.frame === 0;
    }

    postFrameTime(time) {
        this.frameTimeSmoother.postValue(time);
    }
}
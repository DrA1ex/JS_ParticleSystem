import {SimulationSerializer} from "./serializert.js";

export class SimulationSequence {
    frames = [];
    particleCount;
    componentsCount;
    fps;

    _framesView = null;
    _frameSize = 0;
    _frameCount = 0;
    _frameCache = new Map();
    _frameCacheLimit = 4;

    /**
     * @param {number} particleCount
     * @param {number} componentsCount
     * @param {number} fps
     */
    constructor(particleCount, componentsCount, fps) {
        this.particleCount = particleCount;
        this.componentsCount = componentsCount;
        this.fps = fps;
    }

    get length() {
        return this._framesView ? this._frameCount : this.frames.length;
    }

    /**
     * @param {ArrayBuffer} buffer
     * @return {SimulationSequence}
     */
    static fromBuffer(buffer) {
        const {meta, framesView, frameSize} = SimulationSerializer.loadData(buffer, {lazy: true});

        const instance = new SimulationSequence(meta.particleCount, meta.componentsCount, meta.recordedRate);
        instance._framesView = framesView;
        instance._frameSize = frameSize;
        instance._frameCount = meta.framesCount;

        return instance;
    }

    /**
     * @param {Float32Array} buffer
     */
    addFrame(buffer) {
        this.frames.push(buffer);
    }

    /**
     * @param {number} index
     * @return {Float32Array|null}
     */
    getFrame(index) {
        if (index < 0 || index >= this.length) {
            return null;
        }

        if (!this._framesView) {
            return this.frames[index];
        }

        const cached = this._frameCache.get(index);
        if (cached) {
            // Refresh insertion order for the tiny LRU cache.
            this._frameCache.delete(index);
            this._frameCache.set(index, cached);
            return cached;
        }

        const frame = this._framesView.createTypedArray(
            Float32Array,
            index * this._frameSize * Float32Array.BYTES_PER_ELEMENT,
            this._frameSize
        );
        if (frame.length !== this._frameSize) {
            throw new Error(`Invalid frame ${index}. Expected ${this._frameSize} values, got ${frame.length}`);
        }

        this._frameCache.set(index, frame);
        while (this._frameCache.size > this._frameCacheLimit) {
            const oldest = this._frameCache.keys().next().value;
            this._frameCache.delete(oldest);
        }
        return frame;
    }
}
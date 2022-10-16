import {SimulationSerializer} from "./serializert.js";

export class SimulationSequence {
    frames = [];
    particleCount;
    componentsCount;
    fps;

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
        return this.frames.length;
    }

    /**
     * @param {ArrayBuffer} buffer
     * @return {SimulationSequence}
     */
    static fromBuffer(buffer) {
        const {meta, frames} = SimulationSerializer.loadData(buffer);

        const instance = new SimulationSequence(meta.particleCount, meta.componentsCount, meta.recordedRate);
        instance.frames = frames;

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
        if (index >= 0 && index < this.length) {
            return this.frames[index];
        }

        return null;
    }
}
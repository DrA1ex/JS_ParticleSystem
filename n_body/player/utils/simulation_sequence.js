import {SimulationLoader} from "./loader.js";

export class SimulationSequence {
    frames = [];

    constructor(particleCount, componentsCount, fps) {
        this.particleCount = particleCount;
        this.componentsCount = componentsCount;
        this.fps = fps;
    }

    addFrame(buffer) {
        this.frames.push(buffer);
    }

    getFrame(index) {
        if (index < this.length) {
            return this.frames[index];
        }

        return null;
    }

    get length() {
        return this.frames.length;
    }

    /**
     * @param {ArrayBuffer} buffer
     * @return {SimulationSequence}
     */
    static fromBuffer(buffer) {
        const {meta, frames} = SimulationLoader.loadData(buffer);

        const instance = new SimulationSequence(meta.particleCount, meta.componentsCount, meta.recordedRate);
        instance.frames = frames;

        return instance;
    }
}
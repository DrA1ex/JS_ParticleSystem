import {ParticleInitializer, PhysicsEngine} from "../simulation/physics.js";

/**
 * @typedef {{physicsTime:number, treeTime: number, tree: {flops: number, depth: number, segmentCount: number}}} StepStatistics
 * @typedef {{timestamp: number, buffer: Float32Array, treeDebug: Array, forceDebug: Array, stats: StepStatistics}} StepResult
 */

export const ITEM_SIZE = 5;

export class BackendBase {
    /**
     * @param {string} workerPath
     */
    constructor(workerPath) {
        this._worker = new Worker(workerPath, {type: "module"});
    }

    /**
     * @param {function(StepResult):void} onDataFn
     * @param {Settings} settings
     * @param {Particle[]=null} particles
     * @return {void}
     */
    init(onDataFn, settings, particles = null) {
        this._worker.onmessage = function (e) {
            if (e.data.type === "data") {
                onDataFn(e.data);
            }
        }

        this._worker.postMessage({type: "init", settings, state: particles});
    }

    /**
     * @param {Float32Array} buffer
     * @return {void}
     */
    freeBuffer(buffer) {
        this._worker.postMessage({type: "ack", buffer}, [buffer.buffer]);
    }

    /**
     * @return {void}
     */
    requestNextStep() {
        this._worker.postMessage({type: "step", timestamp: performance.now()});
    }
}

export class BackendImpl {
    settings;
    state;

    physicalEngine;
    particles;
    buffers = [];

    constructor() {
    }

    init(settings, state) {
        this.settings = settings;
        this.physicalEngine = new PhysicsEngine(this.settings);
        this.particles = ParticleInitializer.initialize(this.settings);

        if (state && state.length > 0) {
            const size = Math.min(state.length, this.settings.particleCount);
            for (let i = 0; i < size; i++) {
                const [x, y, velX, velY, mass] = state[i];
                this.particles[i].x = x;
                this.particles[i].y = y;
                this.particles[i].velX = velX;
                this.particles[i].velY = velY;
                this.particles[i].mass = mass;
            }
        }

        for (let i = 0; i < this.settings.bufferCount; i++) {
            this.buffers.push(new Float32Array(this.settings.particleCount * ITEM_SIZE));
        }
    }

    ack(buffer) {
        if (this.buffers.length < this.settings.bufferCount) {
            this.buffers.push(buffer);
        } else {
            console.error("Unexpected ack: buffers already fulfilled");
        }
    }

    /**
     * @abstract
     * @param {number} timestamp
     * @return {?StepResult}
     */
    step(timestamp) {
    }
}

export class WorkerHandler {
    constructor(backend) {
        this.backend = backend;
    }

    handleMessage(e) {
        const {type} = e.data;
        switch (type) {
            case "init": {
                const {settings, state} = e.data;
                this.backend.init(settings, state);
            }
                break;

            case "ack": {
                const {buffer} = e.data;
                this.backend.ack(buffer);
            }
                break;

            case "step": {
                const {timestamp} = e.data;

                const data = this.backend.step(timestamp);
                if (data) {
                    postMessage({type: "data", ...data,}, [data.buffer.buffer]);
                }
            }
                break;
        }
    }

}
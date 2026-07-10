import {Particle_initializer} from "../simulation/particle_initializer.js";
import {AppSimulationSettings} from "../settings/app.js";
import {ITEM_SIZE} from "../utils/particles.js";
import {BUILD_ID, WORKER_PROTOCOL_VERSION, withBuildId} from "../utils/build.js";

/**
 * @typedef {{physicsTime:number, treeTime: number, tree: {flops: number, depth: number, segmentCount: number}, profile?: Object, actualSegmentSize?: number, segmentAutoTune?: Object}} StepStatistics
 * @typedef {{timestamp: number, buffer: Float32Array, treeDebug: Array, forceDebug: Array, stats: StepStatistics}} StepResult
 */

export {ITEM_SIZE};

export class BackendBase {
    displayName = "Backend";

    /**
     * @param {string} workerPath
     */
    constructor(workerPath) {
        this._worker = new Worker(withBuildId(workerPath), {type: "module"});
        this._controlRequestId = 0;
        this._pendingReconfigures = new Map();
        this._pendingInitialization = null;
        this._disposed = false;

        this._worker.onerror = (event) => {
            event.preventDefault?.();
            const error = new Error(event.message || `${this.displayName} worker failed`);
            const handledByControlPromise = !!this._pendingInitialization || this._pendingReconfigures.size > 0;
            this._rejectInitialization(error);
            this._rejectPendingReconfigures(error);
            if (!handledByControlPromise) {
                setTimeout(() => { throw error; });
            }
        };
        this._worker.onmessageerror = () => {
            const error = new Error(`${this.displayName} worker returned an unreadable message`);
            const handledByControlPromise = !!this._pendingInitialization || this._pendingReconfigures.size > 0;
            this._rejectInitialization(error);
            this._rejectPendingReconfigures(error);
            if (!handledByControlPromise) {
                setTimeout(() => { throw error; });
            }
        };
    }

    /**
     * @param {function(StepResult):void} onDataFn
     * @param {function():void} onReadyFn
     * @param {AppSimulationSettings} settings
     * @param {Particle[]|Float32Array|Array[]} [particles=null]
     * @return {void}
     */
    init(onDataFn, onReadyFn, settings, particles = null) {
        if (this._disposed) {
            return Promise.reject(new Error(`${this.displayName} is already disposed`));
        }
        if (this._pendingInitialization) {
            return Promise.reject(new Error(`${this.displayName} initialization is already pending`));
        }

        this.subscribe(onDataFn, onReadyFn);
        const promise = new Promise((resolve, reject) => {
            this._pendingInitialization = {resolve, reject};
        });
        try {
            this._worker.postMessage({
                type: "init",
                settings: settings.serialize(),
                state: particles,
                expectedBuildId: BUILD_ID,
                expectedProtocolVersion: WORKER_PROTOCOL_VERSION,
            });
        } catch (error) {
            this._rejectInitialization(error);
        }
        return promise;
    }

    /**
     * @param {AppSimulationSettings} settings
     * @param {Particle[]|Float32Array|Array[]} [particles=null]
     */
    reconfigure(settings, particles = null) {
        if (this._disposed) {
            return Promise.reject(new Error(`${this.displayName} is already disposed`));
        }

        const requestId = ++this._controlRequestId;
        return new Promise((resolve, reject) => {
            this._pendingReconfigures.set(requestId, {resolve, reject});
            try {
                this._worker.postMessage({
                    type: "reconfigure",
                    requestId,
                    settings: settings.serialize(),
                    state: particles,
                });
            } catch (error) {
                this._pendingReconfigures.delete(requestId);
                reject(error);
            }
        });
    }

    subscribe(dataFn, readyFn) {
        this._worker.onmessage = (e) => {
            if (this._handleControlMessage(e.data)) {
                return;
            }
            switch (e.data.type) {
                case "data":
                    dataFn(e.data);
                    break;
                case "ready":
                    this._resolveInitialization(e.data);
                    readyFn(e.data);
                    break;
                case "ready-error":
                    this._rejectInitialization(new Error(e.data.message || "Worker initialization failed"));
                    break;
            }
        }
    }



    _resolveInitialization(data) {
        const pending = this._pendingInitialization;
        if (!pending) return;
        this._pendingInitialization = null;
        pending.resolve(data);
    }

    _rejectInitialization(error) {
        const pending = this._pendingInitialization;
        if (!pending) return;
        this._pendingInitialization = null;
        pending.reject(error);
    }

    _handleControlMessage(data) {
        if (data?.type !== "reconfigured" && data?.type !== "reconfigure-error") {
            return false;
        }

        const pending = this._pendingReconfigures.get(data.requestId);
        if (!pending) {
            return true;
        }
        this._pendingReconfigures.delete(data.requestId);

        if (data.type === "reconfigured") {
            pending.resolve(data);
        } else {
            pending.reject(new Error(data.message || `${this.displayName} reconfiguration failed`));
        }
        return true;
    }

    _rejectPendingReconfigures(error) {
        for (const {reject} of this._pendingReconfigures.values()) {
            reject(error);
        }
        this._pendingReconfigures.clear();
    }

    /**
     * @param {Float32Array} buffer
     * @return {void}
     */
    freeBuffer(buffer) {
        if (this._disposed || !buffer) return;
        this._worker.postMessage({type: "ack", buffer}, [buffer.buffer]);
    }

    /**
     * @return {void}
     */
    requestNextStep() {
        if (this._disposed) return;
        this._worker.postMessage({type: "step", timestamp: performance.now()});
    }

    dispose() {
        if (this._disposed) {
            return;
        }
        this._disposed = true;
        const disposeError = new Error(`${this.displayName} was disposed`);
        this._rejectInitialization(disposeError);
        this._rejectPendingReconfigures(disposeError);
        this._worker.postMessage({type: "dispose"});

        this._worker.onmessage = null;
        this._worker.onerror = null;
        this._worker.onmessageerror = null;
        this._worker.terminate();
    }
}

export class BackendImpl {
    /** @type{AppSimulationSettings} */
    settings;

    physicalEngine;
    particles;
    buffers;

    constructor(physicsEngineClass) {
        this.physicalEngineClass = physicsEngineClass;
    }

    init(settings, state) {
        this.settings = AppSimulationSettings.deserialize(settings);
        this.physicalEngine = new this.physicalEngineClass(this.settings);
        this.particles = Particle_initializer.initialize(this.settings);
        this._applyParticlesState(state);

        this.buffers = new Array(this.settings.simulation.bufferCount);
        for (let i = 0; i < this.settings.simulation.bufferCount; i++) {
            this.buffers[i] = new Float32Array(this.settings.physics.particleCount * ITEM_SIZE);
        }
    }

    ack(buffer) {
        if (this.buffers.length < this.settings.simulation.bufferCount) {
            this.buffers.push(buffer);
        } else {
            console.error("Unexpected ack: buffers already fulfilled");
        }
    }

    /**
     * @param {number} timestamp
     * @return {?StepResult}
     */
    step(timestamp) {
        if (this.buffers.length === 0) {
            console.error("Unexpected step: buffer is not ready");
            return null;
        }

        const tree = this.physicalEngine.step(this.particles);

        const buffer = this.buffers.shift();
        this._fillBuffer(buffer);

        return {
            timestamp: timestamp,
            buffer: buffer,
            treeDebug: this.settings.common.debugTree ? tree.getDebugData() : [],
            forceDebug: [],
            stats: {
                physicsTime: this.physicalEngine.stats.physicsTime,
                treeTime: this.physicalEngine.stats.treeTime,
                tree: {
                    flops: this.physicalEngine.stats.tree.flops,
                    depth: this.physicalEngine.stats.tree.depth,
                    segmentCount: this.physicalEngine.stats.tree.segmentCount
                },
                profile: this.physicalEngine.stats.profile || null
            }
        }
    }

    reconfigure(settings, state) {
        this.settings = AppSimulationSettings.deserialize(settings);
        this._applyParticlesState(state);

        this.physicalEngine.reconfigure(this.settings);
    }

    dispose() {
        this.buffers = null;
        this.particles = null;

        this.physicalEngine.dispose();
        this.physicalEngine = null;
    }

    /**
     * @protected
     */
    _applyParticlesState(state) {
        if (!state || state.length === 0) {
            return;
        }

        if (state instanceof Float32Array) {
            const size = Math.min(state.length / ITEM_SIZE, this.settings.physics.particleCount);
            for (let i = 0; i < size; i++) {
                const offset = i * ITEM_SIZE;
                this.particles[i].x = state[offset];
                this.particles[i].y = state[offset + 1];
                this.particles[i].velX = state[offset + 2];
                this.particles[i].velY = state[offset + 3];
                this.particles[i].mass = state[offset + 4];
            }
            return;
        }

        const size = Math.min(state.length, this.settings.physics.particleCount);
        for (let i = 0; i < size; i++) {
            const [x, y, velX, velY, mass] = state[i];
            this.particles[i].x = x;
            this.particles[i].y = y;
            this.particles[i].velX = velX;
            this.particles[i].velY = velY;
            this.particles[i].mass = mass;
        }
    }

    /**
     * @protected
     */
    _fillBuffer(buffer) {
        for (let i = 0; i < this.settings.physics.particleCount; i++) {
            buffer[i * ITEM_SIZE] = this.particles[i].x;
            buffer[i * ITEM_SIZE + 1] = this.particles[i].y;
            buffer[i * ITEM_SIZE + 2] = this.particles[i].velX;
            buffer[i * ITEM_SIZE + 3] = this.particles[i].velY;
            buffer[i * ITEM_SIZE + 4] = this.particles[i].mass;
        }
    }
}

export class WorkerHandler {
    constructor(backend) {
        this.backend = backend;
        this._queue = Promise.resolve();
    }

    handleMessage(e) {
        this._queue = this._queue
            .then(() => this._handleMessage(e))
            .catch(e => setTimeout(() => {
                throw new Error(e.message)
            }));
    }

    async _handleMessage(e) {
        const {type} = e.data;
        switch (type) {
            case "init": {
                const {settings, state} = e.data;
                try {
                    await this.backend.init(settings, state, {
                        expectedBuildId: e.data.expectedBuildId,
                        expectedProtocolVersion: e.data.expectedProtocolVersion,
                    });
                    postMessage({type: "ready", ...(this.backend.getRuntimeMetadata?.() || {})});
                } catch (error) {
                    postMessage({type: "ready-error", message: error?.message || String(error), ...(this.backend.getRuntimeMetadata?.() || {})});
                }
            }
                break;

            case "ack": {
                const {buffer} = e.data;
                this.backend.ack(buffer);
            }
                break;

            case "step": {
                const {timestamp} = e.data;

                const data = await this.backend.step(timestamp);
                if (data) {
                    postMessage({type: "data", ...data,}, [data.buffer.buffer]);
                }
            }
                break;

            case "reconfigure": {
                const {settings, state, requestId} = e.data;
                try {
                    await this.backend.reconfigure(settings, state);
                    postMessage({
                        type: "reconfigured",
                        requestId,
                        ...(this.backend.getRuntimeMetadata?.() || {}),
                    });
                } catch (error) {
                    postMessage({
                        type: "reconfigure-error",
                        requestId,
                        message: error?.message || String(error),
                        ...(this.backend.getRuntimeMetadata?.() || {}),
                    });
                }
            }
                break;

            case "dispose":
                this.backend.dispose();
                break;
        }
    }

}
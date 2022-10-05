import {BackendBase, BackendImpl} from "./base.js";

export class WorkerBackend extends BackendBase {
    constructor() {
        super();

        this._worker = new Worker("./backend/worker.js", {type: "module"});
    }

    init(onDataFn, settings, particles = null) {
        this._worker.onmessage = function (e) {
            if (e.data.type === "data") {
                onDataFn(e.data);
            }
        }

        this._worker.postMessage({type: "init", settings, state: particles});
    }

    freeBuffer(buffer) {
        this._worker.postMessage({type: "ack", buffer}, [buffer.buffer]);
    }

    requestNextStep() {
        this._worker.postMessage({type: "step", timestamp: performance.now()});
    }
}

class WorkerBackendImpl extends BackendImpl {
    constructor() {
        super();

        this._particleForces = [];
    }

    init(settings, state) {
        super.init(settings, state);

        if (this.settings.debug && this.settings.debugForce) {
            this._particleForces = new Array(this.settings.particleCount);
            for (let i = 0; i < this._particleForces.length; i++) {
                this._particleForces[i] = {forceX: 0, forceY: 0};
            }
        }
    }

    step(timestamp) {
        this._beforeStep();

        const data = super.step(timestamp);
        if (!data) {
            return null;
        }

        return {
            ...data,
            forceDebug: this._getCalculatedForces()
        }
    }

    _beforeStep() {
        if (this.settings.debug && this.settings.debugForce) {
            for (let i = 0; i < this.settings.particleCount; i++) {
                this.particles[i].forceX = 0;
                this.particles[i].forceY = 0;
            }
        }
    }

    _getCalculatedForces() {
        if (this.settings.debug && this.settings.debugForce) {
            for (let i = 0; i < this.settings.particleCount; i++) {
                this._particleForces[i] = {
                    forceX: this.particles[i].forceX,
                    forceY: this.particles[i].forceY
                }
            }
        }

        return this._particleForces;
    }
}

const Backend = new WorkerBackendImpl();

onmessage = function (e) {
    const {type} = e.data;
    switch (type) {
        case "init": {
            const {settings, state} = e.data;
            Backend.init(settings, state);
        }
            break;

        case "ack": {
            const {buffer} = e.data;
            Backend.ack(buffer);
        }
            break;

        case "step": {
            const {timestamp} = e.data;

            const data = Backend.step(timestamp);
            if (data) {
                postMessage({type: "data", ...data,}, [data.buffer.buffer]);
            }
        }
            break;
    }
}
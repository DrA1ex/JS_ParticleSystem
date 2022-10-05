import {BackendBase, BackendImpl, WorkerHandler} from "./base.js";

export class WorkerBackend extends BackendBase {
    constructor() {
        super("./backend/gpgpu.js");
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
const WorkerHandlerInstance = new WorkerHandler(Backend);

onmessage = WorkerHandlerInstance.handleMessage.bind(WorkerHandlerInstance);
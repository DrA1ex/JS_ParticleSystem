import {BackendBase, BackendImpl, WorkerHandler} from "./base.js";
import {PhysicsEngine} from "../simulation/physics.js";

export class WorkerBackend extends BackendBase {
    constructor() {
        super("./backend/worker.js");
    }
}

class WorkerBackendImpl extends BackendImpl {
    constructor() {
        super(PhysicsEngine);

        this._particleForces = [];
    }

    async init(settings, state) {
        super.init(settings, state);

        if (this.settings.common.debugForce) {
            this._particleForces = new Array(this.settings.physics.particleCount);
            for (let i = 0; i < this._particleForces.length; i++) {
                this._particleForces[i] = {forceX: 0, forceY: 0};
            }
        }
    }

    step(timestamp) {
        this._beforeStep();

        const data = super.step(timestamp);
        if (data) {
            data.forceDebug = this._getCalculatedForces();
            return data
        }

        return null;
    }

    /**
     * @protected
     */
    _beforeStep() {
        if (this.settings.common.debugForce) {
            for (let i = 0; i < this.settings.physics.particleCount; i++) {
                this.particles[i].forceX = 0;
                this.particles[i].forceY = 0;
            }
        }
    }

    /**
     * @protected
     */
    _getCalculatedForces() {
        if (this.settings.common.debugForce) {
            for (let i = 0; i < this.settings.physics.particleCount; i++) {
                this._particleForces[i] = {
                    forceX: this.particles[i].forceX,
                    forceY: this.particles[i].forceY
                }
            }
        }

        return this._particleForces;
    }

    dispose() {
        this._particleForces = null;

        super.dispose();
    }
}

const Backend = new WorkerBackendImpl();
const WorkerHandlerInstance = new WorkerHandler(Backend);

onmessage = WorkerHandlerInstance.handleMessage.bind(WorkerHandlerInstance);
import {BackendBase, BackendImpl, ITEM_SIZE, WorkerHandler} from "./base.js";

export class WorkerBackend extends BackendBase {
    constructor() {
        super("./backend/worker.js");
    }
}

class WorkerBackendImpl extends BackendImpl {
    constructor() {
        super();

        this._particleForces = [];
    }

    init(settings, state) {
        super.init(settings, state);

        if (this.settings.debugForce) {
            this._particleForces = new Array(this.settings.particleCount);
            for (let i = 0; i < this._particleForces.length; i++) {
                this._particleForces[i] = {forceX: 0, forceY: 0};
            }
        }
    }

    step(timestamp) {
        if (this.buffers.length === 0) {
            console.error("Unexpected step: buffer is not ready");
            return null;
        }

        this._beforeStep();
        const tree = this.physicalEngine.step(this.particles);

        const buffer = this.buffers.shift();
        for (let i = 0; i < this.settings.particleCount; i++) {
            buffer[i * ITEM_SIZE] = this.particles[i].x;
            buffer[i * ITEM_SIZE + 1] = this.particles[i].y;
            buffer[i * ITEM_SIZE + 2] = this.particles[i].velX;
            buffer[i * ITEM_SIZE + 3] = this.particles[i].velY;
            buffer[i * ITEM_SIZE + 4] = this.particles[i].mass;
        }

        return {
            timestamp: timestamp,
            buffer: buffer,
            treeDebug: this.settings.debugTree ? tree.getDebugData() : [],
            forceDebug: this._getCalculatedForces(),
            stats: {
                physicsTime: this.physicalEngine.stats.physicsTime,
                treeTime: this.physicalEngine.stats.treeTime,
                tree: {
                    flops: this.physicalEngine.stats.tree.flops,
                    depth: this.physicalEngine.stats.tree.depth,
                    segmentCount: this.physicalEngine.stats.tree.segmentCount
                }
            }
        }
    }

    _beforeStep() {
        if (this.settings.debugForce) {
            for (let i = 0; i < this.settings.particleCount; i++) {
                this.particles[i].forceX = 0;
                this.particles[i].forceY = 0;
            }
        }
    }

    _getCalculatedForces() {
        if (this.settings.debugForce) {
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
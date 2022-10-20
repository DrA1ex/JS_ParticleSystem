import {BackendBase, BackendImpl, WorkerHandler} from "./base.js";
import {GPUPhysicsEngine} from "./gpgpu/gpgpu_physics.js";

export class GPUBackend extends BackendBase {
    constructor() {
        super("./backend/gpgpu.js");
    }
}

class GPUBackendImpl extends BackendImpl {
    canvas;
    gl;
    _stateConfig = {};

    constructor() {
        super(GPUPhysicsEngine);
    }

    async init(settings, state) {
        settings.simulation.segmentMaxCount = Math.pow(settings.simulation.segmentMaxCount, 2);

        super.init(settings, state);
        await this.physicalEngine.init(this.settings);
    }
}

const Backend = new GPUBackendImpl();
const WorkerHandlerInstance = new WorkerHandler(Backend);

onmessage = WorkerHandlerInstance.handleMessage.bind(WorkerHandlerInstance);
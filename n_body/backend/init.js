import {BackendType} from "../settings/enum.js";
import {WorkerBackend} from "./worker.js";
import {GPUBackend} from "./gpgpu.js";

export class BackendInitializer {
    static initBackend(type) {
        switch (type) {
            case BackendType.gpgpu:
                return new GPUBackend();

            case BackendType.worker:
            default:
                return new WorkerBackend();
        }
    }
}
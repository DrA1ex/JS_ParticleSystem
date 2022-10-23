import {ComponentType, Property, SettingsBase} from "./base.js";
import {BackendType} from "./enum.js";

export class SimulationSettings extends SettingsBase {
    static Properties = {
        backend: Property.enum("backend", BackendType, BackendType.worker)
            .setName("Backend").setDescription("Choice backend to calculate particle interactions")
            .setBreaks(ComponentType.backend, ComponentType.dfri, ComponentType.debug),
        segmentDivider: Property.int("segment_divider", 2)
            .setName("Segment divider").setDescription("Spatial subdivision factor while segmentation, larger values increase accuracy")
            .setAffects(ComponentType.backend, ComponentType.dfri)
            .setConstraints(2, 16),
        segmentSize: Property.int("segment_max_count", null)
            .setName("Segment size").setDescription(" Max particle count in segment, larger values increase accuracy")
            .setBreaks(ComponentType.backend, ComponentType.dfri)
            .setAffects(ComponentType.debug)
            .setConstraints(1, 1e6),
        segmentRandomness: Property.float("segment_random", 0.25)
            .setName("Segmentation randomness").setDescription("Spatial subdivision randomness factor")
            .setAffects(ComponentType.backend)
            .setConstraints(0, 1),
        bufferCount: Property.int("buffers", 3)
            .setName("Buffer count").setDescription("How many physics frames will be requested ahead of time")
            .setBreaks(ComponentType.backend, ComponentType.debug)
            .setConstraints(1, 20),
    }

    get backend() {return this.config.backend;}
    get segmentDivider() {return this.config.segmentDivider;}
    get segmentRandomness() {return this.config.segmentRandomness;}
    get segmentSize() {return this.config.segmentSize;}
    get segmentMaxCount() {return this.config.segmentMaxCount;}
    get bufferCount() {return this.config.bufferCount;}

    constructor(values) {
        super(values);

        if (!this.segmentSize) {
            this.config.segmentSize = this.backend === BackendType.gpgpu ? 128 : 32;
        }

        this.config.segmentMaxCount = this.segmentSize;
        if (this.backend === BackendType.gpgpu) {
            this.config.segmentMaxCount = Math.pow(Math.min(this.segmentSize, 1024), 2);
        }
    }
}
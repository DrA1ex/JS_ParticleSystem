import {Property, SettingsBase} from "./base.js";
import {BackendType} from "./enum.js";

export class SimulationSettings extends SettingsBase {
    static Properties = {
        backend: Property.enum("backend", BackendType, BackendType.worker).setName("Backend")
            .setDescription("Choice backend to calculate particle interactions"),
        segmentDivider: Property.int("segment_divider", 2).setName("Segment divider")
            .setDescription("Spatial subdivision factor while segmentation, larger values increase accuracy"),
        segmentSize: Property.int("segment_max_count", null).setName("Segment size")
            .setDescription(" Max particle count in segment, larger values increase accuracy"),
        segmentRandomness: Property.float("segment_random", 0.25).setName("Segmentation randomness")
            .setDescription("Spatial subdivision randomness factor"),
        bufferCount: Property.int("buffers", 3).setDescription("Buffer count")
            .setDescription("How many physics frames will be requested ahead of time"),
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
            this.config.segmentMaxCount = Math.pow(this.segmentSize, 2);
        }

        this.config.segmentRandomness = Math.max(0, Math.min(1, this.segmentRandomness));
    }
}
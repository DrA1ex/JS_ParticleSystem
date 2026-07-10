import {ComponentType, Property, ReadOnlyProperty, SettingsBase} from "./base.js";
import {BackendType, WorkerThreadCount} from "./enum.js";

const isCpuBackend = settings => settings.simulation.backend !== BackendType.gpgpu;
const isWorkerMtBackend = settings => settings.simulation.backend === BackendType.workerMt;

export class SimulationSettings extends SettingsBase {
    static Properties = {
        backend: Property.enum("backend", BackendType, BackendType.workerMt)
            .setName("Backend").setDescription("Choice backend to calculate particle interactions")
            .setBreaks(ComponentType.backend, ComponentType.dfri, ComponentType.debug),
        segmentDivider: Property.int("segment_divider", 2)
            .setName("Segment divider").setDescription("Spatial subdivision factor while segmentation, larger values increase accuracy")
            .setAffects(ComponentType.backend, ComponentType.dfri)
            .setVisibleWhen(isCpuBackend)
            .setConstraints(2, 16),
        segmentSize: Property.int("segment_max_count", null)
            .setName("Segment size").setDescription([
                "Target maximum number of particles in a CPU spatial-tree leaf before it is subdivided.",
                "Smaller values create a deeper tree and usually reduce exact pair interactions inside leaves.",
                "Larger values make tree construction cheaper but can make force solving slower because leaf interactions are quadratic.",
                "For GPGPU this is converted to a square texture block size. When Auto tune segment size is enabled, the CPU worker may override this value with the fastest measured candidate."
            ].join("\n"))
            .setBreaks(ComponentType.backend, ComponentType.dfri)
            .setAffects(ComponentType.debug)
            .setConstraints(1, 1e6),
        autoTuneSegmentSize: Property.bool("segment_auto", true)
            .setName("Auto tune segment size").setDescription([
                "CPU worker only. Tries several real physics steps with different segment sizes and keeps the fastest measured value.",
                "This can improve performance because the best segment size depends on particle count, distribution and CPU.",
                "While tuning is running, physics timing may fluctuate; after it finishes, the chosen block size is shown in stats.",
                "GPGPU backend ignores this option because its segment size has a different meaning."
            ].join("\n"))
            .setBreaks(ComponentType.backend, ComponentType.debug)
            .setVisibleWhen(isCpuBackend),
        workerThreads: Property.enum("worker_threads", WorkerThreadCount, WorkerThreadCount.auto)
            .setName("Worker threads").setDescription([
                "Worker MT backend only. Number of physics subworkers used for tree construction, leaf force solving and integration.",
                "auto uses navigator.hardwareConcurrency when available, keeps one logical processor for the coordinator/main thread, and otherwise falls back to 4.",
                "This mode requires SharedArrayBuffer/cross-origin isolation for real multithreading; otherwise it falls back to the single worker path.",
                "On static hosting such as GitHub Pages, n_body can install a local COOP/COEP service worker and reload once to enable SharedArrayBuffer."
            ].join("\n"))
            .setBreaks(ComponentType.backend, ComponentType.debug)
            .setVisibleWhen(isWorkerMtBackend),
        segmentRandomness: Property.float("segment_random", 0.25)
            .setName("Segmentation randomness").setDescription([
                "Randomizes CPU tree split positions to soften visible grid-aligned segmentation artifacts.",
                "The tree approximation is not exact, so this helps avoid persistent sharp subdivision boundaries."
            ].join("\n"))
            .setAffects(ComponentType.backend)
            .setVisibleWhen(isCpuBackend)
            .setConstraints(0, 1),
        bufferCount: Property.int("buffers", 3)
            .setName("Buffer count").setDescription("How many physics frames will be requested ahead of time")
            .setBreaks(ComponentType.backend, ComponentType.debug)
            .setConstraints(1, 20),
    }

    static ReadOnlyProperties = {
        segmentMaxCount: ReadOnlyProperty.float().setName("Actual segment size").setDescription([
            "Effective block size used by the active backend after defaults and backend-specific transformations are applied.",
            "For CPU worker this is the active leaf size, possibly selected by auto-tune.",
            "For GPGPU this may be derived from the configured segment size."
        ].join("\n")),
    }

    static PropertiesDependencies = new Map([
        [this.Properties.backend, [this.ReadOnlyProperties.segmentMaxCount]],
        [this.Properties.segmentSize, [this.ReadOnlyProperties.segmentMaxCount]],
    ]);

    get backend() {return this.config.backend;}
    get segmentDivider() {return this.config.segmentDivider;}
    get segmentRandomness() {return this.config.segmentRandomness;}
    get segmentSize() {return this.config.segmentSize;}
    get autoTuneSegmentSize() {return this.config.autoTuneSegmentSize;}
    get workerThreads() {return this.config.workerThreads;}
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

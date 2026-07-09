import {ComponentType, Property, ReadOnlyProperty, SettingsBase} from "./base.js";
import {BackendType, WorkerHybridProfile, WorkerThreadCount, WorkerTreeJobCount, WorkerTreeStrategy} from "./enum.js";

const isCpuBackend = settings => settings.simulation.backend !== BackendType.gpgpu;
const isWorkerMtBackend = settings => settings.simulation.backend === BackendType.workerMt;
const usesWorkerMtTreeJobs = settings => isWorkerMtBackend(settings) &&
    settings.simulation.workerMtTreeStrategy !== WorkerTreeStrategy.recursive;
const isHybridWorkerMt = settings => isWorkerMtBackend(settings) &&
    settings.simulation.workerMtTreeStrategy === WorkerTreeStrategy.hybrid;

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
                "Worker MT backend only. Number of physics subworkers used for leaf force solving, integration and parallel subtree work.",
                "auto uses navigator.hardwareConcurrency when available and otherwise falls back to 4.",
                "This mode requires SharedArrayBuffer/cross-origin isolation for real multithreading; otherwise it falls back to the single worker path.",
                "On static hosting such as GitHub Pages, n_body can install a local COOP/COEP service worker and reload once to enable SharedArrayBuffer."
            ].join("\n"))
            .setBreaks(ComponentType.backend, ComponentType.debug)
            .setVisibleWhen(isWorkerMtBackend),
        workerMtTreeJobs: Property.enum("worker_mt_tree_jobs", WorkerTreeJobCount, WorkerTreeJobCount.auto)
            .setName("Worker MT tree jobs").setDescription([
                "Worker MT backend only. Target number of subtree jobs used by static/dynamic/hybrid tree scheduling.",
                "More jobs can improve load balancing between workers, but too many jobs add coordinator/message overhead.",
                "recursive ignores this value because it uses its own coarse root seed. hybrid uses this as a seed target unless the selected profile clamps it lower."
            ].join("\n"))
            .setBreaks(ComponentType.backend, ComponentType.debug)
            .setVisibleWhen(usesWorkerMtTreeJobs),
        workerMtTreeStrategy: Property.enum("worker_mt_tree_strategy", WorkerTreeStrategy, WorkerTreeStrategy.dynamic)
            .setName("Worker MT tree strategy").setDescription([
                "Worker MT backend only. Strategy used to split parallel tree work between subworkers.",
                "static uses the shallow coordinator split and assigns jobs once.",
                "dynamic uses the current coordinator queue, but with a conservative shallow split to avoid expensive single-thread preparation.",
                "recursive starts from coarse jobs and lets subworkers split heavy jobs further, returning spawned jobs to the coordinator queue.",
                "hybrid uses a selectable split-first profile. Use Hybrid tree profile to test coarse, balanced and wide variants without changing strategy."
            ].join("\n"))
            .setBreaks(ComponentType.backend, ComponentType.debug)
            .setVisibleWhen(isWorkerMtBackend),
        workerMtHybridProfile: Property.enum("worker_mt_hybrid_profile", WorkerHybridProfile, WorkerHybridProfile.coarse)
            .setName("Hybrid tree profile").setDescription([
                "Worker MT hybrid strategy only. Selects how aggressively hybrid creates seed jobs and recursively splits heavy tree jobs.",
                "coarse: closest to recursive; low coordinator work, one split-first pass, fewer spawned jobs. This is the recommended next test.",
                "balanced: middle ground; slightly wider seed and recursive budget while still avoiding the previous over-splitting profile.",
                "wide: previous split-first hybrid behavior; useful as a comparison point, but it produced too many spawned jobs in the last report."
            ].join("\n"))
            .setBreaks(ComponentType.backend, ComponentType.debug)
            .setVisibleWhen(isHybridWorkerMt),
        workerMtHybridSplitFirst: Property.bool("worker_mt_hybrid_split_first", true)
            .setName("Hybrid split-first").setDescription([
                "Worker MT hybrid strategy only. When enabled, a worker that splits a heavy tree job returns the resulting child jobs to the coordinator immediately instead of mixing that split with local force/integrate work.",
                "This preserves the previous winning hybrid/coarse behavior and keeps the global queue visible early.",
                "Disable it to compare against a more recursive local-processing pipeline."
            ].join("\n"))
            .setBreaks(ComponentType.backend, ComponentType.debug)
            .setVisibleWhen(isHybridWorkerMt),
        workerMtHybridJobSorting: Property.bool("worker_mt_hybrid_job_sorting", false)
            .setName("Hybrid job sorting").setDescription([
                "Worker MT hybrid strategy only. When enabled, the coordinator sorts hybrid jobs with a tail-oriented estimate that includes a rough solve-cost component.",
                "When disabled, hybrid uses the same tree-build estimate as dynamic/recursive. This is the previous baseline behavior."
            ].join("\n"))
            .setBreaks(ComponentType.backend, ComponentType.debug)
            .setVisibleWhen(isHybridWorkerMt),
        workerMtHybridSplitGainFilter: Property.bool("worker_mt_hybrid_split_gain", false)
            .setName("Hybrid split-gain filter").setDescription([
                "Worker MT hybrid strategy only. When enabled, a recursive split is accepted only if it appears to reduce the critical child tail enough.",
                "This lets us test whether avoiding low-value splits helps without also changing split-first or queue sorting behavior."
            ].join("\n"))
            .setBreaks(ComponentType.backend, ComponentType.debug)
            .setVisibleWhen(isHybridWorkerMt),
        segmentRandomness: Property.float("segment_random", 0.25)
            .setName("Segmentation randomness").setDescription("Spatial subdivision randomness factor")
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
    get workerMtTreeJobs() {return this.config.workerMtTreeJobs;}
    get workerMtTreeStrategy() {return this.config.workerMtTreeStrategy;}
    get workerMtHybridProfile() {return this.config.workerMtHybridProfile;}
    get workerMtHybridSplitFirst() {return this.config.workerMtHybridSplitFirst;}
    get workerMtHybridJobSorting() {return this.config.workerMtHybridJobSorting;}
    get workerMtHybridSplitGainFilter() {return this.config.workerMtHybridSplitGainFilter;}
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

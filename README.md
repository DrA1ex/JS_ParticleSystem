# Simulation of Gravity / Galaxy Birth simulation
<p align="center">
<img width="480" alt="Simulation gif" src="https://user-images.githubusercontent.com/1194059/193450370-278ae448-c71b-4282-9045-2f8097a3f6cf.gif">
</p>

## N-Body Simulation

The simulation is an N-Body system, where all particles interact with each other. It can be referred to as a galaxy simulation, although certain assumptions are made. The formation of a galaxy is a lengthy process, shaped over millions of years of interactions. Furthermore, the sheer number of particles in a galaxy is so immense that recreating the birth of a galaxy with high accuracy is beyond the capabilities of any computer. However, this simulation provides the opportunity to witness the process on a smaller scale.

_50,000 particles forms a Galaxy-like
image_ (Try it yourself: [#1](https://dra1ex.github.io/JS_ParticleSystem/n_body/?state=../static/galaxy1.json), [#2](https://dra1ex.github.io/JS_ParticleSystem/n_body/?state=../static/galaxy2.json), [#3](https://dra1ex.github.io/JS_ParticleSystem/n_body/?state=../static/galaxy3.json))

[<img height="250" alt="image" src="https://user-images.githubusercontent.com/1194059/194406835-25e8af62-3361-45d9-8e53-836f68ae04b3.png">](https://user-images.githubusercontent.com/1194059/194406257-721f5516-9685-425c-b157-f4f28aa12c64.png) [ <img height="250" alt="image" src="https://user-images.githubusercontent.com/1194059/194406943-f9996d31-2b2d-402f-b50c-6634538a7a5d.png">](https://user-images.githubusercontent.com/1194059/194406416-311b8dfc-857f-458c-8d7c-5cba1cac4636.png) <img height="250" alt="image" src="https://user-images.githubusercontent.com/1194059/193401669-acc131b5-9aa6-4ddb-b2b2-582986dc7320.png"> <img height="250" alt="image" src="https://user-images.githubusercontent.com/1194059/193060048-2f9dd976-e675-42f2-aef1-1f381a807ced.png"> <img height="250" alt="image" src="https://user-images.githubusercontent.com/1194059/193402299-c9728ea3-b29d-4174-a4d1-3930c85cd863.png"> <img height="250" alt="image" src="https://user-images.githubusercontent.com/1194059/193402786-c9d376cf-5170-47e0-974d-c31bd3710558.png"> <img height="250" alt="image" src="https://user-images.githubusercontent.com/1194059/193416793-244cf9ba-1218-455b-abf8-da453f3bc14e.png">

Given the complexity of accurately calculating gravitational interactions, several optimizations have been employed. 
The particles are organized into hierarchical segments, forming a Spatial Tree. Each particle within a segment interacts with every other particle in the same segment, rather than engaging with particles in different segments. Consequently, the segments themselves are treated as larger particles and interact with one another. This approach ensures an acceptable complexity level: _O(N*logN)_, as opposed to the unoptimized _O(N*N)_ approach.

_Visualization of Spatial tree used to optimize 100,000 particles interaction_

<img width="720" alt="image" src="https://user-images.githubusercontent.com/1194059/192269736-64fe4b19-d0bb-4cbc-b0df-591e17191355.png">

You can see Spatial Tree segmentation in real-time with the default CPU backend: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body?particle_count=50000&debug=1&debug_tree=1&segment_random=0)

In practical terms, this means that we can simulate _100,000_ particles using approximately _500,000_ operations. Without optimization, simulating _100,000_ particles would require _10,000,000,000_ operations, which is _20,000_ times more computationally intensive.

_Visualization of 1,000,000 particles (click image to open YouTube video)_

[<img width="720" alt="image" src="https://user-images.githubusercontent.com/1194059/195990061-9fcf8693-faea-4038-80a3-30ccd9158182.png">](https://youtu.be/Gu8Y1t5cblE)

### Demo Links

- Accurate CPU simulation, galaxy-like pattern may born (#1): [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?particle_count=300000&segment_max_count=32&segment_auto=0)
- Accurate CPU simulation, galaxy-like pattern may born (#2): [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?particle_count=250000&segment_max_count=32&segment_auto=0&particle_init=bang)
- Fast CPU simulation (#1): [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?particle_count=60000&particle_init=rotation&g=1000)
- Fast CPU simulation (#2): [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?particle_count=60000&particle_init=collision&g=1000)
- Big CPU multithreaded simulation (#1): [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?backend=worker-mt&worker_threads=4&worker_mt_tree_strategy=hybrid&particle_count=500000&segment_auto=1)
- Big CPU multithreaded simulation (#2): [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?backend=worker-mt&worker_threads=6&worker_mt_tree_strategy=hybrid&particle_count=750000&segment_auto=1)
- Big GPGPU simulation (#1): [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?backend=gpgpu&particle_count=16384&segment_max_count=128&particle_init=uniform&particle_mass=10&g=10)
- Big GPGPU simulation (#2): [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?backend=gpgpu&particle_count=16384&segment_max_count=128&particle_mass=10&g=100)
- Particle collisions CPU (accurate): [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?particle_count=50000&collision=1)
- Particle collisions CPU (fast): [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?particle_count=50000&collision=1&g=10)
- Particle collisions GPGPU (accurate): [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?collision=1&backend=gpgpu&particle_count=16384&segment_max_count=128)
- Particle collisions GPGPU (fast): [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?collision=1&backend=gpgpu&particle_count=16384&segment_max_count=128&g=100)

More links you can find below.

### Simulation Player
You can use [Simulation Player](https://dra1ex.github.io/JS_ParticleSystem/n_body/player) to watch recorded simulations.

_Note:_ Please be patient, files may be very large, so loading may take a while. Pay attention to the package size written in brackets.

_Demo links_:

- 16k particles with `collision=1`: [player](https://dra1ex.github.io/JS_ParticleSystem/n_body/player/?url=https://media.githubusercontent.com/media/DrA1ex/docs_storage/main/JS_ParticleSystem/records/record_collision_16k.bin) / [recorded track (6MB)](https://github.com/DrA1ex/docs_storage/blob/main/JS_ParticleSystem/records/record_collision_16k.bin) / [simulation](https://dra1ex.github.io/JS_ParticleSystem/n_body/?backend=gpgpu&particle_count=16384&segment_max_count=128&collision=1&g=10)
- 65k particles with `collision=1`: [player](https://dra1ex.github.io/JS_ParticleSystem/n_body/player/?url=https://media.githubusercontent.com/media/DrA1ex/docs_storage/main/JS_ParticleSystem/records/record_collision_65k.bin) / [recorded track (72MB)](https://github.com/DrA1ex/docs_storage/blob/516cd347644427ae493f290c8d5f0cf62fb43986/JS_ParticleSystem/records/record_collision_65k.bin) / [simulation](https://dra1ex.github.io/JS_ParticleSystem/n_body/?backend=gpgpu&particle_count=65536&segment_max_count=256&collision=1&min_distance=0.1)
- 128k particles with `g=100`: [player](https://dra1ex.github.io/JS_ParticleSystem/n_body/player/?url=https://media.githubusercontent.com/media/DrA1ex/docs_storage/main/JS_ParticleSystem/records/record_128k.bin) / [recorded track (56MB)](https://github.com/DrA1ex/docs_storage/blob/main/JS_ParticleSystem/records/record_128k.bin) / [simulation](https://dra1ex.github.io/JS_ParticleSystem/n_body/?backend=gpgpu&particle_count=128000&segment_max_count=360&g=100)
- 128k particles with self-collision burst, `collision=1&g=10`: [player](https://dra1ex.github.io/JS_ParticleSystem/n_body/player/?url=https://media.githubusercontent.com/media/DrA1ex/docs_storage/main/JS_ParticleSystem/records/record_128k_self_collisions.bin) / [recorded track (52MB)](https://github.com/DrA1ex/docs_storage/blob/main/JS_ParticleSystem/records/record_128k_self_collisions.bin) / [simulation](https://dra1ex.github.io/JS_ParticleSystem/n_body/?backend=gpgpu&particle_count=129600&segment_max_count=360&g=10&collision=1&min_distance=0.8)


### Real-Time Simulation
You can combine different [parameters](https://github.com/DrA1ex/JS_ParticleSystem#parameters), [renderer](https://github.com/DrA1ex/JS_ParticleSystem#renderer) and [backend](https://github.com/DrA1ex/JS_ParticleSystem#backend).
To change parameter just add it to url as query parameter, e.g.: [`/?particle_count=50000&particle_init=bang`](https://dra1ex.github.io/JS_ParticleSystem/n_body?particle_count=50000&particle_init=bang)

_Collision:_
- Enabled collisions with the default CPU backend: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?particle_count=50000&collision=1)
- Enabled collisions with gpgpu simulation: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?collision=1&backend=gpgpu&particle_count=16384&segment_max_count=128)
- Enabled collisions with gpgpu simulation and `min_distance=3`: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?collision=1&backend=gpgpu&particle_count=16384&segment_max_count=128&min_distance=3)

_Different initializers:_
- circle initializer: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?particle_count=50000&particle_init=circle)
- uniform initializer: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?particle_count=50000&particle_init=uniform)
- bang initializer: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?particle_count=50000&particle_init=bang)
- rotation initializer: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?particle_count=50000&particle_init=rotation)
- collision initializer: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?particle_count=50000&particle_init=collision)
- swirl initializer: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?particle_count=50000&particle_init=swirl)

_Different gravity forces:_
- rotation initializer with `x1000` gravity: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?particle_count=60000&particle_init=rotation&g=1000)
- collision initializer with `x1000` gravity: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?particle_count=60000&particle_init=collision&g=1000)

_Different resistance:_
- bang initializer with `0.99` resistance and `x100` gravity: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?particle_count=50000&particle_init=bang&resistance=0.99&g=100)
- collision initializer with `0.995` resistance and `x100` gravity: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?particle_count=50000&particle_init=collision&resistance=0.995&g=100)

_Particle mass variation:_
- Mass variation `3` and `x0.5` gravity: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?particle_count=50000&particle_mass=3&g=0.5)
- Mass variation `5` with accurate gpgpu simulation: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?particle_mass=5&backend=gpgpu&segment_max_count=64&particle_count=4096)
- Mass vartiation `10` with accurate big gpgpu simulation: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?backend=gpgpu&particle_count=16384&segment_max_count=128&particle_init=uniform&particle_mass=10&g=10)

_Debug mode:_
- Spatial tree with CPU multithreading: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?particle_count=50000&debug=1&debug_tree=1&g=10&dfri=0)
- Speed and momentum vectors: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?particle_count=5&particle_init=rotation&segment_max_count=5&g=200&debug=1&debug_tree=0&debug_velocity=1)


### Renderer
Supported render engines:

##### `Canvas`
Use HTML5 Canvas to render particles. In order to reduce delays, rendering through the ImageBuffer is utilized.
The rendering performs well on mobile platforms but experiences a significant drop in performance at high resolutions.
Furthermore, canvas renderer does not support dynamic particle size, making particles difficult to discern on screens with high pixel density.

_Demo links_:

- With _enabled_ device pixel rate: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?particle_count=50000&render=canvas&dpr=1)
- With _disabled_ device pixel rate: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?particle_count=50000&render=canvas&dpr=0)


##### `webgl2`
Use WebGL 2.0 to render particles. This rendering method effectively displays numerous particles in high resolution.
The render works well on screens with high pixel density and maintains dynamic particle size. However, it may not function on older browser versions and older mobile devices. This rendering technique is highly recommended for screens with high refresh rates due to its fast performance.

_Demo links_:

- With _enabled_ device pixel rate: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?particle_count=100000&render=webgl2&dpr=1)
- With _disabled_ device pixel rate: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?particle_count=100000&render=webgl2&dpr=0)
 
### Backend
Supported backends:

##### `worker-mt`
`worker-mt` is a multithreaded CPU backend. It keeps the same spatial-tree approximation as `worker`, but distributes leaf force solving and particle integration across several subworkers. This backend is useful when the simulation is CPU-bound and the machine has several available cores.

The number of subworkers can be selected with the `worker_threads` parameter. Supported values are `auto`, `2`, `4`, `6`, and `8`. The `auto` mode uses browser hardware concurrency information when available and otherwise falls back to a safe default. In practice, `4` threads is usually a good starting point; higher values can help on some desktops, but may also add scheduling overhead.

The parallel tree scheduler can be tuned with `worker_mt_tree_jobs`. Supported values are `auto`, `16`, `32`, `64`, and `128`. The default `auto` mode is intentionally conservative: it avoids spending too much coordinator time preparing work before subworkers can start.

The tree split strategy can be selected with `worker_mt_tree_strategy`. Supported values are `static`, `dynamic`, `recursive`, and `hybrid`. `dynamic` is the conservative queue-based baseline. `static` is useful as a simple baseline. `recursive` is a legacy experiment that starts from coarse regions and lets subworkers split heavy jobs further, but it can produce a weaker downstream calc/force pipeline. `hybrid` is the recommended high-performance CPU profile: by default it uses the `coarse` hybrid profile, split-first recursive job release, and hybrid job sorting.

Hybrid-specific tuning is available through `worker_mt_hybrid_profile`, `worker_mt_hybrid_split_first`, `worker_mt_hybrid_job_sorting`, and `worker_mt_hybrid_split_gain`. The recommended setting is the default hybrid combination: `coarse`, split-first enabled, job sorting enabled, and split-gain filtering disabled.

This backend is the default CPU backend for `n_body`. It requires `SharedArrayBuffer` and cross-origin isolation for real multithreading. On static hosting, the app can install a local COOP/COEP service worker and automatically reload once so the page becomes cross-origin isolated. If isolation cannot be enabled, the backend falls back to the single-worker path and shows the fallback reason in stats.

_Demos with different worker thread counts_:
- Auto threads, 500k particles: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?backend=worker-mt&worker_threads=auto&worker_mt_tree_strategy=hybrid&particle_count=500000&segment_auto=1)
- 2 threads, 400k particles: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?backend=worker-mt&worker_threads=2&worker_mt_tree_strategy=hybrid&particle_count=400000&segment_auto=1)
- 4 threads, 500k particles: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?backend=worker-mt&worker_threads=4&worker_mt_tree_strategy=hybrid&particle_count=500000&segment_auto=1)
- 6 threads, 750k particles: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?backend=worker-mt&worker_threads=6&worker_mt_tree_strategy=hybrid&particle_count=750000&segment_auto=1)
- 4 threads with 16 tree jobs, 500k particles: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?backend=worker-mt&worker_threads=4&worker_mt_tree_strategy=hybrid&worker_mt_tree_jobs=16&particle_count=500000&segment_auto=1)
- 4 threads with recursive tree splitting, 500k particles: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?backend=worker-mt&worker_threads=4&worker_mt_tree_strategy=recursive&particle_count=500000&segment_auto=1)
- 4 threads with hybrid tree splitting, 500k particles: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?backend=worker-mt&worker_threads=4&worker_mt_tree_strategy=hybrid&particle_count=500000&segment_auto=1)

_Heavier multithreaded demos_:
- 750k particles with 4 threads and hybrid tree jobs: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?backend=worker-mt&worker_threads=4&worker_mt_tree_strategy=hybrid&worker_mt_tree_jobs=auto&particle_count=750000&segment_auto=1)
- 1M particles with 4 threads and hybrid tree jobs: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?backend=worker-mt&worker_threads=4&worker_mt_tree_strategy=hybrid&worker_mt_tree_jobs=auto&particle_count=1000000&segment_auto=0&segment_max_count=40)
- 1M particles with 4 threads and dynamic tree jobs: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?backend=worker-mt&worker_threads=4&worker_mt_tree_strategy=dynamic&worker_mt_tree_jobs=auto&particle_count=1000000&segment_auto=0&segment_max_count=40)
- 1M particles with 4 threads and recursive tree jobs: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?backend=worker-mt&worker_threads=4&worker_mt_tree_strategy=recursive&worker_mt_tree_jobs=auto&particle_count=1000000&segment_auto=0&segment_max_count=40)


##### `worker`
`worker` is the legacy single-threaded CPU backend. It is still useful as a compatibility fallback and as a baseline when comparing the multithreaded scheduler, but it is no longer the recommended CPU path for large real-time demos. Prefer `worker-mt` for normal desktop CPU simulations.

The single-threaded worker keeps physics calculations away from the main rendering thread, so the UI can remain responsive, but all physics work still runs in one worker. For larger N-Body demos this usually becomes the bottleneck much earlier than `worker-mt`.

You can fine-tune the performance by adjusting the `segmentation_max_count` parameter. Decreasing its value reduces the computational complexity but sacrifices the accuracy of the simulation.

_Legacy single-threaded demos with different segment max sizes_:
- Max segment size `8`: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?backend=worker&segment_max_count=8)
- Max segment size `32`: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?backend=worker&segment_max_count=32)
- Max segment size `128`: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?backend=worker&segment_max_count=128)
- Max segment size `256`: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?backend=worker&segment_max_count=256)

Increasing `segmentation_max_count` significantly degrades performance, but improves calculation accuracy.

_Legacy maximum-accuracy single-threaded demos_:
- Max segment size `1024`: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?backend=worker&particle_count=1024&segment_max_count=1024)
- Max segment size `2048`: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?backend=worker&particle_count=2048&segment_max_count=2048)
- Max segment size `4096`: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?backend=worker&particle_count=4096&segment_max_count=4096)


##### `gpgpu`
GPGPU (General-purpose computing on graphics processing units) is employed for calculations in a dedicated worker, utilizing the power of the GPU. The highly parallelized nature of these computations enables significant acceleration, particularly for complex simulation configurations. However, it's worth noting that this method may not be suitable for mobile platforms but delivers excellent results on desktops equipped with discrete graphics cards.

In this calculation method, the `segmentation_max_count` parameter is interpreted as the dimension of the 2D texture, indicating the size of each segment. For example, a value of 128 actually corresponds to a segment size of 16,348 (128 * 128).

This method enables the simulation of gravity with utmost accuracy, accommodating a high volume of particles. However, it exhibits inefficiency and performs worse than the `worker` backend when used with small segment sizes.

_Demos with different segment max sizes_:
- Max segment size `64*64` and `32k` particles: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?backend=gpgpu&particle_count=32768&segment_max_count=64)
- Max segment size `128*128` and `131k` particles: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?backend=gpgpu&particle_count=131072&segment_max_count=128)
- Max segment size `256*256` and `262k` particles: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?backend=gpgpu&particle_count=262144&segment_max_count=256)

Although increasing the `segmentation_max_count` adversely affects GPGPU performance, it facilitates the simulation of a significantly larger number of particles while maintaining maximum accuracy.

_Simulation demo links with maximum accuracy_:
- Max segment size `96*96`: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?backend=gpgpu&particle_count=9216&segment_max_count=96)
- Max segment size `128*128`: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?backend=gpgpu&particle_count=16384&segment_max_count=128)
- Max segment size `176*176`: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?backend=gpgpu&particle_count=30976&segment_max_count=176)
- Max segment size `256*256`: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?backend=gpgpu&particle_count=65536&segment_max_count=256)

### Parameters:
See params description here: [link](./settings.md)

## Limitations:
Application originally developed and optimized for Chrome browser. In other browsers app can have significant performance degradation.

### Known issues
- Due to lack of [WebWorker modules](https://caniuse.com/mdn-api_worker_worker_ecmascript_modules) the simulation may not work in Firefox.
- Due to lack of [OffscreenCanvas](https://caniuse.com/offscreencanvas) GPGPU backend may not be available in Safari/Firefox.


### Worker MT hybrid tree strategy

`hybrid` is the recommended high-performance tree scheduler for `worker-mt`:

```text
/n_body/?backend=worker-mt&worker_threads=4&worker_mt_tree_strategy=hybrid
```

The current recommended hybrid profile is `coarse` with split-first job release and hybrid job sorting enabled. This keeps coordinator-side tree preparation low, returns recursively spawned jobs to the coordinator early, and sorts hybrid jobs with a tail-oriented estimate. The split-gain filter is kept as an experimental option and is disabled by default.

Recommended comparison links:

```text
/n_body/?backend=worker-mt&worker_threads=4&worker_mt_tree_strategy=hybrid&worker_mt_hybrid_profile=coarse&particle_count=1000000&segment_auto=0&segment_max_count=40
/n_body/?backend=worker-mt&worker_threads=4&worker_mt_tree_strategy=dynamic&particle_count=1000000&segment_auto=0&segment_max_count=40
/n_body/?backend=worker-mt&worker_threads=4&worker_mt_tree_strategy=recursive&particle_count=1000000&segment_auto=0&segment_max_count=40
```

Hybrid comparison toggles:

```text
worker_mt_hybrid_split_first=1
worker_mt_hybrid_job_sorting=1
worker_mt_hybrid_split_gain=0
```

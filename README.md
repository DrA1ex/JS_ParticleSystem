# Simulation of Gravity / Galaxy Birth simulation
<p align="center">
<img width="480" alt="Simulation gif" src="https://user-images.githubusercontent.com/1194059/193450370-278ae448-c71b-4282-9045-2f8097a3f6cf.gif">
</p>

## N-Body Simulation

The simulation is an N-Body system, where all particles interact with each other. It can be referred to as a galaxy simulation, although certain assumptions are made. The formation of a galaxy is a lengthy process, shaped over millions of years of interactions. Furthermore, the sheer number of particles in a galaxy is so immense that recreating the birth of a galaxy with high accuracy is beyond the capabilities of any computer. However, this simulation provides the opportunity to witness the process on a smaller scale.

_50,000 particles forms a Galaxy-like
image_ (Try it yourself: [#1](https://dra1ex.github.io/JS_ParticleSystem/n_body/?state=../static/galaxy1.json), [#2](https://dra1ex.github.io/JS_ParticleSystem/n_body/?state=../static/galaxy2.json), [#3](https://dra1ex.github.io/JS_ParticleSystem/n_body/?state=../static/galaxy3.json))

Imported universe state files restore the particle data and saved universe parameters without rewriting the current URL. Runtime choices such as backend, worker count, renderer, debug options and performance tuning remain unchanged unless they are part of the imported state.
Large local exports use the binary `.nbody` format: a compact JSON header followed by the raw interleaved Float32 particle buffer. This avoids the memory and string-size limits of JSON exports with tens of millions of particles. Legacy JSON state files remain importable.

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
- Big CPU multithreaded simulation (#1): [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?backend=worker-mt&worker_threads=4&particle_count=500000&segment_auto=1)
- Big CPU multithreaded simulation (#2): [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?backend=worker-mt&worker_threads=6&particle_count=750000&segment_auto=1)
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
Collision impulses use a configurable dense-contact response: `collision_contacts=balanced` (default) uses RMS-style normalization, `average` is calmer, and `full` keeps the complete multi-contact sum. `collision_separation` adds a small penetration-depth bias so overlapping or resting particles can move apart instead of sticking. `collision_cap` limits only pathological full sums, while `collision_micro=0` keeps tiny bounce impulses active.
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
`worker-mt` is the default and recommended CPU backend. It uses one production pipeline rather than exposing the historical scheduler experiments:

- four root seed regions are prepared in parallel;
- heavy regions are split recursively and returned to a globally sorted queue;
- exact interactions inside leaves use the symmetric pair kernel, evaluating every pair once;
- `SharedArrayBuffer` keeps particle and tree-index data shared between workers.

The only worker-specific tuning exposed to users is `worker_threads`. `auto` keeps one logical processor available for the coordinator/main thread and selects the nearest supported worker count. The effective leaf size can be controlled with `segment_max_count` or selected automatically with `segment_auto=1`.

Real multithreading requires cross-origin isolation and `SharedArrayBuffer`. On static hosting, the app can install a local COOP/COEP service worker and reload once. If isolation is unavailable, `worker-mt` falls back to its single-threaded path.

_Demos with different worker counts_:
- Auto threads, 500k particles: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?backend=worker-mt&worker_threads=auto&particle_count=500000&segment_auto=1)
- 4 threads, 500k particles: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?backend=worker-mt&worker_threads=4&particle_count=500000&segment_auto=1)
- 8 threads, 1M particles: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?backend=worker-mt&worker_threads=8&particle_count=1000000&segment_auto=1)
- 12 threads, 1M particles: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?backend=worker-mt&worker_threads=12&particle_count=1000000&segment_auto=1)
- 16 threads, 2M particles: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?backend=worker-mt&worker_threads=16&particle_count=2000000&segment_auto=1)
- 20 threads, 3M particles: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?backend=worker-mt&worker_threads=20&particle_count=3000000&segment_auto=1)

_Heavier multithreaded demos_:
- 750k particles with 4 threads: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?backend=worker-mt&worker_threads=4&particle_count=750000&segment_auto=1)
- 1M particles with 4 threads and fixed leaf size: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?backend=worker-mt&worker_threads=4&particle_count=1000000&segment_auto=0&segment_max_count=40)

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


### Worker MT production pipeline

The historical `static`, `dynamic`, `recursive` and configurable `hybrid` variants have been consolidated into one tested worker-mt pipeline. The implementation always uses shallow parallel seed bootstrap, split-first recursive work release, tail-oriented queue sorting and symmetric leaf-force evaluation. These details remain visible in performance reports, but they are no longer user-selectable settings.

`segment_random` remains available because randomized split positions soften persistent grid-aligned artifacts caused by the spatial-tree approximation. Set it to `0` when you need clearly visible deterministic segmentation for debugging.

### Reproducible performance benchmark suites

The browser console exposes `window.nBodyRunBenchmark(...)` for comparing settings against the exact same live universe state. The runner captures one in-memory particle snapshot at the start, restores it before every case, restarts the physics pipeline, waits for warm-up physics steps and a stabilization delay, and then calls the regular performance report collector.

Object-form `cases` creates the Cartesian product of array values. Scalar values are applied to every generated case:

```js
await window.nBodyRunBenchmark({
  name: "heavy-tree-grid",
  cases: {
    worker_threads: [12, 16, 20],
    segment_max_count: [24, 32, 48]
  },
  warmupSteps: 3,
  stabilizationMs: 500,
  report: {
    frames: 240,
    blocks: 4,
    intervalMs: 5000
  }
})
```

Array-form `cases` runs only the explicitly listed combinations:

```js
await window.nBodyRunBenchmark({
  name: "selected-cases",
  cases: [
    {
      name: "baseline",
      worker_threads: 16,
      segment_max_count: 32
    },
    {
      name: "lower-leaf-size",
      worker_threads: 16,
      segment_max_count: 24
    }
  ]
})
```

Setting keys can use URL/query names such as `worker_threads`, JavaScript property names such as `workerThreads`, or full paths such as `simulation.workerThreads`. Settings that require a page reload or change the captured particle universe are rejected before the suite starts.

The runner downloads one ZIP containing:

```text
manifest.json
config.json
summary.json
summary.csv
cases/*.json
reports/*.json
```

The original snapshot and settings are restored after the suite by default. Use `window.nBodyCancelBenchmark()` to stop a running suite and `window.nBodyBenchmarkHelp()` for console examples.

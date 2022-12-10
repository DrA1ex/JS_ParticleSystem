# Simulation of Gravity / Galaxy Birth simulation

[<img width="480" alt="Simulation gif" src="https://user-images.githubusercontent.com/1194059/193450370-278ae448-c71b-4282-9045-2f8097a3f6cf.gif">](https://user-images.githubusercontent.com/1194059/193450143-20287770-4cfe-4665-99cf-6c78dbcfe32b.png) 

## N-Body Simulation

Simulation is N-Body, means all particles interacts with each other. This is what can be called a galaxy
simulation. Of course, with some assumptions! The formation of a galaxy is a long process, the beauty of which was
formed by millions of years of interactions. Moreover, the number of particles in a galaxy is so large that no computer
could recreate the birth of a galaxy with high accuracy. But this simulation will allow you to enjoy the process on a
small scale.

_50,000 particles forms a Galaxy-like
image_ (Try it yourself: [#1](https://dra1ex.github.io/JS_ParticleSystem/n_body/?state=../static/galaxy1.json), [#2](https://dra1ex.github.io/JS_ParticleSystem/n_body/?state=../static/galaxy2.json), [#3](https://dra1ex.github.io/JS_ParticleSystem/n_body/?state=../static/galaxy3.json))

[<img height="250" alt="image" src="https://user-images.githubusercontent.com/1194059/194406835-25e8af62-3361-45d9-8e53-836f68ae04b3.png">](https://user-images.githubusercontent.com/1194059/194406257-721f5516-9685-425c-b157-f4f28aa12c64.png) [ <img height="250" alt="image" src="https://user-images.githubusercontent.com/1194059/194406943-f9996d31-2b2d-402f-b50c-6634538a7a5d.png">](https://user-images.githubusercontent.com/1194059/194406416-311b8dfc-857f-458c-8d7c-5cba1cac4636.png) <img height="250" alt="image" src="https://user-images.githubusercontent.com/1194059/193401669-acc131b5-9aa6-4ddb-b2b2-582986dc7320.png"> <img height="250" alt="image" src="https://user-images.githubusercontent.com/1194059/193060048-2f9dd976-e675-42f2-aef1-1f381a807ced.png"> <img height="250" alt="image" src="https://user-images.githubusercontent.com/1194059/193402299-c9728ea3-b29d-4174-a4d1-3930c85cd863.png"> <img height="250" alt="image" src="https://user-images.githubusercontent.com/1194059/193402786-c9d376cf-5170-47e0-974d-c31bd3710558.png"> <img height="250" alt="image" src="https://user-images.githubusercontent.com/1194059/193416793-244cf9ba-1218-455b-abf8-da453f3bc14e.png">

Since an accurate calculation of the gravitational interaction would be too difficult, some optimizations were used. All
particles are divided into hierarchical segments, thus creating a Spatial Tree.

Each particle in a segment interacts with each other, but not with particles in other segments. Instead, the segments
themselves are perceived as large particles and interact with each other. This allows us to achieve an acceptable
complexity: _O(N*logN)_ instead of unoptimized _O(N*N)_.

_Visualization of Spatial tree used to optimize 100,000 particles interaction_

<img width="720" alt="image" src="https://user-images.githubusercontent.com/1194059/192269736-64fe4b19-d0bb-4cbc-b0df-591e17191355.png">

You can see Spatial Tree segmentation in real-time: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body?debug=1&segment_random=0)

This means that we can simulate _100,000_ particles in just about _500,000_ operations. Without optimization, _100,000_
particles would require _10,000,000,000_ operations (_20,000_ times more)

_Visualization of 1,000,000 particles (click image to open YouTube video)_

[<img width="720" alt="image" src="https://user-images.githubusercontent.com/1194059/195990061-9fcf8693-faea-4038-80a3-30ccd9158182.png">](https://youtu.be/Gu8Y1t5cblE)


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
To change parameter just add it to url as query parameter, e.g.: [`/?particle_count=10000&particle_init=bang`](https://dra1ex.github.io/JS_ParticleSystem/n_body?particle_count=10000&particle_init=bang)

_Collision:_
- Enabled collisions: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?collision=1)
- Enabled collisions with gpgpu simulation: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?collision=1&backend=gpgpu&particle_count=16384&segment_max_count=128)
- Enabled collisions with gpgpu simulation and `min_distance=3`: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?collision=1&backend=gpgpu&particle_count=16384&segment_max_count=128&min_distance=3)

_Different initializers:_
- circle initializer: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?particle_init=circle)
- uniform initializer: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?particle_init=uniform)
- bang initializer: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?particle_init=bang)
- rotation initializer: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?particle_init=rotation)
- collision initializer: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?particle_init=collision)
- swirl initializer: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?particle_init=swirl)

_Different gravity forces:_
- rotation initializer with `x1000` gravity: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?particle_init=rotation&g=1000)
- collision initializer with `x1000` gravity: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?particle_init=collision&g=1000)

_Different resistance:_
- bang initializer with `0.99` resistance and `x100` gravity: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?particle_init=bang&resistance=0.99&g=100)
- collision initializer with `0.995` resistance and `x100` gravity: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?particle_init=collision&resistance=0.995&g=100)

_Particle mass variation:_
- Mass variation `3` and `x0.5` gravity: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?particle_mass=3&g=0.5)
- Mass variation `5` with accurate gpgpu simulation: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?particle_mass=5&backend=gpgpu&segment_max_count=64&particle_count=4096)
- Mass vartiation `10` with accurate big gpgpu simulation: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?backend=gpgpu&particle_count=16384&segment_max_count=128&particle_init=uniform&particle_mass=10&g=10)

_Debug mode:_
- Spatial tree: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?debug=1&debug_tree=1&g=10&dfri=0)
- Speed and momentum vectors: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?particle_count=5&particle_init=rotation&segment_max_count=5&g=200&debug=1&debug_tree=0&debug_velocity=1)


### Renderer
Supported render engines:
##### `сanvas`
Use HMTL5 Canvas to render particles. In order to reduce the delay, rendering through the ImageBuffer is used. 
The render performs well on mobile platforms, but loses a lot in performance at high resolutions.
Also, Canvas does not support dynamic particle size, so particles can be difficult to see on screens with a high pixel density.

_Demo links_:

- With _enabled_ device pixel rate: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?render=canvas&dpr=1)
- With _disabled_ device pixel rate: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?render=canvas&dpr=0)


##### `webgl2`
Use WebGL 2.0 to render particles. This rendering method allows to effectively display many particles in high resolution.
Render works well on screens with high pixel density and maintain dynamic particle size. May not work on older browser versions and on older mobile devices. Rendering is very fast, so this render type is recommended for screens with high refresh rates.

_Demo links_:

- With _enabled_ device pixel rate: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?render=webgl2&dpr=1)
- With _disabled_ device pixel rate: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?render=webgl2&dpr=0)
 
### Backend
Supported backends:

##### `worker`
A web worker is used to calculate physics. All calculations are done separately from the main thread, so even with heavy simulation configurations, rendering will still be at a high frame rate. This method of calculation is well suited for mobile platforms or systems with basic integrated graphics.
The calculation is done entirely by the CPU, so don't expect high performance in tasks like N-Body simulation.
Performance can be influenced through the `segmentation_max_count` parameter. Decreasing the value also reduces the computational complexity, but degrades the accuracy of the simulation.

_Demos with different segment max sizes_:
- Max segment size `8`: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?backend=worker&segment_max_count=8)
- Max segment size `32`: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?backend=worker&segment_max_count=32)
- Max segment size `128`: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?backend=worker&segment_max_count=128)
- Max segment size `256`: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?backend=worker&segment_max_count=256)

Increasing `segmentation_max_count` significantly degrades performance, but improves calculation accuracy.

_Simulation demo links with maximum accuracy_:
- Max segment size `1024`: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?backend=worker&particle_count=1024&segment_max_count=1024)
- Max segment size `2048`: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?backend=worker&particle_count=2048&segment_max_count=2048)
- Max segment size `4096`: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?backend=worker&particle_count=4096&segment_max_count=4096)


##### `gpgpu`
GPGPU is used for calculation (General-purpose computing on graphics processing units). All calculations are performed in a separate worker, but on the GPU. Due to the high parallelization of calculations, it is possible to achieve significant acceleration for complex simulation configurations. This method most likely will not work on mobile platforms, but it will work well on desktops with discrete graphics cards.
In this calculation method, `segmentation_max_count` parameter is interpreted as the size of the side of the 2D texture, i.e. value 128 actually means `128*128=16348` segment size. This method allows to simulate gravity with maximum accuracy and with a large number of particles.
Unfortunately, on small segment sizes, the method works inefficiently and works worse than `worker` backend.

_Demos with different segment max sizes_:
- Max segment size `64*64` and `32k` particles: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?backend=gpgpu&particle_count=32768&segment_max_count=64)
- Max segment size `128*128` and `131k` particles: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?backend=gpgpu&particle_count=131072&segment_max_count=128)
- Max segment size `256*256` and `262k` particles: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?backend=gpgpu&particle_count=262144&segment_max_count=256)

Increasing `segmentation_max_count` also degrades performance for GPGPU, but allows to simulate much more particles with max accuracy.

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
- Due to lack of [WebWorker modules](https://caniuse.com/mdn-api_worker_worker_ecmascript_modules) simulation doesn't work in Firefox.
- Due to lack of [OffscreenCanvas](https://caniuse.com/offscreencanvas) GPGPU backend doesn't work in Safari/Firefox.

# Simulation of Galaxy Birth (Classical mechanics simulation)

[<img width="480" alt="Simulation gif" src="https://user-images.githubusercontent.com/1194059/193450370-278ae448-c71b-4282-9045-2f8097a3f6cf.gif">](https://user-images.githubusercontent.com/1194059/193450143-20287770-4cfe-4665-99cf-6c78dbcfe32b.png) 

## N-Body Simulation

This is a N-Body simulation, means all particles interacts with each other. This is what can be called a galaxy
simulation. Of course, with some assumptions! The formation of a galaxy is a long process, the beauty of which was
formed by millions of years of interactions. Moreover, the number of particles in a galaxy is so large that no computer
could recreate the birth of a galaxy with high accuracy. But this simulation will allow you to enjoy the process on a
small scale.

_50,000 particles forms a Galaxy-like
image_ (Try it yourself: [#1](https://dra1ex.github.io/JS_ParticleSystem/n_body/?state=../static/galaxy1.json), [#2](https://dra1ex.github.io/JS_ParticleSystem/n_body/?state=../static/galaxy2.json), [#3](https://dra1ex.github.io/JS_ParticleSystem/n_body/?state=../static/galaxy3.json))

<img height="250" alt="image" src="https://user-images.githubusercontent.com/1194059/193401669-acc131b5-9aa6-4ddb-b2b2-582986dc7320.png"> <img height="250" alt="image" src="https://user-images.githubusercontent.com/1194059/193060048-2f9dd976-e675-42f2-aef1-1f381a807ced.png"> <img height="250" alt="image" src="https://user-images.githubusercontent.com/1194059/193402299-c9728ea3-b29d-4174-a4d1-3930c85cd863.png"> <img height="250" alt="image" src="https://user-images.githubusercontent.com/1194059/193402786-c9d376cf-5170-47e0-974d-c31bd3710558.png"> <img height="250" alt="image" src="https://user-images.githubusercontent.com/1194059/193416793-244cf9ba-1218-455b-abf8-da453f3bc14e.png">  <img height="250" alt="image" src="https://user-images.githubusercontent.com/1194059/193448692-4b9f5cd5-cd43-4bb8-8c93-2809b5666e98.png">

Since an accurate calculation of the gravitational interaction would be too difficult, some optimizations were used. All
particles are divided into hierarchical segments, thus creating a Spatial Tree.

Each particle in a segment interacts with each other, but not with particles in other segments. Instead, the segments
themselves are perceived as large particles and interact with each other. This allows us to achieve an acceptable
complexity: _O(N*logN)_ instead of unoptimized _O(N*N)_.

_Visualization of Spatial tree used to optimize 100,000 particles interaction_

<img width="720" alt="image" src="https://user-images.githubusercontent.com/1194059/192269736-64fe4b19-d0bb-4cbc-b0df-591e17191355.png">

You can see Spatial Tree segmentation in real-time: https://dra1ex.github.io/JS_ParticleSystem/n_body?debug=1

This means that we can simulate _100,000_ particles in just about _500,000_ operations. Without optimization, _100,000_
particles would require _10,000,000,000_ operations (_20,000_ times more)

_Visualization of 500,000 particles (click image to open YouTube video)_

[<img width="720" alt="image" src="https://user-images.githubusercontent.com/1194059/192136192-65606492-466a-40fe-9274-204b1b446349.png">](https://youtu.be/kHLjrGTBi-o)

Real-time in-browser demo: https://dra1ex.github.io/JS_ParticleSystem/n_body

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
- Max segment size `256*256` and `262k particles: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?backend=gpgpu&particle_count=262144&segment_max_count=256)

Increasing `segmentation_max_count` also degrades performance for GPGPU, but allows to simulate much more particles with max accuracy.

_Simulation demo links with maximum accuracy_:
- Max segment size `96*96`: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?backend=gpgpu&particle_count=9216&segment_max_count=96)
- Max segment size `128*128`: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?backend=gpgpu&particle_count=16384&segment_max_count=128)
- Max segment size `176*176`: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?backend=gpgpu&particle_count=30976&segment_max_count=176)
- Max segment size `256*256`: [link](https://dra1ex.github.io/JS_ParticleSystem/n_body/?backend=gpgpu&particle_count=65536&segment_max_count=256)

### Parameters:

- *particle_count* - Count of particles to simulate (default: __10000__ for mobile, __20000__ for desktop)
- *particle_init* - Particle initialization, values: __circle__, __disk__, __bang__, __uniform__, __rotation__, __collision__ (default: __circle__)
- *segment_divider* - Spatial subdivision factor while segmentation (default: __2__)
- *segment_max_count* - Max particle count in segment, larger values increase accuracy (default: __32__)
- *g* - Attraction force (default: __1__)
- *particle_mass* - Particle mass variance (default: __0__)
- *min_distance* - Minimal distance (pixels) to process interactions (default: __0.01__)
- *resistance* - Resistance of environment, *1* - means no resistance (default: __1__)
- *render* - Configure renderer type: __canvas__, __webgl2__ (default: __canvas__ for mobile, __webgl__ for desktop)
- *backend* - Configure physics backend: __worker__, __gpgpu__ (default: __worker__)
- *dpr* - Enable drawing according to Device Pixel Ratio (default: __0__)
- *dpr_rate* - Custom Device Pixel Ratio, *0* - means use default (default: __0__)
- *dfri* - Enable Dynamic Frame Rate Interpolation (boosts framerate) (default: __1__)
- *dfri_max* - Max frames to interpolate (default: __120__)
- *buffers* - How many physics frames will be requested ahead of time (default: __3__)
- *filter* - Makes particle brighter and change color over time (default: __0__)
- *blend* - Enable color blending (default: __1__)
- *stats* - Display statistics (default: __1__)
- *debug* - Debug mode (default: __0__)
- *debug_tree* - Draw tree segments (default: __1__)
- *debug_velocity* - Draw particles velocity vector (default: __0__)
- *debug_force* - Draw particles moment force vector (default: __0__)
- *state* - Url to exported system state (default: __none__)


# 1-Body Simulation

This is not a something like simulation of a galaxy, since in a galaxy all bodies interact with each other. The
simulation roughly visualizes how ultralight bodies would interact with one supermassive body.

The advantage of this type of simulation is the simplicity of calculations: O(N^2). Because only one body actually
attracts all the particles we can simulate hundreds of thousands of particles in the browser in real time.

For a real N-Body simulation, it would be necessary to calculate the interaction of each particle with each other. For
1000 particles this would require 1,000,000 operations.

But with some optimization it is achievable! See implementation of N-Body simulation in the next section.

_1-Body Visualization frame with 1,000,000 particles_

<img width="1080" alt="image" src="https://user-images.githubusercontent.com/1194059/192269216-d1ed71f0-a3cb-48cc-9d3f-33126291c91e.png">

Demo: https://dra1ex.github.io/JS_ParticleSystem/

### Parameters:

- *particle_count* - Count of particles to simulate (default: __100000__ for mobile, __200000__ for desktop)
- *fps* - Refresh rate in frames per second (default: __60__)
- *dpr* - Enable drawing according to Device Pixel Ratio (default: __0__)
- *g* - Attraction force of mouse pointer (default: __9__)
- *resistance* - Resistance of environment, *1* - means no resistance (default: __0.99__)

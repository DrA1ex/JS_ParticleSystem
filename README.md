# Simulation of Galaxy Birth (Classical mechanics simulation)

[<img width="480" alt="Simulation gif" src="https://user-images.githubusercontent.com/1194059/193450370-278ae448-c71b-4282-9045-2f8097a3f6cf.gif">](https://user-images.githubusercontent.com/1194059/193450143-20287770-4cfe-4665-99cf-6c78dbcfe32b.png) 

## N-Body Simulation

This is a N-Body simulation, means all particles interacts with each other. This is what can be called a galaxy
simulation. Of course, with some assumptions! The formation of a galaxy is a long process, the beauty of which was
formed by millions of years of interactions. Moreover, the number of particles in a galaxy is so large that no computer
could recreate the birth of a galaxy with high accuracy. But this simulation will allow you to enjoy the process on a
small scale.

_50,000 particles forms a Galaxy-like
image_ ([Try it yourself](https://dra1ex.github.io/JS_ParticleSystem/n_body/?state=../static/galaxy1.json))

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

### Parameters:

- *particle_count* - Count of particles to simulate (default: __10000__ for mobile, __20000__ for desktop)
- *particle_init* - Particle initialization, values: __circle__, __disk__, __bang__, __uniform__, __rotation__, __collision__ (default: __circle__)
- *segment_divider* - Spatial subdivision factor while segmentation (default: __2__)
- *segment_max_count* - Max particle count in segment, larger values increase accuracy (default: __32__)
- *g* - Attraction force (default: __1__)
- *particle_mass* - Particle mass variance (default: __0__)
- *min_distance* - Minimal distance (pixels) to process interactions (default: __10__)
- *resistance* - Resistance of environment, *1* - means no resistance (default: __1__)
- *render* - Configure renderer type: __canvas__, __webgl2__ (default: __canvas__ for mobile, __webgl__ for desktop)
- *dpr* - Enable drawing according to Device Pixel Ratio (default: __0__)
- *dpr_rate* - Custom Device Pixel Ratio, *0* - means use default (default: __0__)
- *dfri* - Enable Dynamic Frame Rate Interpolation (boosts framerate) (default: __1__)
- *dfri_max* - Max frames to interpolate (default: __120__)
- *buffers* - How many physics frames will be requested ahead of time (default: __3__)
- *filter* - Makes particle brighter and change color over time (default: __0__)
- *blend* - Enable color blending (default: __1__)
- *stats* - Display statistics (default: __1__)
- *debug* - Debug mode (default: __0__)
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

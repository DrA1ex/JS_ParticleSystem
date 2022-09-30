# Newtons's Gravity Law simulation

<img width="640" alt="Simulation gif" src="https://user-images.githubusercontent.com/1194059/192136681-ccd9e0e9-1395-48f5-a2fe-9851505dbf9c.gif">

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
- *g* - Attraction force of mouse pointer (default: __9__)
- *resistance* - Resistance of environment, *1* - means no resistance (default: __0.99__)

## N-Body Simulation

This is a N-Body simulation, means all particles interacts with each other. This is what can be called a galaxy
simulation. Of course, with some assumptions! The formation of a galaxy is a long process, the beauty of which was
formed by millions of years of interactions. Moreover, the number of particles in a galaxy is so large that no computer
could recreate the birth of a galaxy with high accuracy. But this simulation will allow you to enjoy the process on a
small scale.

_50,000 particles forms a Galaxy-like
image_ ([demo](https://dra1ex.github.io/JS_ParticleSystem/n_body?particle_count=50000&dpr=1&particle_init=bang&blend=1))

<img width="691" alt="image" src="https://user-images.githubusercontent.com/1194059/193060048-2f9dd976-e675-42f2-aef1-1f381a807ced.png">


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


<img width="1080" alt="image" src="https://user-images.githubusercontent.com/1194059/192136192-65606492-466a-40fe-9274-204b1b446349.png">

Real-time in-browser demo: https://dra1ex.github.io/JS_ParticleSystem/n_body

### Parameters:

- *particle_count* - Count of particles to simulate (default: __10000__ for mobile, __20000__ for desktop)
- *particle_init* - Particle initialization, values: __circle__, __disk__, __bang__, __uniform__ (default: __circle__)
- *segment_divider* - Spatial subdivision factor while segmentation (default: __2__)
- *segment_max_count* - Max particle count in segment, larger values increase accuracy (default: __32__)
- *g* - Attraction force (default: __1__)
- *min_distance* - Minimal distance (pixels) to process interactions (default: __10__)
- *resistance* - Resistance of environment, *1* - means no resistance (default: __1__)
- *fps* - Refresh rate in frames per second (default: __60__)
- *dpr* - Enable drawing according to Device Pixel Ratio (default: __0__)
- *dfri* - Enable Dynamic Frame Rate Interpolation (boosts framerate) (default: __1__)
- *dfri_max* - Max frames to interpolate (default: __120__)
- *buffers* - How many physics frames will be requested ahead of time (default: __2__)
- *filter* - Makes particle brighter and change color over time (default: __0__)
- *blend* - Enable color blending (default: __0__)
- *stats* - Display statistics (default: __1__)
- *debug* - Debug mode (default: __0__)

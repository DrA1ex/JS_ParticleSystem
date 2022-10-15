# 1-Body Simulation

This is not a something like simulation of a galaxy, since in a galaxy all bodies interact with each other. The
simulation roughly visualizes how ultralight bodies would interact with one supermassive body.

The advantage of this type of simulation is the simplicity of calculations: O(N^2). Because only one body actually
attracts all the particles we can simulate hundreds of thousands of particles in the browser in real time.

For a real N-Body simulation, it would be necessary to calculate the interaction of each particle with each other. For
1000 particles this would require 1,000,000 operations.

But with some optimization it is achievable! See implementation of [N-Body simulation](/README.md).

_1-Body Visualization frame with 1,000,000 particles_

<img width="1080" alt="image" src="https://user-images.githubusercontent.com/1194059/192269216-d1ed71f0-a3cb-48cc-9d3f-33126291c91e.png">

Demo: https://dra1ex.github.io/JS_ParticleSystem/

### Parameters:

- *particle_count* - Count of particles to simulate (default: __100000__ for mobile, __200000__ for desktop)
- *fps* - Refresh rate in frames per second (default: __60__)
- *dpr* - Enable drawing according to Device Pixel Ratio (default: __0__)
- *g* - Attraction force of mouse pointer (default: __9__)
- *resistance* - Resistance of environment, *1* - means no resistance (default: __0.99__)

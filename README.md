# Newtons's Gravity Law simulation
This is a JS implementation of Newton's Gravity Law simulation.

<img width="1328" alt="image" src="https://user-images.githubusercontent.com/1194059/191757118-01e26a70-922e-4599-9fda-abb854d25d16.png">


1-Body demo: https://dra1ex.github.io/JS_ParticleSystem/
N-Body demo: https://dra1ex.github.io/JS_ParticleSystem/n_body

## Parameters:
- *particle_count* - Count of particles to simulate (default: __100000__ for mobile, __200000__ for desktop, __tenth__ for n-body)
- *fps* - Refresh rate in frames per second (default: __60__)
- *g* - Attraction force of mouse pointer (default: __9__, n-body: __1__)
- *resistance* - Resistance of environment, *1* - means no resistance (default: __0.99__, , n-body: __0.999__)
- *mouse* - Enable mouse interaction, only for n-body (default: __0__)

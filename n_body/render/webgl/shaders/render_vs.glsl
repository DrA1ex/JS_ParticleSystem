#version 300 es

uniform vec2 resolution;
uniform vec2 offset;
uniform float scale;
uniform float point_size;
uniform float max_mass;
uniform float max_speed;
uniform float particle_scale;
uniform float interpolation_factor;

in vec2 position;
#if USE_INTERPOLATION
in vec2 next_position;
#endif
#if defined(COLOR_MODE_VELOCITY)
in vec2 velocity;
in float mass;
#elif defined(COLOR_MODE_MASS)
in float mass;
#endif

out vec3 color;

void main() {
#if USE_INTERPOLATION
    vec2 render_position = mix(position, next_position, interpolation_factor);
#else
    vec2 render_position = position;
#endif
    vec2 translated_pos = ((render_position * scale + offset) / resolution * 2.0 - 1.0);
    gl_Position = vec4(translated_pos * vec2(1, -1.0), 0, 1);

    gl_PointSize = point_size;
#if defined(COLOR_MODE_VELOCITY) || defined(COLOR_MODE_MASS)
    if (max_mass > 1.0) {
        gl_PointSize += 2.0 * mass / max_mass;
    }
#endif
    gl_PointSize *= particle_scale;

#if defined(COLOR_MODE_VELOCITY)
    vec2 translated_velocity = 0.5 + velocity / max_speed * 0.5;
    float translated_mass = 0.25 + mass / max_mass * 0.25;
    color = vec3(translated_velocity.x, translated_mass, translated_velocity.y);
#elif defined(COLOR_MODE_MASS)
    float translated_mass = 0.25 + mass / max_mass * 0.75;
    color = vec3(translated_mass);
#else
    color = vec3(0.8, 0.9, 1.0);
#endif
}

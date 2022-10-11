#version 300 es

uniform vec2 resolution;
uniform vec2 offset;
uniform float scale;
uniform float point_size;
uniform float max_mass;
uniform float max_speed;

in vec2 position;
in vec2 velocity;
in float mass;

out vec3 color;

void main() {
    vec2 translated_pos = ((position * scale + offset) / resolution * 2.0 - 1.0);
    gl_Position = vec4(translated_pos * vec2(1, -1.0), 0, 1);

    float speed = 2.0 * max(abs(velocity.x), abs(velocity.y)) / max_speed;

    gl_PointSize = point_size + speed;
    if (max_mass > 1.0) {
        gl_PointSize += 2.0 * mass / max_mass;
    }

    vec2 translated_velocity = 0.5 + velocity / max_speed * 0.5;
    float translated_mass = 0.25 + mass / max_mass * 0.25;
    color = vec3(translated_velocity.x, translated_mass, translated_velocity.y);
}
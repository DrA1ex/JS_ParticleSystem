#version 300 es

uniform mat4 projection;
uniform float point_size;
uniform float max_mass;
uniform float max_speed;

in vec4 position;
in vec3 velocity;
in float mass;

out vec3 color;

void main() {
    gl_Position = projection * position;

    float speed = 2.0 * max(max(abs(velocity.x), abs(velocity.y)), abs(velocity.z)) / max_speed;

    if (max_mass > 1.0) {
        gl_PointSize = point_size + mass / (max_mass / 2.0 + 1.0) + speed;
    } else {
        gl_PointSize = point_size * mass + speed;
    }

    vec3 translated_velocity = 0.5 + velocity / max_speed * 0.5;
    float translated_mass = 0.25 + mass / max_mass * 0.25;
    color = vec3(translated_velocity.x, translated_mass, translated_velocity.y);
}
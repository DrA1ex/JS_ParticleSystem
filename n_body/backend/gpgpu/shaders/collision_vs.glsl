#version 300 es

precision highp float;
precision highp int;

uniform float min_dist_square;
uniform int count;
uniform float restitution;
uniform int average_contacts;
uniform int limit_impulse;
uniform int ignore_micro;

uniform sampler2D particle_pos_mass_tex;
uniform sampler2D particle_velocity_tex;

in vec2 position;
in vec2 velocity;
in float mass;
in float index;

out vec2 out_velocity;

void main() {
    ivec2 dimensions = textureSize(particle_pos_mass_tex, 0);
    highp int p_index = int(index);
    vec2 velocity_delta = vec2(0.0);
    int contact_count = 0;
    float max_closing_speed_square = 0.0;
    float min_distance_square = max(1e-12, min_dist_square * 1e-10);

    for (int i = 0; i < count; ++i) {
        if (i == p_index) continue;

        ivec2 tex_index = ivec2(i % dimensions.x, i / dimensions.x);
        vec3 other = texelFetch(particle_pos_mass_tex, tex_index, 0).xyz;
        vec2 other_velocity = texelFetch(particle_velocity_tex, tex_index, 0).xy;
        vec2 delta_pos = position - other.xy;
        float dist_square = dot(delta_pos, delta_pos);
        if (dist_square <= min_distance_square || dist_square >= min_dist_square) continue;

        float relative_dot = dot(velocity - other_velocity, delta_pos);
        if (relative_dot >= 0.0) continue;

        float closing_speed_square = relative_dot * relative_dot / dist_square;
        if (ignore_micro != 0 && closing_speed_square <= 1e-10) continue;
        max_closing_speed_square = max(max_closing_speed_square, closing_speed_square);

        float impulse_factor = -(1.0 + restitution) * other.z / (mass + other.z)
            * relative_dot / dist_square;
        velocity_delta += impulse_factor * delta_pos;
        contact_count += 1;
    }

    if (contact_count > 0) {
        if (average_contacts != 0) {
            velocity_delta /= float(contact_count);
        }
        if (limit_impulse != 0) {
            float max_delta = (1.0 + restitution) * sqrt(max_closing_speed_square);
            float delta_length = length(velocity_delta);
            if (max_delta > 0.0 && delta_length > max_delta) {
                velocity_delta *= max_delta / delta_length;
            }
        }
    }

    out_velocity = velocity + velocity_delta;
}

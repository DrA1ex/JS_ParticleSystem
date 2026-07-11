#version 300 es

precision highp float;
precision highp int;

uniform float min_dist_square;
uniform int count;
uniform float restitution;

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

    for (int i = 0; i < count; ++i) {
        if (i == p_index) continue;

        ivec2 tex_index = ivec2(i % dimensions.x, i / dimensions.x);
        vec3 other = texelFetch(particle_pos_mass_tex, tex_index, 0).xyz;
        vec2 other_velocity = texelFetch(particle_velocity_tex, tex_index, 0).xy;
        vec2 delta_pos = position - other.xy;
        float dist_square = dot(delta_pos, delta_pos);
        if (dist_square <= 0.0 || dist_square >= min_dist_square) continue;

        float relative_dot = dot(velocity - other_velocity, delta_pos);
        if (relative_dot >= 0.0) continue;

        float impulse_factor = -(1.0 + restitution) * other.z / (mass + other.z)
            * relative_dot / dist_square;
        velocity_delta += impulse_factor * delta_pos;
        contact_count += 1;
    }

    float contact_scale = contact_count > 1 ? inversesqrt(float(contact_count)) : 1.0;
    out_velocity = velocity + velocity_delta * contact_scale;
}

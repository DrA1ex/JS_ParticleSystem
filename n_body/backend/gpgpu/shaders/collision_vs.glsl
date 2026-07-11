#version 300 es

precision highp float;
precision highp int;

uniform float min_dist_square;
uniform int count;
uniform float restitution;
uniform int contact_mode;
uniform int limit_impulse;
uniform int ignore_micro;
uniform float separation_strength;

uniform sampler2D particle_pos_mass_tex;
uniform sampler2D particle_velocity_tex;

in vec2 position;
in vec2 velocity;
in float mass;
in float index;

out vec2 out_velocity;

float pairHash(int a, int b) {
    float low = float(min(a, b) + 1);
    float high = float(max(a, b) + 1);
    return fract(sin(low * 12.9898 + high * 78.233) * 43758.5453);
}

vec2 fallbackNormal(int a, int b) {
    float angle = pairHash(a, b) * 6.283185307179586;
    vec2 normal = vec2(cos(angle), sin(angle));
    return a <= b ? normal : -normal;
}

void main() {
    ivec2 dimensions = textureSize(particle_pos_mass_tex, 0);
    highp int p_index = int(index);
    vec2 velocity_delta = vec2(0.0);
    int contact_count = 0;
    float impulse_square_sum = 0.0;
    float collision_distance = sqrt(max(0.0, min_dist_square));
    float min_distance_square = max(1e-12, min_dist_square * 1e-10);

    for (int i = 0; i < count; ++i) {
        if (i == p_index) continue;

        ivec2 tex_index = ivec2(i % dimensions.x, i / dimensions.x);
        vec3 other = texelFetch(particle_pos_mass_tex, tex_index, 0).xyz;
        vec2 other_velocity = texelFetch(particle_velocity_tex, tex_index, 0).xy;
        vec2 delta_pos = position - other.xy;
        float dist_square = dot(delta_pos, delta_pos);
        if (dist_square >= min_dist_square) continue;

        float distance = 0.0;
        vec2 normal;
        if (dist_square <= min_distance_square) {
            normal = fallbackNormal(p_index, i);
        } else {
            distance = sqrt(dist_square);
            normal = delta_pos / distance;
        }

        float relative_normal = dot(velocity - other_velocity, normal);
        float closing_speed = max(0.0, -relative_normal);
        if (ignore_micro != 0 && closing_speed * closing_speed <= 1e-10) {
            closing_speed = 0.0;
        }

        float penetration = max(0.0, collision_distance - distance);
        float target_separation_speed = separation_strength * penetration;
        float separation_speed = max(0.0, target_separation_speed - max(0.0, relative_normal));
        float desired_relative_change = (1.0 + restitution) * closing_speed + separation_speed;
        if (desired_relative_change <= 0.0) continue;

        float delta_speed = desired_relative_change * other.z / (mass + other.z);
        vec2 pair_delta = delta_speed * normal;
        velocity_delta += pair_delta;
        impulse_square_sum += dot(pair_delta, pair_delta);
        contact_count += 1;
    }

    if (contact_count > 0) {
        float response_scale = 1.0;
        if (contact_mode == 1) {
            response_scale = inversesqrt(float(contact_count));
        } else if (contact_mode == 2) {
            response_scale = 1.0 / float(contact_count);
        }

        if (limit_impulse != 0 && impulse_square_sum > 0.0) {
            float response_length = length(velocity_delta * response_scale);
            float max_delta = sqrt(impulse_square_sum);
            if (response_length > max_delta) {
                response_scale *= max_delta / response_length;
            }
        }
        velocity_delta *= response_scale;
    }

    out_velocity = velocity + velocity_delta;
}

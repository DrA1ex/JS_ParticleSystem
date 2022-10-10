#version 300 es

uniform float min_dist_square;
uniform int count;

uniform sampler2D particle_pos_mass_tex;
uniform sampler2D particle_velocity_tex;

in vec2 position;
in vec2 velocity;
in float index;

out vec2 out_velocity;

void collide(vec2 p1, vec2 p2, vec2 p2Vel) {
    vec2 deltaPos =  p1 - p2;
    vec2 squareDelta = deltaPos * deltaPos;
    float distSquare = squareDelta.x + squareDelta.y;

    if (distSquare < min_dist_square) {
        out_velocity -= dot((out_velocity - p2Vel), deltaPos) / distSquare * deltaPos;
    }
}

void main() {
    ivec2 dimensions = textureSize(particle_pos_mass_tex, 0);
    highp int p_index = int(index);

    out_velocity = velocity;
    for (int i = 0; i < count; ++i) {
        if (i == p_index) {
            continue;
        }

        ivec2 index = ivec2(i % dimensions.x, i / dimensions.x);
        vec3 atractor = texelFetch(particle_pos_mass_tex, index, 0).xyz;
        vec2 atractor_velocity = texelFetch(particle_velocity_tex, index, 0).xy;

        collide(position, atractor.xy, atractor_velocity);
    }
}
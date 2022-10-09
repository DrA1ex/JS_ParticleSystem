#version 300 es

uniform vec2 p_force;
uniform float gravity;
uniform float min_dist_square;
uniform int count;

uniform sampler2D particles_tex;

in vec2 position;
in float mass;

out vec2 out_velocity;

vec2 calculateForce(vec2 p1, vec2 p2, float g) {
    vec2 deltaPos =  p1 - p2;

    vec2 squareDelta = deltaPos * deltaPos;
    float distSquare = squareDelta.x + squareDelta.y;

    float force;
    if (distSquare >= min_dist_square)
    {
        force = -g / distSquare;
    }

    return deltaPos * force;
}

void main() {
    ivec2 dimensions = textureSize(particles_tex, 0);
    vec2 force = vec2(0.0);

    for (int i = 0; i < count; ++i) {
        ivec2 index = ivec2(i % dimensions.x, i / dimensions.y);
        vec3 atractor = texelFetch(particles_tex, index, 0).xyz;

        force += calculateForce(position, atractor.xy, gravity * atractor.z);
    }

    out_velocity = (p_force + force);
}
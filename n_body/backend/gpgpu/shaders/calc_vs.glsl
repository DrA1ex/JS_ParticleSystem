#version 300 es

uniform vec3 p_force;
uniform float gravity;
uniform float min_dist_square;
uniform int count;

uniform sampler2D particles_tex;

in vec3 position;
in float mass;

out vec3 out_velocity;

vec3 calculateForce(vec3 p1, vec3 p2, float g) {
    vec3 deltaPos =  p1 - p2;

    vec3 squareDelta = deltaPos * deltaPos;
    float distSquare = squareDelta.x + squareDelta.y + squareDelta.z;

    float force;
    if (distSquare >= min_dist_square)
    {
        force = -g / distSquare;
    }

    return deltaPos * force;
}

void main() {
    ivec2 dimensions = textureSize(particles_tex, 0);
    vec3 force = vec3(0.0);

    for (int i = 0; i < count; ++i) {
        ivec2 index = ivec2(i % dimensions.x, i / dimensions.y);
        vec4 atractor = texelFetch(particles_tex, index, 0);

        force += calculateForce(position, atractor.xyz, gravity * atractor.w);
    }

    out_velocity = (p_force + force);
}
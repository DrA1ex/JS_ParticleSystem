#version 300 es

precision highp float;
precision highp int;

uniform int sprite_mode;
in vec3 color;
in float sprite_radius;
in float sprite_coverage;
out vec4 outColor;

void main() {
    if (sprite_mode == 0) {
        outColor = vec4(color * sprite_coverage, sprite_coverage);
        return;
    }

    vec2 centered = gl_PointCoord - vec2(0.5);
    float distance_from_center = length(centered);
    float radius = max(sprite_radius, 0.0001);
    float aa = max(fwidth(distance_from_center), 0.001);
    float alpha = 1.0;
    float brightness = 1.0;

    if (sprite_mode == 1) {
        alpha = 1.0 - smoothstep(radius - aa, radius + aa, distance_from_center);
    } else if (sprite_mode == 2) {
        alpha = 0.68 * (1.0 - smoothstep(radius * 0.72, radius + aa, distance_from_center));
    } else if (sprite_mode == 3) {
        float normalized_distance = distance_from_center / radius;
        float core = 1.0 - smoothstep(0.55, 1.0, normalized_distance);
        float halo = exp(-normalized_distance * normalized_distance * 1.15) * 0.62;
        alpha = max(core, halo);
        brightness = 0.72 + core * 0.55;
    } else if (sprite_mode == 4) {
        float normalized_distance = distance_from_center / radius;
        float core = (1.0 - smoothstep(0.32, 0.84, normalized_distance)) * 0.42;
        float inner_halo = exp(-normalized_distance * normalized_distance * 0.90) * 0.34;
        float outer_halo = exp(-normalized_distance * normalized_distance * 0.34) * 0.08;
        alpha = max(core, inner_halo + outer_halo);
        brightness = 0.66 + core * 0.48;
    } else {
        float normalized_distance = distance_from_center / radius;
        float core = (1.0 - smoothstep(0.18, 0.72, normalized_distance)) * 0.34;
        float inner_halo = exp(-normalized_distance * normalized_distance * 0.72) * 0.30;
        float outer_halo = exp(-normalized_distance * normalized_distance * 0.20) * 0.13;
        alpha = max(core, inner_halo + outer_halo);
        brightness = 0.62 + core * 0.42;
    }

    alpha *= sprite_coverage;
    if (alpha <= 0.001) discard;
    outColor = vec4(color * brightness * alpha, alpha);
}

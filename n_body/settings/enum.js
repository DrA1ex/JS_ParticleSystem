/**
 * @enum(number)
 */
export const ParticleInitType = {
    circle: 0,
    uniform: 1,
    bang: 2,
    disk: 3,
    rotation: 4,
    collision: 5
}

/**
 * @enum(string)
 */
export const RenderType = {
    canvas: "canvas",
    webgl2: "webgl2"
}

/**
 * @enum(string)
 */
export const BackendType = {
    worker: "worker",
    gpgpu: "gpgpu"
}
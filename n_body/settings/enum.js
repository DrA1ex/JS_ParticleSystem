/**
 * @enum(number)
 */
export const ParticleInitType = {
    circle: 0,
    uniform: 1,
    bang: 2,
    disk: 3,
    rotation: 4,
    collision: 5,
    swirl: 6,
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
/**
 * @enum(string)
 */
export const MaxSpeedUpdateMode = {
    current: "current",
    throttle: "throttle",
    off: "off"
}

/**
 * @enum(string)
 */
export const RenderColorMode = {
    velocity: "velocity",
    mass: "mass",
    fixed: "fixed"
}

/**
 * @enum(string)
 */
export const BufferUploadMode = {
    bufferData: "bufferData",
    bufferSubData: "bufferSubData",
    stream: "stream"
}

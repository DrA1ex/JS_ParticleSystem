import {ComponentType, Property, SettingsBase} from "./base.js";
import {BufferUploadMode, MaxSpeedUpdateMode, RenderColorMode, RenderType} from "./enum.js";


export class RenderSettings extends SettingsBase {
    static Properties = {
        render: Property.enum("render", RenderType, null)
            .setName("Render")
            .setBreaks(ComponentType.renderer, ComponentType.dfri, ComponentType.debug),
        useDpr: Property.bool("dpr", null)
            .setName("Use DPR").setDescription("Draw respecting Device Pixel Ratio")
            .setAffects(ComponentType.renderer, ComponentType.debug),
        dprRate: Property.float("dpr_rate", 0)
            .setName("Custom DPR value").setDescription("Override default Device Pixel Ratio")
            .setAffects(ComponentType.renderer, ComponentType.debug)
            .setConstraints(0, 10),
        fixedParticleSize: Property.bool("fixed_size", true)
            .setName("Fixed particle size").setDescription("Don't change particle size when scale")
            .setAffects(ComponentType.renderer),
        particleSizeScale: Property.float("particle_scale", 1)
            .setName("Particle size scale")
            .setAffects(ComponentType.renderer)
            .setConstraints(1e-2, 10),
        enableFilter: Property.bool("filter", false)
            .setExportable(true)
            .setName("Enable filters").setDescription("Make image brighter and change color over time")
            .setAffects(ComponentType.renderer),
        enableBlending: Property.bool("blend", true)
            .setExportable(true)
            .setName("Enable blending").setDescription("Enable color blending for particles")
            .setAffects(ComponentType.renderer),
        colorMode: Property.enum("color_mode", RenderColorMode, RenderColorMode.velocity)
            .setName("Color mode").setDescription([
                "Controls which attributes the WebGL renderer uploads and how particles are colored.",
                "velocity: color depends on velocity and mass; highest visual detail, uploads position, velocity and mass.",
                "mass: color depends only on mass; skips velocity upload and is usually faster for large particle counts.",
                "fixed: uses one fixed color; uploads only positions and is the fastest mode."
            ].join("\n"))
            .setAffects(ComponentType.renderer),
        bufferUploadMode: Property.enum("upload_mode", BufferUploadMode, BufferUploadMode.bufferSubData)
            .setName("Buffer upload mode").setDescription([
                "Controls how dynamic WebGL buffers are updated after a new physics frame arrives.",
                "bufferData: replaces buffer storage with the provided data each upload; can be faster on some drivers.",
                "bufferSubData: keeps allocated storage and updates its content; usually avoids extra reallocations for stable particle counts.",
                "This affects CPU/GPU upload cost, not the physics calculation itself."
            ].join("\n"))
            .setAffects(ComponentType.renderer),
        maxSpeedUpdateMode: Property.enum("max_speed_mode", MaxSpeedUpdateMode, MaxSpeedUpdateMode.throttle)
            .setName("Max speed update").setDescription([
                "Controls how often the renderer scans all velocities to update the color normalization value.",
                "current: scan every render frame; most reactive, but adds a CPU pass over all particles.",
                "throttle: scan periodically; keeps velocity colors adaptive with lower CPU cost.",
                "off: do not scan in the renderer; uses the configured/base max speed and avoids this CPU cost."
            ].join("\n"))
            .setAffects(ComponentType.renderer),
        enableDFRI: Property.bool("dfri", true)
            .setName("Enable DFRI").setDescription([
                "Enables dynamic frame rate interpolation between physics frames.",
                "For WebGL, interpolation is done in the vertex shader using the current and next position buffers.",
                "For Canvas/fallback paths, interpolation may still use CPU-side position transforms.",
                "Disable this to render only completed physics frames without interpolation."
            ].join("\n"))
            .setBreaks(ComponentType.dfri)
            .setAffects(ComponentType.debug),
        DFRIMaxFrames: Property.int("dfri_max", 120)
            .setName("Max DFRI frames").setDescription([
                "Limits how many interpolated render frames may be shown between two physics frames.",
                "Higher values can keep visual motion smooth when physics steps are slow, but may make the display lag further behind simulation time.",
                "Lower values reduce interpolation delay and make slow physics updates more visible."
            ].join("\n"))
            .setAffects(ComponentType.dfri)
            .setConstraints(1, 240),
        slowMotionRate: Property.float("slow_motion", 1)
            .setName("Slow motion rate").setDescription([
                "Scales the DFRI playback speed relative to completed physics frames.",
                "1 means normal speed. Lower values intentionally slow down visual playback."
            ].join("\n"))
            .setAffects(ComponentType.dfri)
            .setConstraints(1e-2, 1)
    };

    static PropertiesDependencies = new Map([
        [this.Properties.useDpr, [this.Properties.dprRate]],
        [this.Properties.enableDFRI, [this.Properties.DFRIMaxFrames, this.Properties.slowMotionRate]]
    ]);

    get render() {return this.config.render}
    get useDpr() {return this.config.useDpr}
    get particleSizeScale() {return this.config.particleSizeScale}
    get fixedParticleSize() {return this.config.fixedParticleSize}
    get enableFilter() {return this.config.enableFilter}
    get enableBlending() {return this.config.enableBlending}
    get colorMode() {return this.config.colorMode}
    get bufferUploadMode() {return this.config.bufferUploadMode}
    get maxSpeedUpdateMode() {return this.config.maxSpeedUpdateMode}
    get enableDFRI() {return this.config.enableDFRI}
    get DFRIMaxFrames() {return this.config.DFRIMaxFrames}
    get dprRate() {return this.config.dprRate}
    get slowMotionRate() {return this.config.slowMotionRate}

    constructor(values) {
        super(values);

        if (!this.render) {
            this.config.render = WebGL2RenderingContext === undefined ? RenderType.canvas : RenderType.webgl2;
        }

        if (this.useDpr === null) {
            this.config.useDpr = this.render === RenderType.webgl2;
        }
    }
}
import {ComponentType, Property, SettingsBase} from "./base.js";
import {BufferUploadMode, MaxSpeedUpdateMode, RenderColorMode, RenderType} from "./enum.js";

const isWebglRenderer = settings => settings.render.render === RenderType.webgl2;
const useDprEnabled = settings => !!settings.render.useDpr;
const dfriEnabled = settings => !!settings.render.enableDFRI;
const velocityWebglColor = settings => isWebglRenderer(settings) &&
    settings.render.colorMode === RenderColorMode.velocity;
const velocityFixedWebglColor = settings => isWebglRenderer(settings) &&
    settings.render.colorMode === RenderColorMode.velocityFixed;
const velocityBasedWebglColor = settings => velocityWebglColor(settings) || velocityFixedWebglColor(settings);

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
            .setVisibleWhen(useDprEnabled)
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
                "velocity_fixed: starts with velocity colors, waits a few frames, then bakes per-particle colors and keeps them fixed.",
                "mass: color depends only on mass; skips velocity upload and is usually faster for large particle counts.",
                "fixed: uses one fixed color; uploads only positions and is the fastest mode."
            ].join("\n"))
            .setAffects(ComponentType.renderer)
            .setVisibleWhen(isWebglRenderer),
        colorFreezeFrames: Property.int("color_freeze_frames", 8)
            .setName("Velocity color freeze frames").setDescription([
                "Used only by velocity_fixed color mode.",
                "The renderer shows normal velocity colors for this many render frames, then bakes the current per-particle RGB values into a GPU color buffer and stops changing them.",
                "Higher values give velocity normalization a little more time to settle before colors are frozen."
            ].join("\n"))
            .setAffects(ComponentType.renderer)
            .setVisibleWhen(velocityFixedWebglColor)
            .setConstraints(0, 120),
        bufferUploadMode: Property.enum("upload_mode", BufferUploadMode, BufferUploadMode.stream)
            .setName("Buffer upload mode").setDescription([
                "Controls how dynamic WebGL buffers are updated after a new physics frame arrives.",
                "bufferData: replaces buffer storage with the provided data each upload; can be faster on some drivers.",
                "bufferSubData: keeps allocated storage and updates its content; usually avoids extra reallocations for stable particle counts.",
                "stream: orphans the previous GPU storage before upload, then writes with bufferSubData. This can avoid stalls when the driver still uses the old buffer for a previous frame.",
                "This affects CPU/GPU upload cost, not the physics calculation itself."
            ].join("\n"))
            .setAffects(ComponentType.renderer)
            .setVisibleWhen(isWebglRenderer),
        webglLowLatency: Property.bool("webgl_low_latency", true)
            .setName("Low latency WebGL context").setDescription([
                "Requests a WebGL2 context optimized for interactive rendering.",
                "When enabled, the renderer asks the browser for high-performance, non-antialiased, non-alpha, desynchronized WebGL where supported.",
                "Browser and GPU drivers may ignore some of these hints.",
                "This option is read only while creating the WebGL context. Changing it updates the URL/state and requires a page reload; it is not applied live."
            ].join("\n"))
            .setRequiresReload()
            .setVisibleWhen(isWebglRenderer),
        maxSpeedUpdateMode: Property.enum("max_speed_mode", MaxSpeedUpdateMode, MaxSpeedUpdateMode.throttle)
            .setName("Max speed update").setDescription([
                "Controls how often the renderer scans all velocities to update the color normalization value.",
                "current: scan every render frame; most reactive, but adds a CPU pass over all particles.",
                "throttle: scan periodically; keeps velocity colors adaptive with lower CPU cost.",
                "off: do not scan in the renderer; uses the configured/base max speed and avoids this CPU cost."
            ].join("\n"))
            .setAffects(ComponentType.renderer)
            .setVisibleWhen(velocityBasedWebglColor),
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
            .setVisibleWhen(dfriEnabled)
            .setConstraints(1, 240),
        slowMotionRate: Property.float("slow_motion", 1)
            .setName("Slow motion rate").setDescription([
                "Scales the DFRI playback speed relative to completed physics frames.",
                "1 means normal speed. Lower values intentionally slow down visual playback."
            ].join("\n"))
            .setAffects(ComponentType.dfri)
            .setVisibleWhen(dfriEnabled)
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
    get colorFreezeFrames() {return this.config.colorFreezeFrames}
    get bufferUploadMode() {return this.config.bufferUploadMode}
    get webglLowLatency() {return this.config.webglLowLatency}
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

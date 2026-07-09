import {ComponentType, Property, SettingsBase} from "./base.js";

const debugEnabled = settings => !!settings.common.debug;
const statsEnabled = settings => !!settings.common.stats;

export class CommonSettings extends SettingsBase {
    static Properties = {
        debug: Property.bool("debug", false)
            .setName("Debug mode")
            .setBreaks(ComponentType.debug)
            .setAffects(ComponentType.renderer, ComponentType.backend),
        debugTree: Property.bool("debug_tree", null)
            .setName("Debug tree").setDescription("Show Spatial Tree segments")
            .setAffects(ComponentType.debug, ComponentType.backend)
            .setVisibleWhen(debugEnabled),
        debugVelocity: Property.bool("debug_velocity", false)
            .setName("Debug velocity").setDescription("Show velocity vectors")
            .setAffects(ComponentType.debug)
            .setVisibleWhen(debugEnabled),
        debugForce: Property.bool("debug_force", null)
            .setName("Debug momentum").setDescription("Show momentum vectors")
            .setAffects(ComponentType.debug, ComponentType.backend)
            .setVisibleWhen(debugEnabled),
        stats: Property.bool("stats", true)
            .setName("Show statistics")
            .setDescription("Show compact runtime statistics overlay with FPS, physics, render and backend summary.")
            .setBreaks(ComponentType.debug),
        verboseStats: Property.bool("verbose_stats", false)
            .setName("Verbose statistics")
            .setDescription([
                "Show detailed diagnostic timing in the statistics overlay.",
                "Disabled by default to keep the overlay stable and readable during normal use.",
                "Enable it when profiling frame pacing, main-thread work, WebGL upload, GPU timing, auto-tune state or other performance details."
            ].join("\n"))
            .setBreaks(ComponentType.debug)
            .setVisibleWhen(statsEnabled),
    }

    static PropertiesDependencies = new Map([
        [this.Properties.debug, [this.Properties.debugTree, this.Properties.debugVelocity, this.Properties.debugForce]],
        [this.Properties.stats, [this.Properties.verboseStats]],
    ]);

    get debug() {return this.config.debug};
    get debugTree() {return this.config.debugTree;}
    get debugVelocity() {return this.config.debugVelocity;}
    get debugForce() {return this.config.debugForce;}
    get stats() {return this.config.stats;}
    get verboseStats() {return this.config.verboseStats;}

    constructor(values) {
        super(values);

        if (this.stats === false) {
            this.config.verboseStats = false;
        }

        if (this.debug === false) {
            this.config.debugTree = false;
            this.config.debugVelocity = false;
            this.config.debugForce = false;
        } else {
            if (this.debugTree === null) {
                this.config.debugTree = this.debug;
            }
            if (this.debugForce === null) {
                this.config.debugForce = this.debugVelocity;
            }
        }
    }
}

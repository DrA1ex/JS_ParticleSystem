import {ComponentType, Property, SettingsBase} from "./base.js";
import {StatsLevel} from "./enum.js";

const debugEnabled = settings => !!settings.common.debug;
const verboseStatsEnabled = settings => settings.common.statsLevel === StatsLevel.verbose;

export class CommonSettings extends SettingsBase {
    static Properties = {
        debug: Property.bool("debug", false)
            .setName("Debug mode")
            .setBreaks(ComponentType.debug)
            .setAffects(ComponentType.renderer, ComponentType.backend),
        debugTree: Property.bool("debug_tree", null)
            .setName("Debug tree").setDescription("Show Spatial Tree segments")
            .setBreaks(ComponentType.backend)
            .setAffects(ComponentType.debug)
            .setVisibleWhen(debugEnabled),
        debugVelocity: Property.bool("debug_velocity", false)
            .setName("Debug velocity").setDescription("Show velocity vectors")
            .setAffects(ComponentType.debug)
            .setVisibleWhen(debugEnabled),
        debugForce: Property.bool("debug_force", null)
            .setName("Debug momentum").setDescription("Show momentum vectors")
            .setBreaks(ComponentType.backend)
            .setAffects(ComponentType.debug)
            .setVisibleWhen(debugEnabled),
        statsLevel: Property.enum("stats", StatsLevel, StatsLevel.default)
            .setName("Statistics")
            .setDescription([
                "off: hide the statistics overlay.",
                "default: compact runtime overview with the most useful timings.",
                "extended: broader performance overview without low-level diagnostics.",
                "verbose: full diagnostics, filtered by the group switches below."
            ].join("\n"))
            .setBreaks(ComponentType.debug),
        statsFrame: Property.bool("stats_frame", true)
            .setName("Verbose: frame & DFRI")
            .setBreaks(ComponentType.debug)
            .setVisibleWhen(verboseStatsEnabled),
        statsTree: Property.bool("stats_tree", true)
            .setName("Verbose: tree")
            .setBreaks(ComponentType.debug)
            .setVisibleWhen(verboseStatsEnabled),
        statsPhysics: Property.bool("stats_physics", true)
            .setName("Verbose: physics")
            .setBreaks(ComponentType.debug)
            .setVisibleWhen(verboseStatsEnabled),
        statsRender: Property.bool("stats_render", true)
            .setName("Verbose: render")
            .setBreaks(ComponentType.debug)
            .setVisibleWhen(verboseStatsEnabled),
        statsRuntime: Property.bool("stats_runtime", true)
            .setName("Verbose: backend & runtime")
            .setBreaks(ComponentType.debug)
            .setVisibleWhen(verboseStatsEnabled),
    }

    static PropertiesDependencies = new Map([
        [this.Properties.debug, [this.Properties.debugTree, this.Properties.debugVelocity, this.Properties.debugForce]],
    ]);

    get debug() {return this.config.debug};
    get debugTree() {return this.config.debugTree;}
    get debugVelocity() {return this.config.debugVelocity;}
    get debugForce() {return this.config.debugForce;}
    get statsLevel() {return this.config.statsLevel;}
    get stats() {return this.config.statsLevel !== StatsLevel.off;}
    get verboseStats() {return this.config.statsLevel === StatsLevel.verbose;}
    get statsFrame() {return this.config.statsFrame;}
    get statsTree() {return this.config.statsTree;}
    get statsPhysics() {return this.config.statsPhysics;}
    get statsRender() {return this.config.statsRender;}
    get statsRuntime() {return this.config.statsRuntime;}

    constructor(values) {
        super(values);

        if (this.debug === false) {
            this.config.debugTree = false;
            this.config.debugVelocity = false;
            this.config.debugForce = false;
        } else {
            if (this.debugTree === null) this.config.debugTree = this.debug;
            if (this.debugForce === null) this.config.debugForce = this.debugVelocity;
        }
    }
}

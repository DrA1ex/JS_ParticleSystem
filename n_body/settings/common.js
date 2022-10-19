import {Property, SettingsBase} from "./base.js";


export class CommonSettings extends SettingsBase {
    static Properties = {
        debug: Property.bool("debug", false),
        debugTree: Property.bool("debug_tree", null),
        debugVelocity: Property.bool("debug_velocity", false),
        debugForce: Property.bool("debug_force", null),
        stats: Property.bool("stats", true)
    }

    get debug() {return this.config.debug};
    get debugTree() {return this.config.debugTree;}
    get debugVelocity() {return this.config.debugVelocity;}
    get debugForce() {return this.config.debugForce;}
    get stats() {return this.config.stats;}

    constructor(values) {
        super(values);

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
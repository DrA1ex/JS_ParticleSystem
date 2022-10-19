import {CommonSettings} from "./common.js";
import {WorldSettings} from "./world.js";
import {SimulationSettings} from "./simulation.js";
import {PhysicsSettings} from "./physics.js";
import {RenderSettings} from "./render.js";

class AppSettingsBase {
    /** @abstract */
    static Types = {};

    config = {};
    constructor() {
    }

    serialize() {
        const result = {};
        for (const [name, _] of Object.entries(this.constructor.Types)) {
            result[name] = this.config[name].serialize();
        }

        return result;
    }

    static deserialize(data) {
        const instance = new this();
        for (const [name, type] of Object.entries(this.Types)) {
            instance.config[name] = type.deserialize(data[name]);
        }

        return instance;
    }

    static fromQueryParams(defaults = null) {
        const instance = new this();
        for (const [name, type] of Object.entries(this.Types)) {
            instance.config[name] = type.fromQueryParams(defaults);
        }

        return instance;
    }

    export() {
        const result = {};
        for (const [name, _] of Object.entries(this.constructor.Types)) {
            Object.assign(result, this.config[name].export());
        }

        return result;
    }

    static import(data) {
        const instance = new this();
        for (const [name, type] of Object.entries(this.Types)) {
            instance.config[name] = type.import(data);
        }

        return instance;
    }
}

export class AppSimulationSettings extends AppSettingsBase {
    static Types = {
        common: CommonSettings,
        world: WorldSettings,
        simulation: SimulationSettings,
        physics: PhysicsSettings,
        render: RenderSettings,
    }

    get common() {return this.config.common;}
    get world() {return this.config.world;}
    get simulation() {return this.config.simulation;}
    get physics() {return this.config.physics;}
    get render() {return this.config.render;}
}

export class AppPlayerSettings extends AppSettingsBase {
    static Types = {
        common: CommonSettings,
        world: WorldSettings,
        physics: PhysicsSettings,
        render: RenderSettings,
    }

    get common() {return this.config.common;}
    get world() {return this.config.world;}
    get physics() {return this.config.physics;}
    get render() {return this.config.render;}
}
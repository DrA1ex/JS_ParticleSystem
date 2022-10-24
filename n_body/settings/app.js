import {CommonSettings} from "./common.js";
import {WorldSettings} from "./world.js";
import {SimulationSettings} from "./simulation.js";
import {PhysicsSettings} from "./physics.js";
import {RenderSettings} from "./render.js";

export class SettingsGroup {
    constructor(type) {
        this.type = type;

        this.name = name;
    }

    setName(name) {
        this.name = name;

        return this;
    }

    static of(type) {
        return new SettingsGroup(type);
    }
}

/**
 * @template {AppSettingsBase} T
 */
export class AppSettingsBase {
    /**
     * @abstract
     * @type {{[string]: SettingsGroup}}
     */
    static Types = {};

    config = {};
    constructor() {
    }

    /**
     * @returns {object}
     */
    serialize() {
        const result = {};
        for (const [name, _] of Object.entries(this.constructor.Types)) {
            result[name] = this.config[name].serialize();
        }

        return result;
    }

    /**
     * @returns {T}
     */
    static deserialize(data) {
        const instance = new this();
        for (const [name, group] of Object.entries(this.Types)) {
            instance.config[name] = group.type.deserialize(data[name]);
        }

        return /** @type {T} */ instance;
    }

    toQueryParams() {
        const params = [];
        for (const [name, _] of Object.entries(this.constructor.Types)) {
            params.push(...this.config[name].toQueryParams());
        }

        return params;
    }

    /**
     * @returns {T}
     */
    static fromQueryParams(defaults = null) {
        const instance = new this();
        for (const [name, group] of Object.entries(this.Types)) {
            instance.config[name] = group.type.fromQueryParams(defaults);
        }

        return /** @type {T} */ instance;
    }

    export() {
        const result = {};
        for (const [name, _] of Object.entries(this.constructor.Types)) {
            Object.assign(result, this.config[name].export());
        }

        return result;
    }

    /**
     * @returns {T}
     */
    static import(data) {
        const instance = new this();
        for (const [name, group] of Object.entries(this.Types)) {
            instance.config[name] = group.type.import(data);
        }

        return /** @type {T} */ instance;
    }

    /**
     * @param {SettingsGroup} newSettings
     * @returns {{breaks: Set<ComponentType>, affects: Set<ComponentType>}}
     */
    compare(newSettings) {
        const affects = new Set();
        const breaks = new Set();
        for (const [groupName, group] of Object.entries(this.constructor.Types)) {
            for (const [name, prop] of Object.entries(group.type.Properties)) {
                if (this[groupName][name] !== newSettings[groupName][name]) {
                    for (const component of prop.affects) {
                        affects.add(component);
                    }
                    for (const component of prop.breaks) {
                        breaks.add(component);
                    }
                }
            }
        }

        return {
            affects: affects,
            breaks: breaks
        }
    }
}

/**
 * @extends {AppSettingsBase<AppSimulationSettings>}
 */
export class AppSimulationSettings extends AppSettingsBase {
    static Types = {
        common: SettingsGroup.of(CommonSettings).setName("Common"),
        world: SettingsGroup.of(WorldSettings).setName("World"),
        simulation: SettingsGroup.of(SimulationSettings).setName("Simulation"),
        physics: SettingsGroup.of(PhysicsSettings).setName("Physics"),
        render: SettingsGroup.of(RenderSettings).setName("Render"),
    }

    /** @returns {CommonSettings} */
    get common() {return this.config.common;}
    /** @returns {WorldSettings} */
    get world() {return this.config.world;}
    /** @returns {SimulationSettings} */
    get simulation() {return this.config.simulation;}
    /** @returns {PhysicsSettings} */
    get physics() {return this.config.physics;}
    /** @returns {RenderSettings} */
    get render() {return this.config.render;}
}
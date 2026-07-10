import {CommonSettings} from "./common.js";
import {WorldSettings} from "./world.js";
import {SimulationSettings} from "./simulation.js";
import {PhysicsSettings} from "./physics.js";
import {RenderSettings} from "./render.js";

export class SettingsGroup {
    constructor(type) {
        this.type = type;

        this.name = "";
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
     * Apply the saved universe settings on top of the current runtime
     * configuration. State-exportable values come from the file even when a
     * conflicting query parameter exists; backend/performance/debug settings
     * remain as currently configured.
     *
     * @param {object|null} data
     * @returns {T}
     */
    withImportedState(data) {
        const instance = new this.constructor();
        for (const [name, _] of Object.entries(this.constructor.Types)) {
            instance.config[name] = this.config[name].withImportedValues(data);
        }

        return /** @type {T} */ instance;
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
     * @returns {{breaks: Set<ComponentType>, affects: Set<ComponentType>, reloadRequired: Set<Property>}}
     */
    compare(newSettings) {
        const affects = new Set();
        const breaks = new Set();
        const reloadRequired = new Set();
        const changes = [];
        for (const [groupName, group] of Object.entries(this.constructor.Types)) {
            for (const [name, prop] of Object.entries(group.type.Properties)) {
                const oldValue = this[groupName][name];
                const newValue = newSettings[groupName][name];
                if (oldValue !== newValue) {
                    changes.push({groupName, name, prop, oldValue, newValue});
                    if (prop.requiresReload) {
                        reloadRequired.add(prop);
                    }
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
            breaks: breaks,
            reloadRequired: reloadRequired,
            changes
        }
    }

    /**
     * Resolve a setting's effective default while retaining the surrounding
     * configuration. This matters for contextual defaults such as DPR, which
     * depends on the selected renderer, and particle count, which is resolved
     * from the runtime device class.
     *
     * @param {string} groupName
     * @param {string} name
     * @returns {*}
     */
    effectiveDefaultValue(groupName, name) {
        const group = this.constructor.Types[groupName];
        const prop = group?.type?.Properties?.[name];
        if (!prop) {
            return undefined;
        }

        const serialized = this.serialize();
        serialized[groupName][name] = prop.defaultValue;
        return this.constructor.deserialize(serialized)[groupName][name];
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
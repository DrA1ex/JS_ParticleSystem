import * as EnumUtils from "../utils/enum.js";


/**
 * @enum{string}
 */
export const PropertyType = {
    string: "string",
    int: "int",
    float: "float",
    bool: "bool",
    enum: "enum",
}

/**
 * @enum{string}
 */
export const ComponentType = {
    backend: "backend",
    renderer: "renderer",
    dfri: "dfri",
    debug: "debug",
    particles: "particles"
}

export class PropertyParser {
    static string(prop) {
        return (param) => {
            const value = param && param.trim();
            if (value && value.length > 0) {
                return value;
            }

            return prop.defaultValue;
        }
    }

    static bool(prop) {
        return (param) => {
            if (typeof param === "boolean") {
                return param;
            }

            const value = param && param.trim();
            if (value && ["1", "true", "on"].includes(value)) {
                return true;
            } else if (value && ["0", "false", "off"].includes(value)) {
                return false;
            }

            return prop.defaultValue;
        }
    }

    static int(prop) {
        return (param) => {
            if (Number.isInteger(param)) {
                return Math.min(prop.max ?? param, Math.max(prop.min ?? param, param));
            }

            const value = param && param.trim();
            if (value && value.length > 0) {
                const parsed = Number.parseInt(value);
                if (Number.isFinite(parsed)) {
                    return Math.min(prop.max ?? parsed, Math.max(prop.min ?? parsed, parsed));
                }
            }

            return prop.defaultValue;
        }
    }

    static float(prop) {
        return (param) => {
            if (Number.isFinite(param)) {
                return Math.min(prop.max ?? param, Math.max(prop.min ?? param, param));
            }

            const value = param && param.trim();
            if (value && value.length > 0) {
                const parsed = Number.parseFloat(value);
                if (Number.isFinite(parsed)) {
                    return Math.min(prop.max ?? parsed, Math.max(prop.min ?? parsed, parsed));
                }
            }

            return prop.defaultValue;
        }
    }

    static enum(prop) {
        return (param) => {
            if (param === undefined) {
                return prop.defaultValue
            }

            const value = param instanceof String ? param.trim() : param;
            const entry = Object.entries(prop.enumType).find(([k, v]) => k === value || v === value);

            return entry?.at(1) ?? prop.defaultValue;
        }
    }
}

/**
 * @template {Property} T
 */
export class Property {
    /**
     * @param {string} [key]
     * @param {PropertyType} [type=PropertyType.string]
     * @param {object} [enumType=null]
     * @param {*} [defaultValue=null]
     */
    constructor(key, type = PropertyType.string, enumType = null, defaultValue = null) {
        this.name = name;
        this.key = key;
        this.type = type;
        this.enumType = enumType;
        this.defaultValue = defaultValue;

        this.exportable = false;
        this.affects = [];
        this.breaks = [];
        this.name = "";
        this._description = "";
        this.min = null;
        this.max = null;

        if (this.type === PropertyType.enum) {
            if (!this.enumType) {
                throw new Error(`Property ${this.name} missing enum type`);
            }

            if (!(this.enumType instanceof Object)) {
                throw new Error(`Property ${this.name} bad enum type`);
            }
        }

        const parser = PropertyParser[this.type];
        if (parser) {
            this._parser = parser(this);
        } else {
            throw new Error(`Property ${this.name} has invalid type ${this.type}`);
        }
    }

    get descriptionText() {
        return this._description;
    }

    /**
     * @return {string|null}
     */
    get description() {
        let constraints = null;
        if (this.min !== null || this.max !== null) {
            constraints = `- Constraints (${this.min ?? '-∞'}-${this.max ?? "∞"})`;
        }

        let type = null;
        if ([PropertyType.string, PropertyType.int, PropertyType.float].includes(this.type)) {
            type = `- Type: ${this.type}`;
        }

        const parts = [this._description, constraints, type].filter(v => v);
        if (parts.length > 0) {
            return parts.join("\n");
        }

        return null;
    }

    /**
     * @template R
     * @param {string|R} param
     * @return {R}
     */
    parse(param) {
        return this._parser(param);
    }

    /**
     * @param {boolean} exportable
     * @return {Property<T>}
     */
    setExportable(exportable) {
        this.exportable = exportable;
        return this;
    }

    /**
     * @param {string} name
     * @return {Property<T>}
     */
    setName(name) {
        this.name = name;
        return this;
    }

    /**
     * @param {string} description
     * @return {Property<T>}
     */
    setDescription(description) {
        this._description = description;
        return this;
    }

    /**
     * @param {ComponentType} affects
     * @return {Property<T>}
     */
    setAffects(...affects) {
        this.affects = affects;
        return this;
    }

    /**
     * @param {ComponentType} breaks
     * @return {Property<T>}
     */
    setBreaks(...breaks) {
        this.breaks = breaks;
        return this;
    }

    /**
     *
     * @param {number|null} min
     * @param {number|null} max
     * @return {Property<T>}
     */
    setConstraints(min, max) {
        this.min = min;
        this.max = max;
        return this;
    }

    static string(key, defaultValue = null) {
        return new Property(key, PropertyType.string, null, defaultValue);
    }

    static bool(key, defaultValue = null) {
        return new Property(key, PropertyType.bool, null, defaultValue);
    }

    static int(key, defaultValue = null) {
        return new Property(key, PropertyType.int, null, defaultValue);
    }

    static float(key, defaultValue = null) {
        return new Property(key, PropertyType.float, null, defaultValue);
    }

    static enum(key, enumType, defaultValue = null) {
        return new Property(key, PropertyType.enum, enumType, defaultValue);
    }
}

/**
 * @extends {Property<ReadOnlyProperty>}
 */
export class ReadOnlyProperty extends Property {
    constructor(type = PropertyType.string, enumType = null) {
        super("", type, enumType);
        this.formatter = null;
    }

    /**
     * @param value
     * @return {string}
     */
    format(value) {
        if (this.formatter) {
            return this.formatter(value);
        }

        return value
    }

    /**
     * @param {(value:*) => string} fn
     * @return {ReadOnlyProperty}
     */
    setFormatter(fn) {
        this.formatter = fn;
        return this;
    }

    get description() {
        return this._description;
    }

    static string() { return new ReadOnlyProperty(PropertyType.string);}
    static bool() { return new ReadOnlyProperty(PropertyType.bool);}
    static int() { return new ReadOnlyProperty(PropertyType.int);}
    static float() { return new ReadOnlyProperty(PropertyType.float);}
    static enum(enumType) { return new ReadOnlyProperty(PropertyType.enum, enumType);}
}


export class QueryParameterParser {
    static parse(type, defaults) {
        const urlSearchParams = new URLSearchParams(window.location.search);
        const queryParams = Object.fromEntries(urlSearchParams.entries());

        const results = {};
        for (const [name, prop] of Object.entries(type.Properties)) {
            if (prop.exportable && defaults?.hasOwnProperty(name) && !queryParams.hasOwnProperty(prop.key)) {
                results[name] = prop.parse(defaults[name]);
            } else {
                results[name] = prop.parse(queryParams[prop.key]);
            }
        }

        return results;
    }
}

export class SettingsBase {
    /**
     *  @abstract
     *
     *  @type {{[string]: Property}}
     */
    static Properties = {};

    /**
     *  @abstract
     *
     *  @type {{[string]: ReadOnlyProperty}}
     */
    static ReadOnlyProperties = {};

    /**
     * @abstract
     *
     * @type {Map<Property, Array<Property|ReadOnlyProperty>>}
     */
    static PropertiesDependencies = new Map();

    isMobile() {
        if (globalThis.window) {
            return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || window.orientation !== undefined;
        }

        return false;
    }

    config = {};

    constructor(values) {
        const config = this.constructor.Properties;
        for (const [key, value] of Object.entries(values || {})) {
            if (config.hasOwnProperty(key)) {
                this.config[key] = value;
            }
        }
    }

    toQueryParams() {
        const params = new Map();
        for (const [name, prop] of Object.entries(this.constructor.Properties)) {
            params.set(prop, this[name])
        }

        for (const [prop, deps] of this.constructor.PropertiesDependencies.entries()) {
            const value = params.get(prop);
            if (!value) {
                for (const depProp of deps) {
                    params.delete(depProp);
                }
            }
        }

        const result = [];
        for (const [prop, value] of params.entries()) {
            if (value !== prop.defaultValue) {
                if (prop.type === PropertyType.enum) {
                    result.push({key: prop.key, value: EnumUtils.findKey(prop.enumType, value)});
                } else {
                    result.push({key: prop.key, value});
                }
            }
        }

        return result;
    }

    static fromQueryParams(defaults = null) {
        const values = QueryParameterParser.parse(this, defaults);
        return new this(values);
    }

    serialize() {
        return Object.assign({}, this.config);
    }


    static deserialize(serialized) {
        const values = {};
        for (const [name, prop] of Object.entries(this.Properties)) {
            values[name] = prop.parse(serialized[name]);
        }

        return new this(values);
    }

    export() {
        const result = {};
        for (const [name, prop] of Object.entries(this.constructor.Properties)) {
            if (prop.exportable) {
                result[name] = this[name];
            }
        }

        return result;
    }

    static import(params) {
        const values = {};
        for (const [name, prop] of Object.entries(this.Properties)) {
            if (prop.exportable) {
                values[name] = prop.parse(params[name]);
            } else {
                values[name] = prop.defaultValue;
            }
        }

        return new this(values);
    }
}
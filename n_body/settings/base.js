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
                return param;
            }

            const value = param && param.trim();
            if (value && value.length > 0) {
                const parsed = Number.parseInt(value);
                if (Number.isFinite(parsed)) {
                    return parsed;
                }
            }

            return prop.defaultValue;
        }
    }

    static float(prop) {
        return (param) => {
            if (Number.isFinite(param)) {
                return param;
            }

            const value = param && param.trim();
            if (value && value.length > 0) {
                const parsed = Number.parseFloat(value);
                if (Number.isFinite(parsed)) {
                    return parsed;
                }
            }

            return prop.defaultValue;
        }
    }

    static enum(prop) {
        return (param) => {
            const value = param && param.trim();
            const enumValue = prop.enumType[value];

            return enumValue ?? prop.defaultValue;
        }
    }
}

export class Property {
    /**
     * @param {string} key
     * @param {PropertyType} [type=PropertyType.string]
     * @param {*} [enumType=null]
     * @param {*} [defaultValue=null]
     */
    constructor(key, type = PropertyType.string, enumType = null, defaultValue = null) {
        this.name = name;
        this.key = key;
        this.type = type;
        this.enumType = enumType;
        this.defaultValue = defaultValue;

        this.exportable = false;
        this.name = "";
        this.description = "";

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

    parse(param) {
        return this._parser(param);
    }

    setExportable(exportable) {
        this.exportable = exportable;
        return this;
    }

    setName(name) {
        this.name = name;
        return this;
    }

    setDescription(description) {
        this.description = description;
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
    /** @abstract */
    static Properties = {};

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
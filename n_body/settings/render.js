import {Property, SettingsBase} from "./base.js";
import {RenderType} from "./enum.js";


export class RenderSettings extends SettingsBase {
    static Properties = {
        render: Property.enum("render", RenderType, null),
        useDpr: Property.bool("dpr", null),
        dprRate: Property.float("dpr_rate", 0),
        enableFilter: Property.bool("filter", false).setExportable(true),
        enableBlending: Property.bool("blend", true).setExportable(true),
        enableDFRI: Property.bool("dfri", true),
        DFRIMaxFrames: Property.int("dfri_max", 120),
    };

    get render() {return this.config.render}
    get useDpr() {return this.config.useDpr}
    get enableFilter() {return this.config.enableFilter}
    get enableBlending() {return this.config.enableBlending}
    get enableDFRI() {return this.config.enableDFRI}
    get DFRIMaxFrames() {return this.config.DFRIMaxFrames}
    get dprRate() {return this.config.dprRate}

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
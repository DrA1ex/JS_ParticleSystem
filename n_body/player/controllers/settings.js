import {ControllerBase} from "../../controllers/base.js";
import {View} from "../../ui/controls/base.js";
import {Select} from "../../ui/controls/select.js";
import {Checkbox} from "../../ui/controls/checkbox.js";
import * as RangeUtils from "../../utils/range.js";

const view = await fetch(new URL("./views/settings.html", import.meta.url)).then(d => d.text());

export class SettingsController extends ControllerBase {
    static SPEED_EVENT = "settings_speed";
    static PARTICLE_FIXED_SIZE_EVENT = "particle_fixed_size";
    static PARTICLE_SCALE_EVENT = "particle_scale";

    constructor(root, parentCtrl) {
        const viewObj = new View(root, view);
        super(viewObj.element, parentCtrl);

        this.speedSelectControl = Select.byId("speed-select");
        this.speedSelectControl.setOptions([0.005, 0.01, 0.05, 0.1, ...Array.from(RangeUtils.range(0.25, 2, 0.25)), 5, 10]);
        this.speedSelectControl.select(1);

        this.speedSelectControl.setOnChange(value => this.emitEvent(SettingsController.SPEED_EVENT, value));

        this.fixedSizeControl = Checkbox.byId("fixed_size_checkbox");
        this.fixedSizeControl.setValue(true);
        this.fixedSizeControl.setOnChange(value => this.emitEvent(SettingsController.PARTICLE_FIXED_SIZE_EVENT, value));

        this.particleScaleControl = Select.byId("particle_scale_select");
        this.particleScaleControl.setOptions([0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 4, 8, 10])
        this.particleScaleControl.select(1);
        this.particleScaleControl.setOnChange(value => this.emitEvent(SettingsController.PARTICLE_SCALE_EVENT, value));
    }
}
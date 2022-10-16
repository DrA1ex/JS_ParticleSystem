import {ControllerBase} from "../../controllers/base.js";
import {View} from "../../ui/controls/base.js";
import {Select} from "../../ui/controls/select.js";

const view = await fetch(new URL("./views/settings.html", import.meta.url)).then(d => d.text());

export class SettingsController extends ControllerBase {
    static SETTINGS_SPEED_EVENT = "settings_speed";

    constructor(root, parentCtrl) {
        const viewObj = new View(root, view);
        super(viewObj.element, parentCtrl);

        this.speedSelectControl = Select.byId("speed-select");

        const speedOptions = [
            {key: "0.01", label: "0.01"},
            {key: "0.05", label: "0.05"},
            {key: "0.1", label: "0.1"},
        ];

        for (let i = 0.25; i <= 2; i += 0.25) {
            const value = i.toString();
            speedOptions.push({key: value, label: value});
        }

        speedOptions.push(
            {key: "5", label: "5"},
            {key: "10", label: "10"},
        );

        this.speedSelectControl.setOptions(speedOptions);
        this.speedSelectControl.select("1");

        this.speedSelectControl.setOnChange((key) => {
            if (key) {
                this.emitEvent(SettingsController.SETTINGS_SPEED_EVENT, Number.parseFloat(key));
            }
        });
    }
}
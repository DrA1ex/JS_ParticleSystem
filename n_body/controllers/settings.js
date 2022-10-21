import {ControllerBase} from "./base.js";
import {View} from "../ui/controls/base.js";
import {Button} from "../ui/controls/button.js";
import {PropertyType} from "../settings/base.js";
import {Select} from "../ui/controls/select.js";
import {Input, InputType} from "../ui/controls/input.js";
import {Checkbox} from "../ui/controls/checkbox.js";

const view = await fetch(new URL("./views/settings.html", import.meta.url)).then(d => d.text());

export class SettingsController extends ControllerBase {
    static RECONFIGURE_EVENT = "start_recording";

    settings;
    config;

    constructor(root, parentCtrl) {
        const viewControl = new View(root, view)
        super(viewControl.element, parentCtrl);

        this.content = this.root.getElementsByClassName("settings-content")[0];

        this.applyBtn = Button.byId("apply");
        this.applyBtn.setOnClick(() => this.emitEvent(SettingsController.RECONFIGURE_EVENT, this.getConfig()));
    }

    /**
     * @param {AppSettingsBase} settings
     */
    configure(settings) {
        this.settings = settings;
        this.config = {};

        while (this.content.firstChild) {
            this.content.removeChild(this.content.lastChild);
        }

        for (const [key, group] of Object.entries(this.settings.constructor.Types)) {
            if (group.name) {
                this.config[key] = {};
                this._createBlock(this.config[key], group, this.settings[key]);
            }
        }
    }

    getConfig() {
        const config = {};

        for (const [blockKey, block] of Object.entries(this.config)) {
            const blockConfig = {}
            for (const [key, control] of Object.entries(block)) {
                let value = control.getValue();
                if (value instanceof String) {
                    value = value && value !== "null" && value.trim() !== "" ? value.trim() : null;
                }

                blockConfig[key] = value;
            }

            config[blockKey] = blockConfig;
        }

        return config;
    }

    _createBlock(config, group, value) {
        const h3 = document.createElement("h3");
        h3.innerText = group.name;
        this.content.appendChild(h3);

        const block = document.createElement("div");
        block.classList.add("settings-block");
        this._createBlockEntry(config, group, block, value);
        this.content.appendChild(block);
    }

    /**
     * @param {object} config
     * @param {SettingsGroup} group
     * @param {HTMLElement} parent
     * @param {SettingsBase} value
     * @private
     */
    _createBlockEntry(config, group, parent, value) {
        let count = 0;
        for (const [key, prop] of Object.entries(value.constructor.Properties)) {
            const caption = document.createElement("div");
            caption.innerText = prop.name || key;
            caption.classList.add("settings-caption")
            if (prop.description) {
                caption.setAttribute("data-tooltip", prop.description);
            }
            parent.appendChild(caption);


            const control = this._createBlockInput(prop, value[key]);
            control.addClass("settings-input");
            parent.appendChild(control.element);

            config[key] = control;
            count += 1;
        }

        parent.style.gridTemplateRows = `repeat(${count}, 2em)`;
    }

    /**
     * @param {Property} property
     * @param {*} value
     * @private
     */
    _createBlockInput(property, value) {
        let control;
        switch (property.type) {
            case PropertyType.enum:
                control = this._createSelect(property.enumType, value);
                break;

            case PropertyType.int:
                control = this._createInput(value, InputType.int)
                break;

            case PropertyType.float:
                control = this._createInput(value, InputType.float)
                break;

            case PropertyType.bool:
                control = this._createCheckbox(value);
                break;

            default:
            case PropertyType.string:
                control = this._createInput(value, InputType.text)
                break;
        }

        return control;
    }

    _createInput(value, type) {
        const input = new Input(document.createElement("input"), type);
        input.setValue(value);

        return input;
    }

    _createCheckbox(value) {
        const e = document.createElement("input");
        e.type = "checkbox";
        const input = new Checkbox(e);
        input.setValue(value);

        return input;
    }

    _createSelect(type, value) {
        const select = new Select(document.createElement("select"));
        select.setOptions(Object.keys(type));

        const entry = value && Object.entries(type).find(([k, v]) => v === value);
        if (entry) {
            select.select(entry[0]);
        }

        return select;
    }
}
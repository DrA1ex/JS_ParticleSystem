import {ControllerBase} from "./base.js";
import {View} from "../ui/controls/base.js";
import {PropertyType, ReadOnlyProperty} from "../settings/base.js";
import {Select} from "../ui/controls/select.js";
import {Input, InputType} from "../ui/controls/input.js";
import {Checkbox} from "../ui/controls/checkbox.js";
import {AppSimulationSettings} from "../settings/app.js";
import {Label} from "../ui/controls/label.js";

const view = await fetch(new URL("./views/settings.html", import.meta.url)).then(d => d.text());

export class SettingsController extends ControllerBase {
    static RECONFIGURE_EVENT = "start_recording";

    /** @type {AppSettingsBase} */
    settings;
    /** @type {{[string]: {[string]: InputControl}}} */
    config;
    /** @type {Map<Property, {key: string, groupKey: string, group: SettingsGroup, control: InputControl|Label}>} */
    propData;

    constructor(root, parentCtrl) {
        const viewControl = new View(root, view)
        super(viewControl.element, parentCtrl);

        this.content = this.root.getElementsByClassName("settings-content")[0];

        this.tooltip = document.createElement("div");
        this.tooltip.classList.add("settings-tooltip");
        document.body.appendChild(this.tooltip);

        this.tooltipTarget = null;
        this.content.addEventListener("pointerover", event => this._onTooltipPointerOver(event));
        this.content.addEventListener("pointerout", event => this._onTooltipPointerOut(event));
        this.content.addEventListener("focusin", event => this._onTooltipFocusIn(event));
        this.content.addEventListener("focusout", event => this._onTooltipFocusOut(event));
    }

    /**
     * @param {AppSettingsBase} settings
     */
    configure(settings) {
        this.settings = settings;
        this.config = {};
        this.propData = new Map();

        while (this.content.firstChild) {
            this.content.removeChild(this.content.lastChild);
        }

        for (const [key, group] of Object.entries(this.settings.constructor.Types)) {
            if (group.name) {
                this.config[key] = {};
                this._createBlock(this.config[key], key, group, this.settings[key]);
            }
        }

        for (const prop of this.propData.keys()) {
            const {key, groupKey} = this.propData.get(prop);
            const deps = this.settings[groupKey].constructor.PropertiesDependencies.get(prop);
            if (deps && deps.length > 0) {
                for (const depProp of deps) {
                    if (!(depProp instanceof ReadOnlyProperty)) {
                        const value = this.settings[groupKey][key];
                        this.propData.get(depProp).control.setEnabled(!!value);
                    }
                }
            }
        }
    }

    onParameterChanged(prop, suppressEvent = false) {
        const config = this.getConfig();
        const {control, key, groupKey} = this.propData.get(prop);
        const value = config[groupKey][key];

        if (prop instanceof ReadOnlyProperty) {
            control.setText(prop.format(value));
        } else {
            control.setValue(value);
            if (!suppressEvent) {
                this.emitEvent(SettingsController.RECONFIGURE_EVENT, config);
            }

            const deps = config[groupKey].constructor.PropertiesDependencies.get(prop);
            if (deps && deps.length > 0) {
                for (const depProp of deps) {
                    this.onParameterChanged(depProp, true);

                    if (!(depProp instanceof ReadOnlyProperty)) {
                        this.propData.get(depProp).control.setEnabled(!!value);
                    }
                }
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

        return AppSimulationSettings.deserialize(config);
    }

    _createBlock(config, groupKey, group, value) {
        const h3 = document.createElement("h3");
        h3.innerText = group.name;
        this.content.appendChild(h3);

        const block = document.createElement("div");
        block.classList.add("settings-block");
        this._createBlockEntries(config, groupKey, group, block, value);
        this.content.appendChild(block);
    }

    /**
     * @param {object} config
     * @param {string} groupKey
     * @param {SettingsGroup} group
     * @param {HTMLElement} parent
     * @param {SettingsBase} groupValue
     * @private
     */
    _createBlockEntries(config, groupKey, group, parent, groupValue) {
        let count = 0;
        for (const [key, prop] of Object.entries(groupValue.constructor.Properties)) {
            const caption = document.createElement("div");
            caption.innerText = prop.name || key;
            caption.classList.add("settings-caption")
            if (prop.description) {
                caption.setAttribute("data-tooltip", prop.description);
                caption.setAttribute("aria-label", prop.description);
                caption.tabIndex = 0;
            }
            parent.appendChild(caption);


            const control = this._createBlockInput(prop, groupValue[key]);
            control.addClass("settings-input");
            control.setOnChange(() => this.onParameterChanged(prop));

            this.propData.set(prop, {
                key,
                groupKey,
                group,
                control
            });

            parent.appendChild(control.element);

            config[key] = control;
            count += 1;
        }

        for (const [key, prop] of Object.entries(groupValue.constructor.ReadOnlyProperties)) {
            const caption = document.createElement("div");
            caption.innerText = prop.name || key;
            caption.classList.add("settings-caption")
            if (prop.description) {
                caption.setAttribute("data-tooltip", prop.description);
                caption.setAttribute("aria-label", prop.description);
                caption.tabIndex = 0;
            }
            parent.appendChild(caption);

            const label = new Label(document.createElement("div"));
            label.setText(prop.format(groupValue[key]));
            label.addClass("settings-input");
            parent.appendChild(label.element);

            this.propData.set(prop, {
                key,
                groupKey,
                group,
                control: label
            });

            count += 1;
        }

        parent.style.gridTemplateRows = `repeat(${count}, 2em)`;
    }


    _onTooltipPointerOver(event) {
        const target = event.target.closest?.("[data-tooltip]");
        if (target && this.content.contains(target)) {
            this._showTooltip(target);
        }
    }

    _onTooltipPointerOut(event) {
        if (!this.tooltipTarget) {
            return;
        }

        const relatedTarget = event.relatedTarget;
        if (relatedTarget instanceof Node && this.tooltipTarget.contains(relatedTarget)) {
            return;
        }

        this._hideTooltip();
    }

    _onTooltipFocusIn(event) {
        const target = event.target.closest?.("[data-tooltip]");
        if (target && this.content.contains(target)) {
            this._showTooltip(target);
        }
    }

    _onTooltipFocusOut(event) {
        if (event.target === this.tooltipTarget) {
            this._hideTooltip();
        }
    }

    /**
     * Settings dialogs are scrollable, so a CSS-only tooltip attached to the caption can be
     * clipped by the dialog overflow. This fixed-position overlay is measured against the
     * viewport and clamped to the visible area, allowing long help text to grow naturally.
     *
     * @param {HTMLElement} target
     * @private
     */
    _showTooltip(target) {
        const text = target.getAttribute("data-tooltip");
        if (!text) {
            this._hideTooltip();
            return;
        }

        this.tooltipTarget = target;
        this.tooltip.innerText = text;
        this.tooltip.classList.add("settings-tooltip-visible");
        this.tooltip.style.visibility = "hidden";
        this.tooltip.style.left = "0px";
        this.tooltip.style.top = "0px";

        const targetRect = target.getBoundingClientRect();
        const tooltipRect = this.tooltip.getBoundingClientRect();
        const margin = 12;

        let left = targetRect.left + targetRect.width / 2 - tooltipRect.width / 2;
        left = Math.max(margin, Math.min(left, window.innerWidth - tooltipRect.width - margin));

        let top = targetRect.top - tooltipRect.height - margin / 2;
        if (top < margin) {
            top = targetRect.bottom + margin / 2;
        }
        top = Math.max(margin, Math.min(top, window.innerHeight - tooltipRect.height - margin));

        this.tooltip.style.left = `${left}px`;
        this.tooltip.style.top = `${top}px`;
        this.tooltip.style.visibility = "visible";
    }

    _hideTooltip() {
        this.tooltipTarget = null;
        this.tooltip.classList.remove("settings-tooltip-visible");
        this.tooltip.style.visibility = "hidden";
    }

    /**
     * @param {Property} property
     * @param {*} value
     * @returns {InputControl}
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
        const input = new Checkbox(e);
        input.setValue(value);

        return input;
    }

    _createSelect(type, value) {
        const select = new Select(document.createElement("select"));
        const options = Object.entries(type).map(([key, enumValue]) => {
            if (typeof enumValue === "string") {
                return {key: enumValue, strKey: enumValue, label: enumValue};
            }

            return {key, strKey: key, label: key};
        });

        select.setOptions(options);

        const entry = Object.entries(type).find(([k, v]) => v === value || k === value);
        if (entry) {
            select.select(typeof entry[1] === "string" ? entry[1] : entry[0]);
        }

        return select;
    }
}
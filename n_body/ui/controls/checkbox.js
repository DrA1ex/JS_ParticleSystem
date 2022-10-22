import {InputControl} from "./base.js";

export class Checkbox extends InputControl {
    constructor(element) {
        super(element);

        this.element.type = "checkbox";
        this.element.onchange = () => this._emitChanged(this.getValue());
    }

    setValue(value) {
        this.element.checked = value;
    }

    getValue() {
        return this.element.checked;
    }
}
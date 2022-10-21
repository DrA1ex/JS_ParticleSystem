import {InputControl} from "./base.js";

export class Checkbox extends InputControl {
    setValue(value) {
        this.element.checked = value;
    }

    getValue() {
        return this.element.checked;
    }
}
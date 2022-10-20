import {InputControl} from "./base.js";

/**
 * @enum{number}
 */
export const InputType = {
    text: 0,
    int: 1,
    float: 2
}

export class Input extends InputControl {
    /**
     * @param {HTMLInputElement} element
     * @param {InputType} [type=InputType.text]
     */
    constructor(element, type = InputType.text) {
        super(element);

        this.type = type;
        this.element.onchange = this._onChange.bind(this);
    }

    setValue(value) {
        this.element.value = value;
    }

    getValue() {
        if (!this.isValid()) {
            return null;
        }

        switch (this.type) {
            case InputType.int:
                return Number.parseInt(this.element.value);

            case InputType.float:
                return Number.parseFloat(this.element.value);

            default:
                return this.element.value;
        }
    }

    isValid() {
        switch (this.type) {
            case InputType.int:
                return Number.isFinite(Number.parseInt(this.element.value));

            case InputType.float:
                return Number.isFinite(Number.parseFloat(this.element.value));

            default:
                return true;
        }
    }

    _onChange(e) {
        this.element.setAttribute("invalid", `${!this.isValid()}`);
    }
}
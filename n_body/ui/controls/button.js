import {ControlBase} from "./base.js";

/**
 * @class
 * @extends ControlBase<ButtonControl>
 */
export class ButtonControl extends ControlBase {
    constructor(element) {
        super(element);
    }

    setOnClick(fn) {
        this.element.onclick = fn;
    }
}
import {Control} from "./base.js";

/**
 * @class
 * @extends Control<ButtonControl>
 */
export class ButtonControl extends Control {
    constructor(element) {
        super(element);
    }

    setOnClick(fn) {
        this.element.onclick = fn;
    }
}
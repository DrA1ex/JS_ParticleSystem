import {Control} from "./base.js";

/**
 * @class
 * @extends Control<Button>
 */
export class Button extends Control {
    constructor(element) {
        super(element);
    }

    setOnClick(fn) {
        this.element.onclick = fn;
    }
}
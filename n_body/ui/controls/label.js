import {ControlBase} from "./base.js";

export class LabelControl extends ControlBase {
    constructor(element) {
        super(element);
    }

    get text() {
        return this.element.innerText;
    }


    setText(text) {
        this.element.innerText = text;
    }
}
import {Control} from "./base.js";

export class LabelControl extends Control {
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
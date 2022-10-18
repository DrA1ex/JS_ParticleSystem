import {Control, View} from "./base.js";

const view = await fetch(new URL("./views/dialog.html", import.meta.url)).then(d => d.text());

export class Dialog extends Control {
    _shown = false;
    _onDismissed = null;

    modal = false;

    get shown() {
        return this._shown;
    }

    /**
     * @param {HTMLElement} element
     * @param {HTMLElementE} contentNode
     */
    constructor(element, contentNode) {
        const viewControl = new View(element, view);
        super(viewControl.element);

        this.contentNode = contentNode;
        if (this.contentNode.parentElement) {
            this.contentNode.parentElement.removeChild(this.contentNode);
        }

        this.dialogElement = this.element.getElementsByClassName("dialog")[0];
        this.dialogElement.appendChild(this.contentNode);

        for (const el of this.contentNode.getElementsByClassName("dialog-close")) {
            el.onclick = this._dismissed.bind(this);
        }

        this._docClickListener = this._onDocumentClick.bind(this);
    }

    setOnDismissed(fn) {
        this._onDismissed = fn;
    }

    show() {
        if (this._shown) {
            this.hide();
            return;
        }

        if (!this.modal) {
            document.addEventListener("mousedown", this._docClickListener);
            document.addEventListener("touchstart", this._docClickListener);
        }

        this._shown = true;
        this.element.classList.add("dialog-shown");
    }

    hide() {
        if (!this._shown) {
            return;
        }

        this._shown = false;
        this.element.classList.remove("dialog-shown");

        if (!this.modal) {
            document.removeEventListener("mousedown", this._docClickListener);
            document.removeEventListener("touchstart", this._docClickListener);
        }
    }

    _onDocumentClick(e) {
        if (this.dialogElement.contains(e.target)) {
            return;
        }

        this._dismissed();
    }

    _dismissed() {
        this.hide();

        if (this._onDismissed) {
            this._onDismissed();
        }
    }
}
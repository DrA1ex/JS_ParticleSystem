import {Control, View} from "./base.js";

const view = await fetch(new URL("./views/dialog.html", import.meta.url)).then(d => d.text());

/**
 * @enum{number}
 */
export const DialogPositionEnum = {
    center: 0,
    left: 1,
    right: 2
}

/**
 * @enum{number}
 */
export const DialogTypeEnum = {
    modal: 0,
    closable: 1,
    popover: 2,
}

export class Dialog extends Control {
    _shown = false;
    _onDismissed = null;

    position = DialogPositionEnum.center;
    type = DialogTypeEnum.modal;

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
            el.onclick = this.hide.bind(this);
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

        switch (this.type) {
            case DialogTypeEnum.modal:
                this.element.classList.add("dialog-modal");
                break;

            case DialogTypeEnum.closable:
                this.element.classList.add("dialog-modal");
                document.addEventListener("mousedown", this._docClickListener);
                document.addEventListener("touchstart", this._docClickListener);
                break;
        }

        switch (this.position) {
            case DialogPositionEnum.left:
                this.element.style.justifyContent = "left";
                this.dialogElement.style.animationName = "dialog-show-left";
                break;

            case DialogPositionEnum.center:
                this.element.style.justifyContent = "center";
                this.dialogElement.style.animationName = "dialog-show-center";
                break;

            case DialogPositionEnum.right:
                this.element.style.justifyContent = "right";
                this.dialogElement.style.animationName = "dialog-show-right";
                break;
        }

        this._shown = true;
        this.element.classList.add("dialog-shown");
    }

    hide() {
        if (!this._shown) {
            return;
        }

        switch (this.type) {
            case DialogTypeEnum.closable:
                document.removeEventListener("mousedown", this._docClickListener);
                document.removeEventListener("touchstart", this._docClickListener);
                break;
        }

        this.element.classList.remove("dialog-shown");
        this.dialogElement.onanimationend = () => {
            this.dialogElement.onanimationend = null;
            this.element.classList.remove("dialog-fading");

            this._shown = false;
            this._dismissed();
        }
        setTimeout(() => {
            this.element.classList.add("dialog-fading")
        });
    }

    _onDocumentClick(e) {
        if (this.dialogElement.contains(e.target)) {
            return;
        }

        this.hide();
    }

    _dismissed() {
        if (this._onDismissed) {
            this._onDismissed();
        }
    }
}
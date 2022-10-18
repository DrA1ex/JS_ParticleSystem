import {Control, View} from "./base.js";

const view = await fetch(new URL("./views/popup.html", import.meta.url)).then(d => d.text());

/**
 * @enum{number}
 */
export const PopupDirectionEnum = {
    up: 0,
    down: 1,
    left: 2,
    right: 3
}

export class Popup extends Control {
    anchor;
    offsetX = 0;
    offsetY = 0;
    direction = PopupDirectionEnum.up;

    shown = false;

    /**
     * @param {HTMLElement} element
     * @param {HTMLElement} contentNode
     */
    constructor(element, contentNode) {
        const viewControl = new View(element, view);
        super(viewControl.element);

        this.contentNode = contentNode;
        if (this.contentNode.parentElement) {
            this.contentNode.parentElement.removeChild(this.contentNode);
        }

        this.element.appendChild(this.contentNode);

        this._docClickListener = this._onDocumentClick.bind(this);
        this._sizeObserver = new ResizeObserver(this._reposition.bind(this));
    }

    show() {
        if (this.shown) {
            this.hide();
            return;
        } else if (!this.anchor) {
            return;
        }

        document.addEventListener("mousedown", this._docClickListener);
        document.addEventListener("touchstart", this._docClickListener);
        this._sizeObserver.observe(document.body, {box: 'border-box'});

        this.shown = true;
        this.element.classList.add("popup-shown");

        this.anchor.classList.add("popup-trigger-opened");
        this._reposition();
    }

    hide() {
        if (!this.shown) {
            return;
        }

        this.shown = false;
        this.element.classList.remove("popup-shown");
        this.anchor.classList.remove("popup-trigger-opened");

        document.removeEventListener("mousedown", this._docClickListener);
        document.removeEventListener("touchstart", this._docClickListener);
        this._sizeObserver.disconnect();

    }

    _reposition() {
        if (!this.shown) {
            return;
        }

        const rect = this.element.getBoundingClientRect();
        const containerRect = document.body.getBoundingClientRect();
        const {x: anchorX, y: anchorY} = this._getAnchorPosition(this.direction, rect, containerRect);
        let top, left;

        switch (this.direction) {
            case PopupDirectionEnum.up:
                left = anchorX - rect.width / 2;
                top = anchorY - rect.height;
                break;
            case PopupDirectionEnum.down:
                left = anchorX - rect.width / 2;
                top = anchorY;
                break;
            case PopupDirectionEnum.left:
                left = anchorX - rect.width;
                top = anchorY - rect.height / 2;
                break;
            case PopupDirectionEnum.right:
                left = anchorX;
                top = anchorY - rect.height / 2;
                break;

            default:
                throw Error(`Unknown popup direction: ${this.direction}`);
        }

        left = this._constrainValue(left, containerRect.x + 2, containerRect.right - rect.width - 2);
        top = this._constrainValue(top, containerRect.y + 2, containerRect.bottom - rect.height - 2);

        this.element.style.left = `${left}px`;
        this.element.style.top = `${top}px`;
    }

    _getAnchorPosition() {
        const anchorRect = this.anchor.getBoundingClientRect();

        let anchorX, anchorY;
        switch (this.direction) {
            case PopupDirectionEnum.up:
                anchorX = anchorRect.left + anchorRect.width / 2 - this.offsetX;
                anchorY = anchorRect.top - this.offsetY;
                break;

            case PopupDirectionEnum.down:
                anchorX = anchorRect.left + anchorRect.width / 2 - this.offsetX;
                anchorY = anchorRect.bottom + this.offsetY;
                break;

            case PopupDirectionEnum.left:
                anchorX = anchorRect.left - this.offsetX;
                anchorY = anchorRect.top + anchorRect.height / 2 - this.offsetY;
                break;

            case PopupDirectionEnum.right:
                anchorX = anchorRect.right + this.offsetX;
                anchorY = anchorRect.top + anchorRect.height / 2 - this.offsetY;
                break;

            default:
                throw Error(`Unknown popup direction: ${this.direction}`);
        }

        return {x: anchorX, y: anchorY};
    }

    _onDocumentClick(e) {
        if (e.target === this.anchor || this.anchor.contains(e.target) || this.element.contains(e.target)) {
            return;
        }

        this.hide();
    }

    _constrainValue(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }
}
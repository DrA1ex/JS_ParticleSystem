/**
 * @class
 * @template T
 */
export class Control {
    constructor(element) {
        this.element = element;
    }

    /**
     *
     * @param {string} id
     * @param {...*} params
     * @return {T}
     */
    static byId(id, ...params) {
        const e = document.getElementById(id);
        if (!e) {
            throw new Error(`Unable to fined element ${id}`);
        }

        return /** @type {T} */ new this(e, ...params);
    }

    setVisibility(show) {
        this.element.style.display = show ? null : "none";
    }

    setEnabled(enabled) {
        if (enabled) {
            this.element.removeAttribute("disabled");
        } else {
            this.element.setAttribute("disabled", "");
        }

    }

    setInteractions(enable) {
        this.element.style.pointerEvents = enable ? null : "none";
    }

    addClass(className) {
        this.element.classList.add(className);
    }

    removeClass(className) {
        this.element.classList.remove(className);
    }
}

export class View {
    /**
     * @param {Node} element
     * @param {string} view
     */
    constructor(element, view) {
        if (!element) {
            throw new Error("Element is missing");
        }

        if (!view) {
            throw new Error("View is missing");
        }

        this.element = element;
        this._replaceElement(view);
    }

    _replaceElement(outerHTML) {
        let parent = false;
        let ref;

        if (this.element.previousElementSibling !== null) {
            ref = this.element.previousElementSibling;
        } else {
            ref = this.element.parentElement;
            parent = true;
        }

        this.element.outerHTML = outerHTML;
        this.element = parent ? ref.firstElementChild : ref.nextElementSibling;
    }

}

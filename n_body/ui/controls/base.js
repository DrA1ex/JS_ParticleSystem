/**
 * @class
 * @template T
 */
export class ControlBase {
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

        return new this(e, ...params);
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
}
import {Control} from "./base.js";

export class Select extends Control {
    _onChangeFn = null;
    options = [];

    constructor(element) {
        super(element);

        this.element.onchange = this._onChangeHandler.bind(this);
    }

    _selected = null

    get selected() {
        return this._selected?.key ?? null;
    }

    setOnChange(fn) {
        this._onChangeFn = fn;
    }

    _onChangeHandler(e) {
        this._selected = this.options.find(o => o.key === this.element.value);
        if (this._onChangeFn) {
            this._onChangeFn(this.selected);
        }
    }

    /**
     * @param {Array<{key: string, label: string}>} options
     */
    setOptions(options) {
        const selectedKey = this.selected;
        this._selected = null;
        this.options = [];
        this.element.innerHTML = "";

        for (const option of options) {
            const e = document.createElement("option");
            e.value = option.key;
            e.text = option.label;

            this.element.appendChild(e);

            this.options.push(Object.assign({}, option, {e}));
        }

        this.select(selectedKey);
    }

    select(key) {
        if (this.selected) {
            this.selected.e.removeAttribute("selected");
        }

        const option = this.options.find(o => o.key === key);
        if (option) {
            option.e.setAttribute("selected", "");
        }
    }
}
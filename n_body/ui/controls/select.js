import {InputControl} from "./base.js";

export class Select extends InputControl {
    options = [];

    constructor(element) {
        super(element);

        this.element.onchange = this._onChangeHandler.bind(this);
    }

    _selected = null

    get selected() {
        return this._selected?.key ?? null;
    }

    _onChangeHandler() {
        this._selected = this.options.find(o => o.strKey === this.element.value);
        this._emitChanged(this.selected);
    }

    /**
     * @param {Array<{key: string, label: string}|*>} options
     */
    setOptions(options) {
        const selectedKey = this.selected;
        this._selected = null;
        this.options = [];
        this.element.innerHTML = "";

        for (let option of options) {
            const e = document.createElement("option");
            const entry = {e};

            if (option instanceof Object) {
                entry.key = option.key
                entry.strKey = option.strKey ?? option.key.toString();
                entry.label = option.label ?? option.key.toString();
            } else {
                entry.key = option
                entry.strKey = option.toString();
                entry.label = option.toString();
            }

            e.value = entry.strKey;
            e.text = entry.label;

            this.element.appendChild(e);
            this.options.push(entry);
        }

        this.select(selectedKey);
    }

    select(key) {
        if (this.selected) {
            this.selected.e.removeAttribute("selected");
        }

        const option = this.options.find(o => o.key === key || o.strKey === key);
        if (option) {
            option.e.setAttribute("selected", "");
            this._selected = option;
        }
    }

    setValue(value) {
        this.select(value);
    }

    getValue() {
        return this.selected;
    }
}
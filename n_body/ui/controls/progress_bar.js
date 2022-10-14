import {ControlBase} from "./base.js";

/**
 * @class
 * @extends ControlBase<ProgressBarControl>
 */
export class ProgressBarControl extends ControlBase {
    _onSeekHandler = null;

    constructor(element, min = 0, max = 1) {
        super(element);
        this.progressElement = element.getElementsByClassName("progress")[0];

        this.min = 0;
        this.max = 0;
        this.value = 0;

        this.setRange(min, max);
        this.setValue(min);

        this.element.onclick = this._onProgressClick.bind(this);
    }

    setOnSeek(fn) {
        this._onSeekHandler = fn;
    }

    _onProgressClick(e) {
        const rect = this.element.getBoundingClientRect();
        const x = 1 - (rect.width - (e.clientX - rect.x)) / rect.width;
        const value = this.min + x * (this.max - this.min);

        if (this._onSeekHandler) {
            this._onSeekHandler(value);
        }
    }

    setRange(min, max) {
        this.min = Math.min(min, max);
        this.max = Math.max(max, min);
        if (this.max <= this.min) {
            this.max += 1;
        }

        this.value = this.min;
    }

    setValue(value) {
        value = Math.max(this.min, Math.min(this.max, value));
        let progress = (value - this.min) / (this.max - this.min);

        this.progressElement.style.setProperty("--value", `${progress}`);
    }
}
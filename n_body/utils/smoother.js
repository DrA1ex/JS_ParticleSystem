export class DataSmoother {
    constructor(count, dropFirstCount = 0, filter = false) {
        this.count = count;
        this.dropCount = dropFirstCount;
        this.filter = filter;
        this.smoothedValue = 0;

        this._historyIndex = 0;
        this._historyValues = [];
        this._historySum = 0;
    }

    postValue(value, force = false) {
        if (!force && this.dropCount > 0) {
            this.dropCount -= 1;
            return;
        }
        if (!force && this.filter && this._historyValues.length > 0) {
            value = this._filter(value);
        }

        this._historySum += value
        if (this._historyValues.length < this.count) {
            this._historyValues.push(value);
        } else {
            this._historySum -= this._historyValues[this._historyIndex];
            this._historyValues[this._historyIndex] = value;
        }

        this._historyIndex = (this._historyIndex + 1) % this.count;
        this.smoothedValue = this._historySum / this._historyValues.length;
        return this.smoothedValue;
    }

    _filter(value) {
        if (this.smoothedValue !== 0) {
            if (value > this.smoothedValue) {
                value = Math.min(value, this.smoothedValue * 2);
            } else if (value < this.smoothedValue) {
                value = Math.max(value, this.smoothedValue / 2);
            }
        }

        return value;
    }
}
const EPSILON = 0.1e-6;

class BoundaryRect {
    constructor(left, top, right, bottom) {
        this.left = left;
        this.top = top;
        this.right = right;
        this.bottom = bottom;

        this._height = null;
        this._width = null;
        this._center = null;
    }

    get width() {
        if (this._width === null) {
            this._width = this.right - this.left;
        }
        return this._width;
    }

    get height() {
        if (this._height === null) {
            this._height = this.bottom - this.top;
        }
        return this._height;
    }

    static fromData(data) {
        let minX = data[0].x, maxX = data[0].x,
            minY = data[0].y, maxY = data[0].y;

        for (let i = 1; i < data.length; i++) {
            const x = data[i].x;
            if (minX > x) minX = x
            if (maxX < x) maxX = x

            const y = data[i].y;
            if (minY > y) minY = y;
            if (maxY < y) maxY = y;
        }

        return new BoundaryRect(minX, minY, maxX, maxY);
    }

    contains(particle) {
        return particle.x >= this.left && particle.x < this.right &&
            particle.y >= this.top && particle.y < this.bottom;
    }

    center() {
        if (this._center === null) {
            this._center = {x: this.left + this.width / 2, y: this.top + this.height / 2};
        }

        return this._center;
    }
}


class Leaf {
    /**
     * @param {SpatialTree} tree
     * @param {Particle[]} data
     * @param {number} [depth=1]
     * @param {BoundaryRect|null} [rect = null]
     */
    constructor(tree, data, depth = 1, rect = null) {
        this.tree = tree;
        this.data = data;
        this.depth = depth;
        this.length = data.length;
        this.children = [];
        this.boundaryRect = rect || BoundaryRect.fromData(data);
        this.mass = data.reduce((p, c) => p + c.mass, 0);

        this.index = this.tree._getIndex();
    }

    appendChild(data, rect = null) {
        const leaf = new Leaf(this.tree, data, this.depth + 1, rect);
        this.children.push(leaf);

        return leaf;
    }

    filterByRect(rect) {
        return this.data.filter(p => rect.contains(p));
    }
}

export class SpatialTree {
    /**
     * @param {Array<Particle>} data
     * @param {number} maxCount
     * @param {number} [divideFactor=4]
     * @param {number} [randomness=0.25]
     */
    constructor(data, maxCount, divideFactor = 2, randomness = 0.25) {
        this._index = 0;
        this.maxDepth = 0;

        this.root = new Leaf(this, data);
        this.maxCount = maxCount;
        this.divideFactor = divideFactor;
        this.randomness = randomness;

        this._populate(this.root, data)
    }

    _populate(current) {
        if (current.length <= this.maxCount) {
            if (current.depth > this.maxDepth) {
                this.maxDepth = current.depth;
            }

            return;
        }

        const boundary = current.boundaryRect;

        let lastLeft = 0;
        for (let x = 0; x < this.divideFactor; x++) {
            let xStep
            if (x + 1 !== this.divideFactor) {
                xStep = this._getNextStep(boundary.width);
            } else {
                xStep = boundary.width - lastLeft + EPSILON;
            }

            let lastTop = 0;
            for (let y = 0; y < this.divideFactor; y++) {
                let yStep;
                if (y + 1 !== this.divideFactor) {
                    yStep = this._getNextStep(boundary.height);
                } else {
                    yStep = boundary.height - lastTop + EPSILON;
                }

                let left = boundary.left + lastLeft;
                let top = boundary.top + lastTop;
                const filterRect = new BoundaryRect(left, top, left + xStep, top + yStep);
                const rectData = current.filterByRect(filterRect);

                if (rectData.length > 0) {
                    const leaf = current.appendChild(rectData, filterRect);
                    this._populate(leaf);
                }

                lastTop += yStep;
            }

            lastLeft += xStep;
        }
    }

    _getNextStep(size) {
        return size * ((1 + (this.randomness * (Math.random() - 0.5))) / this.divideFactor);
    }

    _getIndex() {
        return ++this._index;
    }

    getDebugData() {
        const result = [];
        this._collectLeafDebugData(this.root, result);

        return result;
    }

    _collectLeafDebugData(leaf, out) {
        const rect = leaf.boundaryRect;
        out.push({
            x: rect.left, y: rect.top,
            width: rect.width, height: rect.height,
            count: leaf.length, depth: leaf.depth
        });

        for (let i = 0; i < leaf.children.length; i++) {
            this._collectLeafDebugData(leaf.children[i], out);
        }
    }
}
const EPSILON = 0.1e-6;

class BoundaryBox {

    /**
     * @param {number} left
     * @param {number} top
     * @param {number }right
     * @param {number} bottom
     * @param {number} far
     * @param {number} near
     */
    constructor(left, top, right, bottom, far, near) {
        this.left = left;
        this.top = top;
        this.right = right;
        this.bottom = bottom;
        this.far = far;
        this.near = near;

        this._height = null;
        this._width = null;
        this._depth = null;
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

    get depth() {
        if (this._depth === null) {
            this._depth = this.near - this.far;
        }

        return this._depth;
    }

    /**
     * @param {Particle} particle
     * @return {boolean}
     */
    contains(particle) {
        return particle.x >= this.left && particle.x < this.right &&
            particle.y >= this.top && particle.y < this.bottom &&
            particle.z >= this.far && particle.z < this.near;
    }

    /**
     * @return {PositionVector}
     */
    center() {
        if (this._center === null) {
            this._center = {x: this.left + this.width / 2, y: this.top + this.height / 2, z: this.far + this.depth / 2};
        }

        return this._center;
    }

    /**
     * @param {Particle[]} data
     * @return {BoundaryBox}
     */
    static fromData(data) {
        let minX = data[0].x, maxX = data[0].x,
            minY = data[0].y, maxY = data[0].y,
            minZ = data[0].z, maxZ = data[0].z;

        for (let i = 1; i < data.length; i++) {
            const x = data[i].x;
            if (minX > x) minX = x
            if (maxX < x) maxX = x

            const y = data[i].y;
            if (minY > y) minY = y;
            if (maxY < y) maxY = y;

            const z = data[i].z;
            if (minZ > z) minZ = z;
            if (maxZ < z) maxZ = z;
        }

        return new BoundaryBox(minX, minY, maxX, maxY, minZ, maxZ);
    }
}


class Leaf {
    /**
     * @param {SpatialTree} tree
     * @param {Particle[]} data
     * @param {number=1} depth
     * @param {BoundaryBox|null} rect
     */
    constructor(tree, data, depth = 1, rect = null) {
        this.tree = tree;
        this.data = data;
        this.depth = depth;
        this.length = data.length;
        this.children = [];
        this.boundaryBox = rect || BoundaryBox.fromData(data);
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
     * @param {number=4} divideFactor
     */
    constructor(data, maxCount, divideFactor = 2) {
        this._index = 0;
        this.maxDepth = 0;

        this.root = new Leaf(this, data);
        this.maxCount = maxCount;
        this.divideFactor = divideFactor;
        this.is2D = this.root.boundaryBox.depth === 0;

        this._populate(this.root, data)
    }

    _populate(current) {
        if (current.length <= this.maxCount) {
            if (current.depth > this.maxDepth) {
                this.maxDepth = current.depth;
            }

            return;
        }

        const boundary = current.boundaryBox;
        const xStep = boundary.width / this.divideFactor;
        const yStep = boundary.height / this.divideFactor;

        if (this.is2D) {
            for (let x = 0; x < this.divideFactor; x++) {
                for (let y = 0; y < this.divideFactor; y++) {
                    const filterRect = this._getFilterRect(boundary, x, y, 0, xStep, yStep, EPSILON);
                    this._processSubBox(current, boundary, x, y, 0, filterRect);
                }
            }
        } else {
            const zStep = boundary.depth / this.divideFactor;
            for (let x = 0; x < this.divideFactor; x++) {
                for (let y = 0; y < this.divideFactor; y++) {
                    for (let z = 0; z < this.divideFactor; z++) {
                        const filterRect = this._getFilterRect(boundary, x, y, z, xStep, yStep, zStep);
                        this._processSubBox(current, boundary, x, y, z, filterRect);
                    }
                }
            }
        }
    }

    _processSubBox(current, boundary, x, y, z, filterRect) {
        if (x + 1 === this.divideFactor) {
            filterRect.right += EPSILON;
        }
        if (y + 1 === this.divideFactor) {
            filterRect.bottom += EPSILON;
        }
        if (z + 1 === this.divideFactor) {
            filterRect.near += EPSILON;
        }

        const rectData = current.filterByRect(filterRect);
        if (rectData.length > 0) {
            const leaf = current.appendChild(rectData, filterRect);
            this._populate(leaf);
        }
    }

    _getFilterRect(boundary, x, y, z, xStep, yStep, zStep) {
        const left = boundary.left + x * xStep
        const top = boundary.top + y * yStep;
        const far = boundary.far + z * zStep;
        return new BoundaryBox(left, top, left + xStep, top + yStep, far, far + zStep);
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
        const rect = leaf.boundaryBox;
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
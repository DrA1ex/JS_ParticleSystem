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
        let mass = 0;
        let momentX = 0;
        let momentY = 0;
        for (let i = 0; i < data.length; i++) {
            const particle = data[i];
            mass += particle.mass;
            momentX += particle.x * particle.mass;
            momentY += particle.y * particle.mass;
        }
        this.mass = mass;
        const geometricCenter = this.boundaryRect.center();
        this.centerX = mass !== 0 && Number.isFinite(momentX / mass)
            ? momentX / mass
            : geometricCenter.x;
        this.centerY = mass !== 0 && Number.isFinite(momentY / mass)
            ? momentY / mass
            : geometricCenter.y;
        // Keep the aggregate compatible with force helpers that consume an
        // x/y position object, avoiding temporary allocations during traversal.
        this.x = this.centerX;
        this.y = this.centerY;

        this.index = this.tree._getIndex();
    }

    appendChild(data, rect = null) {
        const leaf = new Leaf(this.tree, data, this.depth + 1, rect);
        this.children.push(leaf);

        return leaf;
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

        this._populate(this.root, data);
    }

    _populate(current) {
        if (current.length <= this.maxCount || this._isTooSmallToSplit(current.boundaryRect)) {
            this._markLeaf(current);
            return;
        }

        const boundary = current.boundaryRect;
        const xEdges = this._buildEdges(boundary.left, boundary.width);
        const yEdges = this._buildEdges(boundary.top, boundary.height);
        const bucketsCount = this.divideFactor * this.divideFactor;
        const buckets = new Array(bucketsCount);
        let usedBuckets = 0;

        // Split once per node by assigning particles to buckets. The previous
        // implementation filtered the same array for every child rectangle,
        // which made high divideFactor values much more expensive.
        for (let i = 0; i < current.length; i++) {
            const particle = current.data[i];
            const x = this._findEdgeIndex(particle.x, xEdges);
            const y = this._findEdgeIndex(particle.y, yEdges);
            const bucketIndex = x * this.divideFactor + y;

            let bucket = buckets[bucketIndex];
            if (!bucket) {
                bucket = buckets[bucketIndex] = [];
                usedBuckets += 1;
            }
            bucket.push(particle);
        }

        if (usedBuckets === 0 || (usedBuckets === 1 && this._hasSinglePoint(current.data))) {
            this._markLeaf(current);
            return;
        }

        for (let x = 0; x < this.divideFactor; x++) {
            for (let y = 0; y < this.divideFactor; y++) {
                const bucket = buckets[x * this.divideFactor + y];
                if (!bucket || bucket.length === 0) {
                    continue;
                }

                const rect = new BoundaryRect(xEdges[x], yEdges[y], xEdges[x + 1], yEdges[y + 1]);
                const leaf = current.appendChild(bucket, rect);
                this._populate(leaf);
            }
        }

        current.data = null;
    }

    _markLeaf(current) {
        if (current.depth > this.maxDepth) {
            this.maxDepth = current.depth;
        }
    }

    _isTooSmallToSplit(boundary) {
        return boundary.width <= EPSILON && boundary.height <= EPSILON;
    }

    _buildEdges(start, size) {
        const edges = new Array(this.divideFactor + 1);
        const weights = new Array(this.divideFactor);
        let totalWeight = 0;

        // Keep the original randomized split, but materialize all edges first
        // so particle bucketing is deterministic within this node.
        for (let i = 0; i < this.divideFactor; i++) {
            const weight = 1 + this.randomness * (Math.random() - 0.5);
            weights[i] = weight;
            totalWeight += weight;
        }

        edges[0] = start;
        let offset = 0;
        for (let i = 1; i < this.divideFactor; i++) {
            offset += size * weights[i - 1] / totalWeight;
            edges[i] = start + offset;
        }

        edges[this.divideFactor] = start + size + EPSILON;
        return edges;
    }

    _findEdgeIndex(value, edges) {
        for (let i = 1; i < edges.length; i++) {
            if (value < edges[i]) {
                return i - 1;
            }
        }

        return edges.length - 2;
    }

    _hasSinglePoint(data) {
        if (data.length < 2) {
            return true;
        }

        const x = data[0].x;
        const y = data[0].y;
        for (let i = 1; i < data.length; i++) {
            if (Math.abs(data[i].x - x) > EPSILON || Math.abs(data[i].y - y) > EPSILON) {
                return false;
            }
        }

        return true;
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
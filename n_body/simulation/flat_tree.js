import {ITEM_SIZE} from "../utils/particles.js";

const EPSILON = 0.1e-6;

class FlatBoundaryRect {
    constructor(left, top, right, bottom) {
        this.left = left;
        this.top = top;
        this.right = right;
        this.bottom = bottom;
        this.width = right - left;
        this.height = bottom - top;
        this.centerX = left + this.width / 2;
        this.centerY = top + this.height / 2;
    }

    static fromRange(particles, indices, start, count) {
        const firstOffset = indices[start] * ITEM_SIZE;
        let minX = particles[firstOffset], maxX = particles[firstOffset],
            minY = particles[firstOffset + 1], maxY = particles[firstOffset + 1];

        const end = start + count;
        for (let i = start + 1; i < end; i++) {
            const offset = indices[i] * ITEM_SIZE;
            const x = particles[offset];
            if (minX > x) minX = x;
            if (maxX < x) maxX = x;

            const y = particles[offset + 1];
            if (minY > y) minY = y;
            if (maxY < y) maxY = y;
        }

        return new FlatBoundaryRect(minX, minY, maxX, maxY);
    }
}

class FlatLeaf {
    constructor(tree, start, count, depth = 1, rect = null) {
        this.tree = tree;
        this.start = start;
        this.count = count;
        this.length = count;
        this.depth = depth;
        this.children = [];
        this.boundaryRect = rect || FlatBoundaryRect.fromRange(tree.particles, tree.indices, start, count);
        this.mass = tree.sumMass(start, count);
        this.tree._registerNode();
    }

    appendChild(start, count, rect = null) {
        const leaf = new FlatLeaf(this.tree, start, count, this.depth + 1, rect);
        this.children.push(leaf);
        return leaf;
    }
}

export class FlatSpatialTree {
    constructor(particles, maxCount, divideFactor = 2, randomness = 0.25, workspace = null) {
        this.particles = particles;
        this.count = Math.floor(particles.length / ITEM_SIZE);
        this.maxCount = maxCount;
        this.divideFactor = divideFactor;
        this.randomness = randomness;
        this.nodeCount = 0;
        this.maxDepth = 0;

        workspace = this._prepareWorkspace(workspace);
        this.indices = workspace.indices;
        this._scratchIndices = workspace.scratchIndices;
        this._identityIndices = workspace.identityIndices;
        this.indices.set(this._identityIndices.subarray(0, this.count), 0);

        this._bucketsCount = this.divideFactor * this.divideFactor;
        this._bucketCounts = workspace.bucketCounts;
        this._bucketStarts = workspace.bucketStarts;
        this._bucketWrites = workspace.bucketWrites;

        this.root = new FlatLeaf(this, 0, this.count);
        this._populate(this.root);
    }

    _prepareWorkspace(workspace) {
        const bucketsCount = this.divideFactor * this.divideFactor;
        if (!workspace) {
            workspace = {};
        }

        if (!workspace.indices || workspace.indices.length < this.count) {
            workspace.indices = new Int32Array(this.count);
            workspace.scratchIndices = new Int32Array(this.count);
            workspace.identityIndices = new Int32Array(this.count);
            for (let i = 0; i < this.count; i++) {
                workspace.identityIndices[i] = i;
            }
        }

        if (!workspace.bucketCounts || workspace.bucketCounts.length < bucketsCount) {
            workspace.bucketCounts = new Int32Array(bucketsCount);
            workspace.bucketStarts = new Int32Array(bucketsCount);
            workspace.bucketWrites = new Int32Array(bucketsCount);
        }

        return workspace;
    }

    sumMass(start, count) {
        let mass = 0;
        const end = start + count;
        for (let i = start; i < end; i++) {
            mass += this.particles[this.indices[i] * ITEM_SIZE + 4];
        }
        return mass;
    }

    _populate(current) {
        if (current.count <= this.maxCount || this._isTooSmallToSplit(current.boundaryRect)) {
            this._markLeaf(current);
            return;
        }

        const boundary = current.boundaryRect;
        const xEdges = this._buildEdges(boundary.left, boundary.width);
        const yEdges = this._buildEdges(boundary.top, boundary.height);
        const bucketCounts = this._bucketCounts;
        const bucketStarts = this._bucketStarts;
        const bucketWrites = this._bucketWrites;
        const bucketsCount = this._bucketsCount;
        const indices = this.indices;
        const scratch = this._scratchIndices;
        const particles = this.particles;
        const divideFactor = this.divideFactor;
        const start = current.start;
        const end = start + current.count;

        bucketCounts.fill(0);

        // Partition the current index range in two passes. This keeps the tree
        // build O(n) per node without allocating arrays of particles for every
        // child bucket.
        let usedBuckets = 0;
        for (let i = start; i < end; i++) {
            const offset = indices[i] * ITEM_SIZE;
            const x = this._findEdgeIndex(particles[offset], xEdges);
            const y = this._findEdgeIndex(particles[offset + 1], yEdges);
            const bucketIndex = x * divideFactor + y;

            if (bucketCounts[bucketIndex] === 0) {
                usedBuckets += 1;
            }
            bucketCounts[bucketIndex] += 1;
        }

        if (usedBuckets === 0 || (usedBuckets === 1 && this._hasSinglePoint(start, current.count))) {
            this._markLeaf(current);
            return;
        }

        let writeStart = start;
        for (let i = 0; i < bucketsCount; i++) {
            bucketStarts[i] = writeStart;
            bucketWrites[i] = writeStart;
            writeStart += bucketCounts[i];
        }

        for (let i = start; i < end; i++) {
            const particleIndex = indices[i];
            const offset = particleIndex * ITEM_SIZE;
            const x = this._findEdgeIndex(particles[offset], xEdges);
            const y = this._findEdgeIndex(particles[offset + 1], yEdges);
            const bucketIndex = x * divideFactor + y;
            scratch[bucketWrites[bucketIndex]++] = particleIndex;
        }

        indices.set(scratch.subarray(start, end), start);

        const children = [];
        for (let x = 0; x < divideFactor; x++) {
            for (let y = 0; y < divideFactor; y++) {
                const bucketIndex = x * divideFactor + y;
                const count = bucketCounts[bucketIndex];
                if (count === 0) {
                    continue;
                }

                const rect = new FlatBoundaryRect(xEdges[x], yEdges[y], xEdges[x + 1], yEdges[y + 1]);
                children.push(current.appendChild(bucketStarts[bucketIndex], count, rect));
            }
        }

        for (let i = 0; i < children.length; i++) {
            this._populate(children[i]);
        }
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

        // Preserve the original randomized grid split. The last edge is widened
        // by EPSILON so particles on the right/bottom boundary still fall into
        // the final bucket.
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

    _hasSinglePoint(start, count) {
        if (count < 2) {
            return true;
        }

        const firstOffset = this.indices[start] * ITEM_SIZE;
        const x = this.particles[firstOffset];
        const y = this.particles[firstOffset + 1];
        const end = start + count;

        for (let i = start + 1; i < end; i++) {
            const offset = this.indices[i] * ITEM_SIZE;
            if (Math.abs(this.particles[offset] - x) > EPSILON || Math.abs(this.particles[offset + 1] - y) > EPSILON) {
                return false;
            }
        }
        return true;
    }

    _registerNode() {
        this.nodeCount += 1;
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
            count: leaf.count, depth: leaf.depth
        });

        for (let i = 0; i < leaf.children.length; i++) {
            this._collectLeafDebugData(leaf.children[i], out);
        }
    }
}

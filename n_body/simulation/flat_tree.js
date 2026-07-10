import {ITEM_SIZE} from "../utils/particles.js";

const EPSILON = 0.1e-6;
const BUFFER_A = 0;
const BUFFER_B = 1;

function nextCapacity(required, current = 0) {
    let capacity = Math.max(16, current || 16);
    while (capacity < required) {
        capacity *= 2;
    }
    return capacity;
}

function growArray(ArrayType, current, capacity) {
    if (current && current.length >= capacity) {
        return current;
    }

    const next = new ArrayType(capacity);
    if (current) {
        next.set(current.subarray(0, Math.min(current.length, capacity)));
    }
    return next;
}

// Flat spatial tree used by the optimized CPU backend. Nodes are stored in
// typed-array pools and addressed by node id instead of small JS objects. This
// keeps the tree rebuild allocation-free in the common case and lets physics
// traversal read compact arrays directly.
export class FlatSpatialTree {
    constructor(particles, maxCount, divideFactor = 2, randomness = 0.25, workspace = null, options = {}) {
        this.particles = particles;
        this.particleCount = Math.floor(particles.length / ITEM_SIZE);
        this.count = options.count ?? this.particleCount;
        this._indexCapacity = options.indexCapacity ?? this.particleCount;
        this._rootOptions = options.root ?? null;
        this._skipIndexReset = !!options.skipIndexReset;
        this.maxCount = maxCount;
        this.divideFactor = divideFactor;
        this.randomness = randomness;
        this.nodeCount = 0;
        this.maxDepth = 0;
        this.root = 0;
        this.profile = {
            resetTime: 0,
            rootBoundsTime: 0,
            populateTime: 0,
            aggregateTime: 0,
            partitionCountParticles: 0,
            partitionScatterParticles: 0,
            partitionCountTime: 0,
            partitionScatterTime: 0,
            partitionCountSampleTime: 0,
            partitionScatterSampleTime: 0,
            partitionCountSampleParticles: 0,
            partitionScatterSampleParticles: 0,
            partitionTimingSamples: 0,
            nodeInitCount: 0,
            fastBucketPath: false,
        };

        workspace = this._prepareWorkspace(workspace);
        this._workspace = workspace;

        this.indices = workspace.indices;
        this._scratchIndices = workspace.scratchIndices;
        this.indexBuffers = workspace.indexBuffers;
        this._identityIndices = workspace.identityIndices;
        let profileStart = performance.now();
        if (!this._skipIndexReset) {
            this.indices.set(this._identityIndices.subarray(0, this.count), 0);
        }
        this.profile.resetTime = performance.now() - profileStart;

        this._bucketsCount = this.divideFactor * this.divideFactor;
        this._bucketCounts = workspace.bucketCounts;
        this._bucketStarts = workspace.bucketStarts;
        this._bucketWrites = workspace.bucketWrites;
        this._bucketIds = workspace.bucketIds;
        this._xEdges = workspace.xEdges;
        this._yEdges = workspace.yEdges;
        this._weights = workspace.weights;

        this.nodeStart = workspace.nodeStart;
        this.nodeParticleCount = workspace.nodeParticleCount;
        this.nodeDepth = workspace.nodeDepth;
        this.nodeIndexBuffer = workspace.nodeIndexBuffer;
        this.nodeFirstChild = workspace.nodeFirstChild;
        this.nodeChildCount = workspace.nodeChildCount;
        this.nodeLeft = workspace.nodeLeft;
        this.nodeTop = workspace.nodeTop;
        this.nodeRight = workspace.nodeRight;
        this.nodeBottom = workspace.nodeBottom;
        this.nodeCenterX = workspace.nodeCenterX;
        this.nodeCenterY = workspace.nodeCenterY;
        this.nodeMass = workspace.nodeMass;

        if (this.count === 0) {
            this.root = this._createNode(0, 0, BUFFER_A, 1, 0, 0, 0, 0);
            this._markLeaf(this.root);
            return;
        }

        if (this._rootOptions) {
            const root = this._rootOptions;
            this.root = this._createNode(root.start, root.count, root.indexBuffer, root.depth ?? 1,
                root.left, root.top, root.right, root.bottom);
        } else {
            profileStart = performance.now();
            const rootBounds = this._calculateRangeBounds(this.indices, 0, this.count);
            this.profile.rootBoundsTime = performance.now() - profileStart;

            this.root = this._createNode(0, this.count, BUFFER_A, 1,
                rootBounds.left, rootBounds.top, rootBounds.right, rootBounds.bottom);
        }

        profileStart = performance.now();
        const initialTargetBuffer = this._rootOptions ? 1 - this.nodeIndexBuffer[this.root] : BUFFER_B;
        this._populate(this.root, initialTargetBuffer);
        this.profile.populateTime = performance.now() - profileStart;
        if (this.profile.partitionCountSampleParticles > 0) {
            this.profile.partitionCountTime = this.profile.partitionCountSampleTime *
                this.profile.partitionCountParticles / this.profile.partitionCountSampleParticles;
        }
        if (this.profile.partitionScatterSampleParticles > 0) {
            this.profile.partitionScatterTime = this.profile.partitionScatterSampleTime *
                this.profile.partitionScatterParticles / this.profile.partitionScatterSampleParticles;
        }

        profileStart = performance.now();
        this._aggregateMassBottomUp();
        this.profile.aggregateTime = performance.now() - profileStart;
        this.profile.fastBucketPath = this.divideFactor === 2;
    }

    _prepareWorkspace(workspace) {
        const bucketsCount = this.divideFactor * this.divideFactor;
        if (!workspace) {
            workspace = {};
        }

        if (!workspace.indices || workspace.indices.length < this._indexCapacity) {
            workspace.indices = new Int32Array(this._indexCapacity);
            workspace.scratchIndices = new Int32Array(this._indexCapacity);
            workspace.identityIndices = new Int32Array(this._indexCapacity);
            for (let i = 0; i < this._indexCapacity; i++) {
                workspace.identityIndices[i] = i;
            }
        }

        if (!workspace.bucketIds || workspace.bucketIds.length < this.count) {
            workspace.bucketIds = new Int16Array(this.count);
        }

        if (!workspace.bucketCounts || workspace.bucketCounts.length < bucketsCount) {
            workspace.bucketCounts = new Int32Array(bucketsCount);
            workspace.bucketStarts = new Int32Array(bucketsCount);
            workspace.bucketWrites = new Int32Array(bucketsCount);
        }

        if (!workspace.xEdges || workspace.xEdges.length < this.divideFactor + 1) {
            workspace.xEdges = new Float64Array(this.divideFactor + 1);
            workspace.yEdges = new Float64Array(this.divideFactor + 1);
            workspace.weights = new Float64Array(this.divideFactor);
        }

        workspace.indexBuffers = [workspace.indices, workspace.scratchIndices];

        const estimatedLeafCount = Math.ceil(this.count / Math.max(1, this.maxCount));
        const initialNodeCapacity = nextCapacity(Math.max(16, estimatedLeafCount * 4), workspace.nodeCapacity || 0);
        this._ensureNodeCapacity(workspace, initialNodeCapacity, 0);

        return workspace;
    }

    _ensureNodeCapacity(workspace, required, usedCount = this.nodeCount) {
        if (workspace.nodeCapacity >= required) {
            return;
        }

        const capacity = nextCapacity(required, workspace.nodeCapacity || 16);
        workspace.nodeStart = growArray(Int32Array, workspace.nodeStart, capacity);
        workspace.nodeParticleCount = growArray(Int32Array, workspace.nodeParticleCount, capacity);
        workspace.nodeDepth = growArray(Int16Array, workspace.nodeDepth, capacity);
        workspace.nodeIndexBuffer = growArray(Int8Array, workspace.nodeIndexBuffer, capacity);
        workspace.nodeFirstChild = growArray(Int32Array, workspace.nodeFirstChild, capacity);
        workspace.nodeChildCount = growArray(Int16Array, workspace.nodeChildCount, capacity);
        workspace.nodeLeft = growArray(Float64Array, workspace.nodeLeft, capacity);
        workspace.nodeTop = growArray(Float64Array, workspace.nodeTop, capacity);
        workspace.nodeRight = growArray(Float64Array, workspace.nodeRight, capacity);
        workspace.nodeBottom = growArray(Float64Array, workspace.nodeBottom, capacity);
        workspace.nodeCenterX = growArray(Float64Array, workspace.nodeCenterX, capacity);
        workspace.nodeCenterY = growArray(Float64Array, workspace.nodeCenterY, capacity);
        workspace.nodeMass = growArray(Float64Array, workspace.nodeMass, capacity);
        workspace.nodeCapacity = capacity;

        // If arrays are grown after the tree object has already cached them,
        // refresh local references so the rest of the build writes to the new
        // buffers. This path is rare because capacity is estimated up-front.
        if (usedCount > 0) {
            this.nodeStart = workspace.nodeStart;
            this.nodeParticleCount = workspace.nodeParticleCount;
            this.nodeDepth = workspace.nodeDepth;
            this.nodeIndexBuffer = workspace.nodeIndexBuffer;
            this.nodeFirstChild = workspace.nodeFirstChild;
            this.nodeChildCount = workspace.nodeChildCount;
            this.nodeLeft = workspace.nodeLeft;
            this.nodeTop = workspace.nodeTop;
            this.nodeRight = workspace.nodeRight;
            this.nodeBottom = workspace.nodeBottom;
            this.nodeCenterX = workspace.nodeCenterX;
            this.nodeCenterY = workspace.nodeCenterY;
            this.nodeMass = workspace.nodeMass;
        }
    }

    _createNode(start, count, indexBufferId, depth, left, top, right, bottom) {
        this._ensureNodeCapacity(this._workspace, this.nodeCount + 1);
        const nodeId = this.nodeCount++;
        this.profile.nodeInitCount += 1;

        this.nodeStart[nodeId] = start;
        this.nodeParticleCount[nodeId] = count;
        this.nodeDepth[nodeId] = depth;
        this.nodeIndexBuffer[nodeId] = indexBufferId;
        this.nodeFirstChild[nodeId] = -1;
        this.nodeChildCount[nodeId] = 0;
        this.nodeLeft[nodeId] = left;
        this.nodeTop[nodeId] = top;
        this.nodeRight[nodeId] = right;
        this.nodeBottom[nodeId] = bottom;
        this.nodeCenterX[nodeId] = left + (right - left) / 2;
        this.nodeCenterY[nodeId] = top + (bottom - top) / 2;
        this.nodeMass[nodeId] = 0;

        return nodeId;
    }

    _calculateRangeBounds(indices, start, count) {
        const firstOffset = indices[start] * ITEM_SIZE;
        let minX = this.particles[firstOffset];
        let maxX = minX;
        let minY = this.particles[firstOffset + 1];
        let maxY = minY;
        const end = start + count;

        for (let i = start + 1; i < end; i++) {
            const offset = indices[i] * ITEM_SIZE;
            const x = this.particles[offset];
            if (minX > x) minX = x;
            if (maxX < x) maxX = x;

            const y = this.particles[offset + 1];
            if (minY > y) minY = y;
            if (maxY < y) maxY = y;
        }

        return {left: minX, top: minY, right: maxX, bottom: maxY};
    }

    _populate(nodeId, targetBufferId) {
        const count = this.nodeParticleCount[nodeId];
        if (count <= this.maxCount || this._isTooSmallToSplit(nodeId)) {
            this._markLeaf(nodeId);
            return;
        }

        const sourceBufferId = this.nodeIndexBuffer[nodeId];
        const sourceIndices = this.indexBuffers[sourceBufferId];
        const targetIndices = this.indexBuffers[targetBufferId];
        const xEdges = this._xEdges;
        const yEdges = this._yEdges;
        const left = this.nodeLeft[nodeId];
        const top = this.nodeTop[nodeId];
        const width = this.nodeRight[nodeId] - left;
        const height = this.nodeBottom[nodeId] - top;
        this._buildEdges(xEdges, left, width);
        this._buildEdges(yEdges, top, height);

        const bucketCounts = this._bucketCounts;
        const bucketStarts = this._bucketStarts;
        const bucketWrites = this._bucketWrites;
        const bucketIds = this._bucketIds;
        const bucketsCount = this._bucketsCount;
        const particles = this.particles;
        const divideFactor = this.divideFactor;
        const start = this.nodeStart[nodeId];
        const end = start + count;

        bucketCounts.fill(0);

        // Counting pass: compute the child bucket once and remember it. The
        // scatter pass can then move only integer particle ids without reading
        // x/y again or repeating edge lookup. The common 2x2 split has a
        // specialized branch because it is by far the hottest tree-build path:
        // avoid function calls and the generic edge loop for every particle at
        // every tree level.
        this.profile.partitionCountParticles += count;
        const measurePartitionTiming = (nodeId & 255) === 0;
        let partitionTimer = measurePartitionTiming ? performance.now() : 0;
        if (measurePartitionTiming) {
            this.profile.partitionTimingSamples += 1;
        }

        let usedBuckets = 0;
        if (divideFactor === 2) {
            const xMid = xEdges[1];
            const yMid = yEdges[1];
            for (let i = start; i < end; i++) {
                const particleIndex = sourceIndices[i];
                const offset = particleIndex * ITEM_SIZE;
                const bucketIndex = (particles[offset] < xMid ? 0 : 2) + (particles[offset + 1] < yMid ? 0 : 1);

                bucketIds[i - start] = bucketIndex;
                if (bucketCounts[bucketIndex] === 0) {
                    usedBuckets += 1;
                }
                bucketCounts[bucketIndex] += 1;
            }
        } else {
            for (let i = start; i < end; i++) {
                const offset = sourceIndices[i] * ITEM_SIZE;
                const x = this._findEdgeIndex(particles[offset], xEdges);
                const y = this._findEdgeIndex(particles[offset + 1], yEdges);
                const bucketIndex = x * divideFactor + y;

                bucketIds[i - start] = bucketIndex;
                if (bucketCounts[bucketIndex] === 0) {
                    usedBuckets += 1;
                }
                bucketCounts[bucketIndex] += 1;
            }
        }

        if (measurePartitionTiming) {
            this.profile.partitionCountSampleTime += performance.now() - partitionTimer;
            this.profile.partitionCountSampleParticles += count;
        }

        if (usedBuckets === 0 || (usedBuckets === 1 && this._hasSinglePoint(nodeId))) {
            this._markLeaf(nodeId);
            return;
        }

        let writeStart = start;
        for (let i = 0; i < bucketsCount; i++) {
            bucketStarts[i] = writeStart;
            bucketWrites[i] = writeStart;
            writeStart += bucketCounts[i];
        }

        this.profile.partitionScatterParticles += count;
        partitionTimer = measurePartitionTiming ? performance.now() : 0;
        for (let i = start; i < end; i++) {
            const bucketIndex = bucketIds[i - start];
            targetIndices[bucketWrites[bucketIndex]++] = sourceIndices[i];
        }
        if (measurePartitionTiming) {
            this.profile.partitionScatterSampleTime += performance.now() - partitionTimer;
            this.profile.partitionScatterSampleParticles += count;
        }

        // Children are allocated back-to-back before recursion, so each parent
        // can store a compact firstChild/childCount pair instead of a JS array.
        const firstChild = this.nodeCount;
        let childCount = 0;
        const childDepth = this.nodeDepth[nodeId] + 1;

        if (divideFactor === 2) {
            for (let bucketIndex = 0; bucketIndex < 4; bucketIndex++) {
                const bucketCount = bucketCounts[bucketIndex];
                if (bucketCount === 0) {
                    continue;
                }
                const x = bucketIndex >> 1;
                const y = bucketIndex & 1;
                this._createNode(bucketStarts[bucketIndex], bucketCount, targetBufferId, childDepth,
                    xEdges[x], yEdges[y], xEdges[x + 1], yEdges[y + 1]);
                childCount += 1;
            }
        } else {
            for (let x = 0; x < divideFactor; x++) {
                for (let y = 0; y < divideFactor; y++) {
                    const bucketIndex = x * divideFactor + y;
                    const bucketCount = bucketCounts[bucketIndex];
                    if (bucketCount === 0) {
                        continue;
                    }

                    this._createNode(bucketStarts[bucketIndex], bucketCount, targetBufferId, childDepth,
                        xEdges[x], yEdges[y], xEdges[x + 1], yEdges[y + 1]);
                    childCount += 1;
                }
            }
        }

        this.nodeFirstChild[nodeId] = firstChild;
        this.nodeChildCount[nodeId] = childCount;

        const nextTargetBufferId = sourceBufferId;
        for (let i = 0; i < childCount; i++) {
            this._populate(firstChild + i, nextTargetBufferId);
        }
    }

    _aggregateMassBottomUp() {
        const particles = this.particles;
        const nodeMass = this.nodeMass;

        // Leaves aggregate particle masses directly. Internal node mass is then
        // calculated bottom-up from child nodes, avoiding one full particle-range
        // mass scan for every internal node during tree construction.
        for (let nodeId = this.nodeCount - 1; nodeId >= 0; nodeId--) {
            const childCount = this.nodeChildCount[nodeId];
            let mass = 0;

            if (childCount === 0) {
                const indices = this.indexBuffers[this.nodeIndexBuffer[nodeId]];
                const start = this.nodeStart[nodeId];
                const end = start + this.nodeParticleCount[nodeId];
                for (let i = start; i < end; i++) {
                    mass += particles[indices[i] * ITEM_SIZE + 4];
                }
            } else {
                const firstChild = this.nodeFirstChild[nodeId];
                for (let i = 0; i < childCount; i++) {
                    mass += nodeMass[firstChild + i];
                }
            }

            nodeMass[nodeId] = mass;
        }
    }

    _markLeaf(nodeId) {
        const depth = this.nodeDepth[nodeId];
        if (depth > this.maxDepth) {
            this.maxDepth = depth;
        }
    }

    _isTooSmallToSplit(nodeId) {
        return this.nodeRight[nodeId] - this.nodeLeft[nodeId] <= EPSILON &&
            this.nodeBottom[nodeId] - this.nodeTop[nodeId] <= EPSILON;
    }

    _buildEdges(edges, start, size) {
        const weights = this._weights;
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
    }

    _findEdgeIndex(value, edges) {
        for (let i = 1; i < edges.length; i++) {
            if (value < edges[i]) {
                return i - 1;
            }
        }
        return edges.length - 2;
    }

    _hasSinglePoint(nodeId) {
        const count = this.nodeParticleCount[nodeId];
        if (count < 2) {
            return true;
        }

        const indices = this.indexBuffers[this.nodeIndexBuffer[nodeId]];
        const start = this.nodeStart[nodeId];
        const firstOffset = indices[start] * ITEM_SIZE;
        const x = this.particles[firstOffset];
        const y = this.particles[firstOffset + 1];
        const end = start + count;

        for (let i = start + 1; i < end; i++) {
            const offset = indices[i] * ITEM_SIZE;
            if (Math.abs(this.particles[offset] - x) > EPSILON || Math.abs(this.particles[offset + 1] - y) > EPSILON) {
                return false;
            }
        }
        return true;
    }

    getDebugData() {
        const result = [];
        for (let nodeId = 0; nodeId < this.nodeCount; nodeId++) {
            result.push({
                x: this.nodeLeft[nodeId],
                y: this.nodeTop[nodeId],
                width: this.nodeRight[nodeId] - this.nodeLeft[nodeId],
                height: this.nodeBottom[nodeId] - this.nodeTop[nodeId],
                count: this.nodeParticleCount[nodeId],
                depth: this.nodeDepth[nodeId]
            });
        }
        return result;
    }
}

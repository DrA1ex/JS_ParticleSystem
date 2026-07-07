import {ITEM_SIZE} from "../utils/particles.js";
import {FlatSpatialTree} from "./flat_tree.js";

// CPU implementation of the existing approximation algorithm over an
// interleaved Float32Array particle buffer. The algorithm is intentionally kept
// close to PhysicsEngine: block-to-block approximation, exact interactions
// inside final leaves, then velocity resistance and position update.
export class FlatPhysicsEngine {
    constructor(settings) {
        this.settings = settings;
        this.stats = {
            treeTime: 0,
            physicsTime: 0,
            tree: {
                flops: 0,
                depth: 0,
                segmentCount: 0
            }
        };
        this._collisionVelX = new Float32Array(0);
        this._collisionVelY = new Float32Array(0);
        this._forceX = new Float32Array(0);
        this._forceY = new Float32Array(0);
        this._treeWorkspace = {};
    }

    get forceX() {return this._forceX;}
    get forceY() {return this._forceY;}

    reconfigure(settings) {
        this.settings = settings;
    }

    step(particles) {
        this._ensureDebugForceBuffers(particles.length / ITEM_SIZE);
        if (this.settings.common.debugForce) {
            this._forceX.fill(0);
            this._forceY.fill(0);
        }

        let t = performance.now();
        const tree = new FlatSpatialTree(particles,
            this.settings.simulation.segmentMaxCount,
            this.settings.simulation.segmentDivider,
            this.settings.simulation.segmentRandomness,
            this._treeWorkspace);
        if (this.settings.common.stats) {
            this.stats.treeTime = performance.now() - t;
        }

        t = performance.now();
        this._calculateTree(tree);
        this._physicsStep(particles);

        if (this.settings.common.stats) {
            this.stats.physicsTime = performance.now() - t;
            this._calcTreeStats(tree);
        }

        return tree;
    }

    _calculateTree(tree) {
        this._calculateLeaf(tree, tree.root, 0, 0);
    }

    _calculateLeaf(tree, leaf, pForceX, pForceY) {
        const blocks = leaf.children;
        if (blocks.length > 0) {
            this._calculateLeafBlock(tree, leaf, pForceX, pForceY);
        } else {
            this._calculateLeafData(tree, leaf, pForceX, pForceY);
            if (this.settings.physics.enableCollision) {
                this._processCollisions(tree, leaf);
            }
        }
    }

    _calculateLeafBlock(tree, leaf, pForceX, pForceY) {
        // Parent force is copied as scalars for each child. Each sibling block
        // contributes one aggregate force based on its mass and rect center,
        // matching the old object-based engine.
        const blocks = leaf.children;
        const particleGravity = this.settings.physics.particleGravity;
        const minInteractionDistanceSq = this.settings.physics.minInteractionDistanceSq;

        for (let i = 0; i < blocks.length; i++) {
            const block = blocks[i];
            const blockRect = block.boundaryRect;
            let forceX = pForceX;
            let forceY = pForceY;

            for (let j = 0; j < blocks.length; j++) {
                if (i === j) continue;
                const otherRect = blocks[j].boundaryRect;
                const dx = blockRect.centerX - otherRect.centerX;
                const dy = blockRect.centerY - otherRect.centerY;
                const distSquare = dx * dx + dy * dy;
                if (distSquare >= minInteractionDistanceSq) {
                    const force = -(particleGravity * blocks[j].mass) / distSquare;
                    forceX += dx * force;
                    forceY += dy * force;
                }
            }

            this._calculateLeaf(tree, block, forceX, forceY);
        }
    }

    _calculateLeafData(tree, leaf, pForceX, pForceY) {
        // Final leaves use exact particle-to-particle interactions. Indices map
        // the compact tree range back to offsets in the shared particle buffer.
        const particles = tree.particles;
        const indices = tree.indices;
        const start = leaf.start;
        const end = start + leaf.count;
        const particleGravity = this.settings.physics.particleGravity;
        const minInteractionDistanceSq = this.settings.physics.minInteractionDistanceSq;
        const accumulateForce = this.settings.common.debugForce;
        const forceXBuffer = this._forceX;
        const forceYBuffer = this._forceY;

        for (let i = start; i < end; i++) {
            const attractorIndex = indices[i];
            const attractorOffset = attractorIndex * ITEM_SIZE;
            const attractorX = particles[attractorOffset];
            const attractorY = particles[attractorOffset + 1];
            const g = particleGravity * particles[attractorOffset + 4];

            particles[attractorOffset + 2] += pForceX;
            particles[attractorOffset + 3] += pForceY;

            for (let j = start; j < end; j++) {
                if (i === j) continue;
                const particleIndex = indices[j];
                const particleOffset = particleIndex * ITEM_SIZE;
                const dx = particles[particleOffset] - attractorX;
                const dy = particles[particleOffset + 1] - attractorY;
                const distSquare = dx * dx + dy * dy;

                if (distSquare >= minInteractionDistanceSq) {
                    const force = -g / distSquare;
                    const vx = dx * force;
                    const vy = dy * force;
                    particles[particleOffset + 2] += vx;
                    particles[particleOffset + 3] += vy;

                    if (accumulateForce) {
                        forceXBuffer[particleIndex] += vx;
                        forceYBuffer[particleIndex] += vy;
                    }
                }
            }
        }
    }

    _processCollisions(tree, leaf) {
        // Collision response must be staged: all next velocities are calculated
        // first, then written back, so earlier particles do not affect later
        // particles within the same collision pass.
        this._ensureCollisionBuffer(leaf.count);
        const particles = tree.particles;
        const indices = tree.indices;
        const start = leaf.start;
        const end = start + leaf.count;
        const nextVelXBuffer = this._collisionVelX;
        const nextVelYBuffer = this._collisionVelY;
        const collisionSizeSq = this.settings.physics.collisionSizeSq;
        const collisionRestitution = this.settings.physics.collisionRestitution;

        for (let i = start; i < end; i++) {
            const p1Index = indices[i];
            const p1Offset = p1Index * ITEM_SIZE;
            const p1X = particles[p1Offset];
            const p1Y = particles[p1Offset + 1];
            const p1Mass = particles[p1Offset + 4];
            let nextVelX = particles[p1Offset + 2];
            let nextVelY = particles[p1Offset + 3];
            let hasCollision = false;

            for (let j = start; j < end; j++) {
                if (i === j) continue;
                const p2Index = indices[j];
                const p2Offset = p2Index * ITEM_SIZE;
                const dx = p1X - particles[p2Offset];
                const dy = p1Y - particles[p2Offset + 1];
                const distSquare = dx * dx + dy * dy;

                if (distSquare > 0 && distSquare < collisionSizeSq) {
                    const p2Mass = particles[p2Offset + 4];
                    const massFactor = 2 * p2Mass / (p1Mass + p2Mass);
                    const dot = massFactor * ((nextVelX - particles[p2Offset + 2]) * dx + (nextVelY - particles[p2Offset + 3]) * dy);
                    nextVelX -= dot / distSquare * dx;
                    nextVelY -= dot / distSquare * dy;
                    hasCollision = true;
                }
            }

            const localIndex = i - start;
            nextVelXBuffer[localIndex] = hasCollision ? nextVelX * collisionRestitution : nextVelX;
            nextVelYBuffer[localIndex] = hasCollision ? nextVelY * collisionRestitution : nextVelY;
        }

        for (let i = start; i < end; i++) {
            const particleIndex = indices[i];
            const particleOffset = particleIndex * ITEM_SIZE;
            const localIndex = i - start;
            const nextVelX = nextVelXBuffer[localIndex];
            const nextVelY = nextVelYBuffer[localIndex];

            if (this.settings.common.debugForce) {
                this._forceX[particleIndex] += nextVelX - particles[particleOffset + 2];
                this._forceY[particleIndex] += nextVelY - particles[particleOffset + 3];
            }

            particles[particleOffset + 2] = nextVelX;
            particles[particleOffset + 3] = nextVelY;
        }
    }

    _ensureCollisionBuffer(length) {
        if (this._collisionVelX.length < length) {
            this._collisionVelX = new Float32Array(length);
            this._collisionVelY = new Float32Array(length);
        }
    }

    _ensureDebugForceBuffers(count) {
        if (this._forceX.length !== count) {
            this._forceX = new Float32Array(count);
            this._forceY = new Float32Array(count);
        }
    }

    _physicsStep(particles) {
        const resistance = this.settings.physics.resistance;
        const count = particles.length / ITEM_SIZE;
        for (let i = 0; i < count; i++) {
            const offset = i * ITEM_SIZE;
            const velX = particles[offset + 2] * resistance;
            const velY = particles[offset + 3] * resistance;
            particles[offset + 2] = velX;
            particles[offset + 3] = velY;
            particles[offset] += velX;
            particles[offset + 1] += velY;
        }
    }

    _calcTreeStats(tree) {
        const flopsPerOp = 14;
        let flops = 0;
        function _processLeaf(parent) {
            if (parent.children.length === 0) {
                flops += Math.pow(parent.count, 2) * flopsPerOp;
                return;
            }
            for (let i = 0; i < parent.children.length; i++) {
                _processLeaf(parent.children[i]);
            }
            flops += Math.pow(parent.children.length, 2) * flopsPerOp;
        }
        _processLeaf(tree.root);
        this.stats.tree.flops = flops;
        this.stats.tree.depth = tree.maxDepth;
        this.stats.tree.segmentCount = tree.nodeCount;
    }

    dispose() {
        this.settings = null;
        this.stats = null;
        this._collisionVelX = null;
        this._collisionVelY = null;
        this._forceX = null;
        this._forceY = null;
        this._treeWorkspace = null;
    }
}

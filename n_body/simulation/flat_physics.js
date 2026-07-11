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
            },
            treeProfile: null,
            profile: {
                forceTime: 0,
                integrateTime: 0,
                statsTime: 0,
                exportTime: 0
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

        if (!this.settings.common.stats) {
            const tree = new FlatSpatialTree(particles,
                this.settings.simulation.segmentMaxCount,
                this.settings.simulation.segmentDivider,
                this.settings.simulation.segmentRandomness,
                this._treeWorkspace);
            this._calculateTree(tree);
            this._physicsStep(particles);
            return tree;
        }

        const profile = this.stats.profile;
        profile.exportTime = 0;

        let t = performance.now();
        const tree = new FlatSpatialTree(particles,
            this.settings.simulation.segmentMaxCount,
            this.settings.simulation.segmentDivider,
            this.settings.simulation.segmentRandomness,
            this._treeWorkspace);
        this.stats.treeTime = performance.now() - t;
        this.stats.treeProfile = tree.profile ? {...tree.profile} : null;

        t = performance.now();
        this._calculateTree(tree);
        profile.forceTime = performance.now() - t;

        t = performance.now();
        this._physicsStep(particles);
        profile.integrateTime = performance.now() - t;

        this.stats.physicsTime = profile.forceTime + profile.integrateTime;

        t = performance.now();
        this._calcTreeStats(tree);
        profile.statsTime = performance.now() - t;

        return tree;
    }

    _calculateTree(tree) {
        this._calculateNode(tree, tree.root, 0, 0);
    }

    _calculateNode(tree, nodeId, pForceX, pForceY) {
        if (tree.nodeChildCount[nodeId] > 0) {
            this._calculateNodeBlock(tree, nodeId, pForceX, pForceY);
        } else {
            this._calculateLeafData(tree, nodeId, pForceX, pForceY);
            if (this.settings.physics.enableCollision) {
                this._processCollisions(tree, nodeId);
            }
        }
    }

    _calculateNodeBlock(tree, nodeId, pForceX, pForceY) {
        // Parent force is copied as scalars for each child. Children are stored
        // contiguously in the tree node-pool, so traversal uses numeric node ids
        // instead of child object arrays.
        const particleGravity = this.settings.physics.particleGravity;
        const minInteractionDistanceSq = this.settings.physics.minInteractionDistanceSq;
        const firstChild = tree.nodeFirstChild[nodeId];
        const childCount = tree.nodeChildCount[nodeId];

        for (let i = 0; i < childCount; i++) {
            const childId = firstChild + i;
            let forceX = pForceX;
            let forceY = pForceY;
            const childCenterX = tree.nodeCenterX[childId];
            const childCenterY = tree.nodeCenterY[childId];

            for (let j = 0; j < childCount; j++) {
                if (i === j) continue;
                const otherId = firstChild + j;
                const dx = childCenterX - tree.nodeCenterX[otherId];
                const dy = childCenterY - tree.nodeCenterY[otherId];
                const distSquare = dx * dx + dy * dy;
                if (distSquare >= minInteractionDistanceSq) {
                    const force = -(particleGravity * tree.nodeMass[otherId]) / distSquare;
                    forceX += dx * force;
                    forceY += dy * force;
                }
            }

            this._calculateNode(tree, childId, forceX, forceY);
        }
    }

    _calculateLeafData(tree, nodeId, pForceX, pForceY) {
        // Final leaves use exact particle-to-particle interactions. Indices map
        // the compact tree range back to offsets in the shared particle buffer.
        const particles = tree.particles;
        const indices = tree.indexBuffers[tree.nodeIndexBuffer[nodeId]];
        const start = tree.nodeStart[nodeId];
        const end = start + tree.nodeParticleCount[nodeId];
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
            if (accumulateForce) {
                forceXBuffer[attractorIndex] += pForceX;
                forceYBuffer[attractorIndex] += pForceY;
            }

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

    _processCollisions(tree, nodeId) {
        // Use a staged Jacobi-style response. Each contact is evaluated from
        // the original velocities, only approaching pairs produce an impulse,
        // and dense multi-contact leaves are normalized so a particle cannot
        // receive an arbitrarily large kick from many simultaneous neighbours.
        const leafCount = tree.nodeParticleCount[nodeId];
        this._ensureCollisionBuffer(leafCount);
        const particles = tree.particles;
        const indices = tree.indexBuffers[tree.nodeIndexBuffer[nodeId]];
        const start = tree.nodeStart[nodeId];
        const end = start + leafCount;
        const nextVelXBuffer = this._collisionVelX;
        const nextVelYBuffer = this._collisionVelY;
        const collisionSizeSq = this.settings.physics.collisionSizeSq;
        const impulseRestitution = 1 + this.settings.physics.collisionRestitution;

        for (let i = start; i < end; i++) {
            const p1Index = indices[i];
            const p1Offset = p1Index * ITEM_SIZE;
            const p1X = particles[p1Offset];
            const p1Y = particles[p1Offset + 1];
            const p1VelX = particles[p1Offset + 2];
            const p1VelY = particles[p1Offset + 3];
            const p1Mass = particles[p1Offset + 4];
            let deltaVelX = 0;
            let deltaVelY = 0;
            let contactCount = 0;

            for (let j = start; j < end; j++) {
                if (i === j) continue;
                const p2Index = indices[j];
                const p2Offset = p2Index * ITEM_SIZE;
                const dx = p1X - particles[p2Offset];
                const dy = p1Y - particles[p2Offset + 1];
                const distSquare = dx * dx + dy * dy;
                if (distSquare <= 0 || distSquare >= collisionSizeSq) continue;

                const relativeDot = (p1VelX - particles[p2Offset + 2]) * dx
                    + (p1VelY - particles[p2Offset + 3]) * dy;
                // Positive means the distance along the contact normal is
                // already increasing. Applying an impulse here caused the old
                // implementation to bounce separating particles back together.
                if (relativeDot >= 0) continue;

                const p2Mass = particles[p2Offset + 4];
                const impulseFactor = -impulseRestitution * p2Mass / (p1Mass + p2Mass)
                    * relativeDot / distSquare;
                deltaVelX += impulseFactor * dx;
                deltaVelY += impulseFactor * dy;
                contactCount += 1;
            }

            const contactScale = contactCount > 1 ? 1 / Math.sqrt(contactCount) : 1;
            const localIndex = i - start;
            nextVelXBuffer[localIndex] = p1VelX + deltaVelX * contactScale;
            nextVelYBuffer[localIndex] = p1VelY + deltaVelY * contactScale;
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

        for (let nodeId = 0; nodeId < tree.nodeCount; nodeId++) {
            const childCount = tree.nodeChildCount[nodeId];
            if (childCount === 0) {
                flops += Math.pow(tree.nodeParticleCount[nodeId], 2) * flopsPerOp;
            } else {
                flops += Math.pow(childCount, 2) * flopsPerOp;
            }
        }

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

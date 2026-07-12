import {ITEM_SIZE} from "../utils/particles.js";
import {FlatSpatialTree} from "./flat_tree.js";
import {COLLISION_MIN_CLOSING_SPEED_SQ, collisionMinDistanceSq, collisionDeltaScale, collisionFallbackNormal} from "./collision_response.js";

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
        this._collisionVelX = new Float64Array(0);
        this._collisionVelY = new Float64Array(0);
        this._collisionContactCount = new Uint32Array(0);
        this._collisionImpulseSq = new Float64Array(0);
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
            const childCenterX = tree.nodeMassCenterX[childId];
            const childCenterY = tree.nodeMassCenterY[childId];

            for (let j = 0; j < childCount; j++) {
                if (i === j) continue;
                const otherId = firstChild + j;
                const dx = childCenterX - tree.nodeMassCenterX[otherId];
                const dy = childCenterY - tree.nodeMassCenterY[otherId];
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
        if (this.settings.physics.symmetricForce) {
            this._calculateLeafDataSymmetric(tree, nodeId, pForceX, pForceY);
        } else {
            this._calculateLeafDataLegacy(tree, nodeId, pForceX, pForceY);
        }
    }

    _calculateLeafDataLegacy(tree, nodeId, pForceX, pForceY) {
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
                if (distSquare < minInteractionDistanceSq) continue;

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

    _calculateLeafDataSymmetric(tree, nodeId, pForceX, pForceY) {
        // Apply the inherited block force once per particle, then evaluate each
        // exact pair once and update both endpoints.
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
            const particleIndex = indices[i];
            const offset = particleIndex * ITEM_SIZE;
            particles[offset + 2] += pForceX;
            particles[offset + 3] += pForceY;
            if (accumulateForce) {
                forceXBuffer[particleIndex] += pForceX;
                forceYBuffer[particleIndex] += pForceY;
            }
        }

        for (let i = start; i < end - 1; i++) {
            const indexI = indices[i];
            const offsetI = indexI * ITEM_SIZE;
            const xI = particles[offsetI];
            const yI = particles[offsetI + 1];
            const massI = particles[offsetI + 4];

            for (let j = i + 1; j < end; j++) {
                const indexJ = indices[j];
                const offsetJ = indexJ * ITEM_SIZE;
                const dx = particles[offsetJ] - xI;
                const dy = particles[offsetJ + 1] - yI;
                const distSquare = dx * dx + dy * dy;
                if (distSquare < minInteractionDistanceSq) continue;

                const scale = particleGravity / distSquare;
                const massJ = particles[offsetJ + 4];
                const dvIX = dx * scale * massJ;
                const dvIY = dy * scale * massJ;
                const dvJX = -dx * scale * massI;
                const dvJY = -dy * scale * massI;

                particles[offsetI + 2] += dvIX;
                particles[offsetI + 3] += dvIY;
                particles[offsetJ + 2] += dvJX;
                particles[offsetJ + 3] += dvJY;

                if (accumulateForce) {
                    forceXBuffer[indexI] += dvIX;
                    forceYBuffer[indexI] += dvIY;
                    forceXBuffer[indexJ] += dvJX;
                    forceYBuffer[indexJ] += dvJY;
                }
            }
        }
    }

    _processCollisions(tree, nodeId) {
        const leafCount = tree.nodeParticleCount[nodeId];
        this._ensureCollisionBuffer(leafCount);
        const particles = tree.particles;
        const indices = tree.indexBuffers[tree.nodeIndexBuffer[nodeId]];
        const start = tree.nodeStart[nodeId];
        const end = start + leafCount;
        const deltaVelXBuffer = this._collisionVelX;
        const deltaVelYBuffer = this._collisionVelY;
        const contactCountBuffer = this._collisionContactCount;
        const impulseSquareBuffer = this._collisionImpulseSq;
        const collisionSize = this.settings.physics.collisionSize;
        const collisionSizeSq = this.settings.physics.collisionSizeSq;
        const minCollisionDistanceSq = collisionMinDistanceSq(collisionSizeSq);
        const restitution = this.settings.physics.collisionRestitution;
        const contactMode = this.settings.physics.collisionContactMode;
        const limitImpulse = this.settings.physics.collisionLimitImpulse;
        const separationStrength = this.settings.physics.collisionSeparation;
        const minClosingSpeedSq = this.settings.physics.collisionIgnoreMicro
            ? COLLISION_MIN_CLOSING_SPEED_SQ
            : 0;
        const impulseRestitution = 1 + restitution;

        deltaVelXBuffer.fill(0, 0, leafCount);
        deltaVelYBuffer.fill(0, 0, leafCount);
        contactCountBuffer.fill(0, 0, leafCount);
        impulseSquareBuffer.fill(0, 0, leafCount);

        // Evaluate each contact once and accumulate the Jacobi response for
        // both endpoints. The previous directed loop performed the same
        // distance/normal work twice for every pair.
        for (let i = start; i < end - 1; i++) {
            const localI = i - start;
            const p1Index = indices[i];
            const p1Offset = p1Index * ITEM_SIZE;
            const p1X = particles[p1Offset];
            const p1Y = particles[p1Offset + 1];
            const p1VelX = particles[p1Offset + 2];
            const p1VelY = particles[p1Offset + 3];
            const p1Mass = particles[p1Offset + 4];

            for (let j = i + 1; j < end; j++) {
                const localJ = j - start;
                const p2Index = indices[j];
                const p2Offset = p2Index * ITEM_SIZE;
                const dx = p1X - particles[p2Offset];
                const dy = p1Y - particles[p2Offset + 1];
                const distSquare = dx * dx + dy * dy;
                if (distSquare >= collisionSizeSq) continue;

                let distance = 0;
                let normalX;
                let normalY;
                if (distSquare <= minCollisionDistanceSq) {
                    [normalX, normalY] = collisionFallbackNormal(p1Index, p2Index);
                } else {
                    distance = Math.sqrt(distSquare);
                    normalX = dx / distance;
                    normalY = dy / distance;
                }

                const p2VelX = particles[p2Offset + 2];
                const p2VelY = particles[p2Offset + 3];
                const relativeNormal = (p1VelX - p2VelX) * normalX
                    + (p1VelY - p2VelY) * normalY;
                let closingSpeed = Math.max(0, -relativeNormal);
                if (closingSpeed * closingSpeed <= minClosingSpeedSq) {
                    closingSpeed = 0;
                }

                const penetration = Math.max(0, collisionSize - distance);
                const targetSeparationSpeed = separationStrength * penetration;
                const separationSpeed = Math.max(0, targetSeparationSpeed - Math.max(0, relativeNormal));
                const desiredRelativeChange = impulseRestitution * closingSpeed + separationSpeed;
                if (desiredRelativeChange <= 0) continue;

                const p2Mass = particles[p2Offset + 4];
                const massSum = p1Mass + p2Mass;
                if (!(massSum > 0) || !Number.isFinite(massSum)) continue;

                const deltaSpeedI = desiredRelativeChange * p2Mass / massSum;
                const deltaSpeedJ = desiredRelativeChange * p1Mass / massSum;
                const deltaIX = deltaSpeedI * normalX;
                const deltaIY = deltaSpeedI * normalY;
                const deltaJX = -deltaSpeedJ * normalX;
                const deltaJY = -deltaSpeedJ * normalY;

                deltaVelXBuffer[localI] += deltaIX;
                deltaVelYBuffer[localI] += deltaIY;
                deltaVelXBuffer[localJ] += deltaJX;
                deltaVelYBuffer[localJ] += deltaJY;
                impulseSquareBuffer[localI] += deltaIX * deltaIX + deltaIY * deltaIY;
                impulseSquareBuffer[localJ] += deltaJX * deltaJX + deltaJY * deltaJY;
                contactCountBuffer[localI] += 1;
                contactCountBuffer[localJ] += 1;
            }
        }

        for (let i = start; i < end; i++) {
            const localIndex = i - start;
            const particleIndex = indices[i];
            const particleOffset = particleIndex * ITEM_SIZE;
            const deltaScale = collisionDeltaScale(
                deltaVelXBuffer[localIndex],
                deltaVelYBuffer[localIndex],
                contactCountBuffer[localIndex],
                impulseSquareBuffer[localIndex],
                contactMode,
                limitImpulse,
            );
            const deltaVelX = deltaVelXBuffer[localIndex] * deltaScale;
            const deltaVelY = deltaVelYBuffer[localIndex] * deltaScale;

            if (this.settings.common.debugForce) {
                this._forceX[particleIndex] += deltaVelX;
                this._forceY[particleIndex] += deltaVelY;
            }

            particles[particleOffset + 2] += deltaVelX;
            particles[particleOffset + 3] += deltaVelY;
        }
    }

    _ensureCollisionBuffer(length) {
        if (this._collisionVelX.length < length) {
            this._collisionVelX = new Float64Array(length);
            this._collisionVelY = new Float64Array(length);
            this._collisionContactCount = new Uint32Array(length);
            this._collisionImpulseSq = new Float64Array(length);
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
                const particleCount = tree.nodeParticleCount[nodeId];
                const pairMultiplier = this.settings.physics.symmetricForce ? 0.5 : 1;
                flops += particleCount * Math.max(0, particleCount - 1) * pairMultiplier * flopsPerOp;
            } else {
                flops += childCount * Math.max(0, childCount - 1) * flopsPerOp;
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
        this._collisionContactCount = null;
        this._collisionImpulseSq = null;
        this._forceX = null;
        this._forceY = null;
        this._treeWorkspace = null;
    }
}

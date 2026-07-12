import {SpatialTree} from "./tree.js";
import {COLLISION_MIN_CLOSING_SPEED_SQ, collisionMinDistanceSq, collisionDeltaScale, collisionFallbackNormal} from "./collision_response.js";

/**
 * @typedef {{x: number, y: number}} PositionVector
 * @typedef {{velX: number, velY: number}} VelocityVector
 * @typedef {{x: number, y: number, velX: number, velY: number, mass: number}} Particle
 */

export class PhysicsEngine {
    /**
     * @param {AppSimulationSettings} settings
     */
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
        this._collisionVelX = new Float64Array(0);
        this._collisionVelY = new Float64Array(0);
        this._collisionContactCount = new Uint32Array(0);
        this._collisionImpulseSq = new Float64Array(0);
    }

    reconfigure(settings) {
        this.settings = settings;
    }

    /**
     * @param {Particle[]} particles
     */
    step(particles) {
        let t = performance.now();

        const tree = new SpatialTree(particles,
            this.settings.simulation.segmentMaxCount,
            this.settings.simulation.segmentDivider,
            this.settings.simulation.segmentRandomness,
            this.settings.simulation.massCenteredTree);
        if (this.settings.common.stats) {
            this.stats.treeTime = performance.now() - t;
        }

        t = performance.now();

        this._calculateTree(tree);
        for (let i = 0; i < particles.length; i++) {
            this._physicsStep(particles[i]);
        }

        if (this.settings.common.stats) {
            this.stats.physicsTime = performance.now() - t;
            this._calcTreeStats(tree);
        }

        return tree;
    }

    /**
     * @param {SpatialTree} tree
     * @protected
     */
    _calculateTree(tree) {
        return this._calculateLeaf(tree.root, [0, 0]);
    }

    /**
     *
     * @param {Leaf} leaf
     * @param {[number, number]} pForce
     * @protected
     */
    _calculateLeaf(leaf, pForce) {
        const blocks = leaf.children;
        if (blocks.length > 0) {
            this._calculateLeafBlock(leaf, pForce);
        } else {
            this._calculateLeafData(leaf, pForce);

            if (this.settings.physics.enableCollision) {
                this._processCollisions(leaf);
            }
        }
    }

    /**
     *
     * @param {Leaf} leaf
     * @param {[number, number]} pForce
     * @protected
     */
    _calculateLeafBlock(leaf, pForce) {
        const blocks = leaf.children;
        for (let i = 0; i < blocks.length; i++) {
            const blockCenter = blocks[i];
            const iForce = pForce.slice();

            for (let j = 0; j < blocks.length; j++) {
                if (i === j) continue;

                const g = this.settings.physics.particleGravity * blocks[j].mass;
                this._calculateForce(blockCenter, blocks[j], g, iForce);
            }

            this._calculateLeaf(blocks[i], iForce);
        }
    }

    /**
     *
     * @param {Leaf} leaf
     * @param {[number, number]} pForce
     * @protected
     */
    _calculateLeafData(leaf, pForce) {
        // Preserve the historical directed-kernel result while evaluating each
        // exact pair only once. For every particle, contributions are still
        // accumulated in the same attractor-index order as before, including
        // the inherited parent force at the same point in that sequence.
        const accumulateForce = this.settings.common.debugForce;
        const particleGravity = this.settings.physics.particleGravity;
        const minInteractionDistanceSq = this.settings.physics.minInteractionDistanceSq;

        for (let i = 0; i < leaf.length - 1; i++) {
            const p1 = leaf.data[i];
            p1.velX += pForce[0];
            p1.velY += pForce[1];
            if (accumulateForce) {
                p1.forceX += pForce[0];
                p1.forceY += pForce[1];
            }

            const g1 = particleGravity * p1.mass;
            for (let j = i + 1; j < leaf.length; j++) {
                const p2 = leaf.data[j];
                const dx12 = p2.x - p1.x;
                const dy12 = p2.y - p1.y;
                const distSquare = dx12 * dx12 + dy12 * dy12;
                if (distSquare < minInteractionDistanceSq) continue;

                // p1 attracts p2 using the exact arithmetic grouping from the
                // legacy directed pass.
                const force12 = -g1 / distSquare;
                const dv2X = dx12 * force12;
                const dv2Y = dy12 * force12;

                // p2 attracts p1. Compute the reverse deltas explicitly so the
                // operation order matches the old j -> i calculation.
                const dx21 = p1.x - p2.x;
                const dy21 = p1.y - p2.y;
                const g2 = particleGravity * p2.mass;
                const force21 = -g2 / distSquare;
                const dv1X = dx21 * force21;
                const dv1Y = dy21 * force21;

                p1.velX += dv1X;
                p1.velY += dv1Y;
                p2.velX += dv2X;
                p2.velY += dv2Y;

                if (accumulateForce) {
                    p1.forceX += dv1X;
                    p1.forceY += dv1Y;
                    p2.forceX += dv2X;
                    p2.forceY += dv2Y;
                }
            }
        }

        if (leaf.length > 0) {
            const last = leaf.data[leaf.length - 1];
            last.velX += pForce[0];
            last.velY += pForce[1];
            if (accumulateForce) {
                last.forceX += pForce[0];
                last.forceY += pForce[1];
            }
        }
    }

    _processCollisions(leaf) {
        this._ensureCollisionBuffer(leaf.length);

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

        deltaVelXBuffer.fill(0, 0, leaf.length);
        deltaVelYBuffer.fill(0, 0, leaf.length);
        contactCountBuffer.fill(0, 0, leaf.length);
        impulseSquareBuffer.fill(0, 0, leaf.length);

        for (let i = 0; i < leaf.length - 1; i++) {
            const p1 = leaf.data[i];
            for (let j = i + 1; j < leaf.length; j++) {
                const p2 = leaf.data[j];
                const dx = p1.x - p2.x;
                const dy = p1.y - p2.y;
                const distSquare = dx * dx + dy * dy;
                if (distSquare >= collisionSizeSq) continue;

                let distance = 0;
                let normalX;
                let normalY;
                if (distSquare <= minCollisionDistanceSq) {
                    [normalX, normalY] = collisionFallbackNormal(i, j);
                } else {
                    distance = Math.sqrt(distSquare);
                    normalX = dx / distance;
                    normalY = dy / distance;
                }

                const relativeNormal = (p1.velX - p2.velX) * normalX
                    + (p1.velY - p2.velY) * normalY;
                let closingSpeed = Math.max(0, -relativeNormal);
                if (closingSpeed * closingSpeed <= minClosingSpeedSq) {
                    closingSpeed = 0;
                }

                const penetration = Math.max(0, collisionSize - distance);
                const targetSeparationSpeed = separationStrength * penetration;
                const separationSpeed = Math.max(0, targetSeparationSpeed - Math.max(0, relativeNormal));
                const desiredRelativeChange = impulseRestitution * closingSpeed + separationSpeed;
                if (desiredRelativeChange <= 0) continue;

                const massSum = p1.mass + p2.mass;
                if (!(massSum > 0) || !Number.isFinite(massSum)) continue;

                const deltaSpeedI = desiredRelativeChange * p2.mass / massSum;
                const deltaSpeedJ = desiredRelativeChange * p1.mass / massSum;
                const deltaIX = deltaSpeedI * normalX;
                const deltaIY = deltaSpeedI * normalY;
                const deltaJX = -deltaSpeedJ * normalX;
                const deltaJY = -deltaSpeedJ * normalY;

                deltaVelXBuffer[i] += deltaIX;
                deltaVelYBuffer[i] += deltaIY;
                deltaVelXBuffer[j] += deltaJX;
                deltaVelYBuffer[j] += deltaJY;
                impulseSquareBuffer[i] += deltaIX * deltaIX + deltaIY * deltaIY;
                impulseSquareBuffer[j] += deltaJX * deltaJX + deltaJY * deltaJY;
                contactCountBuffer[i] += 1;
                contactCountBuffer[j] += 1;
            }
        }

        for (let i = 0; i < leaf.length; i++) {
            const particle = leaf.data[i];
            const deltaScale = collisionDeltaScale(
                deltaVelXBuffer[i],
                deltaVelYBuffer[i],
                contactCountBuffer[i],
                impulseSquareBuffer[i],
                contactMode,
                limitImpulse,
            );
            const deltaVelX = deltaVelXBuffer[i] * deltaScale;
            const deltaVelY = deltaVelYBuffer[i] * deltaScale;
            particle.velX += deltaVelX;
            particle.velY += deltaVelY;

            if (this.settings.common.debugForce) {
                particle.forceX += deltaVelX;
                particle.forceY += deltaVelY;
            }
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

    /**
     * @param {PositionVector|Particle} p1
     * @param {PositionVector|Particle} p2
     * @param {number} g
     * @param {Particle|[number,number]} out
     * @param {boolean=false} accumulateForce
     * @private
     */
    _calculateForce(p1, p2, g, out, accumulateForce = false) {
        const dx = p1.x - p2.x,
            dy = p1.y - p2.y;

        const distSquare = dx * dx + dy * dy;

        let force = 0;
        if (distSquare >= this.settings.physics.minInteractionDistanceSq) {
            force = -g / distSquare;

            if (out.velX !== undefined) {
                out.velX += dx * force;
                out.velY += dy * force;

                if (accumulateForce) {
                    out.forceX += dx * force;
                    out.forceY += dy * force;
                }
            } else {
                out[0] += dx * force;
                out[1] += dy * force;
            }
        }
    }

    /**
     * @param {Particle} particle
     * @private
     */
    _physicsStep(particle) {
        particle.velX *= this.settings.physics.resistance;
        particle.velY *= this.settings.physics.resistance;
        particle.x += particle.velX;
        particle.y += particle.velY;
    }

    _calcTreeStats(tree) {
        const flopsPerOp = 14;
        let flops = 0;

        function _processLeaf(parent) {
            if (parent.children.length === 0) {
                const pairMultiplier = 0.5;
                flops += parent.data.length * Math.max(0, parent.data.length - 1) * pairMultiplier * flopsPerOp;
                return;
            }

            for (let i = 0; i < parent.children.length; i++) {
                _processLeaf(parent.children[i]);
            }

            flops += parent.children.length * Math.max(0, parent.children.length - 1) * flopsPerOp;
        }

        _processLeaf(tree.root);

        this.stats.tree.flops = flops;
        this.stats.tree.depth = tree.maxDepth;
        this.stats.tree.segmentCount = tree._index;
    }

    dispose() {
        this.settings = null;
        this.stats = null;
        this._collisionVelX = null;
        this._collisionVelY = null;
        this._collisionContactCount = null;
        this._collisionImpulseSq = null;
    }
}
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
        this._collisionVelX = new Float32Array(0);
        this._collisionVelY = new Float32Array(0);
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
            this.settings.simulation.segmentMaxCount, this.settings.simulation.segmentDivider, this.settings.simulation.segmentRandomness);
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
            const blockCenter = blocks[i].boundaryRect.center();
            const iForce = pForce.slice();

            for (let j = 0; j < blocks.length; j++) {
                if (i === j) continue;

                const g = this.settings.physics.particleGravity * blocks[j].mass;
                this._calculateForce(blockCenter, blocks[j].boundaryRect.center(), g, iForce);
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
        const accumulateForce = this.settings.common.debugForce;
        for (let i = 0; i < leaf.length; i++) {
            const attractor = leaf.data[i];
            attractor.velX += pForce[0];
            attractor.velY += pForce[1];
            if (accumulateForce) {
                attractor.forceX += pForce[0];
                attractor.forceY += pForce[1];
            }

            for (let j = 0; j < leaf.length; j++) {
                if (i === j) continue;

                const particle = leaf.data[j];
                this._calculateForce(particle, attractor, this.settings.physics.particleGravity * attractor.mass, particle, accumulateForce);
            }
        }
    }

    _processCollisions(leaf) {
        this._ensureCollisionBuffer(leaf.length);

        const nextVelXBuffer = this._collisionVelX;
        const nextVelYBuffer = this._collisionVelY;
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

        for (let i = 0; i < leaf.length; i++) {
            const p1 = leaf.data[i];
            let deltaVelX = 0;
            let deltaVelY = 0;
            let contactCount = 0;
            let impulseSquareSum = 0;

            for (let j = 0; j < leaf.length; j++) {
                if (i === j) continue;
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

                const deltaSpeed = desiredRelativeChange * p2.mass / (p1.mass + p2.mass);
                const pairDeltaX = deltaSpeed * normalX;
                const pairDeltaY = deltaSpeed * normalY;
                deltaVelX += pairDeltaX;
                deltaVelY += pairDeltaY;
                impulseSquareSum += pairDeltaX * pairDeltaX + pairDeltaY * pairDeltaY;
                contactCount += 1;
            }

            const deltaScale = collisionDeltaScale(
                deltaVelX, deltaVelY, contactCount, impulseSquareSum, contactMode, limitImpulse);
            nextVelXBuffer[i] = p1.velX + deltaVelX * deltaScale;
            nextVelYBuffer[i] = p1.velY + deltaVelY * deltaScale;
        }

        for (let i = 0; i < leaf.length; i++) {
            const p = leaf.data[i];
            const nextVelX = nextVelXBuffer[i];
            const nextVelY = nextVelYBuffer[i];

            if (this.settings.common.debugForce) {
                p.forceX += nextVelX - p.velX;
                p.forceY += nextVelY - p.velY;
            }

            p.velX = nextVelX;
            p.velY = nextVelY;
        }
    }

    _ensureCollisionBuffer(length) {
        if (this._collisionVelX.length < length) {
            this._collisionVelX = new Float32Array(length);
            this._collisionVelY = new Float32Array(length);
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
                flops += Math.pow(parent.data.length, 2) * flopsPerOp;
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
        this.stats.tree.segmentCount = tree._index;
    }

    dispose() {
        this.settings = null;
        this.stats = null;
        this._collisionVelX = null;
        this._collisionVelY = null;
    }
}
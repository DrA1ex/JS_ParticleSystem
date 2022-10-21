import {SpatialTree} from "./tree.js";

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

            for (let j = 0; j < leaf.length; j++) {
                if (i === j) continue;

                const particle = leaf.data[j];
                this._calculateForce(particle, attractor, this.settings.physics.particleGravity * attractor.mass, particle, accumulateForce);
            }
        }
    }

    _processCollisions(leaf) {
        const nextVelocity = new Array(leaf.length);
        let hasCollision = false;

        for (let i = 0; i < leaf.length; i++) {
            const p1 = leaf.data[i];
            let nextVelX = p1.velX,
                nextVelY = p1.velY;

            for (let j = 0; j < leaf.length; j++) {
                if (i === j) {
                    continue;
                }

                const p2 = leaf.data[j];
                const dx = p1.x - p2.x,
                    dy = p1.y - p2.y;
                const distSquare = dx * dx + dy * dy;

                if (distSquare < this.settings.physics.minInteractionDistanceSq) {
                    const massFactor = 2 * p2.mass / (p1.mass + p2.mass);
                    const dot = massFactor * ((nextVelX - p2.velX) * dx + (nextVelY - p2.velY) * dy);
                    nextVelX -= dot / distSquare * dx;
                    nextVelY -= dot / distSquare * dy;

                    hasCollision = true;
                }
            }

            if (hasCollision) {
                nextVelocity[i] = [nextVelX * this.settings.physics.collisionRestitution, nextVelY * this.settings.physics.collisionRestitution];
            } else {
                nextVelocity[i] = [nextVelX, nextVelY];
            }
        }

        for (let i = 0; i < leaf.length; i++) {
            const p = leaf.data[i];
            const [nextVelX, nextVelY] = nextVelocity[i];

            if (this.settings.common.debugForce) {
                p.forceX += nextVelX - p.velX;
                p.forceY += nextVelY - p.velY;
            }

            p.velX = nextVelX;
            p.velY = nextVelY;
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
    }
}
import {SpatialTree} from "./tree.js";
import {ParticleInitType} from "./settings.js";

/**
 * @typedef {{x: number, y: number}} PositionVector
 * @typedef {{velX: number, velY: number}} VelocityVector
 * @typedef {{x: number, y: number, velX: number, velY: number}} Particle
 */

export class ParticleInitializer {
    /**
     * @param {Settings} settings
     * @returns {Particle[]}
     */
    static initialize(settings) {
        const particles = new Array(settings.particleCount);

        switch (settings.particleInitType) {
            case ParticleInitType.uniform:
                this._uniformInitializer(particles, settings);
                break;

            case ParticleInitType.bang:
                this._bangInitializer(particles, settings);
                break;

            case ParticleInitType.circle:
            default:
                this._circleInitializer(particles, settings);
                break;
        }

        return particles
    }

    /**
     * @param {Particle[]} particles
     * @param {Settings} settings
     * @private
     */
    static _circleInitializer(particles, settings) {
        const {particleCount, worldWidth, worldHeight} = settings;

        let angle = 0,
            step = Math.PI * 2 / particleCount,
            radius = Math.min(worldWidth, worldHeight) / 2.5,
            wiggle = radius / 3,
            centerX = worldWidth / 2,
            centerY = worldHeight / 2;

        for (let i = 0; i < particleCount; i++) {
            particles[i] = {
                x: centerX + Math.cos(angle) * radius + (Math.random() - 0.5) * wiggle,
                y: centerY + Math.sin(angle) * radius + (Math.random() - 0.5) * wiggle,
                velX: 0, velY: 0
            };

            angle += step;
        }
    }

    /**
     * @param {Particle[]} particles
     * @param {Settings} settings
     * @private
     */
    static _uniformInitializer(particles, settings) {
        const {particleCount, worldWidth, worldHeight} = settings;

        for (let i = 0; i < particleCount; i++) {
            particles[i] = {
                x: Math.random() * worldWidth,
                y: Math.random() * worldHeight,
                velX: 0, velY: 0
            };
        }
    }

    /**
     * @param {Particle[]} particles
     * @param {Settings} settings
     * @private
     */
    static _bangInitializer(particles, settings) {
        const {particleCount, worldWidth, worldHeight} = settings;

        const radius = 50;
        const initialVelocity = Math.sqrt(settings.gravity) * 1.5;
        const centerX = worldWidth / 2;
        const centerY = worldHeight / 2;
        const pi2 = Math.PI * 2;

        for (let i = 0; i < particleCount; i++) {
            const angle = Math.random() * pi2;
            particles[i] = {
                x: centerX + Math.cos(angle) * Math.random() * radius - radius / 2,
                y: centerY + Math.sin(angle) * Math.random() * radius - radius / 2,
                velX: Math.cos(angle) * initialVelocity,
                velY: Math.sin(angle) * initialVelocity
            };
        }
    }
}

export class PhysicsEngine {
    /**
     * @param {Settings} settings
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

    /**
     * @param {Particle[]} particles
     */
    step(particles) {
        let t = performance.now();

        const tree = new SpatialTree(particles, this.settings.segmentMaxCount, this.settings.segmentDivider);
        if (this.settings.stats) {
            this.stats.treeTime = performance.now() - t;
        }

        t = performance.now();

        this._calculateTree(tree);
        for (let i = 0; i < particles.length; i++) {
            this._physicsStep(particles[i]);
        }

        if (this.settings.stats) {
            this.stats.physicsTime = performance.now() - t;
            this._calcTreeStats(tree);
        }

        return tree;
    }

    /**
     * @param {SpatialTree} tree
     * @private
     */
    _calculateTree(tree) {
        return this._calculateLeaf(tree.root, [0, 0]);
    }

    /**
     *
     * @param {Leaf} leaf
     * @param {[number, number]} pForce
     * @private
     */
    _calculateLeaf(leaf, pForce) {
        const blocks = leaf.children;
        if (blocks.length > 0) {
            for (let i = 0; i < blocks.length; i++) {
                const blockCenter = blocks[i].boundaryRect.center();
                const iForce = pForce.slice();

                for (let j = 0; j < blocks.length; j++) {
                    if (i === j) continue;

                    const g = this.settings.particleGravity * blocks[j].length;
                    this._calculateForce(blockCenter, blocks[j].boundaryRect.center(), g, iForce);
                }

                this._calculateLeaf(blocks[i], iForce);
            }
        } else {
            for (let i = 0; i < leaf.length; i++) {
                const attractor = leaf.data[i];
                attractor.velX += pForce[0];
                attractor.velY += pForce[1];

                for (let j = 0; j < leaf.length; j++) {
                    if (i === j) continue;

                    const particle = leaf.data[j];
                    this._calculateForce(particle, attractor, this.settings.particleGravity, particle);
                }
            }
        }
    }

    /**
     * @param {PositionVector} p1
     * @param {PositionVector} p2
     * @param {number} g
     * @param {VelocityVector|[number,number]} out
     * @private
     */
    _calculateForce(p1, p2, g, out) {
        const dx = p1.x - p2.x,
            dy = p1.y - p2.y;

        const distSquare = dx * dx + dy * dy;

        let force = 0;
        if (distSquare >= this.settings.minInteractionDistanceSq) {
            force = -g / distSquare;

            if (out.velX !== undefined) {
                out.velX += dx * force;
                out.velY += dy * force;
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
        particle.velX *= this.settings.resistance;
        particle.velY *= this.settings.resistance;
        particle.x += particle.velX;
        particle.y += particle.velY;
    }

    _calcTreeStats(tree) {
        const flopsPerOp = 12;
        let flops = 0;

        function _processLeaf(parent) {
            if (parent.children.length === 0) {
                flops += Math.pow(parent.data.length * flopsPerOp, 2);
                return;
            }

            for (let i = 0; i < parent.children.length; i++) {
                _processLeaf(parent.children[i]);
            }

            flops += Math.pow(parent.children.length * flopsPerOp, 2);
        }

        _processLeaf(tree.root);

        this.stats.tree.flops = flops;
        this.stats.tree.depth = tree.maxDepth;
        this.stats.tree.segmentCount = tree._index;
    }
}
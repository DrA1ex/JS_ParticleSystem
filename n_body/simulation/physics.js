import {SpatialTree} from "./tree.js";
import {ParticleInitType} from "../utils/settings.js";
import {bmRandom} from "../utils/common.js";

/**
 * @typedef {{x: number, y: number}} PositionVector
 * @typedef {{velX: number, velY: number}} VelocityVector
 * @typedef {{x: number, y: number, velX: number, velY: number, mass: number}} Particle
 */

export class ParticleInitializer {
    /**
     * @param {Settings} settings
     * @returns {Particle[]}
     */
    static initialize(settings) {
        const particles = new Array(settings.particleCount);
        for (let i = 0; i < settings.particleCount; i++) {
            particles[i] = {
                x: 0, y: 0, velX: 0, velY: 0,
                mass: 1 + bmRandom() * settings.particleMass
            }
        }

        switch (settings.particleInitType) {
            case ParticleInitType.uniform:
                this._uniformInitializer(particles, settings);
                break;

            case ParticleInitType.bang:
                this._bangInitializer(particles, settings);
                break;

            case ParticleInitType.disk:
                this._diskInitializer(particles, settings);
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
        const {worldWidth, worldHeight} = settings;

        const radius = Math.min(worldWidth, worldHeight) / 2.5;
        const wiggle = radius / 3;
        this._circleInitializerBase(particles, settings, radius, wiggle);
    }


    /**
     * @param {Particle[]} particles
     * @param {Settings} settings
     * @private
     */
    static _diskInitializer(particles, settings) {
        const {worldWidth, worldHeight} = settings;

        const radius = Math.min(worldWidth, worldHeight) / 4;
        this._circleInitializerBase(particles, settings, radius, radius * 2);
    }

    /**
     * @param {Particle[]} particles
     * @param {Settings} settings
     * @param {number} radius
     * @param {number} wiggle
     * @private
     */
    static _circleInitializerBase(particles, settings, radius, wiggle) {
        const {particleCount, worldWidth, worldHeight} = settings;

        const step = Math.PI * 2 / particleCount,
            centerX = worldWidth / 2,
            centerY = worldHeight / 2;

        let angle = 0;
        for (let i = 0; i < particleCount; i++) {
            const r = (radius + (Math.random() - 0.5) * wiggle)
            particles[i].x = centerX + Math.cos(angle) * r;
            particles[i].y = centerY + Math.sin(angle) * r;

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
            particles[i].x = Math.random() * worldWidth;
            particles[i].y = Math.random() * worldHeight
        }
    }

    /**
     * @param {Particle[]} particles
     * @param {Settings} settings
     * @private
     */
    static _bangInitializer(particles, settings) {
        const {particleCount, worldWidth, worldHeight} = settings;

        const radius = Math.min(worldWidth, worldHeight) / 20;
        this._circleInitializerBase(particles, settings, radius, radius / 2);

        const initialVelocity = Math.sqrt(settings.gravity) / (1 + settings.particleMass) * 1.5;
        for (let i = 0; i < particleCount; i++) {
            const angle = Math.random() * Math.PI * 2;
            particles[i].velX = Math.cos(angle) * initialVelocity * particles[i].mass;
            particles[i].velY = Math.sin(angle) * initialVelocity * particles[i].mass;
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

                    const g = this.settings.particleGravity * blocks[j].mass;
                    this._calculateForce(blockCenter, blocks[j].boundaryRect.center(), g, iForce);
                }

                this._calculateLeaf(blocks[i], iForce);
            }
        } else {
            for (let i = 0; i < leaf.length; i++) {
                const attractor = leaf.data[i];
                attractor.velX += pForce[0] / attractor.mass;
                attractor.velY += pForce[1] / attractor.mass;

                for (let j = 0; j < leaf.length; j++) {
                    if (i === j) continue;

                    const particle = leaf.data[j];
                    this._calculateForce(particle, attractor, this.settings.particleGravity * attractor.mass, particle);
                }
            }
        }
    }

    /**
     * @param {PositionVector} p1
     * @param {PositionVector} p2
     * @param {number} g
     * @param {Particle|[number,number]} out
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
                out.velX += dx * force / out.mass;
                out.velY += dy * force / out.mass;
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
        const flopsPerOp = 14;
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
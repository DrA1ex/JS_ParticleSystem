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

            case ParticleInitType.rotation:
                this._multiCircleInitializerBase(particles, settings, {
                    gravityMul: 0.5,
                    radiusDivider: 3,
                    subRadiusDivider: 4,
                    startAngle: 0,
                    velocityAngle: Math.PI / 2,
                    circleCount: 5,
                    wiggleDivider: 0.75
                });
                break;

            case ParticleInitType.collision:
                this._multiCircleInitializerBase(particles, settings, {
                    gravityMul: 0.05,
                    radiusDivider: 3,
                    subRadiusDivider: 20,
                    startAngle: Math.PI / 6,
                    velocityAngle: Math.PI - Math.PI / 6 + Math.PI / 12,
                    circleCount: 2,
                    wiggleDivider: 0.5
                });
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
        this._circleCenteredInitializer(particles, settings, radius, wiggle);
    }


    /**
     * @param {Particle[]} particles
     * @param {Settings} settings
     * @private
     */
    static _diskInitializer(particles, settings) {
        const {worldWidth, worldHeight} = settings;

        const radius = Math.min(worldWidth, worldHeight) / 4;
        this._circleCenteredInitializer(particles, settings, radius, radius * 2);
    }

    /**
     * @param {Particle[]} particles
     * @param {number} offset
     * @param {number} count
     * @param {number} centerX
     * @param {number} centerY
     * @param {number} radius
     * @param {number} wiggle
     * @private
     */
    static _circleInitializerBase(particles, {offset, count, centerX, centerY, radius, wiggle}) {
        const step = Math.PI * 2 / count;

        const end = Math.min(offset + count, particles.length);
        let angle = 0;
        for (let i = offset; i < end; i++) {
            const r = (radius + (Math.random() - 0.5) * wiggle)
            particles[i].x = centerX + Math.cos(angle) * r;
            particles[i].y = centerY + Math.sin(angle) * r;

            angle += step;
        }
    }

    /**
     * @param {Particle[]} particles
     * @param {Settings} settings
     * @param {number} radius
     * @param {number} wiggle
     * @private
     */
    static _circleCenteredInitializer(particles, settings, radius, wiggle) {
        const {particleCount, worldWidth, worldHeight} = settings;
        const centerX = worldWidth / 2,
            centerY = worldHeight / 2;

        return this._circleInitializerBase(particles, {
            offset: 0,
            count: particleCount,
            centerX,
            centerY,
            radius,
            wiggle
        });
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
        const {particleCount, worldWidth, worldHeight, gravity, particleMass} = settings;

        const radius = Math.min(worldWidth, worldHeight) / 20;
        this._circleCenteredInitializer(particles, settings, radius, radius / 2);

        const initialVelocity = Math.sqrt(gravity) / (1 + particleMass) * 1.5;
        for (let i = 0; i < particleCount; i++) {
            const angle = Math.random() * Math.PI * 2;
            particles[i].velX = Math.cos(angle) * initialVelocity * particles[i].mass;
            particles[i].velY = Math.sin(angle) * initialVelocity * particles[i].mass;
        }
    }

    /**
     * @param {Particle[]} particles
     * @param {Settings} settings
     * @param {number=1} gravityMul
     * @param {number=4} radiusDivider
     * @param {number=4} subRadiusDivider
     * @param {number=0} startAngle
     * @param {number=0} velocityAngle
     * @param {number=2} circleCount
     * @param {number=2} wiggleDivider
     * @private
     */
    static _multiCircleInitializerBase(particles, settings, {
        gravityMul = 1, radiusDivider = 4, subRadiusDivider = 4,
        startAngle = 0, velocityAngle = 0, circleCount = 2, wiggleDivider = 2
    }) {
        const {particleCount, worldWidth, worldHeight, gravity, particleMass} = settings;

        const size = particleCount / circleCount;
        const centerX = worldWidth / 2;
        const centerY = worldHeight / 2;
        const radius = Math.min(worldWidth, worldHeight) / radiusDivider;
        const subRadius = radius / subRadiusDivider;
        const angleStep = Math.PI * 2 / circleCount;
        const velocity = Math.sqrt(gravity) / (1 + particleMass) * gravityMul;
        let angle = startAngle;

        for (let i = 0; i < circleCount; i++) {
            const start = i * size;
            const end = start + size;
            const x = centerX + Math.cos(angle) * radius;
            const y = centerY + Math.sin(angle) * radius;

            this._circleInitializerBase(particles, {
                offset: start,
                count: size,
                centerX: x,
                centerY: y,
                radius: subRadius,
                wiggle: subRadius / wiggleDivider
            });

            for (let j = start; j < end; j++) {
                const p = particles[j];
                p.velX = velocity * Math.cos(angle + velocityAngle);
                p.velY = velocity * Math.sin(angle + velocityAngle);
            }

            angle += angleStep;
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
            const accumulateForce = this.settings.debug && this.settings.debugForce;
            for (let i = 0; i < leaf.length; i++) {
                const attractor = leaf.data[i];
                attractor.velX += pForce[0] / attractor.mass;
                attractor.velY += pForce[1] / attractor.mass;

                for (let j = 0; j < leaf.length; j++) {
                    if (i === j) continue;

                    const particle = leaf.data[j];
                    this._calculateForce(particle, attractor, this.settings.particleGravity * attractor.mass, particle, accumulateForce);
                }
            }
        }
    }

    /**
     * @param {PositionVector} p1
     * @param {PositionVector} p2
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
        if (distSquare >= this.settings.minInteractionDistanceSq) {
            force = -g / distSquare;

            if (out.velX !== undefined) {
                out.velX += dx * force / out.mass;
                out.velY += dy * force / out.mass;

                if (accumulateForce) {
                    out.forceX += dx * force / out.mass;
                    out.forceY += dy * force / out.mass;
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
}
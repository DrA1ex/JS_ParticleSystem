import {ParticleInitType} from "../settings/enum.js";

/**
 * @typedef {(particle: Particle, angle: number, radius: number) => void} CircleParticleTransformer
 */

export class Particle_initializer {
    /**
     * @param {AppSimulationSettings} settings
     * @returns {Particle[]}
     */
    static initialize(settings) {
        const particles = new Array(settings.physics.particleCount);
        for (let i = 0; i < settings.physics.particleCount; i++) {
            let addMass = 0;
            for (let j = 0; j < settings.physics.massDistribution.length; j++) {
                const [k, mass] = settings.physics.massDistribution[j];
                if (i % k === 0) {
                    addMass = mass;
                    break;
                }
            }

            particles[i] = {
                x: 0, y: 0, velX: 0, velY: 0,
                mass: 1 + addMass
            }
        }

        switch (settings.physics.particleInitType) {
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
                this._rotationInitializer(particles, settings);
                break;

            case ParticleInitType.collision:
                this._collisionInitializer(particles, settings);
                break;

            case ParticleInitType.swirl:
                this._swirlInitializer(particles, settings);
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
     * @param {AppSimulationSettings} settings
     * @private
     */
    static _circleInitializer(particles, settings) {
        const {worldWidth, worldHeight} = settings.world;

        const radius = Math.min(worldWidth, worldHeight) / 2.5;
        const wiggle = radius / 3;
        this._circleCenteredInitializer(particles, settings, radius, wiggle);
    }


    /**
     * @param {Particle[]} particles
     * @param {AppSimulationSettings} settings
     * @private
     */
    static _diskInitializer(particles, settings) {
        const {worldWidth, worldHeight} = settings.world;

        const radius = Math.min(worldWidth, worldHeight) / 4;
        this._circleCenteredInitializer(particles, settings, radius, radius * 1.9);
    }

    /**
     * @param {Particle[]} particles
     * @param {AppSimulationSettings} settings
     * @private
     */
    static _swirlInitializer(particles, settings) {
        const {worldWidth, worldHeight} = settings.world;
        const {particleCount, gravity} = settings.physics;

        const centerX = worldWidth / 2,
            centerY = worldHeight / 2;

        const maxRadius = Math.min(worldWidth, worldHeight) / 2;
        const minRadius = maxRadius / 64;
        const wiggle = maxRadius / 8;

        const maxAngle = Math.PI * 2;
        const spiralSize = maxAngle / 16;
        const step = maxAngle / particleCount;
        let angle = 0;
        for (let i = 0; i < particleCount; i++) {
            const r = (minRadius + (angle / spiralSize - Math.floor(angle / spiralSize)) * (maxRadius - minRadius) + Math.random() * wiggle);
            particles[i].x = centerX + Math.cos(angle) * r;
            particles[i].y = centerY + Math.sin(angle) * r;

            particles[i].velX = Math.cos(angle - Math.PI / 2) * (0.1 + r / maxRadius) * gravity;
            particles[i].velY = Math.sin(angle - Math.PI / 2) * (0.1 + r / maxRadius) * gravity;

            angle += step;
        }
    }

    static _rotationInitializer(particles, settings) {
        const {worldWidth, worldHeight} = settings.world;
        const {gravity} = settings.physics;

        const radius = Math.min(worldWidth, worldHeight) / 4;
        const wiggle = radius / 1.5;
        const maxRadius = radius + wiggle / 2;

        const velocityMul = Math.sqrt(gravity) / maxRadius;
        this._circleCenteredInitializer(particles, settings, radius, wiggle, {
            transformer: (p, angle, r) => {
                p.velX = Math.cos(angle - Math.PI / 2) * r * velocityMul;
                p.velY = Math.sin(angle - Math.PI / 2) * r * velocityMul;
            }
        });
    }

    /**
     * @param {Particle[]} particles
     * @param {number} offset
     * @param {number} count
     * @param {number} centerX
     * @param {number} centerY
     * @param {number} radius
     * @param {number} wiggle
     * @param {CircleParticleTransformer} [transformer=null]
     * @private
     */
    static _circleInitializerBase(particles, {offset, count, centerX, centerY, radius, wiggle, transformer}) {
        const step = Math.PI * 2 / count;

        const end = Math.min(offset + count, particles.length);
        let angle = 0;
        for (let i = offset; i < end; i++) {
            const r = (radius + (Math.random() - 0.5) * wiggle)
            particles[i].x = centerX + Math.cos(angle) * r;
            particles[i].y = centerY + Math.sin(angle) * r;

            if (transformer) {
                transformer(particles[i], angle, r);
            }

            angle += step;
        }
    }


    /**
     * @param {Particle[]} particles
     * @param {number} offset
     * @param {number} count
     * @param {number} centerX
     * @param {number} centerY
     * @param {number} minRadius
     * @param {number} maxRadius
     * @param {number} step
     * @param {CircleParticleTransformer} [transformer=null]
     * @private
     */
    static _uniformCircleInitializerBase(particles, {offset, count, centerX, centerY, minRadius, maxRadius, step, transformer}) {
        const PI_2 = Math.PI * 2;
        const n = (maxRadius - minRadius) / step;
        const density = PI_2 * (maxRadius * (n - 1) - step / 2 * (n * n - n)) / count;

        let i = offset;
        for (let r = minRadius; r < maxRadius; r += step) {
            let segmentCount;
            if (r + step < maxRadius) {
                segmentCount = 1 + Math.floor(PI_2 * r / density);
            } else {
                segmentCount = count - (i - offset);
            }

            const angleStep = PI_2 / segmentCount;
            for (let j = 0; j < segmentCount; j++) {
                const angle = j * angleStep;
                particles[i].x = centerX + Math.cos(angle) * r;
                particles[i].y = centerY + Math.sin(angle) * r;

                if (transformer) {
                    transformer(particles[i], angle, r);
                }

                i += 1;
            }
        }
    }

    /**
     * @param {Particle[]} particles
     * @param {AppSimulationSettings} settings
     * @param {number} radius
     * @param {number} wiggle
     * @param {CircleParticleTransformer} [transformer=null]
     * @private
     */
    static _circleCenteredInitializer(particles, settings, radius, wiggle, {transformer} = {}) {
        const {worldWidth, worldHeight} = settings.world;
        const {particleCount} = settings.physics;
        const centerX = worldWidth / 2,
            centerY = worldHeight / 2;

        return this._circleInitializerBase(particles, {
            offset: 0,
            count: particleCount,
            centerX,
            centerY,
            radius,
            wiggle,
            transformer,
        });
    }

    /**
     * @param {Particle[]} particles
     * @param {AppSimulationSettings} settings
     * @private
     */
    static _uniformInitializer(particles, settings) {
        const {worldWidth, worldHeight} = settings.world;
        const {particleCount} = settings.physics;

        for (let i = 0; i < particleCount; i++) {
            particles[i].x = Math.random() * worldWidth;
            particles[i].y = Math.random() * worldHeight
        }
    }

    /**
     * @param {Particle[]} particles
     * @param {AppSimulationSettings} settings
     * @private
     */
    static _bangInitializer(particles, settings) {
        const {worldWidth, worldHeight} = settings.world;
        const {particleCount, gravity, particleMass} = settings.physics;

        const radius = Math.min(worldWidth, worldHeight) / 20;
        this._circleCenteredInitializer(particles, settings, radius, radius / 2);

        const initialVelocity = Math.sqrt(gravity) / (1 + particleMass) * 1.5;
        for (let i = 0; i < particleCount; i++) {
            const angle = Math.random() * Math.PI * 2;
            particles[i].velX = Math.cos(angle) * initialVelocity * particles[i].mass;
            particles[i].velY = Math.sin(angle) * initialVelocity * particles[i].mass;
        }
    }

    static _collisionInitializer(particles, settings) {
        const startAngle = Math.PI / 6,
            velocityAngle = Math.PI,
            circleCount = 2;

        const {worldWidth, worldHeight} = settings.world;
        const {particleCount, gravity, particleMass} = settings.physics;

        const size = Math.ceil(particleCount / circleCount);
        const centerX = worldWidth / 2;
        const centerY = worldHeight / 2;
        const radius = Math.min(worldWidth, worldHeight) / 2;
        const subRadius = radius / 2;
        const angleStep = Math.PI * 2 / circleCount;
        const velocity = Math.sqrt(gravity) / (1 + particleMass) / (subRadius + subRadius);

        let angle = startAngle;
        for (let i = 0; i < circleCount; i++) {
            const count = i + 1 < circleCount ? size : particleCount - i * size;
            this._uniformCircleInitializerBase(particles, {
                offset: i * size,
                count,
                centerX: centerX + Math.cos(angle) * radius,
                centerY: centerY + Math.sin(angle) * radius,
                maxRadius: subRadius,
                minRadius: 0,
                step: subRadius / 32,
                transformer: (p, a, r) => {
                    p.velX = velocity * Math.cos(a - Math.PI / 2) * r + Math.cos(angle + velocityAngle) / 2;
                    p.velY = velocity * Math.sin(a - Math.PI / 2) * r + Math.sin(angle + velocityAngle) / 2;
                }
            });

            angle += angleStep;
        }
    }
}
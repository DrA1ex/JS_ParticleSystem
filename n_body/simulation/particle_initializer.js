import {ParticleInitType} from "../utils/settings.js";

export class Particle_initializer {
    /**
     * @param {Settings} settings
     * @returns {Particle[]}
     */
    static initialize(settings) {
        const particles = new Array(settings.particleCount);
        for (let i = 0; i < settings.particleCount; i++) {
            let addMass = 0;
            for (let j = 0; j < settings.massDistribution.length; j++) {
                const [k, mass] = settings.massDistribution[j];
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
        this._circleCenteredInitializer(particles, settings, radius, radius * 1.9);
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

        const size = Math.ceil(particleCount / circleCount);
        const centerX = worldWidth / 2;
        const centerY = worldHeight / 2;
        const radius = Math.min(worldWidth, worldHeight) / radiusDivider;
        const subRadius = radius / subRadiusDivider;
        const angleStep = Math.PI * 2 / circleCount;
        const velocity = Math.sqrt(gravity) / (1 + particleMass) * gravityMul;
        let angle = startAngle;

        for (let i = 0; i < circleCount; i++) {
            const start = i * size;
            const end = Math.min(start + size, particleCount);
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
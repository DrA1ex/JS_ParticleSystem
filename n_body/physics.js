import {MIN_DISTANCE_SQ, RESISTANCE, G} from "./settings.js";

/**
 * @typedef {{x: number, y: number}} PositionVector
 * @typedef {{velX: number, velY: number}} VelocityVector
 * @typedef {{x: number, y: number, velX: number, velY: number}} Particle
 */

export const InitType = {
    circle: 0,
    uniform: 1,
    bang: 2,
}

export function initParticles(initType, particleCount, width, height) {
    const Particles = new Array(particleCount);

    function _circleInitializer() {
        let angle = 0,
            step = Math.PI * 2 / particleCount,
            radius = Math.min(width, height) / 2.5,
            wiggle = radius / 3,
            centerX = width / 2,
            centerY = height / 2;

        for (let i = 0; i < particleCount; i++) {
            Particles[i] = {
                x: centerX + Math.cos(angle) * radius + (Math.random() * wiggle - wiggle / 2),
                y: centerY + Math.sin(angle) * radius + (Math.random() * wiggle - wiggle / 2),
                velX: 0, velY: 0
            };

            angle += step;
        }
    }

    function _uniformInitializer() {
        for (let i = 0; i < particleCount; i++) {
            Particles[i] = {
                x: Math.random() * width,
                y: Math.random() * height,
                velX: 0, velY: 0
            };
        }
    }

    function _bangInitializer() {
        const radius = 50;
        const initialVelocity = Math.sqrt(G) * 5;
        const centerX = width / 2;
        const centerY = height / 2;
        const pi2 = Math.PI * 2;

        for (let i = 0; i < particleCount; i++) {
            const angle = Math.random() * pi2;
            Particles[i] = {
                x: centerX + Math.cos(angle) * Math.random() * radius - radius / 2,
                y: centerY + Math.sin(angle) * Math.random() * radius - radius / 2,
                velX: Math.cos(angle) * initialVelocity,
                velY: Math.sin(angle) * initialVelocity
            };
        }
    }

    switch (initType) {
        case InitType.circle:
            _circleInitializer();
            break;

        case InitType.bang:
            _bangInitializer();
            break;

        case InitType.uniform:
        default:
            _uniformInitializer();
            break;
    }

    return Particles
}

/**
 * @param {PositionVector} p1
 * @param {PositionVector} p2
 * @param {number} g
 * @param {VelocityVector|[number,number]} out
 */
export function calculateForce(p1, p2, g, out) {
    const dx = p1.x - p2.x,
        dy = p1.y - p2.y;

    const distSquare = dx * dx + dy * dy;

    let force = 0;
    if (distSquare >= MIN_DISTANCE_SQ) {
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
 *
 * @param {Particle} particle
 * @param {number} width
 * @param {number} height
 */
export function physicsStep(particle, width, height) {
    particle.velX *= RESISTANCE;
    particle.velY *= RESISTANCE;
    particle.x += particle.velX;
    particle.y += particle.velY;

    if (particle.x > width) {
        particle.x -= width;
    } else if (particle.x < 0) {
        particle.x += width;
    }

    if (particle.y > height) {
        particle.y -= height;
    } else if (particle.y < 0) {
        particle.y += height;
    }
}
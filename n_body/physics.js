import {MIN_DISTANCE_SQ, RESISTANCE} from "./settings.js";

export const InitType = {
    circle: 0,
    uniform: 1
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

    switch (initType) {
        case InitType.circle:
            _circleInitializer();
            break;

        case InitType.uniform:
        default:
            _uniformInitializer();
            break;
    }

    return Particles
}

export function calculateForce(p1, p2, g) {
    const dx = p1.x - p2.x,
        dy = p1.y - p2.y;

    const distSquare = dx * dx + dy * dy;

    let force = 0;
    if (distSquare >= MIN_DISTANCE_SQ) {
        force = -g / distSquare;
        return [dx * force, dy * force];
    }

    return [0, 0];
}

export function animateParticle(particle, g, attractor) {
    const [xForce, yForce] = calculateForce(particle, attractor, g);
    particle.velX += xForce;
    particle.velY += yForce;
}

export function applyForce(leaf, force) {
    const [xForce, yForce] = force;
    for (let i = 0; i < leaf.length; i++) {
        const particle = leaf.data[i];
        particle.velX += xForce;
        particle.velY += yForce;
    }
}

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
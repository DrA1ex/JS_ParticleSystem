export const ITEM_SIZE = 5;

// Shared particle layout used by the fast CPU backend and renderers:
// [x, y, velX, velY, mass] repeated for each particle.
export function isParticleBuffer(particles) {
    return particles instanceof Float32Array;
}

export function getParticleCount(particles) {
    if (!particles) return 0;
    return isParticleBuffer(particles) ? particles.length / ITEM_SIZE : particles.length;
}

export function getParticleX(particles, index) {
    return isParticleBuffer(particles) ? particles[index * ITEM_SIZE] : particles[index].x;
}

export function getParticleY(particles, index) {
    return isParticleBuffer(particles) ? particles[index * ITEM_SIZE + 1] : particles[index].y;
}

export function getParticleVelX(particles, index) {
    return isParticleBuffer(particles) ? particles[index * ITEM_SIZE + 2] : particles[index].velX;
}

export function getParticleVelY(particles, index) {
    return isParticleBuffer(particles) ? particles[index * ITEM_SIZE + 3] : particles[index].velY;
}

export function exportParticleState(particles, count = getParticleCount(particles)) {
    if (!particles) return null;

    count = Math.min(count, getParticleCount(particles));
    const state = new Array(count);

    if (isParticleBuffer(particles)) {
        for (let i = 0; i < count; i++) {
            const offset = i * ITEM_SIZE;
            state[i] = [
                particles[offset],
                particles[offset + 1],
                particles[offset + 2],
                particles[offset + 3],
                particles[offset + 4],
            ];
        }
    } else {
        for (let i = 0; i < count; i++) {
            const p = particles[i];
            state[i] = [p.x, p.y, p.velX, p.velY, p.mass];
        }
    }

    return state;
}

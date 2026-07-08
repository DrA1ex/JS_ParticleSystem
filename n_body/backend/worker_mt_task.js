import {AppSimulationSettings} from "../settings/app.js";
import {ITEM_SIZE} from "../utils/particles.js";

let settings = null;
let particles = null;
let forceX = null;
let forceY = null;
let collisionVelX = new Float32Array(0);
let collisionVelY = new Float32Array(0);

function init(data) {
    settings = AppSimulationSettings.deserialize(data.settings);
    particles = new Float32Array(data.particlesBuffer);
    forceX = data.forceXBuffer ? new Float32Array(data.forceXBuffer) : null;
    forceY = data.forceYBuffer ? new Float32Array(data.forceYBuffer) : null;
}

function ensureCollisionBuffer(length) {
    if (collisionVelX.length < length) {
        collisionVelX = new Float32Array(length);
        collisionVelY = new Float32Array(length);
    }
}

function calculateLeaf(indices, start, count, pForceX, pForceY) {
    const end = start + count;
    const particleGravity = settings.physics.particleGravity;
    const minInteractionDistanceSq = settings.physics.minInteractionDistanceSq;
    const accumulateForce = !!settings.common.debugForce && forceX && forceY;

    for (let i = start; i < end; i++) {
        const attractorIndex = indices[i];
        const attractorOffset = attractorIndex * ITEM_SIZE;
        const attractorX = particles[attractorOffset];
        const attractorY = particles[attractorOffset + 1];
        const g = particleGravity * particles[attractorOffset + 4];

        particles[attractorOffset + 2] += pForceX;
        particles[attractorOffset + 3] += pForceY;

        for (let j = start; j < end; j++) {
            if (i === j) continue;
            const particleIndex = indices[j];
            const particleOffset = particleIndex * ITEM_SIZE;
            const dx = particles[particleOffset] - attractorX;
            const dy = particles[particleOffset + 1] - attractorY;
            const distSquare = dx * dx + dy * dy;

            if (distSquare >= minInteractionDistanceSq) {
                const force = -g / distSquare;
                const vx = dx * force;
                const vy = dy * force;
                particles[particleOffset + 2] += vx;
                particles[particleOffset + 3] += vy;

                if (accumulateForce) {
                    forceX[particleIndex] += vx;
                    forceY[particleIndex] += vy;
                }
            }
        }
    }
}

function processCollisions(indices, start, count) {
    ensureCollisionBuffer(count);
    const end = start + count;
    const collisionSizeSq = settings.physics.collisionSizeSq;
    const collisionRestitution = settings.physics.collisionRestitution;
    const accumulateForce = !!settings.common.debugForce && forceX && forceY;

    for (let i = start; i < end; i++) {
        const p1Index = indices[i];
        const p1Offset = p1Index * ITEM_SIZE;
        const p1X = particles[p1Offset];
        const p1Y = particles[p1Offset + 1];
        const p1Mass = particles[p1Offset + 4];
        let nextVelX = particles[p1Offset + 2];
        let nextVelY = particles[p1Offset + 3];
        let hasCollision = false;

        for (let j = start; j < end; j++) {
            if (i === j) continue;
            const p2Index = indices[j];
            const p2Offset = p2Index * ITEM_SIZE;
            const dx = p1X - particles[p2Offset];
            const dy = p1Y - particles[p2Offset + 1];
            const distSquare = dx * dx + dy * dy;

            if (distSquare > 0 && distSquare < collisionSizeSq) {
                const p2Mass = particles[p2Offset + 4];
                const massFactor = 2 * p2Mass / (p1Mass + p2Mass);
                const dot = massFactor * ((nextVelX - particles[p2Offset + 2]) * dx + (nextVelY - particles[p2Offset + 3]) * dy);
                nextVelX -= dot / distSquare * dx;
                nextVelY -= dot / distSquare * dy;
                hasCollision = true;
            }
        }

        const localIndex = i - start;
        collisionVelX[localIndex] = hasCollision ? nextVelX * collisionRestitution : nextVelX;
        collisionVelY[localIndex] = hasCollision ? nextVelY * collisionRestitution : nextVelY;
    }

    for (let i = start; i < end; i++) {
        const particleIndex = indices[i];
        const particleOffset = particleIndex * ITEM_SIZE;
        const localIndex = i - start;
        const nextVelX = collisionVelX[localIndex];
        const nextVelY = collisionVelY[localIndex];

        if (accumulateForce) {
            forceX[particleIndex] += nextVelX - particles[particleOffset + 2];
            forceY[particleIndex] += nextVelY - particles[particleOffset + 3];
        }

        particles[particleOffset + 2] = nextVelX;
        particles[particleOffset + 3] = nextVelY;
    }
}

function integrate(indices) {
    const resistance = settings.physics.resistance;
    for (let i = 0; i < indices.length; i++) {
        const offset = indices[i] * ITEM_SIZE;
        const velX = particles[offset + 2] * resistance;
        const velY = particles[offset + 3] * resistance;
        particles[offset + 2] = velX;
        particles[offset + 3] = velY;
        particles[offset] += velX;
        particles[offset + 1] += velY;
    }
}

function processTasks(data) {
    const indices = new Uint32Array(data.indicesBuffer);
    const leafStarts = new Uint32Array(data.leafStartsBuffer);
    const leafCounts = new Uint32Array(data.leafCountsBuffer);
    const parentForceX = new Float32Array(data.parentForceXBuffer);
    const parentForceY = new Float32Array(data.parentForceYBuffer);

    let t = performance.now();
    for (let i = 0; i < leafStarts.length; i++) {
        const start = leafStarts[i];
        const count = leafCounts[i];
        calculateLeaf(indices, start, count, parentForceX[i], parentForceY[i]);
        if (settings.physics.enableCollision) {
            processCollisions(indices, start, count);
        }
    }
    const forceTime = performance.now() - t;

    t = performance.now();
    integrate(indices);
    const integrateTime = performance.now() - t;

    postMessage({
        type: "done",
        requestId: data.requestId,
        forceTime,
        integrateTime,
        leafCount: leafStarts.length,
        particleCount: indices.length,
    });
}

onmessage = (event) => {
    const data = event.data;
    switch (data.type) {
        case "init":
        case "reconfigure":
            init(data);
            postMessage({type: "ready"});
            break;
        case "process":
            processTasks(data);
            break;
        case "dispose":
            close();
            break;
    }
};

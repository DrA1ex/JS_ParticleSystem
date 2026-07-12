import test from "node:test";
import assert from "node:assert/strict";

import {PhysicsSettings, calculateInitializedTotalMass} from "../n_body/settings/physics.js";
import {Particle_initializer} from "../n_body/simulation/particle_initializer.js";
import {FlatSpatialTree} from "../n_body/simulation/flat_tree.js";
import {FlatPhysicsEngine} from "../n_body/simulation/flat_physics.js";
import {PhysicsEngine} from "../n_body/simulation/physics.js";
import {ITEM_SIZE} from "../n_body/utils/particles.js";

function createPhysicsSettings(overrides = {}) {
    return PhysicsSettings.deserialize({
        particleCount: 2001,
        particleMassFactor: 8,
        gravity: 2,
        ...overrides,
    });
}

function createEngineSettings() {
    return {
        common: {
            stats: false,
            debugForce: false,
        },
        simulation: {
            segmentMaxCount: 2,
            segmentDivider: 2,
            segmentRandomness: 0,
        },
        physics: {
            particleGravity: 1,
            symmetricForce: false,
            minInteractionDistanceSq: 1e-12,
            enableCollision: false,
            resistance: 1,
        },
    };
}

function asymmetricParticleBuffer() {
    return new Float32Array([
        0, 0, 0, 0, 1,
        9, 0, 0, 0, 1,
        10, 0, 0, 0, 9,
    ]);
}

test("particle gravity is normalized by the exact initialized mass tiers", () => {
    const physics = createPhysicsSettings();
    const particles = Particle_initializer.initialize({
        physics,
        world: {worldWidth: 100, worldHeight: 100},
    });
    const actualMass = particles.reduce((sum, particle) => sum + particle.mass, 0);

    assert.ok(Math.abs(calculateInitializedTotalMass(physics.particleCount, physics.massDistribution) - actualMass) < 1e-9);
    assert.ok(Math.abs(physics.particleGravity - physics.gravity / actualMass) < 1e-15);

    const tiny = createPhysicsSettings({particleCount: 2, particleMassFactor: 4, gravity: 1});
    const tinyParticles = Particle_initializer.initialize({
        physics: tiny,
        world: {worldWidth: 100, worldHeight: 100},
    });
    assert.deepEqual(tinyParticles.map(particle => particle.mass), [17, 1]);
    assert.equal(tiny.particleGravity, 1 / 18);
});

test("flat spatial tree aggregates mass-weighted centers", () => {
    const particles = asymmetricParticleBuffer();
    const tree = new FlatSpatialTree(particles, 2, 2, 0, {});
    const firstChild = tree.nodeFirstChild[tree.root];
    const childCount = tree.nodeChildCount[tree.root];
    assert.equal(childCount, 2);

    let leftChild = -1;
    let rightChild = -1;
    for (let i = 0; i < childCount; i++) {
        const childId = firstChild + i;
        if (tree.nodeMassCenterX[childId] < 5) leftChild = childId;
        else rightChild = childId;
    }

    assert.notEqual(leftChild, -1);
    assert.notEqual(rightChild, -1);
    assert.equal(tree.nodeMass[leftChild], 1);
    assert.equal(tree.nodeMassCenterX[leftChild], 0);
    assert.equal(tree.nodeMass[rightChild], 10);
    assert.ok(Math.abs(tree.nodeMassCenterX[rightChild] - 9.9) < 1e-12);
    assert.ok(Math.abs(tree.nodeMassCenterX[tree.root] - 9) < 1e-12);
});

test("object and flat physics use center of mass for block approximation", () => {
    const settings = createEngineSettings();
    const expectedLeftVelocity = 10 / (9.9 * 9.9) * 9.9;

    const flatParticles = asymmetricParticleBuffer();
    const flatEngine = new FlatPhysicsEngine(settings);
    flatEngine.step(flatParticles);
    assert.ok(Math.abs(flatParticles[2] - expectedLeftVelocity) < 1e-5);

    const objectParticles = [];
    const source = asymmetricParticleBuffer();
    for (let i = 0; i < source.length / ITEM_SIZE; i++) {
        const offset = i * ITEM_SIZE;
        objectParticles.push({
            x: source[offset],
            y: source[offset + 1],
            velX: source[offset + 2],
            velY: source[offset + 3],
            mass: source[offset + 4],
        });
    }
    const objectEngine = new PhysicsEngine(settings);
    objectEngine.step(objectParticles);
    assert.ok(Math.abs(objectParticles[0].velX - expectedLeftVelocity) < 1e-10);
});

test("legacy directed force calculation remains the default", () => {
    const settings = createEngineSettings();
    settings.simulation.segmentMaxCount = 8;
    settings.physics.particleGravity = 0.25;

    const source = new Float32Array([
        0, 0, 0, 0, 2,
        3, 4, 0, 0, 5,
        -7, 2, 0, 0, 3,
    ]);
    const expected = new Float32Array(source);
    const count = expected.length / ITEM_SIZE;

    // Historical directed kernel: every particle acts as an attractor and
    // updates all other particles in a separate pass.
    for (let i = 0; i < count; i++) {
        const attractorOffset = i * ITEM_SIZE;
        const attractorX = expected[attractorOffset];
        const attractorY = expected[attractorOffset + 1];
        const g = settings.physics.particleGravity * expected[attractorOffset + 4];
        for (let j = 0; j < count; j++) {
            if (i === j) continue;
            const particleOffset = j * ITEM_SIZE;
            const dx = expected[particleOffset] - attractorX;
            const dy = expected[particleOffset + 1] - attractorY;
            const distSquare = dx * dx + dy * dy;
            if (distSquare < settings.physics.minInteractionDistanceSq) continue;
            const force = -g / distSquare;
            expected[particleOffset + 2] += dx * force;
            expected[particleOffset + 3] += dy * force;
        }
    }
    for (let i = 0; i < count; i++) {
        const offset = i * ITEM_SIZE;
        expected[offset] += expected[offset + 2];
        expected[offset + 1] += expected[offset + 3];
    }

    const actual = new Float32Array(source);
    new FlatPhysicsEngine(settings).step(actual);
    assert.deepEqual([...actual], [...expected]);
});

test("symmetric force calculation is opt-in and keeps CPU layouts aligned", () => {
    const settings = createEngineSettings();
    settings.simulation.segmentMaxCount = 8;
    settings.physics.particleGravity = 0.25;
    settings.physics.symmetricForce = true;

    const source = new Float32Array([
        0, 0, 0, 0, 2,
        3, 4, 0, 0, 5,
    ]);
    const flatParticles = new Float32Array(source);
    new FlatPhysicsEngine(settings).step(flatParticles);

    const objectParticles = [
        {x: 0, y: 0, velX: 0, velY: 0, mass: 2},
        {x: 3, y: 4, velX: 0, velY: 0, mass: 5},
    ];
    new PhysicsEngine(settings).step(objectParticles);

    assert.ok(Math.abs(flatParticles[2] - 0.15) < 1e-6);
    assert.ok(Math.abs(flatParticles[3] - 0.20) < 1e-6);
    assert.ok(Math.abs(objectParticles[0].velX - flatParticles[2]) < 1e-6);
    assert.ok(Math.abs(objectParticles[0].velY - flatParticles[3]) < 1e-6);
});

test("all particle initializers fill the requested range with finite values", () => {
    for (const particleInitType of [0, 1, 2, 3, 4, 5, 6]) {
        for (const particleCount of [2, 3, 17, 100]) {
            const physics = createPhysicsSettings({particleCount, particleInitType});
            const particles = Particle_initializer.initialize({
                physics,
                world: {worldWidth: 320, worldHeight: 180},
            });

            assert.equal(particles.length, particleCount);
            for (const particle of particles) {
                assert.ok(Number.isFinite(particle.x));
                assert.ok(Number.isFinite(particle.y));
                assert.ok(Number.isFinite(particle.velX));
                assert.ok(Number.isFinite(particle.velY));
                assert.ok(Number.isFinite(particle.mass));
            }
        }
    }
});

test("exact leaf force kernel conserves momentum in object and flat layouts", () => {
    const settings = createEngineSettings();
    settings.simulation.segmentMaxCount = 8;
    settings.physics.particleGravity = 0.25;

    const source = new Float32Array([
        0, 0, 0, 0, 2,
        3, 4, 0, 0, 5,
    ]);
    const flatParticles = new Float32Array(source);
    new FlatPhysicsEngine(settings).step(flatParticles);
    const flatMomentumX = flatParticles[2] * flatParticles[4] + flatParticles[7] * flatParticles[9];
    const flatMomentumY = flatParticles[3] * flatParticles[4] + flatParticles[8] * flatParticles[9];
    assert.ok(Math.abs(flatMomentumX) < 1e-6);
    assert.ok(Math.abs(flatMomentumY) < 1e-6);

    const objectParticles = [
        {x: 0, y: 0, velX: 0, velY: 0, mass: 2},
        {x: 3, y: 4, velX: 0, velY: 0, mass: 5},
    ];
    new PhysicsEngine(settings).step(objectParticles);
    const objectMomentumX = objectParticles[0].velX * 2 + objectParticles[1].velX * 5;
    const objectMomentumY = objectParticles[0].velY * 2 + objectParticles[1].velY * 5;
    assert.ok(Math.abs(objectMomentumX) < 1e-12);
    assert.ok(Math.abs(objectMomentumY) < 1e-12);
    assert.ok(Math.abs(flatParticles[2] - objectParticles[0].velX) < 1e-6);
    assert.ok(Math.abs(flatParticles[3] - objectParticles[0].velY) < 1e-6);
});

function createCollisionSettings(overrides = {}) {
    return {
        common: {stats: false, debugForce: false},
        simulation: {segmentMaxCount: 8, segmentDivider: 2, segmentRandomness: 0},
        physics: {
            particleGravity: 0,
            minInteractionDistanceSq: 1e-12,
            enableCollision: true,
            collisionSize: 2,
            collisionSizeSq: 4,
            collisionRestitution: 1,
            collisionContactMode: "full",
            collisionLimitImpulse: false,
            collisionIgnoreMicro: false,
            collisionSeparation: 0,
            resistance: 1,
            ...overrides,
        },
    };
}

test("collision kernel applies one symmetric unequal-mass impulse", () => {
    const settings = createCollisionSettings();
    const particles = new Float32Array([
        0, 0, 1, 0, 1,
        1, 0, -1, 0, 3,
    ]);
    const momentumBefore = particles[2] * particles[4] + particles[7] * particles[9];

    new FlatPhysicsEngine(settings).step(particles);

    assert.ok(Math.abs(particles[2] - (-2)) < 1e-6);
    assert.ok(Math.abs(particles[7]) < 1e-6);
    const momentumAfter = particles[2] * particles[4] + particles[7] * particles[9];
    assert.ok(Math.abs(momentumAfter - momentumBefore) < 1e-6);

    const objectParticles = [
        {x: 0, y: 0, velX: 1, velY: 0, mass: 1},
        {x: 1, y: 0, velX: -1, velY: 0, mass: 3},
    ];
    new PhysicsEngine(settings).step(objectParticles);
    assert.ok(Math.abs(objectParticles[0].velX - particles[2]) < 1e-6);
    assert.ok(Math.abs(objectParticles[1].velX - particles[7]) < 1e-6);
});

test("coincident particles receive finite antisymmetric separation", () => {
    const settings = createCollisionSettings({
        collisionRestitution: 0,
        collisionIgnoreMicro: true,
        collisionSeparation: 0.15,
    });
    const particles = new Float32Array([
        0, 0, 0, 0, 1,
        0, 0, 0, 0, 1,
    ]);

    new FlatPhysicsEngine(settings).step(particles);

    for (const value of particles) assert.ok(Number.isFinite(value));
    assert.ok(Math.hypot(particles[2], particles[3]) > 0);
    assert.ok(Math.abs(particles[2] + particles[7]) < 1e-6);
    assert.ok(Math.abs(particles[3] + particles[8]) < 1e-6);
});

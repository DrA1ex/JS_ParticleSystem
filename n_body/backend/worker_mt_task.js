import {AppSimulationSettings} from "../settings/app.js";
import {FlatSpatialTree} from "../simulation/flat_tree.js";
import {ITEM_SIZE} from "../utils/particles.js";

let settings = null;
let particles = null;
let forceX = null;
let forceY = null;
let collisionVelX = new Float32Array(0);
let collisionVelY = new Float32Array(0);
let indexBuffers = null;
let treeWorkspace = null;

function init(data) {
    settings = AppSimulationSettings.deserialize(data.settings);
    particles = new Float32Array(data.particlesBuffer);
    forceX = data.forceXBuffer ? new Float32Array(data.forceXBuffer) : null;
    forceY = data.forceYBuffer ? new Float32Array(data.forceYBuffer) : null;
    indexBuffers = [new Int32Array(data.indexBufferA), new Int32Array(data.indexBufferB)];
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

function integrateLeaf(indices, start, count) {
    const resistance = settings.physics.resistance;
    const end = start + count;
    for (let i = start; i < end; i++) {
        const offset = indices[i] * ITEM_SIZE;
        const velX = particles[offset + 2] * resistance;
        const velY = particles[offset + 3] * resistance;
        particles[offset + 2] = velX;
        particles[offset + 3] = velY;
        particles[offset] += velX;
        particles[offset + 1] += velY;
    }
}


function buildTreeStats(tree) {
    const flopsPerOp = 14;
    let flops = 0;
    for (let nodeId = 0; nodeId < tree.nodeCount; nodeId++) {
        const childCount = tree.nodeChildCount[nodeId];
        if (childCount === 0) {
            flops += Math.pow(tree.nodeParticleCount[nodeId], 2) * flopsPerOp;
        } else {
            flops += Math.pow(childCount, 2) * flopsPerOp;
        }
    }

    return {
        flops,
        depth: tree.maxDepth,
        segmentCount: tree.nodeCount,
    };
}

function addTreeProfile(total, profile) {
    if (!profile) {
        return;
    }
    total.resetTime += profile.resetTime || 0;
    total.rootBoundsTime += profile.rootBoundsTime || 0;
    total.populateTime += profile.populateTime || 0;
    total.aggregateTime += profile.aggregateTime || 0;
    total.fastBucketPath = total.fastBucketPath && profile.fastBucketPath !== false;
}

function collectLeafTasks(tree, nodeId, pForceX, pForceY, tasks) {
    if (tree.nodeChildCount[nodeId] === 0) {
        tasks.push({
            start: tree.nodeStart[nodeId],
            count: tree.nodeParticleCount[nodeId],
            indexBuffer: tree.nodeIndexBuffer[nodeId],
            forceX: pForceX,
            forceY: pForceY,
        });
        return;
    }

    const particleGravity = settings.physics.particleGravity;
    const minInteractionDistanceSq = settings.physics.minInteractionDistanceSq;
    const firstChild = tree.nodeFirstChild[nodeId];
    const childCount = tree.nodeChildCount[nodeId];

    for (let i = 0; i < childCount; i++) {
        const childId = firstChild + i;
        let forceX = pForceX;
        let forceY = pForceY;
        const childCenterX = tree.nodeCenterX[childId];
        const childCenterY = tree.nodeCenterY[childId];

        for (let j = 0; j < childCount; j++) {
            if (i === j) continue;
            const otherId = firstChild + j;
            const dx = childCenterX - tree.nodeCenterX[otherId];
            const dy = childCenterY - tree.nodeCenterY[otherId];
            const distSquare = dx * dx + dy * dy;
            if (distSquare >= minInteractionDistanceSq) {
                const force = -(particleGravity * tree.nodeMass[otherId]) / distSquare;
                forceX += dx * force;
                forceY += dy * force;
            }
        }

        collectLeafTasks(tree, childId, forceX, forceY, tasks);
    }
}

function processLeafTasks(tasks) {
    let particleCount = 0;
    let t = performance.now();
    for (let i = 0; i < tasks.length; i++) {
        const task = tasks[i];
        const indices = indexBuffers[task.indexBuffer];
        calculateLeaf(indices, task.start, task.count, task.forceX, task.forceY);
        if (settings.physics.enableCollision) {
            processCollisions(indices, task.start, task.count);
        }
        particleCount += task.count;
    }
    const forceTime = performance.now() - t;

    t = performance.now();
    for (let i = 0; i < tasks.length; i++) {
        const task = tasks[i];
        integrateLeaf(indexBuffers[task.indexBuffer], task.start, task.count);
    }
    const integrateTime = performance.now() - t;

    return {forceTime, integrateTime, particleCount};
}

function processTreeJobs(data) {
    const jobStarts = new Uint32Array(data.jobStartsBuffer);
    const jobCounts = new Uint32Array(data.jobCountsBuffer);
    const jobIndexBuffers = new Uint8Array(data.jobIndexBuffersBuffer);
    const jobDepths = new Uint16Array(data.jobDepthsBuffer);
    const jobLeft = new Float64Array(data.jobLeftBuffer);
    const jobTop = new Float64Array(data.jobTopBuffer);
    const jobRight = new Float64Array(data.jobRightBuffer);
    const jobBottom = new Float64Array(data.jobBottomBuffer);
    const jobParentForceX = new Float32Array(data.jobParentForceXBuffer);
    const jobParentForceY = new Float32Array(data.jobParentForceYBuffer);

    const tasks = [];
    const treeProfile = {
        resetTime: 0,
        rootBoundsTime: 0,
        populateTime: 0,
        aggregateTime: 0,
        fastBucketPath: true,
    };
    const treeStats = {flops: 0, depth: 0, segmentCount: 0};

    if (!treeWorkspace) {
        treeWorkspace = {
            indices: indexBuffers[0],
            scratchIndices: indexBuffers[1],
        };
    }

    const treeStart = performance.now();
    for (let i = 0; i < jobStarts.length; i++) {
        const count = jobCounts[i];
        if (count === 0) {
            continue;
        }

        const tree = new FlatSpatialTree(
            particles,
            settings.simulation.segmentMaxCount,
            settings.simulation.segmentDivider,
            settings.simulation.segmentRandomness,
            treeWorkspace,
            {
                count,
                indexCapacity: Math.floor(particles.length / ITEM_SIZE),
                skipIndexReset: true,
                root: {
                    start: jobStarts[i],
                    count,
                    indexBuffer: jobIndexBuffers[i],
                    depth: jobDepths[i],
                    left: jobLeft[i],
                    top: jobTop[i],
                    right: jobRight[i],
                    bottom: jobBottom[i],
                }
            }
        );

        addTreeProfile(treeProfile, tree.profile);
        const stats = buildTreeStats(tree);
        treeStats.flops += stats.flops;
        treeStats.depth = Math.max(treeStats.depth, stats.depth);
        treeStats.segmentCount += stats.segmentCount;
        collectLeafTasks(tree, tree.root, jobParentForceX[i], jobParentForceY[i], tasks);
    }
    const treeTime = performance.now() - treeStart;

    const processed = processLeafTasks(tasks);

    postMessage({
        type: "done",
        requestId: data.requestId,
        treeTime,
        treeProfile,
        treeStats,
        forceTime: processed.forceTime,
        integrateTime: processed.integrateTime,
        leafCount: tasks.length,
        particleCount: processed.particleCount,
        jobCount: jobStarts.length,
    });
}

function processTasks(data) {
    const leafStarts = new Uint32Array(data.leafStartsBuffer);
    const leafCounts = new Uint32Array(data.leafCountsBuffer);
    const leafIndexBuffers = new Uint8Array(data.leafIndexBuffersBuffer);
    const parentForceX = new Float32Array(data.parentForceXBuffer);
    const parentForceY = new Float32Array(data.parentForceYBuffer);

    let particleCount = 0;
    let t = performance.now();
    for (let i = 0; i < leafStarts.length; i++) {
        const indices = indexBuffers[leafIndexBuffers[i]];
        const start = leafStarts[i];
        const count = leafCounts[i];
        calculateLeaf(indices, start, count, parentForceX[i], parentForceY[i]);
        if (settings.physics.enableCollision) {
            processCollisions(indices, start, count);
        }
        particleCount += count;
    }
    const forceTime = performance.now() - t;

    t = performance.now();
    for (let i = 0; i < leafStarts.length; i++) {
        integrateLeaf(indexBuffers[leafIndexBuffers[i]], leafStarts[i], leafCounts[i]);
    }
    const integrateTime = performance.now() - t;

    postMessage({
        type: "done",
        requestId: data.requestId,
        forceTime,
        integrateTime,
        leafCount: leafStarts.length,
        particleCount,
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
        case "process-tree":
            processTreeJobs(data);
            break;
        case "dispose":
            close();
            break;
    }
};

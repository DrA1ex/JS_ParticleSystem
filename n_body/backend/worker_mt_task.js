import {AppSimulationSettings} from "../settings/app.js";
import {FlatSpatialTree} from "../simulation/flat_tree.js";
import {ITEM_SIZE} from "../utils/particles.js";
import {BUILD_ID, WORKER_PROTOCOL_VERSION} from "../utils/build.js";
import {COLLISION_MIN_CLOSING_SPEED_SQ, collisionMinDistanceSq, collisionDeltaScale, collisionFallbackNormal} from "../simulation/collision_response.js";

let settings = null;
let particles = null;
let forceX = null;
let forceY = null;
let collisionVelX = new Float64Array(0);
let collisionVelY = new Float64Array(0);
let collisionContactCount = new Uint32Array(0);
let collisionImpulseSq = new Float64Array(0);
let indexBuffers = null;
let treeWorkspace = null;
let recursiveBucketIds = new Int32Array(0);
let recursivePartitionCountSampleTime = 0;
let recursivePartitionScatterSampleTime = 0;
let recursivePartitionCountSampleParticles = 0;
let recursivePartitionScatterSampleParticles = 0;
let recursivePartitionCountParticles = 0;
let recursivePartitionScatterParticles = 0;
let recursivePartitionTimingCounter = 0;
let recursivePartitionTimingSamples = 0;
const EPSILON = 0.1e-6;
const RECURSIVE_PARTITION_TIMING_MASK = 63;

function resetRecursivePartitionProfile() {
    recursivePartitionCountSampleTime = 0;
    recursivePartitionScatterSampleTime = 0;
    recursivePartitionCountSampleParticles = 0;
    recursivePartitionScatterSampleParticles = 0;
    recursivePartitionCountParticles = 0;
    recursivePartitionScatterParticles = 0;
    recursivePartitionTimingCounter = 0;
    recursivePartitionTimingSamples = 0;
}

function getRecursivePartitionProfile() {
    return {
        recursivePartitionCountTime: recursivePartitionCountSampleParticles > 0
            ? recursivePartitionCountSampleTime * recursivePartitionCountParticles / recursivePartitionCountSampleParticles
            : 0,
        recursivePartitionScatterTime: recursivePartitionScatterSampleParticles > 0
            ? recursivePartitionScatterSampleTime * recursivePartitionScatterParticles / recursivePartitionScatterSampleParticles
            : 0,
        recursivePartitionCountParticles,
        recursivePartitionScatterParticles,
        recursivePartitionTimingSamples,
    };
}

function init(data) {
    if (data.expectedBuildId && data.expectedBuildId !== BUILD_ID) {
        throw new Error(`worker-mt task build mismatch: expected ${data.expectedBuildId}, got ${BUILD_ID}`);
    }
    if (data.expectedProtocolVersion && data.expectedProtocolVersion !== WORKER_PROTOCOL_VERSION) {
        throw new Error(`worker-mt task protocol mismatch: expected ${data.expectedProtocolVersion}, got ${WORKER_PROTOCOL_VERSION}`);
    }
    settings = AppSimulationSettings.deserialize(data.settings);
    if (Number.isFinite(data.segmentMaxCount)) {
        settings.simulation.config.segmentMaxCount = Math.max(1, Math.floor(data.segmentMaxCount));
    }
    particles = new Float32Array(data.particlesBuffer);
    forceX = data.forceXBuffer ? new Float32Array(data.forceXBuffer) : null;
    forceY = data.forceYBuffer ? new Float32Array(data.forceYBuffer) : null;
    indexBuffers = [new Int32Array(data.indexBufferA), new Int32Array(data.indexBufferB)];
    // Rebind the reusable flat-tree workspace whenever coordinator buffers are
    // replaced (for example after particle-count/state reconfiguration).
    treeWorkspace = {
        indices: indexBuffers[0],
        scratchIndices: indexBuffers[1],
    };
}


function setSegmentMaxCount(data) {
    if (!settings) {
        throw new Error("worker-mt task is not initialized");
    }
    const segmentMaxCount = Number.parseInt(data.segmentMaxCount, 10);
    if (!Number.isFinite(segmentMaxCount) || segmentMaxCount < 1) {
        throw new Error(`Invalid segment max count: ${data.segmentMaxCount}`);
    }
    settings.simulation.config.segmentMaxCount = segmentMaxCount;
    postMessage({
        type: "done",
        requestId: data.requestId,
        segmentMaxCount,
    });
}

function processHybridSeedBounds(data) {
    const start = Math.max(0, data.startParticle | 0);
    const end = Math.max(start, data.endParticle | 0);
    const sourceIndices = indexBuffers[0];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (let particleIndex = start; particleIndex < end; particleIndex++) {
        sourceIndices[particleIndex] = particleIndex;
        const offset = particleIndex * ITEM_SIZE;
        const x = particles[offset];
        const y = particles[offset + 1];
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    }

    postMessage({
        type: "done",
        requestId: data.requestId,
        minX: Number.isFinite(minX) ? minX : null,
        minY: Number.isFinite(minY) ? minY : null,
        maxX: Number.isFinite(maxX) ? maxX : null,
        maxY: Number.isFinite(maxY) ? maxY : null,
        particleCount: end - start,
    });
}

function processHybridSeedCount(data) {
    const start = Math.max(0, data.startParticle | 0);
    const end = Math.max(start, data.endParticle | 0);
    const xMid = data.xMid;
    const yMid = data.yMid;
    const bucketCounts = [0, 0, 0, 0];
    const bucketMass = [0, 0, 0, 0];
    const bucketMomentX = [0, 0, 0, 0];
    const bucketMomentY = [0, 0, 0, 0];

    for (let particleIndex = start; particleIndex < end; particleIndex++) {
        const offset = particleIndex * ITEM_SIZE;
        const x = particles[offset];
        const y = particles[offset + 1];
        const mass = particles[offset + 4];
        const bucketIndex = (x < xMid ? 0 : 2) + (y < yMid ? 0 : 1);
        bucketCounts[bucketIndex] += 1;
        bucketMass[bucketIndex] += mass;
        bucketMomentX[bucketIndex] += x * mass;
        bucketMomentY[bucketIndex] += y * mass;
    }

    postMessage({
        type: "done",
        requestId: data.requestId,
        bucketCounts,
        bucketMass,
        bucketMomentX,
        bucketMomentY,
        particleCount: end - start,
    });
}

function processHybridSeedScatter(data) {
    const start = Math.max(0, data.startParticle | 0);
    const end = Math.max(start, data.endParticle | 0);
    const xMid = data.xMid;
    const yMid = data.yMid;
    const targetIndices = indexBuffers[1];
    const writes = Array.isArray(data.bucketOffsets) ? data.bucketOffsets.slice(0, 4) : [0, 0, 0, 0];

    for (let particleIndex = start; particleIndex < end; particleIndex++) {
        const offset = particleIndex * ITEM_SIZE;
        const bucketIndex = (particles[offset] < xMid ? 0 : 2) + (particles[offset + 1] < yMid ? 0 : 1);
        targetIndices[writes[bucketIndex]++] = particleIndex;
    }

    postMessage({
        type: "done",
        requestId: data.requestId,
        particleCount: end - start,
    });
}

function ensureCollisionBuffer(length) {
    if (collisionVelX.length < length) {
        collisionVelX = new Float64Array(length);
        collisionVelY = new Float64Array(length);
        collisionContactCount = new Uint32Array(length);
        collisionImpulseSq = new Float64Array(length);
    }
}







function calculateLeaf(indices, start, count, pForceX, pForceY) {
    const end = start + count;
    const particleGravity = settings.physics.particleGravity;
    const minInteractionDistanceSq = settings.physics.minInteractionDistanceSq;
    const accumulateForce = !!settings.common.debugForce && forceX && forceY;

    for (let i = start; i < end - 1; i++) {
        const indexI = indices[i];
        const offsetI = indexI * ITEM_SIZE;
        particles[offsetI + 2] += pForceX;
        particles[offsetI + 3] += pForceY;
        if (accumulateForce) {
            forceX[indexI] += pForceX;
            forceY[indexI] += pForceY;
        }
        const xI = particles[offsetI];
        const yI = particles[offsetI + 1];
        const massI = particles[offsetI + 4];
        for (let j = i + 1; j < end; j++) {
            const indexJ = indices[j];
            const offsetJ = indexJ * ITEM_SIZE;
            const dx = particles[offsetJ] - xI;
            const dy = particles[offsetJ + 1] - yI;
            const distSquare = dx * dx + dy * dy;
            if (distSquare < minInteractionDistanceSq) continue;

            const scale = particleGravity / distSquare;
            const massJ = particles[offsetJ + 4];
            const dvIX = dx * scale * massJ;
            const dvIY = dy * scale * massJ;
            const dvJX = -dx * scale * massI;
            const dvJY = -dy * scale * massI;
            particles[offsetI + 2] += dvIX;
            particles[offsetI + 3] += dvIY;
            particles[offsetJ + 2] += dvJX;
            particles[offsetJ + 3] += dvJY;

            if (accumulateForce) {
                forceX[indexI] += dvIX;
                forceY[indexI] += dvIY;
                forceX[indexJ] += dvJX;
                forceY[indexJ] += dvJY;
            }
        }
    }
    if (count > 0) {
        const lastIndex = indices[end - 1];
        const lastOffset = lastIndex * ITEM_SIZE;
        particles[lastOffset + 2] += pForceX;
        particles[lastOffset + 3] += pForceY;
        if (accumulateForce) {
            forceX[lastIndex] += pForceX;
            forceY[lastIndex] += pForceY;
        }
    }
}

function processCollisions(indices, start, count) {
    ensureCollisionBuffer(count);
    const end = start + count;
    const collisionSize = settings.physics.collisionSize;
    const collisionSizeSq = settings.physics.collisionSizeSq;
    const minCollisionDistanceSq = collisionMinDistanceSq(collisionSizeSq);
    const restitution = settings.physics.collisionRestitution;
    const contactMode = settings.physics.collisionContactMode;
    const limitImpulse = settings.physics.collisionLimitImpulse;
    const separationStrength = settings.physics.collisionSeparation;
    const minClosingSpeedSq = settings.physics.collisionIgnoreMicro
        ? COLLISION_MIN_CLOSING_SPEED_SQ
        : 0;
    const impulseRestitution = 1 + restitution;
    const accumulateForce = !!settings.common.debugForce && forceX && forceY;

    collisionVelX.fill(0, 0, count);
    collisionVelY.fill(0, 0, count);
    collisionContactCount.fill(0, 0, count);
    collisionImpulseSq.fill(0, 0, count);

    for (let i = start; i < end - 1; i++) {
        const localI = i - start;
        const p1Index = indices[i];
        const p1Offset = p1Index * ITEM_SIZE;
        const p1X = particles[p1Offset];
        const p1Y = particles[p1Offset + 1];
        const p1VelX = particles[p1Offset + 2];
        const p1VelY = particles[p1Offset + 3];
        const p1Mass = particles[p1Offset + 4];

        for (let j = i + 1; j < end; j++) {
            const localJ = j - start;
            const p2Index = indices[j];
            const p2Offset = p2Index * ITEM_SIZE;
            const dx = p1X - particles[p2Offset];
            const dy = p1Y - particles[p2Offset + 1];
            const distSquare = dx * dx + dy * dy;
            if (distSquare >= collisionSizeSq) continue;

            let distance = 0;
            let normalX;
            let normalY;
            if (distSquare <= minCollisionDistanceSq) {
                [normalX, normalY] = collisionFallbackNormal(p1Index, p2Index);
            } else {
                distance = Math.sqrt(distSquare);
                normalX = dx / distance;
                normalY = dy / distance;
            }

            const relativeNormal = (p1VelX - particles[p2Offset + 2]) * normalX
                + (p1VelY - particles[p2Offset + 3]) * normalY;
            let closingSpeed = Math.max(0, -relativeNormal);
            if (closingSpeed * closingSpeed <= minClosingSpeedSq) {
                closingSpeed = 0;
            }

            const penetration = Math.max(0, collisionSize - distance);
            const targetSeparationSpeed = separationStrength * penetration;
            const separationSpeed = Math.max(0, targetSeparationSpeed - Math.max(0, relativeNormal));
            const desiredRelativeChange = impulseRestitution * closingSpeed + separationSpeed;
            if (desiredRelativeChange <= 0) continue;

            const p2Mass = particles[p2Offset + 4];
            const massSum = p1Mass + p2Mass;
            if (!(massSum > 0) || !Number.isFinite(massSum)) continue;

            const deltaSpeedI = desiredRelativeChange * p2Mass / massSum;
            const deltaSpeedJ = desiredRelativeChange * p1Mass / massSum;
            const deltaIX = deltaSpeedI * normalX;
            const deltaIY = deltaSpeedI * normalY;
            const deltaJX = -deltaSpeedJ * normalX;
            const deltaJY = -deltaSpeedJ * normalY;

            collisionVelX[localI] += deltaIX;
            collisionVelY[localI] += deltaIY;
            collisionVelX[localJ] += deltaJX;
            collisionVelY[localJ] += deltaJY;
            collisionImpulseSq[localI] += deltaIX * deltaIX + deltaIY * deltaIY;
            collisionImpulseSq[localJ] += deltaJX * deltaJX + deltaJY * deltaJY;
            collisionContactCount[localI] += 1;
            collisionContactCount[localJ] += 1;
        }
    }

    for (let i = start; i < end; i++) {
        const localIndex = i - start;
        const particleIndex = indices[i];
        const particleOffset = particleIndex * ITEM_SIZE;
        const deltaScale = collisionDeltaScale(
            collisionVelX[localIndex],
            collisionVelY[localIndex],
            collisionContactCount[localIndex],
            collisionImpulseSq[localIndex],
            contactMode,
            limitImpulse,
        );
        const deltaVelX = collisionVelX[localIndex] * deltaScale;
        const deltaVelY = collisionVelY[localIndex] * deltaScale;

        if (accumulateForce) {
            forceX[particleIndex] += deltaVelX;
            forceY[particleIndex] += deltaVelY;
        }

        particles[particleOffset + 2] += deltaVelX;
        particles[particleOffset + 3] += deltaVelY;
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
            const particleCount = tree.nodeParticleCount[nodeId];
            flops += particleCount * Math.max(0, particleCount - 1) / 2 * flopsPerOp;
        } else {
            flops += childCount * Math.max(0, childCount - 1) * flopsPerOp;
        }
    }

    return {
        flops,
        depth: tree.maxDepth,
        segmentCount: tree.nodeCount,
    };
}

function addTreeProfile(total, profile) {
    if (!profile) return;
    total.resetTime += profile.resetTime || 0;
    total.rootBoundsTime += profile.rootBoundsTime || 0;
    total.populateTime += profile.populateTime || 0;
    total.aggregateTime += profile.aggregateTime || 0;
    total.partitionCountParticles += profile.partitionCountParticles || 0;
    total.partitionScatterParticles += profile.partitionScatterParticles || 0;
    total.partitionCountTime += profile.partitionCountTime || 0;
    total.partitionScatterTime += profile.partitionScatterTime || 0;
    total.partitionTimingSamples += profile.partitionTimingSamples || 0;
    total.nodeInitCount += profile.nodeInitCount || 0;
    total.leafCollectTime += profile.leafCollectTime || 0;
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
        const childCenterX = tree.nodeMassCenterX[childId];
        const childCenterY = tree.nodeMassCenterY[childId];

        for (let j = 0; j < childCount; j++) {
            if (i === j) continue;
            const otherId = firstChild + j;
            const dx = childCenterX - tree.nodeMassCenterX[otherId];
            const dy = childCenterY - tree.nodeMassCenterY[otherId];
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



function createForceMetrics() {
    return {
        pairChecks: 0,
        kernelTime: 0,
        collisionTime: 0,
    };
}


function finalizeForceMetrics(metrics) {
    return {
        forceKernel: "symmetric",
        forcePairChecks: metrics.pairChecks,
        forceKernelTime: metrics.kernelTime,
        forceCollisionTime: metrics.collisionTime,
        forceGatherTime: 0,
        forcePairTime: metrics.kernelTime,
        forceFlushTime: 0,
        forceTimingSamples: 0,
    };
}


function processLeafTasks(tasks, taskCount = tasks.length) {
    let particleCount = 0;
    const forceMetrics = createForceMetrics();
    let t = performance.now();
    for (let i = 0; i < taskCount; i++) {
        const task = tasks[i];
        const indices = indexBuffers[task.indexBuffer];
        forceMetrics.pairChecks += task.count * Math.max(0, task.count - 1) / 2;
        calculateLeaf(indices, task.start, task.count, task.forceX, task.forceY);
        particleCount += task.count;
    }
    forceMetrics.kernelTime = performance.now() - t;

    if (settings.physics.enableCollision) {
        t = performance.now();
        for (let i = 0; i < taskCount; i++) {
            const task = tasks[i];
            processCollisions(indexBuffers[task.indexBuffer], task.start, task.count);
        }
        forceMetrics.collisionTime = performance.now() - t;
    }
    const forceTime = forceMetrics.kernelTime + forceMetrics.collisionTime;

    t = performance.now();
    for (let i = 0; i < taskCount; i++) {
        const task = tasks[i];
        integrateLeaf(indexBuffers[task.indexBuffer], task.start, task.count);
    }
    const integrateTime = performance.now() - t;

    return {
        forceTime,
        integrateTime,
        particleCount,
        ...finalizeForceMetrics(forceMetrics),
    };
}



function ensureRecursiveBucketIds(length) {
    if (recursiveBucketIds.length < length) {
        recursiveBucketIds = new Int32Array(length);
    }
}

function buildParallelMid(start, size) {
    const randomness = settings.simulation.segmentRandomness;
    const firstWeight = 1 + randomness * (Math.random() - 0.5);
    const secondWeight = 1 + randomness * (Math.random() - 0.5);
    return start + size * firstWeight / (firstWeight + secondWeight);
}

function parallelNodeHasSinglePoint(node, indices) {
    if (node.count < 2) {
        return true;
    }
    const firstOffset = indices[node.start] * ITEM_SIZE;
    const x = particles[firstOffset];
    const y = particles[firstOffset + 1];
    const end = node.start + node.count;
    for (let i = node.start + 1; i < end; i++) {
        const offset = indices[i] * ITEM_SIZE;
        if (Math.abs(particles[offset] - x) > EPSILON || Math.abs(particles[offset + 1] - y) > EPSILON) {
            return false;
        }
    }
    return true;
}

function splitRecursiveNode(node) {
    const sourceIndices = indexBuffers[node.indexBuffer];
    const targetBufferId = 1 - node.indexBuffer;
    const targetIndices = indexBuffers[targetBufferId];
    const left = node.left;
    const top = node.top;
    const right = node.right;
    const bottom = node.bottom;
    const xMid = buildParallelMid(left, right - left);
    const yMid = buildParallelMid(top, bottom - top);
    const start = node.start;
    const end = start + node.count;
    const bucketCounts = new Int32Array(4);
    const bucketMass = new Float64Array(4);
    const bucketMomentX = new Float64Array(4);
    const bucketMomentY = new Float64Array(4);
    ensureRecursiveBucketIds(node.count);
    let usedBuckets = 0;

    const measurePartitionTiming = (recursivePartitionTimingCounter++ & RECURSIVE_PARTITION_TIMING_MASK) === 0;
    let partitionTimer = measurePartitionTiming ? performance.now() : 0;
    for (let i = start; i < end; i++) {
        const particleIndex = sourceIndices[i];
        const offset = particleIndex * ITEM_SIZE;
        const particleX = particles[offset];
        const particleY = particles[offset + 1];
        const particleMass = particles[offset + 4];
        const bucketIndex = (particleX < xMid ? 0 : 2) + (particleY < yMid ? 0 : 1);
        recursiveBucketIds[i - start] = bucketIndex;
        if (bucketCounts[bucketIndex] === 0) usedBuckets += 1;
        bucketCounts[bucketIndex] += 1;
        bucketMass[bucketIndex] += particleMass;
        bucketMomentX[bucketIndex] += particleX * particleMass;
        bucketMomentY[bucketIndex] += particleY * particleMass;
    }
    recursivePartitionCountParticles += node.count;
    if (measurePartitionTiming) {
        recursivePartitionCountSampleTime += performance.now() - partitionTimer;
        recursivePartitionCountSampleParticles += node.count;
        recursivePartitionTimingSamples += 1;
    }

    if (usedBuckets <= 1 && parallelNodeHasSinglePoint(node, sourceIndices)) return [node];

    const bucketStarts = new Int32Array(4);
    const bucketWrites = new Int32Array(4);
    let writeStart = start;
    for (let i = 0; i < 4; i++) {
        bucketStarts[i] = writeStart;
        bucketWrites[i] = writeStart;
        writeStart += bucketCounts[i];
    }

    const measureScatterTiming = measurePartitionTiming || recursivePartitionScatterSampleParticles === 0;
    partitionTimer = measureScatterTiming ? performance.now() : 0;
    for (let i = start; i < end; i++) {
        const bucketIndex = recursiveBucketIds[i - start];
        targetIndices[bucketWrites[bucketIndex]++] = sourceIndices[i];
    }
    recursivePartitionScatterParticles += node.count;
    if (measureScatterTiming) {
        recursivePartitionScatterSampleTime += performance.now() - partitionTimer;
        recursivePartitionScatterSampleParticles += node.count;
        if (!measurePartitionTiming) recursivePartitionTimingSamples += 1;
    }

    const children = [];
    for (let bucketIndex = 0; bucketIndex < 4; bucketIndex++) {
        const count = bucketCounts[bucketIndex];
        if (count === 0) continue;
        const x = bucketIndex >> 1;
        const y = bucketIndex & 1;
        const childLeft = x === 0 ? left : xMid;
        const childRight = x === 0 ? xMid : right + EPSILON;
        const childTop = y === 0 ? top : yMid;
        const childBottom = y === 0 ? yMid : bottom + EPSILON;
        const mass = bucketMass[bucketIndex];
        const massCenterX = mass !== 0 ? bucketMomentX[bucketIndex] / mass : NaN;
        const massCenterY = mass !== 0 ? bucketMomentY[bucketIndex] / mass : NaN;
        children.push({
            start: bucketStarts[bucketIndex],
            count,
            indexBuffer: targetBufferId,
            depth: node.depth + 1,
            left: childLeft,
            top: childTop,
            right: childRight,
            bottom: childBottom,
            centerX: Number.isFinite(massCenterX) ? massCenterX : childLeft + (childRight - childLeft) / 2,
            centerY: Number.isFinite(massCenterY) ? massCenterY : childTop + (childBottom - childTop) / 2,
            mass,
            parentForceX: node.parentForceX,
            parentForceY: node.parentForceY,
        });
    }

    const particleGravity = settings.physics.particleGravity;
    const minInteractionDistanceSq = settings.physics.minInteractionDistanceSq;
    for (let i = 0; i < children.length; i++) {
        const child = children[i];
        let forceXValue = child.parentForceX;
        let forceYValue = child.parentForceY;
        for (let j = 0; j < children.length; j++) {
            if (i === j) continue;
            const other = children[j];
            const dx = child.centerX - other.centerX;
            const dy = child.centerY - other.centerY;
            const distSquare = dx * dx + dy * dy;
            if (distSquare >= minInteractionDistanceSq) {
                const force = -(particleGravity * other.mass) / distSquare;
                forceXValue += dx * force;
                forceYValue += dy * force;
            }
        }
        child.parentForceX = forceXValue;
        child.parentForceY = forceYValue;
    }
    return children;
}


function shouldSplitRecursiveNode(node, splitBudget, minJobParticles) {
    return splitBudget > 0 &&
        node.count > Math.max(settings.simulation.segmentMaxCount, minJobParticles) &&
        node.right - node.left > EPSILON &&
        node.bottom - node.top > EPSILON;
}



function readTreeJobs(data) {
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

    const jobs = [];
    for (let i = 0; i < jobStarts.length; i++) {
        const count = jobCounts[i];
        if (count === 0) {
            continue;
        }
        jobs.push({
            start: jobStarts[i],
            count,
            indexBuffer: jobIndexBuffers[i],
            depth: jobDepths[i],
            left: jobLeft[i],
            top: jobTop[i],
            right: jobRight[i],
            bottom: jobBottom[i],
            parentForceX: jobParentForceX[i],
            parentForceY: jobParentForceY[i],
        });
    }
    return jobs;
}

function createDebugEntryFromJob(job) {
    return {
        x: job.left,
        y: job.top,
        width: job.right - job.left,
        height: job.bottom - job.top,
        count: job.count,
        depth: job.depth,
    };
}

function createEmptyTreeProfile() {
    return {
        resetTime: 0,
        rootBoundsTime: 0,
        populateTime: 0,
        aggregateTime: 0,
        partitionCountParticles: 0,
        partitionScatterParticles: 0,
        partitionCountTime: 0,
        partitionScatterTime: 0,
        partitionTimingSamples: 0,
        nodeInitCount: 0,
        leafCollectTime: 0,
        fastBucketPath: true,
    };
}


function buildAndProcessTreeJobs(jobs, requestId, extra = {}, options = {}) {
    const tasks = [];
    const treeProfile = createEmptyTreeProfile();
    const treeStats = {flops: 0, depth: 0, segmentCount: 0};
    const treeDebug = options.debugTree ? (Array.isArray(options.treeDebug) ? options.treeDebug.slice() : []) : null;

    if (!treeWorkspace) {
        treeWorkspace = {indices: indexBuffers[0], scratchIndices: indexBuffers[1]};
    }

    const treeStart = performance.now();
    for (const job of jobs) {
        if (job.count === 0) continue;
        const tree = new FlatSpatialTree(
            particles,
            settings.simulation.segmentMaxCount,
            settings.simulation.segmentDivider,
            settings.simulation.segmentRandomness,
            treeWorkspace,
            {
                count: job.count,
                indexCapacity: Math.floor(particles.length / ITEM_SIZE),
                skipIndexReset: true,
                root: {
                    start: job.start,
                    count: job.count,
                    indexBuffer: job.indexBuffer,
                    depth: job.depth,
                    left: job.left,
                    top: job.top,
                    right: job.right,
                    bottom: job.bottom,
                }
            }
        );
        addTreeProfile(treeProfile, tree.profile);
        if (treeDebug) treeDebug.push(...tree.getDebugData());
        const stats = buildTreeStats(tree);
        treeStats.flops += stats.flops;
        treeStats.depth = Math.max(treeStats.depth, stats.depth);
        treeStats.segmentCount += stats.segmentCount;
        const leafCollectStart = performance.now();
        collectLeafTasks(tree, tree.root, job.parentForceX, job.parentForceY, tasks);
        treeProfile.leafCollectTime += performance.now() - leafCollectStart;
    }
    const treeTime = performance.now() - treeStart;
    const processed = processLeafTasks(tasks);

    postMessage({
        type: "done",
        requestId,
        treeTime,
        treeProfile,
        treeStats,
        forceTime: processed.forceTime,
        integrateTime: processed.integrateTime,
        leafCount: tasks.length,
        particleCount: processed.particleCount,
        forceKernel: processed.forceKernel,
        forcePairChecks: processed.forcePairChecks,
        forceKernelTime: processed.forceKernelTime,
        forceCollisionTime: processed.forceCollisionTime,
        forceGatherTime: processed.forceGatherTime,
        forcePairTime: processed.forcePairTime,
        forceFlushTime: processed.forceFlushTime,
        forceTimingSamples: processed.forceTimingSamples,
        jobCount: jobs.length,
        treeDebug: treeDebug || undefined,
        ...extra,
    });
}




function postEmptyHybridTreeResult(data, splitTime, spawnedJobs, splitCount, treeDebug = null) {
    postMessage({
        type: "done",
        requestId: data.requestId,
        treeTime: splitTime,
        treeProfile: {resetTime: 0, rootBoundsTime: 0, populateTime: splitTime, aggregateTime: 0, fastBucketPath: true},
        treeStats: {flops: 0, depth: 0, segmentCount: 0},
        forceTime: 0,
        integrateTime: 0,
        leafCount: 0,
        particleCount: 0,
        jobCount: 0,
        treeDebug: treeDebug || undefined,
        spawnedJobs,
        recursiveSplitCount: splitCount,
        recursiveSplitTime: splitTime,
        hybridEarlySplit: spawnedJobs.length > 0,
        hybridEarlySplitJobs: spawnedJobs.length,
        ...getRecursivePartitionProfile(),
        forceKernel: "symmetric",
    });
}


function processHybridTreeJobs(data) {
    resetRecursivePartitionProfile();
    const jobs = readTreeJobs(data);
    const splitBudget = Number.isFinite(data.splitBudget) ? data.splitBudget : 1;
    const minJobParticles = Number.isFinite(data.minJobParticles) ? data.minJobParticles : 32768;
    const localJobs = [];
    const spawnedJobs = [];
    const treeDebug = data.debugTree === true ? [] : null;
    let splitCount = 0;
    const splitStart = performance.now();

    for (const job of jobs) {
        if (shouldSplitRecursiveNode(job, splitBudget - splitCount, minJobParticles)) {
            const children = splitRecursiveNode(job);
            if (children.length > 1) {
                if (treeDebug) treeDebug.push(createDebugEntryFromJob(job));
                splitCount += 1;
                spawnedJobs.push(...children);
                continue;
            }
        }
        localJobs.push(job);
    }

    const splitTime = performance.now() - splitStart;
    if (spawnedJobs.length > 0) {
        spawnedJobs.push(...localJobs);
        spawnedJobs.sort((a, b) => b.count - a.count);
        postEmptyHybridTreeResult(data, splitTime, spawnedJobs, splitCount, treeDebug);
        return;
    }
    if (localJobs.length === 0) {
        postEmptyHybridTreeResult(data, splitTime, [], splitCount, treeDebug);
        return;
    }
    buildAndProcessTreeJobs(localJobs, data.requestId, {
        spawnedJobs: [],
        recursiveSplitCount: splitCount,
        recursiveSplitTime: splitTime,
        hybridEarlySplit: false,
        hybridEarlySplitJobs: 0,
        ...getRecursivePartitionProfile(),
    }, {debugTree: data.debugTree === true, treeDebug});
}



function processTasks(data) {
    const leafStarts = new Uint32Array(data.leafStartsBuffer);
    const leafCounts = new Uint32Array(data.leafCountsBuffer);
    const leafIndexBuffers = new Uint8Array(data.leafIndexBuffersBuffer);
    const parentForceX = new Float32Array(data.parentForceXBuffer);
    const parentForceY = new Float32Array(data.parentForceYBuffer);
    const forceMetrics = createForceMetrics();

    let particleCount = 0;
    let t = performance.now();
    for (let i = 0; i < leafStarts.length; i++) {
        const indices = indexBuffers[leafIndexBuffers[i]];
        const count = leafCounts[i];
        forceMetrics.pairChecks += count * Math.max(0, count - 1) / 2;
        calculateLeaf(indices, leafStarts[i], count, parentForceX[i], parentForceY[i]);
        particleCount += count;
    }
    forceMetrics.kernelTime = performance.now() - t;

    if (settings.physics.enableCollision) {
        t = performance.now();
        for (let i = 0; i < leafStarts.length; i++) {
            processCollisions(indexBuffers[leafIndexBuffers[i]], leafStarts[i], leafCounts[i]);
        }
        forceMetrics.collisionTime = performance.now() - t;
    }
    const forceTime = forceMetrics.kernelTime + forceMetrics.collisionTime;

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
        ...finalizeForceMetrics(forceMetrics),
    });
}


onmessage = (event) => {
    const data = event.data;
    switch (data.type) {
        case "init":
        case "reconfigure":
            try {
                init(data);
                postMessage({type: "ready", buildId: BUILD_ID, protocolVersion: WORKER_PROTOCOL_VERSION});
            } catch (error) {
                postMessage({
                    type: "init-error",
                    message: error?.message || String(error),
                    buildId: BUILD_ID,
                    protocolVersion: WORKER_PROTOCOL_VERSION,
                });
            }
            break;
        case "process":
            processTasks(data);
            break;
        case "process-tree-hybrid":
            processHybridTreeJobs(data);
            break;
        case "hybrid-seed-bounds":
            processHybridSeedBounds(data);
            break;
        case "hybrid-seed-count":
            processHybridSeedCount(data);
            break;
        case "hybrid-seed-scatter":
            processHybridSeedScatter(data);
            break;
        case "set-segment-max-count":
            try {
                setSegmentMaxCount(data);
            } catch (error) {
                postMessage({
                    type: "done",
                    requestId: data.requestId,
                    error: error?.message || String(error),
                });
            }
            break;
        case "dispose":
            close();
            break;
    }
};

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
let recursiveBucketIds = new Int32Array(0);
const EPSILON = 0.1e-6;

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
    const width = right - left;
    const height = bottom - top;
    const xMid = buildParallelMid(left, width);
    const yMid = buildParallelMid(top, height);
    const start = node.start;
    const end = start + node.count;
    const bucketCounts = new Int32Array(4);
    const bucketMass = new Float64Array(4);
    ensureRecursiveBucketIds(node.count);
    let usedBuckets = 0;

    for (let i = start; i < end; i++) {
        const particleIndex = sourceIndices[i];
        const offset = particleIndex * ITEM_SIZE;
        const bucketIndex = (particles[offset] < xMid ? 0 : 2) + (particles[offset + 1] < yMid ? 0 : 1);
        recursiveBucketIds[i - start] = bucketIndex;
        if (bucketCounts[bucketIndex] === 0) {
            usedBuckets += 1;
        }
        bucketCounts[bucketIndex] += 1;
        bucketMass[bucketIndex] += particles[offset + 4];
    }

    if (usedBuckets <= 1 && parallelNodeHasSinglePoint(node, sourceIndices)) {
        return [node];
    }

    const bucketStarts = new Int32Array(4);
    const bucketWrites = new Int32Array(4);
    let writeStart = start;
    for (let i = 0; i < 4; i++) {
        bucketStarts[i] = writeStart;
        bucketWrites[i] = writeStart;
        writeStart += bucketCounts[i];
    }

    for (let i = start; i < end; i++) {
        const bucketIndex = recursiveBucketIds[i - start];
        targetIndices[bucketWrites[bucketIndex]++] = sourceIndices[i];
    }

    const children = [];
    for (let bucketIndex = 0; bucketIndex < 4; bucketIndex++) {
        const bucketCount = bucketCounts[bucketIndex];
        if (bucketCount === 0) {
            continue;
        }
        const x = bucketIndex >> 1;
        const y = bucketIndex & 1;
        const childLeft = x === 0 ? left : xMid;
        const childRight = x === 0 ? xMid : right + EPSILON;
        const childTop = y === 0 ? top : yMid;
        const childBottom = y === 0 ? yMid : bottom + EPSILON;
        children.push({
            start: bucketStarts[bucketIndex],
            count: bucketCount,
            indexBuffer: targetBufferId,
            depth: node.depth + 1,
            left: childLeft,
            top: childTop,
            right: childRight,
            bottom: childBottom,
            centerX: childLeft + (childRight - childLeft) / 2,
            centerY: childTop + (childBottom - childTop) / 2,
            mass: bucketMass[bucketIndex],
            parentForceX: node.parentForceX,
            parentForceY: node.parentForceY,
        });
    }

    const particleGravity = settings.physics.particleGravity;
    const minInteractionDistanceSq = settings.physics.minInteractionDistanceSq;
    for (let i = 0; i < children.length; i++) {
        const child = children[i];
        let forceX = child.parentForceX;
        let forceY = child.parentForceY;
        for (let j = 0; j < children.length; j++) {
            if (i === j) continue;
            const other = children[j];
            const dx = child.centerX - other.centerX;
            const dy = child.centerY - other.centerY;
            const distSquare = dx * dx + dy * dy;
            if (distSquare >= minInteractionDistanceSq) {
                const force = -(particleGravity * other.mass) / distSquare;
                forceX += dx * force;
                forceY += dy * force;
            }
        }
        child.parentForceX = forceX;
        child.parentForceY = forceY;
    }

    return children;
}

function shouldSplitRecursiveNode(node, splitBudget, minJobParticles) {
    return splitBudget > 0 &&
        node.count > Math.max(settings.simulation.segmentMaxCount, minJobParticles) &&
        node.right - node.left > EPSILON &&
        node.bottom - node.top > EPSILON;
}

function estimateHybridNodeWorkByCount(count, depth = 1) {
    if (!Number.isFinite(count) || count <= 0) {
        return 0;
    }

    const treeCost = count * Math.max(1, Math.log2(Math.max(2, count)));
    const solveTailCost = count * Math.sqrt(Math.max(1, count));
    const depthBias = 1 + Math.min(0.5, Math.max(0, depth - 1) * 0.025);
    return (treeCost + solveTailCost * 0.02) * depthBias;
}

function isUsefulHybridSplit(job, children, options) {
    if (children.length <= 1) {
        return false;
    }

    let largest = 0;
    let criticalChildWork = 0;
    for (const child of children) {
        largest = Math.max(largest, child.count);
        criticalChildWork = Math.max(criticalChildWork, estimateHybridNodeWorkByCount(child.count, child.depth));
    }

    const largestRatio = largest / Math.max(1, job.count);
    const parentWork = estimateHybridNodeWorkByCount(job.count, job.depth);
    const criticalGain = parentWork > 0 ? (parentWork - criticalChildWork) / parentWork : 0;
    const maxLargestChildRatio = Number.isFinite(options.maxLargestChildRatio) ? options.maxLargestChildRatio : 0.9;
    const minCriticalGain = Number.isFinite(options.minCriticalGain) ? options.minCriticalGain : 0.1;

    return largestRatio <= maxLargestChildRatio || criticalGain >= minCriticalGain;
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

function createEmptyTreeProfile() {
    return {
        resetTime: 0,
        rootBoundsTime: 0,
        populateTime: 0,
        aggregateTime: 0,
        fastBucketPath: true,
    };
}

function buildAndProcessTreeJobs(jobs, requestId, extra = {}) {
    const tasks = [];
    const treeProfile = createEmptyTreeProfile();
    const treeStats = {flops: 0, depth: 0, segmentCount: 0};

    if (!treeWorkspace) {
        treeWorkspace = {
            indices: indexBuffers[0],
            scratchIndices: indexBuffers[1],
        };
    }

    const treeStart = performance.now();
    for (const job of jobs) {
        if (job.count === 0) {
            continue;
        }

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
        const stats = buildTreeStats(tree);
        treeStats.flops += stats.flops;
        treeStats.depth = Math.max(treeStats.depth, stats.depth);
        treeStats.segmentCount += stats.segmentCount;
        collectLeafTasks(tree, tree.root, job.parentForceX, job.parentForceY, tasks);
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
        jobCount: jobs.length,
        ...extra,
    });
}

function processRecursiveTreeJobs(data) {
    const jobs = readTreeJobs(data);
    const splitBudget = Number.isFinite(data.splitBudget) ? data.splitBudget : 8;
    const minJobParticles = Number.isFinite(data.minJobParticles) ? data.minJobParticles : 8192;
    const stack = jobs.slice();
    const localJobs = [];
    const spawnedJobs = [];
    let splitCount = 0;
    const splitStart = performance.now();

    while (stack.length > 0) {
        const job = stack.pop();
        if (shouldSplitRecursiveNode(job, splitBudget - splitCount, minJobParticles)) {
            const children = splitRecursiveNode(job);
            if (children.length > 1) {
                splitCount += 1;
                for (const child of children) {
                    if (splitCount < splitBudget && child.count > minJobParticles * 2) {
                        stack.push(child);
                    } else if (child.count > minJobParticles) {
                        spawnedJobs.push(child);
                    } else {
                        localJobs.push(child);
                    }
                }
                continue;
            }
        }

        if (job.count > minJobParticles && splitCount >= splitBudget) {
            spawnedJobs.push(job);
        } else {
            localJobs.push(job);
        }
    }

    const splitTime = performance.now() - splitStart;
    if (localJobs.length === 0) {
        postMessage({
            type: "done",
            requestId: data.requestId,
            treeTime: splitTime,
            treeProfile: {
                resetTime: 0,
                rootBoundsTime: 0,
                populateTime: splitTime,
                aggregateTime: 0,
                fastBucketPath: true,
            },
            treeStats: {flops: 0, depth: 0, segmentCount: 0},
            forceTime: 0,
            integrateTime: 0,
            leafCount: 0,
            particleCount: 0,
            jobCount: 0,
            spawnedJobs,
            recursiveSplitCount: splitCount,
        });
        return;
    }

    buildAndProcessTreeJobs(localJobs, data.requestId, {
        spawnedJobs,
        recursiveSplitCount: splitCount,
        recursiveSplitTime: splitTime,
    });
}


function processHybridTreeJobs(data) {
    const jobs = readTreeJobs(data);
    const splitBudget = Number.isFinite(data.splitBudget) ? data.splitBudget : 2;
    const minJobParticles = Number.isFinite(data.minJobParticles) ? data.minJobParticles : 16384;
    const earlySplit = data.hybridEarlySplit !== false;
    const localJobsPerRequest = Math.max(1, Number.isFinite(data.hybridLocalJobsPerRequest) ? data.hybridLocalJobsPerRequest : 1);
    const splitOptions = {
        maxLargestChildRatio: data.hybridSplitMaxLargestChildRatio,
        minCriticalGain: data.hybridSplitMinCriticalGain,
    };
    const stack = jobs.slice();
    const localJobs = [];
    const spawnedJobs = [];
    let splitCount = 0;
    let rejectedSplits = 0;
    let localSplitChildren = 0;
    const splitStart = performance.now();

    while (stack.length > 0) {
        const job = stack.pop();
        if (shouldSplitRecursiveNode(job, splitBudget - splitCount, minJobParticles)) {
            const children = splitRecursiveNode(job);
            if (children.length > 1 && isUsefulHybridSplit(job, children, splitOptions)) {
                splitCount += 1;
                children.sort((a, b) => b.count - a.count);
                let localChildren = 0;
                for (const child of children) {
                    const canSplitChild = splitCount < splitBudget && child.count > minJobParticles * 2;
                    if (earlySplit) {
                        if (canSplitChild) {
                            stack.push(child);
                        } else {
                            spawnedJobs.push(child);
                        }
                    } else if (localChildren < localJobsPerRequest) {
                        localChildren += 1;
                        localSplitChildren += 1;
                        if (canSplitChild) {
                            stack.push(child);
                        } else {
                            localJobs.push(child);
                        }
                    } else if (child.count > minJobParticles) {
                        spawnedJobs.push(child);
                    } else {
                        localJobs.push(child);
                    }
                }
                continue;
            }
            if (children.length > 1) {
                rejectedSplits += 1;
            }
        }

        localJobs.push(job);
    }

    const splitTime = performance.now() - splitStart;

    // Hybrid now uses split-first only while the coordinator queue is still
    // underfed. Once backlog is healthy, the worker keeps a local branch and
    // returns siblings after useful local work, reducing extra descriptors and
    // round-trips without recreating the old recursive tail.
    if (earlySplit && spawnedJobs.length > 0) {
        spawnedJobs.push(...localJobs);
        spawnedJobs.sort((a, b) => b.count - a.count);
        postMessage({
            type: "done",
            requestId: data.requestId,
            treeTime: splitTime,
            treeProfile: {
                resetTime: 0,
                rootBoundsTime: 0,
                populateTime: splitTime,
                aggregateTime: 0,
                fastBucketPath: true,
            },
            treeStats: {flops: 0, depth: 0, segmentCount: 0},
            forceTime: 0,
            integrateTime: 0,
            leafCount: 0,
            particleCount: 0,
            jobCount: 0,
            spawnedJobs,
            recursiveSplitCount: splitCount,
            recursiveSplitTime: splitTime,
            hybridEarlySplit: true,
            hybridEarlySplitJobs: spawnedJobs.length,
            hybridLocalJobs: 0,
            hybridRejectedSplits: rejectedSplits,
            hybridLocalSplitChildren: localSplitChildren,
        });
        return;
    }

    buildAndProcessTreeJobs(localJobs, data.requestId, {
        spawnedJobs,
        recursiveSplitCount: splitCount,
        recursiveSplitTime: splitTime,
        hybridEarlySplit: false,
        hybridEarlySplitJobs: 0,
        hybridLocalJobs: localJobs.length,
        hybridRejectedSplits: rejectedSplits,
        hybridLocalSplitChildren: localSplitChildren,
    });
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
        case "process-tree-recursive":
            processRecursiveTreeJobs(data);
            break;
        case "process-tree-hybrid":
            processHybridTreeJobs(data);
            break;
        case "dispose":
            close();
            break;
    }
};

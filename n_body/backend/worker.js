import {BackendBase, WorkerHandler} from "./base.js";
import {FlatPhysicsEngine} from "../simulation/flat_physics.js";
import {ITEM_SIZE} from "../utils/particles.js";
import {Particle_initializer} from "../simulation/particle_initializer.js";
import {AppSimulationSettings} from "../settings/app.js";


const SEGMENT_TUNE_CANDIDATES = [8, 16, 24, 32, 40, 48, 64, 96];
const SEGMENT_TUNE_SAMPLES_PER_CANDIDATE = 2;

class SegmentSizeAutoTuner {
    constructor(settings) {
        this.enabled = !!settings.simulation.autoTuneSegmentSize;
        this.baseSize = settings.simulation.segmentMaxCount;
        this.particleCount = settings.physics.particleCount;
        this.candidates = this._buildCandidates(this.baseSize, this.particleCount);
        this.samplesPerCandidate = SEGMENT_TUNE_SAMPLES_PER_CANDIDATE;
        this.candidateIndex = 0;
        this.sampleIndex = 0;
        this.results = [];
        this.finished = !this.enabled || this.candidates.length <= 1;
        this.selectedSize = this.finished ? this.baseSize : this.candidates[0];
        this.lastStepTime = null;
        this.lastAverageTime = null;
    }

    get currentSize() {
        return this.finished ? this.selectedSize : this.candidates[this.candidateIndex];
    }

    record(stepTime) {
        if (!this.enabled || this.finished) {
            this.lastStepTime = stepTime;
            return;
        }

        const candidate = this.candidates[this.candidateIndex];
        let result = this.results[this.candidateIndex];
        if (!result) {
            result = {size: candidate, totalTime: 0, samples: 0, averageTime: null};
            this.results[this.candidateIndex] = result;
        }

        result.totalTime += stepTime;
        result.samples += 1;
        result.averageTime = result.totalTime / result.samples;
        this.lastStepTime = stepTime;
        this.lastAverageTime = result.averageTime;
        this.sampleIndex += 1;

        if (this.sampleIndex < this.samplesPerCandidate) {
            return;
        }

        this.sampleIndex = 0;
        this.candidateIndex += 1;

        if (this.candidateIndex >= this.candidates.length) {
            this._selectBest();
        }
    }

    _selectBest() {
        let best = this.results[0];
        for (let i = 1; i < this.results.length; i++) {
            const result = this.results[i];
            if (result && result.averageTime < best.averageTime) {
                best = result;
            }
        }

        this.selectedSize = best?.size ?? this.baseSize;
        this.lastAverageTime = best?.averageTime ?? null;
        this.finished = true;
    }

    _buildCandidates(baseSize, particleCount) {
        const maxCandidate = Math.max(1, Math.min(128, particleCount));
        const values = [...SEGMENT_TUNE_CANDIDATES, baseSize]
            .filter(v => Number.isFinite(v) && v >= 1 && v <= maxCandidate);
        return [...new Set(values)].sort((a, b) => a - b);
    }

    getStats(actualSize) {
        if (!this.enabled) {
            return {
                enabled: false,
                status: "off",
                actualSize,
                selectedSize: actualSize,
                candidateSize: actualSize,
                candidates: [],
                sample: 0,
                samplesPerCandidate: this.samplesPerCandidate,
                lastStepTime: this.lastStepTime,
                lastAverageTime: null,
            };
        }

        return {
            enabled: true,
            status: this.finished ? "done" : "tuning",
            actualSize,
            selectedSize: this.selectedSize,
            candidateSize: this.currentSize,
            candidates: this.candidates,
            sample: this.finished ? this.samplesPerCandidate : this.sampleIndex + 1,
            samplesPerCandidate: this.samplesPerCandidate,
            lastStepTime: this.lastStepTime,
            lastAverageTime: this.lastAverageTime,
        };
    }
}


export class WorkerBackend extends BackendBase {
    constructor() {
        super("./backend/worker.js");
        this.displayName = "WorkerBackend";
    }
}

class WorkerBackendImpl {
    constructor() {
        this.settings = null;
        this.physicalEngine = null;
        this.particles = null;
        this.buffers = [];
        this._particleForces = [];
        this._segmentTuner = null;
        this._actualSegmentSize = null;
    }

    async init(settings, state) {
        this.settings = AppSimulationSettings.deserialize(settings);
        this._initSegmentTuner();
        this.physicalEngine = new FlatPhysicsEngine(this.settings);
        this.particles = this._initializeParticleBuffer();
        this._applyParticlesState(state);
        this._initBuffers();
        this._initDebugForceView();
    }

    ack(buffer) {
        if (this.buffers.length < this.settings.simulation.bufferCount) {
            this.buffers.push(buffer);
        } else {
            console.error("Unexpected ack: buffers already fulfilled");
        }
    }

    step(timestamp) {
        if (this.buffers.length === 0) {
            console.error("Unexpected step: buffer is not ready");
            return null;
        }

        this._applyTunedSegmentSize();
        const tuneStart = performance.now();
        const tree = this.physicalEngine.step(this.particles);
        const stepCalcTime = performance.now() - tuneStart;
        this._recordTuningSample(stepCalcTime);

        const buffer = this.buffers.shift();
        const profile = this.physicalEngine.stats.profile;

        if (this.settings.common.stats && profile) {
            const t = performance.now();
            buffer.set(this.particles);
            profile.exportTime = performance.now() - t;
        } else {
            buffer.set(this.particles);
        }

        return {
            timestamp: timestamp,
            buffer: buffer,
            treeDebug: this.settings.common.debugTree ? tree.getDebugData() : [],
            forceDebug: this._getCalculatedForces(),
            stats: {
                physicsTime: this.physicalEngine.stats.physicsTime,
                treeTime: this.physicalEngine.stats.treeTime,
                tree: {
                    flops: this.physicalEngine.stats.tree.flops,
                    depth: this.physicalEngine.stats.tree.depth,
                    segmentCount: this.physicalEngine.stats.tree.segmentCount
                },
                profile: this.physicalEngine.stats.profile,
                actualSegmentSize: this._actualSegmentSize,
                segmentAutoTune: this._segmentTuner?.getStats(this._actualSegmentSize) ?? null
            }
        };
    }

    reconfigure(settings, state) {
        const newSettings = AppSimulationSettings.deserialize(settings);
        const particleCountChanged = !this.settings ||
            this.settings.physics.particleCount !== newSettings.physics.particleCount;

        this.settings = newSettings;
        this._initSegmentTuner();

        if (particleCountChanged || !this.particles) {
            this.particles = this._initializeParticleBuffer();
            this._initBuffers();
        }

        this._applyParticlesState(state);
        this.physicalEngine.reconfigure(this.settings);
        this._initDebugForceView();
    }

    _initSegmentTuner() {
        this._segmentTuner = new SegmentSizeAutoTuner(this.settings);
        this._actualSegmentSize = this._segmentTuner.currentSize;
        this._setSegmentMaxCount(this._actualSegmentSize);
    }

    _applyTunedSegmentSize() {
        if (!this._segmentTuner) {
            this._actualSegmentSize = this.settings.simulation.segmentMaxCount;
            return;
        }

        const nextSize = this._segmentTuner.currentSize;
        if (nextSize !== this._actualSegmentSize) {
            this._actualSegmentSize = nextSize;
            this._setSegmentMaxCount(nextSize);
        }
    }

    _recordTuningSample(stepTime) {
        if (!this._segmentTuner) {
            return;
        }

        this._segmentTuner.record(stepTime);
        const selectedSize = this._segmentTuner.currentSize;
        if (this._segmentTuner.finished && selectedSize !== this._actualSegmentSize) {
            this._actualSegmentSize = selectedSize;
            this._setSegmentMaxCount(selectedSize);
        }
    }

    _setSegmentMaxCount(size) {
        this.settings.simulation.config.segmentMaxCount = size;
    }

    dispose() {
        this.buffers = null;
        this.particles = null;
        this._particleForces = null;
        this._segmentTuner = null;
        this.physicalEngine.dispose();
        this.physicalEngine = null;
        this.settings = null;
    }

    _initializeParticleBuffer() {
        // Keep initializers unchanged: they still create Particle objects. The
        // CPU backend immediately compacts them into the flat simulation buffer.
        const objectParticles = Particle_initializer.initialize(this.settings);
        const buffer = new Float32Array(this.settings.physics.particleCount * ITEM_SIZE);
        this._copyObjectsToBuffer(objectParticles, buffer);
        return buffer;
    }

    _copyObjectsToBuffer(particles, buffer) {
        const size = Math.min(particles.length, buffer.length / ITEM_SIZE);
        for (let i = 0; i < size; i++) {
            const particle = particles[i];
            const offset = i * ITEM_SIZE;
            buffer[offset] = particle.x;
            buffer[offset + 1] = particle.y;
            buffer[offset + 2] = particle.velX;
            buffer[offset + 3] = particle.velY;
            buffer[offset + 4] = particle.mass;
        }
    }

    _initBuffers() {
        this.buffers = new Array(this.settings.simulation.bufferCount);
        for (let i = 0; i < this.settings.simulation.bufferCount; i++) {
            this.buffers[i] = new Float32Array(this.settings.physics.particleCount * ITEM_SIZE);
        }
    }

    _applyParticlesState(state) {
        // Imported/saved states use arrays for portability, while live
        // reconfiguration can pass the current Float32Array directly.
        if (!state || state.length === 0) {
            return;
        }

        if (state instanceof Float32Array) {
            const size = Math.min(state.length, this.particles.length);
            this.particles.set(state.subarray(0, size), 0);
            return;
        }

        const size = Math.min(state.length, this.settings.physics.particleCount);
        for (let i = 0; i < size; i++) {
            const item = state[i];
            const offset = i * ITEM_SIZE;
            if (Array.isArray(item)) {
                this.particles[offset] = item[0];
                this.particles[offset + 1] = item[1];
                this.particles[offset + 2] = item[2];
                this.particles[offset + 3] = item[3];
                this.particles[offset + 4] = item[4];
            } else if (item) {
                this.particles[offset] = item.x;
                this.particles[offset + 1] = item.y;
                this.particles[offset + 2] = item.velX;
                this.particles[offset + 3] = item.velY;
                this.particles[offset + 4] = item.mass;
            }
        }
    }

    _initDebugForceView() {
        if (!this.settings.common.debugForce) {
            this._particleForces = [];
            return;
        }

        const count = this.settings.physics.particleCount;
        if (this._particleForces.length !== count) {
            this._particleForces = new Array(count);
            for (let i = 0; i < count; i++) {
                this._particleForces[i] = {forceX: 0, forceY: 0};
            }
        }
    }

    _getCalculatedForces() {
        if (!this.settings.common.debugForce) {
            return this._particleForces;
        }

        const forceX = this.physicalEngine.forceX;
        const forceY = this.physicalEngine.forceY;
        for (let i = 0; i < this.settings.physics.particleCount; i++) {
            this._particleForces[i].forceX = forceX[i];
            this._particleForces[i].forceY = forceY[i];
        }
        return this._particleForces;
    }
}

const Backend = new WorkerBackendImpl();
const WorkerHandlerInstance = new WorkerHandler(Backend);

onmessage = WorkerHandlerInstance.handleMessage.bind(WorkerHandlerInstance);

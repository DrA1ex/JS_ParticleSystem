import {BackendBase, WorkerHandler} from "./base.js";
import {FlatPhysicsEngine} from "../simulation/flat_physics.js";
import {ITEM_SIZE} from "../utils/particles.js";
import {Particle_initializer} from "../simulation/particle_initializer.js";
import {AppSimulationSettings} from "../settings/app.js";

export class WorkerBackend extends BackendBase {
    constructor() {
        super("./backend/worker.js");
    }
}

class WorkerBackendImpl {
    constructor() {
        this.settings = null;
        this.physicalEngine = null;
        this.particles = null;
        this.buffers = [];
        this._particleForces = [];
    }

    async init(settings, state) {
        this.settings = AppSimulationSettings.deserialize(settings);
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

        const tree = this.physicalEngine.step(this.particles);
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
                profile: this.physicalEngine.stats.profile
            }
        };
    }

    reconfigure(settings, state) {
        const newSettings = AppSimulationSettings.deserialize(settings);
        const particleCountChanged = !this.settings ||
            this.settings.physics.particleCount !== newSettings.physics.particleCount;

        this.settings = newSettings;

        if (particleCountChanged || !this.particles) {
            this.particles = this._initializeParticleBuffer();
            this._initBuffers();
        }

        this._applyParticlesState(state);
        this.physicalEngine.reconfigure(this.settings);
        this._initDebugForceView();
    }

    dispose() {
        this.buffers = null;
        this.particles = null;
        this._particleForces = null;
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

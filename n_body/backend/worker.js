import {ParticleInitializer, PhysicsEngine} from "../simulation/physics.js";

export const ITEM_SIZE = 5;

export class WorkerBackend {
    constructor() {
        this._worker = new Worker("./backend/worker.js", {type: "module"});
    }

    init(onDataFn, settings, particles = null) {
        this._worker.onmessage = function (e) {
            if (e.data.type === "data") {
                onDataFn(e.data);
            }
        }

        this._worker.postMessage({type: "init", settings, state: particles});
    }

    freeBuffer(buffer) {
        this._worker.postMessage({type: "ack", buffer}, [buffer.buffer]);
    }

    requestNextStep() {
        this._worker.postMessage({type: "step", timestamp: performance.now()});
    }
}

let Settings;
let Particles;
let PhysicsEngineInstance;

const Buffers = [];

onmessage = function (e) {
    const {type} = e.data;
    switch (type) {
        case "init":
            init(e.data);
            break;

        case "ack":
            ack(e.data);
            break;

        case "step":
            step(e.data);
            break;
    }
}

function init(data) {
    const {settings, state} = data;

    Settings = settings;
    PhysicsEngineInstance = new PhysicsEngine(Settings);
    Particles = ParticleInitializer.initialize(Settings);

    if (state && state.length > 0) {
        const size = Math.min(state.length, Settings.particleCount);
        for (let i = 0; i < size; i++) {
            const [x, y, velX, velY, mass] = state[i];
            Particles[i].x = x;
            Particles[i].y = y;
            Particles[i].velX = velX;
            Particles[i].velY = velY;
            Particles[i].mass = mass;
        }
    }

    for (let i = 0; i < Settings.bufferCount; i++) {
        Buffers.push(new Float32Array(Settings.particleCount * ITEM_SIZE));
    }
}

function ack(data) {
    if (Buffers.length < Settings.bufferCount) {
        Buffers.push(data.buffer);
    } else {
        console.error("Unexpected ack: buffers already fulfilled");
    }
}

function step(data) {
    if (Buffers.length === 0) {
        console.error("Unexpected step: buffer is not ready");
        return;
    }

    const tree = PhysicsEngineInstance.step(Particles);

    const buffer = Buffers.shift();
    for (let i = 0; i < Settings.particleCount; i++) {
        buffer[i * ITEM_SIZE] = Particles[i].x;
        buffer[i * ITEM_SIZE + 1] = Particles[i].y;
        buffer[i * ITEM_SIZE + 2] = Particles[i].velX;
        buffer[i * ITEM_SIZE + 3] = Particles[i].velY;
        buffer[i * ITEM_SIZE + 4] = Particles[i].mass;
    }

    postMessage({
        type: "data",
        timestamp: data.timestamp,
        buffer: buffer,
        treeDebug: Settings.debug ? tree.getDebugData() : [],
        stats: {
            physicsTime: PhysicsEngineInstance.stats.physicsTime,
            treeTime: PhysicsEngineInstance.stats.treeTime,
            tree: {
                flops: PhysicsEngineInstance.stats.tree.flops,
                depth: PhysicsEngineInstance.stats.tree.depth,
                segmentCount: PhysicsEngineInstance.stats.tree.segmentCount
            }
        }
    }, [buffer.buffer]);
}
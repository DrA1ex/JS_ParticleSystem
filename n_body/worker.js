import {ParticleInitializer, PhysicsEngine} from "./physics.js";

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
    const {settings} = data;

    Settings = settings;
    PhysicsEngineInstance = new PhysicsEngine(Settings);
    Particles = ParticleInitializer.initialize(Settings);

    for (let i = 0; i < Settings.bufferCount; i++) {
        Buffers.push(new Float32Array(Settings.particleCount * 4));
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
        buffer[i * 4] = Particles[i].x;
        buffer[i * 4 + 1] = Particles[i].y;
        buffer[i * 4 + 2] = Particles[i].velX;
        buffer[i * 4 + 3] = Particles[i].velY;
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
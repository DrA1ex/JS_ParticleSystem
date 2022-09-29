import {ParticleInitializer, PhysicsEngine} from "./physics.js";

let Settings;
let Particles;
let PhysicsEngineInstance;

let CurrentBuffer;
let NextBuffer;

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

    CurrentBuffer = new Float32Array(Settings.particleCount * 4);
    NextBuffer = new Float32Array(Settings.particleCount * 4);
}

function ack(data) {
    if (CurrentBuffer === null) {
        CurrentBuffer = data.buffer;
    } else if (NextBuffer === null) {
        NextBuffer = data.buffer;
    } else {
        console.error("Unexpected ack: buffers already fulfilled");
    }
}

function step() {
    if (CurrentBuffer === null) {
        console.error("Unexpected step: buffer is not ready");
        return;
    }

    const tree = PhysicsEngineInstance.step(Particles);

    for (let i = 0; i < Settings.particleCount; i++) {
        CurrentBuffer[i * 4] = Particles[i].x;
        CurrentBuffer[i * 4 + 1] = Particles[i].y;
        CurrentBuffer[i * 4 + 2] = Particles[i].velX;
        CurrentBuffer[i * 4 + 3] = Particles[i].velY;
    }

    postMessage({
        type: "data",
        buffer: CurrentBuffer,
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
    }, CurrentBuffer.buffer);

    CurrentBuffer = NextBuffer;
    NextBuffer = null;
}
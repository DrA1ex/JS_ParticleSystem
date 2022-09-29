import {CanvasRenderer, InteractionHandler} from "./renderer.js";
import {Debug} from "./debug.js";
import {Settings} from "./settings.js";

const urlSearchParams = new URLSearchParams(window.location.search);
const params = Object.fromEntries(urlSearchParams.entries());

const canvas = document.getElementById("canvas");

const SettingsInstance = Settings.fromQueryParams(params);
const Renderer = new CanvasRenderer(canvas, SettingsInstance);
const DebugInstance = new Debug(Renderer, SettingsInstance);

const InteractionHandlerInstance = new InteractionHandler(Renderer, SettingsInstance);
InteractionHandlerInstance.enable();

const PhysicsWorker = new Worker("./worker.js", {type: "module"});
PhysicsWorker.onmessage = function (e) {
    if (e.data.type === "data") {
        onData(e.data);
    }
}

const Particles = new Array(SettingsInstance.particleCount);
for (let i = 0; i < SettingsInstance.particleCount; i++) {
    Particles[i] = {x: 0, y: 0, velX: 0, velY: 0};
}

const refreshTime = 1000 / SettingsInstance.fps;
const buffers = [];
let lastStepTime = performance.now() - refreshTime;
let ready = false;

function onData(data) {
    if (!ready) {
        const e = document.getElementById("wait");
        e.style.display = "none";
        ready = true;
    }

    buffers.push(data.buffer);
    if (buffers.length < SettingsInstance.bufferCount) {
        requestNextStep();
    }

    const buffer = buffers[0];
    for (let i = 0; i < SettingsInstance.particleCount; i++) {
        Particles[i].x = buffer[i * 4];
        Particles[i].y = buffer[i * 4 + 1];
        Particles[i].velX = buffer[i * 4 + 2];
        Particles[i].velY = buffer[i * 4 + 3];
    }

    if (SettingsInstance.stats) DebugInstance.importPhysicsStats(data);
    if (SettingsInstance.debug) DebugInstance.importTreeDebugData(data.treeDebug);
}

function requestNextStep() {
    PhysicsWorker.postMessage({type: "step"});
}

function render(timestamp) {
    if (ready) {
        if (buffers.length === 0) {
            console.warn("Buffers are empty");
        }

        Renderer.render(Particles);
    }

    if (SettingsInstance.debug) DebugInstance.drawTreeDebug();

    if (SettingsInstance.stats) {
        DebugInstance.renderTime = Renderer.stats.renderTime;
        DebugInstance.bufferCount = buffers.length;
        DebugInstance.postFrameTime(timestamp - lastStepTime);
        DebugInstance.drawStats();
    }

    lastStepTime = timestamp;

    if (buffers.length > SettingsInstance.bufferCount - 1) {
        PhysicsWorker.postMessage({type: "ack", buffer: buffers.shift()});
        requestNextStep();
    }
    requestAnimationFrame(render);
}

PhysicsWorker.postMessage({type: "init", settings: SettingsInstance});

requestNextStep();
requestAnimationFrame(render);
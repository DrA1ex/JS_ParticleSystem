import {CanvasRenderer, InteractionHandler} from "./renderer.js";
import {Debug} from "./debug.js";
import {Settings} from "./settings.js";
import {DFRIHelper} from "./utils.js";

const urlSearchParams = new URLSearchParams(window.location.search);
const params = Object.fromEntries(urlSearchParams.entries());

const canvas = document.getElementById("canvas");

const SettingsInstance = Settings.fromQueryParams(params);
const Renderer = new CanvasRenderer(canvas, SettingsInstance);
const DFRIHelperInstance = new DFRIHelper(Renderer, SettingsInstance);
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
const Deltas = new Array(SettingsInstance.particleCount);
for (let i = 0; i < SettingsInstance.particleCount; i++) {
    Particles[i] = {x: 0, y: 0, velX: 0, velY: 0};
    Deltas[i] = {x: 0, y: 0};
}

const refreshTime = 1000 / SettingsInstance.fps;
const buffers = [];
let pendingBuffers = 0;
let lastRenderTime = performance.now() - refreshTime;
let physicsFrame = 0;
let ready = false;

function onData(data) {
    DFRIHelperInstance.postStepTime(performance.now() - data.timestamp);

    if (!ready) {
        const e = document.getElementById("wait");
        e.style.display = "none";
        ready = true;
    }

    buffers.push({index: ++physicsFrame, buffer: data.buffer, treeDebug: data.treeDebug});
    pendingBuffers -= 1;

    if (buffers.length + pendingBuffers < SettingsInstance.bufferCount) {
        requestNextStep();
    }

    if (SettingsInstance.stats) DebugInstance.importPhysicsStats(data);
}

function requestNextStep() {
    pendingBuffers += 1;
    PhysicsWorker.postMessage({type: "step", timestamp: performance.now()});
}

function switchBuffer() {
    if (buffers.length === 0) {
        console.warn(`${performance.now().toFixed(0)} Next buffer not ready. Frames may be dropped`);
        return false;
    }

    const {buffer} = buffers[0];
    const nextBuffer = buffers.length > 1 ? buffers[1].buffer : null;
    if (SettingsInstance.enableDFRI && !nextBuffer) {
        console.warn(`${performance.now().toFixed(0)} No available ahead buffer, interpolation may be inconsistent`);
    }

    for (let i = 0; i < SettingsInstance.particleCount; i++) {
        Particles[i].x = buffer[i * 4];
        Particles[i].y = buffer[i * 4 + 1];
        Particles[i].velX = buffer[i * 4 + 2];
        Particles[i].velY = buffer[i * 4 + 3];

        if (SettingsInstance.enableDFRI) {
            Deltas[i].x = nextBuffer ? nextBuffer[i * 4] - Particles[i].x : Particles[i].velX;
            Deltas[i].y = nextBuffer ? nextBuffer[i * 4 + 1] - Particles[i].y : Particles[i].velY;
        }
    }

    if (SettingsInstance.debug) DebugInstance.importTreeDebugData(buffers[0].treeDebug);

    if (buffers.length > 0) {
        buffers.shift();
        PhysicsWorker.postMessage({type: "ack", buffer: buffer}, [buffer.buffer]);
        requestNextStep();
    }

    return true;
}

function render(timestamp) {
    if (timestamp - lastRenderTime < refreshTime) {
        requestAnimationFrame(render);
        return;
    }

    if (ready) {
        const t = performance.now();
        if (SettingsInstance.enableDFRI) {
            if (DFRIHelperInstance.needSwitchBuffer()) {
                const success = switchBuffer();
                if (success) {
                    DFRIHelperInstance.bufferSwitched();
                }
            }

            DFRIHelperInstance.render(Particles, Deltas);
        } else {
            switchBuffer();
            Renderer.render(Particles, Deltas, 0);
        }

        if (SettingsInstance.debug) DebugInstance.drawTreeDebug();

        DFRIHelperInstance.postRenderTime(Math.max(refreshTime, performance.now() - t));
    }

    if (SettingsInstance.stats) {
        DebugInstance.renderTime = Renderer.stats.renderTime;
        DebugInstance.bufferCount = buffers.length;
        DebugInstance.interpolateFrames = DFRIHelperInstance.interpolateFrames;
        DebugInstance.postFrameTime(timestamp - lastRenderTime);
        DebugInstance.drawStats();
    }

    lastRenderTime = timestamp;
    requestAnimationFrame(render);
}

PhysicsWorker.postMessage({type: "init", settings: SettingsInstance});

requestNextStep();
requestAnimationFrame(render);
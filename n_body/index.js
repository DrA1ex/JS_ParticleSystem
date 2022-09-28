import {CanvasRenderer, InteractionHandler} from "./renderer.js";
import {PhysicsEngine, ParticleInitializer} from "./physics.js";
import {Debug} from "./debug.js";
import {Settings} from "./settings.js";

const urlSearchParams = new URLSearchParams(window.location.search);
const params = Object.fromEntries(urlSearchParams.entries());

const canvas = document.getElementById("canvas");

const SettingsInstance = Settings.fromQueryParams(params);
const PhysicsEngineInstance = new PhysicsEngine(SettingsInstance);
const Renderer = new CanvasRenderer(canvas, SettingsInstance);
const InteractionHandlerInstance = new InteractionHandler(Renderer, SettingsInstance);
const Particles = ParticleInitializer.initialize(SettingsInstance);
const DebugInstance = new Debug(Renderer, SettingsInstance);

InteractionHandlerInstance.enable();

const refreshTime = 1000 / SettingsInstance.fps;
let lastStepTime = 0;

function calculatePhysics() {
    const tree = PhysicsEngineInstance.step(Particles);
    if (SettingsInstance.stats) DebugInstance.importPhysicsStats(PhysicsEngineInstance);

    return tree;
}

function step() {
    const tree = calculatePhysics();

    requestAnimationFrame((timestamp) => {
        if (timestamp >= lastStepTime + refreshTime) {
            const t = performance.now();
            Renderer.render(Particles);

            if (SettingsInstance.stats) DebugInstance.renderTime = performance.now() - t;
            if (SettingsInstance.debug) DebugInstance.drawTreeStructure(tree);

            if (lastStepTime > 0) {
                DebugInstance.postFrameTime(timestamp - lastStepTime);
            }
            lastStepTime = timestamp;
            if (SettingsInstance.stats) DebugInstance.drawStats();
        }

        step();
    })
}

step();
import {BackendType, RenderType} from "./settings/enum.js";
import {AppSimulationSettings} from "./settings/app.js";
import * as SettingsUtils from "./utils/settings.js";
import {CanvasRenderer} from "./render/canvas.js";
import {Webgl2Renderer} from "./render/webgl/render.js";
import {WorkerBackend} from "./backend/worker.js";
import {GPUBackend} from "./backend/gpgpu.js";
import {Application} from "./app.js";

addEventListener("error", (event) => {
    alert(event.message);
});


const state = await SettingsUtils.loadState();
const SettingsInstance = AppSimulationSettings.fromQueryParams(state?.settings);

const RenderTypeMapping = {
    [RenderType.canvas]: CanvasRenderer,
    [RenderType.webgl2]: Webgl2Renderer,
    default: Webgl2Renderer
}
const RendererClass = RenderTypeMapping[SettingsInstance.render.render] || RenderTypeMapping.default;
const Renderer = new RendererClass(document.getElementById("canvas"), SettingsInstance);

const BackendTypeMapping = {
    [BackendType.worker]: WorkerBackend,
    [BackendType.gpgpu]: GPUBackend,
    default: WorkerBackend,
}
const BackendClass = BackendTypeMapping[SettingsInstance.simulation.backend] || BackendTypeMapping.default;
const BackendInstance = new BackendClass();

const ApplicationInstance = new Application(SettingsInstance, Renderer, BackendInstance);
ApplicationInstance.init(state);
ApplicationInstance.run();
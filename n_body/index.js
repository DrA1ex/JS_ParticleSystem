import {RenderType, Settings} from "./utils/settings.js";
import {CanvasRenderer} from "./render/canvas.js";
import {Webgl2Renderer} from "./render/webgl/render.js";
import {WorkerBackend} from "./backend/worker.js";
import {Application} from "./app.js";


const state = await Settings.loadState();
const SettingsInstance = Settings.fromQueryParams(state?.settings);

const RenderTypeMapping = {
    [RenderType.canvas]: CanvasRenderer,
    [RenderType.webgl2]: Webgl2Renderer,
    default: Webgl2Renderer
}
const RendererClass = RenderTypeMapping[SettingsInstance.render] || RenderTypeMapping.default;
const Renderer = new RendererClass(document.getElementById("canvas"), SettingsInstance);

const WorkerBackendInstance = new WorkerBackend();
const ApplicationInstance = new Application(SettingsInstance, Renderer, WorkerBackendInstance);

ApplicationInstance.init(state);
ApplicationInstance.run();
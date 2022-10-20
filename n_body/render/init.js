import {RenderType} from "../settings/enum.js";
import {CanvasRenderer} from "./canvas.js";
import {Webgl2Renderer} from "./webgl/render.js";

export class RendererInitializer {
    static initRenderer(canvas, type, settings) {
        switch (type) {
            case RenderType.canvas:
                return new CanvasRenderer(canvas, settings);

            case RenderType.webgl2:
            default:
                return new Webgl2Renderer(canvas, settings);
        }
    }
}
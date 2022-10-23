import {ReadOnlyProperty, SettingsBase} from "./base.js";

export class WorldSettings extends SettingsBase {
    static ReadOnlyProperties = {
        fps: ReadOnlyProperty.int().setName("Physics FPS"),
        worldWidth: ReadOnlyProperty.int().setName("World width"),
        worldHeight: ReadOnlyProperty.int().setName("World height"),
    }

    fps = 60;
    worldWidth = 1920;
    worldHeight = 1080;
}
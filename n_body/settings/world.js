import {ComponentType, Property, ReadOnlyProperty, SettingsBase} from "./base.js";

export class WorldSettings extends SettingsBase {
    static Properties = {
        worldWidth: Property.int('width', 1920)
            .setName("World width")
            .setAffects(ComponentType.renderer)
            .setBreaks(ComponentType.backend, ComponentType.particles),
        worldHeight: Property.int('height', 1080)
            .setName("World height")
            .setAffects(ComponentType.renderer)
            .setBreaks(ComponentType.backend, ComponentType.particles),
    }

    static ReadOnlyProperties = {
        fps: ReadOnlyProperty.int().setName("Physics FPS"),
    }

    fps = 60;
    get worldWidth() {return this.config.worldWidth}
    get worldHeight() {return this.config.worldHeight}
}
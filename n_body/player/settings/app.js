import {PlayerPhysicsSettings} from "./physics.js";
import {AppSettingsBase, SettingsGroup} from "../../settings/app.js";
import {WorldSettings} from "../../settings/world.js";
import {RenderSettings} from "../../settings/render.js";

/**
 * @extends {AppSettingsBase<AppPlayerSettings>}
 */
export class AppPlayerSettings extends AppSettingsBase {
    static Types = {
        world: SettingsGroup.of(WorldSettings),
        physics: SettingsGroup.of(PlayerPhysicsSettings),
        render: SettingsGroup.of(RenderSettings),
    }

    /** @returns {WorldSettings} */
    get world() {return this.config.world;}
    /** @returns {PlayerPhysicsSettings} */
    get physics() {return this.config.physics;}
    /** @returns {RenderSettings} */
    get render() {return this.config.render;}

    common = {
        debug: false
    }
}
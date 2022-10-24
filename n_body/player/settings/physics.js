import {Property, SettingsBase} from "../../settings/base.js";


export class PlayerPhysicsSettings extends SettingsBase {
    static ReadOnlyProperties = {
        particleCount: Property.int("particle_count")
            .setName("Particle count"),
    }

    get particleCount() {return this.config.particleCount;}

    gravity = 1;
    particleMass = 0;
}
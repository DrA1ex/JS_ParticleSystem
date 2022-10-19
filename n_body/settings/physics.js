import {Property, SettingsBase} from "./base.js";
import {ParticleInitType} from "./enum.js";


export class PhysicsSettings extends SettingsBase {
    static Properties = {
        particleInitType: Property.enum("particle_init", ParticleInitType, ParticleInitType.circle),
        particleCount: Property.int("particle_count", null).setExportable(true),
        particleMassFactor: Property.int("particle_mass", 0),
        resistance: Property.float("resistance", 1).setExportable(true),
        gravity: Property.float("g", 1).setExportable(true),
        enableCollision: Property.bool("collision", false).setExportable(true),
        collisionRestitution: Property.float("collision_r", 1).setExportable(true),
        minInteractionDistance: Property.float("min_distance", 1).setExportable(true),
    }


    get particleInitType() {return this.config.particleInitType;}
    get particleCount() {return this.config.particleCount;}
    get particleMassFactor() {return this.config.particleMassFactor;}
    get resistance() {return this.config.resistance;}
    get gravity() {return this.config.gravity;}
    get enableCollision() {return this.config.enableCollision;}
    get collisionRestitution() {return this.config.collisionRestitution;}
    get minInteractionDistance() {return this.config.minInteractionDistance;}

    particleGravity;
    particleMass = 0;
    massDistribution = [];
    minInteractionDistanceSq;

    constructor(values) {
        super(values);

        if (!this.particleCount) {
            this.config.particleCount = this.isMobile() ? 10000 : 20000;
        }

        this.config.resistance = Math.max(0.001, Math.min(1, this.resistance));

        let totalMass = this.particleCount;
        if (this.particleMassFactor > 0) {
            this.particleMass = Math.pow(2, this.particleMassFactor);
            this.massDistribution = [
                [Math.floor(1 / 0.001), this.particleMass],
                [Math.floor(1 / 0.005), this.particleMass / 3],
                [Math.floor(1 / 0.01), this.particleMass / 9],
                [Math.floor(1 / 0.05), this.particleMass / 20],
            ]

            for (let i = 0; i < this.massDistribution.length; i++) {
                const [k, mass] = this.massDistribution[i];
                totalMass += Math.floor(this.particleCount / k) * mass;
            }
        }

        this.particleGravity = this.gravity / totalMass;
        this.minInteractionDistanceSq = Math.pow(this.minInteractionDistance, 2);
    }
}
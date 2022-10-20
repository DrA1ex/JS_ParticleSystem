import {Property, SettingsBase} from "./base.js";
import {ParticleInitType} from "./enum.js";


export class PhysicsSettings extends SettingsBase {
    static Properties = {
        particleInitType: Property.enum("particle_init", ParticleInitType, ParticleInitType.circle).setName("Particle initializer"),
        particleCount: Property.int("particle_count", null).setExportable(true).setName("Particle count"),
        particleMassFactor: Property.int("particle_mass", 0).setName("Particle mass factor")
            .setDescription("Particle mass variance, exponential"),
        resistance: Property.float("resistance", 1).setExportable(true).setName("Resistance")
            .setDescription("Resistance of environment, 1 - means no resistance"),
        gravity: Property.float("g", 1).setExportable(true).setName("Gravity").setDescription("Attraction force"),
        enableCollision: Property.bool("collision", false).setExportable(true).setName("Collisions")
            .setDescription("Enable particle collision"),
        collisionRestitution: Property.float("collision_r", 1).setExportable(true).setName("Collision restitution")
            .setDescription("Sets collision restitution, 1 - means no energy loss during collision"),
        minInteractionDistance: Property.float("min_distance", 1).setExportable(true).setName("Min interaction distance")
            .setDescription("Minimal distance (pixels) to process interactions also determine collision distance"),
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
import {ComponentType, Property, ReadOnlyProperty, SettingsBase} from "./base.js";
import {ParticleInitType} from "./enum.js";

const collisionEnabled = settings => !!settings.physics.enableCollision;

export class PhysicsSettings extends SettingsBase {
    static Properties = {
        particleInitType: Property.enum("particle_init", ParticleInitType, ParticleInitType.circle)
            .setExportable(true)
            .setName("Particle initializer")
            .setBreaks(ComponentType.backend, ComponentType.particles),
        particleCount: Property.int("particle_count", null)
            .setExportable(true)
            .setName("Particle count")
            .setBreaks(ComponentType.backend, ComponentType.renderer, ComponentType.debug, ComponentType.dfri, ComponentType.particles)
            .setConstraints(2, 1e9),
        particleMassFactor: Property.int("particle_mass", 0)
            .setExportable(true)
            .setName("Particle mass factor").setDescription("Particle mass variance, exponential")
            .setBreaks(ComponentType.backend, ComponentType.particles)
            .setAffects(ComponentType.renderer)
            .setConstraints(0, 24),
        resistance: Property.float("resistance", 1)
            .setExportable(true)
            .setName("Resistance").setDescription("Resistance of environment, 1 - means no resistance")
            .setAffects(ComponentType.backend)
            .setConstraints(0.01, 1),
        gravity: Property.float("g", 1)
            .setExportable(true)
            .setName("Gravity").setDescription("Attraction force")
            .setAffects(ComponentType.backend)
            .setConstraints(1e-6, 1e6),
        enableCollision: Property.bool("collision", false)
            .setExportable(true)
            .setName("Collisions").setDescription("Enable particle collision")
            .setAffects(ComponentType.backend),
        collisionSize: Property.float("collision_size", 1)
            .setExportable(true)
            .setName("Particle collision size").setDescription("Sets particle collider size in pixels")
            .setAffects(ComponentType.backend)
            .setVisibleWhen(collisionEnabled)
            .setConstraints(1e-6, 1e3),
        collisionRestitution: Property.float("collision_r", 1)
            .setExportable(true)
            .setName("Collision restitution").setDescription("Bounciness used by the collision impulse: 0 removes normal relative velocity, 1 is elastic. Dense simultaneous contacts are averaged and capped by their measured closing speed to avoid velocity bursts. Values above 1 are disallowed to avoid injecting energy.")
            .setAffects(ComponentType.backend)
            .setVisibleWhen(collisionEnabled)
            .setConstraints(0, 1),
        minInteractionDistance: Property.float("min_distance", 0.01)
            .setExportable(true)
            .setName("Min interaction distance").setDescription("Minimal distance (pixels) to process interactions")
            .setAffects(ComponentType.backend)
            .setConstraints(1e-6, 1e3),
    }

    static ReadOnlyProperties = {
        particleGravity: ReadOnlyProperty.float().setName("Particle Gravity")
            .setFormatter(value => value.toExponential(2)),
        particleMass: ReadOnlyProperty.bool().setName("Max particle mass")
    }

    static PropertiesDependencies = new Map([
        [this.Properties.enableCollision, [this.Properties.collisionSize, this.Properties.collisionRestitution]],
        [this.Properties.gravity, [this.ReadOnlyProperties.particleGravity]],
        [this.Properties.particleMassFactor, [this.ReadOnlyProperties.particleMass]],
    ]);


    get particleInitType() {return this.config.particleInitType;}
    get particleCount() {return this.config.particleCount;}
    get particleMassFactor() {return this.config.particleMassFactor;}
    get resistance() {return this.config.resistance;}
    get gravity() {return this.config.gravity;}
    get enableCollision() {return this.config.enableCollision;}
    get collisionSize() {return this.config.collisionSize;}
    get collisionRestitution() {return this.config.collisionRestitution;}
    get minInteractionDistance() {return this.config.minInteractionDistance;}

    particleGravity;
    particleMass = 0;
    massDistribution = [];
    minInteractionDistanceSq;
    collisionSizeSq;

    constructor(values) {
        super(values);

        if (!this.particleCount) {
            this.config.particleCount = this.isMobile() ? 10000 : 20000;
        }

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
        this.collisionSizeSq = Math.pow(this.collisionSize, 2);
    }
}
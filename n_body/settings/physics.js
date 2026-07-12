import {ComponentType, Property, ReadOnlyProperty, SettingsBase} from "./base.js";
import {CollisionContactMode, ParticleInitType} from "./enum.js";

const collisionEnabled = settings => !!settings.physics.enableCollision;

function migrateLegacyCollisionValues(values) {
    if (!values || values.collisionContactMode !== undefined
        || typeof values.collisionAverageContacts !== "boolean") {
        return values;
    }

    return {
        ...values,
        collisionContactMode: values.collisionAverageContacts
            ? CollisionContactMode.average
            : CollisionContactMode.full,
    };
}

function countMultiplesFromZero(count, divisor) {
    if (count <= 0 || divisor <= 0) return 0;
    return Math.floor((count - 1) / divisor) + 1;
}

/**
 * Calculate the exact initialized particle mass without iterating over every
 * particle. Mass tiers are evaluated in priority order by the initializer;
 * the built-in distribution is a nested divisor chain, so each broader tier
 * only owns indices not already claimed by a previous tier.
 */
export function calculateInitializedTotalMass(particleCount, massDistribution) {
    let totalMass = particleCount;
    let claimedCount = 0;

    for (const [divisor, mass] of massDistribution) {
        const matchingCount = countMultiplesFromZero(particleCount, divisor);
        const tierCount = Math.max(0, matchingCount - claimedCount);
        totalMass += tierCount * mass;
        claimedCount += tierCount;
    }

    return totalMass;
}

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
            .setName("Collision restitution").setDescription("Bounciness used by the collision impulse: 0 removes normal relative velocity, 1 is elastic. Values above 1 are disallowed to avoid injecting energy.")
            .setAffects(ComponentType.backend)
            .setVisibleWhen(collisionEnabled)
            .setConstraints(0, 1),
        collisionContactMode: Property.enum("collision_contacts", CollisionContactMode, CollisionContactMode.balanced)
            .setExportable(true)
            .setName("Dense contact response").setDescription("How simultaneous contacts are combined. Balanced divides by sqrt(contact count), preserving dispersal without the explosive full sum. Average divides by contact count and is the calmest mode. Full keeps the complete sum and is mainly useful for intentionally energetic collisions.")
            .setAffects(ComponentType.backend)
            .setVisibleWhen(collisionEnabled),
        collisionLimitImpulse: Property.bool("collision_cap", true)
            .setExportable(true)
            .setName("Limit full contact impulse").setDescription("Limit a full multi-contact sum to the root-sum-square energy of its individual pair impulses. This mainly affects Dense contact response = Full; Balanced and Average are already naturally bounded.")
            .setAffects(ComponentType.backend)
            .setVisibleWhen(settings => collisionEnabled(settings)
                && settings.physics.collisionContactMode === CollisionContactMode.full),
        collisionIgnoreMicro: Property.bool("collision_micro", true)
            .setExportable(true)
            .setName("Ignore micro-collisions").setDescription("Suppress extremely small bounce impulses. Overlap separation remains active, so resting intersecting particles can still move apart instead of sticking together.")
            .setAffects(ComponentType.backend)
            .setVisibleWhen(collisionEnabled),
        collisionSeparation: Property.float("collision_separation", 0.15)
            .setExportable(true)
            .setName("Overlap separation").setDescription("Adds a small velocity bias proportional to penetration depth, allowing already-overlapping or nearly resting particles to separate. Set to 0 to disable. This is not an iterative positional solver.")
            .setAffects(ComponentType.backend)
            .setVisibleWhen(collisionEnabled)
            .setConstraints(0, 2),
        minInteractionDistance: Property.float("min_distance", 0.01)
            .setExportable(true)
            .setName("Min interaction distance").setDescription("Minimal distance (pixels) to process interactions")
            .setAffects(ComponentType.backend)
            .setConstraints(1e-6, 1e3),
    }

    static ReadOnlyProperties = {
        particleGravity: ReadOnlyProperty.float().setName("Particle Gravity")
            .setFormatter(value => value.toExponential(2)),
        particleMass: ReadOnlyProperty.float().setName("Max particle mass")
    }

    static PropertiesDependencies = new Map([
        [this.Properties.enableCollision, [
            this.Properties.collisionSize,
            this.Properties.collisionRestitution,
            this.Properties.collisionContactMode,
            this.Properties.collisionLimitImpulse,
            this.Properties.collisionIgnoreMicro,
            this.Properties.collisionSeparation,
        ]],
        [this.Properties.gravity, [this.ReadOnlyProperties.particleGravity]],
        [this.Properties.particleMassFactor, [this.ReadOnlyProperties.particleMass]],
    ]);


    static fromQueryParams(defaults = null) {
        const result = super.fromQueryParams(migrateLegacyCollisionValues(defaults));
        if (globalThis.window) {
            const params = new URLSearchParams(window.location.search);
            if (!params.has("collision_contacts") && params.has("collision_average")) {
                const legacyValue = params.get("collision_average")?.trim().toLowerCase();
                result.config.collisionContactMode = ["0", "false", "off"].includes(legacyValue)
                    ? CollisionContactMode.full
                    : CollisionContactMode.average;
            }
        }
        return result;
    }

    static deserialize(serialized) {
        return super.deserialize(migrateLegacyCollisionValues(serialized));
    }

    static import(params) {
        return super.import(migrateLegacyCollisionValues(params));
    }

    withImportedValues(params) {
        return super.withImportedValues(migrateLegacyCollisionValues(params));
    }


    get particleInitType() {return this.config.particleInitType;}
    get particleCount() {return this.config.particleCount;}
    get particleMassFactor() {return this.config.particleMassFactor;}
    get resistance() {return this.config.resistance;}
    get gravity() {return this.config.gravity;}
    get enableCollision() {return this.config.enableCollision;}
    get collisionSize() {return this.config.collisionSize;}
    get collisionRestitution() {return this.config.collisionRestitution;}
    get collisionContactMode() {return this.config.collisionContactMode;}
    get collisionLimitImpulse() {return this.config.collisionLimitImpulse;}
    get collisionIgnoreMicro() {return this.config.collisionIgnoreMicro;}
    get collisionSeparation() {return this.config.collisionSeparation;}
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

        if (this.particleMassFactor > 0) {
            this.particleMass = Math.pow(2, this.particleMassFactor);
            this.massDistribution = [
                [Math.floor(1 / 0.001), this.particleMass],
                [Math.floor(1 / 0.005), this.particleMass / 3],
                [Math.floor(1 / 0.01), this.particleMass / 9],
                [Math.floor(1 / 0.05), this.particleMass / 20],
            ]
        }

        const totalMass = calculateInitializedTotalMass(this.particleCount, this.massDistribution);
        this.particleGravity = this.gravity / totalMass;
        this.minInteractionDistanceSq = Math.pow(this.minInteractionDistance, 2);
        this.collisionSizeSq = Math.pow(this.collisionSize, 2);
    }
}
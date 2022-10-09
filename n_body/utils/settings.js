export const ParticleInitType = {
    circle: 0,
    uniform: 1,
    bang: 2,
    disk: 3,
    rotation: 4,
    collision: 5
}

export const RenderType = {
    canvas: "canvas",
    webgl2: "webgl2"
}

export const BackendType = {
    worker: "worker",
    gpgpu: "gpgpu"
}

const SERIALIZABLE_PROPS = [
    "enableFilter", "enableBlending", "particleCount", "resistance", "gravity", "minInteractionDistance", "particleMass"
];

export class Settings {
    isMobile = false;
    render = null;
    backend = BackendType.worker;
    enableFilter = false;
    enableBlending = true;
    enableDFRI = true;
    DFRIMaxFrames = 120;
    useDpr = null;
    dprRate = 0;
    fps = 60;

    particleInitTypeCode = null;
    particleInitType = ParticleInitType.circle;

    particleCount = null;

    resistance = 1;
    gravity = 1;
    particleGravity = null;
    particleMassFactor = 0;
    particleMass = 0;
    massDistribution = [];
    minInteractionDistance = 0.1;
    minInteractionDistanceSq = null;

    segmentDivider = 2;
    segmentMaxCount = null;

    debug = false;
    debugTree = null;
    debugVelocity = false;
    debugForce = null;
    stats = true;

    worldWidth = 1920;
    worldHeight = 1080;
    bufferCount = 3;

    constructor(values) {
        for (const [key, value] of Object.entries(values)) {
            if (value !== null && this.hasOwnProperty(key)) {
                this[key] = value;
            }
        }

        if (!this.render) {
            this.render = this.isMobile ? RenderType.canvas : RenderType.webgl2;
        }

        if (this.useDpr === null) {
            this.useDpr = this.render === RenderType.webgl2;
        }

        if (!this.particleCount) {
            this.particleCount = this.isMobile ? 10000 : 20000;
        }

        if (this.particleInitTypeCode) {
            this.particleInitType = ParticleInitType[this.particleInitTypeCode] ?? this.particleInitTypeCode;
        }

        if (!this.segmentMaxCount) {
            this.segmentMaxCount = this.backend === BackendType.gpgpu ? 128 : 32;
        }

        if (this.backend === BackendType.gpgpu) {
            this.segmentMaxCount *= this.segmentMaxCount;
        }

        if (!this.debug) {
            this.debugTree = false;
            this.debugVelocity = false;
            this.debugForce = false;
        } else {
            if (this.debugTree === null) {
                this.debugTree = this.debug;
            }
            if (this.debugForce === null) {
                this.debugForce = this.debugVelocity;
            }
        }

        let totalMass = this.particleCount;
        if (this.particleMassFactor > 0) {
            this.particleMass = Math.pow(2, this.particleMassFactor);
            const k = Math.floor(this.particleCount / 100);
            this.massDistribution = [
                [5 * k, this.particleMass],
                [4 * k, this.particleMass / 3],
                [3 * k, this.particleMass / 9],
            ]

            for (let i = 0; i < this.massDistribution.length; i++) {
                const [k, mass] = this.massDistribution[i];
                totalMass += Math.floor(this.particleCount / k) * mass;
            }
        }

        this.particleGravity = this.gravity / totalMass;
        this.minInteractionDistanceSq = Math.pow(this.minInteractionDistance, 2);
    }

    serialize() {
        const result = {};
        for (const [key, value] of Object.entries(this)) {
            if (SERIALIZABLE_PROPS.includes(key)) {
                result[key] = value;
            }
        }

        return result;
    }

    static fromQueryParams(defaults = null) {
        const urlSearchParams = new URLSearchParams(window.location.search);
        const queryParams = Object.fromEntries(urlSearchParams.entries());

        function _string(key) {
            const value = queryParams[key] && queryParams[key].trim();
            if (value && value.length > 0) {
                return value;
            }

            return null;
        }

        function _bool(key) {
            const value = queryParams[key] && queryParams[key].trim();
            if (value && ["1", "true", "on"].includes(value)) {
                return true;
            } else if (value && ["0", "false", "off"].includes(value)) {
                return false;
            }

            return null;
        }

        function _int(key) {
            const value = queryParams[key] && queryParams[key].trim();
            if (value && value.length > 0) {
                const parsed = Number.parseInt(value);
                if (Number.isFinite(parsed)) {
                    return parsed;
                }
            }

            return null;
        }

        function _float(key) {
            const value = queryParams[key] && queryParams[key].trim();
            if (value && value.length > 0) {
                const parsed = Number.parseFloat(value);
                if (Number.isFinite(parsed)) {
                    return parsed;
                }
            }

            return null;
        }

        const configFromParams = {
            isMobile: /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || window.orientation !== undefined,
            render: _string("render"),
            backend: _string("backend"),
            useDpr: _bool("dpr"),
            dprRate: _float("dpr_rate"),
            enableFilter: _bool("filter"),
            enableBlending: _bool("blend"),
            enableDFRI: _bool("dfri"),
            DFRIMaxFrames: _int("dfri_max"),
            particleInitTypeCode: _string("particle_init"),
            particleCount: _int("particle_count"),
            particleMassFactor: _int("particle_mass"),
            resistance: _float("resistance"),
            gravity: _float("g"),
            minInteractionDistance: _float("min_distance"),
            segmentDivider: _int("segment_divider"),
            segmentMaxCount: _int("segment_max_count"),
            bufferCount: _int("buffers"),
            debug: _bool("debug"),
            debugTree: _bool("debug_tree"),
            debugVelocity: _bool("debug_velocity"),
            debugForce: _bool("debug_force"),
            stats: _bool("stats")
        };

        if (defaults) {
            for (const [key, value] of Object.entries(defaults)) {
                if (SERIALIZABLE_PROPS.includes(key) && configFromParams[key] === null) {
                    configFromParams[key] = value;
                }
            }
        }

        return new Settings(configFromParams);
    }

    static async loadState() {
        const urlSearchParams = new URLSearchParams(window.location.search);
        const queryParams = Object.fromEntries(urlSearchParams.entries());

        if (queryParams.state) {
            try {
                const data = await fetch(queryParams.state);
                if (data.ok) {
                    return await data.json();
                }

                console.error(`Download failed. Code ${data.status}: ${data.statusText}`);
            } catch (e) {
                console.error("Unable to load state", e);
            }
        }

        return null;
    }
}
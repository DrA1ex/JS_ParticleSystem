export const ParticleInitType = {
    circle: 0,
    uniform: 1,
    bang: 2,
}

export class Settings {
    enableFilter = false;
    isMobile = false;
    useDpr = false;
    fps = 60;

    particleInitType = ParticleInitType.circle;
    particleCount = null;

    resistance = 1;
    gravity = 1;
    particleGravity = null;
    minInteractionDistance = 0.01;
    minInteractionDistanceSq = null;

    segmentDivider = 2;
    segmentMaxCount = 32;

    debug = false;
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

        if (!this.particleCount) {
            this.particleCount = this.isMobile ? 10000 : 20000;
        }

        this.particleGravity = this.gravity / this.particleCount;
        this.minInteractionDistanceSq = Math.pow(this.minInteractionDistance, 2);
    }

    static fromQueryParams(queryParams, width, height) {
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

        return new Settings({
            isMobile: /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || window.orientation !== undefined,
            useDpr: _bool("dpr"),
            fps: _int("fps"),
            enableFilter: _bool("filter"),
            particleInitType: ParticleInitType[_string("particle_init")],
            particleCount: _int("particle_count"),
            resistance: _float("resistance"),
            gravity: _float("g"),
            minInteractionDistance: _int("min_distance"),
            segmentDivider: _int("segment_divider"),
            segmentMaxCount: _int("segment_max_count"),
            bufferCount: _int("buffers"),
            debug: _bool("debug"),
            stats: _bool("stats")
        });
    }
}
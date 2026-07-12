import {RendererBase} from "../base.js";
import * as WebglUtils from "../../utils/webgl.js";
import {BufferUploadMode, MaxSpeedUpdateMode, ParticleSpriteMode, RenderColorMode} from "../../settings/enum.js";
import {ITEM_SIZE, getParticleCount, isParticleBuffer} from "../../utils/particles.js";

const RenderVertexShaderSource = await fetch(new URL("./shaders/render_vs.glsl", import.meta.url))
    .then(r => r.text());
const RenderFragmentShaderSource = await fetch(new URL("./shaders/render_fs.glsl", import.meta.url))
    .then(r => r.text());

const GL = WebGL2RenderingContext;
const MAX_SPEED_THROTTLE_INTERVAL_MS = 250;
const POSITION_ITEM_SIZE = 2;
const VELOCITY_ITEM_SIZE = 2;
const MASS_ITEM_SIZE = 1;
const COLOR_ITEM_SIZE = 3;
const RENDER_BUFFER_PROGRAM = "renderBuffers";
const STATIC_COLOR_MODES = new Set([RenderColorMode.random, RenderColorMode.cluster]);
const PARTICLE_SPRITE_IDS = {
    [ParticleSpriteMode.point]: 0,
    [ParticleSpriteMode.circle]: 1,
    [ParticleSpriteMode.softCircle]: 2,
    [ParticleSpriteMode.glow]: 3,
    [ParticleSpriteMode.softGlow]: 4,
    [ParticleSpriteMode.blured]: 5,
};
const PROGRAM_NAMES = {
    [RenderColorMode.velocity]: {
        plain: "renderVelocity",
        interpolated: "renderVelocityInterpolated",
        compactPlain: "renderVelocityCompact",
        compactInterpolated: "renderVelocityCompactInterpolated"
    },
    [RenderColorMode.random]: {
        plain: "renderRandom",
        interpolated: "renderRandomInterpolated",
        compactPlain: "renderRandomCompact",
        compactInterpolated: "renderRandomCompactInterpolated"
    },
    [RenderColorMode.cluster]: {
        plain: "renderCluster",
        interpolated: "renderClusterInterpolated",
        compactPlain: "renderClusterCompact",
        compactInterpolated: "renderClusterCompactInterpolated"
    },
    [RenderColorMode.mass]: {
        plain: "renderMass",
        interpolated: "renderMassInterpolated",
        compactPlain: "renderMassCompact",
        compactInterpolated: "renderMassCompactInterpolated"
    },
    [RenderColorMode.fixed]: {
        plain: "renderFixed",
        interpolated: "renderFixedInterpolated",
        compactPlain: "renderFixedCompact",
        compactInterpolated: "renderFixedCompactInterpolated"
    }
};

function makeVertexShaderSource(colorMode, interpolated, compact = false) {
    const defines = [
        `#define COLOR_MODE_${colorMode.toUpperCase()} 1`,
        `#define USE_INTERPOLATION ${interpolated ? 1 : 0}`,
        `#define USE_COMPACT_FRAME ${compact ? 1 : 0}`
    ];
    return RenderVertexShaderSource.replace("#version 300 es", `#version 300 es\n${defines.join("\n")}`);
}

function makeProgramConfig(colorMode, interpolated, compact = false) {
    const programKey = compact
        ? (interpolated ? "compactInterpolated" : "compactPlain")
        : (interpolated ? "interpolated" : "plain");
    const program = PROGRAM_NAMES[colorMode][programKey];
    const attributes = [{name: "position"}];
    const entries = [compact
        ? {name: "position", buffer: `${RENDER_BUFFER_PROGRAM}.currentPosition`, type: GL.FLOAT, size: 2}
        : {name: "position", buffer: `${RENDER_BUFFER_PROGRAM}.particles`, type: GL.FLOAT, size: 2, stride: ITEM_SIZE * Float32Array.BYTES_PER_ELEMENT, offset: 0}
    ];

    if (interpolated) {
        attributes.push({name: "next_position"});
        entries.push({name: "next_position", buffer: `${RENDER_BUFFER_PROGRAM}.nextPosition`, type: GL.FLOAT, size: 2});
    }

    if (colorMode === RenderColorMode.velocity) {
        if (compact) {
            attributes.push({name: "previous_position"});
            entries.push({name: "previous_position", buffer: `${RENDER_BUFFER_PROGRAM}.previousPosition`, type: GL.FLOAT, size: 2});
        } else {
            attributes.push({name: "velocity"}, {name: "mass"});
            entries.push(
                {name: "velocity", buffer: `${RENDER_BUFFER_PROGRAM}.particles`, type: GL.FLOAT, size: 2, stride: ITEM_SIZE * Float32Array.BYTES_PER_ELEMENT, offset: 2 * Float32Array.BYTES_PER_ELEMENT},
                {name: "mass", buffer: `${RENDER_BUFFER_PROGRAM}.particles`, type: GL.FLOAT, size: 1, stride: ITEM_SIZE * Float32Array.BYTES_PER_ELEMENT, offset: 4 * Float32Array.BYTES_PER_ELEMENT}
            );
        }
    } else if (STATIC_COLOR_MODES.has(colorMode)) {
        if (!compact) {
            attributes.push({name: "mass"});
            entries.push({name: "mass", buffer: `${RENDER_BUFFER_PROGRAM}.particles`, type: GL.FLOAT, size: 1, stride: ITEM_SIZE * Float32Array.BYTES_PER_ELEMENT, offset: 4 * Float32Array.BYTES_PER_ELEMENT});
        }
        attributes.push({name: "fixed_color"});
        entries.push({
            name: "fixed_color",
            buffer: `${RENDER_BUFFER_PROGRAM}.particleColors`,
            type: GL.UNSIGNED_BYTE,
            size: 3,
            normalized: true
        });
    } else if (colorMode === RenderColorMode.mass && !compact) {
        attributes.push({name: "mass"});
        entries.push({name: "mass", buffer: `${RENDER_BUFFER_PROGRAM}.particles`, type: GL.FLOAT, size: 1, stride: ITEM_SIZE * Float32Array.BYTES_PER_ELEMENT, offset: 4 * Float32Array.BYTES_PER_ELEMENT});
    }

    return {
        program,
        vs: makeVertexShaderSource(colorMode, interpolated, compact),
        fs: RenderFragmentShaderSource,
        attributes,
        uniforms: [
            {type: "uniform2f", name: "resolution"},
            {type: "uniform1f", name: "point_size"},
            {type: "uniform1f", name: "scale"},
            {type: "uniform2f", name: "offset"},
            {type: "uniform1f", name: "max_mass"},
            {type: "uniform1f", name: "max_speed"},
            {type: "uniform1f", name: "particle_scale"},
            {type: "uniform1i", name: "sprite_mode"},
            {type: "uniform1f", name: "interpolation_factor"},
            {type: "uniform1f", name: "filter_enabled"},
            {type: "uniform1f", name: "hue_angle"},
            {type: "uniform3f", name: "fixed_color_uniform"},
        ],
        vertexArrays: [{name: "particle", entries}],
    };
}

const CONFIGURATION = [
    {
        program: RENDER_BUFFER_PROGRAM,
        internal: true,
        buffers: [
            {name: "particles", usageHint: GL.STREAM_DRAW},
            {name: "currentPosition", usageHint: GL.STREAM_DRAW},
            {name: "previousPosition", usageHint: GL.STREAM_DRAW},
            {name: "nextPosition", usageHint: GL.STREAM_DRAW},
            {name: "particleColors", usageHint: GL.STATIC_DRAW},
        ]
    },
    ...Object.values(RenderColorMode).flatMap(colorMode => [
        makeProgramConfig(colorMode, false),
        makeProgramConfig(colorMode, true),
        makeProgramConfig(colorMode, false, true),
        makeProgramConfig(colorMode, true, true),
    ]),
];

export class Webgl2Renderer extends RendererBase {
    /**
     * @param {HTMLCanvasElement} canvas
     * @param {AppSimulationSettings} settings
     */
    constructor(canvas, settings) {
        super(canvas, settings);
        this.displayName = "Webgl2Renderer";

        const contextOptions = this._getContextOptions();
        this.gl = canvas.getContext("webgl2", contextOptions);
        if (!this.gl && contextOptions) {
            this.gl = canvas.getContext("webgl2");
        }
        this._stateConfig = {};

        this._gpuTimerExt = this.gl.getExtension("EXT_disjoint_timer_query_webgl2");
        this._gpuTimerQuery = null;
        this.stats.gpuTimerStatus = this._gpuTimerExt ? "waiting" : "unsupported";

        // Allocate CPU staging buffers lazily. The worker and recording-player
        // fast paths upload their typed arrays directly, so eagerly reserving
        // another 7 floats per particle can waste hundreds of megabytes.
        this._particleBufferData = null;
        this._nextPositionBufferData = null;
        this._particleColorBufferData = null;

        this._maxSpeed = this.settings.physics.gravity / 100;
        this._lastMaxSpeedScanTime = 0;

        this._particleDataDirty = true;
        this._uploadedParticleSource = null;
        this._uploadedParticleCount = 0;
        this._compactFrameDirty = true;
        this._uploadedCurrentPositionSource = null;
        this._uploadedCurrentPositionCount = 0;
        this._uploadedPreviousPositionSource = null;
        this._uploadedPreviousPositionCount = 0;

        this._nextParticles = null;
        this._nextPositionFrame = null;
        this._nextParticlesDirty = true;
        this._uploadedNextParticleSource = null;
        this._uploadedNextParticleCount = 0;
        this._interpolationFactor = 0;

        this._staticColorState = {mode: null, count: 0, generated: false, uploaded: false};
        this._randomColorSeed = this._createRandomColorSeed();

        this._bufferCapacities = new Map();
        this._uploadQueue = [];
        this._uploadQueueTimer = null;
        this._uploadQueueTimerIsIdle = false;
        this._lastUploadedBytes = 0;
        this._lastPreloadedBytes = 0;
        this._lastPreloadTime = 0;
        this._lastQueuedUploads = 0;

        this.initWebgl();
        if (this.settings.common.debug) {
            this.initDebugCanvas();
        }
    }

    _getContextOptions() {
        if (!this.settings.render.webglLowLatency) {
            return undefined;
        }

        return {
            alpha: false,
            antialias: false,
            depth: false,
            stencil: false,
            preserveDrawingBuffer: false,
            powerPreference: "high-performance",
            desynchronized: true,
        };
    }

    initWebgl() {
        WebglUtils.createFromConfig(this.gl, CONFIGURATION, this._stateConfig);
        this._loadUniformsForAllPrograms({
            point_size: this.dpr,
            max_mass: this.settings.physics.particleMass + 1,
            max_speed: this._maxSpeed,
            scale: this.scale,
            offset: [this.xOffset, this.yOffset],
            resolution: [this.canvasWidth, this.canvasHeight],
            particle_scale: this.settings.render.particleSizeScale,
            sprite_mode: this._particleSpriteId,
            interpolation_factor: 0,
            filter_enabled: 0,
            hue_angle: 0,
            fixed_color: this._fixedColorRgb,
        });

        this.gl.viewport(0, 0, this.canvasWidth, this.canvasHeight);
        this.gl.clearColor(0, 0, 0, 1);
        this.gl.clear(this.gl.COLOR_BUFFER_BIT);
        this._applyBlendMode();
    }

    initDebugCanvas() {
        if (!this.debugCanvas) {
            const debugCanvas = document.createElement("canvas");

            debugCanvas.style.position = "absolute";
            debugCanvas.style.top = "0";
            debugCanvas.style.left = "0";
            debugCanvas.style.width = "100%"
            debugCanvas.style.height = "100%"
            debugCanvas.style.pointerEvents = "none";

            const root = document.getElementById("root-content") ?? document.body;
            root.appendChild(debugCanvas);

            this.debugCanvas = debugCanvas;
            this.debugCtx = this.debugCanvas.getContext("2d");
        }

        this._updateDebugCanvasSize();
    }

    reconfigure(settings) {
        const oldSettings = this.settings;
        super.reconfigure(settings);

        if (!oldSettings.common.debug && settings.common.debug) {
            this.initDebugCanvas();
        }

        if (oldSettings.render.colorMode !== settings.render.colorMode ||
            oldSettings.physics.particleCount !== settings.physics.particleCount) {
            this.resetParticleColors();
        }

        this._loadUniformsForAllPrograms({
            max_mass: this.settings.physics.particleMass + 1,
            fixed_color: this._fixedColorRgb,
        });
        this._applyBlendMode();
        this.markParticlesDirty();
    }

    reset() {
        super.reset();
        this._maxSpeed = this.settings.physics.gravity / 100;
        this._lastMaxSpeedScanTime = 0;
        this.resetParticleColors();
        this.markParticlesDirty();
        this.setInterpolationFrame(null);
        this.setInterpolationFactor(0);
    }

    clear() {
        super.clear();

        this.gl.clear(this.gl.COLOR_BUFFER_BIT);
        this.debugCtx?.clearRect(0, 0, this.canvasWidth, this.canvasHeight);
    }

    supportsGpuInterpolation() {
        return true;
    }

    supportsCompactPositionFrames() {
        return true;
    }

    /**
     * DFRI supplies only the next physics frame. The renderer extracts x/y into
     * a compact next-position buffer, so the GPU interpolation path does not
     * upload velocity or mass for the ahead frame.
     */
    setInterpolationFrame(particles) {
        if (particles && isParticleBuffer(particles)) {
            this._nextParticles = particles;
            this._nextPositionFrame = null;
        } else {
            this._nextParticles = null;
            this._nextPositionFrame = null;
        }
        this._nextParticlesDirty = true;
        this._scheduleNextPositionPreload();
    }

    setInterpolationPositionFrame(positions) {
        if (positions instanceof Float32Array) {
            this._nextPositionFrame = positions;
            this._nextParticles = null;
        } else {
            this._nextPositionFrame = null;
            this._nextParticles = null;
        }
        this._nextParticlesDirty = true;
        this._scheduleNextPositionPreload();
    }

    setInterpolationFactor(factor) {
        const value = Number.isFinite(factor) ? Math.max(0, Math.min(1, factor)) : 0;

        // The simulation normally supplies an interleaved particle buffer, while
        // the recording player supplies a compact [x, y] position frame. The
        // previous guard only recognized the simulation path, so the player did
        // select the interpolation shader and upload the next frame, but forced
        // interpolation_factor back to zero on every draw.
        this._interpolationFactor = this._hasInterpolationFrame() ? value : 0;
    }

    markParticlesDirty() {
        this._particleDataDirty = true;
        this._compactFrameDirty = true;
    }

    preloadInterpolationFrame(particles, budgetMs = 4) {
        if (!particles || !isParticleBuffer(particles)) {
            return false;
        }

        if (this._nextParticles !== particles) {
            this._nextParticles = particles;
            this._nextParticlesDirty = true;
        }

        this._queueNextPositionUpload();
        this._flushUploadQueue(budgetMs);
        return true;
    }

    _scheduleNextPositionPreload() {
        if (!this._nextParticles && !this._nextPositionFrame) {
            return;
        }

        this._queueNextPositionUpload();
        if (this._uploadQueueTimer !== null) {
            return;
        }

        this._uploadQueueTimerIsIdle = typeof window.requestIdleCallback === "function";
        const schedule = this._uploadQueueTimerIsIdle
            ? (cb) => window.requestIdleCallback(cb, {timeout: 50})
            : (cb) => setTimeout(() => cb({timeRemaining: () => 4}), 0);

        this._uploadQueueTimer = schedule((deadline) => {
            this._uploadQueueTimer = null;
            this._uploadQueueTimerIsIdle = false;
            const budget = Math.max(1, Math.min(6, deadline?.timeRemaining?.() ?? 4));
            this._flushUploadQueue(budget);
        });
    }

    _queueNextPositionUpload() {
        if (!this._uploadQueue.some(job => job.type === "nextPosition")) {
            this._uploadQueue.push({type: "nextPosition"});
        }
    }

    _flushUploadQueue(budgetMs = 4) {
        if (!this._uploadQueue.length) {
            return 0;
        }

        const start = performance.now();
        const previousPreloadedBytes = this._lastPreloadedBytes || 0;
        let jobs = 0;

        while (this._uploadQueue.length) {
            const job = this._uploadQueue.shift();
            if (job.type === "nextPosition") {
                const count = this._nextPositionFrame ? Math.floor(this._nextPositionFrame.length / POSITION_ITEM_SIZE) :
                    (this._nextParticles ? getParticleCount(this._nextParticles) : 0);
                this._uploadNextPositionIfNeeded(count, false);
            }
            jobs += 1;

            if (performance.now() - start >= budgetMs) {
                break;
            }
        }

        this._lastPreloadTime = performance.now() - start;
        this._lastQueuedUploads = jobs;
        if (this._lastPreloadedBytes === previousPreloadedBytes) {
            this._lastPreloadedBytes = 0;
        }
        return jobs;
    }

    render(particles) {
        this._renderPreparedFrame(() => this._updateData(particles));
    }

    renderPositionFrame(positions, previousPositions = null) {
        this._renderPreparedFrame(() => this._updateCompactPositionData(positions, previousPositions));
    }

    _renderPreparedFrame(prepareFn) {
        const renderStart = performance.now();
        this._updateShaderFilterState();

        this.debugCtx?.clearRect(0, 0, this.canvasWidth, this.canvasHeight);
        const {count, prepareDataTime, uploadTime, programName, sourceLayout = "interleaved"} = prepareFn();

        const drawStart = performance.now();
        this._pollGpuTimer();
        this.gl.clear(this.gl.COLOR_BUFFER_BIT);

        const state = this._stateConfig[programName];
        this.gl.useProgram(state.program);
        this.gl.bindVertexArray(state.vertexArrays["particle"]);

        const gpuQuery = this._beginGpuTimer();
        this.gl.drawArrays(this.gl.POINTS, 0, count);
        this._endGpuTimer(gpuQuery);

        const drawTime = performance.now() - drawStart;

        this.stats.prepareDataTime = prepareDataTime;
        this.stats.uploadTime = uploadTime;
        this.stats.drawTime = drawTime;
        this.stats.renderTime = performance.now() - renderStart;
        this.stats.colorMode = this._colorMode;
        this.stats.staticColorStatus = STATIC_COLOR_MODES.has(this._colorMode)
            ? (this._staticColorState?.uploaded ? "ready" : "pending")
            : "off";
        this.stats.uploadMode = this.settings.render.bufferUploadMode;
        this.stats.uploadedBytes = this._lastUploadedBytes;
        this.stats.preloadedBytes = this._lastPreloadedBytes || 0;
        this.stats.preloadTime = this._lastPreloadTime || 0;
        this.stats.uploadQueue = this._uploadQueue?.length || 0;
        this.stats.webglLowLatency = !!this.settings.render.webglLowLatency;
        this.stats.gpuInterpolation = this._getGpuInterpolationStatus(count);
        this.stats.filterMode = this.settings.render.enableFilter ? "shader" : "off";
        this.stats.particleSprite = this.settings.render.particleSprite || ParticleSpriteMode.point;
        this.stats.particleSizeScale = this.settings.render.particleSizeScale;
        this.stats.sourceLayout = sourceLayout;
    }

    _updateData(particles) {
        this._lastUploadedBytes = 0;
        const prepareStart = performance.now();
        const isBuffer = isParticleBuffer(particles);
        const count = getParticleCount(particles);
        const colorMode = this._colorMode;
        const needsVelocity = colorMode === RenderColorMode.velocity;
        const scanMaxSpeed = needsVelocity && this._shouldScanMaxSpeed(prepareStart);
        const canUseSourceDirectly = isBuffer && !this.coordinateTransformer;
        const sourceData = canUseSourceDirectly ? particles : this._ensureParticleBufferCapacity(count);
        let maxSpeed = this._maxSpeed;

        this._ensureNextPositionBufferCapacity(count);

        const needsCurrentUpload = !canUseSourceDirectly || this._particleDataDirty ||
            this._uploadedParticleSource !== sourceData || this._uploadedParticleCount !== count;

        if (!canUseSourceDirectly) {
            // CPU DFRI and object-particle fallback still need a compact
            // interleaved upload buffer. The fast WebGL path below uses the
            // worker's interleaved Float32Array directly.
            maxSpeed = this._fillUploadBuffer(particles, count, isBuffer, scanMaxSpeed, maxSpeed);
        } else if (scanMaxSpeed) {
            maxSpeed = this._scanMaxSpeedFromBuffer(sourceData, count, maxSpeed);
        }

        if (scanMaxSpeed) {
            this._maxSpeed = maxSpeed;
            this._lastMaxSpeedScanTime = prepareStart;
        }

        const particleScale = this.settings.render.fixedParticleSize ?
            this.settings.render.particleSizeScale :
            this.settings.render.particleSizeScale * this.scale;
        const interpolationEnabled = this._useInterpolationProgram(count);
        const programName = this._getProgramName(colorMode, interpolationEnabled);

        this._loadUniforms(programName, {
            scale: this.scale,
            max_speed: this._maxSpeed,
            offset: [this.xOffset, this.yOffset],
            particle_scale: particleScale,
            sprite_mode: this._particleSpriteId,
            interpolation_factor: interpolationEnabled ? this._interpolationFactor : 0,
            filter_enabled: this.settings.render.enableFilter ? 1 : 0,
            hue_angle: this.settings.render.enableFilter ? this._hueAngle * Math.PI / 180 : 0,
            fixed_color: this._fixedColorRgb,
        });

        const prepareDataTime = performance.now() - prepareStart;
        const uploadStart = performance.now();
        this._uploadCurrentBuffer(sourceData, count, needsCurrentUpload);
        if (STATIC_COLOR_MODES.has(colorMode)) {
            this._ensureStaticParticleColors(sourceData, count, colorMode);
        }
        if (interpolationEnabled) {
            this._uploadNextPositionIfNeeded(count);
        }
        const uploadTime = performance.now() - uploadStart;

        return {count, prepareDataTime, uploadTime, programName, sourceLayout: "interleaved"};
    }

    _updateCompactPositionData(positions, previousPositions = null) {
        if (!(positions instanceof Float32Array) || positions.length % POSITION_ITEM_SIZE !== 0) {
            throw new Error("Compact position frame must be a Float32Array of [x, y] pairs");
        }

        const count = Math.floor(positions.length / POSITION_ITEM_SIZE);
        const previous = previousPositions instanceof Float32Array && previousPositions.length >= positions.length
            ? previousPositions
            : positions;
        const colorMode = this._colorMode;
        const prepareStart = performance.now();
        const scanMaxSpeed = colorMode === RenderColorMode.velocity && this._shouldScanMaxSpeed(prepareStart);
        if (scanMaxSpeed) {
            this._maxSpeed = this._scanMaxSpeedFromPositionFrames(positions, previous, count, this._maxSpeed);
            this._lastMaxSpeedScanTime = prepareStart;
        }

        const particleScale = this.settings.render.fixedParticleSize
            ? this.settings.render.particleSizeScale
            : this.settings.render.particleSizeScale * this.scale;
        const interpolationEnabled = this._useInterpolationProgram(count);
        const programName = this._getCompactProgramName(colorMode, interpolationEnabled);

        this._loadUniforms(programName, {
            scale: this.scale,
            max_speed: this._maxSpeed,
            offset: [this.xOffset, this.yOffset],
            particle_scale: particleScale,
            sprite_mode: this._particleSpriteId,
            interpolation_factor: interpolationEnabled ? this._interpolationFactor : 0,
            filter_enabled: this.settings.render.enableFilter ? 1 : 0,
            hue_angle: this.settings.render.enableFilter ? this._hueAngle * Math.PI / 180 : 0,
            fixed_color: this._fixedColorRgb,
        });

        const prepareDataTime = performance.now() - prepareStart;
        const uploadStart = performance.now();
        this._uploadCompactPositionFrames(positions, previous, count, colorMode === RenderColorMode.velocity);
        if (STATIC_COLOR_MODES.has(colorMode)) {
            this._ensureStaticParticleColors(positions, count, colorMode, POSITION_ITEM_SIZE);
        }
        if (interpolationEnabled) {
            this._uploadNextPositionIfNeeded(count);
        }
        const uploadTime = performance.now() - uploadStart;

        return {count, prepareDataTime, uploadTime, programName, sourceLayout: "compact-position"};
    }

    _scanMaxSpeedFromPositionFrames(current, previous, count, currentMaxSpeed) {
        let maxSpeed = Math.max(1e-9, currentMaxSpeed);
        const step = Math.max(1, Math.floor(count / 4096));
        for (let i = 0; i < count; i += step) {
            const offset = i * POSITION_ITEM_SIZE;
            const speed = Math.max(
                Math.abs(current[offset] - previous[offset]),
                Math.abs(current[offset + 1] - previous[offset + 1]),
            );
            if (Number.isFinite(speed) && speed > maxSpeed) {
                maxSpeed = speed;
            }
        }
        return maxSpeed;
    }

    _uploadCompactPositionFrames(current, previous, count, uploadPrevious) {
        const currentChanged = this._compactFrameDirty ||
            this._uploadedCurrentPositionSource !== current || this._uploadedCurrentPositionCount !== count;
        if (currentChanged) {
            this._uploadArrayBuffer("currentPosition", current, count * POSITION_ITEM_SIZE);
            this._uploadedCurrentPositionSource = current;
            this._uploadedCurrentPositionCount = count;
        }

        if (uploadPrevious) {
            const previousChanged = this._compactFrameDirty ||
                this._uploadedPreviousPositionSource !== previous || this._uploadedPreviousPositionCount !== count;
            if (previousChanged) {
                this._uploadArrayBuffer("previousPosition", previous, count * POSITION_ITEM_SIZE);
                this._uploadedPreviousPositionSource = previous;
                this._uploadedPreviousPositionCount = count;
            }
        }
        this._compactFrameDirty = false;
    }

    get _particleSpriteId() {
        return PARTICLE_SPRITE_IDS[this.settings.render.particleSprite] ?? PARTICLE_SPRITE_IDS[ParticleSpriteMode.point];
    }

    get _colorMode() {
        return this.settings.render.colorMode || RenderColorMode.velocity;
    }

    _getProgramName(colorMode = this._colorMode, interpolated = this._useInterpolationProgram()) {
        const programs = PROGRAM_NAMES[colorMode] || PROGRAM_NAMES[RenderColorMode.velocity];
        return programs[interpolated ? "interpolated" : "plain"];
    }

    _getCompactProgramName(colorMode = this._colorMode, interpolated = this._useInterpolationProgram()) {
        const programs = PROGRAM_NAMES[colorMode] || PROGRAM_NAMES[RenderColorMode.velocity];
        return programs[interpolated ? "compactInterpolated" : "compactPlain"];
    }

    _hasInterpolationFrame(count = null) {
        if (!this._nextParticles && !this._nextPositionFrame) {
            return false;
        }
        if (count === null) {
            return true;
        }
        if (this._nextPositionFrame) {
            return this._nextPositionFrame.length >= count * POSITION_ITEM_SIZE;
        }
        return getParticleCount(this._nextParticles) >= count;
    }

    _useInterpolationProgram(count = null) {
        // Keep the shader interpolation path active for the whole DFRI span.
        // The interpolation factor is allowed to be 0 on the first rendered
        // frame after a physics buffer switch; that should draw the current
        // frame through the interpolation shader, not temporarily fall back to
        // the non-interpolated program and make the stats flicker on/off.
        return this._hasInterpolationFrame(count);
    }

    _getGpuInterpolationStatus(count) {
        return this._hasInterpolationFrame(count) ? "on" : "off";
    }

    _ensureParticleBufferCapacity(count) {
        const minLength = count * ITEM_SIZE;
        if (!this._particleBufferData || this._particleBufferData.length < minLength) {
            this._particleBufferData = new Float32Array(minLength);
        }
        return this._particleBufferData;
    }

    _ensureNextPositionBufferCapacity(count) {
        if (!this._nextPositionBufferData || this._nextPositionBufferData.length < count * POSITION_ITEM_SIZE) {
            this._nextPositionBufferData = new Float32Array(count * POSITION_ITEM_SIZE);
        }
    }

    _ensureParticleColorBufferCapacity(count) {
        if (!this._particleColorBufferData || this._particleColorBufferData.length < count * COLOR_ITEM_SIZE) {
            this._particleColorBufferData = new Uint8Array(count * COLOR_ITEM_SIZE);
        }
    }

    _shouldScanMaxSpeed(now) {
        switch (this.settings.render.maxSpeedUpdateMode) {
            case MaxSpeedUpdateMode.off:
                return false;
            case MaxSpeedUpdateMode.throttle:
                return now - this._lastMaxSpeedScanTime >= MAX_SPEED_THROTTLE_INTERVAL_MS;
            case MaxSpeedUpdateMode.current:
            default:
                return true;
        }
    }

    _scanMaxSpeedFromBuffer(data, count, currentMaxSpeed) {
        let maxSpeed = currentMaxSpeed;
        for (let i = 0; i < count; i++) {
            const offset = i * ITEM_SIZE;
            const speed = Math.max(Math.abs(data[offset + 2]), Math.abs(data[offset + 3]));
            if (Number.isFinite(speed) && maxSpeed < speed) {
                maxSpeed = speed;
            }
        }
        return maxSpeed;
    }

    _fillUploadBuffer(particles, count, isBuffer, scanMaxSpeed, currentMaxSpeed) {
        const uploadData = this._ensureParticleBufferCapacity(count);
        const pos = {x: 0, y: 0};
        let maxSpeed = currentMaxSpeed;

        for (let i = 0; i < count; i++) {
            const offset = i * ITEM_SIZE;
            let velX, velY, mass;

            if (isBuffer) {
                pos.x = particles[offset];
                pos.y = particles[offset + 1];
                velX = particles[offset + 2];
                velY = particles[offset + 3];
                mass = particles[offset + 4];

                if (this.coordinateTransformer) {
                    this.coordinateTransformer(i, null, pos);
                }
            } else {
                const particle = particles[i];
                pos.x = particle.x;
                pos.y = particle.y;
                velX = particle.velX;
                velY = particle.velY;
                mass = particle.mass;

                if (this.coordinateTransformer) {
                    this.coordinateTransformer(i, particle, pos);
                }
            }

            uploadData[offset] = pos.x;
            uploadData[offset + 1] = pos.y;
            uploadData[offset + 2] = velX;
            uploadData[offset + 3] = velY;
            uploadData[offset + 4] = mass;

            if (scanMaxSpeed) {
                const speed = Math.max(Math.abs(velX), Math.abs(velY));
                if (Number.isFinite(speed) && maxSpeed < speed) {
                    maxSpeed = speed;
                }
            }
        }

        return maxSpeed;
    }

    get _fixedColorRgb() {
        const value = this.settings.render.fixedColor || "#cce6ff";
        const match = /^#([0-9a-f]{6})$/i.exec(value);
        const hex = match ? match[1] : "cce6ff";
        return [
            Number.parseInt(hex.slice(0, 2), 16) / 255,
            Number.parseInt(hex.slice(2, 4), 16) / 255,
            Number.parseInt(hex.slice(4, 6), 16) / 255,
        ];
    }

    _createRandomColorSeed() {
        if (globalThis.crypto?.getRandomValues) {
            const seed = new Uint32Array(1);
            globalThis.crypto.getRandomValues(seed);
            return seed[0] >>> 0;
        }
        return Math.floor(Math.random() * 0xffffffff) >>> 0;
    }

    _hashColorValue(index, channel) {
        let value = (index + this._randomColorSeed + Math.imul(channel + 1, 0x9e3779b9)) >>> 0;
        value ^= value >>> 16;
        value = Math.imul(value, 0x7feb352d) >>> 0;
        value ^= value >>> 15;
        value = Math.imul(value, 0x846ca68b) >>> 0;
        value ^= value >>> 16;
        return value & 0xff;
    }

    _ensureStaticParticleColors(data, count, mode, positionStride = ITEM_SIZE) {
        const state = this._staticColorState;
        if (!state || state.mode !== mode || state.count !== count || !state.generated) {
            this._ensureParticleColorBufferCapacity(count);
            if (mode === RenderColorMode.random) {
                this._bakeRandomParticleColors(count);
            } else {
                this._bakeClusterParticleColors(data, count, positionStride);
            }
            this._staticColorState = {mode, count, generated: true, uploaded: false};
        }

        if (!this._staticColorState.uploaded) {
            this._uploadArrayBuffer("particleColors", this._particleColorBufferData, count * COLOR_ITEM_SIZE);
            this._staticColorState.uploaded = true;
        }
    }

    _bakeRandomParticleColors(count) {
        const colors = this._particleColorBufferData;
        for (let i = 0; i < count; i++) {
            const offset = i * COLOR_ITEM_SIZE;
            colors[offset] = this._hashColorValue(i, 0);
            colors[offset + 1] = 64 + (this._hashColorValue(i, 1) & 63);
            colors[offset + 2] = this._hashColorValue(i, 2);
        }
    }

    _bakeClusterParticleColors(data, count, positionStride = ITEM_SIZE) {
        const colors = this._particleColorBufferData;
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;

        for (let i = 0; i < count; i++) {
            const offset = i * positionStride;
            const x = data[offset];
            const y = data[offset + 1];
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }

        const spanX = Math.max(1e-9, maxX - minX);
        const spanY = Math.max(1e-9, maxY - minY);
        for (let i = 0; i < count; i++) {
            const sourceOffset = i * positionStride;
            const colorOffset = i * COLOR_ITEM_SIZE;
            const nx = Math.max(0, Math.min(1, (data[sourceOffset] - minX) / spanX));
            const ny = Math.max(0, Math.min(1, (data[sourceOffset + 1] - minY) / spanY));
            const radial = Math.min(1, Math.hypot(nx - 0.5, ny - 0.5) * Math.SQRT2);
            colors[colorOffset] = Math.round(nx * 255);
            colors[colorOffset + 1] = Math.round(64 + (1 - radial) * 64);
            colors[colorOffset + 2] = Math.round(ny * 255);
        }
    }

    resetParticleColors() {
        this._staticColorState = {mode: null, count: 0, generated: false, uploaded: false};
        this._randomColorSeed = this._createRandomColorSeed();
    }

    _uploadCurrentBuffer(data, count, forceUpload = false) {
        const needsUpload = forceUpload || this._particleDataDirty ||
            this._uploadedParticleSource !== data || this._uploadedParticleCount !== count;
        if (!needsUpload) {
            return;
        }

        // The current frame is uploaded as the same interleaved layout the
        // worker produces: [x, y, vx, vy, mass]. Vertex attributes use stride
        // and offsets instead of CPU-side deinterleaving. This removes the
        // largest prepareData spike from the WebGL path.
        this._uploadArrayBuffer("particles", data, count * ITEM_SIZE);

        this._uploadedParticleSource = data;
        this._uploadedParticleCount = count;
        this._particleDataDirty = false;
    }

    _uploadNextPositionIfNeeded(count, trackRenderBytes = true) {
        const directPositions = this._nextPositionFrame;
        const data = directPositions || this._nextParticles;
        const availableCount = directPositions ? Math.floor(directPositions.length / POSITION_ITEM_SIZE) :
            (data ? getParticleCount(data) : 0);
        if (!data || availableCount < count) {
            return;
        }

        const needsUpload = this._nextParticlesDirty || this._uploadedNextParticleSource !== data ||
            this._uploadedNextParticleCount !== count;
        if (!needsUpload) {
            return;
        }

        let nextPosition;
        if (directPositions) {
            nextPosition = directPositions;
        } else {
            nextPosition = this._nextPositionBufferData;
            for (let i = 0; i < count; i++) {
                const srcOffset = i * ITEM_SIZE;
                const dstOffset = i * POSITION_ITEM_SIZE;
                nextPosition[dstOffset] = data[srcOffset];
                nextPosition[dstOffset + 1] = data[srcOffset + 1];
            }
        }

        this._uploadArrayBuffer("nextPosition", nextPosition, count * POSITION_ITEM_SIZE, trackRenderBytes);
        this._uploadedNextParticleSource = data;
        this._uploadedNextParticleCount = count;
        this._nextParticlesDirty = false;
    }

    _uploadArrayBuffer(name, data, length, trackRenderBytes = true) {
        const buffer = this._stateConfig[RENDER_BUFFER_PROGRAM].buffers[name];
        const view = data.length === length ? data : data.subarray(0, length);
        const byteLength = view.byteLength;
        if (byteLength === 0) {
            return;
        }

        const usageHint = this._stateConfig[RENDER_BUFFER_PROGRAM]._config.buffers[name]?.usageHint || GL.STREAM_DRAW;
        this.gl.bindBuffer(GL.ARRAY_BUFFER, buffer);

        switch (this.settings.render.bufferUploadMode) {
            case BufferUploadMode.bufferSubData: {
                const capacity = this._bufferCapacities.get(name) || 0;
                if (capacity < byteLength) {
                    this.gl.bufferData(GL.ARRAY_BUFFER, byteLength, usageHint);
                    this._bufferCapacities.set(name, byteLength);
                }
                this.gl.bufferSubData(GL.ARRAY_BUFFER, 0, view);
                break;
            }
            case BufferUploadMode.stream: {
                // Orphan the previous storage before writing. This gives the
                // driver a fresh backing store and avoids waiting for a buffer
                // still referenced by an in-flight draw.
                this.gl.bufferData(GL.ARRAY_BUFFER, byteLength, usageHint);
                this.gl.bufferSubData(GL.ARRAY_BUFFER, 0, view);
                this._bufferCapacities.set(name, byteLength);
                break;
            }
            case BufferUploadMode.bufferData:
            default:
                this.gl.bufferData(GL.ARRAY_BUFFER, view, usageHint);
                this._bufferCapacities.set(name, byteLength);
                break;
        }
        if (trackRenderBytes) {
            this._lastUploadedBytes += byteLength;
        } else {
            this._lastPreloadedBytes = (this._lastPreloadedBytes || 0) + byteLength;
        }
    }

    _loadUniformsForAllPrograms(values) {
        for (const colorMode of Object.values(RenderColorMode)) {
            const programs = PROGRAM_NAMES[colorMode];
            this._loadUniforms(programs.plain, values);
            this._loadUniforms(programs.interpolated, values);
            this._loadUniforms(programs.compactPlain, values);
            this._loadUniforms(programs.compactInterpolated, values);
        }
    }

    _loadUniforms(program, values) {
        const uniforms = [];
        if (values.resolution) uniforms.push({name: "resolution", values: values.resolution});
        if (values.point_size !== undefined) uniforms.push({name: "point_size", values: [values.point_size]});
        if (values.scale !== undefined) uniforms.push({name: "scale", values: [values.scale]});
        if (values.offset) uniforms.push({name: "offset", values: values.offset});
        if (values.max_mass !== undefined) uniforms.push({name: "max_mass", values: [values.max_mass]});
        if (values.max_speed !== undefined) uniforms.push({name: "max_speed", values: [values.max_speed]});
        if (values.particle_scale !== undefined) uniforms.push({name: "particle_scale", values: [values.particle_scale]});
        if (values.sprite_mode !== undefined) uniforms.push({name: "sprite_mode", values: [values.sprite_mode]});
        if (values.interpolation_factor !== undefined) {
            uniforms.push({name: "interpolation_factor", values: [values.interpolation_factor]});
        }
        if (values.filter_enabled !== undefined) {
            uniforms.push({name: "filter_enabled", values: [values.filter_enabled]});
        }
        if (values.hue_angle !== undefined) {
            uniforms.push({name: "hue_angle", values: [values.hue_angle]});
        }
        if (values.fixed_color) {
            uniforms.push({name: "fixed_color_uniform", values: values.fixed_color});
        }

        if (uniforms.length === 0) {
            return;
        }

        WebglUtils.loadDataFromConfig(this.gl, this._stateConfig, [{program, uniforms, buffers: []}]);
    }


    _updateShaderFilterState() {
        // CSS filters on a large WebGL canvas are applied by the browser
        // compositor after WebGL rendering and are not included in our GPU draw
        // query. Keep the effect inside the particle shader instead so frame
        // pacing is not dominated by a full-canvas CSS post-process.
        if (this.canvas.style.filter) {
            this.canvas.style.filter = null;
        }

        if (this.settings.render.enableFilter) {
            this._hueAngle = (this._hueAngle + 0.2) % 360;
        }
    }

    _applyBlendMode() {
        if (this.settings.render.enableBlending) {
            this.gl.enable(GL.BLEND);
            const sprite = this.settings.render.particleSprite || ParticleSpriteMode.point;
            this.gl.blendFunc(sprite === ParticleSpriteMode.point ? GL.SRC_COLOR : GL.SRC_ALPHA, GL.ONE);
        } else {
            this.gl.disable(GL.BLEND);
        }
    }

    _beginGpuTimer() {
        if (!this._gpuTimerExt || this._gpuTimerQuery) {
            return null;
        }

        const query = this.gl.createQuery();
        this.gl.beginQuery(this._gpuTimerExt.TIME_ELAPSED_EXT, query);
        this._gpuTimerQuery = query;
        this.stats.gpuTimerStatus = "pending";
        return query;
    }

    _endGpuTimer(query) {
        if (query && this._gpuTimerExt) {
            this.gl.endQuery(this._gpuTimerExt.TIME_ELAPSED_EXT);
        }
    }

    _pollGpuTimer() {
        const ext = this._gpuTimerExt;
        if (!ext) {
            this.stats.gpuTimerStatus = "unsupported";
            this.stats.gpuDrawTime = null;
            return;
        }

        const query = this._gpuTimerQuery;
        if (!query) {
            if (this.stats.gpuDrawTime === null) {
                this.stats.gpuTimerStatus = "waiting";
            }
            return;
        }

        const available = this.gl.getQueryParameter(query, GL.QUERY_RESULT_AVAILABLE);
        const disjoint = this.gl.getParameter(ext.GPU_DISJOINT_EXT);

        if (!available) {
            this.stats.gpuTimerStatus = "pending";
            return;
        }

        if (disjoint) {
            this.stats.gpuDrawTime = null;
            this.stats.gpuTimerStatus = "disjoint";
        } else {
            const elapsedNs = this.gl.getQueryParameter(query, GL.QUERY_RESULT);
            this.stats.gpuDrawTime = elapsedNs / 1_000_000;
            this.stats.gpuTimerStatus = "ok";
        }

        this.gl.deleteQuery(query);
        this._gpuTimerQuery = null;
    }

    getDebugDrawingContext() {
        return this.debugCtx;
    }

    _updateDebugCanvasSize() {
        if (this.debugCanvas) {
            this.debugCanvas.width = this.canvasWidth;
            this.debugCanvas.height = this.canvasHeight;
            this.debugCtx.lineWidth = this.dpr;
        }
    }

    _handleResize() {
        super._handleResize();
        this._updateDebugCanvasSize();

        this.gl.viewport(0, 0, this.canvasWidth, this.canvasHeight);
        this._loadUniformsForAllPrograms({
            point_size: this.dpr,
            resolution: [this.canvasWidth, this.canvasHeight]
        });
    }

    dispose() {
        this._stateConfig = null;
        this._particleBufferData = null;
        this._nextPositionBufferData = null;
        this._particleColorBufferData = null;
        this._staticColorState = null;
        this._nextParticles = null;
        this._nextPositionFrame = null;
        this._uploadedParticleSource = null;
        this._uploadedCurrentPositionSource = null;
        this._uploadedPreviousPositionSource = null;
        this._uploadedNextParticleSource = null;
        this._bufferCapacities = null;
        this._uploadQueue = null;
        if (this._uploadQueueTimer !== null) {
            if (this._uploadQueueTimerIsIdle && typeof window.cancelIdleCallback === "function") {
                window.cancelIdleCallback(this._uploadQueueTimer);
            } else {
                clearTimeout(this._uploadQueueTimer);
            }
            this._uploadQueueTimer = null;
            this._uploadQueueTimerIsIdle = false;
        }
        if (this._gpuTimerQuery) {
            this.gl.deleteQuery(this._gpuTimerQuery);
            this._gpuTimerQuery = null;
        }
        this._gpuTimerExt = null;

        if (this.debugCanvas) {
            this.debugCtx = null;
            this.debugCanvas.remove();

            this.debugCanvas = null;
        }

        super.dispose();
    }
}

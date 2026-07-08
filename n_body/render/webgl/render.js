import {RendererBase} from "../base.js";
import * as WebglUtils from "../../utils/webgl.js";
import {BufferUploadMode, MaxSpeedUpdateMode, RenderColorMode} from "../../settings/enum.js";
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
const RENDER_BUFFER_PROGRAM = "renderBuffers";
const PROGRAM_NAMES = {
    [RenderColorMode.velocity]: {
        plain: "renderVelocity",
        interpolated: "renderVelocityInterpolated"
    },
    [RenderColorMode.mass]: {
        plain: "renderMass",
        interpolated: "renderMassInterpolated"
    },
    [RenderColorMode.fixed]: {
        plain: "renderFixed",
        interpolated: "renderFixedInterpolated"
    }
};

function makeVertexShaderSource(colorMode, interpolated) {
    const defines = [
        `#define COLOR_MODE_${colorMode.toUpperCase()} 1`,
        `#define USE_INTERPOLATION ${interpolated ? 1 : 0}`
    ];
    return RenderVertexShaderSource.replace("#version 300 es", `#version 300 es\n${defines.join("\n")}`);
}

function makeProgramConfig(colorMode, interpolated) {
    const program = PROGRAM_NAMES[colorMode][interpolated ? "interpolated" : "plain"];
    const attributes = [{name: "position"}];
    const entries = [
        {name: "position", buffer: `${RENDER_BUFFER_PROGRAM}.position`, type: GL.FLOAT, size: 2}
    ];

    if (interpolated) {
        attributes.push({name: "next_position"});
        entries.push({name: "next_position", buffer: `${RENDER_BUFFER_PROGRAM}.nextPosition`, type: GL.FLOAT, size: 2});
    }

    if (colorMode === RenderColorMode.velocity) {
        attributes.push({name: "velocity"}, {name: "mass"});
        entries.push(
            {name: "velocity", buffer: `${RENDER_BUFFER_PROGRAM}.velocity`, type: GL.FLOAT, size: 2},
            {name: "mass", buffer: `${RENDER_BUFFER_PROGRAM}.mass`, type: GL.FLOAT, size: 1}
        );
    } else if (colorMode === RenderColorMode.mass) {
        attributes.push({name: "mass"});
        entries.push({name: "mass", buffer: `${RENDER_BUFFER_PROGRAM}.mass`, type: GL.FLOAT, size: 1});
    }

    return {
        program,
        vs: makeVertexShaderSource(colorMode, interpolated),
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
            {type: "uniform1f", name: "interpolation_factor"},
            {type: "uniform1f", name: "filter_enabled"},
            {type: "uniform1f", name: "hue_angle"},
        ],
        vertexArrays: [{name: "particle", entries}],
    };
}

const CONFIGURATION = [
    {
        program: RENDER_BUFFER_PROGRAM,
        internal: true,
        buffers: [
            {name: "position", usageHint: GL.STREAM_DRAW},
            {name: "nextPosition", usageHint: GL.STREAM_DRAW},
            {name: "velocity", usageHint: GL.STREAM_DRAW},
            {name: "mass", usageHint: GL.STATIC_DRAW},
        ]
    },
    makeProgramConfig(RenderColorMode.velocity, false),
    makeProgramConfig(RenderColorMode.velocity, true),
    makeProgramConfig(RenderColorMode.mass, false),
    makeProgramConfig(RenderColorMode.mass, true),
    makeProgramConfig(RenderColorMode.fixed, false),
    makeProgramConfig(RenderColorMode.fixed, true),
];

export class Webgl2Renderer extends RendererBase {
    /**
     * @param {HTMLCanvasElement} canvas
     * @param {AppSimulationSettings} settings
     */
    constructor(canvas, settings) {
        super(canvas, settings);

        this.gl = canvas.getContext("webgl2");
        this._stateConfig = {};

        this._gpuTimerExt = this.gl.getExtension("EXT_disjoint_timer_query_webgl2");
        this._gpuTimerQuery = null;
        this.stats.gpuTimerStatus = this._gpuTimerExt ? "waiting" : "unsupported";

        this._particleBufferData = new Float32Array(this.settings.physics.particleCount * ITEM_SIZE);
        this._positionBufferData = new Float32Array(this.settings.physics.particleCount * POSITION_ITEM_SIZE);
        this._velocityBufferData = new Float32Array(this.settings.physics.particleCount * VELOCITY_ITEM_SIZE);
        this._massBufferData = new Float32Array(this.settings.physics.particleCount * MASS_ITEM_SIZE);
        this._nextPositionBufferData = new Float32Array(this.settings.physics.particleCount * POSITION_ITEM_SIZE);

        this._maxSpeed = this.settings.physics.gravity / 100;
        this._lastMaxSpeedScanTime = 0;

        this._particleDataDirty = true;
        this._uploadedParticleSource = null;
        this._uploadedParticleCount = 0;
        this._massBufferInitialized = false;
        this._uploadedMassCount = 0;

        this._nextParticles = null;
        this._nextParticlesDirty = true;
        this._uploadedNextParticleSource = null;
        this._uploadedNextParticleCount = 0;
        this._interpolationFactor = 0;

        this._bufferCapacities = new Map();
        this._lastUploadedBytes = 0;

        this.initWebgl();
        if (this.settings.common.debug) {
            this.initDebugCanvas();
        }
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
            interpolation_factor: 0,
            filter_enabled: 0,
            hue_angle: 0,
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

        this._loadUniformsForAllPrograms({
            max_mass: this.settings.physics.particleMass + 1
        });
        this._applyBlendMode();
        this.markParticlesDirty();
    }

    reset() {
        super.reset();
        this._maxSpeed = this.settings.physics.gravity / 100;
        this._lastMaxSpeedScanTime = 0;
        this._massBufferInitialized = false;
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

    /**
     * DFRI supplies only the next physics frame. The renderer extracts x/y into
     * a compact next-position buffer, so the GPU interpolation path does not
     * upload velocity or mass for the ahead frame.
     */
    setInterpolationFrame(particles) {
        if (particles && isParticleBuffer(particles)) {
            this._nextParticles = particles;
        } else {
            this._nextParticles = null;
        }
        this._nextParticlesDirty = true;
    }

    setInterpolationFactor(factor) {
        const value = Number.isFinite(factor) ? Math.max(0, Math.min(1, factor)) : 0;
        this._interpolationFactor = this._nextParticles ? value : 0;
    }

    markParticlesDirty() {
        this._particleDataDirty = true;
    }

    render(particles) {
        const renderStart = performance.now();
        this._updateShaderFilterState();

        this.debugCtx?.clearRect(0, 0, this.canvasWidth, this.canvasHeight);
        const {count, prepareDataTime, uploadTime, programName} = this._updateData(particles)

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
        this.stats.uploadMode = this.settings.render.bufferUploadMode;
        this.stats.uploadedBytes = this._lastUploadedBytes;
        this.stats.gpuInterpolation = this._useInterpolationProgram() ? "on" : "off";
        this.stats.filterMode = this.settings.render.enableFilter ? "shader" : "off";
    }

    _updateData(particles) {
        this._lastUploadedBytes = 0;
        const prepareStart = performance.now();
        const isBuffer = isParticleBuffer(particles);
        const count = getParticleCount(particles);
        const colorMode = this._colorMode;
        const needsVelocity = colorMode === RenderColorMode.velocity;
        const needsMass = colorMode === RenderColorMode.velocity || colorMode === RenderColorMode.mass;
        const scanMaxSpeed = needsVelocity && this._shouldScanMaxSpeed(prepareStart);
        const canUseSourceDirectly = isBuffer && !this.coordinateTransformer;
        const sourceData = canUseSourceDirectly ? particles : this._ensureParticleBufferCapacity(count);
        let maxSpeed = this._maxSpeed;

        this._ensureSplitBufferCapacity(count);

        const needsCurrentPrepare = !canUseSourceDirectly || this._particleDataDirty ||
            this._uploadedParticleSource !== sourceData || this._uploadedParticleCount !== count;

        if (!canUseSourceDirectly) {
            maxSpeed = this._fillUploadBuffer(particles, count, isBuffer, scanMaxSpeed, maxSpeed);
        }

        if (needsCurrentPrepare) {
            maxSpeed = this._fillCurrentSplitBuffers(sourceData, count, scanMaxSpeed, maxSpeed, needsVelocity, needsMass);
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
        const interpolationEnabled = this._useInterpolationProgram();
        const programName = this._getProgramName(colorMode, interpolationEnabled);

        this._loadUniforms(programName, {
            scale: this.scale,
            max_speed: this._maxSpeed,
            offset: [this.xOffset, this.yOffset],
            particle_scale: particleScale,
            interpolation_factor: interpolationEnabled ? this._interpolationFactor : 0,
            filter_enabled: this.settings.render.enableFilter ? 1 : 0,
            hue_angle: this.settings.render.enableFilter ? this._hueAngle * Math.PI / 180 : 0,
        });

        const prepareDataTime = performance.now() - prepareStart;
        const uploadStart = performance.now();
        this._uploadCurrentBuffers(sourceData, count, needsVelocity, needsMass, needsCurrentPrepare);
        if (interpolationEnabled) {
            this._uploadNextPositionIfNeeded(count);
        }
        const uploadTime = performance.now() - uploadStart;

        return {count, prepareDataTime, uploadTime, programName};
    }

    get _colorMode() {
        return this.settings.render.colorMode || RenderColorMode.velocity;
    }

    _getProgramName(colorMode = this._colorMode, interpolated = this._useInterpolationProgram()) {
        const programs = PROGRAM_NAMES[colorMode] || PROGRAM_NAMES[RenderColorMode.velocity];
        return programs[interpolated ? "interpolated" : "plain"];
    }

    _useInterpolationProgram() {
        return !!this._nextParticles && this._interpolationFactor > 0;
    }

    _ensureParticleBufferCapacity(count) {
        const minLength = count * ITEM_SIZE;
        if (!this._particleBufferData || this._particleBufferData.length < minLength) {
            this._particleBufferData = new Float32Array(minLength);
        }
        return this._particleBufferData;
    }

    _ensureSplitBufferCapacity(count) {
        if (!this._positionBufferData || this._positionBufferData.length < count * POSITION_ITEM_SIZE) {
            this._positionBufferData = new Float32Array(count * POSITION_ITEM_SIZE);
        }
        if (!this._velocityBufferData || this._velocityBufferData.length < count * VELOCITY_ITEM_SIZE) {
            this._velocityBufferData = new Float32Array(count * VELOCITY_ITEM_SIZE);
        }
        if (!this._massBufferData || this._massBufferData.length < count * MASS_ITEM_SIZE) {
            this._massBufferData = new Float32Array(count * MASS_ITEM_SIZE);
            this._massBufferInitialized = false;
        }
        if (!this._nextPositionBufferData || this._nextPositionBufferData.length < count * POSITION_ITEM_SIZE) {
            this._nextPositionBufferData = new Float32Array(count * POSITION_ITEM_SIZE);
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

    _fillCurrentSplitBuffers(data, count, scanMaxSpeed, currentMaxSpeed, needsVelocity, needsMass) {
        let maxSpeed = currentMaxSpeed;
        const position = this._positionBufferData;
        const velocity = this._velocityBufferData;
        const mass = this._massBufferData;
        const shouldRefreshMass = needsMass && (!this._massBufferInitialized || this._uploadedMassCount !== count);

        // Deinterleave only the attributes used by the selected shader variant.
        // This costs one CPU pass when a physics frame changes, but it avoids
        // uploading unused velocity/mass data and lets DFRI upload x/y only.
        for (let i = 0; i < count; i++) {
            const srcOffset = i * ITEM_SIZE;
            const posOffset = i * POSITION_ITEM_SIZE;
            position[posOffset] = data[srcOffset];
            position[posOffset + 1] = data[srcOffset + 1];

            if (needsVelocity || scanMaxSpeed) {
                const velX = data[srcOffset + 2];
                const velY = data[srcOffset + 3];
                if (needsVelocity) {
                    const velOffset = i * VELOCITY_ITEM_SIZE;
                    velocity[velOffset] = velX;
                    velocity[velOffset + 1] = velY;
                }
                if (scanMaxSpeed) {
                    const speed = Math.max(Math.abs(velX), Math.abs(velY));
                    if (Number.isFinite(speed) && maxSpeed < speed) {
                        maxSpeed = speed;
                    }
                }
            }

            if (shouldRefreshMass) {
                mass[i] = data[srcOffset + 4];
            }
        }

        if (shouldRefreshMass) {
            this._massBufferInitialized = false;
        }

        return maxSpeed;
    }

    _uploadCurrentBuffers(data, count, needsVelocity, needsMass, forceUpload = false) {
        const needsUpload = forceUpload || this._particleDataDirty ||
            this._uploadedParticleSource !== data || this._uploadedParticleCount !== count;
        if (!needsUpload) {
            return;
        }

        this._uploadArrayBuffer("position", this._positionBufferData, count * POSITION_ITEM_SIZE);
        if (needsVelocity) {
            this._uploadArrayBuffer("velocity", this._velocityBufferData, count * VELOCITY_ITEM_SIZE);
        }
        if (needsMass && (!this._massBufferInitialized || this._uploadedMassCount !== count)) {
            this._uploadArrayBuffer("mass", this._massBufferData, count * MASS_ITEM_SIZE);
            this._massBufferInitialized = true;
            this._uploadedMassCount = count;
        }

        this._uploadedParticleSource = data;
        this._uploadedParticleCount = count;
        this._particleDataDirty = false;
    }

    _uploadNextPositionIfNeeded(count) {
        const data = this._nextParticles;
        if (!data || getParticleCount(data) < count) {
            return;
        }

        const needsUpload = this._nextParticlesDirty || this._uploadedNextParticleSource !== data ||
            this._uploadedNextParticleCount !== count;
        if (!needsUpload) {
            return;
        }

        const nextPosition = this._nextPositionBufferData;
        for (let i = 0; i < count; i++) {
            const srcOffset = i * ITEM_SIZE;
            const dstOffset = i * POSITION_ITEM_SIZE;
            nextPosition[dstOffset] = data[srcOffset];
            nextPosition[dstOffset + 1] = data[srcOffset + 1];
        }

        this._uploadArrayBuffer("nextPosition", nextPosition, count * POSITION_ITEM_SIZE);
        this._uploadedNextParticleSource = data;
        this._uploadedNextParticleCount = count;
        this._nextParticlesDirty = false;
    }

    _uploadArrayBuffer(name, data, length) {
        const buffer = this._stateConfig[RENDER_BUFFER_PROGRAM].buffers[name];
        const view = data.length === length ? data : data.subarray(0, length);
        const byteLength = view.byteLength;
        if (byteLength === 0) {
            return;
        }

        const usageHint = this._stateConfig[RENDER_BUFFER_PROGRAM]._config.buffers[name]?.usageHint || GL.STREAM_DRAW;
        this.gl.bindBuffer(GL.ARRAY_BUFFER, buffer);
        if (this.settings.render.bufferUploadMode === BufferUploadMode.bufferSubData) {
            const capacity = this._bufferCapacities.get(name) || 0;
            if (capacity < byteLength) {
                this.gl.bufferData(GL.ARRAY_BUFFER, byteLength, usageHint);
                this._bufferCapacities.set(name, byteLength);
            }
            this.gl.bufferSubData(GL.ARRAY_BUFFER, 0, view);
        } else {
            this.gl.bufferData(GL.ARRAY_BUFFER, view, usageHint);
            this._bufferCapacities.set(name, byteLength);
        }
        this._lastUploadedBytes += byteLength;
    }

    _loadUniformsForAllPrograms(values) {
        for (const colorMode of Object.values(RenderColorMode)) {
            this._loadUniforms(PROGRAM_NAMES[colorMode].plain, values);
            this._loadUniforms(PROGRAM_NAMES[colorMode].interpolated, values);
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
        if (values.interpolation_factor !== undefined) {
            uniforms.push({name: "interpolation_factor", values: [values.interpolation_factor]});
        }
        if (values.filter_enabled !== undefined) {
            uniforms.push({name: "filter_enabled", values: [values.filter_enabled]});
        }
        if (values.hue_angle !== undefined) {
            uniforms.push({name: "hue_angle", values: [values.hue_angle]});
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
            this.gl.blendFunc(GL.SRC_COLOR, GL.ONE);
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
        this._positionBufferData = null;
        this._velocityBufferData = null;
        this._massBufferData = null;
        this._nextPositionBufferData = null;
        this._nextParticles = null;
        this._uploadedParticleSource = null;
        this._uploadedNextParticleSource = null;
        this._bufferCapacities = null;
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

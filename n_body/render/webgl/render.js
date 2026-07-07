import {RendererBase} from "../base.js";
import * as WebglUtils from "../../utils/webgl.js";
import {MaxSpeedUpdateMode} from "../../settings/enum.js";
import {ITEM_SIZE, getParticleCount, isParticleBuffer} from "../../utils/particles.js";

const RenderVertexShaderSource = await fetch(new URL("./shaders/render_vs.glsl", import.meta.url))
    .then(r => r.text());
const RenderFragmentShaderSource = await fetch(new URL("./shaders/render_fs.glsl", import.meta.url))
    .then(r => r.text());

const GL = WebGL2RenderingContext;
const PARTICLE_STRIDE = ITEM_SIZE * Float32Array.BYTES_PER_ELEMENT;
const MAX_SPEED_THROTTLE_INTERVAL_MS = 250;
const CONFIGURATION = [
    {
        program: "render",
        vs: RenderVertexShaderSource,
        fs: RenderFragmentShaderSource,
        attributes: [
            {name: "position"},
            {name: "next_position"},
            {name: "velocity"},
            {name: "mass"}
        ],
        buffers: [
            {name: "particles", usageHint: GL.STREAM_DRAW},
            {name: "nextParticles", usageHint: GL.STREAM_DRAW}
        ],
        uniforms: [
            {type: "uniform2f", name: "resolution"},
            {type: "uniform1f", name: "point_size"},
            {type: "uniform1f", name: "scale"},
            {type: "uniform2f", name: "offset"},
            {type: "uniform1f", name: "max_mass"},
            {type: "uniform1f", name: "max_speed"},
            {type: "uniform1f", name: "particle_scale"},
            {type: "uniform1f", name: "interpolation_factor"},
        ],
        vertexArrays: [{
            name: "particle", entries: [
                {name: "position", buffer: "particles", type: GL.FLOAT, size: 2, stride: PARTICLE_STRIDE, offset: 0},
                {name: "next_position", buffer: "nextParticles", type: GL.FLOAT, size: 2, stride: PARTICLE_STRIDE, offset: 0},
                {name: "velocity", buffer: "particles", type: GL.FLOAT, size: 2, stride: PARTICLE_STRIDE, offset: 2 * Float32Array.BYTES_PER_ELEMENT},
                {name: "mass", buffer: "particles", type: GL.FLOAT, size: 1, stride: PARTICLE_STRIDE, offset: 4 * Float32Array.BYTES_PER_ELEMENT},
            ]
        }],
    }
]

export class Webgl2Renderer extends RendererBase {
    /**
     * @param {HTMLCanvasElement} canvas
     * @param {AppSimulationSettings} settings
     */
    constructor(canvas, settings) {
        super(canvas, settings);

        this.gl = canvas.getContext("webgl2");
        this._stateConfig = {};

        this._particleBufferData = new Float32Array(this.settings.physics.particleCount * ITEM_SIZE);
        this._maxSpeed = this.settings.physics.gravity / 100;
        this._lastMaxSpeedScanTime = 0;

        this._particleDataDirty = true;
        this._uploadedParticleSource = null;
        this._uploadedParticleCount = 0;

        this._nextParticles = null;
        this._nextParticlesDirty = true;
        this._uploadedNextParticleSource = null;
        this._uploadedNextParticleCount = 0;
        this._nextBufferInitialized = false;
        this._interpolationFactor = 0;

        this.initWebgl();
        if (this.settings.common.debug) {
            this.initDebugCanvas();
        }
    }

    initWebgl() {
        WebglUtils.createFromConfig(this.gl, CONFIGURATION, this._stateConfig);

        WebglUtils.loadDataFromConfig(this.gl, this._stateConfig, [{
            program: "render",
            uniforms: [
                {name: "point_size", values: [this.dpr]},
                {name: "max_mass", values: [this.settings.physics.particleMass + 1]},
                {name: "max_speed", values: [this._maxSpeed]},
                {name: "scale", values: [this.scale]},
                {name: "offset", values: [this.xOffset, this.yOffset]},
                {name: "resolution", values: [this.canvasWidth, this.canvasHeight]},
                {name: "particle_scale", values: [this.settings.render.particleSizeScale]},
                {name: "interpolation_factor", values: [0]}],
            buffers: []
        }]);

        this.gl.viewport(0, 0, this.canvasWidth, this.canvasHeight);
        this.gl.clearColor(0, 0, 0, 1);
        this.gl.clear(this.gl.COLOR_BUFFER_BIT);

        if (this.settings.render.enableBlending) {
            this.gl.enable(GL.BLEND);
            this.gl.blendFunc(GL.SRC_COLOR, GL.ONE);
        }
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

        WebglUtils.loadDataFromConfig(this.gl, this._stateConfig, [{
            program: "render",
            uniforms: [
                {name: "max_mass", values: [this.settings.physics.particleMass + 1]}
            ]
        }]);

        if (this.settings.render.enableBlending) {
            this.gl.enable(GL.BLEND);
            this.gl.blendFunc(GL.SRC_COLOR, GL.ONE);
        } else {
            this.gl.disable(GL.BLEND);
        }
    }

    reset() {
        super.reset();
        this._maxSpeed = this.settings.physics.gravity / 100;
        this._lastMaxSpeedScanTime = 0;
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
     * DFRI supplies the next worker frame here. The renderer uploads it only
     * when the buffer reference changes; intermediate render frames only update
     * interpolation_factor, so DFRI no longer requires a CPU pass over particles.
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
        super.render(particles);

        this.debugCtx?.clearRect(0, 0, this.canvasWidth, this.canvasHeight);
        const {count, prepareDataTime, uploadTime} = this._updateData(particles)

        const drawStart = performance.now();
        this.gl.clear(this.gl.COLOR_BUFFER_BIT);
        this.gl.useProgram(this._stateConfig.render.program);
        this.gl.bindVertexArray(this._stateConfig.render.vertexArrays["particle"]);
        this.gl.drawArrays(this.gl.POINTS, 0, count);
        const drawTime = performance.now() - drawStart;

        this.stats.prepareDataTime = prepareDataTime;
        this.stats.uploadTime = uploadTime;
        this.stats.drawTime = drawTime;
        this.stats.renderTime = performance.now() - renderStart;
    }

    _updateData(particles) {
        const prepareStart = performance.now();
        const isBuffer = isParticleBuffer(particles);
        const count = getParticleCount(particles);
        const scanMaxSpeed = this._shouldScanMaxSpeed(prepareStart);
        const canUploadDirectly = isBuffer && !this.coordinateTransformer;
        const uploadData = canUploadDirectly ? particles : this._ensureParticleBufferCapacity(count);
        let maxSpeed = this._maxSpeed;

        // Fast path for the common WebGL case: the renderer receives the flat
        // worker buffer directly, DFRI is handled in the shader, and color
        // normalization is not scanned every frame. No per-particle CPU loop is
        // needed before the upload/draw.
        if (canUploadDirectly && scanMaxSpeed) {
            maxSpeed = this._scanMaxSpeedFromBuffer(particles, count, maxSpeed);
        } else if (!canUploadDirectly) {
            maxSpeed = this._fillUploadBuffer(particles, count, isBuffer, scanMaxSpeed, maxSpeed);
        }

        if (scanMaxSpeed) {
            this._maxSpeed = maxSpeed;
            this._lastMaxSpeedScanTime = prepareStart;
        }

        const particleScale = this.settings.render.fixedParticleSize ?
            this.settings.render.particleSizeScale :
            this.settings.render.particleSizeScale * this.scale;

        WebglUtils.loadDataFromConfig(this.gl, this._stateConfig, [
            {
                program: "render", uniforms: [
                    {name: "scale", values: [this.scale]},
                    {name: "max_speed", values: [this._maxSpeed]},
                    {name: "offset", values: [this.xOffset, this.yOffset]},
                    {name: "particle_scale", values: [particleScale]},
                    {name: "interpolation_factor", values: [this._interpolationFactor]}
                ], buffers: []
            }
        ])

        const prepareDataTime = performance.now() - prepareStart;
        const uploadStart = performance.now();
        this._uploadCurrentParticles(uploadData, count, !canUploadDirectly);
        this._uploadNextParticlesIfNeeded(uploadData, count);
        const uploadTime = performance.now() - uploadStart;

        return {count, prepareDataTime, uploadTime};
    }

    _ensureParticleBufferCapacity(count) {
        const minLength = count * ITEM_SIZE;
        if (!this._particleBufferData || this._particleBufferData.length < minLength) {
            this._particleBufferData = new Float32Array(minLength);
        }
        return this._particleBufferData;
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

    _scanMaxSpeedFromBuffer(particles, count, currentMaxSpeed) {
        let maxSpeed = currentMaxSpeed;
        for (let i = 0; i < count; i++) {
            const offset = i * ITEM_SIZE;
            const speed = Math.max(Math.abs(particles[offset + 2]), Math.abs(particles[offset + 3]));
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

    _uploadCurrentParticles(data, count, forceUpload = false) {
        const needsUpload = forceUpload || this._particleDataDirty ||
            this._uploadedParticleSource !== data || this._uploadedParticleCount !== count;
        if (!needsUpload) {
            return;
        }

        this._uploadParticleBuffer("particles", data, count);
        this._uploadedParticleSource = data;
        this._uploadedParticleCount = count;
        this._particleDataDirty = false;
    }

    _uploadNextParticlesIfNeeded(currentData, count) {
        let data = this._nextParticles;
        let forceUpload = this._nextParticlesDirty;

        if (!data) {
            // The next_position attribute must always have a valid buffer for
            // the draw range. When DFRI has no ahead frame, mirror the current
            // buffer once and keep interpolation_factor at zero.
            data = currentData;
            forceUpload = forceUpload || !this._nextBufferInitialized;
        }

        const nextCount = getParticleCount(data);
        if (nextCount < count) {
            data = currentData;
            forceUpload = true;
        }
        const drawCount = count;
        const needsUpload = forceUpload || this._uploadedNextParticleSource !== data ||
            this._uploadedNextParticleCount !== drawCount;

        if (!needsUpload) {
            return;
        }

        this._uploadParticleBuffer("nextParticles", data, drawCount);
        this._uploadedNextParticleSource = data;
        this._uploadedNextParticleCount = drawCount;
        this._nextParticlesDirty = false;
        this._nextBufferInitialized = true;
    }

    _uploadParticleBuffer(name, data, count) {
        const buffer = this._stateConfig.render.buffers[name];
        const length = Math.min(data.length, count * ITEM_SIZE);
        const view = length === data.length ? data : data.subarray(0, length);

        this.gl.bindBuffer(GL.ARRAY_BUFFER, buffer);
        this.gl.bufferData(GL.ARRAY_BUFFER, view, GL.STREAM_DRAW);
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
        WebglUtils.loadDataFromConfig(this.gl, this._stateConfig, [{
            program: "render",
            uniforms: [
                {name: "point_size", values: [this.dpr]},
                {name: "resolution", values: [this.canvasWidth, this.canvasHeight]}],
            buffers: []
        }]);
    }

    dispose() {
        this._stateConfig = null;
        this._particleBufferData = null;
        this._nextParticles = null;
        this._uploadedParticleSource = null;
        this._uploadedNextParticleSource = null;

        if (this.debugCanvas) {
            this.debugCtx = null;
            this.debugCanvas.remove();

            this.debugCanvas = null;
        }

        super.dispose();
    }
}

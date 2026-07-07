import {RendererBase} from "../base.js";
import * as WebglUtils from "../../utils/webgl.js";
import {ITEM_SIZE, getParticleCount, isParticleBuffer} from "../../utils/particles.js";

const RenderVertexShaderSource = await fetch(new URL("./shaders/render_vs.glsl", import.meta.url))
    .then(r => r.text());
const RenderFragmentShaderSource = await fetch(new URL("./shaders/render_fs.glsl", import.meta.url))
    .then(r => r.text());

const GL = WebGL2RenderingContext;
const CONFIGURATION = [
    {
        program: "render",
        vs: RenderVertexShaderSource,
        fs: RenderFragmentShaderSource,
        attributes: [
            {name: "position"},
            {name: "velocity"},
            {name: "mass"}
        ],
        buffers: [
            {name: "particles", usageHint: GL.STREAM_DRAW}
        ],
        uniforms: [
            {type: "uniform2f", name: "resolution"},
            {type: "uniform1f", name: "point_size"},
            {type: "uniform1f", name: "scale"},
            {type: "uniform2f", name: "offset"},
            {type: "uniform1f", name: "max_mass"},
            {type: "uniform1f", name: "max_speed"},
            {type: "uniform1f", name: "particle_scale"},
        ],
        vertexArrays: [{
            name: "particle", entries: [
                {name: "position", buffer: "particles", type: GL.FLOAT, size: 2, stride: ITEM_SIZE * Float32Array.BYTES_PER_ELEMENT, offset: 0},
                {name: "velocity", buffer: "particles", type: GL.FLOAT, size: 2, stride: ITEM_SIZE * Float32Array.BYTES_PER_ELEMENT, offset: 2 * Float32Array.BYTES_PER_ELEMENT},
                {name: "mass", buffer: "particles", type: GL.FLOAT, size: 1, stride: ITEM_SIZE * Float32Array.BYTES_PER_ELEMENT, offset: 4 * Float32Array.BYTES_PER_ELEMENT},
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
                {name: "particle_scale", values: [this.settings.render.particleSizeScale]}],
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
    }

    clear() {
        super.clear();

        this.gl.clear(this.gl.COLOR_BUFFER_BIT);
        this.debugCtx?.clearRect(0, 0, this.canvasWidth, this.canvasHeight);
    }

    render(particles) {
        const t = performance.now();
        super.render(particles);

        this.debugCtx?.clearRect(0, 0, this.canvasWidth, this.canvasHeight);
        const count = this._updateData(particles)

        this.gl.clear(this.gl.COLOR_BUFFER_BIT);
        this.gl.useProgram(this._stateConfig.render.program);
        this.gl.bindVertexArray(this._stateConfig.render.vertexArrays["particle"]);
        this.gl.drawArrays(this.gl.POINTS, 0, count);

        this.stats.renderTime = performance.now() - t;
    }

    _updateData(particles) {
        const isBuffer = isParticleBuffer(particles);
        const count = getParticleCount(particles);
        const canUploadDirectly = isBuffer && !this.coordinateTransformer;
        const uploadData = canUploadDirectly ? particles : this._particleBufferData;
        const pos = {x: 0, y: 0};

        for (let i = 0; i < count; i++) {
            const offset = i * ITEM_SIZE;
            let velX, velY;

            if (isBuffer) {
                velX = particles[offset + 2];
                velY = particles[offset + 3];

                if (!canUploadDirectly) {
                    pos.x = particles[offset];
                    pos.y = particles[offset + 1];
                    if (this.coordinateTransformer) {
                        this.coordinateTransformer(i, null, pos);
                    }

                    uploadData[offset] = pos.x;
                    uploadData[offset + 1] = pos.y;
                    uploadData[offset + 2] = velX;
                    uploadData[offset + 3] = velY;
                    uploadData[offset + 4] = particles[offset + 4];
                }
            } else {
                const particle = particles[i];
                velX = particle.velX;
                velY = particle.velY;

                pos.x = particle.x;
                pos.y = particle.y;
                if (this.coordinateTransformer) {
                    this.coordinateTransformer(i, particle, pos);
                }

                uploadData[offset] = pos.x;
                uploadData[offset + 1] = pos.y;
                uploadData[offset + 2] = velX;
                uploadData[offset + 3] = velY;
                uploadData[offset + 4] = particle.mass;
            }

            const speed = Math.max(Math.abs(velX), Math.abs(velY));
            if (Number.isFinite(speed) && this._maxSpeed < speed) {
                this._maxSpeed = speed;
            }
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
                    {name: "particle_scale", values: [particleScale]}
                ], buffers: [
                    {name: "particles", data: uploadData},
                ]
            }
        ])

        return count;
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

        if (this.debugCanvas) {
            this.debugCtx = null;
            this.debugCanvas.remove();

            this.debugCanvas = null;
        }

        super.dispose();
    }
}
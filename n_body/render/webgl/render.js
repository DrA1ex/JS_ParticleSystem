import {RendererBase} from "../base.js";
import * as WebglUtils from "../../utils/webgl.js";

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
            {name: "position", usageHint: GL.STREAM_DRAW},
            {name: "velocity", usageHint: GL.STREAM_DRAW},
            {name: "mass", usageHint: GL.STREAM_DRAW}
        ],
        uniforms: [
            {type: "uniform2f", name: "resolution"},
            {type: "uniform1f", name: "point_size"},
            {type: "uniform1f", name: "scale"},
            {type: "uniform2f", name: "offset"},
            {type: "uniform1f", name: "max_mass"},
            {type: "uniform1f", name: "max_speed"},
        ],
        vertexArrays: [{
            name: "particle", entries: [
                {name: "position", type: GL.FLOAT, size: 2},
                {name: "velocity", type: GL.FLOAT, size: 2},
                {name: "mass", type: GL.FLOAT, size: 1},
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

        this._positionBufferData = new Float32Array(this.settings.physics.particleCount * 2);
        this._velocityBufferData = new Float32Array(this.settings.physics.particleCount * 2);
        this._massBufferData = new Float32Array(this.settings.physics.particleCount);
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
                {name: "resolution", values: [this.canvasWidth, this.canvasHeight]}],
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
        const debugCanvas = document.createElement("canvas");

        debugCanvas.style.position = "absolute";
        debugCanvas.style.top = "0";
        debugCanvas.style.left = "0";
        debugCanvas.style.width = "100%"
        debugCanvas.style.height = "100%"
        debugCanvas.style.pointerEvents = "none";

        document.body.appendChild(debugCanvas);

        this.debugCanvas = debugCanvas;
        this.debugCtx = this.debugCanvas.getContext("2d");
        this._updateDebugCanvasSize();
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
        this._updateData(particles)

        this.gl.clear(this.gl.COLOR_BUFFER_BIT);
        this.gl.useProgram(this._stateConfig.render.program);
        this.gl.bindVertexArray(this._stateConfig.render.vertexArrays["particle"]);
        this.gl.drawArrays(this.gl.POINTS, 0, this.settings.physics.particleCount);

        this.stats.renderTime = performance.now() - t;
    }

    _updateData(particles) {
        const pos = {x: 0, y: 0};
        for (let i = 0; i < particles.length; i++) {
            const particle = particles[i];
            pos.x = particle.x;
            pos.y = particle.y;

            if (this.coordinateTransformer) {
                this.coordinateTransformer(i, particle, pos);
            }

            this._positionBufferData[i * 2] = pos.x;
            this._positionBufferData[i * 2 + 1] = pos.y;

            this._velocityBufferData[i * 2] = particle.velX;
            this._velocityBufferData[i * 2 + 1] = particle.velY;
            this._massBufferData[i] = particle.mass;

            const speed = Math.max(Math.abs(particle.velX), Math.abs(particle.velY));
            if (Number.isFinite(speed) && this._maxSpeed < speed) {
                this._maxSpeed = speed;
            }
        }

        WebglUtils.loadDataFromConfig(this.gl, this._stateConfig, [
            {
                program: "render", uniforms: [
                    {name: "scale", values: [this.scale]},
                    {name: "max_speed", values: [this._maxSpeed]},
                    {name: "offset", values: [this.xOffset, this.yOffset]}
                ], buffers: [
                    {name: "position", data: this._positionBufferData},
                    {name: "velocity", data: this._velocityBufferData},
                    {name: "mass", data: this._massBufferData},
                ]
            }
        ])
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
        this._positionBufferData = null;
        this._velocityBufferData = null;
        this._massBufferData = null;

        if (this.debugCanvas) {
            this.debugCtx = null;
            this.debugCanvas.remove();

            this.debugCanvas = null;
        }

        super.dispose();
    }
}
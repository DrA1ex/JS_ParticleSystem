import {RendererBase} from "../base.js";
import * as WebglUtils from "../../utils/webgl.js";

const RenderVertexShaderSource = await fetch("./render/webgl/shaders/render_vs.glsl").then(r => r.text());
const RenderFragmentShaderSource = await fetch("./render/webgl/shaders/render_fs.glsl").then(r => r.text());

const GL = WebGL2RenderingContext;
const CONFIGURATION = [
    {
        program: "render",
        vs: RenderVertexShaderSource,
        fs: RenderFragmentShaderSource,
        attributes: [
            {name: "position", buffer: true},
            {name: "velocity", buffer: true},
            {name: "mass", buffer: true}
        ],
        uniforms: [
            {name: "resolution"}, {name: "point_size"}, {name: "offset"}, {name: "scale"},
            {name: "max_mass"}, {name: "max_speed"},
        ],
        vertexArrays: [{
            name: "particle", entries: [
                {name: "position", type: GL.FLOAT, size: 2},
                {name: "velocity", type: GL.FLOAT, size: 2},
                {name: "mass", type: GL.FLOAT, size: 1},
            ]
        }],
        transformFeedbacks: []
    }
]

export class Webgl2Renderer extends RendererBase {
    /**
     * @param {HTMLCanvasElement} canvas
     * @param {Settings} settings
     */
    constructor(canvas, settings) {
        super(canvas, settings);

        this.gl = canvas.getContext("webgl2", {alpha: false});
        this._stateConfig = {};

        this._positionBufferData = new Float32Array(this.settings.particleCount * 2);
        this._velocityBufferData = new Float32Array(this.settings.particleCount * 2);
        this._massBufferData = new Float32Array(this.settings.particleCount);
        this._maxSpeed = this.settings.gravity / 100;

        this.initWebgl();
        if (this.settings.debug) {
            this.initDebugCanvas();
        }
    }

    initWebgl() {
        WebglUtils.createFromConfig(this.gl, CONFIGURATION, this._stateConfig);

        WebglUtils.loadDataFromConfig(this.gl, [{
            program: "render",
            uniforms: [{
                type: "uniform1f", name: "point_size",
                values: [this.dpr]
            }, {
                type: "uniform1f", name: "max_mass",
                values: [this.settings.particleMass + 1]
            }, {
                type: "uniform1f", name: "max_speed",
                values: [this._maxSpeed]
            }, {
                type: "uniform1f", name: "scale",
                values: [this.scale]
            }, {
                type: "uniform2f", name: "offset",
                values: [this.xOffset, this.yOffset]
            }, {
                type: "uniform2f", name: "resolution",
                values: [this.canvasWidth, this.canvasHeight]
            }],
            buffers: []
        }], this._stateConfig);

        this.gl.viewport(0, 0, this.canvasWidth, this.canvasHeight);
        this.gl.clearColor(0, 0, 0, 1);
        this.gl.clear(this.gl.COLOR_BUFFER_BIT);

        if (this.settings.enableBlending) {
            this.gl.enable(GL.BLEND);
            this.gl.blendFunc(GL.SRC_COLOR, GL.ONE);
        }
    }

    initDebugCanvas() {
        const debugCanvas = document.createElement("canvas");

        debugCanvas.style.position = "absolute";
        debugCanvas.style.top = "0";
        debugCanvas.style.left = "0";
        debugCanvas.style.pointerEvents = "none";
        debugCanvas.style.width = this.canvas.style.width;
        debugCanvas.style.height = this.canvas.style.height;
        debugCanvas.width = this.canvasWidth;
        debugCanvas.height = this.canvasHeight;

        document.body.appendChild(debugCanvas);

        this.debugCanvas = debugCanvas;
        this.debugCtx = this.debugCanvas.getContext("2d");
    }

    render(particles) {
        const t = performance.now();
        super.render(particles);

        this.debugCtx?.clearRect(0, 0, this.canvasWidth, this.canvasHeight);

        this._updateData(particles)

        this.gl.clear(this.gl.COLOR_BUFFER_BIT);
        this.gl.useProgram(this._stateConfig.render.program);
        this.gl.bindVertexArray(this._stateConfig.render.vertexArrays["particle"]);
        this.gl.drawArrays(this.gl.POINTS, 0, this.settings.particleCount);

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
            if (this._maxSpeed < speed) {
                this._maxSpeed = speed;
            }
        }

        WebglUtils.loadDataFromConfig(this.gl, [
            {
                program: "render", uniforms: [
                    {type: "uniform1f", name: "scale", values: [this.scale]},
                    {type: "uniform1f", name: "max_speed", values: [this._maxSpeed]},
                    {type: "uniform2f", name: "offset", values: [this.xOffset, this.yOffset]}
                ], buffers: [
                    {name: "position", data: this._positionBufferData, usageHint: GL.STREAM_DRAW},
                    {name: "velocity", data: this._velocityBufferData, usageHint: GL.STREAM_DRAW},
                    {name: "mass", data: this._massBufferData, usageHint: GL.STREAM_DRAW},
                ]
            }
        ], this._stateConfig)
    }

    drawWorldRect(x, y, width, height) {
        if (!this.settings.debug) {
            console.error("Allowed only in debug mode");
            return;
        }

        this.debugCtx.beginPath()
        this.debugCtx.rect(
            this.xOffset + x * this.scale, this.yOffset + y * this.scale,
            width * this.scale, height * this.scale
        );
        this.debugCtx.stroke();
    }

    setDrawStyle(stroke, fill) {
        if (!this.settings.debug) {
            console.error("Allowed only in debug mode");
            return;
        }

        if (stroke) {
            this.debugCtx.strokeStyle = stroke;
        }
        if (fill) {
            this.debugCtx.fillStyle = fill;
        }
    }
}
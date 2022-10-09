import {RendererBase} from "../base.js";
import * as WebglUtils from "../../utils/webgl.js";
import {m4} from "../../utils/m4.js";

const RenderVertexShaderSource = await fetch("./render/webgl/shaders/render_vs.glsl").then(r => r.text());
const RenderFragmentShaderSource = await fetch("./render/webgl/shaders/render_fs.glsl").then(r => r.text());

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
            {type: "uniformMatrix4fv", name: "projection"},
            {type: "uniform1f", name: "point_size"},
            {type: "uniform1f", name: "max_mass"},
            {type: "uniform1f", name: "max_speed"},
        ],
        vertexArrays: [{
            name: "particle", entries: [
                {name: "position", type: GL.FLOAT, size: 3},
                {name: "velocity", type: GL.FLOAT, size: 3},
                {name: "mass", type: GL.FLOAT, size: 1},
            ]
        }],
    }
]

export class Webgl2Renderer extends RendererBase {
    xRotation = 0;
    yRotation = 0;

    /**
     * @param {HTMLCanvasElement} canvas
     * @param {Settings} settings
     */
    constructor(canvas, settings) {
        super(canvas, settings);

        this.gl = canvas.getContext("webgl2");
        this._stateConfig = {};

        this._positionBufferData = new Float32Array(this.settings.particleCount * 3);
        this._velocityBufferData = new Float32Array(this.settings.particleCount * 3);
        this._massBufferData = new Float32Array(this.settings.particleCount);
        this._maxSpeed = this.settings.gravity / 100;

        this.depth = Math.max(this.canvasWidth, this.canvasHeight);
        this.projection = m4.perspective(75, this.canvasWidth / this.canvasHeight, 1, this.depth * 4);

        this.initWebgl();
        if (this.settings.debug) {
            this.initDebugCanvas();
        }
    }

    initWebgl() {
        WebglUtils.createFromConfig(this.gl, CONFIGURATION, this._stateConfig);

        WebglUtils.loadDataFromConfig(this.gl, this._stateConfig, [{
            program: "render",
            uniforms: [
                {name: "point_size", values: [this.dpr]},
                {name: "max_mass", values: [this.settings.particleMass + 1]},
                {name: "max_speed", values: [this._maxSpeed]},
            ],
            buffers: []
        }]);

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
        this.debugCtx.lineWidth = this.dpr;
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
        const pos = {x: 0, y: 0, z: 0};
        for (let i = 0; i < particles.length; i++) {
            const particle = particles[i];
            pos.x = particle.x;
            pos.y = particle.y;
            pos.z = particle.z;

            if (this.coordinateTransformer) {
                this.coordinateTransformer(i, particle, pos);
            }

            this._positionBufferData[i * 3] = pos.x;
            this._positionBufferData[i * 3 + 1] = pos.y;
            this._positionBufferData[i * 3 + 2] = pos.z;

            this._velocityBufferData[i * 3] = particle.velX;
            this._velocityBufferData[i * 3 + 1] = particle.velY;
            this._velocityBufferData[i * 3 + 2] = particle.velZ;
            this._massBufferData[i] = particle.mass;

            const speed = Math.max(Math.abs(particle.velX), Math.abs(particle.velY), Math.abs(particle.velZ));
            if (this._maxSpeed < speed) {
                this._maxSpeed = speed;
            }
        }


        const cameraMatrix = m4.translation(this.canvasWidth / 2, this.canvasHeight / 2, this.depth * 1.5);

        let matrix = m4.multiply(this.projection, m4.inverse(cameraMatrix));
        matrix = m4.translate(matrix, this.canvasWidth / 2, this.canvasHeight / 2, 0);
        matrix = m4.scale(matrix, this.scale, this.scale, this.scale);
        matrix = m4.translate(matrix, -this.xOffset, this.yOffset, 0);
        matrix = m4.yRotate(matrix, this.yRotation);
        matrix = m4.xRotate(matrix, this.xRotation);
        matrix = m4.xRotate(matrix, Math.PI);
        matrix = m4.zRotate(matrix, Math.PI);
        matrix = m4.translate(matrix, -this.settings.worldWidth / 2, -this.settings.worldHeight / 2, 0);

        WebglUtils.loadDataFromConfig(this.gl, this._stateConfig, [
            {
                program: "render", uniforms: [
                    {name: "max_speed", values: [this._maxSpeed]},
                    {name: "projection", values: [false, matrix]}
                ], buffers: [
                    {name: "position", data: this._positionBufferData},
                    {name: "velocity", data: this._velocityBufferData},
                    {name: "mass", data: this._massBufferData},
                ]
            }
        ])
    }

    rotate(xDelta, yDelta) {
        let newX = this.xRotation + xDelta;
        if (Math.abs(newX) > Math.PI * 2) {
            newX -= Math.sign(newX) * Math.PI * 2;
        }
        this.xRotation = newX;

        if (Math.abs(newX) > Math.PI) {
            yDelta = -yDelta;
        }

        let newY = this.yRotation + yDelta;
        if (Math.abs(newX) > Math.PI * 2) {
            newY -= Math.sign(newY) * Math.PI * 2;
        }

        this.yRotation = newY;
    }

    getDebugDrawingContext() {
        return this.debugCtx;
    }
}
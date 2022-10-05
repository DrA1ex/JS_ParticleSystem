import {PhysicsEngine} from "../../simulation/physics.js";
import * as WebglUtils from "../../utils/webgl.js";

const GL = WebGL2RenderingContext;
const CONFIGURATION1 = [{
    program: "calc",
    vs: "./gpgpu/shaders/calc_vs.glsl",
    fs: "./gpgpu/shaders/calc_fs.glsl",
    tfAttributes: ["out_velocity"],
    attributes: [
        {name: "position"},
        {name: "mass"},
    ],
    buffers: [
        {name: "position", usageHint: GL.STREAM_DRAW},
        {name: "mass", usageHint: GL.STREAM_DRAW},
        {name: "out_velocity", usageHint: GL.STREAM_READ},
    ],
    uniforms: [
        {name: "gravity", type: "uniform1f"},
        {name: "p_force", type: "uniform2f"},
        {name: "min_dist_square", type: "uniform1f"},
        {name: "count", type: "uniform1i"},
    ],
    vertexArrays: [{
        name: "particle", entries: [
            {name: "position", type: GL.FLOAT, size: 2},
            {name: "mass", type: GL.FLOAT, size: 1},
        ]
    }],
    textures: [{
        name: "particles_tex",
        width: null,
        height: null,
        format: GL.RGB,
        internalFormat: GL.RGB32F,
        type: GL.FLOAT,
        params: {
            min: GL.NEAREST,
            mag: GL.NEAREST,
            wrapS: GL.CLAMP_TO_EDGE,
            wrapT: GL.CLAMP_TO_EDGE,
        }
    }]
}];

const CONFIGURATION2 = [
    {
        program: "calc",
        transformFeedbacks: [{
            name: "out_velocity", buffers: ["out_velocity"]
        }],
    }
]

export class GPUPhysicsEngine extends PhysicsEngine {
    async init(settings) {
        this.settings = settings;
        this.canvas = new OffscreenCanvas(this.settings.worldWidth, this.settings.worldHeight);
        this.gl = this.canvas.getContext("webgl2");

        this._stateConfig = {};

        this._positionBufferData = new Float32Array(this.settings.segmentMaxCount * 2);
        this._massBufferData = new Float32Array(this.settings.segmentMaxCount);

        this._outVelocityData = new Float32Array(this.settings.segmentMaxCount * 2);
        this._particleTexData = new Float32Array(this.settings.segmentMaxCount * 3);

        await this.initGl();
    }

    async initGl() {
        CONFIGURATION1[0].vs = await fetch(CONFIGURATION1[0].vs).then(r => r.text())
        CONFIGURATION1[0].fs = await fetch(CONFIGURATION1[0].fs).then(r => r.text());

        const lineSize = Math.ceil(Math.sqrt(this.settings.segmentMaxCount));
        CONFIGURATION1[0].textures[0].width = lineSize;
        CONFIGURATION1[0].textures[0].height = lineSize;

        WebglUtils.createFromConfig(this.gl, CONFIGURATION1, this._stateConfig);

        WebglUtils.loadDataFromConfig(this.gl, this._stateConfig, [{
            program: "calc",
            uniforms: [
                {name: "gravity", values: [this.settings.particleGravity]},
                {name: "p_force", values: [0, 0]},
                {name: "min_dist_square", values: [this.settings.minInteractionDistanceSq]},
            ],
            buffers: [
                {name: "out_velocity", data: this._outVelocityData}
            ]
        }]);

        WebglUtils.createFromConfig(this.gl, CONFIGURATION2, this._stateConfig);

        this.gl.viewport(0, 0, this.settings.worldWidth, this.settings.worldHeight);
        this.gl.enable(GL.RASTERIZER_DISCARD);
    }

    _calculateLeafData(leaf, pForce) {
        for (let i = 0; i < leaf.length; i++) {
            const p = leaf.data[i];

            this._positionBufferData[i * 2] = p.x;
            this._positionBufferData[i * 2 + 1] = p.y;
            this._massBufferData[i] = p.mass;

            this._particleTexData[i * 3] = p.x;
            this._particleTexData[i * 3 + 1] = p.y;
            this._particleTexData[i * 3 + 2] = p.mass;
        }

        WebglUtils.loadDataFromConfig(this.gl, this._stateConfig, [{
            program: "calc",
            uniforms: [
                {name: "p_force", values: pForce},
                {name: "count", values: [leaf.length]},
            ],
            buffers: [
                {name: "position", data: this._positionBufferData},
                {name: "mass", data: this._massBufferData},
            ],
            textures: [
                {name: "particles_tex", data: this._particleTexData}
            ]
        }]);

        this.gl.bindVertexArray(this._stateConfig.calc.vertexArrays["particle"]);
        this.gl.bindTransformFeedback(GL.TRANSFORM_FEEDBACK, this._stateConfig.calc.transformFeedbacks["out_velocity"]);
        this.gl.beginTransformFeedback(GL.POINTS);
        this.gl.drawArrays(GL.POINTS, 0, leaf.length);
        this.gl.endTransformFeedback();
        this.gl.bindTransformFeedback(GL.TRANSFORM_FEEDBACK, null);

        this.gl.bindBuffer(GL.ARRAY_BUFFER, this._stateConfig.calc.buffers["out_velocity"]);
        this.gl.getBufferSubData(GL.ARRAY_BUFFER, 0, this._outVelocityData);

        for (let i = 0; i < leaf.length; i++) {
            const p = leaf.data[i];
            p.velX += this._outVelocityData[i * 2];
            p.velY += this._outVelocityData[i * 2 + 1];
        }
    }
}
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
    ],
    buffers: [
        {name: "position", usageHint: GL.STREAM_DRAW},
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
}, {
    program: "collision",
    vs: "./gpgpu/shaders/collision_vs.glsl",
    fs: "./gpgpu/shaders/collision_fs.glsl",
    tfAttributes: ["out_velocity"],
    attributes: [
        {name: "position"},
        {name: "velocity"},
        {name: "index"},
    ],
    buffers: [
        {name: "position", usageHint: GL.STREAM_DRAW},
        {name: "velocity", usageHint: GL.STREAM_DRAW},
        {name: "index", usageHint: GL.STATIC_DRAW},
        {name: "out_velocity", usageHint: GL.STREAM_READ},
    ],
    uniforms: [
        {name: "min_dist_square", type: "uniform1f"},
        {name: "count", type: "uniform1i"},
    ],
    vertexArrays: [{
        name: "particle", entries: [
            {name: "position", type: GL.FLOAT, size: 2},
            {name: "velocity", type: GL.FLOAT, size: 2},
            {name: "index", type: GL.FLOAT, size: 1},
        ]
    }],
    textures: [{
        name: "particle_pos_mass_tex",
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
    }, {
        name: "particle_velocity_tex",
        width: null,
        height: null,
        format: GL.RG,
        internalFormat: GL.RG32F,
        type: GL.FLOAT,
        params: {
            min: GL.NEAREST,
            mag: GL.NEAREST,
            wrapS: GL.CLAMP_TO_EDGE,
            wrapT: GL.CLAMP_TO_EDGE,
        }
    }]
}];

const CONFIGURATION2 = [{
    program: "calc",
    transformFeedbacks: [{
        name: "out_velocity", buffers: ["out_velocity"]
    }],
}, {
    program: "collision",
    transformFeedbacks: [{
        name: "out_velocity", buffers: ["out_velocity"]
    }],
}]

export class GPUPhysicsEngine extends PhysicsEngine {
    async init(settings) {
        this.settings = settings;
        this.canvas = new OffscreenCanvas(this.settings.worldWidth, this.settings.worldHeight);
        this.gl = this.canvas.getContext("webgl2");

        this._stateConfig = {};

        this._positionBufferData = new Float32Array(this.settings.segmentMaxCount * 2);
        this._velocityBufferData = new Float32Array(this.settings.segmentMaxCount * 2);
        this._indexBufferData = new Float32Array(this.settings.segmentMaxCount);

        this._outVelocityData = new Float32Array(this.settings.segmentMaxCount * 2);
        this._particleTexData = new Float32Array(this.settings.segmentMaxCount * 3);
        this._particleVelocityTexData = new Float32Array(this.settings.segmentMaxCount * 2);

        await this.initGl();
    }

    async initGl() {
        const lineSize = Math.ceil(Math.sqrt(this.settings.segmentMaxCount));
        for (let i = 0; i < CONFIGURATION1.length; i++) {
            const conf = CONFIGURATION1[i];
            conf.vs = await fetch(conf.vs).then(r => r.text())
            conf.fs = await fetch(conf.fs).then(r => r.text());

            for (let j = 0; j < conf.textures.length; j++) {
                conf.textures[j].width = lineSize;
                conf.textures[j].height = lineSize;
            }
        }

        for (let i = 0; i < this.settings.segmentMaxCount; i++) {
            this._indexBufferData[i] = i;
        }

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
        }, {
            program: "collision",
            uniforms: [
                {name: "min_dist_square", values: [this.settings.minInteractionDistanceSq]},
            ],
            buffers: [
                {name: "index", data: this._indexBufferData},
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
            ],
            textures: [
                {name: "particles_tex", data: this._particleTexData}
            ]
        }]);

        this.gl.useProgram(this._stateConfig.calc.program);
        this.gl.bindVertexArray(this._stateConfig.calc.vertexArrays["particle"]);
        this.gl.bindTransformFeedback(GL.TRANSFORM_FEEDBACK, this._stateConfig.calc.transformFeedbacks["out_velocity"]);
        this.gl.beginTransformFeedback(GL.POINTS);
        this.gl.drawArrays(GL.POINTS, 0, leaf.length);
        this.gl.endTransformFeedback();
        this.gl.bindTransformFeedback(GL.TRANSFORM_FEEDBACK, null);

        this.gl.bindBuffer(GL.ARRAY_BUFFER, this._stateConfig.calc.buffers["out_velocity"]);
        this.gl.getBufferSubData(GL.ARRAY_BUFFER, 0, this._outVelocityData, 0, leaf.length * 2);

        for (let i = 0; i < leaf.length; i++) {
            const p = leaf.data[i];
            p.velX += this._outVelocityData[i * 2];
            p.velY += this._outVelocityData[i * 2 + 1];
        }
    }

    _processCollisions(leaf) {
        for (let i = 0; i < leaf.length; i++) {
            const p = leaf.data[i];

            this._positionBufferData[i * 2] = p.x;
            this._positionBufferData[i * 2 + 1] = p.y;

            this._velocityBufferData[i * 2] = p.velX;
            this._velocityBufferData[i * 2 + 1] = p.velY;

            this._particleTexData[i * 3] = p.x;
            this._particleTexData[i * 3 + 1] = p.y;
            this._particleTexData[i * 3 + 2] = p.mass;

            this._particleVelocityTexData[i * 2] = p.velX;
            this._particleVelocityTexData[i * 2 + 1] = p.velY;
        }

        WebglUtils.loadDataFromConfig(this.gl, this._stateConfig, [{
            program: "collision",
            uniforms: [
                {name: "count", values: [leaf.length]},
            ],
            buffers: [
                {name: "position", data: this._positionBufferData},
                {name: "velocity", data: this._velocityBufferData},
            ],
            textures: [
                {name: "particle_pos_mass_tex", data: this._particleTexData},
                {name: "particle_velocity_tex", data: this._particleVelocityTexData}
            ]
        }]);

        this.gl.useProgram(this._stateConfig.collision.program);

        this.gl.activeTexture(GL.TEXTURE0);
        this.gl.bindTexture(GL.TEXTURE_2D, this._stateConfig.collision.textures["particle_pos_mass_tex"]);
        this.gl.activeTexture(GL.TEXTURE1);
        this.gl.bindTexture(GL.TEXTURE_2D, this._stateConfig.collision.textures["particle_velocity_tex"]);

        this.gl.bindVertexArray(this._stateConfig.collision.vertexArrays["particle"]);
        this.gl.bindTransformFeedback(GL.TRANSFORM_FEEDBACK, this._stateConfig.collision.transformFeedbacks["out_velocity"]);
        this.gl.beginTransformFeedback(GL.POINTS);
        this.gl.drawArrays(GL.POINTS, 0, leaf.length);

        this.gl.endTransformFeedback();
        this.gl.bindTransformFeedback(GL.TRANSFORM_FEEDBACK, null);

        this.gl.bindBuffer(GL.ARRAY_BUFFER, this._stateConfig.collision.buffers["out_velocity"]);
        this.gl.getBufferSubData(GL.ARRAY_BUFFER, 0, this._outVelocityData, 0, leaf.length * 2);

        for (let i = 0; i < leaf.length; i++) {
            const p = leaf.data[i];
            p.velX = this._outVelocityData[i * 2];
            p.velY = this._outVelocityData[i * 2 + 1];
        }
    }
}
export function createShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    const success = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
    if (!success) {
        console.error(gl.getShaderInfoLog(shader));
    }

    return shader;
}

export function createProgram(gl, vertexShader, fragmentShader, transformFeedbacks = null) {
    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);

    if (transformFeedbacks && transformFeedbacks.length > 0) {
        gl.transformFeedbackVaryings(program, transformFeedbacks, gl.SEPARATE_ATTRIBS);
    }

    gl.linkProgram(program);

    const success = gl.getProgramParameter(program, gl.LINK_STATUS);
    if (!success) {
        console.error(gl.getProgramInfoLog(program));
    }

    return program;
}

export function createVertexArray(gl, entries) {
    const vertexArray = gl.createVertexArray();
    for (let i = 0; i < entries.length; i++) {
        const {attribute, buffer, type, size, stride, offset} = entries[i];
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bindVertexArray(vertexArray);
        gl.enableVertexAttribArray(attribute);
        gl.vertexAttribPointer(attribute, size, type, false, stride, offset);
    }

    return vertexArray;
}

export function createTransformFeedback(gl, ...buffers) {
    const tf = gl.createTransformFeedback();
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, tf);
    for (let i = 0; i < buffers.length; i++) {
        gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, i, buffers[i]);
    }
    return tf;
}

export function createFromConfig(gl, config, outStateConfig) {
    for (const configElement of config) {
        const programConfig = {};
        outStateConfig[configElement.program] = programConfig;

        programConfig.vs = createShader(gl, gl.VERTEX_SHADER, configElement.vs);
        programConfig.fs = createShader(gl, gl.FRAGMENT_SHADER, configElement.fs);
        programConfig.program = createProgram(gl, programConfig.vs, programConfig.fs);
        gl.useProgram(programConfig.program);

        const attributesConfig = {};
        programConfig.attributes = attributesConfig;
        const buffersConfig = {};
        programConfig.buffers = buffersConfig;

        for (const attributeConfig of configElement.attributes) {
            attributesConfig[attributeConfig.name] = gl.getAttribLocation(
                programConfig.program, attributeConfig.name);

            if (attributeConfig.buffer) {
                buffersConfig[attributeConfig.name] = gl.createBuffer();
            }
        }

        const uniformsConfig = {};
        programConfig.uniforms = uniformsConfig;

        for (const uniformConfig of configElement.uniforms) {
            uniformsConfig[uniformConfig.name] = gl.getUniformLocation(
                programConfig.program, uniformConfig.name);
        }

        const vertexArrayConfig = {};
        programConfig.vertexArrays = vertexArrayConfig;
        for (const vaConfig of configElement.vertexArrays) {
            const entries = vaConfig.entries.map(entry => ({
                attribute: attributesConfig[entry.name],
                buffer: buffersConfig[entry.name],
                type: entry.type,
                size: entry.size,
                stride: entry.stride || 0,
                offset: entry.offset || 0
            }));

            vertexArrayConfig[vaConfig.name] = createVertexArray(gl, entries);
        }

        const transformFeedbacks = {};
        programConfig.transformFeedbacks = transformFeedbacks;
        for (const tf of configElement.transformFeedbacks) {
            const buffers = tf.buffers.map(b => buffersConfig[b]);
            transformFeedbacks[tf.name] = createTransformFeedback(gl, ...buffers);
        }

        gl.bindBuffer(gl.ARRAY_BUFFER, null);
        gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, null);
    }
}

export function loadDataFromConfig(gl, dataConfig, stateConfig) {
    for (const dc of dataConfig) {
        const state = stateConfig[dc.program];
        gl.useProgram(state.program);

        for (const uniformConfig of dc.uniforms) {
            gl[uniformConfig.type](state.uniforms[uniformConfig.name], ...uniformConfig.values);
        }

        for (const bufferConfig of dc.buffers) {
            gl.bindBuffer(gl.ARRAY_BUFFER, state.buffers[bufferConfig.name]);
            gl.bufferData(gl.ARRAY_BUFFER, bufferConfig.data, bufferConfig.usageHint);
        }
    }
}
import test from "node:test";
import assert from "node:assert/strict";
import {installBrowserStubs} from "../test-support/browser-env.js";

installBrowserStubs();

const {Application} = await import("../n_body/player/app.js");
const {PlayerStateEnum} = await import("../n_body/player/controllers/base.js");
const {ControlStateEnum} = await import("../n_body/player/controllers/control_bar.js");
const {PlayerController} = await import("../n_body/player/controllers/player.js");
const {PlayingProgress} = await import("../n_body/ui/controls/playing_progress.js");
const {Webgl2Renderer} = await import("../n_body/render/webgl/render.js");

function makeApp(overrides = {}) {
    const app = Object.create(Application.prototype);
    Object.assign(app, {
        settings: {world: {fps: 60}, render: {config: {}, enableDFRI: true}},
        particles: null,
        sequence: null,
        frameIndex: -1,
        currentSpeed: 1,
        renderer: null,
        dfri: null,
        playerCtrl: null,
        _statesToRender: new Set([PlayerStateEnum.playing, PlayerStateEnum.paused, PlayerStateEnum.finished]),
        _playbackPosition: 0,
        _interpolationFactor: 0,
        _playbackClockTimestamp: null,
        _lastPresentedTimestamp: null,
        _rafId: null,
        _usesCompactPositionFrames: false,
        currentFrame: null,
        previousFrame: null,
        renderStats: null,
        _renderFrame: () => {},
    }, overrides);
    return app;
}

test("WebGL renderer accepts interpolation factor for compact recording frames", () => {
    const state = {
        _nextParticles: null,
        _nextPositionFrame: new Float32Array([0, 0, 1, 1]),
        _interpolationFactor: 0,
        _hasInterpolationFrame: Webgl2Renderer.prototype._hasInterpolationFrame,
    };
    Webgl2Renderer.prototype.setInterpolationFactor.call(state, 0.5);
    assert.equal(state._interpolationFactor, 0.5);

    state._nextPositionFrame = null;
    state._nextParticles = new Float32Array(10);
    Webgl2Renderer.prototype.setInterpolationFactor.call(state, 2);
    assert.equal(state._interpolationFactor, 1);

    state._nextParticles = null;
    Webgl2Renderer.prototype.setInterpolationFactor.call(state, 0.5);
    assert.equal(state._interpolationFactor, 0);
});

test("compact WebGL uploads reuse frame references and cluster colors use x/y stride", () => {
    const uploads = [];
    const state = {
        _compactFrameDirty: true,
        _uploadedCurrentPositionSource: null,
        _uploadedCurrentPositionCount: 0,
        _uploadedPreviousPositionSource: null,
        _uploadedPreviousPositionCount: 0,
        _uploadArrayBuffer(name, data, length) { uploads.push([name, data, length]); },
    };
    const current = new Float32Array([0, 0, 10, 0, 10, 10]);
    const previous = new Float32Array([-1, 0, 9, 0, 9, 9]);

    Webgl2Renderer.prototype._uploadCompactPositionFrames.call(state, current, previous, 3, true);
    Webgl2Renderer.prototype._uploadCompactPositionFrames.call(state, current, previous, 3, true);
    assert.deepEqual(uploads.map(([name, , length]) => [name, length]), [
        ["currentPosition", 6],
        ["previousPosition", 6],
    ]);

    const colorState = {_particleColorBufferData: new Uint8Array(9)};
    Webgl2Renderer.prototype._bakeClusterParticleColors.call(colorState, current, 3, 2);
    assert.deepEqual([...colorState._particleColorBufferData], [0, 64, 0, 255, 64, 0, 255, 64, 255]);
});

test("presentation pacing targets 60 FPS on a simulated 144 Hz display", () => {
    const app = makeApp();
    let presented = 0;
    const interval = 1000 / 144;
    for (let timestamp = 0; timestamp <= 1000; timestamp += interval) {
        if (app._shouldPresent(timestamp)) presented += 1;
    }
    assert.ok(presented >= 59 && presented <= 62, `expected about 60 presentations, got ${presented}`);

    app._lastPresentedTimestamp = 0;
    assert.equal(app._shouldPresent(5), false);
    assert.equal(app._shouldPresent(1000), true);
    assert.ok(Math.abs(app._lastPresentedTimestamp - 1000) < 1e-9);
});

test("playback timeline advances by recording FPS and current speed", () => {
    const positions = [];
    const app = makeApp({
        sequence: {fps: 10},
        currentSpeed: 2,
        _playbackPosition: 1,
        _playbackClockTimestamp: null,
        _applyPlaybackPosition(value) { positions.push(value); this._playbackPosition = value; },
    });
    app._advancePlaybackClock(100);
    assert.equal(positions.length, 0);
    app._advancePlaybackClock(150);
    assert.deepEqual(positions, [2]);
    app._advancePlaybackClock(140);
    assert.deepEqual(positions, [2, 2], "negative elapsed time is clamped");
});

test("applying playback position copies frames, derives velocity and updates GPU target", () => {
    const frames = [
        new Float32Array([0, 0, 10, 20]),
        new Float32Array([2, 4, 13, 25]),
        new Float32Array([5, 9, 17, 31]),
    ];
    const dirty = [];
    const targets = [];
    const app = makeApp({
        sequence: {
            length: frames.length,
            particleCount: 2,
            componentsCount: 2,
            getFrame(index) { return index >= 0 && index < frames.length ? frames[index] : null; },
        },
        particles: new Float32Array(10),
        renderer: {
            markParticlesDirty() { dirty.push(true); },
            setInterpolationFrame(value) { targets.push(["frame", value]); },
            setInterpolationFactor(value) { targets.push(["factor", value]); },
        },
        dfri: {
            setNextPositionFrame(value, reset) { targets.push(["position", value, reset]); return true; },
        },
    });

    app._applyPlaybackPosition(0.5, true);
    assert.equal(app.frameIndex, 0);
    assert.equal(app._interpolationFactor, 0.5);
    assert.deepEqual([...app.particles], [0, 0, 0, 0, 0, 10, 20, 0, 0, 0]);
    assert.equal(targets.at(-1)[1], frames[1]);

    app._applyPlaybackPosition(1.25);
    assert.equal(app.frameIndex, 1);
    assert.equal(app._interpolationFactor, 0.25);
    assert.deepEqual([...app.particles], [2, 4, 2, 4, 0, 13, 25, 3, 5, 0]);
    assert.equal(dirty.length, 2);

    app._applyPlaybackPosition(99);
    assert.equal(app.frameIndex, 2);
    assert.equal(app._playbackPosition, 2);
    assert.equal(app._interpolationFactor, 0);
    assert.ok(targets.some(([name, value]) => name === "frame" && value === null));
});


test("compact playback keeps native position frames without allocating interleaved particles", () => {
    const frames = [
        new Float32Array([0, 0, 10, 20]),
        new Float32Array([2, 4, 13, 25]),
    ];
    const app = makeApp({
        sequence: {
            length: 2,
            particleCount: 2,
            componentsCount: 2,
            getFrame(index) { return index >= 0 && index < frames.length ? frames[index] : null; },
        },
        _usesCompactPositionFrames: true,
        particles: null,
        renderer: {markParticlesDirty() {}},
        dfri: {setNextPositionFrame() { return true; }},
    });

    app._applyPlaybackPosition(1, true);
    assert.equal(app.currentFrame, frames[1]);
    assert.equal(app.previousFrame, frames[0]);
    assert.equal(app.particles, null);
});

test("player progress range reaches exactly the last recorded frame", () => {
    const calls = [];
    const controller = Object.create(PlayerController.prototype);
    Object.assign(controller, {
        framesCount: 0,
        subFrameCount: 0,
        frameIndex: 0,
        subFrameIndex: 0,
        controlBarCtrl: {
            setProgressRange(value) { calls.push(["range", value]); },
            setProgress(value) { calls.push(["progress", value]); },
        },
        emitEvent(name, value) { calls.push([name, value]); },
    });

    controller.setupSequence(3, 4);
    controller.setCurrentFrame(2, 0);
    controller._onSeek(null, 999);

    assert.deepEqual(calls[0], ["range", 8]);
    assert.deepEqual(calls[1], ["progress", 8]);
    assert.deepEqual(calls[2][1], {frame: 2, subFrame: 0});
});

test("zero-length progress ranges render as complete instead of dividing by zero", () => {
    const values = [];
    const progress = Object.create(PlayingProgress.prototype);
    Object.assign(progress, {
        min: 0, max: 1, value: 0,
        progressElement: {style: {setProperty(name, value) { values.push([name, value]); }}},
    });

    progress.setRange(0, 0);
    progress.setValue(0);
    assert.equal(progress.max, 0);
    assert.deepEqual(values.at(-1), ["--value", "1"]);
});

test("CPU interpolation fallback calculates deltas when compact GPU frames are unavailable", () => {
    const current = new Float32Array([1, 2, 3, 4]);
    const next = new Float32Array([5, 8, 9, 10]);
    let dataFn = null;
    const app = makeApp({
        sequence: {componentsCount: 2, getFrame: index => index === 1 ? next : null},
        renderer: {},
        dfri: {
            setNextPositionFrame() { return false; },
            setNextFrame(fn, reset) { dataFn = fn; assert.equal(reset, false); },
        },
    });
    app._setInterpolationTarget(current, 1);
    const out = {};
    dataFn(1, out);
    assert.deepEqual(out, {x: 6, y: 6});
});

test("player frame/subframe counts adapt to playback speed", () => {
    const setup = [];
    const pacing = [];
    const app = makeApp({
        sequence: {fps: 10, length: 100},
        currentSpeed: 0.5,
        playerCtrl: {
            setupSequence(...args) { setup.push(args); },
            setPlaybackPacing(value) { pacing.push(value); },
            setCurrentFrame() {},
        },
        frameIndex: 0,
    });
    assert.equal(app._getFramesPerRecordedStep(), 12);
    assert.equal(app._getUiSubFrameCount(), 12);
    app._updateSequenceUi();
    assert.deepEqual(setup, [[100, 12]]);
    assert.equal(pacing[0].interpolatedFrames, 11);

    app.currentSpeed = 10;
    assert.equal(app._getFramesPerRecordedStep(), 0.6);
    assert.equal(app._getUiSubFrameCount(), 1);
});

test("speed changes reconfigure DFRI and preserve current timeline position", () => {
    const calls = [];
    const app = makeApp({
        sequence: {fps: 12},
        playerCtrl: {currentState: PlayerStateEnum.playing},
        dfri: {
            reconfigure(source, target) { calls.push(["reconfigure", source, target]); },
            init() { calls.push(["init"]); },
        },
        _advancePlaybackClock() { calls.push(["advance"]); },
        _resetPlaybackClock() { calls.push(["reset"]); },
        _updateSequenceUi() { calls.push(["ui"]); },
    });
    app.handleSpeed(2.5);
    assert.equal(app.currentSpeed, 2.5);
    assert.deepEqual(calls, [
        ["advance"],
        ["reconfigure", 30, 60],
        ["init"],
        ["reset"],
        ["ui"],
    ]);
    app.handleSpeed(0);
    assert.equal(app.currentSpeed, 2.5);
});

test("seek and playback controls reset clocks and state consistently", () => {
    const calls = [];
    const playerCtrl = {
        currentState: PlayerStateEnum.finished,
        setState(value) { calls.push(["state", value]); this.currentState = value; },
    };
    const app = makeApp({
        playerCtrl,
        sequence: {fps: 10},
        renderer: {reset() { calls.push(["renderer-reset"]); }, clear() { calls.push(["clear"]); }},
        dfri: {reset() { calls.push(["dfri-reset"]); }},
        _getUiSubFrameCount: () => 4,
        _applyPlaybackPosition(value, force) { calls.push(["position", value, force]); },
        _resetPlaybackClock() { calls.push(["clock"]); },
        _updateProgressUi() { calls.push(["progress"]); },
    });
    app.handleSeek({frame: 3, subFrame: 2});
    assert.ok(calls.some(call => call[0] === "position" && call[1] === 3.5));
    assert.equal(playerCtrl.currentState, PlayerStateEnum.paused);

    calls.length = 0;
    app.handleControl(ControlStateEnum.rewind);
    assert.ok(calls.some(call => call[0] === "position" && call[1] === 0));
    assert.equal(calls.some(call => call[0] === "renderer-reset"), false);
    assert.equal(playerCtrl.currentState, PlayerStateEnum.playing);

    calls.length = 0;
    app.handleControl(ControlStateEnum.reset);
    assert.equal(playerCtrl.currentState, PlayerStateEnum.waiting);
});

test("render presents DFRI factor and marks sequence finished", () => {
    const calls = [];
    const playerCtrl = {
        currentState: PlayerStateEnum.playing,
        setState(value) { calls.push(["state", value]); this.currentState = value; },
        setCurrentFrame() {},
    };
    const app = makeApp({
        playerCtrl,
        sequence: {length: 2, fps: 10},
        particles: new Float32Array(5),
        frameIndex: 1,
        _playbackPosition: 1,
        _interpolationFactor: 0.75,
        _shouldPresent: () => true,
        _advancePlaybackClock() {},
        dfri: {renderAtFactor(particles, factor) { calls.push(["render", particles, factor]); }},
    });
    app.render(100);
    assert.ok(calls.some(call => call[0] === "render" && call[2] === 0.75));
    assert.equal(playerCtrl.currentState, PlayerStateEnum.finished);
});

test("loadData transitions through loading and starts rendering on success", async () => {
    const states = [];
    const sequence = {length: 2};
    let scheduled = 0;
    const originalRaf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = callback => { scheduled += 1; assert.equal(typeof callback, "function"); return 1; };
    try {
        const app = makeApp({
            playerCtrl: {setState(value) { states.push(value); }},
            _setSequence(value) { assert.equal(value, sequence); },
            handleSpeed(value) { assert.equal(value, 1); },
            _renderFrame: () => {},
        });
        const originalFromBuffer = (await import("../n_body/simulation/sequence.js")).SimulationSequence.fromBuffer;
        const {SimulationSequence} = await import("../n_body/simulation/sequence.js");
        SimulationSequence.fromBuffer = value => { assert.equal(value, "buffer"); return sequence; };
        try {
            await app.loadData(async () => "buffer");
        } finally {
            SimulationSequence.fromBuffer = originalFromBuffer;
        }
        assert.deepEqual(states, [PlayerStateEnum.loading, PlayerStateEnum.playing]);
        assert.equal(scheduled, 1);
    } finally {
        globalThis.requestAnimationFrame = originalRaf;
    }
});

test("loadData restores waiting state after loader or parser failure", async () => {
    const states = [];
    const alerts = [];
    const originalAlert = globalThis.alert;
    globalThis.alert = message => alerts.push(message);
    try {
        const app = makeApp({playerCtrl: {setState(value) { states.push(value); }}});
        await app.loadData(async () => { throw new Error("broken recording"); });
        assert.deepEqual(states, [PlayerStateEnum.loading, PlayerStateEnum.waiting]);
        assert.match(alerts[0], /broken recording/);
    } finally {
        globalThis.alert = originalAlert;
    }
});

test("sequence setup creates compact particles and initializes playback dependencies", async () => {
    const {RendererInitializer} = await import("../n_body/render/init.js");
    const originalInit = RendererInitializer.initRenderer;
    const calls = [];
    const renderer = {
        canvas: {},
        dispose() { calls.push("renderer-dispose"); },
        markParticlesDirty() { calls.push("dirty"); },
        supportsGpuInterpolation: () => true,
        supportsCompactPositionFrames: () => true,
        renderPositionFrame() {},
        setCoordinateTransformer() {},
        setInterpolationFrame() {},
        setInterpolationPositionFrame() {},
        setInterpolationFactor() {},
        render() {},
    };
    RendererInitializer.initRenderer = () => renderer;
    try {
        const frames = [new Float32Array([1, 2, 3, 4]), new Float32Array([2, 3, 4, 5])];
        const app = makeApp({
            settings: {
                world: {fps: 60},
                physics: {config: {particleCount: 0}},
                render: {render: "webgl2", enableDFRI: true},
            },
            playerCtrl: {
                setupSequence() {},
                setPlaybackPacing() {},
                setCurrentFrame() {},
            },
            renderer: {dispose() { calls.push("old-renderer-dispose"); }},
            renderInteractions: {dispose() { calls.push("old-interactions-dispose"); }},
            dfri: {disable() { calls.push("old-dfri-disable"); }},
        });
        const sequence = {
            particleCount: 2,
            componentsCount: 2,
            fps: 10,
            length: 2,
            getFrame(index) { return index >= 0 && index < 2 ? frames[index] : null; },
        };
        app._setSequence(sequence);
        assert.equal(app.sequence, sequence);
        assert.equal(app.settings.physics.config.particleCount, 2);
        assert.equal(app.particles, null);
        assert.equal(app.currentFrame, frames[0]);
        assert.equal(app.previousFrame, frames[0]);
        assert.equal(app.dfri.usesGpuInterpolation, true);
        assert.equal(app.frameIndex, 0);
        assert.ok(calls.includes("old-dfri-disable"));
        assert.ok(calls.includes("old-renderer-dispose"));
    } finally {
        RendererInitializer.initRenderer = originalInit;
    }
});

test("render loop schedules at most one requestAnimationFrame callback", () => {
    let scheduled = 0;
    const originalRaf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = () => { scheduled += 1; return scheduled; };
    try {
        const app = makeApp();
        app._ensureRenderLoop();
        app._ensureRenderLoop();
        app._ensureRenderLoop();
        assert.equal(scheduled, 1);
        assert.equal(app._rafId, 1);
    } finally {
        globalThis.requestAnimationFrame = originalRaf;
    }
});

test("render loop skips inactive states and throttled presentation frames", () => {
    let scheduled = 0;
    const originalRaf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = () => { scheduled += 1; return 1; };
    try {
        const waiting = makeApp({playerCtrl: {currentState: PlayerStateEnum.waiting}});
        waiting.render(0);
        assert.equal(scheduled, 0);

        const throttled = makeApp({
            playerCtrl: {currentState: PlayerStateEnum.playing},
            _shouldPresent: () => false,
        });
        throttled.render(0);
        assert.equal(scheduled, 1);

        const pausedCalls = [];
        const paused = makeApp({
            playerCtrl: {currentState: PlayerStateEnum.paused, setCurrentFrame() {}},
            sequence: {length: 2, fps: 10},
            particles: new Float32Array(5),
            renderer: {render(value) { pausedCalls.push(value); }},
            _shouldPresent: () => true,
            frameIndex: 0,
        });
        paused.render(10);
        assert.equal(pausedCalls.length, 1);
        assert.equal(paused._playbackClockTimestamp, null);
    } finally {
        globalThis.requestAnimationFrame = originalRaf;
    }
});

test("render settings update renderer and reset persistent colors", () => {
    const calls = [];
    const settings = {render: {config: {}}};
    const app = makeApp({
        settings,
        renderer: {
            resetParticleColors() { calls.push("reset-colors"); },
            reconfigure(value) { calls.push(["reconfigure", value]); },
        },
    });
    app._updateRenderSetting("particleSizeScale", 2);
    assert.equal(settings.render.config.particleSizeScale, 2);
    app._updateColorMode("cluster");
    assert.equal(settings.render.config.colorMode, "cluster");
    assert.equal(calls.filter(value => value === "reset-colors").length, 1);
    assert.equal(calls.filter(value => Array.isArray(value) && value[0] === "reconfigure").length, 2);
});

import test from "node:test";
import assert from "node:assert/strict";

import {AdaptiveDFRIPacingController, DFRIHelper, SimpleDFRIHelper} from "../n_body/utils/dfri.js";

function makeRenderer({gpu = true} = {}) {
    const calls = [];
    return {
        calls,
        supportsGpuInterpolation: () => gpu,
        setCoordinateTransformer: value => calls.push(["transformer", value]),
        setInterpolationFrame: value => calls.push(["frame", value]),
        setInterpolationPositionFrame: value => calls.push(["positions", value]),
        setInterpolationFactor: value => calls.push(["factor", value]),
        render: value => calls.push(["render", value]),
    };
}

test("adaptive pacing ignores transient boundary noise but reacts to sustained shortages", () => {
    const controller = new AdaptiveDFRIPacingController({maxCount: 10, initialTarget: 2.01});
    assert.equal(controller.selectedFrames, 2);

    for (const value of [2.02, 1.98, 2.04, 1.97, 2.03]) {
        controller.observe(value, 2);
    }
    assert.equal(controller.selectedFrames, 2);

    controller.observe(2.4, 2.3);
    controller.observe(2.4, 2.3);
    controller.observe(2.4, 2.3);
    assert.ok(controller.selectedFrames >= 3);
    assert.ok(controller.diagnostics().increases >= 1);
});

test("adaptive pacing probes lower values slowly and reverts a failed probe", () => {
    const controller = new AdaptiveDFRIPacingController({maxCount: 10, initialTarget: 3});
    for (let i = 0; i < 35; i++) controller.observe(1.8, 1.8);
    assert.equal(controller.selectedFrames, 2);
    assert.equal(controller.diagnostics().probingLower, true);

    controller.beginCycle();
    assert.equal(controller.reportShortage(), true);
    assert.equal(controller.selectedFrames, 3);
    const diagnostics = controller.diagnostics();
    assert.equal(diagnostics.failedProbes, 1);
    assert.equal(diagnostics.probingLower, false);
    assert.equal(controller.reportShortage(), false, "one cycle shortage must only be counted once");
});

test("adaptive pacing clamps values and accepts reconfiguration", () => {
    const controller = new AdaptiveDFRIPacingController({maxCount: 4});
    controller.observe(Number.NaN, 1);
    controller.observe(99, 99);
    assert.ok(controller.selectedFrames <= 4);
    controller.reconfigure({maxCount: 1, initialTarget: 10});
    assert.equal(controller.selectedFrames, 1);
    assert.equal(controller.diagnostics().nominalTarget, 10);
});

test("SimpleDFRIHelper uses compact GPU position frames and clamps external factors", () => {
    const renderer = makeRenderer({gpu: true});
    const helper = new SimpleDFRIHelper(renderer, 2, 10, 60);
    helper.enable();
    helper.init();
    assert.equal(helper.usesGpuInterpolation, true);
    assert.equal(helper.interpolateFrames, 5);

    const next = new Float32Array([1, 2, 3, 4]);
    assert.equal(helper.setNextPositionFrame(next, false), true);
    helper.renderAtFactor(new Float32Array(10), 2);
    helper.renderAtFactor(new Float32Array(10), Number.NaN);

    assert.ok(renderer.calls.some(([name, value]) => name === "positions" && value === next));
    assert.ok(renderer.calls.some(([name, value]) => name === "factor" && value === 1));
    assert.ok(renderer.calls.some(([name, value]) => name === "factor" && value === 0));

    helper.reconfigure(30, 60);
    helper.init();
    assert.equal(helper.interpolateFrames, 1);
    helper.disable();
    assert.equal(helper.usesGpuInterpolation, false);
});

test("SimpleDFRIHelper CPU fallback stores compact deltas and transforms particles", () => {
    const renderer = makeRenderer({gpu: false});
    const helper = new SimpleDFRIHelper(renderer, 2, 10, 20);
    helper.enable();
    assert.equal(helper.usesGpuInterpolation, false);
    assert.equal(helper.setNextPositionFrame(new Float32Array(4)), false);

    helper.setNextFrame((index, out) => {
        out.x = index + 1;
        out.y = (index + 1) * 2;
    });
    helper.renderAtFactor(new Float32Array(10), 0.5);
    const transform = renderer.calls.find(([name, value]) => name === "transformer" && typeof value === "function")[1];
    const out = {x: 10, y: 20};
    transform(1, null, out);
    assert.deepEqual(out, {x: 11, y: 22});

    const objectOut = {x: 0, y: 0};
    transform(0, {x: 5, y: 6}, objectOut);
    assert.deepEqual(objectOut, {x: 5.5, y: 7});
});

test("legacy frame-count DFRI advances factors and frame boundaries", () => {
    const helper = new SimpleDFRIHelper(makeRenderer(), 1, 10, 30);
    helper.enable();
    helper.init();
    assert.equal(helper.interpolateFrames, 2);
    assert.equal(helper.needNextFrame(), true);
    assert.equal(helper.getFactor(), 0);
    helper.render(new Float32Array(5));
    assert.equal(helper.frame, 1);
    assert.equal(helper.getFactor(), 1 / 3);
    helper.render(new Float32Array(5), true);
    assert.equal(helper.frame, 1);
    helper.frame = 3;
    assert.equal(helper.needNextFrame(), true);
    assert.ok(helper.getFactor() < 1);
    helper.reset();
    assert.equal(helper.frame, 0);
});

test("simulation DFRI uses ahead buffers, render samples and reconfiguration", () => {
    const renderer = makeRenderer({gpu: true});
    const settings = {
        physics: {particleCount: 2},
        world: {fps: 60},
        render: {DFRIMaxFrames: 8, slowMotionRate: 1},
    };
    const helper = new DFRIHelper(renderer, settings);
    helper.enable();
    helper.postStepTime(20, true);
    helper.postRenderTime(10);
    helper.postRenderTime(-1);
    helper.postRenderTime(2000);

    const current = new Float32Array(10);
    const ahead = {buffer: new Float32Array(10).fill(1)};
    helper.bufferSwitched(current, ahead);
    assert.ok(renderer.calls.some(([name, value]) => name === "frame" && value === ahead.buffer));
    assert.equal(helper.updateAheadFrame(current, {buffer: null}), false);
    assert.equal(helper.updateAheadFrame(current, ahead), true);
    assert.equal(typeof helper.reportAheadBufferMiss(), "boolean");
    assert.ok(helper.pacingDiagnostics.sampleCount >= 1);

    helper.reconfigure({...settings, render: {DFRIMaxFrames: 2, slowMotionRate: 0.5}});
    helper.reset();
    assert.ok(helper.interpolateFrames <= 2);
    helper.dispose();
    assert.equal(helper.renderer, null);
});

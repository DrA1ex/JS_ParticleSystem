import test from "node:test";
import assert from "node:assert/strict";
import {installBrowserStubs, setLocationSearch} from "../test-support/browser-env.js";

installBrowserStubs();

class FakeWorker {
    static instances = [];

    constructor(path, options) {
        this.path = path;
        this.options = options;
        this.messages = [];
        this.terminated = false;
        FakeWorker.instances.push(this);
    }

    postMessage(message, transfer = []) {
        if (this.throwOnPost) throw new Error("post failed");
        this.messages.push({message, transfer});
    }

    terminate() {
        this.terminated = true;
    }

    emit(data) {
        this.onmessage?.({data});
    }
}

globalThis.Worker = FakeWorker;

const {BackendBase, BackendImpl, WorkerHandler, ITEM_SIZE} = await import("../n_body/backend/base.js");
const {Particle_initializer} = await import("../n_body/simulation/particle_initializer.js");
const {AppSimulationSettings} = await import("../n_body/settings/app.js");

test("BackendBase resolves init, dispatches data and acknowledges reconfiguration", async () => {
    const backend = new BackendBase("worker.js");
    const worker = FakeWorker.instances.at(-1);
    const data = [];
    const ready = [];
    const settings = {serialize: () => ({value: 1})};

    const initPromise = backend.init(value => data.push(value), value => ready.push(value), settings, [1]);
    assert.match(worker.path, /worker\.js\?build=/);
    assert.equal(worker.options.type, "module");
    assert.equal(worker.messages[0].message.type, "init");

    worker.emit({type: "data", payload: 10});
    worker.emit({type: "ready", buildId: "dev"});
    assert.deepEqual(await initPromise, {type: "ready", buildId: "dev"});
    assert.equal(data.length, 1);
    assert.equal(ready.length, 1);

    const reconfigure = backend.reconfigure(settings, null);
    const request = worker.messages.at(-1).message;
    worker.emit({type: "reconfigured", requestId: request.requestId, threads: 4});
    assert.equal((await reconfigure).threads, 4);

    const buffer = new Float32Array(5);
    backend.freeBuffer(buffer);
    assert.equal(worker.messages.at(-1).message.type, "ack");
    assert.equal(worker.messages.at(-1).transfer[0], buffer.buffer);
    backend.requestNextStep();
    assert.equal(worker.messages.at(-1).message.type, "step");
});

test("BackendBase rejects control failures, duplicate init and disposal", async () => {
    const settings = {serialize: () => ({})};
    const backend = new BackendBase("worker.js");
    const worker = FakeWorker.instances.at(-1);

    const pending = backend.init(() => {}, () => {}, settings);
    await assert.rejects(backend.init(() => {}, () => {}, settings), /already pending/);
    worker.emit({type: "ready-error", message: "bad init"});
    await assert.rejects(pending, /bad init/);

    const reconfigure = backend.reconfigure(settings);
    const requestId = worker.messages.at(-1).message.requestId;
    worker.emit({type: "reconfigure-error", requestId, message: "bad config"});
    await assert.rejects(reconfigure, /bad config/);

    const pendingDispose = backend.reconfigure(settings);
    backend.dispose();
    await assert.rejects(pendingDispose, /disposed/);
    assert.equal(worker.terminated, true);
    assert.equal(worker.messages.at(-1).message.type, "dispose");
    backend.dispose();
    await assert.rejects(backend.reconfigure(settings), /already disposed/);
    await assert.rejects(backend.init(() => {}, () => {}, settings), /already disposed/);
});

test("BackendBase cleans pending promises when postMessage or worker decoding fails", async () => {
    const settings = {serialize: () => ({})};
    const backend = new BackendBase("worker.js");
    const worker = FakeWorker.instances.at(-1);
    worker.throwOnPost = true;
    await assert.rejects(backend.init(() => {}, () => {}, settings), /post failed/);
    await assert.rejects(backend.reconfigure(settings), /post failed/);

    worker.throwOnPost = false;
    const pending = backend.reconfigure(settings);
    worker.onmessageerror();
    await assert.rejects(pending, /unreadable message/);
    backend.dispose();
});

test("WorkerHandler serializes init, step and reconfigure messages", async () => {
    const calls = [];
    const sent = [];
    const originalPostMessage = globalThis.postMessage;
    globalThis.postMessage = (message, transfer = []) => sent.push({message, transfer});
    try {
        const backend = {
            async init(settings, state, metadata) { calls.push(["init", settings, state, metadata]); },
            ack(buffer) { calls.push(["ack", buffer]); },
            async step(timestamp) {
                calls.push(["step", timestamp]);
                return {timestamp, buffer: new Float32Array(5), stats: {}, treeDebug: [], forceDebug: []};
            },
            async reconfigure(settings, state) { calls.push(["reconfigure", settings, state]); },
            dispose() { calls.push(["dispose"]); },
            getRuntimeMetadata() { return {buildId: "dev", protocolVersion: 2}; },
        };
        const handler = new WorkerHandler(backend);
        await handler._handleMessage({data: {type: "init", settings: {a: 1}, state: [1], expectedBuildId: "dev", expectedProtocolVersion: 2}});
        await handler._handleMessage({data: {type: "ack", buffer: "buffer"}});
        await handler._handleMessage({data: {type: "step", timestamp: 10}});
        await handler._handleMessage({data: {type: "reconfigure", requestId: 7, settings: {b: 2}, state: null}});
        await handler._handleMessage({data: {type: "dispose"}});

        assert.deepEqual(calls.map(call => call[0]), ["init", "ack", "step", "reconfigure", "dispose"]);
        assert.deepEqual(sent.map(entry => entry.message.type), ["ready", "data", "reconfigured"]);
        assert.equal(sent[1].transfer[0], sent[1].message.buffer.buffer);
    } finally {
        globalThis.postMessage = originalPostMessage;
    }
});

test("WorkerHandler reports init and reconfigure errors without breaking the queue", async () => {
    const sent = [];
    const originalPostMessage = globalThis.postMessage;
    globalThis.postMessage = message => sent.push(message);
    try {
        const backend = {
            async init() { throw new Error("init failed"); },
            async reconfigure() { throw new Error("config failed"); },
            getRuntimeMetadata() { return {runtime: "test"}; },
        };
        const handler = new WorkerHandler(backend);
        await handler._handleMessage({data: {type: "init", settings: {}, state: null}});
        await handler._handleMessage({data: {type: "reconfigure", requestId: 9, settings: {}, state: null}});
        assert.deepEqual(sent, [
            {type: "ready-error", message: "init failed", runtime: "test"},
            {type: "reconfigure-error", requestId: 9, message: "config failed", runtime: "test"},
        ]);
    } finally {
        globalThis.postMessage = originalPostMessage;
    }
});

test("BackendImpl initializes compact buffers, applies states and returns step statistics", () => {
    setLocationSearch("?particle_count=2&buffers=2&debug_tree=1");
    const settings = AppSimulationSettings.fromQueryParams();
    const serialized = settings.serialize();
    const originalInitialize = Particle_initializer.initialize;
    Particle_initializer.initialize = currentSettings => Array.from({length: currentSettings.physics.particleCount}, () => ({x: 0, y: 0, velX: 0, velY: 0, mass: 1}));

    class FakeEngine {
        constructor(currentSettings) {
            this.settings = currentSettings;
            this.stats = {
                physicsTime: 5,
                treeTime: 2,
                tree: {flops: 10, depth: 3, segmentCount: 4},
                profile: {force: 1},
            };
        }
        step(particles) {
            particles[0].x += 1;
            return {getDebugData: () => ["tree"]};
        }
        reconfigure(currentSettings) { this.settings = currentSettings; }
        dispose() { this.disposed = true; }
    }

    try {
        const impl = new BackendImpl(FakeEngine);
        const state = new Float32Array([
            1, 2, 3, 4, 5,
            6, 7, 8, 9, 10,
        ]);
        impl.init(serialized, state);
        assert.equal(impl.buffers.length, 2);
        assert.equal(impl.particles[1].mass, 10);

        const result = impl.step(123);
        assert.equal(result.timestamp, 123);
        assert.equal(result.buffer.length, 2 * ITEM_SIZE);
        assert.equal(result.buffer[0], 2);
        assert.equal(result.stats.physicsTime, 5);
        assert.deepEqual(result.stats.tree, {flops: 10, depth: 3, segmentCount: 4});
        impl.ack(result.buffer);
        assert.equal(impl.buffers.length, 2);

        impl.reconfigure(serialized, [[11, 12, 13, 14, 15], [16, 17, 18, 19, 20]]);
        assert.equal(impl.particles[0].x, 11);
        assert.equal(impl.particles[1].mass, 20);

        impl.buffers.length = 0;
        const originalError = console.error;
        console.error = () => {};
        try {
            assert.equal(impl.step(1), null);
        } finally {
            console.error = originalError;
        }

        const engine = impl.physicalEngine;
        impl.dispose();
        assert.equal(engine.disposed, true);
        assert.equal(impl.physicalEngine, null);
    } finally {
        Particle_initializer.initialize = originalInitialize;
    }
});

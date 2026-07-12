import test from "node:test";
import assert from "node:assert/strict";

import {ChunkedArrayBuffer} from "../n_body/utils/array_buffer.js";
import {ObservableStreamLoader} from "../n_body/utils/stream.js";
import {SimulationSequence} from "../n_body/simulation/sequence.js";
import {SimulationSerializer} from "../n_body/simulation/serializert.js";

function exactBuffer(view) {
    return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
}

function buildRecording({particleCount = 2, fps = 10, frames = []}) {
    const sequence = {particleCount, fps, length: frames.length};
    const meta = SimulationSerializer.formatMeta(sequence);
    const parts = [new Uint8Array(meta.buffer)];
    for (const frame of frames) parts.push(new Uint8Array(frame.buffer, frame.byteOffset, frame.byteLength));
    const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
        bytes.set(part, offset);
        offset += part.byteLength;
    }
    return bytes;
}

function splitBytes(bytes, cuts) {
    const chunks = [];
    let start = 0;
    for (const end of [...cuts, bytes.length]) {
        chunks.push(exactBuffer(bytes.subarray(start, end)));
        start = end;
    }
    return chunks;
}

test("ChunkedArrayBuffer slices and reconstructs typed arrays across unaligned chunks", () => {
    const values = new Float32Array([1.25, 2.5, 3.75, 5]);
    const bytes = new Uint8Array(values.buffer);
    const buffer = new ChunkedArrayBuffer(splitBytes(bytes, [3, 9, 12]));

    assert.equal(buffer.byteLength, bytes.byteLength);
    assert.deepEqual([...buffer.toTypedArray(Float32Array)], [...values]);
    assert.deepEqual([...buffer.createTypedArray(Float32Array, 4, 2)], [2.5, 3.75]);
    assert.equal(buffer.slice(-10, 4).byteLength, 4);
    assert.equal(buffer.slice(999, 4).byteLength, 0);
    assert.equal(new ChunkedArrayBuffer([new ArrayBuffer(0)]).toTypedArray(Float32Array).length, 0);
});

test("ObservableStreamLoader preserves exact view ranges and reports progress", async () => {
    const source = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const backing = new Uint8Array([99, ...source, 88]);
    const reader = {
        size: source.length,
        async *[Symbol.asyncIterator]() {
            yield backing.subarray(1, 4);
            yield backing.subarray(4, 7);
            yield backing.subarray(7, 9);
        },
    };
    const progress = [];
    const loader = new ObservableStreamLoader(reader, (read, total) => progress.push([read, total]));
    assert.deepEqual([...new Uint8Array(await loader.load())], [...source]);

    const chunkedProgress = [];
    const chunked = await new ObservableStreamLoader(reader, (read, total) => chunkedProgress.push([read, total]))
        .loadChunked(4);
    assert.deepEqual([...chunked.toTypedArray(Uint8Array)], [...source]);
    assert.deepEqual(progress.at(-1), [8, 8]);
    assert.deepEqual(chunkedProgress.at(-1), [8, 8]);
});

test("recording serializer and lazy sequence round-trip frames across chunk borders", () => {
    const frames = [
        new Float32Array([1, 2, 3, 4]),
        new Float32Array([5, 6, 7, 8]),
        new Float32Array([9, 10, 11, 12]),
        new Float32Array([13, 14, 15, 16]),
        new Float32Array([17, 18, 19, 20]),
    ];
    const bytes = buildRecording({particleCount: 2, fps: 12, frames});
    const buffer = new ChunkedArrayBuffer(splitBytes(bytes, [5, 21, 37, 56]));

    const eager = SimulationSerializer.loadData(buffer);
    assert.equal(eager.meta.recordedRate, 12);
    assert.equal(eager.frames.length, frames.length);
    assert.deepEqual([...eager.frames[3]], [...frames[3]]);

    const sequence = SimulationSequence.fromBuffer(buffer);
    assert.equal(sequence.length, 5);
    assert.equal(sequence.getFrame(-1), null);
    assert.equal(sequence.getFrame(5), null);
    assert.deepEqual([...sequence.getFrame(0)], [...frames[0]]);
    const cached = sequence.getFrame(0);
    assert.equal(sequence.getFrame(0), cached);
    for (let i = 0; i < sequence.length; i++) sequence.getFrame(i);
    assert.ok(sequence._frameCache.size <= 4);
});

test("recording serializer rejects malformed headers and payloads", () => {
    const validFrame = new Float32Array([1, 2, 3, 4]);
    const bytes = buildRecording({particleCount: 2, fps: 10, frames: [validFrame]});

    const noFrames = bytes.slice();
    new Uint32Array(noFrames.buffer)[3] = 0;
    assert.throws(() => SimulationSerializer.loadData(new ChunkedArrayBuffer([noFrames.buffer])), /no frames/);

    const badRate = bytes.slice();
    new Uint32Array(badRate.buffer)[2] = 0;
    assert.throws(() => SimulationSerializer.loadData(new ChunkedArrayBuffer([badRate.buffer])), /frame rate/);

    const truncated = bytes.slice(0, bytes.length - 4);
    assert.throws(() => SimulationSerializer.loadData(new ChunkedArrayBuffer([exactBuffer(truncated)])), /Invalid size/);

    const badVersion = bytes.slice();
    new Uint32Array(badVersion.buffer)[1] = 99;
    assert.throws(() => SimulationSerializer.loadData(new ChunkedArrayBuffer([badVersion.buffer])), /Unsupported version/);
});

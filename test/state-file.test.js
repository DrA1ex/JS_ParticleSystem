import test from "node:test";
import assert from "node:assert/strict";

import {createStateBlob, readStateFile} from "../n_body/utils/state_file.js";

async function mutateBlob(blob, mutate) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    mutate(bytes);
    return new Blob([bytes]);
}

test("binary state round-trips flat particle buffers", async () => {
    const particles = new Float32Array([
        1, 2, 3, 4, 5,
        6, 7, 8, 9, 10,
    ]);
    const blob = createStateBlob({settings: {gravity: 2}, renderer: {scale: 3}, particles});
    const state = await readStateFile(blob);

    assert.deepEqual(state.settings, {gravity: 2});
    assert.deepEqual(state.renderer, {scale: 3});
    assert.deepEqual([...state.particles], [...particles]);
});

test("binary state exports legacy object particles without JSON particle arrays", async () => {
    const blob = createStateBlob({
        settings: {},
        renderer: null,
        particles: [
            {x: 1, y: 2, velX: 3, velY: 4, mass: 5},
            {x: 6, y: 7, velX: 8, velY: 9, mass: 10},
        ],
    });
    const state = await readStateFile(blob);
    assert.deepEqual([...state.particles], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test("state reader keeps legacy JSON compatibility", async () => {
    const legacy = {settings: {a: 1}, renderer: null, particles: [[1, 2, 3, 4, 5]]};
    assert.deepEqual(await readStateFile(new Blob([JSON.stringify(legacy)])), legacy);
});

test("state writer and reader reject invalid or corrupted data", async () => {
    assert.throws(() => createStateBlob({settings: {}, renderer: null, particles: new Float32Array(5)}), /invalid particle/);

    const good = createStateBlob({settings: {}, renderer: null, particles: new Float32Array(10)});
    const truncatedPrefix = new Blob([(await good.arrayBuffer()).slice(0, 10)]);
    await assert.rejects(readStateFile(truncatedPrefix));

    const badHeaderSize = await mutateBlob(good, bytes => new DataView(bytes.buffer).setUint32(8, 0xffffffff, true));
    await assert.rejects(readStateFile(badHeaderSize), /invalid header size/);

    const truncatedPayload = new Blob([(await good.arrayBuffer()).slice(0, -4)]);
    await assert.rejects(readStateFile(truncatedPayload), /Invalid particle payload/);

    const badVersion = await mutateBlob(good, bytes => {
        const headerLength = new DataView(bytes.buffer).getUint32(8, true);
        const header = JSON.parse(new TextDecoder().decode(bytes.subarray(12, 12 + headerLength)));
        header.version = 2;
        const encoded = new TextEncoder().encode(JSON.stringify(header));
        assert.equal(encoded.length, headerLength);
        bytes.set(encoded, 12);
    });
    await assert.rejects(readStateFile(badVersion), /Unsupported state format/);
});

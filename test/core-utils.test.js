import test from "node:test";
import assert from "node:assert/strict";

import {formatByteSize, formatTimeSpan, formatUnit, formatUnitSuffix} from "../n_body/utils/common.js";
import {findKey} from "../n_body/utils/enum.js";
import {exportParticleState, getParticleCount, getParticleVelX, getParticleVelY, getParticleX, getParticleY, isParticleBuffer, ITEM_SIZE} from "../n_body/utils/particles.js";
import {range} from "../n_body/utils/range.js";
import {DataSmoother} from "../n_body/utils/smoother.js";

test("particle helpers support flat and object layouts", () => {
    const flat = new Float32Array([
        1, 2, 3, 4, 5,
        6, 7, 8, 9, 10,
    ]);
    const objects = [
        {x: 1, y: 2, velX: 3, velY: 4, mass: 5},
        {x: 6, y: 7, velX: 8, velY: 9, mass: 10},
    ];

    assert.equal(ITEM_SIZE, 5);
    assert.equal(isParticleBuffer(flat), true);
    assert.equal(isParticleBuffer(objects), false);
    assert.equal(getParticleCount(null), 0);
    assert.equal(getParticleCount(flat), 2);
    assert.equal(getParticleCount(objects), 2);

    for (const particles of [flat, objects]) {
        assert.equal(getParticleX(particles, 1), 6);
        assert.equal(getParticleY(particles, 1), 7);
        assert.equal(getParticleVelX(particles, 1), 8);
        assert.equal(getParticleVelY(particles, 1), 9);
        assert.deepEqual(exportParticleState(particles, 1), [[1, 2, 3, 4, 5]]);
    }
    assert.equal(exportParticleState(null), null);
});

test("DataSmoother drops warmup values, rotates history and filters spikes", () => {
    const smoother = new DataSmoother(3, 1);
    assert.equal(smoother.postValue(100), undefined);
    assert.equal(smoother.postValue(3), 3);
    assert.equal(smoother.postValue(6), 4.5);
    assert.equal(smoother.postValue(9), 6);
    assert.equal(smoother.postValue(12), 9);

    const filtered = new DataSmoother(4, 0, true);
    filtered.postValue(10, true);
    assert.equal(filtered.postValue(100), 15);
    assert.equal(filtered.postValue(1), 12.5);
});

test("unit, enum and range helpers cover common formatting paths", () => {
    assert.equal(formatUnitSuffix(1, ["item", "items"]), "item");
    assert.equal(formatUnitSuffix(2, ["item", "items"]), "items");
    assert.equal(formatUnitSuffix(2, "ms"), "ms");
    assert.equal(formatUnit(1500, "B", 1), "1.5 KB");
    assert.equal(formatByteSize(1024), "1.00 KB");
    assert.equal(formatTimeSpan(1000), "1 second");
    assert.equal(formatTimeSpan(2500, 1), "2.5 seconds");
    assert.equal(findKey({a: 1, b: 2}, 2), "b");
    assert.equal(findKey({a: 1}, 3), null);
    assert.deepEqual([...range(1, 7, 2)], [1, 3, 5]);
});

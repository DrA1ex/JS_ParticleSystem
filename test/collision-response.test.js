import test from "node:test";
import assert from "node:assert/strict";

import {
    COLLISION_MIN_CLOSING_SPEED_SQ,
    collisionContactModeCode,
    collisionContactScale,
    collisionDeltaScale,
    collisionFallbackNormal,
    collisionMinDistanceSq,
} from "../n_body/simulation/collision_response.js";

test("collision helpers provide deterministic antisymmetric fallback normals", () => {
    const ab = collisionFallbackNormal(10, 20);
    const ba = collisionFallbackNormal(20, 10);
    assert.ok(Math.abs(Math.hypot(...ab) - 1) < 1e-12);
    assert.ok(Math.abs(ab[0] + ba[0]) < 1e-12);
    assert.ok(Math.abs(ab[1] + ba[1]) < 1e-12);
    assert.deepEqual(collisionFallbackNormal(10, 20), ab);
    assert.equal(COLLISION_MIN_CLOSING_SPEED_SQ, 1e-10);
    assert.equal(collisionMinDistanceSq(0), 1e-12);
    assert.equal(collisionMinDistanceSq(100), 1e-8);
});

test("dense contact modes have predictable ordering and codes", () => {
    assert.equal(collisionContactScale(0, "full"), 0);
    assert.equal(collisionContactScale(4, "full"), 1);
    assert.equal(collisionContactScale(4, "balanced"), 0.5);
    assert.equal(collisionContactScale(4, "average"), 0.25);
    assert.equal(collisionContactScale(4, "unknown"), 0.5);
    assert.equal(collisionContactModeCode("full"), 0);
    assert.equal(collisionContactModeCode("balanced"), 1);
    assert.equal(collisionContactModeCode("average"), 2);
    assert.equal(collisionContactModeCode("other"), 1);
});

test("collision delta cap limits only excessive accumulated responses", () => {
    assert.equal(collisionDeltaScale(10, 0, 4, 0, "balanced", true), 0.5);
    assert.equal(collisionDeltaScale(10, 0, 4, 100, "balanced", false), 0.5);
    assert.equal(collisionDeltaScale(1, 0, 4, 100, "balanced", true), 0.5);

    const capped = collisionDeltaScale(100, 0, 4, 25, "full", true);
    assert.equal(capped, 0.05);
    assert.equal(collisionDeltaScale(10, 0, 0, 25, "full", true), 0);
});

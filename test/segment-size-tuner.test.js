import test from "node:test";
import assert from "node:assert/strict";

import {SegmentSizeAutoTuner} from "../n_body/backend/segment_size_tuner.js";

function settings({enabled = true, base = 32, count = 100} = {}) {
    return {
        simulation: {autoTuneSegmentSize: enabled, segmentMaxCount: base},
        physics: {particleCount: count},
    };
}

test("segment tuner is inert when disabled", () => {
    const tuner = new SegmentSizeAutoTuner(settings({enabled: false, base: 40}));
    assert.equal(tuner.finished, true);
    assert.equal(tuner.currentSize, 40);
    tuner.record(12);
    assert.deepEqual(tuner.getStats(40), {
        enabled: false,
        status: "off",
        actualSize: 40,
        selectedSize: 40,
        candidateSize: 40,
        candidates: [],
        sample: 0,
        samplesPerCandidate: 2,
        lastStepTime: 12,
        lastAverageTime: null,
    });
});

test("segment tuner samples every candidate and selects fastest average", () => {
    const tuner = new SegmentSizeAutoTuner(settings({base: 12, count: 24}));
    assert.deepEqual(tuner.candidates, [8, 12, 16, 24]);
    const timings = new Map([[8, 8], [12, 5], [16, 2], [24, 4]]);

    while (!tuner.finished) {
        const current = tuner.currentSize;
        tuner.record(timings.get(current));
        tuner.record(timings.get(current));
    }

    assert.equal(tuner.selectedSize, 16);
    assert.equal(tuner.currentSize, 16);
    const stats = tuner.getStats(16);
    assert.equal(stats.status, "done");
    assert.equal(stats.lastAverageTime, 2);
    assert.equal(stats.sample, 2);
});

test("candidate construction clamps to particle count and removes duplicates", () => {
    const tuner = new SegmentSizeAutoTuner(settings({base: 8, count: 9}));
    assert.deepEqual(tuner.candidates, [8]);
    assert.equal(tuner.finished, true);
});

import test from "node:test";
import assert from "node:assert/strict";
import {installBrowserStubs} from "../test-support/browser-env.js";

installBrowserStubs();

const {expandBenchmarkCases} = await import("../n_body/utils/benchmark.js");
const {buildPerformanceSummaryRows} = await import("../n_body/utils/perf_report.js");

test("generic benchmark accepts explicit upload-mode cases", () => {
    const cases = expandBenchmarkCases([
        {name: "stream-start", upload_mode: "stream"},
        {name: "buffer-data", upload_mode: "bufferData"},
        {name: "buffer-sub-data", upload_mode: "bufferSubData"},
        {name: "stream-end", upload_mode: "stream"},
    ]);

    assert.deepEqual(cases.map(item => item.name), [
        "stream-start",
        "buffer-data",
        "buffer-sub-data",
        "stream-end",
    ]);
    assert.deepEqual(cases.map(item => item.overrides[0].value), [
        "stream",
        "bufferData",
        "bufferSubData",
        "stream",
    ]);
});


test("generic benchmark rejects removed settings instead of silently ignoring them", () => {
    assert.throws(
        () => expandBenchmarkCases([{name: "stale", worker_mt_tree_strategy: "hybrid"}]),
        /Unknown benchmark setting: worker_mt_tree_strategy/
    );
});

test("performance summary exposes upload-mode render timings", () => {
    const metric = (avg, p95 = avg) => ({avg, p95});
    const rows = buildPerformanceSummaryRows([{
        type: "n-body-performance-report",
        comparisonKey: {
            backend: "worker_mt",
            workerThreads: 16,
            bufferUploadMode: "stream",
        },
        summary: {
            measuredFps: metric(119.5),
            rafIntervals: metric(8.37),
            render: {
                total: metric(0.8, 1.2),
                upload: metric(0.25, 0.5),
                uploadedBytes: metric(4 * 1024 * 1024),
                preload: metric(0.1),
                drawCall: metric(0.3),
                gpuDraw: metric(0.2),
            },
            physics: {},
            workerMT: {},
        },
    }]);

    assert.equal(rows.length, 1);
    assert.equal(rows[0].uploadMode, "stream");
    assert.equal(rows[0].render, 0.8);
    assert.equal(rows[0].renderP95, 1.2);
    assert.equal(rows[0].upload, 0.25);
    assert.equal(rows[0].uploadP95, 0.5);
    assert.equal(rows[0].uploadMiB, 4);
    assert.equal(rows[0].draw, 0.3);
    assert.equal(rows[0].gpuDraw, 0.2);
});

import {zip, strToU8} from "fflate";
import {AppSimulationSettings} from "../settings/app.js";
import {ComponentType} from "../settings/base.js";
import {SimulationStateEnum} from "../controllers/enums.js";
import {collectPerformanceReport, buildPerformanceSummaryRows} from "./perf_report.js";
import {saveFile} from "./file.js";

const DEFAULT_REPORT_OPTIONS = Object.freeze({
    frames: 240,
    blocks: 4,
    intervalMs: 5000,
    includeSamples: false,
});
const CASE_META_KEYS = new Set(["name", "label", "$name"]);
const DEFAULT_MAX_CASES = 128;
const HARD_MAX_CASES = 512;
let activeBenchmarkController = null;

function clampInt(value, fallback, min, max) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function clampNumber(value, fallback, min, max) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function abortError() {
    return new DOMException("Benchmark cancelled", "AbortError");
}

function throwIfAborted(signal) {
    if (signal?.aborted) {
        throw abortError();
    }
}

function delay(ms, signal) {
    if (!(ms > 0)) {
        throwIfAborted(signal);
        return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
        const timer = setTimeout(done, ms);
        const onAbort = () => {
            clearTimeout(timer);
            cleanup();
            reject(abortError());
        };
        function cleanup() {
            signal?.removeEventListener("abort", onAbort);
        }
        function done() {
            cleanup();
            resolve();
        }
        signal?.addEventListener("abort", onAbort, {once: true});
    });
}

async function waitUntil(predicate, {timeoutMs, signal, description}) {
    const startedAt = performance.now();
    while (!predicate()) {
        throwIfAborted(signal);
        if (performance.now() - startedAt > timeoutMs) {
            throw new Error(`Timed out waiting for ${description}`);
        }
        await delay(25, signal);
    }
}

function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
}

function buildSettingRegistry() {
    const aliases = new Map();
    const descriptors = [];

    const addAlias = (alias, descriptor) => {
        if (!alias) return;
        const normalized = String(alias).trim();
        const entries = aliases.get(normalized) || [];
        entries.push(descriptor);
        aliases.set(normalized, entries);
    };

    for (const [groupName, group] of Object.entries(AppSimulationSettings.Types)) {
        for (const [name, prop] of Object.entries(group.type.Properties)) {
            const descriptor = {groupName, name, prop};
            descriptors.push(descriptor);
            addAlias(name, descriptor);
            addAlias(prop.key, descriptor);
            addAlias(`${groupName}.${name}`, descriptor);
            addAlias(`${groupName}.${prop.key}`, descriptor);
        }
    }

    return {aliases, descriptors};
}

const SETTING_REGISTRY = buildSettingRegistry();

function resolveSetting(key) {
    const entries = SETTING_REGISTRY.aliases.get(String(key).trim()) || [];
    if (entries.length === 0) {
        throw new Error(`Unknown benchmark setting: ${key}`);
    }
    const unique = entries.filter((entry, index) => entries.indexOf(entry) === index);
    if (unique.length > 1) {
        const options = unique.map(entry => `${entry.groupName}.${entry.name}`).join(", ");
        throw new Error(`Ambiguous benchmark setting '${key}'. Use one of: ${options}`);
    }
    return unique[0];
}

function parseBenchmarkValue(prop, rawValue) {
    if (rawValue === null || rawValue === undefined) {
        return prop.parse(rawValue);
    }
    if (prop.type === "enum" || prop.type === "string") {
        return prop.parse(String(rawValue));
    }
    if (prop.type === "bool" && typeof rawValue !== "boolean") {
        return prop.parse(String(rawValue));
    }
    return prop.parse(rawValue);
}

function parseCaseOverrides(rawCase) {
    if (!rawCase || typeof rawCase !== "object" || Array.isArray(rawCase)) {
        throw new Error("Each benchmark case must be an object");
    }

    const name = rawCase.name ?? rawCase.label ?? rawCase.$name ?? null;
    const overrides = [];
    for (const [key, rawValue] of Object.entries(rawCase)) {
        if (CASE_META_KEYS.has(key)) continue;
        if (Array.isArray(rawValue)) {
            throw new Error(`Explicit case '${name || "unnamed"}' contains an array for '${key}'. Arrays are only expanded in object-form cases.`);
        }
        const descriptor = resolveSetting(key);
        overrides.push({
            key,
            ...descriptor,
            rawValue,
            value: parseBenchmarkValue(descriptor.prop, rawValue),
        });
    }
    return {name, overrides};
}

function expandCartesianCases(spec, maxCases) {
    if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
        throw new Error("Object-form benchmark cases must be an object");
    }

    const entries = Object.entries(spec).map(([key, rawValues]) => {
        const descriptor = resolveSetting(key);
        const values = Array.isArray(rawValues) ? rawValues : [rawValues];
        if (values.length === 0) {
            throw new Error(`Benchmark setting '${key}' has an empty value list`);
        }
        return {key, descriptor, values};
    });

    const total = entries.reduce((count, entry) => count * entry.values.length, 1);
    if (total > maxCases) {
        throw new Error(`Benchmark expands to ${total} cases; maxCases is ${maxCases}`);
    }

    let cases = [{name: null, overrides: []}];
    for (const entry of entries) {
        const next = [];
        for (const current of cases) {
            for (const rawValue of entry.values) {
                next.push({
                    name: null,
                    overrides: current.overrides.concat({
                        key: entry.key,
                        ...entry.descriptor,
                        rawValue,
                        value: parseBenchmarkValue(entry.descriptor.prop, rawValue),
                    }),
                });
            }
        }
        cases = next;
    }
    return cases;
}

export function expandBenchmarkCases(spec, maxCases = DEFAULT_MAX_CASES) {
    const limit = clampInt(maxCases, DEFAULT_MAX_CASES, 1, HARD_MAX_CASES);
    if (Array.isArray(spec)) {
        if (spec.length === 0) {
            throw new Error("Benchmark case list is empty");
        }
        if (spec.length > limit) {
            throw new Error(`Benchmark contains ${spec.length} cases; maxCases is ${limit}`);
        }
        return spec.map(parseCaseOverrides);
    }
    return expandCartesianCases(spec || {}, limit);
}

function validateCases(cases, baseSettings) {
    const errors = [];
    for (let index = 0; index < cases.length; index++) {
        for (const override of cases[index].overrides) {
            if (override.prop.requiresReload) {
                errors.push(`case ${index + 1}: '${override.key}' requires a page reload`);
            }
            if (override.prop.breaks.includes(ComponentType.particles) &&
                override.value !== baseSettings[override.groupName][override.name]) {
                errors.push(`case ${index + 1}: '${override.key}' changes the particle universe and is incompatible with restoring one shared snapshot`);
            }
        }
    }
    if (errors.length) {
        throw new Error(`Invalid benchmark cases:\n- ${errors.join("\n- ")}`);
    }
}

function buildSettings(baseSerialized, overrides) {
    const serialized = deepClone(baseSerialized);
    for (const override of overrides) {
        serialized[override.groupName][override.name] = override.value;
    }
    return AppSimulationSettings.deserialize(serialized);
}

function caseValues(overrides) {
    const values = {};
    for (const override of overrides) {
        values[override.key] = override.value;
    }
    return values;
}

function caseName(index, item) {
    if (item.name) return String(item.name);
    if (item.overrides.length === 0) return `case-${index + 1}-baseline`;
    return item.overrides.map(override => `${override.key}=${String(override.value)}`).join("__");
}

function sanitizeFileName(value, fallback = "case") {
    const normalized = String(value || fallback)
        .normalize("NFKD")
        .replace(/[^a-zA-Z0-9._=-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 160);
    return normalized || fallback;
}

function captureSnapshot(app) {
    if (!(app.particles instanceof Float32Array) || app.particles.length === 0) {
        throw new Error("No live particle buffer is available for a benchmark snapshot");
    }
    return {
        createdAt: new Date().toISOString(),
        particles: new Float32Array(app.particles),
        settings: app.settings.serialize(),
        renderer: {
            scale: app.renderer.scale / app.renderer.dpr,
            relativeOffset: app.renderer.centeredRelativeOffset(),
        },
        simulationState: app.simulationCtrl.currentState,
    };
}

async function waitForLiveFrame(app, timeoutMs, signal) {
    await waitUntil(() =>
        app.simulationCtrl.currentState === SimulationStateEnum.active &&
        app.hasCurrentFrame &&
        app.particles instanceof Float32Array &&
        app.particles.length > 0,
    {timeoutMs, signal, description: "the restored simulation to become active"});
}

async function waitForPhysicsSteps(app, steps, timeoutMs, signal) {
    if (!(steps > 0)) return;
    const target = app.physicsStepCount + steps;
    await waitUntil(() => app.physicsStepCount >= target,
        {timeoutMs, signal, description: `${steps} warm-up physics steps`});
}

function csvEscape(value) {
    if (value === null || value === undefined) return "";
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function rowsToCsv(rows) {
    if (!rows.length) return "";
    const columns = [...new Set(rows.flatMap(row => Object.keys(row)))];
    return [
        columns.map(csvEscape).join(","),
        ...rows.map(row => columns.map(column => csvEscape(row[column])).join(",")),
    ].join("\n");
}

function benchmarkFileName(name, createdAt) {
    const timestamp = createdAt.replace(/[:.]/g, "-");
    return `n-body-benchmark-${sanitizeFileName(name, "run")}-${timestamp}.zip`;
}

function createArchive(result) {
    const files = {};
    files["manifest.json"] = strToU8(JSON.stringify(result.manifest, null, 2));
    files["config.json"] = strToU8(JSON.stringify(result.config, null, 2));
    files["summary.json"] = strToU8(JSON.stringify(result.summary, null, 2));
    files["summary.csv"] = strToU8(rowsToCsv(result.summary));
    for (const item of result.cases) {
        const prefix = String(item.index).padStart(3, "0");
        const name = sanitizeFileName(item.name, `case-${prefix}`);
        const {report, ...caseMetadata} = item;
        files[`cases/${prefix}-${name}.json`] = strToU8(JSON.stringify(caseMetadata, null, 2));
        if (report) {
            files[`reports/${prefix}-${name}.json`] = strToU8(JSON.stringify(report, null, 2));
        }
    }

    return new Promise((resolve, reject) => {
        zip(files, {level: 6}, (error, archive) => {
            if (error) reject(error);
            else resolve(archive);
        });
    });
}

function publicConfig(options, expandedCases) {
    return {
        name: options.name,
        warmupSteps: options.warmupSteps,
        stabilizationMs: options.stabilizationMs,
        timeoutMs: options.timeoutMs,
        maxCases: options.maxCases,
        continueOnError: options.continueOnError,
        restoreAfter: options.restoreAfter,
        download: options.download,
        report: options.report,
        cases: options.cases,
        expandedCases: expandedCases.map((item, index) => ({
            index: index + 1,
            name: caseName(index, item),
            settings: caseValues(item.overrides),
        })),
    };
}

function normalizeOptions(options) {
    const report = {...DEFAULT_REPORT_OPTIONS, ...(options.report || {})};
    return {
        name: options.name || "benchmark",
        cases: options.cases || {},
        warmupSteps: clampInt(options.warmupSteps, 3, 0, 1000),
        stabilizationMs: clampNumber(options.stabilizationMs, 500, 0, 60000),
        timeoutMs: clampNumber(options.timeoutMs, 180000, 1000, 1800000),
        maxCases: clampInt(options.maxCases, DEFAULT_MAX_CASES, 1, HARD_MAX_CASES),
        continueOnError: options.continueOnError !== false,
        restoreAfter: options.restoreAfter !== false,
        download: options.download !== false,
        report: {
            frames: clampInt(report.frames, DEFAULT_REPORT_OPTIONS.frames, 1, 5000),
            blocks: clampInt(report.blocks, DEFAULT_REPORT_OPTIONS.blocks, 1, 20),
            intervalMs: clampNumber(report.intervalMs, DEFAULT_REPORT_OPTIONS.intervalMs, 0, 60000),
            includeSamples: report.includeSamples === true,
        },
    };
}

async function restoreCase(app, snapshot, settings, options, signal) {
    const startedAt = performance.now();
    app.reconfigure(settings, snapshot.particles, snapshot.renderer, {
        updateUrl: false,
        forceBackendRestart: true,
    });
    await waitForLiveFrame(app, options.timeoutMs, signal);
    await waitForPhysicsSteps(app, options.warmupSteps, options.timeoutMs, signal);
    await delay(options.stabilizationMs, signal);
    return performance.now() - startedAt;
}

async function restoreOriginal(app, snapshot, timeoutMs) {
    const settings = AppSimulationSettings.deserialize(snapshot.settings);
    app.reconfigure(settings, snapshot.particles, snapshot.renderer, {
        updateUrl: false,
        forceBackendRestart: true,
    });
    await waitForLiveFrame(app, timeoutMs, null);
    if (snapshot.simulationState === SimulationStateEnum.paused) {
        app.simulationCtrl.setState(SimulationStateEnum.paused);
    }
}

export async function runPerformanceBenchmark(app, rawOptions = {}) {
    if (activeBenchmarkController) {
        throw new Error("Another n-body benchmark is already running");
    }

    const options = normalizeOptions(rawOptions);
    const cases = expandBenchmarkCases(options.cases, options.maxCases);
    validateCases(cases, app.settings);

    const controller = new AbortController();
    const signal = controller.signal;
    activeBenchmarkController = controller;
    const createdAt = new Date().toISOString();
    const result = {
        type: "n-body-performance-benchmark",
        version: 1,
        createdAt,
        finishedAt: null,
        status: "running",
        config: null,
        manifest: null,
        summary: [],
        cases: [],
    };

    await waitUntil(() => app.particles instanceof Float32Array && app.particles.length > 0 && app.hasCurrentFrame,
        {timeoutMs: options.timeoutMs, signal, description: "a live frame before snapshot capture"});
    const snapshot = captureSnapshot(app);
    const baseSettings = AppSimulationSettings.deserialize(snapshot.settings);
    result.config = publicConfig(options, cases);
    result.manifest = {
        type: result.type,
        version: result.version,
        name: options.name,
        createdAt,
        status: result.status,
        snapshot: {
            createdAt: snapshot.createdAt,
            particleCount: snapshot.particles.length / 5,
            particleBytes: snapshot.particles.byteLength,
            settings: snapshot.settings,
            renderer: snapshot.renderer,
        },
        caseCount: cases.length,
        completedCases: 0,
        failedCases: 0,
        cancelled: false,
    };

    console.info(`[n-body] benchmark '${options.name}' captured a ${(snapshot.particles.byteLength / 1024 / 1024).toFixed(1)} MiB snapshot; ${cases.length} case(s)`);

    try {
        for (let index = 0; index < cases.length; index++) {
            throwIfAborted(signal);
            const spec = cases[index];
            const name = caseName(index, spec);
            const caseResult = {
                index: index + 1,
                name,
                settings: caseValues(spec.overrides),
                status: "running",
                startedAt: new Date().toISOString(),
                finishedAt: null,
                restoreAndWarmupMs: null,
                report: null,
                error: null,
            };
            result.cases.push(caseResult);
            console.info(`[n-body] benchmark case ${index + 1}/${cases.length}: ${name}`);

            try {
                const settings = buildSettings(snapshot.settings, spec.overrides);
                caseResult.resolvedSettings = settings.serialize();
                caseResult.restoreAndWarmupMs = await restoreCase(app, snapshot, settings, options, signal);
                caseResult.report = await collectPerformanceReport(app, {
                    ...options.report,
                    download: false,
                    copy: false,
                    log: false,
                    signal,
                });
                caseResult.report.benchmark = {
                    runName: options.name,
                    caseIndex: index + 1,
                    caseName: name,
                    caseSettings: caseResult.settings,
                    snapshotCreatedAt: snapshot.createdAt,
                    warmupSteps: options.warmupSteps,
                    stabilizationMs: options.stabilizationMs,
                };
                caseResult.status = "completed";
                result.manifest.completedCases += 1;
            } catch (error) {
                if (error?.name === "AbortError") throw error;
                caseResult.status = "failed";
                caseResult.error = {name: error?.name || "Error", message: error?.message || String(error), stack: error?.stack || null};
                result.manifest.failedCases += 1;
                console.error(`[n-body] benchmark case failed: ${name}`, error);
                if (!options.continueOnError) throw error;
            } finally {
                caseResult.finishedAt = new Date().toISOString();
            }
        }
        result.status = result.manifest.failedCases ? "completed-with-errors" : "completed";
    } catch (error) {
        if (error?.name === "AbortError") {
            result.status = "cancelled";
            result.manifest.cancelled = true;
            console.warn("[n-body] benchmark cancelled");
        } else {
            result.status = "failed";
            result.manifest.fatalError = {name: error?.name || "Error", message: error?.message || String(error), stack: error?.stack || null};
            throw error;
        }
    } finally {
        if (options.restoreAfter) {
            try {
                console.info("[n-body] restoring the original benchmark snapshot");
                await restoreOriginal(app, snapshot, options.timeoutMs);
            } catch (restoreError) {
                result.manifest.restoreError = {name: restoreError?.name || "Error", message: restoreError?.message || String(restoreError)};
                console.error("[n-body] failed to restore the original snapshot", restoreError);
            }
        }
        activeBenchmarkController = null;
    }

    const completedCases = result.cases.filter(item => item.report);
    const reports = completedCases.map(item => item.report);
    result.summary = buildPerformanceSummaryRows(reports).map((row, index) => {
        const caseItem = completedCases[index];
        const settingColumns = Object.fromEntries(
            Object.entries(caseItem?.settings || {}).map(([key, value]) => [`case.${key}`, value])
        );
        return {
            caseIndex: caseItem?.index ?? index + 1,
            caseName: caseItem?.name ?? `case-${index + 1}`,
            ...settingColumns,
            ...row,
        };
    });
    result.finishedAt = new Date().toISOString();
    result.manifest.finishedAt = result.finishedAt;
    result.manifest.status = result.status;
    result.manifest.cases = result.cases.map(item => ({
        index: item.index,
        name: item.name,
        status: item.status,
        settings: item.settings,
        error: item.error,
    }));

    const archive = await createArchive(result);
    window.nBodyLastBenchmark = result;
    window.nBodyLastBenchmarkArchive = archive;
    console.table(result.summary);
    console.info(`[n-body] benchmark ${result.status}; archive ${(archive.byteLength / 1024).toFixed(1)} KiB`);

    if (options.download) {
        saveFile(archive, benchmarkFileName(options.name, createdAt), "application/zip");
    }
    return result;
}

export function cancelPerformanceBenchmark() {
    if (!activeBenchmarkController) return false;
    activeBenchmarkController.abort();
    return true;
}

export function installBenchmarkConsole(app) {
    window.nBodyRunBenchmark = options => runPerformanceBenchmark(app, options);
    window.nBodyBenchmark = window.nBodyRunBenchmark;
    window.nBodyCancelBenchmark = () => cancelPerformanceBenchmark();
    window.nBodyBenchmarkHelp = () => {
        const message = [
            "Cartesian product benchmark:",
            "  await window.nBodyRunBenchmark({",
            "    name: 'heavy-tree',",
            "    cases: {",
            "      worker_threads: [12, 16, 20],",
            "      segment_max_count: [24, 32, 48]",
            "    },",
            "    warmupSteps: 3,",
            "    stabilizationMs: 500,",
            "    report: {frames: 240, blocks: 4, intervalMs: 5000}",
            "  })",
            "",
            "Explicit case list:",
            "  await window.nBodyRunBenchmark({",
            "    name: 'selected-cases',",
            "    cases: [",
            "      {name: 'baseline', worker_threads: 16, segment_max_count: 32},",
            "      {name: 'lower-leaf-size', worker_threads: 16, segment_max_count: 24}",
            "    ]",
            "  })",
            "",
            "The current universe is snapshotted once, restored before every case, and restored again after the run.",
            "Accepted setting keys: query keys, property names, or group.property paths.",
            "A ZIP with manifest.json, config.json, summary.json/csv, case metadata and all reports is downloaded by default.",
            "Compare WebGL upload modes with the regular benchmark runner:",
            "  await window.nBodyRunBenchmark({",
            "    name: 'webgl-buffer-upload-modes',",
            "    cases: [",
            "      {name: 'stream-start', upload_mode: 'stream'},",
            "      {name: 'buffer-data-1', upload_mode: 'bufferData'},",
            "      {name: 'buffer-sub-data-1', upload_mode: 'bufferSubData'},",
            "      {name: 'stream-middle', upload_mode: 'stream'},",
            "      {name: 'buffer-sub-data-2', upload_mode: 'bufferSubData'},",
            "      {name: 'buffer-data-2', upload_mode: 'bufferData'},",
            "      {name: 'stream-end', upload_mode: 'stream'}",
            "    ],",
            "    warmupSteps: 5,",
            "    stabilizationMs: 1000,",
            "    report: {frames: 240, blocks: 4, intervalMs: 5000}",
            "  })",
            "Cancel a running suite with window.nBodyCancelBenchmark().",
        ].join("\n");
        console.info(message);
        return message;
    };
}

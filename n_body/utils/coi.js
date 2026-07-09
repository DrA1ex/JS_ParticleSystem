import {BackendType} from "../settings/enum.js";

const COI_RELOAD_ATTEMPT_KEY = "n-body-coi-reload-attempted";
const COI_RELOAD_ATTEMPT_VERSION = "2";
const COI_SERVICE_WORKER_FILE = "../coi-serviceworker.js";
const COI_SERVICE_WORKER_SCOPE = "../";
const COI_SERVICE_WORKER_TIMEOUT_MS = 5000;

export function isWorkerMTBackend(settings) {
    return settings?.simulation?.backend === BackendType.workerMt;
}

export function getCrossOriginIsolationStatus() {
    const serviceWorkerSupported = typeof navigator !== "undefined" && "serviceWorker" in navigator;
    const controller = serviceWorkerSupported ? navigator.serviceWorker.controller : null;
    const serviceWorkerScript = controller?.scriptURL || null;

    return {
        secureContext: typeof window !== "undefined" ? !!window.isSecureContext : false,
        crossOriginIsolated: typeof window !== "undefined" ? !!window.crossOriginIsolated : false,
        sharedArrayBuffer: typeof SharedArrayBuffer !== "undefined",
        serviceWorkerSupported,
        serviceWorkerControlled: !!controller,
        coiServiceWorkerControlled: !!serviceWorkerScript && serviceWorkerScript.includes("coi-serviceworker.js"),
        serviceWorkerScript,
    };
}

export function isSharedMemoryReady() {
    const status = getCrossOriginIsolationStatus();
    return status.crossOriginIsolated && status.sharedArrayBuffer;
}

export function clearCrossOriginIsolationReloadAttempt() {
    try {
        sessionStorage.removeItem(COI_RELOAD_ATTEMPT_KEY);
    } catch (_) {
        // Ignore storage errors in private/restricted modes.
    }
}

export async function ensureCrossOriginIsolationForWorkerMT(settings, options = {}) {
    const {interactive = false} = options;
    if (!isWorkerMTBackend(settings)) {
        clearCrossOriginIsolationReloadAttempt();
        return {required: false, ready: isSharedMemoryReady(), reloading: false, status: getCrossOriginIsolationStatus()};
    }

    let status = getCrossOriginIsolationStatus();
    if (status.crossOriginIsolated && status.sharedArrayBuffer) {
        clearCrossOriginIsolationReloadAttempt();
        return {required: true, ready: true, reloading: false, status};
    }

    if (!status.secureContext) {
        console.warn("worker-mt requires a secure context for SharedArrayBuffer.");
        return {required: true, ready: false, reloading: false, reason: "secure context unavailable", status};
    }

    if (!status.serviceWorkerSupported) {
        console.warn("worker-mt requires SharedArrayBuffer, but Service Worker is not supported in this browser.");
        return {required: true, ready: false, reloading: false, reason: "service worker unavailable", status};
    }

    try {
        await registerCrossOriginIsolationServiceWorker();
    } catch (error) {
        console.warn("Failed to register COOP/COEP service worker for worker-mt", error);
        return {required: true, ready: false, reloading: false, reason: "service worker registration failed", status};
    }

    status = getCrossOriginIsolationStatus();
    if (status.crossOriginIsolated && status.sharedArrayBuffer) {
        clearCrossOriginIsolationReloadAttempt();
        return {required: true, ready: true, reloading: false, status};
    }

    if (hasReloadAttempt()) {
        console.warn("COOP/COEP service worker is registered, but the page is still not cross-origin isolated.", status);
        return {required: true, ready: false, reloading: false, reason: "cross-origin isolation unavailable after reload", status};
    }

    const shouldReload = interactive
        ? window.confirm([
            "worker-mt needs SharedArrayBuffer and cross-origin isolation.",
            "A local COOP/COEP service worker has been installed for n_body.",
            "Reload the page now to enable real multithreaded worker mode?"
        ].join("\n"))
        : true;

    if (!shouldReload) {
        return {required: true, ready: false, reloading: false, reason: "reload declined", status};
    }

    markReloadAttempt();
    window.location.reload();
    return {required: true, ready: false, reloading: true, status};
}

async function registerCrossOriginIsolationServiceWorker() {
    const scriptUrl = new URL(COI_SERVICE_WORKER_FILE, import.meta.url);
    const scopeUrl = new URL(COI_SERVICE_WORKER_SCOPE, import.meta.url);
    const registration = await withTimeout(
        navigator.serviceWorker.register(scriptUrl, {scope: scopeUrl, updateViaCache: "none"}),
        COI_SERVICE_WORKER_TIMEOUT_MS,
        "COI service worker registration timed out"
    );

    await withTimeout(
        navigator.serviceWorker.ready,
        COI_SERVICE_WORKER_TIMEOUT_MS,
        "COI service worker readiness timed out"
    );

    return registration;
}

function withTimeout(promise, timeoutMs, message) {
    let timeoutId = null;
    const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
    });

    return Promise.race([promise, timeout]).finally(() => {
        clearTimeout(timeoutId);
    });
}

function hasReloadAttempt() {
    try {
        return sessionStorage.getItem(COI_RELOAD_ATTEMPT_KEY) === COI_RELOAD_ATTEMPT_VERSION;
    } catch (_) {
        return false;
    }
}

function markReloadAttempt() {
    try {
        sessionStorage.setItem(COI_RELOAD_ATTEMPT_KEY, COI_RELOAD_ATTEMPT_VERSION);
    } catch (_) {
        // Ignore storage errors in private/restricted modes.
    }
}

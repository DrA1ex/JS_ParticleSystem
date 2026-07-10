export const BUILD_ID = typeof __NBODY_BUILD_ID__ !== "undefined"
    ? __NBODY_BUILD_ID__
    : "dev";

export const WORKER_PROTOCOL_VERSION = 2;

export function withBuildId(path, base = null) {
    if (base) {
        const url = new URL(path, base);
        url.searchParams.set("build", BUILD_ID);
        return url;
    }

    const separator = path.includes("?") ? "&" : "?";
    return `${path}${separator}build=${encodeURIComponent(BUILD_ID)}`;
}

export function assertWorkerRuntime(metadata, label = "worker") {
    if (!metadata || metadata.buildId !== BUILD_ID || metadata.protocolVersion !== WORKER_PROTOCOL_VERSION) {
        const actualBuild = metadata?.buildId ?? "missing";
        const actualProtocol = metadata?.protocolVersion ?? "missing";
        throw new Error(
            `${label} runtime mismatch: expected build ${BUILD_ID} / protocol ${WORKER_PROTOCOL_VERSION}, ` +
            `got build ${actualBuild} / protocol ${actualProtocol}. Reload the page to refresh worker scripts.`
        );
    }
}

const COOP_HEADER = "Cross-Origin-Opener-Policy";
const COEP_HEADER = "Cross-Origin-Embedder-Policy";
const CORP_HEADER = "Cross-Origin-Resource-Policy";

self.addEventListener("install", (event) => {
    event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
    const request = event.request;
    if (request.method !== "GET") {
        return;
    }

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) {
        return;
    }

    event.respondWith(fetchWithIsolationHeaders(request));
});

async function fetchWithIsolationHeaders(request) {
    const response = await fetch(request);

    // Opaque/opaque-redirect responses cannot be safely rewrapped. This should
    // not normally happen for same-origin requests, but keep the service worker
    // conservative if a browser returns one.
    if (response.type === "opaque" || response.type === "opaqueredirect") {
        return response;
    }

    const headers = new Headers(response.headers);
    headers.set(COOP_HEADER, "same-origin");
    headers.set(COEP_HEADER, "require-corp");
    headers.set(CORP_HEADER, "same-origin");

    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
    });
}

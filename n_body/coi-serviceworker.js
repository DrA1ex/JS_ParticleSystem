const COOP_HEADER = "Cross-Origin-Opener-Policy";
const COEP_HEADER = "Cross-Origin-Embedder-Policy";
const CORP_HEADER = "Cross-Origin-Resource-Policy";
const NULL_BODY_STATUSES = new Set([204, 205, 304]);

self.addEventListener("install", (event) => {
    event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
    event.waitUntil((async () => {
        if (self.registration.navigationPreload) {
            try {
                await self.registration.navigationPreload.enable();
            } catch (_) {
                // Navigation preload is only an optimization. Keep activation
                // resilient on browsers that expose it but fail to enable it.
            }
        }

        await self.clients.claim();
    })());
});

self.addEventListener("fetch", (event) => {
    const request = event.request;
    if (!shouldHandleRequest(request)) {
        return;
    }

    event.respondWith(fetchWithIsolationHeaders(event).catch((error) => {
        console.warn("COI service worker fetch failed; falling back to browser fetch", error);
        return fetch(request);
    }));
});

function shouldHandleRequest(request) {
    if (request.method !== "GET") {
        return false;
    }

    const url = new URL(request.url);
    if (url.origin !== self.location.origin || !/^https?:$/.test(url.protocol)) {
        return false;
    }

    // Chrome may create only-if-cached requests that are illegal to pass to
    // fetch() unless they are same-origin. Do not turn those into failed loads.
    if (request.cache === "only-if-cached" && request.mode !== "same-origin") {
        return false;
    }

    // Let the browser update the service worker script itself without the
    // service worker rewrapping that response. This avoids update/hard-refresh
    // edge cases where the page can stay on the loading screen.
    if (request.destination === "serviceworker" || request.headers.get("service-worker") === "script") {
        return false;
    }

    return true;
}

async function fetchWithIsolationHeaders(event) {
    const response = await event.preloadResponse || await fetch(event.request);

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

    return new Response(NULL_BODY_STATUSES.has(response.status) ? null : response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
    });
}

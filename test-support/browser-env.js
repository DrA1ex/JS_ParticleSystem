import fs from "node:fs/promises";
import {fileURLToPath} from "node:url";

export function installBrowserStubs({search = "", userAgent = "node-test"} = {}) {
    globalThis.WebGL2RenderingContext = globalThis.WebGL2RenderingContext || {
        STREAM_DRAW: 0x88E0,
        DYNAMIC_DRAW: 0x88E8,
        FLOAT: 0x1406,
        UNSIGNED_BYTE: 0x1401,
        ARRAY_BUFFER: 0x8892,
        STATIC_DRAW: 0x88E4,
        POINTS: 0,
        COLOR_BUFFER_BIT: 0x4000,
    };
    globalThis.window = {
        location: {search},
        devicePixelRatio: 1,
        orientation: undefined,
        addEventListener() {},
        removeEventListener() {},
    };
    Object.defineProperty(globalThis, "navigator", {
        value: {userAgent},
        configurable: true,
        writable: true,
    });
    globalThis.document = globalThis.document || {
        body: {},
        getElementById() { return null; },
        createElement() { return {style: {}, click() {}, remove() {}}; },
    };
    globalThis.alert = () => {};
    globalThis.requestAnimationFrame = () => 1;
    globalThis.cancelAnimationFrame = () => {};
    globalThis.fetch = async url => {
        if (url instanceof URL && url.protocol === "file:") {
            return {
                ok: true,
                status: 200,
                statusText: "OK",
                async text() { return fs.readFile(fileURLToPath(url), "utf8"); },
                async json() { return JSON.parse(await fs.readFile(fileURLToPath(url), "utf8")); },
            };
        }
        throw new Error(`Unexpected fetch in test: ${url}`);
    };
}

export function setLocationSearch(search) {
    if (!globalThis.window) installBrowserStubs({search});
    globalThis.window.location.search = search;
}

import {ITEM_SIZE, getParticleCount, isParticleBuffer} from "./particles.js";

const MAGIC_TEXT = "NBSTATE1";
const MAGIC = new TextEncoder().encode(MAGIC_TEXT);
const PREFIX_SIZE = 12;
const FORMAT_VERSION = 1;

function createPrefix(headerLength) {
    const prefix = new Uint8Array(PREFIX_SIZE);
    prefix.set(MAGIC, 0);
    new DataView(prefix.buffer).setUint32(8, headerLength, true);
    return prefix;
}

function hasMagic(bytes) {
    if (bytes.length < MAGIC.length) return false;
    for (let i = 0; i < MAGIC.length; i++) {
        if (bytes[i] !== MAGIC[i]) return false;
    }
    return true;
}

function particleBlobParts(particles, count) {
    const floatCount = count * ITEM_SIZE;
    if (isParticleBuffer(particles)) {
        const view = particles.subarray(0, floatCount);
        // Blob construction from a SharedArrayBuffer-backed view is not
        // consistently supported. Copy it in bounded chunks rather than
        // materializing millions of JS arrays or one giant JSON string.
        if (typeof SharedArrayBuffer !== "undefined" && view.buffer instanceof SharedArrayBuffer) {
            const parts = [];
            const chunkFloats = 4 * 1024 * 1024; // 16 MiB per temporary chunk.
            for (let start = 0; start < view.length; start += chunkFloats) {
                const end = Math.min(view.length, start + chunkFloats);
                parts.push(new Float32Array(view.subarray(start, end)));
            }
            return parts;
        }
        return [view];
    }

    const parts = [];
    const chunkParticles = 250_000;
    for (let start = 0; start < count; start += chunkParticles) {
        const end = Math.min(count, start + chunkParticles);
        const chunk = new Float32Array((end - start) * ITEM_SIZE);
        for (let i = start; i < end; i++) {
            const p = particles[i];
            const offset = (i - start) * ITEM_SIZE;
            chunk[offset] = p.x;
            chunk[offset + 1] = p.y;
            chunk[offset + 2] = p.velX;
            chunk[offset + 3] = p.velY;
            chunk[offset + 4] = p.mass;
        }
        parts.push(chunk);
    }
    return parts;
}

export function createStateBlob({settings, renderer, particles}) {
    const particleCount = getParticleCount(particles);
    if (!Number.isInteger(particleCount) || particleCount < 2) {
        throw new Error("Cannot export an invalid particle buffer");
    }

    const header = {
        format: "n-body-state",
        version: FORMAT_VERSION,
        encoding: "float32-le",
        itemSize: ITEM_SIZE,
        particleCount,
        settings,
        renderer,
    };
    const headerBytes = new TextEncoder().encode(JSON.stringify(header));
    const prefix = createPrefix(headerBytes.byteLength);
    return new Blob(
        [prefix, headerBytes, ...particleBlobParts(particles, particleCount)],
        {type: "application/x-n-body-state"}
    );
}

export async function readStateFile(file) {
    const prefixBytes = new Uint8Array(await file.slice(0, PREFIX_SIZE).arrayBuffer());
    if (!hasMagic(prefixBytes)) {
        const text = await file.text();
        return JSON.parse(text);
    }

    if (prefixBytes.byteLength < PREFIX_SIZE) {
        throw new Error("State file header is truncated");
    }
    const headerLength = new DataView(prefixBytes.buffer, prefixBytes.byteOffset, prefixBytes.byteLength)
        .getUint32(8, true);
    if (headerLength < 2 || headerLength > 16 * 1024 * 1024) {
        throw new Error("State file contains an invalid header size");
    }

    const dataOffset = PREFIX_SIZE + headerLength;
    if (file.size < dataOffset) {
        throw new Error("State file header is truncated");
    }
    const headerText = new TextDecoder().decode(
        new Uint8Array(await file.slice(PREFIX_SIZE, dataOffset).arrayBuffer())
    );
    const header = JSON.parse(headerText);
    if (header.format !== "n-body-state" || header.version !== FORMAT_VERSION) {
        throw new Error(`Unsupported state format version: ${header.version ?? "unknown"}`);
    }
    if (header.encoding !== "float32-le" || header.itemSize !== ITEM_SIZE) {
        throw new Error("Unsupported particle encoding in state file");
    }

    const particleCount = Number(header.particleCount);
    const expectedBytes = particleCount * ITEM_SIZE * Float32Array.BYTES_PER_ELEMENT;
    const actualBytes = file.size - dataOffset;
    if (!Number.isSafeInteger(particleCount) || particleCount < 2 || actualBytes !== expectedBytes) {
        throw new Error(`Invalid particle payload: expected ${expectedBytes} bytes, got ${actualBytes}`);
    }

    const particleBuffer = await file.slice(dataOffset).arrayBuffer();
    const particles = new Float32Array(particleBuffer);
    return {
        settings: header.settings || {},
        renderer: header.renderer || null,
        particles,
    };
}

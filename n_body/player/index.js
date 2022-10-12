import {InteractionHandler} from "../render/base.js";
import {Webgl2Renderer} from "../render/webgl/render.js";
import {Settings} from "../utils/settings.js";

const SettingsInstance = Settings.fromQueryParams();

let Renderer = null;
let RendererInteractions = null;

let Frames = null;
let Particles = null;

let RecordedRate = null;
let ComponentsCount = null;
let CurrentFrameIndex = -1;

const loader = document.getElementById("loader");
loader.ondrop = loadFile;
loader.ondragover = e => e.preventDefault();

async function loadFromUrl() {
    const urlSearchParams = new URLSearchParams(window.location.search);
    const queryParams = Object.fromEntries(urlSearchParams.entries());

    if (queryParams.url) {
        return await load(async () => {
            try {
                const data = await fetch(queryParams.url);
                if (data.ok) {
                    return await data.arrayBuffer();
                }

                alert(`Download failed. Code ${data.status}: ${data.statusText}`);
            } catch (e) {
                alert("Unable to load state", e);
            }

            return null;
        });
    }

    return false;
}

async function loadFile(e) {
    e.preventDefault();

    if ((e.dataTransfer?.files?.length ?? 0) === 0) {
        return;
    }

    const file = e.dataTransfer.files[0];
    await load(() => file.arrayBuffer());
}

async function load(loaderFn) {
    loader.ondrop = null;

    let success = false;
    try {
        document.getElementById("drop_text").style.display = "none";
        document.getElementById("loading_text").style.display = "block";

        const buffer = await loaderFn();
        if (buffer) {
            success = loadFileData(buffer);
        }
    } catch {
    }

    success = success && nextFrame();
    if (success) {
        loader.remove();

        Renderer = new Webgl2Renderer(document.getElementById("canvas"), SettingsInstance);
        RendererInteractions = new InteractionHandler(Renderer, SettingsInstance);
        RendererInteractions.enable();

        render();
    } else {
        document.getElementById("loading_text").style.display = "none";
        document.getElementById("drop_text").style.display = "block";
        loader.ondrop = loadFile;
    }

    return success;
}

function loadFileData(buffer) {
    const metaBuffer = new Uint32Array(buffer);
    const metaLength = metaBuffer[0];
    const metaBytes = metaLength * Uint32Array.BYTES_PER_ELEMENT

    const version = metaBuffer[1];
    if (version !== 1 || metaLength < 6) {
        alert(`Unsupported version or invalid header. Version: ${version}`);
        loader.ondrop = loadFile;
        return false;
    }

    let idx = 2;
    RecordedRate = metaBuffer[idx++];
    const frames = metaBuffer[idx++];
    const particleCount = metaBuffer[idx++];
    ComponentsCount = metaBuffer[idx++];

    const frameSize = particleCount * ComponentsCount;
    const totalDataSize = frames * frameSize;
    const expectedBytes = totalDataSize * Float32Array.BYTES_PER_ELEMENT + metaBytes;
    if (expectedBytes > buffer.byteLength) {
        alert(`Invalid size. Expected: ${expectedBytes} got: ${buffer.byteLength}`);
        return false;
    }

    Frames = new Array(frames);
    const framesBuffer = new Float32Array(buffer, metaLength * Uint32Array.BYTES_PER_ELEMENT, totalDataSize);
    for (let i = 0; i < frames; i++) {
        Frames[i] = new Float32Array(framesBuffer.slice(i * frameSize, i * frameSize + frameSize));
    }

    Particles = new Array(particleCount);
    for (let i = 0; i < particleCount; i++) {
        Particles[i] = {x: 0, y: 0, velX: 0, velY: 0, mass: 1};
    }

    SettingsInstance.particleCount = particleCount;

    return true;
}

function nextFrame() {
    CurrentFrameIndex += 1;
    const frame = Frames[CurrentFrameIndex];

    if (!frame) {
        return false;
    }

    for (let i = 0; i < Particles.length; i++) {
        const x = frame[i * ComponentsCount];
        const y = frame[i * ComponentsCount + 1];

        if (CurrentFrameIndex > 0) {
            Particles[i].velX = x - Particles[i].x;
            Particles[i].velY = y - Particles[i].y;
        }

        Particles[i].x = x;
        Particles[i].y = y;
    }

    return true;
}

function render() {
    Renderer.render(Particles);

    setTimeout(() => {
        nextFrame();
        requestAnimationFrame(render);
    });
}

await loadFromUrl();
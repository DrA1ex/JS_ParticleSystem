import {SpatialTree} from "./tree.js";
import * as Debug from "./debug.js";
import * as Physics from "./physics.js";
import {
    DEBUG,
    ENABLE_MOUSE,
    FPS,
    PARTICLE_G,
    PARTICLE_INIT,
    STATS,
    PARTICLE_CNT,
    SEGMENT_DIVIDER,
    SEGMENT_MAX_COUNT,
} from "./settings.js";

Debug.init();

const canvas = document.getElementById("canvas");
const rect = canvas.getBoundingClientRect();

const CanvasWidth = rect.width;
const CanvasHeight = rect.height;

canvas.style.width = CanvasWidth + "px";
canvas.style.height = CanvasHeight + "px";
canvas.width = CanvasWidth;
canvas.height = CanvasHeight;

const ctx = canvas.getContext('2d');

const imageData = ctx.createImageData(CanvasWidth, CanvasHeight);
const imageWidth = imageData.width;
const pixels = new Uint32Array(imageData.data.buffer);

const MousePosition = {x: CanvasWidth / 2, y: CanvasHeight / 2};
const Particles = Physics.initParticles(Physics.InitType[PARTICLE_INIT], PARTICLE_CNT, CanvasWidth, CanvasHeight);

function init() {
    if (ENABLE_MOUSE) {
        canvas.onmousemove = canvas.ontouchmove = (e) => {
            const point = e.touches ? e.touches[0] : e
            const bcr = e.target.getBoundingClientRect();

            MousePosition.x = point.clientX - bcr.x;
            MousePosition.y = point.clientY - bcr.y;

            e.preventDefault();
        }
    }
}


function _calculateTree(leaf) {
    const blocks = leaf.children;
    if (blocks.length > 0) {
        for (let i = 0; i < blocks.length; i++) {
            _calculateTree(blocks[i]);
        }

        // Apply force between blocks
        for (let i = 0; i < blocks.length; i++) {
            const attractor = blocks[i].boundaryRect.center();
            const g = PARTICLE_G * blocks[i].length;

            for (let j = 0; j < blocks.length; j++) {
                if (i === j) continue;

                const force = Physics.calculateForce(blocks[j].boundaryRect.center(), attractor, g);
                Physics.applyForce(blocks[j], force);
            }
        }
    } else {
        for (let i = 0; i < leaf.length; i++) {
            const attractor = leaf.data[i];
            for (let j = 0; j < leaf.length; j++) {
                if (i === j) continue;
                Physics.animateParticle(leaf.data[j], PARTICLE_G, attractor);
            }
        }
    }
}

function render() {

    ctx.clearRect(0, 0, CanvasWidth, CanvasHeight);

    for (let i = 0; i < pixels.length; i++) {
        pixels[i] = 0;
    }

    const tree = new SpatialTree(Particles, SEGMENT_MAX_COUNT, SEGMENT_DIVIDER);
    _calculateTree(tree.root);

    for (let i = 0; i < Particles.length; i++) {
        const particle = Particles[i];

        if (ENABLE_MOUSE) {
            animateParticle(particle, G, MousePosition);
        }
        Physics.physicsStep(particle, CanvasWidth, CanvasHeight);

        const xVelToColor = 125 + Math.floor(particle.velX * 20);
        const yVelToColor = 125 + Math.floor(particle.velY * 20);
        const overSpeedColor = Math.max(0, xVelToColor + yVelToColor - 255 * 2);
        const index = (Math.floor(particle.x) + Math.floor(particle.y) * imageWidth);
        pixels[index] = 0xff000000 | (xVelToColor & 0xff) << 16 | (yVelToColor & 0xff) << 8 | overSpeedColor & 0xff;
    }

    ctx.putImageData(imageData, 0, 0);

    if (DEBUG) Debug.drawTreeStructure(ctx, tree);
    if (STATS) Debug.calcStatistics(tree);

    if (ENABLE_MOUSE) {
        ctx.fillStyle = "red";
        ctx.beginPath();
        ctx.arc(MousePosition.x - MOUSE_POINT_RADIUS / 2, MousePosition.y - MOUSE_POINT_RADIUS / 2,
            MOUSE_POINT_RADIUS, 0, Math.PI * 2);
        ctx.fill();
    }
}

const refreshTime = 1000 / FPS;
let lastStepTime = 0;

function step(timestamp) {
    if (timestamp >= lastStepTime + refreshTime) {
        lastStepTime = timestamp;
        const t = performance.now();
        render();

        const renderTime = performance.now() - t;
        if (STATS) Debug.drawStats(renderTime);
    }

    requestAnimationFrame(step)
}

init();
requestAnimationFrame(step);
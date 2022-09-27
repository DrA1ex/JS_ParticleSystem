import {SpatialTree} from "./tree.js";
import * as Debug from "./debug.js";
import * as Physics from "./physics.js";
import {
    DEBUG,
    ENABLE_MOUSE,
    FPS,
    G,
    FILTER_ENABLE,
    MOUSE_POINT_RADIUS,
    PARTICLE_G,
    PARTICLE_INIT,
    SEGMENT_DIVIDER,
    SEGMENT_MAX_COUNT,
    STATS,
    PARTICLE_CNT,
} from "./settings.js";
import {DEBUG_DATA} from "./debug.js";

Debug.init();

const dpr = window.devicePixelRatio;
const canvas = document.getElementById("canvas");
const rect = canvas.getBoundingClientRect();

const CanvasWidth = rect.width * dpr;
const CanvasHeight = rect.height * dpr;

canvas.style.width = rect.width + "px";
canvas.style.height = rect.height + "px";
canvas.width = CanvasWidth;
canvas.height = CanvasHeight;

const ctx = canvas.getContext('2d');

const imageData = ctx.createImageData(CanvasWidth, CanvasHeight);
const imageWidth = imageData.width;
const pixels = new Uint32Array(imageData.data.buffer);

const MousePosition = {x: CanvasWidth / 2, y: CanvasHeight / 2};
const Particles = Physics.initParticles(Physics.InitType[PARTICLE_INIT], PARTICLE_CNT, CanvasWidth, CanvasHeight);

let hueAngle = 0;
let maxSpeed = 0;

function init() {
    if (ENABLE_MOUSE) {
        document.body.style.cursor = "none";
        canvas.onmousemove = canvas.ontouchmove = (e) => {
            const point = e.touches ? e.touches[0] : e
            const bcr = e.target.getBoundingClientRect();

            MousePosition.x = point.clientX - bcr.x;
            MousePosition.y = point.clientY - bcr.y;

            e.preventDefault();
        }
    }
}


function calculateTree(tree) {
    function _calculateLeaf(leaf, [pForceX, pForceY]) {
        const blocks = leaf.children;
        if (blocks.length > 0) {
            for (let i = 0; i < blocks.length; i++) {
                const blockCenter = blocks[i].boundaryRect.center();
                let forceX = pForceX;
                let forceY = pForceY;

                for (let j = 0; j < blocks.length; j++) {
                    if (i === j) continue;

                    const g = PARTICLE_G * blocks[j].length;
                    const [jForceX, jForceY] = Physics.calculateForce(blockCenter, blocks[j].boundaryRect.center(), g);
                    forceX += jForceX;
                    forceY += jForceY;
                }

                _calculateLeaf(blocks[i], [forceX, forceY]);
            }
        } else {
            for (let i = 0; i < leaf.length; i++) {
                const attractor = leaf.data[i];
                attractor.velX += pForceX;
                attractor.velY += pForceY;

                for (let j = 0; j < leaf.length; j++) {
                    if (i === j) continue;

                    const particle = leaf.data[j];
                    const [forceX, forceY] = Physics.calculateForce(particle, attractor, PARTICLE_G);
                    particle.velX += forceX;
                    particle.velY += forceY;
                }
            }
        }
    }

    return _calculateLeaf(tree.root, [0, 0]);
}

function calculatePhysics() {
    let t = performance.now();
    const tree = new SpatialTree(Particles, SEGMENT_MAX_COUNT, SEGMENT_DIVIDER);
    if (STATS) {
        DEBUG_DATA.tree_time = performance.now() - t;
    }

    t = performance.now();
    calculateTree(tree);
    if (STATS) {
        DEBUG_DATA.physics_time = performance.now() - t;
    }

    for (let i = 0; i < Particles.length; i++) {
        const particle = Particles[i];
        if (ENABLE_MOUSE) {
            Physics.particleInteract(particle, MousePosition, G);
        }

        Physics.physicsStep(particle, CanvasWidth, CanvasHeight);
    }

    if (STATS) Debug.calcStatistics(tree);

    return tree;
}

function render() {
    ctx.clearRect(0, 0, CanvasWidth, CanvasHeight);
    for (let i = 0; i < pixels.length; i++) {
        pixels[i] = 0;
    }

    for (let i = 0; i < Particles.length; i++) {
        const particle = Particles[i];

        maxSpeed = Math.max(maxSpeed, Math.abs(particle.velX), Math.abs(particle.velY));

        const xVelToColor = Math.floor(255 * (0.5 + particle.velX / maxSpeed / 2));
        const yVelToColor = Math.floor(255 * (0.5 + particle.velY / maxSpeed / 2));
        const index = (Math.floor(particle.x) + Math.floor(particle.y) * imageWidth);
        pixels[index] = 0xff000010 | xVelToColor << 16 | yVelToColor << 8;
    }

    ctx.putImageData(imageData, 0, 0);

    if (ENABLE_MOUSE) {
        ctx.fillStyle = "red";
        ctx.beginPath();
        ctx.arc(MousePosition.x - MOUSE_POINT_RADIUS / 2, MousePosition.y - MOUSE_POINT_RADIUS / 2,
            MOUSE_POINT_RADIUS, 0, Math.PI * 2);
        ctx.fill();
    }

    if (FILTER_ENABLE) {
        canvas.style.filter = `contrast(2) brightness(2) hue-rotate(${hueAngle % 360}deg)`;
        hueAngle += 0.2;
    }
}

const refreshTime = 1000 / FPS;
let lastStepTime = 0;

function step() {
    const tree = calculatePhysics();

    requestAnimationFrame((timestamp) => {
        if (timestamp >= lastStepTime + refreshTime) {
            render();

            if (DEBUG) Debug.drawTreeStructure(ctx, tree);

            if (lastStepTime > 0) {
                Debug.postFrameTime(timestamp - lastStepTime);
            }
            lastStepTime = timestamp;
            if (STATS) Debug.drawStats();
        }

        step();
    })
}

init();
step();
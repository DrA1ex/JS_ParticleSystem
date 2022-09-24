import {SpatialTree} from "./tree.js";

const urlSearchParams = new URLSearchParams(window.location.search);
const params = Object.fromEntries(urlSearchParams.entries());

const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || window.orientation !== undefined;

const MOUSE_POINT_RADIUS = 3;
const ENABLE_MOUSE = params.mouse ? Number.parseInt(params.mouse) : false;
const PARTICLE_CNT = ~~params.particle_count || (isMobile ? 10000 : 20000);
const FPS = ~~params.fps || 60;
const G = Number.parseFloat(params.g) || 1;
const ParticleG = G / PARTICLE_CNT * 10;
const Resistance = Number.parseFloat(params.resistance) || 0.999;

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
const Particles = new Array(PARTICLE_CNT);

function init() {
    for (let i = 0; i < PARTICLE_CNT; i++) {
        Particles[i] = {
            x: Math.random() * CanvasWidth,
            y: Math.random() * CanvasHeight,
            velX: 0, velY: 0
        };
    }

    canvas.onmousemove = canvas.ontouchmove = (e) => {
        const point = e.touches ? e.touches[0] : e
        const bcr = e.target.getBoundingClientRect();

        MousePosition.x = point.clientX - bcr.x;
        MousePosition.y = point.clientY - bcr.y;

        e.preventDefault();
    }
}

function calculateForce(p1, p2, g) {
    const dx = p1.x - p2.x,
        dy = p1.y - p2.y;

    const distSquare = dx * dx + dy * dy;

    let force = 0;
    if (distSquare >= 400) // A magic number represent min process distance
    {
        force = -g / distSquare;
    }

    return [dx * force, dy * force];
}

function animateParticle(particle, g, attractor) {
    const [xForce, yForce] = calculateForce(particle, attractor, g);
    particle.velX += xForce;
    particle.velY += yForce;
}

function applyForce(leaf, force) {
    const [xForce, yForce] = force;
    for (let i = 0; i < leaf.data.length; i++) {
        const particle = leaf.data[i];
        particle.velX += xForce;
        particle.velY += yForce;
    }
}

function physicsStep(particle) {
    particle.velX *= Resistance;
    particle.velY *= Resistance;
    particle.x += particle.velX;
    particle.y += particle.velY;

    if (particle.x > CanvasWidth) {
        particle.x -= CanvasWidth;
    } else if (particle.x < 0) {
        particle.x += CanvasWidth;
    }

    if (particle.y > CanvasHeight) {
        particle.y -= CanvasHeight;
    } else if (particle.y < 0) {
        particle.y += CanvasHeight;
    }
}

function render() {
    function _calculateTree(leaf) {
        const blocks = leaf.children;
        if (blocks.length > 0) {
            for (let i = 0; i < blocks.length; i++) {
                _calculateTree(blocks[i]);
            }

            // Apply force between blocks
            for (let i = 0; i < blocks.length; i++) {
                const attractor = blocks[i].boundaryRect.center();
                const g = ParticleG * blocks[i].length;

                for (let j = 0; j < blocks.length; j++) {
                    if (i === j) continue;

                    const force = calculateForce(blocks[j].boundaryRect.center(), attractor, g);
                    applyForce(blocks[j], force);
                }
            }
        } else {
            for (let i = 0; i < leaf.data.length; i++) {
                const attractor = leaf.data[i];
                for (let j = 0; j < leaf.data.length; j++) {
                    if (i === j) continue;
                    animateParticle(leaf.data[j], ParticleG, attractor);
                }
            }
        }
    }

    ctx.clearRect(0, 0, CanvasWidth, CanvasHeight);

    for (let i = 0; i < pixels.length; i++) {
        pixels[i] = 0;
    }

    const tree = new SpatialTree(Particles, 128, 8);
    _calculateTree(tree.root);

    for (let i = 0; i < Particles.length; i++) {
        const particle = Particles[i];

        if (ENABLE_MOUSE) {
            animateParticle(particle, G, MousePosition);
        }
        physicsStep(particle);

        const xVelToColor = 125 + Math.floor(particle.velX * 20);
        const yVelToColor = 125 + Math.floor(particle.velY * 20);
        const overSpeedColor = Math.max(0, xVelToColor + yVelToColor - 255 * 2);
        const index = (Math.floor(particle.x) + Math.floor(particle.y) * imageWidth);
        pixels[index] = 0xff000000 | (xVelToColor & 0xff) << 16 | (yVelToColor & 0xff) << 8 | overSpeedColor & 0xff;
    }

    ctx.putImageData(imageData, 0, 0);

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
        render();
    }

    requestAnimationFrame(step)
}

init();
requestAnimationFrame(step);
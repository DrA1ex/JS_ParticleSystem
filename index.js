const urlSearchParams = new URLSearchParams(window.location.search);
const params = Object.fromEntries(urlSearchParams.entries());

const MOUSE_POINT_RADIUS = ~~params.mouse_radius || 3;
const PARTICLE_POINT_RADIUS = ~~params.particle_radius || 1;
const PARTICLE_CNT = ~~params.particle_count || 10000;
const FPS = ~~params.fps || 60;

const canvas = document.getElementById("canvas");

const dpr = window.devicePixelRatio;
const rect = canvas.getBoundingClientRect();

const CanvasWidth = rect.width;
const CanvasHeight = rect.height;

canvas.style.width = CanvasWidth + "px";
canvas.style.height = CanvasHeight + "px";

canvas.width = CanvasWidth * dpr;
canvas.height = CanvasHeight * dpr;

const ctx = canvas.getContext('2d');

const MousePosition = {x: CanvasWidth / 2, y: CanvasHeight / 2};
const Particles = new Array(PARTICLE_CNT);

const PhysicsWorkers = new Array(Math.max(1, Math.min(4, navigator.hardwareConcurrency)));

function init() {
    ctx.scale(dpr, dpr);

    for (let i = 0; i < PARTICLE_CNT; i++) {
        Particles[i] = {
            x: Math.random() * CanvasWidth,
            y: Math.random() * CanvasHeight,
            velX: 0, velY: 0
        };
    }

    const perWorkerCnt = Math.floor(Particles.length / PhysicsWorkers.length);
    for (let i = 0; i < PhysicsWorkers.length; i++) {
        const workerIndex = i;
        const workerStartParticle = workerIndex * perWorkerCnt;
        const workerStopParticle = Math.min((workerIndex + 1) * perWorkerCnt, PARTICLE_CNT);

        PhysicsWorkers[workerIndex] = new Worker("physics.js");

        PhysicsWorkers[workerIndex].onmessage = (e) => {
            const data = e.data;
            for (let i = workerStartParticle, j = 0; i < workerStopParticle; i++, j++) {
                Particles[i].x = data[j * 4];
                Particles[i].y = data[j * 4 + 1];
                Particles[i].velX = data[j * 4 + 2];
                Particles[i].velY = data[j * 4 + 3];
            }
        }

        PhysicsWorkers[workerIndex].postMessage({
            type: "init",
            particles: Particles.slice(workerStartParticle, workerStopParticle),
            mousePoint: MousePosition,
            size: {width: CanvasWidth, height: CanvasHeight}
        });
    }

    canvas.onmousemove = canvas.ontouchmove = (e) => {
        const point = e.touches ? e.touches[0] : e
        const bcr = e.target.getBoundingClientRect();

        MousePosition.x = point.clientX - bcr.x;
        MousePosition.y = point.clientY - bcr.y;

        for (let i = 0; i < PhysicsWorkers.length; i++) {
            PhysicsWorkers[i].postMessage({
                type: "mouse",
                mousePoint: MousePosition
            });
        }

        e.preventDefault();
    }
}

init();

setInterval(() => {
    ctx.clearRect(0, 0, CanvasWidth, CanvasHeight);

    ctx.fillStyle = "red";
    ctx.beginPath();
    ctx.arc(MousePosition.x - MOUSE_POINT_RADIUS / 2, MousePosition.y - MOUSE_POINT_RADIUS / 2,
        MOUSE_POINT_RADIUS, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#092e9c";
    for (let i = 0; i < Particles.length; i++) {
        const p = Particles[i];

        //ctx.fillStyle = `rgb(200,${Math.floor(125 + p.velX * 25)},${Math.floor(125 + p.velY * 25)})`;
        ctx.fillRect(p.x - PARTICLE_POINT_RADIUS / 2, p.y - PARTICLE_POINT_RADIUS / 2, PARTICLE_POINT_RADIUS, PARTICLE_POINT_RADIUS);
    }
}, 1000 / FPS);
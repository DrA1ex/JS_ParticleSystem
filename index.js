const MOUSE_POINT_RADIUS = 5;
const PARTICLE_POINT_RADIUS = 2;
const PARTICLE_CNT = 10000;

const PI2 = Math.PI * 2;

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext('2d');

const MousePosition = {x: canvas.width / 2, y: canvas.height / 2};
const Particles = new Array(PARTICLE_CNT);

const PhysicsWorkers = new Array(Math.max(1, Math.min(4, navigator.hardwareConcurrency)));

function init() {
    const particlesPerRow = Math.floor(Math.sqrt(PARTICLE_CNT));
    const stepX = canvas.width / particlesPerRow;
    const stepY = canvas.height / particlesPerRow;

    for (let i = 0; i < PARTICLE_CNT; i++) {
        Particles[i] = {
            x: stepX / 2 + (i % particlesPerRow) * stepX + MOUSE_POINT_RADIUS / 2,
            y: stepY / 2 + Math.floor(i / particlesPerRow) * stepY + MOUSE_POINT_RADIUS / 2,
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
            size: {height: canvas.height, width: canvas.width}
        });
    }

    canvas.onmousemove = (e) => {
        MousePosition.x = e.offsetX;
        MousePosition.y = e.offsetY;

        for (let i = 0; i < PhysicsWorkers.length; i++) {
            PhysicsWorkers[i].postMessage({
                type: "mouse",
                mousePoint: MousePosition
            });
        }
    }
}

init();

setInterval(() => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "red";
    ctx.beginPath();
    ctx.arc(MousePosition.x - MOUSE_POINT_RADIUS / 2, MousePosition.y - MOUSE_POINT_RADIUS / 2,
        MOUSE_POINT_RADIUS, 0, PI2);
    ctx.fill();

    ctx.fillStyle = "black";
    for (let i = 0; i < Particles.length; i++) {
        const p = Particles[i];

        //ctx.fillStyle = `rgb(200,${Math.floor(125 + p.velX * 25)},${Math.floor(125 + p.velY * 25)})`;
        ctx.fillRect(p.x - PARTICLE_POINT_RADIUS / 2, p.y - PARTICLE_POINT_RADIUS / 2, PARTICLE_POINT_RADIUS, PARTICLE_POINT_RADIUS);
    }
}, 1000 / 60);
let G = 9;
let Resistance = 0.99;
let Width, Height;
let Particles, MousePosition;

let interval = null;

onmessage = (e) => {
    if (e.data.type === "init") {
        Particles = e.data.particles;
        MousePosition = e.data.mousePoint;
        Height = e.data.size.height;
        Width = e.data.size.width;

        if (interval) {
            clearInterval(interval);
        }

        interval = setInterval(() => {
            for (let i = 0; i < Particles.length; i++) {
                animateParticle(Particles[i], G, MousePosition);
            }

            const data = new Float32Array(Particles.length * 4);
            for (let i = 0; i < Particles.length; i++) {
                data[i * 4] = Particles[i].x;
                data[i * 4 + 1] = Particles[i].y;
                data[i * 4 + 2] = Particles[i].velX;
                data[i * 4 + 3] = Particles[i].velY;
            }
            postMessage(data);
        }, 1000 / 60);
    } else if (e.data.type === "mouse") {
        MousePosition = e.data.mousePoint;
    }
}


function animateParticle(particle, g, position) {
    const dx = particle.x - position.x,
        dy = particle.y - position.y;

    const distSquare = Math.pow(dx, 2) + Math.pow(dy, 2);

    let force = 0;
    if (distSquare >= 400) // A magic number represent min process distance
    {
        force = -g / distSquare;
    }

    const xForce = dx * force
        , yForce = dy * force;

    particle.velX *= Resistance;
    particle.velY *= Resistance;

    particle.velX += xForce;
    particle.velY += yForce;

    particle.x += particle.velX;
    particle.y += particle.velY;

    if (particle.x > Width)
        particle.x -= Width;
    else if (particle.x < 0)
        particle.x += Width;

    if (particle.y > Height)
        particle.y -= Height;
    else if (particle.y < 0)
        particle.y += Height;
}
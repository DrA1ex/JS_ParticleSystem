import {PlayerController} from "./controllers/player.js";
import {PlayerStateEnum} from "./controllers/base.js";
import {ControlStateEnum} from "./controllers/control_bar.js";
import {SimpleDFRIHelper} from "../utils/dfri.js";
import {SimulationSequence} from "../simulation/sequence.js";
import {FetchDataAsyncReader, FileAsyncReader, ObservableStreamLoader} from "../utils/stream.js";
import {InteractionHandler} from "../render/interactions.js";
import {RendererInitializer} from "../render/init.js";
import {ITEM_SIZE} from "../utils/particles.js";

export class Application {
    _statesToRender = new Set([PlayerStateEnum.playing, PlayerStateEnum.paused, PlayerStateEnum.finished]);

    particles = null;
    sequence = null;
    frameIndex = -1;
    currentSpeed = 1;

    renderer = null;
    renderInteractions = null;
    dfri = null;

    constructor(settings) {
        this.settings = settings;

        this.playerCtrl = new PlayerController(document.body);
        this.playerCtrl.subscribe(this, PlayerController.CONTROL_EVENT, (_, type) => this.handleControl(type));
        this.playerCtrl.subscribe(this, PlayerController.DATA_EVENT, (_, file) => this.loadDataFromFile(file));
        this.playerCtrl.subscribe(this, PlayerController.SEEK_EVENT, (_, value) => this.handleSeek(value));
        this.playerCtrl.subscribe(this, PlayerController.SPEED_EVENT, (_, value) => this.handleSpeed(value));
        this.playerCtrl.subscribe(this, PlayerController.PARTICLE_FIXED_SIZE_EVENT, (_, value) => this.settings.render.config.fixedParticleSize = value);
        this.playerCtrl.subscribe(this, PlayerController.PARTICLE_SCALE_EVENT, (_, value) => this.settings.render.config.particleSizeScale = value);
        this.playerCtrl.setState(PlayerStateEnum.waiting);
        this.playerCtrl.configure(this.settings);
        this._renderFrame = this.render.bind(this);
    }

    async loadDataFromUrl(url) {
        await this.loadData(async () => {
            const data = await fetch(url);
            if (data.ok) {
                const reader = new FetchDataAsyncReader(data);
                const loader = new ObservableStreamLoader(reader, this._onLoadProgress.bind(this));
                return loader.loadChunked();
            }

            throw new Error(`Download failed. Code ${data.status}: ${data.statusText}`);
        });
    }

    loadDataFromFile(file) {
        this.loadData(() => {
            const reader = new FileAsyncReader(file);
            const loader = new ObservableStreamLoader(reader, this._onLoadProgress.bind(this));
            return loader.loadChunked();
        }).catch(e => {
            alert(`Unable to load file: ${e.message}`)
        });
    }

    _onLoadProgress(loaded, size) {
        this.playerCtrl.setLoadingProgress(loaded, size);
    }

    async loadData(loaderFn) {
        this.playerCtrl.setState(PlayerStateEnum.loading);

        let success = false;
        try {
            const buffer = await loaderFn();
            this._setSequence(SimulationSequence.fromBuffer(buffer));
            success = true;
        } catch (e) {
            alert(`Unable to load data: ${e.message}`);
        }

        if (success) {
            this.playerCtrl.setState(PlayerStateEnum.playing);
            this.handleSpeed(this.currentSpeed);
            setTimeout(() => this.render());
        } else {
            this.playerCtrl.setState(PlayerStateEnum.waiting);
        }
    }

    _setSequence(sequence) {
        this.dfri?.disable();
        this.renderInteractions?.dispose();
        this.renderer?.dispose();

        this.sequence = sequence;
        this.frameIndex = -1;

        this.settings.physics.config.particleCount = this.sequence.particleCount;

        this.renderer = RendererInitializer.initRenderer(document.getElementById("canvas"), this.settings.render.render, this.settings);
        this.renderInteractions = new InteractionHandler(this.renderer);
        this.renderInteractions.enable();

        if (this.settings.render.enableDFRI) {
            this.dfri = new SimpleDFRIHelper(this.renderer, this.sequence.particleCount, this.sequence.fps, this.settings.world.fps);
            this.dfri.enable();
            this.dfri.init();
        }

        // Keep playback data in the same compact interleaved layout as the
        // simulation backend. Five million JS particle objects (plus five
        // million DFRI delta objects) can freeze or exhaust the player.
        this.particles = new Float32Array(this.sequence.particleCount * ITEM_SIZE);
        for (let i = 0; i < this.sequence.particleCount; i++) {
            this.particles[i * ITEM_SIZE + 4] = 1;
        }

        this.playerCtrl.setupSequence(this.sequence.length, 1 + (this.dfri?.interpolateFrames ?? 0));
        this.nextFrame();
    }

    render() {
        if (!this._statesToRender.has(this.playerCtrl.currentState)) {
            return;
        }

        if (this.dfri) {
            this.dfri.render(this.particles, this.playerCtrl.currentState !== PlayerStateEnum.playing);
        } else {
            this.renderer.render(this.particles);
        }

        if (this.playerCtrl.currentState === PlayerStateEnum.playing) {
            this.playerCtrl.setCurrentFrame(this.frameIndex, (this.dfri?.frame ?? 0));
        }

        setTimeout(() => {
            if (this.playerCtrl.currentState === PlayerStateEnum.playing) {
                this.nextFrame();
            }

            requestAnimationFrame(this._renderFrame);
        });
    }

    nextFrame() {
        if (this.dfri && !this.dfri.needNextFrame()) {
            return;
        }

        this.frameIndex += 1;
        const frame = this.sequence.getFrame(this.frameIndex);

        if (!frame) {
            this.playerCtrl.setState(PlayerStateEnum.finished);
            return;
        }

        const prevFrame = this.sequence.getFrame(this.frameIndex - 1);
        const components = this.sequence.componentsCount;
        for (let i = 0, dst = 0; i < this.sequence.particleCount; i++, dst += ITEM_SIZE) {
            const src = i * components;
            const x = frame[src];
            const y = frame[src + 1];

            this.particles[dst] = x;
            this.particles[dst + 1] = y;
            this.particles[dst + 2] = prevFrame ? x - prevFrame[src] : 0;
            this.particles[dst + 3] = prevFrame ? y - prevFrame[src + 1] : 0;
        }
        this.renderer.markParticlesDirty?.();

        if (this.dfri) {
            const nextFrame = this.sequence.getFrame(this.frameIndex + 1);
            if (!this.dfri.setNextPositionFrame(nextFrame)) {
                this.dfri.setNextFrame((i, out) => {
                    const src = i * components;
                    const dst = i * ITEM_SIZE;
                    out.x = nextFrame ? nextFrame[src] - this.particles[dst] : this.particles[dst + 2];
                    out.y = nextFrame ? nextFrame[src + 1] - this.particles[dst + 1] : this.particles[dst + 3];
                });
            }
        }
    }

    handleControl(state) {
        switch (state) {
            case ControlStateEnum.play:
                this.playerCtrl.setState(PlayerStateEnum.playing);
                break;

            case ControlStateEnum.pause:
                this.playerCtrl.setState(PlayerStateEnum.paused);
                break;

            case ControlStateEnum.rewind:
                this.frameIndex = -1;
                this.renderer.reset();
                this.renderer.clear();
                this.dfri?.reset();
                this.playerCtrl.setState(PlayerStateEnum.playing);
                break;

            case ControlStateEnum.reset:
                this.frameIndex = -1;
                this.renderer.reset();
                this.renderer.clear();
                this.dfri?.reset();
                this.playerCtrl.setState(PlayerStateEnum.waiting);
                break;
        }
    }

    handleSeek({frame, subFrame}) {
        if (!this._statesToRender.has(this.playerCtrl.currentState)) {
            return;
        }

        this.playerCtrl.setCurrentFrame(frame, subFrame);

        this.frameIndex = frame - 1;
        this.renderer.reset();
        this.dfri?.reset();
        this.nextFrame();

        if (this.dfri) {
            this.dfri.frame = subFrame;
        }

        if (this.playerCtrl.currentState === PlayerStateEnum.finished) {
            this.playerCtrl.setState(PlayerStateEnum.paused);
        }
    }

    handleSpeed(speed) {
        this.currentSpeed = speed;

        if (this.dfri) {
            let inputFps, outFps;
            if (this.currentSpeed <= 1) {
                inputFps = this.sequence.fps;
                outFps = Math.ceil(this.settings.world.fps / this.currentSpeed);
            } else {
                inputFps = Math.ceil(this.sequence.fps * this.currentSpeed);
                outFps = this.settings.world.fps;
            }

            const oldRelativeFrame = this.dfri.interpolateFrames > 0 ?
                Math.min(this.dfri.frame / this.dfri.interpolateFrames, 1) : 0;
            this.dfri.reconfigure(inputFps, outFps);
            this.dfri.init();

            this.dfri.reset();
            this.dfri.frame = Math.ceil(oldRelativeFrame * this.dfri.interpolateFrames);

            this.playerCtrl.setupSequence(this.sequence.length, 1 + this.dfri.interpolateFrames);
        }
    }
}
import {PlayerController} from "./controllers/player.js";
import {StateEnum} from "./controllers/base.js";
import {ControlStateEnum} from "./controllers/control_bar.js";
import {SimpleDFRIHelper} from "../utils/dfri.js";
import {InteractionHandler} from "../render/base.js";
import {Webgl2Renderer} from "../render/webgl/render.js";
import {SimulationSequence} from "./utils/simulation_sequence.js";
import {FetchDataAsyncReader, FileAsyncReader, ObservableStreamLoader} from "./utils/stream.js";

export class Application {
    _statesToRender = new Set([StateEnum.playing, StateEnum.paused, StateEnum.finished]);

    particles = null;
    sequence = null;
    frameIndex = -1;

    renderer = null;
    renderInteractions = null;
    dfri = null;

    constructor(settings) {
        this.settings = settings;

        this.playerCtrl = new PlayerController(document.body);
        this.playerCtrl.subscribe(this, PlayerController.PLAYER_CONTROL_EVENT, (sender, type) => this.handleControl(type));
        this.playerCtrl.subscribe(this, PlayerController.PLAYER_DATA_EVENT, (sender, file) => this.loadDataFromFile(file));
        this.playerCtrl.subscribe(this, PlayerController.PLAYER_SEEK_EVENT, (sender, value) => this.handleSeek(value));
        this.playerCtrl.setState(StateEnum.waiting);
    }

    async loadDataFromUrl(url) {
        await this.loadData(async () => {
            const data = await fetch(url);
            if (data.ok) {
                const reader = new FetchDataAsyncReader(data);
                const loader = new ObservableStreamLoader(reader, this._onLoadProgress.bind(this));
                return loader.load();
            }

            throw new Error(`Download failed. Code ${data.status}: ${data.statusText}`);
        });
    }

    loadDataFromFile(file) {
        this.loadData(() => {
            const reader = new FileAsyncReader(file);
            const loader = new ObservableStreamLoader(reader, this._onLoadProgress.bind(this));
            return loader.load()
        }).catch(e => {
            alert(`Unable to load file: ${e.message}`)
        });
    }

    _onLoadProgress(loaded, size) {
        this.playerCtrl.setLoadingProgress(loaded, size);
    }

    async loadData(loaderFn) {
        this.playerCtrl.setState(StateEnum.loading);

        let success = false;
        try {
            const buffer = await loaderFn();
            this._setSequence(SimulationSequence.fromBuffer(buffer));
            success = true;
        } catch (e) {
            alert(`Unable to load data: ${e.message}`);
        }

        if (success) {
            this.playerCtrl.setState(StateEnum.playing);
            setTimeout(() => this.render());
        } else {
            this.playerCtrl.setState(StateEnum.waiting);
        }
    }

    _setSequence(sequence) {
        this.sequence = sequence;

        this.settings.particleCount = this.sequence.particleCount;

        this.renderer = new Webgl2Renderer(document.getElementById("canvas"), this.settings);
        this.renderInteractions = new InteractionHandler(this.renderer, this.settings);
        this.renderInteractions.enable();

        if (this.settings.enableDFRI) {
            this.dfri = new SimpleDFRIHelper(this.renderer, this.sequence.particleCount, this.sequence.fps, 60);
            this.dfri.enable();
            this.dfri.init();
        }

        this.particles = new Array(this.sequence.particleCount);
        for (let i = 0; i < this.sequence.particleCount; i++) {
            this.particles[i] = {x: 0, y: 0, velX: 0, velY: 0, mass: 1};
        }

        this.playerCtrl.setupSequence(this.sequence.length, 1 + (this.dfri?.interpolateFrames ?? 0));
        this.nextFrame();
    }

    render() {
        if (!this._statesToRender.has(this.playerCtrl.currentState)) {
            return;
        }

        if (this.dfri) {
            this.dfri.render(this.particles, this.playerCtrl.currentState !== StateEnum.playing);
        } else {
            this.renderer.render(this.particles);
        }

        if (this.playerCtrl.currentState === StateEnum.playing) {
            this.playerCtrl.setCurrentFrame(this.frameIndex, (this.dfri?.frame ?? 0));
        }

        setTimeout(() => {
            if (this.playerCtrl.currentState === StateEnum.playing) {
                this.nextFrame();
            }

            requestAnimationFrame(this.render.bind(this));
        });
    }

    nextFrame() {
        if (this.dfri && !this.dfri.needNextFrame()) {
            return;
        }

        this.frameIndex += 1;
        const frame = this.sequence.getFrame(this.frameIndex);

        if (!frame) {
            this.playerCtrl.setState(StateEnum.finished);
            return;
        }

        const prevFrame = this.sequence.getFrame(this.frameIndex - 1);
        for (let i = 0; i < this.particles.length; i++) {
            const x = frame[i * this.sequence.componentsCount];
            const y = frame[i * this.sequence.componentsCount + 1];

            this.particles[i].x = x;
            this.particles[i].y = y;

            this.particles[i].velX = prevFrame ? x - prevFrame[i * this.sequence.componentsCount] : 0;
            this.particles[i].velY = prevFrame ? y - prevFrame[i * this.sequence.componentsCount + 1] : 0;
        }

        if (this.dfri) {
            const nextFrame = this.sequence.getFrame(this.frameIndex + 1);
            this.dfri.setNextFrame((i, out) => {
                out.x = nextFrame ? nextFrame[i * this.sequence.componentsCount] - this.particles[i].x : this.particles[i].velX;
                out.y = nextFrame ? nextFrame[i * this.sequence.componentsCount + 1] - this.particles[i].y : this.particles[i].velY;
            });
        }
    }

    handleControl(state) {
        switch (state) {
            case ControlStateEnum.play:
                this.playerCtrl.setState(StateEnum.playing);
                break;

            case ControlStateEnum.pause:
                this.playerCtrl.setState(StateEnum.paused);
                break;

            case ControlStateEnum.rewind:
                this.frameIndex = -1;
                this.renderer.reset();
                this.renderer.clear();
                this.dfri?.reset();
                this.playerCtrl.setState(StateEnum.playing);
                break;

            case ControlStateEnum.reset:
                this.frameIndex = -1;
                this.renderer.reset();
                this.renderer.clear();
                this.dfri?.reset();
                this.playerCtrl.setState(StateEnum.waiting);
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

        if (this.playerCtrl.currentState === StateEnum.finished) {
            this.playerCtrl.setState(StateEnum.paused);
        }
    }
}
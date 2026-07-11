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

    _playbackPosition = 0;
    _interpolationFactor = 0;
    _playbackClockTimestamp = null;
    _lastPresentedTimestamp = null;

    constructor(settings) {
        this.settings = settings;

        this.playerCtrl = new PlayerController(document.body);
        this.playerCtrl.subscribe(this, PlayerController.CONTROL_EVENT, (_, type) => this.handleControl(type));
        this.playerCtrl.subscribe(this, PlayerController.DATA_EVENT, (_, file) => this.loadDataFromFile(file));
        this.playerCtrl.subscribe(this, PlayerController.SEEK_EVENT, (_, value) => this.handleSeek(value));
        this.playerCtrl.subscribe(this, PlayerController.SPEED_EVENT, (_, value) => this.handleSpeed(value));
        this.playerCtrl.subscribe(this, PlayerController.PARTICLE_FIXED_SIZE_EVENT, (_, value) => this._updateRenderSetting("fixedParticleSize", value));
        this.playerCtrl.subscribe(this, PlayerController.PARTICLE_SCALE_EVENT, (_, value) => this._updateRenderSetting("particleSizeScale", value));
        this.playerCtrl.subscribe(this, PlayerController.PARTICLE_SPRITE_EVENT, (_, value) => this._updateRenderSetting("particleSprite", value));
        this.playerCtrl.subscribe(this, PlayerController.COLOR_MODE_EVENT, (_, value) => this._updateColorMode(value));
        this.playerCtrl.subscribe(this, PlayerController.FIXED_COLOR_EVENT, (_, value) => this._updateRenderSetting("fixedColor", value));
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
            requestAnimationFrame(this._renderFrame);
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
        this._playbackPosition = 0;
        this._interpolationFactor = 0;
        this._resetPlaybackClock();

        this.settings.physics.config.particleCount = this.sequence.particleCount;

        this.renderer = RendererInitializer.initRenderer(document.getElementById("canvas"), this.settings.render.render, this.settings);
        this.renderInteractions = new InteractionHandler(this.renderer);
        this.renderInteractions.enable();

        if (this.settings.render.enableDFRI) {
            this.dfri = new SimpleDFRIHelper(
                this.renderer,
                this.sequence.particleCount,
                this.sequence.fps * this.currentSpeed,
                this.settings.world.fps
            );
            this.dfri.enable();
            this.dfri.init();
        } else {
            this.dfri = null;
        }

        // Keep playback data in the same compact interleaved layout as the
        // simulation backend. Five million JS particle objects (plus five
        // million DFRI delta objects) can freeze or exhaust the player.
        this.particles = new Float32Array(this.sequence.particleCount * ITEM_SIZE);
        for (let i = 0; i < this.sequence.particleCount; i++) {
            this.particles[i * ITEM_SIZE + 4] = 1;
        }

        this._applyPlaybackPosition(0, true);
        this._updateSequenceUi();
    }

    render(timestamp = performance.now()) {
        if (!this._statesToRender.has(this.playerCtrl.currentState)) {
            return;
        }

        if (!this._shouldPresent(timestamp)) {
            requestAnimationFrame(this._renderFrame);
            return;
        }

        if (this.playerCtrl.currentState === PlayerStateEnum.playing) {
            this._advancePlaybackClock(timestamp);
        } else {
            this._playbackClockTimestamp = null;
        }

        if (this.dfri) {
            this.dfri.renderAtFactor(this.particles, this._interpolationFactor);
        } else {
            this.renderer.render(this.particles);
        }

        this._updateProgressUi();

        if (this.playerCtrl.currentState === PlayerStateEnum.playing &&
            this._playbackPosition >= this.sequence.length - 1) {
            this.playerCtrl.setState(PlayerStateEnum.finished);
            this._playbackClockTimestamp = null;
        }

        requestAnimationFrame(this._renderFrame);
    }

    _shouldPresent(timestamp) {
        const interval = 1000 / Math.max(1, this.settings.world.fps);
        if (this._lastPresentedTimestamp === null) {
            this._lastPresentedTimestamp = timestamp;
            return true;
        }

        const elapsed = timestamp - this._lastPresentedTimestamp;
        if (elapsed >= interval - 0.5) {
            // Advance the ideal presentation clock instead of assigning the
            // current rAF timestamp. On 120/144 Hz displays this produces a
            // stable average target rate rather than falling to an integer
            // divisor such as 48 FPS on a 144 Hz panel.
            const elapsedIntervals = Math.max(1, Math.floor((elapsed + 0.5) / interval));
            this._lastPresentedTimestamp += elapsedIntervals * interval;
            if (timestamp - this._lastPresentedTimestamp > interval * 4) {
                this._lastPresentedTimestamp = timestamp;
            }
            return true;
        }
        return false;
    }

    _advancePlaybackClock(timestamp) {
        if (this._playbackClockTimestamp === null) {
            this._playbackClockTimestamp = timestamp;
            return;
        }

        const elapsed = Math.max(0, timestamp - this._playbackClockTimestamp);
        this._playbackClockTimestamp = timestamp;

        const sourceFramesPerMs = this.sequence.fps * this.currentSpeed / 1000;
        this._applyPlaybackPosition(this._playbackPosition + elapsed * sourceFramesPerMs);
    }

    _applyPlaybackPosition(position, force = false) {
        if (!this.sequence || this.sequence.length < 1) {
            return;
        }

        const maxPosition = Math.max(0, this.sequence.length - 1);
        const clampedPosition = Math.max(0, Math.min(maxPosition, Number.isFinite(position) ? position : 0));
        const currentFrameIndex = Math.min(this.sequence.length - 1, Math.floor(clampedPosition));
        const nextFrameIndex = currentFrameIndex + 1 < this.sequence.length ? currentFrameIndex + 1 : -1;
        const factor = nextFrameIndex >= 0 ? clampedPosition - currentFrameIndex : 0;

        if (force || currentFrameIndex !== this.frameIndex) {
            const frame = this.sequence.getFrame(currentFrameIndex);
            const prevFrame = this.sequence.getFrame(currentFrameIndex - 1);
            this._copyFrameToParticles(frame, prevFrame);
            this.frameIndex = currentFrameIndex;
            this.renderer.markParticlesDirty?.();
            this._setInterpolationTarget(frame, nextFrameIndex);
        }

        this._playbackPosition = clampedPosition;
        this._interpolationFactor = factor;
    }

    _copyFrameToParticles(frame, prevFrame) {
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
    }

    _setInterpolationTarget(currentFrame, nextFrameIndex) {
        if (!this.dfri) {
            return;
        }

        const nextFrame = nextFrameIndex >= 0 ? this.sequence.getFrame(nextFrameIndex) : null;
        if (!nextFrame) {
            this.renderer.setInterpolationFrame?.(null);
            this.renderer.setInterpolationFactor?.(0);
            return;
        }

        if (!this.dfri.setNextPositionFrame(nextFrame, false)) {
            const components = this.sequence.componentsCount;
            this.dfri.setNextFrame((i, out) => {
                const src = i * components;
                out.x = nextFrame[src] - currentFrame[src];
                out.y = nextFrame[src + 1] - currentFrame[src + 1];
            }, false);
        }
    }

    _updateProgressUi() {
        if (!this.sequence) {
            return;
        }

        const subFrameCount = this._getUiSubFrameCount();
        const fraction = this._playbackPosition - Math.floor(this._playbackPosition);
        const subFrame = Math.min(subFrameCount - 1, Math.floor(fraction * subFrameCount));
        this.playerCtrl.setCurrentFrame(this.frameIndex, subFrame);
    }

    _getFramesPerRecordedStep() {
        if (!this.sequence) {
            return 1;
        }
        return this.settings.world.fps / Math.max(1e-9, this.sequence.fps * this.currentSpeed);
    }

    _getUiSubFrameCount() {
        return Math.max(1, Math.ceil(this._getFramesPerRecordedStep()));
    }

    _updateSequenceUi() {
        if (!this.sequence) {
            return;
        }

        const framesPerStep = this._getFramesPerRecordedStep();
        this.playerCtrl.setupSequence(this.sequence.length, this._getUiSubFrameCount());
        this.playerCtrl.setPlaybackPacing({
            targetFps: this.settings.world.fps,
            sourceFps: this.sequence.fps,
            speed: this.currentSpeed,
            framesPerStep,
            interpolatedFrames: Math.max(0, framesPerStep - 1),
        });
        this._updateProgressUi();
    }

    _resetPlaybackClock(timestamp = null) {
        this._playbackClockTimestamp = timestamp;
        this._lastPresentedTimestamp = null;
    }

    handleControl(state) {
        switch (state) {
            case ControlStateEnum.play:
                this._resetPlaybackClock();
                this.playerCtrl.setState(PlayerStateEnum.playing);
                break;

            case ControlStateEnum.pause:
                this._playbackClockTimestamp = null;
                this.playerCtrl.setState(PlayerStateEnum.paused);
                break;

            case ControlStateEnum.rewind:
                this.renderer.reset();
                this.renderer.clear();
                this.dfri?.reset();
                this._applyPlaybackPosition(0, true);
                this._resetPlaybackClock();
                this.playerCtrl.setState(PlayerStateEnum.playing);
                break;

            case ControlStateEnum.reset:
                this.renderer.reset();
                this.renderer.clear();
                this.dfri?.reset();
                this._applyPlaybackPosition(0, true);
                this._resetPlaybackClock();
                this.playerCtrl.setState(PlayerStateEnum.waiting);
                break;
        }
    }

    handleSeek({frame, subFrame}) {
        if (!this._statesToRender.has(this.playerCtrl.currentState)) {
            return;
        }

        const subFrameCount = this._getUiSubFrameCount();
        const fraction = subFrameCount > 1 ? Math.max(0, Math.min(1, subFrame / subFrameCount)) : 0;
        this._applyPlaybackPosition(frame + fraction, true);
        this._resetPlaybackClock();
        this._updateProgressUi();

        if (this.playerCtrl.currentState === PlayerStateEnum.finished) {
            this.playerCtrl.setState(PlayerStateEnum.paused);
        }
    }

    handleSpeed(speed) {
        const parsed = Number(speed);
        if (!Number.isFinite(parsed) || parsed <= 0) {
            return;
        }

        if (this.sequence && this.playerCtrl.currentState === PlayerStateEnum.playing) {
            this._advancePlaybackClock(performance.now());
        }

        this.currentSpeed = parsed;
        if (this.dfri && this.sequence) {
            this.dfri.reconfigure(this.sequence.fps * this.currentSpeed, this.settings.world.fps);
            this.dfri.init();
        }

        this._resetPlaybackClock();
        this._updateSequenceUi();
    }

    _updateRenderSetting(name, value) {
        this.settings.render.config[name] = value;
        this.renderer?.reconfigure?.(this.settings);
    }

    _updateColorMode(value) {
        this.settings.render.config.colorMode = value;
        this.renderer?.resetParticleColors?.();
        this.renderer?.reconfigure?.(this.settings);
    }
}

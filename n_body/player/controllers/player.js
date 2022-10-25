import * as CommonUtils from "../../utils/common.js";
import {ControlBarController, ControlStateEnum} from "./control_bar.js";
import {LoaderController} from "./loader.js";
import {PlayerStateEnum} from "./base.js";
import {Label} from "../../ui/controls/label.js";
import {Control} from "../../ui/controls/base.js";
import {Popup, PopupDirectionEnum} from "../../ui/controls/popup.js";
import {SettingsController} from "./settings.js";
import {StateControllerBase} from "../../controllers/base.js";

/**
 * @enum{number}
 */
const PlayerMouseStateEnum = {
    active: 0,
    waiting: 1,
    inactive: 2
}

/**
 * @extends StateControllerBase<PlayerStateEnum>
 */
export class PlayerController extends StateControllerBase {
    static DATA_EVENT = "player_data";
    static CONTROL_EVENT = "player_control";
    static SEEK_EVENT = "player_seek";
    static SPEED_EVENT = "player_speed";

    static MOUSE_INACTIVE_DELAY = 2000;

    framesCount = 0;
    subFrameCount = 0;
    frameIndex = 0;
    subFrameIndex = 0;

    _playerMouseState = PlayerMouseStateEnum.active;
    _inactiveTimer = null;

    constructor(root, parentCtrl = null) {
        super(root, parentCtrl);

        this.loaderCtrl = new LoaderController(document.getElementById("loader"), this);
        this.loaderCtrl.subscribe(this, LoaderController.DATA_EVENT, (sender, file) => this.emitEvent(PlayerController.DATA_EVENT, file));

        this.controlBarCtrl = new ControlBarController(document.getElementById("control-bar"), this);
        this.controlBarCtrl.subscribe(this, ControlBarController.ACTION_EVENT, this._onControl.bind(this));
        this.controlBarCtrl.subscribe(this, ControlBarController.SEEK_EVENT, this._onSeek.bind(this));

        this.settingsCtrl = new SettingsController(document.getElementById("settings-content"), this);
        this.settingsCtrl.subscribe(this, SettingsController.SPEED_EVENT, this._onSpeedChange.bind(this))

        this.settingsPopup = Popup.byId("settings-popup", this.settingsCtrl.root);
        this.settingsPopup.offsetY = 0.4;
        this.settingsPopup.direction = PopupDirectionEnum.up;
        this.settingsPopup.anchor = this.controlBarCtrl.settingsControl.element;


        this.loadingScreen = Control.byId("loading-screen");
        this.loadingStatus = Label.byId("loading-status");

        this._globalHotKeyHandler = this._handleHotKey.bind(this);
        this._globalMouseMoveHandler = this._handleMouseMove.bind(this);
    }

    setLoadingProgress(loaded, size) {
        if (size > 0) {
            this.loadingStatus.setText(`Loaded ${this._getSizeLabel(loaded)} from ${this._getSizeLabel(size)}`);
        } else {
            this.loadingStatus.setText(`Loaded ${this._getSizeLabel(loaded)}`);
        }
    }

    configure(settings) {
        this.controlBarCtrl.settingsControl.setVisibility(settings.render.enableDFRI);
    }

    _getSizeLabel(size) {
        return CommonUtils.formatByteSize(size);
    }

    setupSequence(frameCount, subFrameCount) {
        this.framesCount = frameCount;
        this.subFrameCount = subFrameCount;

        this.controlBarCtrl.setProgressRange(this.framesCount * this.subFrameCount);
    }

    setCurrentFrame(frameIndex, subFrameIndex) {
        this.frameIndex = frameIndex;
        this.subFrameIndex = subFrameIndex;

        this.controlBarCtrl.setProgress(this.frameIndex * this.subFrameCount + this.subFrameIndex);
    }

    _seekOffset(offset) {
        this._onSeek(this, this.frameIndex * this.subFrameCount + this.subFrameIndex + offset);
    }

    _onSeek(sender, value) {
        if (!this.framesCount) {
            return;
        }

        value = Math.max(0, Math.min(this.framesCount * this.subFrameCount - 1, value));
        const frameIndex = Math.floor(value / this.subFrameCount);
        const subFrameIndex = Math.floor(value % this.subFrameCount);

        this.emitEvent(PlayerController.SEEK_EVENT, {frame: frameIndex, subFrame: subFrameIndex});
    }

    _onControl(sender, type) {
        if (type === ControlStateEnum.settings) {
            this.settingsPopup.show();
        }

        this.emitEvent(PlayerController.CONTROL_EVENT, type);
    }

    _onSpeedChange(sender, speed) {
        this.emitEvent(PlayerController.SPEED_EVENT, speed);
    }

    _handleHotKey(e) {
        let handled = true;
        switch (e.code) {
            case "Escape":
                this.controlBarCtrl.toggleVisibility();
                if (!this.controlBarCtrl.shown) {
                    this.settingsPopup.hide();
                }
                break;

            case "Space":
                this.setState(this.currentState === PlayerStateEnum.playing ? PlayerStateEnum.paused : PlayerStateEnum.playing);
                break;

            case "ArrowLeft":
                this._seekOffset(-1);
                break;

            case "ArrowRight":
                this._seekOffset(1);
                break;

            case "ArrowUp":
                this._seekOffset(Math.ceil(this.framesCount * this.subFrameCount * 0.1));
                break;

            case "ArrowDown":
                this._seekOffset(Math.ceil(-this.framesCount * this.subFrameCount * 0.1));
                break;

            default:
                handled = false;
        }

        if (handled) {
            e.stopPropagation();
            e.preventDefault();
        }
    }

    _handleMouseMove() {
        this._handleMouseState(PlayerMouseStateEnum.waiting);
    }

    _handleMouseState(state) {
        if (this._inactiveTimer !== null) {
            clearTimeout(this._inactiveTimer);
        }

        if (this._playerMouseState === PlayerMouseStateEnum.active && state === PlayerMouseStateEnum.inactive) {
            return;
        }

        this._playerMouseState = state;
        switch (this._playerMouseState) {
            case PlayerMouseStateEnum.active:
                this.frame.removeClass("mouse-inactive");
                if (this._inactiveTimer !== null) {
                    clearTimeout(this._inactiveTimer);
                }
                this._inactiveTimer = null;
                break;

            case PlayerMouseStateEnum.waiting:
                this.frame.removeClass("mouse-inactive");
                this._inactiveTimer = setTimeout(() => this._handleMouseState(PlayerMouseStateEnum.inactive), PlayerController.MOUSE_INACTIVE_DELAY);
                break;

            case PlayerMouseStateEnum.inactive:
                this.frame.addClass("mouse-inactive");
                this._inactiveTimer = null;

                break;
        }
    }

    onStateChanged(sender, oldState, newState) {
        switch (oldState) {
            case PlayerStateEnum.unset:
            case PlayerStateEnum.loading:
                this.loadingStatus.setText("");
                this.loadingScreen.setVisibility(false);
                this.loadingStatus.setVisibility(false);
                break;
        }

        switch (newState) {
            case PlayerStateEnum.waiting:
                document.body.removeEventListener("keydown", this._globalHotKeyHandler);
                document.body.removeEventListener("mousemove", this._globalMouseMoveHandler);
                this._handleMouseState(PlayerMouseStateEnum.active);
                break;

            case PlayerStateEnum.loading:
                this.loadingScreen.setVisibility(true);
                this.loadingStatus.setVisibility(true);
                break;
        }

        if (oldState === PlayerStateEnum.loading && newState === PlayerStateEnum.playing) {
            document.body.addEventListener("keydown", this._globalHotKeyHandler);
            document.body.addEventListener("mousemove", this._globalMouseMoveHandler);
            this._handleMouseState(PlayerMouseStateEnum.waiting);
        }
    }
}
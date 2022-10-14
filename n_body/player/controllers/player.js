import {ControlBarController} from "./control_bar.js";
import {LoaderController} from "./loader.js";
import {StateControllerBase, StateEnum} from "./base.js";
import {LabelControl} from "../../ui/controls/label.js";
import {Control} from "../../ui/controls/base.js";

export class PlayerController extends StateControllerBase {
    static PLAYER_DATA_EVENT = "player_data";
    static PLAYER_CONTROL_EVENT = "player_control";
    static PLAYER_SEEK_EVENT = "player_seek";

    framesCount = 0;
    subFrameCount = 0;
    frameIndex = 0;
    subFrameIndex = 0;

    constructor(root, parentCtrl = null) {
        super(root, parentCtrl);

        this.loaderCtrl = new LoaderController(document.getElementById("loader"), this);
        this.loaderCtrl.subscribe(this, LoaderController.LOADER_DATA_EVENT,
            (sender, file) => this.emitEvent(PlayerController.PLAYER_DATA_EVENT, file));

        this.controlBarCtrl = new ControlBarController(document.getElementById("control-bar"), this);
        this.controlBarCtrl.subscribe(this, ControlBarController.CONTROL_ACTION_EVENT,
            (sender, type) => this.emitEvent(PlayerController.PLAYER_CONTROL_EVENT, type));
        this.controlBarCtrl.subscribe(this, ControlBarController.CONTROL_SEEK_EVENT, this._onSeek.bind(this));

        this.loadingScreen = Control.byId("loading-screen");
        this.loadingStatus = LabelControl.byId("loading-status");
    }

    setLoadingProgress(loaded, size) {
        this.loadingStatus.setText(`Loaded ${this._getSizeLabel(loaded)} from ${this._getSizeLabel(size)}`);
    }

    _getSizeLabel(size) {
        const units = [
            {unit: "T", exp: Math.pow(1024, 4)},
            {unit: "G", exp: Math.pow(1024, 3)},
            {unit: "M", exp: Math.pow(1024, 2)},
            {unit: "K", exp: 1024},
        ]

        let unit = "";
        let value = size;
        for (let i = 0; i < units.length; i++) {
            if (value >= units[i].exp) {
                value /= units[i].exp;
                unit = units[i].unit;
                break;
            }
        }

        return `${value.toFixed(2)} ${unit}B`;
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

    _onSeek(sender, value) {
        if (!this.framesCount) {
            return;
        }

        const frameIndex = Math.floor(value / this.subFrameCount);
        const subFrameIndex = Math.floor(value % this.subFrameCount);

        this.emitEvent(PlayerController.PLAYER_SEEK_EVENT, {frame: frameIndex, subFrame: subFrameIndex});
    }

    onStateChanged(sender, oldState, newState) {
        switch (oldState) {
            case StateEnum.unset:
            case StateEnum.loading:
                this.loadingStatus.setText("");
                this.loadingScreen.setVisibility(false);
                this.loadingStatus.setVisibility(false);
                break;
        }

        switch (newState) {
            case StateEnum.loading:
                this.loadingScreen.setVisibility(true);
                this.loadingStatus.setVisibility(true);
                break;
        }
    }
}
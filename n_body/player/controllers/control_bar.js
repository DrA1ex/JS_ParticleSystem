import {StateControllerBase} from "../../controllers/base.js";
import {View} from "../../ui/controls/base.js";
import {Button} from "../../ui/controls/button.js";
import {PlayingProgress} from "../../ui/controls/playing_progress.js";
import {PlayerStateEnum} from "./base.js";

const view = await fetch(new URL("./views/control_bar.html", import.meta.url)).then(d => d.text());

/**
 * @readonly
 * @enum {number}
 */
export const ControlStateEnum = {
    play: 0,
    pause: 1,
    reset: 2,
    rewind: 3,
    settings: 4,
}

/**
 * @extends StateControllerBase<PlayerStateEnum>
 */
export class ControlBarController extends StateControllerBase {
    static CONTROL_ACTION_EVENT = "control_action";
    static CONTROL_SEEK_EVENT = "control_seek";

    constructor(root, stateCtrl) {
        const viewObj = new View(root, view);
        super(viewObj.element, stateCtrl);

        this.playControl = Button.byId("play")
        this.playControl.setOnClick(this.play.bind(this));

        this.pauseControl = Button.byId("pause")
        this.pauseControl.setOnClick(this.pause.bind(this));

        this.rewindControl = Button.byId("rewind")
        this.rewindControl.setOnClick(this.rewind.bind(this));

        this.resetControl = Button.byId("reset")
        this.resetControl.setOnClick(this.reset.bind(this));

        this.settingsControl = Button.byId("settings");
        this.settingsControl.setOnClick(this.openSettings.bind(this));

        this.progressControl = PlayingProgress.byId("simulation-progress");
        this.progressControl.setOnSeek(this.seek.bind(this));

        this.setEnabled(false);
    }


    setProgressRange(count) {
        this.progressControl.setRange(0, count);
    }

    setProgress(value) {
        this.progressControl.setValue(value);
    }

    play() {
        this.emitEvent(ControlBarController.CONTROL_ACTION_EVENT, ControlStateEnum.play);
    }

    pause() {
        this.emitEvent(ControlBarController.CONTROL_ACTION_EVENT, ControlStateEnum.pause);
    }

    rewind() {
        this.emitEvent(ControlBarController.CONTROL_ACTION_EVENT, ControlStateEnum.rewind);
    }

    reset() {
        this.emitEvent(ControlBarController.CONTROL_ACTION_EVENT, ControlStateEnum.reset);
    }

    seek(value) {
        this.emitEvent(ControlBarController.CONTROL_SEEK_EVENT, value);
    }

    openSettings() {
        this.emitEvent(ControlBarController.CONTROL_ACTION_EVENT, ControlStateEnum.settings);
    }

    setEnabled(enabled) {
        this.playControl.setEnabled(enabled);
        this.pauseControl.setEnabled(enabled);
        this.rewindControl.setEnabled(enabled);
        this.resetControl.setEnabled(enabled);
        this.settingsControl.setEnabled(enabled);

        this.frame.setVisibility(enabled);
    }

    onStateChanged(sender, oldState, newState) {
        switch (newState) {
            case PlayerStateEnum.waiting:
            case PlayerStateEnum.loading:
                this.setEnabled(false);

                this.playControl.setVisibility(true);
                this.pauseControl.setVisibility(false);
                this.progressControl.setValue(0);
                break;

            case PlayerStateEnum.playing:
                this.setEnabled(true);

                this.playControl.setVisibility(false);
                this.pauseControl.setVisibility(true);
                break;

            case PlayerStateEnum.paused:
                this.playControl.setEnabled(true);

                this.playControl.setVisibility(true);
                this.pauseControl.setVisibility(false);
                break;

            case PlayerStateEnum.finished:
                this.playControl.setEnabled(false);
                this.pauseControl.setVisibility(false);
                this.playControl.setVisibility(true);
                break;
        }
    }
}
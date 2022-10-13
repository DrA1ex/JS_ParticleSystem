import {ButtonControl} from "../../ui/controls/button.js";
import {ProgressBarControl} from "../../ui/controls/progress_bar.js";
import {StateEnum, StateControllerBase} from "./base.js";

/**
 * @readonly
 * @enum {number}
 */
export const ControlStateEnum = {
    play: 0,
    pause: 1,
    reset: 2,
    rewind: 3,

    progress: 10,
}

export class ControlBarController extends StateControllerBase {
    static CONTROL_EVENT = "control";

    constructor(root, stateCtrl) {
        super(root, stateCtrl);

        this.playControl = ButtonControl.byId("play")
        this.playControl.setOnClick(this.play.bind(this));

        this.pauseControl = ButtonControl.byId("pause")
        this.pauseControl.setOnClick(this.pause.bind(this));

        this.rewindControl = ButtonControl.byId("rewind")
        this.rewindControl.setOnClick(this.rewind.bind(this));

        this.resetControl = ButtonControl.byId("reset")
        this.resetControl.setOnClick(this.reset.bind(this));

        this.progressControl = ProgressBarControl.byId("simulation-progress");

        this.setEnabled(false);
    }


    setProgressRange(count) {
        this.progressControl.setRange(0, count);
    }

    setProgress(value) {
        this.progressControl.setValue(value);
    }

    play() {
        this.emitEvent(ControlBarController.CONTROL_EVENT, ControlStateEnum.play);
    }

    pause() {
        this.emitEvent(ControlBarController.CONTROL_EVENT, ControlStateEnum.pause);
    }

    rewind() {
        this.emitEvent(ControlBarController.CONTROL_EVENT, ControlStateEnum.rewind);
    }

    reset() {
        this.emitEvent(ControlBarController.CONTROL_EVENT, ControlStateEnum.reset);
    }

    setEnabled(enabled) {
        this.playControl.setEnabled(enabled);
        this.pauseControl.setEnabled(enabled);
        this.rewindControl.setEnabled(enabled);
        this.resetControl.setEnabled(enabled);
    }

    onStateChanged(sender, oldState, newState) {
        switch (newState) {
            case StateEnum.waiting:
            case StateEnum.loading:
                this.setEnabled(false);

                this.playControl.setVisibility(true);
                this.progressControl.setValue(0);
                break;

            case StateEnum.playing:
                this.setEnabled(true);

                this.playControl.setVisibility(false);
                this.pauseControl.setVisibility(true);
                break;

            case StateEnum.paused:
                this.playControl.setVisibility(true);
                this.pauseControl.setVisibility(false);
                break;

            case StateEnum.finished:
                this.playControl.setEnabled(false);
                this.pauseControl.setVisibility(false);
                this.playControl.setVisibility(true);
                break;
        }
    }
}
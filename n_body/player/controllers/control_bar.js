import {ButtonControl} from "../../ui/controls/button.js";
import {ProgressBarControl} from "../../ui/controls/progress_bar.js";
import {StateEnum, StateControllerBase} from "./base.js";
import {View} from "../../ui/controls/base.js";

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

    progress: 10,
}

export class ControlBarController extends StateControllerBase {
    static CONTROL_ACTION_EVENT = "control_action";
    static CONTROL_SEEK_EVENT = "control_seek";

    constructor(root, stateCtrl) {
        const viewObj = new View(root, view);
        super(viewObj.element, stateCtrl);
        this.view = viewObj;

        this.playControl = ButtonControl.byId("play")
        this.playControl.setOnClick(this.play.bind(this));

        this.pauseControl = ButtonControl.byId("pause")
        this.pauseControl.setOnClick(this.pause.bind(this));

        this.rewindControl = ButtonControl.byId("rewind")
        this.rewindControl.setOnClick(this.rewind.bind(this));

        this.resetControl = ButtonControl.byId("reset")
        this.resetControl.setOnClick(this.reset.bind(this));

        this.progressControl = ProgressBarControl.byId("simulation-progress");
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

    setEnabled(enabled) {
        this.playControl.setEnabled(enabled);
        this.pauseControl.setEnabled(enabled);
        this.rewindControl.setEnabled(enabled);
        this.resetControl.setEnabled(enabled);

        this.frame.setVisibility(enabled);
    }

    onStateChanged(sender, oldState, newState) {
        switch (newState) {
            case StateEnum.waiting:
            case StateEnum.loading:
                this.setEnabled(false);

                this.playControl.setVisibility(true);
                this.pauseControl.setVisibility(false);
                this.progressControl.setValue(0);
                break;

            case StateEnum.playing:
                this.setEnabled(true);

                this.playControl.setVisibility(false);
                this.pauseControl.setVisibility(true);
                break;

            case StateEnum.paused:
                this.playControl.setEnabled(true);

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
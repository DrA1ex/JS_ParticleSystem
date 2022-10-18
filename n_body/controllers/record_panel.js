import * as CommonUtils from "../utils/common.js";
import {StateControllerBase} from "./base.js";
import {View} from "../ui/controls/base.js";
import {SimulationStateEnum} from "./enums.js";
import {Button} from "../ui/controls/button.js";
import {Label} from "../ui/controls/label.js";

const view = await fetch(new URL("./views/record_panel.html", import.meta.url)).then(d => d.text());

export class RecordPanelController extends StateControllerBase {
    static STOP_RECORDING_EVENT = "record_panel_stop_recording";

    constructor(root, parentCtrl) {
        const viewControl = new View(root, view)
        super(viewControl.element, parentCtrl);

        this.recordBtn = Button.byId("recording-button");
        this.recordBtn.setOnClick(() => this.emitEvent(RecordPanelController.STOP_RECORDING_EVENT));

        this.recordStatusLbl = Label.byId("recording-status");
    }

    /**
     * @param {SimulationSequence} sequence
     */
    onSequenceUpdated(sequence) {
        const bytes = sequence.length * sequence.particleCount * sequence.componentsCount * Float32Array.BYTES_PER_ELEMENT;
        const writtenLabel = CommonUtils.formatByteSize(bytes);

        this.recordStatusLbl.setText(`Frames: ${sequence.length}, size: ${writtenLabel}`);
    }

    onStateChanged(sender, oldState, newState) {
        switch (oldState) {
            case SimulationStateEnum.recording:
                this.frame.removeClass("shown");
                break;
        }

        switch (newState) {
            case SimulationStateEnum.recording:
                this.recordStatusLbl.setText("Waiting for the first frame");
                this.frame.addClass("shown");
        }
    }
}
import {ControlBarController} from "./control_bar.js";
import {LoaderController} from "./loader.js";
import {StateControllerBase, StateEnum} from "./base.js";
import {LabelControl} from "../../ui/controls/labelControl.js";

export class PlayerController extends StateControllerBase {
    static PLAYER_DATA_EVENT = "player_data";
    static PLAYER_CONTROL_EVENT = "player_control";

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
        this.controlBarCtrl.subscribe(this, ControlBarController.CONTROL_EVENT,
            (sender, type) => this.emitEvent(PlayerController.PLAYER_CONTROL_EVENT, type));

        this.loadingLabel = LabelControl.byId("loading_text");
        this.loadingLabel.setVisibility(false);
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

    onStateChanged(sender, oldState, newState) {
        switch (oldState) {
            case StateEnum.loading:
                this.loadingLabel.setVisibility(false);
                break;
        }

        switch (newState) {
            case StateEnum.loading:
                this.loadingLabel.setVisibility(true);
                break;
        }
    }
}
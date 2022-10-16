import {PlayerStateEnum} from "./base.js";
import {Label} from "../../ui/controls/label.js";
import {StateControllerBase} from "../../controllers/base.js";

/**
 * @extends StateControllerBase<PlayerStateEnum>
 */
export class LoaderController extends StateControllerBase {
    static LOADER_DATA_EVENT = "loader_data";

    constructor(root, stateCtrl) {
        super(root, stateCtrl);

        this.dropLabel = Label.byId("drop_text");

        this.root.ondragover = e => e.preventDefault();
    }

    loadFile(e) {
        e.preventDefault();

        if ((e.dataTransfer?.files?.length ?? 0) === 0) {
            return;
        }

        const file = e.dataTransfer.files[0];
        this.emitEvent(LoaderController.LOADER_DATA_EVENT, file);
    }

    setEnabled(enabled) {
        if (enabled) {
            this.root.ondrop = this.loadFile.bind(this);
            this.frame.setInteractions(true);
        } else {
            this.root.ondrop = false;
            this.frame.setInteractions(false);
        }
    }

    onStateChanged(sender, oldState, newState) {
        switch (oldState) {
            case PlayerStateEnum.waiting:
                this.dropLabel.setVisibility(false);
                this.setEnabled(false);
                break;
        }

        switch (newState) {
            case PlayerStateEnum.waiting:
                this.dropLabel.setVisibility(true);
                this.setEnabled(true);
                break;
        }
    }
}
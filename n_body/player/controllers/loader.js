import {PlayerStateEnum} from "./base.js";
import {Label} from "../../ui/controls/label.js";
import {StateControllerBase} from "../../controllers/base.js";
import {Button} from "../../ui/controls/button.js";
import * as FileUtils from "../../utils/file.js";

/**
 * @extends StateControllerBase<PlayerStateEnum>
 */
export class LoaderController extends StateControllerBase {
    static DATA_EVENT = "loader_data";

    constructor(root, stateCtrl) {
        super(root, stateCtrl);

        this.dropLabel = Label.byId("drop-text");
        this.openFileBtn = Button.byId("open-file-btn");
        this.openFileBtn.setOnClick(this._openFile.bind(this));

        this.root.ondragover = e => e.preventDefault();
    }

    loadFile(e) {
        e.preventDefault();

        if ((e.dataTransfer?.files?.length ?? 0) === 0) {
            return;
        }

        const file = e.dataTransfer.files[0];
        this.emitEvent(LoaderController.DATA_EVENT, file);
    }

    async _openFile() {
        const file = await FileUtils.openFile(".bin", false);
        if (file) {
            this.emitEvent(LoaderController.DATA_EVENT, file);
        }
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
                this.openFileBtn.setVisibility(false);
                this.setEnabled(false);
                break;
        }

        switch (newState) {
            case PlayerStateEnum.waiting:
                this.dropLabel.setVisibility(true);
                this.openFileBtn.setVisibility(true);
                this.setEnabled(true);
                break;
        }
    }
}
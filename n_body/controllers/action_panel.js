import {StateControllerBase} from "./base.js";
import {View} from "../ui/controls/base.js";
import {Button} from "../ui/controls/button.js";
import {SimulationStateEnum} from "./enums.js";

const view = await fetch(new URL("./views/action_panel.html", import.meta.url)).then(d => d.text());

/**
 * @enum{number}
 */
export const ActionEnum = {
    exportState: 0,
    importState: 1,
    record: 2,
    settings: 3,
}

export class ActionPanelController extends StateControllerBase {
    static ACTION_EVENT = "action";

    constructor(root, parentCtrl) {
        const viewControl = new View(root, view);
        super(viewControl.element, parentCtrl);

        this.exportStateBtn = Button.byId("export-state");
        this.exportStateBtn.setOnClick(() => this.emitEvent(ActionPanelController.ACTION_EVENT, ActionEnum.exportState));

        this.importStateBtn = Button.byId("import-state");
        this.importStateBtn.setOnClick(() => this.emitEvent(ActionPanelController.ACTION_EVENT, ActionEnum.importState))

        this.recordBtn = Button.byId("export-recording");
        this.recordBtn.setOnClick(() => this.emitEvent(ActionPanelController.ACTION_EVENT, ActionEnum.record));

        this.settingsBtn = Button.byId("open-settings");
        this.settingsBtn.setOnClick(() => this.emitEvent(ActionPanelController.ACTION_EVENT, ActionEnum.settings));
    }

    onStateChanged(sender, oldState, newState) {
        switch (oldState) {
            case SimulationStateEnum.recording:
                this.recordBtn.setEnabled(true);
                this.settingsBtn.setEnabled(true);
                this.importStateBtn.setEnabled(true);
                break;
        }

        switch (newState) {
            case SimulationStateEnum.recording:
                this.recordBtn.setEnabled(false);
                this.settingsBtn.setEnabled(false);
                this.importStateBtn.setEnabled(false);
                break;
        }
    }
}
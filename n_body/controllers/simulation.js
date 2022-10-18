import {ActionEnum, ActionPanelController} from "./action_panel.js";
import {Control} from "../ui/controls/base.js";
import {Button} from "../ui/controls/button.js";
import {Popup} from "../ui/controls/popup.js";
import {SimulationSerializer} from "../simulation/serializert.js";
import * as FileUtils from "../utils/file.js";
import {StateControllerBase} from "./base.js";
import {SimulationStateEnum} from "./enums.js";
import {Label} from "../ui/controls/label.js";
import {SimulationSequence} from "../simulation/sequence.js";
import {ITEM_SIZE} from "../backend/base.js";
import {RecordPanelController} from "./record_panel.js";
import {RecordSettingsController} from "./record_settings.js";
import {Dialog} from "../ui/controls/dialog.js";

/**
 * @extends StateControllerBase<SimulationStateEnum>
 */
export class SimulationController extends StateControllerBase {
    _exportSequence = null;
    _exportFrameNumber = 0;

    constructor(root, app) {
        super(root);

        this.app = app;

        this.actionPanelCtrl = new ActionPanelController(document.getElementById("action-panel-content"), this);
        this.actionPanelCtrl.subscribe(this, ActionPanelController.ACTION_EVENT, this._onAction.bind(this));

        this.actionPanelPopup = Popup.byId("action-panel", this.actionPanelCtrl.root);

        this.actionButton = Button.byId("action-button");
        this.actionPanelPopup.anchor = this.actionButton.element;
        this.actionButton.setOnClick(() => this.actionPanelPopup.show());
        this.actionButton.setVisibility(false);

        this.loadingScreen = Control.byId("loading-screen");

        this.hintLabel = Label.byId("hint");
        this.hintLabel.setVisibility(false);

        this.recordBar = new RecordPanelController(document.getElementById("record-panel"), this);
        this.recordBar.subscribe(this, RecordPanelController.STOP_RECORDING_EVENT, this.exportRecording.bind(this));

        this.recordSettingsCtrl = new RecordSettingsController(document.getElementById("record-settings-content"), this);
        this.recordSettingsCtrl.subscribe(this, RecordSettingsController.START_RECORDING_EVENT,
            () => this.setState(SimulationStateEnum.recording));

        this.recordSettingsDialog = Dialog.byId("record-settings", this.recordSettingsCtrl.root);
        this.recordSettingsDialog.setOnDismissed(() => this.setState(SimulationStateEnum.active));
    }

    _onAction(sender, action) {
        switch (action) {
            case ActionEnum.exportState:
                this.exportState();
                break;

            case ActionEnum.record:
                this.recordSettingsCtrl.configure(this.app.settings.fps,
                    this.app.settings.particleCount * SimulationSerializer.COMPONENTS_COUNT * Float32Array.BYTES_PER_ELEMENT,
                    SimulationSerializer.META_SIZE, this.app.debug.frameLatency);
                this.recordSettingsDialog.show();

                this.setState(SimulationStateEnum.paused);
                break;
        }

        this.actionPanelPopup.hide();
    }

    /**
     * @param {Float32Array} buffer
     */
    onNewBuffer(buffer) {
        if (this.currentState !== SimulationStateEnum.recording) {
            return;
        }

        if (this._exportFrameNumber % (this.app.settings.fps / this._exportSequence.fps) === 0) {
            this._exportSequence.addFrame(this._transformBuffer(buffer));
            this.recordBar.onSequenceUpdated(this._exportSequence);
        }

        if (this.recordSettingsCtrl.totalFrames > 0 && this._exportSequence.length >= this.recordSettingsCtrl.totalFrames) {
            this.exportRecording();
        }

        this._exportFrameNumber += 1;
    }

    _transformBuffer(buffer) {
        const frame = new Float32Array(this._exportSequence.particleCount * this._exportSequence.componentsCount);

        for (let i = 0; i < this._exportSequence.particleCount; i++) {
            frame[i * this._exportSequence.componentsCount] = buffer[i * ITEM_SIZE];
            frame[i * this._exportSequence.componentsCount + 1] = buffer[i * ITEM_SIZE + 1];
        }

        return frame;
    }

    exportState() {
        const data = {
            settings: this.app.settings.serialize(),
            particles: this.app.particles.map(p => [p.x, p.y, p.velX, p.velY, p.mass]),
            renderer: {
                scale: this.app.renderer.scale / this.app.renderer.dpr,
                relativeOffset: this.app.renderer.centeredRelativeOffset()
            }
        }

        FileUtils.saveFile(JSON.stringify(data),
            `universe_state_${new Date().toISOString()}.json`, "application/json");
    }

    exportRecording() {
        if (this.currentState !== SimulationStateEnum.recording) {
            return;
        }

        const meta = SimulationSerializer.formatMeta(this._exportSequence);
        FileUtils.saveFileParts(
            [meta, ...this._exportSequence.frames],
            `sequence_${this.app.settings.particleCount}_${this._exportSequence.length}_${new Date().toISOString()}.bin`,
            "application/octet-stream"
        );

        this.setState(SimulationStateEnum.active);
    }

    onStateChanged(sender, oldState, newState) {
        switch (oldState) {
            case SimulationStateEnum.unset:
                this.loadingScreen.setVisibility(false);
                this.hintLabel.setVisibility(true);
                this.actionButton.setVisibility(true);
                break;

            case SimulationStateEnum.recording:
                this._exportSequence = null;
                this._exportFrameNumber = 0;
                break;
        }

        switch (newState) {
            case SimulationStateEnum.recording:
                this.recordSettingsDialog.hide();
                this._exportSequence = new SimulationSequence(this.app.settings.particleCount, SimulationSerializer.COMPONENTS_COUNT,
                    this.recordSettingsCtrl.frameRate);
        }
    }
}
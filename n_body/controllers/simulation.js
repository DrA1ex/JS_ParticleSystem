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
import {Dialog, DialogPositionEnum, DialogTypeEnum} from "../ui/controls/dialog.js";
import {SettingsController} from "./settings.js";
import {AppSimulationSettings} from "../settings/app.js";
import {Frame} from "../ui/controls/frame.js";

/**
 * @extends StateControllerBase<SimulationStateEnum>
 */
export class SimulationController extends StateControllerBase {
    _exportSequence = null;
    _exportFrameNumber = 0;

    constructor(root, app) {
        super(root);

        this.app = app;

        this.rootContent = Frame.byId("root-content");

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
        this.recordSettingsDialog.type = DialogTypeEnum.closable;

        this.settingsCtrl = new SettingsController(document.getElementById("settings-content"), this);
        this.settingsCtrl.subscribe(this, SettingsController.RECONFIGURE_EVENT, (sender, data) => this.reconfigure(data));

        this.settingsDialog = Dialog.byId("settings", this.settingsCtrl.root);
        this.settingsDialog.setOnDismissed(this.onSettingsClosed.bind(this));
        this.settingsDialog.type = this.app.settings.common.isMobile() ? DialogTypeEnum.modal : DialogTypeEnum.popover;
        this.settingsDialog.position = this.app.settings.common.isMobile() ? DialogPositionEnum.center : DialogPositionEnum.left;
    }

    _onAction(sender, action) {
        switch (action) {
            case ActionEnum.exportState:
                this.exportState();
                break;

            case ActionEnum.importState:
                this.importState().catch(() => {});
                break;

            case ActionEnum.record:
                this.recordSettingsCtrl.configure(this.app.settings.world.fps,
                    this.app.settings.physics.particleCount * SimulationSerializer.COMPONENTS_COUNT * Float32Array.BYTES_PER_ELEMENT,
                    SimulationSerializer.META_SIZE, this.app.debug.frameLatency);
                this.recordSettingsDialog.show();

                this.setState(SimulationStateEnum.paused);
                break;

            case ActionEnum.settings:
                this.settingsCtrl.configure(this.app.settings);
                this.settingsDialog.show();
                this.actionButton.setVisibility(false);
                this.actionPanelPopup.setVisibility(false);
                this._resizeCanvasForSettings();
                break;
        }

        this.actionPanelPopup.hide();
    }

    onSettingsClosed() {
        this.actionButton.setVisibility(true);
        this.actionPanelPopup.setVisibility(true);
        this._resizeCanvasForSettings();
    }

    _resizeCanvasForSettings() {
        if (this.app.settings.common.isMobile()) {
            return;
        }

        const rect = this.settingsDialog.dialogElement.getBoundingClientRect();
        this.rootContent.element.style.width = `calc(100% - ${rect.right}px)`;
        this.rootContent.element.style.transform = `translateX(${rect.right}px)`
    }

    /**
     * @param {Float32Array} buffer
     */
    onNewBuffer(buffer) {
        if (this.currentState !== SimulationStateEnum.recording) {
            return;
        }

        if (this._exportFrameNumber % this.recordSettingsCtrl.frameRateRatio === 0) {
            this._exportSequence.addFrame(this._transformBuffer(buffer));
            this.recordBar.onSequenceUpdated(this._exportSequence, this.recordSettingsCtrl.frameRateRatio, this.recordSettingsCtrl.totalFrames, this.app.debug.frameLatency);
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
            settings: this.app.settings.export(),
            particles: this.app.particles.map(p => [p.x, p.y, p.velX, p.velY, p.mass]),
            renderer: {
                scale: this.app.renderer.scale / this.app.renderer.dpr,
                relativeOffset: this.app.renderer.centeredRelativeOffset()
            }
        }

        FileUtils.saveFile(JSON.stringify(data),
            `universe_state_${new Date().toISOString()}.json`, "application/json");
    }

    async importState() {
        const file = await FileUtils.openFile("application/json", false);
        if (!file) {
            return;
        }

        this.setState(SimulationStateEnum.reconfigure);

        try {
            const data = await file.text();
            const state = JSON.parse(data);
            this.app.reloadFromState(state);
        } catch (e) {
            this.setState(SimulationStateEnum.active);
            alert(`Unable to load state: ${e.message}`);
        }
    }

    exportRecording() {
        if (this.currentState !== SimulationStateEnum.recording) {
            return;
        }

        const meta = SimulationSerializer.formatMeta(this._exportSequence);
        FileUtils.saveFileParts(
            [meta, ...this._exportSequence.frames],
            `sequence_${this.app.settings.physics.particleCount}_${this._exportSequence.length}_${new Date().toISOString()}.bin`,
            "application/octet-stream"
        );

        this.setState(SimulationStateEnum.active);
    }

    reconfigure(settings) {
        this.app.reconfigure(AppSimulationSettings.deserialize(settings));
    }

    onStateChanged(sender, oldState, newState) {
        switch (oldState) {
            case SimulationStateEnum.recording:
                this._exportSequence = null;
                this._exportFrameNumber = 0;
                break;
        }

        switch (newState) {
            case SimulationStateEnum.active:
                this.loadingScreen.setVisibility(false);
                this.hintLabel.setVisibility(true);
                this.actionButton.setVisibility(true);
                break;

            case SimulationStateEnum.loading:
            case SimulationStateEnum.reconfigure:
                this.loadingScreen.setVisibility(true);
                this.hintLabel.setVisibility(false);
                this.actionButton.setVisibility(false);
                break;

            case SimulationStateEnum.recording:
                this.recordSettingsDialog.hide();
                this._exportSequence = new SimulationSequence(this.app.settings.physics.particleCount, SimulationSerializer.COMPONENTS_COUNT,
                    this.recordSettingsCtrl.frameRate);
        }
    }
}
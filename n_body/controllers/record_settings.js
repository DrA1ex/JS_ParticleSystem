import {ControllerBase} from "./base.js";
import {View} from "../ui/controls/base.js";
import {Button} from "../ui/controls/button.js";
import {Select} from "../ui/controls/select.js";
import {Label} from "../ui/controls/label.js";
import * as CommonUtils from "../utils/common.js";

const view = await fetch(new URL("./views/record_settings.html", import.meta.url)).then(d => d.text());

export class RecordSettingsController extends ControllerBase {
    static START_RECORDING_EVENT = "start_recording";

    static RECOMMENDED_MAX_SIZE = 1024 * 1024 * 1024 * 2 - 1;

    _totalFrames;
    _fpsRatio;
    fps;
    frameSize;
    frameTime;

    get frameRate() {
        return Number.parseInt(this.frameRateSelect.selected);
    }

    get duration() {
        return Number.parseInt(this.recodDurationSelect.selected);
    }

    get totalFrames() {
        return this._totalFrames;
    }

    get frameRateRatio() {
        return this._fpsRatio;
    }

    constructor(root, parentCtrl) {
        const viewControl = new View(root, view)
        super(viewControl.element, parentCtrl);

        this.startRecordBtn = Button.byId("start-record");
        this.startRecordBtn.setOnClick(() => this.emitEvent(RecordSettingsController.START_RECORDING_EVENT));

        this.frameRateSelect = Select.byId("framerate-select");
        this.frameRateSelect.setOptions(["1", "2", "3", "5", "10", "15", "20", "30", "60"]);
        this.frameRateSelect.select("10");
        this.frameRateSelect.setOnChange(this._update.bind(this));

        this.recodDurationSelect = Select.byId("duration-select");
        this.recodDurationSelect.setOptions([
            {key: "-1", label: "infinite"},
            ...[1, 3, 5, 10, 20, 30, 60, 180, 300, 600, 1200, 1800, 3600]
                .map(v => ({key: v.toString(), label: CommonUtils.formatTimeSpan(v * 1000)}))
        ]);
        this.recodDurationSelect.select("-1")
        this.recodDurationSelect.setOnChange(this._update.bind(this));

        this.refFramerateLbl = Label.byId("reference-framerate");
        this.frameTimeLbl = Label.byId("frame-time");
        this.frameSizeLbl = Label.byId("frame-size");
        this.frameCountLbl = Label.byId("frame-count");
        this.totalSizeLbl = Label.byId("total-size");
        this.totalDurationLbl = Label.byId("total-duration");
    }

    configure(referenceFps, frameSize, metaSize, frameTime) {
        this.fps = referenceFps;
        this.frameSize = frameSize;
        this.metaSize = metaSize;
        this.frameTime = frameTime;

        this.refFramerateLbl.setText(referenceFps);
        this.frameTimeLbl.setText(CommonUtils.formatTimeSpan(this.frameTime, 2));
        this.frameSizeLbl.setText(CommonUtils.formatByteSize(this.frameSize));

        this._update();
    }

    _update() {
        this._fpsRatio = Math.round(this.fps / this.frameRate);
        this._totalFrames = this.duration > 0 ? this.frameRate * this.duration : -1;

        if (this.totalFrames > 0) {
            const totalSize = this.metaSize + this.frameSize * this.totalFrames;
            this.totalSizeLbl.setText(`${CommonUtils.formatByteSize(totalSize)}`);
            this.frameCountLbl.setText(this.totalFrames);
            if (totalSize > RecordSettingsController.RECOMMENDED_MAX_SIZE) {
                this.totalSizeLbl.addClass("warning")
                this.totalSizeLbl.setTooltip(`Recommended maximum size is ${CommonUtils.formatByteSize(RecordSettingsController.RECOMMENDED_MAX_SIZE)}`);
            } else {
                this.totalSizeLbl.removeClass("warning")
                this.totalSizeLbl.setTooltip("");
            }

            this.totalDurationLbl.setText(CommonUtils.formatTimeSpan(this.totalFrames * this.frameRateRatio * this.frameTime));
        } else {
            this.frameCountLbl.setText("∞");
            this.totalSizeLbl.setText(`${CommonUtils.formatByteSize(this.frameSize)}+`);
            this.totalDurationLbl.setText("∞");
        }
    }
}
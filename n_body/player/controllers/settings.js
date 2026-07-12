import {ControllerBase} from "../../controllers/base.js";
import {View} from "../../ui/controls/base.js";
import {Select} from "../../ui/controls/select.js";
import {Checkbox} from "../../ui/controls/checkbox.js";
import {Input, InputType} from "../../ui/controls/input.js";
import {ParticleSpriteMode, RenderColorMode} from "../../settings/enum.js";
import * as RangeUtils from "../../utils/range.js";

const view = await fetch(new URL("./views/settings.html", import.meta.url)).then(d => d.text());

export class SettingsController extends ControllerBase {
    static SPEED_EVENT = "settings_speed";
    static PARTICLE_FIXED_SIZE_EVENT = "particle_fixed_size";
    static PARTICLE_SCALE_EVENT = "particle_scale";
    static PARTICLE_SPRITE_EVENT = "particle_sprite";
    static COLOR_MODE_EVENT = "color_mode";
    static FIXED_COLOR_EVENT = "fixed_color";
    static RENDER_STATS_EVENT = "render_stats";

    constructor(root, parentCtrl) {
        const viewObj = new View(root, view);
        super(viewObj.element, parentCtrl);

        this.speedSelectControl = Select.byId("speed-select");
        this.speedSelectControl.setOptions([0.005, 0.01, 0.05, 0.1, ...Array.from(RangeUtils.range(0.25, 2, 0.25)), 5, 10]);
        this.speedSelectControl.select(1);
        this.speedSelectControl.setOnChange(value => this.emitEvent(SettingsController.SPEED_EVENT, value));

        this.pacingLabel = document.getElementById("playback-pacing");

        this.renderStatsControl = Checkbox.byId("render_stats_checkbox");
        this.renderStatsControl.setOnChange(value => this.emitEvent(SettingsController.RENDER_STATS_EVENT, value));

        this.fixedSizeControl = Checkbox.byId("fixed_size_checkbox");
        this.fixedSizeControl.setOnChange(value => this.emitEvent(SettingsController.PARTICLE_FIXED_SIZE_EVENT, value));

        this.particleScaleControl = Select.byId("particle_scale_select");
        this.particleScaleControl.setOptions([0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 4, 8, 10]);
        this.particleScaleControl.setOnChange(value => this.emitEvent(SettingsController.PARTICLE_SCALE_EVENT, value));

        this.particleSpriteControl = Select.byId("particle_sprite_select");
        this.particleSpriteControl.setOptions([
            {key: ParticleSpriteMode.point, label: "Point"},
            {key: ParticleSpriteMode.circle, label: "Circle"},
            {key: ParticleSpriteMode.softCircle, label: "Soft circle"},
            {key: ParticleSpriteMode.glow, label: "Glow"},
            {key: ParticleSpriteMode.softGlow, label: "Soft glow"},
            {key: ParticleSpriteMode.blured, label: "Blured"},
        ]);
        this.particleSpriteControl.setOnChange(value => this.emitEvent(SettingsController.PARTICLE_SPRITE_EVENT, value));

        this.colorModeControl = Select.byId("color_mode_select");
        this.colorModeControl.setOptions([
            {key: RenderColorMode.velocity, label: "Velocity"},
            {key: RenderColorMode.mass, label: "Mass"},
            {key: RenderColorMode.fixed, label: "Fixed"},
            {key: RenderColorMode.random, label: "Random"},
            {key: RenderColorMode.cluster, label: "Cluster"},
        ]);
        this.colorModeControl.setOnChange(value => {
            this._updateFixedColorVisibility(value);
            this.emitEvent(SettingsController.COLOR_MODE_EVENT, value);
        });

        this.fixedColorControl = new Input(document.getElementById("fixed_color_input"), InputType.color);
        this.fixedColorControl.setOnChange(value => this.emitEvent(SettingsController.FIXED_COLOR_EVENT, value));
        this.fixedColorLabel = document.getElementById("fixed_color_label");
    }

    configure(settings) {
        this.renderStatsControl.setValue(!!settings.common.renderStats);
        this.fixedSizeControl.setValue(settings.render.fixedParticleSize);
        this.particleScaleControl.setValue(settings.render.particleSizeScale);
        this.particleSpriteControl.setValue(settings.render.particleSprite);
        this.colorModeControl.setValue(settings.render.colorMode);
        this.fixedColorControl.setValue(settings.render.fixedColor);
        this._updateFixedColorVisibility(settings.render.colorMode);
    }

    setPlaybackPacing({targetFps, sourceFps, speed, framesPerStep, interpolatedFrames}) {
        if (!this.pacingLabel) {
            return;
        }

        const generated = framesPerStep >= 1
            ? `${framesPerStep.toFixed(framesPerStep < 10 ? 2 : 1)} target frames/recorded frame`
            : `${(1 / framesPerStep).toFixed(2)} recorded frames/target frame`;
        this.pacingLabel.textContent = `${targetFps} FPS · ${sourceFps} source FPS · ${speed}× · ${generated}`;
        this.pacingLabel.title = `Approximate DFRI frames: ${Math.max(0, interpolatedFrames).toFixed(2)}`;
    }

    _updateFixedColorVisibility(colorMode) {
        const visible = colorMode === RenderColorMode.fixed;
        this.fixedColorLabel.style.display = visible ? "" : "none";
        this.fixedColorControl.element.style.display = visible ? "" : "none";
    }
}

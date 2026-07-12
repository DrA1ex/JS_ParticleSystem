import test from "node:test";
import assert from "node:assert/strict";
import {installBrowserStubs, setLocationSearch} from "../test-support/browser-env.js";

installBrowserStubs();

const {
    ComponentType,
    Property,
    PropertyParser,
    PropertyType,
    QueryParameterParser,
    ReadOnlyProperty,
    SettingsBase,
} = await import("../n_body/settings/base.js");
const {PhysicsSettings} = await import("../n_body/settings/physics.js");
const {SimulationSettings} = await import("../n_body/settings/simulation.js");
const {RenderSettings} = await import("../n_body/settings/render.js");
const {BufferUploadMode, CollisionContactMode, ParticleSpriteMode, RenderColorMode, RenderType} = await import("../n_body/settings/enum.js");
const {AppPlayerSettings} = await import("../n_body/player/settings/app.js");

test("property parsers normalize booleans, numbers, enums and colors", () => {
    const bool = Property.bool("b", true);
    assert.equal(bool.parse("off"), false);
    assert.equal(bool.parse("ON"), true);
    assert.equal(bool.parse("bad"), true);

    const int = Property.int("i", 5).setConstraints(1, 10);
    assert.equal(int.parse("20"), 10);
    assert.equal(int.parse(-2), 1);
    assert.equal(int.parse("bad"), 5);

    const float = Property.float("f", 1.5).setConstraints(0, 2);
    assert.equal(float.parse("1.75"), 1.75);
    assert.equal(float.parse(5), 2);

    const color = Property.color("c", "#ffffff");
    assert.equal(color.parse("#AbC"), "#aabbcc");
    assert.equal(color.parse("#A1b2C3"), "#a1b2c3");
    assert.equal(color.parse("red"), "#ffffff");

    const enumProp = Property.enum("e", ParticleSpriteMode, ParticleSpriteMode.point);
    assert.equal(enumProp.parse("soft-circle"), ParticleSpriteMode.softCircle);
    assert.equal(enumProp.parse("SOFT_CIRCLE"), ParticleSpriteMode.softCircle);
    assert.equal(enumProp.parse("missing"), ParticleSpriteMode.point);
    assert.equal(Property.string("s", "fallback").parse("  value "), "value");
    assert.equal(Property.string("s", "fallback").parse(""), "fallback");

    assert.throws(() => new Property("bad", PropertyType.enum), /missing enum type/);
    assert.throws(() => new Property("bad", "invalid"), /invalid type/);
    assert.equal(typeof PropertyParser.bool(bool), "function");
});

test("property metadata supports visibility, descriptions and readonly formatting", () => {
    const prop = Property.float("x", 1)
        .setName("Value")
        .setDescription("Details")
        .setExportable(true)
        .setAffects(ComponentType.renderer)
        .setBreaks(ComponentType.backend)
        .setRequiresReload()
        .setConstraints(0, 2)
        .setVisibleWhen(settings => settings.enabled);
    assert.match(prop.description, /Details/);
    assert.match(prop.description, /0-2/);
    assert.equal(prop.isVisible({enabled: true}, null), true);
    assert.equal(prop.isVisible({enabled: false}, null), false);
    assert.equal(prop.exportable, true);
    assert.deepEqual(prop.affects, [ComponentType.renderer]);
    assert.deepEqual(prop.breaks, [ComponentType.backend]);
    assert.equal(prop.requiresReload, true);

    const ro = ReadOnlyProperty.float().setDescription("Read only").setFormatter(value => `${value}%`);
    assert.equal(ro.description, "Read only");
    assert.equal(ro.format(5), "5%");
    assert.equal(ReadOnlyProperty.string().format("x"), "x");
});

test("SettingsBase parses query params, serializes, imports and hides dependent params", () => {
    class DemoSettings extends SettingsBase {
        static Properties = {
            enabled: Property.bool("enabled", true),
            count: Property.int("count", 2).setExportable(true),
            mode: Property.enum("mode", {a: "a", b: "b"}, "a"),
        };
        static PropertiesDependencies = new Map([[this.Properties.enabled, [this.Properties.count]]]);
        get enabled() { return this.config.enabled; }
        get count() { return this.config.count; }
        get mode() { return this.config.mode; }
    }

    setLocationSearch("?enabled=0&count=9&mode=b");
    const parsed = DemoSettings.fromQueryParams();
    assert.equal(parsed.enabled, false);
    assert.equal(parsed.count, 9);
    assert.deepEqual(parsed.toQueryParams(), [
        {key: "enabled", value: false},
        {key: "mode", value: "b"},
    ]);

    setLocationSearch("");
    assert.deepEqual(QueryParameterParser.parse(DemoSettings, {count: 7}), {enabled: true, count: 7, mode: "a"});
    assert.deepEqual(parsed.serialize(), {enabled: false, count: 9, mode: "b"});
    assert.deepEqual(parsed.export(), {count: 9});
    assert.equal(parsed.withImportedValues({count: "5"}).count, 5);
    assert.equal(DemoSettings.import({count: 4}).count, 4);
    assert.equal(DemoSettings.deserialize({enabled: "on", count: "3", mode: "b"}).count, 3);
});

test("physics settings migrate legacy collision options and derive runtime values", () => {
    const migrated = PhysicsSettings.deserialize({
        particleCount: 100,
        gravity: 100,
        collisionSize: 2,
        minInteractionDistance: 0.5,
        collisionAverageContacts: true,
    });
    assert.equal(migrated.collisionContactMode, CollisionContactMode.average);
    assert.equal(migrated.collisionSizeSq, 4);
    assert.equal(migrated.minInteractionDistanceSq, 0.25);
    assert.equal(migrated.particleGravity, 1);

    // Removed tuning fields from older URLs/state files are ignored safely.
    setLocationSearch("?collision_average=0&particle_count=20&symmetric_force=1");
    const queryMigrated = PhysicsSettings.fromQueryParams();
    assert.equal(queryMigrated.collisionContactMode, CollisionContactMode.full);
    assert.equal(Object.prototype.hasOwnProperty.call(queryMigrated.export(), "symmetricForce"), false);

    const massSettings = PhysicsSettings.deserialize({particleCount: 10000, particleMassFactor: 6, gravity: 1});
    assert.equal(massSettings.particleMass, 64);
    assert.ok(massSettings.massDistribution.length > 0);
    assert.ok(massSettings.particleGravity < 1 / 10000);
});

test("mass-centered tree approximation defaults to the new model and preserves legacy mode", () => {
    setLocationSearch("");
    const defaults = SimulationSettings.fromQueryParams();
    assert.equal(defaults.massCenteredTree, true);
    assert.equal(defaults.toQueryParams().some(item => item.key === "tree_mass_center"), false);

    setLocationSearch("?tree_mass_center=0");
    const legacy = SimulationSettings.fromQueryParams();
    assert.equal(legacy.massCenteredTree, false);
    assert.deepEqual(legacy.toQueryParams().find(item => item.key === "tree_mass_center"), {
        key: "tree_mass_center",
        value: false,
    });
    assert.equal(legacy.serialize().massCenteredTree, false);
    assert.equal(legacy.export().massCenteredTree, false);
    assert.equal(SimulationSettings.deserialize({}).massCenteredTree, true);
    assert.equal(SimulationSettings.import({massCenteredTree: false}).massCenteredTree, false);
});

test("render and app player settings preserve contextual defaults and visibility", () => {
    const render = RenderSettings.deserialize({
        render: RenderType.webgl2,
        useDpr: null,
        particleSprite: ParticleSpriteMode.glow,
        colorMode: RenderColorMode.fixed,
        fixedColor: "#123456",
    });
    assert.equal(render.useDpr, true);
    assert.equal(render.particleSprite, ParticleSpriteMode.glow);
    assert.equal(render.fixedColor, "#123456");
    assert.equal(render.bufferUploadMode, BufferUploadMode.stream);
    assert.equal(render.webglLowLatency, true);

    const fakeApp = {render};
    assert.equal(RenderSettings.Properties.fixedColor.isVisible(fakeApp, render), true);
    render.config.colorMode = RenderColorMode.velocity;
    assert.equal(RenderSettings.Properties.fixedColor.isVisible(fakeApp, render), false);

    setLocationSearch("?render=webgl2&particle_sprite=soft_glow&color_mode=cluster");
    const app = AppPlayerSettings.fromQueryParams();
    assert.equal(app.render.particleSprite, ParticleSpriteMode.softGlow);
    assert.equal(app.render.colorMode, RenderColorMode.cluster);
    assert.equal(app.render.bufferUploadMode, BufferUploadMode.stream);
    assert.equal(app.render.webglLowLatency, true);
    const serialized = app.serialize();
    const restored = AppPlayerSettings.deserialize(serialized);
    assert.deepEqual(restored.serialize(), serialized);
    assert.equal(app.effectiveDefaultValue("render", "particleSprite"), ParticleSpriteMode.point);
});

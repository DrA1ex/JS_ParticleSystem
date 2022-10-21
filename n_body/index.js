import {AppSimulationSettings} from "./settings/app.js";
import * as SettingsUtils from "./utils/settings.js";
import {Application} from "./app.js";

addEventListener("error", (event) => {
    alert(event.message);
});

const state = await SettingsUtils.loadState();
const SettingsInstance = AppSimulationSettings.fromQueryParams(state?.settings);

const ApplicationInstance = new Application(SettingsInstance);
ApplicationInstance.init(state, null);
ApplicationInstance.run();
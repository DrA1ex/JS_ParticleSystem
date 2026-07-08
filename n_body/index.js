import {AppSimulationSettings} from "./settings/app.js";
import * as SettingsUtils from "./utils/settings.js";
import {Application} from "./app.js";
import {installPerformanceReportConsole} from "./utils/perf_report.js";
import {ensureCrossOriginIsolationForWorkerMT} from "./utils/coi.js";

addEventListener("error", (event) => {
    alert(event.message);
});

const state = await SettingsUtils.loadState();
const SettingsInstance = AppSimulationSettings.fromQueryParams(state?.settings);
const coiState = await ensureCrossOriginIsolationForWorkerMT(SettingsInstance);

if (!coiState.reloading) {
    const ApplicationInstance = new Application(SettingsInstance);
    ApplicationInstance.init(state, null);
    installPerformanceReportConsole(ApplicationInstance);
    ApplicationInstance.run();
}

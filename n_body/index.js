import {AppSimulationSettings} from "./settings/app.js";
import * as SettingsUtils from "./utils/settings.js";
import {Application} from "./app.js";
import {installPerformanceReportConsole} from "./utils/perf_report.js";
import {installBenchmarkConsole} from "./utils/benchmark.js";
import {ensureCrossOriginIsolationForWorkerMT} from "./utils/coi.js";
import {getParticleCount} from "./utils/particles.js";

addEventListener("error", (event) => {
    alert(event.message);
});

const state = await SettingsUtils.loadState();
let SettingsInstance = AppSimulationSettings.fromQueryParams();
if (state) {
    const importedSettings = {...(state.settings || {})};
    const importedParticleCount = getParticleCount(state.particles);
    if (Number.isInteger(importedParticleCount) && importedParticleCount >= 2) {
        importedSettings.particleCount = importedParticleCount;
    }
    // State files define the saved universe even when the current URL contains
    // stale particle/initializer values. Runtime choices such as backend,
    // threads, renderer and debug flags still come from the URL.
    SettingsInstance = SettingsInstance.withImportedState(importedSettings);
}
const coiState = await ensureCrossOriginIsolationForWorkerMT(SettingsInstance);

if (!coiState.reloading) {
    const ApplicationInstance = new Application(SettingsInstance);
    ApplicationInstance.init(state, null);
    installPerformanceReportConsole(ApplicationInstance);
    installBenchmarkConsole(ApplicationInstance);
    ApplicationInstance.run();
}

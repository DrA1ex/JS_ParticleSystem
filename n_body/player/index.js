import {Application} from "./app.js";
import {AppPlayerSettings} from "./settings/app.js";


const SettingsInstance = AppPlayerSettings.fromQueryParams();

const App = new Application(SettingsInstance);

const urlSearchParams = new URLSearchParams(window.location.search);
const queryParams = Object.fromEntries(urlSearchParams.entries());

if (queryParams.url) {
    await App.loadDataFromUrl(queryParams.url);
}
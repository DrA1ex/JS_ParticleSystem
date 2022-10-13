import {Settings} from "../utils/settings.js";
import {Application} from "./app.js";


const SettingsInstance = Settings.fromQueryParams();

const App = new Application(SettingsInstance);

const urlSearchParams = new URLSearchParams(window.location.search);
const queryParams = Object.fromEntries(urlSearchParams.entries());

if (queryParams.url) {
    await App.loadDataFromUrl(queryParams.url);
}
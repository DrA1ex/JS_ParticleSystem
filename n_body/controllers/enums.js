import {StateControllerBase} from "./base.js";

/**
 * @enum{number}
 */
export const SimulationStateEnum = {
    loading: StateControllerBase.UnsetState,
    active: 0,
    paused: 1,
    recording: 2,
    reconfigure: 3,
}
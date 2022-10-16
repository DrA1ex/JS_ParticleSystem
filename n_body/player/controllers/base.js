import {StateControllerBase} from "../../controllers/base.js";

/**
 * @readonly
 * @enum {number}
 */
export const PlayerStateEnum = {
    unset: StateControllerBase.UnsetState,
    waiting: 0,
    loading: 1,
    playing: 2,
    paused: 3,
    finished: 4
}

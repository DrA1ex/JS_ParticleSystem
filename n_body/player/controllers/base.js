import {FrameControl} from "../../ui/controls/frame.js";

/**
 * @readonly
 * @enum {number}
 */
export const StateEnum = {
    unset: -1,
    waiting: 0,
    loading: 1,
    playing: 2,
    paused: 3,
    finished: 4
}

export class IEventEmitter {
    /**
     * @abstract
     *
     * @param {string} type
     * @param {*|null} data
     */
    emitEvent(type, data = null) {
    }
}

export class ControllerBase extends IEventEmitter {
    subscribers = new Map();

    /**
     * @param {Node} root
     * @param {ControllerBase=null} parentCtrl
     */
    constructor(root, parentCtrl = null) {
        super();

        this.root = root;
        this.parentCtrl = parentCtrl;
        this.frame = new FrameControl(this.root);
    }

    /**
     * @param {string} type
     * @param {*|null} data
     */
    emitEvent(type, data = null) {
        for (let subscriptions of this.subscribers.values()) {
            const handler = subscriptions[type];
            if (handler) {
                handler(this, data);
            }
        }
    }

    /**
     * @param {object} subscriber
     * @param {string} type
     * @param {function} handler
     */
    subscribe(subscriber, type, handler) {
        if (!this.subscribers.has(subscriber)) {
            this.subscribers.set(subscriber, {});
        }

        const subscription = this.subscribers.get(subscriber);
        subscription[type] = handler;
    }

    /**
     * @param {object} subscriber
     * @param {string} type
     */
    unsubscribe(subscriber, type) {
        const subscription = this.subscribers.has(subscriber) ? this.subscribers.get(subscriber) : null;
        if (subscription && subscription.hasOwnProperty(type)) {
            delete subscription[type];
        }
    }
}

export class StateControllerBase extends ControllerBase {
    static STATE_EVENT_NAME = "state";

    currentState = StateEnum.unset;

    constructor(root, parentCtrl = null) {
        super(root, parentCtrl);
        parentCtrl?.subscribe(this, StateControllerBase.STATE_EVENT_NAME, (sender, state) => this.setState(state));
    }

    /**
     * @param {StateEnum} state
     */
    setState(state) {
        if (this.currentState === state) {
            return;
        }

        const oldState = this.currentState;
        this.currentState = state;

        this.emitEvent(StateControllerBase.STATE_EVENT_NAME, state);
        this.onStateChanged(this, oldState, state);

    }

    /**
     * @abstract
     *
     * @param {object} sender
     * @param {StateEnum} oldState
     * @param {StateEnum} newState
     */
    onStateChanged(sender, oldState, newState) {
        this.currentState = newState;
    }
}
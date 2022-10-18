import {Frame} from "../ui/controls/frame.js";

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
     * @param {HTMLElement} root
     * @param {ControllerBase|null} [parentCtrl=null]
     */
    constructor(root, parentCtrl = null) {
        super();

        this.root = root;
        this.parentCtrl = parentCtrl;
        this.frame = new Frame(this.root);
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

/**
 * @template T
 */
export class StateControllerBase extends ControllerBase {
    static UnsetState = /** @type {T} */ -1;
    static STATE_EVENT_NAME = "state";

    /**
     * @type {T}
     */
    currentState = StateControllerBase.UnsetState;

    /**
     * @param {HTMLElement} root
     * @param {ControllerBase|null} [parentCtrl=null]
     */
    constructor(root, parentCtrl = null) {
        super(root, parentCtrl);
        this.parentCtrl?.subscribe(this, StateControllerBase.STATE_EVENT_NAME, (sender, state) => this.setState(state));
    }

    /**
     * @param {T} state
     */
    setState(state) {
        if (this.currentState === state) {
            return;
        }

        const oldState = this.currentState;
        this.currentState = state;

        this.emitEvent(StateControllerBase.STATE_EVENT_NAME, this.currentState);
        this.onStateChanged(this, oldState, this.currentState);
    }

    /**
     *
     * @param {object} sender
     * @param {T} oldState
     * @param {T} newState
     */
    onStateChanged(sender, oldState, newState) {
    }
}
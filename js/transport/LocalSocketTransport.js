// @ts-check
/** @typedef {import('../core/types.js').NetEvent} NetEvent */
/** @typedef {import('./Transport.js').Transport} Transport */

/**
 * Stub de transport local (Socket.io) levant « non implémenté ».
 * @implements {Transport}
 */
export class LocalSocketTransport {
    /**
     * @param {string} _sessionId
     * @param {'gm'|'players'} _role
     * @returns {Promise<void>}
     */
    async connect(_sessionId, _role) {
        throw new Error('LocalSocketTransport non implémenté');
    }

    /**
     * @param {NetEvent} _event
     * @returns {Promise<import('./Transport.js').PublishResult>} jamais rendu : le stub lève
     */
    publish(_event) {
        throw new Error('LocalSocketTransport non implémenté');
    }

    /**
     * @param {(e: NetEvent) => void} _handler
     * @returns {() => void}
     */
    subscribe(_handler) {
        throw new Error('LocalSocketTransport non implémenté');
    }

    /**
     * @returns {Promise<object>}
     */
    async snapshot() {
        throw new Error('LocalSocketTransport non implémenté');
    }

    /**
     * @param {import('../core/types.js').SharedImage} _image
     * @returns {Promise<import('./Transport.js').PublishResult>} jamais rendu : le stub lève
     */
    shareImage(_image) {
        throw new Error('LocalSocketTransport non implémenté');
    }

    /**
     * @param {string} _id
     * @returns {Promise<import('./Transport.js').PublishResult>} jamais rendu : le stub lève
     */
    closeSharedImage(_id) {
        throw new Error('LocalSocketTransport non implémenté');
    }

    /**
     * @param {(image: import('../core/types.js').SharedImage|null) => void} _callback
     * @returns {() => void}
     */
    subscribeSharedImage(_callback) {
        throw new Error('LocalSocketTransport non implémenté');
    }

    /**
     * @returns {void}
     */
    disconnect() {
        throw new Error('LocalSocketTransport non implémenté');
    }
}

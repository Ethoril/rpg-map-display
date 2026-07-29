// @ts-check
/** @typedef {import('../core/types.js').NetEvent} NetEvent */

/**
 * Abstraction de synchronisation. L'hébergement devient un choix d'exécution.
 *
 * @typedef {Object} Transport
 * @property {(sessionId: string, role: 'gm'|'players') => Promise<void>} connect
 * @property {(event: NetEvent) => void} publish
 * @property {(handler: (e: NetEvent & {eventId?: string, clientId?: string}) => void) => () => void} subscribe
 * @property {() => Promise<object>} snapshot   état complet — TOUJOURS avant les deltas
 * @property {(snapshot: object) => Promise<void>} [saveSnapshot]
 * @property {(event: NetEvent & {eventId?: string, clientId?: string}) => boolean} [isOwnEvent]
 * @property {(handler: (error: unknown) => void) => (() => void)|void} [onError]
 * @property {() => void} disconnect
 */
export {}

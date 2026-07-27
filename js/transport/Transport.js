// @ts-check
/** @typedef {import('../core/types.js').NetEvent} NetEvent */

/**
 * Abstraction de synchronisation. L'hébergement devient un choix d'exécution.
 *
 * @typedef {Object} Transport
 * @property {(sessionId: string, role: 'gm'|'players') => Promise<void>} connect
 * @property {(event: NetEvent) => void} publish
 * @property {(handler: (e: NetEvent) => void) => () => void} subscribe  retourne un désabonnement
 * @property {() => Promise<object>} snapshot   état complet — TOUJOURS avant les deltas
 * @property {() => void} disconnect
 */
export {}

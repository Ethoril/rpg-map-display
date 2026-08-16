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
 * @property {() => boolean} [mayHaveMissedEvents] le canal a-t-il pu purger des événements non lus.
 *   Calcul à la demande, sans drapeau ni écouteur : un état posé par un écouteur du transport
 *   serait lu par l'application avant d'être écrit dès le deuxième réveil (ordre d'insertion DOM).
 * @property {() => Promise<void>} [resync] rouvre le canal sans changer d'identité de client.
 *   Un appel pendant une resynchro en vol rejoint celle-ci au lieu d'en lancer une seconde.
 * @property {() => void} disconnect
 */
export {}

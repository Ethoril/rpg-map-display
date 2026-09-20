// @ts-check
/** @typedef {import('../core/types.js').NetEvent} NetEvent */

/**
 * Issue d'une publication. `ok: false` signifie que RIEN n'est parti sur le canal : événement
 * refusé par une garde, transport non connecté, ou écriture rejetée par le serveur. `error` porte
 * alors la cause, déjà signalée par ailleurs à la console et aux handlers `onError`.
 *
 * ⛔ La promesse rendue par `publish` SE RÉSOUT TOUJOURS — elle ne rejette jamais, et ce n'est pas
 * une négligence à « corriger ». Les appelants sont des dizaines à publier sans `await` ni
 * `.catch` : une promesse qui rejette produirait autant de rejets non rattrapés, donc du bruit
 * sans destinataire. Un résultat résolu laisse savoir celui qui veut savoir, sans rien casser
 * chez les autres.
 *
 * @typedef {{ok: true} | {ok: false, error: Error}} PublishResult
 */

/**
 * Abstraction de synchronisation. L'hébergement devient un choix d'exécution.
 *
 * @typedef {Object} Transport
 * @property {(sessionId: string, role: 'gm'|'players') => Promise<void>} connect
 * @property {(event: NetEvent) => Promise<PublishResult>} publish
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

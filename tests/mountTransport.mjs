// @ts-check
// Module chargé DANS LA PAGE par tests/firebaseTransport.spec.mjs. Chaque contexte de
// navigateur en charge un exemplaire : c'est ce qui fait de deux onglets deux clients
// réellement distincts — stockage isolé, session d'authentification propre, connexion
// Realtime Database séparée.
//
// Il vit en fichier plutôt qu'en chaîne passée à page.evaluate() pour être typé par `tsc`
// comme le reste du dépôt. Il n'est jamais chargé par l'application.

import { FirebaseTransport } from '../js/transport/FirebaseTransport.js';

/**
 * @typedef {Object} ParamsTest
 * @property {Record<string, any>} config
 * @property {string} sessionId
 * @property {'gm'|'players'} role
 * @property {string} email
 * @property {string} password
 */

const params = /** @type {ParamsTest} */ (/** @type {any} */ (window).__rpgTest);

const transport = new FirebaseTransport(params.config);

/** @type {string[]} */
let recus = [];
/** @type {string[]} */
const erreurs = [];

transport.onError((err) => {
  erreurs.push(String(/** @type {any} */ (err)?.code || err));
});

/** Rebranche l'abonnement : `disconnect()` vide la liste des abonnés. */
function abonner() {
  transport.subscribe((event) => {
    recus.push(event.type);
  });
}

await transport.signInWithPassword(params.email, params.password);
await transport.connect(params.sessionId, params.role);
abonner();

/** @type {any} */ (window).__probe = {
  /** Types d'événements reçus, dans l'ordre de livraison. */
  recus: () => recus.slice(),
  /** Échecs asynchrones signalés par le transport. Doit rester vide. */
  erreurs: () => erreurs.slice(),
  /** @param {string} type */
  publish: (/** @type {string} */ type) =>
    transport.publish({ type, payload: { id: 'pion-1', to: { a: 3, b: 4 } }, at: Date.now(), by: params.role }),
  /** Résout l'état complet puis vide le tampon. */
  snapshot: async () => {
    await transport.snapshot();
    return true;
  },
  /** Coupe puis rejoint la même session, comme un F5 en cours de partie. */
  reconnect: async () => {
    transport.disconnect();
    recus = [];
    await transport.connect(params.sessionId, params.role);
    abonner();
    return true;
  },
  purge: () => transport.purgeEvents(),
  purgeSession: () =>
    transport.purgeSessionEvents(params.sessionId, { dryRun: false, confirm: true }),
};

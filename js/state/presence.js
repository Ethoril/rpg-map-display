// @ts-check

/**
 * @typedef {Object} ClientPresence
 * @property {string} clientId
 * @property {'gm'|'players'} role
 * @property {number} at
 * @property {number} build
 * @property {string} label
 */

/** @type {Map<string, ClientPresence>} */
const presenceMap = new Map();
export const PRESENCE_STALE_AFTER_MS = 90_000;

/** @type {Set<() => void>} */
const subscribers = new Set();

/**
 * Met à jour la présence d'un client dans le store de présence.
 *
 * @param {string} clientId
 * @param {Omit<ClientPresence, 'clientId'>} data
 */
export function updatePresence(clientId, data) {
  const normalized = normalizePresence(clientId, data);
  if (!normalized) return;
  presenceMap.set(clientId, normalized);
  notifySubscribers();
}

/**
 * Définit l'ensemble de la carte de présence depuis un dictionnaire.
 *
 * @param {Record<string, Omit<ClientPresence, 'clientId'>>} presences
 */
export function setPresenceMap(presences) {
  presenceMap.clear();
  if (presences && typeof presences === 'object') {
    for (const [clientId, data] of Object.entries(presences)) {
      const normalized = normalizePresence(clientId, data);
      if (normalized) presenceMap.set(clientId, normalized);
    }
  }
  notifySubscribers();
}

/**
 * Supprime un client de la carte de présence.
 *
 * @param {string} clientId
 */
export function removePresence(clientId) {
  if (presenceMap.delete(clientId)) notifySubscribers();
}

/**
 * Réinitialise la carte de présence.
 */
export function clearPresence() {
  presenceMap.clear();
  notifySubscribers();
}

/**
 * Obtenir la liste de tous les clients connectés.
 *
 * @returns {ClientPresence[]}
 */
export function getPresenceList() {
  const now = Date.now();
  return (
    Array.from(presenceMap.values())
      // Âge en valeur absolue, et c'est le point important.
      //
      // La borne était `now - client.at <= 90 s`, sans plancher : une présence datée dans le
      // futur donnait un âge négatif, satisfaisait la condition, et ne périmait donc
      // **jamais**. Or `at` a longtemps été écrit avec l'horloge du client (cf.
      // `FirebaseTransport.publishPresence`) : il suffisait d'une tablette en avance de
      // quelques minutes pour qu'un écran éteint depuis des jours continue d'annoncer sa
      // build, et rende l'alerte d'écart de version impossible à éteindre.
      //
      // Les `at` sont désormais datés par le serveur, mais les enregistrements écrits par les
      // anciennes versions traînent dans la base : ce plancher les élimine sans migration.
      .filter((client) => Math.abs(now - client.at) <= PRESENCE_STALE_AFTER_MS)
      .map((client) => ({ ...client }))
  );
}

/**
 * Liste **tous** les clients dont la build diffère de la build locale.
 *
 * `checkBuildMismatch` s'arrête au premier trouvé : quand plusieurs écrans divergent, le
 * numéro affiché sautait de l'un à l'autre au gré de l'ordre d'itération, ce qui donnait
 * l'impression d'un diagnostic erratique. Pour dire *qui* recharger, il faut les voir tous.
 *
 * @param {number} localBuild Build du client local
 * @param {string} [selfClientId] Exclure optionnellement son propre clientId
 * @returns {ClientPresence[]} Triés par build croissante, le plus en retard d'abord
 */
export function listBuildMismatches(localBuild, selfClientId = '') {
  return getPresenceList()
    .filter((client) => {
      if (selfClientId && client.clientId === selfClientId) return false;
      return typeof client.build === 'number' && client.build !== 0 && client.build !== localBuild;
    })
    .sort((a, b) => a.build - b.build);
}

/**
 * Les autres sessions MJ vivantes, hors la sienne.
 *
 * S'appuie sur `getPresenceList`, qui écarte déjà les présences périmées : un onglet MJ fermé
 * brutalement disparaît de lui-même au bout de `PRESENCE_STALE_AFTER_MS`, sans quoi le compte
 * afficherait des concurrents qui ne sont plus là et le bouton d'éviction paraîtrait cassé.
 *
 * @param {string} [selfClientId] Son propre clientId, à exclure
 * @returns {ClientPresence[]} Triées de la plus ancienne à la plus récente
 */
export function listOtherGmClients(selfClientId = '') {
  return getPresenceList()
    .filter((client) => client.role === 'gm' && client.clientId !== selfClientId)
    .sort((a, b) => a.at - b.at);
}

/**
 * Vérifie si une désynchronisation de build existe par rapport au build local.
 *
 * @param {number} localBuild Build du client local
 * @param {string} [selfClientId] Exclure optionnellement son propre clientId
 * @returns {{ hasMismatch: boolean, localBuild: number, remoteBuild: number|null, remoteRole: string|null, remoteLabel: string|null }}
 */
export function checkBuildMismatch(localBuild, selfClientId = '') {
  for (const client of getPresenceList()) {
    if (selfClientId && client.clientId === selfClientId) {
      continue;
    }
    if (typeof client.build === 'number' && client.build !== 0 && client.build !== localBuild) {
      return {
        hasMismatch: true,
        localBuild,
        remoteBuild: client.build,
        remoteRole: client.role,
        remoteLabel: client.label || String(client.build),
      };
    }
  }
  return {
    hasMismatch: false,
    localBuild,
    remoteBuild: null,
    remoteRole: null,
    remoteLabel: null,
  };
}

/**
 * S'abonne aux changements de présence.
 *
 * @param {() => void} listener
 * @returns {() => void}
 */
export function subscribePresence(listener) {
  if (typeof listener !== 'function') {
    throw new Error('L’abonné de présence doit être une fonction');
  }
  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
  };
}

/**
 * @param {string} clientId
 * @param {unknown} data
 * @returns {ClientPresence|null}
 */
function normalizePresence(clientId, data) {
  if (!clientId || !data || typeof data !== 'object') return null;
  const raw = /** @type {Record<string, unknown>} */ (data);
  if (raw.role !== 'gm' && raw.role !== 'players') return null;
  if (!Number.isFinite(raw.at) || Number(raw.at) <= 0) return null;
  if (!Number.isSafeInteger(raw.build) || Number(raw.build) < 0) return null;
  if (typeof raw.label !== 'string') return null;
  return {
    clientId,
    role: raw.role,
    at: Number(raw.at),
    build: Number(raw.build),
    label: raw.label,
  };
}

function notifySubscribers() {
  for (const listener of Array.from(subscribers)) {
    try {
      listener();
    } catch (err) {
      console.error('Erreur dans un abonné de présence :', err);
    }
  }
}

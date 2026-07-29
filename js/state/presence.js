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

/** @type {Set<() => void>} */
const subscribers = new Set();

/**
 * Met à jour la présence d'un client dans le store de présence.
 *
 * @param {string} clientId
 * @param {Omit<ClientPresence, 'clientId'>} data
 */
export function updatePresence(clientId, data) {
  if (!clientId || !data) return;
  presenceMap.set(clientId, { clientId, ...data });
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
      if (data && typeof data === 'object') {
        presenceMap.set(clientId, {
          clientId,
          role: data.role || 'players',
          at: data.at || Date.now(),
          build: data.build || 0,
          label: data.label || '',
        });
      }
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
  presenceMap.delete(clientId);
  notifySubscribers();
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
  return Array.from(presenceMap.values());
}

/**
 * Vérifie si une désynchronisation de build existe par rapport au build local.
 *
 * @param {number} localBuild Build du client local
 * @param {string} [selfClientId] Exclure optionnellement son propre clientId
 * @returns {{ hasMismatch: boolean, localBuild: number, remoteBuild: number|null, remoteRole: string|null, remoteLabel: string|null }}
 */
export function checkBuildMismatch(localBuild, selfClientId = '') {
  for (const client of presenceMap.values()) {
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
  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
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

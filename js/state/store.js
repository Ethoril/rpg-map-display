// @ts-check

import {
  validateCampaign,
  createCampaign,
  normalizeCampaignColors,
  isPersistableAssetUrl,
  assertPersistableAssetUrl,
} from '../core/schema.js';
import {
  setSelectionState,
  clearSelectionState,
  getSelectedTokenId,
  getReachableCells,
} from './selection.js';

/** @typedef {import('../core/types.js').Campaign} Campaign */
/** @typedef {import('../core/types.js').Level} Level */
/** @typedef {import('../core/types.js').Token} Token */
/** @typedef {import('../core/types.js').Cell} Cell */
/** @typedef {import('../core/types.js').Handout} Handout */

/** @type {Campaign | null} */
let campaign = null;

/** @type {string | null} */
let activeLevelId = null;

/** @type {Handout | null} */
let activeHandout = null;

/** @type {Set<() => void>} */
const subscribers = new Set();

/**
 * Gèle récursivement un objet en mode strict.
 *
 * @template T
 * @param {T} obj
 * @returns {T}
 */
function deepFreeze(obj) {
  if (obj === null || typeof obj !== 'object' || Object.isFrozen(obj)) {
    return obj;
  }
  Object.freeze(obj);
  if (Array.isArray(obj)) {
    for (const item of obj) {
      deepFreeze(item);
    }
  } else if (obj instanceof Map) {
    for (const [k, v] of obj.entries()) {
      deepFreeze(k);
      deepFreeze(v);
    }
  } else {
    const record = /** @type {Record<string, any>} */ (obj);
    for (const key of Object.keys(record)) {
      deepFreeze(record[key]);
    }
  }
  return obj;
}

/** @type {string | null} */
let currentSessionId = null;
/** @type {Error|null} */
let lastPersistenceError = null;

/**
 * Configure l'identifiant de session actif pour la persistance automatique en LocalStorage.
 *
 * @param {string | null} sessionId
 */
export function setSessionId(sessionId) {
  currentSessionId = sessionId;
}

/** @type {Map<string, string>} */
const inMemoryStorage = new Map();

function getStorage() {
  if (typeof localStorage !== 'undefined') {
    return localStorage;
  }
  return {
    getItem: (/** @type {string} */ key) => inMemoryStorage.get(key) ?? null,
    setItem: (/** @type {string} */ key, /** @type {string} */ val) => {
      inMemoryStorage.set(key, String(val));
    },
    removeItem: (/** @type {string} */ key) => {
      inMemoryStorage.delete(key);
    },
  };
}

/**
 * Valide une campagne candidate avant de remplacer l'état courant.
 *
 * @param {Campaign} candidate
 * @param {string} operation
 */
function assertValidCampaign(candidate, operation) {
  const errors = validateCampaign(candidate);
  if (errors.length > 0) {
    throw new Error(`${operation} refusée : ${errors.join(' ; ')}`);
  }
}

/**
 * Sauvegarde manuellement la campagne et l'état de session courant dans LocalStorage.
 *
 * @param {string} [sessionId]
 */
export function saveToLocalStorage(sessionId) {
  const targetSessionId = sessionId || currentSessionId;
  const storage = getStorage();
  if (!targetSessionId || !storage) return;
  try {
    if (campaign) {
      assertValidCampaign(campaign, 'Sauvegarde de la campagne');
      storage.setItem(`rpg_campaign_${targetSessionId}`, JSON.stringify(campaign));
    } else {
      storage.removeItem(`rpg_campaign_${targetSessionId}`);
    }
    storage.setItem(
      `rpg_session_${targetSessionId}`,
      JSON.stringify({
        activeLevelId,
        selectedTokenId: getSelectedTokenId(),
        activeHandout,
      })
    );
    lastPersistenceError = null;
  } catch (err) {
    lastPersistenceError = new Error(
      `Erreur écriture LocalStorage : ${err instanceof Error ? err.message : String(err)}`,
      { cause: err }
    );
    throw lastPersistenceError;
  }
}

/**
 * Restaure la campagne et l'état de session depuis LocalStorage.
 *
 * @param {string} sessionId
 * @returns {boolean} true si **un état** a été restauré : campagne, état de session, ou
 *   les deux. Une entrée de session sans campagne est un cas réel et non une anomalie —
 *   un handout peut être affiché avant tout chargement de carte (chantier H). Aucun
 *   appelant n'exploite ce retour aujourd'hui ; ne pas en déduire « une campagne est
 *   chargée » sans vérifier `getCampaign()`.
 */
export function loadFromLocalStorage(sessionId) {
  const storage = getStorage();
  if (!sessionId || !storage) return false;
  currentSessionId = sessionId;
  lastPersistenceError = null;
  try {
    const rawCamp = storage.getItem(`rpg_campaign_${sessionId}`);
    const rawSess = storage.getItem(`rpg_session_${sessionId}`);
    if (!rawCamp && !rawSess) return false;

    const campData = rawCamp ? JSON.parse(rawCamp) : null;
    const sessData = rawSess ? JSON.parse(rawSess) : {};

    restoreFromSnapshot(
      {
        campaign: campData,
        activeLevelId: sessData.activeLevelId,
        selectedTokenId: sessData.selectedTokenId,
        activeHandout: sessData.activeHandout,
      },
      { sessionId }
    );
    return true;
  } catch (err) {
    lastPersistenceError = new Error(
      `Erreur chargement LocalStorage : ${err instanceof Error ? err.message : String(err)}`,
      { cause: err }
    );
    console.warn(lastPersistenceError.message);
    return false;
  }
}

/** @returns {Error|null} */
export function getLastPersistenceError() {
  return lastPersistenceError;
}

/**
 * Restaure le store à partir d'un snapshot (Firestore, LocalStorage ou document de campagne).
 *
 * @param {any} snapshotData
 * @param {Object} [options]
 * @param {string} [options.sessionId]
 * @param {string} [options.activeLevelId]
 * @returns {void}
 */
export function restoreFromSnapshot(snapshotData, options = {}) {
  if (!snapshotData || typeof snapshotData !== 'object') return;

  if (options.sessionId) {
    currentSessionId = options.sessionId;
  }

  const campaignCandidate = Array.isArray(snapshotData.levels)
    ? snapshotData
    : snapshotData.campaign && Array.isArray(snapshotData.campaign.levels)
    ? snapshotData.campaign
    : null;

  if (campaignCandidate) {
    // Normaliser avant de valider : un instantané hérité est converti, pas
    // refusé. La copie évite de muter l'objet de l'appelant — un payload réseau
    // ou un document gelé.
    const normalise = normalizeCampaignColors(campaignCandidate);
    const errors = validateCampaign(normalise);
    if (errors.length > 0) {
      throw new Error(`Snapshot invalide : ${errors.join(' ; ')}`);
    }
    campaign = structuredClone(normalise);
  }

  const requestedLevelId =
    options.activeLevelId ||
    snapshotData.activeLevelId ||
    (campaign && campaign.levels.length > 0 ? campaign.levels[0].id : null);

  activeLevelId = campaign
    ? campaign.levels.some((level) => level.id === requestedLevelId)
      ? requestedLevelId
      : campaign.levels[0]?.id ?? null
    : null;

  const targetTokenId = snapshotData.selectedTokenId || null;
  if (campaign && targetTokenId && campaign.tokens.some((t) => t.id === targetTokenId)) {
    const token = campaign.tokens.find((t) => t.id === targetTokenId);
    const level = campaign.levels.find((l) => l.id === activeLevelId) || null;
    if (token) setSelectionState(token, level);
  } else {
    clearSelectionState();
  }

  const rawHandout = snapshotData.activeHandout;
  if (
    rawHandout &&
    typeof rawHandout === 'object' &&
    typeof rawHandout.imageUrl === 'string' &&
    isPersistableAssetUrl(rawHandout.imageUrl)
  ) {
    activeHandout = deepFreeze({
      id: String(rawHandout.id || 'handout-1'),
      name: String(rawHandout.name || ''),
      imageUrl: String(rawHandout.imageUrl),
    });
  } else {
    activeHandout = null;
  }

  notifySubscribers();
}

/**
 * Notifie tous les abonnés d'une mutation.
 */
function notifySubscribers() {
  if (currentSessionId) {
    saveToLocalStorage(currentSessionId);
  }
  for (const listener of Array.from(subscribers)) {
    try {
      listener();
    } catch (err) {
      console.error('Erreur dans un abonné du store :', err);
    }
  }
}

/**
 * S'abonne aux changements d'état du store.
 *
 * @param {() => void} listener
 * @returns {() => void} Fonction de désabonnement
 */
export function subscribe(listener) {
  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
  };
}

/**
 * Charge une campagne complète dans le store après validation par validateCampaign.
 * Refuse tout document invalide en levant une erreur.
 *
 * @param {Campaign} campaignData
 * @returns {void}
 */
export function loadCampaign(campaignData) {
  // Normaliser d'abord : un document hérité doit être converti, jamais refusé.
  // La normalisation rend une copie, donc `campaignData` reste intact — y compris
  // s'il est gelé.
  const normalise = normalizeCampaignColors(campaignData);

  try {
    assertValidCampaign(normalise, 'Chargement de la campagne');
  } catch (err) {
    throw new Error(
      `Impossible de charger la campagne : document invalide. ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const chargee = structuredClone(normalise);
  campaign = chargee;
  activeLevelId = chargee.levels.length > 0 ? chargee.levels[0].id : null;
  clearSelectionState();

  notifySubscribers();
}

/**
 * Change l'étage actif courant.
 *
 * @param {string} levelId
 * @returns {void}
 */
export function selectLevel(levelId) {
  if (!campaign) {
    throw new Error('Aucune campagne chargée');
  }

  const levelExists = campaign.levels.some((l) => l.id === levelId);
  if (!levelExists) {
    throw new Error(`Étage inconnu : "${levelId}"`);
  }

  if (activeLevelId === levelId) {
    return;
  }

  activeLevelId = levelId;

  // Ajustement de la sélection si le pion n'est pas sur le nouvel étage
  const selTokenId = getSelectedTokenId();
  if (selTokenId) {
    const selToken = campaign.tokens.find((t) => t.id === selTokenId);
    if (selToken && selToken.levelId === levelId) {
      const activeLevel = campaign.levels.find((l) => l.id === activeLevelId) || null;
      setSelectionState(selToken, activeLevel);
    } else {
      clearSelectionState();
    }
  }

  notifySubscribers();
}

/**
 * Sélectionne un pion par son identifiant ou réinitialise la sélection (null).
 *
 * @param {string | null} tokenId
 * @returns {void}
 */
export function setSelection(tokenId) {
  if (tokenId === null) {
    if (getSelectedTokenId() !== null) {
      clearSelectionState();
      notifySubscribers();
    }
    return;
  }

  if (!campaign) {
    throw new Error('Aucune campagne chargée');
  }

  const token = campaign.tokens.find((t) => t.id === tokenId);
  if (!token) {
    throw new Error(`Pion inconnu : "${tokenId}"`);
  }

  const activeLevel = campaign.levels.find((l) => l.id === activeLevelId) || null;
  setSelectionState(token, activeLevel);

  notifySubscribers();
}

/** Alias de setSelection pour la compatibilité avec le contrat T-20 */
export const selectToken = setSelection;

/**
 * Déplace un pion vers une case (index entier Cell {a, b}).
 * Mutation composite : si le pion déplacé est sélectionné, sa sélection est mise à jour.
 * Émet UN SEUL signal de changement.
 *
 * @param {string} tokenId
 * @param {Cell} cell
 * @param {{ from?: Cell, to?: Cell, path?: Cell[], startedAt?: number } | null} [moveData] Données de mouvement animable optionnelles
 * @returns {void}
 */
export function moveTokenToCell(tokenId, cell, moveData = null) {
  if (!campaign) {
    throw new Error('Aucune campagne chargée');
  }

  if (
    !cell ||
    typeof cell !== 'object' ||
    !Number.isInteger(cell.a) ||
    !Number.isInteger(cell.b)
  ) {
    throw new Error(
      `Position invalide pour le pion "${tokenId}" : cell doit être un Cell avec des coordonnées entières {a, b}`
    );
  }

  const candidate = structuredClone(campaign);
  const token = candidate.tokens.find((t) => t.id === tokenId);
  if (!token) {
    throw new Error(`Pion inconnu : "${tokenId}"`);
  }

  const fromCell = { a: token.cell.a, b: token.cell.b };
  token.cell = { a: cell.a, b: cell.b };

  if (moveData) {
    token.move = {
      from: moveData.from ?? fromCell,
      to: moveData.to ?? { a: cell.a, b: cell.b },
      path: moveData.path ?? [fromCell, { a: cell.a, b: cell.b }],
      startedAt: moveData.startedAt ?? Date.now(),
    };
  }

  assertValidCampaign(candidate, `Déplacement du pion "${tokenId}"`);
  campaign = candidate;

  // Si le pion est actuellement sélectionné, mettre à jour les cases atteignables
  if (getSelectedTokenId() === tokenId) {
    const activeLevel = campaign.levels.find((l) => l.id === activeLevelId) || null;
    setSelectionState(token, activeLevel);
  }

  notifySubscribers();
}

/**
 * Ajoute un nouveau pion dans la campagne.
 *
 * @param {Token} tokenData
 * @returns {void}
 */
export function addToken(tokenData) {
  if (!campaign) {
    throw new Error('Aucune campagne chargée');
  }

  const candidate = structuredClone(campaign);
  candidate.tokens.push(structuredClone(tokenData));
  assertValidCampaign(candidate, `Ajout du pion "${tokenData?.id || 'inconnu'}"`);
  campaign = candidate;
  notifySubscribers();
}

/**
 * Ajoute un nouvel étage à la campagne (ou initialise la campagne si inexistante) et le sélectionne.
 *
 * @param {Level} levelData
 * @returns {void}
 */
export function addLevel(levelData) {
  /** @type {Campaign} */
  let candidate;
  if (!campaign) {
    candidate = createCampaign({ levels: [structuredClone(levelData)] });
  } else {
    candidate = structuredClone(campaign);
    const idx = candidate.levels.findIndex((l) => l.id === levelData.id);
    if (idx !== -1) {
      candidate.levels[idx] = structuredClone(levelData);
    } else {
      candidate.levels.push(structuredClone(levelData));
    }
  }
  assertValidCampaign(candidate, `Ajout de l'étage "${levelData?.id || 'inconnu'}"`);
  campaign = candidate;
  activeLevelId = levelData.id;
  notifySubscribers();
}

/**
 * Met à jour l'étage actif avec les propriétés fournies.
 *
 * @param {Omit<Partial<Level>, 'grid'> & {grid?: Partial<import('../core/types.js').GridConfig>}} levelUpdates
 * @returns {void}
 */
export function updateActiveLevel(levelUpdates) {
  if (!campaign || !activeLevelId) return;
  updateLevel(activeLevelId, levelUpdates);
}

/**
 * Met à jour un étage identifié, indépendamment de l'étage actif.
 * La campagne candidate complète est validée avant toute mutation.
 *
 * @param {string} levelId
 * @param {Omit<Partial<Level>, 'grid'> & {grid?: Partial<import('../core/types.js').GridConfig>}} levelUpdates
 * @returns {void}
 */
export function updateLevel(levelId, levelUpdates) {
  if (!campaign) {
    throw new Error('Aucune campagne chargée');
  }
  const idx = campaign.levels.findIndex((l) => l.id === levelId);
  if (idx === -1) {
    throw new Error(`Étage inconnu : "${levelId}"`);
  }
  if (levelUpdates.id !== undefined && levelUpdates.id !== levelId) {
    throw new Error(
      `Mise à jour de l'étage "${levelId}" refusée : son identifiant ne peut pas être modifié`
    );
  }

  const candidate = structuredClone(campaign);
  const currentLevel = candidate.levels[idx];
  const gridUpdates = levelUpdates.grid || {};
  candidate.levels[idx] = {
    ...currentLevel,
    ...levelUpdates,
    grid: {
      ...currentLevel.grid,
      ...gridUpdates,
    },
  };
  assertValidCampaign(candidate, `Mise à jour de l'étage "${levelId}"`);
  campaign = candidate;
  notifySubscribers();
}

const ALLOWED_TOKEN_PATCH_KEYS = new Set(['elevation']);

/**
 * Met à jour les champs autorisés d'un pion existant.
 * La campagne candidate complète est validée avant toute mutation.
 *
 * @param {string} tokenId
 * @param {Partial<import('../core/types.js').Token>} patch
 * @returns {void}
 */
export function updateToken(tokenId, patch) {
  if (!campaign) {
    throw new Error('Aucune campagne chargée');
  }

  for (const key of Object.keys(patch)) {
    if (!ALLOWED_TOKEN_PATCH_KEYS.has(key)) {
      throw new Error(
        `Mise à jour du pion "${tokenId}" refusée : champ non autorisé "${key}"`
      );
    }
  }

  const index = campaign.tokens.findIndex((t) => t.id === tokenId);
  if (index === -1) {
    throw new Error(`Pion inconnu : "${tokenId}"`);
  }

  const candidate = structuredClone(campaign);
  candidate.tokens[index] = {
    ...candidate.tokens[index],
    ...patch,
  };

  assertValidCampaign(candidate, `Mise à jour du pion "${tokenId}"`);
  campaign = candidate;
  notifySubscribers();
}


/**
 * Supprime un pion de la campagne par son identifiant.
 *
 * @param {string} tokenId
 * @returns {void}
 */
export function removeToken(tokenId) {
  if (!campaign) {
    throw new Error('Aucune campagne chargée');
  }

  const index = campaign.tokens.findIndex((t) => t.id === tokenId);
  if (index === -1) {
    throw new Error(`Pion inconnu : "${tokenId}"`);
  }

  campaign.tokens.splice(index, 1);

  if (getSelectedTokenId() === tokenId) {
    clearSelectionState();
  }

  notifySubscribers();
}

/**
 * Vide le store : aucune campagne, aucun étage actif, aucune sélection.
 *
 * C'est une mutation comme les autres — elle **notifie**, et elle **conserve les abonnés**.
 * Effacer les abonnements serait une porte de service pour les tests dans l'API de
 * production : un abonné silencieusement débranché est un bug qu'on ne voit pas.
 *
 * @returns {void}
 */
export function resetStore() {
  campaign = null;
  activeLevelId = null;
  activeHandout = null;
  clearSelectionState();
  notifySubscribers();
}

/**
 * Instantané figé (Readonly) de l'état complet du store.
 *
 * @returns {Readonly<{
 *   campaign: Campaign | null,
 *   activeLevelId: string | null,
 *   activeLevel: Level | null,
 *   selectedTokenId: string | null,
 *   selectedToken: Token | null,
 *   reachableCells: Map<string, number>,
 *   activeHandout: Handout | null
 * }>}
 */
export function getState() {
  const activeLevel =
    campaign && activeLevelId
      ? campaign.levels.find((l) => l.id === activeLevelId) || null
      : null;

  const selId = getSelectedTokenId();
  const selectedToken =
    campaign && selId ? campaign.tokens.find((t) => t.id === selId) || null : null;

  return deepFreeze({
    campaign: campaign ? structuredClone(campaign) : null,
    activeLevelId,
    activeLevel: activeLevel ? structuredClone(activeLevel) : null,
    selectedTokenId: selId,
    selectedToken: selectedToken ? structuredClone(selectedToken) : null,
    reachableCells: getReachableCells(),
    activeHandout: activeHandout ? structuredClone(activeHandout) : null,
  });
}

/**
 * Copie figée de la campagne courante (ou null).
 * @returns {Campaign | null}
 */
export function getCampaign() {
  return campaign ? deepFreeze(structuredClone(campaign)) : null;
}

/**
 * Identifiant de l'étage actif (ou null).
 * @returns {string | null}
 */
export function getActiveLevelId() {
  return activeLevelId;
}

/**
 * Copie figée de l'étage actif courant (ou null).
 * @returns {Level | null}
 */
export function getActiveLevel() {
  if (!campaign || !activeLevelId) return null;
  const level = campaign.levels.find((l) => l.id === activeLevelId) || null;
  return level ? deepFreeze(structuredClone(level)) : null;
}

/**
 * Copie figée du pion sélectionné courant (ou null).
 * @returns {Token | null}
 */
export function getSelectedToken() {
  const selId = getSelectedTokenId();
  if (!campaign || !selId) return null;
  const token = campaign.tokens.find((t) => t.id === selId) || null;
  return token ? deepFreeze(structuredClone(token)) : null;
}

/**
 * Copie figée du handout actif courant (ou null).
 * @returns {Handout | null}
 */
export function getActiveHandout() {
  return activeHandout ? deepFreeze(structuredClone(activeHandout)) : null;
}

/**
 * Définit ou réinitialise le handout actif.
 * Refuse les URLs non persistables (data:, blob:).
 *
 * @param {Handout | null} handout
 * @returns {void}
 */
export function setActiveHandout(handout) {
  if (handout === null || handout === undefined) {
    if (activeHandout !== null) {
      activeHandout = null;
      notifySubscribers();
    }
    return;
  }

  if (typeof handout !== 'object' || !handout.imageUrl) {
    throw new Error('Handout invalide : imageUrl requise');
  }

  assertPersistableAssetUrl(handout.imageUrl, 'imageUrl');

  activeHandout = deepFreeze({
    id: String(handout.id || `handout-${Date.now()}`),
    name: String(handout.name || ''),
    imageUrl: String(handout.imageUrl),
  });

  notifySubscribers();
}

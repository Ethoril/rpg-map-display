// @ts-check

import { validateCampaign, createCampaign } from '../core/schema.js';
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

/** @type {Campaign | null} */
let campaign = null;

/** @type {string | null} */
let activeLevelId = null;

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
      storage.setItem(`rpg_campaign_${targetSessionId}`, JSON.stringify(campaign));
    }
    storage.setItem(
      `rpg_session_${targetSessionId}`,
      JSON.stringify({
        activeLevelId,
        selectedTokenId: getSelectedTokenId(),
      })
    );
  } catch (err) {
    console.warn('Erreur écriture LocalStorage :', err);
  }
}

/**
 * Restaure la campagne et l'état de session depuis LocalStorage.
 *
 * @param {string} sessionId
 * @returns {boolean} true si une campagne valide a été restaurée
 */
export function loadFromLocalStorage(sessionId) {
  const storage = getStorage();
  if (!sessionId || !storage) return false;
  currentSessionId = sessionId;
  try {
    const rawCamp = storage.getItem(`rpg_campaign_${sessionId}`);
    const rawSess = storage.getItem(`rpg_session_${sessionId}`);
    if (!rawCamp) return false;

    const campData = JSON.parse(rawCamp);
    const sessData = rawSess ? JSON.parse(rawSess) : {};

    restoreFromSnapshot(
      {
        campaign: campData,
        activeLevelId: sessData.activeLevelId,
        selectedTokenId: sessData.selectedTokenId,
      },
      { sessionId }
    );
    return true;
  } catch (err) {
    console.warn('Erreur chargement LocalStorage :', err);
    return false;
  }
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
  console.log('[DEBUG] restoreFromSnapshot appelée :', {
    hasCampaign: !!(snapshotData && snapshotData.campaign),
    levels: snapshotData?.campaign?.levels?.length ?? snapshotData?.levels?.length,
  });
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
    const errors = validateCampaign(campaignCandidate);
    if (errors.length > 0) {
      throw new Error(`Snapshot invalide : ${errors.join(' ; ')}`);
    }
    campaign = structuredClone(campaignCandidate);
  }

  const targetLevelId =
    options.activeLevelId ||
    snapshotData.activeLevelId ||
    (campaign && campaign.levels.length > 0 ? campaign.levels[0].id : null);

  if (campaign && targetLevelId && campaign.levels.some((l) => l.id === targetLevelId)) {
    activeLevelId = targetLevelId;
  }

  const targetTokenId = snapshotData.selectedTokenId || null;
  if (campaign && targetTokenId && campaign.tokens.some((t) => t.id === targetTokenId)) {
    const token = campaign.tokens.find((t) => t.id === targetTokenId);
    const level = campaign.levels.find((l) => l.id === activeLevelId) || null;
    if (token) setSelectionState(token, level);
  } else {
    clearSelectionState();
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
  const errors = validateCampaign(campaignData);
  if (errors.length > 0) {
    throw new Error(
      `Impossible de charger la campagne : document invalide. ${errors.join(' ; ')}`
    );
  }

  campaign = structuredClone(campaignData);
  activeLevelId = campaign.levels.length > 0 ? campaign.levels[0].id : null;
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

  const token = campaign.tokens.find((t) => t.id === tokenId);
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

  if (
    !tokenData.cell ||
    !Number.isInteger(tokenData.cell.a) ||
    !Number.isInteger(tokenData.cell.b)
  ) {
    throw new Error('Coordonnées du pion non entières');
  }

  campaign.tokens.push(structuredClone(tokenData));
  notifySubscribers();
}

/**
 * Ajoute un nouvel étage à la campagne (ou initialise la campagne si inexistante) et le sélectionne.
 *
 * @param {Level} levelData
 * @returns {void}
 */
export function addLevel(levelData) {
  if (!campaign) {
    campaign = createCampaign({ levels: [structuredClone(levelData)] });
  } else {
    const idx = campaign.levels.findIndex((l) => l.id === levelData.id);
    if (idx !== -1) {
      campaign.levels[idx] = structuredClone(levelData);
    } else {
      campaign.levels.push(structuredClone(levelData));
    }
  }
  activeLevelId = levelData.id;
  notifySubscribers();
}

/**
 * Met à jour l'étage actif avec les propriétés fournies.
 *
 * @param {Partial<Level>} levelUpdates
 * @returns {void}
 */
export function updateActiveLevel(levelUpdates) {
  if (!campaign || !activeLevelId) return;
  const idx = campaign.levels.findIndex((l) => l.id === activeLevelId);
  if (idx === -1) return;

  const currentLevel = campaign.levels[idx];
  const gridUpdates = levelUpdates.grid || {};
  campaign.levels[idx] = {
    ...currentLevel,
    ...levelUpdates,
    grid: {
      ...currentLevel.grid,
      ...gridUpdates,
    },
  };
  notifySubscribers();
}

/** Alias updateLevel pour compatibilité avec le contrat T-22 */
export const updateLevel = updateActiveLevel;

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
 *   reachableCells: Map<string, number>
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

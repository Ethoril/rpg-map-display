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

/**
 * Notifie tous les abonnés d'une mutation.
 */
function notifySubscribers() {
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

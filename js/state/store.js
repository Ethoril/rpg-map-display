// @ts-check

import {
  validateCampaign,
  createCampaign,
  normalizeCampaignColors,
  normalizeCampaign,
  normalizeLevel,
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
/** @typedef {import('../core/types.js').CellPoint} CellPoint */

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

  // Un état interne invalide est un **bug**, pas une panne d'environnement (`CONVENTIONS.md`
  // §6 : invariant violé → lever). La validation sort donc du `try` : à l'intérieur, elle se
  // faisait rhabiller en « Erreur écriture LocalStorage », ce qui envoyait chercher un quota
  // là où c'est une mutation qui a laissé passer une campagne invalide.
  if (campaign) {
    assertValidCampaign(campaign, 'Sauvegarde de la campagne');
  }

  try {
    if (campaign) {
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
    const normalise = normalizeCampaign(campaignCandidate);
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
    // La sauvegarde automatique est une **commodité**, pas une clause du contrat de mutation.
    // Quand on arrive ici, la mutation est déjà appliquée : laisser l'exception remonter
    // laisserait le store muté, les abonnés jamais prévenus, donc aucun rendu et — depuis
    // L-04 — la publication du fog interrompue en plein `.then()`. Un `localStorage` plein
    // sur le Mac cesserait alors d'alimenter les tablettes : la panne locale deviendrait une
    // panne de table. Refuser de notifier ne défait pas la mutation, ça ne fait qu'ajouter
    // une seconde avarie à la première.
    //
    // L'erreur n'est pas avalée pour autant : elle est journalisée, et `saveToLocalStorage`
    // l'a déjà consignée dans `lastPersistenceError`, que `getLastPersistenceError()` expose
    // et que `app/gm.js` remonte dans l'état réseau.
    try {
      saveToLocalStorage(currentSessionId);
    } catch (err) {
      console.warn(
        `Sauvegarde automatique impossible : ${err instanceof Error ? err.message : String(err)}`
      );
    }
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
  const normalise = normalizeCampaign(campaignData);

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
  const levelNormalized = normalizeLevel(structuredClone(levelData));
  if (!campaign) {
    candidate = createCampaign({ levels: [levelNormalized] });
  } else {
    candidate = structuredClone(campaign);
    const idx = candidate.levels.findIndex((l) => l.id === levelNormalized.id);
    if (idx !== -1) {
      candidate.levels[idx] = levelNormalized;
    } else {
      candidate.levels.push(levelNormalized);
    }
  }
  assertValidCampaign(candidate, `Ajout de l'étage "${levelData?.id || 'inconnu'}"`);
  campaign = candidate;
  activeLevelId = levelNormalized.id;
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

/**
 * Modifie l'état d'un portail sur un étage.
 *
 * @param {string} levelId
 * @param {string} portalId
 * @param {'open'|'closed'|'locked'} state
 * @returns {void}
 */
export function setPortalState(levelId, portalId, state) {
  if (state !== 'open' && state !== 'closed' && state !== 'locked') {
    throw new Error(`État de portail invalide : "${state}"`);
  }
  if (!campaign) {
    throw new Error('Aucune campagne chargée');
  }

  const candidate = structuredClone(campaign);
  const level = candidate.levels.find((l) => l.id === levelId);
  if (!level) {
    throw new Error(`Étage inconnu : "${levelId}"`);
  }
  const portal = level.portals.find((p) => p.id === portalId);
  if (!portal) {
    throw new Error(`Portail inconnu : "${portalId}" sur l'étage "${levelId}"`);
  }

  portal.state = state;

  assertValidCampaign(candidate, `Bascule du portail "${portalId}"`);
  campaign = candidate;

  // Si un pion est sélectionné et qu'il appartient à l'étage muté, rafraîchir ses cases atteignables
  const selectedId = getSelectedTokenId();
  if (selectedId) {
    const token = campaign.tokens.find((t) => t.id === selectedId);
    if (token && token.levelId === levelId) {
      const targetLevel = candidate.levels.find((l) => l.id === levelId) || null;
      setSelectionState(token, targetLevel);
    }
  }

  notifySubscribers();
}

/**
 * Ajoute une polyligne de mur sur un étage.
 *
 * @param {string} levelId
 * @param {CellPoint[]} wall
 * @returns {void}
 */
export function addWall(levelId, wall) {
  if (!campaign) {
    throw new Error('Aucune campagne chargée');
  }
  if (!Array.isArray(wall) || wall.length < 2) {
    throw new Error('Un mur doit être une polyligne d\'au moins 2 sommets');
  }
  for (let i = 0; i < wall.length; i++) {
    const pt = wall[i];
    if (
      !pt ||
      typeof pt !== 'object' ||
      typeof pt.cellX !== 'number' ||
      !Number.isFinite(pt.cellX) ||
      typeof pt.cellY !== 'number' ||
      !Number.isFinite(pt.cellY)
    ) {
      throw new Error(`Sommet de mur invalide à l'index ${i}`);
    }
  }

  const candidate = structuredClone(campaign);
  const level = candidate.levels.find((l) => l.id === levelId);
  if (!level) {
    throw new Error(`Étage inconnu : "${levelId}"`);
  }

  level.walls.push(structuredClone(wall));

  assertValidCampaign(candidate, `Ajout d'un mur sur l'étage "${levelId}"`);
  campaign = candidate;

  // Si un pion est sélectionné et qu'il appartient à l'étage muté, rafraîchir ses cases atteignables
  const selectedId = getSelectedTokenId();
  if (selectedId) {
    const token = campaign.tokens.find((t) => t.id === selectedId);
    if (token && token.levelId === levelId) {
      const targetLevel = candidate.levels.find((l) => l.id === levelId) || null;
      setSelectionState(token, targetLevel);
    }
  }

  notifySubscribers();
}

/**
 * Supprime une polyligne de mur sur un étage (comparaison par valeur exacte).
 * Idempotent : ne fait rien si le mur est déjà absent.
 *
 * @param {string} levelId
 * @param {CellPoint[]} wall
 * @returns {boolean} True si un mur a été retiré, false sinon.
 */
export function removeWall(levelId, wall) {
  if (!campaign) {
    throw new Error('Aucune campagne chargée');
  }
  if (!Array.isArray(wall)) return false;

  const candidate = structuredClone(campaign);
  const level = candidate.levels.find((l) => l.id === levelId);
  if (!level) return false;

  const idx = level.walls.findIndex((w) => {
    if (!Array.isArray(w) || w.length !== wall.length) return false;
    return w.every((pt, i) => pt.cellX === wall[i].cellX && pt.cellY === wall[i].cellY);
  });

  if (idx === -1) return false;

  level.walls.splice(idx, 1);

  assertValidCampaign(candidate, `Suppression d'un mur sur l'étage "${levelId}"`);
  campaign = candidate;

  // Si un pion est sélectionné et qu'il appartient à l'étage muté, rafraîchir ses cases atteignables
  const selectedId = getSelectedTokenId();
  if (selectedId) {
    const token = campaign.tokens.find((t) => t.id === selectedId);
    if (token && token.levelId === levelId) {
      const targetLevel = candidate.levels.find((l) => l.id === levelId) || null;
      setSelectionState(token, targetLevel);
    }
  }

  notifySubscribers();
  return true;
}

/**
 * Champs d'un pion qu'un patch peut modifier.
 *
 * La liste est **fermée** à dessein : un `{...token, ...patch}` libre laisserait réécrire
 * `id` ou `levelId` par une faute de frappe, et le pion changerait d'identité ou d'étage
 * sans qu'aucun message ne le dise.
 *
 * Ce qui reste dehors, et pourquoi :
 * - `id`, `levelId` — l'identité et l'appartenance à un étage ne se corrigent pas, elles se
 *   recréent. Le CdC §7 prévoit `token.levelChange` pour le changement d'étage.
 * - `cell`, `move` — la position appartient à `moveTokenToCell` et à `token.move`, qui
 *   portent l'animation déterministe. Deux chemins vers la même donnée en feraient diverger
 *   un des deux.
 * - `imageUrl` — remplacer l'image, c'est repasser par le générateur : un champ texte libre
 *   n'y apporterait qu'un moyen de casser l'affichage.
 */
const ALLOWED_TOKEN_PATCH_KEYS = new Set([
  'label',
  'kind',
  'borderColor',
  'sizeCells',
  'speedCells',
  'hidden',
  'playerMovable',
  'locked',
  'visionBright',
  'visionDim',
  'elevation',
  'markers',
]);

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
 * Transactionnelle comme ses voisines : la suppression se fait sur une campagne candidate,
 * validée avant d'être adoptée. Cette fonction opérait auparavant par `splice` directement
 * sur l'état vivant — elle était la seule mutation du store à le faire, et elle n'a jamais
 * été appelée par l'interface, donc l'écart n'était jamais apparu. Une suppression *peut*
 * invalider une campagne, ne serait-ce qu'en vidant `tokens` sous une contrainte future ;
 * avec un `splice`, l'état fautif serait déjà en place quand on s'en apercevrait.
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

  const candidate = structuredClone(campaign);
  candidate.tokens.splice(index, 1);
  assertValidCampaign(candidate, `Suppression du pion "${tokenId}"`);
  campaign = candidate;

  if (getSelectedTokenId() === tokenId) {
    clearSelectionState();
  }

  notifySubscribers();
}

/**
 * Pose ou déplace un gabarit sur la campagne.
 *
 * @param {import('../core/types.js').Template} templateData
 * @param {string[]} [cells]
 * @returns {void}
 */
export function placeTemplate(templateData, cells = []) {
  if (!campaign) {
    throw new Error('Aucune campagne chargée');
  }
  if (!templateData || typeof templateData !== 'object') {
    throw new Error('Données de gabarit requises');
  }

  const candidate = structuredClone(campaign);
  if (!Array.isArray(candidate.templates)) {
    candidate.templates = [];
  }

  const idx = candidate.templates.findIndex((t) => t.id === templateData.id);
  if (idx >= 0) {
    candidate.templates[idx] = structuredClone(templateData);
  } else {
    candidate.templates.push(structuredClone(templateData));
  }

  assertValidCampaign(candidate, `Placement du gabarit "${templateData.id || 'inconnu'}"`);
  campaign = candidate;
  if (Array.isArray(cells)) {
    sessionTemplateCellsMap.set(templateData.id, cells);
  }
  notifySubscribers();
}

/**
 * Supprime tous les gabarits d'un étage donné.
 *
 * @param {string} levelId
 * @returns {void}
 */
export function clearTemplates(levelId) {
  if (!campaign) {
    throw new Error('Aucune campagne chargée');
  }
  if (!levelId || typeof levelId !== 'string') {
    throw new Error('Identifiant d\'étage requis');
  }
  const levelExists = campaign.levels.some((l) => l.id === levelId);
  if (!levelExists) {
    throw new Error(`Étage inconnu : "${levelId}"`);
  }

  const candidate = structuredClone(campaign);
  const toRemove = (candidate.templates || []).filter((t) => t.levelId === levelId);
  candidate.templates = (candidate.templates || []).filter((t) => t.levelId !== levelId);

  assertValidCampaign(candidate, `Effacement des gabarits de l'étage "${levelId}"`);
  campaign = candidate;
  for (const t of toRemove) {
    sessionTemplateCellsMap.delete(t.id);
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
  sessionTemplateCellsMap.clear();
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

/** @type {Map<string, string>} */
const sessionFogMap = new Map();
/** @type {Map<string, string>} */
const sessionVisionMap = new Map();

/**
 * Consigne une panne de stockage du masque de fog, au lieu de l'avaler.
 *
 * `CONVENTIONS.md` §6 interdit un `catch` qui avale une erreur et continue. Les trois que
 * cette fonction remplace le faisaient : un quota dépassé, ou un `localStorage` refusé en
 * navigation privée, perdait le fog **en silence** — précisément la panne que le §6 existe
 * pour rendre bruyante. `getStorage()` ne rendant jamais `null` (il replie sur une carte
 * mémoire), ces `catch` ne pouvaient attraper qu'une vraie défaillance du stockage.
 *
 * L'erreur passe par `lastPersistenceError`, canal que `getLastPersistenceError()` expose et
 * que `app/gm.js` remonte déjà dans l'état réseau : le mécanisme existait, seul le fog ne
 * l'empruntait pas.
 *
 * @param {string} operation Libellé pour le message : « lecture », « écriture », « purge »
 * @param {string} levelId
 * @param {unknown} err
 * @returns {void}
 */
function recordMaskStorageError(operation, levelId, err) {
  lastPersistenceError = new Error(
    `Erreur ${operation} LocalStorage du masque de l'étage "${levelId}" : ${
      err instanceof Error ? err.message : String(err)
    }`,
    { cause: err }
  );
  console.warn(lastPersistenceError.message);
}

/**
 * Recupere le masque exploré pour un étage.
 * @param {string} levelId
 * @returns {string|null} Base64 PNG brut ou null
 */
export function getSessionFog(levelId) {
  if (!levelId) return null;
  if (sessionFogMap.has(levelId)) {
    return sessionFogMap.get(levelId) ?? null;
  }
  if (currentSessionId) {
    const saved = readFogFromStorage(currentSessionId, levelId);
    if (saved) {
      sessionFogMap.set(levelId, saved);
      return saved;
    }
  }
  return null;
}

/**
 * Lit le masque d'un étage depuis le stockage. Une panne rend `null` — l'absence de copie
 * sauvegardée est un état légitime, la séance se poursuit sur la carte mémoire.
 *
 * @param {string} sessionId
 * @param {string} levelId
 * @returns {string|null}
 */
function readFogFromStorage(sessionId, levelId) {
  try {
    return getStorage().getItem(`rpg_fog_${sessionId}_${levelId}`);
  } catch (err) {
    recordMaskStorageError('lecture', levelId, err);
    return null;
  }
}

/**
 * Reporte le masque d'un étage dans le stockage, ou l'en retire si `png` est `null`.
 *
 * **Ne lève pas, et c'est délibéré.** `setSessionFog` est appelée depuis le `.then()` de la
 * publication du MJ (`app/gm.js`, `scheduleFogPublish`) et depuis `applyNetworkEvent` : une
 * exception y interromprait le `transport.publish` qui suit. Un stockage plein sur le Mac
 * cesserait alors d'alimenter les tablettes — panne bien plus grave que la perte d'une copie
 * locale. La carte mémoire porte la vérité de la séance en cours ; `localStorage` n'en est
 * que le report d'un démarrage au suivant.
 *
 * @param {string} sessionId
 * @param {string} levelId
 * @param {string|null} png
 * @returns {void}
 */
function writeFogToStorage(sessionId, levelId, png) {
  try {
    if (png === null) {
      getStorage().removeItem(`rpg_fog_${sessionId}_${levelId}`);
    } else {
      getStorage().setItem(`rpg_fog_${sessionId}_${levelId}`, png);
    }
  } catch (err) {
    recordMaskStorageError(png === null ? 'purge' : 'écriture', levelId, err);
  }
}

/**
 * Enregistre le masque exploré pour un étage.
 * @param {string} levelId
 * @param {string|null} png Base64 PNG brut
 */
export function setSessionFog(levelId, png) {
  if (!levelId) return;
  if (!png) {
    sessionFogMap.delete(levelId);
    if (currentSessionId) {
      writeFogToStorage(currentSessionId, levelId, null);
    }
  } else {
    sessionFogMap.set(levelId, png);
    if (currentSessionId) {
      writeFogToStorage(currentSessionId, levelId, png);
    }
  }
  notifySubscribers();
}

/**
 * Recupere le masque de vision courante (visible) pour un étage.
 * @param {string} levelId
 * @returns {string|null}
 */
export function getSessionVision(levelId) {
  return levelId ? sessionVisionMap.get(levelId) ?? null : null;
}

/**
 * Enregistre le masque de vision courante (visible) pour un étage.
 * @param {string} levelId
 * @param {string|null} png
 */
export function setSessionVision(levelId, png) {
  if (!levelId) return;
  if (!png) {
    sessionVisionMap.delete(levelId);
  } else {
    sessionVisionMap.set(levelId, png);
  }
  notifySubscribers();
}

/** @type {Map<string, string[]>} */
const sessionTemplateCellsMap = new Map();

/**
 * Recupere les cases affectees par un gabarit (Session).
 * @param {string} templateId
 * @returns {string[]}
 */
export function getSessionTemplateCells(templateId) {
  return templateId ? sessionTemplateCellsMap.get(templateId) ?? [] : [];
}

/**
 * Enregistre les cases affectees d'un gabarit (Session).
 * @param {string} templateId
 * @param {string[]} cells
 */
export function setSessionTemplateCells(templateId, cells) {
  if (!templateId) return;
  if (!Array.isArray(cells) || cells.length === 0) {
    sessionTemplateCellsMap.delete(templateId);
  } else {
    sessionTemplateCellsMap.set(templateId, cells);
  }
  notifySubscribers();
}


// @ts-check

import {
  validateCampaign,
  createCampaign,
  normalizeCampaign,
  normalizeLevel,
} from '../core/schema.js';
import {
  setSelectionState,
  clearSelectionState,
  getSelectedTokenId,
  getReachableCells,
} from './selection.js';
import { gridFor } from '../grid/index.js';
import { numberLibraryCopy } from '../import/tokenCatalog.js';
import { cellKey, parseCellKey } from '../core/cellKey.js';

/** @typedef {import('../core/types.js').Campaign} Campaign */
/** @typedef {import('../core/types.js').Level} Level */
/** @typedef {import('../core/types.js').Token} Token */
/** @typedef {import('../core/types.js').Cell} Cell */
/** @typedef {import('../core/types.js').CellPoint} CellPoint */

/** @type {Campaign | null} */
let campaign = null;

/** @type {string | null} */
let activeLevelId = null;

/**
 * Dernier instantané destiné au rendu. Il ne contient aucune copie de la campagne : ses
 * branches sont celles de l'état interne, gelées au moment où elles entrent dans le store.
 * Il est invalidé par `notifySubscribers`, donc une frame qui suit une mutation voit un
 * objet cohérent, tandis que les frames d'animation partagent exactement les mêmes données.
 *
 * @type {Readonly<{
 *   campaign: Campaign | null,
 *   activeLevelId: string | null,
 *   activeLevel: Level | null,
 *   selectedTokenId: string | null,
 *   selectedToken: Token | null,
 *   reachableCells: Map<string, number>
 * }> | null}
 */
let renderSnapshot = null;

/** @type {Set<(change: StoreChange) => void>} */
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
 * Retourne une Map lisible, mais dont les trois mutateurs échouent aussi à l'exécution.
 * `Object.freeze(new Map())` ne suffit pas : les emplacements internes d'une Map restent
 * modifiables par `.set()`. Cette protection est nécessaire car le renderer reçoit la Map
 * des cases atteignables directement dans le snapshot partagé.
 *
 * @param {Map<string, number>} source
 * @returns {Map<string, number>}
 */
function createReadonlyMap(source) {
  const snapshot = new Map(source);
  const immutable = () => {
    throw new TypeError('Snapshot de rendu en lecture seule');
  };
  Object.defineProperties(snapshot, {
    set: { value: immutable },
    delete: { value: immutable },
    clear: { value: immutable },
  });
  return Object.freeze(snapshot);
}

/**
 * Fige la nouvelle racine de campagne avant qu'elle ne devienne observable par le rendu.
 * Les mutateurs travaillent déjà sur un `structuredClone`, donc le gel ne les empêche pas
 * de préparer la prochaine version de l'état.
 *
 * @param {Campaign} nextCampaign
 */
function replaceCampaign(nextCampaign) {
  campaign = deepFreeze(nextCampaign);
}

/** @type {string | null} */
let currentSessionId = null;
/** @type {Error|null} */
let lastPersistenceError = null;

/**
 * Ce que `resolveStackedTokens` a envoyé en réserve au dernier chargement — remis à zéro à
 * CHAQUE appel (voir la fonction), donc jamais un reliquat d'une campagne précédente. C'est un
 * fait de ce poste sur ce qu'il vient de lire, pas un état de campagne : rien ici ne se
 * réseaute ni ne se persiste (CLAUDE.md, interdiction réseau).
 *
 * @type {{id: string, label: string}[]}
 */
let stackingNormalizationReport = [];

/**
 * Configure l'identifiant de session actif pour la persistance automatique en LocalStorage.
 *
 * @param {string | null} sessionId
 */
export function setSessionId(sessionId) {
  // ⛔ Les masques de session en mémoire appartiennent à LA session (audit du 22/09, C10) :
  // `getSessionFog` les sert avant le stockage, donc les garder faisait revenir, dans une
  // autre session, le masque d'un étage de même identifiant.
  if (sessionId !== currentSessionId) {
    sessionFogMap.clear();
    sessionVisionMap.clear();
  }
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
 * ⭐ **UNE CASE, UN PION, POUR TOUS LES PIONS** — décision du mainteneur du 10/09/2026
 * (C-6, `docs/QUESTIONS-EN-ATTENTE.md`). Seule porte d'entrée de l'invariant : les cinq chemins
 * qui posent ou déplacent un pion (`addToken`, `moveTokenToCell`, `traverseLink`,
 * `placeTokenFromReserve`, `updateToken`) l'appellent tous, et la normalisation au chargement
 * (`resolveStackedTokens`) aussi.
 *
 * La règle porte sur **toute l'emprise** (`GridAdapter.cellsOccupied`), pas la seule case
 * d'ancrage : c'est ce que la table voit, et c'est aussi ce qui rend cette fonction correcte en
 * hexagonal, où l'emprise est une rosette et non un carré.
 *
 * ⛔ Ne relogue jamais le pion en conflit — elle se contente de le désigner. Un relogement
 * automatique vers une case libre voisine serait « quelque chose qui bouge dans le dos de tout le
 * monde » (CLAUDE.md, règle n°4) ; c'est à l'appelant de refuser.
 *
 * @param {Token[]} tokensOnBoard Pions à considérer (jamais la réserve, qui n'occupe aucune case)
 * @param {Level} level Étage sur lequel `cell` est exprimée, pour son `GridAdapter`
 * @param {string} levelId
 * @param {Cell} cell Ancre du pion testé
 * @param {number} sizeCells
 * @param {string | null} excludeTokenId Pion à ignorer — lui-même, lors d'un déplacement ou d'un
 *   redimensionnement
 * @returns {Token | null} Le premier pion dont l'emprise croise celle testée, ou `null`
 */
function findStackingConflict(tokensOnBoard, level, levelId, cell, sizeCells, excludeTokenId) {
  const grid = gridFor(level);
  const claimed = new Set(grid.cellsOccupied(cell, sizeCells || 1).map(cellKey));

  for (const other of tokensOnBoard) {
    if (other.levelId !== levelId) continue;
    if (excludeTokenId && other.id === excludeTokenId) continue;

    const otherCells = grid.cellsOccupied(other.cell, other.sizeCells || 1);
    if (otherCells.some((c) => claimed.has(cellKey(c)))) {
      return other;
    }
  }

  return null;
}

/**
 * Normalise une campagne chargée qui contiendrait un empilement — jamais ne la refuse (précédent
 * `visionBright`/`ambient.color` : refuser une campagne existante est une régression plus chère
 * que le défaut corrigé). Appelée au chargement (`loadCampaign`, `restoreFromSnapshot`), après
 * `normalizeCampaign` et avant la validation.
 *
 * ⭐ **Départage déterministe, en commentaire pour ne pas le perdre** : les pions sont traités par
 * identifiant CROISSANT, et le premier arrivé sur une case garde sa place — c'est le même
 * départage que `findHitToken` à distance nulle. Un pion dont l'emprise croise celle d'un pion
 * déjà retenu part en réserve : c'est elle qui accueille « hors du plateau », donc l'y envoyer
 * n'invente aucune position. Et ça se dit : un `console.warn` nomme chaque pion déplacé, et
 * `getStackingNormalizationReport()` le tient pour le panneau MJ — un `console.warn` seul est
 * invisible pour le mainteneur (CLAUDE.md, règle n°4 : rien ne se déplace dans le dos de
 * personne).
 *
 * ⭐ **Remise à zéro systématique** : chaque appel écrase `stackingNormalizationReport`, y
 * compris quand il n'y a rien à signaler. Sans quoi l'avertissement d'une campagne survivrait
 * à la campagne suivante, saine, qui vient de se charger par-dessus.
 *
 * @param {Campaign} campaignObj Mutée en place (déjà une copie de travail à ce stade)
 * @returns {Campaign}
 */
function resolveStackedTokens(campaignObj) {
  if (!Array.isArray(campaignObj.tokens) || campaignObj.tokens.length === 0) {
    stackingNormalizationReport = [];
    return campaignObj;
  }

  /** @type {Token[]} */
  const survivors = [];
  /** @type {Set<string>} */
  const evictedIds = new Set();

  const byIdCroissant = [...campaignObj.tokens].sort((a, b) =>
    String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0
  );

  for (const token of byIdCroissant) {
    const level = campaignObj.levels.find((l) => l.id === token.levelId);
    // Un `levelId` inconnu n'est pas notre affaire : `validateCampaign` le refusera juste après.
    const conflict =
      level && findStackingConflict(survivors, level, token.levelId, token.cell, token.sizeCells || 1, null);
    if (conflict) {
      evictedIds.add(token.id);
      console.warn(
        `Pion "${token.id}" envoyé en réserve au chargement : sa case était déjà occupée par ` +
          `"${conflict.id}" (une case, un pion — C-6).`
      );
    } else {
      survivors.push(token);
    }
  }

  if (evictedIds.size === 0) {
    stackingNormalizationReport = [];
    return campaignObj;
  }

  const evicted = campaignObj.tokens.filter((t) => evictedIds.has(t.id));
  campaignObj.tokens = campaignObj.tokens.filter((t) => !evictedIds.has(t.id));
  campaignObj.reserve = [...(campaignObj.reserve ?? []), ...evicted];
  stackingNormalizationReport = evicted.map((t) => ({ id: t.id, label: t.label }));
  return campaignObj;
}

/**
 * Ce que le dernier chargement de campagne a envoyé en réserve pour cause d'empilement — vide
 * si le dernier chargement était sain. C'est le panneau MJ (tiroir de réserve) qui l'affiche :
 * voir `resolveStackedTokens`.
 *
 * @returns {{id: string, label: string}[]}
 */
export function getStackingNormalizationReport() {
  return [...stackingNormalizationReport];
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
 *   les deux. Une entrée de session sans campagne est un cas réel et non une anomalie :
 *   `saveToLocalStorage` l'écrit même quand aucune carte n'est chargée. Aucun appelant
 *   n'exploite ce retour aujourd'hui ; ne pas en déduire « une campagne est chargée »
 *   sans vérifier `getCampaign()`.
 *
 *   ⚠ Une entrée de session écrite avant C-13 porte encore `activeHandout` : il est ignoré.
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

    const lu = rawCamp ? JSON.parse(rawCamp) : null;
    // Le transport a longtemps écrit sous cette clé l'enveloppe `{campaign, …}` au lieu de la
    // campagne nue (audit du 22/09, A2). Elle existe encore chez les utilisateurs : sans ce
    // déballage, rien n'était restauré, et la sauvegarde suivante effaçait la clé.
    const campData = lu && !Array.isArray(lu.levels) && lu.campaign ? lu.campaign : lu;
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
    const normalise = resolveStackedTokens(normalizeCampaign(campaignCandidate));
    const errors = validateCampaign(normalise);
    if (errors.length > 0) {
      throw new Error(`Snapshot invalide : ${errors.join(' ; ')}`);
    }
    replaceCampaign(structuredClone(normalise));
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

  // ⛔ `snapshotData.activeHandout`, qu'un instantané d'avant C-13 porte encore, n'est pas lu : le
  // partage d'image ne passe plus par le store (nœud d'état RTDB, `FirebaseTransport.shareImage`).

  notifySubscribers();
}

/**
 * Nature d'une notification : `session` vaut `true` quand seul un masque de session (fog
 * exploré, vision courante) a changé — la campagne, elle, est intacte.
 * @typedef {{ session: boolean }} StoreChange
 */

/**
 * Notifie tous les abonnés d'une mutation.
 *
 * ⛔ Audit du 22/09, C2 : `setSessionFog` et `setSessionVision` passaient par ici comme une
 * mutation de campagne. Chaque masque reçu — la vision, publiée sans limite de fréquence —
 * revalidait et réécrivait TOUTE la campagne dans localStorage, et faisait réécrire l'instantané
 * Firestore par les abonnés, alors que la campagne n'avait pas changé. Une notification de
 * session saute la sauvegarde, et le dit à ses abonnés.
 *
 * @param {StoreChange} [change]
 */
function notifySubscribers(change = { session: false }) {
  // Ne pas reconstruire ici : il n'y a pas de raison de payer même une copie de Map tant
  // qu'aucune frame ne lit l'état. La prochaine lecture reconstruira un instantané unique.
  renderSnapshot = null;
  if (currentSessionId && !change.session) {
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
      listener(change);
    } catch (err) {
      console.error('Erreur dans un abonné du store :', err);
    }
  }
}

/**
 * S'abonne aux changements d'état du store. L'abonné reçoit la nature du changement : voir
 * `StoreChange`.
 *
 * @param {(change: StoreChange) => void} listener
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
  const normalise = resolveStackedTokens(normalizeCampaign(campaignData));

  try {
    assertValidCampaign(normalise, 'Chargement de la campagne');
  } catch (err) {
    throw new Error(
      `Impossible de charger la campagne : document invalide. ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const chargee = structuredClone(normalise);
  replaceCampaign(chargee);
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
 * Le pion qui empêcherait `tokenId` d'aller en `cell` (une case, un pion — C-6), ou `null`.
 * Ne mute rien : c'est la question que `moveTokenToCell` se pose avant de lever.
 *
 * Sert à l'arbitrage du MJ (audit du 22/09, C3 ; D-10) : devant un coup reçu de la table vers une
 * case qu'il occupe déjà, le MJ doit savoir QUI l'occupe pour réannoncer ce pion.
 *
 * @param {string} tokenId
 * @param {Cell} cell
 * @returns {Token|null}
 */
export function findMoveConflict(tokenId, cell) {
  if (!campaign) return null;
  const token = campaign.tokens.find((t) => t.id === tokenId);
  if (!token) return null;
  const level = campaign.levels.find((l) => l.id === token.levelId);
  if (!level) return null;
  return findStackingConflict(campaign.tokens, level, token.levelId, cell, token.sizeCells || 1, tokenId) ?? null;
}

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
  // (`findMoveConflict`, plus bas, répond à la même question sans rien muter.)

  const fromCell = { a: token.cell.a, b: token.cell.b };

  // Une case, un pion (C-6) : la destination doit être libre sur TOUTE l'emprise du pion
  // déplacé, pas seulement sa case d'ancrage.
  const destLevel = candidate.levels.find((l) => l.id === token.levelId);
  if (destLevel) {
    const conflict = findStackingConflict(
      candidate.tokens,
      destLevel,
      token.levelId,
      { a: cell.a, b: cell.b },
      token.sizeCells || 1,
      tokenId
    );
    if (conflict) {
      throw new Error(
        `Déplacement du pion "${tokenId}" refusé : case occupée par "${conflict.id}"`
      );
    }
  }

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
  replaceCampaign(candidate);

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

  // Une case, un pion (C-6) : refuser AVANT de cloner la campagne, sur l'état encore vivant —
  // les autres refus de cette fonction (validation de schéma) se lisent sur le candidat, mais
  // celui-ci porterait déjà le pion en trop si on le laissait passer jusque-là.
  const level = campaign.levels.find((l) => l.id === tokenData.levelId);
  if (level) {
    const conflict = findStackingConflict(
      campaign.tokens,
      level,
      tokenData.levelId,
      tokenData.cell,
      tokenData.sizeCells || 1,
      null
    );
    if (conflict) {
      throw new Error(
        `Ajout du pion "${tokenData?.id || 'inconnu'}" refusé : case occupée par "${conflict.id}"`
      );
    }
  }

  const candidate = structuredClone(campaign);
  candidate.tokens.push(structuredClone(tokenData));
  assertValidCampaign(candidate, `Ajout du pion "${tokenData?.id || 'inconnu'}"`);
  replaceCampaign(candidate);
  notifySubscribers();
}

/**
 * Pose un exemplaire de bibliothèque et le numérote — chantier C-15.
 *
 * ⭐ **Une seule transaction** : le numéro donné au premier exemplaire (quand on pose le deuxième),
 * celui du nouveau, le compteur de campagne et l'ajout lui-même. Validés ensemble, adoptés ensemble ;
 * un refus (case occupée, schéma) ne laisse aucun numéro distribué pour rien.
 *
 * La règle elle-même est `numberLibraryCopy`, pure. L'appelant publie les `token.update` rendus
 * dans `patches` PUIS le `token.add` du pion rendu — les joueurs reçoivent ainsi les numéros des
 * deux exemplaires.
 *
 * @param {import('../core/types.js').Token} tokenData pion à poser, avec `libraryId`
 * @returns {{ token: import('../core/types.js').Token, patches: { tokenId: string, patch: { copyNumber: number, label?: string } }[] }}
 */
export function addLibraryCopy(tokenData) {
  if (!campaign) {
    throw new Error('Aucune campagne chargée');
  }
  const level = campaign.levels.find((l) => l.id === tokenData.levelId);
  if (level) {
    const conflict = findStackingConflict(
      campaign.tokens,
      level,
      tokenData.levelId,
      tokenData.cell,
      tokenData.sizeCells || 1,
      null
    );
    if (conflict) {
      throw new Error(
        `Ajout du pion "${tokenData?.id || 'inconnu'}" refusé : case occupée par "${conflict.id}"`
      );
    }
  }

  const { token, patches, counter } = numberLibraryCopy(campaign, tokenData);
  const candidate = structuredClone(campaign);
  for (const { tokenId, patch } of patches) {
    const cible =
      candidate.tokens.find((t) => t.id === tokenId) ?? (candidate.reserve ?? []).find((t) => t.id === tokenId);
    if (cible) Object.assign(cible, patch);
  }
  if (counter !== null && tokenData.libraryId) {
    candidate.settings = {
      ...(candidate.settings ?? {}),
      copyCounters: { ...(candidate.settings?.copyCounters ?? {}), [tokenData.libraryId]: counter },
    };
  }
  candidate.tokens.push(structuredClone(token));
  assertValidCampaign(candidate, `Ajout du pion "${tokenData?.id || 'inconnu'}"`);
  replaceCampaign(candidate);
  notifySubscribers();
  return { token: structuredClone(token), patches };
}

/**
 * Identifiant et nom de chaque étage, sans cloner la campagne.
 *
 * ⚠ **`getCampaign()` coûte cher, et le prix se paie à chaque mutation.** Il fait
 * `deepFreeze(structuredClone(campaign))` : **2,49 ms mesurés dans le navigateur** sur une carte
 * de 65 × 71 cases et 1338 murs, contre 5,15 ms pour `getState()`. Un abonné du store qui
 * l'appelle pour lire trois champs paie donc le clonage de toute la géométrie de l'étage —
 * murs, portails, lumières — à chaque déplacement de pion.
 *
 * C'est exactement la faute commise par la barre d'étage du lot 3 : elle appelait `getCampaign()`
 * en première ligne de la souscription du panneau MJ, pour n'en tirer qu'une liste de noms.
 *
 * ⛔ Ne pas rendre les objets `Level` eux-mêmes ici : ce serait rouvrir la porte au clonage, ou
 * pire, laisser fuir une référence mutable sur l'état interne.
 *
 * @returns {{ id: string, name: string }[]}
 */
export function getLevelSummaries() {
  return (campaign?.levels ?? [])
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((l) => ({ id: l.id, name: l.name }));
}

/**
 * Les liaisons de la campagne.
 *
 * @returns {import('../core/types.js').Link[]}
 */
export function getLinks() {
  return campaign?.links ?? [];
}

/**
 * Ajoute une liaison complète de façon transactionnelle.
 *
 * @param {import('../core/types.js').Link} linkData
 */
export function addLink(linkData) {
  if (!campaign) throw new Error('Aucune campagne chargée');
  if (!linkData || typeof linkData.id !== 'string' || linkData.id.length === 0) {
    throw new Error('Liaison invalide : identifiant requis');
  }
  if (campaign.links.some((link) => link.id === linkData.id)) {
    throw new Error(`Liaison déjà existante : "${linkData.id}"`);
  }
  const candidate = structuredClone(campaign);
  candidate.links.push(structuredClone(linkData));
  assertValidCampaign(candidate, `Ajout de la liaison "${linkData.id}"`);
  replaceCampaign(candidate);
  notifySubscribers();
}

/**
 * Supprime une liaison. L'absence est idempotente et ne notifie pas.
 *
 * @param {string} linkId
 * @returns {boolean}
 */
export function removeLink(linkId) {
  if (!campaign) throw new Error('Aucune campagne chargée');
  const index = campaign.links.findIndex((link) => link.id === linkId);
  if (index < 0) return false;
  const candidate = structuredClone(campaign);
  candidate.links.splice(index, 1);
  assertValidCampaign(candidate, `Suppression de la liaison "${linkId}"`);
  replaceCampaign(candidate);
  notifySubscribers();
  return true;
}

/**
 * La liaison dont une extrémité tombe exactement sur cette case de cet étage, s'il y en a une.
 *
 * ⚠ **Le franchissement exige la case exacte**, sans la tolérance de désignation du chantier O.
 * Cette tolérance sert à *viser* un pion ou une porte, gestes réversibles ; une téléportation
 * change d'étage et casse la continuité du plateau. Un escalier qu'on rate se retape ; un escalier
 * qu'on prend par accident oblige à revenir, et la table a vu l'autre étage entre-temps.
 *
 * @param {string} levelId
 * @param {{a: number, b: number}} cell
 * @param {{ includeGmOnly?: boolean }} [options]
 * @returns {{ link: import('../core/types.js').Link, vers: import('../core/types.js').LinkEndpoint }|null}
 */
export function findLinkAtCell(levelId, cell, options = {}) {
  if (!levelId || !cell) return null;
  for (const lien of getLinks()) {
    if (!options.includeGmOnly && lien.gmOnly) continue;
    /** @type {[import('../core/types.js').LinkEndpoint, import('../core/types.js').LinkEndpoint][]} */
    const sens = [
      [lien.a, lien.b],
      [lien.b, lien.a],
    ];
    for (const [depuis, vers] of sens) {
      // Une liaison à sens unique ne se prend que de `a` vers `b`.
      if (!lien.bidirectional && depuis !== lien.a) continue;
      if (depuis.levelId === levelId && depuis.at.cellX === cell.a && depuis.at.cellY === cell.b) {
        return { link: lien, vers };
      }
    }
  }
  return null;
}

/**
 * Fait franchir une liaison à un pion : il change de case **et d'étage**.
 *
 * ⚠ C'est la seule mutation qui déplace un pion d'un étage à l'autre. `moveTokenToCell` reste
 * confinée à l'étage du pion — les deux ne doivent pas fusionner : un déplacement ordinaire qui
 * pourrait changer d'étage par inadvertance ferait disparaître un pion de la table.
 *
 * @param {string} tokenId
 * @param {string} linkId
 * @param {{ expectedDestination?: {levelId: string, cell: {a: number, b: number}} }} [options]
 * @returns {{ levelId: string, cell: {a: number, b: number} }} La destination effectivement appliquée
 */
export function traverseLink(tokenId, linkId, options = {}) {
  if (!campaign) {
    throw new Error('Aucune campagne chargée');
  }
  const pion = campaign.tokens.find((t) => t.id === tokenId);
  if (!pion) {
    throw new Error(`Pion inconnu : "${tokenId}"`);
  }
  const lien = getLinks().find((l) => l.id === linkId);
  if (!lien) {
    throw new Error(`Liaison inconnue : "${linkId}"`);
  }

  // Le départ est l'extrémité qui porte le pion ; l'arrivée est l'autre.
  const surA =
    lien.a.levelId === pion.levelId &&
    lien.a.at.cellX === pion.cell.a &&
    lien.a.at.cellY === pion.cell.b;
  const surB =
    lien.b.levelId === pion.levelId &&
    lien.b.at.cellX === pion.cell.a &&
    lien.b.at.cellY === pion.cell.b;

  if (!surA && !surB) {
    throw new Error(`Le pion "${tokenId}" n'est sur aucune extrémité de la liaison "${linkId}"`);
  }
  if (surB && !lien.bidirectional) {
    throw new Error(`La liaison "${linkId}" est à sens unique et ne se prend pas dans ce sens`);
  }

  const vers = surA ? lien.b : lien.a;
  const destination = { levelId: vers.levelId, cell: { a: vers.at.cellX, b: vers.at.cellY } };
  const expected = options.expectedDestination;
  if (
    expected &&
    (expected.levelId !== destination.levelId ||
      expected.cell?.a !== destination.cell.a ||
      expected.cell?.b !== destination.cell.b)
  ) {
    throw new Error(`Destination contradictoire pour la liaison "${linkId}"`);
  }

  // Une case, un pion (C-6) : un escalier dont la case d'arrivée est occupée ne se franchit
  // plus. Conséquence de jeu assumée — le refus est celui que l'interface sait déjà montrer,
  // pas un silence.
  const arriveeLevel = campaign.levels.find((l) => l.id === destination.levelId);
  if (arriveeLevel) {
    const conflict = findStackingConflict(
      campaign.tokens,
      arriveeLevel,
      destination.levelId,
      destination.cell,
      pion.sizeCells || 1,
      tokenId
    );
    if (conflict) {
      throw new Error(
        `Franchissement de la liaison "${linkId}" refusé : case d'arrivée occupée par "${conflict.id}"`
      );
    }
  }

  const candidate = structuredClone(campaign);
  const cible = candidate.tokens.find((/** @type {any} */ t) => t.id === tokenId);
  if (!cible) {
    // Inatteignable — le pion vient d'être trouvé dans `campaign` juste au-dessus, et la copie en
    // est fidèle. Écrit quand même : une copie qui perdrait un pion doit se dire, pas se deviner.
    throw new Error(`Pion "${tokenId}" perdu à la copie de la campagne`);
  }
  cible.levelId = destination.levelId;
  cible.cell = destination.cell;
  assertValidCampaign(candidate, `Franchissement de la liaison "${linkId}"`);
  replaceCampaign(candidate);

  // La sélection ne survit pas au changement d'étage : le pion n'est plus sur l'étage affiché.
  // La laisser produirait une zone de déplacement calculée sur un étage, dessinée sur un autre.
  const selId = getSelectedTokenId();
  if (selId === tokenId && getActiveLevelId() !== destination.levelId) {
    clearSelectionState();
  }

  notifySubscribers();
  return destination;
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
  replaceCampaign(candidate);
  if (!activeLevelId) {
    activeLevelId = levelNormalized.id;
  }
  // Un étage remplacé en place (même identifiant) peut changer de grille ou de murs.
  rafraichirZoneAtteignable(levelNormalized.id);
  notifySubscribers();
}

/**
 * Recalcule la zone atteignable du pion sélectionné, s'il y en a un et qu'il est sur
 * `levelId` (ou sur n'importe quel étage si `levelId` est omis).
 *
 * ⛔ Toute mutation qui change la vitesse, la taille ou la position d'un pion, ou la grille,
 * les murs ou les portes d'un étage, doit passer par ici (audit du 22/09, A4). La zone est
 * un CACHE : sans ce rappel, elle restait celle d'avant la mutation — la tablette acceptait
 * un coup à 6 cases pour un pion ramené à 3, et des clés de cases carrées étaient relues
 * en hexagonal.
 *
 * @param {string} [levelId]
 * @returns {void}
 */
function rafraichirZoneAtteignable(levelId) {
  const selectedId = getSelectedTokenId();
  if (!selectedId || !campaign) return;
  const token = campaign.tokens.find((t) => t.id === selectedId);
  if (!token) return;
  if (levelId !== undefined && token.levelId !== levelId) return;
  const level = campaign.levels.find((l) => l.id === token.levelId) || null;
  if (level) setSelectionState(token, level);
}

/**
 * Retire un étage de la campagne et tout ce qu'il portait (amendement UX-16).
 *
 * Emporte avec l'étage : ses pions posés (`campaign.tokens`), ses gabarits (`campaign.templates`,
 * qui portent un `levelId`), et **toute liaison dont une extrémité vivait dessus** — une liaison
 * pendante serait un piège silencieux, invisible jusqu'au jour où quelqu'un tente de la franchir.
 * Purge aussi le masque exploré et la vision de session de l'étage : sans cela, un étage réimporté
 * plus tard sous le même identifiant hériterait d'un vieux brouillard.
 *
 * ⛔ **Ne touche PAS aux pions en réserve.** UX-14 : leur `levelId` et leur `cell` n'y sont qu'une
 * trace de provenance, pas une position, et le schéma ne les valide ni contre les étages existants
 * ni contre les bornes de la carte. Un pion rangé survit donc à la disparition de son étage
 * d'origine — ne pas « corriger » ça en le filtrant ici.
 *
 * ⛔ **Le dernier étage ne se retire pas** : une campagne sans étage n'a pas de vue. C'est le
 * miroir de la règle d'`addLevel`, qui ne sélectionne que s'il n'y avait pas d'étage actif —
 * l'initialisation, seul cas où quelqu'un doit bien être choisi.
 *
 * ⚠ Si l'étage retiré était l'étage actif, un autre est sélectionné — le premier restant dans
 * l'ordre. C'est le seul endroit où quelque chose bouge sans que personne l'ait demandé : le
 * geste explicite et confirmé du MJ qui retire l'étage autorise ce déplacement-là.
 *
 * Rejeu inoffensif : un étage déjà absent rend `false` sans lever, comme `token.reserve`.
 *
 * @param {string} levelId
 * @returns {boolean} true si un étage a été retiré
 */
export function removeLevel(levelId) {
  if (!campaign) {
    throw new Error('Aucune campagne chargée');
  }
  if (!levelId || typeof levelId !== 'string') {
    throw new Error("Identifiant d'étage requis");
  }

  const idx = campaign.levels.findIndex((l) => l.id === levelId);
  if (idx < 0) return false;

  if (campaign.levels.length <= 1) {
    throw new Error(
      `Retrait de l'étage "${levelId}" refusé : c'est le dernier, une campagne sans étage n'a pas de vue`
    );
  }

  const candidate = structuredClone(campaign);
  candidate.levels.splice(
    candidate.levels.findIndex((l) => l.id === levelId),
    1
  );
  candidate.tokens = candidate.tokens.filter((t) => t.levelId !== levelId);
  candidate.templates = (candidate.templates || []).filter((t) => t.levelId !== levelId);
  candidate.links = (candidate.links || []).filter(
    (link) => link.a.levelId !== levelId && link.b.levelId !== levelId
  );

  assertValidCampaign(candidate, `Retrait de l'étage "${levelId}"`);
  replaceCampaign(candidate);

  // Le masque exploré et la vision de session de l'étage ne survivent pas : sans cette purge, un
  // étage réimporté plus tard sous le même identifiant hériterait d'un vieux brouillard.
  sessionFogMap.delete(levelId);
  sessionVisionMap.delete(levelId);
  if (currentSessionId) {
    writeFogToStorage(currentSessionId, levelId, null);
  }

  // L'étage retiré était affiché : la vue retombe sur un autre, le premier restant dans l'ordre.
  if (activeLevelId === levelId) {
    const restants = getLevelSummaries();
    activeLevelId = restants.length > 0 ? restants[0].id : null;
  }

  // Un pion sélectionné qui vivait sur l'étage retiré n'existe plus sur le plateau.
  const selTokenId = getSelectedTokenId();
  if (selTokenId && !candidate.tokens.some((t) => t.id === selTokenId)) {
    clearSelectionState();
  }

  notifySubscribers();
  return true;
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
  replaceCampaign(candidate);
  rafraichirZoneAtteignable(levelId);
  notifySubscribers();
}

/**
 * Remplace la carte d'un étage en une seule transaction atomique (UX-13).
 *
 * Déplace tous les pions de cet étage vers la réserve, vide la géométrie
 * (`walls`, `portals`, `lights`), applique le patch de carte et valide l'ensemble
 * sur un unique `structuredClone` avant adoption et notification unique.
 *
 * @param {string} levelId Identifiant de l'étage à remplacer
 * @param {Omit<Partial<Level>, 'grid'> & {grid?: Partial<import('../core/types.js').GridConfig>}} patch Propriétés de carte à appliquer
 * @returns {string[]} Liste des identifiants des pions déplacés en réserve
 */
export function replaceLevelMap(levelId, patch) {
  if (!campaign) {
    throw new Error('Aucune campagne chargée');
  }
  if (!levelId || typeof levelId !== 'string') {
    throw new Error("Identifiant d'étage requis");
  }
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new Error("Patch d'étage requis");
  }
  const idx = campaign.levels.findIndex((l) => l.id === levelId);
  if (idx === -1) {
    throw new Error(`Étage inconnu : "${levelId}"`);
  }
  if (patch.id !== undefined && patch.id !== levelId) {
    throw new Error(
      `Remplacement de l'étage "${levelId}" refusé : son identifiant ne peut pas être modifié`
    );
  }

  const candidate = structuredClone(campaign);
  if (!Array.isArray(candidate.reserve)) {
    candidate.reserve = [];
  }

  /** @type {string[]} */
  const reservedTokenIds = [];
  /** @type {import('../core/types.js').Token[]} */
  const remainingTokens = [];

  for (const token of candidate.tokens) {
    if (token.levelId === levelId) {
      candidate.reserve.push(token);
      reservedTokenIds.push(token.id);
    } else {
      remainingTokens.push(token);
    }
  }
  candidate.tokens = remainingTokens;

  const currentLevel = candidate.levels[idx];
  const gridUpdates = patch.grid || {};
  candidate.levels[idx] = {
    ...currentLevel,
    ...patch,
    walls: [],
    portals: [],
    lights: [],
    grid: {
      ...currentLevel.grid,
      ...gridUpdates,
    },
  };

  assertValidCampaign(candidate, `Remplacement de la carte de l'étage "${levelId}"`);
  replaceCampaign(candidate);

  const selectedId = getSelectedTokenId();
  if (selectedId && reservedTokenIds.includes(selectedId)) {
    clearSelectionState();
  } else {
    rafraichirZoneAtteignable(levelId);
  }

  notifySubscribers();
  return reservedTokenIds;
}

/**
 * Identité du réseau de cases d'un étage : ce qui, s'il change, fait désigner à un même `{a, b}`
 * un autre endroit de l'image (D-11). Ni les dimensions — elles ne font qu'ajouter ou retirer des
 * cases au bord — ni l'offset : un recalage laisse les pions sur leurs cases (`CONVENTIONS.md`
 * §1, tranché le 22/09/2026).
 *
 * @param {Level} level
 * @returns {string}
 */
function reseauDe(level) {
  return level.grid.type === 'hex' ? `hex:${level.grid.hexShiftX ?? 0}` : 'square';
}

/**
 * Rapport d'un changement de pavage (D-11), pour le panneau MJ.
 *
 * @typedef {Object} RegridReport
 * @property {string[]} reservedTokenIds Pions rangés en réserve, quelle qu'en soit la raison
 * @property {string[]} collidedTokenIds Ceux d'entre eux rangés parce que leur nouvelle case était
 *   déjà prise par un pion converti avant eux
 * @property {Array<{linkId: string, side: 'a'|'b', reason: 'collision'|'outside'}>} linkConflicts
 *   Extrémités d'escalier restées sur leurs anciennes coordonnées : nouvelle case déjà prise par une
 *   autre extrémité (`collision`), ou centre hors de la nouvelle grille (`outside`)
 */

/**
 * Change le pavage d'un étage et ses dimensions en cases, en une seule transaction (C-16,
 * complété par D-11).
 *
 * ⭐ Contrairement à `replaceLevelMap`, la carte reste. Quand le **réseau** change (`reseauDe`),
 * chaque pion, extrémité d'escalier et case de coût de terrain de l'étage passe sur la case de la
 * nouvelle grille qui contient le **centre** de son ancienne case : il reste au même endroit de
 * l'image, à une demi-case près. ⛔ Garder le même `{a, b}` (l'ancienne règle C-16) faisait remonter
 * un pion de la rangée 40 de plus de 5 cases à l'écran.
 *
 * - un pion sans case d'arrivée, ou qui déborde, part en réserve ; deux pions sur la même case
 *   (emprise comprise, C-6) → le second dans l'ordre du tableau part en réserve ;
 * - une extrémité d'escalier sans case d'arrivée, ou dont la case est déjà prise par une autre
 *   extrémité, **reste** où elle est et le conflit est rendu pour le MJ — rien n'est inventé à sa
 *   place. Deux extrémités qui partageaient déjà une case la partagent encore : ce n'est pas un
 *   conflit créé par la conversion ;
 * - deux cases de terrain sur la même case → le coût le plus élevé ; sans case d'arrivée →
 *   abandonnée.
 *
 * La conversion est **déterministe** et ne lit que l'état local : le MJ l'applique au changement
 * de pavage, la tablette à la réception de `level.grid`, avec cette même fonction et donc le même
 * résultat — si bien que les `token.reserve` qui suivent trouvent leur pion déjà rangé et ne font
 * rien. Sans ce rangement local, la tablette refuserait la hauteur réduite tant qu'un pion de la
 * dernière rangée n'aurait pas encore été rangé par son `token.reserve`.
 *
 * Rejeu inoffensif : le réseau étant déjà le bon, rien n'est converti, et les mêmes dimensions ne
 * rangent plus rien. Un `level.grid` de couleur ou d'opacité ne déplace rien non plus.
 *
 * @param {string} levelId
 * @param {{grid: Partial<import('../core/types.js').GridConfig>, widthCells?: number, heightCells?: number}} patch
 * @returns {RegridReport}
 */
export function regridLevel(levelId, patch) {
  if (!campaign) {
    throw new Error('Aucune campagne chargée');
  }
  const idx = campaign.levels.findIndex((l) => l.id === levelId);
  if (idx === -1) {
    throw new Error(`Étage inconnu : "${levelId}"`);
  }

  const candidate = structuredClone(campaign);
  if (!Array.isArray(candidate.reserve)) {
    candidate.reserve = [];
  }
  const currentLevel = candidate.levels[idx];
  /** @type {Level} */
  const level = {
    ...currentLevel,
    widthCells: patch.widthCells ?? currentLevel.widthCells,
    heightCells: patch.heightCells ?? currentLevel.heightCells,
    grid: { ...currentLevel.grid, ...patch.grid },
  };
  candidate.levels[idx] = level;

  const ancienneGrille = gridFor(currentLevel);
  const nouvelleGrille = gridFor(level);
  const reseauChange = reseauDe(currentLevel) !== reseauDe(level);
  /**
   * La case de la nouvelle grille qui contient le centre de l'ancienne ; l'identité quand le
   * réseau ne change pas (seuls les bords bougent), `null` hors de la nouvelle grille.
   * @param {Cell} cell
   * @returns {Cell|null}
   */
  const convertir = (cell) =>
    reseauChange ? nouvelleGrille.cellFromPoint(ancienneGrille.cellCenter(cell)) : cell;

  /** @type {string[]} */
  const reservedTokenIds = [];
  /** @type {string[]} */
  const collidedTokenIds = [];
  /** @type {import('../core/types.js').Token[]} */
  const remainingTokens = [];
  /** @type {import('../core/types.js').Token[]} Pions déjà posés sur l'étage converti */
  const poses = [];
  for (const token of candidate.tokens) {
    if (token.levelId !== levelId) {
      remainingTokens.push(token);
      continue;
    }
    const cell = convertir(token.cell);
    // Même règle de bornes que `validateCampaign` : en hexagonal, seul l'ancrage compte (D-8).
    const horsCarte =
      !cell ||
      (level.grid.type === 'hex'
        ? cell.a >= level.widthCells || cell.b >= level.heightCells
        : cell.a + token.sizeCells > level.widthCells || cell.b + token.sizeCells > level.heightCells);
    const collision =
      !horsCarte && cell && findStackingConflict(poses, level, levelId, cell, token.sizeCells || 1, null);
    if (horsCarte || collision || !cell) {
      // Le pion rangé garde son ancienne case : la réserve n'en lit aucune.
      candidate.reserve.push(token);
      reservedTokenIds.push(token.id);
      if (collision) collidedTokenIds.push(token.id);
      continue;
    }
    if (reseauChange) {
      token.cell = { a: cell.a, b: cell.b };
      // ⛔ Le dernier `move` reste sur le pion après l'animation, et le rendu le lit : son `to`,
      // exprimé dans l'ancien réseau, redessinerait le pion à l'ancien numéro de case.
      delete token.move;
    }
    poses.push(token);
    remainingTokens.push(token);
  }
  candidate.tokens = remainingTokens;

  /** @type {RegridReport['linkConflicts']} */
  const linkConflicts = [];
  if (reseauChange && Array.isArray(candidate.links)) {
    /** @type {Map<string, string>} nouvelle case → ancienne case de l'extrémité qui l'occupe */
    const prises = new Map();
    for (const lien of candidate.links) {
      for (const side of /** @type {const} */ (['a', 'b'])) {
        const extremite = lien[side];
        if (extremite.levelId !== levelId) continue;
        const ancienne = { a: extremite.at.cellX, b: extremite.at.cellY };
        const cell = convertir(ancienne);
        if (!cell) {
          linkConflicts.push({ linkId: lien.id, side, reason: 'outside' });
          continue;
        }
        const occupant = prises.get(cellKey(cell));
        if (occupant !== undefined && occupant !== cellKey(ancienne)) {
          linkConflicts.push({ linkId: lien.id, side, reason: 'collision' });
          continue;
        }
        prises.set(cellKey(cell), cellKey(ancienne));
        extremite.at = { cellX: cell.a, cellY: cell.b };
      }
    }
  }

  if (reseauChange && level.terrainCost) {
    /** @type {Record<string, number>} */
    const couts = {};
    for (const [cle, cout] of Object.entries(level.terrainCost)) {
      const cell = convertir(parseCellKey(cle));
      if (!cell) continue;
      const nouvelle = cellKey(cell);
      couts[nouvelle] = nouvelle in couts ? Math.max(couts[nouvelle], cout) : cout;
    }
    // `null` est l'idiome d'absence du champ (`createLevel`) : un étage vidé de ses coûts y revient.
    level.terrainCost = Object.keys(couts).length > 0 ? couts : null;
  }

  assertValidCampaign(candidate, `Changement de pavage de l'étage "${levelId}"`);
  replaceCampaign(candidate);

  const selectedId = getSelectedTokenId();
  if (selectedId && reservedTokenIds.includes(selectedId)) {
    clearSelectionState();
  } else {
    rafraichirZoneAtteignable(levelId);
  }

  notifySubscribers();
  return { reservedTokenIds, collidedTokenIds, linkConflicts };
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
  replaceCampaign(candidate);

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
 * Bascule l'état allumé/éteint d'une lampe — patron de `setPortalState`, porté par
 * `light.toggle` (amendement C-2). État **absolu**, jamais « inverse-le » : c'est le seul
 * écrivain de `Light.on`, ni `placeLight` ni `moveLight` n'y touchent.
 *
 * @param {string} levelId
 * @param {string} lightId
 * @param {boolean} on
 * @returns {void}
 */
export function setLightState(levelId, lightId, on) {
  if (typeof on !== 'boolean') {
    throw new Error(`État de lampe invalide : "${on}"`);
  }
  if (!campaign) {
    throw new Error('Aucune campagne chargée');
  }

  const candidate = structuredClone(campaign);
  const level = candidate.levels.find((l) => l.id === levelId);
  if (!level) {
    throw new Error(`Étage inconnu : "${levelId}"`);
  }
  const light = (level.lights || []).find((li) => li.id === lightId);
  if (!light) {
    throw new Error(`Lampe inconnue : "${lightId}" sur l'étage "${levelId}"`);
  }

  light.on = on;

  assertValidCampaign(candidate, `Bascule de la lampe "${lightId}"`);
  replaceCampaign(candidate);
  notifySubscribers();
}

/**
 * Pose une lampe ou remplace la géométrie d'une lampe existante — idempotent par identifiant,
 * patron de `placeTemplate`, porté par `light.place` (amendement C-2).
 *
 * ⛔ **Ne touche JAMAIS `on`** : sur une lampe qui existe déjà, l'état allumé/éteint courant est
 * CONSERVÉ, quelle que soit la valeur portée par `lightData.on`. C'est la règle « un champ, un
 * écrivain » de l'amendement — `light.toggle` est seul à écrire ce champ.
 *
 * @param {string} levelId
 * @param {import('../core/types.js').Light} lightData
 * @returns {void}
 */
export function placeLight(levelId, lightData) {
  if (!campaign) {
    throw new Error('Aucune campagne chargée');
  }
  if (!lightData || typeof lightData !== 'object' || typeof lightData.id !== 'string' || lightData.id.trim() === '') {
    throw new Error('Données de lampe requises');
  }

  const candidate = structuredClone(campaign);
  const level = candidate.levels.find((l) => l.id === levelId);
  if (!level) {
    throw new Error(`Étage inconnu : "${levelId}"`);
  }
  if (!Array.isArray(level.lights)) {
    level.lights = [];
  }

  const idx = level.lights.findIndex((li) => li.id === lightData.id);
  if (idx >= 0) {
    const currentOn = level.lights[idx].on;
    level.lights[idx] = { ...structuredClone(lightData), on: currentOn };
  } else {
    level.lights.push(structuredClone(lightData));
  }

  assertValidCampaign(candidate, `Placement de la lampe "${lightData.id}"`);
  replaceCampaign(candidate);
  notifySubscribers();
}

/**
 * Déplace une lampe existante, porté par `light.move` (amendement C-2). Émis par le **glisser**
 * du MJ depuis la tranche 3 (11/09/2026) : le geste n'écrit ici qu'au relâcher, jamais pendant le
 * glisser — `moveLight` recompose la vision, et republier de la vision à chaque `move` est
 * exactement ce que la règle du glisser MJ interdit. Ce réducteur a existé une tranche avant son
 * geste, pour que le contrat réseau du §7 soit complet d'abord.
 *
 * Même règle que `placeLight` : ne touche pas `on`.
 *
 * @param {string} levelId
 * @param {string} lightId
 * @param {CellPoint} at
 * @returns {void}
 */
export function moveLight(levelId, lightId, at) {
  if (!campaign) {
    throw new Error('Aucune campagne chargée');
  }
  if (!at || !Number.isFinite(at.cellX) || !Number.isFinite(at.cellY)) {
    throw new Error('Position de lampe invalide');
  }

  const candidate = structuredClone(campaign);
  const level = candidate.levels.find((l) => l.id === levelId);
  if (!level) {
    throw new Error(`Étage inconnu : "${levelId}"`);
  }
  const light = (level.lights || []).find((li) => li.id === lightId);
  if (!light) {
    throw new Error(`Lampe inconnue : "${lightId}" sur l'étage "${levelId}"`);
  }

  light.at = { cellX: at.cellX, cellY: at.cellY };

  assertValidCampaign(candidate, `Déplacement de la lampe "${lightId}"`);
  replaceCampaign(candidate);
  notifySubscribers();
}

/**
 * Retire une lampe d'un étage, porté par `light.delete` (amendement C-2). Idempotent : une
 * lampe déjà absente rend `false` sans lever — patron de `removeTemplate`.
 *
 * @param {string} levelId
 * @param {string} lightId
 * @returns {boolean} true si une lampe a été retirée
 */
export function removeLight(levelId, lightId) {
  if (!campaign) {
    throw new Error('Aucune campagne chargée');
  }
  if (!lightId || typeof lightId !== 'string') return false;

  const candidate = structuredClone(campaign);
  const level = candidate.levels.find((l) => l.id === levelId);
  if (!level || !Array.isArray(level.lights)) return false;

  const idx = level.lights.findIndex((li) => li.id === lightId);
  if (idx === -1) return false;

  level.lights.splice(idx, 1);

  assertValidCampaign(candidate, `Retrait de la lampe "${lightId}" sur l'étage "${levelId}"`);
  replaceCampaign(candidate);
  notifySubscribers();
  return true;
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
  replaceCampaign(candidate);

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
  replaceCampaign(candidate);

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
 * - `mounted` — un seul écrivain, `token.mounted` → `setTokenMounted` (chantier C-9, règle « un
 *   champ, un écrivain » de l'amendement C-2).
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
  'emitsLight',
  'elevation',
  'markers',
  'hp',
  'health',
  // C-15 : le premier exemplaire reçoit son numéro quand on pose le deuxième, par `token.update`.
  'copyNumber',
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

  // Une case, un pion (C-6) : `sizeCells` est dans `ALLOWED_TOKEN_PATCH_KEYS`, donc faire grossir
  // un pion de 1×1 en 2×2 peut le faire recouvrir un voisin — c'est le seul champ de ce patch qui
  // change l'emprise sans passer par `moveTokenToCell`, et c'est pour ça qu'il faut le contrôler
  // ici plutôt que de compter sur les quatre autres chemins.
  if ('sizeCells' in patch) {
    const token = campaign.tokens[index];
    const level = campaign.levels.find((l) => l.id === token.levelId);
    if (level) {
      const conflict = findStackingConflict(
        campaign.tokens,
        level,
        token.levelId,
        token.cell,
        patch.sizeCells || 1,
        tokenId
      );
      if (conflict) {
        throw new Error(
          `Mise à jour du pion "${tokenId}" refusée : la nouvelle taille recouvrirait "${conflict.id}"`
        );
      }
    }
  }

  const candidate = structuredClone(campaign);
  candidate.tokens[index] = {
    ...candidate.tokens[index],
    ...patch,
  };

  assertValidCampaign(candidate, `Mise à jour du pion "${tokenId}"`);
  replaceCampaign(candidate);
  // `speedCells` et `sizeCells` sont dans ce patch : la zone atteignable en dépend (A4).
  rafraichirZoneAtteignable();
  notifySubscribers();
}

/**
 * Met un pion à cheval ou le fait descendre — patron de `setLightState`, porté par
 * `token.mounted` (chantier C-9). État **absolu**, jamais « inverse-le » : c'est le seul écrivain
 * de `Token.mounted`, `updateToken` le refuse.
 *
 * @param {string} tokenId
 * @param {boolean} mounted
 * @returns {void}
 */
export function setTokenMounted(tokenId, mounted) {
  if (typeof mounted !== 'boolean') {
    throw new Error(`État de monture invalide : "${mounted}"`);
  }
  if (!campaign) {
    throw new Error('Aucune campagne chargée');
  }

  const candidate = structuredClone(campaign);
  const token = candidate.tokens.find((t) => t.id === tokenId);
  if (!token) {
    throw new Error(`Pion inconnu : "${tokenId}"`);
  }

  token.mounted = mounted;

  assertValidCampaign(candidate, `Monture du pion "${tokenId}"`);
  replaceCampaign(candidate);
  // Monté, le budget double et toute porte bloque : la zone atteignable en dépend (A4).
  rafraichirZoneAtteignable();
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
  replaceCampaign(candidate);

  if (getSelectedTokenId() === tokenId) {
    clearSelectionState();
  }

  notifySubscribers();
}

/**
 * Range un pion du plateau dans la réserve, avec tout son état (UX-14).
 *
 * ⭐ **Le pion n'est pas recréé, il est déplacé.** Ses PV, ses marqueurs, son élévation et son
 * nom voyagent avec lui : c'est ce qui distingue la réserve de la bibliothèque, qui ne tient que
 * des modèles. Un PNJ blessé rangé pendant un changement de décor doit revenir blessé.
 *
 * Absence idempotente et silencieuse, comme `removeTemplate` et `removeLink` : un pion déjà
 * rangé rend `false` sans lever ni notifier, ce qui rend l'événement réseau rejouable.
 *
 * @param {string} tokenId
 * @returns {boolean} true si un pion a été rangé
 */
export function reserveToken(tokenId) {
  if (!campaign) {
    throw new Error('Aucune campagne chargée');
  }
  if (!tokenId || typeof tokenId !== 'string') {
    throw new Error('Identifiant de pion requis');
  }

  const index = campaign.tokens.findIndex((t) => t.id === tokenId);
  if (index < 0) return false;

  const candidate = structuredClone(campaign);
  if (!Array.isArray(candidate.reserve)) candidate.reserve = [];
  const [pion] = candidate.tokens.splice(index, 1);
  candidate.reserve.push(pion);

  assertValidCampaign(candidate, `Mise en réserve du pion "${tokenId}"`);
  replaceCampaign(candidate);

  // Un pion rangé ne peut pas rester sélectionné : la barre de vitalité et la zone de
  // déplacement désigneraient un pion qui n'est plus sur aucune carte.
  if (getSelectedTokenId() === tokenId) {
    clearSelectionState();
  }

  notifySubscribers();
  return true;
}

/**
 * Ressort un pion de la réserve et le pose sur une case (UX-14).
 *
 * ⭐ **UX-08 est la moitié visible de ce geste** : sortir un pion de la réserve, c'est le poser
 * quelque part. Les deux ne font qu'un, et c'est pourquoi le panneau réutilise le même armement.
 *
 * @param {string} tokenId
 * @param {string} levelId
 * @param {import('../core/types.js').Cell} cell
 * @returns {boolean} true si un pion a été posé
 */
export function placeTokenFromReserve(tokenId, levelId, cell) {
  if (!campaign) {
    throw new Error('Aucune campagne chargée');
  }
  if (!tokenId || typeof tokenId !== 'string') {
    throw new Error('Identifiant de pion requis');
  }
  if (!cell || !Number.isInteger(cell.a) || !Number.isInteger(cell.b)) {
    throw new Error('Case valide requise');
  }

  const index = (campaign.reserve ?? []).findIndex((t) => t.id === tokenId);
  if (index < 0) return false;

  const pionEnReserve = /** @type {Token} */ ((campaign.reserve ?? [])[index]);

  // Une case, un pion (C-6) : le pion reste en réserve si sa destination est déjà occupée, comme
  // une case hors carte — même transaction, même idiome.
  const level = campaign.levels.find((l) => l.id === levelId);
  if (level) {
    const conflict = findStackingConflict(
      campaign.tokens,
      level,
      levelId,
      cell,
      pionEnReserve.sizeCells || 1,
      null
    );
    if (conflict) {
      throw new Error(
        `Pose du pion "${tokenId}" depuis la réserve refusée : case occupée par "${conflict.id}"`
      );
    }
  }

  const candidate = structuredClone(campaign);
  const [pion] = (candidate.reserve ?? []).splice(index, 1);
  candidate.tokens.push({ ...pion, levelId, cell: { a: cell.a, b: cell.b } });

  // ⚠ La validation est celle du plateau, bornes comprises : c'est ici que se refuse une case
  // hors carte, et le pion **reste en réserve** si elle échoue, puisque la campagne candidate
  // est jetée. Sans cette transaction, un pion pourrait disparaître des deux collections.
  assertValidCampaign(candidate, `Pose du pion "${tokenId}" depuis la réserve`);
  replaceCampaign(candidate);
  notifySubscribers();
  return true;
}

/**
 * Les pions actuellement en réserve, dans leur ordre de rangement.
 *
 * @returns {import('../core/types.js').Token[]}
 */
export function getReserve() {
  return campaign?.reserve ?? [];
}

/**
 * Pose ou met à jour un gabarit sur la campagne.
 *
 * @param {import('../core/types.js').Template} templateData
 * @returns {void}
 */
export function placeTemplate(templateData) {
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
  replaceCampaign(candidate);
  notifySubscribers();
}

/**
 * Déplace ou pivote un gabarit existant.
 *
 * @param {string} templateId Identifiant du gabarit
 * @param {import('../core/types.js').MapPoint} origin Nouvelle origine (pixels carte)
 * @param {number} [directionDeg] Nouvelle direction en degrés
 * @returns {void}
 */
export function moveTemplate(templateId, origin, directionDeg) {
  if (!campaign) {
    throw new Error('Aucune campagne chargée');
  }
  if (!templateId || typeof templateId !== 'string') {
    throw new Error('Identifiant de gabarit requis');
  }
  if (!origin || typeof origin.x !== 'number' || typeof origin.y !== 'number') {
    throw new Error('Origine valide requise');
  }

  const candidate = structuredClone(campaign);
  const t = (candidate.templates || []).find((tpl) => tpl.id === templateId);
  if (!t) {
    throw new Error(`Gabarit inconnu : "${templateId}"`);
  }

  t.origin = { x: origin.x, y: origin.y };
  if (typeof directionDeg === 'number' && Number.isFinite(directionDeg)) {
    t.directionDeg = directionDeg;
  }

  assertValidCampaign(candidate, `Déplacement du gabarit "${templateId}"`);
  replaceCampaign(candidate);
  notifySubscribers();
}

/**
 * Retire un gabarit et lui seul.
 *
 * Sur le modèle de `removeLink` : l'absence est **idempotente et silencieuse** — elle rend
 * `false` sans lever ni notifier. C'est ce qui rend l'événement `template.remove` rejouable
 * sans précaution du côté de l'appelant (`CONVENTIONS.md` §4).
 *
 * ⛔ Ne pas confondre avec `clearTemplates`, qui efface tout l'étage. Le seul retrait possible
 * était celui-là, et retirer le cône d'un sort résolu effaçait aussi la zone de ténèbres posée
 * deux tours plus tôt.
 *
 * @param {string} templateId
 * @returns {boolean} true si un gabarit a été retiré
 */
export function removeTemplate(templateId) {
  if (!campaign) {
    throw new Error('Aucune campagne chargée');
  }
  if (!templateId || typeof templateId !== 'string') {
    throw new Error('Identifiant de gabarit requis');
  }

  const index = (campaign.templates || []).findIndex((t) => t.id === templateId);
  if (index < 0) return false;

  const candidate = structuredClone(campaign);
  candidate.templates.splice(index, 1);
  assertValidCampaign(candidate, `Retrait du gabarit "${templateId}"`);
  replaceCampaign(candidate);
  notifySubscribers();
  return true;
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
  candidate.templates = (candidate.templates || []).filter((t) => t.levelId !== levelId);

  assertValidCampaign(candidate, `Effacement des gabarits de l'étage "${levelId}"`);
  replaceCampaign(candidate);
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
  sessionFogMap.clear();
  sessionVisionMap.clear();
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
 * Instantané stable pour une image de rendu.
 *
 * Contrairement à `getState()`, cet accès ne clone pas la campagne ni l'étage actif. Les
 * références sont structurellement partagées avec le store, mais elles sont gelées dès leur
 * insertion dans celui-ci ; un renderer ne peut donc ni les modifier, ni contaminer une
 * image suivante. L'objet est mis en cache jusqu'à la prochaine notification de mutation.
 *
 * Cet accès est volontairement réservé au chemin de rendu. `getState()` et les accesseurs
 * historiques restent des copies indépendantes pour préserver leurs contrats publics.
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
export function getRenderSnapshot() {
  if (renderSnapshot) return renderSnapshot;

  const activeLevel =
    campaign && activeLevelId
      ? campaign.levels.find((level) => level.id === activeLevelId) || null
      : null;
  const selectedTokenId = getSelectedTokenId();
  const selectedToken =
    campaign && selectedTokenId
      ? campaign.tokens.find((token) => token.id === selectedTokenId) || null
      : null;

  renderSnapshot = Object.freeze({
    campaign,
    activeLevelId,
    activeLevel,
    selectedTokenId,
    selectedToken,
    reachableCells: createReadonlyMap(getReachableCells()),
  });
  return renderSnapshot;
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
  notifySubscribers({ session: true });
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
  notifySubscribers({ session: true });
}

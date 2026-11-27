// @ts-check
/**
 * Liaison outil MJ Warhammer, côté carte (docs/CONTRAT-LIAISON-OUTIL-MJ.md §2-§7).
 *
 * Partie pure : traduit un message de l'outil MJ en **opérations** sur la campagne, sans rien
 * exécuter. L'exécution (store, puis `transport.publish` vers la tablette) et le canal
 * BroadcastChannel viennent par-dessus ; les garder séparés laisse tester la traduction sans
 * navigateur ni Firebase.
 *
 * Un pion lié se retrouve par `link.ref`, sur le plateau comme en réserve. Un `ref` PNJ inconnu
 * crée un pion **en réserve** (contrat §7 : le MJ le pose) ; un `ref` PJ inconnu ne crée rien, il
 * attend la liaison durable faite par le MJ (contrat §3).
 */
import { isLinkedToken, isTokenLibraryPath } from '../core/schema.js';
import { movementRulesFor } from '../state/selection.js';
import { ranStartIndex } from '../state/movePlan.js';
import { movementStepCost } from '../movement/reachable.js';
import { parseFx } from '../render/layers/fx.js';
import { distanceBetweenFootprints, footprintsAdjacent } from '../grid/index.js';
import { LIAISON_CARTE } from '../core/donnees-communes.js';

/** @typedef {import('../core/types.js').Token} Token */
/** @typedef {import('../core/types.js').Campaign} Campaign */
/** @typedef {import('../core/types.js').LinkedPlace} LinkedPlace */
/** @typedef {import('../core/types.js').Cell} Cell */
/**
 * Issue d'une attaque, arbitrée par l'outil MJ (contrat §9.3) : cinq issues, et non trois ;
 * `fumble` n'en est pas une, il se lit comme un `miss` côté outil MJ.
 * @typedef {'hit'|'miss'|'critical'|'parried'|'dodged'} AttackOutcome
 */

/**
 * État d'un pion lié tel que l'outil MJ l'envoie (contrat §4).
 * @typedef {Object} MjTokenState
 * @property {string} ref
 * @property {string} label
 * @property {'pj'|'allie'|'ennemi'|'neutre'} camp
 * @property {'pc'|'npc'} kind
 * @property {boolean} visionSource
 * @property {string|null} imageUrl `data:` ≤ 24 Kio, chemin relatif sous `maps/tokens/`, ou `null` (ne pas toucher)
 * @property {string|null} [formImageUrl] Image de Forme bestiale : chemin sous `maps/tokens/`, `null` l'efface, clé absente = inchangé (contrat §4, §6)
 * @property {string|null} [color] PJ seulement : couleur propre, `#rrggbb` (contrat §4, lot P2)
 * @property {number} sizeCells
 * @property {number|null} speedCells
 * @property {number|null} runCells
 * @property {number} [bondCells] Portée de Bond en cases (2 × runCells) ; absent ou invalide = pas de Bond
 * @property {number} visionDim
 * @property {{ current: number, max: number }} hp
 * @property {'unharmed'|'wounded'|'critical'} health
 * @property {string[]} markers
 * @property {Record<string, number>} markerLevels
 * @property {boolean} dead
 * @property {string|null} [deathCause]
 * @property {boolean} [mounted]
 * @property {import('../core/types.js').RiderOverlay|null} [rider] monture fusionnée (contrat §8.1)
 */

/**
 * `place` d'un `reserveAdd` : la case retenue du même `ref` (mémoire des cases, contrat §7), où le
 * poser ; celui d'un `remove` : la case à retenir, pour un pion qui quitte le plateau.
 * @typedef {{ op: 'reserveAdd', ref: string, token: Record<string, any>, place?: LinkedPlace }
 *   | { op: 'update', tokenId: string, patch: Record<string, any> }
 *   | { op: 'mounted', tokenId: string, mounted: boolean }
 *   | { op: 'remove', tokenId: string, where: 'board'|'reserve', place?: LinkedPlace }
 *   | { op: 'awaitBinding', ref: string, label: string }
 *   | { op: 'fx', tokenId: string, hidden: boolean, fx: NonNullable<ReturnType<typeof parseFx>> }
 *   | { op: 'attack', from: Cell, to: Cell, levelId: string, outcome: AttackOutcome, hidden: boolean, damage?: number }
 *   | { op: 'merge', riderTokenId: string, mountTokenId: string }
 *   | { op: 'split', riderTokenId: string, mountTokenId: string }
 *   | { op: 'impactQuery', query: ImpactQuery }
 *   | { op: 'impactCancel', queryId: string|number }} MjLinkOperation
 */

/**
 * Demande de point d'impact d'un sort de zone (`mj.impactQuery`, contrat §10.1, version 3).
 * `casterLevelId` : étage du lanceur s'il est posé, sinon `null` (l'écran MJ prend l'étage affiché).
 * @typedef {{ queryId: string|number, label: string, radiusCells: number, casterRef: string|null, casterLevelId: string|null }} ImpactQuery
 */

/**
 * Demande de point d'impact en cours, l'étage résolu.
 * @typedef {{ queryId: string|number, label: string, radiusCells: number, levelId: string }} PendingImpact
 */

/** Longueur maximale du `label` d'un `mj.impactQuery` (contrat §10.1). */
export const IMPACT_LABEL_MAX = 40;

/** Champs que l'outil MJ écrit sur un pion lié (contrat §1). */
const OWNED_KEYS = /** @type {const} */ ([
  'label', 'kind', 'camp', 'visionSource', 'sizeCells', 'speedCells', 'runCells', 'visionDim',
  'hp', 'health', 'markers', 'markerLevels', 'dead', 'deathCause', 'imageUrl',
]);

/**
 * Patch des champs détenus par l'outil MJ. Une valeur absente ou nulle ne touche pas le pion :
 * `imageUrl: null` laisse l'image d'un PJ, `speedCells: null` (Mouvement inconnu) garde la portée
 * saisie sur la carte.
 *
 * @param {MjTokenState} state
 * @returns {Record<string, any>}
 */
export function patchFromState(state) {
  /** @type {Record<string, any>} */
  const patch = {};
  for (const key of OWNED_KEYS) {
    const value = /** @type {any} */ (state)[key];
    if (value !== null && value !== undefined) patch[key] = value;
  }
  // La monture fusionnée (contrat §8.1) : `null` y a un sens, la fusion est défaite.
  // Bond (contrat §4) : champ facultatif, entier >= 0 ; absent ou invalide = pas de Bond (cavalier descendu) :
  // `null` retire le champ du pion (le store l'efface), comme `deathCause: null`.
  patch.bondCells = Number.isInteger(state.bondCells) && /** @type {number} */ (state.bondCells) >= 0 ? state.bondCells : null;
  if (state.rider !== undefined) patch.rider = state.rider;
  // La couleur d'un PJ (contrat §4) : `null` aussi, le MJ l'a retirée du profil.
  if (state.color !== undefined) patch.color = state.color;
  // Image de forme (contrat §4, §6) : `null` y a un sens (la forme est quittée), une clé absente non (outil
  // plus ancien). Une valeur invalide est ignorée, le pion ne change pas. `imageUrl` n'est jamais touché.
  if (state.formImageUrl === null || isTokenLibraryPath(state.formImageUrl)) patch.formImageUrl = state.formImageUrl;
  // MAP-06 (08/11) : `deathCause: null` aussi — un pion relevé ne garde pas l'ancienne cause.
  // Le store retire le champ (`updateToken`), le schéma ne connaissant pas de cause nulle.
  if (state.deathCause === null) patch.deathCause = null;
  return patch;
}

/**
 * Pion lié d'un `ref`, sur le plateau ou en réserve.
 *
 * @param {Campaign} campaign
 * @param {string} ref
 * @returns {{ token: Token, where: 'board'|'reserve' }|null}
 */
export function findLinkedToken(campaign, ref) {
  const board = campaign.tokens.find((t) => isLinkedToken(t) && t.link?.ref === ref);
  if (board) return { token: board, where: 'board' };
  const reserved = (campaign.reserve || []).find((t) => isLinkedToken(t) && t.link?.ref === ref);
  return reserved ? { token: reserved, where: 'reserve' } : null;
}

/**
 * Ne garde du patch que ce qui change, pour ne rien republier pour rien.
 *
 * @param {Token} token
 * @param {Record<string, any>} patch
 * @returns {Record<string, any>}
 */
function changedOnly(token, patch) {
  return Object.fromEntries(
    Object.entries(patch).filter(([key, value]) => JSON.stringify(/** @type {any} */ (token)[key] ?? (key === 'rider' || key === 'color' || key === 'deathCause' || key === 'formImageUrl' || key === 'bondCells' ? null : undefined)) !== JSON.stringify(value))
  );
}

/**
 * Retrait d'un pion lié non PJ (contrat §7). Un pion du plateau retient sa place (étage, case, caché
 * ou non) pour que `token.add` du même `ref` la lui rende ; un pion de la réserve n'est nulle part,
 * il ne retient rien.
 *
 * @param {Token} token
 * @param {'board'|'reserve'} where
 * @returns {MjLinkOperation}
 */
function removeOperation(token, where) {
  const ref = token.link?.ref;
  if (where !== 'board' || !ref) return { op: 'remove', tokenId: token.id, where };
  return { op: 'remove', tokenId: token.id, where, place: { ref, levelId: token.levelId, cell: { a: token.cell.a, b: token.cell.b }, hidden: token.hidden === true } };
}

/**
 * Opérations d'un état de pion (`token.add`, `token.state`, ou ligne d'un instantané).
 *
 * @param {Campaign} campaign
 * @param {MjTokenState} state
 * @returns {MjLinkOperation[]}
 */
export function planTokenState(campaign, state) {
  const found = findLinkedToken(campaign, state.ref);
  if (!found) {
    if (state.ref.startsWith('pj:')) return [{ op: 'awaitBinding', ref: state.ref, label: state.label }];
    // `deathCause: null` n'a de sens que sur un pion existant (MAP-06) : un pion neuf n'a pas de cause.
    const { rider, deathCause, formImageUrl, bondCells, ...fields } = patchFromState(state);
    if (bondCells !== null) fields.bondCells = bondCells;
    if (deathCause) fields.deathCause = deathCause;
    if (formImageUrl) fields.formImageUrl = formImageUrl;
    // Mémoire des cases (contrat §7) : un `ref` retiré plus tôt revient là où il était, si la pose le permet.
    const place = (campaign.removedLinkedPlaces ?? []).find((p) => p.ref === state.ref);
    return [{ op: 'reserveAdd', ref: state.ref, token: { ...fields, ...(rider ? { rider } : {}), link: { source: 'outil-mj', ref: state.ref }, mounted: state.mounted === true }, ...(place ? { place } : {}) }];
  }
  /** @type {MjLinkOperation[]} */
  const ops = [];
  // Montures (contrat §8) : fusion quand le cavalier passe monté et que sa monture est sur le
  // plateau ; séparation quand il descend alors que sa monture attend hors plateau. Avant le patch,
  // qui donne au pion fusionné la taille de la monture une fois sur sa case.
  const mergeWith = state.mounted === true && state.rider?.ref ? findLinkedToken(campaign, state.rider.ref) : null;
  if (mergeWith?.where === 'board') ops.push({ op: 'merge', riderTokenId: found.token.id, mountTokenId: mergeWith.token.id });
  const splitFrom = state.mounted === false ? planSplit(campaign, found, found.token.rider?.ref) : null;
  if (splitFrom) ops.push(splitFrom);
  const patch = changedOnly(found.token, patchFromState(state));
  if (Object.keys(patch).length) ops.push({ op: 'update', tokenId: found.token.id, patch });
  if (typeof state.mounted === 'boolean' && state.mounted !== (found.token.mounted === true)) {
    ops.push({ op: 'mounted', tokenId: found.token.id, mounted: state.mounted });
  }
  return ops;
}

/**
 * Séparation d'un pion fusionné (contrat §8.2) : seulement si le cavalier est monté sur le plateau
 * et sa monture hors plateau. Sinon rien, ce qui rend `mount.split` et le `token.state` qui le
 * suit rejouables dans n'importe quel ordre.
 *
 * @param {Campaign} campaign
 * @param {{ token: Token, where: 'board'|'reserve' }|null} rider
 * @param {string|null|undefined} mountRef
 * @returns {MjLinkOperation|null}
 */
function planSplit(campaign, rider, mountRef) {
  if (!rider || rider.where !== 'board' || rider.token.mounted !== true || typeof mountRef !== 'string') return null;
  const mount = findLinkedToken(campaign, mountRef);
  return mount?.where === 'reserve' ? { op: 'split', riderTokenId: rider.token.id, mountTokenId: mount.token.id } : null;
}

/**
 * Réponse à `mount.request { riderRef, mountRef }` (contrat §8.2) : refus `not-adjacent` quand les
 * deux pions sont posés sans se toucher, accord sinon. Un pion absent du plateau ne se vérifie pas.
 *
 * @param {Campaign} campaign
 * @param {any} payload
 * @returns {{ type: 'mount.accepted'|'mount.refused', payload: { riderRef: string, mountRef: string, reason?: 'not-adjacent' } }|null}
 */
export function answerMountRequest(campaign, payload) {
  const riderRef = payload?.riderRef;
  const mountRef = payload?.mountRef;
  if (typeof riderRef !== 'string' || typeof mountRef !== 'string') return null;
  const rider = findLinkedToken(campaign, riderRef);
  const mount = findLinkedToken(campaign, mountRef);
  const accepted = { type: /** @type {const} */ ('mount.accepted'), payload: { riderRef, mountRef } };
  if (rider?.where !== 'board' || mount?.where !== 'board') return accepted;
  const level = campaign.levels.find((l) => l.id === mount.token.levelId);
  const adjacent = rider.token.levelId === mount.token.levelId && level !== undefined && footprintsAdjacent(level, rider.token, mount.token);
  return adjacent ? accepted : { type: 'mount.refused', payload: { riderRef, mountRef, reason: 'not-adjacent' } };
}

/**
 * Pions liés posés, `ref` → étage (contrat §10, `map.placed`). La réserve n'est pas posée.
 *
 * @param {Campaign} campaign
 * @returns {Map<string, string>}
 */
export function placedLinkedRefs(campaign) {
  /** @type {Map<string, string>} */
  const placed = new Map();
  for (const token of campaign.tokens) {
    if (isLinkedToken(token) && token.link) placed.set(token.link.ref, token.levelId);
  }
  return placed;
}

/**
 * Côté d'un camp de l'outil MJ : PJ et alliés d'un bord, ennemis de l'autre, neutres d'aucun.
 * @param {Token['camp']} camp @returns {'groupe'|'ennemis'|null}
 */
function campSide(camp) {
  if (camp === 'pj' || camp === 'allie') return 'groupe';
  return camp === 'ennemi' ? 'ennemis' : null;
}

/**
 * Paires de pions liés adjacents de camps opposés (contrat §10, `map.adjacency`) : emprises
 * comprises, 8 voisines en carré (§14, D4), même étage. Un mort ne s'engage plus. Paires et
 * membres triés, pour un message stable.
 *
 * @param {Campaign} campaign
 * @returns {[string, string][]}
 */
export function adjacencyPairs(campaign) {
  const linked = campaign.tokens.filter((t) => isLinkedToken(t) && t.link && t.dead !== true && campSide(t.camp) !== null);
  /** @type {[string, string][]} */
  const pairs = [];
  for (let i = 0; i < linked.length; i++) {
    for (let j = i + 1; j < linked.length; j++) {
      const first = linked[i];
      const second = linked[j];
      if (first.levelId !== second.levelId || campSide(first.camp) === campSide(second.camp)) continue;
      const level = campaign.levels.find((l) => l.id === first.levelId);
      if (!level || !footprintsAdjacent(level, first, second)) continue;
      const refs = /** @type {[string, string]} */ ([/** @type {any} */ (first.link).ref, /** @type {any} */ (second.link).ref].sort());
      pairs.push(refs);
    }
  }
  /** @param {string} x @param {string} y */
  const ordinal = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
  return pairs.sort((p, q) => ordinal(p[0], q[0]) || ordinal(p[1], q[1]));
}

/**
 * Réponse à `mj.distanceQuery { fromRef, toRef, queryId }` (contrat §10, §14 D4) : la plus courte
 * `grid.distance` entre une case de chaque emprise, en cases (diagonale 1,5 en carré). `cells`
 * vaut `null` quand un pion n'est pas posé ou que les deux sont sur des étages différents : la
 * carte ne sait pas répondre, mais elle répond, pour que l'outil MJ n'attende pas.
 *
 * @param {Campaign} campaign
 * @param {any} payload
 * @returns {{ queryId: string|number, cells: number|null }|null}
 */
export function answerDistanceQuery(campaign, payload) {
  const { fromRef, toRef, queryId } = payload ?? {};
  if (typeof fromRef !== 'string' || typeof toRef !== 'string' || (typeof queryId !== 'string' && typeof queryId !== 'number')) return null;
  /** @param {string} ref */
  const placed = (ref) => campaign.tokens.find((t) => isLinkedToken(t) && (t.link?.ref === ref || t.rider?.ref === ref)) ?? null;
  const from = placed(fromRef);
  const to = placed(toRef);
  const level = from ? campaign.levels.find((l) => l.id === from.levelId) : undefined;
  if (!from || !to || !level || from.levelId !== to.levelId) return { queryId, cells: null };
  return { queryId, cells: distanceBetweenFootprints(level, from, to) };
}

/** @param {unknown} queryId @returns {queryId is string|number} */
const isQueryId = (queryId) => typeof queryId === 'string' || (typeof queryId === 'number' && Number.isFinite(queryId));

/**
 * Lecture d'un `mj.impactQuery` (contrat §10.1) : `queryId` texte ou nombre, `radiusCells` nombre
 * ≥ 0, `label` borné à 40 caractères, `casterRef` ou `null`. L'étage du lanceur est celui de son
 * pion posé, monture fusionnée comprise (`rider.ref`), comme pour `answerDistanceQuery`.
 *
 * @param {Campaign} campaign
 * @param {any} payload
 * @returns {ImpactQuery|null}
 */
export function parseImpactQuery(campaign, payload) {
  const { queryId, label, radiusCells, casterRef } = payload ?? {};
  if (!isQueryId(queryId) || typeof radiusCells !== 'number' || !Number.isFinite(radiusCells) || radiusCells < 0) return null;
  const ref = typeof casterRef === 'string' && casterRef ? casterRef : null;
  const caster = ref ? campaign.tokens.find((t) => isLinkedToken(t) && (t.link?.ref === ref || t.rider?.ref === ref)) : null;
  return {
    queryId,
    label: (typeof label === 'string' ? label : '').slice(0, IMPACT_LABEL_MAX),
    radiusCells,
    casterRef: ref,
    casterLevelId: caster ? caster.levelId : null,
  };
}

/**
 * `refs` d'un point d'impact (contrat §10.1, `map.impact`) : les pions liés posés sur l'étage dont
 * l'emprise a au moins une case à une `grid.distance` ≤ `radiusCells` de la case visée — même
 * géométrie que `map.distance` (§14 D4 : octile en carré, hexagonale en hexagone). Cachés et morts
 * compris ; une monture fusionnée donne sa `ref` et `rider.ref`. Sans doublon, dans l'ordre du
 * plateau. Un pion non lié n'y est jamais.
 *
 * @param {Campaign} campaign
 * @param {string} levelId
 * @param {import('../core/types.js').Cell} cell
 * @param {number} radiusCells
 * @returns {string[]}
 */
export function impactRefs(campaign, levelId, cell, radiusCells) {
  const level = campaign.levels.find((l) => l.id === levelId);
  if (!level) return [];
  /** @type {Set<string>} */
  const refs = new Set();
  const target = { cell: { a: cell.a, b: cell.b }, sizeCells: 1 };
  for (const token of campaign.tokens) {
    if (!isLinkedToken(token) || !token.link || token.levelId !== levelId) continue;
    if (distanceBetweenFootprints(level, target, token) > radiusCells) continue;
    refs.add(token.link.ref);
    if (token.rider?.ref) refs.add(token.rider.ref);
  }
  return [...refs];
}

/**
 * Paires `mj.engagements` valides : deux `ref` textuels distincts.
 * @param {any} payload @returns {[string, string][]}
 */
export function parseEngagements(payload) {
  const pairs = Array.isArray(payload?.pairs) ? payload.pairs : [];
  return pairs
    .filter((/** @type {any} */ p) => Array.isArray(p) && p.length === 2 && typeof p[0] === 'string' && typeof p[1] === 'string' && p[0] !== p[1])
    .map((/** @type {[string, string]} */ p) => /** @type {[string, string]} */ ([p[0], p[1]]));
}

/** Issues reconnues d'une attaque (contrat §9.3), sensibles à la casse. */
const ATTACK_OUTCOMES = /** @type {const} */ (['hit', 'miss', 'critical', 'parried', 'dodged']);

/**
 * Opération d'une attaque (`fx.attack`, contrat §9.3) : les deux `ref` doivent désigner des pions
 * liés **posés** sur le plateau (une monture fusionnée répond par le pion du cavalier,
 * `rider.ref`), deux pions distincts sur le même étage. La carte ne republie que des **cases**,
 * jamais de `ref` ni de pixels : `from` et `to` sont les cases des deux pions. `damage` n'est repris
 * que s'il est un nombre fini strictement positif ; un chiffre aberrant est lâché sans refuser le
 * coup. Toute autre malformation ne produit rien.
 *
 * @param {Campaign} campaign
 * @param {any} payload
 * @returns {MjLinkOperation[]}
 */
function planAttack(campaign, payload) {
  if (!payload || typeof payload !== 'object') return [];
  const { attackerRef, targetRef, outcome, damage } = payload;
  if (!ATTACK_OUTCOMES.includes(outcome)) return [];
  if (typeof attackerRef !== 'string' || !attackerRef || typeof targetRef !== 'string' || !targetRef) return [];
  // Pions liés posés seulement : la réserve n'est pas sur le plateau (comme `fx.wound`).
  const attacker = campaign.tokens.find((t) => isLinkedToken(t) && (t.link?.ref === attackerRef || t.rider?.ref === attackerRef));
  const target = campaign.tokens.find((t) => isLinkedToken(t) && (t.link?.ref === targetRef || t.rider?.ref === targetRef));
  if (!attacker || !target || attacker.id === target.id || attacker.levelId !== target.levelId) return [];
  /** @type {Extract<MjLinkOperation, { op: 'attack' }>} */
  const op = {
    op: 'attack',
    from: { a: attacker.cell.a, b: attacker.cell.b },
    to: { a: target.cell.a, b: target.cell.b },
    levelId: attacker.levelId,
    outcome,
    hidden: attacker.hidden === true || target.hidden === true,
  };
  if (typeof damage === 'number' && Number.isFinite(damage) && damage > 0) op.damage = damage;
  return [op];
}

/**
 * Opérations d'un message de l'outil MJ. Un message inconnu, d'une autre version ou d'un autre
 * émetteur ne produit rien.
 *
 * @param {Campaign} campaign
 * @param {any} message
 * @param {number} version version du contrat attendue
 * @returns {MjLinkOperation[]}
 */
export function planMjMessage(campaign, message, version = MJ_LINK_VERSION) {
  if (!message || message.from !== 'outil-mj' || message.v !== version) return [];
  const payload = message.payload || {};
  switch (message.type) {
    case 'token.add':
    case 'token.state':
      return planTokenState(campaign, payload);
    case 'token.remove': {
      // Un PJ ne se retire jamais (contrat §7) ; l'outil MJ ne l'envoie pas, la carte le garantit aussi.
      if (typeof payload.ref !== 'string' || payload.ref.startsWith('pj:')) return [];
      const found = findLinkedToken(campaign, payload.ref);
      return found ? [removeOperation(found.token, found.where)] : [];
    }
    case 'fx.wound':
    case 'fx.death': {
      // Effet éphémère (contrat §9) : joué sur le pion posé, jamais rejoué ni persisté.
      const fx = parseFx(message.type === 'fx.wound' ? 'wound' : 'death', payload);
      // MAP-02 (08/11) : une monture fusionnée n'a plus de pion à elle, elle est le `rider` du pion
      // du cavalier — l'effet se joue sur lui, comme la distance (`answerDistanceQuery`).
      const token = typeof payload.ref === 'string'
        ? campaign.tokens.find((t) => isLinkedToken(t) && (t.link?.ref === payload.ref || t.rider?.ref === payload.ref))
        : null;
      return fx && token ? [{ op: 'fx', tokenId: token.id, hidden: token.hidden === true, fx }] : [];
    }
    case 'fx.attack':
      // Attaque (contrat §9.3) : effet éphémère, la carte résout les deux `ref` en cases avant de
      // republier vers la tablette, qui ne recevra jamais de `ref` de l'outil MJ.
      return planAttack(campaign, payload);
    case 'mount.split': {
      if (typeof payload.riderRef !== 'string') return [];
      const split = planSplit(campaign, findLinkedToken(campaign, payload.riderRef), payload.mountRef);
      return split ? [split] : [];
    }
    case 'mj.impactQuery': {
      const query = parseImpactQuery(campaign, payload);
      return query ? [{ op: 'impactQuery', query }] : [];
    }
    case 'mj.impactCancel':
      return isQueryId(payload.queryId) ? [{ op: 'impactCancel', queryId: payload.queryId }] : [];
    case 'mj.snapshot': {
      /** @type {MjTokenState[]} */
      const tokens = Array.isArray(payload.tokens) ? payload.tokens : [];
      const refs = new Set(tokens.map((t) => t.ref));
      const ops = tokens.flatMap((state) => planTokenState(campaign, state));
      // Rencontre close pendant que la carte était fermée : ses pions PNJ liés partent.
      for (const where of /** @type {const} */ (['board', 'reserve'])) {
        const list = where === 'board' ? campaign.tokens : campaign.reserve || [];
        for (const token of list) {
          const ref = token.link?.ref;
          if (isLinkedToken(token) && ref && !ref.startsWith('pj:') && !refs.has(ref)) ops.push(removeOperation(token, where));
        }
      }
      return ops;
    }
    default:
      return [];
  }
}

/**
 * Exécute les opérations de `planMjMessage` : store, puis republication vers la tablette des seuls
 * changements du plateau. La réserve reste locale au MJ (la tablette reçoit le pion à la pose).
 * Les dépendances sont injectées : `store` (fonctions du module `state/store.js`), `publish(type,
 * payload)` du transport, `createToken` du schéma, `newTokenId()`, et `trace` (`levelId` et `cell`
 * notés sur un pion créé en réserve, qui n'y sont pas une position). Rend les `ref` PJ en attente
 * de liaison, pour la liste du panneau MJ.
 *
 * Montures (contrat §8) : la fusion range la monture (`token.reserve`) puis amène le cavalier sur
 * sa case (`token.move`, ou `token.add` s'il attendait en réserve) ; la séparation range le
 * cavalier, repose la monture sur la case du pion fusionné et confie le cavalier à `onRiderToPlace`
 * pour la pose armée. Aucun événement réseau nouveau.
 *
 * @param {MjLinkOperation[]} ops
 * @param {{
 *   store: { addTokenToReserve: Function, updateToken: Function, updateReserveToken: Function,
 *            setTokenMounted: Function, removeToken: Function, removeFromReserve: Function,
 *            rememberLinkedPlace: (place: LinkedPlace) => void, forgetLinkedPlace: (ref: string) => boolean,
 *            reserveToken?: (tokenId: string) => boolean,
 *            placeTokenFromReserve?: (tokenId: string, levelId: string, cell: { a: number, b: number }, latest?: Token|null) => boolean,
 *            moveTokenToCell?: (tokenId: string, cell: { a: number, b: number }, moveData?: any) => void,
 *            getCampaign: () => Campaign|null },
 *   publish: (type: string, payload: any) => void,
 *   createToken: (overrides: any) => Token,
 *   playFx?: (fx: NonNullable<ReturnType<typeof parseFx>>, tokenId: string) => void,
 *   playAttack?: (op: Extract<MjLinkOperation, { op: 'attack' }>) => void,
 *   newTokenId: () => string,
 *   trace: { levelId: string, cell: { a: number, b: number } },
 *   onRiderToPlace?: (riderTokenId: string, around: { levelId: string, cell: { a: number, b: number }, sizeCells: number }) => void,
 *   onImpact?: (op: Extract<MjLinkOperation, { op: 'impactQuery'|'impactCancel' }>) => void,
 * }} deps
 * @returns {{ awaiting: { ref: string, label: string }[] }}
 */
export function executeMjOperations(ops, deps) {
  const { store, publish } = deps;
  /** @type {{ ref: string, label: string }[]} */
  const awaiting = [];
  /** @param {string} tokenId */
  const onBoard = (tokenId) => Boolean(store.getCampaign()?.tokens.some((t) => t.id === tokenId));
  for (const op of ops) {
    switch (op.op) {
      case 'reserveAdd': {
        const { link, mounted, ...fields } = op.token;
        const token = { ...deps.createToken({ ...fields, id: deps.newTokenId(), levelId: deps.trace.levelId, cell: deps.trace.cell, mounted }), link };
        store.addTokenToReserve(token);
        if (op.place) restoreRememberedPlace(deps, token, op.place);
        break;
      }
      case 'update':
        if (onBoard(op.tokenId)) {
          store.updateToken(op.tokenId, op.patch);
          publish('token.update', { tokenId: op.tokenId, patch: op.patch });
        } else {
          store.updateReserveToken(op.tokenId, op.patch);
        }
        break;
      case 'mounted':
        if (onBoard(op.tokenId)) {
          store.setTokenMounted(op.tokenId, op.mounted);
          publish('token.mounted', { tokenId: op.tokenId, mounted: op.mounted });
        } else {
          store.updateReserveToken(op.tokenId, { mounted: op.mounted });
        }
        break;
      case 'remove':
        if (op.where === 'board') {
          store.removeToken(op.tokenId);
          if (op.place) store.rememberLinkedPlace(op.place);
          publish('token.delete', { tokenId: op.tokenId });
        } else {
          store.removeFromReserve(op.tokenId);
        }
        break;
      case 'awaitBinding':
        awaiting.push({ ref: op.ref, label: op.label });
        break;
      case 'fx':
        // L'écran MJ joue toujours l'effet ; la tablette n'en reçoit aucun pour un pion caché.
        deps.playFx?.(op.fx, op.tokenId);
        if (!op.hidden) publish('fx', { tokenId: op.tokenId, ...op.fx });
        break;
      case 'attack':
        // L'écran MJ joue toujours l'attaque (contrat §9) ; la tablette ne la reçoit que quand
        // aucune des deux extrémités n'est cachée, sous forme de cases. Éphémère : rien dans le
        // store, jamais persisté ni rejoué.
        deps.playAttack?.(op);
        if (!op.hidden) {
          publish('attack', { from: op.from, to: op.to, levelId: op.levelId, outcome: op.outcome, ...(op.damage !== undefined ? { damage: op.damage } : {}) });
        }
        break;
      case 'merge':
        mergeMount(op, deps);
        break;
      case 'split':
        splitMount(op, deps);
        break;
      case 'impactQuery':
      case 'impactCancel':
        // Point d'impact (contrat §10.1) : rien dans la campagne, la demande vit dans la liaison.
        deps.onImpact?.(op);
        break;
    }
  }
  return { awaiting };
}

/**
 * Mémoire des cases (contrat §7, révision du 24/11/2026) : un pion lié qui revient avec le `ref` d'un
 * pion retiré est posé sur sa case d'avant, caché ou non comme il l'était, et publié par `token.add`.
 * L'étage supprimé ou la case prise (règles de pose de la carte : `placeTokenFromReserve`) le laissent
 * en réserve, comme avant. Dans les deux cas la place est oubliée : le pion est de nouveau connu de la
 * carte, et une place plus ancienne que lui ne doit pas le déplacer plus tard dans le dos du MJ.
 *
 * @param {Parameters<typeof executeMjOperations>[1]} deps
 * @param {Token} token pion fraîchement rangé en réserve
 * @param {LinkedPlace} place
 */
function restoreRememberedPlace(deps, token, place) {
  const { store, publish } = deps;
  store.forgetLinkedPlace(place.ref);
  try {
    if (!store.placeTokenFromReserve?.(token.id, place.levelId, place.cell, { ...token, hidden: place.hidden })) return;
  } catch {
    return; // étage disparu, case hors carte ou occupée : le pion attend en réserve
  }
  const posed = store.getCampaign()?.tokens.find((t) => t.id === token.id);
  if (posed) publish('token.add', { token: posed });
}

/**
 * Pose sur le plateau un pion lié de la réserve et le publie par `token.add`, qui porte le pion
 * entier : la tablette pose cet état, pas sa copie de réserve d'avant le rangement.
 *
 * @param {Parameters<typeof executeMjOperations>[1]} deps
 * @param {string} tokenId @param {string} levelId @param {{ a: number, b: number }} cell
 */
function placeLinkedFromReserve(deps, tokenId, levelId, cell) {
  const { store, publish } = deps;
  if (!store.placeTokenFromReserve?.(tokenId, levelId, cell)) return;
  const token = store.getCampaign()?.tokens.find((t) => t.id === tokenId);
  if (!token) return;
  publish('token.add', { token });
}

/**
 * Fusion (contrat §8.1) : la monture sort du plateau, conservée en réserve, et le cavalier prend sa
 * case. Le `token.update` qui suit dans le même message lui donne la taille de la monture. Deux
 * étages différents : rien ne se fusionne, personne ne change d'étage dans le dos du MJ.
 *
 * @param {{ riderTokenId: string, mountTokenId: string }} op
 * @param {Parameters<typeof executeMjOperations>[1]} deps
 */
function mergeMount(op, deps) {
  const { store, publish } = deps;
  const campaign = store.getCampaign();
  const mount = campaign?.tokens.find((t) => t.id === op.mountTokenId);
  if (!campaign || !mount) return;
  const rider = campaign.tokens.find((t) => t.id === op.riderTokenId);
  if (rider && rider.levelId !== mount.levelId) return;
  const cell = { a: mount.cell.a, b: mount.cell.b };
  if (!store.reserveToken?.(mount.id)) return;
  publish('token.reserve', { tokenId: mount.id });
  if (!rider) {
    placeLinkedFromReserve(deps, op.riderTokenId, mount.levelId, cell);
    return;
  }
  const from = { a: rider.cell.a, b: rider.cell.b };
  if (from.a === cell.a && from.b === cell.b) return;
  const startedAt = Date.now();
  try {
    store.moveTokenToCell?.(rider.id, cell, { from, to: cell, path: [from, cell], startedAt });
  } catch (err) {
    // La monture reprend sa case : un refus ne doit pas la faire disparaître du plateau.
    placeLinkedFromReserve(deps, mount.id, mount.levelId, cell);
    throw err;
  }
  publish('token.move', { tokenId: rider.id, from, to: cell, path: [from, cell], startedAt });
}

/**
 * Séparation (contrat §8.2) : la monture revient sur la case du pion fusionné, le cavalier passe en
 * réserve, à pied, et attend que le MJ touche une case adjacente libre (`onRiderToPlace`). Rien ne
 * bouge seul.
 *
 * @param {{ riderTokenId: string, mountTokenId: string }} op
 * @param {Parameters<typeof executeMjOperations>[1]} deps
 */
function splitMount(op, deps) {
  const { store, publish } = deps;
  const campaign = store.getCampaign();
  const rider = campaign?.tokens.find((t) => t.id === op.riderTokenId);
  const mount = (campaign?.reserve ?? []).find((t) => t.id === op.mountTokenId);
  if (!rider || !mount) return;
  const levelId = rider.levelId;
  const cell = { a: rider.cell.a, b: rider.cell.b };
  if (!store.reserveToken?.(rider.id)) return;
  publish('token.reserve', { tokenId: rider.id });
  placeLinkedFromReserve(deps, mount.id, levelId, cell);
  // Le cavalier reprend sa taille de pied (le `token.state` suivant la confirme) : posé avec celle de
  // la monture fusionnée, il prendrait des cases qu'il rend aussitôt.
  store.updateReserveToken(rider.id, { mounted: false, rider: null, sizeCells: 1 });
  const around = { levelId, cell, sizeCells: mount.sizeCells || 1 };
  // Décision du MJ (recette 06/11) : le cavalier reste sur le plateau, sur la case libre adjacente la
  // plus proche de sa monture. Aucune case libre : il attend en réserve, pose armée comme avant.
  if (!placeOnFreeAdjacentCell(deps, rider.id, around)) deps.onRiderToPlace?.(rider.id, around);
}

/**
 * Pose un pion de la réserve sur la case libre adjacente à une monture posée, la plus proche d'abord
 * (distance entre cases, puis `a`, puis `b` : ordre déterministe), selon la grille de l'étage
 * (carrée ou hexagonale) et la taille du pion. « Libre » = le store accepte la pose (case dans la
 * carte, non occupée) ; il rejette les autres sans rien changer.
 *
 * @param {Parameters<typeof executeMjOperations>[1]} deps
 * @param {string} tokenId
 * @param {{ levelId: string, cell: { a: number, b: number }, sizeCells: number }} around
 * @returns {boolean} true si le pion est maintenant sur le plateau
 */
function placeOnFreeAdjacentCell(deps, tokenId, around) {
  const { store } = deps;
  const campaign = store.getCampaign();
  const level = campaign?.levels.find((l) => l.id === around.levelId);
  const rider = (campaign?.reserve ?? []).find((t) => t.id === tokenId);
  if (!level || !rider) return false;
  const reach = around.sizeCells + (rider.sizeCells || 1) + 1;
  /** @type {{ a: number, b: number, d: number }[]} */
  const candidates = [];
  for (let da = -reach; da <= reach; da++) {
    for (let db = -reach; db <= reach; db++) {
      const cell = { a: around.cell.a + da, b: around.cell.b + db };
      if (footprintsAdjacent(level, { cell, sizeCells: rider.sizeCells || 1 }, around)) {
        candidates.push({ ...cell, d: Math.hypot(da, db) });
      }
    }
  }
  candidates.sort((p, q) => p.d - q.d || p.a - q.a || p.b - q.b);
  for (const { a, b } of candidates) {
    try {
      placeLinkedFromReserve(deps, tokenId, around.levelId, { a, b });
    } catch {
      continue; // case refusée : suivante
    }
    if (store.getCampaign()?.tokens.some((t) => t.id === tokenId)) return true;
  }
  return false;
}

// Constantes du contrat lues dans la copie des données communes (source : dépôt de l'outil MJ, ne pas modifier ici).
export const MJ_LINK_CHANNEL = LIAISON_CARTE.canal;
export const MJ_LINK_VERSION = LIAISON_CARTE.version;
export const MJ_LINK_PING_MS = LIAISON_CARTE.battementMs;
export const MJ_LINK_TIMEOUT_MS = LIAISON_CARTE.delaiDeconnexionMs;
/**
 * Écho du battement (contrat §2.3) : un onglet caché voit ses minuteries ralenties à une par minute,
 * mais reçoit toujours les messages ; il répond au battement de l'outil MJ s'il n'a pas battu depuis
 * ce délai. Pas de boucle : l'écho reçu en retour tombe dans le délai.
 */
export const MJ_LINK_ECHO_MS = LIAISON_CARTE.echoMs;

/**
 * Ouvre le canal avec l'outil MJ (contrat §2) : `map.hello` à l'ouverture et sur `mj.hello`,
 * battement `map.ping`, traduction puis exécution des messages reçus. Sans BroadcastChannel
 * (navigateur ancien, test), ne fait rien et rend `null`.
 *
 * @param {{
 *   store: Parameters<typeof executeMjOperations>[1]['store'] & {
 *     setTokenLink: (tokenId: string, ref: string|null) => void,
 *     subscribe?: (listener: () => void) => () => void,
 *     getTurn?: () => Readonly<import('../core/types.js').Turn>|null,
 *     setTurn?: (tokenId: string|null, spentCells?: number) => void,
 *     addTurnSpent?: (tokenId: string, cells: number) => void,
 *     getTurnSpent?: (tokenId: string) => number,
 *   },
 *   publish: (type: string, payload: any) => void,
 *   createToken: (overrides: any) => Token,
 *   playFx?: (fx: NonNullable<ReturnType<typeof parseFx>>, tokenId: string) => void,
 *   playAttack?: (op: Extract<MjLinkOperation, { op: 'attack' }>) => void,
 *   activeLevelId: () => string|null,
 *   sessionId: string,
 *   onStatus?: (status: 'connected'|'disconnected'|'version-mismatch', awaiting: { ref: string, label: string }[]) => void,
 *   onRiderToPlace?: Parameters<typeof executeMjOperations>[1]['onRiderToPlace'],
 *   Channel?: typeof BroadcastChannel,
 *   now?: () => number,
 * }} options
 * @returns {{ tick: () => void, close: () => void, status: () => { status: 'connected'|'disconnected'|'version-mismatch', awaiting: { ref: string, label: string }[] }, subscribe: (listener: () => void) => () => void, roster: () => { ref: string, label: string }[], bind: (tokenId: string, ref: string|null) => void, reportMove: (tokenId: string, path: import('../core/types.js').Cell[]) => boolean, reportTurnReset: (tokenId: string) => boolean, engagements: () => [string, string][], activeTurn: () => string|null,
 *   impact: () => PendingImpact|null, subscribeImpact: (listener: (query: PendingImpact|null) => void) => () => void,
 *   answerImpact: (cell: import('../core/types.js').Cell) => (PendingImpact & { cell: import('../core/types.js').Cell, refs: string[] })|null, cancelImpact: () => boolean }|null}
 */
export function startMjLink(options) {
  const Channel = options.Channel ?? globalThis.BroadcastChannel;
  if (typeof Channel !== 'function') return null;
  const now = options.now ?? Date.now;
  const channel = new Channel(MJ_LINK_CHANNEL);
  let seq = 0;
  /** @type {number|null} */
  let lastSeen = null;
  let lastPing = -Infinity;
  // Message reçu sans campagne chargée : l'état est perdu, on le redemande dès qu'une campagne existe.
  let missedWithoutCampaign = false;
  /** @type {'connected'|'disconnected'|'version-mismatch'} */
  let status = 'disconnected';
  /** @type {Map<string, string>} */
  const awaiting = new Map();
  /** Liste des PJ de l'outil MJ (`mj.roster`, contrat §3), pour « Lier à un PJ de l'outil MJ ». */
  /** @type {{ ref: string, label: string }[]} */
  let roster = [];
  /** Traits d'engagement (`mj.engagements`, contrat §10) : écran MJ seul, jamais republiés. */
  /** @type {[string, string][]} */
  let engagements = [];
  /**
   * `ref` du participant actif (`mj.turn`, contrat §10, révision du 21/11/2026 ; republié vers la
   * tablette par `turn.select`, 22/11/2026). Oublié à la déconnexion : un halo figé ou une table
   * bridée sur l'ancien tour tromperait tout le monde.
   * @type {string|null}
   */
  let activeTurn = null;
  /** Dernier `tokenId` de tour publié vers la tablette (`turn.select`). @type {string|null} */
  let announcedTurnTokenId = null;
  /** Dernier état « posé » annoncé à l'outil MJ (`map.placed` / `map.unplaced`), `ref` → étage. */
  /** @type {Map<string, string>} */
  let announcedPlaced = new Map();
  /** Signature des positions des pions liés : un changement est une fin de déplacement. */
  /** @type {string|null} */
  let positionsSignature = null;
  let counter = 0;
  /**
   * Point d'impact demandé par l'outil MJ (contrat §10.1), en attente du clic du MJ. Une seule
   * réponse par demande : la répondre ou l'abandonner la remet à `null`. Ni persistée, ni rejouée,
   * perdue à la déconnexion.
   * @type {PendingImpact|null}
   */
  let pendingImpact = null;
  /** @type {Set<(query: PendingImpact|null) => void>} */
  const impactListeners = new Set();
  const emitImpact = () => {
    const query = pendingImpact ? { ...pendingImpact } : null;
    for (const listener of impactListeners) listener(query);
  };
  /** La demande en cours est perdue (déconnexion) : l'écran MJ quitte le mode, rien n'est envoyé. */
  const dropImpact = () => {
    if (!pendingImpact) return;
    pendingImpact = null;
    emitImpact();
  };
  /** @param {Extract<MjLinkOperation, { op: 'impactQuery'|'impactCancel' }>} op */
  const onImpactOperation = (op) => {
    if (op.op === 'impactCancel') {
      if (pendingImpact?.queryId !== op.queryId) return;
      pendingImpact = null;
      emitImpact();
      return;
    }
    // Une nouvelle demande remplace la précédente, qui reçoit sa réponse d'abandon.
    if (pendingImpact) send('map.impact', { queryId: pendingImpact.queryId, cancelled: true });
    const campaign = options.store.getCampaign();
    const levelId = op.query.casterLevelId ?? options.activeLevelId() ?? campaign?.levels[0]?.id ?? '';
    pendingImpact = { queryId: op.query.queryId, label: op.query.label, radiusCells: op.query.radiusCells, levelId };
    emitImpact();
  };
  const awaitingList = () => [...awaiting].map(([ref, label]) => ({ ref, label }));
  /** @type {Set<() => void>} */
  const listeners = new Set();
  /** Prévient l'indicateur du panneau MJ (état ou liste d'attente changés). */
  const notify = () => {
    options.onStatus?.(status, awaitingList());
    for (const listener of listeners) listener();
  };
  const setStatus = (/** @type {'connected'|'disconnected'|'version-mismatch'} */ next) => {
    if (next === status) return;
    status = next;
    notify();
  };
  /** @param {string} type @param {any} [payload] */
  const send = (type, payload = {}) => channel.postMessage({ v: MJ_LINK_VERSION, type, seq: ++seq, at: now(), from: 'map', payload });
  const ping = () => {
    lastPing = now();
    send('map.ping');
  };
  const hello = () => send('map.hello', { v: MJ_LINK_VERSION, sessionId: options.sessionId });
  /** Annonce les pions liés posés, retirés ou changés d'étage depuis la dernière annonce. */
  const syncPlaced = () => {
    const campaign = options.store.getCampaign();
    if (!campaign) return;
    const placed = placedLinkedRefs(campaign);
    for (const [ref, levelId] of placed) if (announcedPlaced.get(ref) !== levelId) send('map.placed', { ref, levelId });
    for (const [ref, levelId] of announcedPlaced) if (!placed.has(ref)) send('map.unplaced', { ref, levelId });
    announcedPlaced = placed;
  };
  /** Fin de déplacement d'un pion lié (sa case, sa taille ou son étage changent) : `map.adjacency`. */
  const syncAdjacency = () => {
    const campaign = options.store.getCampaign();
    if (!campaign) return;
    const signature = JSON.stringify(campaign.tokens.filter((t) => isLinkedToken(t) && t.link)
      .map((t) => [t.link?.ref, t.levelId, t.cell.a, t.cell.b, t.sizeCells]));
    const previous = positionsSignature;
    positionsSignature = signature;
    if (previous !== null && previous !== signature) send('map.adjacency', { pairs: adjacencyPairs(campaign) });
  };
  /** Synchronise le tour dans le store et publie `turn.select` vers la tablette s'il change. */
  const syncTurn = () => {
    if (!options.store.setTurn) return;
    const campaign = options.store.getCampaign();
    const token = activeTurn && campaign
      ? campaign.tokens.find((t) => isLinkedToken(t) && (t.link?.ref === activeTurn || t.rider?.ref === activeTurn)) ?? null
      : null;
    const nextTokenId = token ? token.id : null;
    const current = options.store.getTurn?.() ?? null;
    if ((current?.tokenId ?? null) !== nextTokenId) {
      options.store.setTurn(nextTokenId);
    }
    const after = options.store.getTurn?.() ?? null;
    const afterTokenId = after ? after.tokenId : null;
    if (afterTokenId !== announcedTurnTokenId) {
      announcedTurnTokenId = afterTokenId;
      options.publish(
        'turn.select',
        after ? { tokenId: after.tokenId, spentCells: after.spentCells } : { tokenId: null }
      );
    }
  };
  const onStoreChange = () => {
    syncPlaced();
    syncAdjacency();
    syncTurn();
  };
  channel.onmessage = (event) => {
    const message = event?.data;
    if (!message || message.from !== 'outil-mj') return;
    if (message.v !== MJ_LINK_VERSION) {
      setStatus('version-mismatch');
      return;
    }
    // Le réveil peut livrer le premier message avant le prochain tick de déconnexion.
    const receivedAt = now();
    const resumed = lastSeen !== null && (status === 'disconnected' || receivedAt - lastSeen > MJ_LINK_TIMEOUT_MS);
    if (resumed && status === 'connected') {
      activeTurn = null;
      syncTurn();
      dropImpact();
      setStatus('disconnected');
    }
    lastSeen = receivedAt;
    setStatus('connected');
    if (message.type === 'mj.hello' || (resumed && message.type !== 'mj.snapshot')) hello();
    // L'outil MJ (re)démarre ou renvoie son état : il ne sait plus ce qui est posé, on le lui redit.
    if (message.type === 'mj.hello' || message.type === 'mj.snapshot') announcedPlaced = new Map();
    if (message.type === 'mj.ping' && now() - lastPing > MJ_LINK_ECHO_MS) ping();
    if ((message.type === 'fx.wound' || message.type === 'fx.death' || message.type === 'fx.attack') && Number.isFinite(message.at) &&
        receivedAt - message.at > MJ_LINK_TIMEOUT_MS) return;
    if (message.type === 'mj.roster') {
      const characters = Array.isArray(message.payload?.characters) ? message.payload.characters : [];
      roster = characters.filter((/** @type {any} */ c) => typeof c?.ref === 'string' && c.ref.startsWith('pj:') && typeof c.label === 'string')
        .map((/** @type {any} */ c) => ({ ref: c.ref, label: c.label }));
      return;
    }
    if (message.type === 'mj.engagements') {
      engagements = parseEngagements(message.payload);
      notify();
      return;
    }
    if (message.type === 'mj.turn') {
      const ref = typeof message.payload?.ref === 'string' && message.payload.ref ? message.payload.ref : null;
      if (ref !== activeTurn) {
        activeTurn = ref;
        syncTurn();
        notify();
      } else {
        syncTurn();
      }
      return;
    }
    const campaign = options.store.getCampaign();
    if (!campaign) {
      if (message.type !== 'mj.ping') missedWithoutCampaign = true;
      return;
    }
    if (message.type === 'mount.request') {
      const answer = answerMountRequest(campaign, message.payload);
      if (answer) send(answer.type, answer.payload);
      return;
    }
    if (message.type === 'mj.distanceQuery') {
      const answer = answerDistanceQuery(campaign, message.payload);
      if (answer) send('map.distance', answer);
      return;
    }
    const levelId = options.activeLevelId() ?? campaign.levels[0]?.id ?? '';
    try {
      const { awaiting: refs } = executeMjOperations(planMjMessage(campaign, message, MJ_LINK_VERSION), {
        store: options.store,
        publish: options.publish,
        createToken: options.createToken,
        playFx: options.playFx,
        playAttack: options.playAttack,
        newTokenId: () => `lie-${now().toString(36)}-${++counter}`,
        trace: { levelId, cell: { a: 0, b: 0 } },
        onRiderToPlace: options.onRiderToPlace,
        onImpact: onImpactOperation,
      });
      let changed = false;
      for (const { ref, label } of refs) {
        if (awaiting.get(ref) !== label) changed = true;
        awaiting.set(ref, label);
      }
      if (changed) notify();
    } catch (err) {
      console.error(`Liaison outil MJ : message "${message.type}" refusé : ${err instanceof Error ? err.message : String(err)}`);
    }
    syncPlaced();
  };
  // État de départ retenu sans rien émettre : l'outil MJ reçoit le « posé » complet à son instantané.
  const initial = options.store.getCampaign();
  if (initial) {
    announcedPlaced = placedLinkedRefs(initial);
    syncAdjacency();
  }
  const unsubscribe = options.store.subscribe?.(onStoreChange) ?? (() => {});
  hello();
  return {
    tick() {
      ping();
      if (missedWithoutCampaign && options.store.getCampaign()) {
        missedWithoutCampaign = false;
        hello();
      }
      if (status === 'connected' && lastSeen !== null && now() - lastSeen > MJ_LINK_TIMEOUT_MS) {
        activeTurn = null;
        syncTurn();
        dropImpact();
        setStatus('disconnected');
      }
    },
    /** Point d'impact en attente du clic du MJ (contrat §10.1), ou `null`. */
    impact: () => (pendingImpact ? { ...pendingImpact } : null),
    /**
     * Prévient l'écran MJ à chaque changement de la demande : une demande à viser, ou `null` quand
     * il n'y en a plus (répondue, abandonnée, annulée par l'outil MJ ou perdue à la déconnexion).
     * @param {(query: PendingImpact|null) => void} listener @returns {() => void}
     */
    subscribeImpact(listener) {
      impactListeners.add(listener);
      return () => impactListeners.delete(listener);
    },
    /**
     * Clic du MJ sur une case de l'étage de la demande : `map.impact { queryId, levelId, cell, refs }`,
     * une seule fois. Rend la réponse (et le rayon, pour le gabarit), ou `null` sans demande en cours.
     * @param {import('../core/types.js').Cell} cell
     */
    answerImpact(cell) {
      const campaign = options.store.getCampaign();
      if (!pendingImpact || !campaign) return null;
      const query = pendingImpact;
      const target = { a: cell.a, b: cell.b };
      const refs = impactRefs(campaign, query.levelId, target, query.radiusCells);
      pendingImpact = null;
      send('map.impact', { queryId: query.queryId, levelId: query.levelId, cell: target, refs });
      emitImpact();
      return { ...query, cell: target, refs };
    },
    /**
     * Abandon par le MJ (Échap, autre outil) : `map.impact { queryId, cancelled: true }`, une seule
     * fois. @returns {boolean} true si une réponse est partie
     */
    cancelImpact() {
      if (!pendingImpact) return false;
      const { queryId } = pendingImpact;
      pendingImpact = null;
      send('map.impact', { queryId, cancelled: true });
      emitImpact();
      return true;
    },
    close() {
      unsubscribe();
      channel.close();
    },
    status: () => ({ status, awaiting: awaitingList() }),
    /** @param {() => void} listener @returns {() => void} */
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    roster: () => roster.map((entry) => ({ ...entry })),
    engagements: () => engagements.map(([a, b]) => /** @type {[string, string]} */ ([a, b])),
    activeTurn: () => activeTurn,
    /**
     * Fin de déplacement marché d'un pion : incrémente les cases parcourues du tour actif
     * (décision 6 : le glisser libre MJ n'appelle pas cette méthode) puis publie `turn.select` ;
     * si le pion est lié et que son trajet dépasse la Marche restante, prévient l'outil MJ
     * (`map.ran`, contrat §10) — une fois par déplacement.
     * @param {string} tokenId @param {import('../core/types.js').Cell[]} path @returns {boolean} true si `map.ran` est parti
     */
    reportMove(tokenId, path) {
      const campaign = options.store.getCampaign();
      const token = campaign?.tokens.find((t) => t.id === tokenId);
      const level = campaign?.levels.find((l) => l.id === token?.levelId);
      if (!token || !level || !Array.isArray(path)) return false;
      const spentBefore = options.store.getTurnSpent?.(tokenId) ?? 0;
      const rules = movementRulesFor(token, level, spentBefore);
      let pathCost = 0;
      for (let i = 1; i < path.length; i++) {
        pathCost += movementStepCost(rules.grid, path[i - 1], path[i], rules.terrainCost);
      }
      if (pathCost > 0 && options.store.addTurnSpent) {
        options.store.addTurnSpent(tokenId, pathCost);
        const turn = options.store.getTurn?.() ?? null;
        if (turn && turn.tokenId === tokenId) {
          announcedTurnTokenId = turn.tokenId;
          options.publish('turn.select', { tokenId: turn.tokenId, spentCells: turn.spentCells });
        }
      }
      if (!isLinkedToken(token) || !token.link) return false;
      if (ranStartIndex(path, rules) < 0) return false;
      send('map.ran', { ref: token.link.ref });
      return true;
    },
    /**
     * Annulation du mouvement du tour d'un pion : prévient l'outil MJ (`map.turnReset`, contrat
     * §10, version 2) pour qu'il rende l'Action du Tour. Pion lié seulement ; à appeler une fois
     * par annulation effectivement appliquée.
     * @param {string} tokenId @returns {boolean} true si `map.turnReset` est parti
     */
    reportTurnReset(tokenId) {
      const token = options.store.getCampaign()?.tokens.find((t) => t.id === tokenId);
      if (!token || !isLinkedToken(token) || !token.link) return false;
      send('map.turnReset', { ref: token.link.ref });
      return true;
    },
    /**
     * Liaison durable d'un pion posé à un PJ (`ref`), ou déliaison (`null`) : store, tablette par
     * `token.link`, puis `map.hello` pour que l'outil MJ renvoie l'état du PJ (contrat §3).
     * @param {string} tokenId @param {string|null} ref
     */
    bind(tokenId, ref) {
      options.store.setTokenLink(tokenId, ref);
      options.publish('token.link', ref === null ? { tokenId } : { tokenId, ref });
      if (ref !== null && awaiting.delete(ref)) notify();
      hello();
    },
  };
}

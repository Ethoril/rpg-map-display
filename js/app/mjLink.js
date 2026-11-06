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
import { isLinkedToken } from '../core/schema.js';
import { movementRulesFor } from '../state/selection.js';
import { ranStartIndex } from '../state/movePlan.js';
import { parseFx } from '../render/layers/fx.js';
import { footprintsAdjacent, gridFor } from '../grid/index.js';

/** @typedef {import('../core/types.js').Token} Token */
/** @typedef {import('../core/types.js').Campaign} Campaign */

/**
 * État d'un pion lié tel que l'outil MJ l'envoie (contrat §4).
 * @typedef {Object} MjTokenState
 * @property {string} ref
 * @property {string} label
 * @property {'pj'|'allie'|'ennemi'|'neutre'} camp
 * @property {'pc'|'npc'} kind
 * @property {boolean} visionSource
 * @property {string|null} imageUrl
 * @property {string|null} [color] PJ seulement : couleur propre, `#rrggbb` (contrat §4, lot P2)
 * @property {number} sizeCells
 * @property {number|null} speedCells
 * @property {number|null} runCells
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
 * @typedef {{ op: 'reserveAdd', ref: string, token: Record<string, any> }
 *   | { op: 'update', tokenId: string, patch: Record<string, any> }
 *   | { op: 'mounted', tokenId: string, mounted: boolean }
 *   | { op: 'remove', tokenId: string, where: 'board'|'reserve' }
 *   | { op: 'awaitBinding', ref: string, label: string }
 *   | { op: 'fx', tokenId: string, hidden: boolean, fx: NonNullable<ReturnType<typeof parseFx>> }
 *   | { op: 'merge', riderTokenId: string, mountTokenId: string }
 *   | { op: 'split', riderTokenId: string, mountTokenId: string }} MjLinkOperation
 */

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
  if (state.rider !== undefined) patch.rider = state.rider;
  // La couleur d'un PJ (contrat §4) : `null` aussi, le MJ l'a retirée du profil.
  if (state.color !== undefined) patch.color = state.color;
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
    Object.entries(patch).filter(([key, value]) => JSON.stringify(/** @type {any} */ (token)[key] ?? (key === 'rider' || key === 'color' ? null : undefined)) !== JSON.stringify(value))
  );
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
    const { rider, ...fields } = patchFromState(state);
    return [{ op: 'reserveAdd', ref: state.ref, token: { ...fields, ...(rider ? { rider } : {}), link: { source: 'outil-mj', ref: state.ref }, mounted: state.mounted === true } }];
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
  const grid = gridFor(level);
  const fromCells = grid.cellsOccupied(from.cell, from.sizeCells || 1);
  const toCells = grid.cellsOccupied(to.cell, to.sizeCells || 1);
  let cells = Infinity;
  for (const a of fromCells) for (const b of toCells) cells = Math.min(cells, grid.distance(a, b));
  return { queryId, cells };
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

/**
 * Opérations d'un message de l'outil MJ. Un message inconnu, d'une autre version ou d'un autre
 * émetteur ne produit rien.
 *
 * @param {Campaign} campaign
 * @param {any} message
 * @param {number} version version du contrat attendue
 * @returns {MjLinkOperation[]}
 */
export function planMjMessage(campaign, message, version = 1) {
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
      return found ? [{ op: 'remove', tokenId: found.token.id, where: found.where }] : [];
    }
    case 'fx.wound':
    case 'fx.death': {
      // Effet éphémère (contrat §9) : joué sur le pion posé, jamais rejoué ni persisté.
      const fx = parseFx(message.type === 'fx.wound' ? 'wound' : 'death', payload);
      const token = typeof payload.ref === 'string' ? campaign.tokens.find((t) => isLinkedToken(t) && t.link?.ref === payload.ref) : null;
      return fx && token ? [{ op: 'fx', tokenId: token.id, hidden: token.hidden === true, fx }] : [];
    }
    case 'mount.split': {
      if (typeof payload.riderRef !== 'string') return [];
      const split = planSplit(campaign, findLinkedToken(campaign, payload.riderRef), payload.mountRef);
      return split ? [split] : [];
    }
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
          if (isLinkedToken(token) && ref && !ref.startsWith('pj:') && !refs.has(ref)) ops.push({ op: 'remove', tokenId: token.id, where });
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
 *            reserveToken?: (tokenId: string) => boolean,
 *            placeTokenFromReserve?: (tokenId: string, levelId: string, cell: { a: number, b: number }) => boolean,
 *            moveTokenToCell?: (tokenId: string, cell: { a: number, b: number }, moveData?: any) => void,
 *            getCampaign: () => Campaign|null },
 *   publish: (type: string, payload: any) => void,
 *   createToken: (overrides: any) => Token,
 *   playFx?: (fx: NonNullable<ReturnType<typeof parseFx>>, tokenId: string) => void,
 *   newTokenId: () => string,
 *   trace: { levelId: string, cell: { a: number, b: number } },
 *   onRiderToPlace?: (riderTokenId: string, around: { levelId: string, cell: { a: number, b: number }, sizeCells: number }) => void,
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
      case 'merge':
        mergeMount(op, deps);
        break;
      case 'split':
        splitMount(op, deps);
        break;
    }
  }
  return { awaiting };
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
  store.updateReserveToken(rider.id, { mounted: false, rider: null });
  deps.onRiderToPlace?.(rider.id, { levelId, cell, sizeCells: mount.sizeCells || 1 });
}

export const MJ_LINK_CHANNEL = 'wfrp-map-link';
export const MJ_LINK_VERSION = 1;
export const MJ_LINK_PING_MS = 5000;
export const MJ_LINK_TIMEOUT_MS = 15000;
/**
 * Écho du battement (contrat §2.3) : un onglet caché voit ses minuteries ralenties à une par minute,
 * mais reçoit toujours les messages ; il répond au battement de l'outil MJ s'il n'a pas battu depuis
 * ce délai. Pas de boucle : l'écho reçu en retour tombe dans le délai.
 */
export const MJ_LINK_ECHO_MS = 4000;

/**
 * Ouvre le canal avec l'outil MJ (contrat §2) : `map.hello` à l'ouverture et sur `mj.hello`,
 * battement `map.ping`, traduction puis exécution des messages reçus. Sans BroadcastChannel
 * (navigateur ancien, test), ne fait rien et rend `null`.
 *
 * @param {{
 *   store: Parameters<typeof executeMjOperations>[1]['store'] & { setTokenLink: (tokenId: string, ref: string|null) => void, subscribe?: (listener: () => void) => () => void },
 *   publish: (type: string, payload: any) => void,
 *   createToken: (overrides: any) => Token,
 *   playFx?: (fx: NonNullable<ReturnType<typeof parseFx>>, tokenId: string) => void,
 *   activeLevelId: () => string|null,
 *   sessionId: string,
 *   onStatus?: (status: 'connected'|'disconnected'|'version-mismatch', awaiting: { ref: string, label: string }[]) => void,
 *   onRiderToPlace?: Parameters<typeof executeMjOperations>[1]['onRiderToPlace'],
 *   Channel?: typeof BroadcastChannel,
 *   now?: () => number,
 * }} options
 * @returns {{ tick: () => void, close: () => void, status: () => { status: 'connected'|'disconnected'|'version-mismatch', awaiting: { ref: string, label: string }[] }, subscribe: (listener: () => void) => () => void, roster: () => { ref: string, label: string }[], bind: (tokenId: string, ref: string|null) => void, reportMove: (tokenId: string, path: import('../core/types.js').Cell[]) => boolean, engagements: () => [string, string][] }|null}
 */
export function startMjLink(options) {
  const Channel = options.Channel ?? globalThis.BroadcastChannel;
  if (typeof Channel !== 'function') return null;
  const now = options.now ?? Date.now;
  const channel = new Channel(MJ_LINK_CHANNEL);
  let seq = 0;
  let lastSeen = 0;
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
  /** Dernier état « posé » annoncé à l'outil MJ (`map.placed` / `map.unplaced`), `ref` → étage. */
  /** @type {Map<string, string>} */
  let announcedPlaced = new Map();
  /** Signature des positions des pions liés : un changement est une fin de déplacement. */
  /** @type {string|null} */
  let positionsSignature = null;
  let counter = 0;
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
  const onStoreChange = () => {
    syncPlaced();
    syncAdjacency();
  };
  channel.onmessage = (event) => {
    const message = event?.data;
    if (!message || message.from !== 'outil-mj') return;
    if (message.v !== MJ_LINK_VERSION) {
      setStatus('version-mismatch');
      return;
    }
    lastSeen = now();
    setStatus('connected');
    if (message.type === 'mj.hello') hello();
    // L'outil MJ (re)démarre ou renvoie son état : il ne sait plus ce qui est posé, on le lui redit.
    if (message.type === 'mj.hello' || message.type === 'mj.snapshot') announcedPlaced = new Map();
    if (message.type === 'mj.ping' && now() - lastPing > MJ_LINK_ECHO_MS) ping();
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
        newTokenId: () => `lie-${now().toString(36)}-${++counter}`,
        trace: { levelId, cell: { a: 0, b: 0 } },
        onRiderToPlace: options.onRiderToPlace,
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
      if (status === 'connected' && now() - lastSeen > MJ_LINK_TIMEOUT_MS) setStatus('disconnected');
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
    /**
     * Fin de déplacement d'un pion : s'il est lié et que son trajet dépasse la Marche, il a couru
     * et l'outil MJ en est prévenu (`map.ran`, contrat §10) — une fois par déplacement.
     * @param {string} tokenId @param {import('../core/types.js').Cell[]} path @returns {boolean} true si `map.ran` est parti
     */
    reportMove(tokenId, path) {
      const campaign = options.store.getCampaign();
      const token = campaign?.tokens.find((t) => t.id === tokenId);
      const level = campaign?.levels.find((l) => l.id === token?.levelId);
      if (!token || !level || !isLinkedToken(token) || !token.link || !Array.isArray(path)) return false;
      if (ranStartIndex(path, movementRulesFor(token, level)) < 0) return false;
      send('map.ran', { ref: token.link.ref });
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

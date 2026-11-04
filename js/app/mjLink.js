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
 */

/**
 * @typedef {{ op: 'reserveAdd', ref: string, token: Record<string, any> }
 *   | { op: 'update', tokenId: string, patch: Record<string, any> }
 *   | { op: 'mounted', tokenId: string, mounted: boolean }
 *   | { op: 'remove', tokenId: string, where: 'board'|'reserve' }
 *   | { op: 'awaitBinding', ref: string, label: string }} MjLinkOperation
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
    Object.entries(patch).filter(([key, value]) => JSON.stringify(/** @type {any} */ (token)[key]) !== JSON.stringify(value))
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
    return [{ op: 'reserveAdd', ref: state.ref, token: { ...patchFromState(state), link: { source: 'outil-mj', ref: state.ref }, mounted: state.mounted === true } }];
  }
  /** @type {MjLinkOperation[]} */
  const ops = [];
  const patch = changedOnly(found.token, patchFromState(state));
  if (Object.keys(patch).length) ops.push({ op: 'update', tokenId: found.token.id, patch });
  if (typeof state.mounted === 'boolean' && state.mounted !== (found.token.mounted === true)) {
    ops.push({ op: 'mounted', tokenId: found.token.id, mounted: state.mounted });
  }
  return ops;
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
 * @param {MjLinkOperation[]} ops
 * @param {{
 *   store: { addTokenToReserve: Function, updateToken: Function, updateReserveToken: Function,
 *            setTokenMounted: Function, removeToken: Function, removeFromReserve: Function,
 *            getCampaign: () => Campaign|null },
 *   publish: (type: string, payload: any) => void,
 *   createToken: (overrides: any) => Token,
 *   newTokenId: () => string,
 *   trace: { levelId: string, cell: { a: number, b: number } },
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
    }
  }
  return { awaiting };
}

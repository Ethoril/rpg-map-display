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
 *   store: Parameters<typeof executeMjOperations>[1]['store'] & { setTokenLink: (tokenId: string, ref: string|null) => void },
 *   publish: (type: string, payload: any) => void,
 *   createToken: (overrides: any) => Token,
 *   activeLevelId: () => string|null,
 *   sessionId: string,
 *   onStatus?: (status: 'connected'|'disconnected'|'version-mismatch', awaiting: { ref: string, label: string }[]) => void,
 *   Channel?: typeof BroadcastChannel,
 *   now?: () => number,
 * }} options
 * @returns {{ tick: () => void, close: () => void, status: () => { status: 'connected'|'disconnected'|'version-mismatch', awaiting: { ref: string, label: string }[] }, subscribe: (listener: () => void) => () => void, roster: () => { ref: string, label: string }[], bind: (tokenId: string, ref: string|null) => void, reportMove: (tokenId: string, path: import('../core/types.js').Cell[]) => boolean }|null}
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
    if (message.type === 'mj.ping' && now() - lastPing > MJ_LINK_ECHO_MS) ping();
    if (message.type === 'mj.roster') {
      const characters = Array.isArray(message.payload?.characters) ? message.payload.characters : [];
      roster = characters.filter((/** @type {any} */ c) => typeof c?.ref === 'string' && c.ref.startsWith('pj:') && typeof c.label === 'string')
        .map((/** @type {any} */ c) => ({ ref: c.ref, label: c.label }));
      return;
    }
    const campaign = options.store.getCampaign();
    if (!campaign) {
      if (message.type !== 'mj.ping') missedWithoutCampaign = true;
      return;
    }
    const levelId = options.activeLevelId() ?? campaign.levels[0]?.id ?? '';
    try {
      const { awaiting: refs } = executeMjOperations(planMjMessage(campaign, message, MJ_LINK_VERSION), {
        store: options.store,
        publish: options.publish,
        createToken: options.createToken,
        newTokenId: () => `lie-${now().toString(36)}-${++counter}`,
        trace: { levelId, cell: { a: 0, b: 0 } },
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
  };
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
    close: () => channel.close(),
    status: () => ({ status, awaiting: awaitingList() }),
    /** @param {() => void} listener @returns {() => void} */
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    roster: () => roster.map((entry) => ({ ...entry })),
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

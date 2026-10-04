// @ts-check

import { movementRulesFor } from '../state/selection.js';
import { createMovePlan, extendMovePlan, movePlanPreview, validateMovePlan } from '../state/movePlan.js';
import { getPresenceList, PRESENCE_STALE_AFTER_MS, subscribePresence } from '../state/presence.js';
import { computeReachable } from '../movement/reachable.js';
import { cellKey } from '../core/cellKey.js';

/** @typedef {import('../core/types.js').Token} Token */
/** @typedef {import('../core/types.js').Level} Level */
/** @typedef {import('../core/types.js').Cell} Cell */
/** @typedef {import('../core/types.js').MovePreview} MovePreview */

/** @typedef {{
 * publishMovePreview?:(preview:MovePreview)=>Promise<{ok:boolean,error?:unknown}>,
 * clearMovePreview?:(planId:string)=>Promise<{ok:boolean,error?:unknown}>,
 * subscribeMovePreviews?:(callback:(previews:Record<string,MovePreview>)=>void)=>()=>void,
 * getClientId?:()=>string|null
 * }} MovePlanningTransport
 */

/**
 * Contrôleur éphémère commun aux deux vues. Il ne lit ni ne modifie le store : l'appelant
 * conserve l'autorité sur les cibles, permissions et mutations de campagne.
 */
export class MovePlanningController {
  /** @param {{transport?:MovePlanningTransport,onChange?:()=>void,onInvalidated?:(reason:string)=>void,onPublicationError?:(error:unknown)=>void}} [options] */
  constructor(options = {}) {
    /** @type {MovePlanningTransport|null} */
    this.transport = null;
    this.onChange = options.onChange ?? (() => {});
    this.onInvalidated = options.onInvalidated ?? ((reason) => console.info(`[déplacement] ${reason}`));
    this.onPublicationError = options.onPublicationError ?? ((error) => console.warn('[déplacement] aperçu non synchronisé', error));
    /** @type {import('../state/movePlan.js').MovePlan|null} */
    this.plan = null;
    /** @type {Record<string,MovePreview>} */
    this.remote = {};
    /** @type {Record<string,MovePreview>} */
    this.receivedRemote = {};
    /** @type {Set<string>} */
    this.closedPlanIds = new Set();
    /** @type {string|null} */
    this.rulesSignature = null;
    /** @type {boolean} */
    this.suppressReconcile = false;
    /** @type {ReturnType<typeof setTimeout>|null} */
    this.presenceTimer = null;
    this.unsubscribePreviews = null;
    this.unsubscribePresence = subscribePresence(() => this.refreshRemote());
    if (options.transport) this.setTransport(options.transport);
  }

  /** @param {MovePlanningTransport|null} transport */
  setTransport(transport) {
    const previous = this.transport;
    this.unsubscribePreviews?.();
    if (previous && previous !== transport) {
      this.remote = {};
      this.receivedRemote = {};
    }
    this.transport = transport;
    this.unsubscribePreviews = this.transport?.subscribeMovePreviews?.((/** @type {Record<string,MovePreview>} */ previews) => {
      /** @type {Record<string,MovePreview>} */
      const next = {};
      for (const [clientId, preview] of Object.entries(previews || {})) {
        if (clientId === this.transport?.getClientId?.() || this.closedPlanIds.has(preview.planId)) continue;
        next[clientId] = preview;
      }
      this.receivedRemote = next;
      this.refreshRemote();
    }) ?? null;
  }

  /** @returns {import('../state/movePlan.js').MovePlan|null} */
  getPlan() { return this.plan; }

  /** @returns {Record<string,MovePreview>} */
  getRemotePreviews() { return this.remote; }

  /** @param {Token} token @param {Level} level */
  start(token, level) {
    this.cancel();
    const rules = movementRulesFor(token, level);
    this.plan = createMovePlan(token, level, rules);
    this.rulesSignature = signatureFor(token, level, rules);
    this.onChange();
    return this.plan;
  }

  /** @param {Cell} destination @param {Token} token @param {Level} level */
  extend(destination, token, level) {
    if (!this.plan || this.plan.tokenId !== token.id || this.plan.levelId !== level.id) {
      this.start(token, level);
    }
    const plan = this.plan;
    if (!plan) return { ok: false, reason: 'aucune préparation active' };
    const rules = movementRulesFor(token, level);
    const result = extendMovePlan(plan, destination, rules);
    if (!result.plan) return { ok: false, reason: result.reason };
    this.plan = result.plan;
    this.rulesSignature = signatureFor(token, level, rules);
    this.publish();
    this.onChange();
    return { ok: true, plan: this.plan };
  }

  /** Annule et retire l'aperçu du réseau. @returns {string|null} planId retiré */
  cancel() {
    const old = this.plan;
    if (!old) return null;
    this.rememberClosedPlanId(old.planId);
    this.plan = null;
    this.rulesSignature = null;
    void this.transport?.clearMovePreview?.(old.planId);
    this.onChange();
    return old.planId;
  }

  /**
   * Revérifie avant d'appeler une unique mutation de mouvement. `commit` retourne true seulement
   * si la mutation locale a été acceptée.
   * @param {Token} token
   * @param {Level} level
   * @param {(path:Cell[],destination:Cell)=>boolean} commit
   * @returns {{ok:boolean,reason:string|null}}
   */
  validate(token, level, commit) {
    const plan = this.plan;
    if (!plan || plan.status !== 'ready') return { ok: false, reason: 'aucune préparation validable' };
    const check = validateMovePlan(plan, token, level, movementRulesFor(token, level));
    if (!check.valid) {
      this.invalidate(check.reason || 'le trajet n’est plus valide');
      return { ok: false, reason: check.reason };
    }
    const destination = plan.path[plan.path.length - 1];
    this.plan = { ...plan, status: /** @type {'validating'} */ ('validating') };
    this.onChange();
    let committed = false;
    try { committed = commit(plan.path.map((cell) => ({ ...cell })), { ...destination }); }
    catch { committed = false; }
    if (!committed) {
      this.plan = { ...plan, status: /** @type {'ready'} */ ('ready') };
      this.onChange();
      return { ok: false, reason: 'déplacement refusé' };
    }
    this.cancel();
    return { ok: true, reason: null };
  }

  /** @param {string} levelId */
  clearIfLevelDiffers(levelId) {
    if (this.plan && this.plan.levelId !== levelId) this.cancel();
  }

  /** Revalide une préparation après une notification d'état (étage, pion ou règles).
   * @param {Token|null} token @param {Level|null} level @param {boolean} [playerRules]
   */
  reconcile(token, level, playerRules = false) {
    const plan = this.plan;
    if (!plan) return;
    if (plan.status === 'validating' || this.suppressReconcile) return;
    if (!token || !level || token.id !== plan.tokenId || level.id !== plan.levelId || token.levelId !== level.id) {
      this.invalidate('la sélection ou l’étage a changé');
      return;
    }
    if (playerRules && (token.hidden || token.kind !== 'pc' || token.locked || token.playerMovable === false)) {
      this.invalidate('ce personnage ne peut plus être déplacé');
      return;
    }
    const rules = movementRulesFor(token, level);
    if (token.cell.a !== plan.start.a || token.cell.b !== plan.start.b) {
      this.invalidate('la position du personnage a changé');
      return;
    }
    const signature = signatureFor(token, level, rules);
    if (signature === this.rulesSignature) return;
    this.rulesSignature = signature;
    if (Math.abs(rules.budget - plan.budget) > 1e-9) {
      this.invalidate('la capacité de déplacement a changé');
      return;
    }
    if (plan.steps.length) {
      const check = validateMovePlan(plan, token, level, rules);
      if (!check.valid) {
        this.invalidate(check.reason || 'le trajet n’est plus valide');
        return;
      }
      // Une modification de terrain peut conserver la légalité du chemin tout en changeant son coût.
      const oldCost = plan.cost;
      const oldRemaining = plan.remaining;
      plan.cost = check.cost;
      plan.remaining = Math.max(0, plan.budget - check.cost);
      if (Math.abs(oldCost - plan.cost) > 1e-9 || Math.abs(oldRemaining - plan.remaining) > 1e-9) {
        plan.revision++;
        this.publish();
      }
    }
    const result = computeReachable(rules.grid, plan.path.at(-1) || plan.start, plan.remaining, rules.blockedEdges, rules.terrainCost);
    result.distances.delete(cellKey(plan.path.at(-1) || plan.start));
    plan.reachable = result.distances;
    plan.predecessors = result.predecessors;
    this.onChange();
  }

  /** @param {string} reason */
  invalidate(reason) {
    const plan = this.plan;
    this.cancel();
    if (plan) this.onInvalidated(reason);
  }

  /** @param {string} planId */
  rememberClosedPlanId(planId) {
    this.closedPlanIds.add(planId);
    if (this.closedPlanIds.size > 64) {
      const oldest = this.closedPlanIds.values().next().value;
      if (oldest !== undefined) this.closedPlanIds.delete(oldest);
    }
  }

  /** @template T @param {()=>T} operation @returns {T} */
  withSuppressedReconcile(operation) {
    this.suppressReconcile = true;
    try { return operation(); }
    finally { this.suppressReconcile = false; }
  }

  dispose() {
    this.cancel();
    this.unsubscribePreviews?.();
    this.unsubscribePresence?.();
    if (this.presenceTimer) clearTimeout(this.presenceTimer);
    this.presenceTimer = null;
    this.remote = {};
    this.receivedRemote = {};
  }

  refreshRemote() {
    const now = Date.now();
    const live = new Set(getPresenceList().map((presence) => presence.clientId));
    const next = Object.fromEntries(Object.entries(this.receivedRemote).filter(([id]) => live.has(id)));
    const changed = JSON.stringify(next) !== JSON.stringify(this.remote);
    this.remote = next;
    if (this.presenceTimer) clearTimeout(this.presenceTimer);
    this.presenceTimer = null;
    let expiry = Infinity;
    for (const presence of getPresenceList()) {
      if (next[presence.clientId]) expiry = Math.min(expiry, PRESENCE_STALE_AFTER_MS - Math.abs(now - presence.at) + 1);
    }
    if (Number.isFinite(expiry)) {
      this.presenceTimer = setTimeout(() => {
        this.presenceTimer = null;
        this.refreshRemote();
      }, Math.max(1, expiry));
    }
    if (changed || Object.keys(next).length) this.onChange();
  }

  publish() {
    if (!this.plan || !this.transport?.publishMovePreview) return;
    const preview = movePlanPreview(this.plan);
    void this.transport.publishMovePreview(preview).then((result) => {
      if (result?.ok) return;
      const current = this.plan;
      if (!current || current.planId !== preview.planId || current.revision !== preview.revision) return;
      this.onPublicationError(result?.error);
      this.rememberClosedPlanId(current.planId);
      void this.transport?.clearMovePreview?.(current.planId);
      current.planId = makeNewPlanId();
      current.revision = 0;
      this.onChange();
    });
  }
}

/** @returns {string} */
function makeNewPlanId() {
  return globalThis.crypto?.randomUUID?.() ?? `move-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** @param {Token} token @param {Level} level @param {ReturnType<typeof movementRulesFor>} rules */
function signatureFor(token, level, rules) {
  return JSON.stringify([
    token.id, token.levelId, token.cell.a, token.cell.b, token.sizeCells,
    token.speedCells, token.mounted === true, token.hidden === true, token.locked === true,
    token.playerMovable !== false, level.id, level.widthCells, level.heightCells, rules.grid.type,
    rules.budget, Array.from(rules.blockedEdges).sort(), Array.from(rules.terrainCost.entries()).sort(),
  ]);
}

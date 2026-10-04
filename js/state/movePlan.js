// @ts-check

import { cellKey } from '../core/cellKey.js';
import { canTraverseStep, computeReachable, movementStepCost } from '../movement/reachable.js';
import { reconstructPath } from '../movement/path.js';

/** @typedef {import('../core/types.js').Cell} Cell */
/** @typedef {import('../core/types.js').Token} Token */
/** @typedef {import('../core/types.js').Level} Level */
/** @typedef {import('../grid/GridAdapter.js').GridAdapter} GridAdapter */
/** @typedef {{grid:GridAdapter,budget:number,blockedEdges:Set<string>,terrainCost:Map<string,number>}} MovementRules */

/** @typedef {Object} MovePlan
 * @property {string} planId
 * @property {number} revision
 * @property {string} tokenId
 * @property {string} levelId
 * @property {Cell} start
 * @property {Cell[]} steps
 * @property {Cell[]} path
 * @property {number} budget
 * @property {number} cost
 * @property {number} remaining
 * @property {Map<string,number>} reachable
 * @property {Map<string,string>} predecessors
 * @property {'ready'|'validating'} status
 */

export const MOVE_COST_EPSILON = 1e-9;

/**
 * Crée une préparation sans toucher au pion. Le Dijkstra initial sert à la fois à la zone
 * disponible et au chemin des étapes choisies.
 * @param {Token} token
 * @param {Level} level
 * @param {MovementRules} rules
 * @returns {MovePlan}
 */
export function createMovePlan(token, level, rules) {
  const start = { a: token.cell.a, b: token.cell.b };
  const result = computeReachable(rules.grid, start, rules.budget, rules.blockedEdges, rules.terrainCost);
  result.distances.delete(cellKey(start));
  return {
    planId: makePlanId(), revision: 0, tokenId: token.id, levelId: level.id,
    start, steps: [], path: [start], budget: rules.budget, cost: 0,
    remaining: rules.budget, reachable: result.distances, predecessors: result.predecessors,
    status: /** @type {'ready'} */ ('ready'),
  };
}

/**
 * Ajoute une arrivée en conservant tous les détours préparés précédemment.
 * @param {MovePlan} plan
 * @param {Cell} destination
 * @param {MovementRules} rules
 * @returns {{plan:MovePlan|null,reason:'unreachable'|'exhausted'|null}}
 */
export function extendMovePlan(plan, destination, rules) {
  if (plan.status !== 'ready' || plan.remaining <= MOVE_COST_EPSILON) {
    return { plan: null, reason: 'exhausted' };
  }
  const destinationKey = cellKey(destination);
  const segmentCost = plan.reachable.get(destinationKey);
  if (segmentCost === undefined || segmentCost <= MOVE_COST_EPSILON) {
    return { plan: null, reason: 'unreachable' };
  }
  const current = plan.path[plan.path.length - 1];
  const segment = reconstructPath(plan.predecessors, current, destination);
  if (segment.length < 2) return { plan: null, reason: 'unreachable' };
  const totalCost = plan.cost + segmentCost;
  if (totalCost > plan.budget + MOVE_COST_EPSILON) return { plan: null, reason: 'unreachable' };

  const next = {
    ...plan,
    revision: plan.revision + 1,
    steps: [...plan.steps, { a: destination.a, b: destination.b }],
    path: [...plan.path, ...segment.slice(1).map((cell) => ({ a: cell.a, b: cell.b }))],
    cost: totalCost,
    remaining: Math.max(0, plan.budget - totalCost),
    status: /** @type {'ready'} */ ('ready'),
  };
  const reachable = computeReachable(rules.grid, destination, next.remaining, rules.blockedEdges, rules.terrainCost);
  reachable.distances.delete(destinationKey);
  next.reachable = reachable.distances;
  next.predecessors = reachable.predecessors;
  return { plan: next, reason: null };
}

/** Revalidates the complete route against the current grid and movement rules. @param {MovePlan} plan @param {Token} token @param {Level} level @param {MovementRules} rules @returns {{valid:boolean,reason:string|null,cost:number}} */
export function validateMovePlan(plan, token, level, rules) {
  if (plan.status !== 'ready') return { valid: false, reason: 'validation en cours', cost: plan.cost };
  if (token.id !== plan.tokenId || level.id !== plan.levelId || token.levelId !== level.id) {
    return { valid: false, reason: 'le personnage ou l’étage a changé', cost: plan.cost };
  }
  if (token.cell.a !== plan.start.a || token.cell.b !== plan.start.b) {
    return { valid: false, reason: 'la position de départ a changé', cost: plan.cost };
  }
  if (plan.path.length < 2 || plan.steps.length === 0) {
    return { valid: false, reason: 'aucune arrivée préparée', cost: 0 };
  }
  let cost = 0;
  for (let i = 1; i < plan.path.length; i++) {
    const from = plan.path[i - 1];
    const to = plan.path[i];
    if (!canTraverseStep(rules.grid, from, to, rules.blockedEdges)) {
      return { valid: false, reason: 'un obstacle bloque le chemin', cost };
    }
    cost += movementStepCost(rules.grid, from, to, rules.terrainCost);
  }
  if (cost > Math.min(plan.budget, rules.budget) + MOVE_COST_EPSILON) {
    return { valid: false, reason: 'la capacité de déplacement a changé', cost };
  }
  if (plan.path.at(-1)?.a !== plan.steps.at(-1)?.a || plan.path.at(-1)?.b !== plan.steps.at(-1)?.b) {
    return { valid: false, reason: 'la dernière arrivée ne correspond plus au chemin', cost };
  }
  return { valid: true, reason: null, cost };
}

/** @param {MovePlan} plan @returns {import('../core/types.js').MovePreview} */
export function movePlanPreview(plan) {
  return {
    planId: plan.planId, revision: plan.revision, levelId: plan.levelId,
    tokenId: plan.tokenId, start: { ...plan.start },
    path: plan.path.map((cell) => ({ ...cell })),
    destination: { ...plan.path[plan.path.length - 1] }, remaining: plan.remaining,
  };
}

/** @returns {string} */
function makePlanId() {
  return globalThis.crypto?.randomUUID?.() ?? `move-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}


// @ts-check
import { parseCellKey } from '../../core/cellKey.js';

/**
 * @typedef {import('../../core/types.js').Token} Token
 * @typedef {import('../../grid/GridAdapter.js').GridAdapter} GridAdapter
 * @typedef {{
 *   selectedToken: Token|null,
 *   reachableCells: Map<string, number>|null
 * }} MoveZoneState
 */

/** @typedef {'refused'|'occupied'} DestinationFeedbackKind */

const DESTINATION_FEEDBACK_MS = 650;

/**
 * Couche visuelle sans surface interactive propre.
 */
export class MoveZoneLayer {
  constructor() {
    /** @type {{cell: import('../../core/types.js').Cell, kind: DestinationFeedbackKind, startedAt: number}|null} */
    this.destinationFeedback = null;
  }

  /**
   * Affiche brièvement le refus d'une destination dans la carte, sans créer d'UI DOM.
   *
   * @param {import('../../core/types.js').Cell} cell
   * @param {DestinationFeedbackKind} kind
   */
  showDestinationFeedback(cell, kind) {
    this.destinationFeedback = {
      cell: { a: cell.a, b: cell.b },
      kind,
      startedAt: Date.now(),
    };
  }

  /**
   * Dessine le retour temporaire au-dessus de la carte. Le booléen demande une nouvelle frame
   * tant que l'animation est visible, puis l'état est libéré : aucun élément permanent ne reste.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {GridAdapter} grid
   * @param {{now: number, zoom: number}} options
   * @returns {boolean} true tant que le retour est animé
   */
  renderDestinationFeedback(ctx, grid, options) {
    const feedback = this.destinationFeedback;
    if (!ctx || !grid || !feedback) return false;

    const elapsed = options.now - feedback.startedAt;
    if (elapsed >= DESTINATION_FEEDBACK_MS) {
      this.destinationFeedback = null;
      return false;
    }

    const p0 = grid.mapFromCellPoint({ cellX: feedback.cell.a, cellY: feedback.cell.b });
    const p1 = grid.mapFromCellPoint({ cellX: feedback.cell.a + 1, cellY: feedback.cell.b + 1 });
    const centerX = (p0.x + p1.x) / 2;
    const centerY = (p0.y + p1.y) / 2;
    const radius = Math.min(Math.abs(p1.x - p0.x), Math.abs(p1.y - p0.y)) * 0.32;
    const zoom = Math.max(0.01, options.zoom);
    const progress = elapsed / DESTINATION_FEEDBACK_MS;

    ctx.save();
    ctx.globalAlpha = 0.9 * (1 - progress);
    ctx.strokeStyle = feedback.kind === 'occupied' ? '#f59e0b' : '#f43f5e';
    ctx.lineWidth = 4 / zoom;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius * (0.8 + progress * 0.2), 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(centerX - radius * 0.42, centerY - radius * 0.42);
    ctx.lineTo(centerX + radius * 0.42, centerY + radius * 0.42);
    ctx.moveTo(centerX + radius * 0.42, centerY - radius * 0.42);
    ctx.lineTo(centerX - radius * 0.42, centerY + radius * 0.42);
    ctx.stroke();
    ctx.restore();
    return true;
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {GridAdapter} grid
   * @param {MoveZoneState} state
   * @returns {number} nombre de cases dessinées
   */
  render(ctx, grid, state) {
    const token = state?.selectedToken;
    const reachableCells = state?.reachableCells;
    if (!ctx || !grid || !token || !(reachableCells instanceof Map) || reachableCells.size === 0) {
      return 0;
    }

    ctx.save();
    ctx.fillStyle = token.borderColor || '#3b82f6';
    ctx.globalAlpha = 0.3;
    let renderedCells = 0;

    for (const key of reachableCells.keys()) {
      const cell = parseCellKey(key);
      const p0 = grid.mapFromCellPoint({ cellX: cell.a, cellY: cell.b });
      const p1 = grid.mapFromCellPoint({ cellX: cell.a + 1, cellY: cell.b + 1 });
      ctx.fillRect(p0.x, p0.y, p1.x - p0.x, p1.y - p0.y);
      renderedCells++;
    }

    ctx.restore();
    return renderedCells;
  }
}

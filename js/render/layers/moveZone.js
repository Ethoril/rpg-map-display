// @ts-check
import { parseCellKey } from '../../core/cellKey.js';
import { MOVE_ZONE_FILL_ALPHA, MOVE_ZONE_OUTLINE_PX } from '../../core/constants.js';

/**
 * @typedef {import('../../core/types.js').Token} Token
 * @typedef {import('../../grid/GridAdapter.js').GridAdapter} GridAdapter
 * @typedef {{
 *   selectedToken: Token|null,
 *   reachableCells: Map<string, number>|null,
 *   walkLimit?: number
 * }} MoveZoneState
 * `walkLimit` : coût au-delà duquel une case est en Course (second palier, contrat §11.6). Absent
 * ou ≥ au plus grand coût, la zone n'a qu'un palier — pion non lié, ou sans `runCells`.
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

    // Centre par `cellCenter` (jamais faux, dans les deux pavages) et rayon par `cellBounds` —
    // plus la différence de deux `mapFromCellPoint`, fausse d'une demi-case en hexagonal selon
    // la parité de rangée (C-5, `docs/QUESTIONS-EN-ATTENTE.md`).
    const center = grid.cellCenter(feedback.cell);
    const bounds = grid.cellBounds({ cellX: feedback.cell.a, cellY: feedback.cell.b }, 1);
    const centerX = center.x;
    const centerY = center.y;
    const radius = Math.min(bounds.width, bounds.height) * 0.32;
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
   * @param {number} [zoom=1] Zoom caméra, pour garder le contour constant en pixels écran
   * @returns {number} nombre de cases dessinées
   */
  render(ctx, grid, state, zoom = 1) {
    const token = state?.selectedToken;
    const reachableCells = state?.reachableCells;
    if (!ctx || !grid || !token || !(reachableCells instanceof Map) || reachableCells.size === 0) {
      return 0;
    }

    const walkLimit = Number.isFinite(state.walkLimit) ? /** @type {number} */ (state.walkLimit) : Infinity;
    /** @type {string[]} */
    const walkKeys = [];
    /** @type {string[]} */
    const runKeys = [];
    for (const [key, cost] of reachableCells) (cost > walkLimit + 1e-9 ? runKeys : walkKeys).push(key);
    const color = token.borderColor || '#3b82f6';

    ctx.save();
    ctx.fillStyle = color;
    ctx.globalAlpha = MOVE_ZONE_FILL_ALPHA;
    let renderedCells = 0;

    // Un seul chemin, un seul fill() : à cette globalAlpha, remplir case par case superposerait
    // l'alpha sur les bords communs et laisserait des coutures — voir GridAdapter.cellPath.
    ctx.beginPath();
    for (const key of walkKeys) {
      grid.cellPath(ctx, parseCellKey(key));
      renderedCells++;
    }
    ctx.fill();

    // Course : anneau extérieur plus pâle et hachuré (lisible sans la couleur, donc sur la TV et
    // dans le brouillard), bordure en pointillés.
    if (runKeys.length > 0) {
      ctx.beginPath();
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const key of runKeys) {
        const cell = parseCellKey(key);
        grid.cellPath(ctx, cell);
        renderedCells++;
        const box = grid.cellBounds({ cellX: cell.a, cellY: cell.b }, 1);
        minX = Math.min(minX, box.x);
        minY = Math.min(minY, box.y);
        maxX = Math.max(maxX, box.x + box.width);
        maxY = Math.max(maxY, box.y + box.height);
      }
      ctx.globalAlpha = MOVE_ZONE_FILL_ALPHA * 0.4;
      ctx.fill();
      ctx.save();
      ctx.clip();
      ctx.globalAlpha = MOVE_ZONE_FILL_ALPHA * 1.1;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2 / Math.max(0.01, zoom);
      const step = 9 / Math.max(0.01, zoom);
      ctx.beginPath();
      for (let x = minX - (maxY - minY); x < maxX; x += step) {
        ctx.moveTo(x, maxY);
        ctx.lineTo(x + (maxY - minY), minY);
      }
      ctx.stroke();
      ctx.restore();
    }

    // Le remplissage groupé ne crée pas de coutures. Les contours sont ensuite tracés par
    // case, en pixels écran constants, pour que la frontière reste lisible au zoom courant.
    ctx.globalAlpha = 1;
    ctx.strokeStyle = color;
    ctx.lineWidth = MOVE_ZONE_OUTLINE_PX / Math.max(0.01, zoom);
    ctx.lineJoin = 'round';
    for (const key of walkKeys) {
      ctx.beginPath();
      grid.cellPath(ctx, parseCellKey(key));
      ctx.stroke();
    }
    if (runKeys.length > 0) {
      ctx.setLineDash([6 / Math.max(0.01, zoom), 5 / Math.max(0.01, zoom)]);
      for (const key of runKeys) {
        ctx.beginPath();
        grid.cellPath(ctx, parseCellKey(key));
        ctx.stroke();
      }
    }

    ctx.restore();
    return renderedCells;
  }
}

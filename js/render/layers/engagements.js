// @ts-check

/**
 * @typedef {import('../../core/types.js').Level} Level
 * @typedef {import('../../core/types.js').Token} Token
 * @typedef {import('../../core/types.js').MapPoint} MapPoint
 * @typedef {import('../../grid/GridAdapter.js').GridAdapter} GridAdapter
 */

/**
 * Traits d'engagement du contrat de liaison (§10, §11.6) : l'outil MJ envoie
 * `mj.engagements { pairs }`, la carte trace un trait entre les deux pions engagés.
 *
 * ⛔ **Vue MJ SEULE** : `player.js` ne branche jamais cette couche, et rien ne part vers la
 * tablette. Ne lit pas le store : les paires viennent de la liaison, les pions de l'appelant.
 */

/**
 * Pion posé d'un `ref` de l'outil MJ sur l'étage : le pion lié lui-même, ou le pion fusionné qui
 * porte cette monture (contrat §8.1).
 *
 * @param {readonly Token[]} tokens
 * @param {string} levelId
 * @param {string} ref
 * @returns {Token|null}
 */
function tokenForRef(tokens, levelId, ref) {
  return tokens.find((t) => t.levelId === levelId && (t.link?.ref === ref || t.rider?.ref === ref)) ?? null;
}

/**
 * Centre de l'emprise d'un pion, en pixels carte — même ancrage que `fx.js` et `tokens.js`.
 *
 * @param {GridAdapter} grid
 * @param {Token} token
 * @returns {MapPoint & { radius: number }}
 */
function footprintCenter(grid, token) {
  const bounds = grid.cellBounds({ cellX: token.cell.a, cellY: token.cell.b }, Math.max(1, token.sizeCells || 1));
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2, radius: Math.min(bounds.width, bounds.height) / 2 };
}

/**
 * Segments à tracer sur un étage : une paire dont un pion manque ou est sur un autre étage ne se
 * trace pas.
 *
 * @param {GridAdapter} grid
 * @param {Level} level
 * @param {readonly Token[]} tokens
 * @param {readonly (readonly string[])[]} pairs
 * @returns {{ from: MapPoint, to: MapPoint }[]}
 */
export function engagementSegments(grid, level, tokens, pairs) {
  /** @type {{ from: MapPoint, to: MapPoint }[]} */
  const segments = [];
  for (const [refA, refB] of pairs) {
    const a = tokenForRef(tokens, level.id, refA);
    const b = tokenForRef(tokens, level.id, refB);
    if (!a || !b || a === b) continue;
    const ca = footprintCenter(grid, a);
    const cb = footprintCenter(grid, b);
    const dx = cb.x - ca.x;
    const dy = cb.y - ca.y;
    const dist = Math.hypot(dx, dy);
    // Trait de bord à bord : il n'entre pas dans le disque des pions (initiales, portraits).
    if (dist <= ca.radius + cb.radius) continue;
    const ux = dx / dist;
    const uy = dy / dist;
    segments.push({
      from: { x: ca.x + ux * ca.radius, y: ca.y + uy * ca.radius },
      to: { x: cb.x - ux * cb.radius, y: cb.y - uy * cb.radius },
    });
  }
  return segments;
}

export class EngagementsLayer {
  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {GridAdapter} grid
   * @param {Level|null} level
   * @param {{ tokens?: readonly Token[], pairs?: readonly (readonly string[])[], zoom?: number }} [options]
   */
  render(ctx, grid, level, options = {}) {
    const pairs = options.pairs ?? [];
    if (!ctx || !grid || !level || pairs.length === 0) return;
    const segments = engagementSegments(grid, level, options.tokens ?? [], pairs);
    if (segments.length === 0) return;
    // Épaisseurs en pixels ÉCRAN, comme la mesure : un trait fin reste lisible au zoom « carte entière ».
    const k = 1 / Math.max(0.01, options.zoom ?? 1);
    ctx.save();
    ctx.lineCap = 'round';
    for (const [width, color] of /** @type {const} */ ([[5, 'rgba(15, 23, 42, 0.85)'], [2.5, '#f97316']])) {
      ctx.lineWidth = width * k;
      ctx.strokeStyle = color;
      ctx.beginPath();
      for (const { from, to } of segments) {
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }
}

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
 * @returns {MapPoint}
 */
function footprintCenter(grid, token) {
  const bounds = grid.cellBounds({ cellX: token.cell.a, cellY: token.cell.b }, Math.max(1, token.sizeCells || 1));
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
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
    segments.push({ from: footprintCenter(grid, a), to: footprintCenter(grid, b) });
  }
  return segments;
}

/**
 * Pion du participant actif (`mj.turn`, contrat §10, révision du 21/11/2026) sur cet étage, ou
 * `null` : hors tour, pion non posé ou sur un autre étage.
 *
 * @param {readonly Token[]} tokens
 * @param {string} levelId
 * @param {string|null|undefined} ref
 * @returns {Token|null}
 */
export function activeTurnToken(tokens, levelId, ref) {
  return ref ? tokenForRef(tokens, levelId, ref) : null;
}

/** Or du halo du tour : tranche sur le liseré des camps, le trait orange des engagements et le sang. */
export const ACTIVE_TURN_COLOR = '#facc15';

export class EngagementsLayer {
  /**
   * Halo du pion actif, **écran MJ seul** (combat du 21/11/2026) : le MJ voit d'un coup d'œil qui
   * joue, sans toucher chaque pion. Un anneau doré, cerné de sombre, posé AUTOUR de l'emprise —
   * il ne couvre ni le portrait ni les badges du pion.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {GridAdapter} grid
   * @param {Level|null} level
   * @param {{ tokens?: readonly Token[], ref?: string|null, zoom?: number }} [options]
   * @returns {boolean} true si un halo a été dessiné
   */
  renderActiveTurn(ctx, grid, level, options = {}) {
    if (!ctx || !grid || !level) return false;
    const token = activeTurnToken(options.tokens ?? [], level.id, options.ref);
    if (!token) return false;
    const bounds = grid.cellBounds({ cellX: token.cell.a, cellY: token.cell.b }, Math.max(1, token.sizeCells || 1));
    const centre = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    // Épaisseurs en pixels ÉCRAN : visible au zoom « carte entière » comme de près.
    const k = 1 / Math.max(0.01, options.zoom ?? 1);
    const rayon = Math.max(bounds.width, bounds.height) / 2 + 7 * k;
    ctx.save();
    for (const [width, color] of /** @type {const} */ ([[16, 'rgba(250, 204, 21, 0.28)'], [8, 'rgba(15, 23, 42, 0.9)'], [4.5, ACTIVE_TURN_COLOR]])) {
      ctx.lineWidth = width * k;
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.arc(centre.x, centre.y, rayon, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
    return true;
  }

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

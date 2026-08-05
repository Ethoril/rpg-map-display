// @ts-check

import { TOKEN_HIT_MARGIN_SCREEN_PX, TOKEN_HIT_MAX_CELL_RATIO } from '../core/constants.js';

/**
 * Calcul de la distance d'un point au RECTANGLE d'un pion en unités carte.
 * Si le point est à l'intérieur du rectangle, la distance est 0.
 *
 * @param {{x: number, y: number}} pt
 * @param {{x: number, y: number, w: number, h: number}} rect
 * @returns {number}
 */
export function distancePointToRectangle(pt, rect) {
  const dx = Math.max(rect.x - pt.x, 0, pt.x - (rect.x + rect.w));
  const dy = Math.max(rect.y - pt.y, 0, pt.y - (rect.y + rect.h));
  return Math.hypot(dx, dy);
}

/**
 * Recherche exacte par case (sans marge). Utilisé pour la vérification
 * d'occupation de la case cible lors d'un déplacement.
 *
 * @param {import('../core/types.js').Level} activeLevel
 * @param {{a: number, b: number}} cell
 * @param {import('../core/types.js').Token[]} tokens
 * @param {{ filter?: (token: import('../core/types.js').Token) => boolean }} [options]
 * @returns {import('../core/types.js').Token|null}
 */
export function exactTokenAtCell(activeLevel, cell, tokens, options = {}) {
  if (!activeLevel || !cell || !tokens) return null;
  const filter = options.filter;

  for (const token of tokens) {
    if (token.levelId !== activeLevel.id) continue;
    if (filter && !filter(token)) continue;

    const size = token.sizeCells || 1;
    if (
      cell.a >= token.cell.a &&
      cell.a < token.cell.a + size &&
      cell.b >= token.cell.b &&
      cell.b < token.cell.b + size
    ) {
      return token;
    }
  }

  return null;
}

/**
 * Un pion que le joueur peut manipuler lui-même : un PJ, non interdit, non verrouillé.
 *
 * Les trois conditions sont défensives et cumulatives — les PNJ restent réservés au MJ même si
 * une donnée incohérente les marque `playerMovable`.
 *
 * ⚠ Cette notion est celle de la **vue joueurs**, et d'elle seule. Le MJ manipule les PNJ comme
 * les PJ : lui l'appliquer déclasserait précisément les pions qu'il désigne le plus. C'est pour
 * ça que `findHitToken` reçoit un prédicat en paramètre et n'en câble aucun.
 *
 * @param {import('../core/types.js').Token} token
 * @returns {boolean}
 */
export function isPlayerManipulableToken(token) {
  return token.kind === 'pc' && token.playerMovable !== false && !token.locked;
}

/**
 * Option de recherche pour `findHitToken`
 *
 * @typedef {Object} FindHitTokenOptions
 * @property {(token: import('../core/types.js').Token) => boolean} [filter] Pions candidats.
 *   Absent = tous. La vue joueurs y exclut les `hidden`, le MJ non.
 * @property {(token: import('../core/types.js').Token) => boolean} [deprioritize] Pions à
 *   **classer après** les autres à distance comparable, sans pour autant les rendre
 *   indésignables. Chaque vue a le sien : le MJ y met `locked` (il doit pouvoir désigner un pion
 *   verrouillé pour le déverrouiller, mais pas au détriment d'un voisin libre) ; la vue joueurs
 *   y met tout ce qui n'est pas `isPlayerManipulableToken`.
 */

/**
 * Recherche le pion le plus proche sous le tap/point en appliquant une marge en pixels écran,
 * plafonnée par une fraction de taille de case en unités carte.
 *
 * Signature alignée sur `portalHit.js` : grid en 1er.
 *
 * @param {import('../grid/GridAdapter.js').GridAdapter} grid
 * @param {import('../core/types.js').Level} activeLevel
 * @param {{x: number, y: number}} mapPos
 * @param {number} zoom
 * @param {import('../core/types.js').Token[]} tokens
 * @param {FindHitTokenOptions} [options]
 * @returns {import('../core/types.js').Token|null}
 */
export function findHitToken(grid, activeLevel, mapPos, zoom, tokens = [], options = {}) {
  if (!activeLevel || !mapPos || !tokens || tokens.length === 0) return null;

  const origin0 = grid.mapFromCellPoint({ cellX: 0, cellY: 0 });
  const origin1 = grid.mapFromCellPoint({ cellX: 1, cellY: 0 });
  const gridScale = Math.abs(origin1.x - origin0.x);

  const safeZoom = zoom > 0 ? zoom : 1;
  const marginMap = Math.min(
    TOKEN_HIT_MARGIN_SCREEN_PX / safeZoom,
    TOKEN_HIT_MAX_CELL_RATIO * gridScale
  );

  const filter = options.filter;
  const deprioritize = options.deprioritize;

  /** @type {{ token: import('../core/types.js').Token, dist: number, inside: boolean, deprioritized: boolean } | null} */
  let best = null;

  for (const token of tokens) {
    if (token.levelId !== activeLevel.id) continue;
    if (filter && !filter(token)) continue;

    const size = token.sizeCells || 1;
    const pTopLeft = grid.mapFromCellPoint({ cellX: token.cell.a, cellY: token.cell.b });
    const pBottomRight = grid.mapFromCellPoint({ cellX: token.cell.a + size, cellY: token.cell.b + size });

    const rect = {
      x: Math.min(pTopLeft.x, pBottomRight.x),
      y: Math.min(pTopLeft.y, pBottomRight.y),
      w: Math.abs(pBottomRight.x - pTopLeft.x),
      h: Math.abs(pBottomRight.y - pTopLeft.y),
    };

    const dist = distancePointToRectangle(mapPos, rect);
    if (dist <= marginMap) {
      const inside = dist <= 1e-6;
      const deprioritized = deprioritize ? deprioritize(token) : false;

      if (!best) {
        best = { token, dist, inside, deprioritized };
        continue;
      }

      // 1. Un pion exactement sous le doigt (dist=0) l'emporte TOUJOURS sur un pion dans la marge.
      //    Cet ordre-là n'est pas cosmétique : c'est ce qui rend la marge sûre (brief O §3), et
      //    aucun déclassement ne doit passer devant lui — sinon un pion à 15 px vole la
      //    désignation d'un pion sous le doigt.
      if (inside && !best.inside) {
        best = { token, dist, inside, deprioritized };
        continue;
      } else if (!inside && best.inside) {
        continue;
      }

      // 2. À inclusion égale, un pion déclassé passe après un pion qui ne l'est pas.
      if (!deprioritized && best.deprioritized) {
        best = { token, dist, inside, deprioritized };
        continue;
      } else if (deprioritized && !best.deprioritized) {
        continue;
      }

      // 3. Plus proche par distance euclidienne
      const distDiff = dist - best.dist;
      if (distDiff < -1e-6) {
        best = { token, dist, inside, deprioritized };
      } else if (Math.abs(distDiff) <= 1e-6) {
        // 4. Départage déterministe et stable par ID
        if (String(token.id) < String(best.token.id)) {
          best = { token, dist, inside, deprioritized };
        }
      }
    }
  }

  return best ? best.token : null;
}

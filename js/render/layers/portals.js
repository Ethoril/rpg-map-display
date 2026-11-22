// @ts-check

import {
  PORTAL_OPEN_LINE_SCREEN_PX,
  PORTAL_OPEN_DASH_SCREEN_PX,
  PORTAL_CLOSED_LINE_SCREEN_PX,
  PORTAL_CLOSED_DASH_SCREEN_PX,
  PORTAL_LOCKED_LINE_SCREEN_PX,
  PORTAL_LOCK_DOT_RADIUS_SCREEN_PX,
  PORTAL_LOCK_DOT_MAX_SEGMENT_RATIO,
  PORTAL_LOCK_DOT_BORDER_SCREEN_PX,
  PORTAL_LOCKED_FLASH_MS,
} from '../../core/constants.js';
import { cellKey } from '../../core/cellKey.js';
import { isPlayerManipulableToken } from '../../input/tokenHit.js';

/**
 * @typedef {import('../../core/types.js').Level} Level
 * @typedef {import('../../core/types.js').Token} Token
 * @typedef {import('../../core/types.js').MapPoint} MapPoint
 * @typedef {import('../../grid/GridAdapter.js').GridAdapter} GridAdapter
 * @typedef {{ x: number, y: number, width: number, height: number }} MapRect
 * @typedef {{ portalId: string, tokenId: string, rect: MapRect, enabled: boolean }} PortalButton
 */

const DOOR_BUTTON_SCREEN_PX = 44;

/**
 * Teste le croisement strict du segment `[a1, a2]` avec `[b1, b2]` en unités carte.
 * Retourne les paramètres `(u, t)` dans `]0, 1[` s'ils se croisent franchement, `null` sinon.
 *
 * @param {MapPoint} a1 @param {MapPoint} a2 @param {MapPoint} b1 @param {MapPoint} b2
 * @returns {{ u: number, t: number }|null}
 */
function strictSegmentCrossing(a1, a2, b1, b2) {
  const rx = a2.x - a1.x;
  const ry = a2.y - a1.y;
  const sx = b2.x - b1.x;
  const sy = b2.y - b1.y;
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) <= 1e-9) return null;
  const qx = b1.x - a1.x;
  const qy = b1.y - a1.y;
  const u = (qx * sy - qy * sx) / denom;
  const t = (qx * ry - qy * rx) / denom;
  if (u > 1e-6 && u < 1 - 1e-6 && t > 1e-6 && t < 1 - 1e-6) {
    return { u, t };
  }
  return null;
}

/**
 * Géométrie pure des boutons d'adjacence aux portes côté joueurs (décisions 2, 3, 4 et 5 du
 * 22/11/2026). Appelée à la fois par le rendu (`PortalsLayer.renderButtons`) et par le test de
 * tap (`js/ui/player/bootstrap.js`) pour qu'il n'y ait jamais deux géométries divergentes.
 *
 * - Porte `locked` : aucun bouton (CA9).
 * - Pour chaque PJ déplaçable adjacent à une porte ouvrable (`open` ou `closed`), le bouton se
 *   pose sur la case de l'autre côté du segment par rapport à la case du PJ (CA6).
 * - Deux PJ de part et d'autre de la même porte : un seul bouton, décalé d'un demi-bouton le
 *   long du segment (CA7).
 * - En session liée avec un tour actif sur un autre pion : `enabled: false` (bouton grisé, CA10).
 * - `rect` est en unités CARTE, côté `44 / zoom` (même repère que `intention.mapPos`).
 *
 * @param {GridAdapter} grid
 * @param {Level} level
 * @param {readonly Token[]} tokens
 * @param {{ zoom?: number, turn?: { tokenId: string }|null }} [options]
 * @returns {PortalButton[]}
 */
export function boutonsPorte(grid, level, tokens, options = {}) {
  if (!grid || !level || !Array.isArray(level.portals) || level.portals.length === 0 || !Array.isArray(tokens)) {
    return [];
  }

  const zoom = options.zoom && options.zoom > 0 ? options.zoom : 1;
  const turn = options.turn ?? null;
  const side = DOOR_BUTTON_SCREEN_PX / zoom;

  const movablePcs = tokens.filter(
    (token) => token.levelId === level.id && !token.hidden && isPlayerManipulableToken(token, null)
  );
  if (movablePcs.length === 0) return [];

  /** @type {PortalButton[]} */
  const buttons = [];

  for (const portal of level.portals) {
    if (portal.state === 'locked') continue;
    const pA = grid.mapFromGeometryPoint({ cellX: portal.a.cellX, cellY: portal.a.cellY });
    const pB = grid.mapFromGeometryPoint({ cellX: portal.b.cellX, cellY: portal.b.cellY });
    const segDx = pB.x - pA.x;
    const segDy = pB.y - pA.y;
    const segLenSq = segDx * segDx + segDy * segDy;
    if (segLenSq <= 1e-9) continue;
    const segLen = Math.sqrt(segLenSq);
    const mid = { x: (pA.x + pB.x) / 2, y: (pA.y + pB.y) / 2 };

    /** @type {{ token: Token, enabled: boolean, oppositeCenter: MapPoint, sideSign: number }[]} */
    const candidates = [];

    for (const token of movablePcs) {
      const occupied = grid.cellsOccupied(token.cell, Math.max(1, token.sizeCells || 1));
      const occupiedKeys = new Set(occupied.map(cellKey));

      /** @type {{ stepDist: number, distToMid: number, key: string, cFrom: MapPoint, cTo: MapPoint }|null} */
      let best = null;

      for (const cell of occupied) {
        const cFrom = grid.pointFromCell(cell);
        for (const neighbor of grid.neighbors(cell)) {
          const nKey = cellKey(neighbor);
          if (occupiedKeys.has(nKey)) continue;
          const cTo = grid.pointFromCell(neighbor);
          if (!strictSegmentCrossing(cFrom, cTo, pA, pB)) continue;

          const stepDist = grid.distance(cell, neighbor);
          // En carré, une arête diagonale (1,5) ne retient la porte que si les deux centres se
          // projettent sur le segment (porte oblique) — cela évite qu'un coin de mur fasse
          // apparaître un bouton sur une porte axiale voisine. En hexagone, les 6 voisines valent 1.
          if (stepDist > 1 + 1e-6) {
            const projFrom = ((cFrom.x - pA.x) * segDx + (cFrom.y - pA.y) * segDy) / segLenSq;
            const projTo = ((cTo.x - pA.x) * segDx + (cTo.y - pA.y) * segDy) / segLenSq;
            if (projFrom < -1e-6 || projFrom > 1 + 1e-6 || projTo < -1e-6 || projTo > 1 + 1e-6) {
              continue;
            }
          }

          const distToMid = Math.hypot(cTo.x - mid.x, cTo.y - mid.y);
          if (
            !best ||
            stepDist < best.stepDist - 1e-6 ||
            (Math.abs(stepDist - best.stepDist) <= 1e-6 &&
              (distToMid < best.distToMid - 1e-6 ||
                (Math.abs(distToMid - best.distToMid) <= 1e-6 && nKey < best.key)))
          ) {
            best = { stepDist, distToMid, key: nKey, cFrom, cTo };
          }
        }
      }

      if (best) {
        const cross = segDx * (best.cFrom.y - pA.y) - segDy * (best.cFrom.x - pA.x);
        candidates.push({
          token,
          enabled: isPlayerManipulableToken(token, turn),
          oppositeCenter: best.cTo,
          sideSign: cross >= 0 ? 1 : -1,
        });
      }
    }

    if (candidates.length === 0) continue;

    // Priorité au pion actif (enabled: true), puis ordre déterministe par identifiant.
    candidates.sort((a, b) => {
      if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
      return String(a.token.id) < String(b.token.id) ? -1 : String(a.token.id) > String(b.token.id) ? 1 : 0;
    });

    const chosen = candidates[0];
    const hasPositive = candidates.some((c) => c.sideSign > 0);
    const hasNegative = candidates.some((c) => c.sideSign < 0);

    /** @type {MapPoint} */
    let center;
    if (hasPositive && hasNegative) {
      // Deux PJ de part et d'autre : un seul bouton, décalé d'un demi-bouton le long du segment.
      let tx = segDx / segLen;
      let ty = segDy / segLen;
      if (ty < -1e-9 || (Math.abs(ty) <= 1e-9 && tx < 0)) {
        tx = -tx;
        ty = -ty;
      }
      center = { x: mid.x + tx * (side / 2), y: mid.y + ty * (side / 2) };
    } else {
      center = chosen.oppositeCenter;
    }

    buttons.push({
      portalId: portal.id,
      tokenId: chosen.token.id,
      rect: {
        x: center.x - side / 2,
        y: center.y - side / 2,
        width: side,
        height: side,
      },
      enabled: chosen.enabled,
    });
  }

  return buttons;
}

/**
 * Trace un rectangle arrondi sur le contexte Canvas courant.
 * @param {CanvasRenderingContext2D} ctx
 * @param {MapRect} rect
 * @param {number} radius
 */
function traceRoundedRect(ctx, rect, radius) {
  const r = Math.min(radius, rect.width / 2, rect.height / 2);
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(rect.x, rect.y, rect.width, rect.height, r);
  } else {
    ctx.moveTo(rect.x + r, rect.y);
    ctx.lineTo(rect.x + rect.width - r, rect.y);
    ctx.quadraticCurveTo(rect.x + rect.width, rect.y, rect.x + rect.width, rect.y + r);
    ctx.lineTo(rect.x + rect.width, rect.y + rect.height - r);
    ctx.quadraticCurveTo(rect.x + rect.width, rect.y + rect.height, rect.x + rect.width - r, rect.y + rect.height);
    ctx.lineTo(rect.x + r, rect.y + rect.height);
    ctx.quadraticCurveTo(rect.x, rect.y + rect.height, rect.x, rect.y + rect.height - r);
    ctx.lineTo(rect.x, rect.y + r);
    ctx.quadraticCurveTo(rect.x, rect.y, rect.x + r, rect.y);
    ctx.closePath();
  }
}

/**
 * Couche d'affichage de l'indicateur d'état des trois états de portail.
 * Plaisante et discrète entre la grille et la zone de mouvement.
 *
 * **Toutes ses grandeurs sont écrites en pixels écran puis divisées par le zoom.** Le contexte
 * reçu est déjà mis à l'échelle par `camera.applyToContext` : une épaisseur écrite crûment y
 * serait une épaisseur *carte*, donc juste à zoom 1 et fausse partout ailleurs. Voir les
 * constantes `PORTAL_*_SCREEN_PX`.
 */
export class PortalsLayer {
  /**
   * Rendu des portails d'un étage.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {GridAdapter} grid
   * @param {Level} level
   * @param {{ zoom?: number, flash?: { portalId: string, at: number }|null, now?: number }} [options]
   * @returns {{ renderedCount: number, animationActive: boolean }}
   */
  render(ctx, grid, level, options = {}) {
    const result = { renderedCount: 0, animationActive: false };
    if (!ctx || !grid || !level || !Array.isArray(level.portals) || level.portals.length === 0) {
      return result;
    }

    const zoom = options.zoom && options.zoom > 0 ? options.zoom : 1;
    /**
     * Pixels écran → pixels carte, l'unique conversion de cette couche.
     * @param {number} screenPx
     * @returns {number}
     */
    const px = (screenPx) => screenPx / zoom;
    const flash = options.flash ?? null;
    const now = options.now ?? 0;

    ctx.save();

    for (const portal of level.portals) {
      const state = portal.state;
      const pA = grid.mapFromGeometryPoint({ cellX: portal.a.cellX, cellY: portal.a.cellY });
      const pB = grid.mapFromGeometryPoint({ cellX: portal.b.cellX, cellY: portal.b.cellY });

      // Le battement d'une porte verrouillée qu'on vient de taper. Relevé ici pour n'être écrit
      // qu'une fois, mais il ne concerne que `locked`.
      let flashProgress = 0;
      if (flash && flash.portalId === portal.id) {
        const age = now - flash.at;
        if (age >= 0 && age < PORTAL_LOCKED_FLASH_MS) {
          flashProgress = 1 - age / PORTAL_LOCKED_FLASH_MS;
          result.animationActive = true;
        }
      }

      ctx.save();

      if (!state || state === 'closed') {
        // Porte fermée : pointillé rouge, jumeau exact du vert de la porte ouverte.
        //
        // ⛔ Ne pas revenir au « rien à dessiner » d'avant le 16 août 2026 sous prétexte que le
        // fond de carte montre déjà le battant. Le fond montre un battant ; il ne dit pas que
        // c'est une porte, ni qu'elle s'ouvre au doigt. Aux joueurs, qui ne voient pas la couche
        // des murs, une porte fermée était strictement indiscernable du décor.
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = px(PORTAL_CLOSED_LINE_SCREEN_PX);
        ctx.setLineDash([px(PORTAL_CLOSED_DASH_SCREEN_PX), px(PORTAL_CLOSED_DASH_SCREEN_PX)]);
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        ctx.moveTo(pA.x, pA.y);
        ctx.lineTo(pB.x, pB.y);
        ctx.stroke();
      } else if (state === 'open') {
        // Porte ouverte : trait discret vert discontinu le long du segment
        ctx.strokeStyle = '#22c55e';
        ctx.lineWidth = px(PORTAL_OPEN_LINE_SCREEN_PX);
        ctx.setLineDash([px(PORTAL_OPEN_DASH_SCREEN_PX), px(PORTAL_OPEN_DASH_SCREEN_PX)]);
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        ctx.moveTo(pA.x, pA.y);
        ctx.lineTo(pB.x, pB.y);
        ctx.stroke();
      } else if (state === 'locked') {
        // Porte verrouillée : ligne rouge avec cadenas central
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = px(PORTAL_LOCKED_LINE_SCREEN_PX);
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        ctx.moveTo(pA.x, pA.y);
        ctx.lineTo(pB.x, pB.y);
        ctx.stroke();

        // Marqueur central (disque rouge avec bordure blanche), borné par la longueur de la
        // porte pour ne jamais la recouvrir entièrement.
        const segmentScreenLength = Math.hypot(pB.x - pA.x, pB.y - pA.y) * zoom;
        const dotRadiusScreen = Math.min(
          PORTAL_LOCK_DOT_RADIUS_SCREEN_PX,
          (segmentScreenLength * PORTAL_LOCK_DOT_MAX_SEGMENT_RATIO) / 2
        );
        const midX = (pA.x + pB.x) / 2;
        const midY = (pA.y + pB.y) / 2;
        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.arc(midX, midY, px(dotRadiusScreen), 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = px(PORTAL_LOCK_DOT_BORDER_SCREEN_PX);
        ctx.stroke();

        // Le battement : un halo qui se resserre sur le cadenas. Il ne déplace ni ne masque
        // l'indicateur, il l'entoure — l'information reste lisible pendant le signal.
        if (flashProgress > 0) {
          ctx.globalAlpha = 0.9 * flashProgress;
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = px(2);
          ctx.beginPath();
          ctx.arc(
            midX,
            midY,
            px(dotRadiusScreen + 4 + 14 * (1 - flashProgress)),
            0,
            Math.PI * 2
          );
          ctx.stroke();
        }
      }

      ctx.restore();
      result.renderedCount++;
    }

    ctx.restore();
    return result;
  }

  /**
   * Dessine les boutons d'ouverture / fermeture de porte côté joueurs, dans le rang `feedback`
   * (au-dessus du brouillard, CA8). Utilise `boutonsPorte` comme source unique de géométrie.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {GridAdapter} grid
   * @param {Level} level
   * @param {readonly Token[]} tokens
   * @param {{ zoom?: number, turn?: { tokenId: string }|null }} [options]
   * @returns {number} Nombre de boutons dessinés
   */
  renderButtons(ctx, grid, level, tokens, options = {}) {
    if (!ctx || !grid || !level) return 0;
    const buttons = boutonsPorte(grid, level, tokens, options);
    if (buttons.length === 0) return 0;

    const zoom = options.zoom && options.zoom > 0 ? options.zoom : 1;
    const px = (/** @type {number} */ screenPx) => screenPx / zoom;

    ctx.save();
    ctx.font = `600 ${px(11)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (const button of buttons) {
      const portal = level.portals.find((p) => p.id === button.portalId);
      const isOpen = portal?.state === 'open';
      const label = isOpen ? 'Fermer' : 'Ouvrir';

      ctx.save();
      if (!button.enabled) {
        ctx.globalAlpha = 0.55;
      }
      traceRoundedRect(ctx, button.rect, px(8));
      ctx.fillStyle = button.enabled ? 'rgba(15, 23, 42, 0.9)' : 'rgba(51, 65, 85, 0.85)';
      ctx.fill();
      ctx.strokeStyle = !button.enabled ? '#94a3b8' : isOpen ? '#f59e0b' : '#22c55e';
      ctx.lineWidth = px(button.enabled ? 2 : 1.5);
      ctx.stroke();

      ctx.fillStyle = button.enabled ? '#ffffff' : '#cbd5e1';
      ctx.fillText(
        label,
        button.rect.x + button.rect.width / 2,
        button.rect.y + button.rect.height / 2,
        button.rect.width - px(4)
      );
      ctx.restore();
    }

    ctx.restore();
    return buttons.length;
  }
}

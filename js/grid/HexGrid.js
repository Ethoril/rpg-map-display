// @ts-check

import { reachableCells } from '../movement/reachable.js';

/** @typedef {import('../core/types.js').Cell} Cell */
/** @typedef {import('../core/types.js').CellPoint} CellPoint */
/** @typedef {import('../core/types.js').MapPoint} MapPoint */
/** @typedef {import('../core/types.js').Level} Level */
/** @typedef {import('./GridAdapter.js').GridAdapter} GridAdapter */

const SQRT3 = Math.sqrt(3);
const SQRT3_OVER_2 = SQRT3 / 2;

/**
 * Adaptateur de grille hexagonale (pointe en haut / pointy-topped).
 * Stockage externe en coordonnées décalées `odd-r` (colonne a, rangée b).
 * Calculs internes (voisines, distance) convertis en axial/cubique (q, r).
 *
 * @implements {GridAdapter}
 */
export class HexGrid {
  /**
   * @param {Level} level
   */
  constructor(level) {
    /** @type {'hex'} */
    this.type = 'hex';
    this.pxPerCell = level.pxPerCell;
    this.widthCells = level.widthCells;
    this.heightCells = level.heightCells;
    this.offsetX = level.grid?.offsetX ?? 0;
    this.offsetY = level.grid?.offsetY ?? 0;
    this.color = level.grid?.color ?? '#000000';
    this.opacity = level.grid?.opacity ?? 0.25;
    this.visible = level.grid?.visible ?? true;
  }

  /**
   * Pixels carte → cellule {a: col, b: row} (odd-r) avec arrondi cubique exact.
   * Retourne null si hors bornes.
   *
   * @param {MapPoint} p
   * @returns {Cell|null}
   */
  cellFromPoint(p) {
    const dy = (p.y - this.offsetY) / this.pxPerCell - 0.5;
    const r_f = dy / SQRT3_OVER_2;
    const dx = (p.x - this.offsetX) / this.pxPerCell - 0.5;
    const q_f = dx - 0.5 * r_f;
    const s_f = -q_f - r_f;

    let q = Math.round(q_f);
    let r = Math.round(r_f);
    let s = Math.round(s_f);

    const q_diff = Math.abs(q - q_f);
    const r_diff = Math.abs(r - r_f);
    const s_diff = Math.abs(s - s_f);

    if (q_diff > r_diff && q_diff > s_diff) {
      q = -r - s;
    } else if (r_diff > s_diff) {
      r = -q - s;
    }

    const col = q + (r >> 1);
    const row = r;

    if (col < 0 || col >= this.widthCells || row < 0 || row >= this.heightCells) {
      return null;
    }

    return { a: col, b: row };
  }

  /**
   * Cellule → CENTRE de la case en pixels carte (odd-r).
   *
   * @param {Cell} cell
   * @returns {MapPoint}
   */
  pointFromCell(cell) {
    return {
      x: this.offsetX + this.pxPerCell * (cell.a + 0.5 * (cell.b & 1) + 0.5),
      y: this.offsetY + this.pxPerCell * (cell.b * SQRT3_OVER_2 + 0.5),
    };
  }

  /**
   * Unité de case fractionnaire (odd-r) → pixels carte.
   *
   * @param {CellPoint} cp
   * @returns {MapPoint}
   */
  mapFromCellPoint(cp) {
    const rowInt = Math.floor(cp.cellY);
    return {
      x: this.offsetX + this.pxPerCell * (cp.cellX + 0.5 * (rowInt & 1) + 0.5),
      y: this.offsetY + this.pxPerCell * (cp.cellY * SQRT3_OVER_2 + 0.5),
    };
  }

  /**
   * Pixels carte → unité de case fractionnaire (odd-r).
   *
   * @param {MapPoint} p
   * @returns {CellPoint}
   */
  cellPointFromMap(p) {
    const dy = (p.y - this.offsetY) / this.pxPerCell - 0.5;
    const cellY = dy / SQRT3_OVER_2;
    const rowInt = Math.floor(cellY);
    const dx = (p.x - this.offsetX) / this.pxPerCell - 0.5 - 0.5 * (rowInt & 1);
    return { cellX: dx, cellY };
  }

  /**
   * Voisines adjacentes (les 6 voisines hexagonales, calculées en axial).
   *
   * @param {Cell} cell
   * @returns {Cell[]}
   */
  neighbors(cell) {
    /** @type {Cell[]} */
    const res = [];
    const q = cell.a - (cell.b >> 1);
    const r = cell.b;

    const dirs = [
      [1, 0], [1, -1], [0, -1],
      [-1, 0], [-1, 1], [0, 1],
    ];

    for (const [dq, dr] of dirs) {
      const nq = q + dq;
      const nr = r + dr;
      const ncol = nq + (nr >> 1);
      const nrow = nr;
      if (ncol >= 0 && ncol < this.widthCells && nrow >= 0 && nrow < this.heightCells) {
        res.push({ a: ncol, b: nrow });
      }
    }
    return res;
  }

  /**
   * Distance hexagonale uniforme (calculée en axial).
   *
   * @param {Cell} a
   * @param {Cell} b
   * @returns {number}
   */
  distance(a, b) {
    const qA = a.a - (a.b >> 1);
    const rA = a.b;
    const qB = b.a - (b.b >> 1);
    const rB = b.b;

    const dq = qA - qB;
    const dr = rA - rB;
    return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
  }

  /**
   * Arêtes franchissables depuis la cellule.
   *
   * @param {Cell} cell
   * @returns {Array<[Cell, Cell]>}
   */
  edgesOf(cell) {
    return this.neighbors(cell).map((n) => [cell, n]);
  }

  /**
   * Cases couvertes par un pion (rosette centrée).
   *
   * @param {Cell} cell
   * @param {number} sizeCells
   * @returns {Cell[]}
   */
  cellsOccupied(cell, sizeCells) {
    const radius = Math.max(0, Math.floor(sizeCells) - 1);
    /** @type {Cell[]} */
    const res = [];
    const centerQ = cell.a - (cell.b >> 1);
    const centerR = cell.b;

    for (let dq = -radius; dq <= radius; dq++) {
      for (let dr = Math.max(-radius, -dq - radius); dr <= Math.min(radius, -dq + radius); dr++) {
        const q = centerQ + dq;
        const r = centerR + dr;
        const col = q + (r >> 1);
        const row = r;
        if (col >= 0 && col < this.widthCells && row >= 0 && row < this.heightCells) {
          res.push({ a: col, b: row });
        }
      }
    }
    return res;
  }

  /**
   * Énumère toutes les cellules de l'étage (rectangle odd-r 0..width × 0..height).
   *
   * @param {number} widthCells
   * @param {number} heightCells
   * @returns {Cell[]}
   */
  allCells(widthCells, heightCells) {
    /** @type {Cell[]} */
    const res = [];
    for (let col = 0; col < widthCells; col++) {
      for (let row = 0; row < heightCells; row++) {
        res.push({ a: col, b: row });
      }
    }
    return res;
  }

  /**
   * @param {Cell} from
   * @param {number} budget
   * @param {Set<string>} blockedEdges
   * @param {Map<string, number>} [terrainCost]
   * @returns {Map<string, number>}
   */
  cellsInRange(from, budget, blockedEdges, terrainCost) {
    return reachableCells(this, from, budget, blockedEdges, terrainCost);
  }

  /**
   * Trace le quadrillage hexagonal sur le contexte Canvas 2D.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @returns {void}
   */
  renderGrid(ctx) {
    if (this.visible === false || this.opacity <= 0 || !ctx) return;

    ctx.save();
    ctx.strokeStyle = this.color;
    ctx.globalAlpha = this.opacity;
    ctx.lineWidth = 1;

    const R = this.pxPerCell / SQRT3;

    ctx.beginPath();
    for (let col = 0; col < this.widthCells; col++) {
      for (let row = 0; row < this.heightCells; row++) {
        const center = this.pointFromCell({ a: col, b: row });
        for (let i = 0; i < 6; i++) {
          const angle = (Math.PI / 6) + (i * Math.PI / 3);
          const vx = center.x + R * Math.cos(angle);
          const vy = center.y + R * Math.sin(angle);
          if (i === 0) ctx.moveTo(vx, vy);
          else ctx.lineTo(vx, vy);
        }
        ctx.closePath();
      }
    }
    ctx.stroke();
    ctx.restore();
  }
}

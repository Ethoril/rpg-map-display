// @ts-check

import { reachableCells } from '../movement/reachable.js';

/** @typedef {import('../core/types.js').Cell} Cell */
/** @typedef {import('../core/types.js').CellPoint} CellPoint */
/** @typedef {import('../core/types.js').MapPoint} MapPoint */
/** @typedef {import('../core/types.js').Level} Level */
/** @typedef {import('./GridAdapter.js').GridAdapter} GridAdapter */

/**
 * Adaptateur de grille carrée.
 * @implements {GridAdapter}
 */
export class SquareGrid {
  /**
   * @param {Level} level
   */
  constructor(level) {
    /** @type {'square'} */
    this.type = 'square';
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
   * Pixels carte → cellule (index entier {a, b}). Retourne null si hors carte.
   *
   * @param {MapPoint} p
   * @returns {Cell|null}
   */
  cellFromPoint(p) {
    const a = Math.floor((p.x - this.offsetX) / this.pxPerCell);
    const b = Math.floor((p.y - this.offsetY) / this.pxPerCell);
    if (a < 0 || a >= this.widthCells || b < 0 || b >= this.heightCells) {
      return null;
    }
    return { a, b };
  }

  /**
   * Cellule → CENTRE de la case en pixels carte.
   *
   * @param {Cell} cell
   * @returns {MapPoint}
   */
  pointFromCell(cell) {
    return {
      x: this.offsetX + (cell.a + 0.5) * this.pxPerCell,
      y: this.offsetY + (cell.b + 0.5) * this.pxPerCell,
    };
  }

  /**
   * Unité de case fractionnaire → pixels carte.
   *
   * @param {CellPoint} cp
   * @returns {MapPoint}
   */
  mapFromCellPoint(cp) {
    return {
      x: this.offsetX + cp.cellX * this.pxPerCell,
      y: this.offsetY + cp.cellY * this.pxPerCell,
    };
  }

  /**
   * Pixels carte → unité de case fractionnaire.
   *
   * @param {MapPoint} p
   * @returns {CellPoint}
   */
  cellPointFromMap(p) {
    return {
      cellX: (p.x - this.offsetX) / this.pxPerCell,
      cellY: (p.y - this.offsetY) / this.pxPerCell,
    };
  }

  /**
   * Voisines adjacentes (8 en grille carrée).
   *
   * @param {Cell} cell
   * @returns {Cell[]}
   */
  neighbors(cell) {
    /** @type {Cell[]} */
    const res = [];
    const dirs = [
      [-1, -1], [0, -1], [1, -1],
      [-1,  0],          [1,  0],
      [-1,  1], [0,  1], [1,  1],
    ];
    for (const [da, db] of dirs) {
      const na = cell.a + da;
      const nb = cell.b + db;
      if (na >= 0 && na < this.widthCells && nb >= 0 && nb < this.heightCells) {
        res.push({ a: na, b: nb });
      }
    }
    return res;
  }

  /**
   * Distance en cases (coût octile : orthogonal 1, diagonale 1.5).
   *
   * @param {Cell} a
   * @param {Cell} b
   * @returns {number}
   */
  distance(a, b) {
    const dx = Math.abs(a.a - b.a);
    const dy = Math.abs(a.b - b.b);
    return Math.max(dx, dy) + 0.5 * Math.min(dx, dy);
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
   * Cases couvertes par un pion (bloc n×n en carré).
   *
   * @param {Cell} cell
   * @param {number} sizeCells
   * @returns {Cell[]}
   */
  cellsOccupied(cell, sizeCells) {
    /** @type {Cell[]} */
    const res = [];
    const size = Math.max(1, Math.floor(sizeCells));
    for (let da = 0; da < size; da++) {
      for (let db = 0; db < size; db++) {
        res.push({ a: cell.a + da, b: cell.b + db });
      }
    }
    return res;
  }

  /**
   * @param {number} widthCells
   * @param {number} heightCells
   * @returns {Cell[]}
   */
  allCells(widthCells, heightCells) {
    /** @type {Cell[]} */
    const res = [];
    for (let a = 0; a < widthCells; a++) {
      for (let b = 0; b < heightCells; b++) {
        res.push({ a, b });
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
   * Trace le quadrillage sur le contexte Canvas 2D.
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
    ctx.beginPath();

    const startX = this.offsetX;
    const endX = this.offsetX + this.widthCells * this.pxPerCell;
    const startY = this.offsetY;
    const endY = this.offsetY + this.heightCells * this.pxPerCell;

    for (let col = 0; col <= this.widthCells; col++) {
      const x = this.offsetX + col * this.pxPerCell;
      ctx.moveTo(x, startY);
      ctx.lineTo(x, endY);
    }

    for (let row = 0; row <= this.heightCells; row++) {
      const y = this.offsetY + row * this.pxPerCell;
      ctx.moveTo(startX, y);
      ctx.lineTo(endX, y);
    }

    ctx.stroke();
    ctx.restore();
  }
}

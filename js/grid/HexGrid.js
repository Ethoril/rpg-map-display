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
    // Décalage horizontal du RÉSEAU des hexagones par rapport à la géométrie d'étage, en pixels
    // carte (amendement D-11, `docs/CONVENTIONS.md` §1). Le passage en hexagones depuis le panneau
    // MJ le pose à −pxPerCell/4 pour qu'aucun centre ne tombe sur une bordure de case carrée, là
    // où passent les murs. ⛔ Il décale tout ce qui dépend du réseau — et rien d'autre : ni
    // `mapExtent` (le cadre de l'image), ni la géométrie (`mapFromGeometryPoint`).
    this.hexShiftX = level.grid?.hexShiftX ?? 0;
    /** Origine horizontale du réseau : `offsetX + hexShiftX`. */
    this.latticeX = this.offsetX + this.hexShiftX;
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
    const dx = (p.x - this.latticeX) / this.pxPerCell - 0.5;
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
      x: this.latticeX + this.pxPerCell * (cell.a + 0.5 * (cell.b & 1) + 0.5),
      y: this.offsetY + this.pxPerCell * (cell.b * SQRT3_OVER_2 + 0.5),
    };
  }

  /**
   * Unité de case fractionnaire (odd-r) → pixels carte. Rend le COIN de la case, comme
   * `SquareGrid.mapFromCellPoint` — pas son centre (C-5, `docs/QUESTIONS-EN-ATTENTE.md`).
   * Le `0.5 * (rowInt & 1)` n'est PAS du centrage : c'est le décalage odd-r qui aligne la
   * colonne des rangées impaires, il reste.
   * ⛔ Lecture du RÉSEAU (`hexShiftX` compris) : pour les pions. La géométrie d'étage se lit par
   * `mapFromGeometryPoint` (D-11).
   *
   * @param {CellPoint} cp
   * @returns {MapPoint}
   */
  mapFromCellPoint(cp) {
    const rowInt = Math.floor(cp.cellY);
    return {
      x: this.latticeX + this.pxPerCell * (cp.cellX + 0.5 * (rowInt & 1)),
      y: this.offsetY + this.pxPerCell * (cp.cellY * SQRT3_OVER_2),
    };
  }

  /**
   * Géométrie d'étage → pixels carte, **lue en carré** (amendement D-11) : ni décalage odd-r,
   * ni pas √3/2, ni `hexShiftX`. Identique à `SquareGrid.mapFromGeometryPoint`.
   *
   * @param {CellPoint} cp
   * @returns {MapPoint}
   */
  mapFromGeometryPoint(cp) {
    return {
      x: this.offsetX + cp.cellX * this.pxPerCell,
      y: this.offsetY + cp.cellY * this.pxPerCell,
    };
  }

  /**
   * Réciproque exacte de `mapFromGeometryPoint`.
   *
   * @param {MapPoint} p
   * @returns {CellPoint}
   */
  geometryPointFromMap(p) {
    return {
      cellX: (p.x - this.offsetX) / this.pxPerCell,
      cellY: (p.y - this.offsetY) / this.pxPerCell,
    };
  }

  /**
   * Étendue de la carte en pixels, depuis l'origine de l'espace carte — voir le contrat dans
   * `GridAdapter.js`. ⛔ Cadre de l'image : `hexShiftX` n'y entre pas (D-11).
   *
   * ⭐ **L'axe Y n'a pas la même échelle que l'axe X** : les rangées hexagonales ne sont espacées
   * que de √3/2 case. Et la largeur ne porte **aucun** décalage odd-r — c'est tout l'objet de
   * cette méthode.
   *
   * @returns {{width: number, height: number}}
   */
  mapExtent() {
    return {
      width: this.offsetX + this.widthCells * this.pxPerCell,
      height: this.offsetY + this.heightCells * this.pxPerCell * SQRT3_OVER_2,
    };
  }

  /**
   * Pas de la grille par axe — voir le contrat dans `GridAdapter.js`.
   *
   * @returns {{x: number, y: number}}
   */
  cellPitch() {
    return { x: this.pxPerCell, y: this.pxPerCell * SQRT3_OVER_2 };
  }

  /**
   * Rectangle couvert par un masque de l'étage — voir le contrat dans `GridAdapter.js`. Même
   * échelle par axe que `composeVisibleMask` : une colonne vaut `pxPerCell`, une rangée
   * `pxPerCell × √3/2`.
   * ⛔ Il commence à l'origine de l'IMAGE (`offsetX`), pas à celle du réseau : ses dimensions sont
   * figées à `widthCells × 8` pixels de masque (`CONVENTIONS.md` §3), et calé sur un réseau décalé
   * de `hexShiftX` il laissait hors de tout masque une bande de |hexShiftX| pixels au bord droit
   * de l'image — sous le voile et sans lumière pour toujours (D-11). Le décalage du réseau par
   * rapport au masque est rendu par `maskLatticeShift`.
   *
   * @returns {{x: number, y: number, width: number, height: number}}
   */
  maskRect() {
    return {
      x: this.offsetX,
      y: this.offsetY,
      width: this.widthCells * this.pxPerCell,
      height: this.heightCells * this.pxPerCell * SQRT3_OVER_2,
    };
  }

  /**
   * Décalage horizontal du réseau par rapport au masque, en colonnes — voir le contrat dans
   * `GridAdapter.js`. `hexShiftX / pxPerCell` : −0,25 sur un étage passé en hexagones depuis le
   * panneau, 0 sinon.
   *
   * @returns {number}
   */
  maskLatticeShift() {
    return this.hexShiftX / this.pxPerCell;
  }

  /**
   * Cellule → CENTRE de la case, en pixels carte (odd-r). Alias explicite de
   * `pointFromCell` pour l'API sans ambiguïté de G-1 (`docs/QUESTIONS-EN-ATTENTE.md` C-5).
   *
   * @param {Cell} cell
   * @returns {MapPoint}
   */
  cellCenter(cell) {
    return this.pointFromCell(cell);
  }

  /**
   * Boîte englobante d'un pion en pixels carte. L'ancre `cp` est la position (fractionnaire
   * pour l'animation de déplacement) de son CENTRE — même formule que le centre rendu par
   * `mapFromCellPoint` — et la boîte est centrée dessus, à la taille d'un hexagone pointe en
   * haut mis à l'échelle de `sizeCells`. Jamais reconstruite par différence de deux centres :
   * c'est cette différence, dépendante de la parité de rangée, qui rendait les pions faux
   * (C-5). À 140 px/case et taille 1 : largeur 140 px, hauteur 161,66 px.
   *
   * @param {CellPoint} cp Position (fractionnaire) du centre de l'ancrage.
   * @param {number} sizeCells
   * @returns {{x: number, y: number, width: number, height: number}}
   */
  cellBounds(cp, sizeCells) {
    const size = Math.max(1, sizeCells || 1);
    const rowInt = Math.floor(cp.cellY);
    const centerX = this.latticeX + this.pxPerCell * (cp.cellX + 0.5 * (rowInt & 1) + 0.5);
    const centerY = this.offsetY + this.pxPerCell * (cp.cellY * SQRT3_OVER_2 + 0.5);
    // ⛔ **La boîte doit couvrir exactement les cases de `cellsOccupied`, ni plus ni moins.**
    // Un pion qui déborde semble bloquer un passage qu'il laisse libre ; un pion trop petit
    // laisse croire l'inverse. Ce n'est pas une préférence de dessin, c'est la cohérence entre
    // ce que la table voit et ce que la règle applique.
    //
    // `cellsOccupied` occupe le **disque hexagonal** de rayon `sizeCells - 1` : 1 case en
    // taille 1, 7 en taille 2, 19 en taille 3. Une mise à l'échelle linéaire de la boîte —
    // `size * pxPerCell` — rendait donc un pion de taille 2 **d'un tiers trop petit** (280 px
    // au lieu de 420 à 140 px/case), et ne couvrait pas la couronne de voisins qu'il occupe.
    //
    // Étendue réelle d'une rosette de rayon R, en pointe-en-haut : les colonnes s'espacent de
    // `pxPerCell`, d'où `(2R+1)` de large ; les rangées s'espacent de `pxPerCell·√3/2`, d'où
    // `R·pxPerCell·√3` plus la hauteur d'un hexagone entier.
    const radius = Math.max(0, size - 1);
    const width = (2 * radius + 1) * this.pxPerCell;
    const height = radius * this.pxPerCell * SQRT3 + this.pxPerCell * (2 / SQRT3);
    return {
      x: centerX - width / 2,
      y: centerY - height / 2,
      width,
      height,
    };
  }

  /**
   * Pixels carte → unité de case fractionnaire (odd-r). Inverse exacte de `mapFromCellPoint`
   * ci-dessus : même retrait du centrage, même décalage de rangée conservé.
   *
   * @param {MapPoint} p
   * @returns {CellPoint}
   */
  cellPointFromMap(p) {
    const dy = (p.y - this.offsetY) / this.pxPerCell;
    const cellY = dy / SQRT3_OVER_2;
    const rowInt = Math.floor(cellY);
    const dx = (p.x - this.latticeX) / this.pxPerCell - 0.5 * (rowInt & 1);
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
   * Ajoute au chemin courant le contour hexagonal (six sommets) de la case, comme sous-chemin :
   * ne remplit ni ne trace rien, c'est l'appelant qui décide (voir `GridAdapter.cellPath`).
   * Géométrie pointe-en-haut centrée sur `pointFromCell` — celle validée à l'œil par
   * `renderGrid`, qui l'appelle désormais au lieu de la dupliquer.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {Cell} cell
   * @returns {void}
   */
  cellPath(ctx, cell) {
    const R = this.pxPerCell / SQRT3;
    const center = this.pointFromCell(cell);
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 6) + (i * Math.PI / 3);
      const vx = center.x + R * Math.cos(angle);
      const vy = center.y + R * Math.sin(angle);
      if (i === 0) ctx.moveTo(vx, vy);
      else ctx.lineTo(vx, vy);
    }
    ctx.closePath();
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

    ctx.beginPath();
    for (let col = 0; col < this.widthCells; col++) {
      for (let row = 0; row < this.heightCells; row++) {
        this.cellPath(ctx, { a: col, b: row });
      }
    }
    ctx.stroke();
    ctx.restore();
  }
}

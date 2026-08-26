// @ts-check
/** @typedef {import('../core/types.js').Cell} Cell */
/** @typedef {import('../core/types.js').CellPoint} CellPoint */
/** @typedef {import('../core/types.js').GridType} GridType */
/** @typedef {import('../core/types.js').MapPoint} MapPoint */

/**
 * Abstraction de topologie de grille. SEUL endroit du projet autorisé à connaître
 * `pxPerCell` et la géométrie des cases.
 *
 * @typedef {Object} GridAdapter
 *
 * @property {GridType} type
 *
 * @property {(p: MapPoint) => Cell|null} cellFromPoint
 *   Pixels carte → cellule. `null` hors carte. En hexagone : arrondi cubique.
 *
 * @property {(cell: Cell) => MapPoint} pointFromCell
 *   Cellule → CENTRE de la case, en pixels carte.
 *
 * @property {(cp: CellPoint) => MapPoint} mapFromCellPoint
 *   Unité de case fractionnaire → pixels carte. Applique `pxPerCell` ET l'offset issu de
 *   `map_origin`. Sert au rendu des murs, portails et lumières importés.
 *   ⚠ Contrat ambigu, conservé pour ces seuls appelants (G-1) : `SquareGrid` y rend le
 *   **coin** haut-gauche de la case, `HexGrid` en rend le **centre**. Ne jamais en déduire
 *   une boîte englobante par différence de deux appels — voir `cellBounds`.
 *
 * @property {(p: MapPoint) => CellPoint} cellPointFromMap
 *   Réciproque. Sert à l'éditeur de murs du lot 2.
 *
 * @property {(cell: Cell) => MapPoint} cellCenter
 *   Cellule → CENTRE de la case, en pixels carte. Sans ambiguïté par construction (G-1) :
 *   contrairement à `mapFromCellPoint`, cette méthode rend toujours un centre, dans les
 *   deux pavages.
 *
 * @property {(cp: CellPoint, sizeCells: number) => {x: number, y: number, width: number, height: number}} cellBounds
 *   Boîte englobante d'un pion (ou de tout élément de `sizeCells` cases de côté) ancré à
 *   `cp`, en pixels carte. `cp` est en unité de case fractionnaire, au même sens que
 *   l'argument de `mapFromCellPoint` — coin haut-gauche en grille carrée, position du
 *   centre en grille hexagonale. Calculée directement à partir de la géométrie de la case
 *   et de sa taille, **jamais** par différence de deux appels à `mapFromCellPoint` : c'est
 *   précisément cette différence qui rendait les pions hexagonaux faux selon la parité de
 *   rangée (C-5, `docs/QUESTIONS-EN-ATTENTE.md`).
 *
 * @property {(cell: Cell) => Cell[]} neighbors
 *   Voisines adjacentes. 8 en carré (diagonales incluses), 6 en hexagone.
 *
 * @property {(a: Cell, b: Cell) => number} distance
 *   Distance en cases. Octile en carré, uniforme en hexagone.
 *
 * @property {(cell: Cell) => Array<[Cell, Cell]>} edgesOf
 *   Paires (cell, voisine) définissant les arêtes franchissables de la case.
 *
 * @property {(cell: Cell, sizeCells: number) => Cell[]} cellsOccupied
 *   Cases couvertes par un pion. Bloc n×n en carré. Convention hexagonale à trancher.
 *
 * @property {(from: Cell, budget: number, blockedEdges: Set<string>, terrainCost?: Map<string,number>) => Map<string, number>} cellsInRange
 *   Dijkstra pondéré. Clé = cellKey, valeur = coût cumulé. Interdit le corner-cutting en
 *   carré : une diagonale exige les deux arêtes orthogonales adjacentes libres.
 *
 * @property {(widthCells: number, heightCells: number) => Cell[]} allCells
 *   Énumère toutes les cellules de l'étage pour les dimensions données.
 *
 * @property {(ctx: CanvasRenderingContext2D, viewport?: object) => void} renderGrid
 *   Trace le quadrillage sur le contexte 2D. Seule dépendance de rendu tolérée dans l'adaptateur.
 */
export {}

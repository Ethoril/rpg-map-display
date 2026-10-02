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
 *   `map_origin`, et en hexagonal le décalage `hexShiftX` du réseau.
 *   ⭐ Rend le COIN de la case (C-5, `docs/QUESTIONS-EN-ATTENTE.md`) : les entiers dénotent
 *   l'origine de la grille, pas son centre. **Pour un centre, appeler `pointFromCell` /
 *   `cellCenter`, jamais celle-ci.** Ne jamais déduire une boîte englobante par différence
 *   de deux appels — voir `cellBounds`.
 *   ⛔ **Lecture de la GRILLE courante** (odd-r et pas √3/2 en hexagonal) : elle sert aux
 *   positions de pions. Un sommet de mur, une extrémité de portail ou une lumière posée se
 *   lisent par `mapFromGeometryPoint` (amendement D-11, `docs/CONVENTIONS.md` §1).
 *
 * @property {(cp: CellPoint) => MapPoint} mapFromGeometryPoint
 *   Géométrie d'étage (murs, portails, lumières posées) → pixels carte. **Toujours lue en
 *   carré**, quel que soit le pavage : `offsetX + cellX × pxPerCell`, `offsetY + cellY ×
 *   pxPerCell` (amendement D-11). La géométrie appartient à l'image, pas à la grille :
 *   changer de pavage ne la déplace pas d'un pixel. ⛔ `hexShiftX` n'y entre pas — c'est le
 *   réseau des hexagones qu'il décale par rapport à elle.
 *
 * @property {(p: MapPoint) => CellPoint} geometryPointFromMap
 *   Réciproque exacte de `mapFromGeometryPoint`. Sert à l'éditeur de murs et à la pose de
 *   lumière.
 *
 * @property {() => {width: number, height: number}} mapExtent
 *   Étendue de la carte en pixels, **mesurée depuis l'origine de l'espace carte (0,0)** —
 *   l'offset de la grille y est donc inclus. C'est la taille sur laquelle on cadre la
 *   caméra. ⛔ **Pas** celle vers laquelle on agrandit un masque : voir `maskRect`.
 *   ⭐ C'est le **cadre de l'image** (fond, vidéo, caméra) : il ne dépend pas de `hexShiftX`
 *   (D-11). Décaler le réseau des hexagones ne déplace pas l'image.
 *
 * @property {() => {x: number, y: number}} cellPitch
 *   Pas de la grille en pixels carte, PAR AXE : écart entre deux colonnes (`x`) et entre deux
 *   rangées (`y`). En carré les deux valent `pxPerCell` ; en hexagonal les rangées ne sont
 *   espacées que de √3/2 case (E-11). C'est la « taille d'une case » qu'il faut aux longueurs
 *   exprimées en cases — rayon d'un gabarit, portée d'un pinceau — et qu'on recopiait par
 *   différence de deux `mapFromCellPoint` (audit du 22/09, D3 et H4).
 *
 * @property {() => {x: number, y: number, width: number, height: number}} maskRect
 *   Rectangle, en pixels carte, que couvre un masque de `widthCells × heightCells` cases
 *   (brouillard, vision, champ lumineux) : il commence à l'origine de la grille, **offset
 *   compris**, et non en (0,0). ⛔ Étirer un masque sur `mapExtent()` le décalait d'autant
 *   qu'il y a d'offset — jusqu'à une demi-case de vision au-delà d'un mur (audit du 22/09,
 *   A1). Ce qui est hors de ce rectangle n'est couvert par aucun masque.
 *   ⭐ **C'est aussi l'origine du masque** : tout ce qui projette des pixels carte dans un masque
 *   (révélation, vision, champ lumineux, pinceau) prend `(maskRect().x, maskRect().y)`. En
 *   hexagonal décalé (D-11), elle diffère de `mapFromCellPoint({cellX: 0, cellY: 0})` : le masque
 *   reste calé sur l'image, de dimensions figées, et c'est le réseau qui se décale par rapport à lui.
 *
 * @property {() => number} maskLatticeShift
 *   Décalage horizontal du réseau des cases par rapport à l'origine du masque, en colonnes
 *   (`hexShiftX / pxPerCell`, 0 en carré). Le seul renseignement dont `isCellVisibleInMask`, qui
 *   ne connaît pas la grille, a besoin pour retrouver le centre d'une case dans le masque (D-11).
 *
 *   ⛔ **Ne JAMAIS la reconstituer par `mapFromCellPoint({cellX: widthCells, cellY: heightCells})`.**
 *   Ce point porte le décalage odd-r `0,5 × (rangée & 1)`, qui dit où commence une rangée
 *   impaire et n'a rien à voir avec la largeur de la carte : sur une carte hexagonale à nombre
 *   de rangées **impair**, il rend une demi-case de trop. C'est exactement ce qui a produit les
 *   dettes **E-12** (masque de brouillard et champ lumineux étirés) et **E-13** (cadrage caméra),
 *   à six endroits qui recopiaient tous la même erreur.
 *
 * @property {(p: MapPoint) => CellPoint} cellPointFromMap
 *   Réciproque, dans la lecture de la grille courante. ⛔ Jamais pour la géométrie d'étage :
 *   voir `geometryPointFromMap`.
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
 *
 * @property {(ctx: CanvasRenderingContext2D, cell: Cell) => void} cellPath
 *   Ajoute au CHEMIN COURANT (`ctx`) le contour de la case, comme sous-chemin : ne remplit ni
 *   ne trace rien, c'est l'appelant qui décide. `SquareGrid` y trace le carré de la case,
 *   `HexGrid` le vrai hexagone — **jamais** une boîte englobante (`cellBounds`), qui déborde
 *   sur les cases voisines en hexagonal et annoncerait au joueur des cases hors de portée.
 */
export {}

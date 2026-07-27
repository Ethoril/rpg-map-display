# ARCHITECTURE — manifeste de fichiers & interfaces

> **Document normatif et fermé.** Aucun fichier ne doit être créé s'il n'est pas listé ici.
> Un besoin non couvert se signale, il ne s'improvise pas.
>
> À lire après `docs/STACK.md` et `docs/CONVENTIONS.md`.

---

## 1. Arborescence

Les fichiers marqués `[1a]` `[1b]` `[2]` `[3]` `[4]` indiquent le lot qui les crée.
Ceux marqués `[stub]` existent dès le lot 1a mais ne contiennent qu'une interface ou une
implémentation qui lève.

```
F:\rpg-map-display\
│
├─ index.html                     [1a] vue MJ. Import map créée en T-03b (domicile unique
│                                      des versions), reste de la page construit en T-22
├─ player.html                    [1a] vue joueurs — URL autonome, zéro UI. Import map
│                                      IDENTIQUE à index.html (T-23)
├─ jsconfig.json                  [1a] checkJs strict, noEmit
├─ package.json                   [1a] scripts Node uniquement
├─ .gitattributes                 [1a] * text=auto eol=lf
├─ .gitignore                     [1a]
│
├─ css/
│   ├─ gm.css                     [1a] vue MJ
│   └─ player.css                 [1a] Zero-UI, overscroll/touch-action
│
├─ js/
│   ├─ core/
│   │   ├─ types.js               [1a] tous les @typedef partagés — AUCUN code exécutable
│   │   ├─ constants.js           [1a] FOG_PX_PER_CELL, seuils, limites
│   │   ├─ cellKey.js             [1a] cellKey, parseCellKey, edgeKey
│   │   ├─ version.js             [1a] ⚙ GÉNÉRÉ par scripts/stamp-version.mjs
│   │   └─ schema.js              [1a] fabriques + validation du document de campagne
│   │
│   ├─ grid/
│   │   ├─ GridAdapter.js         [1a] interface documentée (JSDoc) — aucune implémentation
│   │   ├─ SquareGrid.js          [1a] implémentation carrée
│   │   ├─ HexGrid.js             [4]  implémentation hexagonale
│   │   └─ index.js               [1a] gridFor(level) → GridAdapter
│   │
│   ├─ transport/
│   │   ├─ Transport.js           [1a] interface documentée
│   │   ├─ FirebaseTransport.js   [1a] SEUL fichier autorisé à importer firebase/*
│   │   └─ LocalSocketTransport.js [stub] lève « non implémenté » jusqu'au besoin réel
│   │
│   ├─ state/
│   │   ├─ store.js               [1a] source de vérité + signal de changement
│   │   ├─ selection.js           [1a] pion sélectionné, cases atteignables courantes
│   │   └─ presence.js            [1a] clients connectés + détection d'écart de build
│   │
│   ├─ import/
│   │   ├─ uvtt.js                [1a] parsing UVTT pur (aucune I/O, aucun DOM)
│   │   ├─ imageCalibrate.js      [1a] image simple → grille (source B)
│   │   └─ blockedEdges.js        [2]  segments UVTT → Set<edgeKey>
│   │
│   ├─ movement/
│   │   ├─ reachable.js           [1a] Dijkstra pondéré → Map<cellKey, coût>
│   │   └─ path.js                [1a] chaîne de prédécesseurs → chemin de cases
│   │
│   ├─ vision/
│   │   ├─ sweep.js               [2]  visibilité 2D → polygone
│   │   └─ fog.js                 [2]  masque raster, OR, encodage PNG
│   │
│   ├─ render/
│   │   ├─ stage.js               [1a] Application Pixi + ordre des couches
│   │   ├─ camera.js              [1a] SEUL fichier convertissant carte ⇄ écran
│   │   ├─ frame.js               [1a] boucle à la demande (coalescence rAF)
│   │   └─ layers/
│   │       ├─ background.js      [1a] image de fond
│   │       ├─ gridLayer.js       [1a] délègue le tracé à GridAdapter.renderGrid
│   │       ├─ moveZone.js        [1a] cases atteignables — NON interactif
│   │       ├─ tokens.js          [1a] pions, badges élévation/marqueurs
│   │       ├─ fogLayer.js        [2]  masque + trois états de rendu
│   │       └─ templates.js       [2]  gabarits de zone d'effet
│   │
│   ├─ input/
│   │   ├─ pointer.js             [1a] pointerdown/move/up → intentions abstraites
│   │   └─ gestures.js            [1a] pan, pinch, tap, appui long
│   │
│   ├─ ui/
│   │   ├─ versionBadge.js        [1a] affichage partagé MJ (permanent) / joueurs (transitoire)
│   │   ├─ gm/
│   │   │   ├─ panel.js           [1a] panneau latéral (conteneur)
│   │   │   ├─ importPanel.js     [1a] import UVTT + image, calibration
│   │   │   ├─ tokenMaker.js      [1a] générateur de pions (recadrage canvas)
│   │   │   ├─ sceneLibrary.js    [1b] bibliothèque de cartes
│   │   │   ├─ tokenLibrary.js    [1b] bibliothèque de pions
│   │   │   ├─ handouts.js        [1b] révélation d'image
│   │   │   ├─ fogTools.js        [2]  pinceaux révéler/masquer, reset
│   │   │   ├─ wallEditor.js      [2]  éditeur minimal de murs
│   │   │   └─ levelSelector.js   [3]  sélecteur d'étage MJ
│   │   └─ player/
│   │       ├─ bootstrap.js       [1a] montage de la vue joueurs
│   │       ├─ handoutOverlay.js  [1b] plein écran d'image révélée
│   │       └─ levelSelector.js   [3]  sélecteur d'étage joueurs
│   │
│   └─ app/
│       ├─ gm.js                  [1a] point d'entrée vue MJ
│       └─ player.js              [1a] point d'entrée vue joueurs
│
├─ scripts/
│   ├─ import-uvtt.mjs            [1a] CLI Node : .uvtt → maps/ + document de scène
│   ├─ resample.mjs               [1a] rééchantillonnage d'image (Node)
│   ├─ make-fixture.mjs           [1a] génère les fixtures de test
│   ├─ stamp-version.mjs          [1a] écrit js/core/version.js
│   └─ check-deps.mjs             [1a] vérifie les URLs de l'import map (HEAD 200 + registre)
│
├─ fixtures/                      [1a] cf. docs/FIXTURES.md
├─ maps/                          [1a] images traitées, commitées
├─ tests/                         [1a] Playwright + tests unitaires
└─ docs/
    ├─ CAHIER-DES-CHARGES.md      spécification fonctionnelle (source de vérité du « quoi »)
    ├─ STACK.md                   versions & idiomes
    ├─ CONVENTIONS.md             conventions & interdictions
    ├─ ARCHITECTURE.md            ce document
    ├─ TASKS-lot1a.md             découpage en tâches
    └─ FIXTURES.md                jeux de données de test
```

---

## 2. Règles d'importation

C'est **le mécanisme d'application** des abstractions. Chaque règle est vérifiable
mécaniquement (§4).

| Module | Peut importer | Ne doit JAMAIS importer |
|---|---|---|
| `core/*` | rien (sauf `core/*`) | tout le reste |
| `grid/*` | `core/*` | `render/*`, `state/*`, `transport/*`, `ui/*` |
| `transport/*` | `core/*` | `render/*`, `grid/*`, `ui/*` |
| `state/*` | `core/*`, `grid/*` | `render/*`, `ui/*`, `transport/*` |
| `import/*` | `core/*`, `grid/*` | `render/*`, `ui/*`, `transport/*`, `state/*` |
| `movement/*` | `core/*`, `grid/*` | tout le reste |
| `vision/*` | `core/*` | `grid/*`, `render/*`, `ui/*`, `state/*` |
| `render/*` | `core/*`, `grid/*`, `state/*` | `transport/*`, `ui/*`, `import/*` |
| `input/*` | `core/*` | `render/*`, `state/*` |
| `ui/*` | tout sauf `transport/*` en direct | `firebase/*` |
| `app/*` | tout | — |

**Trois règles portantes, à ne jamais assouplir :**

1. **`vision/*` n'importe pas `grid/*`.** La visibilité opère sur des segments et produit
   un polygone : elle ignore totalement la topologie de grille. C'est ce qui rend
   l'hexagone bon marché.
2. **Seul `transport/FirebaseTransport.js` importe `firebase/*`.** Le reste du code ne
   connaît que l'interface. C'est ce qui rend le mode LAN possible sans refactor.
3. **Seul `grid/*` fait de l'arithmétique `pxPerCell`, seul `render/camera.js` convertit
   vers l'écran.**

---

## 3. Interfaces — à écrire en premier, avant toute implémentation

Ces trois fichiers constituent le contrat. Ils sont créés et validés **avant** que quoi que
ce soit ne les implémente.

### `js/core/types.js`

Aucun code exécutable, uniquement des `@typedef`. Reprend le schéma du cahier des charges
§6 sans le réinterpréter.

```js
// @ts-check

/** Couple opaque, ENTIER. Carré : (colonne, ligne). Hexagone : axial (q, r). @typedef {{a:number,b:number}} Cell */
/** Unité de case, FRACTIONNAIRE. Géométrie UVTT. @typedef {{cellX:number,cellY:number}} CellPoint */
/** Pixels de l'image de fond. @typedef {{x:number,y:number}} MapPoint */
/** Pixels du canvas. @typedef {{screenX:number,screenY:number}} ScreenPoint */
/** @typedef {'square'|'hex'} GridType */

// Noms de propriétés distincts à dessein : le typage étant structurel, c'est la seule
// façon de rendre un mélange d'unités impossible à compiler. Cf. CONVENTIONS.md §1.

/**
 * @typedef {Object} Token
 * @property {string} id
 * @property {string} levelId
 * @property {Cell} cell          position — TOUJOURS entière
 * @property {number} sizeCells
 * @property {'pc'|'npc'} kind
 * @property {string} imageUrl
 * @property {string} borderColor
 * @property {string} label
 * @property {boolean} hidden
 * @property {number} visionBright
 * @property {number} visionDim
 * @property {{range:number,intensity:number,color:string}|null} emitsLight
 * @property {number} speedCells
 * @property {boolean} playerMovable
 * @property {boolean} locked
 * @property {number} elevation
 * @property {string[]} markers
 */

/** @typedef {Object} Level  … cf. cahier des charges §6 */
/** @typedef {Object} Campaign … */
/** @typedef {{type:string,payload:object,at:number,by:'gm'|'players'}} NetEvent */
```

### `js/grid/GridAdapter.js`

Interface pure. Aucune implémentation dans ce fichier.

```js
// @ts-check
/** @typedef {import('../core/types.js').Cell} Cell */
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
 *
 * @property {(p: MapPoint) => CellPoint} cellPointFromMap
 *   Réciproque. Sert à l'éditeur de murs du lot 2.
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
 * @property {(from: Cell, budget: number, blockedEdges: Set<string>,
 *             terrainCost?: Map<string,number>) => Map<string, number>} cellsInRange
 *   Dijkstra pondéré. Clé = cellKey, valeur = coût cumulé. Interdit le corner-cutting en
 *   carré : une diagonale exige les deux arêtes orthogonales adjacentes libres.
 *
 * @property {(g: import('pixi.js').Graphics, viewport: object) => void} renderGrid
 *   Trace le quadrillage. Seule dépendance de rendu tolérée dans l'adaptateur.
 */
export {}
```

### `js/transport/Transport.js`

```js
// @ts-check
/** @typedef {import('../core/types.js').NetEvent} NetEvent */

/**
 * Abstraction de synchronisation. L'hébergement devient un choix d'exécution.
 *
 * @typedef {Object} Transport
 * @property {(sessionId: string, role: 'gm'|'players') => Promise<void>} connect
 * @property {(event: NetEvent) => void} publish
 * @property {(handler: (e: NetEvent) => void) => () => void} subscribe  retourne un désabonnement
 * @property {() => Promise<object>} snapshot   état complet — TOUJOURS avant les deltas
 * @property {() => void} disconnect
 */
export {}
```

---

## 4. Tests de conformité architecturale

Ces tests ne vérifient pas des fonctionnalités, ils **empêchent l'architecture de se
dégrader**. Ils sont écrits au lot 1a et ne doivent jamais être désactivés.

`tests/architecture.test.mjs` :

1. **`pxPerCell` confiné** — aucune occurrence hors de `js/grid/`, à **deux exceptions
   près** : sa *déclaration* de champ dans `js/core/types.js` et sa lecture dans
   `js/core/schema.js`. Le test cible l'**arithmétique**, pas la mention du nom. Ne jamais
   renommer le champ pour faire passer le test.
2. **Firebase confiné** — aucun `import … 'firebase/…'` hors de
   `js/transport/FirebaseTransport.js`.
3. **Pas de coordonnées nommées** — aucune occurrence de `.col`, `.row`, `.q`, `.r` sur un
   objet cellule dans tout `js/`.
4. **`vision/` indépendant de la grille** — aucun import de `grid/` dans `js/vision/`.
5. **Manifeste respecté** — tout fichier de `js/` figure dans ce document.
6. **Règles d'importation** — le tableau §2 est vérifié fichier par fichier.
7. **Versions centralisées** — aucun numéro de version ni URL de CDN dans un `.js`.

Un échec de l'un de ces tests **bloque la tâche**, même si la fonctionnalité marche.

---

## 5. Ordre des couches de rendu

Du fond vers la surface. Ordre figé : il détermine la lisibilité à table.

```
1. background      image de fond (ou vidéo)
2. gridLayer       quadrillage
3. moveZone        cases atteignables        ← non interactif
4. templates       gabarits de zone d'effet
5. tokens          pions + badges
6. fogLayer        masque de fog             ← au-dessus des pions
7. (DOM)           overlays : révélation d'image, sélecteur d'étage
```

`fogLayer` **au-dessus** de `tokens` : c'est ce qui garantit mécaniquement l'interdiction
n°3 des conventions — un pion en zone non visible est masqué par le fog, pas par une
condition d'affichage qu'on peut oublier.

---

## 6. Vue joueurs — contraintes de montage

`player.html` est autonome et paramétrable par l'URL :

```
player.html?session=<id>&camera=follow
```

- Sans `camera=follow` : caméra locale libre.
- Avec : la caméra suit celle publiée par la tablette (repli si le cast déçoit).

CSS obligatoire dans `player.css` :

```css
html, body { overscroll-behavior: none; overflow: hidden; margin: 0; }
canvas     { touch-action: none; display: block; }
*          { user-select: none; -webkit-user-select: none; }
```

Et au montage : `screen.orientation.lock('landscape')` (échec toléré), Wake Lock si le
contexte est sécurisé, plein écran ou PWA `display: fullscreen`.

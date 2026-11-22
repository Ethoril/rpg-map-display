# Tour de jeu, portes et liaisons — plan

Le quoi est dans `CADRAGE-TOUR-DE-JEU-2026-11-22.md`. Ici le comment, confronté au `CLAUDE.md`
du projet.

## Approche

**Aucun fichier nouveau, aucun amendement du manifeste, aucune règle d'importation touchée.**
Les quatre changements se branchent sur des mécanismes déjà en place.

### 1. Les boutons sont dessinés sur la carte, pas en DOM

Le rang `feedback` du rendu joueurs est **déjà au-dessus du brouillard** : c'est là que
`linksLayer.renderPrompt` écrit l'invite d'escalier, précisément « parce que l'invite s'écrit dans
la case du voisin, que rien ne garantit explorée ». Les boutons s'y dessinent (CA8).

La géométrie de chaque bouton vient d'une fonction **pure et exportée**, appelée par le rendu
*et* par le test de tap — la leçon de `input/portalHit.js`, dont le commentaire d'en-tête dit que
deux copies promettaient « deux valeurs à régler pour un seul réglage » :

```js
// js/render/layers/portals.js
export function boutonsPorte(grid, level, tokens, options) // → [{ portalId, tokenId, rect, enabled }]
// js/render/layers/links.js
export function boutonLiaison(grid, level, links, token, options) // → { linkId, rect, label } | null
```

`rect` est en unités **carte** (comme `findHitPortal`), côté `44 / zoom` : même repère que
`intention.mapPos`, donc aucune conversion à écrire ailleurs. `js/ui/player/bootstrap.js` est en
`ui/*` et a le droit d'importer `render/*` (§2) ; l'inverse resterait interdit.

Le bouton de porte se pose sur la case **de l'autre côté du segment** par rapport à la case du PJ.
Deux PJ de part et d'autre : les deux calculs tombent sur la même porte, on n'en garde qu'un et on
le décale d'un demi-bouton (CA7).

### 2. Le tour vit dans le store comme la vision de session

`store.getSessionVision` / `setSessionVision` est le précédent exact : un état **de session, non
persisté**, hors de la campagne. Le tour suit le même profil, ce qui tient l'exigence « le tour
n'est ni persisté ni republié » du contrat §10 pour ce qu'elle protégeait (l'instantané Firestore).

```js
// js/state/store.js
export function getTurn()                        // → { tokenId, startCell, startLevelId, spentCells } | null
export function setTurn(tokenId, spentCells = 0) // null efface ; même tokenId → ne remet pas à zéro (CA19)
export function addTurnSpent(tokenId, cells)
export function undoTurnMove(tokenId)            // → la case de départ, ou lève si elle est occupée
```

`resetStore` l'efface. `setTurn` relit `startCell`/`startLevelId` sur le pion au moment du
changement de tour.

### 3. Le budget passe par le seul goulot existant

`movementRulesFor(token, level)` est le point de passage unique du budget (dix appelants).
Signature étendue : `movementRulesFor(token, level, spentCells = 0)`, qui retranche de `budget` et
de `walkBudget` (plancher 0) — CA18. **Le paramètre reste explicite** : `js/ui/player/gameHelp.js`
calcule la zone d'une carte fictive et ne doit jamais être bridé ; un store lu en douce depuis
`selection.js` l'aurait bridé aussi.

`js/app/movePlanning.js` lit `store.getTurn()` pour ses propres appels.

### 4. Ce qui consomme du mouvement est déjà distingué dans le code

`reportMove(tokenId, path)` de `js/app/gm.js` est appelé à **exactement** deux endroits : la
réception d'un `token.move` venu de la tablette (ligne ~1318) et la validation d'une préparation
sur l'écran MJ (ligne ~2075). Le **glisser libre ne l'appelle pas** (ligne ~2208 : « ce glisser
n'est pas un trajet marché »). C'est donc littéralement CA20, sans drapeau à inventer : le
compteur s'incrémente dans `reportMove`, le coût étant recalculé depuis `path` par
`movementStepCost`, comme `mjLink` le fait déjà pour `map.ran`.

### 5. Deux événements au CdC §7, aucune touche au protocole outil MJ

| Événement | Sens | Payload | Effet |
|---|---|---|---|
| `turn.select` | MJ → tablette | `{ tokenId: string\|null, spentCells?: number }` | Désigne le participant actif et le mouvement déjà consommé. Émis au changement de tour (`mj.turn`), après chaque `reportMove`, après une annulation, et à l'arrivée d'une présence joueurs. |
| `turn.undo` | tablette → MJ | `{ tokenId: string }` | Replace le pion sur sa case et son étage de début de tour, remet le compteur à zéro. Le MJ relit **sa** case de départ : la tablette ne l'envoie pas. |

L'instantané Firestore n'est pas touché (le tour n'y entre pas). La tablette rechargée en cours de
tour retrouve l'état par le `turn.select` que le MJ republie à l'arrivée de sa présence — même
idiome que l'outil MJ répondant `mj.snapshot` à `map.hello`.

`mjLink.activeTurn()` existe déjà (halo MJ) : il devient la source du `turn.select` publié.

### 6. Le bridage passe par `isPlayerManipulableToken`

Six appels dans la vue joueurs, tous dans `bootstrap.js` et `player.js`. Signature étendue :
`isPlayerManipulableToken(token, turn)` — `turn` absent ou `null` = aucun bridage (CA16), un pion
sans `link` n'est jamais bridé (CA17). Un PJ bridé retombe mécaniquement sur la branche
« consultation » déjà écrite pour un PJ non déplaçable (CA15), sans nouvelle interface.

### 7. Le bouton d'annulation est en DOM, comme le plein écran

`js/app/player.js` crée déjà ses boutons fixes en styles en ligne (`player-fullscreen-btn`,
`top: 12px; right: 12px`). Le bouton d'annulation suit le même moule à `right: 116px`, à gauche
de l'aide et du plein écran, présent seulement quand `getTurn()` désigne un PJ de la tablette avec
`spentCells > 0` (CA22, CA25, CA27).

## Complexité justifiée

- **Deux événements plutôt qu'un.** `turn.select` ne peut pas porter l'annulation : la case de
  départ est détenue par le MJ, et un `turn.select` émis par la tablette inverserait l'autorité.
- **Un paramètre de plus à deux fonctions pures** (`movementRulesFor`, `isPlayerManipulableToken`)
  au lieu d'une lecture du store à l'intérieur : voir §3 — le tutoriel et la vue MJ passeraient
  sinon sous une règle qui ne les concerne pas.
- Rien d'autre : pas de module, pas de couche de rendu, pas d'abstraction de bouton.

## Cas de refus à ne pas oublier

- **Case de départ occupée à l'annulation** : un autre pion a pu s'y poser. `undoTurnMove` lève,
  la tablette montre le retour transitoire « refusé » déjà en place, rien n'est publié.
- **Pion lié dont le `ref` disparaît** (mort, retiré de la scène) : `mj.turn` suit, `turn.select`
  passe à `null`, le bouton disparaît.
- **Étage** : un pion rendu à un autre étage par l'annulation ne fait basculer aucun écran
  (règle 4, UX-10).

## Vérification, critère par critère

| Critères | Comment |
|---|---|
| CA1–CA13 | `tests/tourDeJeu.test.mjs` : géométrie pure des boutons — côté opposé, fusion des deux PJ, porte verrouillée, grisé hors tour, absence pendant une préparation. |
| CA14–CA21 | `tests/tourDeJeu.test.mjs` : `isPlayerManipulableToken` avec et sans tour, pion non lié, `ref` null ; `movementRulesFor` avec `spentCells`, paliers Marche/Course décalés, budget épuisé ; `reportMove` qui incrémente, glisser qui n'incrémente pas. |
| CA1–CA13, CA22–CA27 | `tests/tourDeJeu.spec.mjs` (e2e, transport de test) : tap sur le bouton de porte, tap sur le bouton de liaison, toucher la porte qui n'ouvre plus, bouton d'annulation présent/absent, pion rendu à sa case, zone revenue à son budget, événement publié, brouillard non régressé. |

⚠ **Deux fichiers de test nouveaux** (`tests/tourDeJeu.test.mjs`, `tests/tourDeJeu.spec.mjs`) :
le test d'architecture n°5 ne lit que `js/` et `scripts/`, mais le manifeste est fermé pour tout
le dépôt — ils entrent au §1 d'`ARCHITECTURE.md` avec le reste de l'amendement. Aucun fichier
nouveau sous `js/`.
| Toutes | `pnpm run verify`, puis **mutation** de chaque mécanisme (casser l'effet, pas l'étiquette) avant de conclure. |

## Documents à amender en même temps que le code

- `CAHIER-DES-CHARGES.md` §5.3 (vue joueurs), §5.3bis (bande de sélection — voisinage du nouveau
  bouton), §7 (les deux événements).
- `CONVENTIONS.md` § « Vue joueurs » : trois dérogations nouvelles à la règle 2 (boutons de porte,
  bouton de liaison, bouton d'annulation), et l'amendement de la règle 1 (le re-tap ne franchit
  plus).
- `CONTRAT-LIAISON-OUTIL-MJ.md` §10 : la phrase « le tour n'est ni persisté ni republié » devient
  « non persisté, republié vers la tablette ». ⚠ **Changement à reporter dans la copie du dépôt
  outil MJ** ; aucun message du protocole ne change, la version ne bouge pas.
- `QUESTIONS-EN-ATTENTE.md` : section TJ, les sept arbitrages du 22/11/2026.
- `ETAT.md` : entrée de chantier dans la table « Suite produit ».

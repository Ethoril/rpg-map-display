# CONVENTIONS & INTERDICTIONS

> **Document normatif.** Il fixe les décisions que la spécification fonctionnelle laisse
> implicites, et que l'on résout systématiquement mal si on les improvise.
>
> **Règle d'or : en cas de doute, s'arrêter et demander.** Ne jamais « choisir
> raisonnablement » sur un point traité ici.

---

## 1. Les trois espaces de coordonnées

C'est la source d'erreur numéro un du projet. Trois espaces distincts coexistent et
**ne doivent jamais être mélangés**.

| Espace | Type | Unité | Forme |
|---|---|---|---|
| **Cellule discrète** | `Cell` | index de case, **entier** | `{a, b}` |
| **Cellule continue** | `CellPoint` | unité de case, **fractionnaire** | `{cellX, cellY}` |
| **Carte** | `MapPoint` | pixel de l'image de fond | `{x, y}` |
| **Écran** | `ScreenPoint` | pixel du canvas | `{screenX, screenY}` |

**Les quatre formes ont des noms de propriétés distincts, et c'est délibéré.** Le typage
JavaScript est structurel : deux types `{x, y}` sont interchangeables même si l'un est en
pixels et l'autre en cases. Des noms différents rendent le mélange **impossible à
compiler** — c'est le même mécanisme que `{a, b}` pour la topologie de grille.

`CellPoint` est indispensable et distinct de `Cell` : la géométrie importée d'un UVTT
(murs, portails, lumières, extrémités de liaison) est en unités de case mais
**fractionnaire** — un portail se pose en `{cellX: 4.5, cellY: 2}`. Ce ne sont pas des
index de case.

```js
/** @type {Cell} */      const cell = { a: 4, b: 7 }                  // ✅ index de case
/** @type {CellPoint} */ const wallVertex = { cellX: 4.5, cellY: 2 }  // ✅ case fractionnaire
/** @type {MapPoint} */  const p = { x: 560, y: 980 }                 // ✅ pixels carte

const q = { x: 4, y: 7 }             // ❌ espace indéterminé : interdit
const px = cell.a * 140              // ❌ conversion hors de GridAdapter
grid.cellFromPoint(wallVertex)       // ❌ ne compile pas — et c'est le but
```

**Trois conversions, trois seuls endroits autorisés :**

```
CellPoint ⇄ MapPoint      →  GridAdapter uniquement   (js/grid/*)
Cell      ⇄ MapPoint      →  GridAdapter uniquement   (js/grid/*)
MapPoint  ⇄ ScreenPoint   →  Camera uniquement        (js/render/camera.js)
```

> `CellPoint` → `MapPoint` est une simple multiplication par `pxPerCell` **plus l'offset issu
> de `map_origin`**. Oublier l'offset est le second piège UVTT. Il n'a lieu qu'à un seul
> endroit, donc il ne peut être oublié qu'une fois.

Additionner une valeur de deux espaces différents est un bug, jamais une optimisation.
Une fonction ne renvoie jamais des coordonnées sans que son nom ou son JSDoc dise dans
quel espace.

### Ce qui circule sur le réseau et en persistance

**Uniquement des coordonnées de cellule.** Jamais de pixel dans un document de scène ni
dans un payload d'événement. Le pixel n'existe qu'au rendu.

Exception unique et explicite : `pxPerCell` dans le document d'étage, et les dimensions
du masque de fog. Rien d'autre.

### `terrainCost` : `Record` persisté, `Map` en mémoire

Le document de campagne stocke `terrainCost` en `Record<cellKey, number>` — un `Map` n'est
pas sérialisable en JSON, donc inutilisable dans Firestore. À l'exécution, `cellsInRange`
attend un `Map<string, number>` pour des raisons de performance.

**La conversion a lieu dans `js/core/schema.js`, au chargement, et nulle part ailleurs.**
Ne pas propager le `Record` jusqu'au Dijkstra, ne pas persister le `Map`.

---

## 2. La cellule est un couple opaque

```js
/** @typedef {{ a: number, b: number }} Cell */
```

`a` et `b` sont **délibérément sans signification**. En grille carrée c'est (colonne,
ligne) ; en grille hexagonale ce sont les coordonnées axiales (q, r). Aucun code hors de
`js/grid/` n'a le droit de savoir laquelle.

**Interdictions absolues :**

```js
cell.col, cell.row        // ❌ n'existe pas, ne doit jamais exister
cell.x, cell.y            // ❌ confusion avec l'espace carte
cell.q, cell.r            // ❌ fuite de la topologie hexagonale
[cell.a, cell.b]          // ❌ ne pas dégrader en tableau
```

Renommer `{a, b}` en quelque chose de « plus lisible » casse la compatibilité hexagonale
de tout le projet. C'est la contrainte la plus facile à violer par bonne intention.

### Clés canoniques

Une seule implémentation de chacune, dans `js/core/cellKey.js`. Ne jamais reconstruire ces
chaînes à la main ailleurs.

```js
cellKey({a: 4, b: 7})                    // → "4,7"
parseCellKey("4,7")                      // → {a: 4, b: 7}

// Clé d'arête : indépendante du sens de parcours.
// Les deux clés de cellule sont triées lexicographiquement puis jointes par '|'.
edgeKey({a:4,b:7}, {a:5,b:7})            // → "4,7|5,7"
edgeKey({a:5,b:7}, {a:4,b:7})            // → "4,7|5,7"  (identique)
```

Le masque d'arêtes bloquées est un `Set<string>` de clés d'arête. Une arête absente du Set
est franchissable.

---

## 3. Masque de fog — structure figée

```js
FOG_PX_PER_CELL = 8                      // js/core/constants.js
```

- Dimensions : `widthCells * 8` × `heightCells * 8` pixels.
- Origine : alignée sur la case `{a:0, b:0}`, sans décalage.
- Un canal, un octet par pixel : `0` = non exploré, `255` = exploré.
- Stockage en mémoire : `Uint8Array` de longueur `width * height`.
- Indexation : `index = row * width + col`. **Toujours cette formule**, jamais l'inverse.
- Persistance : PNG en niveaux de gris, encodé base64 dans Firestore.
- Un masque **par étage**, jamais global.

Le masque est en espace *pixel de masque*, pas en espace carte ni cellule. Le facteur de
conversion est `pxPerCell / FOG_PX_PER_CELL`. Cette conversion vit dans `js/vision/fog.js`
et nulle part ailleurs.

---

## 4. Événements réseau

Forme unique, sans exception :

```js
/** @typedef {{ type: string, payload: object, at: number, by: 'gm'|'players' }} Event */
```

- `type` : chaîne en `domaine.action`, en anglais — `token.move`, `portal.toggle`,
  `handout.show`. La liste exhaustive est dans le cahier des charges §7 ; **ne pas en
  inventer** sans demander.
- `payload` : objet plat. Pas d'événement imbriqué, pas de tableau d'événements.
- **Ne jamais transmettre ce que le destinataire peut recalculer.** On envoie
  `{from, to, path}`, pas la liste des cases révélées.
- **Ne jamais transmettre d'image**, ni en base64, ni en tuile, ni en dataURL. Uniquement
  des URLs relatives au dépôt.
- Tout événement doit être **idempotent** : le rejouer deux fois donne le même état.

---

## 5. État & mutation

- Une seule source de vérité en mémoire : le store (`js/state/store.js`).
- Aucun module de rendu ne mute l'état. Le rendu **lit**, il ne décide pas.
- Toute mutation passe par une fonction nommée du store, jamais par affectation directe
  depuis l'extérieur.
- Le store émet un signal de changement ; le rendu s'y abonne et demande une frame.

---

## 6. Erreurs

**Échouer bruyamment.** Un `catch` qui avale une erreur et continue est interdit.

- Import d'un fichier invalide → message explicite dans l'interface MJ, avec le champ
  fautif. Jamais un état à moitié chargé.
- Donnée réseau inattendue → journaliser et ignorer l'événement, sans corrompre le store.
- Invariant violé (coordonnées non entières pour un pion, arête inconnue, `levelId`
  inexistant) → lever. Ce sont des bugs, pas des cas limites.

```js
try { parse(file) } catch (e) { /* on continue */ }   // ❌ interdit
```

---

## 7. Nommage

Convention reprise de `shadowrunbank`, à respecter strictement.

- **Identifiants en anglais**, `camelCase` pour les fonctions et variables, `PascalCase`
  pour les classes et les `@typedef`, `SCREAMING_SNAKE` pour les constantes.
- **Commentaires en français.**
- Un fichier = une responsabilité, nommé d'après elle.
- Pas d'abréviation inventée. `blockedEdges`, pas `blkEdg`.

---

## 8. INTERDICTIONS

Liste courte et absolue. Chacune correspond à une décision déjà arbitrée, dont la
violation constitue une **régression fonctionnelle** même si le code fonctionne.

### Vue joueurs

1. **Ne jamais ajouter de drag & drop de pion sur la vue joueurs.** Le drag tactile a été
   testé puis abandonné au profit du déplacement tap-tap. Le drag à un doigt est réservé au
   **pan de la carte**. C'est la violation la plus probable, parce que le drag paraît être
   le geste « naturel » d'un VTT. Il ne l'est pas ici.
2. **Ne jamais ajouter d'élément d'interface à la vue joueurs** : ni barre d'outils, ni
   menu, ni bouton, ni panneau, ni tchat. Seuls la carte, la grille, les pions, le fog, le
   sélecteur d'étage et les gabarits s'affichent.

   > **Trois dérogations, et trois seulement** (cf. `STACK.md` §5bis) :
   > - **Overlay de version au chargement** — 4 s puis disparition totale,
   >   `pointer-events: none`, rappelable par tap à trois doigts. Rien de persistant, rien
   >   de tapable.
   > - **Bandeau de désynchronisation de version** — persistant *tant que l'écart existe*,
   >   car c'est un état cassé et non de l'habillage.
   > - **Fenêtre de connexion Google** (ajoutée à T-14) — l'accès anonyme est fermé par les
   >   règles de sécurité, la tablette doit donc prouver une identité. Geste **unique** : la
   >   session est persistée, et plus rien n'apparaît aux rechargements suivants. Elle ne
   >   s'affiche que si aucune session valide n'existe, et rien d'autre ne doit l'accompagner —
   >   ni message d'accueil, ni bouton de déconnexion, ni indicateur de compte.
   >
   > Toute autre exception se demande. Elle ne se décide pas.
3. **Ne jamais afficher un pion dans une zone explorée mais hors vision courante.** Cela
   permettrait de suivre les PNJ à travers les murs.

### Fonctionnalités hors périmètre

4. Ni fiches de personnage, ni jets de dés, ni tchat, ni initiative, ni barres de points de
   vie, ni snapshot/restauration de positions. Tous **explicitement écartés**.

### Abstractions

5. **Aucune arithmétique `pxPerCell` hors de `js/grid/`.** Vérifié par test automatisé.
6. **Ne jamais supposer 4 ou 8 voisins.** Toujours `grid.neighbors(cell)`.
7. **Ne jamais coder une distance en dur** (Chebyshev, octile, euclidienne). Toujours
   `grid.distance(a, b)`.
8. **Ne jamais accéder à Firebase hors de `js/transport/FirebaseTransport.js`.** Le reste
   du code ne connaît que l'interface `Transport`.

### Réseau

9. **Ne rien publier pendant un drag MJ avant le `pointerup`.** Seule la position
   stabilisée part sur le réseau.
10. **Ne jamais écrire de position de pion dans Firestore** pendant une séance (Realtime
    Database uniquement).
11. **Ne jamais parser un fichier UVTT sur la tablette.** L'import est une opération MJ.

### Divers

12. **Ne jamais créer un fichier absent du manifeste** de `docs/ARCHITECTURE.md`. Le
    manifeste est fermé : proposer l'ajout, ne pas le décider.
13. **Ne jamais ajouter de dépendance** absente de `docs/STACK.md`.
14. **Ne jamais cocher un critère de performance.** 30 fps, arrêt de la boucle rAF sous
    cast, tenue thermique, limite de texture : ils exigent la tablette physique. Les
    signaler « à vérifier par le mainteneur », jamais « fait ».
15. **Ne jamais modifier l'identité git** du dépôt (cf. `docs/STACK.md` §7).
16. **Ne jamais désactiver une vérification pour la faire passer.** Sont interdits :
    `@ts-nocheck`, `@ts-ignore`, l'exclusion d'un fichier de `jsconfig.json`, la mise en
    commentaire d'un test, l'assouplissement d'une option de `strict`. Un type qui résiste
    signale soit un type faux, soit une déclaration manquante — dans les deux cas on
    corrige, ou on **signale et on demande**.

    **Y compris en la contournant plutôt qu'en la coupant.** Sont interdits au même titre :
    remplacer une dépendance réelle par un faux pour qu'un test passe, rediriger un paquet
    vers un fichier local dans `jsconfig.json`, ou vérifier par test unitaire un critère que
    la tâche exige en navigateur. Une vérification satisfaite contre une imitation est un
    **faux vert** : elle coûte plus cher qu'une vérification absente, parce qu'elle ferme la
    question. Si le vrai composant est indisponible dans l'environnement de test, c'est
    l'environnement qu'on change — pas le composant.
17. **Ne jamais exécuter de commande git** : ni `commit`, ni `add`, ni `push`, ni `stash`.
    Les modifications restent dans l'arbre de travail (cf. `TASKS-lot1a.md`).

---

## 9. Définition de « terminé »

Une tâche n'est terminée que si **les quatre** conditions sont réunies :

1. `pnpm run typecheck` ne rapporte aucune erreur, code de sortie 0.
   *Unique exception : `TS18003` (« No inputs were found ») à la tâche T-01, avant
   l'existence du premier fichier source. Partout ailleurs, une sortie non nulle = non
   terminé.*
2. La vérification d'acceptation propre à la tâche passe (cf. `docs/TASKS-lot1a.md`).
3. Aucune interdiction de la §8 n'est violée.
4. Aucun fichier hors manifeste n'a été créé.

En cas de blocage, livrer ce qui fonctionne, **dire explicitement ce qui manque et
pourquoi**, et ne pas cocher la tâche. Un rapport honnête d'échec partiel est utile ; une
tâche déclarée terminée à tort coûte une session de débogage.

### Ce qui doit obligatoirement figurer dans la ligne « Écarts »

La ligne « Écarts » n'est pas une formalité. Y déclarer **systématiquement** :

- tout fichier créé, modifié ou supprimé qui n'était pas au contrat de la tâche ;
- toute partie du contrat non implémentée, même mineure ;
- tout critère de vérification impossible à atteindre, ou atteint autrement que prévu ;
- toute dépendance ajoutée ;
- toute décision prise faute d'information dans les documents.

« Écarts : aucun » sur une tâche qui a créé un fichier hors contrat est un **rapport
inexact**, même si le code est bon. C'est ce qui rend la relecture coûteuse : le mainteneur
doit alors tout auditer au lieu de vérifier ce qui est annoncé.

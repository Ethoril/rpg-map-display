# FIXTURES — jeux de données de test

> Objectif : rendre les pièges du format UVTT **détectables par test** plutôt que
> découvrables en séance. Le piège des unités de case, en particulier, ne se voit pas à la
> lecture du code — seulement sur une donnée dont on connaît la réponse attendue.

---

## 1. Réserve à lire d'abord

Les fixtures décrites ici sont **synthétiques** : générées par script, donc reproductibles
et versionnables sans commiter de gros binaires.

**Elles ne remplacent pas un vrai export.** Un `.uvtt` produit par Dungeondraft contient des
irrégularités qu'aucune fixture synthétique ne reproduit : polylignes de murs ouvertes ou
dégénérées, portails à cheval sur deux cloisons, `map_origin` non entier, cloisons
manquantes, listes de lumières vides, variantes de casse dans les clés.

**Action requise du mainteneur :** déposer au moins un export réel dans
`fixtures/real/` — idéalement une carte de donjon avec des portes et plusieurs pièces — et
ajouter un test qui le parse sans erreur. Tant que ce fichier n'existe pas, le parsing UVTT
est **validé en théorie seulement**, et cela doit être dit dans le rapport de la tâche T-10.

`fixtures/real/` est dans `.gitignore` si les cartes sont sous licence ; sinon commité.

---

## 2. Arborescence

```
fixtures/
├─ synthetic/
│  ├─ minimal.uvtt              1 pièce, 1 porte, 1 lumière — cas nominal
│  ├─ baked-lighting.uvtt       environment.baked_lighting = true
│  ├─ offset-origin.uvtt        map_origin non nul — piège d'alignement
│  └─ no-geometry.uvtt          aucun mur, aucune lumière — équivalent image simple
├─ expected/
│  ├─ minimal.json              sortie attendue de parseUvtt()
│  ├─ baked-lighting.json
│  ├─ offset-origin.json
│  └─ no-geometry.json
├─ images/
│  └─ checker-10x8.png          damier généré, 1 case = 1 carreau
└─ real/                        exports réels — À FOURNIR (cf. §1)
```

---

## 3. `scripts/make-fixture.mjs`

Génère `fixtures/synthetic/*` et `fixtures/images/*`. Node pur, cross-platform, aucune
dépendance hors de celles de `STACK.md`.

**Contrat :**

- Produit un PNG de damier **réellement encodé** (pas de base64 inventé), 10×8 cases à
  64 px/case, un carreau clair et un carreau foncé alternés. Le damier rend les erreurs
  d'alignement de grille immédiatement visibles à l'œil sur une capture.
- Encode ce PNG en base64 dans le champ `image` de chaque `.uvtt`.
- Écrit les `.uvtt` **et** les `expected/*.json` correspondants, pour qu'ils ne puissent pas
  diverger.
- Idempotent : deux exécutions produisent des fichiers identiques octet pour octet
  (aucun horodatage, aucun aléa).

**Commande :** `node scripts/make-fixture.mjs`

---

## 4. `minimal.uvtt` — cas nominal

Une pièce de 6×4 cases dans une carte de 10×8, une porte sur le mur nord, une lumière au
centre.

```json
{
  "format": 0.3,
  "resolution": {
    "map_origin": { "x": 0, "y": 0 },
    "map_size":   { "x": 10, "y": 8 },
    "pixels_per_grid": 64
  },
  "line_of_sight": [
    [ {"x":2,"y":2}, {"x":8,"y":2}, {"x":8,"y":6}, {"x":2,"y":6}, {"x":2,"y":2} ]
  ],
  "objects_line_of_sight": [],
  "portals": [
    {
      "position": { "x": 5, "y": 2 },
      "bounds": [ {"x":4.5,"y":2}, {"x":5.5,"y":2} ],
      "rotation": 0, "closed": true, "freestanding": false
    }
  ],
  "environment": { "baked_lighting": false, "ambient_light": "ffffffff" },
  "lights": [
    { "position": {"x":5,"y":4}, "range": 3, "intensity": 1,
      "color": "ffffffff", "shadows": true }
  ],
  "image": "<PNG base64 — damier 640×512>"
}
```

### Ce que `expected/minimal.json` doit vérifier

C'est ici que se joue la valeur de la fixture. Les assertions portent sur les **pièges**,
pas sur la recopie des champs.

| Assertion | Pourquoi c'est le piège |
|---|---|
| `level.walls[0][1]` vaut `{a:8, b:2}` — **pas** `{a:512, b:128}` | Les coordonnées UVTT sont en **unités de case**. Toute multiplication par `pixels_per_grid` à l'import est le bug n°1. |
| `level.pxPerCell === 64` | Vient de `pixels_per_grid`, seul champ en pixels. |
| `level.widthCells === 10`, `heightCells === 8` | `map_size` est en cases. |
| `level.grid.type === 'square'` | Le format n'a **aucun** champ de topologie. Défaut imposé. |
| `level.portals[0].closed === true` | État initial préservé. |
| `level.ambient.baked === false` | Lu depuis `environment.baked_lighting`. |
| `level.lights[0].range === 3` | En cases, pas en pixels. |
| Aucune propriété `x`/`y` sur une cellule | `CONVENTIONS.md` §2 — les cellules sont `{a,b}`. |

---

## 5. `baked-lighting.uvtt`

Identique à `minimal`, avec `environment.baked_lighting: true`.

**Attendu :** `level.ambient.baked === true`, et `parseUvtt` retourne un avertissement
exploitable par l'interface MJ. Sans cette détection, le curseur jour/nuit se cumule à
l'éclairage déjà cuit dans l'image et le rendu est sale.

---

## 6. `offset-origin.uvtt` — le piège d'alignement

`map_origin: { x: 1.5, y: 0.5 }`, le reste identique à `minimal`.

**Attendu :** l'offset de grille dérive de `map_origin` et **non** d'un champ d'offset —
lequel n'existe pas dans le format. Une case de coordonnée `{a:0,b:0}` ne tombe donc pas
sur le pixel `(0,0)` de l'image.

**Assertion clé :** `grid.pointFromCell({a:0,b:0})` retourne le centre attendu compte tenu
de l'origine décalée. Un import qui ignore `map_origin` passe `minimal` et échoue ici — c'est
précisément la raison d'être de cette fixture.

---

## 7. `no-geometry.uvtt`

`line_of_sight: []`, `portals: []`, `lights: []`.

**Attendu :** import réussi produisant un étage jouable **sans** lignes de vue. C'est le cas
équivalent à la source B (image simple calibrée, §5.1 du cahier des charges) et un palier
volontairement valide — pas une erreur à rejeter.

---

## 8. Fixture de grille pour le test de calibration

`calibrateFromRect` se teste sans image, sur des nombres seuls :

| Entrée | Sortie attendue |
|---|---|
| `rectPx: {w:700}`, `cellsWide: 5` | `pxPerCell === 140` |
| rectangle démarrant à `x:30` avec `pxPerCell:140` | `offsetX === 30` |
| `imageSize: {w:1400,h:1120}`, `pxPerCell:140` | `widthCells === 10`, `heightCells === 8` |

Le damier `checker-10x8.png` sert au contrôle visuel : après calibration, chaque carreau
doit coïncider exactement avec une case. Un décalage d'un demi-carreau se voit
immédiatement sur une capture Playwright, là où aucune assertion numérique ne l'aurait
signalé.

---

## 9. Ce que les fixtures ne couvrent pas

À vérifier à la main, faute de pouvoir être automatisé ici :

- Tenue à 30 fps sous cast actif sur la Tab S9 FE.
- `MAX_TEXTURE_SIZE` réel de la tablette.
- Comportement thermique sur 45 minutes.
- Latence Firebase réelle depuis le réseau de la table.
- Lisibilité à distance sur la TV.

Ces points appartiennent au mainteneur. Aucun test, et aucun modèle, ne peut les cocher.

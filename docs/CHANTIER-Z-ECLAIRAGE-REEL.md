# CHANTIER Z — L'éclairage réel

> Ouvert le **26/08/2026**, sur décision du mainteneur, après la clôture de **M2**.
>
> **Ce document est un brief, pas une spécification arrêtée.** Il pose ce qui est acquis, ce qui est
> décidé, et surtout **ce qui ne l'est pas**. ⛔ Aucune ligne de code ne s'écrit avant les
> arbitrages du §4.

---

## 1. Ce qui est acquis, et qui ne se rediscute pas

### La mesure — M2, close le 26/08

Village étage 00, **93 sources réellement lues**, masque 336 × 336 px, Tab S9 FE :

| Destination | Surface | Coût par image |
|---|---|---|
| référence 640×480 | 0,31 Mpx | 2,253 ms |
| **écran réel 2303×1134** | **2,61 Mpx** | **5,62 ms** |

**Part fixe** (composer les 93 disques) **1,80 ms** ; **part variable** (agrandir)
**1,46 ms/Mpx**. Budget 300 ms → **moins de 2 %**. Un cycle complet tient dans **17 % d'une image à
30 fps**, quand la vue joueurs entière tourne à 1–3 ms depuis la fermeture du fog.

⛔ **WebGL est écarté par cette mesure**, pas par principe. Le déclencheur écrit le 18/08 —
« ça ne tient pas → on a enfin la mesure qui justifie WebGL » — n'a pas été atteint, et de loin.

⚠ **Trois termes ne sont PAS mesurés** et restent au devis :

1. **Le mélange du champ sur le décor.** M2 compose et agrandit ; elle ne mélange à rien. Une
   `LightLayer` ajoute **un second balayage plein écran**. Devis réaliste par image : **5 à 10 ms**.
   Il ne se saura qu'en écrivant la couche — donc **Z-03 doit le mesurer**.
2. ⭐ **L'occlusion du champ — et c'est celui que j'ai failli oublier.** M2 a composé des **disques
   pleins**. Un champ occlus exige **un sweep par source**, et la décision §4.6 retire le filtre
   `vuParUnPJ` : on passe de « les sources qu'un PJ voit » à **toutes les sources, toujours**.

   | Carte | Sources | Murs | Portée médiane |
   |---|---|---|---|
   | village étage 00 | 93 | 200 | 4 cases |
   | **testbig150** | **185** | **1338** | — |

   Aucune source ne dépasse le plafond de 20 cases (`VISION_MAX_RANGE_CELLS`), donc le garde-fou de
   L-02 joue déjà. ⭐ **Et l'instrument existe déjà** : la **section 10** de `diag.html` mesure
   exactement ce coût sur toutes les cartes publiées — 2,6 ms sous cast aujourd'hui, **avec** le
   filtre. La relancer après Z-05 donne le delta directement, sans écrire une ligne de sonde.

3. **Le cast.** Non relevé le 26/08. La section 10 l'avait été. Non bloquant à 2 % du budget, mais
   ⛔ aucun critère de performance ne se coche sans le dispositif réel.

### Ce que le modèle porte déjà, et que personne ne lit

`Light` (`js/core/types.js:78`) : `id`, `at`, `range`, `intensity`, `color`, `shadows`.

**Seul `range` est utilisé.** Il produit un polygone de visibilité dans `FogLayer.updateVision`.
`intensity`, `color` et `shadows` sont importés, validés, persistés, et n'entrent que dans la
**signature de cache** — jamais dans un rendu. Idem pour `Token.emitsLight`.

⭐ **C'est précisément ce que ce chantier vient corriger** : un modèle qui transporte des champs que
personne ne lit ment à chaque relecture.

### Les règles qui s'appliquent sans discussion

- **Résolution : 8 px/case** (`FOG_MASK_PX_PER_CELL`), la même que le masque de fog. C'est à cette
  résolution que M2 a mesuré, et la question de la résolution du masque a été **écartée le 23/08**.
- **Calcul sur mutation du store, jamais dans `rAF`.** C'est déjà la règle du fog, et la raison pour
  laquelle il est passé de 1600 ms à 1 ms. Le champ se met en cache, se recompose quand sa signature
  change — une lumière bascule, un pion porteur de torche bouge, une porte s'ouvre.
- **Sur le réseau et en persistance, uniquement des coordonnées de cellule.**
- ⛔ **Aucun nom d'événement inventé.** S'il en faut un, il entre dans la table du §7 du CdC
  **avant** d'être implémenté (`CONVENTIONS.md`).
- ⛔ **Aucune arithmétique `pxPerCell` hors `GridAdapter`.**

---

## 2. ✅ Le manifeste, amendé le 26/08 — tranche Z-01

`ARCHITECTURE.md` §1 est **normatif et fermé**, et `tests/architecture.test.mjs` §5 vérifie **par nom
de fichier** que tout `js/**` y figure : créer un fichier avant l'amendement fait rougir la porte.

**Deux fichiers déclarés**, et la séparation n'est pas cosmétique — c'est celle que M2 a mesurée :

| Fichier | Ce qu'il fait | Coût |
|---|---|---|
| `js/vision/lightField.js` | compose les sources en additif plafonné, occluses. ⚠ **aucun DOM** | 1,80 ms, **à la mutation** |
| `js/render/layers/light.js` | collecte, **signature de cache**, agrandissement, mélange | ~4,85 ms + mélange, **par image** |

⛔ **`js/vision/` ne connaît pas la grille** — le test d'architecture n°4 interdit jusqu'à la chaîne
`grid/` dans le fichier. `lightField.js` reçoit donc centres et rayons **déjà en pixels carte**, plus
`mapOrigin` et `gridScale`, exactement comme `ExploredFog.reveal`.

⭐ **Et la signature de cache vit dans la couche, pas dans le champ** — c'est le précédent de
`buildVisionSignature`, qui vit dans `fogLayer.js` et non dans `fog.js`. La couche connaît la grille
et les pions ; le champ ne connaît que des pixels.

### ⭐ Et une dérive trouvée en passant, corrigée

Le §5 « Ordre des couches » n'énumérait que **7 rangs** en une seule liste, quand §1 en listait
**11** — `walls`, `portals`, `links`, `measure` et `pings` manquaient. Pire : **les deux vues n'ont
pas la même pile**, ce que la section ne disait pas du tout. La vue joueurs n'a ni `walls` (MJ seul)
ni `measure` (MJ local), et porte un créneau `feedback` — absent côté MJ — **au-dessus du fog**,
délibérément, parce que l'invite de franchissement s'écrit dans la case du *voisin*, que rien ne
garantit explorée.

⚠ **`feedback` n'est pas un fichier** : c'est un créneau qui rappelle
`moveZoneLayer.renderDestinationFeedback` et `linksLayer.renderPrompt`. Il n'a donc rien à faire au
§1, et tout à faire au §5.

§5 est rétabli d'après les deux piles réellement montées dans `gm.js` et `player.js`. L'ordre relatif
de ce qui y figurait était juste : c'était une omission, pas une erreur d'ordre.

---

## 3. La forme technique proposée

Elle recopie ce que le fog fait déjà, parce que c'est ce que la mesure valide.

```
  sources de l'étage (level.lights)          ┐
+ torches portées (token.emitsLight)         ├─→  champ lumineux, 8 px/case, EN CACHE
+ ambiante de l'étage (level.ambient)        ┘         (recomposé sur mutation)
                                                              │
                                                              ↓
                                              agrandi une fois vers l'écran
                                                              │
                                                              ↓
                                                mélangé sur le décor  ← non mesuré
```

**Deux coûts distincts, et il faut les garder distincts** — c'est la leçon de M2 :

| | quand | coût mesuré |
|---|---|---|
| composer le champ | à la **mutation** seulement | 1,80 ms |
| agrandir + mélanger | à **chaque image** | ~4,85 ms + le mélange, non mesuré |

⚠ **Le second terme est celui qui compte**, et c'est le seul qui croît avec la taille de l'écran :
le rapport tablette/poste Windows vaut **×2,4 sur la composition** mais **×18 sur l'agrandissement**.

---

## 4. ⛔ CE QUI N'EST PAS TRANCHÉ — arbitrages du mainteneur

### 4.1 ✅ TRANCHÉE le 26/08 — TACTIQUE

**Le champ lumineux alimente la vision.** Une zone faiblement éclairée est vue de moins loin, une
zone noire n'est pas vue du tout. `intensity`, `color` et `shadows` prennent un sens de jeu, pas
seulement un sens d'image.

**Ce que cette décision entraîne, et qu'il faut assumer :**

- ⛔ **C'est le chemin où une erreur EXPOSE de l'information aux joueurs.** La mise en garde était
  écrite dans B-1 avant d'être choisie. Conséquence de méthode, non négociable pour ce chantier :
  **toute tranche qui touche au calcul de vision se prouve par un test qui montre le rouge**, et
  l'assertion porte sur *ce que la vue joueurs peut lire*, jamais sur un drapeau interne.
- La tranche **Z-05** existe, et c'est la plus délicate du chantier. Elle vient **en dernier** :
  le champ doit être juste à l'œil avant d'avoir le droit de décider ce que la table voit.
- **§12 q.9 entre dans le périmètre** — voir §4.6.

### 4.2 ✅ TRANCHÉE le 26/08 — SOUS LES PIONS

`fogLayer` reste **au-dessus de `tokens`** : c'est ce qui garantit *mécaniquement* l'interdiction n°3
— un pion en zone non visible est masqué par le fog, pas par une condition d'affichage qu'on peut
oublier. ⛔ Ce point ne bouge pas.

**La lumière se pose au rang 3**, juste au-dessus du décor (fond + quadrillage) et **sous** les murs,
les portes, les liaisons, la zone de déplacement, les gabarits et les pions.

⭐ **La raison vaut pour toutes ces couches, pas seulement pour les pions** : leur lisibilité à trois
écrans a été validée en séance, et les teinter la remettrait en jeu. Les quatorze marqueurs d'état et
les badges d'élévation ont coûté une campagne de jugement à eux seuls (chantier Q). C'est pourquoi la
couche descend sous **tout ce qui doit rester lisible**, et pas seulement sous `tokens`.

⚠ **Le quadrillage, lui, EST éclairé** : une pièce noire n'a pas à montrer une grille en pleine
lumière. Décision déduite du motif ci-dessus, pas demandée — à corriger si elle déplaît.

✅ **Manifeste amendé le 26/08** : `ARCHITECTURE.md` §1 (deux fichiers) et §5 (l'ordre, rétabli pour
les deux vues). Voir §2.

### 4.3 ✅ TRANCHÉE le 26/08 — AMBIANTE GRADUÉE. ⚠ **B-1 est renversée**

`ambient.level` module réellement le champ, de 0 à 1. Crépuscule, cave et pièce en demi-jour
deviennent exprimables.

⛔ **Ceci renverse une décision du 16/08 consignée dans `AUDIT-UX-MJ.md`**, document qui fait foi :
*« bascule jour / nuit ; la pénombre graduée est écartée »*. Le motif d'alors était le coût et le
risque d'un voile proportionnel écrit dans le chemin du fog. La prémisse a changé — l'atténuation
continue sort désormais gratuitement des dégradés du champ — mais **le renversement doit être écrit
là où la décision d'origine l'est**, sinon on fabrique une seconde source de vérité.

⚠ **Et il coûte plus que prévu.** Vérifié dans le code le 26/08, la bascule jour/nuit n'est pas
seulement une étiquette :

| | État au 26/08 | Ce que « gradué » entraîne |
|---|---|---|
| `AmbientLight.color` | **retiré du modèle le 17/08 (UX-07)**, plus validé — `js/core/schema.js:923` | à **restaurer** : modèle, validateur, persistance |
| Panneau MJ | deux boutons ☀ Jour / 🌙 Nuit (`js/ui/gm/panel.js:98`), qui n'écrivent que 0 ou 1 | à **remplacer par un variateur** — annule le gain d'ergonomie d'UX-07 |
| `level.ambient` (événement) | ✅ existe déjà | rien à inventer, §7 du CdC intact |

⭐ **Ces deux volets sont séparables**, et c'est le §4.3bis qui les départage.

### 4.3bis ✅ TRANCHÉE le 26/08 — MOTEUR GRADUÉ, INTERFACE INCHANGÉE

**Le moteur** lit `ambient.level` comme un vrai 0 → 1. Une carte importée avec `ambient.level: 0.35`
est enfin rendue à 0,35 au lieu d'être traitée comme du plein jour — l'information importée cesse
d'être ignorée.

**Le panneau MJ ne bouge pas** : les deux boutons ☀ Jour / 🌙 Nuit restent et continuent d'écrire 0
ou 1. ⭐ **UX-07 n'est donc PAS défait**, et B-1 n'est renversée que sur son volet moteur.

⚠ **Conséquence sur `ambient.color`, et c'est ma lecture — à corriger si elle est fausse** : le champ
**reste hors du modèle**, tel qu'UX-07 l'a laissé le 17/08. Il n'était restauré que dans l'option
« remettre le variateur », qui n'a pas été retenue. La dette **E-6 reste donc fermée par le
retrait**, pas par l'usage.

⭐ **Et le curseur n'est pas enterré, il est ajourné** : c'est un jugement d'œil, et il n'existe pas
encore d'image à juger. La question se rouvre d'elle-même quand un demi-jour sera visible à l'écran.

### 4.4a ✅ TRANCHÉE le 26/08 — TEINTE RÉELLE

`color` est lu et teinte le décor : torche orange, sort bleu, vitrail. Les cartes UVTT arrivent
**avec** ces couleurs — le corpus en porte 7 distinctes sur `testbig150`, 5 sur le village.

⚠ **Jugement d'œil obligatoire** sur une vraie carte avant de valider la tranche. Deux sources de
couleurs opposées qui se recouvrent sont un cas à éprouver, pas à supposer.

### 4.4b ✅ TRANCHÉE le 26/08 — OCCLURE TOUJOURS, GARDER LE CHAMP, SIGNALER

Toutes les sources restent arrêtées par les murs et les portes fermées. En mode tactique, c'est la
garantie la plus forte qu'on puisse donner : **aucune lumière ne peut révéler à travers un mur.**

⭐ **Le chiffre qui a tranché** — relevé sur les trois scènes publiées le 26/08 :

| Carte | Sources | `shadows: true` | `shadows: false` |
|---|---|---|---|
| testbig150 | 185 | 185 | **0** |
| test_village_complet | 114 | 114 | **0** |
| testvideo-3 | 4 | 4 | **0** |
| **Total** | **303** | **303** | **0** |

Et l'importeur pose `true` quand le champ est absent (`js/import/uvtt.js:377`). **Le cas ne s'est
jamais présenté.** Écrire le second chemin — le plus exposé du chantier, puisqu'il faudrait découpler
éclairage et vision — pour 0 source sur 303, et le valider sur des fixtures fabriquées faute de
carte réelle, n'aurait pas de sens.

⛔ **Mais le champ n'est PAS retiré**, et c'est délibéré : un import n'écarte jamais rien en silence.
`shadows` reste importé et persisté fidèlement, et **le rapport d'import signale** toute source qui
demande à ignorer les murs et se voit rendue avec ombres. Le jour où une vraie carte en porte une,
le mainteneur le sait et décide avec un cas réel sous les yeux.

### 4.4c ✅ TRANCHÉE le 26/08 — ADDITIF PLAFONNÉ

Les intensités s'ajoutent, bornées à 1. C'est le mode du prototype M2 (`lighter`), donc **le coût
mesuré de 1,80 ms correspond exactement à ce qui sera écrit** — pas à une approximation.

⚠ **Le risque est nommé, et il faut l'éprouver, pas l'oublier** : en mode tactique, trois sources
faibles empilées font une zone bien éclairée, donc vue de plus loin. Un auteur de carte qui superpose
des lueurs d'ambiance élargit la vision des joueurs sans l'avoir voulu. `testbig150` porte
**185 sources** : les recouvrements y sont la norme, pas l'exception. ⭐ **C'est la carte sur laquelle
la tranche Z-05 doit être regardée.**

### 4.5 ✅ TRANCHÉE le 26/08 — ÉCLAIRÉ EN « JOUER », À PLAT EN « PRÉPARER »

Le sélecteur **Jouer / Préparer** existe déjà (UX-03, `js/ui/gm/panel.js:77`) et pilote déjà les
onglets. Aucune interface nouvelle.

- **Jouer** → la vue MJ est éclairée comme la table la voit. Indispensable en mode tactique, où c'est
  la lumière qui décide de ce que les joueurs voient.
- **Préparer** → carte à plat, pour poser murs et pions sans travailler à l'aveugle dans une cave.

La vue joueurs, elle, est **toujours** éclairée.

### 4.6 §12 q.9 — ⭐ elle se ferme d'elle-même, et c'est une simplification

En réfléchissant à la mécanique du mode tactique, la question 9 cesse d'être un arbitrage : elle
disparaît.

**Aujourd'hui**, `FogLayer.updateVision` traite les lumières comme des **yeux** : chaque source
produit un polygone de vision, ajouté à l'union révélée, à condition qu'un PJ ait une ligne de vue
jusqu'à son **centre** (`vuParUnPJ`). C'est de là que vient l'approximation — voir la lampe révèle
tout son halo.

**En mode tactique**, la décomposition correcte est autre, et elle est plus simple :

| | Ce que c'est | De quoi ça dépend |
|---|---|---|
| **le champ lumineux** | l'éclairage physique de la carte | des sources et des murs. ⛔ **d'aucun observateur** |
| **la vision** | ce qu'un PJ peut voir | de son propre sweep, ET du niveau de lumière atteint |
| **la révélation** | ce que le fog dévoile | de l'intersection des deux |

⭐ **Une lampe éclaire qu'on la regarde ou non** — c'est une propriété de la carte, pas de la table.
Et la révélation exige la ligne de vue du PJ **jusqu'à chaque point**, plus jusqu'au seul centre de
la source. Le halo derrière un angle n'est donc plus révélé : **q.9 tombe, sans l'avoir traitée.**

⛔ **Conséquence à ne pas manquer : `vuParUnPJ` et son approximation DISPARAISSENT.** La tranche Z-05
retire du code au lieu d'en ajouter. ⚠ Mais elle retire du code **dans le chemin le plus exposé du
projet** — c'est pour ça qu'elle vient en dernier, et qu'elle s'éprouve sur `testbig150`.

### 4.5 Vue MJ et vue joueurs voient-elles la même chose ?

La couche `links` a déjà le précédent d'un rendu **par rôle**. Le MJ veut-il voir la carte éclairée
comme la table, ou à plat pour préparer ?

### 4.6 §12 q.9 — la traiter ici, ou pas

Le plan dit que ce choix ferme q.9 « parce que séparer la ligne de vue de l'illumination est le même
changement ». ⚠ **C'est vrai en (B), douteux en (A).**

Rappel : ton déclencheur pour q.9 est écrit et **n'est jamais tombé**. Deux non-déclenchements
consignés, dont le 13/08 où tu jugeais le comportement « tout à fait adéquat ».

---

## 5. Découpage envisagé — à confirmer après le §4

⛔ Indicatif. Une tranche à la fois, chacune passée à la porte et **prouvée par mutation**.

| # | Tranche | Ce qu'elle ferme |
|---|---|---|
| ✅ Z-01 | Amendement du manifeste (§1 et §5) — **fait le 26/08** | Débloque tout le reste |
| ✅ Z-02 | `js/vision/lightField.js` — composition occluse à 8 px/case, **faite le 26/08** | La composition, éprouvée sans DOM |
| Z-03 | `LightLayer` : agrandissement et mélange, **et la mesure du mélange sur tablette** | Le terme non mesuré du §1 |
| Z-04 | `intensity`, `color`, `shadows` réellement lus | Le modèle cesse de mentir |
| Z-05 | Le volet tactique — **retenu (§4.1)**, et en DERNIER | La vision suit l'éclairage, et §12 q.9 |

⚠ **Z-03 porte une mesure, et une mesure ne rentre pas dans la porte** — c'est son *calcul* qui y
entre. La leçon de M2 s'applique d'avance : chronométrer N cycles d'un seul tenant, jamais une
opération isolée encadrée d'un vidage.

---

## 6. Ce que ce chantier ne fait pas

- ⛔ **Les lumières cliquables comme les portes** — c'est **C-2**, un chantier distinct, avec ses
  propres décisions ouvertes (champ d'état, rendu par rôle, nom d'événement à faire entrer au §7 du
  CdC). Il a besoin d'une couche de rendu des lumières, donc il vient **après** celui-ci.
- ⛔ **Toucher à l'ordre des couches au-delà de l'insertion.** `fogLayer` reste au-dessus de
  `tokens`.
- ⛔ **Rien qui déplace quoi que ce soit dans le dos de personne.** Allumer la lumière ne bouge aucun
  pion, ne change aucun étage affiché, ne recadre aucune vue.

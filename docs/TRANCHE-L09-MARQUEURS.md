# TRANCHE L-09 — marqueurs d'état

> Neuvième et dernière tranche **écrite** du Lot 2 du CdC §11. Découpage : `PLAN-LOT2.md` §4.
> Ne dépend d'aucune autre tranche : ni du fog, ni des murs, ni des gabarits.
>
> Elle adresse le **critère 4** — « les marqueurs d'un pion sont lisibles sur les trois
> écrans ». **Elle ne le cochera pas**, et ce n'est pas un aveu d'échec : « lisible sur les
> trois écrans » se constate sur les trois écrans. Le mécanisme se vérifie en machine, le
> critère attend la table, comme les critères 10 et 11 de L-05.
>
> Spécification de référence : CdC §5.2 (`markers`) et §12 Q7, **tranchée le 04/08/2026**. Le
> vocabulaire est clos : quatorze valeurs, listées dans
> `assets/icons/status/SOURCES.md`, qui fait autorité.

---

## 1. Ce qui a été mesuré avant d'écrire ce brief

Huit briefs sur huit ont été corrigés par une mesure faite **avant** la première ligne de
code. Celle-ci en corrige trois, dont **un défaut du code déjà livré**.

### 1.1 Un seuil exprimé en zoom serait faux, et « carte entière » vaut toujours 33 px

`_drawToken` travaille en espace **carte** — `grid.mapFromCellPoint()` — et
`camera.applyToContext` applique `ctx.scale(zoom, zoom)` (`camera.js:93`). Une grandeur
écrite dans cette couche est donc multipliée par le zoom avant d'atteindre l'œil.

Le zoom n'est pas pour autant un réglage libre : il est contraint par le besoin de voir la
carte. Mesuré sur le profil réel de la Tab S9 FE (48 × 45 cases), pour une largeur logique de
1600 px, avec les six `pxPerCell` réellement commités dans `maps/` :

| `pxPerCell` | largeur carte | zoom « carte entière » | pion d'une case à l'écran |
|---|---|---|---|
| 140 | 6720 px | 0,24× | **33,3 px** |
| 115,4 | 5538 px | 0,29× | **33,3 px** |
| 85,3 | 4096 px | 0,39× | **33,3 px** |
| 64 | 3072 px | 0,52× | **33,3 px** |
| 57,7 | 2769 px | 0,58× | **33,3 px** |
| 42,7 | 2048 px | 0,78× | **33,3 px** |

**La dernière colonne est constante, et ce n'est pas une coïncidence** : le produit
`pxPerCell × zoom` ne dépend que du nombre de cases affichées, jamais de la résolution de
l'image. Deux conséquences, et elles commandent toute la tranche :

1. **Le seuil s'exprime en pixels écran, une seule valeur, valable pour toutes les cartes.**
   Un seuil en zoom aurait exigé une valeur par carte, et se serait faussé au prochain
   rééchantillonnage.
2. **Un pion d'une case ne fait que 33 px quand on voit la carte entière.** C'est l'état
   normal de la vue joueurs sur la tablette, pas un cas limite. Une icône n'y tient pas :
   le palier dégradé n'est donc pas une précaution, c'est le mode le plus fréquent.

Et le seuil ne peut pas non plus s'écrire en zoom parce que `sizeCells` existe :

| | bascule vers les icônes |
|---|---|
| pion d'une case, `pxPerCell` 140 | zoom **0,38×** |
| pion de trois cases, `pxPerCell` 140 | zoom **0,13×** |

Le même seuil en zoom ferait basculer l'ogre et le gobelin au même instant, alors que l'ogre
offre neuf fois la surface. **Le seuil porte sur le diamètre du pion à l'écran**, calculé
pion par pion.

### 1.2 Les garde-fous actuels sont écrits dans le mauvais espace — défaut déjà livré

`tokens.js:332` borne le rayon d'un marqueur par `Math.max(3, Math.min(6, width * 0.05))`, et
`tokens.js:312` le badge d'élévation par `Math.max(8, Math.min(14, width * 0.12))`. Ces bornes
sont en pixels **carte**. Rendues à l'écran, pour un pion d'une case en `pxPerCell` 140 :

| zoom | pion à l'écran | rayon du marqueur | rayon de l'élévation |
|---|---|---|---|
| 0,10× | 14 px | **0,6 px** | 1,4 px |
| 0,24× (carte entière) | 33 px | 1,4 px | **3,4 px** |
| 1,00× | 140 px | 6,0 px | 14,0 px |
| 5,00× | 700 px | **30,0 px** | 70,0 px |

**Rapport entre les deux extrêmes : cinquante.** Un garde-fou « jamais moins de 3 px, jamais
plus de 6 » énonce une intention d'écran ; écrit en espace carte, il ne borne rien. À la vue
« carte entière » — la vue normale — le badge d'élévation fait 3,4 px de rayon **avec un
texte dedans** : `+2` y est illisible. Ce n'est pas une régression de cette tranche, c'est un
défaut du chantier K que la mesure met au jour.

**Décision, et c'est une extension délibérée du périmètre : le badge d'élévation adopte la
même géométrie que les marqueurs.** Sans cela le même pion porterait deux règles de taille
contradictoires, et la deuxième serait fausse. Le coût est d'une division ; le laisser en
place, c'est garantir la divergence.

### 1.3 Le nombre de badges qui tiennent est invariant au zoom — donc c'est un choix

Si le badge est proportionnel au pion, le nombre qui tient sur sa largeur ne dépend plus du
zoom du tout :

| diamètre du badge | nombre qui tient (espacement 1,1) |
|---|---|
| 34 % du pion | 2 |
| 30 % | 3 |
| **26 %** | **3** |
| 22 % | 4 |
| 18 % | 5 |

**C'est donc un plafond de conception, pas une conséquence du zoom.** Il faut le choisir. Le
choix retenu est **26 % et trois badges** : descendre à 22 % pour en gagner un quatrième
repousse l'apparition des icônes de 54 à 64 px de diamètre de pion, c'est-à-dire retarde le
palier lisible pour afficher davantage d'illisible.

---

## 2. Les trois paliers

Un seul critère, le **diamètre du pion à l'écran** `D = sizeCells × pxPerCell × zoom`, calculé
pour chaque pion.

| Palier | Condition | Ce qui s'affiche |
|---|---|---|
| **Icônes** | `D × 0,26 ≥ 14 px`, soit `D ≥ 54 px` | jusqu'à **3** icônes, puis un pastillon `+N` |
| **Points de catégorie** | `D ≥ 20 px` | jusqu'à **4** points, un par catégorie présente, dédoublonnés |
| **Point unique** | `D < 20 px` | **un** point neutre, « il se passe quelque chose » |

Vérifié sur la plage réelle, `pxPerCell` 140 :

| zoom | pion 1 case | pion 3 cases | palier 1 case | palier 3 cases |
|---|---|---|---|---|
| 0,10× | 14 px | 42 px | point unique | points de catégorie |
| 0,24× | 34 px | 101 px | points de catégorie | icônes |
| 0,40× | 56 px | 168 px | icônes | icônes |
| 1,00× | 140 px | 420 px | icônes | icônes |

**Le palier intermédiaire porte de l'information, et c'est son intérêt.** Quatre points de
catégorie dédoublonnés disent « il est blessé *et* entravé » sans prétendre dire lequel — un
pion empoisonné, en flammes et hémorragique n'affiche qu'un seul point rouge, parce que la
place disponible ne permet pas d'en dire plus honnêtement. Les couleurs sont celles déjà
arrêtées par `PROMPTS-ICONES-ETATS.md` :

| Catégorie | Couleur | États |
|---|---|---|
| `damage` | rouge | `ablaze`, `bleeding`, `poisoned` |
| `control` | orange | `prone`, `entangled`, `stunned`, `surprised` |
| `senses` | bleu-gris | `blinded`, `deafened`, `unconscious` |
| `mind` | violet | `broken`, `fear`, `terror`, `frenzy` |

### 2.1 La règle qui rend tout cela vrai

> **Toute grandeur de badge s'écrit en pixels écran, puis se divise par le zoom.**

`sizeMap = sizeScreen / zoom`. Rien d'autre ne doit être écrit en dur dans cette couche.
C'est la règle qui manque au code actuel (§1.2), et la seule à retenir de ce brief si l'on
n'en retient qu'une.

La couche ignore aujourd'hui le zoom : `RenderOptions` de `tokens.js` ne le porte pas. Il faut
donc l'y ajouter et le fournir depuis les **deux** points d'entrée qui rendent cette couche :
`gm.js` et `player.js`.

> **Correction du 04/08 au soir : `diag.js` n'est PAS concerné**, contrairement à ce que ce
> brief affirmait d'abord. Il applique bien `camera.applyToContext` (`diag.js:172`), ce qui
> rendait la déduction tentante, mais il **n'utilise pas la couche `tokens.js`** : il trace ses
> propres disques au contexte (`diag.js:192-200`) pour mesurer un profil de charge. Y chercher
> un appel à `tokensLayer.render()` serait chercher ce qui n'existe pas.

⚠ **`zoom` n'est pas `resolution`.** `gm.js:421` applique `ctx.scale(stage.resolution, …)`
*avant* la caméra, avec `RENDER_RESOLUTION_CAP = 1,5`. La résolution ne change pas la taille
perçue, elle ajoute des pixels physiques : elle n'entre donc **pas** dans le calcul du palier,
mais **elle entre dans la clé du cache de rastérisation** (§4), faute de quoi les icônes
seraient floues sur un écran dense.

---

## 3. Le plafond de trois, et l'ordre qui décide qui tombe

Trois icônes au plus, puis un pastillon `+N`. Reste à dire **lesquelles trois**, et la réponse
ne peut pas être « les trois premières du document » : cette liste est alphabétique, et
tronquer alphabétiquement masquerait `unconscious` derrière `assourdi`. Absurde à la table.

**Les badges se dessinent toujours dans un ordre canonique, jamais dans l'ordre d'insertion**
— sinon la rangée se réorganise sous l'œil du MJ à chaque ajout. Cet ordre canonique est aussi
l'ordre de troncature. Proposition, du plus décisif au moins décisif :

```
unconscious, prone, stunned, entangled, terror, fear, blinded,
deafened, broken, frenzy, ablaze, bleeding, poisoned, surprised
```

Le critère : **ce qui change ce qu'un personnage peut faire ce tour-ci passe devant ce qui
lui coûte des points de vie.** `surprised` ferme la liste parce qu'il dure un round et que
tout le monde à la table le sait déjà.

> ⛔ **Point de contrôle.** Cet ordre est un arbitrage de jeu, donc il appartient au
> mainteneur, pas à moi. Il est écrit ici pour ne pas bloquer l'implémentation — c'est une
> constante, le changer est une ligne — mais **il doit être confirmé ou corrigé après la
> première séance qui verra cinq marqueurs sur un pion**. Ne pas le figer dans un test
> d'acceptation autrement que par sa forme.

---

## 4. Rastérisation et cache

Un SVG passé à `drawImage` est rasterisé par le navigateur à chaque appel. Quatorze états ×
plusieurs pions × soixante images par seconde n'est pas un budget à dépenser pour un dessin
qui ne change jamais.

- **Un `HTMLImageElement` par icône**, chargé une fois depuis `assets/icons/status/<id>.svg`,
  suivant le motif de `preload()` déjà en place pour les images de pions.
- **Un canvas hors écran par (id, taille)**, rempli une fois puis réutilisé. La taille est
  celle du **pixel physique** : `round(badgeScreenPx × resolution / 2) × 2`, arrondie au pas
  de 2 px pour ne pas rastériser à chaque cran de pinch.
- **Mesuré** : sur toute la plage de zoom et pour `sizeCells` de 1 à 3, dix tailles distinctes
  apparaissent en deçà de 64 px — 14, 16, 18, 22, 28, 30, 32, 36, 44, 54. Soit 140 entrées au
  pire théorique, alors que l'usage réel n'expose que trois à cinq états simultanés.
  **Plafond LRU à 128**, du même ordre que `TOKEN_IMAGE_CACHE_LIMIT` qui vaut 64.
- **La recoloration est une substitution de chaîne unique.** Les quatorze fichiers ont été
  normalisés pour ne porter qu'un seul `fill`, vérifié fichier par fichier avant écriture
  (`SOURCES.md`). Pas de parsing XML, pas de filtre canvas.

**Une icône qui ne charge pas se dégrade en point de catégorie, et se journalise une fois par
identifiant.** `CONVENTIONS.md` §6 impose d'échouer bruyamment, mais lever dans la boucle de
rendu tuerait une image sur soixante et rendrait la table injouable ; c'est le motif déjà
retenu pour les images de pions en erreur. Ne pas avaler l'erreur en silence pour autant : un
fichier manquant est un bug de déploiement, pas un cas limite.

---

## 5. Ce qu'il faut écrire

### 5.1 Amendement du manifeste

Un fichier nouveau, `js/render/statusBadges.js`, à ajouter à `ARCHITECTURE.md` §1.

**Pourquoi pas dans `tokens.js`**, que le manifeste crédite déjà des « badges
élévation/marqueurs » : parce que le choix du palier, la mise en page de la rangée et la
troncature sont de l'**arithmétique pure**, donc vérifiables sous `node:test` sans navigateur,
tandis que `tokens.js` ne l'est pas. Y enfermer ces fonctions rendrait la seule partie
testable de la tranche non testable. C'est le raisonnement déjà tenu pour
`import/tokenCatalog.js` au chantier I, et il est ici plus fort : la géométrie est
précisément ce qu'un test doit fixer, puisque c'est ce que la mesure du §1.2 a trouvé faux.

Le module ne touche pas au DOM au chargement — le canvas hors écran se crée à la demande,
pas au niveau du module — sans quoi il redeviendrait inimportable depuis Node. Règles du §2
respectées : `render/*` peut importer `core/*`.

### 5.2 Les constantes

Dans `js/core/constants.js`, source unique partagée par le schéma, le rendu et l'interface :
`STATUS_MARKER_IDS` (les quatorze, dans l'ordre canonique du §3),
`STATUS_MARKER_CATEGORY`, `STATUS_MARKER_LABEL_FR`, puis `BADGE_DIAMETER_RATIO = 0.26`,
`BADGE_ICON_MIN_PX = 14`, `BADGE_DOT_MIN_TOKEN_PX = 20`, `BADGE_MAX_ICONS = 3`,
`BADGE_RASTER_STEP_PX = 2`, `STATUS_ICON_CACHE_LIMIT = 128`.

Trois tables et non une : la catégorie sert au rendu, le libellé à l'interface MJ, et l'ordre
au rendu comme à la troncature. Les réunir en un objet unique obligerait le schéma à importer
des libellés d'interface.

### 5.3 La validation

`core/schema.js:758` ne vérifie aujourd'hui que `Array.isArray(token.markers)`. Le
vocabulaire étant clos, il doit **rejeter toute valeur hors des quatorze**, et nommer la
fautive — c'est la seule chose qui empêchera un `"poisonned"` de traverser silencieusement
jusqu'au rendu, où il se manifesterait par une icône absente.

Rejeter aussi les **doublons** : `["prone","prone"]` dessinerait deux fois le même badge et
consommerait une des trois places.

### 5.4 La liste blanche du store

`store.updateToken` refuse `markers` par une liste blanche explicite, et le commentaire de
`store.js:724` en donne la raison : « tranche L-09, dont le jeu de valeurs n'est pas arrêté
(CdC Q7) ». **La raison a disparu le 04/08/2026** : ajouter `markers` à
`ALLOWED_TOKEN_PATCH_KEYS`, et retirer la ligne du commentaire — laisser une justification
périmée en place est le meilleur moyen qu'elle soit rouverte plus tard par erreur.

### 5.5 L'interface MJ

`js/ui/gm/panel.js` porte déjà l'édition du pion sélectionné et `applyTokenPatch()`, qui mute
puis publie. Le sélecteur de marqueurs y prend place : quatorze cases à cocher libellées en
français, `change` et non `input` pour la raison déjà écrite pour l'élévation, et
`applyTokenPatch({ markers: [...] })`.

**Rien côté joueurs.** L'interdiction n°2 ferme la vue joueurs, et poser un état est un
arbitrage de MJ. Les badges s'y **affichent**, ils ne s'y modifient pas.

Le panneau MJ est aussi la réponse au plafond de trois : c'est là que la liste complète se lit
quand un pion porte cinq états.

### 5.6 Les événements — aucun nouveau

`token.update` porte déjà `{ tokenId, patch }` en valeurs absolues, ce qui le rend rejouable
et idempotent. Un tableau de marqueurs **est** une valeur absolue. Il n'y a donc **ni
événement à créer, ni amendement du CdC §7** — et il ne faut pas en inventer un : la liste du
§7 est fermée (`CONVENTIONS.md` §4).

---

## 6. Ce qui n'est PAS dans cette tranche

- **Aucune règle de jeu.** Un marqueur est un affichage. `prone` ne modifie ni la vision, ni
  `speedCells`, ni l'atteignabilité, ni un gabarit. Le CdC §5.2 est explicite — « le jeu
  reste dans la tête du MJ » — et l'interdiction n°4 écarte toute mécanique chiffrée.
- **Aucune durée, aucun décompte de tours.** Ni initiative ni compteur : hors périmètre.
- **Aucun quinzième état.** La liste est close. En ajouter un, c'est rouvrir Q7.
- **Aucune icône redessinée.** Les quatorze sont posées et commitées.
- **Aucun écran « à propos ».** L'attribution CC BY 3.0 n'est due qu'à la diffusion, qui
  n'est pas prévue (`SOURCES.md`).
- **Pas de placement des badges sur le pourtour du pion.** Une rangée en bas, comme
  aujourd'hui. L'arc aurait fait tenir davantage de badges, pour un calcul de position par
  badge et par pion à chaque image, et le §1.3 montre que le plafond utile est de trois.

---

## 7. Amendements requis

| Document | Amendement |
|---|---|
| `ARCHITECTURE.md` §1 | ajouter `js/render/statusBadges.js [2]` ; `assets/icons/status/` est déjà porté |
| `CAHIER-DES-CHARGES.md` §5.2 | « le jeu de marqueurs reste à définir » est faux depuis le 04/08 : le nommer clos et pointer `SOURCES.md`. Retirer « concentré » de la liste d'exemples — il n'est **pas** des quatorze |
| `CAHIER-DES-CHARGES.md` §12 | barrer Q7, la marquer tranchée le 04/08/2026 |
| `PLAN-LOT2.md` §7 | Q7 n'est plus « ce qui reste ouvert » ; L-09 n'attend plus une partie jouée pour être **écrite**, seulement pour être **validée** |
| `ETAT.md` | L-09 écrite, critère 4 toujours décoché et pourquoi |

---

## 8. Critères d'acceptation

1. **Le badge garde la même taille à l'écran** quand le zoom change. Deux zooms, un facteur
   trois entre eux, taille mesurée en pixels écran : identique à 1 px près. **C'est le critère
   central** — c'est exactement ce que le code actuel ne fait pas (§1.2).
2. **Le palier suit le diamètre du pion, pas le zoom.** À un zoom donné, un pion de trois
   cases affiche ses icônes quand un pion d'une case en est encore aux points.
3. Un pion portant cinq marqueurs affiche **trois icônes et `+2`**, les trois étant les
   premières de l'ordre canonique.
4. Un pion portant `ablaze`, `bleeding` et `poisoned` au palier intermédiaire affiche **un
   seul** point rouge, pas trois.
5. Le badge d'élévation garde lui aussi sa taille à l'écran, et `+2` reste lisible à la vue
   « carte entière ».
6. `markers: ["poisonned"]` est **refusé** par le schéma, avec la valeur fautive dans le
   message. `["prone","prone"]` également.
7. Le MJ cochant un état voit le badge apparaître sur les trois vues ; le rechargement le
   conserve.
8. La vue joueurs n'a gagné **aucun** élément d'interface.
9. `pnpm run verify` sort à 0.

   > **Correction du 04/08 au soir : `pnpm run test:manuel` n'est PAS requis par cette
   > tranche**, contrairement à ce que ce brief exigeait d'abord. Le projet `manuel` existe
   > pour les **gestes tactiles de la vue joueurs**, sortis de la porte le 04/08. Or L-09
   > n'ajoute aucun geste : le sélecteur est une case à cocher du panneau MJ, donc un clic
   > souris, que Playwright couvre entièrement. L'exiger aurait été demander une vérification
   > qui ne vérifie rien de cette tranche — et une vérification hors sujet est le début d'un
   > faux vert.
   >
   > Elle redeviendrait requise si les badges touchaient le chemin du geste de la vue joueurs,
   > ce qui n'est pas le cas : ils se dessinent, ils ne se tapent pas.

**Le critère 4 du CdC ne se coche pas ici.** « Lisibles sur les trois écrans » exige la
tablette et l'écran de cast. Le mécanisme sera vérifié, la lisibilité constatée à la table —
et le seuil de 14 px est précisément le nombre qu'une vraie séance peut démentir.

---

## 9. Tests attendus

**Sous `node:test`, sans navigateur** — c'est ce qui justifie le module séparé :

- le choix du palier aux trois frontières et de part et d'autre, pour `sizeCells` 1 et 3 ;
- la troncature à trois et le `+N`, ordre canonique respecté ;
- le dédoublonnage par catégorie, dont le cas des trois `damage` ;
- la mise en page d'une rangée de 1, 2, 3 badges : aucun ne dépasse la largeur du pion ;
- l'invariance de la taille écran : `sizeMap(z) × z` constant, pour z de 0,1 à 5 ;
- le schéma : valeur inconnue, doublon, tableau vide, casse différente.

**Sous Playwright** : le rendu effectif d'une icône, la case à cocher du panneau MJ jusqu'au
badge dessiné, et la mesure de taille écran à deux zooms du critère 1.

> ⚠ Ne pas remplacer l'icône par un faux dans le test de rendu. `CONVENTIONS.md` §8-16 :
> une vérification satisfaite contre une imitation est un faux vert, et le sujet même du test
> est ici la rastérisation d'un vrai SVG.

---

## 10. Ce qu'il restera quand cette tranche sera livrée

**Tout le lot 2 sera écrit, et trois critères resteront décochés — aucun n'attendant du
code :** le 10 (seuil de 300 ms) et le 11 (tactile) attendent la Tab S9 FE, le 4 attend une
partie jouée. L'interdiction n°14 les réserve tous les trois au mainteneur.

Deux questions que seule la table tranchera, à rouvrir ce jour-là et pas avant : l'**ordre
canonique** du §3, dont la troncature dépend, et le **seuil de 14 px**, qui décide à partir de
quand une icône vaut mieux qu'un point.

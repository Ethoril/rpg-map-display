# BRIEF — Phase 0 : les deux mesures qui conditionnent la suite

> Écrit le 18/08/2026. Découle de [PLAN-SUITE.md](./PLAN-SUITE.md) §1.
>
> **Aucune de ces deux mesures ne modifie le produit.** M1 n'exige aucun code. M2 ajoute une section
> à `diag.html` et rien d'autre. Tout le reste du plan attend leurs résultats — c'est délibéré : ce
> projet a déjà écarté une migration de moteur pour 3 % de gain, en mesurant d'abord.

---

## M1 — Le coût réel du compositing du fog

**Pour le mainteneur, sur la tablette. Aucun développement.**

### Pourquoi ce relevé n'existe pas déjà

La campagne du 11/08 a conclu « aucun problème de performance », et cette conclusion tient. Mais son
tableau ne contient **aucune mesure du fog en vue joueurs sur `testbig150`**. Le coût est donc **non
mesuré, pas infirmé** — nuance qui fait toute la différence entre un risque écarté et un risque
jamais regardé.

### Ce que le code fait aujourd'hui

`pinchZoom` appelle `requestRender()` (`js/app/player.js:926-932`), qui déclenche `renderAll()`, qui
appelle `fogLayer.render()` **à chaque image**, sans condition ni mémoïsation
(`js/app/player.js:589`). Et `FogLayer.render()` alloue — ou réutilise — un canvas **aux dimensions
de la carte entière**, puis y fait deux `fillRect` pleine surface plus les masques étirés à cette
même taille. Sur `testbig150` (7499 × 8192), c'est 61 mégapixels balayés deux à trois fois, par
image, pendant tout le geste.

### Le protocole

L'instrumentation existe déjà : `FrameProbe` enregistre la durée **par couche**, et son tableau porte
une colonne `background` et une colonne `fog` côte à côte, image par image (`js/render/probe.js`).

1. Charger **`testbig150`** et ouvrir la vraie vue joueurs : `player.html?session=<id>&probe=1`.
2. Pincer pour **zoomer à fond**, relever `background` et `fog` sur plusieurs images.
3. Pincer pour **dézoomer jusqu'à voir l'étage entier**, relever les deux mêmes colonnes.
4. Noter aussi la colonne `total`.

### Ce que le relevé décide

**L'urgence de la phase 2** — et accessoirement une vieille question, le petit lag résiduel au zoom,
clos le 16/08 sur « sans conséquence, on arrête de le chasser ». La signature départage les deux
suspects :

| Observation | Conclusion |
|---|---|
| `fog` **plat**, identique zoomé et dézoomé | c'est le composite du fog : il balaie la carte entière quel que soit le zoom |
| `background` **variable** avec l'échelle | c'est le rééchantillonnage du fond, et le tuilage serait alors pertinent |

Le raisonnement est celui déjà écrit dans `CORRECTIF-COUT-DU-MASQUE-JOUEURS.md` pour le défaut
jumeau des pions : *une composition coûte en proportion de sa surface de destination.*

⛔ **Ne rien conclure d'un relevé fait sur une petite carte.** Le défaut, s'il existe, est
proportionnel à la surface de la carte : `manoir-rdc` et `testbig150` ne racontent pas la même
histoire, et c'est justement l'écart entre les deux qui est le chiffre utile.

---

## M2 — Le champ lumineux à la résolution du masque

**Développement : une nouvelle section `16` dans `diag.html` + `js/app/diag.js`, et rien d'autre.**

### La question exacte

> 93 sources de lumière composées **à la résolution du masque** (8 px/case) puis agrandies une fois,
> est-ce que ça tient dans le budget de la tablette ?

L'hypothèse : 93 disques de gradient à 8 px/case tiennent dans ~1,9 Mpx par image, et un gradient est
précisément ce qu'un agrandissement bilinéaire ne dégrade pas.

### ⛔ Périmètre — ce que cette section ne mesure PAS

Elle mesure **uniquement le coût par pixel nouveau** : la composition du champ lumineux et son
agrandissement.

Elle ne mesure **pas** l'occlusion par les murs. Le coût des sweeps est **déjà mesuré** — section 10,
⛔ **2,6 ms — chiffre à jeter, la section balayait des cartes sans murs (corrigé le 27/08/2026)**. Le coût total d'un éclairage réel sera
`sweep déjà mesuré + composition mesurée ici`. Ne pas les additionner à la main dans le verdict de la
page : afficher les deux séparément et laisser la lecture se faire.

### Ce que la section doit faire

1. Lire une **carte réellement publiée**, comme le fait déjà la section `6bis` — même principe,
   **sans extrapolation**. Cible : l'étage 00 du village, qui déclare **93 sources**.
2. Afficher le nombre de sources **effectivement** trouvées, et les dimensions du masque
   (`largeurCases × 8`, `hauteurCases × 8`).
3. Pour chaque source, calculer son disque **dans l'espace du masque** et y peindre un gradient
   radial, en composition additive.
4. Agrandir **une seule fois** le champ composé aux dimensions du viewport.
5. Chronométrer séparément : (a) la composition à la résolution du masque, (b) l'agrandissement,
   (c) le total.

### ⚠ Les cinq pièges, tous déjà rencontrés sur ce projet

**1. `performance.now()` autour d'une opération canvas mesure une mise en file, pas une peinture.**
C'est le défaut exact de la sonde de décodage froid, qui affichait 0,2 ms pour 12 Mpx — soit
60 Gpx/s. La technique retenue au correctif G-01 du 12/08 est la seule acceptable ici :

> chronométrer l'opération **suivie d'un `getImageData(0, 0, 1, 1)`** qui vide le pipeline, mesurer
> le coût de cette relecture **seule** sur un bitmap 1×1, et le **retrancher**. Afficher les trois
> durées, et faire porter le verdict sur le **net**.

**2. Ne pas extrapoler depuis un petit nombre de sources.** `ETAT.md` le dit : les extrapolations de
huit sources vers 93 « ne valent rien ». Utiliser le compte réel de la carte. Si la carte visée n'est
pas disponible, **dire que la mesure n'a pas eu lieu** — ne pas la remplacer par une estimation.

**3. Ne pas mesurer un canvas déjà chaud.** Le premier tracé d'une surface coûte plus cher que les
suivants. Faire une passe de chauffe explicite **hors chronomètre**, et le dire sur la page.

**4. La fenêtre de mesure doit pouvoir voir le défaut qu'elle cherche.** La sonde 7bis mesurait sur
60 s un flux de 30 s, et sa correction de boucle n'en rattrapait qu'un tour : le verdict était faux
par construction, de façon déterministe et indépendante du matériel. Écrire sur la page **ce que la
fenêtre choisie permet de conclure**, et ce qu'elle ne permet pas.

**5. Le masque et la carte ne sont pas le même espace.** Un rayon en pixels carte peint dans un
canvas en pixels de masque donne un disque 17,5 fois trop grand à 140 px/case. C'est l'erreur
« grandeur dans le mauvais espace » qui a déjà coûté un facteur 3 sur ce projet. La conversion passe
par `FOG_MASK_PX_PER_CELL` et l'origine de l'étage, comme partout (`CONVENTIONS.md` §3).

### Ce qui entre dans la porte, et ce qui n'y entre pas

⭐ C'est la répartition de la preuve du 11/08, et elle n'est pas négociable.

| | Où | Éprouvé comment |
|---|---|---|
| **L'arithmétique** — position et rayon d'une source dans l'espace du masque, surface totale peinte, soustraction de la relecture, formulation du verdict | fonction **pure**, exportée de `js/app/diag.js` | tests unitaires dans `tests/`, **dans la porte** |
| **La durée mesurée** | la page | relevé manuel du mainteneur, **hors porte** |

Un test navigateur qui mesure une performance mesure aussi la machine : il serait instable, donc
désactivé un jour. Séparer le calcul de la lecture est ce qui rend la moitié prouvable réellement
prouvée.

> ⛔ **Ne pas créer de fichier.** `ARCHITECTURE.md` est un manifeste fermé. La fonction pure vit dans
> `js/app/diag.js`, exportée nommément. Si l'éclairage réel se fait en phase 3, elle déménagera vers
> sa propre couche — et ce déménagement portera alors son entrée au manifeste.

### Critères d'acceptation

1. La section affiche le **nombre de sources réellement lues** et les dimensions du masque — pas des
   valeurs codées en dur.
2. Les trois durées (composition, agrandissement, total) sont affichées, **brutes et nettes**, avec
   le coût de la relecture de vidage affiché séparément.
3. Le verdict est rendu par la **fonction pure**, pas composé dans la page.
4. La page écrit **ce que la mesure ne permet pas de conclure** — au minimum : qu'elle exclut
   l'occlusion, déjà mesurée ailleurs.
5. `pnpm run verify` verte.

### Preuves par mutation exigées

Chacune doit faire **rougir au moins un test**, et le rapport doit dire lequel :

1. Retirer la soustraction de la relecture → le verdict doit basculer sur un cas limite construit
   pour ça. *(C'est exactement la mutation qui a validé la correction du décodage froid.)*
2. Utiliser un rayon en pixels carte au lieu de pixels de masque → la surface calculée doit exploser
   et un test doit le voir.
3. Remplacer le compte réel de sources par une constante → un test doit rougir.

⛔ **Muter l'effet, pas l'étiquette.** Un test qui relève le nombre de sources affiché sans vérifier
la surface calculée passera au vert sur une panne réelle. Voir `.claude/skills/muter/SKILL.md`.

### Interdictions

- Aucun nouveau fichier, aucune nouvelle dépendance.
- Aucune modification du chemin de rendu du produit — c'est une **sonde**, pas une fonctionnalité.
- Aucun `LightLayer`, aucun début d'éclairage réel : cette section sert précisément à décider s'il
  faut l'écrire.
- Aucun chiffre extrapolé présenté comme une mesure.

---

## Ce que la phase 0 rend possible

| Résultat | Suite |
|---|---|
| M1 : `fog` plat et coûteux | la phase 2 devient prioritaire, et le lag au zoom a peut-être sa cause |
| M1 : `fog` négligeable | la phase 2 reste souhaitable pour la mémoire, mais passe après G-1 |
| M2 : la composition tient | **l'éclairage réel se fait en Canvas 2D**, et la question du moteur est close pour de bon |
| M2 : la composition ne tient pas | on a enfin **la mesure qui justifierait WebGL**, celle qui a toujours manqué |

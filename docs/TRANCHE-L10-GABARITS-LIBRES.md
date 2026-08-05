# Tranche L-10 — Gabarits libres : une forme qu'on déplace et qu'on pivote

> **Statut : brief arbitré le 05/08/2026, code non écrit.** Les trois questions de la première
> rédaction sont tranchées, ainsi que le point mineur du §2.4. **Aucune question ne reste
> ouverte : la tranche est implémentable en l'état.**

## 0. La demande, telle qu'elle a été formulée

> « souci sur les gabarits, il rajoute une case à droite, et en fait on va changer de paradigme.
> L'idée est de créer une forme réelle (rond, cone etc), déplaçable sur la carte. On lui donne
> une dimension en cases pour se donner une idée, mais inutile de chercher à l'ancrer sur la
> map, au contraire on doit pouvoir la sélectionner et la déplacer. Idéalement la forme épouse
> les murs quand elle les rencontre. Si trop compliqué on laisse tomber. »

Puis, sur la rotation :

> « le glissement ne doit pas être de la pointe mais du corps. En gros une fois placé, il est
> placé en mettant la pointe au niveau du perso qui est à l'origine du cone. Donc quand on veut
> pivoter, on veut que la pointe reste en place et que ce soit le reste qui pivote… »

---

## 1. Décision (a) — la forme SEULE, et ce que cela abandonne

**Tranché : la forme réelle remplace le surlignage des cases.** Plus de cases surlignées, plus
de liste de cases dans le modèle ni sur le réseau.

Il faut écrire ce que cette décision abandonne, parce que ce n'est pas un choix de rendu. Le
CdC §5.9 ne demandait pas une forme : il demandait de surligner les cases, **et il disait
pourquoi** — clore « est-ce que le gobelin est dans la boule de feu ? » par une réponse binaire
et non discutable. L-08 §4 avait poussé la logique jusqu'au bout avec la règle du centre de case.

**Cette propriété est abandonnée sciemment.** Désormais le verdict se lit à l'œil sur la forme,
donc :

- **le contour devient la règle**, et sa justesse visuelle n'est plus cosmétique. C'est là que se
  déplace l'exigence, pas là qu'elle disparaît ;
- un pion à cheval sur le bord se tranchera à la table, comme avant la fonction. Le §5.9 est
  amendé sur sa raison d'être, et l'amendement doit le dire (§10).

**Ce qui disparaît du code** : `computeTemplateCells`, `getSessionTemplateCells`, le champ
`cells` du payload de `template.place`, et la passe de remplissage par case de `TemplatesLayer`.
C'est une tranche qui **retire** plus qu'elle n'ajoute, côté modèle.

### ⚠ Conséquence manquée à la première rédaction : un critère coché du lot 2 tombe

Le critère 3 du lot 2 est écrit, dans le CdC §11, mot pour mot :

> - [x] Un gabarit circulaire **surligne les cases affectées** en respectant les murs.

Il est **coché**, fermé par L-08. La décision (a) le rend faux **tel qu'il est rédigé** : sans
cases surlignées, le critère n'est plus satisfait quoi que fasse la forme. Deux conséquences, et
la seconde change le périmètre :

1. **Le critère 3 doit être amendé lui aussi**, pas seulement le §5.9. Sans quoi le lot 2 repasse
   de 10 sur 13 à 9 sur 13 — la liste d'acceptation du CdC *est* la définition de « fait ».
2. **La découpe par les murs n'est donc plus optionnelle.** La demande disait « idéalement la
   forme épouse les murs […] si trop compliqué on laisse tomber » ; or « en respectant les murs »
   est la moitié du critère. L'abandonner ne reformulerait pas le critère, il le **perdrait**.
   Comme la découpe est un `ctx.clip()` sur un polygone déjà calculé (§3.3), le coût ne justifie
   pas de le perdre : **elle est exigée.**

> ⚠ Conséquence directe sur le §3 : le défaut des pointes mangées et son correctif à 2 %
> deviennent **sans objet**, puisqu'aucune case n'est plus énumérée. La mesure reste consignée
> parce que **sa cause survit** : elle explique pourquoi un contour découpé par le polygone de
> sweep montrera des cordes plates, et c'est exactement ce qui compte maintenant que le contour
> fait loi.

---

## 2. Décisions (b) et (c), et le point resté ouvert

### 2.1 La pointe est l'ancre — décision (b), et elle inverse ma proposition

Le cône se pose **pointe sur le personnage qui le lance**. Donc :

- **la pointe ne bouge pas quand on pivote** : elle est le point d'origine, au sens propre — le
  souffle part du personnage ;
- **on pivote en glissant depuis le corps**, pas depuis la pointe.

D'où une répartition des rôles qui tombe d'elle-même, et qu'il faut écrire pour ne pas la
réinventer de travers :

| geste sur le gabarit | effet |
|---|---|
| glisser depuis la **pointe** | **déplacer** le gabarit (la pointe est la poignée de position) |
| glisser depuis le **corps** | **pivoter** autour de la pointe, qui reste fixe |
| glisser hors du gabarit | pan de la carte, inchangé |

Le cercle n'a pas de pointe : il se déplace en glissant n'importe où sur lui, et ne pivote pas.
Son ancre est son **centre**.

> ⚠ `Template.origin` n'a donc pas le même sens selon la forme : **centre** pour le cercle,
> **pointe** pour le cône. À nommer dans le typedef, sans quoi le premier lecteur supposera
> « centre » pour les deux et placera un cône décalé d'un rayon.

**Aucun geste nouveau n'est inventé** : ce sont deux zones d'un même glisser, désambiguïsées par
le point de départ. Le budget de gestes tenait le tap (pion, porte, pose), l'appui long (verrou)
et le glisser (pion, pan) ; le glisser sur un gabarit s'insère par priorité de cible, comme le
pion s'insère avant la porte.

### 2.2 Priorité des cibles sous le doigt, à arrêter avant d'écrire

L'ordre existant est : pion, puis porte, puis rien. Le gabarit s'y insère, et **le pion doit
rester premier** — c'est l'objet qu'on manipule le plus souvent, et un gabarit couvre par
construction une large surface où des pions se trouvent.

> Ordre proposé : **pion → gabarit → porte → pan.** Un gabarit posé sur une porte ne doit pas
> empêcher de l'ouvrir : la porte reste atteignable là où le gabarit ne couvre pas, et la capsule
> de porte fait un quart de case (`PORTAL_HIT_CELL_RATIO`).

### 2.3 Les joueurs manipulent — décision (c), sur le modèle des portes

**Tranché : oui, avec autorisation par transition, comme L-05.** Le CdC §12 Q8, tranché le
04/08 (« MJ seul au lot 2 »), est donc **rouvert et amendé** — c'est la seconde fois qu'une
question du §12 est rouverte par la table, et c'est légitime : Q8 avait été tranchée sans séance.

Répartition proposée, calquée sur les portes :

| action | MJ | joueurs |
|---|---|---|
| poser un gabarit | ✅ | ❌ |
| déplacer, pivoter | ✅ | ✅ |
| effacer | ✅ | ❌ |
| changer rayon / couleur / visibilité | ✅ | ❌ |

**La règle est à l'émission, pas à l'application** (L-05 §6.3) : un client qui refuserait
d'appliquer un déplacement émis par un autre divergerait de la campagne. La vue joueurs gagne
donc un module de manipulation — ce que L-08 §11 excluait explicitement, et qui est le vrai coût
de cette décision.

### 2.4 Pas d'aimantation de la pointe — tranché

« Pointe au niveau du perso » et « inutile de chercher à l'ancrer sur la map » ne se contredisaient
pas : l'un parle de pion, l'autre de grille. La question était donc réelle, et elle est tranchée.

**Aucune aimantation, ni sur un pion ni sur la grille** — décision du mainteneur, 05/08/2026,
« on verra à l'usage ». La pointe étant la poignée de position, la poser sur un pion est déjà
facile, et une aimantation qui accroche mal est plus pénible qu'absente. ⛔ **Ne pas l'ajouter
« pendant qu'on y est »** : c'est le genre d'aide qui se juge à la table et nulle part ailleurs.

---

## 3. Ce que la mesure a établi, et pourquoi ça compte encore

### 3.1 « Une case à droite » était trois cases mangées ailleurs

Sonde sur une grille 21×21, rayon 4, origine (10,10), `computeTemplateCells` réel :

```
   sans mur : 49 cases          avec un mur : 46 cases
     .....#.....                  ...........
     ...#####...                  ...#####...
     ..#######..                  ..#######..
     ..#######..                  ..#######..
     .####O####.                  ..###O####.
     ..#######..                  ..#######..
     ..#######..                  ..#######..
     ...#####...                  ...#####...
     .....#.....                  ...........
```

Dès qu'un segment existe, le calcul passe par le polygone de sweep, dont les **cordes coupent en
deçà** du cercle de portée : les pointes, à distance exactement 4, tombent dehors. Sauf celle de
droite, parce que le sweep émet un sommet pile à l'angle 0 et que l'`eps` de `isPointInPolygon`
la fait basculer dedans. **La case de droite était la seule correcte.**

Étendre la portée du sweep de 2 % restaurait les trois pointes sans laisser passer une seule case
derrière un mur (vérifié dans les deux sens). **Ce correctif ne sera pas écrit** : la décision (a)
supprime l'énumération de cases.

### 3.2 Mais la cause survit, et elle est maintenant visible

Le polygone de sweep approche le plafond de portée par des **cordes**. Un contour découpé par ce
polygone montrera donc des **facettes plates** là où le cercle devrait être lisse — et depuis la
décision (a), **le contour est le verdict**. Ce qui n'était qu'un défaut d'appartenance discrète
devient un défaut visible et arbitral.

À regarder au rendu, avec deux leviers possibles : la résolution angulaire du sweep près du
plafond de portée, ou un découpage du contour qui n'utilise le polygone que pour les **occulteurs**
et garde l'arc exact pour la portée. Le second est plus juste et probablement pas plus cher —
c'est la même séparation des deux conditions que le correctif à 2 % rétablissait.

### 3.3 « Épouser les murs » est la partie déjà écrite

`js/vision/sweep.js` produit le polygone de visibilité depuis l'origine et
`computeTemplateCells` l'appelle déjà. Faire épouser les murs à la forme est un
`ctx.clip(polygone)` avant de la remplir. **Ce n'est pas le morceau coûteux de cette tranche**,
contrairement à ce que la demande supposait.

Le morceau coûteux est la manipulation : sélection d'un objet non ancré, deux zones de glisser,
priorité des cibles, autorisation joueurs, et un `origin` qui devient un point carte.

> ⚠ Aveu de méthode : la première version de la sonde du §3.1 passait les segments au format
> `{a, b}` quand `sweep` attend `{p1, p2}`. Elle ne mesurait donc **aucune occultation** — la
> conclusion sur les pointes tient, elle ne dépend que du plafond de portée, mais le contrôle
> « aucune fuite derrière un mur » a dû être refait au bon format pour vouloir dire quelque chose.

---

## 4. L'origine libre a un piège que L-08 avait nommé

L-08 §4 l'écrit noir sur blanc :

> **L'origine est un `Cell`**, donc entière. Le sweep part du **centre** de cette case. Ne pas
> partir d'un coin : un coin est sur un mur potentiel, et le sweep depuis un point posé sur un
> segment est **indéterminé**.

Une origine libre peut tomber exactement sur un mur, ce qu'une origine en case ne pouvait pas —
et le cas se produira dès la première boule de feu posée sur une porte, ou dès le premier cône
dont la pointe se pose sur le pion collé au mur.

- **Proposition** : si l'origine tombe à moins d'ε d'un segment, la repousser de ε le long de la
  normale, **du côté où elle se trouvait** — le côté se lit au signe du produit vectoriel, et il
  doit être conservé, sinon un cône posé contre un mur se retrouverait à souffler dans la pièce
  voisine. ε **en pixels carte** et non en cases : la valeur est numérique, elle n'a pas à suivre
  le zoom ni la taille des cases. Déterministe, borné, invisible à l'écran.
- À écarter : refuser le placement (le MJ ne comprendrait pas pourquoi son doigt ne prend pas),
  et ignorer le cas (le polygone serait arbitraire, donc le contour aussi — et le contour fait
  loi).

---

## 5. Schéma, réseau, persistance

- `Template.origin` passe de `Cell` à `MapPoint`, et **son sens dépend de la forme** (§2.1).
- `Template.cells` et toute liste de cases **disparaissent** du modèle, du payload et du store de
  session.
- `directionDeg` **entre en service** (il existe depuis le lot 1a sans usage). Convention à
  fixer : degrés, sens horaire, 0 = vers l'est. À écrire dans le typedef, pas seulement ici.
- `radiusCells` **reste entier** : la dimension se donne en cases, comme demandé.
- `template.move` **existe déjà au CdC §7** et n'a jamais été implémenté. Il portera position
  **et** direction — un pivot est un déplacement au sens du modèle, et deux événements pour un
  geste continu se désynchroniseraient.
- **Migration** : les campagnes persistées portent `origin: {a, b}` et éventuellement des cases.
  Normalisation à la lecture, exactement comme L-05 pour `closed` → `state` sur 182 portails :
  la lecture accepte les deux, l'écriture n'émet que la nouvelle forme.
- Fréquence de publication pendant un glisser : **au relâchement seulement**, comme le glisser de
  pion publie sa case d'arrivée et non sa trajectoire.

---

## 6. Ce qu'il faut écrire

Inventaire des fichiers touchés, pour que le périmètre soit lisible avant d'ouvrir un éditeur.
**Ce que cette tranche retire compte autant que ce qu'elle ajoute.**

### À retirer

- `js/render/layers/templates.js` — `computeTemplateCells` et `isPointInPolygon` **sortent** (la
  seconde n'existait que pour la première). La couche ne peint plus de cases.
- `js/state/store.js` — le store de session des cases de gabarit (`getSessionTemplateCells` et
  son alimentation).
- `js/app/networkEvents.js` — le champ `cells` du payload `template.place`, et la garde qui le
  validait.
- `js/app/gm.js` — l'appel à `computeTemplateCells` au placement, et le passage des cases à la
  publication.

⚠ Retirer `computeTemplateCells` **casse** `tests/templates.test.mjs`, et le tri est à faire
test par test — « nettoyer » ou « réécrire » le fichier en bloc est trop vague pour être exécuté
sans dommage. Sur les huit tests actuels :

| test | sort |
|---|---|
| `isPointInPolygon` détermine… | **supprimé** — la fonction disparaît |
| Énumération 5 / 13 / 29 / 49 cases | **supprimé** — règle abandonnée |
| Occlusion : 21 cases contre 31 | **supprimé, mais son intention est transplantée** (voir ci-dessous) |
| « Le centre de la case décide » | **supprimé** — règle abandonnée |
| Store `placeTemplate` / `clearTemplates` | adapté : plus d'argument `cells` |
| Schéma refuse un gabarit malformé | adapté : `origin` est un `MapPoint` |
| Réseau `template.place` / `template.clear` | adapté, plus `template.move` |
| Isolation : aucune formule euclidienne réinventée | à réexaminer selon ce qui reste |

⛔ **Ne pas « adapter » les quatre premiers pour les garder verts** : un test conservé sur une
règle morte mesure le passé, et il maintiendra en vie la fonction qu'il teste.

⚠ **Mais l'intention du test d'occlusion doit survivre.** Il prouvait qu'un mur arrête l'effet —
la moitié du critère 3 du lot 2. Le supprimer sans le remplacer ferait perdre la propriété en
silence, avec une suite verte. Son remplaçant porte sur la **découpe** : une portion de forme
derrière un mur n'est pas peinte.

### À écrire

- `js/render/layers/templates.js` — rendu de la forme réelle : arc pour le cercle, secteur
  circulaire pour le cône (`origin` = pointe, `directionDeg`, `radiusCells`, angle du cône à
  fixer — 60° est la convention D&D 5e, à écrire dans les constantes et non en dur). Découpe par
  les murs au `ctx.clip()` sur le polygone de sweep. **Toutes les grandeurs de contour en pixels
  écran divisés par le zoom** — c'est le troisième endroit du projet où cette règle a été violée
  (chantier K, L-09, indicateurs de porte), qu'elle ne le soit pas une quatrième fois.
- `js/input/templateHit.js` (nouveau) — désignation sous le doigt : dans la pointe, dans le corps,
  ou dehors. **Logique pure, testable sous Node**, sur le modèle de `js/input/portalHit.js`. La
  taille de la zone « pointe » est une constante commentée, en pixels écran.
  ⚠ **Et bornée par la taille de la forme à l'écran**, sinon la poignée avale le corps : à la vue
  « carte entière » une case fait 33 px, donc une poignée fixe de 24 px ne laisse plus de zone
  « corps » sur un cône de rayon 1 — la rotation devient impossible et rien ne le signale. Même
  remède que le cadenas de porte : `min(taille fixe, fraction de la taille écran de la forme)`.
- `js/core/constants.js` — angle du cône, taille de la poignée de pointe, ε de décollement de
  l'origine (§4).
- `js/core/types.js` + `js/core/schema.js` — `origin: MapPoint`, sens dépendant de la forme
  (§2.1), convention de `directionDeg`, normalisation à la lecture des anciennes campagnes (§5).
  ⚠ **`js/core/schema.js` ne peut pas importer `js/grid/*`** : la règle §2 d'`ARCHITECTURE.md`
  n'autorise `core/*` qu'à importer `core/*`, et le test 6 du manifeste la vérifie fichier par
  fichier. La conversion `{a, b}` → `{x, y}` doit donc se faire **en arithmétique sur place**, à
  partir de `level.pxPerCell` et `level.grid.offsetX/offsetY` du niveau retrouvé par
  `template.levelId` — et sur le **centre** de la case, `offset + (a + 0,5) × pxPerCell`, jamais
  le coin : l'ancienne origine était le centre de sa case (L-08 §4), et prendre le coin
  décalerait chaque gabarit migré d'une demi-case.
- `js/app/gm.js` et `js/ui/player/` — la manipulation, avec la règle d'autorisation à l'émission
  (§2.3) et l'ordre des cibles (§2.2).
- `js/app/networkEvents.js` — `template.move` portant position **et** direction.

---

## 7. Tests attendus, et la preuve qu'ils mordent

Le protocole du dépôt s'applique intégralement, et il n'est pas négociable ici : **la revue de
L-09 a attrapé douze faux verts sur trois passes, et les défauts qui ont survécu étaient des
défauts de _prédicat_, pas d'implémentation.**

- **Unitaires** (`js/input/templateHit.js`) — pointe / corps / dehors, sur le cercle et sur le
  cône, aux quatre orientations cardinales et à deux zooms. Cas limite : un cône de rayon 1.
- **Unitaires** (schéma) — une campagne portant `origin: {a, b}` et une liste de cases se relit
  sans perte ; une campagne neuve n'émet que la nouvelle forme.
- **E2E** — les critères 1 à 5 et 7 du §9, chacun avec son geste réel.
- **E2E** — le critère 2 s'assure sur `origin`, **pas sur l'image** : pivoter ne doit pas déplacer
  la pointe d'un pixel, et c'est une assertion sur la donnée.

> ⛔ **Chaque assertion doit être prouvée par mutation** : casser le code qu'elle prétend
> vérifier, constater qu'elle rougit, restaurer. Une assertion qui survit à la mutation de son
> propre sujet est à réécrire, pas à commenter. Voir `debugging_lessons` et le protocole de revue
> de L-09.
>
> ⚠ Deux pièges déjà payés dans ce dépôt, à ne pas repayer : muter le store en direct **ne publie
> rien** (donc une assertion de propagation qui passe sans qu'aucun événement soit parti ne prouve
> rien), et une **sonde de pixels qui échantillonne hors du canvas rend zéro**, ce qui est
> exactement ce que rendrait un rendu absent — d'où l'obligation d'exprimer ses préconditions.

---

## 8. Ce qui n'est PAS dans cette tranche

- La **ligne** (`TemplateShape` la déclare ; seul le cône est demandé en plus du cercle).
- L'**aimantation** de la pointe sur un pion (§2.4).
- L'**undo** : aucun undo de campagne n'existe, et la pile de L-06 porte des masques de fog.
- Le **compte de pions touchés** affiché.
- Toute **énumération d'aire** ajoutée à `GridAdapter` : y toucher ouvrirait le lot 4.

---

## 9. Critères d'acceptation

1. Un gabarit se **sélectionne** d'un tap et se **déplace** au doigt sans jamais déclencher un pan
   ni un déplacement de pion. Ordre des cibles respecté : pion → gabarit → porte → pan (§2.2).
2. Un cône **pivote autour de sa pointe**, laquelle **ne bouge pas d'un pixel** pendant la
   rotation — assertion sur `origin`, pas sur l'image.
3. Un glisser depuis la **pointe** déplace ; un glisser depuis le **corps** pivote. Les deux se
   distinguent au point de départ, et le test le vérifie dans les deux sens.
4. La forme **épouse les murs** — **exigé, non optionnel** : « en respectant les murs » est la
   moitié du critère 3 du lot 2, et l'abandonner le perdrait au lieu de le reformuler (§1). Le
   test transplante l'intention de l'ancien test d'occlusion : une portion de forme derrière un
   mur n'est pas peinte.
5. Un **joueur** peut déplacer et pivoter, **pas** poser ni effacer, et la règle est vérifiée à
   l'émission (L-05 §6.3).
6. Une campagne persistée avec `origin: {a, b}` et une liste de cases se relit **sans perte et
   sans erreur** (§5).
7. Aucun geste existant ne régresse : porte, verrou, pion, pan. Les tests de L-05, L-07 et L-09
   restent verts **sans modification**.
8. Le contour ne montre pas de facette plate grossière à la vue « carte entière » (§3.2), ou la
   limite est mesurée et écrite.

---

## 10. Amendements requis

- **CdC §11, critère 3 du lot 2** — à amender **et à laisser coché** : « surligne les cases
  affectées » devient « dessine la zone d'effet ». Sans cet amendement, le critère est faux tel
  qu'il est rédigé et le lot 2 retombe à 9 sur 13 (§1).
- **CdC §5.9** — amendement daté : la forme réelle **remplace** le surlignage. La *raison d'être*
  du paragraphe est réécrite, pas seulement son rendu — l'arbitrage binaire est abandonné au
  profit d'un objet manipulable (§1).
- **CdC §12 Q8** — **rouverte et amendée** : les joueurs manipulent, avec autorisation par
  transition (§2.3).
- **CdC §7** — `template.move` porte position et direction.
- **`ARCHITECTURE.md` §1** — tout nouveau module (hit-test des gabarits, manipulation côté
  joueurs) doit y figurer, sinon le test 5 du manifeste échoue, et c'est voulu.
- **`ETAT.md`** — le retour de table du 05/08 renvoie déjà ici ; la ligne du lot 2 devra dire que
  L-08 est **remplacée** par L-10 sur le rendu et le modèle.

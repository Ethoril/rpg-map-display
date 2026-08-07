# TRANCHE L-08 — gabarits de zone d'effet

> **Mise à jour du 07/08/2026 :** le §14 ci-dessous décrit l'état au moment de la livraison de
> L-08. Les critères 4, 10 et 11 ont depuis été validés sur le dispositif réel ; le lot 2 est
> fermé à 13/13.

> Huitième tranche du **Lot 2 du CdC §11**. Découpage : `PLAN-LOT2.md` §4. Dépend de **L-02**
> (`vision/sweep.js`), livrée. Ne dépend ni de L-01, ni de L-04 à L-07.
>
> Elle ferme le **critère 3** — « un gabarit circulaire surligne les cases affectées **en
> respectant les murs** ». Le lot passe de 8/13 à 9/13, et **tout le lot 2 sera alors écrit** :
> ce qui restera n'attend plus de code (voir §14).
>
> Spécification de référence : CdC §5.9. Elle règle « le principal arbitrage verbal pénible à
> table — *est-ce que le gobelin est dans la boule de feu ?* — en le rendant visible de tous sur
> l'écran partagé ». C'est le but à garder en tête : la tranche ne livre pas un dessin, elle
> livre une **réponse sans discussion**.

---

## 1. Ce qui a été mesuré avant d'écrire ce brief

Sept briefs sur sept ont été corrigés par une mesure faite **avant** la première ligne de code.
Celle-ci en corrige deux : **le cahier des charges se trompe sur l'occlusion**, et **je me
trompais sur la forme**.

### 1.1 La forme : `grid.distance()` suffit, contre mon hypothèse

`SquareGrid.distance` est une distance **octile** — `max(dx,dy) + 0,5·min(dx,dy)`, une métrique
de *déplacement*. Un cercle n'en est pas une, et je m'attendais donc à ce qu'énumérer les cases
par `grid.distance()` produise un octogone plutôt qu'un disque. Mesuré, case par case :

| Rayon | Par `grid.distance()` octile | Par distance du centre | Écart |
|---|---|---|---|
| 1 | 5 | 5 | **aucun** |
| 2 | 13 | 13 | **aucun** |
| 3 | 29 | 29 | **aucun** |
| 4 | 49 | 49 | **aucun** |
| 5 | 73 | 81 | 8 cases |
| 6 | 105 | 113 | 8 cases |
| 7 | 141 | 149 | 8 cases |
| 8 | 181 | 197 | 16 cases |

**Les deux coïncident exactement jusqu'au rayon 4**, qui couvre les gabarits usuels — une boule
de feu de 20 pieds fait 4 cases, une explosion de 10 pieds en fait 2. À partir du rayon 5,
l'octile **rogne** 8 cases aux quatre extrémités diagonales.

**Décision : énumérer par `grid.distance()`, et écrire la limite.** L'interdiction n°7 est
absolue — « ne jamais coder une distance en dur (Chebyshev, octile, euclidienne), toujours
`grid.distance(a, b)` » — et elle a une bonne raison : c'est ce qui rendra l'hexagone bon
marché au lot 4. Fabriquer une distance euclidienne dans `render/` ou `ui/` la violerait pour
gagner 8 cases sur des rayons que personne n'utilise encore.

Si un gabarit de rayon 5 ou plus devient un besoin réel, **le correctif appartient à
`GridAdapter`** — une méthode d'énumération d'aire, honorée par `SquareGrid` et par `HexGrid` —
et non à l'appelant. À ne pas improviser dans cette tranche.

### 1.2 L'occlusion : le CdC §5.9 propose la mauvaise brique, et l'écart est mesurable

Le §5.9 affirme qu'un gabarit s'appuie « entièrement sur des briques déjà spécifiées :
énumération de cases via `GridAdapter`, et **occlusion par les segments de murs et portes
fermées du §5.3bis** », donc « sans code de géométrie supplémentaire ». Or le §5.3bis est le
**masque d'arêtes bloquées**, qui est une notion de *déplacement* : il dit ce qu'on peut
franchir en marchant, pas ce qu'on voit.

Mesuré sur `manoir-rdc`, rayon 4, **182 origines balayées** sur la carte réelle :

| Grandeur | Valeur |
|---|---|
| Écart moyen entre les deux occlusions | **3,0 cases par gabarit** |
| Pire cas : **marchable mais non vu** | **11 cases** — origine `{a:31, b:31}` |
| Pire cas : vu mais non marchable | 2 cases |

> **Les chiffres de cette origine, réconciliés**, parce qu'ils se lisent mal séparément : sur les
> 49 cases du rayon, le sweep en retient **21** et la marche **31**. Onze sont marchables sans
> être vues, une est vue sans être marchable, vingt sont les deux. L'écart de comptes est donc de
> 10, et l'écart d'ensembles de 12 — ce sont deux grandeurs différentes, et c'est la seconde qui
> compte : chacune de ces 12 cases recevrait une réponse fausse.

**Onze cases sur trente-et-une, soit plus d'un tiers du gabarit**, seraient déclarées touchées
alors qu'aucune ligne de vue ne les atteint. C'est la boule de feu qui contourne le coin en
marchant, et c'est exactement l'arbitrage que le §5.9 prétend clore qui serait rouvert — en
pire, puisque l'écran donnerait une réponse fausse avec autorité.

Le cas inverse, 2 cases **vues mais non marchables**, confirme le même choix : ce sont des cases
visibles en diagonale au-delà d'un bout de mur, où l'anti-corner-cutting interdit le pas. Une
explosion les atteint — on les voit. Le sweep a raison des deux côtés.

**Décision : l'occlusion se calcule au `sweep`, jamais aux arêtes bloquées.** `PLAN-LOT2.md` §4
avait raison de faire dépendre L-08 de **L-02** et non de L-01 ; c'est le §5.9 qui doit être
amendé (§10).

### 1.3 Le coût : recalculable à chaque image, sans cache ni throttle

Coût d'un recalcul **complet** — un `sweep` depuis l'origine, puis le test de toutes les cases
candidates :

| Rayon | `manoir-rdc` (171 segments) | `testbig150` (1396 segments) |
|---|---|---|
| 2 | 0,23 ms | 0,14 ms |
| 4 | 0,29 ms | 0,10 ms |
| 8 | 0,30 ms | 0,20 ms |
| 12 | **1,27 ms** | 0,34 ms |

Le pire cas des deux cartes et des quatre rayons est **1,27 ms**. Un gabarit peut donc être
recalculé **à chaque image** pendant qu'on le place, et il ne faut ni mémoïsation, ni throttle,
ni publication différée. Écrit ici pour qu'on n'optimise pas ce qui ne coûte rien : le lot a
déjà payé une fois l'optimisation prématurée, et une fois l'absence de mesure.

> Relevé au poste de bureau. Ce ne sont pas des verdicts de performance — aucun critère n'en
> dépend, l'interdiction n°14 n'est pas en jeu : ils servent à écarter un cache dont personne
> n'a besoin.

---

## 2. Ce qu'il faut écrire

| Fichier | État |
|---|---|
| `js/render/layers/templates.js` | **déjà au manifeste**, et `'templates'` est **déjà** dans `CANVAS_LAYER_ORDER` (`js/render/stage.js:10`) |
| `js/ui/gm/templateTools.js` | **hors manifeste** → amendement (§9.1) |
| `js/core/types.js` | `Template` **existe déjà et est complet** — rien à changer |
| `js/core/schema.js` | valider les champs autres que `color` (§8) |
| `js/state/store.js` | `placeTemplate`, `clearTemplates` |
| `js/app/networkEvents.js` | `template.place`, `template.clear` |
| `js/app/gm.js`, `js/ui/gm/panel.js` | montage et geste |

**Rien dans `js/input/`**, pour la même raison qu'à L-07 : poser un gabarit est un tap (§9.2).

**Rien dans `js/vision/`** : le sweep est utilisé tel quel. Si cette tranche modifie
`vision/sweep.js`, c'est qu'elle s'égare.

---

## 3. Le partage d'autorité

| Calcul | Où | Pourquoi |
|---|---|---|
| Cases affectées par un gabarit | **partout, localement** | déterministe à partir de la géométrie d'étage et du gabarit |
| Vision, fog | Mac seul, publiés | CdC §4 |

Un gabarit est une **donnée de campagne** (`campaign.templates`, déjà au modèle), et les cases
qu'il touche sont **recalculables** par chaque client à partir de lui. `CONVENTIONS.md` §4 :
« ne jamais transmettre ce que le destinataire peut recalculer » — donc **la liste des cases
affectées ne transite jamais**, seul le gabarit voyage. C'est le même partage que les arêtes
bloquées, et pour la même raison.

⚠ **Ne pas confondre avec le fog.** Le fog voyage en masque parce que les tablettes n'ont pas le
droit de calculer la vision (CdC §4, mesuré à L-04 : le polygone pesait 38 à 180 Kio). Un
gabarit est l'inverse : sa description tient en une dizaine de champs, et son évaluation coûte
au pire 1,27 ms (§1.3). Publier des cases serait payer cher pour rendre le modèle faux.

---

## 4. La règle « case affectée », à arrêter avant d'écrire

Deux conditions, dans cet ordre :

1. **`grid.distance(origine, case) <= radiusCells`** — l'énumération, par l'adaptateur (§1.1).
2. **le centre de la case est dans le polygone de sweep** issu de l'origine, de portée
   `radiusCells` convertie en pixels carte (§1.2).

**Pourquoi le centre de la case, et non « tout recouvrement ».** « Tout recouvrement » exigerait
de découper chaque case contre le polygone — de la géométrie nouvelle, précisément ce que le
§5.9 promet d'éviter, et un arbitrage à la marge sur chaque case de bordure. Le centre donne une
réponse **binaire et non discutable**, ce qui est le but déclaré du §5.9 : clore l'arbitrage,
pas le déplacer d'un cran.

**Conséquence assumée, à écrire dans l'interface** : une case effleurée par le bord du cercle
n'est pas touchée. C'est une règle de jeu, elle doit être lisible, et elle est cohérente avec le
reste du projet — le modèle discret du §5.3bis place déjà les pions au centre de leur case.

**L'origine est un `Cell`**, donc entière (le modèle le dit : `origin: Cell`). Le sweep part du
**centre** de cette case, `grid.pointFromCell(origine)`. Ne pas partir d'un coin : un coin est
sur un mur potentiel, et le sweep depuis un point posé sur un segment est indéterminé.

---

## 5. Ce que le gabarit affiche, et pour qui

`Template.visibleToPlayers` existe déjà au modèle. Il **ne s'invente pas un sens** ici : un
gabarit visible aux joueurs se dessine sur les deux vues, un gabarit invisible ne se dessine que
côté MJ. Le défaut est `true` — la fabrique `createTemplate` le fixera —, parce que l'usage
nommé par le §5.9 est de rendre la zone « visible de tous sur l'écran partagé ».

⚠ **Le fog reste au-dessus.** `'templates'` est avant `'tokens'` et `'fog'` dans
`CANVAS_LAYER_ORDER`, donc un gabarit posé en zone non explorée est masqué côté joueurs par le
voile plein. C'est correct et il ne faut pas le contourner : un gabarit ne doit pas révéler la
forme d'une pièce que les joueurs n'ont pas visitée.

Côté MJ, le voile est semi-transparent : le gabarit s'y verra, ce qui est voulu — la vue MJ est
une carte de travail.

---

## 6. Le périmètre : le cercle, et pourquoi pas encore le cône ni la ligne

Le §5.9 nomme trois formes, et `TemplateShape` les déclare déjà : `'circle' | 'cone' | 'line'`.

**L-08 livre le cercle seul.** Le critère 3 ne porte que sur lui, et les deux autres demandent
`directionDeg`, donc un geste pour **orienter** — un second tap, sa désambiguïsation, son
retour visuel pendant l'orientation. C'est de l'interface réelle, pas un prédicat de plus.

Le modèle portant déjà `directionDeg` et `widthCells`, les ajouter plus tard **ne demandera
aucune refonte** : le sweep, le test de visibilité, la publication et le rendu sont communs, seul
le prédicat d'appartenance change. C'est un report daté, pas un oubli — le même arbitrage qu'à
L-07 pour « déplacer », et il a bien tourné deux fois.

---

## 7. Les événements

Le CdC §7 liste `template.place` / `move` / `clear`, « MJ, joueurs si autorisé ».

```js
{ type: 'template.place', payload: { template: Template }, at, by: 'gm' }
{ type: 'template.clear', payload: { levelId }, at, by: 'gm' }
```

**`template.move` n'est pas émis**, et le nom reste réservé — le précédent est `fog.paint` à
L-06. Déplacer un gabarit, c'est le reposer à une autre origine : `template.place` portant le
**même `id`** remplace l'existant. Un second nom pour le même effet ferait deux chemins vers un
même état, ce que ce dépôt a déjà payé assez de fois.

`template.place` porte le gabarit **entier**, valeurs absolues, donc rejouable : deux fois le
même événement converge. Le payload est un objet plat sans tableau imbriqué — `origin` est un
`Cell`, pas une polyligne — il ne réveille donc pas `assertNoNestedArrays`.

`template.clear` vide les gabarits **de l'étage nommé**, pas tous : le `levelId` figure au
payload et ne se déduit pas de l'étage affiché, le MJ et la tablette pouvant regarder deux
étages différents. C'est la leçon de `portal.toggle` à L-05.

---

## 8. Le schéma valide les couleurs et rien d'autre — pour la troisième fois

`validateCampaign` vérifie `template.color` (`js/core/schema.js:802-808`) et
`normalizeCampaignColors` la normalise (`:143-155`). **Aucun autre champ n'est validé** : ni
`shape`, ni `origin`, ni `radiusCells`, ni `levelId`, ni `visibleToPlayers`.

C'est la **troisième tranche d'affilée** à faire ce constat — les portails avant L-05, les murs
avant L-07, les gabarits maintenant. La cause est identifiable : le chantier G a durci les
couleurs partout et rien d'autre nulle part. Tant que la donnée venait d'un import, le trou
restait théorique ; dès qu'un humain la fabrique, il devient un chemin d'entrée.

À valider par gabarit : `id` chaîne non vide, `levelId` désignant un étage existant, `shape`
parmi les trois valeurs, `origin` un `Cell` aux coordonnées **entières** (`Number.isInteger`,
pas seulement finies — le modèle l'exige), `radiusCells` fini et strictement positif,
`visibleToPlayers` booléen. Message nommant le gabarit, comme celui des couleurs le fait déjà.

> Le contrôle de `Number.isInteger` sur `origin` n'est pas du zèle : `Cell` et `CellPoint` sont
> délibérément non interchangeables (`CONVENTIONS.md` §1), et un gabarit dont l'origine
> arriverait en fractionnaire ferait partir le sweep d'un point qui n'est pas un centre de case.

---

## 9. Le geste et l'interface

### 9.1 Amendement du manifeste

Le manifeste porte `render/layers/templates.js`, mais **aucun module d'interface** pour les
gabarits — `ui/gm/` liste `panel`, `importPanel`, `tokenMaker`, `sceneLibrary`, `tokenLibrary`,
`handouts`, `fogTools`, `wallEditor`, `levelSelector`, et c'est tout.

| Fichier | Rôle |
|---|---|
| `js/ui/gm/templateTools.js` `[2]` | choix de la forme et du rayon, armement, effacement |

**Troisième amendement en trois tranches** — `portals.js` à L-05, `walls.js` à L-07,
`templateTools.js` ici. `PLAN-LOT2.md` §1 annonçait « les six fichiers du lot sont déjà au
manifeste » ; il en manquait trois. Le constat vaut d'être écrit une fois : la liste d'origine a
compté les briques de calcul et de rendu, et oublié qu'une brique manipulable par le MJ demande
aussi une surface pour la manipuler.

### 9.2 Le geste : un tap, comme L-07

Le rayon et la forme se choisissent dans le panneau ; **un tap sur la carte pose l'origine** et
crée le gabarit. Aucun glisser, donc aucune ligne dans `js/input/`.

L'outil est le **quatrième mode armé** de la vue MJ, après le glisser de pion, le pinceau de fog
et l'éditeur de murs. La règle établie s'applique telle quelle : armer l'un désarme les autres,
et l'exclusion vit dans `panel.js`, où les modules sont montés. Outil armé ⇒ `canStartTokenDrag`
rend `null`, `canStartBrush` rend `false`, et la branche `tap` de `gm.js` sert l'outil **avant**
le hit-test de pion et celui de portail.

⚠ **Quatre modes exclusifs, c'est le seuil où la solution ad hoc devient une convention à
nommer.** Trois prédicats injectés et quatre outils qui se désarment mutuellement par
énumération, cela tient encore ; au cinquième, il faudra un état « outil actif » unique dans la
vue MJ plutôt que des exclusions deux à deux. Ce n'est **pas** le travail de L-08 — mais le
prochain qui ajoute un outil doit trouver cette phrase avant d'ajouter le cinquième `if`.

### 9.3 Effacer

Un bouton « Effacer les gabarits » de l'étage actif. Pas de suppression individuelle : un
gabarit est éphémère par nature — il répond à une question, puis il disparaît — et sélectionner
un gabarit parmi plusieurs demanderait un hit-test dont personne n'a montré le besoin. Reposer
le même `id` suffit à corriger un placement raté (§7).

---

## 10. Amendements requis

- **CdC §5.9** — la phrase « occlusion par les segments de murs et portes fermées du §5.3bis »
  est fausse et doit être corrigée : l'occlusion se calcule au **sweep** (`vision/sweep.js`),
  pas au masque d'arêtes bloquées. Consigner la mesure du §1.2 — 3 cases d'écart en moyenne,
  11 dans le pire cas relevé — parce que c'est elle qui tranche, et que sans elle quelqu'un
  refera le raisonnement en sens inverse. Le reste du §5.9 tient : l'énumération passe bien par
  `GridAdapter`, et il n'y a bien aucune géométrie nouvelle à écrire.
- **CdC §5.9** — consigner que le cône et la ligne sont reportés (§6), le modèle les portant
  déjà sans refonte à prévoir.
- **CdC §7** — `template.move` n'est pas émis, `template.place` au même `id` remplace (§7).
- **CdC §11, lot 2** — cocher le critère 3 une fois vérifié. Aucun seuil, aucun matériel :
  l'interdiction n°14 ne s'y applique pas.
- **CdC §12, Q8** — « Gabarits manipulables par les joueurs ? » est **tranchée** : MJ seul,
  conformément à `PLAN-LOT2.md` §2.5. Le modèle l'autorisera plus tard sans refonte,
  `template.place` étant ouvert aux deux au §7, mais rien ne l'implémente au lot 2.
- **`ARCHITECTURE.md` §1** — ajouter `js/ui/gm/templateTools.js` `[2]` (§9.1).
- **`CONVENTIONS.md` §8 n°2** — rien à changer : les gabarits figurent déjà dans la liste de ce
  qui s'affiche en vue joueurs.

---

## 11. Ce qui n'est PAS dans cette tranche

- **Le cône et la ligne** (§6), **`template.move` sur le fil** (§7), la suppression
  individuelle (§9.3).
- **La manipulation par les joueurs** (§10, Q8 tranchée). Aucun module de gabarit sous
  `js/ui/player/`, aucun import de `templateTools.js` depuis la vue joueurs.
- **Aucune liste de cases affectées sur le réseau** (§3).
- **Aucune énumération d'aire ajoutée à `GridAdapter`** : `grid.distance()` suffit jusqu'au
  rayon 4 et la limite est écrite (§1.1). Y toucher serait ouvrir le lot 4 par la fenêtre.
- **Aucun undo.** Reposer ou effacer suffit, et la pile de L-06 porte des masques de fog, pas
  des mutations de campagne.
- Pas d'animation, pas de dégradé, pas de compte de pions touchés affiché : le surlignage des
  cases *est* la réponse.

---

## 12. Critères d'acceptation

1. **Critère 3 du §11** — un gabarit circulaire posé sur `manoir-rdc` surligne les cases
   affectées, et **un mur les arrête** : une case derrière un mur, dans le rayon, n'est pas
   surlignée.
2. **L'occlusion est celle du sweep, pas celle de la marche.** Test unitaire adossé au §1.2 :
   à l'origine `{a:31, b:31}` sur `manoir-rdc`, rayon 4, le gabarit retient **21 cases**, là où
   l'énumération par arêtes bloquées en retiendrait 31. La mesure devient une garde, et c'est
   elle qui empêche de « simplifier » vers le §5.3bis.
3. **La forme est celle de `grid.distance()`** — 5, 13, 29, 49 cases pour les rayons 1 à 4 en
   terrain dégagé. Aucune distance codée en dur : un grep de `Math.hypot`, `Math.sqrt` et
   `Chebyshev` hors de `js/grid/` reste muet.
4. **Le centre décide** — une case dont le centre est hors du cercle n'est pas surlignée, même
   effleurée par le bord.
5. **Le gabarit arrive sur les trois écrans** quand `visibleToPlayers` est vrai, et **sur le
   seul écran MJ** quand il est faux.
6. **Un gabarit en zone non explorée reste invisible aux joueurs**, masqué par le voile plein.
7. **`template.place` est idempotent**, et reposer le même `id` déplace au lieu de dupliquer.
8. **`template.clear` ne vide que l'étage nommé** — vérifié sur une campagne à deux étages.
9. **Aucune liste de cases sur le réseau** : un test compte les types émis et inspecte les
   payloads, qui ne portent que le gabarit ou un `levelId`.
10. **Le schéma refuse un gabarit malformé** — `shape` inconnue, `origin` fractionnaire,
    `radiusCells` nul ou négatif, `levelId` inexistant — en nommant le gabarit.
11. **Exclusion des outils** : armer les gabarits désarme le pinceau de fog et l'éditeur de
    murs ; un tap ne bascule aucune porte et ne sélectionne aucun pion ; un glisser panne.
12. `pnpm run verify` vert, `pnpm run check-deps` vert. `js/input/` et `js/vision/` **intouchés**,
    vérifié au diff.

---

## 13. Tests attendus

Unitaires (`node:test`) :

- **énumération** — 5, 13, 29, 49 cases pour les rayons 1 à 4 ; et le constat du §1.1 gelé :
  au rayon 5, `grid.distance()` en retient 73 quand la distance du centre en retiendrait 81.
  Ce test **documente une limite acceptée**, il ne la dénonce pas ;
- **occlusion** — les chiffres du §1.2 sur la géométrie publiée, dont l'origine `{a:31, b:31}`
  où le sweep retient 21 cases et la marche 31 ;
- **le centre décide** — une case dont le centre tombe juste hors du rayon est exclue ;
- **`placeTemplate` / `clearTemplates`** — gabarit invalide refusé, même `id` remplaçant,
  effacement limité à un étage, abonnés notifiés une fois ;
- **schéma** — les cinq refus du critère 10, chacun nommant le gabarit ;
- **événements** — `template.place` idempotent, payload malformé refusé et journalisé, étage
  inconnu refusé.

Navigateur (`*.spec.mjs`) :

- un gabarit posé côté MJ apparaît côté joueurs quand `visibleToPlayers` est vrai, et pas
  quand il est faux ;
- un mur coupe le surlignage — la vérification du critère 3 de bout en bout ;
- un gabarit en zone non explorée n'est pas visible côté joueurs ;
- outil armé : un tap près d'une porte ne la bascule pas ;
- `template.clear` vide l'étage courant et laisse l'autre intact.

---

## 14. Ce qu'il restera quand cette tranche sera livrée

**Tout le lot 2 sera écrit.** Ce qui restera ouvert n'attend plus de code :

- **critères 10 et 11** (L-05) — ouvrir une porte en moins de 300 ms, et l'ouvrir au doigt du
  premier coup : ils attendent la **Tab S9 FE**, l'interdiction n°14 refusant de les cocher sur
  un test de bureau. Pour le 11, le compte rendu devra indiquer le **zoom** en cases visibles
  en largeur ;
- **critère 4** — les marqueurs d'état, tranche **L-09**, qui attend une **partie jouée** :
  `PLAN-LOT2.md` §7 et le CdC §12 Q7 le disent tous deux, le jeu de marqueurs se décide à table
  et pas en conception. C'est la seule tranche du lot dont la dépendance soit extérieure au code.

Le lot 2 ne se terminera donc pas par un commit mais par une séance. C'est un bon signe : le
substrat est fini, et ce qui reste à apprendre ne s'apprend qu'en jouant.

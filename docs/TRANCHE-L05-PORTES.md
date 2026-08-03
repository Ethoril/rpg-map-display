# TRANCHE L-05 — portes à trois états, interactives

> Cinquième tranche du **Lot 2 du CdC §11**. Découpage : `PLAN-LOT2.md` §4. Dépend de L-01
> (arêtes bloquées) et L-04 (fog, publication de la vision), toutes deux livrées et poussées.
>
> Elle ferme deux critères sur treize — **10** (ouvrir une porte étend la vision des deux côtés
> en moins de 300 ms et rouvre les arêtes de passage) et **11** (une porte est ouvrable au doigt
> du premier coup sur la tablette). Le lot passe de 6/13 à 8/13.
>
> ⚠ « Tranche L-05 » ≠ « chantier L » (outil de cartes). Le préfixe L des tranches désigne le
> lot 2, celui du chantier désigne son rang alphabétique. Collision de nommage héritée, non
> réparable sans casser les renvois déjà écrits.

---

## 1. Ce qui a été compté et mesuré avant d'écrire ce brief

Quatre briefs sur cinq ont été corrigés par une mesure faite **avant** la première ligne de
code. Celui-ci ne fait pas exception, et il en sort deux corrections : le plan se trompe d'un
facteur quatre sur le nombre de portails à migrer, et la zone tactile qu'il prescrit est
**quatre à six fois trop petite** pour un doigt au zoom d'ensemble.

### 1.1 Les portails commités : 182, pas 41

`PLAN-LOT2.md` §2.1 parle de « 41 portails déjà commités ». C'était vrai le 30 juillet. Depuis,
`testbig150` en a apporté 141.

| Document | Portails | Forme |
|---|---|---|
| `maps/generated/manoir-rdc.scene.json` | 40 | `{closed: true}` |
| `maps/generated/testbig150.scene.json` | 141 | `{closed: …}` — **58 vrais, 83 faux** |
| `maps/minimal.json` | 1 | `{closed: true}` |
| **Total** | **182** | **aucun ne porte `state`** |

Deux conséquences. La branche `closed: false → 'open'` de la normalisation n'est pas
théorique : elle concerne 83 portails. Et la migration doit être **muette et automatique**,
parce que 182 entrées ne se corrigent pas à la main sans en oublier une.

### 1.2 La géométrie réelle d'un portail n'est pas une porte d'une case

| Étage | Longueur médiane | p90 | max | > 2 cases | Paires à ≤ 0,5 case |
|---|---|---|---|---|---|
| `manoir-rdc` | 1,00 | 2,00 | 2,00 | 0 | 0 |
| `testbig150` | 1,00 | 2,01 | **9,01** | 20 | **45** |

Trois faits à ne pas découvrir dans le code :

1. **Un portail peut mesurer neuf cases.** Ce n'est pas une porte, c'est une baie ou un
   portail de herse. Aucune sémantique nouvelle n'en découle, mais rien ne doit supposer
   qu'un portail tient dans une case.
2. **Un portail dégénéré existe** : longueur minimale mesurée **0,01 case**, soit environ un
   pixel carte. Le calcul de distance doit traiter `a == b` sans diviser par zéro, et ce
   portail ne doit pas être filtré en silence — il est dans les données publiées.
3. **45 paires de portails sont à moins d'une demi-case l'un de l'autre** sur `testbig150`.
   Le départage « le plus proche gagne » est donc réellement exercé, et il lui faut une règle
   de départage déterministe pour que les tests soient stables (§7.3).

### 1.3 Le coût d'une bascule, mesuré

Relevé au poste de bureau sur les documents publiés, avec les modules du dépôt (Node, `js/`
importé tel quel). **Aucun verdict de performance n'est coché ici** — interdiction n°14 : ces
chiffres servent à choisir une conception, pas à valider un critère.

| Opération | `manoir-rdc` (48 × 45) | `testbig150` (65 × 71) |
|---|---|---|
| `structuredClone(campaign)` + `validateCampaign` — une mutation du store | **0,31 ms** | **3,15 ms** |
| `validateCampaign` seul | 0,02 ms | 0,02 ms |
| `computeBlockedEdges`, cache froid | **10,3 ms** | **15,2 ms** |
| `computeBlockedEdges`, cache chaud (signature seule) | 0,09 ms | 0,77 ms |
| Arêtes bloquées produites | 1 409 | 2 701 |

Ce tableau commande deux décisions et en annule une troisième :

- **La mutation par le store est assez bon marché** pour une bascule de porte : 0,3 à 3 ms,
  clonage complet de la campagne et revalidation comprise. Aucun chemin de mutation étroit à
  inventer (§5.2).
- **`validateCampaign` coûte 0,02 ms sur un document de 344 Kio**, ce qui n'est pas une bonne
  nouvelle : c'est la mesure de ce qu'il ne valide pas. Il ne regarde aucun champ de portail
  (`js/core/schema.js:554` se contente de `Array.isArray(level.portals)`). Valider 182 portails
  reste donc largement finançable (§4.3).
- **L'invalidation partielle du cache d'arêtes est à ne pas écrire** (§9.1).

### 1.4 La zone tactile d'une demi-case est trop petite — arithmétique, pas opinion

`PLAN-LOT2.md` §4 prescrit « une hitbox d'au moins une demi-case autour du segment ». Voici ce
que cette demi-case vaut en pixels CSS sous le doigt.

La Tab S9 FE affiche 1920 × 1200 physiques (CdC §3) et rend à 1440 × 900 avec
`RENDER_RESOLUTION_CAP = 1,5`, ce qui place le viewport CSS aux alentours de **960 × 600**.
Au zoom qui fait tenir l'étage entier en largeur :

| Étage | Cases en largeur | Case à l'écran | Bande d'une demi-case |
|---|---|---|---|
| `manoir-rdc` | 48 | 20 px CSS | **20 px de large** |
| `testbig150` | 65 | 14,8 px CSS | **14,8 px de large** |

La cible tactile recommandée est de l'ordre de **44 px**. La bande prescrite en fait le tiers
ou le quart. Et l'agrandir ne sauve rien : une bande de 44 px à ce zoom mesurerait plus de deux
cases et avalerait les cases voisines entières.

**Ce n'est pas un défaut d'implantation, c'est une limite de zoom.** Pour que la bande atteigne
44 px, il faut une case d'au moins 44 px CSS, donc **au plus 21 cases visibles en largeur** sur
ce viewport. Conséquence à écrire noir sur blanc plutôt qu'à découvrir à table : le critère 11
se vérifie **à un zoom de jeu**, et il est faux au zoom d'ensemble sur les deux cartes du
dépôt. Voir §7.5 pour ce qui en découle et §12 pour la forme du critère.

> La largeur du viewport CSS est déduite du CdC, pas mesurée. Un coup d'œil sur `diag.html`
> depuis la tablette la confirme en une ligne ; à faire avant de conclure sur le critère 11,
> les chiffres ci-dessus étant proportionnels à cette largeur.

### 1.5 La zone tactile mange des centres de case — et pas également partout

Un tap au centre d'une case est le geste de déplacement. Si la bande d'une porte couvre ce
centre, la case cesse d'être atteignable au doigt. Distance minimale d'un centre de case au
portail le plus proche, sur toutes les cases de chaque étage :

| Étage | Centres à < 0,45 case | dans [0,45 ; 0,50) | Minimum observé |
|---|---|---|---|
| `manoir-rdc` (2 160 cases) | 0 | **0** | **exactement 0,500000** |
| `testbig150` (4 615 cases) | 44 | **132** | 0,4233 |

Le contraste a une cause nette : les portails de `manoir-rdc` sont posés sur des frontières de
case entières, donc à exactement une demi-case de chaque centre voisin — la bande les effleure
sans jamais les couvrir. Ceux de `testbig150` sont à des coordonnées non entières
(`60.01005`, `65.0033951`…) et certains sont obliques ou longs de neuf cases, si bien que
**176 centres sur 4 615 (3,8 %) tombent dans la bande**.

C'est la mesure qui tranche §7.4 : sur la carte de campagne la bande est gratuite, sur la carte
d'effort elle coûte 3,8 % des cases, et ce coût est **accepté et chiffré** plutôt que corrigé
par une bande plus fine qui rendrait les portes intapables partout.

---

## 2. Ce qu'il faut écrire

1. **Le modèle** — `Portal.state` devient le champ portant, `closed` devient un héritage lu et
   jamais écrit. Normalisation à l'entrée, validation par le schéma (§4).
2. **La mutation** — `store.setPortalState()`, seule porte d'entrée, qui porte la règle
   d'autorisation par transition et rafraîchit la sélection (§5, §6).
3. **L'événement** — `portal.toggle` dans `js/app/networkEvents.js`, à état absolu (§6).
4. **Le hit-test** — dans `js/ui/player/bootstrap.js` et `js/app/gm.js`, avec la règle de
   priorité et le départage (§7).
5. **Le rendu des trois états** — `js/render/layers/portals.js`, fichier nouveau, donc
   amendement du manifeste (§8).

Pas d'outils de fog MJ (L-06), pas d'éditeur de murs (L-07), pas de gabarits (L-08).

---

## 3. Le partage d'autorité, à ne pas inverser

`PLAN-LOT2.md` §3, répété à chaque brief :

| Calcul | Où | Pourquoi |
|---|---|---|
| Arêtes bloquées | **partout, localement** | déterministe à partir des données d'étage |
| Vision, fog | **Mac seul**, publiés | CdC §4 : le Mac est le nœud autoritaire |

L'état d'une porte tombe du **premier** côté, et c'est ce qui rend la tranche faisable : chaque
client applique `portal.toggle` à son propre store, chacun recalcule ses propres arêtes
bloquées, et personne n'attend le Mac pour savoir qu'une porte est ouverte. Le Mac, lui, reste
seul à recalculer la vision et à publier les masques.

Corollaire à ne pas franchir : **aucun `sweep()` ni accumulation de fog ne doit apparaître sous
`js/ui/player/` ou dans `js/app/player.js`** à l'occasion de cette tranche. La tablette apprend
qu'une porte s'est ouverte, elle en déduit ses arêtes, et elle attend le masque de vision du
Mac pour le reste.

---

## 4. Le modèle : `state` porte, `closed` survit en lecture seule

### 4.1 L'état actuel est le pire des deux mondes, et c'est à réparer d'abord

`js/core/types.js:49-56` déclare aujourd'hui **les deux champs à la fois** — `closed` requis,
`state` optionnel. C'est exactement la forme que `PLAN-LOT2.md` §2.1 refusait : elle rend
représentable `{closed: false, state: 'locked'}`, qui ne veut rien dire, et elle laisse deux
sources de vérité pour une seule question.

L-01 avait besoin d'un pont et l'a bien construit — `isPortalOpen()`
(`js/import/blockedEdges.js:44`) lit `state` s'il existe, `closed` sinon. Le pont est correct.
Ce qui manque, c'est la rive d'arrivée.

**Forme retenue :**

```js
/**
 * @typedef {Object} Portal
 * @property {string} id
 * @property {CellPoint} a
 * @property {CellPoint} b
 * @property {'open'|'closed'|'locked'} state
 * @property {boolean} [closed] HÉRITAGE — lu par la normalisation, jamais écrit.
 * @property {boolean} freestanding
 */
```

`state` devient **requis**, `closed` devient **optionnel**. Un état illégal cesse d'être
représentable, ce qui vaut mieux qu'un contrôle qui l'attrape.

### 4.2 La normalisation se fait à deux portes, et il n'y en a pas de troisième

Un document hérité se **convertit, jamais ne se refuse** : refuser reproduirait la
« disparition après F5 » qu'`ETAT.md` documente comme la cause historique d'une perte de
campagne. C'est le traitement déjà retenu au chantier G pour les couleurs ARGB.

Les deux seules portes d'entrée d'une campagne dans le store sont
`loadCampaign` (`js/state/store.js:305`) et `restoreFromSnapshot`
(`js/state/store.js:218`). Toutes deux appellent déjà `normalizeCampaignColors` **avant** de
valider. C'est là, et nulle part ailleurs, que la conversion doit vivre.

**Décision de placement.** Ajouter la conversion des portails dans une fonction nommée
`normalizeCampaignColors` en ferait un nom menteur. Introduire à côté un second appel aux deux
sites ferait deux choses à retenir au lieu d'une, et la troisième porte d'entrée qu'on ouvrira
un jour n'en appellerait qu'une. On introduit donc dans `js/core/schema.js` :

```js
export function normalizeCampaign(campaign)   // couleurs PUIS portails, une copie rendue
```

Les deux sites du store appellent `normalizeCampaign`. `normalizeCampaignColors` reste exportée
et inchangée, appelée par la nouvelle. Aucun test ne la référence directement (vérifié : quatre
occurrences dans le dépôt, toutes dans `js/`), le coût du changement est donc nul.

**Table de conversion, sans autre cas :**

| Entrée | `state` produit |
|---|---|
| `state` déjà l'une des trois valeurs | inchangé, `closed` ignoré |
| `closed === true`, pas de `state` | `'closed'` |
| `closed === false`, pas de `state` | `'open'` |
| ni l'un ni l'autre, ou `state` inconnu | `'closed'` + avertissement journalisé |

Le défaut est `'closed'` et non `'open'` : c'est celui de l'import UVTT
(`js/import/uvtt.js:215` — `closed: p.closed ?? true`), et une porte supposée fermée à tort se
constate au premier tap, là qu'une porte supposée ouverte à tort ouvre une ligne de vue que le
MJ n'a pas voulue.

`closed` **n'est pas supprimé du document** : le laisser en place coûte un booléen par portail
et permet à un document normalisé de rester relisible par une version antérieure du code
pendant une séance en cours. Il n'est simplement plus jamais lu après normalisation, ni jamais
écrit.

### 4.3 Le schéma doit valider le portail, sinon `state` entre en silence

`validateCampaign` ne regarde aucun champ de portail (`js/core/schema.js:554`). Introduire
`state` sans le valider laisserait passer n'importe quelle chaîne — le défaut « atteignable,
franchi, silencieux » que le chantier G a corrigé sur les couleurs, et que la mesure §1.3
rend visible : 0,02 ms de validation sur 344 Kio, c'est le prix de ce qui n'est pas regardé.

À valider par portail, dans la boucle d'étage existante : `id` chaîne non vide, `a` et `b`
munis de `cellX`/`cellY` finis, `state` parmi les trois valeurs, `freestanding` booléen. Le
message d'erreur nomme l'étage et l'identifiant du portail, comme le fait déjà celui des
lumières juste au-dessus.

**Ordre à ne pas inverser** : la normalisation tourne avant la validation aux deux portes. Un
document hérité est donc converti puis validé, et il passe. Un document dont un portail est
réellement cassé est refusé. La validation ne doit **pas** accepter `closed` en substitut de
`state` : ce serait rouvrir la double vérité que §4.1 vient de fermer.

---

## 5. Où vit l'état d'une porte

### 5.1 Dans la campagne, comme la position d'un pion

**Décision : l'état runtime d'une porte vit dans `level.portals[].state`, à l'intérieur de la
campagne.** Pas dans un espace de session séparé.

Trois raisons, dont la première est décisive :

1. **Le cache d'arêtes bloquées est indexé sur la géométrie de l'étage.** La signature de
   `computeBlockedEdges` inclut `isPortalOpen(p)` pour chaque portail
   (`js/import/blockedEdges.js:83`). Si l'état vivait à côté de la campagne,
   `computeBlockedEdges(level, grid)` ne le verrait pas : sa signature serait inchangée, il
   rendrait des arêtes périmées, et le symptôme — « les portes ne bloquent plus rien, ou
   bloquent encore » — apparaîtrait très loin de sa cause. L'alternative serait de passer les
   surcharges en paramètre, donc de changer la signature de L-01 et ses deux appelants.
2. **La signature de vision du fog inclut déjà les portails**
   (`js/render/layers/fogLayer.js:61-65`, qui lit `p.closed` **et** `p.state`). Muter la
   campagne suffit à faire recalculer la vision. Rien à câbler.
3. **La persistance est acquise.** Le snapshot durable, c'est la campagne
   (`createSnapshotPayload`, `js/app/networkEvents.js:190`), sauvegardée à chaque mutation par
   `scheduleSnapshot` (`js/app/gm.js:512-520`). Une porte ouverte survit donc au F5 comme au
   redémarrage complet, sans une ligne de plus. C'est ce que le CdC §7 appelle le scénario
   nominal de reconnexion.

**Ce que cela coûte, et pourquoi c'est acceptable.** La campagne est aussi le document
*d'auteur* : muter `state` mêle l'état de jeu à la carte préparée. Il faut donc un moyen de
tout refermer pour rejouer la carte, et il existe déjà — recharger la scène depuis
`maps/generated/*.scene.json` par la bibliothèque (U-05, `scene.load`) réécrit la campagne
entière, donc referme les portes. Aucun mécanisme de remise à zéro n'est à écrire.

### 5.2 La mutation passe par une fonction nommée du store

`CONVENTIONS.md` §5 : toute mutation passe par une fonction nommée du store. `updateLevel`
existe et suffirait techniquement, mais l'utiliser pour une porte obligerait chaque appelant à
reconstruire le tableau `portals` complet — et à porter la règle d'autorisation, qui se
retrouverait dupliquée côté MJ, côté joueurs et côté réseau. On écrit donc :

```js
export function setPortalState(levelId, portalId, state)
```

Elle est le **domicile unique** de quatre responsabilités :

1. la validation de `state` et de l'existence du portail — un portail inconnu lève
   (`CONVENTIONS.md` §6 : invariant violé, pas cas limite) ;
2. la campagne candidate clonée, validée, puis substituée — le motif de `updateToken` ;
3. **le rafraîchissement de la sélection** (§5.3) ;
4. la notification des abonnés, qui déclenche tout le reste (§9.2).

La mesure §1.3 autorise le clonage complet : 0,31 ms sur `manoir-rdc`, 3,15 ms sur
`testbig150`, revalidation comprise. Une bascule de porte est ponctuelle, pas haute fréquence.

L'autorisation par transition, en revanche, ne vit **pas** ici : voir §6.3.

### 5.3 Le piège que la lecture du code a trouvé : les cases atteignables sont périmées

`reachableCells` n'est calculé qu'**au moment de la sélection**
(`setSelectionState`, `js/state/selection.js:47`). Le store le rafraîchit après un déplacement
(`js/state/store.js:441-443`) mais **`updateLevel` ne le rafraîchit pas**.

Sans traitement, la seconde moitié du critère 10 — « rouvre les arêtes de passage » — est
fausse dans le cas le plus courant du jeu : un joueur a son PJ sélectionné, une porte s'ouvre,
la zone de déplacement affichée continue de s'arrêter à la porte jusqu'à ce qu'il désélectionne
et resélectionne. Personne ne comprendrait pourquoi, et le fog, lui, se mettrait correctement à
jour — ce qui rendrait le défaut d'autant plus déroutant.

`setPortalState` doit donc, après mutation, refaire `setSelectionState(selectedToken,
activeLevel)` si un pion est sélectionné et appartient à l'étage muté. C'est exactement ce que
fait `moveTokenToCell`, et c'est le motif à copier plutôt qu'à réinventer.

---

## 6. `portal.toggle`

### 6.1 Le nom reste, le payload porte l'état absolu

Le nom vient du CdC §7 et `CONVENTIONS.md` §4 interdit d'en inventer un autre. Avec trois
états, « basculer » n'a plus de sens — basculer depuis `locked` mènerait où ? Le payload porte
donc l'**état cible**, ce qu'exige aussi l'idempotence :

```js
{ type: 'portal.toggle', payload: { levelId, portalId, state }, at, by }
```

`levelId` est dans le payload et n'est pas déduit de l'étage actif : le MJ et la tablette
peuvent regarder deux étages différents, et un événement qui dépend de l'étage affiché du
destinataire n'est pas rejouable. C'est la leçon déjà payée par `fog.update`, qui porte son
`levelId` pour la même raison.

Rejouer deux fois converge. C'est la leçon apprise trois fois : `handout.hide` au chantier H,
`token.elevation` au chantier K, `token.update` au chantier I.

### 6.2 L'application réseau refuse bruyamment et ne corrige rien

Dans `js/app/networkEvents.js`, sur le modèle exact de `token.elevation` : `levelId`,
`portalId` chaînes non vides, `state` parmi les trois valeurs, étage et portail existants.
Chaque refus se journalise avec sa raison (`CONVENTIONS.md` §6). Un événement portant l'état
déjà en place rend `false` sans journaliser — c'est le cas nominal d'une reconnexion, pas une
anomalie, et c'est le traitement déjà retenu pour `token.delete`.

### 6.3 L'autorisation porte sur la transition, et elle ne vit pas dans le store

| Transition | MJ | Joueurs |
|---|---|---|
| `closed` ↔ `open` | oui | **oui** |
| `locked` → `closed` | oui | non |
| `closed`/`open` → `locked` | oui | non |

**Où cette règle vit, et pourquoi pas dans le store.** `setPortalState` est appelée par
`applyNetworkEvent` pour *appliquer* la décision d'un autre poste. Si elle refusait les
transitions réservées au MJ, un client joueur rejetterait l'ordre de verrouillage émis par le
MJ, et son état divergerait de celui de la table — silencieusement. La règle est donc appliquée
**à l'émission**, là où l'intention naît : dans le hit-test de `bootstrap.js` pour les joueurs,
dans celui de `gm.js` pour le MJ. Le store et la couche réseau appliquent.

**À dire franchement : c'est une règle de jeu, pas une frontière de sécurité.** Elle est
appliquée côté client, et un `by: 'players'` n'est pas une preuve d'identité. La vraie
frontière est la liste blanche d'adresses des règles Firebase (`ETAT.md`). Confondre les deux
conduirait à croire le modèle plus solide qu'il n'est. Conséquence assumée : une tablette
modifiée peut déverrouiller une porte. Le remède, si le besoin devient réel, est côté règles,
pas côté client.

---

## 7. Le hit-test au doigt — le point le plus fragile de la tranche

### 7.1 Aucune interface, seulement le canvas

`CONVENTIONS.md` §8 interdiction n°2 : aucun élément d'interface sur la vue joueurs, et les
quatre dérogations existantes sont closes. Une porte s'ouvre donc **par un tap sur le canvas**,
sans bouton, sans menu, sans info-bulle. L'interdiction n°1 exclut par ailleurs tout geste de
glisser : le tap est le seul canal.

### 7.2 La bande tactile, et le seul moyen légal de la calculer

Un portail est un segment. La cible est la **capsule** de rayon une demi-case autour de ce
segment : `distance(tap, segment) < 0,5 case`, distance point-segment, bornes incluses côté
extrémités. La capsule vaut aussi pour un portail de neuf cases (§1.2) et pour un portail
dégénéré où `a == b`, qui devient un disque — le calcul doit traiter ce cas sans division par
zéro plutôt que de le filtrer.

**Interdiction n°5 : aucune arithmétique `pxPerCell` hors de `js/grid/`**, vérifiée par
`tests/architecture.test.mjs:42-63`, qui échoue sur la simple présence de la chaîne. La
demi-case en pixels carte s'obtient donc par l'idiome déjà employé deux fois dans `gm.js`
(lignes 250-252 et 330-332) :

```js
const origin0 = grid.mapFromCellPoint({ cellX: 0, cellY: 0 });
const origin1 = grid.mapFromCellPoint({ cellX: 1, cellY: 0 });
const gridScale = Math.abs(origin1.x - origin0.x);   // pixels carte par case
```

Ne pas ajouter de méthode à `GridAdapter` pour cela : l'interface est un fichier `[1a]`, et
toute méthode ajoutée devra être honorée par `HexGrid` au lot 4 pour un besoin que l'idiome
ci-dessus couvre déjà.

Les portails sont en `CellPoint` (unités de case fractionnaires) et le tap arrive en `MapPoint`
(pixels carte, `intention.mapPos`). La conversion se fait dans un sens et un seul :
`grid.mapFromCellPoint()` sur les deux extrémités du portail. Ne jamais convertir le tap en
`CellPoint` pour comparer — `CONVENTIONS.md` §1 sépare les deux formes exprès.

### 7.3 La priorité, et le départage

Ordre de décision, à respecter tel quel :

1. **Un pion sous le tap gagne.** Un PJ debout dans l'embrasure doit rester sélectionnable ;
   si la porte gagnait, ce pion deviendrait inatteignable au doigt.
2. **Sinon, une porte dans la bande gagne** — la plus proche en distance au segment. En cas
   d'égalité exacte, celle dont l'`id` est le plus petit en ordre lexicographique. Le départage
   n'est pas cosmétique : `testbig150` compte 45 paires de portails à moins d'une demi-case
   (§1.2), et sans règle déterministe les tests seraient instables.
3. **Sinon, le comportement actuel, inchangé** : sélection, déplacement, désélection.

**Le point d'insertion dans le code des joueurs est contraint.** La cascade de
`handleIntention` (`js/ui/player/bootstrap.js:38-141`) sort tôt : ligne 78, un tap sans pion
sélectionné se termine par `selectToken(null)` et `return`. Le test de porte doit être placé
**après** le hit-test de pion et **avant** cette sortie, sans quoi une porte ne serait tapable
qu'avec un pion déjà sélectionné — soit jamais, dans le geste naturel « j'arrive devant la
porte, je l'ouvre ».

### 7.4 Ce que la bande coûte au déplacement, chiffré et accepté

Une porte est posée sur une frontière de case, donc sa bande couvre la moitié extérieure des
deux cases voisines. Un tap dans cette moitié adresse la porte, pas la case. La question est de
savoir si le **centre** de la case reste libre, puisque c'est là qu'on tape pour se déplacer.

La mesure §1.5 répond, et différemment selon la carte :

- **`manoir-rdc` : aucun centre touché**, distance minimale exactement 0,500000 sur 2 160
  cases. Les portails y sont posés sur des frontières entières. La bande est gratuite.
- **`testbig150` : 176 centres sur 4 615 (3,8 %)** tombent dans la bande, le plus profond à
  0,4233 case. Sur ces cases, il faut taper hors du centre pour s'y déplacer. La case reste
  atteignable — la capsule ne couvre jamais toute la surface d'une case — mais la zone utile
  est réduite.

**Décision : la bande reste une demi-case, et ces 3,8 % sont acceptés.** L'alternative serait
de rétrécir la bande jusqu'à ce qu'elle épargne tous les centres, soit un quart de case, soit
5 à 10 px CSS sous le doigt d'après §1.4 : des portes intapables partout pour sauver 176 cases
d'une carte d'effort. Le calcul est vite fait.

Ce que cela dit surtout, c'est que **la qualité de la préparation des cartes compte** : des
portails posés sur des frontières entières ne coûtent rien, des portails à 0,01 case près
coûtent 3,8 % des cases. `testbig150` étant une carte de mesure et non de campagne, le coût
réel aujourd'hui est nul.

### 7.5 Le critère 11 dépend du zoom, et ce n'est pas contournable

D'après §1.4, la bande vaut 15 à 20 px CSS au zoom d'ensemble, contre 44 px recommandés pour
un doigt. **Le critère 11 se vérifie donc à un zoom de jeu — au plus une vingtaine de cases
visibles en largeur — et il est faux au zoom d'ensemble.**

Aucune correction géométrique n'existe : une bande assez large pour être tapable à ce zoom
mesurerait plus de deux cases et rendrait le déplacement impossible près des portes. Les
joueurs jouent zoomés, le MJ a une souris et n'est jamais gêné, donc le coût pratique est
probablement nul — mais c'est une hypothèse, et le §12 la transforme en vérification physique.

**Si l'essai à table échoue, le remède est un zoom minimum sur la vue joueurs, et c'est une
décision à demander, pas à improviser.** Ne pas la prendre au fil du code.

### 7.6 Côté MJ : le tap bascule, l'appui long verrouille

Le MJ a besoin des trois états ; un tap ne sait exprimer qu'une bascule. Le canal existe déjà
et personne ne l'utilise : `pointer.js` émet une intention `longPress` à 500 ms
(`js/input/pointer.js:235-246`, `LongPressIntention` déclarée en
`js/input/gestures.js:40-44`), pour les deux rôles, et aucun code ne s'y abonne aujourd'hui.

- **Tap MJ sur une porte** → `open` ↔ `closed`. Depuis `locked`, un tap ne fait rien et le
  signale — la porte est verrouillée, c'est l'information utile.
- **Appui long MJ sur une porte** → `locked` ↔ `closed`.
- **Appui long joueurs** → rien. Le verrouillage est réservé au MJ (§6.3), et `pointer.js`
  garantit déjà qu'un appui long ne dégénère pas en tap (`longPressTriggered`, ligne 387).

Le glisser MJ de pion reste intact : il démarre par `canStartTokenDrag`, qui ne consulte que
les pions, et la priorité §7.3 place le pion avant la porte.

---

## 8. Le rendu des trois états — un fichier hors manifeste, donc un amendement

### 8.1 Pourquoi il faut dessiner quelque chose

L'image de fond montre déjà les portes : elles font partie du dessin de la carte, et les
portails importés sont posés dessus. Une porte **fermée** n'a donc besoin d'aucun rendu.

Mais l'image est figée dans l'état où l'auteur l'a dessinée. Une porte ouverte reste dessinée
fermée, une porte verrouillée ne se distingue de rien. Sans rendu, ni le MJ ni les joueurs ne
peuvent lire l'état du plateau, et le critère 11 devient invérifiable — on ne sait pas si le
tap a fait quelque chose.

**Décision : dessiner un indicateur d'état, pas une porte.** Trois styles sur le segment du
portail — `closed` invisible (l'image suffit), `open` un trait discret marquant le vantail
effacé, `locked` une marque distincte. Dessiner une porte battante par-dessus le dessin de la
carte donnerait deux portes superposées.

### 8.2 Placement dans la pile, et ce qu'il apporte gratuitement

`CANVAS_LAYER_ORDER` (`js/render/stage.js:4-11`) vaut aujourd'hui : `background`, `grid`,
`moveZone`, `templates`, `tokens`, `fog`. La couche des portails s'insère **après `grid` et
avant `moveZone`**.

Le placement n'est pas esthétique, il est fonctionnel : `fog` étant dessiné en dernier avec une
opacité pleine sur le non-exploré côté joueurs
(`FOG_VEIL_PLAYER_UNEXPLORED = 1`, `js/core/constants.js:112`), **toute couche antérieure est
masquée dans les zones non explorées**. L'état d'une porte dans une pièce jamais visitée est
donc invisible aux joueurs sans une ligne de code pour cela. Dessiner les portails après le fog
divulguerait la carte.

### 8.3 L'amendement du manifeste

`CONVENTIONS.md` §8 interdiction n°12 : ne jamais créer un fichier absent du manifeste. Un
besoin non couvert se signale et ne s'improvise pas — c'est l'objet de cette section, sur le
modèle du chantier L.

`PLAN-LOT2.md` §1 listait six fichiers pour le lot 2 : `vision/sweep.js`, `vision/fog.js`,
`render/layers/fogLayer.js`, `render/layers/templates.js`, `ui/gm/fogTools.js`,
`ui/gm/wallEditor.js`. **Aucun ne concerne les portes.** L'oubli est réel : le plan pouvait
supposer que les portes n'avaient pas de rendu propre, ce que §8.1 démentit.

| Fichier | Rôle |
|---|---|
| `js/render/layers/portals.js` `[2]` | indicateur d'état des trois états, entre `grid` et `moveZone` |

Un fichier, dans le chemin de l'application, à ajouter à `ARCHITECTURE.md` §1 et à
`CANVAS_LAYER_ORDER`. Aucun autre fichier nouveau dans cette tranche.

---

## 9. Ce qui est déjà acquis : ne pas l'écrire deux fois

### 9.1 L'invalidation partielle du cache d'arêtes est à ne pas écrire

Le CdC §5.3bis (ligne 380) demande une « invalidation limitée aux arêtes voisines d'une porte
lors d'un `portal.toggle` ». **Ne pas l'implémenter**, pour deux raisons.

D'abord elle est déjà faite, autrement et mieux : la signature de cache de L-01 inclut l'état
de chaque portail (`js/import/blockedEdges.js:83`). Muter `state` change la signature, le
prochain appel recalcule. Aucun appel à `invalidateBlockedEdgesCache` n'est même nécessaire
depuis `setPortalState`.

Ensuite le gain n'existe pas : le recalcul complet coûte 10,3 ms sur `manoir-rdc` et 15,2 ms
sur `testbig150` (§1.3), sur un budget de 300 ms. Une invalidation partielle échangerait ces
15 ms contre une classe de bugs entière — un voisinage subtilement faux produit une arête qui
bloque encore ou ne bloque plus, dans une seule direction, sur une seule porte.

La ligne du CdC est une **piste d'optimisation** écrite avant toute mesure, pas une exigence.
Le critère 10 demande que les arêtes se rouvrent, pas qu'elles se rouvrent partiellement.

### 9.2 La chaîne du critère 10 est déjà câblée de bout en bout

Elle a été construite par L-04, qui l'annonçait explicitement — le commentaire de
`publishVisibleVision` (`js/app/gm.js:195-196`) cite le critère 10 nommément et explique
pourquoi la vision courante n'est **pas** throttlée, contrairement au fog exploré.

Une mutation de `state` par le store déclenche donc, sans une ligne de plus :

```
setPortalState → notifySubscribers
   → store.subscribe de gm.js (js/app/gm.js:525-529)
      → syncVision()
         → fogLayer.updateVision  — la signature de vision inclut les portails
                                    (js/render/layers/fogLayer.js:61-65)
         → sweep sur la géométrie fraîche (extractBlockedSegments ignore les portails ouverts,
                                    js/import/blockedEdges.js:224)
         → publishVisibleVision → vision.update, immédiat, non throttlé
         → scheduleFogPublish   → fog.update, throttlé
      → requestRender()
      → scheduleSnapshot()      → la porte ouverte est persistée (§5.1)
```

**Ce qu'il reste donc à écrire pour le critère 10 est très peu de chose** : la mutation, sa
propagation réseau, et le rafraîchissement de la sélection du §5.3. Le reste est acquis. Si la
tranche se met à toucher `syncVision` ou `fogLayer`, c'est le signe qu'elle s'égare.

---

## 10. Amendements requis

Tous se font délibérément, avec justification écrite, pas au fil de l'eau.

**Cahier des charges** — source de vérité du « quoi » :

- **§6 ligne 543** : `portals: [{ id, a, b, closed: true, freestanding: false }]` devient
  `state: 'open'|'closed'|'locked'`.
- **§6 ligne 614** : la ligne RTDB `/session/{sid}/portals/{portalId} → { closed }` **est
  retirée**. L'état d'une porte ne transite pas par un espace de session : il vit dans la
  campagne et voyage par événement, exactement comme la position d'un pion — pour laquelle la
  ligne `/session/{sid}/tokens/{tokenId}` du même tableau est déjà obsolète pour la même raison
  (§5.1). Retirer la ligne plutôt que la corriger : elle décrit un mécanisme que le projet n'a
  pas retenu.
- **§7, tableau des événements** : préciser que `portal.toggle` porte l'état absolu
  `{levelId, portalId, state}`, et reporter la règle d'autorisation par transition du §6.3.
- **§11 lot 2** : cocher les critères 10 et 11 une fois vérifiés, en notant pour le 11 le zoom
  auquel il a été vérifié (§7.5).
- **§12** : Q3 (« portes ouvrables par les joueurs ou MJ uniquement ? ») est tranchée — les
  deux, avec la règle par transition du §6.3. La marquer comme telle.

**Architecture** :

- `ARCHITECTURE.md` §1 : ajouter `js/render/layers/portals.js` `[2]` (§8.3).

**Conventions** :

- `CONVENTIONS.md` §8 n°2 : la liste de ce qui s'affiche sur la vue joueurs (« la carte, la
  grille, les pions, le fog, le sélecteur d'étage et les gabarits ») gagne l'indicateur d'état
  des portes. Ce n'est pas une dérogation à l'interdiction — ce n'est pas un élément
  d'interface, c'est une couche de rendu de la carte — mais la liste doit rester exacte.

---

## 11. Ce qui n'est PAS dans cette tranche

- Les outils de fog du MJ, pinceaux et undo — **L-06**.
- L'éditeur de murs — **L-07**. En particulier : aucun moyen d'**ajouter** une porte à la main.
  L-05 rend interactives les 182 portes importées, elle n'en crée aucune.
- Les gabarits — **L-08**. Les marqueurs — **L-09**.
- Le privilège MJ de traverser les murs reste intact (`PLAN-LOT2.md` §4, note L-01) : le
  glisser MJ ne consulte ni les arêtes bloquées ni les portes, et **ce n'est pas une
  régression**.
- Aucun son, aucune animation d'ouverture. Le rendu à la demande s'arrête au repos (CdC §9) et
  une porte qui s'anime rallume la boucle pour rien.
- `freestanding` n'acquiert aucune sémantique. Le champ est transporté, il n'est pas lu.

---

## 12. Critères d'acceptation

Vérifiables, dans l'ordre où ils cassent.

1. **Migration muette.** Charger `manoir-rdc`, `testbig150` et `minimal` produit 182 portails
   dont `state` vaut `'closed'` pour les 99 `closed: true` et `'open'` pour les 83
   `closed: false`. Aucun refus, aucun avertissement.
2. **État illégal impossible.** Un document portant `state: 'ajar'` est refusé par
   `validateCampaign` avec un message nommant l'étage et le portail. Un document portant
   `{closed: false, state: 'locked'}` est normalisé sur `state`, `closed` ignoré.
3. **Une porte fermée bloque, une porte verrouillée bloque identiquement.** Pour
   `computeBlockedEdges` comme pour le sweep, `closed` et `locked` sont indiscernables ; seules
   l'interface et l'autorisation les distinguent.
4. **Critère 10, première moitié.** Ouvrir une porte étend la vision des deux côtés sur les
   trois écrans. Vérifié par un test navigateur qui compte les `vision.update` publiés après un
   `portal.toggle`, pas par un chronomètre à la main.
5. **Critère 10, seconde moitié.** Avec un PJ sélectionné devant une porte fermée, ouvrir la
   porte étend **immédiatement** la zone de déplacement affichée au-delà, sans
   resélection (§5.3).
6. **Critère 11.** Sur la tablette, à un zoom de jeu, une porte s'ouvre au premier tap. Le
   compte rendu **doit** indiquer le zoom — cases visibles en largeur — auquel l'essai a été
   fait, et signaler si le premier coup a échoué au zoom d'ensemble (§7.5). C'est une
   vérification physique, pas un test automatisé.
7. **Priorité respectée.** Un PJ debout dans une embrasure se sélectionne au tap ; il ne
   déclenche pas la porte.
8. **Autorisation.** Un joueur ne peut pas verrouiller ni déverrouiller. Le MJ peut les deux.
   Un `portal.toggle` `by: 'players'` portant `state: 'locked'` reçu par un client est
   **appliqué** — la règle est à l'émission, pas à l'application (§6.3).
9. **Persistance.** Une porte ouverte le reste après F5 de la tablette et après redémarrage
   complet de la session. Recharger la scène depuis la bibliothèque la referme.
10. **Rien ne fuit par le fog.** L'état d'une porte dans une zone non explorée est invisible
    côté joueurs (§8.2).
11. **Aucun calcul de vision côté tablette.** Un grep de `sweep`, `ExploredFog` et
    `computeBlockedEdges` sous `js/ui/player/` et dans `js/app/player.js` ne ramène que
    `computeBlockedEdges`, qui y est légitime (§3).
12. `pnpm run verify` vert, `pnpm run check-deps` vert. En particulier
    `tests/architecture.test.mjs` : aucun `pxPerCell` hors de `js/grid/` (§7.2), et
    `js/render/layers/portals.js` présent au manifeste (§8.3).

---

## 13. Tests attendus

Unitaires (`node:test`) :

- **normalisation** — les trois formes d'entrée du §4.2, le défaut `'closed'`, `closed`
  préservé mais non relu, `campaignData` d'origine non muté ;
- **validation** — `state` inconnu refusé, portail sans `id` refusé, message nommant l'étage ;
- **`setPortalState`** — portail inconnu lève, étage inconnu lève, transition appliquée,
  sélection rafraîchie, abonnés notifiés une seule fois ;
- **arêtes** — ouvrir un portail rouvre exactement les arêtes qu'il bloquait, sans en rouvrir
  d'autres ; `locked` bloque comme `closed` ; le cache se recalcule sur changement de signature
  sans appel explicite à `invalidateBlockedEdgesCache` ;
- **hit-test** — capsule autour d'un segment de neuf cases, portail dégénéré `a == b` sans
  division par zéro, départage par `id` sur deux portails équidistants, un pion sous le tap qui
  gagne, un tap au centre d'une case de `manoir-rdc` qui ne touche aucune porte ;
- **événement** — `portal.toggle` idempotent, payload malformé refusé et journalisé, portail
  inconnu refusé.

Navigateur (`*.spec.mjs`) :

- ouvrir une porte côté joueurs publie `portal.toggle` puis reçoit `vision.update` ;
- la zone de déplacement s'étend sans resélection (critère 5 du §12) ;
- l'état d'une porte en zone non explorée n'est pas visible côté joueurs ;
- l'appui long MJ verrouille, l'appui long joueurs ne fait rien ;
- après rechargement, la porte ouverte l'est encore.

---

## 14. Dette repérée en passant — hors périmètre, à ne pas corriger ici

Relevée en lisant le code pour ce brief. **Ne pas la traiter dans L-05** : elle ne gêne pas la
tranche, et l'y mêler brouillerait la revue.

`js/core/constants.js` porte **deux constantes pour une seule décision** :
`FOG_PX_PER_CELL = 8` (ligne 7) et `FOG_MASK_PX_PER_CELL = 8` (ligne 86). Seule la seconde est
importée — par `js/vision/fog.js` et `tests/fog.test.mjs`. La première n'est plus lue par aucun
module, mais c'est elle que nomment `ARCHITECTURE.md:56`, `CONVENTIONS.md:143` et `:155`, et
`TASKS-lot1a.md:112`, dont le §3 de `CONVENTIONS.md` s'intitule « Masque de fog — structure
figée ».

La documentation normative décrit donc une constante que le code n'utilise plus, et la valeur
réellement utilisée n'est décrite nulle part. Deux domiciles pour un réglage divergeront au
premier ajustement. À reprendre dans une passe dédiée : soit retirer `FOG_PX_PER_CELL` et
corriger les quatre renvois, soit renommer en sens inverse — mais une seule doit survivre.

# TRANCHE L-06 — outils de fog du MJ : tout révéler, tout masquer, pinceaux, undo

> Sixième tranche du **Lot 2 du CdC §11**. Découpage : `PLAN-LOT2.md` §4. Dépend de L-04
> (masque exploré, publication, trois états de rendu), livrée et poussée. Ne dépend **pas** de
> L-05.
>
> **Elle ne ferme aucun des treize critères du lot 2** — le lot reste à 6/13 validés. Elle
> ferme en revanche un critère du **lot 4** : « Undo restaure l'état fog précédent »
> (CdC §11, lot 4, sixième critère), qui passe de 0/6 à 1/6. Le décalage vient du découpage :
> `PLAN-LOT2.md` place l'undo ici parce qu'il n'a de sens qu'avec le fog, alors que le CdC le
> rangeait avec le confort de table. C'est le découpage qui a raison, et la comptabilité qui
> doit suivre.
>
> Spécification de référence : CdC §5.4 « Outils fog MJ : tout révéler, tout masquer, pinceau
> révéler, pinceau masquer, **par étage**, avec undo » et §5.5 « Undo MJ ».

---

## 1. Ce qui a été mesuré avant d'écrire ce brief

Cinq briefs sur cinq ont été corrigés par une mesure faite **avant** la première ligne de code.
Celle-ci trouve un rapport de **400 à 600×** entre deux façons de stocker un historique, et
établit que les deux boutons les plus redoutés — « tout révéler », « tout masquer » — sont en
réalité les charges les moins chères du système.

Relevé avec l'encodeur réel du dépôt (`encodeFogPng`, `decodeFogPng`) sur les dimensions de
masque réelles des deux cartes publiées. **Aucun verdict de performance n'est coché ici**
(interdiction n°14) : mesuré au poste de bureau, sous `zlib` de Node et non sous
`CompressionStream` du navigateur. Ces chiffres servent à choisir une conception.

| Grandeur | `manoir-rdc` (masque 384 × 360) | `testbig150` (masque 520 × 568) |
|---|---|---|
| **Instantané RGBA en mémoire** | **0,53 Mio** | **1,13 Mio** |
| Instantané **PNG encodé**, bord découpé (cas réaliste) | **1,3 Kio** | **1,9 Kio** |
| « Tout révélé » encodé | 1,0 Kio — **2,1 %** du plafond | 1,5 Kio — **3,0 %** |
| « Tout masqué » encodé | 1,1 Kio — 2,2 % | 1,6 Kio — 3,2 % |
| Pire motif imaginable (bruit 50 % au pixel) | 11,5 Kio — 23,0 % | 17,6 Kio — **35,2 %** |
| Encodage | 1,3 à 4,8 ms | 2,3 à 8,4 ms |
| **Décodage — le coût d'un retour arrière** | **4,0 ms** | **9,7 ms** |

Quatre décisions en découlent, développées aux §5, §6 et §7.

**Le PNG encodé bat l'instantané RGBA de 400 à 600×** dans le cas réaliste. Une pile de vingt
pas d'undo pèse **26 à 38 Kio** en PNG, contre **10,6 à 22,6 Mio** en canvas. Sur une tablette
partagée qui encode déjà un flux cast, ce n'est pas un détail d'implantation (§5).

**« Tout révéler » et « tout masquer » sont les charges les plus légères du système**, à 2 ou
3 % de `FOG_MAX_ENCODED_BYTES`. Un masque uniforme se comprime admirablement. Toute inquiétude
sur ces deux boutons est infondée, et il valait mieux le mesurer que le supposer : c'est
exactement le genre de fonction qu'on hésite à écrire par crainte de la charge.

**Même le pire motif concevable reste sous 36 % du plafond.** Le bruit au pixel près — un
damier aléatoire, que nul MJ ne peindra jamais — est la borne supérieure absolue de ce qu'un
pinceau peut produire en découpe de bord. La marge est donc confortable, et les pinceaux n'ont
pas besoin d'un plafond propre.

**Un retour arrière coûte 4 à 10 ms**, décodage compris. C'est un geste ponctuel : le budget
est sans objet. Le temps n'est donc pas l'argument, la mémoire l'est.

---

## 2. Ce qu'il faut écrire

1. **`js/ui/gm/fogTools.js`** — fichier nouveau, **déjà au manifeste**
   (`ARCHITECTURE.md` §1 : « `[2]` pinceaux révéler/masquer, reset »). Aucun amendement du
   manifeste n'est nécessaire, contrairement à L-05.
2. **`js/vision/fog.js`** — trois méthodes manquantes sur `ExploredFog` (§8).
3. **`js/input/pointer.js` et `js/input/gestures.js`** — l'intention de coup de pinceau, sur
   le modèle exact de `dragToken` (§6).
4. **`js/app/gm.js`** — le montage de l'outil, et le branchement du geste.
5. **`js/ui/gm/panel.js`** — un septième onglet (§9).

Pas d'éditeur de murs (L-07), pas de gabarits (L-08), pas de marqueurs (L-09).

---

## 3. Le partage d'autorité, à ne pas inverser

`PLAN-LOT2.md` §3, répété à chaque brief :

| Calcul | Où | Pourquoi |
|---|---|---|
| Arêtes bloquées | partout, localement | déterministe à partir des données d'étage |
| Vision, fog | **Mac seul**, publiés | CdC §4 : le Mac est le nœud autoritaire |

Cette tranche est la plus MJ-centrée du lot : **rien de ce qu'elle ajoute ne doit exister côté
joueurs.** Ni bouton, ni pinceau, ni undo — interdiction n°2, la vue joueurs n'accepte aucun
élément d'interface, et ses quatre dérogations sont closes. Les tablettes reçoivent le masque
résultant et ne savent pas d'où il vient : d'un déplacement de PJ, d'un coup de pinceau ou
d'un « tout révéler », c'est le même `fog.update`.

C'est aussi ce qui rend le §7 possible.

---

## 4. La décision centrale : l'undo ne défait pas ce que les joueurs ont vu

C'est le piège de la tranche, et il ne se voit qu'en y pensant à l'avance.

Le masque exploré grandit de deux sources : **la vision des PJ**, automatiquement, à chaque
déplacement (L-04, critère 7 — chaque case du chemin) ; et **les outils du MJ**, délibérément.
Un undo naïf, indexé sur « l'état du masque avant la dernière modification », annulerait
indifféremment les deux.

**Conséquence si on se trompe :** le MJ peint une zone par erreur, déplace deux PJ, appuie sur
undo — et **dé-révèle un couloir que les joueurs viennent de traverser**. Le fog contredirait
alors ce qui s'est passé à table, et personne ne comprendrait pourquoi une pièce visitée
redevient noire.

**Décision : la pile d'undo n'enregistre que les actions d'outil.** Un déplacement de pion ne
crée pas de pas d'undo, et n'efface pas la pile. Ce que le CdC §5.5 réclame, mot pour mot,
c'est de rattraper « une révélation de fog ou une suppression de pion **accidentelles** » — un
geste du MJ, pas le déroulement du jeu.

**Corollaire à écrire, parce qu'il surprend :** annuler un « tout révéler » ne rend pas le
masque à son état d'avant *la partie*, mais à son état d'avant *le clic* — lequel contient tout
ce que les PJ avaient déjà exploré. C'est le comportement voulu, et c'est ce que la pile en
PNG donne naturellement puisqu'elle capture le masque entier (§5).

**Cas limite à trancher explicitement.** Si un déplacement de PJ révèle du terrain *après* un
coup de pinceau, annuler ce pinceau écrase la révélation intervenue entre-temps — la pile
porte des états absolus, pas des différences. Deux options, et je tranche pour la seconde :

- rejouer la vision après restauration, pour récupérer ce qui a été perdu : correct mais
  coûteux et surprenant, l'undo cessant d'être une opération simple ;
- **accepter la perte, et la borner en vidant la pile dès qu'un déplacement de pion révèle du
  terrain.** L'undo redevient alors ce qu'il est censé être : le rattrapage immédiat d'un geste
  qu'on vient de faire, pas un voyage dans le temps. Le bouton se grise, ce qui **dit** au MJ
  que la fenêtre est fermée au lieu de le laisser découvrir une régression du fog.

La seconde est plus simple à écrire, plus simple à expliquer, et sans surprise à table.

---

## 5. L'undo se stocke en PNG encodé — et l'instantané existe déjà

### 5.1 Pourquoi pas des instantanés de canvas

La mesure du §1 : 0,53 à 1,13 Mio par pas en RGBA, contre 1,3 à 1,9 Kio en PNG encodé. Une
pile de vingt pas coûte 10,6 à 22,6 Mio d'un côté, 26 à 38 Kio de l'autre. Le prix du PNG est
un décodage de 4 à 10 ms au moment du retour arrière, sur un geste ponctuel : sans objet.

Et le format existe. `encodeFogPng` et `decodeFogPng` sont écrits, testés, et portent déjà la
subtilité qui a coûté un critère à L-04 — le masque vit dans le **canal alpha**, et un
décodage naïf le restituait opaque partout. **Ne pas écrire un second format d'instantané** :
ce serait un deuxième domicile pour la même décision, et le premier réglage les ferait
diverger.

### 5.2 L'instantané est déjà produit, il suffit de le retenir

`scheduleFogPublish` (`js/app/gm.js`) appelle déjà `exploredFog.exportPng()` puis
`store.setSessionFog(levelId, png)` à chaque publication. **Le PNG de la pile d'undo est le
même octet pour octet.** Capturer au bon moment ne coûte donc aucun encodage supplémentaire.

⚠ **Mais ne pas brancher la pile sur `setSessionFog`.** Ce serait le raccourci évident et il
serait faux : `setSessionFog` est appelée à chaque publication, donc à chaque déplacement de
PJ — la pile se remplirait de pas involontaires, exactement ce que le §4 interdit. La capture
appartient à `fogTools.js`, **avant** d'appliquer une action d'outil, et à lui seul.

### 5.3 Profondeur de la pile

**Dix pas, et une raison.** À 1,9 Kio le pas sur la plus grande carte, dix pas coûtent 19 Kio —
négligeable, on pourrait en garder cent. La borne n'est donc pas là pour la mémoire mais pour
l'usage : un undo de table sert à rattraper le geste qu'on vient de faire. Passé une poignée de
pas, le MJ ne sait plus ce qu'il annule, et la pile se vide de toute façon au premier
déplacement de PJ (§4).

Un pas par **action**, et non par pixel : un coup de pinceau, c'est le glisser entier du
`pointerdown` au `pointerup`, pas chaque position intermédiaire.

---

## 6. Le geste du pinceau : un doigt peint, deux doigts naviguent

### 6.1 Le conflit, précisément

Peindre demande un glisser, et le glisser à un doigt est déjà pris sur la vue MJ. La mécanique
de `js/input/pointer.js` est sans ambiguïté :

- au `pointerdown`, `canStartTokenDrag(screenPos, mapPos)` — **injecté par la vue** — rend un
  identifiant de pion ou `null` (ligne 228) ;
- au `pointermove`, si `role === 'gm'` et qu'un pion est sous le doigt, l'intention devient
  `dragToken` (lignes 287-311) ;
- sinon, dès le seuil spatial franchi, **tout glisser à un doigt devient un `panBy`**
  (lignes 315-322).

Un pinceau doit donc primer sur le pan, sans jamais primer sur rien d'autre par accident.

### 6.2 La solution est déjà dessinée par `canStartTokenDrag`

**Ajouter une seconde fonction injectée, symétrique** : `canStartBrush(screenPos, mapPos)`
rendant un booléen, et une intention `brushStroke` portant `phase: 'start'|'move'|'end'`,
calquée sur `dragToken`.

C'est le choix le moins inventif possible, et c'est son mérite : `js/input/*` n'a le droit
d'importer que `core/*` et ne doit jamais connaître le store. Une fonction injectée respecte
exactement cette frontière — c'est la raison d'être de `canStartTokenDrag`, et le pinceau pose
le même problème.

**L'exclusion mutuelle vit dans la vue, pas dans `pointer.js`.** Quand un pinceau est actif,
le `canStartTokenDrag` de `gm.js` rend `null` ; quand il ne l'est pas, `canStartBrush` rend
`false`. Aucune logique de priorité n'est alors nécessaire dans `pointer.js`, qui ne fait que
consulter deux prédicats dont un seul répond. Le mode est une affaire de vue, il reste dans la
vue.

**Conséquence assumée : un pinceau actif interdit de glisser un pion.** C'est cohérent — le MJ
a choisi un mode — et réversible d'un clic.

### 6.3 Le pan reste accessible, sans rien ajouter

La branche à deux pointeurs (lignes 323-351) gère déjà pinch et pan, et le pinceau ne la touche
pas. **Un doigt peint, deux doigts naviguent** : règle unique, apprise en un essai, et zéro
interface supplémentaire.

Sur le Mac, la souris n'a qu'un « doigt » : le MJ y sort du mode pinceau pour naviguer, ou
utilise la molette si le zoom y est branché. À vérifier au montage plutôt qu'à supposer.

### 6.4 La forme du pinceau

Un disque, dont le rayon se règle en **cases** et non en pixels de masque — le MJ raisonne en
cases, et `FOG_MASK_PX_PER_CELL` ne doit pas fuir dans l'interface. Trois tailles suffisent
(1, 3, 5 cases) ; un curseur continu serait du réglage pour le plaisir du réglage.

⚠ La conversion cases → pixels de masque appartient à `vision/fog.js`, qui reçoit `gridScale`
de son appelant (`CONVENTIONS.md` §3). `fogTools.js` est sous `ui/`, il ne fait **aucune**
arithmétique `pxPerCell` — interdiction n°5, vérifiée par un grep littéral dans
`tests/architecture.test.mjs`.

---

## 7. `fog.paint` et `fog.reset` ne doivent pas être publiés

Le CdC §7 les liste (« `fog.reset` / `fog.paint` | MJ | ponctuel »), et `CONVENTIONS.md` §4
interdit d'inventer un nom d'événement. Mais il n'oblige pas à en émettre un parce qu'il est
listé, et ici **il ne faut pas.**

Trois raisons, dont la première est décisive :

1. **Une tablette qui reçoit un coup de pinceau devrait le rasteriser** — donc calculer, ce que
   le CdC §4 leur interdit et que L-04 a bâti son architecture pour éviter. Les tablettes
   reçoivent des masques déjà faits, jamais des instructions de dessin.
2. **`fog.update` porte déjà la conséquence**, et pour trois fois rien : 1,0 à 1,9 Kio par
   masque complet (§1). Publier un ordre de peinture n'économiserait rien de mesurable tout en
   ajoutant un second chemin vers le même état.
3. **Deux chemins vers un état divergent toujours.** Ce dépôt l'a payé assez de fois pour que
   ce soit une règle et non une préférence.

**Ce que L-06 publie, donc : `fog.update`, et rien d'autre.** Les deux noms du CdC restent
réservés, non émis, avec la raison écrite — voir l'amendement du §10.

Un point d'attention qui en découle : `scheduleFogPublish` est **throttlé à 1 Hz**. Un
« tout masquer » suivi immédiatement d'un « tout révéler » doit arriver aux tablettes dans le
bon ordre et ne pas rester coincé dans la traîne. L-04 a écrit cette traîne exprès (« sans
laquelle la dernière révélation d'une rafale restait indéfiniment non publiée ») : la vérifier
sur une rafale d'actions d'outil fait partie de la tranche, c'est le critère 6 du §12.

---

## 8. Ce qu'il faut ajouter à `vision/fog.js`

`ExploredFog` sait aujourd'hui `clear()`, `reveal(polygons, mapOrigin, gridScale)`,
`revealPath(...)`, `importPng(...)`, `exportPng()`. Trois opérations manquent, et **aucune
n'est un polygone de vision** :

| Méthode | Rôle |
|---|---|
| `revealAll()` | remplit le masque entier — le pendant de `clear()`, qui existe déjà et sert de « tout masquer » |
| `paintDisc(center, radiusPx, mapOrigin, gridScale)` | révèle un disque en coordonnées carte |
| `eraseDisc(center, radiusPx, mapOrigin, gridScale)` | l'efface, en `destination-out` |

Deux remarques qui évitent une mauvaise implantation :

**« Tout masquer » est déjà écrit** : c'est `clear()`. Ne pas en ajouter un second.

**L'effacement n'est pas un remplissage en noir.** Le masque porte l'exploration dans son canal
**alpha** (`CONVENTIONS.md` §3) : peindre du noir opaque révélerait au lieu de masquer. Il faut
`globalCompositeOperation = 'destination-out'`, comme `clear()` le fait à l'échelle du masque
entier. C'est le piège exact qui a coûté le critère 9 à L-04 — l'alpha confondu avec la
luminance — et il se tend de nouveau ici.

---

## 9. L'interface : un septième onglet

`js/ui/gm/panel.js` porte six onglets (`data-tab` : `scene-library`, `import-uvtt`,
`import-image`, `token-maker`, `handouts`, `grid-settings`) et compose ses modules par
injection : `createSceneLibrary(mount, { transport })`, `createTokenLibrary(...)`,
`createHandouts(...)`. Le septième suit le même moule : `data-tab="fog-tools"`, monté par
`createFogTools(mount, options)`.

**Ce que l'injection doit porter, et pourquoi ça ne peut pas être le store.** Les instances
d'`ExploredFog` ne vivent pas dans le store — le store ne détient que le PNG publié
(`setSessionFog`). Elles vivent dans la fermeture de `bootstrapGMApp`, dans
`exploredFogMap`, accessibles par `getExploredFog(level)`. `createFogTools` reçoit donc de
`gm.js` de quoi agir : l'accès au masque de l'étage, le déclenchement d'une publication, et la
demande de rendu. `fogTools.js` ne fabrique aucun masque et n'en publie aucun lui-même.

**« Par étage »**, dit le CdC §5.4 : les outils agissent sur l'étage **actif**, et la pile
d'undo est **par étage**. Changer d'étage ne doit pas offrir d'annuler une action faite sur un
autre — ce serait un undo qui modifie une carte qu'on ne regarde pas.

L'onglet porte : *Tout révéler*, *Tout masquer*, deux pinceaux exclusifs (*Révéler* /
*Masquer*), trois tailles, *Annuler*. Le mode actif doit être **visible** — un pinceau armé
change le comportement du clic sur la carte, et un mode invisible qui change ce que fait un
clic est un piège à MJ. Le bouton *Annuler* se grise quand la pile est vide (§4).

---

## 10. Amendements requis

- **CdC §7**, ligne des événements `fog.reset` / `fog.paint` : consigner qu'ils **ne sont pas
  émis**, avec la raison du §7 — les tablettes ne calculent pas, et `fog.update` porte déjà la
  conséquence. Les noms restent réservés.
- **CdC §11, lot 4** : cocher « Undo restaure l'état fog précédent » une fois vérifié, en
  notant que la tranche qui le ferme appartient au lot 2.
- **`CONVENTIONS.md` §8 n°2** : rien à changer. Les outils sont côté MJ ; la liste de ce qui
  s'affiche en vue joueurs est inchangée.
- **`ARCHITECTURE.md`** : rien à changer. `ui/gm/fogTools.js` est déjà au manifeste, et
  l'extension de `input/pointer.js` et `input/gestures.js` ne crée aucun fichier.

---

## 11. Ce qui n'est PAS dans cette tranche

- L'éditeur de murs (**L-07**), les gabarits (**L-08**), les marqueurs (**L-09**).
- **L'undo d'autre chose que le fog.** Le CdC §5.5 mentionne aussi « une suppression de pion
  accidentelle ». Hors périmètre : un undo générique sur les mutations du store est un chantier
  à part, dont le contrat n'est pas écrit. À ne pas commencer par la porte de derrière.
- **Aucun `fog.paint` ni `fog.reset` sur le fil** (§7).
- **Aucune interface côté joueurs**, aucun pinceau, aucun undo (§3).
- Pas de forme de pinceau autre que le disque, pas de curseur continu de taille (§6.4).
- Pas de « masquer sauf la vision courante » ni d'autre opération composite : quatre actions,
  celles du CdC §5.4.

---

## 12. Critères d'acceptation

1. **Tout révéler / tout masquer** agissent sur l'étage actif, arrivent sur les tablettes, et
   ne touchent aucun autre étage. Vérifié sur une campagne à deux étages.
2. **Les pinceaux révèlent et masquent** un disque sous le doigt, en un glisser continu, avec
   les trois tailles.
3. **Masquer masque vraiment** : après un pinceau *Masquer* sur une zone explorée, la zone
   redevient non explorée côté joueurs, pions compris — c'est le canal alpha, pas du noir
   peint (§8).
4. **Un doigt peint, deux doigts naviguent** : pinceau actif, un glisser à un doigt peint et ne
   déplace pas la carte ; deux doigts continuent de panner et de zoomer ; aucun pion n'est
   déplaçable tant qu'un pinceau est armé.
5. **Undo restaure l'état précédent** — critère du lot 4. Une action d'outil annulée rend le
   masque tel qu'il était juste avant, sur l'étage concerné seulement.
6. **Une rafale d'actions converge**, malgré le throttle de 1 Hz : « tout masquer » puis
   immédiatement « tout révéler » laisse les tablettes sur « tout révélé », pas sur l'état
   intermédiaire. C'est la traîne de `scheduleFogPublish` qu'on éprouve ici.
7. **Un déplacement de PJ ne crée pas de pas d'undo**, et vide la pile : le bouton *Annuler*
   se grise. Vérifié par un test, parce que c'est la décision du §4 et qu'une régression y
   serait invisible jusqu'à la table.
8. **La pile est par étage** : une action sur l'étage A, un changement vers B, et *Annuler* ne
   propose rien.
9. **Aucun `fog.paint` ni `fog.reset` publié** : un test compte les types d'événements émis
   pendant une session d'outils et n'y trouve que `fog.update`.
10. **Aucun élément d'interface n'apparaît côté joueurs** ; aucun import de `fogTools.js`
    depuis `js/ui/player/` ni `js/app/player.js`.
11. **Le mode actif est visible** dans le panneau MJ, et le clic sur la carte fait ce que le
    panneau annonce.
12. `pnpm run verify` vert, `pnpm run check-deps` vert. En particulier : aucune mention de
    `pxPerCell` hors de `js/grid/` (§6.4), et `js/input/*` n'importe toujours que `core/*`.

---

## 13. Tests attendus

Unitaires (`node:test`), sur `vision/fog.js` :

- `revealAll` remplit le masque, `clear` le vide, et l'encodage des deux tient dans le plafond ;
- `eraseDisc` **retire** de l'exploration là où `paintDisc` en ajoute — vérifié sur l'alpha du
  masque, pas sur une couleur ;
- un aller-retour `paintDisc` → `exportPng` → `decodeFogPng` conserve la zone peinte, avec le
  décodage réel et non un mock qui ignore le compositing ;
- la conversion cases → pixels de masque respecte un `mapOrigin` non nul.

Unitaires, sur la pile d'undo (via `fogTools.js`, monté hors DOM ou avec un conteneur minimal) :

- un pas par action, jamais par position intermédiaire d'un glisser ;
- profondeur bornée à dix, le plus ancien tombant en premier ;
- une révélation par déplacement de PJ vide la pile ;
- la pile est indexée par étage.

Navigateur (`*.spec.mjs`) :

- « tout révéler » côté MJ éclaircit la vue joueurs, mesuré sur le masque publié et décodé —
  pas sur les pixels rendus, où voile, grille et fond se superposent (leçon de L-04) ;
- un pinceau *Masquer* fait disparaître un pion des joueurs ;
- rafale « tout masquer » puis « tout révéler » : l'état final côté joueurs est le bon ;
- pinceau armé : un glisser à un doigt ne pan pas et ne déplace aucun pion ;
- *Annuler* rend l'état précédent sur les trois écrans.

---

## 14. Ce que cette tranche apprendra pour la suite

`PLAN-LOT2.md` §7 laisse L-09 (marqueurs d'état) en attente d'une séance réelle. L-06 est la
première tranche dont l'ergonomie se juge **au geste** plutôt qu'au critère : la taille des
pinceaux, l'utilité réelle de « tout masquer », la profondeur d'undo nécessaire ne se
sauront qu'à table. Les valeurs de ce brief — trois tailles, dix pas — sont des points de
départ défendables, pas des résultats. Les corriger après une séance n'est pas un échec de
conception, c'est le seul moyen d'avoir raison.

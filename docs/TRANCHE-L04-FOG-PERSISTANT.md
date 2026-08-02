# TRANCHE L-04 — fog persistant, trois états, masquage joueurs

> Quatrième tranche du **Lot 2 du CdC §11**. Découpage : `PLAN-LOT2.md`. Dépend de L-01
> (arêtes bloquées), L-02 (`vision/sweep.js`) et L-03 (union des champs de vision), toutes
> trois livrées et poussées.
>
> C'est la **plus grosse tranche du lot** : elle ferme à elle seule cinq critères sur treize
> — **5** (masquage joueurs), **6** (zone explorée grisée, aucun pion visible), **7** (le
> couloir entier révélé), **9** (le fog survit au redémarrage), **12** (aucune fuite aux
> angles). Le lot passe de 1/13 à 6/13.
>
> ⚠ « Tranche L-04 » ≠ « chantier L » (outil de cartes).

---

## 1. Ce qui a été mesuré avant d'écrire ce brief

Trois briefs sur quatre ont été corrigés par une mesure faite **avant** la première ligne de
code. Celle-ci ne fait pas exception : elle a trouvé un piège à **425×** et une collision
avec une garde existante. Les chiffres qui suivent viennent d'un prototype sur la géométrie
publiée — carte `testbig150`, 65 × 71 cases, 1396 segments, chemin de 299 positions — et de
Chromium pour tout ce qui touche au canvas.

| Opération | Coût mesuré |
|---|---|
| Sweep sur un chemin de 10 cases | 27 ms |
| Rasterisation du masque **en boucle de pixels JS** | **51 ms par case de chemin** |
| Rasterisation du masque par **`fill()` natif** | **0,12 ms par case de chemin** |
| Encodage PNG mono-canal du masque | 6 ms |
| Charge publiée, PNG mono-canal 8 px/case | 11,7 Kio base64 |
| Charge publiée, PNG RGBA via `toDataURL` | 26,8 Kio base64 |

Ces chiffres commandent trois décisions de la tranche, développées aux §5, §6 et §7. Ils ont
été relevés sur un poste de bureau : **aucun verdict de performance n'est coché ici**
(interdiction n°14), ils servent à choisir une conception, pas à valider le critère 13 — qui
est d'ailleurs déjà clos par la mesure du 31/07.

---

## 2. Ce qu'il faut écrire

1. **`js/vision/fog.js`** — le masque exploré : accumulation, encodage, décodage. Le
   manifeste le décrit déjà : « masque raster, OR, encodage PNG ».
2. **`js/render/layers/fogLayer.js`** — passage de deux à **trois** états de rendu. L-03 l'a
   écrit pour accepter ce second niveau sans réécriture ; c'est le moment de vérifier que
   c'était vrai.
3. **La publication et la persistance** — `fog.update`, Mac seul, et le document Firestore
   qui survit au redémarrage.
4. **Le masquage côté joueurs** — la première fois de ce lot que `js/ui/player/` et
   `js/app/player.js` sont touchés.

Pas de portes à trois états (L-05), pas d'outils de pinceau ni d'undo (L-06), pas d'éditeur
de murs (L-07).

---

## 3. Le partage d'autorité, à ne pas inverser

`PLAN-LOT2.md` §3, répété à chaque brief parce que c'est l'erreur qui coûterait le plus
cher : **la vision et le fog se calculent sur le Mac seul**, nœud autoritaire (CdC §4).

À L-03 c'était trivial, rien ne partait sur le réseau. **À L-04 ça devient la contrainte
structurante** : les tablettes reçoivent des **masques déjà rasterisés** et ne font que les
afficher. Aucun `sweep()`, aucune accumulation, aucun calcul de visibilité sous
`js/ui/player/` ni dans `js/app/player.js`. Si du code de vision apparaît là, la tranche est
à refaire.

Corollaire utile : les arêtes bloquées, elles, restent calculées **partout localement**
(déterministes à partir des données d'étage). Ne pas « harmoniser » les deux.

---

## 4. Les deux masques, et pourquoi il en faut deux

| Masque | Contenu | Rythme | Persisté |
|---|---|---|---|
| `explored` | tout ce qui a **déjà** été vu, cumulé depuis le début de la séance | à la révélation, throttlé 1 Hz | **oui**, Firestore |
| `visible` | ce qui est vu **maintenant** — l'union de L-03 | à chaque changement | non, éphémère |

Le critère 6 impose la distinction : « une zone explorée puis quittée reste grisée ». Sans
`visible`, on ne saurait pas ce qui est *encore* vu ; sans `explored`, la zone quittée
redeviendrait noire et le critère 9 n'aurait aucun sens.

`visible` n'est **pas** persisté : il se recalcule en une passe au redémarrage, et le
persister créerait un second état à maintenir cohérent avec le premier. `explored` seul est
de la mémoire ; `visible` est une projection.

**Où ils vivent, et surtout où ils ne vivent pas.** CdC §6 : `explored` va dans
`/session/{sid}/fog/{levelId}`, `visible` dans `/session/{sid}/vision`. Les deux portent la
**même** représentation — PNG mono-canal 8 px/case, base64 brut — et diffèrent par leur cycle
de vie, pas par leur format.

⚠ **Ni l'un ni l'autre n'entre dans le document de campagne.** Ne pas ajouter de champ `fog`
au type `Level`, ne pas l'autoriser dans `validateCampaign`. La ligne 622 du CdC parle d'une
« séparation volontaire », et l'instantané de campagne est justement le document qui porte le
plafond de 1 Mio et l'historique de perte de campagne après F5 (`ETAT.md`).

---

## 5. Le piège principal : la rasterisation. Mesuré à 425×.

Le critère 7 exige de recalculer le sweep **sur chaque case du chemin** (CdC ligne 384) —
sinon traverser un couloir ne révèle que l'arrivée. Il faut donc, à chaque case parcourue,
verser un polygone de vision dans le masque exploré.

**La façon évidente est la mauvaise.** Écrire une boucle de pixels en JavaScript — pour
chaque pixel du masque, tester s'il est dans le polygone — coûte **51 ms par case de
chemin** sur la carte de test. Un déplacement banal de 10 cases coûterait **510 ms**, soit
près du double du budget de 300 ms que le CdC fixe au déplacement d'un pion. La tranche
serait injouable, et le symptôme apparaîtrait tard : sur une petite carte, la même boucle ne
coûte que 4 ms et paraît saine.

**Le masque doit *être* un canvas, jamais un tableau de pixels.** C'est exactement l'astuce
de L-03, appliquée une couche plus bas :

- le masque exploré est un **canvas hors écran persistant**, un par étage, dimensionné à
  8 px par case ;
- verser un polygone de vision, c'est un `fill()` — **0,12 ms**, 425 fois moins cher ;
- **l'union dans le temps est gratuite** : deux `fill()` successifs sur le même canvas se
  recouvrent, et le recouvrement *est* le OR que le manifeste demande. Aucune logique
  d'accumulation à écrire ;
- le masque n'est jamais relu pixel par pixel, sauf au moment de l'encodage (§6).

Il n'y a donc **aucun `getImageData` dans la boucle de déplacement**. S'il y en a un, la
tranche est repartie dans le mur mesuré.

### La conversion vers l'espace du masque n'appartient pas à `vision/`

`vision/*` ne peut importer que `core/*`, jamais `grid/*`. `fog.js` travaille donc en
**pixels de masque** et reçoit de son appelant la transformation depuis les pixels carte :
origine et pas, obtenus par `grid.mapFromCellPoint()`. L'appelant est le seul à savoir qu'une
case fait 8 pixels de masque.

⚠ **L'origine du masque n'est pas forcément (0, 0)** : un étage peut porter un décalage.
Prendre `grid.mapFromCellPoint({ cellX: 0, cellY: 0 })` comme origine, ne jamais la supposer
nulle.

⚠ **Nommer la constante `FOG_MASK_PX_PER_CELL`, jamais `fogPxPerCell`.** Le test
d'architecture n°1 fait une recherche **littérale** de `pxPerCell` hors de `js/grid/`, y
compris en commentaire. `FOG_MASK_PX_PER_CELL` passe ; la variante en casse mixte contient la
chaîne interdite et fait rougir la suite. Ce garde-fou a déjà arrêté trois personnes sur ce
lot.

---

## 6. Le second piège : `toDataURL` produit du RGBA, et la garde le refuse

La recette naturelle pour publier le masque est `canvas.toDataURL('image/png')`. **Elle ne
passe pas.**

Un canvas est toujours RGBA : `toDataURL` encode quatre canaux là où le masque n'en porte
qu'un. Mesuré : **26,8 Kio** de base64 pour le masque de la carte de test. Or
`assertNoTransientAssetUrls` refuse toute chaîne commençant par `data:` au-delà de
`TOKEN_IMAGE_MAX_BYTES`, soit **24 Kio**, et cette garde tourne sur **chaque événement**
(`js/transport/FirebaseTransport.js:567`), pas seulement sur les instantanés. Le fog serait
rejeté au réseau, tardivement, avec un message parlant d'image de pion.

**L'encodeur PNG mono-canal se écrit donc à la main**, dans `vision/fog.js` — ce que le
manifeste annonçait déjà par « encodage PNG ». Le chemin a été validé de bout en bout dans
Chromium :

- un seul `getImageData` à la publication, dont on ne garde que le **canal alpha** ;
- filtre `Up` par ligne, puis `CompressionStream('deflate')` — présent nativement, **aucune
  dépendance à ajouter** à `STACK.md` ;
- chunks `IHDR` (profondeur 8, type couleur 0), `IDAT`, `IEND`, CRC32 ;
- résultat : **11,7 Kio** de base64, encodés en **6 ms**, relus sans peine par un `<img>`.

**Décision du mainteneur du 01/08/2026 :** on garde 8 px par case et on écrit l'encodeur.
L'alternative à 4 px/case via `toDataURL` produisait une charge identique (11,6 Kio) pour
deux fois moins de finesse de bord — le gain était nul.

### Les deux amendements au CdC, faits le 01/08/2026

- **`~5 Ko/étage` → `~12 Ko/étage`** (§10, persistance). L'estimation n'avait jamais été
  mesurée ; elle vaut 11,7 Kio.
- **`/session/{sid}/vision` porte un masque, plus un polygone** (§6, canal temps réel). Le
  polygone pesait 38 à 180 Kio sur le fil, et aurait obligé les tablettes à rasteriser —
  donc à calculer, ce que le §3 leur interdit.

Les deux portent leur justification dans le CdC. **Le CdC fait donc foi, ce brief ne le
contredit plus.**

### Le fog échappe à la garde, donc il doit porter la sienne

En stockant du **base64 brut** (sans préfixe `data:`), le champ `png` ne déclenche plus
`assertNoTransientAssetUrls`. C'est ce qu'il faut faire — mais ça veut dire que **plus rien
ne borne cette charge**, et ce projet a déjà perdu une campagne sur une charge non bornée
(`ETAT.md`, bug de disparition après F5 ; le danger n'était pas `data:`, c'était l'absence de
borne). `fog.js` refuse donc lui-même un masque encodé au-delà d'un plafond nommé, avant
publication.

---

## 7. Les trois états de rendu, et le sens du voile

L-03 a posé le sens, il ne change pas : **on voile ce que les joueurs ne voient pas** (CdC
§5.6). L-04 scinde le voile en deux niveaux.

| État | Vue MJ | Vue joueurs |
|---|---|---|
| Vu maintenant | pleine opacité | pleine opacité |
| Exploré, hors vision | voile léger | **grisé**, terrain lisible, **aucun pion** |
| Jamais exploré | voile plus marqué | **opaque** |

**Le MJ n'est jamais masqué** : ses trois états restent tous lisibles, y compris le
« jamais exploré ». C'est le rappel du CdC — « les zones hors vision sont masquées côté
joueurs, pas côté MJ ». Côté joueurs au contraire, « jamais exploré » est **réellement
opaque** : c'est ce qui remplace les toits abandonnés (`ANALYSE-DD2VTT-GRILLES.md` §9).

`fogLayer` reste **au-dessus des pions**, dernière couche de `CANVAS_LAYER_ORDER`. L'ordre
est figé et porte une garantie de sécurité (`ARCHITECTURE.md` §5) : ne pas le contourner.

### La substitution des toits, hypothèse à valider — pas à supposer

`PLAN-LOT2.md` §5.2 la signale comme un trou de spécification. **L'hypothèse est qu'aucun
mécanisme nouveau n'est nécessaire** : si le masque exploré démarre vide et que le sweep ne
fuit pas aux angles, l'intérieur d'un bâtiment est noir jusqu'à ce qu'on y entre — ce qui
*est* l'effet recherché. Elle reçoit un critère d'acceptation (n°6 ci-dessous) : sans ça,
personne ne saura dire si elle est satisfaite.

### Le critère 6 ne s'obtient pas par une condition d'affichage

« Une zone explorée puis quittée reste grisée, **et aucun pion n'y est visible** » — CdC
ligne 421 : montrer les pions en zone explorée-hors-vision permettrait aux joueurs de suivre
les PNJ à travers les murs.

⚠ **Et le voile ne suffit pas à l'obtenir.** `fogLayer` au-dessus des pions garantit
mécaniquement le masquage là où le voile est **opaque** — donc en zone jamais explorée. Mais
la zone explorée-hors-vision est *grisée*, semi-transparente par construction, puisque le
terrain doit y rester lisible. **Un pion posé dessous transparaîtrait.** La garantie
d'`ARCHITECTURE.md` §5 ne couvre pas ce cas, et c'est le piège de cette tranche côté joueurs.

La réponse n'est pas une condition par pion — « une condition d'affichage qu'on peut
oublier », précisément ce que l'architecture cherche à éviter. C'est un **découpage par le
masque** : côté joueurs, les pions se composent sur un canvas hors écran, auquel on applique
le masque `visible` en `destination-in`, avant dépose sur la scène. Un pion hors vision
courante n'est alors pas « caché », il n'existe pas dans le rendu — et aucun oubli ponctuel
ne peut le ramener.

Même discipline hors écran qu'à L-03, et pour la même raison : **le `destination-in` ne doit
jamais toucher le contexte de la scène**, où il effacerait le fond et la grille.

---

## 7bis. Deux défauts trouvés à l'usage, le 02/08/2026

Livrée, la tranche a tenu ses critères. Deux choses qu'aucun d'eux ne regardait ont sauté
à la première vraie partie. Elles sont corrigées ; le rappel sert à ne pas les réintroduire.

### L'autorité de vision ne doit pas dépendre de `requestAnimationFrame`

**Symptôme.** Côté joueurs, le fog ne bougeait qu'au F5 ou au changement de fenêtre —
alors même que c'était le joueur qui déplaçait son pion.

**Cause.** Le §3 confie au MJ l'autorité de vision. Ce travail vivait dans `renderAll`,
donc dans la boucle de rendu à la demande, donc dans `requestAnimationFrame` — que le
navigateur **suspend** dès que la fenêtre MJ est cachée, occultée par une autre fenêtre ou
minimisée. Le MJ recevait bien le `token.move` du joueur et mutait bien son store, mais ne
recalculait plus rien : il ne publiait donc plus ni `vision.update` ni `fog.update`, et
toutes les tablettes gardaient un fog figé jusqu'au retour de la fenêtre au premier plan.

**Mesuré par mutation** (`tests/fogRealtime.spec.mjs`) : page MJ privée de
`requestAnimationFrame`, zéro `vision.update` publié après un déplacement joueur ; frames
rendues, publication immédiate. Avec des frames, l'ancien code passait — c'est pourquoi le
test prive délibérément la page MJ de frames, et pourquoi aucun critère de la tranche ne
pouvait attraper ce défaut.

**Règle.** Le calcul et la publication de la vision vivent dans `syncVision()`, appelée sur
**mutation du store**. `renderAll` ne fait plus que dessiner. La mémoïsation par signature
reste ce qui rend l'appel bon marché quand rien n'a bougé — et elle est aussi ce qui
**empêche le rebouclage** : publier écrit dans le store, le store notifie, la notification
rappelle `syncVision`. Sans le filtre sur changement réel, le MJ diffusait 13 Kio par
seconde, indéfiniment, partie à l'arrêt.

### `destination-over` additionne les deux voiles, il ne les remplace pas

**Symptôme.** En vue MJ, la zone jamais explorée était trop opaque pour qu'on y lise la
carte, alors que la constante annonçait 0,70.

**Cause.** L'étape B pose le voile exploré **sous** ce qui reste de l'étape A. Là où
l'étape A n'a rien effacé — c'est-à-dire dans le non-exploré — les deux voiles
s'additionnent : `1-(1-0,70)(1-0,45) = 0,835`. L'affichage était donc plus sombre d'un
tiers que ce que le code disait, et personne ne pouvait s'en apercevoir en lisant les
constantes.

**Le mock de `fogLayer.test.mjs` ne pouvait pas le voir** : son `drawImage` ignore
`globalCompositeOperation`, donc il ne modélise ni l'étape B ni l'étape C. La mesure
appartient au navigateur (`tests/fogVeil.spec.mjs`), qui lit les trois états sur un fond
clair connu et les compare aux constantes déclarées.

**Règle.** L'étape A ne peint que le **complément** — `(U-E)/(1-E)` — pour que la
composition vaille exactement `U`. Les valeurs de `core/constants.js` disent alors la
vérité de ce qui s'affiche, ce qui est la condition pour pouvoir les régler.

### Le trajet se révèle pour le joueur, pas pour le glisser du MJ

**Symptôme.** Un couloir traversé par un joueur restait noir en son milieu ; un pion posé
d'un bout à l'autre de la carte par le MJ, lui, ouvrait derrière lui une traînée de fog
que personne n'avait parcourue. Les deux moitiés du même défaut, et son exact inverse.

**Cause.** `revealAlongMove` n'était appelée que depuis le glisser du MJ. Le déplacement
lancé par la table arrive par le réseau et ne passait pas par là : seule la case d'arrivée
était révélée, par `syncVision`.

**Le partage est celui du CdC** (ligne 384 : « chaque case du chemin **validé** »). Un
joueur *marche* son trajet — chemin calculé par Dijkstra, murs respectés — et tout ce
qu'il a aperçu en chemin lui reste acquis. Le MJ franchit les murs et pose un pion où il
veut : son glisser n'est pas un trajet validé, et il n'a rien à révéler d'autre que ce qui
se voit depuis la case d'arrivée.

**Le trajet révélé est le chemin publié**, pas la droite entre les deux cases : c'est le
vrai parcours marché. La droite ne sert plus que de repli, pour un `token.move` qui
arriverait sans chemin.

**Les deux moitiés cassent indépendamment** (`tests/fogTrajet.spec.mjs`) : ne vérifier que
la révélation du trajet joueur laisserait le glisser MJ continuer d'ouvrir ses couloirs
fantômes. La mesure porte sur le **masque publié**, décodé côté joueurs, et non sur les
pixels rendus — à l'écran, le voile, la grille et le fond se superposent, et une mesure de
couleur dirait autant du décor que du fog.

### Et le réglage lui-même : les trois états se règlent ensemble

Baisser la seule opacité du non-exploré vers celle de l'exploré les rendrait
indiscernables — l'information « ils n'ont pas encore vu ça » disparaîtrait au moment même
où l'on croit la rendre plus lisible. Vue MJ : **0,50 / 0,25 / 0**, écart net de 0,25 entre
états voisins. Vue joueurs : inchangée, et **non réglable** — l'opacité pleine du
non-exploré est ce qui masque mécaniquement les pions (§7).

---

## 8. Critères d'acceptation

Écrits pour être **falsifiables**. Sur les trois tranches précédentes, huit faux verts sont
passés, aucun visible à la lecture. Chaque critère indique donc ce qu'un test faible ne
verrait pas.

1. **Critère 7 — le couloir entier.** Un pion **déplacé par un joueur** traverse un couloir
   de dix cases d'un bout à l'autre : **tout le couloir** est exploré, pas seulement
   l'arrivée ni seulement le départ. Le même trajet **glissé par le MJ** ne révèle que
   l'arrivée (§7bis).
   *Ce qu'un test faible manquerait :* vérifier que l'arrivée est révélée — c'est vrai même
   si l'on ne rasterise que la dernière case. Échantillonner **une case du milieu**, que ni
   le départ ni l'arrivée ne voient.

2. **Critère 6 — la zone quittée reste grisée, sans pion.** Après le passage, le pion
   s'éloigne. Sur la vue joueurs, une case du couloir rend : le terrain **lisible** (ni noir,
   ni pleine opacité) et **aucun pixel du pion** qui s'y trouvait.
   *Ce qu'un test faible manquerait :* tester le grisé sans tester le pion. Les deux moitiés
   de ce critère cassent indépendamment — le découpage par masque du §7 est ce qui tient la
   seconde.

3. **Critère 5 — masqué chez les joueurs, jamais chez le MJ.** La **même** scène, rendue dans
   les deux vues : côté joueurs, une case jamais explorée est **opaque** ; côté MJ, la même
   case reste **lisible**.
   *Ce qu'un test faible manquerait :* ne tester qu'une vue. Le rendre côte à côte est ce qui
   prouve le partage.

4. **Critère 9 — survie au redémarrage.** Explorer, publier, **détruire tout l'état en
   mémoire**, recharger depuis Firestore : le masque exploré revient identique. Un vrai
   rechargement, pas une réutilisation d'objet resté vivant.
   *Ce qu'un test faible manquerait :* relire le masque depuis la même instance. C'est la
   leçon de `tests/player.spec.mjs` sur le F5 réel.

5. **Critère 12 — aucune fuite aux angles.** Une case située derrière un angle de mur reste
   non explorée, à 8 px/case. La rasterisation est une **nouvelle** occasion de fuite : le
   sweep peut être correct et le masque fuir quand même, si un pixel de bord bascule du
   mauvais côté.
   *Ce qu'un test faible manquerait :* réutiliser le test de L-02 sur le polygone. Celui-ci
   doit échantillonner **le masque**.

6. **La substitution des toits.** Sur un étage jamais visité, l'intérieur d'un bâtiment clos
   est **entièrement opaque** côté joueurs avant toute entrée, et se révèle en entrant. C'est
   la validation de l'hypothèse du §7 — si elle est fausse, il faut le savoir maintenant.

7. **Le masque tient sa borne.** Un masque encodé au-delà du plafond est **refusé par
   `fog.js`**, avec un message qui nomme la taille et le plafond. Et la charge publiée ne
   commence **pas** par `data:` — sinon la garde transport la refuserait à 24 Kio.

8. **La rasterisation ne relit jamais le masque.** Aucun `getImageData` sur le chemin de
   déplacement ; il n'en reste qu'un, à la publication. Vérifié par **compteur d'appels**, pas
   par chronomètre — la CI est bruitée et ce projet a déjà payé trois budgets en horloge
   murale.

9. **Le recalcul reste sur changement**, jamais par image, et la signature de mémoïsation
   suit la règle de L-03. **Le masque exploré étant cumulatif, il ne s'invalide pas** : le
   vider parce qu'un pion a bougé est le contresens à ne pas commettre. Seul `visible`
   se recalcule.

10. `pnpm run verify` vert, suite unitaire sous 10 s, `pnpm run check-deps` vert, aucun
    `@ts-ignore` (interdiction n°16), aucune mention de `pxPerCell` hors de `js/grid/`.

---

## 9. Ne pas faire

- **Ne pas** rasteriser le masque en boucle de pixels JavaScript (§5, mesuré à 425×).
- **Ne pas** publier par `toDataURL` (§6, refusé par la garde à 24 Kio).
- **Ne pas** préfixer la charge par `data:` — et ne pas pour autant la laisser sans borne.
- **Ne pas** ajouter de dépendance : `CompressionStream` est natif, `STACK.md` ne bouge pas.
- **Ne pas** calculer la vision côté joueurs (§3), ni y appeler `sweep()`.
- **Ne pas** remettre le calcul ni la publication de la vision dans la boucle de rendu
  (§7bis) : une fenêtre MJ en arrière-plan n'a plus de frame, et fige le fog de la table.
- **Ne pas** régler l'opacité d'un seul des trois états de la vue MJ (§7bis).
- **Ne pas** révéler le trajet depuis le glisser du MJ (§7bis) : il franchit les murs, son
  geste n'est pas un chemin validé.
- **Ne pas** obtenir le critère 6 par une condition d'affichage par pion (§7).
- **Ne pas** invalider le masque exploré sur mouvement (§8, critère 9).
- **Ne pas** toucher `sweep.js` : L-02 est close, la piste d'accélération est pour après L-04.
- **Ne pas** faire les portes à trois états (L-05), les pinceaux ni l'undo (L-06).
- **Ne pas** créer de fichier hors manifeste : `vision/fog.js` et `render/layers/fogLayer.js`
  y sont déjà.

---

## 10. Attendu en fin de tâche

Un rapport de **3 lignes**, puis **arrêt**. Aucun commit.

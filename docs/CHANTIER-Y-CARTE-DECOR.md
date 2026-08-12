# Chantier Y — La carte-décor

> Livré le 12 août 2026. Rend importable une **simple image** comme fond de carte, sans géométrie.

## 1. Le constat qui a déclenché le chantier, et qu'aucun critère ne mesurait

Le préparateur n'acceptait que `.uvtt`, `.dd2vtt`, `.df2vtt`. Or la bibliothèque réelle du mainteneur
— les packs Stained Karbon — ne contient que du `.jpg` et du `.pdf` : **1 774 images JPEG**, mesurées
en parcourant le dossier.

**Sa bibliothèque entière était donc inutilisable par sa propre chaîne.** Le produit tournait sur
cinq cartes de test pendant que 1 774 vraies cartes dormaient dans `Downloads`. Aucun critère du CdC
ne mesure cet écart, et c'était pourtant ce qui séparait le plus l'outil d'un outil dont on se sert.

⭐ Le critère 1 du lot 3 — « trois étages importés indépendamment » — était classé « bloqué sur du
contenu licencié pour le dépôt ». C'était une lecture fausse : il n'attendait pas du contenu, il
attendait que la chaîne sache avaler ce que le mainteneur avait déjà.

## 2. Le périmètre, tranché par le mainteneur

> « si je le fais ce sera en mode fond de carte pour un combat par exemple, restons le plus simple
> possible »

Donc **pas d'outillage de murs** : ni détection de contours, ni tracé assisté. Une carte-décor est un
fond, et rien de plus. L'alternative — rendre la géométrie exploitable — aurait retardé l'usage de
plusieurs semaines pour un gain limité aux cartes tactiques, et elle reste possible carte par carte
avec l'éditeur de murs de L-07. L'inverse n'était pas vrai.

## 3. ⭐ La densité vient du nom de fichier, et c'est exact

Le corpus écrit ses dimensions dans le nom : `Ambush Site_37x28_High res.jpg` fait 5180 × 3920 px,
donc **5180 / 37 = exactement 140 px/case**. Aucune calibration à saisir, aucune détection à faire,
aucune approximation.

⛔ **Et aucune valeur par défaut, sur arbitrage explicite du mainteneur :**

> « ce corpus est à 140px / cases mais peut être qu'un jour j'aurai d'autres images qui auront une
> densité différente, il ne faut pas tout baser là dessus »

C'est juste : coder 140 en dur ferait d'une propriété de fournisseur une règle du produit. Sans
couple lisible dans le nom, la préparation **refuse**, avec un message qui nomme le remède et
explique pourquoi rien n'est supposé.

**Le repli que j'avais annoncé n'existe pas, et je m'étais trompé en le promettant.**
`js/import/gridPitch.js` semblait pouvoir mesurer un pas de grille ; sa fonction prend en réalité
`pxPerCell` **en entrée** — elle classe un réseau peint en carré ou hexagonal à partir d'un pas connu,
elle ne découvre pas un pas inconnu. Écrire un détecteur *ab initio* était un chantier à part,
incompatible avec « le plus simple possible ». Le refus explicite l'a remplacé.

### La validation croisée, et le piège qu'elle attrape

Un nom peut porter plusieurs couples de nombres. `carte_5180x3920.jpg` donnerait **1 px/case** et
produirait silencieusement une carte de 5 180 cases de large. Chaque couple est donc confronté aux
dimensions réelles de l'image et écarté s'il sort des bornes de plausibilité (20 à 600 px/case).

Et si les deux axes ne concordent pas — `37x28` sur une image rognée en bas —, la largeur sert de
référence **mais l'écart est signalé**. Trancher sans le dire est exactement ce que l'exigence
d'universalité de l'import interdit.

## 4. Ce que produit un étage décor

Géométrie vide — ni murs, ni portes, ni lumières — et **ambiante pleine**. Ce dernier point n'est pas
décoratif : `fogLayer` fait voir chaque PJ jusqu'au **plafond technique** quand l'ambiante est active,
au lieu de sa seule portée nocturne. Sans lui, une carte-décor s'afficherait comme une cave.

⚠ Deux limites, vérifiées dans le code avant d'être écrites ici :

1. **Sans pion PJ sur l'étage, les joueurs ne voient rien.** Ce n'est pas propre aux cartes-décor,
   c'est la règle « une lumière n'est pas un œil » du lot 2 — mais elle surprend sur une carte où l'on
   n'attend pas de fog. Poser un pion suffit.
2. `VISION_MAX_RANGE_CELLS` vaut 20. Sur une carte de 37 × 28, un pion au centre est à 23 cases des
   coins : ils resteront sombres tant que personne ne s'en approche. Acceptable pour un fond de
   combat. Si ça gêne un jour, le correctif est un drapeau « pas de fog » sur l'étage.

**La variante `_Grid` éteint le quadrillage de l'application.** Les packs fournissent les deux
versions ; superposer une grille calculée à une grille peinte donnerait deux quadrillages, l'un juste
et l'autre décalé. Le choix se lit dans le nom parce que c'est là que le fournisseur l'a écrit.

## 5. Deux défauts trouvés en essayant sur une vraie carte

**L'essai réel valait tous les tests.** La carte est passée du premier coup, mais elle a fait tomber
deux défauts que rien d'autre n'aurait révélés.

**1. `maps/minimal.webp` a été pris pour une carte.** C'est l'illustration de `maps/minimal.json`, une
scène de test du dépôt, et toute la préparation a échoué. La règle des affiches vidéo
(`.poster.webp`) ne suffisait pas : il fallait la règle générale du **fichier accompagnant** — une
image dont le nom de base correspond à un `.json`, un export VTT ou une vidéo est l'illustration de
ce fichier, pas une carte. Cette règle ne juge pas de la densité : une image orpheline sans
dimensions reste une carte candidate, et son refus reste bruyant.

**2. `Jimp.read` ne décode pas le WebP.** Le greffon `@jimp/wasm-webp` n'est pas enregistré seul, et
`resample` gérait déjà ce repli. Plutôt que de le dupliquer, `imageDimensions` a été ajouté à
`resample.mjs` pour qu'il n'existe **qu'un seul** chemin de décodage dans le dépôt.

⚠ **Et un effet de bord de nommage, qui a cassé un test existant.** Élargir `isSupportedSource` aux
images a changé le **sens** du prédicat : il répondait « est-ce un export VTT ? », il répond désormais
« est-ce préparable ? ». `tests/realUvtt.test.mjs` l'utilisait dans l'ancien sens et a tenté de parser
un binaire. Deux questions distinctes méritent deux noms : `isVttSource` a été ajouté.

## 6. L'outil au double-clic, sans quoi la fonction n'existerait pour personne

⛔ **Le mainteneur ne passe pas par un terminal** — c'est la raison d'être de `outil-cartes.cmd`.
L'aperçu de cet outil appelle `prepareMap`, la voie UVTT. Sans bifurcation, la carte-décor n'aurait
existé que pour la ligne de commande, donc pour personne. `prepareMap` détecte donc une image et
délègue, et la liste des sources de l'outil filtre les fichiers accompagnants.

## 7. Où le code vit, et pourquoi là

`buildDecorLevel` rend un **étage**, pas une carte. Le préparateur ne traite pas les fichiers un par
un : tout passe par des « scene jobs » qui assemblent la campagne, même pour une carte seule. Rendre
un étage évite de dupliquer ce pipeline — et donne gratuitement la possibilité de **mêler une image et
un export UVTT dans la même campagne à plusieurs étages**, ce que le critère 1 du lot 3 demande.

⚠ Ma première version dupliquait le pipeline. Elle a été remplacée avant d'être commitée.

## 8. Couverture

`tests/decorMap.test.mjs` — 14 tests. Lecture du nom sur la convention réelle, séparateurs des noms
d'éditeurs, **couple de pixels écarté**, bornes de plausibilité aux deux extrémités, incohérence
entre axes signalée, refus sans densité avec son message, règle du fichier accompagnant, étage sans
géométrie à ambiante pleine, variante `_Grid`, et manifeste gardant la main sur l'identifiant.

⛔ **Aucune image sous licence dans les tests.** Le corpus est autorisé en usage privé, pas en
republication, et `maps/` est publié sur GitHub Pages. Les fixtures sont des PNG générés dans un
dossier temporaire. La carte réelle qui a servi à l'essai a été retirée du dépôt avant tout commit,
artefacts et entrée de catalogue compris.

⭐ **Preuve par mutation sur les deux garde-fous.** Retirer les bornes de plausibilité fait rougir 2
tests, dont celui du couple de pixels. Désactiver la règle du fichier accompagnant fait rougir 2
tests — et reproduit la panne réelle du premier essai, désormais avec un message clair.

## 9. Ce qui reste ouvert

- **Le critère 1 du lot 3 n'est pas coché pour autant** : il demande trois étages importés
  indépendamment, ce qui est maintenant *possible* mais pas *fait*. Il faut trois images, un
  `scenes.json` qui les déclare comme trois étages, et le constat que rien ne s'aligne à la main.
- Le catalogue ne distingue pas une carte-décor d'un export sans murs. `walls: 0` le suggère sans
  l'affirmer. Sciemment non traité : le mainteneur a demandé le plus simple possible.

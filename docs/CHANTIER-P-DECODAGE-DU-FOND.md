# Chantier P — sortir le décodage du fond du chemin critique

> **Statut : brief, écrit le 05/08/2026 juste après la lecture de la sonde du chantier N.
> Aucun code.**
> Contrairement à N, ce chantier ne part pas d'une hypothèse : **la cause est mesurée**, et les
> chiffres sont au §1. C'est le correctif que le brief N annonçait sans le choisir.

## 1. La mesure, et ce qu'elle tranche

Sonde du chantier N, vue MJ sur le Mac, 5 août 2026. Frames provoquées par un cran de zoom après
une inactivité réelle :

| # | écart | total | fond | fog | résidu |
|---|---|---|---|---|---|
| 9 | 100,0 s | 501,1 ms | **497,5 ms** | 0,3 ms | 2,9 ms |
| 8 | 87,9 s | 490,8 ms | **487,3 ms** | 0,3 ms | 3,0 ms |
| 7 | 123,6 s | 495,7 ms | **491,4 ms** | 0,2 ms | 3,7 ms |
| 6 | 5,6 s | 1,8 ms | 0,1 ms | 0,1 ms | 1,4 ms |
| 5 | 0,0 s | 1,6 ms | 0,1 ms | 0,2 ms | 1,1 ms |
| 4 | 1,0 s | 485,3 ms | **483,9 ms** | 0,1 ms | 1,1 ms |

C'est la **première des trois lectures** du §4 du brief N : total élevé *et* couche de fond
élevée → décodage synchrone du bitmap. Le fog est à 0,3 ms, donc sa mémoïsation n'a rien perdu,
et le **résidu à 3 ms** exclut le GC comme le compositing : le coût est entier dans le
`ctx.drawImage` du fond. C'est précisément le champ que le brief N marquait ⭐ pour cette raison,
et c'est lui qui rend la conclusion ferme plutôt que suggestive.

Deux choses que la sonde a données **en plus** de ce que le brief N attendait :

1. **La fenêtre d'éviction est bien plus courte que « un moment ».** Ligne 6 : après 5,6 s
   d'inactivité, le fond coûte encore 0,1 ms — le bitmap est chaud. Lignes 7 à 9 : entre 88 et
   124 s, il coûte 490 ms. La bascule est donc **entre 6 s et 88 s**, pas au-delà de 30 s comme le
   brief le supposait. À la table, n'importe quelle pause de conversation suffit à la payer.
2. **La frame froide de chargement n'est pas la frame n°1.** Les frames 2 et 3 affichent un fond à
   `0 ms` pile : `render` sortait tôt, l'image n'était pas encore chargée. C'est la frame **4**,
   après 1 s, qui paie le premier décodage. L'exclusion de `frameCount === 1` codée dans
   `FrameProbe` ne suffit donc pas à écarter la frame froide ; sans conséquence sur cette lecture,
   où elle se repère à l'œil, mais à corriger si l'instrument reste.

Le à-coup est **surtout sensible sur la tablette**, légèrement côté MJ. 490 ms sur le Mac
signifient davantage sur la Tab S9 FE, qui décode plus lentement. Les deux vues partagent
`BackgroundLayer` : une correction dans cette couche sert les deux.

## 2. Ce que le code fait aujourd'hui, et où est le mensonge

- `js/render/layers/background.js:16` — `imageCache` est un `Map` **de portée module**, LRU de 8
  entrées, partagé par toutes les instances : les deux vues d'un même onglet et les sondes de test
  y puisent. Il retient des `HTMLImageElement`.
- `status: 'ready'` est posé sur `onload` (ligne 110). **Et c'est là qu'est le mensonge dont tout
  le défaut découle** : `onload` dit que l'image est *chargée*, pas que ses pixels sont *décodés et
  retenus*. Chrome est libre de libérer les pixels d'une image qu'il n'a pas eu à peindre depuis un
  moment, et de la redécoder en synchrone au `drawImage` suivant. Rien dans l'objet ne le signale.
- `render` (ligne 185) appelle donc `drawImage` sans condition dès que le statut est `ready`, et la
  frame paie ce que le navigateur a décidé entre-temps.
- Deux bonnes nouvelles pour le correctif, l'une et l'autre déjà en place :
  - `render` peint **déjà** un fond neutre `#34383f` avant l'image. Le cas « rien à dessiner » est
    déjà traité visuellement, il n'y a pas de trou blanc à inventer ;
  - `invalidate` est **déjà** branché sur `requestRender` dans les deux vues
    (`js/app/gm.js:103`, `js/app/player.js:226`) et `load` s'en sert déjà pour réveiller la boucle
    à la fin d'un chargement. Le mécanisme qui redemande une frame après une opération asynchrone
    existe : ce chantier le réutilise, il ne l'invente pas.

## 3. Le correctif retenu, et le prix des deux autres

Trois options, et il faut dire le prix de chacune parce que le premier réflexe — « garder le
bitmap » — est le plus coûteux des trois :

| option | effet | prix |
|---|---|---|
| **A.** baisser `MAX_PREPARED_TEXTURE_PX` de 8192 à 4096 | décodage ÷ 4, ~120 ms | **la netteté au zoom** : seules les cartes jusqu'à 29 cases garderaient 140 px/case, contre 58 aujourd'hui. Et 120 ms restent un à-coup visible : ça atténue sans régler |
| **B.** retenir un `ImageBitmap` pleine taille | à-coup supprimé, `drawImage` devient une recopie | **245 Mio retenus** pour une carte à 8192 px. Sur la tablette, c'est fabriquer la pression mémoire qu'on fuit — et c'est cette option, et elle seule, qui forcerait à choisir A |
| **C.** doublure basse résolution + décodage asynchrone | à-coup supprimé, aucune frame ne décode | **~4 Mio**, et un instant où la carte est floue au lieu d'être figée |

**C est retenue.** Elle ne coûte rien sur les cartes : le plafond de préparation reste à 8192, la
densité reste intacte, aucune carte n'est à réexporter. Elle transforme un gel d'une demi-seconde
en un flou d'une demi-seconde, ce qui est le bon sens de l'erreur à une table de jeu : le geste
répond. Et elle est réversible — elle n'engage aucune décision sur le format des cartes déjà
préparées.

## 4. La forme

1. **Une doublure décodée et retenue.** Au chargement, une fois, hors du chemin de rendu :
   `createImageBitmap(image, { resizeWidth, resizeHeight })` avec au plus **1024 px** sur le grand
   côté. Un `ImageBitmap` appartient au JS ; le navigateur ne peut pas le libérer en silence,
   contrairement au backing store d'un `<canvas>`, qui peut être perdu sous pression et qu'on ne
   saurait pas détecter. Coût : moins de 4 Mio.
   La doublure se range **à côté de l'entrée de cache**, pas dans l'instance : le cache est de
   portée module et partagé, une doublure par instance la reconstruirait deux fois par onglet.
2. **Aucun décodage synchrone dans la frame.** `render` dessine l'image pleine taille seulement si
   le bitmap est *présumé chaud*. Sinon il dessine la doublure, lance `image.decode()`, et appelle
   `invalidate()` quand la promesse se résout — la frame suivante est nette.
3. ⭐ **« Présumé chaud » est une présomption assumée, et c'est le cœur du correctif.** Rien ne
   permet de demander au navigateur si les pixels sont encore là. On tranche donc par une règle :
   chaud = **l'image a été décodée il y a moins de 4 s** (sous les 5,6 s observés chauds au §1).
   Ce qui rend la règle sûre, c'est que **ses deux erreurs sont invisibles** :
   - présumé froid alors qu'il était chaud → `decode()` se résout en une micro-tâche, une seule
     frame floue, soit ~16 ms ;
   - réellement froid → la doublure couvre les ~500 ms.

   C'est ce qui permet de traiter un état inobservable sans jamais bloquer : on ne cherche pas à
   savoir, on borne le coût de se tromper.

4. ⛔ **La machine à états s'écrit en entier, transitions comprises.** Formuler la règle comme
   « une *peinture* pleine taille a eu lieu il y a moins de 4 s » — ce que disait une version
   antérieure de ce brief — donne un état **sans sortie** : le chemin froid ne peint jamais en
   pleine taille, donc rien ne peut plus rendre l'état chaud, la frame suivante est froide à son
   tour, et l'`invalidate()` du décodage relance une frame froide. Résultat : **boucle infinie à
   60 fps et carte définitivement floue.** Ce qui manque est une seule transition — c'est la
   *résolution du décodage*, et non la peinture, qui fait foi :

   ```
   chaud = (now - decodedAt) < 4000

   dessin pleine taille réussi   → decodedAt = now
   decode() résolu               → decodedAt = now ; decodePending = false ; invalidate()
   chemin froid et !decodePending → decodePending = true ; decode()
   ```

   Avec cette transition, la frame qui suit le décodage est chaude, peint net, repousse l'échéance,
   et **la boucle s'arrête d'elle-même**. Pendant l'interaction continue, chaque peinture pleine
   taille repousse `decodedAt`, donc la doublure n'apparaît jamais — critère 3 du §6.
   Le garde `decodePending` n'est pas décoratif : sans lui chaque frame froide relance un décodage,
   et les deux vues d'un même onglet en lancent deux sur la même entrée.

5. **Une seule horloge, et elle est passée en paramètre.** Ce dépôt a déjà payé un bug d'horloges
   non comparables, et les deux sont en circulation dans ce fichier même : la sonde du chantier N
   utilise `performance.now()`, `renderAll` passe `now: Date.now()` aux couches portes et pions.
   Mélanger les deux donne un écart de 1,7 × 10¹² et un état chaud permanent, **sans aucun symptôme
   avant la table**. `render` reçoit donc `now` dans ses `options`, comme `portals` et `tokens`, et
   s'en sert pour la comparaison **comme** pour la mise à jour. Bénéfice second, et il n'est pas
   accessoire : l'horloge devient injectable, donc la règle de chaleur est testable sous Node.

6. **Le rectangle de destination se calcule une fois, et il est le même pour les deux sources.**
   Depuis `naturalWidth` / `naturalHeight` de l'image pleine taille — les deux restent lisibles même
   quand les pixels ont été libérés. La doublure et l'image nette se dessinent dans **ce** rectangle,
   sinon la carte se décale au passage du flou au net et l'art ne s'aligne plus avec la brume, les
   murs et les pions, qui sont en espace carte.

7. **Où vit l'état, et le cas `setImage`.** `decodedAt`, `decodePending` et la doublure sont des
   propriétés de l'**image décodée**, donc de l'entrée de cache — partagée par URL entre les deux
   vues d'un onglet, ce qui est exactement le comportement voulu : une vue qui garde le fond chaud
   le garde chaud pour l'autre. L'instance ne connaît aujourd'hui que `this.image` : il lui faut
   donc une référence à l'entrée courante. `setImage()` (ligne 169) n'a pas d'entrée — il
   court-circuite le cache pour l'outil local et la calibration. Tranché : **il déclare son image
   chaude en permanence et ne construit pas de doublure.** Ce sont des images locales, petites, et
   aucun chemin ne doit y décoder en synchrone.

8. **`decode()` ne garantit rien sur la rétention** — il dit seulement que l'image peut être peinte
   sans bloquer, maintenant. La doublure est le filet, pas l'appel à `decode()`.

## 5. Les pièges, tous déjà payés dans ce dépôt

1. ⛔ **Le rendu est à la demande, et ça coupe des deux côtés.** Si `invalidate()` n'est pas appelé
   quand le décodage se résout, la carte nette ne revient **jamais** avant le geste suivant — le fog
   l'a déjà payée. Et si l'état chaud n'a pas de transition d'entrée (§4.4), le même `invalidate()`
   devient une **boucle infinie**. Les deux fautes tiennent dans la même ligne de code, en sens
   opposés : la seule façon de ne pas les commettre est d'écrire les transitions avant le rendu, pas
   de raisonner sur une frame isolée.
2. ⛔ **Ne pas mettre huit `ImageBitmap` pleine taille dans le LRU** : 8 × 245 Mio. La doublure est
   petite *par construction*, c'est ce qui autorise à en garder plusieurs.
3. La doublure se construit hors frame, **jamais** dans `render`.
4. ⛔ **Ne pas faire disparaître le chemin froid des tests en les « adaptant ».** `testBackgroundLoad`
   (`tests/mountStage.mjs:148`) rend le statut, le compte d'invalidations et le pixel central. Le
   faire *attendre la promesse de décodage avant de capturer* le rend vert sans effort — et supprime
   le seul endroit du dépôt où la peinture du chemin froid s'observe. Ce que la sonde doit voir doit
   rester visible : ajouter un chemin froid explicite, pas neutraliser celui qui existe.
5. ⚠ **Le faux objet-image de `tests/mountStage.mjs:161` n'est pas une image** : c'est un objet nu,
   sans `decode()`, sans pixels, que `createImageBitmap` refusera. Le code doit détecter l'absence
   et continuer. Et **ne pas « adapter » le mock en lui greffant un faux `decode()` qui résout
   toujours** : ce dépôt a déjà eu un mock qui implémentait l'inverse du mécanisme qu'il prétendait
   tester, et le test était vert.
6. `tests/stage.spec.mjs:52` affirme « le fond charge une URL réelle et **invalide exactement une
   fois** ». Avec une doublure construite après le chargement, ce sera deux. Ce test doit être
   **rendu explicite** — une invalidation pour le chargement, une pour la doublure, chacune nommée
   — et non desserré en « au moins une ».
7. **La sonde du chantier N reste en place jusqu'à la preuve.** Elle est l'instrument de mesure de
   ce correctif ; on ne la retire qu'après le critère 1 du §6, et en un commit.

## 6. Critères d'acceptation

1. **Sur la même carte que la mesure du §1**, après plus de 2 min d'inactivité et un cran de zoom :
   la sonde montre un **fond sous 5 ms** et un total sous le budget d'une frame. C'est la même
   lecture qui a diagnostiqué, et c'est elle qui doit constater.
2. Aucun gel perceptible : le geste répond immédiatement, la carte est floue au plus ~0,5 s, puis
   nette.
3. **Pendant l'interaction continue, aucune frame ne dessine la doublure.** Sinon le correctif a
   introduit un scintillement, ce qui serait pire que le défaut.
4. ⭐ **La boucle se termine, et c'est gardé par un test.** Deux rendus froids consécutifs : le
   second ne redessine pas la doublure et ne relance pas de décodage. C'est le test qui attrape la
   faute du §4.4, et c'est le plus important du chantier — un correctif qui boucle à 60 fps sur la
   tablette est pire que le à-coup qu'il remplace.
5. Mémoire retenue par les doublures **mesurée** et sous 8 Mio, pas estimée.
6. `MAX_PREPARED_TEXTURE_PX` inchangé à 8192, aucune carte à réexporter, aucune perte de densité.
7. **La tablette** : c'est là que le à-coup était le plus fort, et la sonde n'y est pas. Le
   constater à la main fait partie du chantier, pas après. Y juger aussi la **lisibilité de la
   doublure au zoom de combat** : 1024 px étirés sur toute la carte passent à la vue « carte
   entière », où ils sont encore sur-échantillonnés, mais de près ce sera très flou. Si ça se lit
   comme « c'est cassé » plutôt que comme « ça arrive », 1536 px coûtent ~9 Mio et rouvrent le
   critère 5.

⛔ **Le statut ne passe pas à « livré » à l'écriture du code.** Les critères 1, 5 et 7 exigent une
mesure et une table : aucun des trois ne peut être vrai à l'instant où la porte passe au vert. Le
statut correct entre les deux est **« code écrit, mesure de confirmation à faire »**, et la sonde du
chantier N reste en place jusque-là (piège n°7). Ce dépôt a déjà confondu « livré » et « validé ».

### Les trois tests qui doivent exister

`background.js` n'a aujourd'hui **aucun test unitaire** — il n'est couvert qu'en e2e à travers
`tests/mountStage.mjs`. Or l'essentiel de ce chantier est une règle de temps, donc de la logique
pure, donc du ressort de la porte unitaire dès que l'horloge est injectée (§4.5) :

1. **`tests/background.test.mjs` (nouveau) — la règle de chaleur.** `now` piloté par le test :
   chaud sous 4 s, froid au-delà, et `decodedAt` repoussé par les deux transitions du §4.4.
2. **Deux rendus froids consécutifs** — le critère 4 ci-dessus. Un seul décodage lancé, une seule
   invalidation, et le second rendu n'est pas un rendu de doublure.
3. **Le chemin froid dessine bien la doublure** et `render` rend la main sans décoder en synchrone —
   là où le pixel central se lit, c'est-à-dire dans `mountStage`, sans supprimer l'observation
   existante (piège n°4).

## 7. Ce qui n'est PAS dans ce chantier

- **Le découpage en tuiles.** C'est ce qui lèvera un jour le plafond de 58 cases à pleine densité —
  la carte en dalles, seules celles à l'écran décodées. C'est un autre ordre de grandeur de
  travail, et rien n'y oblige aujourd'hui.
- Toucher au plafond de préparation, réexporter des cartes, ou changer quoi que ce soit à la
  chaîne de `scripts/resample.mjs`.
- Un `ImageBitmap` pleine taille, sous aucune forme (§3, option B).
- ⛔ **Une minuterie qui redessine pendant l'inactivité pour garder le bitmap chaud.** Elle lutte
  contre le navigateur, vide la batterie de la tablette, et c'est exactement la faute que la sonde
  du chantier N a failli commettre avec son rafraîchissement automatique.
- Porter la sonde côté joueurs : inutile si la cause est bien celle-ci, puisque la couche est
  partagée. À rouvrir seulement si un à-coup subsiste sur la tablette après le correctif.

# Chantier N — Sonde : la première image après inactivité

> **Statut : chantier clos le 05/08/2026 — la sonde a désigné une cause.** Instrument en place
> (`js/render/probe.js`, touche `P` dans la vue MJ, instantané des 64 dernières frames avec
> ventilation par couche et résidu brut), et **lecture faite le jour même**.
>
> **Résultat : le décodage synchrone du bitmap de fond.** Sur une frame provoquée après 88 à 124 s
> d'inactivité, total ≈ 500 ms dont **fond ≈ 490 ms**, fog à 0,3 ms, résidu à 3 ms — la première des
> trois lectures du §4, et le résidu exclut GC et compositing. La sonde a donné deux choses en plus :
> la fenêtre d'éviction est **entre 6 s et 88 s** et non au-delà de 30 s comme supposé au §2, et la
> frame froide de chargement est la n°4, pas la n°1 — l'exclusion codée dans `FrameProbe` ne
> l'attrape donc pas.
>
> **Le correctif est le chantier P** (`CHANTIER-P-DECODAGE-DU-FOND.md`), qui reprend ces chiffres et
> arbitre entre les trois options. La sonde y reste en place : c'est elle qui devra constater que le
> correctif tient, et elle ne se retire qu'après (critère 4 du §6 — retirable en un commit).

## 1. Le symptôme, tel qu'il a été rapporté

> « c'est désormais fluide, pas de souci de performance visible pour l'instant (sauf
> systématiquement à la première action de zoom ou déplacement après un moment passé sans agir) »

Trois mots comptent : **systématiquement**, **première**, **après un moment sans agir**. Ce n'est
donc ni une charge qui s'accumule, ni un hasard : quelque chose se dégrade *pendant* l'inactivité
et se paie à la frame suivante.

⛔ **Ne pas écrire de correctif avant la mesure.** Mon hypothèse principale est plausible et
documentée ci-dessous ; elle reste une hypothèse, et ce dépôt a déjà payé le prix d'un correctif
deviné (`ETAT.md`, la CI du 05/08 : un desserrage de seuils qui n'a rien corrigé parce que la
cause était ailleurs).

## 2. Pourquoi l'inactivité peut coûter : le rendu est à la demande

`js/render/frame.js` — `FrameLoop` ne produit **aucune** image si personne n'invalide. Pendant
l'inactivité, il ne se dessine donc rien du tout, et la première action doit tout refaire d'un
coup. Tout ce qui a été relâché par le navigateur ou vidé entre-temps se reconstruit dans cette
seule frame, sur le fil principal.

### Hypothèse principale : le bitmap décodé de l'image de fond

`js/render/layers/background.js` peint le fond par `ctx.drawImage` depuis un `HTMLImageElement`
conservé dans un cache LRU de 8 entrées (`imageCache`, ligne 16). Le cache retient l'**élément**,
pas le bitmap décodé : Chrome est libre de libérer les pixels décodés d'une image qu'il n'a pas
eu à peindre depuis un moment, et de la **redécoder en synchrone** au prochain `drawImage`. Sur
une carte préparée à 8192 px de côté, c'est un coût à trois chiffres de millisecondes.

Cela colle exactement au symptôme : systématique, une seule fois, puis fluide — la deuxième frame
retrouve le bitmap chaud.

### Les autres candidats, à ne pas écarter sans mesure

| candidat | se dégrade-t-il pendant l'inactivité ? |
|---|---|
| `fogLayer` — mémoïsation par signature (`_lastSignature`, `_cachedPolygons`, lignes 127-232) | **Non** en principe : la signature ne change pas si rien ne change, et le cache est un champ d'instance que le navigateur ne vide pas. À confirmer, car un recalcul de sweep coûte cher. |
| `computeBlockedEdges` — cache par étage | **Non** : cache applicatif, invalidé par mutation seulement. |
| `StatusIconCache` (`js/render/statusBadges.js`) — canvas hors écran par icône et par taille | **Peut-être** : ce sont des `<canvas>`, et un navigateur sous pression mémoire peut perdre leur backing store. Volume faible cependant. |
| images des pions | **Peut-être**, même mécanisme que le fond, mais des ordres de grandeur plus petites. |
| GC | **Possible**, et c'est le candidat qui ressemble le plus aux autres : il faut pouvoir le distinguer, cf. §4. |
| minuteries throttlées (heartbeat de présence, publications) | Sans effet sur une frame de rendu, mais peut produire un pic de travail réseau au réveil. À noter, pas à confondre. |

## 3. La sonde va dans l'application, pas dans `diag.html`

`diag.html` existe déjà — page de diagnostic matériel à boutons, sans terminal, boutons de 44 px
de haut pensés pour le doigt (`btn-env`, `btn-store`, `btn-fps`, `btn-thermique`, `btn-sweep`,
`btn-sweep-reel`). C'était le véhicule évident, **et c'est le mauvais** :

- elle monte sa **propre scène** (`preparerScene`, ligne 156) sur son propre canvas. Elle ne
  reproduit ni la pile de couches réelle, ni le fog réel, ni la carte réelle ;
- surtout, le symptôme se produit **dans une vraie séance après une vraie inactivité**. Une
  mesure provoquée dans une page de test mesurerait une inactivité simulée, ce qui est
  exactement le genre de sonde qui répond à côté.

**La sonde est donc passive et embarquée dans la vue MJ** : elle chronomètre les frames qui ont
lieu de toute façon, et n'en provoque aucune. Affichage par un geste, sur le modèle du tap à
trois doigts qui rappelle déjà l'overlay de version côté joueurs
(`tests/player.spec.mjs`, « Tap à trois doigts rappelle overlay »).

## 4. Ce qu'il faut mesurer, et pourquoi chaque champ est nécessaire

Pour chaque frame, dans un **tampon circulaire de taille fixe** :

| champ | ce qu'il discrimine |
|---|---|
| **écart depuis la frame précédente** | isole les frames « après inactivité » des autres. C'est la variable indépendante : sans elle, on compare des choux et des carottes. |
| **durée totale de la frame** | le symptôme lui-même. |
| **durée de chaque couche** | désigne le coupable. Sans cette ventilation, on saura qu'une frame est lente sans savoir pourquoi. |
| **durée du seul `drawImage` du fond** | teste l'hypothèse principale directement. |
| **somme des couches, comparée au total** | ⭐ le champ le plus important, cf. ci-dessous. |

### Ventilation R2

L'overlay (touche `P`) existe côté MJ comme côté joueurs et montre, séparément, **store/snapshot**, **vision**, **fond**,
**grille**, **portes**, **pions**, **fog**, **autres** (murs, zone de mouvement et gabarits), le
**total** et le résidu. La vision est calculée hors de `renderAll` pour continuer à être publiée
quand la fenêtre MJ n'obtient plus de rAF : son temps est donc rapporté avec la première image qui
suit la mutation, mais n'est pas inclus dans le résidu du Canvas. Aucune de ces mesures ne crée de
frame, de minuterie ou de tableau qui grandit pendant l'inactivité. Sur la tablette, `vision` vaut
zéro : le calcul autoritaire reste côté MJ ; le décodage et l'application des masques restent
mesurés dans les couches pions/fog. Sans clavier, ouvrir `player.html?probe=1` révèle l'overlay après
la première frame, ou appeler `__RPG_APP__.frameProbe.toggleOverlay()` depuis DevTools. Pour le cas
froid : ouvrir avec `?probe=1`, laisser la tablette inactive 120 s, faire le geste qui redemande la
carte, puis **taper l'overlay** pour actualiser l'instantané. Ce tap ne planifie aucune frame.

⭐ **Le résidu total − somme des couches est ce qui rend la sonde concluante plutôt que
suggestive.** `drawImage` peut déclencher un décodage que le navigateur exécute **hors** du temps
JS mesurable : dans ce cas la couche paraît rapide et le retard apparaît ailleurs — compositing,
GC, ou attente. Trois lectures possibles, et elles se distinguent :

- total élevé **et** couche de fond élevée → décodage synchrone, hypothèse confirmée ;
- total élevé **et** fog élevé → mémoïsation perdue, hypothèse à revoir ;
- total élevé **et toutes les couches basses** → le coût est hors JS : GC ou compositing, et le
  correctif n'est pas celui qu'on croyait.

## 5. Les pièges de mesure, tous déjà payés dans ce dépôt

1. ⛔ **La sonde ne doit provoquer aucune frame.** Une sonde qui redessine pour mesurer supprime
   l'inactivité qu'elle prétend observer. Elle enregistre, elle ne demande jamais de rendu.
2. ⛔ **Aucune allocation par frame** : pas de tableau d'objets qui grandit, sinon la sonde
   fabrique elle-même la pression mémoire qu'elle cherche. Tampon circulaire de nombres, alloué
   une fois.
3. **`performance.now()`, jamais `Date.now()`** — horloge monotone et sous-milliseconde. Le
   projet a déjà eu un bug d'horloges non comparables (`debugging_lessons`).
4. **La première frame après le chargement est froide elle aussi**, pour d'autres raisons. Il faut
   pouvoir l'exclure, sans quoi elle contaminera la statistique du cas qui nous intéresse.
5. **L'affichage se construit à partir des frames précédentes**, jamais de la frame en cours :
   dessiner l'overlay dans la frame mesurée la fausse.
6. **Ne pas remesurer ce qui l'est déjà** : le coût du sweep, celui de la lecture du store et les
   images par seconde ont leurs routines dans `diag.js`, avec des valeurs consignées dans
   `ETAT.md`. Ce chantier ne mesure qu'une chose : ce que coûte la **première** frame après un
   silence.

## 6. Critères d'acceptation

1. La sonde tourne en séance réelle **sans changer le comportement** : aucune frame de plus,
   aucune allocation par frame, aucun affichage tant que le geste ne l'a pas demandé.
2. Après une inactivité de plus de 30 s suivie d'un zoom, l'overlay montre la frame incriminée
   avec sa ventilation par couche et son résidu.
3. La sonde **désigne une cause** parmi les trois lectures du §4, ou dit explicitement qu'elle ne
   tranche pas — ce qui est un résultat, pas un échec.
4. Elle est **retirable en un commit** : c'est un instrument, pas une fonction.

## 7. Ce qui n'est PAS dans ce chantier

- **Aucun correctif.** Pas de `createImageBitmap`, pas de préchauffage, pas de frame gardienne
  pendant l'inactivité. Le correctif est un chantier suivant, choisi sur la mesure.
- Aucune modification de `diag.html` (§3).
- Aucune mesure de cast, de thermique ou de latence réseau : déjà couvertes ailleurs.

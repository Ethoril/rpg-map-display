# Chantier O — Désigner un pion au doigt : la tolérance manquante

> **Statut : brief, écrit le 05/08/2026. Aucun code.** Deux arbitrages attendent le mainteneur
> (§5), le reste est décidé par la mesure et par le code existant.

## 1. Le vrai déséquilibre, et il n'est pas où on l'a cherché

Retour de table : au doigt, un tap destiné à un pion adjacent à une porte ouvrait la porte. La
capsule des portes a été ramenée de 0,5 à 0,25 case le 05/08, ce qui traite le symptôme. **La
cause, elle, reste entière** :

| cible | tolérance de désignation |
|---|---|
| une **porte** | une capsule autour de son segment (`PORTAL_HIT_CELL_RATIO`, 0,25 case) |
| un **pion** | **aucune** — appartenance à la case exacte (`tokenAtCell`, `js/app/gm.js:48`) |

À la vue « carte entière » — la vue normale de la tablette — une case fait **33 px** à l'écran
quand un doigt en couvre une quarantaine. Viser un pion demande donc une précision que le doigt
n'a pas, et un tap manqué ne sélectionne rien.

⚠ **C'est aussi ce qui rend le réglage des portes inconfortable dans l'autre sens** : à 0,25 case
la bande de porte ne fait plus que 8 px à l'écran. On a rendu la porte difficile à viser pour
protéger le pion, alors que le pion n'avait aucune tolérance à défendre. **Donner au pion sa
tolérance permettra peut-être de rendre à la porte la sienne** — à mesurer après, pas avant.

## 2. Ce que le code fait aujourd'hui, précisément

### Un seul point d'entrée sert le tap ET le glisser — c'est une bonne nouvelle

- `tokenAtCell(campaign, activeLevel, cell)` — `js/app/gm.js:48`. Filtre sur `levelId`, puis
  appartenance au rectangle du pion en tenant compte de `sizeCells`.
- appelé au **tap** (`js/app/gm.js:895`) et par **`canStartTokenDrag`** (`js/app/gm.js:1011`),
  qui est le point où `js/input/pointer.js:243` décide si un glisser devient `dragToken` ou
  `panBy`.

**Une tolérance écrite là bénéficie donc aux deux gestes d'un seul coup.** Mais elle change aussi
le glisser, et c'est à assumer explicitement (§4, test qui casse).

### La vue joueurs a sa propre copie, et elle ne filtre pas pareil

`js/ui/player/bootstrap.js:115-124` réimplémente la désignation en ligne, avec **une différence
de fond** : elle exclut les pions `hidden`, ce que la version MJ ne fait pas — et à raison, le MJ
doit pouvoir saisir un PNJ caché.

> ⚠ **Donc l'extraction ne peut pas être un simple copier-déplacer**, contrairement à
> `js/input/portalHit.js` dont les deux copies étaient identiques mot pour mot. Le helper partagé
> doit recevoir son **filtre en paramètre**. Écrire un helper qui filtre `hidden` en dur ferait
> disparaître les PNJ cachés de la vue MJ, en silence.

### `find()` renvoie le premier du tableau, pas le plus proche ni celui du dessus

Les deux implémentations utilisent `Array.prototype.find`. Pour deux pions superposés, **le
gagnant dépend de l'ordre du tableau de campagne** — donc de l'ordre d'insertion. Ce n'est pas
un choix, c'est un effet de bord ; il devient visible dès qu'on introduit une tolérance, parce que
les candidats seront alors nombreux.

### Un pion non manipulable bloque la porte, côté joueurs

`js/ui/player/bootstrap.js:136` — la porte n'est consultée que `if (!tappedToken)`. Un joueur qui
tape un PNJ n'obtient donc **rien** : ni sélection (le PNJ n'est pas manipulable), ni porte. La
zone morte existe déjà ; **une tolérance l'agrandirait autour de chaque PNJ**. À traiter dans ce
chantier, sinon il aggrave ce qu'il vient corriger.

## 3. La forme de la tolérance : pixels écran, et pourquoi ce n'est pas contradictoire

`PORTAL_HIT_CELL_RATIO` porte une interdiction écrite : ⛔ ne pas convertir la capsule des portes
en pixels écran, parce qu'une bande constante à l'écran couvrirait d'autant plus de cases que la
carte est dézoomée. **Cette interdiction ne s'applique pas ici, et il faut dire pourquoi** :

- une porte est un **objet de la carte** ; sa capsule était une extension de l'objet, donc à
  l'échelle de la carte ;
- la tolérance d'un pion n'est pas une extension du pion : c'est une **compensation de
  l'imprécision du doigt**, laquelle est une grandeur d'écran et rien d'autre.

Donc : **surface du pion en unités carte, plus une marge en pixels écran**, convertie en unités
carte au moment du test (`marge / zoom`), bornée par une fraction de case pour qu'au zoom le plus
lointain elle n'attrape pas un pion à deux cases.

Et ce qui rend cette marge sûre là où la bande de porte était dangereuse : **le plus proche
gagne**. Le danger, dans le cas des portes, n'était pas la largeur de la bande mais sa
**priorité inconditionnelle** — elle gagnait dès qu'on était dedans. Une désignation au plus
proche n'a pas ce défaut : un pion sous le doigt (distance 0) bat toujours un voisin à 15 px.

## 4. Les tests qui vont casser, et c'est voulu

`tests/input.spec.mjs`, « Vue MJ — un drag commencé **hors pion** pan la caméra sans déplacer de
pion » (ligne 161) : il affirme qu'un glisser démarré à côté d'un pion produit `panBy` et **aucun**
`dragToken`. Avec une tolérance, « hors pion » devient flou — un glisser démarré à 15 px d'un pion
le saisira.

⚠ **Ce test ne doit pas être « adapté » à la va-vite** : il protège l'interdiction n°1 du CdC (un
doigt déplace la caméra). Il doit être **rendu explicite** : le point de départ du glisser doit
être placé à une distance **supérieure à la tolérance**, distance lue dans la constante et non
recopiée. Un test qui presse « quelque part à côté » redeviendra faux au premier réglage.

Autres tests à vérifier avant de toucher quoi que ce soit : `tests/fogTrajet.spec.mjs`,
`tests/wallEditor.spec.mjs` et `tests/manuel/gmToolDisarmGeste.spec.mjs` désignent tous des pions
par des coordonnées d'écran, et l'un d'eux a déjà coûté six runs de CI parce qu'il pressait 66 px
à côté sans le dire (`DIAGNOSTIC-GESTE-GABARITS.md`).

## 5. Les deux arbitrages

### (a) Que fait-on du pion non manipulable qui bloque la porte, côté joueurs ?

- **Recommandation : préférer, parmi les candidats, celui que le joueur peut manipuler**, et si
  aucun ne l'est, **laisser passer le geste** — donc consulter la porte. Un joueur qui tape à
  côté d'un PNJ obtient ainsi la porte qu'il visait, au lieu de rien.
- L'alternative — garder le blocage — est défendable si tu veux qu'un PNJ « protège » ce qu'il y a
  derrière lui, mais alors la zone morte grandit avec la tolérance.

### (b) Le pion verrouillé reste-t-il sélectionnable par le MJ ?

Aujourd'hui oui : `tokenAtCell` ne filtre ni `locked` ni `hidden`. Avec une tolérance, un pion
verrouillé pourrait voler la désignation d'un pion voisin manipulable.

- **Recommandation : le garder sélectionnable** (le MJ doit pouvoir le désigner pour le
  déverrouiller) mais le **classer après** un pion manipulable à distance comparable.

## 6. Ce qu'il faut écrire

- `js/input/tokenHit.js` (nouveau) — `findHitToken(tokens, levelId, mapPos, zoom, options)`,
  logique **pure et testable sous Node**, sur le modèle de `js/input/portalHit.js`. Rend le pion
  le plus proche dans la marge, filtre **passé en paramètre**, départage **par identifiant** en
  cas d'égalité pour ne jamais dépendre de l'ordre du tableau.
- `js/core/constants.js` — `TOKEN_HIT_MARGIN_SCREEN_PX` et son plafond en cases, commentés avec
  l'arithmétique de la table (33 px par case, doigt d'une quarantaine) et **la raison de la
  différence avec `PORTAL_HIT_CELL_RATIO`** (§3), sans quoi le prochain lecteur croira à une
  incohérence et « harmonisera ».
- `js/app/gm.js` — `tokenAtCell` remplacé aux deux appels (tap et `canStartTokenDrag`).
- `js/ui/player/bootstrap.js` — la copie en ligne remplacée, avec son filtre `hidden` et la
  préférence pour les pions manipulables (§5a).
- `docs/ARCHITECTURE.md` §1 — le nouveau module au manifeste, sinon le test 5 échoue.

## 7. Critères d'acceptation

1. Un tap à moins de la marge du bord d'un pion le sélectionne ; au-delà, non. Les deux sens
   testés, avec la distance **lue dans la constante**.
2. La distance se mesure au **rectangle** du pion, pas à son centre : sinon un gobelin d'une case
   battrait un ogre de trois cases dont on touche le corps.
3. Deux pions équidistants sont départagés **par identifiant**, jamais par l'ordre du tableau.
4. Un pion sous le doigt (distance 0) l'emporte toujours sur un voisin dans la marge.
5. Côté MJ, un pion `hidden` reste désignable ; côté joueurs, il reste indésignable.
6. Le glisser suit la même règle que le tap — c'est le même point d'entrée (§2).
7. `tests/input.spec.mjs` prouve toujours l'interdiction n°1, avec un point de départ **exprimé**
   comme au-delà de la tolérance (§4).
8. Mesure à faire **après** : la capsule des portes peut-elle remonter de 0,25 vers 0,4 sans que
   le pion perde ? C'est le gain caché de ce chantier, et il ne se constate qu'à la table.

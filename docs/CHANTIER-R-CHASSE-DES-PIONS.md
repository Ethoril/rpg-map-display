# Chantier R — La châsse des pions : un substrat maîtrisé pour les PV et l'état des PNJ

> **Statut : brief, rien d'écrit.** Ouvert par le mainteneur le 06/08/2026, après la première
> séance où le chantier Q a tourné sur la tablette. Verdict : « mécaniquement ça marche, mais je ne
> suis pas satisfait esthétiquement — les formes sont trop simples, les superpositions de couleurs
> se voient mal ».
>
> **Ce chantier ne rouvre aucune décision du chantier Q.** Il change le **substrat** sur lequel
> l'information se pose, pas ce qu'elle dit. La clé de lecture de Q — chez le PJ la longueur parle
> et la couleur se tait, chez le PNJ la couleur parle et la longueur se tait — est **conservée
> telle quelle**, et le §4.3 dit comment elle survit au nouveau dessin.

---

## 0. Les arbitrages

**(1) La châsse est une géométrie générée, pas un art dessiné — mais avec un contrat de zones qui
laisse l'art possible plus tard.** Tranché le 06/08/2026 après comparaison des deux voies.

> Raison de fond, et elle n'est pas budgétaire : les pions arrivent **de n'importe quel UVTT**, à
> n'importe quelle taille. Une matrice d'images de cadre — rond × carré × 1×1, 2×2, 3×3… —
> laisserait sans châsse le premier pion de taille imprévue, et « sans châsse » voudrait dire
> « sans jauge de PV ». Une géométrie s'adapte à ce qu'on lui donne. Le zéro build du projet
> (`STACK.md`) pèse dans le même sens, mais il ne serait pas une raison suffisante à lui seul.

**(2) La châsse réserve la place *avant* de dessiner. L'illustration du pion n'est jamais
recouverte.** C'est la correction de la cause réelle du mécontentement, analysée au §1.

**(3) L'information s'encode par la forme et la position, pas par la teinte seule.** À bout de
bras sur une tablette, un arc qui se remplit se lit ; deux rouges voisins ne se distinguent pas.
Cet arbitrage ajoute un canal non-coloré aux trois états de PNJ (§4.3), il ne retire pas la
couleur.

**(4) La matière de la châsse est un gris sombre unique, constant pour tous les pions.** Tranché
par le mainteneur le 06/08/2026. L'identité de couleur du pion reste portée par le **liseré** au
bord de l'illustration, à sa largeur actuelle.

| | **retenu : matière neutre** | *écarté : matière teintée par `borderColor`* |
|---|---|---|
| Base de la châsse | un gris sombre unique, constant | la couleur d'identité du pion |
| Identité du pion | portée par le liseré au bord de l'image | portée par la châsse, bien plus visible de loin |
| Lisibilité de la jauge | **garantie** : contraste connu d'avance | variable — un `borderColor` bleu sous un arc bleu de PJ se perd |

> Raison du choix : le but même du chantier est d'obtenir un contraste qui **ne dépende pas de
> données venues du dehors**. Teinter la châsse avec une couleur de pion recréerait sur la châsse
> le défaut de contraste accidentel que le §1 décrit — un pas de côté, pas une correction.

⛔ **Ne pas « améliorer » en teintant la châsse, même légèrement, même « juste une nuance de la
couleur du pion ».** C'est la voie écartée, et elle rouvre le défaut par la porte de service : dès
que la teinte dépend du pion, le contraste avec l'arc redevient variable, donc invérifiable. Le
critère d'acceptation 2 (§7) est écrit pour mordre exactement là.

---

## 1. La cause : ce n'est pas la simplicité des formes, c'est l'absence de place réservée

L'anneau de PV est tracé **par-dessus** l'image du pion (`js/render/layers/tokens.js:321-337`),
sur une illustration dont le projet ne maîtrise **ni les couleurs ni le contraste** — elle vient
d'un UVTT quelconque, exigence d'universalité de l'import. Le contraste entre la jauge et ce
qu'elle recouvre est donc **accidentel** : bon sur un portrait sombre, nul sur un portrait clair
ou bariolé.

**Conséquence à retenir avant de chiffrer quoi que ce soit : enrichir les formes au même endroit
ne réglerait rien.** Une forme plus travaillée posée sur un fond non maîtrisé reste une
superposition. C'est ce que le mainteneur décrit par « les superpositions de couleurs se voient
mal » — le mot « superposition » nomme la cause mieux que le mot « simple ».

D'où la châsse : un anneau **opaque**, de couleur connue d'avance, dans lequel l'image entre en
retrait. La jauge ne se pose plus sur l'illustration, elle se pose sur une matière que le projet
possède.

---

## 2. Deux défauts préexistants dans l'anneau que la châsse va occuper

Ils sont **dans la zone de travail du chantier** et doivent être corrigés au passage, sinon la
châsse héritera de leur comportement.

`camera.applyToContext` fait `ctx.scale(zoom, zoom)` (`js/render/camera.js:93`) : tout ce qui est
écrit dans ce contexte est en **pixels carte**, et une épaisseur voulue constante à l'écran doit
s'écrire divisée par le zoom. Deux traits ne le font pas :

1. **Le liseré du pion** — `ctx.lineWidth = Math.max(2, Math.min(width, height) * 0.035)`
   (`tokens.js:311`), en pixels carte. Sur un pion 1×1 d'une carte à 100 px/case : 3,5 px carte,
   soit **0,7 px écran à la vue « carte entière »** et 7 px à zoom 2. Le `Math.max(2, …)` a l'air
   d'être un plancher ; il n'en est pas un, puisqu'il borne la valeur avant la mise à l'échelle.
2. **L'anneau de sélection** — rayon `radiusX + 4` et `lineWidth = 3` (`tokens.js:342-344`), tous
   deux en pixels carte. Même conséquence : **0,6 px écran** au dézoom, là où le retour de table
   du 05/08 a déjà exigé le contraire pour les portes.

⭐ **Quatrième occurrence de la même erreur** — chantier K (élévation), L-09 (marqueurs), portes le
05/08, et ici. Les badges de Q et de L-09, eux, sont corrects : ils divisent par le zoom. Le
correctif est connu, il s'agit d'appliquer la constante en pixels écran.

⚠ **L'anneau de sélection touche à la désignation, pas seulement au dessin.** Vérifier avant de
le déplacer qu'il n'entre pas en conflit avec la tolérance de désignation du chantier O.

---

## 3. Le contrat de zones — la pièce qui rend l'art possible plus tard

Une seule fonction pure calcule la géométrie ; le dessin la consomme sans rien recalculer. C'est
elle qui permettra de substituer un cadre illustré au tracé procédural sans rien jeter : l'art
n'aura qu'à remplir les mêmes zones.

```
computeSocketLayout(tokenWidthMap, zoom, { kind, hp, health }) → {
  tier:        'full' | 'reduced' | 'none',
  imageRadius:  number,                          // rayon de découpe de l'illustration, px carte
  separator:  { radius, thicknessMap },           // trait sombre image ↔ châsse
  band:       { innerRadius, outerRadius },       // la châsse elle-même
  hpArc:      { radius, startAngle, endAngle, thicknessMap } | null,
  stateMarks: { radius, angles: number[], … } | null,
}
```

**Toutes les épaisseurs sont en pixels carte dans le résultat**, déjà divisées par le zoom à
l'intérieur de la fonction — comme `computeProportionalRing` le fait déjà. Aucune division par le
zoom dans le code de dessin : c'est ainsi qu'on évite une cinquième occurrence du §2.

Emplacement proposé : `js/render/tokenSocket.js`, à côté de `js/render/statusBadges.js` qui suit
déjà exactement ce partage entre calcul pur et dessin.

---

## 4. La géométrie

### 4.1 ⛔ La châsse mange vers l'intérieur, jamais vers l'extérieur

L'empreinte du pion reste **exactement** sa taille en cases. La châsse est prise sur le disque du
pion, l'illustration se réduit d'autant.

> Raison, et elle n'est pas esthétique : deux pions adjacents se touchent déjà. Une châsse de 6 px
> écran poussée vers l'extérieur ferait **chevaucher les voisins** et changerait la surface
> désignable, donc la tolérance du chantier O. Vers l'intérieur, rien de ce qui existe ne bouge.

Sur un pion de 60 px écran, une châsse de 6 px laisse 48 px de portrait. C'est le compromis à
juger sur la tablette, et le seul réglage qui compte est `CHASSE_BAND_PX`.

### 4.2 L'illustration est déjà circulaire — à savoir avant de coder deux variantes

`_drawToken` découpe **toujours** en ellipse (`tokens.js:276-278`), y compris pour un pion généré
carré par l'outil de pions : sur la carte, tous les pions sont des disques. La châsse n'a donc
**qu'une** variante à écrire. ⚠ Si un jour un pion carré doit être rendu carré, la châsse aura
besoin de sa variante — le contrat de zones du §3 est le bon endroit pour l'accueillir.

### 4.3 Comment la clé de lecture du chantier Q survit

| | ce qui varie | ce qui est fixe | canal ajouté par ce chantier |
|---|---|---|---|
| **PJ** | la **longueur** de l'arc, `current/max` | la couleur | l'arc est **posé sur** la châsse, donc lisible sur tout portrait |
| **PNJ** | la **couleur** de la châsse, trois crans manuels | la longueur — tour complet | **des crans** : 0 / 1 / 2 encoches sur la châsse |

Les encoches sont des marques **sur** la châsse, pas une variation de longueur d'arc : la clé
« chez le PNJ la longueur se tait » est intacte. Elles ajoutent un canal de **forme** à un canal
de couleur, ce que demande l'arbitrage (3).

⛔ **Ne pas dériver l'état d'un PNJ de ses PV, à aucun moment, même « juste pour choisir les
encoches ».** L'arbitrage (2) du chantier Q est la raison d'être de la fonctionnalité : le
mainteneur veut pouvoir laisser un boss à 12/140 annoncé « Indemne ». Les encoches se comptent
depuis `token.health`, jamais depuis `token.hp`.

### 4.4 Les paliers, en pixels écran

Précédent à suivre : `getBadgeTier` (`statusBadges.js:55-63`). Soit `D = tokenWidthMap × zoom` le
diamètre écran.

| `D` | palier | ce qui est dessiné |
|---|---|---|
| ≥ 44 px | `full` | châsse, séparateur, arc de PV, encoches, biseau |
| 24 – 44 px | `reduced` | châsse, séparateur, arc de PV. **Ni encoches ni biseau** — sous-pixellaires |
| < 24 px | `none` | pas de châsse ; repli sur l'anneau fin actuel |

⚠ **Limite connue, à assumer et à juger sur la tablette :** au palier `none`, l'état d'un PNJ
redevient porté par la seule couleur — exactement ce que l'arbitrage (3) corrige ailleurs. C'est
accepté parce qu'à moins de 24 px le pion est un point. Le compteur chiffré, lui, ne disparaît
jamais (arbitrage 1 du chantier Q) : l'information reste accessible au MJ à tout zoom.

### 4.5 Ce qui règle le contraste, et c'est une ligne de code

**Le séparateur.** Un trait sombre entre l'illustration et la châsse. Sans lui, un portrait clair
et une châsse claire se touchent sans frontière, et on retombe sur « les superpositions se voient
mal » à l'intérieur même du nouveau dessin. Il est aussi important que la châsse.

---

## 5. Ce qu'il ne faut pas casser

- **`token.hidden`** met `globalAlpha` à 0,45 (`tokens.js:275, 307, 329`). La châsse doit hériter
  de cette atténuation, sinon un pion caché s'annoncera par une châsse à pleine opacité.
- **Qui voit quoi.** Le compteur chiffré est réservé à qui a le droit de le lire
  (`tokens.js:381`, `canSeeHpDigits`). La châsse et l'arc sont visibles de tous — c'est déjà la
  règle de Q pour l'anneau, et ce chantier ne l'élargit pas.
- **Les badges existants** — élévation (coin haut-droit), marqueurs d'état (rangée), compteur de PV
  (coin haut-gauche) — sont ancrés sur `p0` et le diamètre. Ils ne bougent pas. Vérifier qu'aucun
  ne tombe **sur** la châsse au point de la rendre illisible ; si c'est le cas, c'est le badge qui
  se décale, pas la châsse qui se rétrécit.

---

## 6. Performance : mesurer avant de mettre en cache

Le rendu ne pèse que **3 %** du coût d'une frame (`ETAT.md`, migration Canvas 2D) : rien ici ne
justifie a priori une optimisation. Le tracé est procédural et par pion.

⚠ Un piège mérite d'être nommé d'avance : un `createRadialGradient` **par pion et par frame** pour
le biseau serait une allocation dans la boucle de rendu. S'il s'avère coûteux, le remède est un
cache par tranche de diamètre, comme `STATUS_ICON_CACHE_LIMIT` et `BADGE_RASTER_STEP_PX` le font
déjà pour les icônes — **mais seulement après mesure**. Un biseau plat, sans gradient, est
d'ailleurs la première version à essayer.

⛔ **Aucun `getImageData` sur le chemin de dessin d'un pion.** Le critère 8 du lot 2 l'interdit, et
c'est le défaut que `publishVisibleVision` a déjà eu à corriger.

---

## 7. Critères d'acceptation

Vérifiables en machine, par sonde de pixels sur le canvas — précédent :
`statusBadges.spec.mjs:174`, qui valide déjà une icône et sa position géométrique.

1. L'illustration du pion n'est **pas** recouverte : un pixel du portrait à `imageRadius − 1` est
   inchangé par la présence de la châsse.
2. La châsse est **opaque** : la même châsse dessinée sur deux portraits de couleurs opposées
   donne, dans la bande, deux couleurs identiques à ±2 par canal. ⭐ C'est le critère qui mesure
   la correction du défaut ; les autres mesurent la géométrie.
3. L'empreinte est inchangée : un pion 1×1 châssé n'écrit **aucun** pixel au-delà du rayon qu'il
   occupait avant le chantier (§4.1).
4. Un PJ à `current/max` connu donne un arc dont l'angle balayé vaut `ratio × 2π` à ±0,02 rad.
5. Les trois états de PNJ donnent **trois** empreintes distinctes **en niveaux de gris** — c'est
   la mesure de l'arbitrage (3) : convertie en gris, l'image doit encore les distinguer.
6. Les trois paliers du §4.4 s'enclenchent aux seuils annoncés, mesurés en pixels **écran** à
   trois zooms différents.
7. Les épaisseurs sont constantes à l'écran : le liseré, la sélection et la châsse mesurent la même
   épaisseur en pixels écran à zoom 0,2 et à zoom 2, à ±1 px (§2).
8. Un pion `hidden` atténue la châsse comme le reste (§5).
9. **⚠ Ne peut pas être fermé en machine — interdiction n°14 :** le jugement esthétique du
   mainteneur, sur la Tab S9 FE, à distance de jeu. C'est la seule raison d'être du chantier ; il
   restera **décoché** à la livraison, comme le critère 4 du lot 2.

---

## 8. Ce que ce chantier ne fait pas

- Il ne touche pas au **panneau MJ** de saisie des PV, ni aux radios d'état : le chantier Q les a
  livrés et ils fonctionnent.
- Il ne touche pas au **schéma** ni aux **événements réseau** : `hp` et `health` existent déjà, et
  aucune donnée nouvelle n'est nécessaire. **Un chantier purement de rendu.** Si une modification
  de schéma paraît nécessaire, c'est le signe qu'une décision a dérivé — s'arrêter et le dire.
- Il ne propose **aucun** cadre illustré. L'arbitrage (1) garde la porte ouverte ; il ne la
  franchit pas.

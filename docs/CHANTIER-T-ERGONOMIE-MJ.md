# CHANTIER T — ergonomie de la table et du panneau MJ

> Ouvert le 8 août 2026. Couvre R4-03, R4-04 et R4-05 de la feuille de route complémentaire.
>
> Périmètre choisi parce qu'il n'attend **aucun matériel** : ni tablette, ni cast, ni console, ni
> droits d'image. Il peut donc avancer pendant que les portes R1, R2 et R3 attendent leurs constats
> physiques.
>
> ⚠ **Ce brief ne propose pas de code avant décision.** Deux des trois critères ne sont pas des
> problèmes d'interface : ce sont des règles de jeu et une hiérarchie d'outils, et elles
> appartiennent au mainteneur. Coder d'abord reviendrait à trancher en silence.

---

## 1. Ce qui est déjà acquis, et qu'il ne faut pas refaire

Deux tranches de la phase R0 ont déjà mordu sur ce périmètre. Les redemander gaspillerait le
chantier.

| Acquis | Livré par | Ce qui existe |
|---|---|---|
| Retour sur destination refusée | R0-02 | `MoveZoneLayer.showDestinationFeedback`, 650 ms, croix rose `#f43f5e` pour un refus et ambre `#f59e0b` pour une case occupée. Aucun élément DOM permanent. |
| Barre d'onglets accessible | R0-04 | `role="tablist"`, `role="tab"`, `aria-selected`, `aria-controls`, `tabindex` glissant, flèches gauche/droite, Début/Fin, focus visible, aucun débordement horizontal à 1280 et 1024 px. |

⛔ **Ne pas retoucher la barre d'onglets pour l'accessibilité** : elle est conforme. Ce qui reste
est **à l'intérieur** des panneaux, où rien n'a été fait.

---

## 2. T-01 — les cases occupées (R4-03)

### Ce que le code fait aujourd'hui, vérifié et non supposé

`computeReachable` (`js/movement/reachable.js`) ne connaît **pas** les pions. Sa signature n'en
reçoit aucun : elle pondère les arêtes bloquées, le coût de terrain et le budget, et rien d'autre.
**L'occupation n'est modélisée nulle part dans le mouvement.**

Conséquence directe, en deux temps qui se contredisent :

1. `MoveZoneLayer.render` peint **toutes** les cases atteignables d'un même aplat — même couleur,
   même alpha 0,3 — donc les cases occupées avec les autres. **La zone promet.**
2. `bootstrap.js:192` refuse le tap sur une case exactement occupée par un autre pion, appelle
   `onDestinationRejected(cell, 'occupied')`… **et la zone n'avait rien dit.**

C'est exactement le libellé du critère : une destination occupée est présentée comme atteignable.

### ⭐ Un second défaut trouvé au passage, et il est plus gênant que le premier

`bootstrap.js:195`, `:236` et `:243` font tous suivre le refus d'un `store.selectToken(null)`.
**Un tap mal visé ne coûte pas seulement le déplacement : il coûte la sélection.** Il faut
re-désigner le pion avant de réessayer.

Ce n'est pas cohérent avec le chantier O, qui a précisément ajouté une tolérance de désignation de
24 px parce que viser au doigt est difficile. On a rendu la désignation tolérante, et on punit
l'erreur de destination en la supprimant.

⚠ À ne pas confondre avec un cas où la désélection est **voulue** : taper hors zone pour « lâcher »
son pion est un geste légitime. La question est de distinguer *renoncer* de *se tromper*, et elle
n'est pas tranchée aujourd'hui.

### ⛔ Décision n°1 requise avant toute ligne de code : quelle est la règle ?

« Expliquer la règle appliquée » suppose qu'une règle existe. Il n'y en a pas. Trois modèles
possibles, et ils ne coûtent pas la même chose :

| Modèle | Comportement | Coût technique |
|---|---|---|
| **A. Traversable, non posable** | Le chemin passe à travers les pions ; seule l'arrivée est refusée. C'est le comportement actuel, simplement rendu visible. | Faible — l'aplat de la zone se différencie, Dijkstra ne bouge pas |
| **B. Bloquante** | Un pion bloque le passage comme un mur. | Moyen — `computeReachable` reçoit les occupations, **les distances changent**, et le contournement devient possible |
| **C. Alliés traversables, autres bloquants** | Distinction par `kind` / camp. | Le plus élevé — exige une notion de camp que le modèle ne porte pas aujourd'hui |

⚠ **B et C changent les distances**, donc la forme de la zone de mouvement, donc ce que la table a
appris à lire depuis le lot 1a. Ce n'est pas un raffinement visuel, c'est un changement de règle de
jeu. **A est le seul modèle qui décrit ce qui se joue déjà.**

### Décision n°2 : un tap mal visé doit-il désélectionner ?

Trois options, à trancher pour les trois cas de refus, pas seulement pour l'occupation :

- garder la sélection sur toute destination refusée, la désélection restant un tap hors zone ;
- garder la sélection sur `'occupied'` seulement, où l'intention de déplacer est manifeste ;
- ne rien changer.

### Critère de sortie T-01

- Une case occupée se distingue **avant** le geste, dans la zone de mouvement, sans nouvel élément
  DOM (zéro-UI, `CONVENTIONS.md` §8).
- La distinction survit au cast : elle ne peut reposer sur une nuance de teinte fine ni sur un
  contraste inférieur à celui déjà retenu pour les marqueurs.
- Le comportement du tap et celui de la zone disent **la même chose**. C'est le vrai critère : le
  défaut n'est pas qu'une case soit refusée, c'est que deux parties du code se contredisent.
- Un test navigateur couvre la contradiction : sonde de pixels sur la case occupée, puis tap, puis
  vérification que le refus correspond à ce que la zone annonçait.

---

## 3. T-02 — regrouper les outils MJ (R4-04)

### État constaté

**Dix onglets à plat**, et non neuf comme l'annoncent encore certains documents — `↕ Liaisons` a été
ajouté par le lot 3 :

`📂 Cartes` · `UVTT` · `Image` · `Pions` · `Handouts` · `🌫️ Fog` · `🧱 Murs` · `↕ Liaisons` ·
`📐 Gabarits` · `Grille`

Le sélecteur d'étage est **hors** des onglets, délibérément : changer d'étage est une action de
séance, faite depuis n'importe quel outil (`panel.js:90`). ⛔ Ce choix ne se rediscute pas ici.

### ⚠ Le regroupement proposé par la feuille de route ne tombe pas juste

Les cinq familles annoncées — contenu, terrain, visibilité, effets, réglages — se répartissent
très mal :

| Famille | Onglets | Compte |
|---|---|---|
| Contenu | Cartes, UVTT, Image, Pions, Handouts | 5 |
| Terrain | Murs, Liaisons | 2 |
| Visibilité | Fog | **1** |
| Effets | Gabarits | **1** |
| Réglages | Grille | **1** |

**Trois familles sur cinq n'auraient qu'un seul membre.** Une navigation à deux niveaux dont trois
branches ne contiennent qu'une feuille ajoute un clic sans rien regrouper : c'est strictement pire
que la liste plate d'aujourd'hui.

### ⛔ Décision n°3 : quelle forme, et sur quel constat ?

Trois formes possibles, et je recommande la troisième :

- **A — deux niveaux à cinq familles.** Fidèle au libellé, mais souffre du défaut ci-dessus.
- **B — deux familles seulement.** « Préparer » (Cartes, UVTT, Image, Pions, Handouts, Grille) et
  « Jouer » (Fog, Murs, Liaisons, Gabarits). Le partage suit ce que la feuille de séance montre :
  la préparation se fait avant, les quatre autres pendant la partie.
- **C — ne pas hiérarchiser, ordonner.** Garder dix onglets, mais les ranger par moment d'usage et
  séparer visuellement les deux blocs. Zéro clic ajouté, zéro état de navigation nouveau.

⚠ **Et une question qui doit précéder les trois** : quels onglets sont réellement ouverts en cours
de partie, et lesquels ne servent qu'avant ? Personne ne l'a mesuré. Réorganiser sur une intuition
d'usage, c'est déplacer le problème d'un cran — et ce projet a déjà payé cette leçon avec la
décision n°2 du §12, tranchée sans mesure.

**Le constat manquant est bon marché** : il tient dans la prochaine séance, à noter à la main.

### Critère de sortie T-02

- Un outil se retrouve sans parcourir toute la barre.
- L'état d'onglet actif reste **unique et centralisé** : le désarmement de l'outil actif à chaque
  changement d'onglet (`panel.js:366`, correctif du 4 août) ne doit pas être contourné par un second
  niveau de navigation. ⚠ C'est le vrai risque de régression de cette tranche.
- Les rôles ARIA restent valides : un `tablist` imbriqué a des règles propres, et un regroupement
  bâclé casserait l'accessibilité acquise par R0-04.

---

## 4. T-03 — accessibilité des contrôles hors canvas (R4-05)

### Périmètre réel

R0-04 a traité **la barre**. Ce qui reste est le contenu des dix panneaux, soit environ 2 200 lignes
réparties sur dix modules (`panel.js` 1128, `tokenMaker.js` 525, `importPanel.js` 374,
`sceneLibrary.js` 283, `fogTools.js` 254, `wallEditor.js` 253, `tokenLibrary.js` 190,
`templateTools.js` 161, `handouts.js` 141, `linkEditor.js` 86).

À vérifier, dans cet ordre — du plus probablement fautif au moins :

1. **Étiquettes.** Tout champ a-t-il un `<label for>` ou un `aria-label` ? Un placeholder n'est pas
   une étiquette.
2. **Focus visible.** Chaque contrôle atteignable au clavier montre-t-il où il est ?
3. **Ordre de tabulation.** Suit-il l'ordre visuel après un changement d'onglet ?
4. **Contrastes.** Les libellés secondaires et les états désactivés atteignent-ils 4,5:1 ?
5. **Annonce des changements.** Un import qui échoue, un avertissement de taille, un état d'outil
   armé : sont-ils perceptibles autrement que par la couleur ?

### Ce qui est hors périmètre, et pourquoi

⛔ **La vue joueurs ne fait pas partie de ce chantier.** Elle est en zéro-UI par décision : y ajouter
des libellés, des rôles ou un ordre de tabulation reviendrait à créer l'interface que
`CONVENTIONS.md` §8 interdit. L'accessibilité de la table passe par la lisibilité au canvas —
taille, contraste, distinction de forme — et c'est traité ailleurs, marqueur par marqueur.

### Critère de sortie T-03

- Les points 1 à 5 sont vérifiés sur les dix panneaux, et **ce qui est corrigé porte un test**.
- ⚠ Un audit qui ne produit qu'une liste ne ferme rien : la leçon du bouton « Copier l'entrée
  JSON » est qu'un contrôle sans test cesse de fonctionner en silence. Un critère d'accessibilité
  sans test se dégradera de la même façon.

---

## 5. Ordre d'exécution proposé

1. **T-01**, après les décisions n°1 et n°2. C'est celui qui se voit à la table, et le seul qui
   corrige une contradiction du code plutôt qu'un inconfort.
2. **T-03**, qui ne dépend d'aucune décision et peut avancer par panneau.
3. **T-02** en dernier, et seulement après le constat d'usage de la prochaine séance.

⚠ **T-02 avant T-01 serait le mauvais ordre** : réorganiser des onglets ne change rien à la partie,
alors qu'une zone de mouvement qui ment se paie à chaque tour.

---

## 6. Les trois décisions — tranchées par le mainteneur le 08/08/2026

| N° | Question | Décision |
|---|---|---|
| 1 | Un pion est-il traversable, bloquant, ou selon son camp ? | **A — traversable, non posable** |
| 2 | Un tap mal visé désélectionne-t-il ? | **Non — la sélection est gardée sur tout refus** |
| 3 | Deux niveaux, deux familles, ou réordonnancement ? | **Ajourné — constat d'usage d'abord** |

### Ce que chaque décision engage

**n°1 — traversable, non posable.** Le modèle décrit ce qui se joue déjà : `computeReachable` n'est
**pas** modifié, les distances ne bougent pas, et la table relit la même zone de mouvement qu'avant.
Le travail est donc entièrement dans la **différenciation visuelle** de la case occupée et dans la
cohérence entre ce que la zone annonce et ce que le tap fait. ⛔ Ne pas en profiter pour ajouter une
occupation à Dijkstra « tant qu'on y est » : ce serait le modèle B, qui a été écarté.

**n°2 — garder la sélection.** Les trois `store.selectToken(null)` de `bootstrap.js` (lignes 195,
236 et 243) disparaissent. ⚠ **Le geste de renoncement doit rester possible et il faut le vérifier**,
sinon on remplace un défaut par un autre : taper hors de la zone de mouvement reste la façon de
lâcher son pion, et ce chemin ne passe pas par ces trois lignes. Un test doit couvrir les deux
faces — l'erreur ne désélectionne plus, le renoncement désélectionne toujours.

**n°3 — ajourné, et ce n'est pas un report mou.** Le relevé est ajouté à la phase 5 de
`SEANCE-TABLETTE.md` : une croix par ouverture d'onglet en cours de partie. Le partage tombera du
constat au lieu d'être deviné. T-02 ne démarre pas avant.

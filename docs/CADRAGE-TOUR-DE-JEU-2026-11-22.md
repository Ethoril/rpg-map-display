# Tour de jeu, portes et liaisons côté joueurs — spécification

Chantier arbitré le 22/11/2026 par le mainteneur (sept sélecteurs, traces dans
`QUESTIONS-EN-ATTENTE.md` section TJ). Il porte sur la **vue joueurs** ; la vue MJ ne change
que là où c'est dit.

Ce document dit le **quoi**. Le comment est dans `PLAN-TOUR-DE-JEU-2026-11-22.md`.

---

## 1. Prendre une liaison par un bouton

Aujourd'hui : on amène le pion sur l'escalier, un libellé flotte au-dessus de lui, et on
**retape sa case** pour franchir. Le geste est invisible pour qui ne l'a pas appris.

⛔ Le franchissement automatique en fin de mouvement est **écarté** : une case d'escalier est
aussi une case marchable — on s'y poste, on la traverse, on y finit un tour faute de cases —
et basculer d'étage sans l'avoir demandé est exactement ce que la règle 4 du projet interdit.

- **CA1** — Un PJ déplaçable, **aucun pion sélectionné** (voir CA11), posé sur une extrémité de
  liaison franchissable par les joueurs : un **bouton** apparaît près de lui, au-dessus du
  brouillard, libellé selon le type de liaison (« Monter », « Descendre »…).
- **CA2** — L'appui sur ce bouton franchit la liaison : même effet qu'aujourd'hui (pion placé à
  l'autre extrémité, étage du pion changé, l'écran de la table **ne bascule pas** d'étage).
- **CA3** — Retaper la case du pion ne franchit plus rien.
- **CA4** — Pion monté : **aucun bouton**. La mention « Descendre de cheval » (ou « Demander au
  MJ de vous faire descendre de cheval » pour un pion lié) reste affichée comme aujourd'hui,
  non tapable.
- **CA5** — Vue MJ : inchangée (le MJ franchit comme aujourd'hui).

## 2. Ouvrir une porte par un bouton d'adjacence

Aujourd'hui, côté joueurs, on touche la porte elle-même : une cible fine, sur un segment, en
concurrence de distance avec les pions voisins.

- **CA6** — Tout PJ **déplaçable** adjacent à une porte ouvrable (`open` ou `closed`) fait
  apparaître un bouton « Ouvrir » / « Fermer », posé **de l'autre côté de la porte par rapport à
  lui**.
- **CA7** — Deux PJ de part et d'autre de la même porte : **un seul** bouton, légèrement déporté.
- **CA8** — Le bouton se dessine **au-dessus du brouillard** : une porte dont l'autre côté n'est
  pas exploré porte quand même son bouton.
- **CA9** — Porte `locked` : **aucun bouton**. L'indicateur d'état de la porte dit déjà qu'elle
  est verrouillée.
- **CA10** — Session liée à l'outil MJ avec un tour actif : seul le bouton du **PJ actif** est
  fonctionnel ; les boutons des autres PJ sont **grisés** et sans effet.
- **CA11** — Dès qu'un pion est **sélectionné** — donc pendant toute préparation de trajet — et
  pendant une animation de déplacement, **aucun** bouton de porte ni de liaison n'est affiché ni
  tapable. ⭐ Arbitré le 22/11/2026 à la relecture : le seuil est la **sélection**, pas la première
  étape posée. Raison : le bouton de porte occupe une case voisine, souvent atteignable ; sélection
  active, il volerait le tap de destination juste derrière la porte ouverte. Conséquence à la
  table : on ouvre une porte sans rien de sélectionné, et après être descendu de cheval (qui exige
  la sélection) il faut taper ailleurs avant que le bouton d'escalier n'apparaisse.
- **CA12** — Toucher la porte elle-même n'ouvre plus rien côté joueurs : le tap retombe sur le
  comportement normal de la case visée.
- **CA13** — Vue MJ : inchangée (le MJ continue de toucher la porte).

## 3. Le tour de jeu bride le mouvement et se souvient des cases parcourues

L'outil MJ annonce déjà le participant actif (`mj.turn { ref }`, contrat §10), mais la carte ne
s'en sert que pour un halo sur l'écran MJ.

- **CA14** — Session liée avec un tour actif : depuis la tablette, **seul le pion du participant
  actif** se sélectionne et se déplace.
- **CA15** — Un autre PJ touché s'ouvre en **consultation** (encart lecture seule, idiome déjà en
  place pour un PJ bridé) : rien de publié, aucune préparation.
- **CA16** — Liaison déconnectée, ou connectée sans tour actif (`ref` à `null`) : comportement
  d'aujourd'hui, tout PJ déplaçable bouge. ⚠ Trou résiduel accepté : le tour d'un ennemi non posé
  sur la carte n'empêche rien.
- **CA17** — Un PJ **non lié** à l'outil MJ n'est jamais bridé par le tour.
- **CA18** — La zone disponible du PJ actif tient compte des cases déjà parcourues **dans son
  tour** : après un déplacement de *n* cases, elle vaut `budget − n`, et le palier de Marche
  recule d'autant (la Course commence après `Marche − n`).
- **CA19** — Le compteur repart de zéro **à chaque changement** de participant actif. Un
  instantané qui réannonce le **même** participant ne le remet pas à zéro.
- **CA20** — Le **glisser libre du MJ** ne consomme rien : il repositionne sans toucher au
  compteur. Seul un déplacement validé depuis une préparation consomme — tablette ou écran MJ.
- **CA21** — Budget épuisé : aucune destination acceptée, mais les boutons de porte et de liaison
  restent fonctionnels (ouvrir une porte ou monter un escalier ne coûte pas de mouvement).

- **CA28** — La couronne de Bond (Charge, Saut, Sprint) recule des cases déjà parcourues : elle
  démarre au budget réduit et disparaît quand le mouvement est entièrement consommé. ⭐ Ajouté le
  22/11/2026 à la relecture (`TJ-9`) : l'anneau partait du budget entier alors que la zone
  s'arrêtait à `budget − n`.

## 4. Annuler le mouvement du tour

- **CA22** — Session liée, tour actif, au moins un déplacement validé dans le tour : un bouton
  apparaît **en haut à droite** de la vue joueurs, à gauche des boutons déjà présents.
- **CA23** — Son appui replace le pion sur la **case et l'étage** qu'il occupait au début du tour
  et rend **tout** le mouvement : la zone redevient celle du début de tour.
- **CA24** — Le MJ voit le pion revenir : l'annulation passe par le réseau, rien ne bouge en
  douce.
- **CA25** — Le bouton disparaît après l'annulation, et à tout changement de participant actif.
- **CA26** — Le brouillard exploré **ne régresse pas** (il est cumulatif, invariant du projet) ;
  une porte ouverte pendant le tour **reste ouverte**.
- **CA27** — Hors session liée, ou hors du tour du PJ, le bouton n'existe pas.

---

## Hors périmètre

- **L'outil MJ n'est pas prévenu de l'annulation.** Si le PJ avait couru, son Action du Tour
  reste cochée dans l'outil MJ ; le MJ la rend à la main. Un message carte → outil MJ serait un
  amendement du **contrat dans les deux dépôts** : à décider séparément.
- Aucun compteur d'Action, de réaction ou d'initiative sur la carte.
- Rien de persisté : le tour actif et le compteur meurent avec la session, comme `mj.turn`
  aujourd'hui.
- Aucun changement au protocole outil MJ → carte : `mj.turn` est utilisé tel qu'il existe.
- Pas de bouton d'annulation hors session liée (voir CA27) : un second mécanisme, à demander si
  le besoin apparaît.

# Chantier X — Le ping

> Livré le 12 août 2026. Ferme le critère « **Un ping est visible sur les trois postes en < 500 ms** »
> du lot 4 (CdC §11), et amende le §5.5 qui le décrivait.

## 1. Ce que le mainteneur a corrigé dans la conception, et pourquoi il avait raison

Le CdC décrivait le ping comme « **deux doigts tap**, marqueur animé ~2 s, visible de tous ». Le
chantier partait donc sur un geste tactile multi-touch. Le mainteneur l'a arrêté net :

> « il n'y a pas de besoin côté joueur, donc pas de besoin côté tactile. En effet ils n'ont qu'à
> zoomer sur la tablette pour que le MJ voie très bien de quoi ils parlent »

C'est juste, et ça **supprime la pièce risquée du chantier**. Le ping ne sert que dans le sens
MJ → table ; or le poste MJ est toujours clavier-souris. `js/input/pointer.js` n'est donc **pas
touché** — le fichier où l'appui long et le glisser se disputent déjà le doigt, et où la marge
mesurée le 11/08 n'est que de 10,8 ms entre le p95 d'un tap réel (139,2 ms) et `DRAG_HOLD_MS`.

⭐ **L'affichage, lui, reste sur les trois postes.** Seule l'émission est réservée au MJ. Le critère
du lot 4 est donc inchangé, et c'est bien tout l'objet du geste : le MJ pointe pour que les joueurs
regardent là.

## 2. Bouton armé plutôt que double-clic

Le mainteneur proposait le double-clic, ou un bouton d'armement « si ça permet de borner plus
facilement ». Le bouton n'est pas seulement plus facile, il est **meilleur**.

Sur la vue MJ, un clic a déjà des effets : sélectionner un pion, désigner une destination. Un
double-clic les déclencherait au premier clic, ou imposerait de **retarder chaque clic simple** de
la fenêtre de double-clic pour lever l'ambiguïté — soit ~250 ms ajoutés à toute l'interface MJ pour
un geste occasionnel. C'est un recul de sensation permanent contre un confort ponctuel.

Le bouton armé n'a aucun de ces défauts et **hérite gratuitement** de mécanismes déjà éprouvés :
l'exclusivité mutuelle des outils MJ et le désarmement au changement d'onglet, tous deux couverts
par `gmToolDisarmGeste`. Le ping n'a donc **aucun module à lui** : son seul état est l'armement,
porté par `setActiveTool('ping')`.

Il vit **hors des onglets**, comme la barre d'étage et pour la même raison écrite là-bas : pointer
un endroit se fait en cours de jeu, depuis n'importe quel outil. L'enfouir dans un onglet
obligerait le MJ à quitter son pinceau, et le désarmement automatique le lui reprendrait aussitôt.

## 3. ⛔ La décision de conception : l'horodatage est local

C'est le cœur du chantier, et elle est **contre-intuitive**.

Le réflexe était de copier l'animation des pions, qui dérive tout de `move.startedAt` + `now` et se
trouve juste à côté dans le même dossier. **Appliqué au ping, c'est un défaut.** `startedAt` est
estampillé avec le `Date.now()` de l'émetteur (`store.js`, `moveTokenToCell`), et la tablette de ce
projet a été mesurée **5,3 s en avance** — l'écart d'horloge est la donnée qui a coûté le plus cher
à ce projet, invisible à deux campagnes de mesure.

Un ping de 2 s jugé sur cette horloge étrangère serait **déjà expiré en arrivant** : l'âge calculé
serait négatif, la couche ne dessinerait rien, et le geste échouerait **en silence sur le seul écran
qui compte**.

Chaque poste **réhorodate donc à la réception** : `at: Date.now()` local, jamais `event.at`.
L'horodatage voyage toujours dans l'événement, mais uniquement pour l'ordonnancement du canal.

⭐ **Pourquoi c'est licite ici et pas pour un pion.** Un pion a besoin de déterminisme entre postes :
un client qui rejoint doit le voir au bon endroit. Un ping n'a **aucun état persistant à
reconstituer** — c'est un geste, pas une donnée. Chacun peut donc l'afficher 2 s depuis sa propre
réception sans que la différence soit observable. La conception la plus simple est ici la plus
juste, ce qui est assez rare pour être écrit.

## 4. Ce que le ping n'est pas

- **Pas un état de campagne.** Il ne va ni dans le store, ni dans le snapshot, ni dans la
  persistance. Il vit en variable locale de la vue, exactement comme `lockedPortalFlash` et le
  retour de destination de `moveZone.js` — deux précédents d'horodatage local qui existaient déjà.
- **Pas rejoué.** Un joueur qui rejoint la séance ne doit surtout pas voir ressurgir un vieux ping.
  L'événement est intercepté **avant** `applyNetworkEvent`, comme `view.change`.
- **Pas un mode.** Le ping se désarme après une seule pose : rester armé ferait pointer au clic
  suivant, presque toujours destiné à autre chose.

## 5. Au-dessus du fog, délibérément

`'pings'` est le **dernier** de `CANVAS_LAYER_ORDER`, après `'fog'` et `'feedback'`. Un marqueur
« regarde ici » masqué par le brouillard serait invisible sans que le MJ sache pourquoi, et il
pointerait dans le vide.

⚠ **Ce n'est pas une fuite d'information**, et la distinction mérite d'être écrite dans un projet
aussi attentif aux fuites : le MJ désigne cet endroit **exprès**. Une fuite est ce qui échappe ; un
acte explicite du MJ est le contraire.

## 6. Un défaut latent trouvé et corrigé en passant

**Le test de l'exclusivité mutuelle a échoué au premier essai, et il avait raison.**

`setActiveTool` désarme l'outil précédent, ce qui déclenche son rappel `onArmChange(false)`, qui
rappelle `setActiveTool('none')` — **en pleine exécution du premier appel**. Le désarmement de
l'ancien outil **écrasait donc celui qu'on venait d'armer** : `setActiveTool('ping')` finissait à
`'none'`.

Le défaut **préexistait au ping** et n'avait jamais mordu par chance d'ordonnancement : chaque outil
existant s'arme depuis son propre `onArmChange(true)`, donc le `setActiveTool` du nouveau survient
*après* le désarmement de l'ancien. Un appelant direct — ce bouton — tombe dessus immédiatement.

Corrigé par une garde de réentrance qui ignore un `'none'` **imbriqué** : c'est la seule valeur que
les rappels de désarmement émettent, donc la garde ne peut pas masquer une transition légitime.

## 7. Couverture, et ce qu'elle ne couvre pas

`tests/pings.test.mjs` — 10 tests unitaires : bornes exactes de la fenêtre, ping d'un autre étage
ignoré, grandeurs en pixels écran divisées par le zoom, état du contexte rendu intact, et
l'incohérence d'horloge qui ne dessine rien plutôt qu'une progression hors bornes.

`tests/ping.spec.mjs` — 4 scénarios navigateur, dont **le budget de 500 ms** mesuré par une sonde de
teinte *dans la page* (un `poll` depuis Playwright coûterait des dizaines de millisecondes et
polluerait une mesure dont le budget est de 500), et **l'immunité à un décalage d'horloge de 5,3 s**
injecté sur la page MJ.

⭐ **Preuve par mutation, et c'est elle qui donne sa valeur au scénario du décalage.** Remplacer
`Date.now()` par `event.at` côté joueurs fait rougir **exactement un** test — celui du décalage. Les
trois autres **passent** sous la mutation : sans écart d'horloge le défaut est invisible. Il ne se
serait manifesté qu'à la table, sur la tablette, sous la forme d'un ping qui n'apparaît jamais.
Retirer la garde d'âge négatif de la couche fait rougir exactement le test unitaire correspondant.

⛔ **Ce que la porte ne prouve pas.** Les deux pages tournent dans le même navigateur sur la même
machine, donc sur un transport local et une horloge unique. Le délai mesuré est le coût du **code**,
pas celui du réseau. Les 500 ms réels ne se constatent qu'à la table, entre le Mac et la tablette,
et c'est `tests/mesures/latenceAllerRetour.spec.mjs` qui mesure ce trajet — délibérément hors porte,
parce qu'une mesure dépend de la machine qui l'exécute (voir `ETAT.md`, « Vérifications de
référence »).

## 8. Ce qui reste à constater à la table

- Que le marqueur soit **visible sous cast**, sur le téléviseur, à la taille « carte entière ». Le
  jaune `#facc15` n'est employé par aucune autre couche, mais aucune mesure ne remplace un œil.
- Que 2 s soit la bonne durée : assez pour être vu, assez court pour ne pas gêner.
- Que le geste en deux temps — armer, cliquer — ne soit pas ressenti comme un détour en pleine
  partie. Si c'est le cas, le repli est le raccourci clavier, pas le double-clic.

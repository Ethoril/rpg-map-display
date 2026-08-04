# PROTOCOLE — séance de mesure sur la Tab S9 FE

> Écrit le 4 août 2026 pour la séance du 5. Rassemble les mesures dispersées dans
> `ETAT.md` § « Ce qui reste à vérifier manuellement » **dans un ordre exécutable**, parce que
> trois d'entre elles en conditionnent d'autres et qu'une séance mal ordonnée se refait.
>
> **À lire d'une main.** Une ligne = une action. Chaque point porte son critère et ce qu'il faut
> noter. Noter les chiffres, pas les impressions : un « ça a l'air fluide » ne ferme aucun critère.
>
> ⚠ **Aucun de ces points ne se coche depuis un poste de bureau** (interdiction n°14). Et un point
> qui échoue n'est pas un échec de séance : c'est le seul moyen de le savoir.

---

## Pourquoi cet ordre, en trois phrases

1. **La largeur du viewport conditionne le critère 11**, et elle est aujourd'hui *déduite du CdC,
   pas mesurée* (`TRANCHE-L05-PORTES.md` §1.4). Tous les chiffres de tapabilité lui sont
   proportionnels : la mesurer d'abord, ou refaire les conclusions ensuite.
2. **La grosse carte passe avant le jeu réel.** Si `testbig150` ne tient pas à 8192 px, le pas
   suivant est de redescendre `MAX_PREPARED_TEXTURE_PX` — et tout ce qui aurait été mesuré sur elle
   serait à refaire.
3. **La tenue thermique n'est pas une étape, c'est un arrière-plan.** Elle court *pendant* le reste.
   La traiter comme une étape ajoute 45 minutes d'attente à la séance.

---

## Phase 0 — Avant de prendre la tablette (poste de bureau, 3 min)

**0.1 — La règle RTDB porte-t-elle sur `$sessionId` ?**
Console Firebase → Realtime Database → Règles. La condition doit être sur `$sessionId`, **pas sur
`events` seul**.

> Les règles RTDB ne se propagent pas latéralement : posée sur `events`, la condition laisse
> `session/{code}/presence/{clientId}` **sans aucune règle, donc refusé**. La présence échoue alors
> en `PERMISSION_DENIED`, et la détection d'écart de version **ne se déclenche jamais** —
> `checkBuildMismatch` parcourant une liste vide. Tout ce qui suit avec deux clients serait
> silencieusement faux.

☐ Condition sur `$sessionId` — sinon corriger **avant** de continuer. Règle exacte : `ETAT.md`,
section Firebase.

---

## Phase 1 — `diag.html`, dans l'ordre (tablette, ~10 min)

Ouvrir `diag.html` sur la tablette. Les boutons sont numérotés et **l'ordre compte** : le 1 établit
l'environnement dont les suivants dépendent.

**1.1 — Bouton 1, « Environnement & limites GPU »**

☐ Noter **la largeur du viewport CSS** — c'est la mesure qui manque, et elle conditionne le point 5.3.
☐ Noter **la limite de texture réelle**. Attendu 8192 ; c'est la limite *mesurée* de la dalle, donc
   **sans marge**.
☐ Noter le `devicePixelRatio`.

**1.2 — Bouton 3, « Images par seconde (20 s) »** — hors cast, carte légère.

☐ Noter le chiffre. C'est **la référence** : tout ce qui sera mesuré sous cast ou sur grosse carte
   s'y compare. Sans elle, une baisse n'est attribuable à rien. Relevé antérieur sur cette dalle :
   60 fps.

**1.3 — Bouton 4, « Tenue thermique (5 min) »**

☐ Noter la dérive. Ce n'est **pas** la mesure des 45 minutes — c'est un premier signal, à 5 min.

**1.4 — Bouton 6bis, « Sweep sur les cartes publiées »**

☐ Noter le coût. C'est **la moitié quantitative du critère 10** : le budget de 300 ms pour qu'une
   porte ouverte étende la vision des deux côtés. L'autre moitié est perceptuelle, au point 4.4.

---

## Phase 2 — Les trois gestes, tout de suite (2 min)

Ils coûtent dix secondes chacun et **conditionnent le confort de tout le reste** : si le
déplacement de la carte accroche, les phases suivantes sont pénibles pour une mauvaise raison.

**2.1 — Le geste corrigé aujourd'hui, vue joueurs**
Toucher la carte, **attendre une demi-seconde**, puis glisser.

☐ La carte doit suivre le doigt. *Avant le correctif du 4 août, elle ne bougeait pas du tout.*

**2.2 — Le geste corrigé aujourd'hui, appui long sur une porte**
Presser une porte, attendre une demi-seconde, **relever le doigt**.

☐ Elle doit se verrouiller **au relèvement**. C'est le seul changement de ressenti : le verrou
   tombait auparavant à 500 ms, doigt encore posé.
☐ Cette latence est-elle acceptable au toucher ? **C'est un jugement, et il t'appartient** — le
   mécanisme est vérifié en machine, pas la sensation.

**2.3 — Le déplacement tap-tap, vue joueurs**
Tap sur un pion, tap sur une destination.

☐ Le pion part. **Faire un essai avec un tap volontairement mou**, plus lent que d'habitude.
   ⚠ **S'il ne se passe rien, ce n'est pas le correctif d'aujourd'hui** : c'est la zone morte
   **préexistante** entre 150 ms (`DRAG_HOLD_MS`) et 500 ms (`longPressMs`), où un appui immobile ne
   produit ni `tap` ni `longPress`. Consignée au §7 A7 de `CORRECTIF-APPUI-LONG.md`. **Noter si tu
   la rencontres en jouant normalement** — c'est ce qui décidera de l'arbitrage.

**2.4 — Plein écran et Wake Lock**
Taper le bouton de plein écran (44 × 44 px, en haut à droite, opacité 0,4).

☐ Le plein écran s'active.
☐ **Noter l'heure.** L'écran ne doit pas s'éteindre de toute la séance : c'est la vérification du
   Wake Lock, et elle se fait par l'absence d'événement, donc en durée.

---

## Phase 3 — La grosse carte, avant le jeu réel (~10 min)

Charger **`testbig150`** : 65 × 71 cases, 7499 × 8192 px, 1338 murs, 141 portes, 185 lumières,
13,7 Mio de WebP. **245 Mio décodés en RGBA** dans le navigateur.

**3.1 — Tient-elle ?**

☐ La carte s'affiche entièrement, sans onglet qui se recharge ni fond noir.
☐ Refaire **le bouton 3 de `diag.html`** sur cette carte et comparer à 1.2.
☐ Juger la **qualité du rééchantillonnage** au zoom d'ensemble puis au zoom de jeu : le texte de la
   carte reste-t-il lisible ?

> **Si elle ne tient pas, s'arrêter là sur cette carte.** Le pas suivant est de redescendre
> `MAX_PREPARED_TEXTURE_PX`, **pas de bricoler le rendu**. Et ne rien mesurer d'autre sur
> `testbig150` : les chiffres seraient à refaire.

`testbig150` est une carte de **mesure**, pas de campagne. La suite se fait sur `manoir-rdc`.

---

## Phase 4 — Le jeu réel sur `manoir-rdc` (~15 min)

C'est ici que se trouve **le point le plus concret de la liste**.

**4.1 — Le correctif du masquage des pions**
Vue joueurs, fog actif, **plusieurs pions dont au moins un hors vision courante** (donc masqué).

☐ Refaire le bouton 3 de `diag.html` et noter. **Critère : 30 fps tenus.**

> Ce point existe parce qu'un défaut y a été mesuré puis corrigé **sans mesure finale**. L'ancien
> masquage allouait par image un canvas aux dimensions de la carte entière — 6720 × 6300, soit
> 161 Mio de RGBA — à **542 ms par image, seize fois le budget de 33 ms**. Tu l'avais relevé en
> usage réel, avant tout test. Le correctif filtre les pions case par case et retombe à 0,44 ms de
> bureau. **Ce chiffre ne vaut pas validation** : c'est cette mesure-ci qui tranche.

**4.2 — Déplacement d'un pion, budget de 300 ms**
Tap pion → tap destination.

☐ L'affichage suit-il sans délai perceptible ? 300 ms ne se chronomètre pas à l'œil : si tu **vois**
   un retard, c'est un échec ; si ça paraît instantané, c'est un succès. En cas de doute, c'est un
   doute — le noter comme tel plutôt que de trancher.

**4.3 — Ouvrir une porte**

☐ La vision s'étend **des deux côtés**.
☐ Les arêtes de passage se rouvrent — le pion peut franchir la porte ouverte.
☐ Sans délai perceptible (même règle qu'en 4.2 ; la part chiffrée est au point 1.4).

**4.4 — Le fog en usage**

☐ L'intérieur d'un bâtiment non visité reste **opaque** tant qu'on n'y entre pas.
☐ Aucun pion n'apparaît en zone explorée mais hors vision courante (interdiction n°3 — c'est ce qui
   empêcherait de suivre les PNJ à travers les murs).

---

## Phase 5 — Sous cast (~15 min)

Le cast est un **miroir passif Google Cast**. Il a son propre coût : la référence hors cast des
points 1.2 et 4.1 est ce qui permet de le lui attribuer.

**5.1 — 30 fps sous cast**

☐ Bouton 3 de `diag.html`, sous cast, sur `manoir-rdc`. **Critère : 30 fps.**
☐ Noter l'écart avec 4.1.

**5.2 — Lisibilité du badge d'élévation**
Un pion avec une élévation non nulle (+N / −N).

☐ Le badge est-il **lisible sur le téléviseur**, pas sur la tablette. C'est le seul critère de cette
   liste qui se juge à distance de canapé.

**5.3 — Critère 11 : une porte est ouvrable au doigt**

☐ **À un zoom de jeu**, au plus une vingtaine de cases visibles en largeur. La bande tactile fait
   15 à 20 px CSS au zoom d'ensemble contre 44 px recommandés pour un doigt : **le critère est faux
   au zoom d'ensemble, et ce n'est pas contournable.** Vérifier avec la largeur de viewport relevée
   en 1.1, qui donne le nombre exact de cases.
☐ Une porte s'ouvre au doigt, du premier coup, sans viser.

> **Si l'essai échoue, le remède est un zoom minimum sur la vue joueurs**, pas une bande plus large :
> une bande tapable au zoom d'ensemble mesurerait plus de deux cases et rendrait le déplacement
> impossible près des portes.

---

## Phase 6 — La durée, en arrière-plan

Ne rien faire de plus : continuer à jouer.

☐ **À 45 minutes** — noter la température au toucher, et si l'affichage a ralenti.
☐ **À 4 heures** — même relevé. C'est la seule mesure de la liste qui ne peut pas être accélérée.
☐ L'écran ne s'est pas éteint (Wake Lock, depuis 2.4).
☐ Le plein écran a survécu — y compris après un geste système de la tablette.

---

## Phase 7 — Fin de séance

☐ **Purge** : la fin de séance nettoie-t-elle ce qu'elle doit, selon l'usage réel ?
☐ Badge réseau : `Firebase connecté` ou `Mode local` — et c'est bien celui attendu.

---

## Ce qui n'est PAS à faire demain

- **Le bouton « Mettre à jour » du bandeau de désynchronisation.** Le défaut qu'il corrige est
  **propre au cache de Safari iOS**, qui ressert les modules ES d'un `max-age` non expiré sans
  revalider. La Tab S9 FE est sous Chromium : elle ne le reproduira pas. ⚠ **Il y a donc une
  incohérence dans `ETAT.md`**, qui range ce point parmi les vérifications « sur la tablette » — soit
  un appareil iOS existe et il faut le nommer, soit le point est mal cadré. **À trancher, pas à
  tenter.**
- **La restriction de la clé d'API Google.** Confort, pas urgence, et rien à voir avec la tablette :
  sans compte de facturation aucun coût n'est possible, les quotas du plan gratuit étant des
  plafonds durs.
- **Le rapatriement du test de geste dans la porte.** Décision, pas mesure.
- **Le débordement horizontal du panneau des gabarits.** Défaut de la vue MJ, sur poste de bureau —
  et sans effet sur la justesse du hit-test.

---

## Après la séance

Reporter les chiffres dans `ETAT.md`, et **cocher un critère seulement s'il porte un nombre**. Un
critère de performance déclaré réussi sans mesure est précisément ce que l'interdiction n°14
proscrit — et ce document existe pour rendre ces mesures possibles, pas pour rendre les cases
faciles à cocher.

Trois critères du lot 2 sont en jeu, et **deux d'entre eux se ferment demain si les points 4.3, 5.3
et 1.4 passent** : le 10 et le 11. Le troisième, le critère 4 (marqueurs, L-09), attend une partie
jouée et non une mesure.

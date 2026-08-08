# PROTOCOLE — séance de mesure sur la Tab S9 FE

> Écrit le 4 août 2026 pour la séance du 5. **Refondu le 8 août 2026** : les mesures ouvertes par
> les phases R2 et R3 y sont intégrées, et ce document redevient **la seule feuille exécutable**.
> `PROTOCOLE-ENDURANCE.md` garde le détail de méthode de R2-03/05/06 et les limites de chaque
> mesure ; il ne dit plus dans quel ordre les faire. Les chiffres se reportent dans
> `RAPPORT-ENDURANCE.md`.
>
> **À lire d'une main.** Une ligne = une action. Chaque point porte son critère et ce qu'il faut
> noter. Noter les chiffres, pas les impressions : un « ça a l'air fluide » ne ferme aucun critère.
>
> ⚠ **Aucun de ces points ne se coche depuis un poste de bureau** (interdiction n°14). Et un point
> qui échoue n'est pas un échec de séance : c'est le seul moyen de le savoir.

---

## Ce que cette séance ferme, si elle va au bout

Sept critères ouverts, sur trois lots et deux portes. C'est ce qui justifie de ne pas la découper.

| Critère | Origine | Phase |
|---|---|---|
| Limite de texture réelle à 8192 px | Lot 1a | 3 |
| Tenue thermique sur la durée | Lot 1a | 2, 9 |
| R2-03 — décodage du fond après inactivité | Porte R2 | 4 |
| R2-05 — essai cast de 45 minutes | Porte R2 | 7 |
| R2-06 — session de quatre heures | Porte R2 | 9 |
| R3-05 — coût d'une mutation lumineuse | Porte R3 | 6 |
| R1-01 — rétention du canal sur deux vrais clients | Porte R1 | 8 |

---

## Pourquoi cet ordre, en quatre phrases

1. **La largeur du viewport conditionne le critère 11**, et tous les chiffres de tapabilité lui sont
   proportionnels : la mesurer d'abord, ou refaire les conclusions ensuite.
2. **La grosse carte passe avant le jeu réel.** Si `testbig150` ne tient pas à 8192 px, le pas
   suivant est de redescendre `MAX_PREPARED_TEXTURE_PX` — et tout ce qui aurait été mesuré sur elle
   serait à refaire.
3. **La tenue thermique n'est pas une étape, c'est un arrière-plan.** Elle court *pendant* le reste.
   La traiter comme une étape ajoute 45 minutes d'attente à la séance.
4. **Le silence de 120 s de la phase 4 est la seule étape qui exige de ne rien faire**, et la seule
   qu'un geste distrait annule. Elle est placée juste après le chargement de la grosse carte, au
   moment où l'on a de toute façon besoin d'une pause.

---

## Phase 0 — Avant de prendre la tablette (poste de bureau, 3 min)

**0.1 — Les règles RTDB portent-elles sur `$sessionId` ?**

☒ **Acquis depuis le 08/08/2026** : les règles versionnées du dépôt sont déployées, et
`database.rules.json` porte la condition sur `session/$sessionId`. Ce point n'est plus à corriger,
seulement à ne pas défaire.

> Il reste consigné parce que la raison compte : posée sur `events` seul, la condition laisserait
> `session/{code}/presence/{clientId}` **sans aucune règle, donc refusé**. La présence échouerait en
> `PERMISSION_DENIED`, `checkBuildMismatch` parcourrait une liste vide, et **tout ce qui suit avec
> deux clients serait silencieusement faux** — y compris la phase 8.

**0.2 — Le compte de la tablette est-il autorisé ?**

☐ La tablette se connecte-t-elle avec `ethoril@gmail.com` (e-mail vérifié) ou `et.horil@gmail.com` ?

⚠ **Nouveau depuis le 08/08 et c'est le seul effet de bord du déploiement** : ce sont les deux seuls
comptes autorisés. Un troisième compte Google sera refusé, et la séance s'arrêtera là.

**0.3 — Les deux clients portent-ils le même build ?**

☐ Comparer le numéro de build affiché côté MJ et côté tablette. Un écart fausse toute comparaison
   de chiffres entre les deux.

---

## Phase 1 — `diag.html`, dans l'ordre (tablette, ~10 min)

Ouvrir `diag.html` sur la tablette. Les boutons sont numérotés et **l'ordre compte** : le 1 établit
l'environnement dont les suivants dépendent.

**1.1 — Bouton 1, « Environnement & limites GPU »**

☐ Noter **la largeur du viewport CSS** — c'est la mesure qui manque, et elle conditionne le point 7.3.
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
   porte ouverte étende la vision des deux côtés. L'autre moitié est perceptuelle, au point 5.3.

---

## Phase 2 — Les trois gestes, et le départ de l'horloge (2 min)

Ils coûtent dix secondes chacun et **conditionnent le confort de tout le reste** : si le
déplacement de la carte accroche, les phases suivantes sont pénibles pour une mauvaise raison.

**2.1 — Glisser après une demi-seconde, vue joueurs**
Toucher la carte, **attendre une demi-seconde**, puis glisser.

☐ La carte doit suivre le doigt. *Avant le correctif du 4 août, elle ne bougeait pas du tout.*

**2.2 — Appui long sur une porte**
Presser une porte, attendre une demi-seconde, **relever le doigt**.

☐ Elle doit se verrouiller **au relèvement**.
☐ Cette latence est-elle acceptable au toucher ? **C'est un jugement, et il t'appartient.**

**2.3 — Le déplacement tap-tap, vue joueurs**
Tap sur un pion, tap sur une destination.

☐ Le pion part. **Faire un essai avec un tap volontairement mou**, plus lent que d'habitude.
   ✅ La zone morte de 150 à 500 ms est supprimée depuis R0-01 : un appui immobile dans cette
   fenêtre doit désormais produire un déplacement. **S'il ne se passe rien, c'est une régression**,
   et non le défaut connu — le noter comme telle.
☐ Une destination refusée ou occupée doit produire un **retour Canvas transitoire** (R0-02, 650 ms).
   Sa durée et son contraste rouge/ambre sont à juger ici : c'est le seul point d'observation prévu.

**2.4 — Plein écran, Wake Lock, et départ du journal**
Taper le bouton de plein écran (44 × 44 px, en haut à droite, opacité 0,4).

☐ Le plein écran s'active.
☐ **Noter l'heure.** L'écran ne doit pas s'éteindre de toute la séance : c'est la vérification du
   Wake Lock, et elle se fait par l'absence d'événement, donc en durée.
☐ `diag.html` → **« Démarrer le journal endurance »**, puis **« Ajouter le relevé manuel »** pour la
   ligne 0 min de `RAPPORT-ENDURANCE.md`.

⭐ **Tout ce qui suit court sur cette horloge.** Les phases 3 à 8 sont ce qu'on fait *pendant* les
45 premières minutes ; il n'y a pas d'attente dédiée avant la phase 9.

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
> `testbig150` : les chiffres seraient à refaire. Sauter directement à la phase 5.

`testbig150` est une carte de **mesure**, pas de campagne.

---

## Phase 4 — R2-03, le décodage du fond après inactivité (~5 min dont 2 de silence)

C'est la **lecture d'après** du chantier P. Le chantier N avait désigné la cause en la mesurant :
490 ms des 500 ms d'une frame post-inactivité étaient dans le seul `drawImage` du fond, résidu à
3 ms — donc ni GC ni compositing. P a répondu par une doublure 1024 px en `ImageBitmap` et un
décodage asynchrone. **Rien n'est validé tant que cette phase ne l'a pas constaté.**

**4.1 — La mesure instrumentée**

☐ `diag.html` → **« Armer le décodage froid (2 min) »**, en renseignant l'URL de l'image de
   référence. La chauffe initiale est volontaire.
☐ **Ne plus toucher l'écran ni le navigateur pendant au moins 120 s.** Ne pas ouvrir la sonde de
   rendu, ne pas lancer de mesure FPS, ne pas réveiller la tablette « juste pour voir ».
☐ **« Mesurer après inactivité »** : noter l'inactivité réellement constatée et la durée de
   `Image.decode()`.

⛔ **Un geste pendant le silence annule la mesure**, et pas de façon visible : il suffit à faire
vivre la page pour que le navigateur garde le bitmap. On mesurerait alors un cas chaud en croyant
mesurer un cas froid. Recommencer plutôt que d'interpréter.

**4.2 — La mesure réelle, qui est celle du critère**

☐ Ouvrir la vraie vue joueurs, `player.html?session=<id>&probe=1`, sur `testbig150`.
☐ Laisser la tablette tranquille **120 s** de plus.
☐ Faire **un** cran de zoom, puis toucher l'encart de la sonde pour l'actualiser.
☐ Lire la ligne dont l'**écart** dépasse 100 s, et noter la colonne **Fond**.
   **Critère : `< 5 ms`.** Relevé avant correctif : 490 ms.
☐ Noter aussi, à la main, si la tablette a saccadé. Le chiffre et la sensation doivent concorder.

> ⚠ La sonde est un **instantané** : elle ne se rafraîchit jamais toute seule, et c'est délibéré.
> Un encart qui se redessinerait chaque seconde ferait vivre la page pendant l'inactivité même
> qu'on mesure, et **ferait disparaître le symptôme**. Toucher l'encart n'affiche que des valeurs
> déjà enregistrées.
>
> Et le navigateur n'expose aucune API disant qu'il a évincé un bitmap : un chiffre bas ne prouve
> pas que l'image est restée chaude, un chiffre haut ne dit pas quelle ressource a été évincée.
> C'est une mesure post-inactivité reproductible, pas une télémétrie mémoire.

---

## Phase 5 — Le jeu réel sur `manoir-rdc` (~15 min)

**5.1 — Le correctif du masquage des pions**
Vue joueurs, fog actif, **plusieurs pions dont au moins un hors vision courante** (donc masqué).

☐ Refaire le bouton 3 de `diag.html` et noter. **Critère : 30 fps tenus.**

> Ce point existe parce qu'un défaut y a été mesuré puis corrigé **sans mesure finale**. L'ancien
> masquage allouait par image un canvas aux dimensions de la carte entière — 161 Mio de RGBA — à
> **542 ms par image, seize fois le budget de 33 ms**. Le correctif retombe à 0,44 ms de bureau.
> **Ce chiffre ne vaut pas validation** : c'est cette mesure-ci qui tranche.

**5.2 — Déplacement d'un pion, budget de 300 ms**

☐ L'affichage suit-il sans délai perceptible ? Si tu **vois** un retard, c'est un échec ; si ça
   paraît instantané, c'est un succès. En cas de doute, c'est un doute — le noter comme tel.

⭐ **Et si un retard apparaît, ne pas conclure « le réseau ».** Le 7 août, une « grosse latence » de
plusieurs secondes était une **horloge de tablette en avance de 5,3 s**, pas un réseau : le poste
MJ encaissait et repeignait en 23 ms. Le départage tient en une phrase — *une porte s'ouvre-t-elle
instantanément ?* Si oui, le canal est innocenté, et seul le déplacement, qui est le seul événement
porteur d'un horodatage d'animation, est en cause.

**5.3 — Ouvrir une porte**

☒ La vision s'étend **des deux côtés** — confirmation du mainteneur, 07/08/2026.
☒ Les arêtes de passage se rouvrent, le pion peut franchir — 07/08/2026.
☒ Sous le budget de 300 ms — 07/08/2026.

**5.4 — Le fog en usage**

☐ L'intérieur d'un bâtiment non visité reste **opaque** tant qu'on n'y entre pas.
☐ Aucun pion n'apparaît en zone explorée mais hors vision courante (interdiction n°3).

⚠ Si **aucun** pion n'apparaît alors que la zone de vision est bien dessinée, c'est le défaut du
7 août : un masque de fog mal dimensionné, relu depuis une autre carte. Il est corrigé, avec deux
barrières redondantes — mais c'est le symptôme à reconnaître, parce qu'il ne ressemble pas à sa
cause.

---

## Phase 6 — R3-05, le coût d'une mutation lumineuse (~10 min)

⭐ **Cette mesure se fait sur deux machines, et c'est le point que le brief avait mal cadré.** La
feuille de route demandait « le budget tablette » ; or **la vue joueurs ne calcule aucune vision** —
elle décode un masque PNG publié par le MJ. Le sweep est payé sur la machine qui porte la vue MJ.
Mesurer la lumière sur la tablette, c'est mesurer le mauvais monde.

Ce qui se constate se sépare donc en deux, et les deux comptent :

**6.1 — Le coût du calcul, sur le poste MJ**

Charger une carte avec des sources : `testbig150` en déclare 185. Placer un pion `emitsLight`.

☐ Vue MJ, presser **`P`** pour ouvrir la sonde (sur `gm.html` c'est la touche, pas `?probe=1`).
☐ Déplacer un pion **sans** `emitsLight` d'une case. Actualiser, noter la colonne **Vision**.
☐ Déplacer le pion **lumineux** d'une case. Actualiser, noter la colonne **Vision**.
☐ L'écart entre les deux est le coût propre de la lumière. Profil de bureau indicatif, six PJ, huit
   sources fixes et trois torches : **28 à 49 ms** pour 17 polygones. Ce n'est pas un verdict.

**6.2 — Ce que la table ressent, sur la tablette**

☐ Même geste, en regardant la tablette : la vision se met-elle à jour **sans délai perceptible** ?
☐ Sur la tablette, `?probe=1`, actualiser et noter **Fond**, **Fog** et **Pions** — c'est là que se
   paie la réception, pas dans une colonne Vision qui restera vide.

**Critère retenu :** le geste reste dans le budget de 300 ms de bout en bout, et le calcul MJ ne
dépasse pas le budget d'une image sur la machine qui l'exécute réellement en séance.

> ⚠ Si 6.1 dérape, le remède est **déjà écrit et il ne faut pas improviser** : indexer les segments
> par case pour ne tester que celles qu'un rayon traverse. Le polygone produit doit rester
> rigoureusement identique, ce qui rend la piste sûre et testable. ⛔ **Ne pas partir sur un
> balayage angulaire à ensemble actif** : ses bugs ne plantent pas, ils font fuir la vision dans les
> angles — soit exactement le critère 12.

---

## Phase 7 — Sous cast (~15 min, et départ des 45 minutes de R2-05)

Le cast est un **miroir passif Google Cast**. Il a son propre coût : les références hors cast des
points 1.2 et 5.1 sont ce qui permet de le lui attribuer. ⛔ Ne pas substituer une vidéo locale au
mirroring : c'est le mirroring qui est le produit testé.

**7.1 — 30 fps sous cast**

☐ Bouton 3 de `diag.html`, sous cast, sur `manoir-rdc`. **Critère : 30 fps.**
☐ Noter l'écart avec 5.1.

**7.2 — Lisibilité du badge d'élévation**

☐ Le badge est-il **lisible sur le téléviseur**, pas sur la tablette.

**7.3 — Critère 11 : une porte est ouvrable au doigt**

☒ À un zoom de jeu, au plus une vingtaine de cases visibles en largeur — 07/08/2026.
☒ Une porte s'ouvre au doigt, du premier coup, sans viser — 07/08/2026.

**7.4 — Critère 4 : lisibilité des marqueurs**

☒ Lisibles sur le poste MJ, la tablette et le téléviseur casté — 07/08/2026.

**7.5 — Les relevés de R2-05**

☐ **À 15, 30 et 45 min** : « Ajouter le relevé manuel » dans `diag.html`, puis saisir à la main les
   FPS (bouton 3, 20 s, si cela ne perturbe pas la partie), la **température au toucher**, l'état
   réel du **cast**, du **plein écran** et du **Wake Lock**.
☐ **À 45 min** : provoquer ou attendre une sortie/reprise, puis constater que la vision **et** la
   diffusion reviennent.

⛔ Ne jamais déclarer la température, la qualité Cast ou le Wake Lock « mesurés par le navigateur » :
aucune API Web disponible ne les expose de façon fiable dans cette configuration. Ce sont des
observations manuelles, et le rapport les traite comme telles.

**Critère R2-05 :** pas de chute bloquante sous 30 fps pendant le mouvement, pas de coupure cast,
écran allumé, plein écran récupérable, reprise utilisable. Un doute reste un doute ; le noter.

---

## Phase 8 — R1-01, la rétention sur deux vrais clients (~10 min, pendant la partie)

C'est le dernier item de la porte R1 qui exige du matériel, et **la séance fournit exactement les
deux clients demandés** : la tablette et le poste MJ. Il s'observe depuis la console, sur le poste
MJ, sans rien interrompre.

Console Firebase → Realtime Database → `session/<id>`.

**8.1 — Les deux clients sont-ils déclarés ?**

☐ `retentionClients` porte **deux** entrées, une par client, chacune avec un curseur d'ACK.
☐ `presence` en porte deux également.

**8.2 — Le canal cesse-t-il de croître ?**

☐ Noter le nombre d'enfants de `events`.
☐ Jouer en produisant **plus de 32 événements** — déplacements, portes, fog — puis attendre **30 s**.
☐ Recompter. Le nombre doit avoir cessé de croître indéfiniment.

> Les deux constantes expliquent l'attente, et sans elles on conclurait trop tôt à un échec : une
> tentative de rétention n'a lieu qu'après **32 événements publiés** (`EVENT_RETENTION_PUBLISH_INTERVAL`)
> et **au plus une fois par 30 s** (`EVENT_RETENTION_MIN_INTERVAL_MS`). La suppression se fait par
> lots de 32 (`EVENT_RETENTION_BATCH_SIZE`), en dessous de la frontière des ACK.

**8.3 — Le cas qui compte vraiment : la rétention doit savoir s'abstenir**

☐ Mettre la tablette en veille ou fermer son onglet **sans quitter proprement**.
☐ Produire des événements depuis le MJ pendant **moins de 2 min**.
☐ Vérifier que les événements **ne sont pas supprimés** tant que ce client n'a pas dépassé
   `EVENT_RETENTION_CLIENT_STALE_AFTER_MS` (120 s).
☐ Réveiller la tablette et vérifier qu'elle **rattrape** sans trou.

⚠ **C'est ce point qui a de la valeur, pas 8.2.** Un canal qui se vide est facile ; un canal qui
refuse de se vider tant qu'un client n'a pas lu est le vrai mécanisme. Un échec ici se verrait en
séance par une tablette qui manque des événements après une veille — c'est-à-dire tard.

---

## Phase 9 — R2-06, la durée (arrière-plan, jusqu'à 4 h)

Ne rien faire de plus : continuer à jouer.

☐ **À 60, 120, 180 et 240 min** — « Ajouter le relevé manuel », même contenu qu'en 7.5.
☐ L'écran ne s'est pas éteint (Wake Lock, depuis 2.4).
☐ Le plein écran a survécu — y compris après un geste système de la tablette.
☐ Température au toucher à chaque palier, et tout ralentissement perçu.

⛔ **Ne pas faire tourner la sonde en continu** : elle ne doit ni maintenir la page active, ni
masquer un bridage. C'est la même raison qu'en 4.1.

Un essai interrompu n'est **ni un succès ni un échec** : l'indiquer comme incomplet, avec l'heure et
la cause. Seule une séance complète conclut sur l'endurance thermique.

---

## Phase 10 — Fin de séance

☐ **Purge** : la fin de séance nettoie-t-elle ce qu'elle doit, selon l'usage réel ?
☐ Badge réseau : `Firebase connecté` ou `Mode local` — et c'est bien celui attendu.
☐ Reporter tous les chiffres dans `RAPPORT-ENDURANCE.md` avant de ranger la tablette.

---

## Ce qui n'est PAS à faire pendant cette séance

- **Le bouton « Mettre à jour » du bandeau de désynchronisation.** Le défaut qu'il corrige est
  **propre au cache de Safari iOS**. La Tab S9 FE est sous Chromium : elle ne le reproduira pas.
  ⚠ **Incohérence à trancher, pas à tenter** — soit un appareil iOS existe et il faut le nommer,
  soit le point est mal cadré.
- **Les restrictions de clé et d'origine.** C'est le dernier item de la porte R1, mais il se fait en
  console depuis un poste de bureau, et il n'a rien à voir avec la tablette. Voir
  `FIREBASE-CONSOLE-RESTRICTIONS.md`.
- **Le débordement horizontal du panneau des gabarits.** Défaut de la vue MJ, sur poste de bureau.
- **Chercher trois cartes réelles à trois étages.** C'est un sujet de droits, pas de matériel.

---

## Après la séance

Reporter les chiffres dans `RAPPORT-ENDURANCE.md` et `ETAT.md`, et **cocher un critère seulement
s'il porte un nombre**. Un critère de performance déclaré réussi sans mesure est précisément ce que
l'interdiction n°14 proscrit — et ce document existe pour rendre ces mesures possibles, pas pour
rendre les cases faciles à cocher.

Si R2-03 (phase 4) est concluant, **la sonde du chantier N peut être retirée en un commit** : elle
était posée jusqu'à ce qu'elle constate que le correctif tient.

**Résultat consolidé le 07/08/2026 : les trois critères du lot 2 engagés par cette séance sont
fermés.** Les points 1.4, 5.3 et 7.3 valident les critères 10 et 11 ; la partie jouée valide le
critère 4 des marqueurs. Le lot 2 est à 13/13.

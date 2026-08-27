# Questions en attente — au 16 août 2026

> **À quoi sert ce document.** Rassembler, en un seul endroit, tout ce qui attend une décision du
> mainteneur ou une mesure qu'il est seul à pouvoir prendre. Il est écrit pour être dépouillé en
> **séance de choix multiples** : chaque question porte un numéro, la raison pour laquelle elle est
> ouverte, ce qui la ferme, et les options quand elles sont connues.
>
> ⚠ **Ce document n'est pas une feuille de route.** Il ne dit pas quoi faire ensuite, il dit ce qui
> n'est pas tranché. La suite du travail se lit dans `ETAT.md`, table « Suite produit ».
>
> ⛔ **Une question fermée sort d'ici et va dans le document qui fait foi** — `CAHIER-DES-CHARGES.md`
> §11/§12 pour les critères et les questions produit, `ETAT.md` pour l'avancement. Laisser une
> décision ici après l'avoir prise, c'est fabriquer une seconde source de vérité.

---

## A. Mesures qui appartiennent au mainteneur

Aucune de ces trois ne se ferme par du code. Interdiction n°14 : aucun verdict de performance sans
la tablette.

### A-1 ⛔ R2-03 — l'étape 5, sur la vraie vue joueurs

**Où on en est.** L'instrument est réparé le 12/08 et le relevé tablette est fait le 13/08 :
brut **1 206,1 ms**, relecture **68,5 ms**, **net 1 137,6 ms**, doublure 1024 px **2,2 ms**.

Les trois chiffres se recoupent avec l'historique — 1 146 ms mal imputés par l'ancienne sonde,
1 118 ms d'`Image.decode()` le 11/08 — et le rapport au Mac est de **2,3×**, exactement le facteur
déjà consigné. L'instrument dit donc vrai.

**Ce qui reste.** Le seuil de 5 ms porte sur ce qui est payé **dans une frame**. Le plein format
coûte 1,14 s à froid et ne repassera jamais sous 5 ms ; c'est la raison d'être de la doublure
1024 px du chantier P, qui mesure 2,2 ms. Le critère est donc tenu **par le mécanisme de la
doublure**, à condition qu'elle soit réellement ce que la vue joueurs peint en premier.

**Ce qui ferme la question** : refaire le scénario sur la vraie vue joueurs après 2 minutes de
silence et décrire la première image. Carte immédiate → R2-03 tenu. Une seconde de gel → le plein
format tombe dans une frame quelque part, et c'est un vrai défaut.

⚠ Le mainteneur a indiqué le 13/08 que « normalement c'est ok », sans avoir encore fait l'essai.

### A-2 Le hit-test hexagonal « au doigt du premier coup »

Critère du lot 4. L'arrondi cubique est **exact sur 16 287 points balayés**, mais « au doigt » est un
geste, pas un calcul. Les portes ont eu leur banc de visée — erreur p50 2,9 px, réussite 100 % dès
0,25 case ; l'hexagone n'a pas d'équivalent.

**Options** : (a) constat à la tablette sur `marais-hex_16x16` ; (b) un `tests/manuel/` sur le modèle
du banc de visée des portes ; (c) cocher sur lecture, l'exactitude géométrique étant prouvée.

### A-3 Le décompte du lot 4 — trois critères à cocher sur lecture

`HexGrid`, `MeasureLayer` et le sélecteur de pavage sont livrés et éprouvés. Trois critères sur
quatre ne demandent plus que la lecture du mainteneur : coexistence hex/carré, cases atteignables à
coût uniforme respectant les murs, mesure de distance sans quitter le Zero-UI.

⛔ Le décompte fait foi dans le §11 du CdC, pas dans `ETAT.md`.

### A-4 ✅ M2 relevée le 26/08 — reste le volet **cast**, non bloquant

**La mesure est prise sur la Tab S9 FE : 5,62 ms par image sur l'écran réel (2303×1134), contre un
budget de 300 ms.** Le champ lumineux tient, et **WebGL n'est pas justifié**. Détail, décomposition
et conséquences : `PLAN-SUITE.md` §1, M2. La lumière n'attend donc plus une mesure, elle attend une
**décision** — voir D-1 et la phase 3 du plan.

⚠ **Ce qui reste, et c'est mineur** : le relevé **sous cast** n'a pas pu être fait. Le précédent
existe — la section 10 avait été mesurée sous cast actif. Avec 2 % du budget consommé, le cast ne
peut raisonnablement pas renverser le verdict ; mais **aucun critère de performance ne se coche sans
le dispositif réel** (interdiction n°14). À refaire quand le cast sera disponible : même protocole,
`pnpm run serve -- --host 0.0.0.0`, `diag.html` sur la tablette, bouton **16**.

---

## B. Décisions d'interface

> ✅ **Les trois sont tranchées le 16 août 2026.** Elles ont été dépouillées avec le mainteneur dans
> le cadre de l'audit d'ergonomie du panneau MJ : **`docs/AUDIT-UX-MJ.md` fait foi** sur ce qui a
> été décidé et pourquoi. Ce qui reste ci-dessous est la **description des défauts**, conservée
> parce qu'elle est mesurée et qu'elle servira à qui les corrigera. ⛔ Ne pas y relire les options :
> elles sont périmées, le choix est fait.
>
> - **B-1 Ambiance** → bascule jour / nuit ; la pénombre graduée est écartée.
> - **B-2 onglet Image** → le faire marcher ; c'était l'onglet le plus ouvert de la séance.
> - **B-3 trois onglets à zéro** → absorbée par la décision C-1 de l'audit : deux modes de panneau,
>   « Préparer » et « Jouer ». Aucun onglet n'est supprimé.

### B-1 ✅ tranchée — Le curseur « Ambiance » est un interrupteur déguisé en variateur

**Le fait, mesuré dans le code.** Le curseur offre 21 positions de 0 à 1 par pas de 0,05. Le moteur
en lit **une seule chose**, dans `js/render/layers/fogLayer.js` :

```js
return Boolean(level?.ambient?.baked) || Number(level?.ambient?.level) > 0;
```

Ambiante non nulle → chaque PJ voit jusqu'au plafond technique dans sa ligne de vue. Ambiante nulle →
chaque PJ ne voit que sa portée propre (`visionDim`) et les zones éclairées. **0,05 et 1,00 sont
rigoureusement indistinguables.** Le seul cran qui change quoi que ce soit est le passage par zéro.

`ambient.color` est importé, validé, persisté, et **lu par aucun rendu** — même profil que
`settings.ambientLevel`, supprimé en q.4 pour cette raison.

**Options** :
- **(a) Bascule jour/nuit.** L'interface dit ce que le moteur fait. Aucune ligne de rendu à écrire.
  *Recommandé.*
- **(b) Implémenter la pénombre graduée.** Un voile proportionnel dans le chemin du fog — celui où
  une erreur fait voir aux joueurs ce qu'ils ne devraient pas.
- **(c) Garder le curseur** en marquant le seuil sur l'étiquette. Le moins de travail, et le
  mensonge subsiste.

À trancher aussi : `ambient.color` — le supprimer, ou l'implémenter avec (b).

### B-2 ✅ tranchée — L'onglet « Image » du panneau MJ : aperçu ou import ?

**Le bug rapporté** — « un fond gris quadrillé, pas l'image » — n'est pas un bug de rendu. L'onglet
Image construit l'étage **sans `imageUrl`** (`js/ui/gm/importPanel.js:392`) : l'image décodée ne sert
qu'à l'aperçu de calibration 300×180 et n'est jamais remise au moteur. Le gris est la couleur neutre
`#34383f` de `background.js`, la grille est peinte par-dessus. Le petit aperçu, lui, montre bien
l'image — c'est le piège.

`BackgroundLayer.setImage()` existe précisément pour ce cas et **n'est appelé de nulle part**. Et
`tests/gmPanel.spec.mjs:227` asserte `imageUrl === ''` : **le test certifie le bug**.

**Options** :
- **(a) Le faire afficher.** Câbler `setImage`, et empêcher `renderAll` de l'écraser — il rappelle
  `load(activeLevel.imageUrl)` à **chaque frame**, donc une image locale posée naïvement
  disparaîtrait à la frame suivante.
- **(b) Le rendre honnête.** Le panneau annonce un succès qu'il ne livre pas, ce que le critère
  d'acceptation de `PLAN-STABILISATION-CANVAS.md` interdit déjà. Reformuler comme le fait la branche
  UVTT : grille calibrée, fond vide jusqu'à publication par `maps:prepare`.
- **(c) Le fondre dans le chantier bibliothèque** (C-1) : importer une image devient la publier.

Dans tous les cas, `tests/gmPanel.spec.mjs:227` est à reprendre.

### B-3 ✅ absorbée — Trois onglets MJ ne servent pas

Relevé du 11/08 : UVTT, Liaisons et Grille à **zéro ouverture** sur la séance. La section 15 de
`diag.html` cherche explicitement ça. ⚠ Un relevé, une séance — à confirmer sur une seconde avant de
retirer quoi que ce soit de la barre.

⚠ **Ce relevé est antérieur au 13/08** : l'onglet Grille porte désormais le sélecteur de pavage, donc
sa fréquentation va changer.

---

## C. Chantiers à cadrer

Aucun n'est commencé. Chacun demande un arbitrage avant d'écrire la première ligne.

### C-1 Bibliothèque ++ — naviguer, supprimer, modifier, créer

**L'existant est asymétrique.** Les **pions** ont déjà un CRUD complet côté outil de préparation :
`/api/tokens/save`, `/api/tokens/delete`, édition par repopulation du formulaire, image bornée à
256 Kio, écriture atomique par renommage. Les **cartes** n'ont **rien** : pas de renommage, pas de
suppression, pas de vignette. Le catalogue est régénéré en bloc par `maps:prepare`, et les artefacts
orphelins sont seulement **signalés**, jamais supprimés.

**Le chantier est donc double** : côté pions, *exposer* l'existant ; côté cartes, *écrire* le CRUD.

**À trancher** :
- **Où ?** Dans l'outil de préparation (qui écrit sur disque) ou dans le panneau MJ (qui lit un
  catalogue statique) ? ⚠ L'appli déployée ne peut pas écrire dans `maps/` ; le CRUD des cartes
  suppose l'outil local. Le mainteneur ne veut pas de terminal — l'outil se lance au double-clic.
- Renommer une scène est aujourd'hui une édition à la main de `maps/scenes.json`, sans interface ni
  validateur. Le CRUD doit-il le couvrir ?
- Vignettes de scènes : le typedef `SceneLibraryEntry` (`js/core/types.js:220`) porte un `thumbUrl`
  et **n'est référencé par rien**. À implémenter ou à supprimer.
- `features.animated` est écrit par le générateur et **absent du typedef et du validateur** du
  catalogue : dérive à corriger avant d'écrire quoi que ce soit dessus.

### C-2 Lumières cliquables comme les portes

**Ce qui aide** : les portes donnent le patron complet — modèle à états, hit-test partagé entre les
deux vues, événement réseau idempotent, mutation validée avant remplacement, et invalidation de cache
**par signature** plutôt que par appel explicite.

**Ce qui ne se recopie pas** :
- Un `Light` n'a **aucun champ d'état** aujourd'hui. Il faut le champ, sa valeur par défaut à
  l'import, sa normalisation pour les scènes déjà sur disque, et sa validation.
- Il n'existe **aucune couche de rendu des lumières**. Onze couches, aucune pour elles : les lumières
  ne contribuent aujourd'hui que des polygones au masque de fog, elles ne sont jamais dessinées. Le
  MJ ne voit pas où elles sont.
- ⛔ Une porte fermée **ne se dessine pas**, le décor la montre déjà. Une lumière éteinte n'a aucun
  indice dans le dessin : vos cercles rouge/vert doivent être peints **dans les deux états**. C'est
  un écart assumé au patron des portes.
- Le champ doit entrer dans la **signature de vision** de `fogLayer`, sans quoi la bascule ne change
  rien à l'écran — le cache court-circuite.

**À trancher** :
- État **booléen** (allumée/éteinte) ou **à trois valeurs** comme les portes ?
- Cercles visibles **côté joueurs aussi**, ou MJ seulement ? Un marqueur rouge/vert sur la vue
  joueurs révèle une information de MJ. La couche `links` a déjà le précédent d'un rendu par rôle.
- Les **torches portées par les pions** sont un second système de lumière (`Token.emitsLight`). Si le
  MJ clique une lumière fixe, il voudra cliquer une torche — or ce chemin passe aujourd'hui par la
  sélection du pion, pas par un hit-test de lumière.
- Les joueurs peuvent-ils éteindre une lumière ? Les portes, oui, sauf le verrouillage.
- ⛔ Le nom de l'événement doit entrer dans la table du §7 du CdC **avant** d'être implémenté :
  `CONVENTIONS.md` interdit d'inventer un nom d'événement.

### C-3 Handouts — envoi de fichier et bibliothèque de session

**L'existant est minimal.** Un `Handout` a **trois champs** : `id`, `name`, `imageUrl`. Il y a **un
seul emplacement actif**, pas de liste, pas d'historique, aucun regroupement par session ni par
campagne. L'`id` est fabriqué à chaque révélation et **n'adresse rien**.

L'image est fournie en **collant une URL**. Les `data:` sont refusés partout sauf pour les pions
(bornés à 24 Kio). La conversion Google Drive existe mais s'appuie sur des **points d'entrée non
documentés qui peuvent casser**, et elle ne s'applique **qu'aux handouts** — un fond de carte ou une
image de pion collés depuis Drive restent cassés.

⭐ **Le vrai manque est un chemin d'envoi de fichier.** `maps/tokens/` en a un ; il n'existe aucun
équivalent pour les handouts. C'est exactement pourquoi le mainteneur colle encore des liens Drive.

**À trancher** :
- Où vivent les fichiers ? Un `maps/handouts/` avec un `/api/handouts/save` sur le modèle des pions,
  ou un stockage Firebase ? ⚠ Le premier suppose l'outil local ; le second sort de « zéro build » et
  demande une décision de coût.
- « Bibliothèque **spécifique à une session** » : le handout est aujourd'hui de l'**état de session**,
  pas de la donnée de campagne. Une bibliothèque par session la rendrait persistante — est-ce
  toujours de l'état de session, ou de la donnée de campagne ?
- Plafond de taille ? Il n'y en a aucun aujourd'hui : un JPEG de 20 Mo en HTTPS passe toutes les
  vérifications.
- Plusieurs handouts affichables à la fois, ou toujours un seul ?

### C-4 Un skill de projet pour les passes UI/UX

**Réponse à la question posée** : aucun skill dédié à l'UI/UX n'est installé ici. Ce qui existe est
`artifact-design`, qui porte sur des pages web publiées, et `dataviz`, qui porte sur les graphiques —
ni l'un ni l'autre ne fait une passe d'ergonomie sur une application.

Mais un skill n'est qu'un fichier : `.claude/skills/<nom>/SKILL.md`, dans le dépôt ou dans
`~/.claude/skills/`. Ce dépôt n'en a **aucun** aujourd'hui. En écrire un aurait de la valeur
précisément parce qu'il porterait les contraintes **de ce projet**, qu'aucun skill générique ne
connaît : le Zero-UI côté joueurs, l'exclusivité mutuelle des outils MJ et leur désarmement au
changement d'onglet, le refus du terminal, la tablette et sa lisibilité à trois écrans, le
débordement du panneau MJ à 1024 px.

⭐ **Second candidat, indépendant** : un skill `revue-mutation` qui porterait le protocole de revue —
muter le code et exiger le rouge, vérifier que le patch touche du code et non une JSDoc, ne jamais
lire un nom de test comme une preuve. Ce savoir-faire a attrapé une vingtaine de faux verts ; il vit
aujourd'hui dans la mémoire de l'assistant et dans `docs/`, pas dans un outil invocable.

**À trancher** : en écrire un, les deux, ou aucun.

> ⚠ **Une moitié de la question est répondue le 16/08/2026.** Le mainteneur a demandé s'il existait
> un skill à *récupérer* pour une passe UX. Réponse vérifiée : **non**. Les skills ne se téléchargent
> pas en session — ils se chargent de `.claude/skills/`, de `~/.claude/skills/` ou d'un plugin — et
> **aucun plugin officiel Anthropic ne porte sur la revue d'ergonomie ou d'accessibilité d'une
> interface**. Les marketplaces existent (`/plugin marketplace add anthropics/claude-plugins-official`
> puis `/plugin install <nom>@<marketplace>`) mais n'offrent rien sur ce sujet.
>
> ⭐ Et l'audit du 16/08 a montré que le skill n'était pas le besoin : ce qui manquait n'était pas
> une méthode, c'étaient **trois faits d'usage** que seul le mainteneur détient (voir le tableau en
> tête de `AUDIT-UX-MJ.md`). Si un skill s'écrit un jour, ce sera **en aval** d'une passe réussie,
> pour figer ce qui a marché — pas en amont pour la guider.

### C-5 ⛔ `mapFromCellPoint` ne veut pas dire la même chose selon le pavage — les pions sont faux en hexagonal

**Trouvé le 16/08/2026** par la relecture du chantier des liaisons, hors de son périmètre. Ce n'est
pas une dette dormante : c'est un **défaut actif**, dès qu'une carte hexagonale porte un pion.

Le contrat `GridAdapter.js` dit « unité de case fractionnaire → pixels carte » sans dire *quel* point
de la case. Les deux implantations ont répondu différemment :

- `SquareGrid.mapFromCellPoint` rend le **coin** : `offset + cellX * pxPerCell` ;
- `HexGrid.mapFromCellPoint` rend le **centre** : `offset + px * (cellX + 0.5*(ligne&1) + 0.5)`,
  c'est-à-dire la formule de `pointFromCell` à l'entier près.

`TokensLayer._drawToken` calcule sa boîte par deux appels — coin haut-gauche et coin bas-droit — ce
qui n'est juste que pour la première convention. Vérifié par le calcul, `pxPerCell` 140, pion 1×1 :

| ligne | largeur dessinée | attendu |
|---|---|---|
| paire | `1,5 × px` = **210 px** | 140 |
| impaire | `0,5 × px` = **70 px** | 140 |

La hauteur est fausse aussi : `√3/2 × px` = 121,2 px au lieu des 161,7 px d'un hexagone pointe en
haut. Le centre dessiné est décalé de 105 px en ligne paire, 35 px en ligne impaire.

**Pourquoi ce n'est pas corrigé tout de suite** : le choix de convention ne concerne pas que les
pions. `mapFromCellPoint` sert aussi au rendu des murs, portails et lumières importés — voir son
commentaire dans `GridAdapter.js` — et l'import UVTT donne ses coordonnées en unités de case
fractionnaires depuis le **coin**. Changer `HexGrid` pour rendre le coin est probablement la bonne
réponse, mais elle traverse `portals.js`, `walls.js`, `blockedEdges.js` et l'import. C'est un
chantier, pas un correctif d'une ligne.

**Ce qui ferme la question** : trancher la convention dans `GridAdapter.js` — coin, et pas centre —
puis aligner `HexGrid` et vérifier les quatre consommateurs. ⚠ Aucun test ne défend aujourd'hui la
géométrie d'un pion hexagonal ; il en faudra un avant de toucher quoi que ce soit.

### C-6 ⛔ Deux fonctions de désignation en désaccord — avec deux PJ empilés, c'est le mauvais qui franchit

**Trouvé le 16/08/2026** par la relecture du chantier de l'invite de franchissement. Défaut
antérieur au chantier, mais rendu visible par lui : il se manifeste maintenant sur un escalier.

Deux fonctions désignent « le pion sur cette case » et ne répondent pas la même chose :

- `findHitToken` (`js/input/tokenHit.js`) départage par **identifiant croissant** ;
- `exactTokenAtCell` (`js/input/tokenHit.js`) rend **le premier du tableau**.

Rien n'interdit deux PJ sur la même case — `moveTokenToCell` n'empêche pas l'empilement. Avec
`tokens = [PC_zeta, PC_alpha]`, tous deux sur l'escalier :

1. le joueur tape : `findHitToken` sélectionne **alpha** (identifiant le plus petit), l'invite
   s'allume pour alpha ;
2. il retape : `exactTokenAtCell` rend **zeta**, la sélection saute silencieusement sur zeta et
   l'invite reste allumée — rien à l'écran ne signale le changement ;
3. il retape : c'est **zeta** qui monte à l'étage.

Le joueur lit « Retaper pour prendre l'escalier », retape, et c'est le personnage d'un autre qui
part. `PC_alpha` ne peut jamais franchir. ⛔ **Aucun ordre de branches ne répare ce cas** : l'ordre
inverse rendrait simplement zeta insélectionnable. C'est le désaccord entre les deux fonctions qui
le crée.

**Ce qui ferme la question** : leur donner le même départage — le plus simple étant de faire rendre
à `exactTokenAtCell` le même pion que `findHitToken` à distance nulle, c'est-à-dire l'identifiant le
plus petit plutôt que l'ordre du tableau. ⚠ `exactTokenAtCell` sert aussi au refus « case occupée » ;
vérifier les deux appelants. Le comportement actuel est figé par le test « deux PJ empilés » de
`tests/multiLevelJourney.spec.mjs`, qui devra bouger avec le correctif.

**Pourquoi ce n'est pas corrigé tout de suite** : il faut deux PJ exactement sur la même case, ce
qui ne s'est jamais produit en séance, et le correctif touche un départage dont dépendent la
désignation et le refus de destination — deux chemins que le chantier O a déjà réglés finement.

### C-7 ⛔ On peut ajouter un étage, on ne peut pas en retirer — et UX-01 va rendre l'ajout facile

**Trouvé le 16/08/2026** en relisant le plan d'implémentation de UX-01. Ce n'est pas un défaut de ce
plan : c'est une conséquence de son succès.

**Le fait, vérifié.** `js/state/store.js` expose `addLevel` et **aucun `removeLevel`**. Il n'existe
ni événement `level.delete`, ni `level.remove`, ni aucun bouton de suppression d'étage dans le
panneau MJ. Le seul moyen de se débarrasser d'un étage est `scene.load`, qui **remplace la campagne
entière** — donc jette aussi les pions posés, le brouillard travaillé et la position de tout le
monde.

**Pourquoi ça devient un problème maintenant.** Jusqu'ici l'onglet Image ne publiait rien : ajouter
un étage en séance ne se produisait pas. UX-01 en fait un geste courant, et `store.addLevel`
**sélectionne** l'étage qu'il ajoute, donc chaque import bascule la table dessus. Deux imports ratés
— une mauvaise adresse, une mauvaise calibration — laissent deux étages morts dans la campagne, pour
toujours, et dans le sélecteur d'étage que le MJ ouvre à chaque changement de niveau.

## ✅ Ce que le mainteneur a tranché le 16/08/2026

**1. Deux gestes, au choix à l'import.** L'onglet Image propose « remplacer l'étage courant » ou
« ajouter un étage ». Les deux besoins sont réels : recaler une carte ratée, et monter un bâtiment à
plusieurs niveaux. ⚠ La branche « ajouter » implique donc quand même d'écrire la suppression
d'étage, qui n'existe pas.

**2. ⭐ Aucun pion ne se place tout seul sur une carte qui vient d'arriver.** Mot pour mot : « si
j'importe une nouvelle carte en milieu de séance, les pions ne doivent pas être automatiquement
placés dessus, ce sera à moi de le faire manuellement ».

C'est un **principe**, pas la réponse à un cas particulier. Il décide d'avance tous les cas de ce
genre : rien ne bouge dans le dos du MJ, sur un plateau que six personnes regardent.

**3. Et le principe se décline différemment selon le geste** — précision du mainteneur le même jour,
qui va plus loin que ce que j'avais compris :

| Geste | Les pions | La carte, côté joueurs |
|---|---|---|
| **Remplacer** l'étage courant | ⭐ **retournent « en réserve »** — ils quittent le plateau, le MJ les repose ensuite | **immédiatement affichée**, quitte à être toute noire tant qu'aucun pion n'y porte de ligne de vue |
| **Ajouter** un étage | **ne bougent pas** : ils restent exactement où ils sont, sur leur étage | ⭐ **pas affichée** — la tablette ne bascule pas. Elle y viendra quand les joueurs iront, par un escalier ou parce que le MJ les y emmène |

⭐ La ligne « ajouter » a une conséquence immédiate et **elle est déjà partie en développement** :
`store.addLevel` sélectionne l'étage qu'il ajoute, donc la table basculait sur la nouvelle carte à
la seconde où le MJ validait. La règle retenue est qu'`addLevel` ne sélectionne que **s'il n'y avait
pas d'étage actif** — l'initialisation d'une campagne, le seul cas où quelqu'un doit bien être
choisi. Voir UX-01 dans `BRIEF-GEMINI-UX-MJ.md`.

### ⛔ « La réserve » n'existe pas, et c'est le cœur du chantier

Un `Token` porte aujourd'hui un `levelId` **et** une `cell`, tous deux obligatoires et validés : un
pion est **toujours quelque part**. Il n'y a aucun endroit où poser un pion qui n'est sur aucune
carte.

C'est donc une notion neuve, et elle traverse le schéma, la validation, la persistance, le réseau et
le panneau MJ. Questions ouvertes, à trancher avant d'écrire :

- **Comment se représente un pion en réserve ?** Un `levelId` nul — qui casse un invariant partout —
  ou une collection séparée dans la campagne, qui en préserve un mais duplique la forme du pion ?
- **Qui la voit ?** La réserve est-elle un fait de jeu partagé, ou un tiroir du seul poste MJ ? ⚠ Si
  elle est partagée, elle transite par le réseau et la persistance ; si elle est locale, elle ne
  survit pas à un F5 du MJ, et les pions seraient perdus.
- **Le fog et la vision** : un pion en réserve n'émet ni vision ni lumière, et ne doit compter dans
  aucun calcul. À vérifier partout où les pions sont balayés — `js/vision/`, `computeReachable`,
  `blockedEdges`.

⚠ **Ne pas confondre la réserve avec la bibliothèque de pions.** La bibliothèque tient des
**modèles** dont on instancie des copies ; la réserve tient **ces instances-là**, celles qui étaient
sur le plateau, avec leurs PV, leurs marqueurs et leur histoire.

⭐ **La réserve rend le placement au doigt indispensable**, et il est déjà briefé : UX-08 fait poser
un pion là où le MJ tape, au lieu de la case (0,0) où ils apparaissent aujourd'hui. Le mainteneur l'a
redemandé de lui-même le 16/08 — « à l'usage je ne suis pas satisfait des pions qui apparaissent
automatiquement tout en haut à gauche, je veux pouvoir choisir exactement où ils apparaissent ». Les
deux besoins sont le même geste : **sortir un pion de la réserve, c'est le poser quelque part.**

### La règle sur les débordements reste, et elle découle du principe

`assertValidCampaign` **borne les pions aux dimensions de leur étage**. Sur la branche « ajouter »,
où les pions ne bougent pas, la question ne se pose pas. Sur la branche « remplacer », la réserve la
dissout : les pions ont quitté le plateau, aucun ne peut déborder.

⛔ Elle ressurgira le jour où quelqu'un voudra « garder les pions en place en remplaçant la carte ».
La réponse est alors **refuser et nommer les pions qui débordent** — jamais les ramener au bord, ce
qui serait le placement automatique que le principe interdit.

## Ce qui reste à trancher

- **Où vit la suppression d'un étage ?** Panneau MJ en séance, ou seulement outil de préparation
  comme le reste du CRUD des cartes (voir C-1, qui porte la même question pour les scènes) ?
- **Que devient ce qui vit sur l'étage supprimé** — pions, murs, portes, masques de fog indexés par
  étage ? ⚠ Les **liaisons** sont le cas dur : `validateLinks` exige deux étages existants et
  distincts, donc supprimer un étage peut rendre la campagne invalide, avec la même conséquence que
  ci-dessus — plus aucune mutation ne passe.

⛔ **Hors périmètre de UX-01** — ne pas l'y ajouter. Le brief Gemini traite une tâche à la fois, et
ce qui reste demande encore les deux arbitrages ci-dessus.

### C-8 ⭐ Découpler les étages : chacun circule chez soi, les joueurs ne voient que ce qu'ils connaissent

**Demandé le 16/08/2026, et jamais consigné jusque-là** — le mainteneur : « c'est un truc qu'on
devait faire évoluer à l'avenir ça par contre, on a dû oublier de le consigner ».

## L'état actuel, et pourquoi il gêne

La vue joueurs **suit l'étage actif du MJ**. Il n'y a qu'un seul étage courant pour toute la table,
et c'est le MJ qui le tient. Conséquence : il ne peut pas aller regarder un autre niveau — vérifier
une carte, préparer la suite — sans y emmener les six personnes qui le regardent.

## Ce qui est voulu

1. **Les joueurs ont leur propre sélecteur d'étage**, d'une autre forme que celui du MJ. Référence
   donnée : le projet `E:\Projet_shadowrun`, dont la forme est à reprendre.
2. **MJ et joueurs circulent indépendamment.** Aucun des deux ne fait basculer l'autre.
3. ⭐ **Les joueurs ne peuvent choisir qu'un étage « connu » d'eux** — c'est-à-dire un étage sur
   lequel un pion PJ **a obtenu** une ligne de vue. Précision du mainteneur le 16/08, et elle change
   tout : c'est du **passé**, pas du présent. « Un joueur visite un étage puis le quitte. La map de
   cet étage doit rester sélectionnable du côté des joueurs. Simplement ils n'ont plus de ligne de
   vue active dessus, donc ce sera dans le brouillard de guerre. Les zones préalablement explorées
   visibles mais sans ligne de vue active. »

### ⭐ Conséquence : « connu » existe déjà, et ne demande aucun champ nouveau

C'est **exactement** la définition du masque **exploré** que le fog persiste par étage depuis L-04,
avec ses trois rendus — actuellement visible, exploré mais hors vision, jamais vu. Un étage est
« connu » si son masque exploré existe et n'est pas vide.

⇒ Ni champ de schéma, ni événement réseau, ni migration. La liste des étages offerts aux joueurs se
**dérive** d'un état déjà calculé, déjà persisté et déjà transmis. Et l'affichage d'un étage connu
mais quitté est correct **par construction** : le fog sait déjà peindre « exploré sans vision ».

### ⚠ Le piège qui vient avec, et il faut le traiter dans ce chantier

`requestVisionResend`, dans `js/app/player.js`, réclame la vision **du seul étage actif** :
`payload: { levelId: store.getActiveLevel()?.id ?? null }`.

Or la liste des étages connus est, elle, une propriété de **tous** les étages. Après un F5 de la
tablette — ou après la resynchro au réveil livrée le 16/08 — la vue joueurs risque de ne récupérer
le masque que d'un seul étage, et **sa liste d'étages connus s'effondrerait à un**. Les joueurs
perdraient l'accès à des niveaux qu'ils ont bel et bien explorés.

### ✅ Vérifié le 16/08 — un F5 ne perd rien, une tablette neuve perd tout

Le masque **exploré** est persisté **par étage** dans le stockage local, sous
`rpg_fog_<sessionId>_<levelId>`, et `getSessionFog` retombe sur le stockage quand sa carte mémoire
est vide (`js/state/store.js:1356-1367`). Le poste joueurs écrit ce masque à chaque événement de
fog reçu. Donc :

- **F5 sur la même tablette** → tous les masques déjà reçus reviennent du stockage local. La liste
  des étages connus est intacte. ✅ Aucun travail.
- **Tablette neuve, navigation privée, stockage vidé** → aucun masque local. Le seul apport est
  `requestVisionResend`, qui ne réclame que **l'étage actif**. Le sélecteur n'y offrirait donc que
  les étages dont un masque est arrivé depuis la connexion.

⛔ **Ce second cas ne sera PAS traité, et ce n'est pas un oubli.** Décision du mainteneur le
16/08/2026 : « il est totalement inutile de traiter ce cas spécifique ». Le F5 — le cas courant —
est déjà couvert par la persistance locale ; une tablette entièrement neuve en pleine partie est
jugée trop rare pour son coût. ⚠ Ne pas rouvrir sans que le cas se soit **réellement produit** en
séance. Le numéro UX-11 du brief est laissé en place comme pierre tombale, avec sa raison.

## ✅ Ce que la convention autorise déjà, contre toute attente

⛔ L'interdiction n°2 de `CONVENTIONS.md` — « ne jamais ajouter d'élément d'interface à la vue
joueurs » — **liste explicitement le sélecteur d'étage parmi ce qui a le droit de s'afficher** :
« Seuls la carte, la grille, l'indicateur d'état des portes, les pions, le fog, **le sélecteur
d'étage** et les gabarits s'affichent. »

Il n'y a donc **aucune dérogation à demander** : la convention l'avait prévu, il n'a jamais été
construit. C'est le seul élément du Zero-UI joueurs qui existe sur le papier et pas à l'écran.

## La forme de référence, relevée dans `E:\Projet_shadowrun`

Composant réel : `js/editor.js:318-352` (`renderTabs`), styles `css/style.css:439-455` et
`:1203-1214`, ancrage `index.html:113`. HTML/CSS/JS sans framework, DOM construit impérativement —
même famille technique que ce projet-ci.

- **Barre horizontale d'onglets** au-dessus de la carte, un bouton par étage portant son nom.
- **Au repos** : fond transparent, bordure d'un pixel en couleur primaire, texte en majuscules,
  `padding: 8px 16px`.
- **Actif** : fond plein en couleur primaire, texte foncé, gras.
- **En mode joueur** : la barre devient défilable horizontalement, sans retour à la ligne, avec une
  **cible tactile d'au moins 44 px de haut** — seule concession tactile du composant.
- Un re-clic sur l'onglet déjà actif ouvre les propriétés de l'étage plutôt que d'en changer. ⚠ Sans
  objet ici : la vue joueurs n'a pas d'inspecteur, et n'en aura pas.
- Changer d'étage y **vide la sélection courante** et désarme l'outil actif.

⛔ **Une chose à ne PAS copier : l'accessibilité.** Le composant de référence n'a aucun `role`, aucun
`aria-*`, aucune gestion des flèches — ce sont des `<button>` natifs et rien de plus. La barre
d'onglets MJ de ce projet-ci est conforme depuis R0-04 ; le sélecteur joueurs doit l'être aussi. On
reprend la **forme**, pas le retard.

## ⭐ Le fait qui contredit l'hypothèse de départ : le projet de référence MASQUE, il ne verrouille pas

J'avais supposé que « les joueurs ne peuvent sélectionner qu'un étage connu » voulait dire une
entrée **présente mais grisée**. Ce n'est pas ce que fait la référence, et c'est vérifié :

- **côté MJ**, tous les étages sont listés ; ceux que les joueurs n'ont pas découverts portent une
  bordure en pointillés et `opacity: 0.65`, mais restent **cliquables normalement** — c'est un
  simple rappel visuel (`store.js:1483` côté MJ, `style.css:453`) ;
- **côté joueur**, les étages non révélés sont **retirés de la liste** (`store.js:1479-1483`,
  `isEffectivelyRevealed`). Pas d'onglet grisé, pas de cadenas : **l'entrée n'existe pas dans le
  DOM**.

⭐ **Et c'est probablement le bon comportement, pour une raison que la forme grisée aurait ratée** :
un onglet « Étage 3 » verrouillé apprend aux joueurs qu'il **existe** un troisième étage. C'est une
fuite d'information exactement de la même famille que celles que le fog existe pour empêcher.

⇒ **Recommandation : filtrer à la source, comme la référence.** Si le mainteneur veut malgré tout
un état « visible mais verrouillé », ce n'est pas une copie — c'est une invention, et elle se paie
en information donnée à la table.

## Ce qu'il faut concevoir

- **La notion d'« étage connu ».** ⭐ Elle existe peut-être déjà sous un autre nom : le fog persiste
  un masque **exploré par étage** (`getSessionFog(levelId)`). « Connu » pourrait se lire comme « un
  masque exploré existe et n'est pas vide pour cet étage » — à vérifier avant d'inventer un champ.
  ⚠ Si un champ neuf est nécessaire, il traverse le schéma, la persistance et le réseau.
- **Où vit l'étage actif des joueurs ?** Aujourd'hui `activeLevelId` est unique dans le store. En
  découpler deux demande soit un second champ, soit un état local à la vue joueurs qui ne voyage
  pas. ⚠ La seconde forme est probablement la bonne — c'est un point de vue, pas un fait de jeu —
  mais elle interagit avec la restauration après F5 et avec la resynchro au réveil.
- **Que devient le suivi automatique du MJ ?** Le cadenas 🔒 suspend déjà la bascule automatique
  quand un pion change d'étage. Si les vues se découplent, ce cadenas change de sens : à relire
  avant d'écrire, pas après.
- **Et le franchissement d'une liaison ?** ⭐ La précision du 16/08 le résout presque seule. La vue
  joueurs est **partagée par toute la table sur une seule tablette** — « le joueur » n'existe pas
  individuellement dans ce produit —, donc faire suivre l'écran au pion qui monte emmènerait la
  table entière et abandonnerait les personnages restés en bas.

  ⇒ **Proposition, à confirmer** : personne ne bascule automatiquement. Le franchissement rend
  simplement l'étage d'arrivée **connu**, donc offert dans le sélecteur, et la table décide d'y
  aller ou non. Le pion qui est monté cesse d'apparaître sur l'étage affiché, ce qui est vrai et
  lisible. C'est la même règle que pour l'ajout d'un étage — **rien ne se déplace dans le dos de
  personne** —, et elle vaut alors pour tout le produit.

⛔ **Hors périmètre du brief UX en cours** — ne pas l'y glisser.

---

## D. Décisions produit encore ouvertes

### D-1 §12 q.9 — l'approximation de la lumière vue

La règle « une lumière n'est pas un œil » est tranchée et implantée. Ce qui reste ouvert est
l'**approximation** : le test porte sur le **centre** de la source, donc un PJ qui aperçoit une lampe
se voit révéler *tout son halo*.

⭐ **Le déclencheur est écrit** : voir en séance une pièce entière se dévoiler parce qu'un PJ aperçoit
une lampe par une porte.

**Deux non-déclenchements consignés** : le 11/08 sur `testvideo-3`, où les murs obliques bloquent la
ligne vers les lampes ; et le **13/08**, où le mainteneur a éprouvé les angles de vision sur porte
ouverte et juge le comportement « tout à fait adéquat ».

La version stricte coûterait 15 à 20 ms pour six PJ contre 300 de budget — le vrai prix est **une
centaine de lignes dans le chemin du fog**. Tant que le cas reste théorique, l'approximation tient.

### D-2 Le vrai nom dans l'historique public

L'identité git est corrigée pour l'avenir. ⚠ Le vrai nom du mainteneur reste dans l'historique public
de trois dépôts. Réécrire l'historique est une décision qui lui appartient, et elle n'a pas été prise.

### D-3 Vision dans le noir — la table de référence

Le besoin d'une table est confirmé et le champ existe depuis le lot 1a. ⚠ Ne pas régler un PJ à 0
avant le lot 3.

### D-4 `tests/manuel` — rapatriement à décider

`verify` ne couvre pas le geste réel ; `pnpm run test:manuel` existe pour ça. La cause est corrigée
depuis le 04/08, mais le rapatriement des scénarios dans la porte n'est pas décidé.

---

## E. Dettes techniques consignées, non corrigées

Aucune n'est un défaut actif. Toutes sont des pièges pour qui viendra après.

| # | Dette | Où | Pourquoi elle est laissée |
|---|---|---|---|
| E-1 | `cellPointFromMap(pointFromCell(c))` n'est **pas** un aller-retour exact en hexagonal : erreur jusqu'à **une demi-case** quand l'erreur sur `cellY` fait basculer le plancher et change la parité | `js/grid/HexGrid.js` | Ne casse pas `computeBlockedEdges`, qui n'évalue que des points réels. Mais les tolérances à `1e-9` du fichier n'absorberaient jamais 0,5 : tout futur code qui supposerait cet aller-retour exact casserait en silence |
| E-2 | La clé d'arête `min * cellCount + max` dépasse 2⁵³ au-delà de ~9 741 × 9 741 cases | `js/import/blockedEdges.js` | `allCells()` allouerait 10⁸ objets bien avant. Aucun test ne défend la borne |
| E-3 | Une mutation reste verte : faire juger le verdict R2-03 par un second appel `resumeDecodageFroid(brut, 0)` tout en affichant le net correct | `js/app/diag.js` | Aucun scénario de navigateur ne peut la distinguer, les deux durées d'un Chromium sans charge tombant du même côté du seuil. Ce n'est pas une régression plausible |
| E-4 | `features.animated` écrit par le générateur, absent du typedef et du validateur du catalogue | `js/import/catalog.js` | À corriger avant d'écrire un CRUD de cartes (C-1) |
| E-5 | Le typedef `SceneLibraryEntry` n'est référencé par rien | `js/core/types.js:220` | Vestige d'une conception antérieure. À implémenter avec C-1 ou à supprimer |
| E-6 | `ambient.color` importé, validé, persisté, **lu par aucun rendu** | `js/core/schema.js` | Voir B-1 |
| E-7 | `if (!level \|\| !grid) return new Set()` — un adaptateur nul rend « aucun mur ne bloque », en silence | `js/import/blockedEdges.js:253` | Même forme que le défaut corrigé en R-04a, mais changer le comportement peut casser des appelants qui passent `null` pendant le chargement |
| E-8 | La marge de `DRAG_HOLD_MS` n'est que de **10,8 ms** — appui p95 mesuré à 139,2 ms pour un seuil à 150 | `js/core/constants.js` | C'est ce chiffre qu'il faudra reprendre si la zone morte 150–500 ms est un jour découplée |

---

## F. Leçons de méthode, pour ne pas les repayer

- ⛔ **`verify` vert en local ne vaut pas vert en CI.** Le 13/08, l'option « Hexagonale (pointe en
  haut) » a fait déborder le panneau MJ de 15 px sur le runner Linux, dont les fontes sont plus
  larges, et passait sur le poste du mainteneur. Un test de mise en page dépend des fontes de la
  machine : la contrainte doit être **structurelle** (`width: 100%; min-width: 0`) et non
  cosmétique — raccourcir le libellé n'aurait protégé que jusqu'au prochain libellé.
- ⛔ **Ne jamais mettre de backticks dans un commentaire situé à l'intérieur d'un template literal.**
  La chaîne se termine là, et l'application ne démarre plus. Le symptôme est un `waitForApp` qui
  expire, pas une erreur de syntaxe lisible.
- ⛔ **Toute exécution de `test:unit` recopie `js/` dans `_site/`** — `tests/sitePackage.test.mjs`
  appelle `buildSite()`. Muter un fichier, lancer la suite, puis restaurer `js/` laisse la mutation
  **figée dans `_site/`**, que `.gitignore` masque.
- ⭐ **Une revue adversariale par sous-agent trouve ce qu'une relecture rate.** Le 13/08, deux agents
  ont sorti un bug réel déjà déclaré correct et dix mutations survivantes dans des tests neufs.
- ⚠ **Un message de commit qui cache son contenu coûte un aller-retour complet.** G-01 avait été
  livrée dans un commit intitulé `docs(...)` qui transportait trois fichiers de code : le travail a
  été réclamé deux fois par écrit alors qu'il était fait.

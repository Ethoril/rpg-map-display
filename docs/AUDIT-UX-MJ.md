# Audit d'ergonomie du panneau MJ — 16 août 2026

> **État : dépouillé et tranché le 16 août 2026.** Ce document a été écrit comme une séance de choix
> multiples, puis rempli des décisions du mainteneur le jour même. Il devient donc le **plan de
> travail** des passes d'ergonomie du panneau MJ.
>
> ⚠ **Ce document n'est pas une source de vérité sur l'avancement.** Une tranche livrée se coche
> dans `ETAT.md`, pas ici. Ce qui vit ici est le *pourquoi* de chaque décision — ce qui manquerait
> cruellement à qui lirait le code six mois plus tard.

---

## Ce que le mainteneur a répondu sur sa façon de jouer

Trois faits qui ne se lisent nulle part dans le code, et dont chacun a décidé une option.

| Question | Réponse du 16/08/2026 | Ce qu'elle tranche |
|---|---|---|
| Crée-t-il des PNJ pendant la partie ? | **Les deux, selon les séances** | B-2 est à corriger : le gain existe dans un cas et ne coûte rien dans l'autre |
| Quand travaille-t-il le brouillard ? | **Révélé au début, puis peu touché** | B-4 tombe : le pinceau qui reste armé est sans conséquence |
| Prépare-t-il ses cartes en jouant ? | **Parfois en cours de partie** | C-1 reste possible, mais la bascule de mode doit être **en un geste et sans rien perdre** |

⛔ Ces trois réponses sont des faits d'usage, pas des préférences d'interface. Les redemander au
prochain chantier ferait retrancher trois options déjà arbitrées.

---

## Ordre de bataille arrêté

1. **A-1 — l'onglet Image.** Seul défaut dont on peut dire qu'il a coûté du temps de jeu, et
   indépendant de tout le reste.
2. **C-1 + B-3 + D-2 ensemble** — les deux modes du panneau, la barre permanente des PV, et
   l'extraction de la barre d'étage. Les trois touchent la même mise en page : les séparer
   reviendrait à retoucher `panel.js` trois fois.
3. **B-1 + A-3 ensemble** — le retrait d'un gabarit et la forme « ligne ». Les deux vivent dans
   `templateTools.js` et la couche des gabarits.
4. **Au fil de l'eau, sans tranche dédiée** : A-2, B-2, D-1.

---

## A. Ce que le panneau promet et ne tient pas

### A-1 ⛔ L'onglet le plus ouvert de la séance est celui qui ne peut pas marcher — **le faire marcher**

**Le fait.** L'onglet « Image » a été ouvert **cinq fois** lors de la séance du 11/08, à égalité
avec Handouts, en tête du relevé. Or il construit son étage **sans `imageUrl`**
(`js/ui/gm/importPanel.js:392-407`) : l'image décodée ne sert qu'à l'aperçu de calibration de
300 × 180 px et n'est jamais remise au moteur. Le mainteneur voit l'image dans le petit aperçu,
valide, et obtient un fond gris quadrillé. `BackgroundLayer.setImage()` existe pour ce cas précis et
**n'est appelé de nulle part**.

**Pourquoi ce point est le premier.** Les autres défauts coûtent des gestes. Celui-ci a coûté cinq
tentatives dans une seule séance, chacune suivie d'un échec silencieux.

**✅ Décision : le faire marcher.** Le mainteneur prépare parfois en cours de partie : l'import
d'une image est un geste de séance, et il doit aboutir.

### ⚠ Correction du 16/08, le jour même — ma première formulation était fausse

J'avais écrit « câbler `setImage` et empêcher `renderAll` de l'écraser ». **Cela n'aurait affiché
l'image que sur l'écran du MJ.** Le mainteneur, à qui un premier plan d'implémentation a été
soumis : « je veux pouvoir choisir une image qui servira de map, et oui qu'elle devienne visible aux
joueurs, sinon ça n'a pas d'intérêt ».

Pour que la tablette affiche la carte, `imageUrl` doit être une **adresse qu'elle peut aller
chercher** — elle ne partage ni le disque du MJ ni sa mémoire. Y mettre l'image elle-même est fermé
par la borne de persistance : URL relatives ou HTTPS seulement, la seule exception étant l'image de
pion embarquée et bornée, plafond cumulé 512 Kio, qu'une carte fait sauter d'un coup.

**✅ Chemin retenu : une adresse d'image, comme les handouts.** L'onglet accepte une URL HTTPS ou un
lien Google Drive, le convertit avec le code qui existe déjà dans `js/ui/gm/handouts.js`, le calibre
et le publie. ⭐ Le mécanisme est éprouvé et déjà utilisé en séance — Handouts, cinq ouvertures, à
égalité en tête du relevé. Le sélecteur de fichier local disparaît de cet onglet : garder les deux
chemins reproduirait le mensonge qu'on corrige.

⛔ **L'envoi de fichier vers un hébergement** — Firebase Storage ou autre — est écarté **pour cette
tranche, pas pour toujours**. C'est le seul chemin qui garderait le geste « je choisis un fichier »,
mais il demande un produit de plus, ses règles de sécurité, son quota et un amendement à `STACK.md`.
Chantier à part entière, à rouvrir quand l'adresse d'image aura montré ses limites à l'usage.

⚠ `tests/gmPanel.spec.mjs:227` asserte `imageUrl === ''` — **le test certifie le bug**. Il est à
reprendre en même temps, et c'est lui qui dira si le correctif a mordu.

### A-2 Le curseur « Ambiance » a 21 positions et un seul cran utile — **bascule jour / nuit**

**Le fait.** 21 positions de 0 à 1 par pas de 0,05. Le moteur en lit une seule chose, dans
`js/render/layers/fogLayer.js` : `baked || level > 0`. **0,05 et 1,00 sont rigoureusement
indistinguables** ; le seul cran qui change quoi que ce soit est le passage par zéro.
`ambient.color` est importé, validé, persisté, et lu par aucun rendu.

**✅ Décision : aligner l'interface sur le moteur.** Le curseur devient une bascule jour / nuit.
Aucune ligne de rendu à écrire, aucun risque pris sur le chemin du fog. ⛔ La pénombre graduée est
**écartée** : c'est le chemin où une erreur fait voir aux joueurs ce qu'ils ne devraient pas voir,
et personne n'a réclamé la nuance en séance.

À traiter au passage : `ambient.color`, à supprimer puisque plus rien ne pourra l'implémenter.

### A-3 La forme de gabarit « Ligne (bientôt) » — **l'implémenter**

**Le fait.** `<option value="line" disabled>Ligne (bientôt)</option>`
(`js/ui/gm/templateTools.js:55`), désactivée en permanence depuis le lot 2 ; le gestionnaire
n'accepte que `circle` et `cone`.

**✅ Décision : l'implémenter**, contre ma recommandation, qui était de la retirer faute de demande
en séance. Le mainteneur en a l'usage — mur de feu, souffle, ligne de tir. La couche des gabarits
sait déjà découper par les murs (`ctx.clip()`, protégé par un test e2e d'occlusion).

**Précisions du 16/08, qui lèvent le point d'arrêt** :
- **Largeur réglable, défaut 1 case.** ⚠ C'est un champ de plus au schéma, donc à la validation, au
  réseau et à la persistance — cette tranche n'est plus du rendu seul.
- **L'origine peut être libre ou prise sur un pion.** Règle de geste, pas de mode : l'outil armé, un
  tap sur un pion accroche l'origine à son centre, un tap ailleurs la laisse sous le doigt.
- ⛔ **La ligne ne suit PAS le pion.** Écarté explicitement, avec ses trois cas non tranchés — pion
  supprimé, pion qui change d'étage, pion masqué — et son conflit avec le glisser de gabarit qui
  existe déjà côté joueurs. Aucun champ d'ancrage n'entre dans le schéma.

⭐ **C'est la seule fonctionnalité neuve de tout ce lot**, et depuis l'ajout de la largeur, **la
seule qui touche au schéma** ; les huit autres points sont des réparations confinées à `js/ui/gm/`
et `js/render/`. À garder en tête si le temps manque : c'est elle qu'on décale, pas les autres.

---

## B. Les gestes de séance qui coûtent trop cher

### B-1 ⛔ Un gabarit posé ne peut pas être retiré seul — **appui long ET liste**

**Le fait.** Le store expose `placeTemplate`, `moveTemplate` et `clearTemplates` — rien d'autre. Le
seul bouton de retrait est « Effacer les gabarits de l'étage » (`js/ui/gm/templateTools.js:92`).

**Ce que ça coûte.** Retirer le cône du sort qui vient d'être résolu **efface aussi** la zone de
ténèbres posée deux tours plus tôt. Le MJ a le choix entre laisser la carte se remplir de formes
mortes, ou tout perdre.

**✅ Décision : les deux voies.** L'appui long sur un gabarit le retire — le geste existe déjà pour
verrouiller une porte, la désignation existe déjà (`findHitTemplate`), il ne manque qu'un
`removeTemplate` au store. Et une liste des gabarits posés dans l'onglet, avec un bouton par ligne,
comme la liste des liaisons — comme **filet** pour le gabarit qui se trouve sous un pion ou hors
écran, cas où l'appui long est inatteignable.

### B-2 Un PNJ créé apparaît toujours dans le coin de la carte — **poser au premier tap**

**Le fait.** Le générateur crée le pion en `cell: { a: 0, b: 0 }`, en dur
(`js/ui/gm/tokenMaker.js:506`). Aucun geste de positionnement n'existe dans le composant.

**Ce que ça coûte.** Un PNJ créé en cours de séance apparaît à l'angle de la carte — souvent hors
écran, souvent sous le brouillard — et il faut le glisser jusqu'à sa place sous les yeux de la table.

**✅ Décision : corriger.** Le mainteneur crée des pions en séance **selon les séances** : le gain
existe dans un cas et ne coûte rien dans l'autre. « Générer » arme l'outil, le pion se pose là où le
MJ tape — cohérent avec le gabarit, le ping et la pose d'extrémité de liaison, qui fonctionnent déjà
ainsi.

### B-3 Les points de vie coûtent un aller-retour carte → onglet — **barre permanente**

**Le fait.** Modifier les PV demande : sélectionner le pion sur la carte, aller dans l'onglet Pions,
saisir. Si le panneau servait à autre chose, c'est un changement d'onglet en plein combat — et le
geste le plus répété d'un combat.

**✅ Décision : une barre permanente**, visible dès qu'un pion est sélectionné, au même titre que la
barre d'étage. Elle ne porte que ce qui bouge en combat — PV et état de santé ; le panneau garde
l'édition complète.

⛔ **La bascule automatique vers l'onglet Pions est écartée**, et il ne faut pas y revenir :
`activateTab` appelle `disarmActiveTool`, donc sélectionner un pion casserait le pinceau de fog ou
l'éditeur de murs en cours d'usage.

### B-4 Le pinceau de fog est le seul outil qui ne se désarme jamais — **laissé tel quel**

**Le fait.** Ping, mesure, gabarit et pose de liaison se désarment automatiquement après leur geste.
Le pinceau de fog reste armé jusqu'à un reclic ou un changement d'onglet
(`js/ui/gm/fogTools.js:247-257`).

**✅ Décision : ne rien changer.** Le mainteneur révèle le brouillard au début puis y touche peu —
ce que confirmait déjà son relevé, deux ouvertures de l'onglet sur toute la séance. L'incohérence
existe, mais elle ne se paie pas dans son usage réel.

⚠ À rouvrir **si et seulement si** l'usage du fog change. Le jour où le brouillard se travaille au
fil de la séance, c'est le seul outil armé qui modifie ce que les joueurs voient, et son armement
silencieux devient un risque.

---

## C. La structure : préparer contre jouer

### C-1 ⭐ Dix onglets pour deux métiers — **deux modes, bascule en un geste**

**Le fait.** Six onglets ne servent qu'à la préparation (Cartes, UVTT, Image, Murs, Liaisons,
Grille), quatre à la séance (Pions, Handouts, Fog, Gabarits). Relevé de fréquentation réelle,
séance du 11/08, section 15 de `diag.html` :

| Onglet | Ouvertures | Métier |
|---|---|---|
| Image | 5 | préparation |
| Handouts | 5 | **séance** |
| Gabarits | 4 | **séance** |
| Pions | 3 | **séance** |
| Cartes | 2 | préparation |
| Fog | 2 | **séance** |
| Murs | 1 | préparation |
| UVTT · Liaisons · Grille | **0** | préparation |

⭐ **Les trois onglets à zéro ouverture sont tous des onglets de préparation.** Ce ne sont pas des
onglets inutiles : ce sont des outils de préparation, mesurés pendant une phase de jeu. Les
supprimer serait la mauvaise lecture du chiffre.

Le panneau avait d'ailleurs **déjà commencé à séparer les deux métiers sans le dire** : les gestes
de séance les plus rapides — changer d'étage, ping, mesure — sont hors des onglets, dans des barres
permanentes, et ouvrir une porte ne demande aucun outil.

**✅ Décision : deux modes, « Préparer » et « Jouer ».** Quatre onglets en jeu au lieu de dix, et
plus de mauvais clic possible en séance.

⛔ **Deux contraintes non négociables, l'une venant de l'usage et l'autre de l'acquis :**

1. Le mainteneur prépare **parfois en cours de partie**. La bascule doit donc tenir en **un seul
   geste** et **ne rien perdre au passage** — ni outil armé, ni saisie en cours, ni sélection.
   ⚠ Attention : `activateTab` désarme l'outil actif à chaque changement d'onglet. La bascule de
   mode ne doit pas hériter de ce comportement, sinon préparer en cours de partie coûte la reprise
   de l'outil qu'on avait sous la main.
2. **Ne pas retoucher l'accessibilité de la barre d'onglets.** Elle est conforme depuis R0-04 —
   `role="tablist"`, flèches, Début/Fin, focus visible — et sans débordement à 1024 et 1440 px
   (`tests/gmPanelOverflow.spec.mjs:45-46`). Le test de débordement doit rester vert aux deux
   largeurs, avec les deux modes.

⚠ Le relevé qui fonde cette décision date d'**une seule séance** et il est **antérieur au 13/08**,
date à laquelle l'onglet Grille a reçu le sélecteur de pavage. Un second relevé reste utile — la
section 15 de `diag.html` le produit sans rien installer — mais il ne conditionne plus la décision.

---

## D. Broutilles

### D-1 Trois `console.log` de diagnostic en production — **à retirer**

`js/ui/gm/fogTools.js:233,235,238` — `[FOG_TOOLS] btnHideAll clicked`, `levelId`, `fog: FOUND/NULL`.
Restes d'un débogage.

### D-2 Le manifeste annonce un fichier qui n'existe pas — **extraire le composant**

**Le fait.** `docs/ARCHITECTURE.md` liste `js/ui/gm/levelSelector.js` [3]. Le répertoire contient dix
fichiers et celui-là n'en fait pas partie : la barre d'étage vit dans `panel.js:95-100` et
`1238-1308`. Le manifeste est **normatif et fermé** ; une ligne fantôme y est plus grave
qu'ailleurs, parce que c'est lui qu'on lit pour savoir où poser du code.

⚠ La garde automatique ne l'a pas vu et ne pouvait pas : elle vérifie que **tout fichier de `js/`
figure au manifeste**, pas l'inverse.

**✅ Décision : extraire réellement le composant.** `panel.js` va grossir avec les deux modes et la
barre des PV ; sortir la barre d'étage dans son fichier va dans le sens du rangement, et le
manifeste redevient vrai sans qu'on lui retire rien. À faire dans la même tranche que C-1 et B-3.

---

## Ce qui n'a pas été retenu, et pourquoi — à ne pas rouvrir sans raison neuve

- **La pénombre graduée** (A-2 option b) : le seul chemin de cet audit où une erreur montre aux
  joueurs ce qu'ils ne devraient pas voir, pour une nuance que personne n'a réclamée.
- **La bascule automatique vers l'onglet Pions** (B-3 option c) : elle désarmerait l'outil en cours.
- **Le désarmement automatique du pinceau de fog** (B-4 option b) : sans objet dans l'usage réel du
  mainteneur, à rouvrir seulement si cet usage change.
- **Deux groupes visuels dans une barre unique** (C-1 option b) : moins cher, mais la barre reste
  longue et rien n'empêche d'ouvrir un outil de préparation au mauvais moment.
- **Retirer la forme « ligne »** (A-3 option a) : c'était ma recommandation, le mainteneur a l'usage
  de la forme et a tranché dans l'autre sens.

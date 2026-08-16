# Brief Gemini — ergonomie du panneau MJ

> Écrit le 16 août 2026, après l'audit `docs/AUDIT-UX-MJ.md`, **dépouillé et tranché avec le
> mainteneur le jour même**. Neuf tâches, dans l'ordre d'exécution. Les décisions sont prises : ce
> document dit quoi faire, l'audit dit pourquoi.
>
> ⛔ **Ne rouvre aucune décision de l'audit.** Sa dernière section liste les options écartées avec
> leur raison. Si une te paraît meilleure, dis-le dans ton rapport — ne la mets pas en œuvre.

## Règles de travail, non négociables

- **Une tâche à la fois**, dans l'ordre de ce document. Ne pas anticiper la suivante.
- **Rapport de 3 lignes** en fin de tâche : ce qui a changé, comment c'est vérifié, ce qui reste.
- **Zéro commit.** Les modifications restent en arbre de travail pour relecture.
- **Arrêt obligatoire à chaque ⛔ marqué « point d'arrêt ».** Les autres ⛔ sont des interdits, pas
  des arrêts : ils se respectent sans rien demander.
- **`pnpm run verify` doit passer** avant de rendre le rapport. Pas `test:unit` seul : un lot entier
  est déjà passé avec quatre tests navigateur rouges.
- ⛔ **Un seul worker Playwright, jamais plus.** La machine du mainteneur est un poste de travail et
  le parallélisme l'a fait planter deux fois. La configuration s'en charge — ne la contourne pas.
- **Preuve par mutation exigée** sur toute assertion qui porte un risque : casse volontairement le
  code, vérifie que le test rougit **et pour la bonne raison**, révoque. Un test qui ne peut pas
  échouer ne prouve rien — ce dépôt a déjà attrapé 12 faux verts, dont un mock qui implémentait
  l'inverse du mécanisme testé. Dans ton rapport : ce que tu as muté, et la réponse exacte du test.
- **Les interdictions de `docs/CONVENTIONS.md` §8 s'appliquent en permanence.** Celles qui mordent
  ici sont citées tâche par tâche.

## Trois faits d'usage qui expliquent tout le reste

Recueillis auprès du mainteneur le 16/08. Ils ne se lisent nulle part dans le code, et ils ont
décidé trois des neuf tâches. ⛔ Ne pas les redemander, ne pas les contredire.

1. Il crée des PNJ en séance **selon les séances** — parfois oui, parfois tout est prêt d'avance.
2. Il révèle le brouillard **au début** et n'y touche presque plus.
3. Il prépare ses cartes **parfois en cours de partie**. ⭐ C'est la contrainte la plus dure de tout
   le lot : voir UX-03.

---

# UX-01 — L'onglet « Image » accepte une adresse et la publie à la table

**À faire en premier.** C'est le seul défaut de ce lot dont on puisse dire qu'il a coûté du temps de
jeu : cinq ouvertures de cet onglet dans une seule séance, cinq échecs silencieux.

> ⚠ **Cette tâche a été réécrite le 16/08/2026, après un premier plan d'implémentation.** Ce plan
> câblait `BackgroundLayer.setImage()` avec une image locale et `imageUrl` laissé vide. Il était
> juste sur la borne de persistance, mais il ne livrait qu'un **aperçu côté MJ** : la tablette
> serait restée grise. Le mainteneur a tranché — « qu'elle devienne visible aux joueurs, sinon ça
> n'a pas d'intérêt ». ⛔ Ne reviens donc pas à `setImage` : ce n'est pas le chemin.

## Le défaut

`js/ui/gm/importPanel.js:392-407` — le bouton de validation appelle `createLevel({...})` **sans
`imageUrl`**. L'image décodée ne sert qu'à l'aperçu de calibration de 300 × 180 px et n'est jamais
remise au moteur. Le MJ voit son image dans l'aperçu, valide, et obtient le gris neutre `#34383f` de
`js/render/layers/background.js` avec la grille peinte par-dessus.

## ⛔ Pourquoi une image locale ne peut pas marcher, et qu'il ne faut pas réessayer

Pour que la **tablette** affiche la carte, `imageUrl` doit être une adresse qu'elle peut aller
chercher elle-même. Elle ne partage ni le disque du MJ ni sa mémoire.

Y mettre l'image elle-même est fermé par la borne de persistance : les assets persistés sont limités
aux URL **relatives ou HTTPS**, la seule exception étant l'image de pion embarquée et **bornée**,
avec un plafond cumulé de 512 Kio. Une carte le fait sauter d'un coup. `assertNoTransientAssetUrls`
refuse d'ailleurs tout `data:` et `blob:` sur le réseau.

## Ce qu'il faut faire

L'onglet Image devient un champ d'**adresse**, sur le modèle exact de l'onglet Handouts — qui résout
déjà ce problème, et que le mainteneur utilise déjà en séance.

1. Un champ d'URL remplace le sélecteur de fichier local. HTTPS, ou lien Google Drive.
2. Les fonctions d'URL sont **déjà dans `js/core/schema.js`** : `normalizeImageUrl` (ligne 624),
   `isUnusableGoogleDriveUrl` (652) et `isPersistableAssetUrl` (558). ⛔ Ne les duplique pas et ne
   les prends pas dans `handouts.js` — une version antérieure de ce brief demandait de les importer
   depuis là, c'était **faux** : `core/` est leur domicile, et l'y prendre supprime au passage toute
   question d'import entre deux modules de `js/ui/gm/`.
3. La **sonde de chargement asynchrone** de `handouts.js` est à reprendre aussi : elle dit au MJ que
   l'adresse ne répond pas. ⭐ Sans elle, on remplace un échec silencieux par un autre — le MJ
   valide une adresse morte et la table voit du gris, exactement le défaut qu'on corrige.
4. L'aperçu de calibration se construit à partir de cette adresse.
5. À la validation, `createLevel({ ..., imageUrl: <adresse normalisée> })`, `store.addLevel(level)`,
   **et la publication réseau** — voir ci-dessous, elle n'existe pas.

⭐ **Le modèle est à cinq lignes de toi, dans le même fichier** : la branche UVTT demande déjà
« Indiquez l'URL publiée pour ajouter cet étage à la campagne » (`importPanel.js:225`). Elle fait
honnêtement le partage entre l'aperçu local et l'adresse publiée. Reprends sa structure et son
vocabulaire plutôt que d'en inventer d'autres.

## ⛔ Le trou plus gros que le défaut d'origine : **rien ne publie**

Vérifié le 16/08, et ce n'était pas dans la première version de ce brief.

`js/ui/gm/panel.js:495-496` monte les deux onglets d'import **sans aucune option** :
`createImportPanel(uvttMount, { mode: 'uvtt' })` et `createImportPanel(imageMount, { mode: 'image' })`.

Conséquences, toutes vérifiées :
- le rappel `onImportImage` est **déclaré** dans le typedef et **appelé** (`importPanel.js:421-422`),
  mais **personne ne le fournit** : c'est du code mort ;
- **aucun événement réseau n'est publié** par l'un ou l'autre onglet. Ni `level.add`, ni rien ;
- donc, même avec un `imageUrl` correct, **la tablette ne recevrait rien** tant que la séance dure.
  Elle ne verrait l'étage qu'au prochain instantané complet, c'est-à-dire à un rechargement.

⭐ Corriger `imageUrl` sans ajouter la publication ne changerait **rien** pour la table. C'est la
moitié invisible de UX-01, et c'est elle qui décide du critère 2.

`createHandouts(panel.js:498)` reçoit déjà `transport` en option : **c'est le voisin immédiat et le
modèle à suivre**. Passer `transport` à `createImportPanel` est donc cohérent avec ce fichier.
⚠ Si tu publies depuis le composant, ne laisse pas en plus un `options.onImportImage?.(level)` qui
n'est câblé nulle part : ou tu le branches, ou tu le retires. Du code mort qui ressemble à un
mécanisme est pire que pas de mécanisme.

## ⛔ Le réducteur `level.add` n'est pas gardé, et tu vas lui donner du trafic

`js/app/networkEvents.js:68-72`, en entier :

```js
case 'level.add': {
  if (!payload.level) return false;
  store.addLevel(payload.level);
  return true;
}
```

Aucune validation au-delà de la présence du champ, **aucun `try`/`catch`**. Ses voisins en ont un,
et le commentaire de `link.traverse` dit pourquoi : « Le laisser lever emporterait le réducteur et,
avec lui, tous les événements suivants du lot. »

Cet événement n'était **jamais émis**. UX-01 en fait un événement de séance. **Durcis-le dans la
même tâche** : valider la forme avant de muter, envelopper `addLevel`, journaliser le refus avec sa
raison, rendre `false`. Un étage malformé venu du réseau ne doit pas emporter le lot d'événements
qui le suit.

## ⛔ `store.addLevel` sélectionne l'étage qu'il ajoute, et il ne doit plus le faire

> ⚠ **Corrigé le 16/08/2026 après une décision du mainteneur, alors que cette tâche était en cours
> d'écriture.** Une version antérieure de ce brief disait que la bascule immédiate était
> « probablement ce qu'on veut ». **C'est faux.**

`store.addLevel` sélectionne l'étage qu'il ajoute. Comme la vue joueurs suit l'étage actif, un
import en séance **bascule toute la table sur la nouvelle carte à la seconde où le MJ valide**.

Décision du mainteneur, mot pour mot : « quand je rajoute un étage, la map ne doit pas s'afficher
immédiatement côté joueur, seulement quand ils iront (par eux-même ou par moi) ».

⭐ **Ajouter un étage est un acte de préparation, pas un acte de séance.** Personne ne doit être
déplacé parce que le MJ a préparé le niveau suivant. Les joueurs y vont quand ils y vont — par un
escalier, ou parce que le MJ les y emmène avec la barre d'étage.

**Ce qu'il faut faire** : `addLevel` ne sélectionne l'étage ajouté **que s'il n'y avait pas d'étage
actif** — c'est-à-dire à l'initialisation d'une campagne, le seul cas où quelqu'un doit bien être
choisi. Si un étage est déjà actif, sur le poste MJ comme sur la tablette, il le reste.

⚠ **Cette règle vaut pour les deux chemins**, le local et le réseau. Ne la mets pas seulement dans
le réducteur `level.add` : le poste MJ passe par `store.addLevel` en direct, et il ne doit pas
sauter non plus.

## ⛔ Décisions déjà prises, à ne pas rouvrir

- **Le sélecteur de fichier local disparaît de cet onglet.** Garder les deux chemins reproduirait
  exactement le mensonge qu'on corrige : un aperçu qu'on prend pour un import. La calibration d'un
  fichier local vit dans l'outil de préparation (`prepare.html`), qui sait écrire sur le disque —
  et c'est cohérent avec la séparation « Préparer / Jouer » d'UX-03.
- **L'envoi de fichier vers un hébergement** (Firebase Storage ou autre) est écarté **pour cette
  tranche**, pas pour toujours. Il demanderait un produit de plus, ses règles et un amendement à
  `docs/STACK.md`. C'est un chantier à part entière.

## ⚠ Deux pièges techniques

- **CORS, et aucun test ne peut l'attraper.** Une image d'une autre origine se **dessine** sans
  problème mais **ne se lit pas** au pixel : tout `getImageData` sur elle souille le canvas et lève.
  Vérifie que le chemin de calibration ne lit aucun pixel de l'image ; s'il le fait aujourd'hui, il
  faut l'en priver.
  ⛔ **C'est le piège le plus vicieux de cette tâche** : ton test e2e servira une image de fixture
  **de la même origine**, donc il ne déclenchera jamais la souillure — il sera vert pendant que le
  premier lien Google Drive réel lèvera en séance. Ne conclus pas de ce vert que le chemin est sûr :
  la garantie doit venir de la **lecture du code**, pas du test. Dis dans ton rapport quels appels
  tu as vérifiés.
- **`isPersistableAssetUrl`** est le juge de ce qui entre dans la campagne. L'adresse normalisée
  doit lui plaire **avant** d'atteindre `createLevel`, sinon l'échec surviendra plus tard, ailleurs,
  et sera illisible.

## ⛔ Le test qui certifie le bug

`tests/gmPanel.spec.mjs:227` asserte `imageUrl === ''`. **Ce test valide le défaut.** Il est à
reprendre dans le même travail.

## Critères d'acceptation

1. Après validation d'une adresse dans l'onglet Image, `imageUrl` porte l'adresse normalisée dans la
   campagne.
2. ⭐ **La vue joueurs REÇOIT l'étage** — il apparaît dans sa campagne, avec son `imageUrl` — mais
   **elle ne bascule pas dessus et n'affiche pas l'image**. Elle reste sur l'étage où elle était.
   C'est le critère qui distingue ce travail des deux plans d'implémentation précédents : le premier
   ne livrait rien à la table, le second l'y aurait téléportée.
3. ⭐ **Puis le MJ change d'étage par la barre, et alors seulement la tablette affiche la carte.**
   Ce second temps prouve que l'image est bien arrivée et bien lisible — sans lui, le critère 2 ne
   distingue pas « reçue » de « perdue ».
4. À l'initialisation d'une campagne vide, en revanche, le premier étage ajouté **est** sélectionné :
   il faut bien que quelqu'un le soit.
5. Un lien Google Drive est converti et fonctionne comme une URL HTTPS directe.
6. Une adresse qui ne répond pas est **signalée au MJ**, et n'est pas publiée en silence.
7. Le comportement de l'onglet **UVTT** est inchangé : il reste un diagnostic et continue de
   produire `imageUrl: ''`.
8. `tests/gmPanel.spec.mjs` ne certifie plus le bug et couvre le nouveau comportement.
9. **Deux preuves par mutation.** (a) Coupe la propagation de `imageUrl` et vérifie que le critère 3
   rougit — côté joueurs, pas côté MJ ; un test qui ne regarde que l'écran du MJ serait passé au vert
   sur le premier plan, qui ne livrait rien à la table. (b) Fais sélectionner l'étage ajouté même
   quand un étage est déjà actif, et vérifie que le critère 2 rougit. ⚠ Sans cette seconde mutation,
   rien ne défend la règle « ajouter n'emmène personne », et elle se reperdra.

---

# UX-02 — Extraire la barre d'étage dans `js/ui/gm/levelSelector.js`

**Refactor pur, aucun changement de comportement.** Il précède UX-03 et UX-04 parce que ces deux-là
vont faire grossir `panel.js`, déjà très gros.

## Le fait

`docs/ARCHITECTURE.md` liste `js/ui/gm/levelSelector.js` [3]. **Le fichier n'existe pas** : la barre
d'étage vit dans `panel.js:95-100` (le HTML) et `panel.js:1238-1308` (le sélecteur, le cadenas de
bascule automatique, la logique de rafraîchissement).

⚠ La garde automatique ne l'a pas vu et ne pouvait pas : elle vérifie que **tout fichier de `js/`
figure au manifeste**, pas l'inverse.

## Ce qu'il faut faire

Créer `js/ui/gm/levelSelector.js` sur le modèle des autres composants du répertoire — `createXxx(container, options)`, aucun accès direct au store ni au transport, tout passe par des rappels
injectés (`linkEditor.js` est le modèle le plus proche).

Y déplacer : le HTML de la barre, le sélecteur d'étage, le cadenas 🔒/🔓 et son état
`levelFollowLocked`.

⛔ **N'essaie PAS de le rendre réutilisable par la vue joueurs.** UX-12 leur donnera un sélecteur
d'étage, mais **d'une autre forme** — barre d'onglets défilable, cibles tactiles de 44 px, liste
filtrée par les étages connus, aucun cadenas. Chercher un composant commun aux deux maintenant
produirait une abstraction gouvernée par des besoins dont un seul existe. Extrais la barre du MJ
telle qu'elle est ; la mise en commun, si elle a lieu un jour, se décidera quand les deux formes
existeront.

⛔ **Le cadenas reste local au poste MJ et n'entre PAS dans la campagne.** C'est un réglage de
conduite de séance, pas un fait de jeu ; le mettre dans le document le ferait voyager jusqu'aux
tablettes et survivre à la partie. Le commentaire qui l'explique est dans `panel.js` — déplace-le
avec le code, ne le laisse pas orphelin.

## Critères d'acceptation

1. Le fichier existe, et le manifeste redevient vrai sans qu'on lui retire une ligne.
2. **Aucun changement de comportement** : `tests/levelSwitch.spec.mjs` et
   `tests/multiLevelJourney.spec.mjs` passent sans être modifiés. Si tu dois en toucher un, c'est
   que ce n'est plus un refactor — **arrête-toi et dis-le**.
3. `pnpm run check-deps` reste vert (cohérence des import maps).

---

# UX-03 — Deux modes : « Préparer » et « Jouer »

⭐ La plus grosse tâche du lot, et celle qui porte la contrainte la plus dure.

## Le constat

Six onglets ne servent qu'à la préparation, quatre à la séance. Relevé de fréquentation réelle sur
la séance du 11/08 (section 15 de `diag.html`) : Image 5, Handouts 5, Gabarits 4, Pions 3, Cartes 2,
Fog 2, Murs 1, et **UVTT, Liaisons, Grille à zéro**.

⭐ Les trois onglets à zéro sont **tous des onglets de préparation**, mesurés pendant une phase de
jeu. ⛔ **Ne les supprime pas** — ce serait la mauvaise lecture du chiffre.

## Ce qu'il faut faire

Un basculement à deux positions, en tête du panneau, qui change le jeu d'onglets affichés :

| Mode | Onglets |
|---|---|
| **Jouer** | Pions, Handouts, Fog, Gabarits |
| **Préparer** | Cartes, UVTT, Image, Murs, Liaisons, Grille |

Les barres permanentes — session, ambiance, étage, gestes de séance — restent visibles dans les deux
modes.

## ⛔ Contrainte n°1, qui vient de l'usage : la bascule ne doit RIEN perdre

Le mainteneur prépare **parfois en cours de partie**. La bascule doit donc tenir en **un seul geste**
et ne coûter aucun état.

⚠ **Le piège est déjà dans le code** : `activateTab` (`panel.js:436-439`) appelle
`disarmActiveTool()` à chaque changement d'onglet — c'est l'amendement A3, et il est justifié pour
les onglets. **La bascule de mode ne doit pas en hériter.** Si elle désarme l'outil actif, préparer
un mur en pleine partie coûte la reprise du pinceau qu'on avait sous la main, et le geste devient
plus cher qu'avant.

À vérifier explicitement : armer un outil, basculer en « Préparer », revenir en « Jouer » →
**l'outil est toujours armé**, et l'indicateur d'onglet le montre toujours.

Idem pour une saisie en cours : passer en « Jouer » puis revenir ne doit pas vider les champs de
l'éditeur de liaisons ni ceux de l'import.

## ⛔ Contrainte n°2, qui vient de l'acquis : l'accessibilité est conforme, n'y touche pas

La barre d'onglets est conforme depuis R0-04 — `role="tablist"`, `role="tab"`, `aria-selected`,
`aria-controls`, `tabindex` glissant, flèches gauche/droite, Début/Fin, focus visible. **Elle reste
telle quelle**, avec un jeu d'onglets plus court.

`tests/gmPanelOverflow.spec.mjs:45-46` vérifie l'absence de débordement à **1024 et 1440 px**. Il
doit rester vert **dans les deux modes** — donc il doit être étendu pour les parcourir tous les
deux, pas seulement celui affiché par défaut.

## Décisions que j'ai prises pour toi

- **Le mode par défaut au chargement est « Jouer ».** C'est l'état dans lequel on ouvre le panneau
  le plus souvent, et le seul où un mauvais clic coûte quelque chose devant la table.
- **Le mode est local au poste, comme le cadenas d'étage** : ni dans la campagne, ni sur le réseau.
  Il peut être retenu en `localStorage` si tu veux, mais ce n'est pas demandé.
- **Le basculement est un contrôle à deux boutons** (« Préparer » / « Jouer ») dans la barre de
  session, au-dessus de la barre d'onglets. Pas un menu déroulant : deux positions se lisent d'un
  coup d'œil, un menu demande de l'ouvrir pour savoir où l'on est.

## Critères d'acceptation

1. Quatre onglets en mode Jouer, six en mode Préparer, dans l'ordre du tableau ci-dessus.
2. Un outil armé **survit** à un aller-retour entre les deux modes. ⭐ C'est le critère qui compte
   le plus, et le seul qui vienne d'un fait d'usage.
3. Une saisie en cours survit à un aller-retour.
4. `tests/gmPanelOverflow.spec.mjs` vert à 1024 et 1440 px, **dans les deux modes**.
5. Les attributs ARIA de la barre d'onglets sont inchangés, et la navigation au clavier fonctionne
   dans les deux modes.
6. **Preuve par mutation** : fais que la bascule appelle `disarmActiveTool()`, et vérifie que le
   critère 2 rougit. C'est la régression la plus probable de toute cette tâche.

---

# UX-04 — Une barre permanente pour les points de vie

## Le besoin

Modifier les PV d'un pion demande aujourd'hui : le sélectionner sur la carte, aller dans l'onglet
Pions, saisir. C'est le geste le plus répété d'un combat, et le seul qui se paie à chaque coup porté.

## Ce qu'il faut faire

Une barre permanente, visible **dès qu'un pion est sélectionné** et masquée sinon, sur le modèle de
la barre d'étage (masquée tant qu'il n'y a qu'un seul étage).

Elle porte **uniquement ce qui bouge en combat**. Le panneau garde l'édition complète — nom, image,
taille, vitesse, vision, marqueurs.

## ⛔ L'interdiction qui mord ici, et elle est facile à mal lire

`CONVENTIONS.md` §8 interdiction n°4 : « ni barre de points de vie **sur un PNJ** ».

⚠ **Cette interdiction porte sur le rendu du pion sur le canvas**, pas sur le panneau MJ. Elle vient
du chantier Q : anneau proportionnel réservé aux PJ, état de santé à trois crans manuels pour les
PNJ, sans dérivation de `health` depuis `hp`. Le panneau MJ édite déjà la santé d'un PNJ par trois
boutons radio, et c'est légitime.

Donc, dans la barre permanente :
- pion **PJ** → PV courants et PV max ;
- pion **PNJ** → les trois crans de santé, **jamais** des PV chiffrés.

⛔ Ne dérive **jamais** `health` depuis `hp`, dans aucun sens.

## ⛔ Ce qui est écarté, et qu'il ne faut pas ramener

**La bascule automatique vers l'onglet Pions quand un pion est sélectionné.** Elle passerait par
`activateTab`, donc par `disarmActiveTool` : sélectionner un pion casserait le pinceau de fog ou
l'éditeur de murs en cours d'usage.

## Critères d'acceptation

1. La barre apparaît à la sélection d'un pion et disparaît à la désélection.
2. PV chiffrés pour un PJ, trois crans pour un PNJ, jamais l'inverse.
3. Modifier une valeur dans la barre **n'affecte aucun outil armé**.
4. La valeur saisie se propage à la vue joueurs comme le fait déjà le panneau — même événement
   réseau, pas un nouveau.
5. `tests/gmPanelOverflow.spec.mjs` reste vert aux deux largeurs, barre affichée.
6. **Preuve par mutation** : fais afficher des PV chiffrés pour un PNJ et vérifie qu'un test rougit.

---

# UX-05 — Retirer un gabarit : appui long et liste

## Le besoin

Le store expose `placeTemplate`, `moveTemplate` et `clearTemplates` — rien d'autre. Le seul retrait
possible est « Effacer les gabarits de l'étage » (`js/ui/gm/templateTools.js:92`). Retirer le cône
d'un sort résolu **efface aussi** la zone de ténèbres posée deux tours plus tôt.

## Ce qu'il faut faire, dans cet ordre

1. **`store.removeTemplate(templateId)`** — sur le modèle de `removeLink` : absence idempotente qui
   ne notifie pas, mutation transactionnelle sur une copie, validation avant remplacement.
2. **L'événement réseau `template.remove`** — même forme que `template.clear`, validé avant
   mutation, **idempotent au rejeu** (`docs/CONVENTIONS.md` §4). Un événement qui retire un gabarit
   déjà retiré rend `false` sans lever.
3. **L'appui long sur un gabarit le retire**, côté MJ. La désignation existe déjà
   (`findHitTemplate`), le geste d'appui long existe déjà (`js/input/pointer.js` l'émet, et le MJ
   s'en sert pour verrouiller une porte).
4. **La liste des gabarits posés** dans l'onglet Gabarits, avec un bouton de suppression par ligne,
   sur le modèle exact de la liste des liaisons (`linkEditor.js`).

## ⛔ Pourquoi les deux, et pas seulement l'appui long

Le mainteneur a explicitement demandé les deux. La liste est le **filet** : un gabarit sous un pion,
ou hors de l'écran, n'est pas atteignable à l'appui long. Sans elle, il reste des cas sans issue —
et c'est exactement le genre de cas qui se découvre en séance, devant la table.

## ⛔ Le conflit de gestes à vérifier

L'appui long MJ sert **déjà** à verrouiller une porte. Un gabarit posé sur une porte crée une
ambiguïté. Tranche en faveur de **la porte** — c'est le geste le plus ancien et le plus utilisé — et
écris la règle en commentaire à l'endroit qui arbitre. Le cas doit être couvert par un test.

## Critères d'acceptation

1. Un appui long sur un gabarit le retire, et **lui seul** : les autres gabarits de l'étage restent.
2. Le bouton de la liste retire le même gabarit, avec le même résultat.
3. Le retrait se propage aux joueurs, et le rejeu de l'événement est sans effet.
4. Un gabarit posé sur une porte : l'appui long verrouille **la porte**, pas le gabarit.
5. **Preuve par mutation** : fais retirer le premier gabarit du tableau au lieu de celui désigné, et
   vérifie qu'un test rougit. ⚠ Un test qui ne pose qu'un seul gabarit ne peut pas attraper cette
   faute-là — il en faut au moins deux.

---

# UX-06 — La forme « ligne » des gabarits

⭐ **La seule fonctionnalité neuve de tout ce lot** ; les huit autres tâches sont des réparations.
Si le temps manque, c'est celle-ci qu'on décale — pas les autres.

⚠ **Et c'est la seule qui touche au schéma**, depuis l'ajout de la largeur réglable le 16/08. Elle
traverse donc `js/core/schema.js`, `js/core/types.js`, `js/app/networkEvents.js` et la persistance,
là où les autres tâches restent dans `js/ui/gm/` et `js/render/`. À budgéter comme telle.

## Le fait

`js/ui/gm/templateTools.js:55` porte `<option value="line" disabled>Ligne (bientôt)</option>`,
grisée depuis le lot 2. Le gestionnaire n'accepte que `circle` et `cone`.

Le mainteneur en a l'usage — mur de feu, souffle, ligne de tir — et a tranché pour l'implémenter
contre ma recommandation, qui était de retirer l'option faute de demande.

## Décisions du mainteneur, prises le 16/08 — le point d'arrêt est levé

- **Géométrie** : un rectangle partant de `origin`, de longueur `radius` cases, orienté par
  `directionDeg`, et de `widthCells` cases de large.
- **Largeur réglable, valeur par défaut 1.** ⚠ C'est **un champ de plus au schéma** — donc à la
  validation, à l'événement réseau et à la persistance. Ce n'est plus une tranche de rendu seul.
- **L'origine peut être libre ou prise sur un pion**, au choix du geste et sans mode ni case à
  cocher : voir la règle ci-dessous.
- **Même découpe par les murs que le cône.** Le `ctx.clip()` de la couche des gabarits est protégé
  par un test e2e d'occlusion : la ligne doit y entrer, pas le contourner.

## Le champ `widthCells`

- Entier positif, **défaut 1**.
- Validé quand il est présent, **quelle que soit la forme** ; seul le rendu de la ligne le lit. Le
  cercle et le cône l'ignorent — n'invente pas un schéma par forme pour un seul champ.
- ⛔ **Compatibilité** : les gabarits déjà enregistrés ne le portent pas. Leur absence vaut 1 et ne
  doit **jamais** faire échouer la validation. Un import qui rejetterait une campagne existante
  serait une régression plus chère que la fonction ajoutée.
- Il voyage dans `template.place`. Il n'a rien à faire dans `template.move`, qui ne porte que
  l'origine et la direction.
- Côté panneau : un champ numéraire avec ses valeurs rapides, sur le modèle exact du rayon, et
  **visible seulement quand la forme est « ligne »**.

## ⛔ Partir d'un pion : une règle de geste, aucun champ de plus

Le mainteneur a tranché : **le pion sert de point de départ, la ligne ne lui reste PAS attachée.**
Une fois posée, elle se déplace et pivote à la main comme les autres gabarits.

La règle à implanter tient en une phrase : **l'outil de pose étant armé, si le tap tombe sur un
pion, l'origine s'accroche au centre de ce pion ; sinon elle reste là où le doigt s'est posé.**

⛔ **N'ajoute donc ni champ d'ancrage, ni identifiant de pion dans le gabarit, ni case à cocher
« suivre le pion ».** L'option « la ligne suit le pion » a été explicitement écartée, avec ses trois
cas non tranchés — pion supprimé, pion qui change d'étage, pion masqué — et son conflit avec le
glisser de gabarit qui existe déjà côté joueurs.

## Critères d'acceptation

1. L'option n'est plus `disabled` et la forme se pose, se déplace et pivote comme le cône.
2. La ligne est découpée par les murs, vérifié par une sonde de pixels comme l'est déjà le cône.
3. Le rayon, la largeur, la couleur et la visibilité joueurs s'appliquent tous les quatre.
4. Une ligne posée sur un pion a son origine au **centre** de ce pion ; posée sur une case vide,
   elle a son origine sous le doigt.
5. Un gabarit chargé **sans** `widthCells` se valide et vaut 1.
6. Un `widthCells` invalide — zéro, négatif, fractionnaire — est refusé par le schéma avec un
   message qui nomme le gabarit.
7. **Deux preuves par mutation** : retire le `ctx.clip()` et vérifie que le test d'occlusion rougit ;
   puis force `widthCells` à 1 dans le rendu et vérifie qu'un test de largeur rougit. ⚠ Sans cette
   seconde mutation, un rendu qui ignorerait la largeur passerait au vert.

---

# UX-07 — Le curseur « Ambiance » devient une bascule jour / nuit

## Le fait

Le curseur offre 21 positions de 0 à 1 par pas de 0,05. Le moteur en lit **une seule chose**, dans
`js/render/layers/fogLayer.js` : `baked || level > 0`. **0,05 et 1,00 sont rigoureusement
indistinguables** ; le seul cran qui change quoi que ce soit est le passage par zéro.

## Ce qu'il faut faire

Remplacer le curseur par une bascule à deux états. L'interface dit enfin ce que le moteur fait.

Supprimer aussi **`ambient.color`** : importé, validé, persisté, et **lu par aucun rendu**. Il
n'attendait que la pénombre graduée, qui est écartée. C'est le même profil que `settings.ambientLevel`,
supprimé pour cette raison à la question §12 q.4 du cahier des charges.

## ⛔ Ce qui est écarté, et pourquoi il ne faut pas y revenir

**La pénombre graduée.** C'est le seul chemin de tout cet audit où une erreur fait voir aux joueurs
ce qu'ils ne devraient pas voir. Personne n'a réclamé la nuance en séance.

## ⛔ La compatibilité des campagnes existantes

Les campagnes déjà enregistrées portent un `ambient.level` fractionnaire et un `ambient.color`. La
lecture doit continuer de les accepter : **tout `level > 0` devient « jour »**, et un `ambient.color`
présent est ignoré sans faire échouer la validation. Un import qui rejetterait une campagne
existante serait une régression bien plus chère que le défaut corrigé.

## Critères d'acceptation

1. La bascule à deux états produit exactement les deux comportements que le moteur distingue.
2. Une campagne enregistrée avec `ambient.level: 0.35` se charge et vaut « jour ».
3. Une campagne portant `ambient.color` se charge sans erreur.
4. Aucun rendu ne lit `ambient.color`, vérifié par recherche.

---

# UX-08 — Un pion créé se pose là où l'on tape

## Le fait

`js/ui/gm/tokenMaker.js:506` crée le pion en `cell: { a: 0, b: 0 }`, **en dur**. Aucun geste de
positionnement n'existe dans le composant : un PNJ créé en cours de séance apparaît à l'angle de la
carte — souvent hors écran, souvent sous le brouillard — et il faut le glisser jusqu'à sa place sous
les yeux de la table.

Le mainteneur crée des pions en séance **selon les séances** : le gain existe dans un cas et ne
coûte rien dans l'autre.

## Ce qu'il faut faire

« Générer » **arme l'outil** ; le pion se pose là où le MJ tape ensuite. C'est le comportement de
tout le reste du panneau — le gabarit, le ping, la pose d'extrémité A d'une liaison.

⛔ **L'armement passe par `setActiveTool`** (`panel.js:306-428`), comme tous les autres outils, et
non par un mécanisme parallèle. C'est ce qui garantit l'exclusivité mutuelle : armer la pose d'un
pion doit désarmer le pinceau de fog, et réciproquement.

⛔ **Désarmement automatique après la pose**, comme le gabarit et la pose de liaison — pas comme le
pinceau de fog, qui reste armé, et dont l'exception est assumée ailleurs.

## Critères d'acceptation

1. Le pion se pose sur la case tapée, jamais en (0,0).
2. Armer la pose d'un pion désarme l'outil précédent, et réciproquement.
3. L'outil se désarme seul après la pose.
4. Un changement d'onglet en cours d'armement désarme, comme pour les autres outils.
5. **Preuve par mutation** : remets la pose en dur en (0,0) et vérifie que le test rougit.

---

# UX-09 — Ménage : trois `console.log` de diagnostic en production

`js/ui/gm/fogTools.js:233, 235, 238` — `[FOG_TOOLS] btnHideAll clicked`, `levelId`,
`fog: FOUND/NULL`. Restes d'un débogage, à retirer.

⚠ **Ne retire pas les `console.error`** au passage : `docs/CONVENTIONS.md` §6 impose qu'une donnée
réseau inattendue se journalise et s'ignore. Ce sont deux choses différentes.

---

---

# Deuxième vague — les étages se découplent

> ⭐ **Ajoutée le 16/08/2026**, après les décisions prises pendant l'écriture de UX-01. Ces cinq
> tâches forment un ensemble : elles se tiennent, et l'ordre n'est pas négociable — chacune repose
> sur la précédente. Leur raison d'être est consignée en **C-7** et **C-8** de
> `docs/QUESTIONS-EN-ATTENTE.md`.
>
> ⛔ **Ne commence pas cette vague avant que UX-01 à UX-09 soient livrées et relues.** Elle touche
> l'étage actif, qui est le pivot des deux vues.

## La règle qui gouverne toute cette vague

⭐ **Rien ne se déplace dans le dos de personne.** Elle est née trois fois le même jour, sur trois
sujets sans rapport, et c'est ce qui en fait une règle et non une préférence :

- ajouter un étage n'emmène pas la table dessus ;
- importer une carte ne replace aucun pion ;
- franchir un escalier ne fait basculer aucun écran.

Quand un cas nouveau se présente et que ce brief ne le tranche pas, **applique cette règle** plutôt
que de demander.

---

# UX-10 — Découpler l'étage actif du MJ de celui des joueurs

## L'état actuel

Il n'y a **qu'un seul** `activeLevelId`, tenu par le store, et la vue joueurs suit celui du MJ. Le
MJ ne peut donc pas aller regarder un autre niveau — vérifier une carte, préparer la suite — sans y
emmener les six personnes qui le regardent.

## Ce qu'il faut faire

Donner à la vue joueurs **son propre étage affiché**, indépendant de celui du MJ.

⛔ **C'est un point de vue, pas un fait de jeu.** Il ne voyage donc **pas** sur le réseau et n'entre
**pas** dans le document de campagne — même raison que le cadenas d'étage du MJ, dont le commentaire
l'explique déjà. Il peut être retenu en stockage local pour survivre à un rechargement.

⚠ **Trois mécanismes reposent aujourd'hui sur le couplage. Relis-les AVANT d'écrire, pas après :**
- l'événement de sélection d'étage publié par la barre du MJ ;
- le cadenas 🔒, qui suspend la bascule automatique du MJ quand un pion change d'étage — son objet
  change de sens ici, il ne suspend plus le même couplage ;
- le franchissement de liaison, qui fait aujourd'hui suivre le MJ.

## ⛔ Le franchissement ne fait plus basculer personne

Un PJ qui monte un escalier ne déplace **aucun** écran. L'étage d'arrivée devient simplement
**connu** (voir UX-12) et donc offert dans le sélecteur des joueurs ; la table décide d'y aller.

Raison : la vue joueurs est **une seule tablette partagée**. Suivre le pion qui monte emmènerait
toute la table et abandonnerait les personnages restés en bas. Le pion monté cesse d'apparaître sur
l'étage affiché — c'est vrai, et c'est lisible.

## Critères d'acceptation

1. Le MJ change d'étage : la vue joueurs **ne bouge pas**.
2. Un PJ franchit une liaison : aucune des deux vues ne bascule ; le pion disparaît de l'étage
   affiché côté joueurs et apparaît sur l'étage d'arrivée quand on l'affiche.
3. L'étage affiché côté joueurs survit à un rechargement.
4. Rien de nouveau ne transite sur le réseau, et le document de campagne est inchangé — vérifié en
   lisant ce qui est publié, pas seulement l'état final.
5. **Preuve par mutation** : refais suivre la vue joueurs à celle du MJ, et vérifie que le critère 1
   rougit.

---

# UX-11 — ⛔ ÉCARTÉE le 16/08/2026 — ne pas la reprendre

**Le numéro est laissé en place exprès**, pour que ce cas ne soit pas « redécouvert » dans six mois
et traité par quelqu'un qui croira combler un oubli.

**Ce qu'elle proposait** : élargir `requestVisionResend` — qui ne réclame que l'étage actif — afin
qu'un poste joueurs **sans aucun stockage local** obtienne les masques explorés de tous les étages.

**Pourquoi elle est écartée.** Décision du mainteneur : « il est totalement inutile de traiter ce
cas spécifique. »

**Ce qui reste vrai, et qui suffit** : le masque exploré est persisté **par étage** sous
`rpg_fog_<sessionId>_<levelId>`, et `getSessionFog` retombe sur le stockage local
(`js/state/store.js:1356-1367`). Donc **un F5 de la tablette ne perd rien** — c'est le cas courant,
et il est déjà couvert.

**La conséquence assumée** : une tablette **neuve** — remplacement en pleine partie, stockage vidé,
navigation privée — n'affichera dans le sélecteur d'UX-12 que les étages dont elle aura reçu un
masque depuis son arrivée. ⚠ Ce n'est **pas un défaut à corriger**, c'est un cas jugé trop rare pour
son coût. Si tu le rencontres en écrivant UX-12, **ne le traite pas** : passe outre et signale-le.

---

# UX-12 — Le sélecteur d'étage de la vue joueurs

## ✅ Aucune dérogation à demander

⛔ L'interdiction n°2 de `docs/CONVENTIONS.md` — « ne jamais ajouter d'élément d'interface à la vue
joueurs » — **liste déjà le sélecteur d'étage** parmi ce qui a le droit de s'afficher. La convention
l'avait prévu ; il n'a jamais été construit. **N'ouvre pas de discussion là-dessus.**

## « Connu » se dérive, il ne s'invente pas

Un étage est **connu des joueurs** si son masque **exploré** existe et n'est pas vide. C'est
exactement la notion demandée : « un pion PJ **a obtenu** une ligne de vue », au passé. Un étage
visité puis quitté reste connu, et s'affiche dans son brouillard — le fog sait déjà peindre
« exploré sans vision courante » depuis L-04.

⛔ **N'ajoute donc ni champ de schéma, ni événement réseau, ni migration.**

## ⛔ Un étage inconnu est ABSENT, pas grisé

Le projet de référence (`E:\Projet_shadowrun`, `js/editor.js:318-352`, `js/store.js:1479-1483`)
retire purement les étages non révélés de la liste des joueurs. **Fais pareil**, et pour une raison
que la version grisée aurait ratée : un onglet « Étage 3 » verrouillé apprend aux joueurs qu'il
**existe** un troisième étage. C'est une fuite de la même famille que celles que le fog empêche.

## La forme, reprise de la référence

Barre horizontale d'onglets au-dessus de la carte, un bouton par étage portant son nom. Au repos :
fond transparent, bordure d'un pixel, `padding: 8px 16px`. Actif : fond plein, texte foncé, gras.
Barre **défilable horizontalement sans retour à la ligne**, cible tactile d'au moins **44 px** de
haut.

⛔ **Une chose à ne PAS copier de la référence : son accessibilité.** Elle n'a aucun `role`, aucun
`aria-*`, aucune gestion des flèches. La barre d'onglets MJ de ce dépôt est conforme depuis R0-04 :
le sélecteur joueurs doit l'être aussi. On reprend la forme, pas le retard.

## Critères d'acceptation

1. Seuls les étages au masque exploré non vide apparaissent ; les autres sont **absents du DOM**.
2. Un étage visité puis quitté reste offert, et s'affiche dans son brouillard exploré.
3. Choisir un étage ne publie rien et ne déplace pas la vue MJ.
4. `role="tablist"`, `aria-selected`, navigation aux flèches et focus visible, comme la barre MJ.
5. Cible tactile ≥ 44 px, barre défilable, aucun débordement.
6. **Preuve par mutation** : rends visible un étage au masque vide et vérifie que le critère 1
   rougit.

---

# UX-13 — « Remplacer l'étage courant » à l'import d'image

⛔ **Dépend de UX-14** : remplacer une carte renvoie les pions en réserve, et la réserve n'existe
pas encore. **Ne commence pas celle-ci avant.**

L'onglet Image propose deux gestes au choix : **ajouter un étage** — le comportement livré par
UX-01 — ou **remplacer l'étage courant**.

| | Les pions | La carte, côté joueurs |
|---|---|---|
| **Remplacer** | retournent **en réserve** | **affichée immédiatement**, quitte à être toute noire tant qu'aucun pion n'y porte de ligne de vue |
| **Ajouter** | ne bougent pas | **pas affichée** — déjà livré par UX-01 |

---

# UX-14 — La réserve de pions

⛔ **Point d'arrêt : demande avant d'écrire une ligne.** Trois questions ne sont pas tranchées, et
elles décident de la forme du schéma.

Un `Token` porte aujourd'hui un `levelId` **et** une `cell`, tous deux obligatoires et validés : un
pion est **toujours quelque part**. Il n'existe aucun endroit où poser un pion qui n'est sur aucune
carte.

Questions ouvertes, consignées en C-7 :

1. **Comment se représente un pion en réserve ?** Un `levelId` nul, qui casse un invariant partout,
   ou une collection séparée dans la campagne, qui le préserve mais duplique la forme du pion ?
2. **Qui la voit ?** Fait de jeu partagé, ou tiroir du seul poste MJ ? ⚠ Si elle est locale, elle ne
   survit pas à un F5 du MJ et les pions sont perdus.
3. **Le fog et la vision** : un pion en réserve n'émet ni vision ni lumière et ne doit compter dans
   aucun calcul. À vérifier partout où les pions sont balayés — `js/vision/`, `computeReachable`,
   `js/import/blockedEdges.js`.

⚠ **Ne confonds pas la réserve avec la bibliothèque de pions.** La bibliothèque tient des
**modèles** dont on instancie des copies ; la réserve tient **ces instances-là**, celles qui étaient
sur le plateau, avec leurs PV, leurs marqueurs et leur histoire.

⭐ **UX-08 est la moitié visible de cette tâche** : sortir un pion de la réserve, c'est le poser
quelque part. Les deux gestes n'en font qu'un.

---

## Ce que ce brief ne couvre pas, et qui attend ailleurs

Deux défauts trouvés le 16/08 **hors du périmètre de cet audit**, consignés dans
`docs/QUESTIONS-EN-ATTENTE.md`. ⛔ Ne les traite pas ici — chacun traverse assez de code pour
mériter sa propre séance.

- **C-5** — `mapFromCellPoint` rend un **coin** dans `SquareGrid` et un **centre** dans `HexGrid`,
  et le contrat `GridAdapter` ne tranche pas. Conséquence mesurée : un pion 1×1 fait 210 px de large
  en ligne paire et 70 en ligne impaire, à `pxPerCell` 140.
- **C-6** — `findHitToken` départage par identifiant, `exactTokenAtCell` prend le premier du
  tableau. Avec deux PJ empilés sur un escalier, c'est le mauvais qui franchit.

⚠ Si une tâche de ce brief te conduit à toucher `js/grid/` ou `js/input/tokenHit.js`,
**arrête-toi et signale-le** : tu es probablement en train d'entrer dans l'un de ces deux chantiers
sans le vouloir.

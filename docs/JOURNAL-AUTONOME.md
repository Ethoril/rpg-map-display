# JOURNAL DU CHANTIER AUTONOME

> Tenu à chaque tranche et à chaque arrêt, selon `CHANTIER-AUTONOME.md` §4.
> Écrit pour quelqu'un qui reprend **sans contexte frais**. Un arrêt bien expliqué vaut mieux
> qu'une tranche mal finie.

---

## 18 août 2026 — mise en place, M1 relevée, M2 implémentée

### Ce qui a été fait

**Le dispositif.** `CLAUDE.md`, les skills `/muter` et `/reprise`, le crochet `SessionStart`, et
l'ouverture de `.gitignore` pour que tout cela atteigne l'autre poste. Trois commits sur `main`,
poussés, CI lancée. Branche `autonome/2026-08` créée depuis `09ef591`.

**La question du canal Claude → Gemini est close**, par quatre sondes toutes négatives : le CLI de
l'IDE n'injecte pas de prompt, le tier gratuit du CLI Gemini a été fermé par Google, Antigravity ne
déclare pas la capacité MCP `sampling`, et le SDK `google-antigravity` exige une clé facturée à
l'acte. ⛔ **Ne pas refaire ces sondes** — détail en mémoire, `canal_gemini_antigravity`.

Un guetteur de boîte aux lettres reste utilisable **quand le mainteneur est présent** :
`bridge/attendre-message.ps1` et `bridge/PROTOCOLE.md`. Une impulsion de sa part achète une longue
séance d'allers-retours. Hors git, jetable.

**⭐ M1 relevée, et c'est le grand acquis de la journée.** Le compositing du fog coûte **1580 à
1700 ms par image** sur la Tab S9 FE, `testbig150`, vue joueurs — **plat quel que soit le zoom**,
donc ~50 fois le budget de 33 ms. Chiffres complets dans `PLAN-SUITE.md` §1. Deux conséquences :
le fog basse résolution devient **prioritaire**, et le « petit lag résiduel » clos le 16/08 avait
cette cause.

**M2 implémentée** (section 16 de `diag.html`) par un sous-agent, puis **relue et mutée par un
autre**. Trois fonctions pures exportées de `js/app/diag.js` ; les tests assertent le **basculement
du verdict**, pas un nombre intermédiaire. Mutation revérifiée indépendamment : retirer la
soustraction du vidage de pipeline fait rougir le test, la restauration le rend vert.

### ✅ Où exactement le travail s'est arrêté

**M2 est commitée et poussée** sur `autonome/2026-08` (`999ff2a`), suivie de la mesure M1 et des
observations de terrain (`727fe2e`). Arbre propre, rien en attente.

La porte a été passée **seule et jusqu'au bout**, code de sortie réel capturé hors de tout tube :
`CODE_REEL=0`, 205 e2e, 3 gestes. Deux passages antérieurs ont été écartés — l'un contaminé par une
mutation en vol, l'autre par une collision entre deux exécutions simultanées.

### Un point de vigilance sur M2

Pour rendre `diag.js` importable sous `node:test`, le câblage de fin de fichier a été enveloppé dans
`if (typeof document !== 'undefined')`. Vérifié : rien n'a disparu, tous les branchements sont
présents, et les e2e de `diag.spec.mjs` exercent la page. Mais c'est une modification du chemin réel
de la page pour un besoin de test — à regarder une fois de plus avant de committer.

### Ce qui attend, dans l'ordre

1. **Confirmer la porte, puis committer M2.**
2. **Instruire les deux régressions** de `PLAN-SUITE.md` §10 — l'import qui remplace sans demander,
   et le F5 nécessaire sur la tablette. Elles portent sur UX-13, livrée le matin même.
3. **Le fog basse résolution**, désormais prioritaire. Gros morceau : il mérite une session entière.

⛔ Aucune décision produit n'a été prise, et aucune ne doit l'être ici : modèle de lumière, sens de
`map_origin`, seuils de tuilage restent au mainteneur.

### ⚠ Deux pièges rencontrés en fin de séance, à ne pas refaire

**1. Un tube masque le code de sortie.** `pnpm run verify | tail -18` rend le code de `tail`, donc
**toujours 0** — le harnais annonçait « exit code 0 » sur une porte qui avait échoué. Capturer le
code réel : `pnpm run verify > sortie.txt 2>&1; echo "CODE=$?" >> sortie.txt`.

C'est la même famille que le `gemini -p` qui rend 0 malgré un échec d'authentification, rencontré le
même jour : **juger l'effet, jamais l'étiquette.**

**2. Ne jamais lancer deux `pnpm run verify` en parallèle.** Deux exécutions Playwright se disputent
le port du serveur et le dossier `test-results/`. Symptôme : « 43 passed » et une longue liste de
tests **non exécutés**, sans aucun échec nommé. Ce n'est pas une régression, c'est une collision —
nettoyer `test-results/` et relancer **seul**.

---

## 19 août 2026 — les deux observations instruites, G-1 livrée

### Fait

**Les deux observations du 18/08 sont instruites, et aucune n'est une régression** — détail dans
`PLAN-SUITE.md` §10. En résumé : les deux chemins d'import offrent deux boutons explicites (le
produit n'interroge pas, il offre deux gestes), et le F5 sur la tablette vient de
`estConnuDesJoueurs()`, qui rend **absent** du sélecteur joueurs tout étage sans masque de fog
publié. `scene.load` apporte des étages **neufs**, donc sans masque ; `level.replace` — le chemin
d'UX-13 — remplace la carte **à identifiant constant**, l'étage garde son masque et reste connu.
⛔ Non corrigé : le correctif suppose une règle de jeu (une table doit-elle voir l'onglet d'un étage
où elle n'a jamais mis les pieds ?), donc un arbitrage du mainteneur.

**G-1 livrée** (`c51d15f`) : `cellCenter` et `cellBounds` sur les deux grilles, couche des pions
migrée, aucun autre appelant touché. Porte `CODE=0`, 205 e2e, 3 gestes.

**Brief du fog écrit** (`BRIEF-FOG-BASSE-RESOLUTION.md`), non implémenté.

### Ce que la relecture a ajouté au travail du sous-agent

Il avait fait ses trois mutations. J'en ai ajouté une quatrième qu'il n'avait pas faite : aplatir le
facteur `2/√3` de la hauteur hexagonale → **3 tests sur 7 rougissent**. La hauteur est donc
réellement assertée. C'est le point où un test paresseux serait passé — il aurait vérifié la largeur
et ignoré la hauteur, qui était fausse elle aussi dans le défaut d'origine.

### ✅ Les deux points ouverts sont réglés le jour même — ne pas les rouvrir

1. **Pion hexagonal multi-cases : il n'y avait aucun arbitrage à demander.**
   `HexGrid.cellsOccupied` définit depuis le lot 1a qu'un pion de taille N occupe le **disque
   hexagonal de rayon N−1** — 7 hexagones en taille 2, 19 en taille 3. Le dessin **doit** suivre
   cette définition : un pion qui déborde semble bloquer un passage qu'il laisse libre.

   Le dessin ne la suivait pas : l'échelle linéaire rendait un pion de taille 2 **d'un tiers trop
   petit** (280 px au lieu de 420). ✅ **Corrigé** (`0cc2d3c`).

   ⚠ **Deux tests verrouillaient l'erreur** — l'extrapolation du sous-agent figée en assertion. Ils
   ont été **corrigés, pas assouplis** : la règle « ne pas retoucher un test existant » protège un
   test qui *était* juste, pas un test qui encode une invention. Distinction à garder en tête, elle
   se représentera.

2. **Étage neuf côté joueurs : tranché par le mainteneur le 19/08 — « la table ne voit que les
   étages où elle est allée. »** Le comportement actuel est donc **le bon**. Le F5 du 18/08 n'était
   pas un défaut. ⛔ **Ne pas publier de masque noir pour « réparer » ce symptôme** : ce serait
   montrer l'existence d'un étage que la table n'a pas découvert.

### Leçon de méthode de cette séance

⭐ **Avant de demander un arbitrage au mainteneur, vérifier si le code ne l'a pas déjà rendu.** Le
doute du sous-agent ressemblait à une question de règle ; c'était une incohérence interne, et la
réponse était dans `cellsOccupied` depuis le début. Une question posée au mainteneur alors que la
réponse existe lui coûte du temps et retarde un correctif.

### Suite de la file

G-2 (avertissement `map_origin`), puis les bornes de ressources à l'import. Le fog a son brief et
reste prioritaire au plan, mais sa validation exige les yeux du mainteneur.

---

## 19 août 2026, après-midi — la première carte de campagne, et le défaut qu'elle a révélé

**« Carte_Combat _Ferme_isolée » est en bibliothèque** (`4f3cbe2`) : 38 × 28 hexagones à 140 px/case,
image 5320 × 3500 intacte, grille hexagonale posée à la demande du mainteneur. Première vraie carte
de campagne du dépôt — les autres étaient des cartes de mesure ou d'essai.

⚠ **Carte-décor** : ni murs, ni portes, ni lumières. Les lignes de vue du lot 2 y sont inertes, et
sans pion PJ posé les joueurs ne verront rien. `maps:prepare` le signale de lui-même.

### ⭐ Le défaut qu'elle a fait tomber

L'outil **ne pouvait produire aucune carte hexagonale correcte à partir d'une image rectangulaire**.
`_hex` fixait le type de grille, mais le rééchantillonnage calculait `hauteur = rangées × pxPerCell`,
hypothèse carrée en dur. La ferme sortait **comprimée de 11 % en largeur**.

Invisible depuis toujours, parce que la seule carte hexagonale du dépôt — `marais-hex_16x16` — est
**carrée** : aucune déformation n'y est possible. Il a fallu une image rectangulaire pour le révéler.

⚠ **Ma première correction était fausse elle aussi** : forcer la hauteur à l'étendue exacte des
rangées écrasait encore de 1,9 %, aucun nombre entier de rangées ne couvrant pile la hauteur d'une
image quelconque. La règle retenue : **une grille est une couche de jeu posée sur un dessin, ce n'est
pas au dessin de s'y plier.** On conserve le ratio.

### Deux avertissements de l'outil, tous deux justes mais l'un mal calibré

1. « carte-décor sans géométrie » — **juste et utile**, à garder.
2. « Dimensions du nom incohérentes : 38×28 donne 140 px/case en largeur mais 125 en hauteur » —
   ⚠ **faux positif en hexagonal**, où les deux densités *doivent* diverger. `cellDimensionsFromName`
   ignore le pavage. Non corrigé : à traiter quand la file y reviendra.

### Suite de la file

**G-2 n'a pas été commencée** — la carte a pris la séance, et elle le méritait : elle serait entrée
déformée en bibliothèque. G-2 reste en tête de file.

### Fin de séance du 19/08 — G-2 livrée, et le faux positif hexagonal corrigé

**G-2 livrée** (`c019a5c`). Un `map_origin` non nul **parle** désormais : il nomme les valeurs, le
sens appliqué (le projet **ajoute** l'origine), la convention concurrente (Foundry la **soustrait**)
et le symptôme à guetter — « décalés du double de l'origine ». ⛔ Le signe n'est **pas** basculé :
aucun export réel n'a jamais porté d'origine non nulle, et on ne parie pas sur la foi d'un importeur
tiers. Le premier fichier qui déclenchera l'avertissement fournira le cas qui manque.

⭐ Le test n'exige pas « un avertissement existe » — ce critère passerait au vert sur un message
vide. Il exige que le message **nomme** valeurs, sens, convention concurrente et symptôme. Et
l'autre moitié : **le silence quand il n'y a rien à dire**, sans quoi l'avertissement se banalise.

**Faux positif hexagonal corrigé** (`6bca612`). `cellDimensionsFromName` comparait la densité en
hauteur à celle en largeur, alors qu'en pointe-en-haut elles doivent diverger. ⚠ Ma première passe
comparait au **pas** entre rangées ; il fallait l'**étendue réelle**, la dernière rangée ajoutant sa
hauteur pleine. Le test verrouille les deux sens — pas d'avertissement en hexagonal correct, mais
l'incohérence reste détectée en carré, sans quoi « corriger » aurait pu vouloir dire « supprimer la
vigilance ».

### Reste dans la file

**Les bornes de ressources à l'import** (`PLAN-SUITE.md` §5) — dernière tranche autonome de la file.
Puis le fog, dont le brief est prêt mais dont la validation exige les yeux du mainteneur.

### 19/08 au soir — les bornes de ressources : ⭐ LA FILE AUTONOME EST VIDE

**Bornes livrées** (`c871cf1`). Seuils mesurés sur les six exports réels du dépôt avant d'écrire une
ligne — pire cas `testbig150` : 103,8 Mpx · 4 615 cases · 1 338 polylignes · 2 676 sommets ·
141 portes · 185 lumières. Chaque plafond laisse passer ce pire cas avec au moins un facteur 2.

⭐ **Le contrôle qui protège vraiment est celui de l'image**, et il tient à *ce qu'il mesure* : pas
la taille du JSON — déjà allouée quand `parseUvtt` la reçoit — mais l'image **décodée**, estimée
depuis `map_size × pixels_per_grid` **sans toucher au fichier image**.

⚠ **Trou trouvé en chemin** : `typeof pt.x === 'number'` acceptait `NaN` et `Infinity`. Un `NaN`
traverse tout sans rien casser — toute comparaison avec lui étant fausse, un segment devient
invisible au sweep **sans la moindre erreur** — puis ressort en `null` à la sérialisation. Corrigé.

⭐ **La leçon de la tranche, à garder** : un test qui vérifie qu'un plafond refuse l'absurde est
facile à écrire et ne protège qu'à moitié. Ce qui casse une séance, c'est un plafond descendu **sous
le réel** « par prudence ». D'où le test qui parcourt tout le corpus et exige que chaque carte passe.

## ⛔ État de la file au 19/08 au soir

**Les quatre tranches autonomes sont livrées** : M2, G-1, G-2, bornes d'import — plus trois
correctifs non prévus nés de la vraie carte (déformation hexagonale, rosette, faux positif).

**Il ne reste que le fog**, et il ne peut pas être terminé sans le mainteneur : son critère est
« rendu visuellement identique ». Le brief est prêt (`BRIEF-FOG-BASSE-RESOLUTION.md`), le code peut
s'écrire et l'arithmétique se prouver, mais ⛔ **aucun agent ne déclare cette tranche terminée**.

⚠ **Donc : ne pas inventer de travail.** La charte (§3) est explicite — file vide, on s'arrête. S'il
reste du temps de réveil, l'employer à écrire, mesurer ou vérifier, jamais à ouvrir un chantier non
listé.

---

## ⚠ 19/08 au soir — UN TRAVAIL NON RELU PEUT ATTENDRE DANS L'ARBRE

Un sous-agent a été lancé sur **le fog basse résolution** (`BRIEF-FOG-BASSE-RESOLUTION.md`) avec les
jetons du mainteneur presque épuisés. Il a consigne de **ne rien committer**.

⛔ **Donc, avant TOUT autre travail : `git status`.**

- **Arbre sale** → c'est cette implémentation, **jamais relue**. Elle ne vaut rien tant qu'elle n'a
  pas été lue ligne à ligne et mutée. ⛔ Ne pas committer sur la foi de son rapport, ⛔ ne pas lancer
  d'autre tranche par-dessus, ⛔ ne pas lancer de revue mutante dans cet arbre — elle révoquerait par
  `git checkout` et emporterait le travail.
- **Arbre propre** → l'agent n'a rien produit ou a échoué. Reprendre le brief à zéro.

⚠ Et le rappel qui vaut pour cette tranche plus que pour aucune autre : **son critère est « rendu
visuellement identique », donc aucun agent ne peut la déclarer terminée.** Porte verte et mutations
prouvées = *implémentée*. Validée = quand le mainteneur a regardé les trois états, en vue MJ et en
vue joueurs.

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

### Le fog est implémenté et attend sa relecture — état exact

L'agent a rendu. **Arbre sale, rien commité**, comme demandé :
`js/render/layers/fogLayer.js` (+160), `js/vision/fog.js` (+24), `tests/fogLayer.test.mjs` (+148).

Il annonce `CODE=0` sur une porte lancée seule, 475 unitaires et 205 + 3 Playwright.
⛔ **Non vérifié par moi.** Refaire la porte, et relire le code — pas le rapport.

**Ce qu'il dit avoir fait** : composition dans un tampon `widthCells × 8` par `heightCells × 8`, plus
jamais à la taille de la carte ; masques déposés 1:1 ; polygones convertis vers l'espace du masque
par l'origine de l'étage et `FOG_MASK_PX_PER_CELL / gridScale` ; arithmétique du complément et ordre
des compositions inchangés ; un seul agrandissement, à l'étape D.

### ⚠ Quatre points qu'il signale lui-même — à instruire en priorité à la relecture

1. ⭐ **La mutation n°4 n'est PAS attrapée par `fogLayer.test.mjs`.** Peindre l'opacité visée au lieu
   de son complément n'y fait rougir aucun test ; seul `fogVeil.spec.mjs` le voit (0,625 au lieu de
   0,5). **C'est un trou de couverture unitaire**, pas une réussite : le jour où l'e2e est écarté ou
   ralenti, plus rien ne garde cette arithmétique. À combler.
2. ⚠ **Il a modifié le mock partagé de `drawImage`** dans `tests/fogLayer.test.mjs` pour gérer le
   redimensionnement. Un mock qui change est exactement l'endroit où un faux vert se loge — voir le
   mock qui implémentait l'inverse du mécanisme testé, en mémoire `lot2_revue_protocole`. À lire de
   près.
3. ⚠ **Il a touché `js/vision/fog.js`**, hors du périmètre annoncé : ajout d'une estampille
   `__fogRevision` posée par `_touch()`, parce que les masques sont mutés **en place** et que leur
   référence ne change jamais. Le raisonnement se tient, mais c'est du code de production hors brief.
4. ⚠ **Trou de cache signalé par lui-même** : un futur appelant qui réutiliserait un canvas muté en
   place **sans** `__fogRevision` verrait son fog figé silencieusement. Aujourd'hui `decodeFogPng`
   crée un objet neuf à chaque fois, donc le cas ne se produit pas — mais rien ne l'empêche.

⛔ **Et le rappel qui prime sur tout le reste : cette tranche n'est pas terminée.** Porte verte et
mutations prouvées = *implémentée*. **Validée** = quand le mainteneur a regardé les trois états, en
vue MJ et en vue joueurs. L'écart visuel attendu — bords du chemin polygones adoucis — est annoncé
dans le brief et n'a été vérifié par personne.

⚠ La mesure terrain reste à faire : `player.html?probe=1` sur `testbig150`, colonne `fog`. Point de
départ **1580–1700 ms**.

---

## 23 août 2026 — le fog relu et commité, et la boucle rendue durable

### ⛔ Le `cron` de session a échoué — mécanisme abandonné

La tâche armée le 19/08 pour dimanche 12h05 **n'a jamais tiré**. Constaté à 22h39 : `CronList`
rendait « No scheduled jobs », dernier commit du 19/08. Elle a disparu avec une session remplacée
entre-temps, **sans le moindre signal** — le seul symptôme était qu'il ne se passait rien.

⚠ **Et l'erreur de méthode qui va avec, à ne pas refaire** : le 19/08 j'avais conclu « elle a
survécu » en la voyant **listée**. La liste était l'étiquette, le déclenchement était l'effet ; je
n'avais vérifié que la première. Exactement le travers qu'on traque partout ailleurs ici.

✅ **Remplacé par une tâche planifiée durable** : `rpg-map-display-boucle-autonome`, toutes les
5 heures, stockée dans `~/.claude/scheduled-tasks/`. Elle survit aux sessions, **se rattrape au
lancement suivant** si l'application était fermée, et se voit dans la barre latérale.

### ✅ Le fog est relu, complété et commité (`83d6110`)

Vérifié pièce par pièce, pas sur rapport : les six chemins de mutation de `js/vision/fog.js`
appellent bien `_touch()` (`revealPath` déléguant à `reveal`), la clé de cache couvre les deux
masques **avec** leur révision, et la conversion des polygones reprend la formule de
`ExploredFog.reveal()`. Porte repassée par moi : `CODE=0`, 205 e2e.

⭐ **Trou de couverture fermé.** `alphaNonExplore` est extraite de `render()` et testée : elle y
vivait en ligne, donc hors de portée d'un test unitaire, et sa seule garde était un e2e. Le test ne
verrouille pas la formule mais **sa propriété** — les deux voiles superposés doivent totaliser
exactement l'opacité visée. La mutation qui échappait aux unitaires les fait maintenant rougir.

⚠ Le trou était **antérieur** au travail du sous-agent : il l'a trouvé et signalé dans son propre
rapport. Un agent qui dénonce un angle mort de sa livraison vaut mieux qu'un agent au rapport net.

### ⛔ Ce qui reste, et n'appartient qu'au mainteneur

1. **Regarder le rendu.** L'écart annoncé par le brief — bords du chemin polygones **adoucis**,
   tracés à 8 px/case puis agrandis — n'a été vu par personne. Trois états, vue MJ et vue joueurs.
   Si l'adoucissement est refusé, le repli est un tampon borné au viewport : plus cher, mais net.
2. **Mesurer sur tablette** : `player.html?session=<id>&probe=1` sur `testbig150`, colonne `fog`.
   Point de départ **1580–1700 ms**. ⚠ Ne pas s'attendre à zéro : le **fond**, à 1131–1431 ms, est
   un problème **distinct** que cette tranche ne traite pas.

**La file est vide.** ⛔ Ne pas inventer de travail : la charte §3 est explicite.

---

## ✅ 23 août 2026, nuit — LE FOG EST VALIDÉ, mesuré et regardé

Relevé du mainteneur sur Tab S9 FE, vue joueurs, **`testbig150`**, `?probe=1`, pendant un pincement :

| | Avant (18/08) | Après | |
|---|---|---|---|
| **Fog** | 1580–1700 ms | **max 1 ms**, 0–0,2 le plus souvent | ~×2000 |
| **Fond** | 1131–1431 ms | **max 0,5 ms**, 0,0 le plus souvent | ~×2500 |
| **Total** | 1123–3512 ms | **1–3 ms** | budget de 33 ms tenu ×10 |

Premier chargement à 1350 ms : c'est le décodage à froid du WebP, mesuré à 1118 ms le 11/08. Attendu,
et c'est précisément ce que la doublure 1024 px du chantier P empêche de tomber dans la 1ʳᵉ image.

⭐ **Validé par l'œil aussi**, ce qu'aucune porte ne peut faire : « un léger crénelage qui n'est pas
gênant, je n'éprouve pas le besoin d'aller chercher mieux ». La tranche est donc **validée**, pas
seulement implémentée — la première fois qu'on peut l'écrire.

### ⭐ Le fond s'est réparé seul — un seul défaut, pas deux

Non prévu : cette tranche n'a pas touché la couche de fond, classée « problème distinct ».

**Hypothèse, et elle n'est pas prouvée** : le second coût était **en aval** du premier. Le tampon
retenait 245 Mio et balayait 61 Mpx deux à trois fois par image ; sous cette pression le navigateur
lâchait le *backing store* du fond, qui devait être redécodé — d'où ces 1131–1431 ms **intermittents**,
seulement sur les images où la perte avait eu lieu. C'est le mécanisme dont `CHANTIER-N` prévenait,
écrit pour les icônes d'état et applicable au fond.

⚠ **Ce qui la confirmerait** : que le fond ne remonte jamais à quatre chiffres sur une séance longue.
⛔ **Ne pas ouvrir de chantier « fond » sans cette observation** — il n'a peut-être jamais existé.

### Le levier, si le crénelage dérange un jour

⛔ **Pas** le repli « tampon borné au viewport » du brief : il coûterait bien plus cher pour rien.
`imageSmoothingEnabled` vaut déjà `true` (jamais désactivé dans `js/`), donc l'agrandissement est
lissé. Ce qu'on voit est **la résolution du masque** : à 8 px/case, un bord de polygone a des marches
que le lissage adoucit sans les effacer. Le levier est donc `FOG_MASK_PX_PER_CELL` — 12 ou 16 px/case
affineraient, à coût proportionnel, et la marge existe (1 ms sur 33).

### Trois défauts du chemin de validation, réparés en route

Aucun ne se voyait en séance : ils étaient tous sur le trajet qui permet de **regarder avant de
publier**, jamais emprunté donc jamais éprouvé.

1. `serve.mjs` n'écoutait que sur `127.0.0.1` → `--host` optionnel (`c685fd8`).
2. `crypto.randomUUID` absent hors contexte sécurisé → `identifiantAleatoire()` (`8a83b35`).
3. Le cartouche de la sonde à z-index 99 999 masquait l'état réseau, l'overlay de connexion et
   l'overlay bloquant → redescendu à 800 (`8a83b35`).

⚠ Et un quatrième, non technique : le nettoyage des domaines Firebase du 08/08 — que j'avais
recommandé — interdit toute validation locale. `localhost` est à remettre **définitivement**.

⭐ **La leçon, la même que celle de la carte hexagonale quatre jours plus tôt : ce qui n'a jamais
servi ne marche pas.**

---

## 26 août 2026 — M2 : l'instrument mentait ; réparé, mesuré, ✅ CLOSE

**Demande du mainteneur : « lance M2 ».** La section 16 de `diag.html` existait déjà — livrée le
18/08 (`999ff2a`), testée, relue. Elle n'avait **jamais été exécutée**. Elle ne pouvait pas rendre de
verdict.

### ⛔ Le faux vert, et il était structurel

Deux exécutions sur le poste Windows, avant toute modification :

| | Relecture seule | Composition brute | Agrandissement brut | **Net** | Verdict rendu |
|---|---|---|---|---|---|
| 1ʳᵉ | **51,1 ms** | 2,3 ms | 10,3 ms | **0 / 0** | « la composition tient » |
| 2ᵉ | **13,1 ms** | 6,2 ms | 12,4 ms | **0 / 0** | « la composition tient » |

Le vidage de pipeline coûtait **plus cher que l'opération mesurée**. `Math.max(0, brut − vidage)`
rendait donc 0 quoi qu'il arrive, et « ça tient » ne pouvait **pas basculer**. Le treizième faux vert
du projet, et le premier qu'aucune relecture n'aurait attrapé : il ne se voyait qu'à l'exécution.

⭐ **La technique n'était pas fausse, elle était hors de son régime.** Le correctif G-01 du 12/08
mesurait un décodage de ~490 ms avec un vidage de quelques millisecondes : y retrancher la relecture
était juste. Ici l'opération coûte **moins** que la relecture. La même formule, appliquée deux ordres
de grandeur plus bas, ne mesure plus rien. ⚠ **Une technique de mesure a un domaine de validité, et
le brief qui la prescrit ne le transporte pas avec elle.**

### ⭐ Le second mensonge : chronométrer les deux moitiés séparément

Mesurés isolément, composition (0,15 ms) et agrandissement (0,043 ms) totalisaient **0,19 ms**. Leur
**enchaînement** en coûtait **1,63**. Neuf fois plus.

Séparés, rien ne force la résolution du masque : on chronomètre une file d'attente. C'est **le piège
n°1 du brief lui-même**, que la séparation demandée par ce même brief réintroduisait par la porte de
derrière. ⛔ **Le cycle complet est la seule fenêtre honnête.**

### Le troisième : la destination était figée à 640×480

Le brief disait « aux dimensions du viewport ». Le code posait un canvas de 640×480 en dur — sur la
tablette visée, **cinq fois moins de pixels de destination que l'écran réel**, donc le terme qui
gouverne la dépense, sous-mesuré d'autant. C'est le raisonnement déjà écrit pour le défaut jumeau des
pions : *une composition coûte en proportion de sa surface de destination.*

### Ce qui remplace

1. **30 cycles chronométrés d'un seul tenant, un seul vidage à la fin.** Le vidage est amorti sur
   30 images au lieu d'être payé — et retranché — à chacune.
2. **Le cycle entier, jamais ses moitiés.** La part fixe et la part variable se lisent alors **par la
   pente**, sur deux surfaces de destination : coût plat *vs* coût variable avec la surface.
3. **La destination réelle de l'appareil** (`innerWidth × innerHeight × devicePixelRatio`), plus une
   petite référence pour donner le second point.
4. ⛔ **Un vidage plus cher que la fenêtre entière est REFUSÉ**, plus jamais ramené à zéro. C'est ce
   plancher qui rendait le défaut muet : il transformait une mesure absurde en un joli 0 ms, et 0 ms
   tient dans tous les budgets.

**Quatre mutations, quatre rouges ciblés**, restauration verte : rétablir la soustraction par image,
faire porter le verdict sur le premier relevé, calculer la pente sur les durées de fenêtre, remplacer
le refus par le plancher. ⚠ Une cinquième tentative est passée **verte à tort** — `python` n'existe
pas sur ce poste, la mutation n'avait pas été appliquée. Vérifier que le motif a bien été remplacé
fait partie de la mutation.

### ✅ Le relevé — poste Windows, 26/08/2026

Village, étage `test_village_complet_00`, **93 sources réellement lues**, masque 336 × 336 px.

| Destination | Surface | Coût par image |
|---|---|---|
| référence 640×480 | 0,31 Mpx | **0,78 ms** |
| écran réel 1280×720 | 0,92 Mpx | **0,83 ms** |

- **part fixe** — composer 93 disques à 336×336 : **0,755 ms**
- **part variable** — agrandir : **0,081 ms par mégapixel de destination**

⭐ **L'hypothèse du plan est confirmée, et plus largement qu'espéré.** Le coût est presque
entièrement dans la composition ; l'agrandissement est quasi gratuit. Un écran 4K (8,3 Mpx)
n'ajouterait que **0,67 ms**. Le gradient n'est pas seulement ce qu'un agrandissement bilinéaire ne
dégrade pas — c'est aussi ce qu'il ne fait pas payer.

### ⛔ Ce que ce relevé ne décide PAS

**Il est pris sur le poste Windows, pas sur la Tab S9 FE.** Il établit que le calcul est sain et que
l'instrument mesure enfin quelque chose ; il **ne ferme pas M2**. La tablette est plus lente d'un
facteur qui n'est pas connu ici — et le budget de 300 ms laisse de la marge, mais c'est au relevé
réel de le dire, pas à une extrapolation. *Voir la leçon du 05/08 : les extrapolations de huit
sources vers 93 « ne valent rien ».*

Et ce que la section ne mesure toujours pas, par construction :

- **l'occlusion par les murs** — ⛔ **PAS mesurée, contrairement à ce qui était écrit ici.** La section 10 balayait des cartes sans murs jusqu'au 27/08/2026 : son 2,6 ms ne portait pas sur l'occlusion. Instrument réparé, relevé à refaire ;
- ⚠ **l'application du champ sur le décor** — le mélange d'une `LightLayer` par-dessus la carte. La
  section compose le champ et l'agrandit ; elle ne le mélange à rien. C'est un coût réel, non mesuré,
  et il porte sur la surface de l'écran. À ajouter au devis de la phase 3.

### Un défaut du chemin de validation, réparé en route

La section restait figée sur « chauffe… » : le `requestAnimationFrame` qui laisse l'écran se
rafraîchir **ne se déclenche jamais dans un onglet d'arrière-plan**. Remplacé par `setTimeout`.

⭐ **Encore la même leçon, la troisième en quinze jours : ce qui n'a jamais servi ne marche pas.**
Une section de diagnostic livrée, relue et testée, mais jamais exécutée, ne mesurait rien.

### ✅ Le même jour, plus tard — M2 EST CLOSE, relevé sur la Tab S9 FE

| Destination | Surface | Coût par image |
|---|---|---|
| référence 640×480 | 0,31 Mpx | 2,253 ms |
| **écran réel 2303×1134** | **2,61 Mpx** | **5,62 ms** |

**Part fixe** (composer 93 disques à 336×336) : **1,80 ms**. **Part variable** (agrandir) :
**1,46 ms/Mpx**.

⭐ **5,62 ms pour 300 ms de budget — moins de 2 %.** Et 17 % d'une image à 30 fps, quand la vue
joueurs entière tourne à 1–3 ms depuis la fermeture du fog. **L'hypothèse du plan tient sur le
matériel cible**, et elle tient largement.

### ⭐ Les deux rapports ne disent pas la même chose, et c'est là qu'est le résultat

| | poste Windows | Tab S9 FE | rapport |
|---|---|---|---|
| composition (93 disques, 336×336) | 0,755 ms | 1,804 ms | **×2,4** |
| agrandissement | 0,081 ms/Mpx | 1,461 ms/Mpx | **×18** |

- **×2,4 sur la composition** tombe exactement sur le facteur **2,3×** consigné entre les deux
  machines depuis le 11/08, et retrouvé au relevé R2-03 du 13/08. ⭐ **C'est un contrôle de
  cohérence, pas une découverte** : il dit que la mesure est saine, ce qui valait la peine d'être
  vérifié le jour où l'on répare l'instrument.
- **×18 sur l'agrandissement** est le débit de remplissage d'une dalle mobile. ⚠ **C'est le seul
  terme qui croît avec l'écran**, donc le seul à surveiller. Il reste petit dans l'absolu.

### Ce que ça décide

⛔ **WebGL n'est pas justifié, et cette fois par la mesure.** Le sujet du moteur avait été rouvert le
18/08 avec un déclencheur écrit : *« ça ne tient pas → on a enfin la mesure qui justifie WebGL. »*
Ça tient, avec deux ordres de grandeur de marge. La question se referme donc **par le chiffre**, pas
par l'absence de raison d'en changer. Voir [[canvas2d_migration_complete]].

**Conséquence d'architecture, et elle recopie ce que le fog fait déjà** : si le champ est mis en
cache comme le masque, la composition (1,80 ms) n'est payée qu'à la **mutation** — une lumière
bascule, un pion porteur de torche bouge, une porte s'ouvre — et l'image ne paie que l'agrandissement,
**4,85 ms en plein écran** (déduit de la pente mesurée, non mesuré).

### ⚠ Les deux termes non mesurés, à ne pas oublier au devis

1. **Le mélange du champ sur le décor** — la section compose et agrandit, elle ne mélange à rien. Une
   `LightLayer` ajoutera **un second balayage plein écran**, du même ordre que l'agrandissement.
   Devis réaliste par image : **5 à 10 ms**. Il ne se saura qu'en écrivant la couche.
2. **Le cast** — le mainteneur n'a pas pu le faire ce jour-là. La section 10 avait, elle, été relevée
   sous cast actif. ⚠ Non bloquant à 2 % du budget, mais **aucun critère de performance ne se coche
   sans le dispositif réel**.

⛔ **Ce que ce relevé ne décide PAS** : il dit que l'éclairage réel est *abordable*, pas qu'il est
*voulu*. Le choix entre **tactique binaire** et **éclairage réel** reste entier, et il appartient au
mainteneur — voir `PLAN-SUITE.md` §4 et `QUESTIONS-EN-ATTENTE.md` D-1.

# Chantier W — Fond animé

> Livré le 11 août 2026. **Constaté à table le jour même, et ça marche** : sur la Tab S9 FE,
> l'animation est fluide, la boucle ne s'arrête pas, aucun ralentissement perceptible au zoom
> ni au dézoom, et la vue joueurs suit. Le déplacement autour du bâtiment rond est jugé
> « vraiment nickel ». Restent le cast 45 min et l'endurance 4 h — voir §6.

## 1. Ce que le mainteneur voulait, et pourquoi c'était la bonne idée

> « Sur cette carte l'animation n'est qu'esthétique. Elle ne change rien au gameplay.
> Qu'est-ce qui empêche de faire fonctionner la map exactement comme maintenant, avec la
> frame 0 — et en parallèle, sans aucun effet sur le gameplay, la tablette lit la vidéo en
> boucle en tâche de fond ? »

Cette formulation contient la solution. La difficulté annoncée dans le CdC §9 — « un fond
vidéo désactive le rendu à la demande » — ne venait pas de la vidéo : elle venait de
l'hypothèse qu'on la ferait passer par `drawImage`. En la sortant du canvas, elle disparaît.

## 2. La décision d'architecture

**Un élément `<video>` dans le DOM, posé sous le canvas. Jamais `drawImage`.**

`FrameScheduler.requestFrame` (`js/render/frame.js`) planifie **une** frame et s'arrête.
Tout le moteur est bâti là-dessus, et le chantier P existe précisément pour ne plus
redécoder le fond à chaque frame. Une vidéo dessinée dans le canvas aurait exigé 30
invalidations par seconde, indéfiniment, invalidant du même coup les protocoles
d'endurance de R2 (120 s d'inactivité, 45 min de cast, 4 h de séance).

Sous le canvas, le compositeur du navigateur décode sur son propre fil, avec
l'accélération matérielle. `requestAnimationFrame` ne voit rien. **Le rendu à la demande
est intégralement conservé** — c'est la propriété centrale de ce chantier.

Trois conditions rendent cela correct, et les trois ont été vérifiées avant d'écrire une
ligne :

1. **Le canvas est déjà transparent.** `stage.js` appelle `getContext('2d')` sans
   `{ alpha: false }`.
2. **Le fog est un calque RGBA autonome.** Ses `destination-out` se font sur un canvas
   hors écran (`fogLayer.js`), composité en une passe. Il ne suppose rien du fond, donc
   il couvre une vidéo comme il couvre une image.
3. **Le recalage est une transposition directe.** `Camera.applyToContext` fait
   `translate(sw/2, sh/2) · scale(zoom) · translate(-x, -y)`, ce qui s'écrit tel quel en
   `transform` CSS.

### ⛔ Le piège du facteur de densité

`renderAll` applique `ctx.scale(stage.resolution, stage.resolution)` **avant** la caméra.
Une transformation CSS travaille déjà en pixels CSS : reprendre ce facteur doublerait le
zoom sur tout écran à densité > 1 — donc sur la tablette cible, **et nulle part sur un
poste de développement en densité 1**. Couvert par un test unitaire dédié.

## 3. Ce qui rend le repli gratuit

`videoBackdrop.active` n'est vrai que si `readyState >= HAVE_CURRENT_DATA` **et** qu'aucune
erreur n'est survenue. La couche de fond ne se tait que dans ce cas.

Conséquence : chargement en cours, codec refusé, fichier absent, étage sans vidéo — dans
tous ces cas `imageUrl` est peint, c'est-à-dire l'affiche. Le secours est le comportement
par défaut ; le fond animé est ce qui s'y substitue quand il le peut.

`imageUrl` reste donc toujours renseigné. La vidéo est **en plus**, jamais à la place.

### ⭐ Ce que la revue adverse a trouvé, et il fallait le trouver

**Ce contrat couvrait « ça ne décode pas ». Il ne couvrait pas « ça décode trop
lentement » — qui est le mode de panne le plus probable ici.**

Un flux dont la résolution dépasse ce que le décodeur matériel accepte n'échoue pas :
Chromium bascule en décodage **logiciel** et le lit à quelques images par seconde.
`readyState` reste à 4, aucun `error` n'est émis. `active` restait donc vrai, la couche de
fond restait muette, et **l'affiche — parfaitement nette — n'était jamais reprise**. On
préférait un diaporama à une carte fixe correcte, et le repli, dont tout ce chantier
affirme qu'il est gratuit, ne pouvait pas se déclencher.

`videoBackdrop` compare désormais l'avancement du flux à l'horloge murale toutes les
2,5 s. En dessous de 50 % du temps réel, il rend la main à l'affiche et le dit. Deux
pièges évités, tous deux couverts par un test : le retour à zéro de la boucle
(`currentTime` **recule**, ce n'est pas un blocage) et le flux en pause (lecture
automatique refusée — autre cas, déjà traité). C'est un `setInterval` à 2,5 s, pas une
boucle de rendu : il ne réveille aucune frame.

⚠ Et ce n'est pas théorique : `testvideo-3` est **précisément** au-dessus du palier
(§6.1).

## 4. La chaîne de préparation

Un export vidéo de Dungeon Alchemist porte `"image": ""` : la géométrie est dans le JSON,
les pixels sont dans la vidéo. Mesuré sur les trois exports fournis par le mainteneur.

```
carte.dd2vtt   (géométrie, image vide)
carte.webm     (pixels)            ─┐
carte.poster.webp (affiche)         │ → maps/generated/carte.{webp,webm,scene.json}
```

L'affiche est produite par `scripts/extract-poster.mjs`, qui décode la première image
**dans Chromium** — Node ne sait pas décoder du VP9, et aucune dépendance du projet non
plus. Playwright étant déjà une dépendance de développement, rien n'est ajouté à l'arbre.
L'extraction est **séparée** de `prepare-maps.mjs` à dessein : la préparation ne doit pas
exiger un navigateur. Elle réclame l'affiche bruyamment, avec la commande à lancer.

Trois pièges fermés au passage, chacun couvert par un test :
- l'empreinte de source inclut **la vidéo et l'affiche** : réencoder la vidéo sans toucher
  au JSON ne doit pas laisser le cache republier l'ancienne ;
- `isReusable` vérifie la présence effective du `.webm` publié ;
- le relevé d'orphelins lit `videoUrl` dans la **scène**, sinon il déclarait orpheline la
  vidéo qu'il venait de publier — un avertissement faux à chaque passe, et un avertissement
  faux est un avertissement qu'on cesse de lire.

## 5. Publication

`scripts/build-site.mjs` gagne `PUBLISHABLE_MAPS`, une liste blanche **avec provenance
écrite**. La règle du dépôt n'a jamais été « aucune carte » mais « aucune carte dont la
provenance n'est pas documentée » ; le catalogue publié était vide parce qu'aucune carte
ne remplissait la condition.

`testvideo-3` la remplit : elle est l'œuvre du mainteneur, produite avec Dungeon Alchemist,
sans aucun élément de tiers. Consignée dans `attributions.html`.

⚠ **Détenir une licence d'usage ne suffit pas** à publier : la republication sur le web
relève d'une autre clause que la partie privée à table. C'est écrit dans le commentaire de
`PUBLISHABLE_MAPS`, à l'endroit où la question se pose.

## 6. Ce que la table doit constater, et que rien ne remplace en machine

Aucun de ces points n'est mesuré. Ils sont classés par ordre de ce qui tuerait le chantier.

> ✅ **Le point 1 est tombé le 11/08/2026 : ça marche.** L'animation est fluide sur la
> tablette, le détecteur de cadence ne s'est pas déclenché. Le décodeur franchit donc le
> plafond théorique ci-dessous. Le raisonnement reste juste et le seuil reste utile — il
> vaudra pour une carte plus grande — mais la prédiction pessimiste était fausse pour cet
> appareil. La section **7** de `diag.html` permet désormais de le vérifier en deux taps sur
> n'importe quel appareil, plutôt que de le déduire.

1. **La Tab S9 FE décode-t-elle `testvideo-3` en matériel ? Probablement pas.**
   L'arithmétique est nette et je l'ai vérifiée sur l'en-tête du fichier publié :
   4200 × 2850 = **11 970 000 échantillons de luminance**, contre **8 912 896** au plafond
   VP9 **niveau 5.2**. Il faut donc du **niveau 6.0**, que les décodeurs matériels mobiles
   ne gèrent couramment pas. Ce n'est plus « plausible, pas acquis » : c'est *au-dessus du
   palier*, et il faut s'attendre à un décodage logiciel.

   Ce que ça change concrètement : le détecteur de cadence (§3) devrait alors rendre la
   main à l'affiche au bout de ~5 s, avec un avertissement en console. **Une carte fixe
   nette, pas un écran noir.** C'est le comportement voulu — mais c'est une prédiction,
   pas une mesure.

   Le plus court chemin pour trancher : ouvrir `maps/generated/testvideo-3.webm` **seul**
   dans Chrome sur la tablette. Si ça joue fluide, le décodeur gère le niveau 6.0 et tout
   va bien. Sinon, il faudra réexporter plus petit — 28 × 20 cases à 140 px/case, soit
   3920 × 2800, passe sous le plafond.

   `pnpm maps:prepare` avertit désormais quand une vidéo dépasse ce seuil
   (`scripts/videoProbe.mjs`), par symétrie avec le plafond de texture de `resample`.
2. **La mémoire sur 4 h.** VP9 conserve des images de référence ; un flux de 12 Mpx
   immobilise quelques centaines de Mo de mémoire vidéo, en plus du canvas et du hors-écran
   du fog. C'est ça qu'il faut surveiller, pas le fil principal.
3. **La batterie et la chaleur sous cast**, 45 min. Le décodage continu est exactement ce
   que la conception à image fixe évitait.
4. **Le recalage à la densité de la tablette.** Le piège du §2 ne se voit qu'à densité > 1.
   Si la carte est deux fois trop grande ou décalée au zoom, c'est là qu'il faut regarder.

## 7. Couverture

- `tests/videoBackdrop.test.mjs` — 12 cas unitaires : cycle de vie, repli, arrêt réel du
  décodage, transformation CSS, suppression de la couche de fond à froid et à chaud.
- `tests/prepareVideo.test.mjs` — 10 cas : détection de la jumelle, messages d'erreur,
  empreinte, orphelins, publication.
- `tests/videoBackdrop.spec.mjs` — 6 scénarios navigateur sur **la carte réellement
  publiée**, dont : deux captures espacées d'une seconde qui diffèrent (donc ça bouge
  vraiment), la couche de fond muette, le brouillard qui couvre le fond animé côté joueurs,
  et le repli sur affiche.

### La revue adverse, et ce qu'elle a changé

Deux relecteurs indépendants ont audité le chantier. La revue des tests a **prouvé par
mutation que six de mes tests restaient verts sur du code cassé** — c'est le genre de
constat qui justifie à lui seul le protocole. Les plus instructifs :

| Faux vert prouvé | Ce qui passait inaperçu |
|---|---|
| `place()` entièrement désactivé | **les 6 scénarios navigateur restaient verts** : la vidéo affichée dans un coin, sans pan ni zoom, totalement désalignée de la carte |
| `HAVE_CURRENT_DATA = 1` | le test écrivait ses seuils avec la constante qu'il vérifiait — les deux côtés bougeaient ensemble |
| `this.failed` jamais réarmé | une seule vidéo illisible éteignait le fond animé **pour toute la séance** |
| `suppressed` conditionné à `status === 'ready'` | les deux tests partaient d'une couche prête ; le cas « vidéo décodée avant l'affiche » n'existait pas |
| `videoUrl` forcé à `null` en préparation | **la fonctionnalité entièrement morte**, suite unitaire verte : les helpers étaient testés, jamais leur raccord |
| liste blanche : provenance `'x'.repeat(41)` | une carte tierce partait sur le web, porte verte |

Corrigés, chacun par un test qui rougit sur sa mutation. La couverture est passée de 12 à
19 cas unitaires et de 6 à 7 scénarios navigateur, plus un test de préparation de bout en
bout sur la vraie carte.

**Campagne de mutation finale : 22 mutations, 22 tuées.** Dont les deux qui comptent le
plus — canvas rendu non positionné dans chaque feuille de style, ce qui ferait passer la
vidéo **au-dessus du brouillard** et montrerait toute la carte aux joueurs.

### Ce que je n'ai pas corrigé, et pourquoi

- **`sourceHashOf` relit chaque vidéo en entier à chaque passe**, avant même le contrôle de
  cache. 20 Mio aujourd'hui, davantage demain. Un hachage sur `(taille, mtime)` rendrait le
  même service — mais changer la règle d'empreinte mérite son propre chantier, pas un
  passage en fin de celui-ci.
- **L'affiche est chargée et décodée même quand la vidéo joue.** C'est le prix du repli
  gratuit : sans elle prête, la reprise ne serait pas instantanée. Coût mémoire non chiffré.
- **`this.container` est écrit et jamais lu**, et `sourceUrl` du catalogue publié pointe
  vers un `.dd2vtt` qui n'est pas dans le paquet (chaîne validée, jamais suivie).

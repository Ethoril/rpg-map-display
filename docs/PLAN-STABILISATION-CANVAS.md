# PLAN DE STABILISATION — Canvas 2D, persistance et synchronisation

> Document de travail créé après l’audit du 29 juillet 2026.
>
> Ce plan remplace la recommandation initiale de « revenir au dernier Pixi fonctionnel » :
> l’ancienne implantation Pixi était elle-même inutilisable. La direction retenue ici est de
> **terminer proprement la migration Canvas 2D**, puis de mesurer son comportement sur la
> tablette avant d’engager les lots graphiquement lourds.
>
> Ce document ne déclare aucune tâche terminée. Chaque critère doit être prouvé par un test
> réel ou, lorsque le matériel est indispensable, marqué « à vérifier par le mainteneur ».

---

## 1. Objectif

Obtenir un lot 1a réellement jouable avec :

- une carte et ses pions encore présents après un véritable rechargement de page ;
- une vue MJ et une vue joueurs synchronisées par Firebase ;
- un rendu Canvas 2D **strictement à la demande**, arrêté à l’inactivité ;
- des images référencées par URL persistante, jamais transportées en base64 ;
- un drag MJ libre et un déplacement joueurs tap-pion → tap-case ;
- des tests portant sur les pages réelles, sans réécrire le contrat autour d’une sonde
  factice ;
- une documentation conforme au moteur réellement utilisé.

Le plan ne cherche pas encore à ajouter le fog, la vision, les lumières, les étages reliés ou
les animations de fond. Ces sujets restent hors du lot 1a.

---

## 2. Constats de départ à conserver comme tests de non-régression

Les symptômes suivants ont été confirmés sur la page réelle et doivent d’abord devenir des
tests rouges :

1. **Boucle permanente** : environ 31 callbacks `requestAnimationFrame` en 500 ms sans
   interaction.
2. **Image perdue après F5** : la campagne et l’étage reviennent, mais `imageUrl` vaut `null`.
3. **Campagne entièrement refusée après F5** : un pion généré reçoit `levelId: "rdc"` alors
   que l’étage importé a un autre identifiant ; la validation rejette ensuite le snapshot.
4. **Transport réel absent** : les pages automatiques ne reçoivent aucune configuration
   Firebase et ne déclenchent aucune authentification.
5. **Tests faussement verts** : les tests de reconnexion ne rechargent pas la page réelle,
   le ticker est déclaré arrêté par une constante, et les « deux onglets » utilisent un
   relais manuel externe à l’application.

Ces cinq constats sont le socle de la remise à plat. Aucun correctif ne doit supprimer leur
test ou en réduire la portée.

---

## 3. Décisions d’architecture

### 3.1 Canvas 2D devient le moteur officiel du lot 1a

Pour le lot 1a :

- le renderer est Canvas 2D natif ;
- PixiJS et `pixi-viewport` ne sont ni chargés ni déclarés ;
- les couches restent des modules séparés, mais ne prétendent plus être des conteneurs Pixi ;
- la caméra demeure le seul convertisseur carte ⇄ écran ;
- la géométrie de grille reste confinée aux adaptateurs `grid/*`.

Le choix n’est pas définitif pour tout le projet. Il sera réévalué au point de contrôle
performance décrit en §19, avant le fog dynamique et l’éclairage.

### 3.2 Une image persistée est une URL, jamais le contenu du fichier

Valeurs autorisées dans un document de campagne persistant :

- URL relative même origine, par exemple `maps/ruines.webp` ;
- URL HTTPS stable ;
- chaîne vide tant qu’aucune image n’est publiée.

Valeurs interdites dans le store persistant, Firestore et RTDB :

- `data:image/...;base64,...` ;
- URL `blob:...` ;
- contenu binaire ou base64 sous un autre nom de champ.

Une data URL peut être utilisée **uniquement en mémoire pour un aperçu local transitoire**.
Elle ne doit jamais franchir `store.addLevel`, `store.addToken`, `saveSnapshot` ou
`transport.publish`.

### 3.3 Le dépôt statique reste la source des images partagées

Le navigateur ne peut pas écrire dans `maps/` sur GitHub Pages. Le flux partagé du lot 1a est
donc :

1. préparer la carte avec le CLI existant ;
2. produire l’image WebP et le document JSON ;
3. placer les fichiers dans `maps/` ;
4. publier le dépôt ;
5. charger dans l’application le document dont `imageUrl` est une URL relative.

L’interface MJ peut conserver un mode « aperçu/import local », mais il doit être clairement
marqué **non persistant et non partageable** tant que l’asset n’a pas une URL publiée.

Même principe pour les pions : le générateur produit et télécharge un WebP ; le pion partagé
référence ensuite un chemin tel que `maps/tokens/<id>.webp`. Une future automatisation de
l’upload pourra remplacer ce geste, mais elle ne fait pas partie de ce plan.

### 3.4 La configuration Web Firebase est publique et peut être livrée

Une configuration Web Firebase (`apiKey`, `authDomain`, `databaseURL`, `projectId`, `appId`)
n’est pas un secret. Une application statique ne peut pas fonctionner si elle n’est fournie
nulle part.

Recommandation :

- ajouter un module de configuration runtime, sans mot de passe ni compte de test ;
- le charger par les deux points d’entrée ;
- continuer à fournir `testEmail` et `testPassword` uniquement par variable
  `RPG_FIREBASE_CONFIG` dans les tests ;
- faire reposer la sécurité sur Firebase Authentication et les règles, jamais sur la
  confidentialité de la configuration Web.

Le nouveau module devra être ajouté au manifeste **avant sa création**.

### 3.5 Une seule chaîne de traitement pour les événements réseau

Les deux applications doivent appliquer le même vocabulaire d’événements :

- `level.add`
- `level.grid`
- `token.add`
- `token.move`
- `view.change`
- événements de présence/version

Le traitement doit être centralisé dans une fonction pure ou dans le store, afin d’éviter
que la vue MJ et la vue joueurs divergent. Ce traitement ne doit pas importer Firebase :
il reçoit uniquement un `NetEvent`.

---

## 4. Règles de mise en œuvre

1. Une tâche à la fois, dans l’ordre du §5.
2. Commencer chaque correctif par le test qui reproduit le défaut.
3. Ne jamais modifier un test uniquement pour lui faire accepter le résultat courant.
4. Tester les modules de rendu dans le navigateur, avec le vrai Canvas.
5. Tester persistance et reconnexion avec un vrai `page.reload()`.
6. Tester la synchronisation via les points d’entrée réels, pas en montant seulement
   `bootstrapPlayerView`.
7. Une erreur de chargement, validation, persistance ou réseau doit être visible dans
   l’interface MJ et observable côté joueurs si elle bloque la séance.
8. Aucun `catch` vide sur un chemin critique.
9. Aucun `console.log('[DEBUG] ...')` dans la livraison finale.
10. Aucun nouveau fichier de production avant amendement du manifeste.
11. Aucun critère matériel déclaré réussi sans mesure sur la Tab S9 FE.

---

## 5. Ordre d’exécution

```
C-00 tests rouges de référence
  └─ C-01 contrat Canvas et nettoyage des dépendances
       ├─ C-02 invalidation et boucle de rendu
       ├─ C-03 modèle d’assets persistants
       │    ├─ C-04 validité campagne/pions
       │    └─ C-05 fond et pions Canvas
       ├─ C-06 machine d’état des entrées
       └─ C-07 configuration et authentification Firebase
             └─ C-08 événements réseau et snapshots
                   └─ C-09 reconnexion réelle
                         └─ C-10 mobile et robustesse
                               └─ PC-CANVAS-1
                                     └─ gate performance tablette
```

Les tâches C-02, C-03 et C-07 peuvent être conçues séparément, mais leur intégration ne doit
pas être livrée hors de cet ordre.

---

## 6. C-00 — Installer les tests rouges de référence

### Fichiers

- `tests/stage.spec.mjs`
- `tests/player.spec.mjs`
- `tests/gmPanel.spec.mjs`
- éventuellement nouveaux fichiers `tests/*.spec.mjs` clairement spécialisés

### Travail

1. Ajouter un test de la vraie page `index.html` qui compte les rendus ou les callbacks rAF :
   après le premier rendu et 2 s d’inactivité, le compteur reste stable.
2. Ajouter le même test sur `player.html`.
3. Importer une carte avec image transitoire, effectuer un vrai `page.reload()`, puis prouver
   explicitement l’état attendu. Le test doit initialement exposer la perte d’image.
4. Importer un étage dont l’id n’est pas `rdc`, générer un pion, recharger réellement la page
   et vérifier que la campagne reste valide. Le test doit initialement échouer.
5. Vérifier qu’un événement publié ne contient aucune chaîne commençant par `data:` ou
   `blob:`.
6. Vérifier qu’une page démarrée sans transport affiche un état réseau explicite côté MJ,
   plutôt que de continuer silencieusement comme si elle était synchronisée.

### Critères d’acceptation

- Les tests reproduisent les défauts avant correctif.
- Aucun test n’utilise de valeur codée en dur telle que `tickerStarted: false`.
- Le test F5 exécute bien `page.reload()` et recharge le point d’entrée.
- Le rapport distingue clairement tests rouges attendus et régressions imprévues.

### Arrêt obligatoire

Faire relire les tests avant de commencer C-01. Ils définissent le contrat de toute la suite.

---

## 7. C-01 — Officialiser Canvas et rétablir l’honnêteté architecturale

### Fichiers

- `docs/STACK.md`
- `docs/ARCHITECTURE.md`
- `docs/CONVENTIONS.md`
- `docs/ETAT.md`
- `README.md`
- `package.json`
- `pnpm-lock.yaml`
- `index.html`
- `player.html`
- `diag.html`
- `scripts/check-deps.mjs`
- `tests/architecture.test.mjs`
- `tests/mountStage.mjs`
- `tests/stage.spec.mjs`

### Travail

1. Remplacer les contrats Pixi par les contrats Canvas réels :
   - `initStage()` renvoie canvas, contexte, résolution et dimensions logiques ;
   - les couches reçoivent un `CanvasRenderingContext2D` ;
   - `SquareGrid.renderGrid` reçoit le contexte Canvas ;
   - l’ordre des appels de rendu remplace l’ordre des enfants Pixi.
2. Retirer les imports maps Pixi si plus aucun module ne l’importe.
3. Retirer `pixi.js` et `pixi-viewport` de `package.json`.
4. Adapter `check-deps.mjs` pour vérifier uniquement les dépendances réellement utilisées.
5. Remplacer le faux test d’ordre des objets `{name}` par une instrumentation de l’ordre réel
   des appels de couches pendant une frame.
6. Ajouter un test architectural :
   - aucune occurrence de `from 'pixi.js'` ;
   - aucune dépendance npm runtime non documentée ;
   - aucune couche factice conservée uniquement pour compatibilité.
7. Supprimer le fichier parasite au nom de chemin Claude et ne pas commiter `.claude/`.
8. Mettre `ETAT.md` et le README au niveau réel d’avancement.

### Critères d’acceptation

- `pnpm run typecheck` passe sans Pixi installé.
- `pnpm run check-deps` ne vérifie plus une bibliothèque inutilisée.
- Les tests de rendu utilisent le vrai contexte Canvas.
- La documentation ne prétend plus que le runtime est Pixi.
- Aucun paramètre `container` factice ne subsiste dans les couches.

---

## 8. C-02 — Boucle de rendu à la demande et redimensionnement

### Fichiers

- `js/render/frame.js`
- `js/render/stage.js`
- `js/app/gm.js`
- `js/app/player.js`
- `js/render/layers/background.js`
- `tests/render.test.mjs`
- `tests/stage.spec.mjs`
- tests de pages réelles

### Modèle cible

`renderAll()` dessine une frame mais **ne demande jamais la suivante**.

Une frame est demandée uniquement par :

- mutation du store ;
- pan, zoom ou redimensionnement ;
- fin de chargement d’une image ;
- étape d’une animation encore active ;
- changement de caméra reçu du réseau.

### Travail

1. Retirer `frameLoop.requestFrame()` de la fin de `renderAll()`.
2. Donner à `FrameLoop` un callback explicite, sans mode de compatibilité avec un objet
   arbitraire exposant `render()`.
3. Faire remonter les exceptions de rendu au lieu de les réduire à `console.error`.
4. Éviter les doubles écouteurs `resize` entre `initStage` et les points d’entrée.
5. Centraliser le redimensionnement :
   - calcul des dimensions CSS ;
   - calcul du backing store avec résolution plafonnée ;
   - mise à jour de la caméra ;
   - demande d’une seule frame.
6. Au chargement asynchrone du fond, demander exactement une nouvelle frame.
7. Pendant une animation de mouvement, redemander une frame seulement tant que
   `Date.now() < animationEnd`.

### Critères d’acceptation

- Trois demandes synchrones produisent une seule frame.
- Après 2 s d’inactivité, le compteur n’augmente plus sur les deux pages réelles.
- Le chargement d’une image provoque au maximum une frame supplémentaire.
- Un resize produit une frame et conserve des dimensions logiques cohérentes.
- Aucun timer à 16 ms ne tourne après stabilisation.
- Tenue thermique : **à vérifier par le mainteneur**.

### Arrêt obligatoire — PC-CANVAS-A

Ne pas poursuivre tant que l’arrêt réel à l’inactivité n’est pas prouvé.

---

## 9. C-03 — Modèle d’assets persistants

### Fichiers

- `js/core/schema.js`
- `js/state/store.js`
- `js/ui/gm/importPanel.js`
- `js/ui/gm/tokenMaker.js`
- `js/ui/gm/panel.js`
- `js/transport/FirebaseTransport.js`
- `scripts/import-uvtt.mjs`
- `scripts/resample.mjs`
- tests import, store, panneau et transport

### Travail

1. Ajouter une validation « URL persistable » :
   - accepte URL relative ou HTTPS ;
   - refuse `data:` et `blob:` avant toute persistance ou publication.
2. Ne plus supprimer silencieusement `imageUrl` lors de la sauvegarde.
   - une campagne persistable est sauvée sans transformation ;
   - une campagne non persistable produit une erreur explicite avant écriture.
3. Dans l’import UVTT navigateur :
   - utiliser la base64 seulement pour l’aperçu local ;
   - ne pas ajouter cet étage au store partagé ;
   - proposer le flux CLI/publication pour obtenir `maps/<nom>.webp` et JSON.
4. Dans l’import image :
   - distinguer aperçu transitoire et étage publiable ;
   - demander ou produire une URL canonique avant ajout au store partagé.
5. Dans le générateur de pions :
   - télécharger le WebP ;
   - ne pas créer de pion partagé avec la data URL ;
   - produire ou demander le chemin canonique `maps/tokens/<id>.webp`.
6. Ajouter une garde récursive dans `transport.publish` en défense finale contre tout
   `data:`/`blob:`.
7. Ajouter la même garde dans `saveSnapshot`.
8. Documenter précisément le geste utilisateur entre téléchargement, placement dans le dépôt
   et publication.

### Critères d’acceptation

- Aucun `NetEvent` ne contient d’image encodée.
- Un snapshot sauvegardé puis rechargé conserve exactement ses `imageUrl`.
- Une tentative de sauvegarde d’une data URL échoue avant toute écriture.
- La fixture `maps/minimal.json` reste jouable après F5.
- Le panneau ne promet pas « importé avec succès » si l’asset n’est qu’un aperçu local.

---

## 10. C-04 — Validité permanente de la campagne et rattachement des pions

### Fichiers

- `js/state/store.js`
- `js/core/schema.js`
- `js/ui/gm/tokenMaker.js`
- `js/ui/gm/panel.js`
- `tests/store.test.mjs`
- `tests/tokenMaker.spec.mjs`
- `tests/gmPanel.spec.mjs`
- `tests/player.spec.mjs`

### Travail

1. Rendre `defaultLevelId` obligatoire pour générer un pion.
2. Le panneau passe systématiquement `store.getActiveLevelId()`.
3. Désactiver le générateur s’il n’existe aucun étage actif.
4. Faire valider `addToken()` :
   - identifiant unique ;
   - `levelId` existant ;
   - coordonnées entières et dans les limites utiles ;
   - objet conforme au schéma.
5. Faire valider `addLevel()` et `updateActiveLevel()` avant mutation.
6. Avant toute sauvegarde, valider la campagne complète.
7. En cas d’échec, ne pas altérer l’ancien état valide.
8. Faire distinguer les valeurs par défaut PC et PNJ :
   - PC : `playerMovable: true` ;
   - PNJ : `playerMovable: false`.

### Critères d’acceptation

- Un pion généré appartient toujours à l’étage actif.
- Un pion visant un étage inconnu est refusé immédiatement.
- Générer un pion puis exécuter un vrai F5 conserve campagne, étage et pion.
- Un PNJ généré n’est jamais déplaçable par les joueurs par défaut.
- Tous les tests vérifient le `levelId`, pas seulement la présence du pion dans le tableau.

---

## 11. C-05 — Terminer les couches Canvas

### C-05a — Fond

#### Fichiers

- `js/render/layers/background.js`
- `js/app/gm.js`
- `js/app/player.js`
- tests navigateur du fond

#### Travail

1. Remplacer `lastImageCache` global par un cache borné par URL.
2. Ne jamais dessiner l’image d’un autre étage pendant un chargement.
3. Exposer des états explicites : `idle`, `loading`, `ready`, `error`.
4. Permettre une nouvelle tentative après erreur.
5. Ignorer proprement la résolution tardive d’un chargement devenu obsolète.
6. Dessiner selon les dimensions carte déterminées par la grille, sans déformer le ratio.
7. Afficher un fond neutre et un message MJ visible en cas d’échec.

#### Critères

- Changer rapidement d’étage ne révèle jamais l’ancien fond.
- Une erreur 404 est visible et peut être retentée.
- Une image chargée déclenche une seule invalidation.
- F5 recharge la même URL canonique.

### C-05b — Pions

#### Fichiers

- `js/render/layers/tokens.js`
- tests navigateur des pions

#### Travail

1. Filtrer les pions par `activeLevel.id` avant rendu.
2. Charger et mettre en cache les images des pions par URL.
3. Dessiner l’image recadrée dans le cercle ou carré attendu.
4. Dessiner bordure, sélection, élévation et marqueurs dans un ordre déterministe.
5. Utiliser un placeholder explicite pendant chargement ou en cas d’erreur.
6. Respecter :
   - PNJ masqué absent côté joueurs ;
   - PNJ masqué semi-transparent côté MJ ;
   - aucun pion d’un autre étage.
7. Ajouter l’animation déterministe à partir de `{from, to, path, startedAt}` sans publier
   de position intermédiaire.

#### Critères

- Le test vérifie le contenu visuel de l’image, pas uniquement la couleur de bordure.
- Un pion 2×2 couvre exactement les bonnes cases.
- L’inactivité reprend après la fin de l’animation.
- Une image absente ne casse pas le rendu des autres pions.

### C-05c — Grille et zone de mouvement

#### Fichiers

- `js/grid/SquareGrid.js`
- `js/render/layers/gridLayer.js`
- `js/render/layers/moveZone.js`
- tests navigateur correspondants

#### Travail

1. Simplifier les signatures pour supprimer tous les modes de compatibilité Pixi/Canvas.
2. Conserver toute géométrie `pxPerCell` dans `grid/*`.
3. Faire de `clear()` une opération explicite ou supprimer cette méthode si le redraw complet
   la rend inutile.
4. Vérifier offsets non nuls et `pxPerCell` fractionnaire.
5. Vérifier que la zone de mouvement ne participe jamais au hit-test.

---

## 12. C-06 — Entrées tactiles et drag MJ

### Fichiers

- `js/input/pointer.js`
- `js/input/gestures.js`
- `js/app/gm.js`
- `js/ui/player/bootstrap.js`
- tests input et intégration

### Machine d’état cible

États exclusifs :

- `idle`
- `tapCandidate`
- `panning`
- `pinching`
- `gmTokenDrag`
- `longPress`

Une interaction ne doit jamais être simultanément `panning` et `gmTokenDrag`.

### Travail

1. Ne passer en `panning` qu’après dépassement du seuil spatial.
2. Tolérer les micro-mouvements d’un doigt sans annuler le tap.
3. À `pointerdown` MJ, effectuer le hit-test et retenir éventuellement le pion candidat.
4. Ne démarrer `gmTokenDrag` que si :
   - le pointeur a commencé sur un pion ;
   - le seuil temporel ou spatial défini est franchi.
5. Pendant `gmTokenDrag`, ne pas déplacer la caméra.
6. Pendant un pan sur le vide, ne jamais émettre `dragToken`.
7. Fournir l’identifiant du pion dans l’intention de drag.
8. Mettre à jour visuellement le drag local sans publication intermédiaire.
9. Au `pointerup`, valider la cellule finale puis publier une seule fois.
10. Côté joueurs :
    - seuls les PC `playerMovable` et non verrouillés sont sélectionnables ;
    - les PNJ restent non manipulables même si une donnée incohérente les marque movable.
11. Émettre une seule intention de tap sémantique, pas successivement `tapCell` et
    `tapToken`. Le hit-test applicatif décide ensuite de la cible.
12. Ancrer le zoom autour du centre du pinch ou de la molette.

### Critères d’acceptation

- Un mouvement de 1 à 4 px reste un tap.
- Un drag joueur déplace uniquement la caméra.
- Un drag MJ sur le vide déplace uniquement la caméra.
- Un drag MJ sur un pion déplace uniquement le pion.
- Aucun événement réseau n’est publié avant `pointerup`.
- Un PNJ visible ne peut pas être sélectionné ou déplacé côté joueurs.
- Les tests utilisent de vrais événements pointeur sur la page complète.

---

## 13. C-07 — Configuration et authentification Firebase

### Fichiers

- nouveau module de configuration runtime à ajouter d’abord au manifeste ;
- `js/app/gm.js`
- `js/app/player.js`
- `js/transport/FirebaseTransport.js`
- `js/ui/versionBadge.js`
- pages HTML si nécessaire
- tests Firebase et pages réelles

### Travail

1. Charger la configuration publique Firebase depuis un domicile unique.
2. Ne jamais y placer mot de passe, compte de test ou secret administratif.
3. Au démarrage :
   - créer le transport ;
   - attendre `currentUser()` ;
   - si absent, déclencher le geste de connexion Google autorisé ;
   - appeler `connect()` seulement après authentification ;
   - demander `snapshot()` avant d’appliquer les deltas.
4. Côté joueurs, limiter l’interface à la fenêtre de connexion déjà autorisée par les
   conventions.
5. Côté MJ, afficher clairement :
   - hors ligne ;
   - connexion en cours ;
   - connecté ;
   - erreur d’authentification ou de règles.
6. Brancher `transport.onError()` sur cet état visible.
7. Ne pas transformer une erreur Firebase en simple repli silencieux LocalStorage.
8. Définir explicitement le mode local :
   - activé par paramètre ou choix MJ ;
   - clairement affiché ;
   - jamais confondu avec une session Firebase fonctionnelle.

### Critères d’acceptation

- Un navigateur sans session ouvre une seule fois le flux Google.
- Après authentification, F5 réutilise la session sans nouveau popup.
- Une écriture refusée devient visible côté MJ.
- Une configuration absente ne donne pas l’impression que la session est partagée.
- Les tests Firebase restent ignorés uniquement lorsque leur configuration de test est
  réellement absente.

---

## 14. C-08 — Événements réseau, snapshots et présence

### Fichiers

- `js/state/store.js`
- éventuel module d’application des événements, ajouté au manifeste avant création ;
- `js/app/gm.js`
- `js/app/player.js`
- `js/ui/gm/panel.js`
- `js/ui/player/bootstrap.js`
- `js/transport/FirebaseTransport.js`
- `js/state/presence.js`
- `js/ui/versionBadge.js`
- tests transport et deux pages

### Travail

1. Implémenter un applicateur exhaustif des événements autorisés.
2. Les deux rôles s’abonnent après remise du snapshot.
3. Le MJ applique les déplacements joueurs.
4. Les joueurs appliquent :
   - ajout d’étage ;
   - réglages de grille ;
   - ajout de pion ;
   - mouvement de pion ;
   - changement de vue si `camera=follow`.
5. Éviter les doubles applications de l’événement local :
   - identifiant d’événement ou de client ;
   - mutation idempotente ;
   - tests d’écho.
6. Appeler `saveSnapshot()` après chaque mutation stabilisée pertinente :
   - import d’étage publiable ;
   - ajout de pion ;
   - réglage de grille ;
   - fin de mouvement.
7. Débouncer les sauvegardes rapprochées sans perdre la dernière version.
8. Ne jamais sauvegarder de position intermédiaire.
9. Publier et retirer correctement la présence.
10. Connecter réellement les badges de build au transport.
11. Définir et implémenter la purge du canal à la fin d’une session, ou documenter
    explicitement son report.

### Critères d’acceptation

- Deux pages réelles sur la même session convergent sans relais manuel dans le code du test.
- Un import MJ apparaît côté joueurs.
- Un pion ajouté apparaît côté joueurs avec son URL, sans image encodée.
- Un déplacement joueur apparaît côté MJ et inversement.
- Snapshot d’abord, delta ensuite : l’ordre est asserté.
- Une reconnexion ne rejoue pas l’historique.
- Un événement propre au client ne crée pas une seconde animation.

---

## 15. C-09 — Reconnexion réelle et repli local

### Fichiers

- `js/state/store.js`
- `js/transport/FirebaseTransport.js`
- `js/app/gm.js`
- `js/app/player.js`
- tests de reconnexion

### Travail

1. Définir la priorité :
   - snapshot Firestore valide ;
   - snapshot LocalStorage valide en mode local/hors ligne explicite ;
   - état vide visible.
2. Ne jamais fusionner silencieusement deux campagnes de versions différentes.
3. Persister séparément :
   - campagne durable ;
   - niveau actif ;
   - sélection si elle doit vraiment survivre ;
   - caméra locale par appareil.
4. Valider chaque donnée avant remplacement du store courant.
5. Conserver l’ancien état valide si le nouveau snapshot est rejeté.
6. Afficher la cause exacte d’un snapshot invalide côté MJ.
7. Effectuer les tests avec fermeture/rechargement réel du document.

### Matrice minimale de tests

| Cas | Résultat attendu |
|---|---|
| F5 MJ après import publié | carte, grille et pions restaurés |
| F5 joueurs | état restauré en moins de 3 s |
| F5 après déplacement | dernière position stabilisée restaurée |
| F5 après génération de pion | campagne toujours valide |
| Firestore indisponible, LocalStorage valide | mode local explicite |
| Snapshot invalide | ancien état conservé + erreur visible |
| Image 404 | campagne conservée + placeholder |
| Delta reçu pendant snapshot | remis après snapshot |

---

## 16. C-10 — Mobile, CSS et cycle de vie

### Fichiers

- `js/app/player.js`
- `css/player.css`
- `player.html`
- tests joueur

### Travail

1. Demander l’orientation `landscape`, pas `portrait`.
2. Utiliser :
   - `overscroll-behavior: none` ;
   - `touch-action: none` ;
   - `user-select: none`.
3. Ne pas accepter `contain` ou `manipulation` dans les tests.
4. Réacquérir le Wake Lock après retour de visibilité.
5. Ne pas considérer `requestFullscreen()` au chargement comme suffisant :
   - il nécessite généralement un geste ;
   - prévoir le geste de connexion ou le premier geste utilisateur comme déclencheur
     autorisé.
6. Détacher écouteurs, abonnements et Wake Lock dans une fonction de destruction.
7. Gérer `pointercancel`, perte de focus et changement d’orientation sans laisser une
   interaction bloquée.

### Critères d’acceptation

- Aucun geste navigateur parasite pendant pan/pinch.
- Orientation demandée : paysage.
- Retour d’arrière-plan : rendu et Wake Lock reprennent proprement.
- La vue joueurs conserve zéro UI hors exceptions documentées.
- Comportement réel Android : **à vérifier par le mainteneur**.

---

## 17. C-11 — Nettoyage, observabilité et documentation finale

### Fichiers

- tous les fichiers touchés par les tâches précédentes ;
- `README.md`
- `docs/ETAT.md`
- `docs/STACK.md`
- `docs/ARCHITECTURE.md`
- `docs/CONVENTIONS.md`
- `docs/TASKS-lot1a.md`

### Travail

1. Retirer tous les logs `[DEBUG]`.
2. Retirer les signatures de compatibilité et paramètres inutilisés.
3. Faire échouer le typecheck sur toute ancienne signature.
4. Vérifier les abonnements non désabonnés et écouteurs doublés.
5. Vérifier qu’aucune dépendance inutilisée ne reste.
6. Mettre à jour l’état réel des tâches sans annoncer les mesures tablette.
7. Documenter :
   - préparation et publication des assets ;
   - configuration Firebase ;
   - connexion initiale de la tablette ;
   - mode local explicite ;
   - procédure de diagnostic.
8. Ajouter au rapport final les écarts et décisions réellement prises.

### Critères d’acceptation

- `pnpm run typecheck` : code 0.
- `pnpm run test:unit` : vert, hors fixture réelle explicitement absente.
- `pnpm run test:e2e` : vert, avec raisons précises pour tout test ignoré.
- `pnpm run check-deps` : vert sur les dépendances réellement utilisées.
- `rg` ne trouve aucun `[DEBUG]`, `@ts-ignore`, `@ts-nocheck`, `pixi.js`,
  `pixi-viewport`, ni paramètre de couche factice.
- Arbre Git sans fichier mémoire ou configuration locale accidentelle.

---

## 18. Point de contrôle final du lot Canvas — PC-CANVAS-1

Revue obligatoire avant toute fonctionnalité de lot 2.

### Scénario complet

1. Préparer et publier une vraie carte.
2. Ouvrir la vue MJ.
3. Authentifier le MJ.
4. Ouvrir la vue joueurs sur la tablette avec la même session.
5. Ajouter au moins un PC et un PNJ.
6. Vérifier que le PNJ n’est pas manipulable côté joueurs.
7. Déplacer le PC côté joueurs.
8. Déplacer librement le PNJ côté MJ.
9. Modifier la grille.
10. Recharger les deux pages.
11. Couper puis rétablir le réseau.
12. Vérifier la présence, le build et les erreurs visibles.

### Résultat attendu

- aucune image disparue ;
- aucune campagne rejetée ;
- aucune position intermédiaire réseau ;
- aucune image encodée réseau ;
- convergence des deux vues ;
- zéro frame à l’inactivité ;
- reprise correcte après F5 et reconnexion ;
- aucune erreur console non expliquée.

---

## 19. Gate performance avant fog et lumière

Canvas 2D reste retenu si les mesures réelles sont satisfaisantes sur la Tab S9 FE.

### Profil de mesure

- carte réelle à la résolution maximale retenue ;
- 30 pions visibles avec images ;
- grille visible ;
- zone de déplacement active ;
- pan et pinch continus ;
- cast actif vers la TV ;
- session d’au moins 45 minutes ;
- prototype représentatif du futur masque de fog avant de commencer le lot 2.

### Mesures

- fps moyen et minimum pendant interaction ;
- temps d’une frame complète ;
- stabilité après 5, 15 et 45 minutes ;
- mémoire et nombre d’images mises en cache ;
- latence Firebase p50/p95 ;
- absence de rendu à l’inactivité ;
- température et bridage observé.

### Décision

Conserver Canvas si :

- l’interaction reste à 30 fps stables sous cast ;
- aucune dérive thermique problématique n’apparaît ;
- le prototype de fog respecte le budget de frame ;
- le cache d’images reste borné et stable.

Réévaluer un renderer GPU si l’un de ces critères échoue de manière reproductible. Dans ce
cas, ne pas restaurer l’ancienne implantation Pixi : écrire un nouveau contrat de renderer et
un prototype minimal comparatif avant toute migration.

Tous ces critères restent **à vérifier par le mainteneur**.

---

## 20. Risques et parades

| Risque | Parade |
|---|---|
| Corriger le F5 en remettant les base64 dans LocalStorage | Refuser les URL non persistables et utiliser des assets publiés |
| Masquer une panne Firebase derrière le mode local | État réseau visible et mode local explicitement choisi |
| Rendre les tests verts par nouvelles sondes factices | Tester les points d’entrée et pages réelles |
| Réintroduire une boucle permanente pour animer un pion | Invalidations bornées à la durée de l’animation |
| Pan caméra pendant drag MJ | Machine d’état exclusive |
| Déplacer un PNJ côté joueurs | Vérification `kind === 'pc'` + `playerMovable` + `locked` |
| Mélanger les pions de plusieurs étages | Filtrage par `levelId` avant rendu et hit-test |
| Accumuler des images en mémoire | Cache par URL borné et politique d’éviction |
| Ajouter une configuration secrète au dépôt | Configuration Web publique seulement, aucun compte ni mot de passe |
| Déclarer Canvas performant sur PC | Gate matérielle obligatoire sur tablette sous cast |

---

## 21. Priorités si le travail doit être fractionné

### Bloc P0 — rendre le projet non destructeur

1. C-00 tests rouges.
2. C-01 contrat Canvas et nettoyage des dépendances.
3. C-02 arrêt de la boucle.
4. C-03 assets persistants.
5. C-04 `levelId` des pions et validation avant sauvegarde.
6. Partie locale de C-09 : vrai F5 sur une campagne persistable.

À la fin de P0, le projet ne doit plus perdre image ou campagne.

### Bloc P1 — rendre une séance partagée possible

1. C-05 couches Canvas complètes.
2. C-06 drag MJ et droits joueurs.
3. C-07 configuration/authentification.
4. C-08 événements et snapshots.
5. C-09 reconnexion réseau complète.

À la fin de P1, deux appareils doivent pouvoir jouer une séance minimale.

### Bloc P2 — consolider

1. C-10 mobile.
2. C-11 nettoyage et documentation finale.
3. PC-CANVAS-1.
4. Gate performance.

---

## 22. Définition de terminé pour ce plan

Le plan est terminé uniquement lorsque :

1. le scénario PC-CANVAS-1 passe ;
2. les pages réelles sont utilisées par les tests d’intégration ;
3. aucune image n’est encodée dans les données persistées ou réseau ;
4. un vrai F5 conserve campagne, carte, pions, étage actif et caméra locale ;
5. le transport est authentifié, connecté et visible ;
6. le renderer est arrêté à l’inactivité ;
7. les droits PJ/PNJ et le drag MJ correspondent au cahier des charges ;
8. les documents normatifs décrivent Canvas sans vestige contractuel Pixi ;
9. les mesures physiques non réalisées sont explicitement laissées au mainteneur ;
10. aucune tâche suivante — fog, lumière, vision — n’a été anticipée.

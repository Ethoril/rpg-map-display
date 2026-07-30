# Chantier K — badge d'élévation, dernier item du lot 1b

> Brief d'exécution **court**, écrit le 30 juillet 2026. Autonome : tout ce qui suit a été
> vérifié dans le dépôt, il n'y a rien à redécouvrir.
>
> Référence : CdC §5.3 (ligne 295), §7 (ligne 638), §11 lot 1b (ligne 818).
>
> **Règle commune, non négociable :** `pnpm run verify` doit sortir en code 0 à la fin du
> chantier. Aucun critère d'acceptation ne peut être affaibli ni réécrit pour coller au
> comportement obtenu.
>
> **Aucun fichier à créer**, ni dans `js/` ni ailleurs. `ARCHITECTURE.md` n'est pas à
> amender : tous les fichiers touchés existent déjà.

---

## 1. Pourquoi

Un mage qui vole, un personnage qui a escaladé un mur, quelqu'un au fond d'une fosse. Le
CdC §5.3 est explicite sur le périmètre : « altitude numérique (vol, escalade, fosse).
**Simple badge affiché sur le pion, sans aucune incidence sur la géométrie ni sur la
vision.** » C'est de l'information pour la table, pas une mécanique de jeu.

C'est le dernier item du lot 1b.

---

## 2. Faits établis — ne pas les redécouvrir

1. **Le badge est déjà dessiné.** `js/render/layers/tokens.js:283-301` affiche `+N` / `−N`
   dans un disque dès que `elevation !== 0`, et les deux vues partagent cette couche.
   **L'affichage n'est pas le travail de ce chantier.**
2. **`validateCampaign` contrôle déjà le champ** : `!Number.isFinite(token.elevation)` fait
   échouer la validation (`js/core/schema.js:511`). Une mutation transactionnelle hérite donc
   du contrôle sans rien ajouter. À noter : le schéma **n'exige pas un entier**.
3. **Le store n'a aucune mutation pour modifier un pion existant.** Ses exports comptent
   `addToken`, `removeToken`, `moveTokenToCell`, `updateLevel`, `updateActiveLevel` — mais
   **pas d'`updateToken`**. C'est le vrai travail de ce chantier.
4. **Le motif transactionnel à copier est `updateLevel`** (`js/state/store.js:512-540`) :
   cloner la campagne, appliquer le patch sur la copie, `assertValidCampaign(candidate, …)`,
   puis seulement affecter et notifier. Il refuse aussi explicitement la modification de
   l'`id`.
5. **L'événement `token.elevation` est déjà nommé au CdC §7 ligne 638** (émetteur **MJ**,
   ponctuel), mais `applyNetworkEvent` n'en a aucun cas : il traite `scene.load`,
   `level.add`, `level.grid`, `token.add`, `token.move`, `handout.show` et `handout.hide`.
   `CONVENTIONS.md:149` interdit d'inventer un type : utiliser celui du §7, tel quel.
6. **`elevation: 0` est posé à la création** (`js/ui/gm/tokenMaker.js:451`) et plus jamais
   modifié ensuite.
7. **La TV n'est pas une vue.** Le §3 (lignes 81-83) décrit trois écrans : le Mac (MJ), la
   tablette (joueurs), et la TV en **miroir passif de la tablette** par Google Cast. Le
   troisième écran ne demande donc **aucun code** — il impose une **lisibilité à distance**,
   après réduction par le cast et avec ~10 % de hauteur perdue en bandes noires (16:10 sur
   16:9, ligne 111).

---

## 3. Décisions arrêtées par le mainteneur

1. **`updateToken(tokenId, patch)` avec une liste blanche de champs modifiables, et
   `elevation` seule dedans pour l'instant.** Pas de patch générique : `id`, `cell` et
   `levelId` portent des invariants propres et ont déjà leurs mutations dédiées
   (`moveTokenToCell` notamment). Un patch libre permettrait de les contourner
   silencieusement. Tout champ hors liste blanche est **refusé bruyamment**.
2. **La liste blanche est conçue pour accueillir `markers`, mais `markers` n'est pas
   implémenté ici.** Le jeu de marqueurs est la question ouverte n°7 du §12, que le CdC
   repousse « après une séance réelle, pas avant », et c'est un livrable du lot 2. Le
   mécanisme est mutualisé, pas la fonctionnalité.
3. **`token.elevation` porte la valeur absolue, jamais un delta.** Le rejouer deux fois
   converge, conformément à `CONVENTIONS.md:156`. C'est la même leçon que `handout.hide` au
   chantier H : une bascule ou un incrément casse l'idempotence.
4. **Ne pas inventer de contrainte d'entier.** Le schéma exige un nombre fini, pas un entier
   (§2.2) ; le CdC ne dit rien de plus. Même refus qu'au chantier G, où aucune échelle n'a été
   inventée pour `intensity`.
5. **Le contrôle agit sur le pion sélectionné**, et est **désactivé sans sélection**, avec un
   motif visible — comme `tokenMaker` se désactive sans étage actif. L'ergonomie reste libre
   (§5.7 : « pas l'ergonomie définitive »).
6. **Le critère du lot 1b se clôt en deux temps.** Le code ici ; la **lisibilité au cast**
   est une mesure sur la tablette réelle, impossible à établir sur un poste de bureau. Elle
   rejoint la liste « Ce qui reste à vérifier manuellement » d'`ETAT.md`. **Ne pas cocher le
   critère §11 ligne 818 sur la foi d'un test desktop** — `ETAT.md` dit déjà que ces points
   « ne doivent pas être déclarés réussis à partir d'un test desktop ».

---

## 4. Contrat

1. **`js/state/store.js`** — `updateToken(tokenId, patch)` sur le motif exact d'`updateLevel`
   (§2.4) : clone, patch, `assertValidCampaign`, puis affectation et notification. Pion
   inconnu → lever. Champ hors liste blanche → lever, en le nommant.
2. **`js/app/networkEvents.js`** — cas `token.elevation`, payload `{ tokenId, elevation }`.
   Idempotent. Pion inconnu ou valeur non finie : journaliser et ignorer sans muter le store,
   comme `scene.load` le fait déjà (ligne 39).
3. **`js/ui/gm/panel.js`** — contrôle de l'élévation du pion sélectionné, désactivé sans
   sélection, publiant `token.elevation` après la mutation locale.
4. **Rien à changer dans `js/render/layers/tokens.js`** (§2.1). Si le rendu doit bouger, ce
   sera pour la lisibilité au cast, après mesure — pas dans ce chantier.

---

## 5. Interdictions

- Ne créer **aucun** fichier, et ne pas amender `ARCHITECTURE.md`.
- Ne pas inventer de type d'événement : `token.elevation` existe au §7.
- **Ne pas faire de `token.elevation` un incrément ou une bascule** : valeur absolue.
- Ne pas ouvrir la liste blanche à `id`, `cell` ou `levelId`, ni la rendre générique.
- Ne pas implémenter les marqueurs d'état (§3.2).
- Ne pas donner d'effet géométrique à l'élévation : ni vision, ni portée, ni cases
  atteignables. Le CdC l'exclut explicitement.
- Ne pas exiger un entier (§3.4).
- Ne pas permettre à la vue joueurs de modifier l'élévation : le §7 réserve l'événement au MJ.
- **Ne pas déclarer le critère §11 ligne 818 satisfait** : il attend une mesure tablette.
- Ne pas commiter : le mainteneur relit puis commite.

---

## 6. Tests

- **Unitaire** — `updateToken` modifie l'élévation et **ne mute rien** si la campagne
  candidate est invalide ; pion inconnu → lève ; champ hors liste blanche → lève en le
  nommant.
- **Unitaire** — `updateToken` ne permet pas de modifier `cell`, `levelId` ni `id`.
- **Unitaire** — `applyNetworkEvent` sur `token.elevation` : état attendu, et **rejeu deux
  fois du même événement** sans divergence.
- **Unitaire** — `token.elevation` sur un pion inconnu ou avec une valeur non finie :
  retourne `false` et laisse le store intact.
- **Navigateur** — le MJ change l'élévation d'un pion sélectionné ; un **second client**
  reçoit la valeur via `token.elevation`. Faire converger deux vraies pages par le canal du
  navigateur, sans relais par le test (motif de `tests/tokenLibrary.spec.mjs` test 5).
- **Navigateur** — sans sélection, le contrôle est désactivé et le store reste intact.
- **Navigateur** — le badge apparaît quand l'élévation est non nulle et disparaît à 0.

---

## 7. Acceptation

1. `pnpm run verify` en code 0.
2. Une élévation posée côté MJ est visible sur la vue joueurs, donc sur la TV qui la duplique.
3. La suite unitaire reste sous 3 s.
4. `ARCHITECTURE.md` est **inchangé**.
5. `docs/ETAT.md` mentionne la lisibilité du badge au cast dans « Ce qui reste à vérifier
   manuellement », et le critère §11 ligne 818 **n'est pas coché**.

---

## 8. Ce qui sera contrôlé à la relecture

Indépendamment de ce que le rapport d'exécution affirmera :

- **Test de mutation** : en rendant `token.elevation` incrémental, le test de rejeu doit
  échouer. En retirant la liste blanche d'`updateToken`, le test refusant la modification de
  `cell` doit échouer.
- Que `updateToken` valide bien la campagne **entière** avant d'affecter, et non seulement le
  pion — c'est ce qui distingue le motif d'`updateLevel` d'un patch naïf.
- Que le test de synchronisation utilise **deux vraies pages** et pas un relais par le test.
  C'est la lacune trouvée au chantier I, où quatre specs tournaient sans transport et donc
  sur un `publish` sans effet.
- Que les marqueurs d'état n'ont pas été implémentés en passant.
- Que l'élévation n'a **aucun** effet sur les cases atteignables ni sur la vision.
- Que le critère §11 ligne 818 n'a pas été coché, et que la mesure attendue est bien
  consignée dans `ETAT.md`.
- Qu'aucun critère ci-dessus n'a été réécrit pour coller au résultat obtenu.

# Chantier H — révélation d'image aux joueurs (§5.8)

> Brief d'exécution **court**, écrit le 30 juillet 2026. Autonome : tout ce qui suit a été
> vérifié dans le dépôt, il n'y a rien à redécouvrir.
>
> Référence : CdC §5.8, §7 (table des événements), §11 lot 1b.
>
> **Volontairement court.** Le CdC place §5.7/§5.8 dans le seul lot qu'il désigne comme « à
> **affiner à l'usage** plutôt qu'à spécifier d'avance » (§1), et §5.7 précise « fixe le
> périmètre et les structures de données, pas l'ergonomie définitive ». Ce brief gèle donc
> les données, les événements et les frontières. **L'ergonomie est laissée libre.**
>
> **Règle commune, non négociable :** `pnpm run verify` doit sortir en code 0 à la fin du
> chantier. Aucun critère d'acceptation ne peut être affaibli ni réécrit pour coller au
> comportement obtenu.

---

## 1. Pourquoi

Le MJ affiche une image (portrait, lettre, rune, plan trouvé) en plein écran sur la vue
joueurs, jusqu'à fermeture par lui. Le CdC en fait le **meilleur rapport valeur/effort du
document** — « quelques dizaines de lignes, un seul événement réseau » (§5.8, ligne 491).

C'est aussi le plus petit des trois restants du lot 1b, et le seul totalement autonome :
il « ne touche ni la carte, ni les pions, ni le fog ».

---

## 2. Faits établis — ne pas les redécouvrir

Tout ce qui suit **existe déjà**. Rien n'est à concevoir ni à nommer.

| Élément | Où | Contenu |
|---|---|---|
| Noms d'événements | CdC §7 ligne 636 | `handout.show` / `handout.hide`, émetteur **MJ**, ponctuel |
| Structure de donnée | `js/core/types.js:194` | `Handout` = `{ id, name, imageUrl }` — figée |
| Fichier UI MJ | `ARCHITECTURE.md:101` | `js/ui/gm/handouts.js` `[1b]` |
| Fichier UI joueurs | `ARCHITECTURE.md:107` | `js/ui/player/handoutOverlay.js` `[1b]` |
| Validateur d'URL | `js/core/schema.js:325` | `assertPersistableAssetUrl` / `isPersistableAssetUrl` |
| Garde transport | `js/transport/FirebaseTransport.js:45` | `assertNoTransientAssetUrls`, récursive |

1. **Les deux fichiers sont déjà au manifeste**, marqués `[1b]`. `ARCHITECTURE.md` est
   « normatif et fermé » : **aucun autre fichier ne doit être créé**. Le manifeste n'a donc
   pas à être modifié — cas rare, en profiter.
2. **`CONVENTIONS.md:149` interdit d'inventer un type d'événement** et cite précisément
   `handout.show` en exemple. Utiliser les deux noms du §7, tels quels.
3. **`CONVENTIONS.md:154` : « Ne jamais transmettre d'image, ni en base64, ni en tuile, ni
   en dataURL. Uniquement des URLs relatives au dépôt. »** Et ce n'est pas qu'une consigne :
   `assertNoTransientAssetUrls` refuse `data:` et `blob:` **à toute profondeur**, sur
   `publish` comme sur `saveSnapshot`. Un MJ qui choisit un fichier local obtient une
   exception, pas un affichage. **C'est la contrainte structurante du chantier.**
4. **Zero-UI côté joueurs, vérifié mécaniquement.** `tests/player.spec.mjs:341` exige
   `document.querySelectorAll('button, nav, input').length === 0` sur `player.html`. Un
   `<img>` plein écran est compatible ; **un bouton de fermeture ne l'est pas** — et c'est
   cohérent avec §5.8, où la fermeture appartient au MJ seul.
5. **L'overlay de version joueurs occupe `z-index: 9999`** (`js/ui/versionBadge.js:137`) et
   signale un écart de build. Le plein écran de révélation doit passer **en dessous** :
   masquer cet avertissement rendrait un client périmé indétectable à table.
6. **`ui/*` ne doit jamais importer `transport/*` en direct** (`ARCHITECTURE.md:170`), mais
   reçoit le transport **par injection** et appelle `.publish()`. Motif établi :
   `js/ui/gm/panel.js:156` et `createSceneLibrary(mount, { transport })` à la ligne 169.
7. **`applyNetworkEvent` est le point d'entrée unique** (`js/app/networkEvents.js:19`) ; son
   `default` retourne `false` (ligne 76). Les deux nouveaux cas s'y ajoutent.
8. **L'état de session a déjà un domicile distinct de la campagne.**
   `saveToLocalStorage` écrit `rpg_session_<id>` = `{ activeLevelId, selectedTokenId }`
   (`js/state/store.js:116`), séparé de `rpg_campaign_<id>`. Et `createSnapshotPayload`
   (`js/app/networkEvents.js:86`) ne transporte que ces trois champs.
9. **La reconnexion n'est pas un cas limite.** CdC §7 ligne 658 : « À chaque `connect`, le
   client reçoit un snapshot complet avant tout delta… Une session doit survivre à un F5
   accidentel sur la tablette **en cours de partie — c'est le scénario nominal** ».

---

## 3. Décisions arrêtées par le mainteneur

Ces trois points ne sont pas tranchés par le CdC. Ils ont été **arrêtés le 30 juillet 2026**
et ne sont pas à rediscuter en cours d'exécution.

1. **Le handout affiché est un état de *session*, pas une donnée de campagne.** Il rejoint
   `activeLevelId` et `selectedTokenId` : dans le snapshot, dans `rpg_session_<id>`, hors du
   document validé par `validateCampaign`. Raison : le CdC §11 prévient qu'ajouter un champ
   au modèle après le lot 1a est un refactor transverse, et le chantier G a déjà refusé
   d'étendre le modèle pour moins que ça. Conséquence assumée : un handout affiché **survit
   à un F5 tablette**, conformément au §7 ligne 658.
2. **Pas de catalogue de handouts.** Le MJ saisit une URL, validée par
   `isPersistableAssetUrl`, et la convention de publication est celle que `tokenMaker`
   affiche déjà (`js/ui/gm/tokenMaker.js:152`) : déposer le fichier dans un dossier publié
   du dépôt avant la séance. Construire une chaîne de préparation d'images comme celle des
   cartes serait hors périmètre d'un lot dont l'ergonomie est explicitement non figée.
3. **Un seul handout affiché à la fois.** `handout.show` porte l'état absolu (quel handout),
   pas une pile. `handout.hide` n'est pas une bascule.

---

## 4. Contrat

1. **`js/ui/gm/handouts.js`** — `createHandouts(mount, { transport })`, sur le motif de
   `createSceneLibrary`. Saisie d'une URL, refus visible d'une URL non persistable **avant**
   toute publication, et indication de ce qui est actuellement affiché chez les joueurs.
2. **`js/ui/player/handoutOverlay.js`** — plein écran, `position: fixed`, `z-index`
   strictement inférieur à 9999, image contenue sans déformation, **aucun `button`, `nav`
   ni `input`**. Ne touche ni le canvas, ni la caméra, ni le store de rendu.
3. **Deux cas dans `applyNetworkEvent`** : `handout.show` (payload `{ handout }` conforme au
   typedef) et `handout.hide` (payload vide). Idempotents — rejouer deux fois converge
   (`CONVENTIONS.md:156`). Un payload aberrant se journalise et s'ignore sans muter le
   store, comme `scene.load` le fait déjà (`networkEvents.js:39`).
4. **Une mutation nommée dans le store**, sur le modèle des mutations existantes, et le
   champ ajouté à `createSnapshotPayload`, `restoreFromSnapshot`, `saveToLocalStorage` et
   `loadFromLocalStorage`. Une URL non persistable est **refusée à l'entrée du store**, pas
   seulement à l'affichage.
5. **Câblage dans `js/app/gm.js` et `js/app/player.js`**, seuls autorisés à tout importer.

---

## 5. Interdictions

- Ne pas inventer de type d'événement : `handout.show` / `handout.hide`, rien d'autre.
- Ne pas modifier le typedef `Handout` ni ajouter un champ au modèle de campagne.
- Ne pas faire transiter d'image : ni base64, ni `data:`, ni `blob:`.
- **Ne pas ajouter de `button`, `nav` ou `input` à `player.html`** — cela casse T-23.
- Ne pas créer de fichier hors des deux déjà inscrits au manifeste.
- Ne pas affaiblir `assertNoTransientAssetUrls` ni le contourner.
- Ne pas toucher au fog, aux pions, à la caméra ni au rendu de la carte.
- Ne pas commiter : le mainteneur relit puis commite.

---

## 6. Tests

- **Unitaire** — `applyNetworkEvent` sur `handout.show` puis `handout.hide` : état attendu,
  et **rejeu deux fois du même événement** sans divergence.
- **Unitaire** — une URL `data:` ou `blob:` est refusée par le store, sans mutation.
- **Unitaire** — aller-retour `createSnapshotPayload` → `restoreFromSnapshot` conservant le
  handout affiché.
- **Navigateur** — deux onglets, même session : le MJ révèle, l'overlay apparaît côté
  joueurs **en moins de 500 ms** ; il ferme, et la carte est intacte (canvas et pions
  inchangés).
- **Navigateur** — F5 sur la vue joueurs pendant qu'un handout est affiché : il revient.
- **Navigateur** — T-23 reste vert : toujours zéro `button`/`nav`/`input` sur `player.html`,
  handout affiché **ou non**.
- **Navigateur** — l'overlay de version reste visible par-dessus un handout affiché.

---

## 7. Acceptation

1. `pnpm run verify` en code 0.
2. Le critère du CdC §11 ligne 816 est tenu tel qu'il est écrit : « Une image révélée
   s'affiche en plein écran chez les joueurs en < 500 ms, et sa fermeture rend la carte
   intacte. »
3. `git status` ne montre aucune modification de `maps/` ni de `fixtures/`.
4. La suite unitaire reste sous 3 s.
5. `ARCHITECTURE.md` §1 est **inchangé** : les deux fichiers y figuraient déjà.

---

## 8. Ce qui sera contrôlé à la relecture

Indépendamment de ce que le rapport d'exécution affirmera :

- **Test de mutation** : en retirant la validation d'URL du store, le test de refus
  `data:`/`blob:` doit échouer. En rendant `handout.hide` bascule au lieu d'absolu, le test
  de rejeu doit échouer.
- Qu'aucun `button`/`nav`/`input` n'est apparu sur `player.html`, y compris **pendant**
  l'affichage d'un handout.
- Que le `z-index` du plein écran est bien inférieur à 9999, et vérifié par un test plutôt
  qu'affirmé.
- Qu'aucun champ n'a été ajouté au document de campagne ni au typedef `Handout`.
- Qu'aucun critère ci-dessus n'a été réécrit pour coller au résultat obtenu.

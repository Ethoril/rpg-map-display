# Chantier I — bibliothèque de pions (§5.7)

> **Amendé le 30 juillet 2026, après clôture.** Deux faits de ce brief ne tiennent plus, et
> le corps du document est laissé intact plutôt que réécrit :
>
> - le fait n°7 (« la garde transport refuse `data:` et `blob:` récursivement ») : `blob:`
>   reste refusé sans condition, mais un `data:` **borné** passe désormais ;
> - la décision §3.2 (« le dépôt du WebP dans `maps/tokens/` reste manuel : ce chantier ne
>   l'aggrave ni ne la résout ») : `tokenMaker` embarque maintenant l'image dans le pion,
>   donc plus aucun dépôt n'est requis pour qu'un pion créé s'affiche.
>
> La contrainte reste entière pour le **catalogue commité**, qui continue d'exiger des URL
> vers des fichiers réels — `validateTokenCatalog` refuse toujours `data:`. Raisonnement
> complet dans `ETAT.md` § « Persistance et assets ».

> Brief d'exécution **court**, écrit le 30 juillet 2026. Autonome : tout ce qui suit a été
> vérifié dans le dépôt, il n'y a rien à redécouvrir.
>
> Référence : CdC §5.7, §11 lot 1b.
>
> **Volontairement court**, pour la même raison que le chantier H : §5.7 est « conçue
> progressivement », elle « fixe le périmètre et les structures de données, pas l'ergonomie
> définitive ». Ce brief gèle les données et les frontières. **L'ergonomie est libre.**
>
> **Règle commune, non négociable :** `pnpm run verify` doit sortir en code 0 à la fin du
> chantier. Aucun critère d'acceptation ne peut être affaibli ni réécrit pour coller au
> comportement obtenu.

---

## 1. Pourquoi

« Les PNJ récurrents sont recadrés une fois, pas à chaque séance » (§5.7). Aujourd'hui
`tokenMaker` produit un WebP et l'oublie : tout est à refaire à la séance suivante.

C'est aussi la pièce qui **débloque la séance réelle**, donc l'arbitrage de la question
ouverte n°7 du CdC §12 (jeu de marqueurs d'état), que le document repousse explicitement
« après une séance réelle, pas avant » — et dont dépend une partie du lot 2.

---

## 2. Faits établis — ne pas les redécouvrir

| Élément | Où | Contenu |
|---|---|---|
| Structure de donnée | `js/core/types.js:170` | `TokenLibraryEntry`, 10 champs — figée |
| Fichier UI | `ARCHITECTURE.md` §1 | `js/ui/gm/tokenLibrary.js` `[1b]` |
| Module d'import pur | `ARCHITECTURE.md` §1 | `js/import/tokenCatalog.js` `[1b]` |
| Précédent à copier | `js/ui/gm/sceneLibrary.js:33` | catalogue commité, `catalogUrl` injectable |
| Validateur d'URL | `js/core/schema.js:325` | `assertPersistableAssetUrl` |

1. **Les deux fichiers sont au manifeste** en `[1b]`. `ARCHITECTURE.md` est « normatif et
   fermé » : **aucun autre fichier de `js/` ne doit être créé.** `tokenCatalog.js` y a été
   ajouté pour ce chantier, avec sa justification en note sous l'arborescence du §1.
2. **La correspondance vers `Token` est bijective, à un renommage près.** Les 9 champs de
   `TokenLibraryEntry` autres que `id` portent **le même nom** que dans `Token`
   (`imageUrl`, `kind`, `sizeCells`, `speedCells`, `visionBright`, `visionDim`,
   `emitsLight`, `borderColor`), **sauf `name`, qui alimente `Token.label`**. Les champs
   restants de `Token` (`cell`, `levelId`, `hidden`, `playerMovable`, `locked`,
   `elevation`, `markers`) sont fournis à l'instanciation. **Aucun champ à ajouter au
   modèle.**
3. **`TokenLibraryEntry` ne fait pas partie de `Campaign`** (cf. le typedef `Campaign`,
   ligne 158) : la bibliothèque n'est pas une donnée de campagne et ne passe pas par
   `validateCampaign`.
4. **`maps/tokens/` n'existe pas encore**, alors que `tokenMaker.js:152` affiche déjà au MJ
   « Placez-le dans `maps/tokens/` avant de partager la campagne ». La convention est donc
   annoncée mais le dossier reste à créer.
5. **Divergence de nommage préexistante, à ne pas « corriger ».** Le CdC §7 annonce
   `token.create`, mais le code publie et applique `token.add` (`js/ui/gm/panel.js:157` et
   `js/app/networkEvents.js:59`). L'instanciation **réutilise `token.add`**. Ne pas
   renommer, ne pas inventer : `CONVENTIONS.md:149` interdit d'ajouter un type d'événement.
6. **`store.addToken` valide la campagne entière et ne mute rien en cas de refus** — c'est
   déjà couvert par un test unitaire existant. S'appuyer dessus, ne pas le contourner.
7. La garde transport refuse `data:` et `blob:` **récursivement**
   (`js/transport/FirebaseTransport.js:45`), sur `publish` comme sur `saveSnapshot`.
8. **Les couches pures sont le substrat partagé navigateur ↔ Node**, ce n'est pas une vue de
   l'esprit : `js/import/uvtt.js` est importé par `scripts/import-uvtt.mjs:5` **et**
   `scripts/prepare-maps.mjs:6`, aux côtés de `js/core/schema.js` et `js/core/constants.js`.
   C'est la raison d'être de `tokenCatalog.js` : une validation qui touche le DOM serait
   inutilisable depuis Node.

---

> ## ⚠ Amendé par le chantier M, le 31 juillet 2026
>
> **La décision n°2 ci-dessous — « la bibliothèque est en lecture seule » — ne tient plus.**
> Sa justification était « aucune écriture de fichier depuis le navigateur, c'est impossible
> sans chaîne d'upload, hors périmètre ». Le chantier L a livré un serveur local qui écrit
> dans le dépôt : la prémisse est tombée.
>
> La bibliothèque se remplit désormais depuis `prepare.html`, qui écrit l'image **et**
> l'entrée. Éditer et supprimer n'importe quelle entrée est possible, entrées de
> démonstration comprises.
>
> **La décision n°1 tient toujours**, et c'est elle qui a guidé l'implantation : source de
> vérité = catalogue commité, **pas LocalStorage**, parce que le mainteneur travaille depuis
> plusieurs machines. On écrit le fichier commité, pour que la bibliothèque voyage par git.
>
> **L'action « copier l'entrée JSON » de la décision n°2 a été retirée.** Elle produisait une
> entrée pointant sur un fichier absent, et l'amendement du 30/07 — image de pion embarquée
> en `data:` — l'a rendue définitivement inutilisable, le catalogue refusant les `data:`.
> Détail dans `ETAT.md` § « Chantier M ».

## 3. Décisions arrêtées par le mainteneur

1. **La source de vérité est un catalogue commité : `maps/tokens/catalog.json`**, sur le
   modèle exact de `maps/catalog.json`. **Pas LocalStorage** : le mainteneur travaille
   depuis plusieurs machines, une bibliothèque locale au navigateur serait perdue au
   changement de poste. **Pas le document de campagne** : `TokenLibraryEntry` en a été tenu
   à l'écart délibérément (§2.3).
2. **La bibliothèque est en lecture seule dans l'interface.** Aucune écriture de fichier
   depuis le navigateur — c'est impossible sans chaîne d'upload, hors périmètre. Pour que
   le MJ n'ait pas à saisir les métadonnées à la main, **`tokenMaker` gagne une action
   « copier l'entrée JSON »** qui produit une entrée `TokenLibraryEntry` prête à coller
   dans le catalogue. Le dépôt du WebP dans `maps/tokens/` reste manuel : cette contrainte
   est préexistante (`tokenMaker.js:152`), ce chantier ne l'aggrave ni ne la résout.
3. **Aucun nouvel événement réseau.** La bibliothèque est un outil d'auteur, côté MJ. Seul
   le pion instancié se synchronise, par le `token.add` existant.
4. **La validation du catalogue vit dans un module d'import pur, `js/import/tokenCatalog.js`**,
   symétrique de `js/import/catalog.js` pour les scènes — lequel est spécifique aux cartes
   (il valide `sceneUrl`/`imageUrl` de scènes) et n'est donc pas réutilisable tel quel.
   « Pur » a un sens précis et vérifié mécaniquement : **aucun accès au DOM, aucune I/O,
   aucun import hors `core/*`**. Le `fetch` reste du côté de `tokenLibrary.js` ; le module
   d'import ne reçoit que des données déjà lues.

   *Un premier jet de ce brief logeait cette validation dans `tokenLibrary.js`, pour ne pas
   toucher un manifeste « fermé ». C'était privilégier la lettre du document sur sa raison
   d'être, pour les deux motifs du §2.8 : testabilité en `node:test` plutôt qu'au navigateur,
   et réutilisation depuis Node. Le manifeste a donc été amendé, comme il l'avait été à
   T-13 et avec la même exigence de justification écrite.*

---

## 4. Contrat

1. **`maps/tokens/catalog.json`** — `{ version: 1, tokens: TokenLibraryEntry[] }`, avec au
   moins une entrée réelle et son WebP dans `maps/tokens/`, pour que le chantier soit
   démontrable et testable de bout en bout.
2. **`js/import/tokenCatalog.js`** — pur : valide un catalogue déjà lu et projette une
   `TokenLibraryEntry` vers les champs de `Token` (§2.2). Aucun `fetch`, aucun DOM, aucun
   import hors `core/*`. C'est ici que vit la logique testable.
3. **`js/ui/gm/tokenLibrary.js`** — `createTokenLibrary(mount, { transport, catalogUrl })`,
   sur le motif de `createSceneLibrary`. Fait le `fetch`, délègue la validation à
   `tokenCatalog.js`, liste les entrées, et **instancie** un pion pré-réglé sur l'étage
   actif via `store.addToken` puis `transport.publish({type: 'token.add'})`.
4. **Un catalogue absent ou corrompu laisse la bibliothèque indisponible et visible en
   erreur**, sans casser le panneau MJ — exactement comme la bibliothèque de scènes
   (couvert par un test existant côté scènes).
5. **Instanciation sans étage actif : refusée bruyamment**, jamais silencieusement.
6. **`tokenMaker`** — action « copier l'entrée JSON » produisant une entrée conforme au
   typedef.
7. **Câblage dans `js/ui/gm/panel.js`**, comme les autres sous-composants du panneau.

---

## 5. Interdictions

- Ne pas ajouter de champ à `TokenLibraryEntry` ni à `Token`, ni au document de campagne.
- Ne pas créer de type d'événement : `token.add` existe, il suffit.
- **Ne pas renommer `token.add` en `token.create`** malgré le CdC §7 : c'est un écart
  préexistant, le corriger ici casserait la compatibilité sans que ce soit demandé.
- Ne pas créer de fichier dans `js/` hors des **deux** déjà inscrits au manifeste.
- **Ne rien mettre de non pur dans `js/import/tokenCatalog.js`** : ni `fetch`, ni DOM, ni
  import hors `core/*`. C'est ce qui le rend testable en `node:test` et réutilisable depuis
  Node ; l'y violer annule la raison de son existence.
- Ne pas écrire la bibliothèque en LocalStorage.
- Ne pas contourner `store.addToken` pour insérer un pion.
- Ne pas toucher aux cartes existantes de `maps/` ni aux fixtures.
- Ne pas commiter : le mainteneur relit puis commite.

---

## 6. Tests

- **Unitaire** — validation du catalogue de pions : entrée valide acceptée ; `imageUrl` en
  `data:`/`blob:` refusée ; doublon d'`id` refusé ; `version` manquante refusée.
- **Unitaire** — projection `TokenLibraryEntry` → `Token` : les 9 champs sont reportés et
  `name` alimente bien `label`.
- **Navigateur** — une entrée de la bibliothèque instancie sur l'étage actif un pion
  **pré-réglé** : `sizeCells`, `speedCells`, vision et `borderColor` correspondent à
  l'entrée, sans aucune saisie.
- **Navigateur** — le pion instancié apparaît chez un second client via `token.add`.
- **Navigateur** — catalogue corrompu : bibliothèque indisponible, erreur visible, panneau
  MJ toujours fonctionnel.
- **Navigateur** — instanciation sans étage actif : refus visible, store inchangé.
- **Navigateur** — T-23 reste vert : `player.html` n'expose toujours aucun
  `button`/`nav`/`input`.

---

## 7. Acceptation

1. `pnpm run verify` en code 0.
2. Le critère du CdC §11 ligne 815 est tenu tel qu'il est écrit : « Un PNJ récurrent est
   recadré une seule fois et réinstancié pré-réglé. »
3. `maps/catalog.json` et les cartes existantes sont inchangés, octet pour octet.
4. La suite unitaire reste sous 3 s — la validation étant pure, elle n'a aucune raison de
   coûter des secondes.
5. `ARCHITECTURE.md` §1 n'est **pas modifié par l'exécution** : les deux fichiers y sont
   déjà inscrits, l'amendement a été fait en amont avec sa justification.
6. Le test d'architecture n°6 (règles d'importation, vérifiées fichier par fichier) passe
   sans qu'aucune règle du §2 ait été touchée.

---

## 8. Ce qui sera contrôlé à la relecture

Indépendamment de ce que le rapport d'exécution affirmera :

- **Test de mutation** : en retirant la validation d'URL du catalogue, le test de refus
  `data:`/`blob:` doit échouer. En ignorant un champ dans la projection vers `Token`, le
  test de pré-réglage doit échouer.
- Que le test d'instanciation vérifie les **valeurs** des métadonnées, et ne se contente
  pas de constater qu'un pion existe.
- Que l'image du pion de démonstration **existe réellement** et se décode
  (`naturalWidth > 0`) : c'est le défaut trouvé au chantier H, où les tests visaient un
  fichier absent et passaient malgré une image cassée.
- Que `js/import/tokenCatalog.js` est **réellement pur** : aucun `fetch`, aucune référence à
  `document` ou `window`, aucun import hors `core/*`. Contrôle décisif : ses tests tournent
  en `node:test`, sans navigateur. S'ils exigent Playwright, le module a échoué à sa raison
  d'être et l'amendement du manifeste n'aura servi à rien.
- Que `token.add` n'a pas été renommé et qu'aucun événement n'a été inventé.
- Qu'aucun champ n'a été ajouté à `Token` ni à `TokenLibraryEntry`.
- Qu'aucun critère ci-dessus n'a été réécrit pour coller au résultat obtenu.

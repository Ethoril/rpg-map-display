# CHANTIER L — outil local de préparation des cartes

> Écrit le 31 juillet 2026. Demande du mainteneur : « un petit client local, uniquement sur
> cette machine, qui avec une interface légère me permettrait de préparer les cartes à
> l'avance pour le commit. »
>
> Ce chantier **amende le manifeste** (`ARCHITECTURE.md` §1) : trois fichiers nouveaux. Un
> amendement se fait délibérément, avec sa justification écrite — c'est l'objet de ce
> document.

---

## 1. Ce qui motive l'outil

`pnpm maps:prepare` est aveugle et lent, et la séance du 30/07 l'a montré trois fois :

- il retraite **toutes** les cartes à chaque appel — 2 minutes pour deux cartes, alors
  qu'aucune n'avait changé ;
- le choix de qualité et de plafond ne se compare qu'en relançant la chaîne entière, puis en
  ouvrant les fichiers produits à la main ;
- rien ne montre le résultat avant le commit.

## 2. La règle qui prime sur tout le reste

> **L'outil ne réimplémente rien.** Il appelle `prepareMap()` de `scripts/prepare-maps.mjs`.

Le plafond `MAX_PREPARED_TEXTURE_PX`, le garde-fou anti-agrandissement et la qualité WebP
n'existent qu'à **un seul endroit**. Si le navigateur rééchantillonnait lui-même, ces trois
gardes existeraient en double et divergeraient au premier réglage — c'est le motif déjà payé
deux fois ici (l'image de pion à déposer à la main, la règle « pas de `data:` » écrite pour un
fond et appliquée aux pions).

Corollaire : le navigateur ne décode aucune image source. Il affiche des artefacts déjà
produits par Node, et rien d'autre.

## 3. Décisions arrêtées

### 3.1 Un serveur dédié, pas `serve.mjs`

`serve.mjs` porte un contrat explicite dans son en-tête : « ce serveur ne fait rien d'autre
que servir des fichiers du dépôt ». Un point d'entrée qui **écrit** sur le disque le
romprait, et ce serveur est celui qu'utilisent les tests Playwright — lui ajouter une surface
d'écriture, c'est l'ajouter aux tests. `scripts/prepare-server.mjs` est donc distinct, et
`serve.mjs` reste inchangé.

Le serveur écoute sur `127.0.0.1` **uniquement**, comme `serve.mjs`. Il écrit dans le dépôt :
il n'a rien à faire sur une interface réseau.

### 3.2 La publication du catalogue reste transactionnelle

L'outil prépare **un artefact à la fois**, mais ne publie jamais `catalog.json` lui-même :
« Publier » relance la passe complète `prepareMaps()`. Autrement, une carte en échec
laisserait un catalogue amputé de son entrée — exactement ce que U-02 interdit, et pour la
raison qui a coûté un lot entier : mieux vaut un catalogue daté qu'un catalogue incomplet.

La passe complète est désormais rapide, parce qu'elle saute ce qui n'a pas changé (§3.4).

### 3.3 On compare avec des réglages, on publie avec les constantes

Le comparateur produit des variantes dans `maps/.preview/`, un dossier jetable et ignoré par
git. **La publication, elle, utilise toujours les constantes du dépôt.**

C'est délibéré, et c'est la décision la plus importante du chantier. Si l'outil pouvait
publier en q80 « juste pour cette carte », un `pnpm maps:prepare` ultérieur la régénérerait en
q90 sans rien dire, et la carte changerait sous les pieds du mainteneur. Le réglage retenu
après comparaison se fixe donc **dans la constante**, où il vaut pour tout le dépôt et se
relit dans le diff.

L'outil sert à décider ; le dépôt porte la décision.

### 3.4 Le saut incrémental ne peut pas reposer sur `sourceHash` seul

Une carte est à jour si **la recette** qui l'a produite est identique, pas seulement sa
source. Changer le plafond ou la qualité ne change pas un octet du `.dd2vtt` : un cache
indexé sur `sourceHash` sauterait la carte en laissant croire qu'elle est à jour, et la
divergence n'apparaîtrait qu'à l'œil, des semaines plus tard.

Pire : la recette doit inclure **le code du pipeline**. Ce n'est pas une précaution
théorique — le 30/07, remplacer un `floor` par un `round` borné a déplacé une dimension de
sortie de 4679 à 4680 px, à constantes rigoureusement identiques. Un cache aveugle au code
aurait affirmé « rien à faire ». L'empreinte est donc le hachage de `resample.mjs` (qui
détermine l'image) et de `prepare-maps.mjs` (qui détermine le document de scène) : bumper une
version à la main serait une consigne, pas un mécanisme.

La clé est donc `{ sourceHash, targetPxPerCell, maxTexturePx, quality, pipelineHash }`,
enregistrée dans `maps/generated/.recipes.json`.

Ce sidecar est **ignoré par git**. C'est un cache : le perdre coûte une passe complète, jamais
une carte. Le commiter n'épargnerait qu'une minute sur un clone neuf, en échange de conflits
de fusion possibles et de métadonnées de fabrication publiées sur le web.

Ce fichier est **un sidecar, pas une entrée de catalogue** : `catalog.json` est publié sur le
web, et des métadonnées de fabrication n'y ont pas leur place. Le point initial du nom le fait
ignorer par `findOrphanArtifacts`, qui filtre déjà les fichiers cachés.

### 3.5 La page est publiée, et le dit

Le workflow déploie le dépôt entier (`path: '.'`), donc `prepare.html` partira sur GitHub
Pages. `diag.html` crée le précédent — une page « hors application » déjà publiée — mais
celle-ci sera **inerte** en production, faute de serveur local.

Il n'y a pas de moyen propre de l'exclure sans introduire une étape de build, que la pile
interdit. La page détecte donc l'absence d'API et affiche une consigne explicite au lieu
d'échouer en silence.

### 3.6 Import map imposée

`check-deps.mjs` exige que **toute** page de la racine chargeant un module porte l'import map
de `gm.html`, à l'identique. `prepare.html` n'a besoin d'aucune de ces quatre entrées, mais la
porte le veut ainsi, et la raison est bonne : les versions n'ont qu'un seul domicile.

---

## 4. Amendement du manifeste

Trois fichiers, aucun dans le chemin de l'application :

| Fichier | Rôle |
|---|---|
| `prepare.html` | page de l'outil, `<style>` inline comme `diag.html` — pas de CSS nouveau |
| `js/app/prepare.js` | point d'entrée de la page ; ne parle qu'à l'API locale |
| `scripts/prepare-server.mjs` | serveur local : sert la page et expose l'API de préparation |

Fichiers existants modifiés : `scripts/resample.mjs` (accepte plafond et qualité en
paramètres, défauts inchangés), `scripts/prepare-maps.mjs` (passe-plat + saut incrémental),
`package.json` (script `maps:tool`), `.gitignore` (`maps/.preview/`).

## 5. Critères d'acceptation

1. `pnpm maps:tool` ouvre la page ; sans le serveur, la page affiche la consigne au lieu de
   planter.
2. Préparer une carte seule n'en retraite aucune autre.
3. Une seconde passe complète sans changement ne réencode rien, et le dit.
4. Changer la qualité ou le plafond **invalide** le cache, vérifié par test.
5. Le comparateur écrit dans `maps/.preview/` et n'y touche jamais à `maps/generated/`.
6. « Publier » relance la passe transactionnelle avec les constantes du dépôt.
7. `pnpm run verify` vert, `pnpm run check-deps` vert.

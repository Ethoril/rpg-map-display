# Restrictions Firebase à appliquer dans la console

Ce document est une procédure de configuration externe. Les fichiers `firebase.json`,
`firestore.rules` et `database.rules.json` sont versionnés et testés localement, mais leur
**déploiement effectif**, les restrictions de clé, les domaines et les quotas ne peuvent pas être
constatés depuis ce dépôt.

## 1. Déployer les règles versionnées

Dans le projet Firebase `rpg-map-display`, déployer uniquement les règles pointées par
`firebase.json` : Firestore depuis `firestore.rules` et Realtime Database depuis
`database.rules.json`. Vérifier dans chaque onglet **Rules** de la console que la version publiée
contient les deux comptes explicitement autorisés et aucun `allow ... if true` / `".read": "true"`.

Les règles couvrent aujourd'hui uniquement `campaigns/{sessionId}` dans Firestore et
`session/{sessionId}` dans RTDB. Ne pas ajouter de règle générique pour « faire marcher » un futur
schéma v3 : sa couverture de sous-collections doit être livrée avec ce schéma.

`pnpm run test:firebase-rules` démarre les deux émulateurs dans un projet local `demo-*`, charge
les règles versionnées et exerce les refus anonymes, les comptes non autorisés, les chemins hors
périmètre et les deux comptes admis. Cette cible est bloquante dans la CI. Le fichier de test seul
reste ignoré lorsque les deux variables d'émulateur sont absentes, plutôt que de présenter un test
statique comme une preuve d'autorisation réelle.

## 2. Firebase Authentication : domaines autorisés

Firebase Console → **Authentication** → **Settings** → **Authorized domains**. Ajouter les noms
d'hôte, sans protocole ni chemin :

- `rpg-map-display.firebaseapp.com` (domaine OAuth Firebase du projet) ;
- `<proprietaire-github>.github.io` (le propriétaire réel de GitHub Pages) ;
- le domaine personnalisé éventuel, sans chemin.

N'ajouter `localhost` que pour le développement ; il ne doit pas rester autorisé pour un projet de
production. Les motifs de chemin ne sont pas acceptés ici : l'autorisation porte sur un domaine,
donc `owner.github.io` couvre les pages de ce propriétaire, pas seulement ce dépôt. Vérifier aussi
que Google et E-mail/Mot de passe restent les seuls fournisseurs activés par l'application.

## 3. Clé Web : origine et APIs autorisées

Google Cloud Console → **APIs & Services** → **Credentials** → clé `Browser key` associée au
`apiKey` de `firebase-config.js`.

Dans **Application restrictions**, sélectionner *Websites* et conserver seulement :

- `https://<proprietaire-github>.github.io/rpg-map-display/*` ;
- `https://rpg-map-display.firebaseapp.com/*` ;
- le motif du domaine personnalisé, s'il existe ;
- temporairement et sur une clé de développement distincte : `http://localhost:*/*` et
  `http://127.0.0.1:*/*`.

Dans **API restrictions**, sélectionner *Restrict key* et conserver les APIs Firebase liées au
runtime actuel :

- Firebase Management API (`firebase.googleapis.com`) ;
- Cloud Logging API (`logging.googleapis.com`) ;
- Identity Toolkit API (`identitytoolkit.googleapis.com`) ;
- Token Service API (`securetoken.googleapis.com`) ;
- Cloud Datastore API (`datastore.googleapis.com`) ;
- Google Cloud Firestore API (`firestore.googleapis.com`).

La documentation Firebase marque Firebase Rules API (`firebaserules.googleapis.com`) et
Realtime Database API (`firebasedatabase.googleapis.com`) comme requises sur la clé seulement en
cas d'accès REST direct ou d'outil tiers. Le runtime actuel passe par le SDK Web ; ne les ajouter
que si le test depuis l'URL Pages réelle produit un `API_KEY_SERVICE_BLOCKED`, ou si un tel outil
est effectivement introduit. Partir de la liste restreinte créée automatiquement par Firebase et
retirer seulement une API après un test complet Auth + Firestore + RTDB.

Ne pas autoriser une API non Firebase sur cette clé publique ; créer une clé séparée et restreinte
pour tout nouveau service. Les clés Firebase identifient le projet et ses quotas, elles ne
remplacent ni les règles ni l'authentification. La liste officielle des APIs Firebase requises et
le rôle des règles est décrite dans la [documentation Firebase](https://firebase.google.com/docs/projects/api-keys).

## 4. Quotas et preuve de la configuration

Dans Google Cloud Console → **APIs & Services** → **Enabled APIs & services**, consulter les quotas
de `identitytoolkit.googleapis.com`; fixer des plafonds adaptés à une table et une alerte avant
épuisement plutôt que de compter sur la clé comme barrière d'accès. Tester ensuite une connexion
Google depuis l'URL GitHub Pages réelle et une sauvegarde Firestore/RTDB avec le compte autorisé.

À consigner hors dépôt : URL Pages exacte, identifiant de la clé contrôlée, date de déploiement des
règles, captures de la liste d'origines/API et résultat du test de connexion. Ces éléments restent
externes et ne sont pas vérifiables localement.

## 5. État réel et arbitrage — 8 août 2026

Cette procédure décrit ce qu'il est *possible* de faire. Voici ce qui a été *décidé*.

| § | Objet | État |
|---|---|---|
| 1 | Déploiement des règles | **Fait** — Firestore et RTDB publiés depuis le dépôt, `.firebaserc` versionné |
| 2 | Domaines autorisés | **Fait** — `localhost` retiré |
| 3 | APIs de la clé Web | **Fait** — de 25 à 6 |
| 3 | Origines de la clé Web | ⛔ **Écarté sciemment** |
| 4 | Plafonds de quota | ⛔ **Écarté sciemment** |

### Les six APIs conservées, et d'où vient la liste

`Cloud Datastore` · `Cloud Firestore` · `Cloud Logging` · `Firebase Management` ·
`Identity Toolkit` · `Token Service`.

Elle se déduit des imports réels et non d'une recommandation générique : `gm.html`, `player.html` et
`diag.html` ne déclarent que `firebase/app`, `firebase/auth`, `firebase/database` et
`firebase/firestore` dans leurs import maps, et `firebase-config.js` ne porte aucun `measurementId`,
donc aucune Analytics. Les dix-neuf autres relevaient de produits jamais chargés (Storage, Messaging,
App Check, Remote Config, ML, Installations…), du chemin de publication Firebase Hosting que le
projet n'emploie pas, ou d'APIs de management que le SDK Web n'appelle pas.

⚠ **Ne rajouter une API que sur un blocage constaté**, jamais par précaution : le signal est
`API_KEY_SERVICE_BLOCKED` dans la console du navigateur, et les deux candidates connues sont
*Realtime Database Management* et *Firebase Rules*.

### Pourquoi l'origine est écartée, et ce qui la rouvrirait

⭐ **La restriction d'origine ne garde pas les données.** La clé Web identifie le projet, elle
n'autorise rien ; l'accès est gouverné par les règles, déployées le même jour. Ce qu'elle empêche
est qu'un tiers brûle le quota d'authentification depuis son propre site — un déni de service, pas
une fuite.

⚠ **Et elle casserait les séances.** Le paquet publié ne contient aucune carte, faute de droits
documentés. Une séance réelle se sert donc en local par `pnpm run serve`, et la tablette rejoint le
poste par `http://192.168.x.x:port` — une origine qui ne correspond à aucun motif HTTPS. La
restreindre aujourd'hui refuserait la connexion Google à la table.

Les plafonds de quota, eux, ne valent rien sans compte de facturation : le palier gratuit est déjà
un plafond dur.

**La décision se réexamine si** un compte de facturation est activé, ou si des cartes licenciées
entrent dans le paquet public et font de GitHub Pages la voie de diffusion réelle des séances. Tant
que la table joue depuis un serveur local, la restriction d'origine coûte plus qu'elle ne protège.

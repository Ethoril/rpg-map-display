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

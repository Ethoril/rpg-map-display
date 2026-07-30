// Configuration Firebase Web — publique par nature.
//
// Ce fichier n'est PAS un module : il est chargé par une balise `<script>` classique, donc
// exécuté avant les modules d'application, qui sont différés. C'est la seule façon que
// `window.RPG_FIREBASE_CONFIG` existe au moment où `resolveFirebaseConfig` le cherche
// (js/app/runtimeConfig.js).
//
// Pourquoi commité : la configuration Web de Firebase est destinée au navigateur de chaque
// visiteur, elle n'est pas un secret — la protection vient des règles de sécurité du projet,
// jamais de la confidentialité de ces cinq champs. Auparavant, il fallait la coller dans
// `diag.html` sur chaque appareil ET chaque origine, `localStorage` étant cloisonné par les
// deux. Le mode dégradé était pire que la contrainte : « Mode local » n'empêche pas
// d'utiliser l'application, elle fonctionne simplement sans synchronisation — un défaut qu'on
// ne remarque qu'à table.
//
// Les identifiants du compte technique de test n'ont RIEN à faire ici : ils vivent dans le
// secret GitHub `RPG_FIREBASE_CONFIG`, lu par la CI comme variable d'environnement.
//
// ── Alerte « secret détecté » de GitHub : attendue, et à ne pas confondre avec une fuite ──
//
// `apiKey` commence par `AIzaSy`, motif des clés d'API Google : la détection automatique se
// déclenche donc à chaque fois. Ce n'est pas un mot de passe. Une clé Firebase Web **identifie**
// le projet auprès des services, elle n'**autorise** rien par elle-même : l'accès aux données
// est gouverné par les règles de sécurité Firebase, et l'authentification par les fournisseurs
// activés et les domaines autorisés.
//
// Ce que l'alerte ne dit pas, et qui compte : **la protection repose entièrement sur les règles
// de sécurité du projet**. Elles sont consignées dans docs/ETAT.md, avec les chemins réellement
// utilisés et les deux pièges du mode test — lequel autorise lecture et écriture sans
// authentification, et expire au bout de 30 jours.
//
// Sans compte de facturation, aucun coût n'est possible : les quotas du plan gratuit sont des
// plafonds durs. Restreindre la clé par référents HTTP (Cloud Console → Identifiants) reste
// utile contre l'épuisement de quota, mais c'est un confort, pas une urgence.
(function () {
  // Navigateur piloté : ne rien configurer.
  //
  // Une grande partie de la suite e2e n'injecte pas de transport et s'exécute
  // délibérément en mode local. Si une configuration était présente, `connectSession`
  // construirait un `FirebaseTransport`, ne trouverait aucun utilisateur, et **attendrait
  // une connexion Google** (js/app/session.js:196-201) : la suite se bloquerait.
  // `navigator.webdriver` est le signal standard de l'automatisation.
  if (navigator.webdriver) return;

  // Ne jamais écraser une configuration déjà posée par l'hôte ou par un test.
  if (window.RPG_FIREBASE_CONFIG) return;

  window.RPG_FIREBASE_CONFIG = {
    apiKey: 'AIzaSyBvkSVruo3m7BlHPPSb2tTNqqGA7ceUwBA',
    authDomain: 'rpg-map-display.firebaseapp.com',
    databaseURL: 'https://rpg-map-display-default-rtdb.europe-west1.firebasedatabase.app',
    projectId: 'rpg-map-display',
    appId: '1:440721267905:web:d8758633167ea779f08840',
  };
})();

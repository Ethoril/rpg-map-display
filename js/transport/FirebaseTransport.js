// @ts-check
import { initializeApp, getApp, getApps } from 'firebase/app';
import {
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signInWithEmailAndPassword,
  GoogleAuthProvider,
  signOut,
} from 'firebase/auth';
import {
  getDatabase,
  ref,
  push,
  query,
  orderByKey,
  startAfter,
  limitToLast,
  get,
  onChildAdded,
  off,
  remove,
} from 'firebase/database';
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';

/** @typedef {import('../core/types.js').NetEvent} NetEvent */
/** @typedef {import('./Transport.js').Transport} Transport */

/** Champs sans lesquels rien ne peut fonctionner. `databaseURL` n'apparaît dans la console
 * Firebase qu'une fois la Realtime Database créée : son absence est l'oubli le plus fréquent. */
const CHAMPS_REQUIS = ['apiKey', 'authDomain', 'databaseURL', 'projectId', 'appId'];

/**
 * Transport réseau : Realtime Database pour les événements, Firestore pour le document de
 * campagne durable. **Seul fichier du projet autorisé à importer `firebase/*`.**
 *
 * L'authentification n'appartient pas à l'interface `Transport` : elle est propre à ce
 * transport-ci (un transport LAN n'a pas de compte Google). C'est `app/*` qui décide *quand*
 * demander une identité, en appelant `signInWithGoogle()` ou `signInWithPassword()` **avant**
 * `connect()`. Ce fichier fournit le geste, jamais la politique.
 *
 * @implements {Transport}
 */
export class FirebaseTransport {
  /**
   * @param {Record<string, any>} config Configuration SDK Firebase, injectée par `app/*`.
   *   Jamais lue depuis un fichier du dépôt : le dépôt est public.
   */
  constructor(config) {
    if (!config || typeof config !== 'object') {
      throw new Error('Configuration Firebase absente');
    }
    for (const champ of CHAMPS_REQUIS) {
      if (!config[champ]) {
        throw new Error(`Configuration Firebase incomplète : champ ${champ} manquant`);
      }
    }

    this._config = config;
    /** @type {import('firebase/app').FirebaseApp|null} */
    this._app = null;
    /** @type {import('firebase/auth').Auth|null} */
    this._auth = null;
    /** @type {import('firebase/database').Database|null} */
    this._db = null;
    /** @type {import('firebase/firestore').Firestore|null} */
    this._firestore = null;

    /** @type {string|null} */
    this._sessionId = null;
    /** @type {'gm'|'players'|null} */
    this._role = null;

    /** @type {import('firebase/database').Query|null} Requête bornée effectivement écoutée */
    this._liveQuery = null;
    /** @type {Set<(e: NetEvent) => void>} */
    this._subscribers = new Set();
    /** @type {Set<(err: unknown) => void>} */
    this._errorHandlers = new Set();

    /** @type {NetEvent[]} Événements reçus avant que `snapshot()` ne soit remis */
    this._eventBuffer = [];
    this._snapshotReady = false;
  }

  // --- Authentification -----------------------------------------------------

  /**
   * Initialise l'application Firebase et l'objet `Auth`, sans se connecter à une session.
   * Idempotent.
   *
   * @returns {import('firebase/auth').Auth}
   */
  _ensureAuth() {
    if (!this._app) {
      if (getApps().length === 0) {
        this._app = initializeApp(this._config);
      } else {
        // Une seule application Firebase par page : la session persistée est indexée par nom
        // d'application, un second nom perdrait la connexion déjà établie. Deux configs
        // différentes dans la même page sont en revanche une erreur de câblage.
        const existante = getApp();
        const attendu = this._config.projectId;
        if (existante.options.projectId !== attendu) {
          throw new Error(
            `Une application Firebase du projet "${existante.options.projectId}" existe déjà ` +
              `dans cette page : impossible d'en ouvrir une seconde sur "${attendu}".`
          );
        }
        this._app = existante;
      }
    }
    if (!this._auth) {
      this._auth = getAuth(this._app);
    }
    return this._auth;
  }

  /**
   * Attend la résolution de l'état d'authentification.
   *
   * Indispensable : après un rechargement de page, le SDK restaure la session persistée de
   * façon asynchrone. Lire `auth.currentUser` immédiatement retournerait `null` alors que
   * l'utilisateur est bel et bien connecté, et déclencherait une demande de connexion à
   * chaque F5.
   *
   * @returns {Promise<import('firebase/auth').User|null>}
   */
  async currentUser() {
    const auth = this._ensureAuth();
    return new Promise((resolve) => {
      const desabonner = onAuthStateChanged(auth, (user) => {
        desabonner();
        resolve(user);
      });
    });
  }

  /**
   * Connexion Google interactive (fenêtre). Réservée aux humains.
   *
   * `signInWithPopup` et non `signInWithRedirect` : le flux par redirection s'appuie sur un
   * domaine auxiliaire distinct de celui de GitHub Pages et casse de façon fuyante avec les
   * restrictions de cookies tiers de Chrome et de Safari.
   *
   * @returns {Promise<import('firebase/auth').User>}
   */
  async signInWithGoogle() {
    const auth = this._ensureAuth();
    const credential = await signInWithPopup(auth, new GoogleAuthProvider());
    return credential.user;
  }

  /**
   * Connexion par e-mail et mot de passe, sans interaction. Sert au compte technique des
   * tests automatisés : la connexion Google n'est pas scriptable, Google la refuse depuis un
   * navigateur piloté.
   *
   * @param {string} email
   * @param {string} password
   * @returns {Promise<import('firebase/auth').User>}
   */
  async signInWithPassword(email, password) {
    const auth = this._ensureAuth();
    const credential = await signInWithEmailAndPassword(auth, email, password);
    return credential.user;
  }

  /** @returns {Promise<void>} */
  async signOut() {
    await signOut(this._ensureAuth());
  }

  // --- Signalement d'erreur -------------------------------------------------

  /**
   * S'abonne aux échecs asynchrones du transport (écriture refusée, réseau perdu).
   *
   * En l'absence de tout abonné, une erreur est **relancée hors pile** pour devenir une
   * erreur non capturée visible : un transport qui échoue en silence donne un écran qui ne
   * suit pas, sans le moindre indice (`CONVENTIONS.md` §6).
   *
   * @param {(err: unknown) => void} handler
   * @returns {() => void} désabonnement
   */
  onError(handler) {
    this._errorHandlers.add(handler);
    return () => {
      this._errorHandlers.delete(handler);
    };
  }

  /**
   * @private
   * @param {unknown} err
   * @param {string} contexte
   */
  _reportError(err, contexte) {
    const detail =
      /** @type {any} */ (err)?.code || /** @type {any} */ (err)?.message || String(err);
    const message = `FirebaseTransport : échec ${contexte} — ${detail}`;
    console.error(message, err);

    if (this._errorHandlers.size === 0) {
      setTimeout(() => {
        throw err instanceof Error ? err : new Error(message);
      }, 0);
      return;
    }
    for (const handler of this._errorHandlers) {
      try {
        handler(err);
      } catch (interne) {
        console.error('Erreur dans un handler onError :', interne);
      }
    }
  }

  // --- Interface Transport --------------------------------------------------

  /**
   * Rejoint une session. Exige une identité déjà établie.
   *
   * @param {string} sessionId
   * @param {'gm'|'players'} role
   * @returns {Promise<void>}
   */
  async connect(sessionId, role) {
    if (!sessionId || typeof sessionId !== 'string') {
      throw new Error('Paramètre sessionId manquant ou invalide');
    }
    if (role !== 'gm' && role !== 'players') {
      throw new Error('Paramètre role invalide (attendu : "gm" ou "players")');
    }

    this._ensureAuth();
    const user = await this.currentUser();
    if (!user) {
      throw new Error(
        'Transport non authentifié : appeler signInWithGoogle() ou signInWithPassword() ' +
          'avant connect(). Aucun accès anonyme n\'est autorisé par les règles de sécurité.'
      );
    }

    this._sessionId = sessionId;
    this._role = role;
    this._db = getDatabase(/** @type {import('firebase/app').FirebaseApp} */ (this._app));
    this._firestore = getFirestore(
      /** @type {import('firebase/app').FirebaseApp} */ (this._app)
    );

    this._snapshotReady = false;
    this._eventBuffer = [];

    const eventsRef = ref(this._db, `session/${sessionId}/events`);

    // Ne recevoir QUE les événements postérieurs à la connexion. `onChildAdded` rejoue sinon
    // tous les enfants déjà présents : à la reconnexion, un client se verrait resservir
    // l'historique entier de la séance. On relève donc la dernière clé existante et on
    // n'écoute qu'au-delà. Les clés `push` sont chronologiquement ordonnées, ce qui rend ce
    // repère fiable sans dépendre d'une horloge cliente.
    /** @type {string|null} */
    let derniereCle = null;
    try {
      const queue = await get(query(eventsRef, orderByKey(), limitToLast(1)));
      queue.forEach((enfant) => {
        derniereCle = enfant.key ?? null;
        return true; // interrompt l'itération
      });
    } catch (err) {
      // Un canal illisible est un problème de règles ou de réseau : il ne se devine pas.
      throw new Error(
        `Impossible de lire le canal d'événements de la session "${sessionId}" : ` +
          `${/** @type {any} */ (err)?.code || err}`
      );
    }

    // Canal vide : la référence nue suffit, elle ne rejouera rien puisqu'il n'y a rien.
    // Canal non vide : on borne strictement après la dernière clé connue. Pas de sentinelle
    // `startAfter('')` — RTDB exige une clé valide et ne livre alors plus aucun enfant.
    const requeteVivante =
      derniereCle === null ? eventsRef : query(eventsRef, orderByKey(), startAfter(derniereCle));
    this._liveQuery = requeteVivante;

    onChildAdded(requeteVivante, (snapshot) => {
      const netEvent = /** @type {NetEvent|null} */ (snapshot.val());
      if (!netEvent) return;
      if (this._snapshotReady) {
        this._notifySubscribers(netEvent);
      } else {
        this._eventBuffer.push(netEvent);
      }
    });
  }

  /**
   * Publie un événement sur le canal temps réel.
   *
   * Volontairement sans valeur de retour (l'interface l'impose) : l'appelant n'attend pas la
   * confirmation réseau, l'animation est déterministe côté client. Mais l'échec, lui, n'est
   * jamais avalé — il passe par `_reportError`.
   *
   * @param {NetEvent} event
   * @returns {void}
   */
  publish(event) {
    if (!event || typeof event !== 'object' || !event.type) {
      throw new Error('Événement invalide pour publication');
    }
    if (!this._db || !this._sessionId) {
      throw new Error('Transport non connecté');
    }

    const complet = {
      type: event.type,
      payload: event.payload || {},
      at: typeof event.at === 'number' ? event.at : Date.now(),
      by: event.by || this._role,
    };

    const eventsRef = ref(this._db, `session/${this._sessionId}/events`);
    Promise.resolve(push(eventsRef, complet)).catch((err) =>
      this._reportError(err, `publication de "${complet.type}"`)
    );
  }

  /**
   * @param {(e: NetEvent) => void} handler
   * @returns {() => void} désabonnement
   */
  subscribe(handler) {
    if (typeof handler !== 'function') {
      throw new Error('Le handler de souscription doit être une fonction');
    }
    this._subscribers.add(handler);
    return () => {
      this._subscribers.delete(handler);
    };
  }

  /**
   * État complet de la campagne, **toujours remis avant le premier delta**. Les événements
   * arrivés entre `connect()` et la résolution de cette promesse ont été tamponnés : ils sont
   * remis ici, dans l'ordre, juste après l'état.
   *
   * @returns {Promise<object>}
   */
  async snapshot() {
    if (!this._firestore || !this._sessionId) {
      throw new Error('Transport non connecté');
    }

    const docRef = doc(this._firestore, 'campaigns', this._sessionId);
    const docSnap = await getDoc(docRef);
    const etat = docSnap.exists() ? docSnap.data() : {};

    this._snapshotReady = true;
    const tamponnes = this._eventBuffer;
    this._eventBuffer = [];
    for (const event of tamponnes) {
      this._notifySubscribers(event);
    }

    return etat;
  }

  /**
   * Persiste le document de campagne dans Firestore. Hors interface `Transport` au sens
   * strict, mais nécessaire à T-24 : cf. la note d'`ARCHITECTURE.md` §3.
   *
   * @param {object} campaignData
   * @returns {Promise<void>}
   */
  async saveSnapshot(campaignData) {
    if (!this._firestore || !this._sessionId) {
      throw new Error('Transport non connecté');
    }
    await setDoc(doc(this._firestore, 'campaigns', this._sessionId), campaignData);
  }

  /**
   * Vide le canal d'événements de la session. Le canal est en ajout pur : il grossit tant
   * qu'on ne le purge pas. Geste de fin de séance, et nettoyage des tests.
   *
   * @returns {Promise<void>}
   */
  async purgeEvents() {
    if (!this._db || !this._sessionId) {
      throw new Error('Transport non connecté');
    }
    await remove(ref(this._db, `session/${this._sessionId}/events`));
  }

  /** @returns {void} */
  disconnect() {
    if (this._liveQuery) {
      off(this._liveQuery);
      this._liveQuery = null;
    }
    this._subscribers.clear();
    this._eventBuffer = [];
    this._snapshotReady = false;
    this._sessionId = null;
    this._role = null;
  }

  /**
   * @private
   * @param {NetEvent} event
   */
  _notifySubscribers(event) {
    for (const handler of this._subscribers) {
      try {
        handler(event);
      } catch (err) {
        console.error('Erreur dans un handler de souscription :', err);
      }
    }
  }
}

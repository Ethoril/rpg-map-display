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
  set,
  query,
  orderByKey,
  startAfter,
  limitToLast,
  get,
  onChildAdded,
  onValue,
  off,
  remove,
  onDisconnect,
} from 'firebase/database';
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';

/** @typedef {import('../core/types.js').NetEvent} NetEvent */
/** @typedef {import('./Transport.js').Transport} Transport */

/** Champs sans lesquels rien ne peut fonctionner. `databaseURL` n'apparaît dans la console
 * Firebase qu'une fois la Realtime Database créée : son absence est l'oubli le plus fréquent. */
const CHAMPS_REQUIS = ['apiKey', 'authDomain', 'databaseURL', 'projectId', 'appId'];
const TRANSIENT_ASSET_URL = /^(?:data|blob):/i;
const PRESENCE_HEARTBEAT_MS = 30_000;

/**
 * Refuse récursivement les URL qui ne peuvent survivre ni à un rechargement ni à un
 * autre navigateur.
 *
 * @param {unknown} value
 * @param {string} [context]
 */
export function assertNoTransientAssetUrls(value, context = 'payload') {
  /** @type {WeakSet<object>} */
  const visited = new WeakSet();

  /**
   * @param {unknown} current
   * @param {string} path
   */
  function visit(current, path) {
    if (typeof current === 'string') {
      if (TRANSIENT_ASSET_URL.test(current)) {
        const scheme = current.slice(0, current.indexOf(':') + 1);
        throw new Error(
          `${context} contient une URL transitoire interdite (${scheme}) au chemin ${path}`
        );
      }
      return;
    }
    if (!current || typeof current !== 'object') return;
    if (visited.has(current)) return;
    visited.add(current);

    if (Array.isArray(current)) {
      current.forEach((entry, index) => visit(entry, `${path}[${index}]`));
      return;
    }
    for (const [key, entry] of Object.entries(current)) {
      visit(entry, `${path}[${JSON.stringify(key)}]`);
    }
  }

  visit(value, '$');
}

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
    /** @type {string|null} */
    this._clientId = null;

    /** @type {import('firebase/database').Query|null} Requête bornée effectivement écoutée */
    this._liveQuery = null;
    /** @type {(() => void)|null} */
    this._liveUnsubscribe = null;
    /** @type {Set<(e: NetEvent) => void>} */
    this._subscribers = new Set();
    /** @type {Set<(err: unknown) => void>} */
    this._errorHandlers = new Set();

    /** @type {NetEvent[]} Événements reçus avant que `snapshot()` ne soit remis */
    this._eventBuffer = [];
    /** @type {'inactive'|'buffering'|'draining'|'live'} */
    this._deliveryState = 'inactive';
    /** @type {Promise<object>|null} */
    this._snapshotPromise = null;
    this._sessionEpoch = 0;

    /** @type {Set<() => void>} */
    this._presenceUnsubscribers = new Set();
    /** @type {import('firebase/database').DatabaseReference|null} */
    this._presenceRef = null;
    /** @type {import('firebase/database').OnDisconnect|null} */
    this._presenceOnDisconnect = null;
    /** @type {ReturnType<typeof setInterval>|null} */
    this._presenceHeartbeat = null;
    /** @type {{ role: 'gm'|'players', build: number, label: string }|null} */
    this._presencePayload = null;
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
    if (typeof handler !== 'function') {
      throw new Error('Le handler d’erreur doit être une fonction');
    }
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
    const reported =
      err instanceof Error
        ? Object.assign(new Error(message, { cause: err }), {
            code: /** @type {any} */ (err).code,
          })
        : new Error(message);
    console.error(message, err);

    if (this._errorHandlers.size === 0) {
      setTimeout(() => {
        throw reported;
      }, 0);
      return;
    }
    for (const handler of this._errorHandlers) {
      try {
        handler(reported);
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

    this._stopSessionListeners();
    this._sessionEpoch += 1;
    const epoch = this._sessionEpoch;
    this._sessionId = sessionId;
    this._role = role;
    this._clientId = `c_${crypto.randomUUID()}`;
    this._db = getDatabase(/** @type {import('firebase/app').FirebaseApp} */ (this._app));
    this._firestore = getFirestore(
      /** @type {import('firebase/app').FirebaseApp} */ (this._app)
    );

    this._deliveryState = 'buffering';
    this._snapshotPromise = null;
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

    this._liveUnsubscribe = onChildAdded(
      requeteVivante,
      (snapshot) => {
        if (epoch !== this._sessionEpoch) return;
        const netEvent = /** @type {NetEvent|null} */ (snapshot.val());
        if (!netEvent || typeof netEvent.type !== 'string') return;
        if (this._deliveryState === 'live') {
          this._notifySubscribers(netEvent);
        } else {
          this._eventBuffer.push(netEvent);
        }
      },
      (err) => {
        if (epoch === this._sessionEpoch) {
          this._reportError(err, `écoute des événements de la session "${sessionId}"`);
        }
      }
    );
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
    assertNoTransientAssetUrls(event, `événement "${event.type}"`);

    const complet = {
      type: event.type,
      payload: event.payload || {},
      at: typeof event.at === 'number' ? event.at : Date.now(),
      by: event.by || this._role,
      eventId: `${this._clientId}:${Date.now()}:${crypto.randomUUID()}`,
      clientId: this._clientId,
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
  snapshot() {
    if (!this._sessionId) {
      return Promise.reject(new Error('Transport non connecté'));
    }
    if (this._snapshotPromise) return this._snapshotPromise;

    const sessionId = this._sessionId;
    const epoch = this._sessionEpoch;
    this._snapshotPromise = (async () => {
      let etat = {};
      if (this._firestore) {
        try {
          const docRef = doc(this._firestore, 'campaigns', sessionId);
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            etat = docSnap.data();
          }
        } catch (err) {
          this._reportError(err, `lecture du snapshot "${sessionId}"`);
        }
      }

      // Repli LocalStorage si Firestore n'a rien renvoyé ou est indisponible.
      if (!etat || Object.keys(etat).length === 0) {
        try {
          if (typeof localStorage !== 'undefined') {
            const localCamp = localStorage.getItem(`rpg_campaign_${sessionId}`);
            const localSess = localStorage.getItem(`rpg_session_${sessionId}`);
            if (localCamp) {
              const campObj = JSON.parse(localCamp);
              const sessObj = localSess ? JSON.parse(localSess) : {};
              etat = {
                campaign: campObj,
                activeLevelId: sessObj.activeLevelId,
                selectedTokenId: sessObj.selectedTokenId,
              };
            }
          }
        } catch (err) {
          this._reportError(err, `lecture du repli local "${sessionId}"`);
        }
      }

      if (epoch !== this._sessionEpoch) {
        throw new Error('La session a changé pendant la lecture du snapshot');
      }

      // La continuation de `await snapshot()` applique l'état complet avant que ce timer
      // ne vide les deltas reçus pendant sa lecture.
      setTimeout(() => this._activateBufferedEvents(epoch), 0);
      return etat;
    })();
    return this._snapshotPromise;
  }

  /**
   * Persiste le document de campagne dans Firestore et LocalStorage (repli).
   *
   * @param {object} campaignData
   * @returns {Promise<void>}
   */
  async saveSnapshot(campaignData) {
    if (!this._sessionId) {
      throw new Error('Transport non connecté');
    }
    if (!campaignData || typeof campaignData !== 'object') {
      throw new Error('Snapshot invalide pour sauvegarde');
    }
    assertNoTransientAssetUrls(campaignData, 'snapshot');

    // Les URL HTTP(S) persistantes sont conservées dans le repli local.
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(`rpg_campaign_${this._sessionId}`, JSON.stringify(campaignData));
      } catch (err) {
        this._reportError(err, `écriture du repli local "${this._sessionId}"`);
      }
    }

    // Firestore sauvegarde le complet (avec imageUrl)
    if (this._firestore) {
      try {
        await setDoc(doc(this._firestore, 'campaigns', this._sessionId), campaignData);
      } catch (err) {
        this._reportError(err, `sauvegarde du snapshot "${this._sessionId}"`);
        throw err;
      }
    }
  }

  /**
   * Publie la présence du client local dans la session.
   *
   * @param {{ role?: 'gm'|'players', build: number, label: string }} presenceData
   * @returns {Promise<void>}
   */
  async publishPresence(presenceData) {
    if (!this._db || !this._sessionId) {
      throw new Error('Transport non connecté');
    }
    if (
      !presenceData ||
      !Number.isSafeInteger(presenceData.build) ||
      typeof presenceData.label !== 'string'
    ) {
      throw new Error('Présence invalide (build entier et label requis)');
    }
    const presenceRef = ref(this._db, `session/${this._sessionId}/presence/${this._clientId}`);
    const payload = /** @type {{ role: 'gm'|'players', build: number, label: string }} */ ({
      role: presenceData.role || this._role || 'players',
      build: presenceData.build,
      label: presenceData.label,
    });
    if (payload.role !== 'gm' && payload.role !== 'players') {
      throw new Error('Présence invalide (role attendu : "gm" ou "players")');
    }

    if (this._presenceHeartbeat) clearInterval(this._presenceHeartbeat);

    const disconnectRegistration = onDisconnect(presenceRef);
    try {
      // Enregistrer la suppression avant l'écriture ferme la fenêtre où un client pourrait
      // disparaître en laissant une présence fantôme.
      await disconnectRegistration.remove();
      await set(presenceRef, { ...payload, at: Date.now() });
    } catch (err) {
      this._reportError(err, 'publication de la présence');
      throw err;
    }
    this._presenceRef = presenceRef;
    this._presenceOnDisconnect = disconnectRegistration;
    this._presencePayload = payload;
    this._presenceHeartbeat = setInterval(() => {
      if (!this._presenceRef || !this._presencePayload) return;
      set(this._presenceRef, { ...this._presencePayload, at: Date.now() }).catch((err) =>
        this._reportError(err, 'rafraîchissement de la présence')
      );
    }, PRESENCE_HEARTBEAT_MS);
  }

  /**
   * S'abonne aux enregistrements de présence de la session.
   *
   * @param {(presences: Record<string, any>) => void} handler
   * @returns {() => void} Désabonnement
   */
  subscribePresence(handler) {
    if (!this._db || !this._sessionId) {
      throw new Error('Transport non connecté');
    }
    if (typeof handler !== 'function') {
      throw new Error('Le handler de présence doit être une fonction');
    }
    const presenceRef = ref(this._db, `session/${this._sessionId}/presence`);
    const unsubscribe = onValue(
      presenceRef,
      (snap) => {
        const val = snap.val() || {};
        handler(val);
      },
      (err) => this._reportError(err, 'écoute de la présence')
    );
    this._presenceUnsubscribers.add(unsubscribe);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this._presenceUnsubscribers.delete(unsubscribe);
      unsubscribe();
    };
  }

  /**
   * Identifiant unique du client connecté courant.
   * @returns {string|null}
   */
  getClientId() {
    return this._clientId;
  }

  /**
   * Permet à l'application d'ignorer l'écho réseau d'une mutation déjà appliquée localement.
   * Les anciens événements sans `clientId` restent compatibles et retournent `false`.
   *
   * @param {NetEvent & { clientId?: string }} event
   * @returns {boolean}
   */
  isOwnEvent(event) {
    return Boolean(this._clientId && event?.clientId === this._clientId);
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
    try {
      await remove(ref(this._db, `session/${this._sessionId}/events`));
    } catch (err) {
      this._reportError(err, `purge des événements "${this._sessionId}"`);
      throw err;
    }
  }

  /** @returns {void} */
  disconnect() {
    this._sessionEpoch += 1;
    this._stopSessionListeners();
    this._subscribers.clear();
    this._eventBuffer = [];
    this._deliveryState = 'inactive';
    this._snapshotPromise = null;
    this._sessionId = null;
    this._role = null;
    this._clientId = null;
  }

  /**
   * Coupe les écouteurs et retire au mieux la présence de la session quittée.
   * @private
   */
  _stopSessionListeners() {
    if (this._liveUnsubscribe) {
      this._liveUnsubscribe();
      this._liveUnsubscribe = null;
    } else if (this._liveQuery) {
      off(this._liveQuery);
    }
    this._liveQuery = null;

    for (const unsubscribe of this._presenceUnsubscribers) unsubscribe();
    this._presenceUnsubscribers.clear();
    if (this._presenceHeartbeat) {
      clearInterval(this._presenceHeartbeat);
      this._presenceHeartbeat = null;
    }
    if (this._presenceRef) {
      const presenceRef = this._presenceRef;
      const disconnectRegistration = this._presenceOnDisconnect;
      // La suppression distante passe avant l'annulation de onDisconnect : si le réseau
      // tombe entre les deux, le serveur conserve ainsi l'ordre de secours.
      remove(presenceRef)
        .then(() => disconnectRegistration?.cancel())
        .catch((err) => this._reportError(err, 'retrait de la présence à la déconnexion'));
      this._presenceRef = null;
    }
    this._presenceOnDisconnect = null;
    this._presencePayload = null;
  }

  /**
   * @private
   * @param {number} epoch
   */
  _activateBufferedEvents(epoch) {
    if (epoch !== this._sessionEpoch || this._deliveryState !== 'buffering') return;
    this._deliveryState = 'draining';
    while (this._eventBuffer.length > 0) {
      const event = /** @type {NetEvent} */ (this._eventBuffer.shift());
      this._notifySubscribers(event);
    }
    this._deliveryState = 'live';
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

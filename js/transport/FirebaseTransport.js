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
  runTransaction,
  update,
  onDisconnect,
  serverTimestamp,
} from 'firebase/database';
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';
import { isBoundedImageDataUrl, TOKEN_IMAGE_MAX_BYTES } from '../core/schema.js';

/** @typedef {import('../core/types.js').NetEvent} NetEvent */
/** @typedef {import('./Transport.js').Transport} Transport */

/** Champs sans lesquels rien ne peut fonctionner. `databaseURL` n'apparaît dans la console
 * Firebase qu'une fois la Realtime Database créée : son absence est l'oubli le plus fréquent. */
const CHAMPS_REQUIS = ['apiKey', 'authDomain', 'databaseURL', 'projectId', 'appId'];
const TRANSIENT_ASSET_URL = /^(?:data|blob):/i;
const PRESENCE_HEARTBEAT_MS = 30_000;

/** Limite imposée par Firestore pour un document, en octets. */
export const FIRESTORE_DOCUMENT_LIMIT_BYTES = 1024 * 1024;

/**
 * Plafond applicatif volontairement inférieur à la limite Firestore. La marge absorbe les
 * champs ajoutés par une évolution du schéma et toute différence de comptage du SDK.
 */
export const FIRESTORE_SNAPSHOT_MAX_BYTES = 900 * 1024;

/** À partir de ce seuil, le MJ est prévenu avant que la sauvegarde devienne impossible. */
export const FIRESTORE_SNAPSHOT_WARNING_BYTES = 750 * 1024;

/**
 * Taille UTF-8 exacte du JSON qui sera remis au SDK, après les adaptations Firestore.
 *
 * Ce n'est pas une longueur JavaScript : les accents et les caractères non BMP comptent leurs
 * octets réels. Le calcul est conservé avec l'estimation de stockage afin que les mesures de
 * campagne soient reproductibles hors ligne.
 *
 * @param {unknown} value
 * @returns {number}
 */
export function encodedJsonByteLength(value) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

/**
 * Évalue la taille Firestore documentée d'une valeur du modèle actuel. Les types rencontrés par
 * un snapshot sont JSON : null, booléen, nombre, chaîne, tableau et objet. On majore les objets
 * de 32 octets, comme les maps Firestore, et chaque nom de champ par sa taille UTF-8 + 1.
 *
 * Ce calcul ne prétend pas reproduire le protocole interne du SDK. La garde utilise le maximum
 * de cette valeur et du JSON encodé, puis applique 10 % + 2 Kio de marge.
 *
 * @param {unknown} value
 * @returns {number}
 */
function estimateFirestoreValueBytes(value) {
  if (value === null || value === undefined) return 1;
  if (typeof value === 'boolean') return 1;
  if (typeof value === 'number') return 8;
  if (typeof value === 'string') return new TextEncoder().encode(value).byteLength + 1;
  if (value instanceof Uint8Array) return value.byteLength + 1;
  if (value instanceof Date) return 8;
  if (Array.isArray(value)) {
    return value.reduce((total, entry) => total + estimateFirestoreValueBytes(entry), 1);
  }
  if (typeof value === 'object') {
    return (
      32 +
      Object.entries(/** @type {Record<string, unknown>} */ (value)).reduce(
        (total, [name, entry]) =>
          total + new TextEncoder().encode(name).byteLength + 1 + estimateFirestoreValueBytes(entry),
        0
      )
    );
  }
  throw new Error(`Type non persistable dans le snapshot Firestore : ${typeof value}`);
}

/**
 * Taille documentée du document `campaigns/{sessionId}` : nom du document, champs et 32 octets.
 *
 * @param {object} document
 * @param {string} sessionId
 */
function estimateFirestoreDocumentBytes(document, sessionId) {
  /** @param {string} text */
  const stringBytes = (text) => new TextEncoder().encode(text).byteLength + 1;
  const documentNameBytes = stringBytes('campaigns') + stringBytes(sessionId) + 16;
  const fieldsBytes = Object.entries(document).reduce(
    (total, [name, value]) => total + stringBytes(name) + estimateFirestoreValueBytes(value),
    0
  );
  return documentNameBytes + fieldsBytes + 32;
}

/** @param {number} bytes */
function formatKib(bytes) {
  return `${(bytes / 1024).toFixed(1)} Kio`;
}

/**
 * Mesure le document exactement tel qu'il sera donné à `setDoc`, puis fournit une estimation
 * prudente de sa taille persistée. À appeler sur le snapshot source : les murs sont encodés ici.
 *
 * @param {object} snapshot
 * @param {string} [sessionId] identifiant réel du document, pour compter son nom.
 * @returns {{documentFirestore: object, encodedJsonBytes: number, firestoreEstimatedBytes: number, conservativeBytes: number, severity: 'ok'|'warning'|'error', message: string}}
 */
export function measureFirestoreSnapshot(snapshot, sessionId = 'measure') {
  const documentFirestore = encodeSnapshotForFirestore(snapshot);
  assertNoNestedArrays(documentFirestore, 'snapshot');
  const encodedJsonBytes = encodedJsonByteLength(documentFirestore);
  const firestoreEstimatedBytes = estimateFirestoreDocumentBytes(documentFirestore, sessionId);
  const conservativeBytes = Math.ceil(Math.max(encodedJsonBytes, firestoreEstimatedBytes) * 1.1) + 2048;
  const severity =
    conservativeBytes > FIRESTORE_SNAPSHOT_MAX_BYTES
      ? 'error'
      : conservativeBytes >= FIRESTORE_SNAPSHOT_WARNING_BYTES
        ? 'warning'
        : 'ok';
  const message =
    severity === 'error'
      ? `Snapshot Firestore refusé avant écriture : ${formatKib(conservativeBytes)} estimés ` +
        `(JSON encodé ${formatKib(encodedJsonBytes)}), plafond applicatif ${formatKib(FIRESTORE_SNAPSHOT_MAX_BYTES)}. ` +
        'Réduis les images embarquées/fog ou migre la campagne vers le schéma v3 multi-étages.'
      : severity === 'warning'
        ? `Snapshot Firestore proche du plafond : ${formatKib(conservativeBytes)} estimés ` +
          `(JSON encodé ${formatKib(encodedJsonBytes)}) sur ${formatKib(FIRESTORE_SNAPSHOT_MAX_BYTES)}. ` +
          'Prépare une migration v3 avant d’ajouter un étage ou des images embarquées.'
        : `Snapshot Firestore : ${formatKib(conservativeBytes)} estimés ` +
          `(JSON encodé ${formatKib(encodedJsonBytes)}).`;
  return {
    documentFirestore,
    encodedJsonBytes,
    firestoreEstimatedBytes,
    conservativeBytes,
    severity,
    message,
  };
}
// La r\u00e9tention ne repose pas sur ces d\u00e9lais pour d\u00e9cider qu'un \u00e9v\u00e9nement est
// supprimable : les curseurs des clients sont cette preuve. Ils bornent seulement le
// travail d'entretien d'un navigateur bavard.
export const EVENT_RETENTION_BATCH_SIZE = 32;
export const EVENT_RETENTION_PUBLISH_INTERVAL = 32;
export const EVENT_RETENTION_MIN_INTERVAL_MS = 30_000;
export const EVENT_RETENTION_CLIENT_STALE_AFTER_MS = 120_000;
export const SESSION_INSPECTION_MAX = 20;

/**
 * Retourne le dernier curseur dont tous les clients encore actifs ont accus\u00e9 r\u00e9ception.
 * Une trace malform\u00e9e, sans curseur, ou dont l'horodatage serveur n'est pas exploitable
 * bloque le nettoyage : une incertitude ne doit jamais devenir une suppression.
 *
 * `serverNow` est obtenu via `.info/serverTimeOffset`, donc n'est pas une comparaison
 * entre deux horloges clientes.
 *
 * @param {Record<string, any>|null|undefined} clients
 * @param {number|null} serverNow
 * @param {Record<string, any>|null|undefined} [presences]
 * @returns {{ frontier: string|null, activeClientIds: string[], blocked: boolean }}
 */
export function getAcknowledgedEventFrontier(clients, serverNow, presences = {}) {
  if (typeof serverNow !== 'number' || !Number.isFinite(serverNow)) {
    return { frontier: null, activeClientIds: [], blocked: true };
  }
  /** @type {string[]} */
  const cursors = [];
  /** @type {string[]} */
  const activeClientIds = [];
  for (const [clientId, raw] of Object.entries(clients || {})) {
    if (!raw || typeof raw !== 'object' || typeof raw.at !== 'number') {
      return { frontier: null, activeClientIds, blocked: true };
    }
    const age = serverNow - raw.at;
    // Une date dans le futur est conservatrice : elle ne rend jamais le client p\u00e9rim\u00e9.
    if (age <= EVENT_RETENTION_CLIENT_STALE_AFTER_MS) {
      activeClientIds.push(clientId);
      // Une connexion annonce d'abord `joining`, avant même de lire le dernier événement.
      // Cette barrière ferme la course « lecture du repère → branchement de l'écoute ».
      if (raw.state === 'joining') {
        return { frontier: null, activeClientIds, blocked: true };
      }
      if (typeof raw.eventCursor !== 'string' || raw.eventCursor.length === 0) {
        return { frontier: null, activeClientIds, blocked: true };
      }
      cursors.push(raw.eventCursor);
    }
  }
  // Les versions ant\u00e9rieures publient d\u00e9j\u00e0 `presence` mais ignorent le protocole de
  // curseur. Tant qu'une de ces pr\u00e9sences est active, son absence de trace est une raison de
  // ne rien supprimer, jamais une permission de supposer qu'elle a tout re\u00e7u.
  for (const [clientId, raw] of Object.entries(presences || {})) {
    if (!raw || typeof raw !== 'object' || typeof raw.at !== 'number') {
      return { frontier: null, activeClientIds, blocked: true };
    }
    if (serverNow - raw.at <= EVENT_RETENTION_CLIENT_STALE_AFTER_MS) {
      const lease = clients?.[clientId];
      if (
        !lease ||
        typeof lease !== 'object' ||
        lease.state === 'joining' ||
        typeof lease.eventCursor !== 'string' ||
        lease.eventCursor.length === 0 ||
        typeof lease.at !== 'number' ||
        serverNow - lease.at > EVENT_RETENTION_CLIENT_STALE_AFTER_MS
      ) {
        return { frontier: null, activeClientIds, blocked: true };
      }
    }
  }
  if (cursors.length === 0) return { frontier: null, activeClientIds, blocked: false };
  cursors.sort();
  return { frontier: cursors[0], activeClientIds, blocked: false };
}

/**
 * Valide une liste explicitement fournie : le client Web ne tente jamais de lire le parent
 * global `/session`, qui demanderait une r\u00e8gle d'administration distincte.
 *
 * @param {unknown} sessionIds
 * @returns {string[]}
 */
export function normalizeExplicitSessionIds(sessionIds) {
  if (!Array.isArray(sessionIds) || sessionIds.length === 0) {
    throw new Error('Fournir au moins un identifiant de session explicite');
  }
  if (sessionIds.length > SESSION_INSPECTION_MAX) {
    throw new Error(`Inspection limit\u00e9e \u00e0 ${SESSION_INSPECTION_MAX} sessions explicites`);
  }
  const ids = sessionIds.map((id) => {
    if (typeof id !== 'string' || id.trim() === '') {
      throw new Error('Identifiant de session invalide');
    }
    return id;
  });
  if (new Set(ids).size !== ids.length) {
    throw new Error('Les identifiants de session doivent \u00eatre distincts');
  }
  return ids;
}

/**
 * Refuse récursivement les URL qui ne peuvent survivre ni à un rechargement ni à un
 * autre navigateur, et les images embarquées non bornées.
 *
 * Cette garde teste la propriété qui compte, pas le schéma d'URL. Un `blob:` est lié
 * au document qui l'a créé : il ne survit à rien, il est refusé sans condition. Un
 * `data:` porte ses octets avec lui, donc il survit — son danger est sa **taille**,
 * puisque `saveSnapshot` écrit toute la campagne dans un unique document Firestore de
 * 1 MiB. Une image embarquée bornée passe donc, une image non bornée est refusée.
 *
 * Le champ auquel une image embarquée est permise n'est **pas** décidé ici : c'est
 * `validateCampaign` qui le sait, et le store valide la campagne avant chaque mutation
 * et chaque sauvegarde. Un fond d'étage en `data:` est refusé là, avant d'atteindre le
 * réseau.
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
      if (TRANSIENT_ASSET_URL.test(current) && !isBoundedImageDataUrl(current)) {
        const scheme = current.slice(0, current.indexOf(':') + 1);
        let motif;
        if (!/^data:/i.test(current)) {
          motif = `URL transitoire interdite (${scheme})`;
        } else if (current.length > TOKEN_IMAGE_MAX_BYTES) {
          motif =
            `image embarquée non bornée (${current.length} octets pour un plafond de ` +
            `${TOKEN_IMAGE_MAX_BYTES})`;
        } else {
          motif =
            'image embarquée non bornée : seuls png, jpeg, webp et gif en base64 sont acceptés';
        }
        throw new Error(`${context} contient une ${motif} au chemin ${path}`);
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
 * Refuse récursivement un tableau directement contenu dans un tableau : Firestore ne sait
 * pas les stocker (« Nested arrays are not supported »).
 *
 * Le SDK, lui, ne nomme que le document fautif — pas le champ. Sur un document de campagne
 * qui compte des étages, des pions et des gabarits, cela laisse chercher l'aiguille dans
 * tout le modèle. Cette garde nomme le chemin, et se déclenche avant l'appel réseau.
 *
 * @param {unknown} value
 * @param {string} [context]
 */
export function assertNoNestedArrays(value, context = 'document') {
  /** @type {WeakSet<object>} */
  const visited = new WeakSet();

  /**
   * @param {unknown} current
   * @param {string} path
   * @param {boolean} insideArray vrai si `current` est un élément direct d'un tableau
   */
  function visit(current, path, insideArray) {
    if (!current || typeof current !== 'object') return;
    if (Array.isArray(current) && insideArray) {
      throw new Error(
        `${context} contient un tableau imbriqué au chemin ${path} : Firestore le refuse. ` +
          'Enrober chaque élément dans un objet avant la persistance.'
      );
    }
    if (visited.has(current)) return;
    visited.add(current);

    if (Array.isArray(current)) {
      current.forEach((entry, index) => visit(entry, `${path}[${index}]`, true));
      return;
    }
    for (const [key, entry] of Object.entries(current)) {
      visit(entry, `${path}[${JSON.stringify(key)}]`, false);
    }
  }

  visit(value, '$', false);
}

/**
 * Transpose les polylignes de murs entre la forme du modèle et la forme Firestore.
 *
 * `Level.walls` est un `CellPoint[][]` — un mur *est* une polyligne, et une carte en compte
 * des dizaines : la forme est juste, et le modèle la garde. Mais c'est exactement le
 * tableau de tableaux que Firestore rejette. Les deux exigences se concilient par un
 * enrobage, `{ points: CellPoint[] }`, appliqué **au seul franchissement de la frontière
 * Firestore** — même discipline que `terrainCost`, persisté en `Record` et manipulé en
 * `Map` (CONVENTIONS §1).
 *
 * Le modèle en mémoire, le repli LocalStorage (JSON accepte l'imbrication) et les
 * événements temps réel conservent donc la forme native.
 *
 * @param {unknown} walls
 * @returns {unknown}
 */
function encodeWalls(walls) {
  if (!Array.isArray(walls)) return walls;
  return walls.map((polyline) => (Array.isArray(polyline) ? { points: polyline } : polyline));
}

/**
 * Inverse de `encodeWalls`. Tolère la forme native : un document écrit avant l'enrobage,
 * comme le repli LocalStorage, reste lisible sans migration.
 *
 * @param {unknown} walls
 * @returns {unknown}
 */
function decodeWalls(walls) {
  if (!Array.isArray(walls)) return walls;
  return walls.map((polyline) => {
    if (Array.isArray(polyline)) return polyline;
    const points = /** @type {any} */ (polyline)?.points;
    return Array.isArray(points) ? points : polyline;
  });
}

/**
 * Applique une conversion de murs à tous les étages, sur une copie.
 *
 * Muter l'entrée corromprait le store : `createSnapshotPayload()` remet les objets vivants
 * de l'état, pas des copies. Les deux formes d'instantané acceptées par
 * `store.restoreFromSnapshot` sont reconnues : document de campagne nu, ou enveloppe
 * `{ campaign, activeLevelId, … }`.
 *
 * @param {any} data
 * @param {(walls: unknown) => unknown} convert
 * @returns {any} copie convertie
 */
function mapLevelWalls(data, convert) {
  if (!data || typeof data !== 'object') return data;

  /**
   * @param {any} campaign
   * @returns {any}
   */
  function convertCampaign(campaign) {
    if (!campaign || !Array.isArray(campaign.levels)) return campaign;
    return {
      ...campaign,
      levels: campaign.levels.map((/** @type {any} */ level) =>
        level && typeof level === 'object' && 'walls' in level
          ? { ...level, walls: convert(level.walls) }
          : level
      ),
    };
  }

  if (Array.isArray(data.levels)) return convertCampaign(data);
  if (data.campaign && Array.isArray(data.campaign.levels)) {
    return { ...data, campaign: convertCampaign(data.campaign) };
  }
  return data;
}

/**
 * Instantané prêt pour Firestore : murs enrobés, reste inchangé.
 *
 * @param {any} snapshot
 * @returns {any}
 */
export function encodeSnapshotForFirestore(snapshot) {
  return mapLevelWalls(snapshot, encodeWalls);
}

/**
 * Instantané relu depuis Firestore, ramené à la forme du modèle.
 *
 * @param {any} data
 * @returns {any}
 */
export function decodeSnapshotFromFirestore(data) {
  return mapLevelWalls(data, decodeWalls);
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
    /** @type {number} Décalage horloge serveur − horloge locale, en millisecondes */
    this._serverTimeOffset = 0;
    /** @type {boolean} */
    this._serverTimeOffsetTracked = false;
    /** @type {boolean} La premi\u00e8re valeur du serveur est arriv\u00e9e. */
    this._serverTimeOffsetReady = false;
    /** @type {(() => void)|null} */
    this._presenceVisibilityCleanup = null;

    // Cette trace est distincte de la pr\u00e9sence d'interface : tout consommateur du flux,
    // y compris un outil qui ne publie pas son num\u00e9ro de build, participe \u00e0 la barri\u00e8re de
    // r\u00e9tention. Elle est supprim\u00e9e par onDisconnect et rafra\u00eechie au temps serveur.
    /** @type {import('firebase/database').DatabaseReference|null} */
    this._retentionClientRef = null;
    /** @type {import('firebase/database').OnDisconnect|null} */
    this._retentionClientOnDisconnect = null;
    /** @type {ReturnType<typeof setInterval>|null} */
    this._retentionHeartbeat = null;
    /** @type {string|null} */
    this._eventCursor = null;
    /** @type {number} */
    this._eventsSinceRetentionAttempt = 0;
    /** @type {number} */
    this._lastRetentionAttemptAt = 0;
    /** @type {Promise<number>|null} */
    this._retentionPromise = null;
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
    this._eventCursor = null;
    this._eventsSinceRetentionAttempt = 0;
    this._lastRetentionAttemptAt = 0;

    const eventsRef = ref(this._db, `session/${sessionId}/events`);

    // La barrière `joining` doit exister AVANT la lecture du repère. Sans elle, un autre
    // client pourrait publier puis purger entre le `get()` ci-dessous et l'inscription de ce
    // client, qui manquerait alors un delta sans aucun moyen de le savoir.
    await this._startRetentionClient(epoch);

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
      await this._releaseRetentionClient().catch(() => {});
      // Un canal illisible est un problème de règles ou de réseau : il ne se devine pas.
      throw new Error(
        `Impossible de lire le canal d'événements de la session "${sessionId}" : ` +
          `${/** @type {any} */ (err)?.code || err}`
      );
    }

    if (epoch !== this._sessionEpoch) {
      throw new Error('La session a changé pendant la connexion');
    }

    // Le curseur reste protégé par l'état distant `joining` jusqu'à ce que l'écoute soit
    // effectivement branchée. Les callbacks peuvent déjà le faire avancer sans lever cette
    // barrière ; seule `_activateRetentionClient()` publie l'état `active`.
    this._eventCursor = derniereCle;

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
        const eventKey = snapshot.key;
        const netEvent = /** @type {NetEvent|null} */ (snapshot.val());
        // M\u00eame une ancienne entr\u00e9e invalide ne doit pas bloquer toute la file. Le client
        // l'a observ\u00e9e et n'en a donc pas besoin. Les entr\u00e9es valides sont d'abord
        // tamponn\u00e9es ou livr\u00e9es, puis seulement accus\u00e9es au r\u00e9seau.
        if (!netEvent || typeof netEvent.type !== 'string') {
          if (eventKey) this._acknowledgeEvent(eventKey, epoch);
          return;
        }
        if (this._deliveryState === 'live') {
          this._notifySubscribers(netEvent);
        } else {
          this._eventBuffer.push(netEvent);
        }
        if (eventKey) this._acknowledgeEvent(eventKey, epoch);
      },
      (err) => {
        if (epoch === this._sessionEpoch) {
          this._reportError(err, `écoute des événements de la session "${sessionId}"`);
        }
      }
    );
    await this._activateRetentionClient(epoch);
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
  /**
   * Inscrit une barrière `joining` avant même de lire le canal. Un curseur éventuellement écrit
   * pendant cet état ne permet jamais une purge ; l'activation est une étape séparée.
   *
   * @private
   * @param {number} epoch
   * @returns {Promise<void>}
   */
  async _startRetentionClient(epoch) {
    if (!this._db || !this._sessionId || !this._clientId || epoch !== this._sessionEpoch) return;
    this._trackServerTimeOffset();
    const clientRef = ref(
      this._db,
      `session/${this._sessionId}/retentionClients/${this._clientId}`
    );
    const disconnectRegistration = onDisconnect(clientRef);
    this._retentionClientRef = clientRef;
    this._retentionClientOnDisconnect = disconnectRegistration;
    try {
      await disconnectRegistration.remove();
      await set(clientRef, { state: 'joining', at: serverTimestamp() });
    } catch (err) {
      this._retentionClientRef = null;
      this._retentionClientOnDisconnect = null;
      await disconnectRegistration.cancel().catch(() => {});
      this._reportError(err, `inscription de r\u00e9tention \"${this._sessionId}\"`);
      throw err;
    }
    if (epoch !== this._sessionEpoch) await this._releaseRetentionClient();
  }

  /**
   * L'appel intervient après `onChildAdded()`. Les opérations RTDB partent sur la même connexion
   * dans cet ordre : le serveur ne peut donc observer `active` avant l'enregistrement de l'écoute.
   *
   * @private
   * @param {number} epoch
   * @returns {Promise<void>}
   */
  async _activateRetentionClient(epoch) {
    if (!this._retentionClientRef || epoch !== this._sessionEpoch) {
      throw new Error('Barrière de rétention perdue pendant la connexion');
    }
    try {
      await update(this._retentionClientRef, {
        state: 'active',
        eventCursor: this._eventCursor,
        at: serverTimestamp(),
      });
    } catch (err) {
      this._reportError(err, `activation de la rétention "${this._sessionId}"`);
      throw err;
    }
    this._retentionHeartbeat = setInterval(
      () => this._writeRetentionCursor(epoch),
      PRESENCE_HEARTBEAT_MS
    );
  }

  /**
   * @private
   * @param {number} epoch
   */
  _writeRetentionCursor(epoch) {
    if (!this._retentionClientRef || epoch !== this._sessionEpoch) return;
    update(this._retentionClientRef, {
      eventCursor: this._eventCursor,
      at: serverTimestamp(),
    }).catch((err) => this._reportError(err, 'rafra\u00eechissement du curseur de r\u00e9tention'));
  }

  /**
   * L'accus\u00e9 est \u00e9crit apr\u00e8s la mise en tampon locale : supprimer ce n\u0153ud ne peut donc
   * plus priver ce client du delta, m\u00eame tant que `snapshot()` n'est pas r\u00e9solu.
   *
   * @private
   * @param {string} eventKey
   * @param {number} epoch
   */
  _acknowledgeEvent(eventKey, epoch) {
    if (this._eventCursor && eventKey <= this._eventCursor) return;
    this._eventCursor = eventKey;
    this._writeRetentionCursor(epoch);
  }

  /**
   * D\u00e9clenche au plus une petite suppression par session, et jamais depuis une horloge
   * d'\u00e9v\u00e9nement cliente. Les erreurs sont visibles via le canal normal du transport.
   *
   * @private
   */
  _scheduleAutomaticRetention() {
    this._eventsSinceRetentionAttempt += 1;
    const now = Date.now(); // uniquement un throttle local, jamais un crit\u00e8re de suppression
    if (
      this._eventsSinceRetentionAttempt < EVENT_RETENTION_PUBLISH_INTERVAL ||
      now - this._lastRetentionAttemptAt < EVENT_RETENTION_MIN_INTERVAL_MS ||
      this._retentionPromise
    ) {
      return;
    }
    this._eventsSinceRetentionAttempt = 0;
    this._lastRetentionAttemptAt = now;
    const epoch = this._sessionEpoch;
    this._retentionPromise = this._pruneAcknowledgedEvents(epoch)
      .catch((err) => {
        this._reportError(err, 'r\u00e9tention automatique des \u00e9v\u00e9nements');
        return 0;
      })
      .finally(() => {
        this._retentionPromise = null;
      });
  }

  /**
   * @private
   * @param {number} epoch
   * @returns {Promise<number>}
   */
  async _pruneAcknowledgedEvents(epoch) {
    if (!this._db || !this._sessionId || epoch !== this._sessionEpoch || !this._serverTimeOffsetReady) {
      return 0;
    }
    const sessionId = this._sessionId;
    const serverNow = Date.now() + this._serverTimeOffset;
    let deletedCount = 0;
    const result = await runTransaction(
      ref(this._db, `session/${sessionId}`),
      (/** @type {any} */ current) => {
        deletedCount = 0;
        if (!current || typeof current !== 'object') return;
        const status = getAcknowledgedEventFrontier(
          current.retentionClients,
          serverNow,
          current.presence
        );
        if (status.blocked || !status.frontier || !current.events) return;

        const keys = Object.keys(current.events)
          .filter((key) => key <= /** @type {string} */ (status.frontier))
          .sort()
          .slice(0, EVENT_RETENTION_BATCH_SIZE);
        if (keys.length === 0) return;
        const events = { ...current.events };
        for (const key of keys) delete events[key];
        deletedCount = keys.length;
        return { ...current, events: Object.keys(events).length > 0 ? events : null };
      },
      { applyLocally: false }
    );
    return result.committed ? deletedCount : 0;
  }

  publish(/** @type {NetEvent} */ event) {
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
    Promise.resolve(push(eventsRef, complet))
      .then(() => this._scheduleAutomaticRetention())
      .catch((err) => this._reportError(err, `publication de "${complet.type}"`));
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
            etat = decodeSnapshotFromFirestore(docSnap.data());
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

    // Mesuré et vérifié avant la première écriture, y compris quand Firestore est absent :
    // un instantané que Firestore refuserait doit être refusé de la même façon en ligne et
    // hors ligne, sinon le défaut n'apparaît qu'en séance.
    const measurement = measureFirestoreSnapshot(campaignData, this._sessionId);
    if (measurement.severity === 'error') {
      throw new Error(measurement.message);
    }
    const documentFirestore = measurement.documentFirestore;

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
        await setDoc(doc(this._firestore, 'campaigns', this._sessionId), documentFirestore);
      } catch (err) {
        this._reportError(err, `sauvegarde du snapshot "${this._sessionId}"`);
        throw err;
      }
    }
  }

  /**
   * Diagnostic sans écriture, destiné à l'interface avant une sauvegarde planifiée.
   *
   * @param {object} campaignData
   */
  getSnapshotSizeDiagnostic(campaignData) {
    assertNoTransientAssetUrls(campaignData, 'snapshot');
    return measureFirestoreSnapshot(campaignData, this._sessionId || 'measure');
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
    this._presenceVisibilityCleanup?.();
    this._trackServerTimeOffset();

    const disconnectRegistration = onDisconnect(presenceRef);
    try {
      // Enregistrer la suppression avant l'écriture ferme la fenêtre où un client pourrait
      // disparaître en laissant une présence fantôme.
      await disconnectRegistration.remove();
      // `at` est daté par le SERVEUR, jamais par l'horloge locale.
      //
      // Auparavant : `at: Date.now()`. La péremption se calcule chez le lecteur par
      // `Date.now() - at > 90 s` — donc en comparant deux horloges différentes. Une tablette
      // en avance de quelques minutes produisait un `at` dans le futur, un âge négatif, et
      // une présence qui **ne périmait jamais** : un écran éteint depuis des jours
      // continuait d'annoncer sa build et de déclencher une alerte d'écart insoluble.
      await set(presenceRef, { ...payload, at: serverTimestamp() });
    } catch (err) {
      this._reportError(err, 'publication de la présence');
      throw err;
    }
    this._presenceRef = presenceRef;
    this._presenceOnDisconnect = disconnectRegistration;
    this._presencePayload = payload;

    const refreshPresence = () => {
      if (!this._presenceRef || !this._presencePayload) return;
      set(this._presenceRef, { ...this._presencePayload, at: serverTimestamp() }).catch((err) =>
        this._reportError(err, 'rafraîchissement de la présence')
      );
    };

    // Un onglet en arrière-plan continue de battre : les navigateurs bornent les minuteries
    // masquées à environ une par minute, ce qui reste sous les 90 s de péremption. Un vieil
    // onglet oublié sur un appareil quelconque tenait donc la session en alerte permanente,
    // sans que personne ne regarde son écran.
    //
    // La présence décrit les écrans **en service**, pas les onglets qui existent : masqué,
    // ce client cesse de battre et se périme comme il se doit ; revenu au premier plan, il
    // se réannonce immédiatement.
    const startHeartbeat = () => {
      if (this._presenceHeartbeat) return;
      this._presenceHeartbeat = setInterval(refreshPresence, PRESENCE_HEARTBEAT_MS);
    };
    const stopHeartbeat = () => {
      if (!this._presenceHeartbeat) return;
      clearInterval(this._presenceHeartbeat);
      this._presenceHeartbeat = null;
    };
    const onVisibilityChange = () => {
      if (typeof document === 'undefined') return;
      if (document.hidden) {
        stopHeartbeat();
      } else {
        refreshPresence();
        startHeartbeat();
      }
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange);
      this._presenceVisibilityCleanup = () =>
        document.removeEventListener('visibilitychange', onVisibilityChange);
      if (document.hidden) return;
    }
    startHeartbeat();
  }

  /**
   * Suit le décalage entre l'horloge du serveur et l'horloge locale.
   *
   * Firebase expose `.info/serverTimeOffset` précisément pour cela. Il sert à reconvertir les
   * `at` datés par le serveur vers l'horloge du lecteur, de sorte que la péremption d'une
   * présence se calcule dans un seul et même référentiel.
   *
   * @private
   */
  _trackServerTimeOffset() {
    if (!this._db || this._serverTimeOffsetTracked) return;
    this._serverTimeOffsetTracked = true;
    const offsetRef = ref(this._db, '.info/serverTimeOffset');
    onValue(offsetRef, (snapshot) => {
      const value = snapshot.val();
      this._serverTimeOffset = typeof value === 'number' && Number.isFinite(value) ? value : 0;
      this._serverTimeOffsetReady = true;
    });
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
    this._trackServerTimeOffset();
    const presenceRef = ref(this._db, `session/${this._sessionId}/presence`);
    const unsubscribe = onValue(
      presenceRef,
      (snap) => {
        const val = snap.val() || {};
        // Les `at` arrivent dans le référentiel du serveur ; on les ramène à l'horloge du
        // lecteur ici, à la frontière du transport. Au-delà, le reste du code ne connaît
        // qu'un seul temps, le sien, et `Date.now() - at` redevient un âge réel.
        /** @type {Record<string, any>} */
        const normalized = {};
        for (const [clientId, entry] of Object.entries(/** @type {object} */ (val))) {
          const raw = /** @type {any} */ (entry);
          normalized[clientId] =
            raw && typeof raw.at === 'number'
              ? { ...raw, at: raw.at - this._serverTimeOffset }
              : raw;
        }
        handler(normalized);
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
   * Lit un ensemble fini de sessions nommées. Il n'existe volontairement aucune variante
   * sans argument : les règles actuelles accordent l'accès sous `/session/$sessionId`, pas
   * la lecture globale de `/session` qui serait nécessaire pour énumérer toute la base.
   *
   * @param {string[]} sessionIds
   * @returns {Promise<Array<{ sessionId: string, hasEvents: boolean, latestEventKey: string|null, activeRetentionClients: string[], retentionBlocked: boolean }>>}
   */
  async inspectSessions(sessionIds) {
    if (!this._db) throw new Error('Transport non connecté');
    const db = /** @type {import('firebase/database').Database} */ (this._db);
    const ids = normalizeExplicitSessionIds(sessionIds);
    const serverNow = this._serverTimeOffsetReady ? Date.now() + this._serverTimeOffset : null;
    return Promise.all(
      ids.map(async (sessionId) => {
        const eventsRef = ref(db, `session/${sessionId}/events`);
        const [lastEvent, clients, presences] = await Promise.all([
          get(query(eventsRef, orderByKey(), limitToLast(1))),
          get(ref(db, `session/${sessionId}/retentionClients`)),
          get(ref(db, `session/${sessionId}/presence`)),
        ]);
        /** @type {string|null} */
        let latestEventKey = null;
        lastEvent.forEach((child) => {
          latestEventKey = child.key ?? null;
          return true;
        });
        const status = getAcknowledgedEventFrontier(clients.val(), serverNow, presences.val());
        return {
          sessionId,
          hasEvents: lastEvent.exists(),
          latestEventKey,
          activeRetentionClients: status.activeClientIds,
          retentionBlocked: status.blocked,
        };
      })
    );
  }

  /**
   * Purge un canal explicitement choisi, seulement après une inspection et une confirmation.
   * Le dry-run est le défaut. Une session avec un client actif n'est jamais forcée par cette
   * API ; il faut la laisser se déconnecter puis relancer l'inspection.
   *
   * @param {string} sessionId
   * @param {{ dryRun?: boolean, confirm?: boolean }} [options]
   * @returns {Promise<{ sessionId: string, dryRun: boolean, hasEvents: boolean, purged: boolean, activeRetentionClients: string[], retentionBlocked: boolean }>}
   */
  async purgeSessionEvents(sessionId, options = {}) {
    const [inspection] = await this.inspectSessions([sessionId]);
    const dryRun = options.dryRun !== false;
    if (inspection.retentionBlocked || inspection.activeRetentionClients.length > 0) {
      throw new Error(
        `Session "${sessionId}" encore active (${inspection.activeRetentionClients.join(', ')}) : purge refusée`
      );
    }
    if (dryRun) return { ...inspection, dryRun: true, purged: false };
    if (options.confirm !== true) {
      throw new Error('Confirmation explicite requise : passer { confirm: true, dryRun: false }');
    }

    // Le contrôle ci-dessus est informatif. La décision destructive est reprise dans une
    // transaction au niveau de la session : l'arrivée d'une lease `joining`, d'un curseur ou
    // d'une présence entre l'inspection et la suppression fait recommencer puis avorter la
    // transaction. Il n'existe ainsi aucune fenêtre check-then-delete.
    const db = /** @type {import('firebase/database').Database} */ (this._db);
    const sessionRef = ref(db, `session/${sessionId}`);
    const serverNow = this._serverTimeOffsetReady ? Date.now() + this._serverTimeOffset : null;
    let transactionStatus = {
      frontier: /** @type {string|null} */ (null),
      activeClientIds: /** @type {string[]} */ ([]),
      blocked: true,
    };
    let hadEvents = false;
    try {
      const result = await runTransaction(
        sessionRef,
        (/** @type {any} */ current) => {
          if (!current || typeof current !== 'object') {
            transactionStatus = { frontier: null, activeClientIds: [], blocked: false };
            hadEvents = false;
            return current;
          }
          transactionStatus = getAcknowledgedEventFrontier(
            current.retentionClients,
            serverNow,
            current.presence
          );
          if (transactionStatus.blocked || transactionStatus.activeClientIds.length > 0) {
            return; // `undefined` annule la transaction sans écrire.
          }
          hadEvents = Boolean(current.events && typeof current.events === 'object');
          return { ...current, events: null };
        },
        { applyLocally: false }
      );
      if (!result.committed) {
        const clients = transactionStatus.activeClientIds.join(', ');
        const detail = clients
          ? `clients actifs : ${clients}`
          : 'barrière de rétention incomplète ou horloge serveur indisponible';
        throw new Error(`Session "${sessionId}" non purgeable (${detail})`);
      }
      return {
        sessionId,
        dryRun: false,
        hasEvents: hadEvents,
        purged: hadEvents,
        activeRetentionClients: [],
        retentionBlocked: false,
      };
    } catch (err) {
      this._reportError(err, `purge des événements "${sessionId}"`);
      throw err;
    }
  }

  /**
   * Compatibilité avec le geste de fin de séance historique. Cette variante ne peut vider
   * que la session courante et reste refusée tant qu'un autre consommateur est actif.
   *
   * @returns {Promise<void>}
   */
  async purgeEvents() {
    if (!this._sessionId || !this._clientId) throw new Error('Transport non connecté');
    const sessionId = this._sessionId;
    // Le demandeur déclare explicitement ne plus avoir besoin du flux ; les autres traces,
    // elles, restent une barrière infranchissable. Le transport cesse aussi d'écouter : un
    // consommateur vivant sans lease ne doit jamais subsister après un geste de purge.
    await this._releaseRetentionClient();
    await this._releasePresenceClient();
    this.disconnect();
    await this.purgeSessionEvents(sessionId, { dryRun: false, confirm: true });
  }

  /**
   * Retire la trace locale tout en gardant le transport connect\u00e9 pour l'inspection/purge de
   * fin de s\u00e9ance. La suppression distante pr\u00e9c\u00e8de l'annulation de onDisconnect.
   *
   * @private
   * @returns {Promise<void>}
   */
  async _releaseRetentionClient() {
    if (this._retentionHeartbeat) {
      clearInterval(this._retentionHeartbeat);
      this._retentionHeartbeat = null;
    }
    if (!this._retentionClientRef) return;
    const clientRef = this._retentionClientRef;
    const disconnectRegistration = this._retentionClientOnDisconnect;
    this._retentionClientRef = null;
    this._retentionClientOnDisconnect = null;
    try {
      await remove(clientRef);
      await disconnectRegistration?.cancel();
    } catch (err) {
      this._reportError(err, 'retrait du curseur de r\u00e9tention \u00e0 la d\u00e9connexion');
      throw err;
    }
  }

  /**
   * @private
   * @returns {Promise<void>}
   */
  async _releasePresenceClient() {
    if (this._presenceHeartbeat) {
      clearInterval(this._presenceHeartbeat);
      this._presenceHeartbeat = null;
    }
    this._presenceVisibilityCleanup?.();
    this._presenceVisibilityCleanup = null;
    if (!this._presenceRef) return;
    const presenceRef = this._presenceRef;
    const disconnectRegistration = this._presenceOnDisconnect;
    this._presenceRef = null;
    this._presenceOnDisconnect = null;
    this._presencePayload = null;
    try {
      await remove(presenceRef);
      await disconnectRegistration?.cancel();
    } catch (err) {
      this._reportError(err, 'retrait de la présence à la déconnexion');
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

    // `disconnect()` reste synchrone par contrat. Le filet onDisconnect reste arm\u00e9 si le
    // navigateur dispara\u00eet avant que cette suppression au mieux ait atteint le serveur.
    this._releaseRetentionClient().catch((err) =>
      this._reportError(err, 'retrait du curseur de r\u00e9tention \u00e0 la d\u00e9connexion')
    );

    for (const unsubscribe of this._presenceUnsubscribers) unsubscribe();
    this._presenceUnsubscribers.clear();
    if (this._presenceHeartbeat) {
      clearInterval(this._presenceHeartbeat);
      this._presenceHeartbeat = null;
    }
    this._presenceVisibilityCleanup?.();
    this._presenceVisibilityCleanup = null;
    this._releasePresenceClient().catch((err) =>
      this._reportError(err, 'retrait de la présence à la déconnexion')
    );
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

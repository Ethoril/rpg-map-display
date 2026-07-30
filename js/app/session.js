// @ts-check

import { FirebaseTransport } from '../transport/FirebaseTransport.js';
import { resolveFirebaseConfig } from './runtimeConfig.js';

/** @typedef {import('../transport/Transport.js').Transport} Transport */

/**
 * Alphabet des codes de session : 30 caractères, sans `0`, `1`, `I`, `L`, `O` ni `U`.
 *
 * L'exclusion n'est pas cosmétique. Le code voyage **oralement ou à la main** du bandeau MJ
 * vers le clavier de la tablette : `0`/`O` et `1`/`I`/`L` confondus produisent une session
 * différente, donc un plateau vide sans le moindre message d'erreur. `U` part avec eux pour
 * éviter les mots formés par hasard.
 */
const ALPHABET_SESSION = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
const LONGUEUR_CODE = 5;

/**
 * Engendre un code de session court, lisible et saisissable sur une tablette.
 *
 * 30^5 ≈ 24 millions de combinaisons : la collision est sans objet à l'échelle d'une table
 * de jeu, et une collision ne coûterait de toute façon qu'un code à régénérer.
 *
 * @returns {string} 5 caractères de `ALPHABET_SESSION`
 */
export function createSessionCode() {
  const tailles = ALPHABET_SESSION.length;
  // 240 = 8 × 30 : rejeter au-delà supprime le biais de modulo, 256 n'étant pas
  // divisible par 30.
  const PLAFOND = Math.floor(256 / tailles) * tailles;
  let code = '';

  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    while (code.length < LONGUEUR_CODE) {
      const octets = new Uint8Array(LONGUEUR_CODE);
      crypto.getRandomValues(octets);
      for (const octet of octets) {
        if (code.length >= LONGUEUR_CODE) break;
        if (octet >= PLAFOND) continue;
        code += ALPHABET_SESSION[octet % tailles];
      }
    }
    return code;
  }

  for (let i = 0; i < LONGUEUR_CODE; i++) {
    code += ALPHABET_SESSION[Math.floor(Math.random() * tailles)];
  }
  return code;
}

/**
 * Normalise un identifiant de session **uniquement** s'il a la forme d'un code court.
 *
 * La casse est ainsi pardonnée à la saisie — `a7k2m` rejoint bien `A7K2M`. Mais tout ce qui
 * n'a pas exactement la forme d'un code passe **inchangé** : les sessions engendrées avant
 * ce changement sont des UUID, et les mettre en majuscules les ferait pointer vers un
 * document Firestore inexistant, donc vers un plateau vide.
 *
 * @param {string|null|undefined} brut
 * @returns {string} l'identifiant à utiliser, normalisé le cas échéant
 */
export function normalizeSessionId(brut) {
  if (!brut) return '';
  const candidat = brut.trim();
  if (candidat.length !== LONGUEUR_CODE) return candidat;
  const majuscules = candidat.toUpperCase();
  const conforme = [...majuscules].every((c) => ALPHABET_SESSION.includes(c));
  return conforme ? majuscules : candidat;
}

/**
 * Indicate clairement le mode réseau. Côté joueurs, le badge n'est visible que pour un état
 * cassé ou local ; côté MJ il reste discret et permanent.
 *
 * @param {'gm'|'players'} role
 * @param {string} [sessionId]
 * @returns {{element: HTMLElement, update: (status: 'local'|'auth'|'connecting'|'connected'|'error', detail?: unknown) => void, remove: () => void}}
 */
export function createNetworkStatus(role, sessionId = '') {
  const element = document.createElement('div');
  element.id = `network-status-${role}`;
  element.style.cssText =
    'position:fixed;z-index:900;left:8px;bottom:8px;padding:5px 8px;border-radius:4px;' +
    'font:12px system-ui,sans-serif;pointer-events:none;background:#222;color:#ddd';
  document.body.appendChild(element);

  return {
    element,
    update(status, detail) {
      const messages = {
        local: 'Mode local — Firebase non configuré',
        auth: 'Connexion Google requise',
        connecting: 'Connexion Firebase…',
        connected: 'Firebase connecté',
        error: `Erreur réseau — ${/** @type {any} */ (detail)?.message || detail || 'inconnue'}`,
      };
      const sessionSuffix = role === 'gm' && sessionId ? ` · session ${sessionId}` : '';
      element.textContent = `${messages[status]}${sessionSuffix}`;
      element.dataset.status = status;
      element.dataset.sessionId = sessionId;
      element.style.background =
        status === 'error' ? '#8b1e1e' : status === 'connected' ? '#174f2a' : '#3d3520';
      element.style.display =
        role === 'players' && status === 'connected' ? 'none' : 'block';
    },
    remove() {
      element.remove();
    },
  };
}

/**
 * @param {'gm'|'players'} role
 * @param {HTMLElement|null} host
 * @param {FirebaseTransport} transport
 */
async function requestGoogleSignIn(role, host, transport) {
  if (typeof document === 'undefined') {
    throw new Error('Authentification Google impossible hors navigateur');
  }

  const overlay = document.createElement('div');
  overlay.className = `firebase-login firebase-login-${role}`;
  overlay.setAttribute('role', 'status');
  overlay.style.cssText =
    role === 'players'
      ? 'position:fixed;inset:0;z-index:1000;display:grid;place-items:center;background:#000;color:#fff'
      : 'padding:12px;background:#3b1f1f;color:#fff;border:1px solid #d66';

  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Se connecter avec Google';
  button.style.cssText = 'padding:12px 18px;font:inherit;cursor:pointer';
  overlay.appendChild(button);
  (host || document.body).appendChild(overlay);

  try {
    await new Promise((resolve, reject) => {
      button.addEventListener(
        'click',
        () => {
          button.disabled = true;
          button.textContent = 'Connexion…';
          transport.signInWithGoogle().then(resolve, reject);
        },
        { once: true }
      );
    });
  } finally {
    overlay.remove();
  }
}

/**
 * Construit et connecte le transport d'une page. Un transport injecté sert aux tests et au
 * mode LAN ; Firebase est utilisé sinon lorsque sa configuration publique est disponible.
 *
 * @param {{
 *   injectedTransport?: Transport|null,
 *   firebaseConfig?: Record<string, any>|null,
 *   sessionId: string,
 *   role: 'gm'|'players',
 *   loginHost?: HTMLElement|null,
 *   onStatus?: (status: 'local'|'auth'|'connecting'|'connected'|'error', detail?: unknown) => void
 * }} options
 * @returns {Promise<Transport|null>}
 */
export async function connectSession(options) {
  const {
    injectedTransport = null,
    firebaseConfig = null,
    sessionId,
    role,
    loginHost = null,
    onStatus = () => {},
  } = options;

  if (injectedTransport) {
    onStatus('connecting');
    await injectedTransport.connect(sessionId, role);
    onStatus('connected');
    return injectedTransport;
  }

  const config = resolveFirebaseConfig(firebaseConfig);
  if (!config) {
    onStatus('local', new Error('Configuration Firebase absente'));
    return null;
  }

  const transport = new FirebaseTransport(config);
  transport.onError((error) => onStatus('error', error));

  try {
    const user = await transport.currentUser();
    if (!user) {
      onStatus('auth');
      await requestGoogleSignIn(role, loginHost, transport);
    }
    onStatus('connecting');
    await transport.connect(sessionId, role);
    onStatus('connected');
    return transport;
  } catch (error) {
    onStatus('error', error);
    throw error;
  }
}

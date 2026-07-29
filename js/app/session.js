// @ts-check

import { FirebaseTransport } from '../transport/FirebaseTransport.js';
import { resolveFirebaseConfig } from './runtimeConfig.js';

/** @typedef {import('../transport/Transport.js').Transport} Transport */

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

// @ts-check
import { VERSION } from '../core/version.js';
import {
  checkBuildMismatch,
  subscribePresence,
  setPresenceMap,
} from '../state/presence.js';

/**
 * Options de montage du badge de version.
 * @typedef {Object} VersionBadgeOptions
 * @property {import('../transport/Transport.js').Transport} [transport] Instance du transport réseau
 * @property {'gm'|'players'} [role] Rôle du client courant ('gm' ou 'players')
 * @property {number} [build] Surcharge optionnelle du numéro de build local (pour tests)
 * @property {string} [label] Surcharge optionnelle du label de version (pour tests)
 */

/**
 * Monte le badge et la bannière de version pour la vue MJ.
 *
 * @param {HTMLElement} container Élément conteneur du pied de panneau (footer)
 * @param {VersionBadgeOptions} [options]
 * @returns {{ detach: () => void, update: () => void }}
 */
export function mountGMVersionBadge(container, options = {}) {
  if (!container) {
    throw new Error('mountGMVersionBadge : conteneur requis');
  }

  const localBuild = options.build ?? VERSION.build;
  const localLabel = options.label ?? VERSION.label;
  const localCommit = VERSION.commit;

  // Création du pied de panneau discret
  container.innerHTML = `
    <div id="version-mismatch-banner-gm" class="version-mismatch-banner" style="display: none; padding: 0.6rem 0.8rem; margin-bottom: 0.5rem; background: #d32f2f; color: #ffffff; border-radius: 4px; font-weight: bold; font-size: 0.8rem; text-align: center; box-shadow: 0 2px 8px rgba(0,0,0,0.4);"></div>
    <div class="version-label-gm" style="font-size: 0.75rem; color: #888; text-align: center;">
      <span>${localLabel} · ${localCommit}</span>
    </div>
  `;

  const banner = /** @type {HTMLElement} */ (container.querySelector('#version-mismatch-banner-gm'));

  function update() {
    const mismatch = checkBuildMismatch(localBuild);
    if (mismatch.hasMismatch) {
      const remoteBuild = mismatch.remoteBuild;
      banner.textContent = `La tablette exécute la build ${remoteBuild}, ce poste la ${localBuild}. Recharge la tablette.`;
      banner.style.display = 'block';
    } else {
      banner.style.display = 'none';
    }
  }

  const unsubPresence = subscribePresence(update);

  let unsubTransportPresence = null;
  if (options.transport) {
    const transport = /** @type {any} */ (options.transport);
    if (typeof transport.subscribePresence === 'function') {
      unsubTransportPresence = transport.subscribePresence((/** @type {any} */ presences) => {
        setPresenceMap(presences);
      });
    }
    if (typeof transport.publishPresence === 'function') {
      transport.publishPresence({
        role: options.role || 'gm',
        build: localBuild,
        label: localLabel,
      });
    }
  }

  update();

  return {
    detach: () => {
      unsubPresence();
      if (unsubTransportPresence) unsubTransportPresence();
    },
    update,
  };
}

/**
 * Monte l'overlay de version transitoire/persistant pour la vue Joueurs.
 *
 * @param {VersionBadgeOptions} [options]
 * @returns {{ detach: () => void, show: () => void, update: () => void, element: HTMLElement }}
 */
export function mountPlayerVersionBadge(options = {}) {
  const localBuild = options.build ?? VERSION.build;
  const localLabel = options.label ?? VERSION.label;

  let overlay = document.getElementById('player-version-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'player-version-overlay';
    overlay.className = 'player-version-overlay';
    document.body.appendChild(overlay);
  }

  overlay.style.position = 'fixed';
  overlay.style.bottom = '12px';
  overlay.style.right = '12px';
  overlay.style.zIndex = '9999';
  overlay.style.padding = '6px 12px';
  overlay.style.borderRadius = '4px';
  overlay.style.fontFamily = 'system-ui, sans-serif';
  overlay.style.fontSize = '0.8rem';
  overlay.style.color = '#ffffff';
  overlay.style.background = 'rgba(0, 0, 0, 0.75)';
  overlay.style.pointerEvents = 'none';
  overlay.style.transition = 'opacity 0.4s ease, background-color 0.3s ease';
  overlay.style.opacity = '1';
  overlay.textContent = localLabel;

  /** @type {ReturnType<typeof setTimeout>|null} */
  let fadeTimer = null;
  let isMismatching = false;

  function hideAfterDelay() {
    if (fadeTimer) clearTimeout(fadeTimer);
    fadeTimer = setTimeout(() => {
      if (!isMismatching && overlay) {
        overlay.style.opacity = '0';
      }
    }, 4000);
  }

  function showOverlay() {
    if (!overlay) return;
    overlay.style.opacity = '1';
    hideAfterDelay();
  }

  function update() {
    if (!overlay) return;
    const mismatch = checkBuildMismatch(localBuild);
    if (mismatch.hasMismatch) {
      isMismatching = true;
      if (fadeTimer) clearTimeout(fadeTimer);
      overlay.style.backgroundColor = '#d32f2f';
      overlay.style.opacity = '1';
      overlay.textContent = `${localLabel} · Écart de version (build ${mismatch.remoteBuild})`;
    } else {
      isMismatching = false;
      overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.75)';
      overlay.textContent = localLabel;
      hideAfterDelay();
    }
  }

  // Écoute des gestes à 3 doigts (touchstart, pointerdown simultanés et événement custom)
  /** @type {Set<number>} */
  const activePointers = new Set();

  const handleThreeFinger = () => showOverlay();

  /** @param {TouchEvent} e */
  const handleTouchStart = (e) => {
    if (e.touches && e.touches.length === 3) {
      showOverlay();
    }
  };

  /** @param {PointerEvent} e */
  const handlePointerDown = (e) => {
    activePointers.add(e.pointerId);
    if (activePointers.size >= 3) {
      showOverlay();
    }
  };

  /** @param {PointerEvent} e */
  const handlePointerUp = (e) => {
    activePointers.delete(e.pointerId);
  };

  window.addEventListener('three-finger-tap', handleThreeFinger);
  window.addEventListener('touchstart', handleTouchStart);
  window.addEventListener('pointerdown', handlePointerDown);
  window.addEventListener('pointerup', handlePointerUp);
  window.addEventListener('pointercancel', handlePointerUp);

  const unsubPresence = subscribePresence(update);

  let unsubTransportPresence = null;
  if (options.transport) {
    const transport = /** @type {any} */ (options.transport);
    if (typeof transport.subscribePresence === 'function') {
      unsubTransportPresence = transport.subscribePresence((/** @type {any} */ presences) => {
        setPresenceMap(presences);
      });
    }
    if (typeof transport.publishPresence === 'function') {
      transport.publishPresence({
        role: options.role || 'players',
        build: localBuild,
        label: localLabel,
      });
    }
  }

  // Affichage initial pendant 4s au chargement
  hideAfterDelay();
  update();

  return {
    detach: () => {
      window.removeEventListener('three-finger-tap', handleThreeFinger);
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
      unsubPresence();
      if (unsubTransportPresence) unsubTransportPresence();
      if (overlay && overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
      }
    },
    show: showOverlay,
    update,
    element: overlay,
  };
}

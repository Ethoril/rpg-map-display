// @ts-check
import { VERSION } from '../core/version.js';
import {
  listBuildMismatches,
  subscribePresence,
  setPresenceMap,
} from '../state/presence.js';

/**
 * Désigne un client par son rôle, tel qu'on en parle à table.
 *
 * @param {'gm'|'players'} role
 * @returns {string}
 */
function nommerClient(role) {
  return role === 'gm' ? 'un poste MJ' : 'la tablette';
}

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
  const transport = /** @type {any} */ (options.transport);
  /** @type {string|null} */
  let transportError = null;

  function update() {
    const selfClientId =
      transport && typeof transport.getClientId === 'function' ? transport.getClientId() : '';
    const mismatches = listBuildMismatches(localBuild, selfClientId || '');
    if (transportError) {
      banner.textContent = `Connexion impossible : ${transportError}`;
      banner.style.display = 'block';
      return;
    }
    if (mismatches.length > 0) {
      // Le message nommait « la tablette » quel que soit le rôle du client fautif, et n'en
      // citait qu'un seul. Envoyer recharger le mauvais écran est pire que ne rien dire.
      const enumeration = mismatches
        .map((client) => `${nommerClient(client.role)} exécute la build ${client.build}`)
        .join(' ; ');
      const consigne = mismatches.some((client) => client.build > localBuild)
        ? 'Recharge ce poste.'
        : mismatches.every((client) => client.role === 'players')
          ? 'Recharge la tablette.'
          : 'Recharge l’écran en retard.';
      banner.textContent = `${enumeration.charAt(0).toUpperCase()}${enumeration.slice(1)}, ce poste la ${localBuild}. ${consigne}`;
      banner.style.display = 'block';
    } else {
      banner.style.display = 'none';
    }
  }

  const unsubPresence = subscribePresence(update);
  const stalePresenceTimer = setInterval(update, 30_000);

  let unsubTransportPresence = null;
  let unsubTransportError = null;
  if (transport) {
    if (typeof transport.onError === 'function') {
      unsubTransportError = transport.onError((/** @type {unknown} */ err) => {
        transportError =
          /** @type {any} */ (err)?.message || /** @type {any} */ (err)?.code || String(err);
        update();
      });
    }
    if (typeof transport.subscribePresence === 'function') {
      try {
        unsubTransportPresence = transport.subscribePresence((/** @type {any} */ presences) => {
          setPresenceMap(presences);
        });
      } catch (err) {
        transportError = /** @type {any} */ (err)?.message || String(err);
      }
    }
    if (typeof transport.publishPresence === 'function') {
      Promise.resolve()
        .then(() =>
          transport.publishPresence({
            role: options.role || 'gm',
            build: localBuild,
            label: localLabel,
          })
        )
        .catch((err) => {
          transportError = /** @type {any} */ (err)?.message || String(err);
          update();
        });
    }
  }

  update();

  return {
    detach: () => {
      unsubPresence();
      clearInterval(stalePresenceTimer);
      if (unsubTransportPresence) unsubTransportPresence();
      if (unsubTransportError) unsubTransportError();
    },
    update,
  };
}

/**
 * Recense les URL de **code** (JS/CSS) de cette origine déjà chargées par la page.
 *
 * Images et scènes en sont exclues à dessein : elles ne portent pas la version
 * applicative, et les recharger coûterait plusieurs mégaoctets sur la liaison de la
 * tablette pour rien.
 *
 * @returns {string[]}
 */
function collectCodeUrls() {
  /** @type {Set<string>} */
  const urls = new Set();
  // Le document lui-même : sans lui, le rechargement repart de l'ancien HTML.
  urls.add(location.href);

  /** @param {string} raw @returns {string|null} */
  const codeUrl = (raw) => {
    const url = new URL(raw, location.href);
    if (url.origin !== location.origin) return null;
    return /\.(m?js|css)$/i.test(url.pathname) ? url.href : null;
  };

  // Resource Timing est la seule source qui recense les modules ES tirés par `import` :
  // le DOM n'expose que les points d'entrée.
  for (const entry of performance.getEntriesByType('resource')) {
    const url = codeUrl(entry.name);
    if (url) urls.add(url);
  }

  // Repli : le tampon Resource Timing est borné (250 entrées par défaut) et peut avoir
  // débordé. Les points d'entrée déclarés dans le HTML, eux, sont toujours là.
  try {
    for (const el of document.querySelectorAll('script[src], link[rel="stylesheet"][href]')) {
      const raw = el.getAttribute('src') || el.getAttribute('href');
      const url = raw ? codeUrl(raw) : null;
      if (url) urls.add(url);
    }
  } catch (err) {
    // Une URL d'attribut malformée ne doit pas priver la purge des URL déjà recensées.
    console.warn('Mise à jour forcée : lecture du DOM incomplète —', err);
  }

  return Array.from(urls);
}

/**
 * Force le passage à la version publiée la plus récente.
 *
 * Un simple `location.reload()` ne suffit pas, et c'est le cœur du problème : GitHub Pages
 * sert tous les fichiers avec un `Cache-Control: max-age`, et Safari iOS ressert alors les
 * modules ES depuis son cache HTTP sans même revalider. La page se recharge, le code reste
 * celui d'hier, et la tablette continue d'annoncer son écart de build.
 *
 * On rafraîchit donc explicitement chaque URL de code avec `cache: 'reload'` — qui ignore
 * le cache **et le remplace** par la réponse réseau — avant de recharger. Le rechargement
 * repart alors d'entrées de cache fraîches.
 *
 * @returns {Promise<void>}
 */
export async function forceReloadToLatest() {
  // 1. Un service worker ou un Cache Storage resservirait l'ancienne version quoi qu'on
  //    fasse ensuite. Le dépôt n'en installe aucun aujourd'hui ; la purge est là pour que
  //    l'en ajouter un jour ne rende pas ce bouton mensonger.
  try {
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
    if (navigator.serviceWorker && typeof navigator.serviceWorker.getRegistrations === 'function') {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }
  } catch (err) {
    // Purge best-effort : on journalise et on poursuit, le rechargement reste utile.
    console.warn('Mise à jour forcée : purge des caches applicatifs impossible —', err);
  }

  // 2. Remplacement des entrées du cache HTTP par la version réseau.
  const urls = collectCodeUrls();
  const results = await Promise.allSettled(
    urls.map((url) => fetch(url, { cache: 'reload', credentials: 'same-origin' }))
  );
  const echecs = results.filter((result) => result.status === 'rejected').length;
  if (echecs > 0) {
    console.warn(
      `Mise à jour forcée : ${echecs}/${urls.length} ressources non rafraîchies (réseau ?)`
    );
  }

  // 3. Rechargement, désormais servi par des entrées de cache fraîches.
  location.reload();
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

  // Le libellé vit désormais dans son propre nœud : l'écrire ne doit pas emporter le
  // bouton de mise à jour au passage.
  overlay.textContent = '';
  const overlayText = document.createElement('span');
  overlayText.id = 'player-version-text';
  overlayText.textContent = localLabel;
  overlay.appendChild(overlayText);

  // Tapable, et seulement tant que l'écart de build dure : l'overlay reste en
  // `pointer-events: none`, le bouton seul le rétablit (cf. CONVENTIONS.md §8,
  // interdiction 2).
  //
  // Il est créé ici mais **inséré dans le document uniquement en cas d'écart** : le zéro-UI
  // de la vue joueurs se vérifie par `querySelectorAll('button, nav, input').length === 0`
  // (T-23), donc un bouton simplement masqué violerait la règle sans que rien ne s'affiche.
  const updateButton = document.createElement('button');
  updateButton.id = 'player-version-update';
  updateButton.type = 'button';
  updateButton.textContent = 'Mettre à jour';
  updateButton.style.marginLeft = '10px';
  updateButton.style.padding = '6px 12px';
  updateButton.style.minHeight = '32px';
  updateButton.style.border = '0';
  updateButton.style.borderRadius = '4px';
  updateButton.style.background = '#ffffff';
  updateButton.style.color = '#d32f2f';
  updateButton.style.font = 'inherit';
  updateButton.style.fontWeight = 'bold';
  updateButton.style.cursor = 'pointer';
  updateButton.style.pointerEvents = 'auto';
  updateButton.style.touchAction = 'manipulation';

  let isUpdating = false;
  const handleUpdateClick = () => {
    if (isUpdating) return;
    isUpdating = true;
    updateButton.disabled = true;
    updateButton.style.cursor = 'default';
    updateButton.textContent = 'Mise à jour…';
    void forceReloadToLatest();
  };
  updateButton.addEventListener('click', handleUpdateClick);

  /** @type {ReturnType<typeof setTimeout>|null} */
  let fadeTimer = null;
  let isMismatching = false;
  const transport = /** @type {any} */ (options.transport);
  /** @type {string|null} */
  let transportError = null;

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
    const selfClientId =
      transport && typeof transport.getClientId === 'function' ? transport.getClientId() : '';
    const mismatches = listBuildMismatches(localBuild, selfClientId || '');
    if (transportError) {
      isMismatching = true;
      if (fadeTimer) clearTimeout(fadeTimer);
      overlay.style.backgroundColor = '#d32f2f';
      overlay.style.opacity = '1';
      overlayText.textContent = `${localLabel} · Connexion impossible`;
      // Sans réseau, forcer la mise à jour ne peut rien ramener de neuf.
      if (!isUpdating) updateButton.remove();
      return;
    }
    if (mismatches.length > 0) {
      isMismatching = true;
      if (fadeTimer) clearTimeout(fadeTimer);
      overlay.style.backgroundColor = '#d32f2f';
      overlay.style.opacity = '1';
      // Le numéro de build est monotone (nombre de commits, cf. le workflow de déploiement) :
      // le plus grand est le plus récent. Cette page n'est périmée que s'il existe plus récent
      // qu'elle — les clients *en retard sur elle* ne la concernent pas.
      const buildMax = Math.max(...mismatches.map((client) => client.build));
      const estPerime = buildMax > localBuild;
      const enRetard = mismatches[0];
      overlayText.textContent = estPerime
        ? `${localLabel} · Version périmée (build ${buildMax} disponible)`
        : `${localLabel} · ${nommerClient(enRetard.role)} est en retard (build ${enRetard.build})`;
      // Le bouton n'apparaît que si cette page est réellement en retard.
      //
      // Il s'affichait dans les deux sens, au motif que forcer ne ferait « aucun mal ». Si :
      // sur l'écran déjà à jour, il promet un remède qu'il ne peut pas tenir, on le tape, la
      // page recharge, l'alerte revient — et on cherche le défaut du mauvais côté.
      if (estPerime) {
        if (!updateButton.isConnected) overlay.appendChild(updateButton);
      } else if (!isUpdating) {
        updateButton.remove();
      }
    } else {
      isMismatching = false;
      overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.75)';
      overlayText.textContent = localLabel;
      if (!isUpdating) updateButton.remove();
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
  const stalePresenceTimer = setInterval(update, 30_000);

  let unsubTransportPresence = null;
  let unsubTransportError = null;
  if (transport) {
    if (typeof transport.onError === 'function') {
      unsubTransportError = transport.onError((/** @type {unknown} */ err) => {
        transportError =
          /** @type {any} */ (err)?.message || /** @type {any} */ (err)?.code || String(err);
        update();
      });
    }
    if (typeof transport.subscribePresence === 'function') {
      try {
        unsubTransportPresence = transport.subscribePresence((/** @type {any} */ presences) => {
          setPresenceMap(presences);
        });
      } catch (err) {
        transportError = /** @type {any} */ (err)?.message || String(err);
      }
    }
    if (typeof transport.publishPresence === 'function') {
      Promise.resolve()
        .then(() =>
          transport.publishPresence({
            role: options.role || 'players',
            build: localBuild,
            label: localLabel,
          })
        )
        .catch((err) => {
          transportError = /** @type {any} */ (err)?.message || String(err);
          update();
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
      updateButton.removeEventListener('click', handleUpdateClick);
      unsubPresence();
      clearInterval(stalePresenceTimer);
      if (unsubTransportPresence) unsubTransportPresence();
      if (unsubTransportError) unsubTransportError();
      if (overlay && overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
      }
    },
    show: showOverlay,
    update,
    element: overlay,
  };
}

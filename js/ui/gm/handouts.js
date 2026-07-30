// @ts-check

import * as store from '../../state/store.js';
import { isPersistableAssetUrl } from '../../core/schema.js';

/** @typedef {import('../../transport/Transport.js').Transport} Transport */

/**
 * Options d'initialisation de l'interface Handouts MJ.
 * @typedef {Object} HandoutsOptions
 * @property {Transport} [transport]
 */

/**
 * Crée et monte l'interface de révélation d'images (handouts) pour le MJ.
 *
 * @param {HTMLElement} mount Élément DOM d'ancrage
 * @param {HandoutsOptions} [options]
 * @returns {{ destroy: () => void }}
 */
export function createHandouts(mount, options = {}) {
  if (!mount) {
    throw new Error('createHandouts : élément d\'ancrage requis');
  }

  const { transport } = options;
  const listeners = new AbortController();

  mount.innerHTML = `
    <div class="handouts-form" style="display: flex; flex-direction: column; gap: 1rem; background: #252525; padding: 1rem; border-radius: 6px; border: 1px solid #333;">
      <h3 style="margin: 0 0 0.5rem 0; font-size: 1rem; color: #4a90e2;">Révélation d'image (Handout)</h3>

      <div style="display: flex; flex-direction: column; gap: 0.5rem;">
        <label for="handout-image-url" style="font-size: 0.85rem; color: #ccc;">URL de l'image (relative ou https://) :</label>
        <input type="text" id="handout-image-url" placeholder="./assets/mon-image.jpg" style="padding: 0.5rem; background: #1e1e1e; color: #fff; border: 1px solid #444; border-radius: 4px; font-size: 0.85rem;" />
      </div>

      <div style="display: flex; flex-direction: column; gap: 0.5rem;">
        <label for="handout-title" style="font-size: 0.85rem; color: #ccc;">Nom / Titre (optionnel) :</label>
        <input type="text" id="handout-title" placeholder="Lettre secrète" style="padding: 0.5rem; background: #1e1e1e; color: #fff; border: 1px solid #444; border-radius: 4px; font-size: 0.85rem;" />
      </div>

      <div id="handout-error-msg" style="display: none; padding: 0.5rem; background: #3a1a1a; color: #ff6b6b; border: 1px solid #662222; border-radius: 4px; font-size: 0.8rem;"></div>

      <div style="display: flex; gap: 0.5rem;">
        <button id="handout-show-btn" style="flex: 1; padding: 0.6rem; background: #2e7d32; color: #fff; border: none; border-radius: 4px; font-weight: bold; cursor: pointer;">👁️ Révéler aux joueurs</button>
        <button id="handout-hide-btn" style="flex: 1; padding: 0.6rem; background: #c62828; color: #fff; border: none; border-radius: 4px; font-weight: bold; cursor: pointer;">🙈 Masquer</button>
      </div>

      <div id="handout-status" style="padding: 0.5rem; background: #1e1e1e; border-radius: 4px; border: 1px solid #333; font-size: 0.8rem; color: #aaa;">
        Aucun handout affiché aux joueurs.
      </div>
    </div>
  `;

  const urlInput = /** @type {HTMLInputElement} */ (mount.querySelector('#handout-image-url'));
  const titleInput = /** @type {HTMLInputElement} */ (mount.querySelector('#handout-title'));
  const errorEl = /** @type {HTMLElement} */ (mount.querySelector('#handout-error-msg'));
  const showBtn = /** @type {HTMLButtonElement} */ (mount.querySelector('#handout-show-btn'));
  const hideBtn = /** @type {HTMLButtonElement} */ (mount.querySelector('#handout-hide-btn'));
  const statusEl = /** @type {HTMLElement} */ (mount.querySelector('#handout-status'));

  function updateStatusUI() {
    const active = store.getActiveHandout();
    if (active && active.imageUrl) {
      const displayName = active.name ? active.name : active.imageUrl;
      statusEl.style.borderColor = '#2e7d32';
      statusEl.style.color = '#81c784';
      statusEl.textContent = `🟢 Affiché aux joueurs : ${displayName}`;
    } else {
      statusEl.style.borderColor = '#333';
      statusEl.style.color = '#aaa';
      statusEl.textContent = '⚪ Aucun handout affiché aux joueurs.';
    }
  }

  showBtn.addEventListener('click', () => {
    errorEl.style.display = 'none';
    errorEl.textContent = '';
    const url = urlInput.value.trim();

    if (!url) {
      errorEl.textContent = 'Veuillez saisir une URL d\'image.';
      errorEl.style.display = 'block';
      return;
    }

    if (!isPersistableAssetUrl(url)) {
      errorEl.textContent = 'URL non persistable : les images data: et blob: ou absolues non-https sont interdites. Déposez le fichier dans un dossier du dépôt.';
      errorEl.style.display = 'block';
      return;
    }

    const handout = {
      id: `handout-${Date.now()}`,
      name: titleInput.value.trim() || 'Handout',
      imageUrl: url,
    };

    store.setActiveHandout(handout);

    if (transport) {
      transport.publish({
        type: 'handout.show',
        payload: { handout },
        at: Date.now(),
        by: 'gm',
      });
    }
  }, { signal: listeners.signal });

  hideBtn.addEventListener('click', () => {
    errorEl.style.display = 'none';
    errorEl.textContent = '';

    store.setActiveHandout(null);

    if (transport) {
      transport.publish({
        type: 'handout.hide',
        payload: {},
        at: Date.now(),
        by: 'gm',
      });
    }
  }, { signal: listeners.signal });

  const unsubscribeStore = store.subscribe(updateStatusUI);
  updateStatusUI();

  return {
    destroy: () => {
      listeners.abort();
      unsubscribeStore();
      mount.replaceChildren();
    },
  };
}

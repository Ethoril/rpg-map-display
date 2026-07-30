// @ts-check

import * as store from '../../state/store.js';
import {
  isPersistableAssetUrl,
  isUnusableGoogleDriveUrl,
  normalizeImageUrl,
} from '../../core/schema.js';

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
    const saisie = urlInput.value.trim();

    if (!saisie) {
      errorEl.textContent = 'Veuillez saisir une URL d\'image.';
      errorEl.style.display = 'block';
      return;
    }

    if (isUnusableGoogleDriveUrl(saisie)) {
      errorEl.textContent =
        'Ce lien Google Drive ne désigne pas un fichier (un dossier ?). Ouvrez l\'image dans Drive, puis copiez son lien de partage.';
      errorEl.style.display = 'block';
      return;
    }

    // Un lien de partage Drive est une page HTML : converti ici, avant le store et avant le
    // réseau, pour que ce soit une URL affichable qui parte — et non à l'affichage, où le
    // défaut se serait manifesté sur l'écran des joueurs.
    const url = normalizeImageUrl(saisie);
    // Le champ reflète ce qui est réellement publié : le MJ voit la conversion plutôt que de
    // la subir.
    if (url !== saisie) urlInput.value = url;

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

    // Vérification délibérément NON bloquante. Au milieu d'une scène, faire patienter le MJ
    // le temps d'un aller-retour réseau serait pire que le défaut qu'on surveille. La
    // révélation part donc immédiatement ; si l'image ne charge pas, le MJ l'apprend ici, et
    // non par un joueur qui décrit un cadre vide.
    const sonde = new Image();
    sonde.addEventListener('error', () => {
      errorEl.textContent = `L'image n'a pas pu être chargée depuis ${url} — les joueurs voient un cadre vide. Vérifiez que le partage est bien « tous ceux qui ont le lien ».`;
      errorEl.style.display = 'block';
    });
    sonde.src = url;
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

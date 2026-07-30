// @ts-check

import * as store from '../../state/store.js';
import { normalizeImageUrl } from '../../core/schema.js';

/**
 * Monte l'overlay plein écran d'affichage de handout pour la vue joueurs.
 *
 * Règle Zero-UI (T-23) : Aucun élément <button>, <nav> ou <input> n'est créé dans le DOM.
 * Le z-index est fixé à 9000, strictement inférieur à 9999 (avertissement de version).
 *
 * @param {HTMLElement} [container] Conteneur DOM (par défaut document.body)
 * @returns {{ detach: () => void, update: () => void }}
 */
export function mountHandoutOverlay(container = document.body) {
  let overlay = document.getElementById('handout-overlay');
  let img = /** @type {HTMLImageElement|null} */ (overlay?.querySelector('img') ?? null);

  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'handout-overlay';
    overlay.className = 'handout-overlay';

    img = document.createElement('img');
    img.alt = 'Handout';
    overlay.appendChild(img);

    container.appendChild(overlay);
  }

  overlay.style.position = 'fixed';
  overlay.style.top = '0';
  overlay.style.left = '0';
  overlay.style.width = '100vw';
  overlay.style.height = '100vh';
  overlay.style.background = 'rgba(0, 0, 0, 0.9)';
  overlay.style.zIndex = '9000';
  overlay.style.display = 'none';
  overlay.style.alignItems = 'center';
  overlay.style.justifyContent = 'center';
  overlay.style.pointerEvents = 'none';

  if (img) {
    img.style.maxWidth = '100%';
    img.style.maxHeight = '100%';
    img.style.objectFit = 'contain';
    img.style.display = 'block';
  }

  function update() {
    const active = store.getActiveHandout();
    if (active && active.imageUrl && overlay && img) {
      // La conversion a déjà lieu côté MJ, avant publication. Elle est répétée ici pour les
      // handouts déjà enregistrés dans une campagne, qui portent encore un lien de partage
      // brut : sans cela, ils resteraient cassés jusqu'à ce qu'on les republie.
      img.src = normalizeImageUrl(active.imageUrl);
      overlay.style.display = 'flex';
    } else if (overlay && img) {
      overlay.style.display = 'none';
      img.src = '';
    }
  }

  const unsubscribe = store.subscribe(update);
  update();

  return {
    detach: () => {
      unsubscribe();
      overlay?.remove();
    },
    update,
  };
}

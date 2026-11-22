// @ts-check

/** @typedef {import('../../transport/Transport.js').Transport} Transport */
/** @typedef {import('../../core/types.js').SharedImage} SharedImage */

/**
 * Monte l'overlay plein écran du partage d'image pour la vue joueurs — chantier C-13.
 *
 * Il suit le nœud d'état de l'image partagée : une image ouverte s'affiche, y compris après un F5 ;
 * une image fermée disparaît, et ne revient jamais puisque le nœud est effacé.
 *
 * Règle Zero-UI (T-23) : **rien** dans le DOM tant qu'aucune image n'est partagée. Pendant
 * l'affichage, l'overlay capte les gestes (pas de pan de carte dessous) et son seul contrôle est
 * la croix, qui ferme l'image **pour tous**. Le z-index (`css/player.css`) reste strictement
 * inférieur à 9999, l'avertissement de version.
 *
 * @param {{ transport?: Transport, container?: HTMLElement, onVisibility?: (visible: boolean) => void }} [options]
 *   `onVisibility` prévient la vue quand l'overlay apparaît ou disparaît. Il existe pour une
 *   raison concrète : le bouton d'annulation du mouvement du tour (`right: 116px`) recouvrirait
 *   la croix de fermeture (`right: 124px`, 64 px de large) et lui volerait son tap. La vue le
 *   retire donc tant qu'une image est à l'écran, et ce rappel est le seul signal qu'elle ait —
 *   l'overlay suit son propre nœud réseau, pas le store.
 * @returns {{ detach: () => void }}
 */
export function mountImageShareOverlay(options = {}) {
  const { transport, container = document.body } = options;
  const annoncer = () => options.onVisibility?.(overlay !== null);

  /** @type {HTMLDivElement|null} */
  let overlay = null;
  /** @type {HTMLImageElement|null} */
  let img = null;
  /** @type {SharedImage|null} */
  let affichee = null;

  function retirer() {
    overlay?.remove();
    overlay = null;
    img = null;
  }

  function fermer() {
    if (!affichee) return;
    const id = affichee.id;
    // Masquée tout de suite, sans attendre l'aller-retour : la croix doit répondre au doigt.
    affichee = null;
    retirer();
    annoncer();
    transport?.closeSharedImage?.(id);
  }

  function construire() {
    overlay = document.createElement('div');
    overlay.id = 'image-share-overlay';

    img = document.createElement('img');
    img.alt = 'Image partagée par le meneur de jeu';
    img.draggable = false;

    const croix = document.createElement('button');
    croix.type = 'button';
    croix.className = 'image-share-close';
    croix.setAttribute('aria-label', 'Fermer l\'image');
    croix.textContent = '✕';
    croix.addEventListener('click', fermer);

    overlay.append(img, croix);
    container.appendChild(overlay);
  }

  /** @param {SharedImage|null} image */
  function surNoeud(image) {
    affichee = image;
    if (!image) {
      retirer();
      annoncer();
      return;
    }
    if (!overlay) construire();
    if (img && img.getAttribute('src') !== image.dataUrl) img.src = image.dataUrl;
    annoncer();
  }

  const unsubscribe =
    transport && typeof transport.subscribeSharedImage === 'function'
      ? transport.subscribeSharedImage(surNoeud)
      : () => {};

  return {
    detach: () => {
      unsubscribe();
      retirer();
    },
  };
}

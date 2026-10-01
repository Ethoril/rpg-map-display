// @ts-check

import {
  MOUNTED_ICON_URL,
  SELECTION_STRIP_LABEL_MS,
  STATUS_MARKER_IDS,
  STATUS_MARKER_LABEL_FR,
} from '../../core/constants.js';
import { isPlayerManipulableToken } from '../../input/tokenHit.js';

/** @typedef {import('../../core/types.js').Token} Token */

/**
 * Options de la bande de sélection de la vue joueurs (chantier C-9).
 *
 * @typedef {Object} SelectionStripOptions
 * @property {() => Token | null} getSelectedToken Pion sélectionné à la tablette
 * @property {(token: Token) => void} onToggleMounted Bascule monter / descendre. La bande ne
 *   publie rien elle-même : `ui/*` n'importe pas `transport/*` en direct (`ARCHITECTURE.md` §2).
 * @property {number} [labelDurationMs] Durée de la bulle de nom d'un badge ; défaut
 *   `SELECTION_STRIP_LABEL_MS`, injectable pour les tests
 */

/**
 * Bande verticale du bord droit, tant qu'un pion est sélectionné : le bouton monter / descendre,
 * puis un badge par marqueur d'état.
 *
 * ## C'est la cinquième dérogation, et son contenu est fixé
 *
 * L'interdiction n°2 de `docs/CONVENTIONS.md` §8 tient toujours : la bande n'existe **que** tant
 * qu'un pion est sélectionné, et ne porte que ce que la dérogation énumère. Un bouton de plus s'y
 * décide comme toute dérogation — il ne s'ajoute pas ici.
 *
 * ## ⚠ Les appuis dans la bande ne touchent pas la carte
 *
 * La bande est un élément DOM **frère** du canvas, et `PointerInput` n'écoute que le canvas : un
 * appui ici ne désélectionne pas, ne déplace rien et ne fait pas défiler la carte.
 *
 * ## ⚠ La bulle de nom vit HORS de la bande
 *
 * La bande défile verticalement (`overflow-y: auto`) au-delà de cinq ou six états, et un conteneur
 * défilant coupe tout ce qui déborde à gauche. La bulle est donc un frère de la bande, positionné
 * en `fixed` d'après le rectangle du badge.
 *
 * @param {HTMLElement} container
 * @param {SelectionStripOptions} options
 */
export function createSelectionStrip(container, options) {
  if (!container) {
    throw new Error('createSelectionStrip : conteneur HTML requis');
  }

  const listeners = new AbortController();
  const labelDurationMs = options.labelDurationMs ?? SELECTION_STRIP_LABEL_MS;

  const bulle = document.createElement('div');
  bulle.className = 'player-selection-label';
  bulle.setAttribute('role', 'status');
  bulle.style.display = 'none';
  (container.parentElement ?? document.body).appendChild(bulle);

  /** @type {ReturnType<typeof setTimeout>|null} */
  let minuterieBulle = null;

  function masquerBulle() {
    if (minuterieBulle !== null) clearTimeout(minuterieBulle);
    minuterieBulle = null;
    bulle.style.display = 'none';
    bulle.textContent = '';
  }

  /**
   * Affiche le nom à gauche du badge, centré sur lui verticalement. Un nouvel appui remplace la
   * bulle et relance la minuterie.
   * @param {HTMLElement} badge
   * @param {string} libelle
   */
  function afficherBulle(badge, libelle) {
    masquerBulle();
    const rect = badge.getBoundingClientRect();
    bulle.textContent = libelle;
    bulle.style.right = `${window.innerWidth - rect.left + 8}px`;
    bulle.style.top = `${rect.top + rect.height / 2}px`;
    bulle.style.display = 'block';
    minuterieBulle = setTimeout(masquerBulle, labelDurationMs);
  }

  // Un défilement de la bande éloignerait le badge de sa bulle : elle disparaît plutôt que de
  // désigner le mauvais état.
  container.addEventListener('scroll', masquerBulle, { signal: listeners.signal });

  /**
   * @param {boolean} monte
   * @returns {HTMLButtonElement}
   */
  function creerBoutonMonture(monte) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = monte ? 'player-selection-mount is-mounted' : 'player-selection-mount';
    // Patron du bouton plein écran : le libellé dit l'ACTION, pas l'état — donc pas
    // d'`aria-pressed`, qui ferait lire « Monter à cheval, enfoncé ».
    const libelle = monte ? 'Descendre de cheval' : 'Monter à cheval';
    btn.setAttribute('aria-label', libelle);
    btn.title = libelle;
    const img = document.createElement('img');
    img.src = MOUNTED_ICON_URL;
    img.alt = '';
    btn.appendChild(img);
    btn.addEventListener(
      'click',
      () => {
        // Le pion est relu à l'appui : celui d'une reconstruction antérieure peut avoir changé.
        const token = options.getSelectedToken();
        if (!token || !isPlayerManipulableToken(token)) return;
        options.onToggleMounted(token);
      },
      { signal: listeners.signal }
    );
    return btn;
  }

  /**
   * @param {import('../../core/constants.js').StatusMarker} id
   * @returns {HTMLButtonElement}
   */
  function creerBadge(id) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'player-selection-badge';
    btn.dataset.marker = id;
    const libelle = STATUS_MARKER_LABEL_FR[id];
    btn.setAttribute('aria-label', libelle);
    const img = document.createElement('img');
    img.src = `assets/icons/status/${id}.svg`;
    img.alt = '';
    btn.appendChild(img);
    btn.addEventListener('click', () => afficherBulle(btn, libelle), {
      signal: listeners.signal,
    });
    return btn;
  }

  /**
   * Reconstruit la bande depuis le pion sélectionné.
   *
   * ⚠ Ne reconstruit que si l'identifiant, la monture ou les marqueurs ont changé : `update` est
   * appelé à chaque notification du store, y compris pendant l'animation d'un déplacement.
   */
  function update() {
    const token = options.getSelectedToken();
    if (!token || !isPlayerManipulableToken(token)) {
      container.style.display = 'none';
      delete container.dataset.signature;
      masquerBulle();
      return;
    }
    container.style.display = 'flex';

    const monte = token.mounted === true;
    // Ordre canonique de `STATUS_MARKER_IDS`, quel que soit l'ordre du tableau du pion.
    const marqueurs = STATUS_MARKER_IDS.filter((id) => token.markers.includes(id));
    const signature = JSON.stringify([token.id, monte, marqueurs]);
    if (container.dataset.signature === signature) return;
    container.dataset.signature = signature;

    masquerBulle();
    container.replaceChildren(creerBoutonMonture(monte), ...marqueurs.map(creerBadge));
  }

  update();

  return {
    update,
    destroy: () => {
      listeners.abort();
      masquerBulle();
      bulle.remove();
      container.replaceChildren();
    },
  };
}

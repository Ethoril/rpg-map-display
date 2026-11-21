// @ts-check

import {
  HEALTH_STATE_LABEL_FR,
  MOUNTED_ICON_URL,
  SELECTION_STRIP_LABEL_MS,
  STATUS_MARKER_IDS,
  STATUS_MARKER_LABEL_FR,
} from '../../core/constants.js';
import { isPlayerManipulableToken } from '../../input/tokenHit.js';
import { displayImageUrl, isLinkedToken } from '../../core/schema.js';
import { CAMP_FILL, campInitials } from '../../render/layers/tokens.js';

/** @typedef {import('../../core/types.js').Token} Token */

const formatDistance = new Intl.NumberFormat('fr-FR');

/**
 * Options de la bande de sélection de la vue joueurs (chantier C-9).
 *
 * @typedef {Object} SelectionStripOptions
 * @property {() => Token | null} getSelectedToken Pion sélectionné à la tablette
 * @property {() => Token | null} [getInspectedToken] Pion **consulté** (combat du 21/11/2026) :
 *   pion que la tablette ne déplace pas, touché sans sélection ou consulté le temps d'un appui.
 * @property {(from: Token, to: Token) => number|null} [getInspectionDistance] Distance réelle en cases
 * @property {(token: Token) => void} onToggleMounted Bascule monter / descendre. La bande ne
 *   publie rien elle-même : `ui/*` n'importe pas `transport/*` en direct (`ARCHITECTURE.md` §2).
 * @property {number} [labelDurationMs] Durée de la bulle de nom d'un badge ; défaut
 *   `SELECTION_STRIP_LABEL_MS`, injectable pour les tests
 */

/**
 * Bande verticale du bord droit, tant qu'un pion est sélectionné : l'encart du pion (portrait,
 * nom, vitalité), le bouton monter / descendre, puis un badge par marqueur d'état.
 *
 * ## Consultation, en lecture seule (combat du 21/11/2026)
 *
 * Un pion que la tablette ne déplace pas — PNJ, ennemi, PJ bridé — ne se sélectionne pas. Touché,
 * il s'ouvre ici en **consultation** : même encart et mêmes badges, sans bouton. ⛔ Rien de
 * secret : la vitalité d'un PNJ est son état à trois crans (Indemne, Blessé, Mal en point), déjà
 * lisible sur son anneau ; les PV en chiffres ne s'affichent que pour un PJ (CdC, amendement du
 * 06/08/2026 ; contrat de liaison §4).
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
   * @param {boolean} lie pion piloté par l'outil MJ : la bascule s'y fait (contrat de liaison §8.2)
   * @returns {HTMLButtonElement}
   */
  function creerBoutonMonture(monte, lie) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = monte ? 'player-selection-mount is-mounted' : 'player-selection-mount';
    // Patron du bouton plein écran : le libellé dit l'ACTION, pas l'état — donc pas
    // d'`aria-pressed`, qui ferait lire « Monter à cheval, enfoncé ».
    const libelle = monte ? 'Descendre de cheval' : 'Monter à cheval';
    btn.setAttribute('aria-label', libelle);
    btn.title = lie ? 'Géré par l’outil MJ' : libelle;
    btn.disabled = lie;
    const img = document.createElement('img');
    img.src = MOUNTED_ICON_URL;
    img.alt = '';
    btn.appendChild(img);
    btn.addEventListener(
      'click',
      () => {
        // Le pion est relu à l'appui : celui d'une reconstruction antérieure peut avoir changé.
        const token = options.getSelectedToken();
        if (!token || !isPlayerManipulableToken(token) || isLinkedToken(token)) return;
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
   * Vitalité affichable aux joueurs : PV d'un PJ, état à trois crans de tout autre pion.
   * @param {Token} token
   * @returns {string}
   */
  function vitalite(token) {
    if (token.dead === true) return 'Mort';
    if (token.kind === 'pc') return token.hp ? `PV ${token.hp.current}/${token.hp.max}` : '';
    return HEALTH_STATE_LABEL_FR[token.health] ?? '';
  }

  /**
   * En-tête de l'encart : portrait (ou disque du camp et initiales) et nom, puis la vitalité.
   * @param {Token} token
   * @param {string} image
   * @param {string} vie
   * @param {string} distance
   * @returns {HTMLElement}
   */
  function creerEncart(token, image, vie, distance) {
    const carte = document.createElement('div');
    carte.className = 'player-selection-card';
    const portrait = document.createElement('div');
    portrait.className = 'player-selection-portrait';
    if (token.dead === true) portrait.classList.add('is-dead');
    if (image) {
      const img = document.createElement('img');
      img.src = image;
      img.alt = '';
      portrait.appendChild(img);
    } else {
      portrait.style.background = (token.camp && CAMP_FILL[token.camp]) || '#555d68';
      portrait.textContent = campInitials(token.label);
    }
    const nom = document.createElement('div');
    nom.className = 'player-selection-name';
    nom.textContent = token.label || '';
    carte.append(portrait, nom);
    if (vie) {
      const ligne = document.createElement('div');
      ligne.className = 'player-selection-vitality';
      ligne.textContent = vie;
      carte.appendChild(ligne);
    }
    if (distance) {
      const ligne = document.createElement('div');
      ligne.className = 'player-selection-distance';
      ligne.textContent = distance;
      carte.appendChild(ligne);
    }
    return carte;
  }

  /**
   * Reconstruit la bande depuis le pion sélectionné, à défaut le pion consulté.
   *
   * ⚠ Ne reconstruit que si l'identifiant, la monture ou les marqueurs ont changé : `update` est
   * appelé à chaque notification du store, y compris pendant l'animation d'un déplacement.
   */
  function update() {
    const selectionne = options.getSelectedToken();
    const consulte = options.getInspectedToken?.() ?? null;
    const enSelection = !consulte && !!selectionne && isPlayerManipulableToken(selectionne);
    const token = consulte ?? (enSelection ? selectionne : null);
    if (!token) {
      container.style.display = 'none';
      delete container.dataset.signature;
      delete container.dataset.mode;
      masquerBulle();
      return;
    }
    container.style.display = 'flex';

    const monte = token.mounted === true;
    // Ordre canonique de `STATUS_MARKER_IDS`, quel que soit l'ordre du tableau du pion.
    const marqueurs = STATUS_MARKER_IDS.filter((id) => token.markers.includes(id));
    const lie = isLinkedToken(token);
    const image = displayImageUrl(token).trim();
    const vie = vitalite(token);
    const cases = consulte && selectionne ? options.getInspectionDistance?.(selectionne, consulte) : null;
    const nomReference = selectionne?.label || 'ton personnage';
    const reference = /^[aeiouy]/i.test(nomReference.normalize('NFD')) ? `d’${nomReference}` : `de ${nomReference}`;
    const distance = typeof cases === 'number' && Number.isFinite(cases) && selectionne
      ? `À ${formatDistance.format(cases)} ${cases <= 1 ? 'case' : 'cases'} ${reference}` : '';
    const mode = enSelection ? 'selection' : 'consultation';
    const signature = JSON.stringify([mode, token.id, monte, lie, marqueurs, token.label, image, vie, distance, token.camp ?? null]);
    if (container.dataset.signature === signature) return;
    container.dataset.signature = signature;
    container.dataset.mode = mode;

    masquerBulle();
    // ⛔ En consultation, aucun bouton : la tablette ne touche pas à ce pion.
    container.replaceChildren(
      creerEncart(token, image, vie, distance),
      ...(enSelection ? [creerBoutonMonture(monte, lie)] : []),
      ...marqueurs.map(creerBadge)
    );
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

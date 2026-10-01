// @ts-check
import { validateTokenCatalog, createTokenFromLibraryEntry } from '../../import/tokenCatalog.js';
import * as store from '../../state/store.js';

/**
 * @typedef {import('../../core/types.js').TokenLibraryEntry} TokenLibraryEntry
 * @typedef {import('../../core/types.js').Token} Token
 */

/**
 * Options du composant tokenLibrary
 * @typedef {Object} TokenLibraryOptions
 * @property {(token: Token) => void} [onArmPlacement] Rappel armant la pose du pion fabriqué
 *   (UX-08/UX-14) — le composant ne l'ajoute plus lui-même à la campagne. Optionnel : un appelant
 *   qui ne le fournit pas ne voit rien s'armer.
 * @property {string} [catalogUrl='maps/tokens/catalog.json'] URL relative du catalogue de pions
 */

/**
 * Monte la bibliothèque de pions pré-réglés.
 *
 * Charge `maps/tokens/catalog.json`, affiche les pions disponibles et permet au MJ d'ARMER la
 * pose d'un pion pré-réglé (UX-08/UX-14) — sans saisie de métadonnées, mais sans l'ajouter non
 * plus : la case reste à taper.
 *
 * @param {HTMLElement} container Élément HTML conteneur
 * @param {TokenLibraryOptions} [options={}]
 * @returns {Promise<{destroy: () => void}>}
 */
export async function createTokenLibrary(container, options = {}) {
  if (!container) {
    throw new Error('createTokenLibrary : conteneur HTML requis');
  }

  const { onArmPlacement, catalogUrl = 'maps/tokens/catalog.json' } = options;
  const listeners = new AbortController();

  container.innerHTML = `
    <div class="token-library gm-stack">
      <div class="token-library-status gm-status gm-muted">
        Chargement du catalogue de pions…
      </div>
      <div class="token-library-list gm-stack"></div>
    </div>
  `;

  const statusEl = /** @type {HTMLElement} */ (container.querySelector('.token-library-status'));
  const listEl = /** @type {HTMLElement} */ (container.querySelector('.token-library-list'));

  /**
   * Affiche un message d'état dans le composant.
   *
   * @param {'info'|'ok'|'error'} kind
   * @param {string} message
   */
  function setStatus(kind, message) {
    statusEl.classList.remove('gm-ok', 'gm-err', 'gm-muted');
    statusEl.classList.add(kind === 'ok' ? 'gm-ok' : kind === 'error' ? 'gm-err' : 'gm-muted');
    statusEl.textContent = message;
  }

  /**
   * Fabrique le pion depuis l'entrée du catalogue et ARME sa pose (UX-08/UX-14), au lieu de
   * l'ajouter directement sur l'étage actif : c'est `placePendingTokenAt` du panneau qui publiera
   * `token.add`, une fois la case connue.
   *
   * @param {TokenLibraryEntry} entry
   */
  function handleInstantiateToken(entry) {
    const activeLevelId = store.getActiveLevelId();
    if (!activeLevelId) {
      setStatus('error', `✗ Instanciation impossible : aucun étage actif dans la campagne.`);
      return;
    }

    if (!onArmPlacement) {
      setStatus('error', `✗ Impossible d'instancier « ${entry.name} » : composant non configuré pour armer la pose.`);
      return;
    }

    try {
      const token = createTokenFromLibraryEntry(entry, { levelId: activeLevelId });
      onArmPlacement(token);
      setStatus('ok', `✓ « ${entry.name} » prêt : tapez la carte pour le poser.`);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setStatus('error', `✗ Impossible d'instancier « ${entry.name} » : ${errMsg}`);
    }
  }

  /**
   * Rendu de la carte d'un pion.
   *
   * @param {TokenLibraryEntry} entry
   * @returns {HTMLElement}
   */
  function renderTokenCard(entry) {
    const card = document.createElement('div');
    card.className = 'token-card gm-section gm-stack';
    card.dataset.tokenId = entry.id;

    const topRow = document.createElement('div');
    topRow.className = 'gm-row';
    topRow.style.flexWrap = 'nowrap';

    const img = document.createElement('img');
    img.className = 'token-card-image';
    img.src = entry.imageUrl;
    img.alt = entry.name;
    img.style.width = '48px';
    img.style.height = '48px';
    img.style.objectFit = 'cover';
    img.style.borderRadius = '50%';
    img.style.border = `2px solid ${entry.borderColor || 'var(--gm-trait-fort)'}`;

    const infoCol = document.createElement('div');
    infoCol.style.flex = '1';

    const titleEl = document.createElement('h4');
    titleEl.className = 'token-card-name gm-title';
    titleEl.textContent = entry.name;
    titleEl.style.margin = '0 0 4px';

    const metaEl = document.createElement('div');
    metaEl.className = 'token-card-meta gm-muted';
    metaEl.textContent = `${entry.kind.toUpperCase()} • Taille: ${entry.sizeCells} case(s) • Vit: ${entry.speedCells} case(s)`;

    infoCol.append(titleEl, metaEl);
    topRow.append(img, infoCol);

    const btnInstantiate = document.createElement('button');
    btnInstantiate.className = 'token-card-instantiate gm-btn--sm gm-btn--primary';
    btnInstantiate.textContent = 'Instancier';

    btnInstantiate.addEventListener(
      'click',
      () => {
        handleInstantiateToken(entry);
      },
      { signal: listeners.signal }
    );

    card.append(topRow, btnInstantiate);
    return card;
  }

  // Chargement du catalogue
  try {
    const response = await fetch(catalogUrl, { cache: 'no-cache' });
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText} en chargeant ${catalogUrl}`);
    }

    const data = await response.json();
    const errors = validateTokenCatalog(data);
    if (errors.length > 0) {
      throw new Error(`Catalogue invalide — ${errors.join(' ; ')}`);
    }

    if (data.tokens.length === 0) {
      setStatus('info', 'Aucun pion disponible dans la bibliothèque.');
      return { destroy: () => listeners.abort() };
    }

    setStatus('ok', `✓ ${data.tokens.length} pion(s) disponible(s)`);
    for (const entry of data.tokens) {
      listEl.appendChild(renderTokenCard(entry));
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    setStatus('error', `✗ Bibliothèque indisponible : ${errMsg}`);
    listEl.replaceChildren();
  }

  return {
    destroy: () => {
      listeners.abort();
    },
  };
}

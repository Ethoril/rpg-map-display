// @ts-check
import { validateTokenCatalog, createTokenFromLibraryEntry } from '../../import/tokenCatalog.js';
import * as store from '../../state/store.js';

/**
 * @typedef {import('../../transport/Transport.js').Transport} Transport
 * @typedef {import('../../core/types.js').TokenLibraryEntry} TokenLibraryEntry
 */

/**
 * Options du composant tokenLibrary
 * @typedef {Object} TokenLibraryOptions
 * @property {Transport} [transport] Transport optionnel pour la synchronisation
 * @property {string} [catalogUrl='maps/tokens/catalog.json'] URL relative du catalogue de pions
 */

/**
 * Monte la bibliothèque de pions pré-réglés.
 *
 * Charge `maps/tokens/catalog.json`, affiche les pions disponibles et permet au MJ
 * d'instancier un pion pré-réglé sur l'étage actif sans saisie de métadonnées.
 *
 * @param {HTMLElement} container Élément HTML conteneur
 * @param {TokenLibraryOptions} [options={}]
 * @returns {Promise<{destroy: () => void}>}
 */
export async function createTokenLibrary(container, options = {}) {
  if (!container) {
    throw new Error('createTokenLibrary : conteneur HTML requis');
  }

  const { transport, catalogUrl = 'maps/tokens/catalog.json' } = options;
  const listeners = new AbortController();

  container.innerHTML = `
    <div class="token-library" style="display: flex; flex-direction: column; gap: 1rem;">
      <div class="token-library-status" style="padding: 0.75rem; background: #252525; border-radius: 4px; border: 1px solid #333; color: #aaa; text-align: center; font-size: 0.85rem;">
        Chargement du catalogue de pions…
      </div>
      <div class="token-library-list" style="display: grid; grid-template-columns: 1fr; gap: 0.75rem;"></div>
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
    const palette = {
      info: { background: '#252525', color: '#aaa' },
      ok: { background: '#1a3a2a', color: '#6fb386' },
      error: { background: '#3a1a1a', color: '#e07070' },
    };
    statusEl.style.background = palette[kind].background;
    statusEl.style.color = palette[kind].color;
    statusEl.textContent = message;
  }

  /**
   * Instancie un pion sur l'étage actif.
   *
   * @param {TokenLibraryEntry} entry
   * @param {HTMLButtonElement} btn
   */
  function handleInstantiateToken(entry, btn) {
    const activeLevelId = store.getActiveLevelId();
    if (!activeLevelId) {
      setStatus('error', `✗ Instanciation impossible : aucun étage actif dans la campagne.`);
      return;
    }

    const originalText = btn.textContent;
    btn.disabled = true;

    try {
      const token = createTokenFromLibraryEntry(entry, { levelId: activeLevelId });
      store.addToken(token);

      if (transport) {
        transport.publish({
          type: 'token.add',
          payload: { token },
          at: Date.now(),
          by: 'gm',
        });
      }

      setStatus('ok', `✓ Pion « ${entry.name} » instancié sur l'étage actif`);
      btn.textContent = '✓ Fait';
      btn.style.background = '#2a5a3a';
      setTimeout(() => {
        btn.textContent = originalText;
        btn.style.background = '#4a90e2';
        btn.disabled = false;
      }, 1200);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setStatus('error', `✗ Impossible d'instancier « ${entry.name} » : ${errMsg}`);
      btn.disabled = false;
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
    card.className = 'token-card';
    card.dataset.tokenId = entry.id;
    card.style.background = '#252525';
    card.style.border = `1px solid ${entry.borderColor || '#333'}`;
    card.style.borderRadius = '4px';
    card.style.padding = '0.75rem';
    card.style.display = 'flex';
    card.style.flexDirection = 'column';
    card.style.gap = '0.5rem';

    const topRow = document.createElement('div');
    topRow.style.display = 'flex';
    topRow.style.alignItems = 'center';
    topRow.style.gap = '0.75rem';

    const img = document.createElement('img');
    img.className = 'token-card-image';
    img.src = entry.imageUrl;
    img.alt = entry.name;
    img.style.width = '48px';
    img.style.height = '48px';
    img.style.objectFit = 'cover';
    img.style.borderRadius = '50%';
    img.style.border = `2px solid ${entry.borderColor || '#888'}`;

    const infoCol = document.createElement('div');
    infoCol.style.flex = '1';

    const titleEl = document.createElement('h4');
    titleEl.className = 'token-card-name';
    titleEl.textContent = entry.name;
    titleEl.style.margin = '0 0 0.25rem 0';
    titleEl.style.fontSize = '0.95rem';
    titleEl.style.color = '#fff';

    const metaEl = document.createElement('div');
    metaEl.className = 'token-card-meta';
    metaEl.style.fontSize = '0.75rem';
    metaEl.style.color = '#aaa';
    metaEl.textContent = `${entry.kind.toUpperCase()} • Taille: ${entry.sizeCells} case(s) • Vit: ${entry.speedCells} case(s)`;

    infoCol.append(titleEl, metaEl);
    topRow.append(img, infoCol);

    const btnInstantiate = document.createElement('button');
    btnInstantiate.className = 'token-card-instantiate';
    btnInstantiate.textContent = '➕ Instancier';
    btnInstantiate.style.padding = '0.4rem 0.6rem';
    btnInstantiate.style.background = '#4a90e2';
    btnInstantiate.style.color = '#fff';
    btnInstantiate.style.border = 'none';
    btnInstantiate.style.borderRadius = '4px';
    btnInstantiate.style.cursor = 'pointer';
    btnInstantiate.style.fontSize = '0.8rem';
    btnInstantiate.style.fontWeight = '500';

    btnInstantiate.addEventListener(
      'click',
      () => {
        handleInstantiateToken(entry, btnInstantiate);
      },
      { signal: listeners.signal }
    );

    card.append(topRow, btnInstantiate);
    return card;
  }

  // Chargement du catalogue
  try {
    const response = await fetch(catalogUrl);
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

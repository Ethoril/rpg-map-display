// @ts-check
import { loadCatalog, resolveMapUrl } from '../../import/catalog.js';
import { validateCampaign, createCampaign } from '../../core/schema.js';
import * as store from '../../state/store.js';

/**
 * @typedef {import('../../transport/Transport.js').Transport} Transport
 */

/**
 * Options du composant sceneLibrary
 * @typedef {Object} SceneLibraryOptions
 * @property {Transport} [transport] Transport optionnel pour la synchronisation
 * @property {string} [catalogUrl='maps/catalog.json'] URL relative du catalogue
 */

/**
 * Monte une bibliothèque de cartes préparées.
 * Charge le catalog.json, affiche les cartes, permet le chargement transactionnel.
 *
 * @param {HTMLElement} container Élément HTML conteneur
 * @param {SceneLibraryOptions} [options={}]
 * @returns {Promise<{destroy: () => void}>}
 */
export async function createSceneLibrary(container, options = {}) {
  if (!container) {
    throw new Error('createSceneLibrary : conteneur HTML requis');
  }

  const { transport, catalogUrl = 'maps/catalog.json' } = options;
  const listeners = new AbortController();

  container.innerHTML = `
    <div class="scene-library" style="display: flex; flex-direction: column; gap: 1rem;">
      <div class="scene-library-status" style="padding: 0.75rem; background: #252525; border-radius: 4px; border: 1px solid #333; color: #aaa; text-align: center;">
        Chargement du catalogue…
      </div>
      <div class="scene-library-list" style="display: grid; grid-template-columns: 1fr; gap: 0.75rem;"></div>
    </div>
  `;

  const statusEl = /** @type {HTMLElement} */ (container.querySelector('.scene-library-status'));
  const listEl = /** @type {HTMLElement} */ (container.querySelector('.scene-library-list'));

  try {
    const catalog = await loadCatalog(catalogUrl);

    if (!catalog.maps || catalog.maps.length === 0) {
      statusEl.style.background = '#252525';
      statusEl.style.color = '#aaa';
      statusEl.textContent = 'Aucune carte disponible. Préparez des fichiers .uvtt avec `pnpm maps:prepare`.';
      return { destroy: () => listeners.abort() };
    }

    statusEl.style.background = '#1a3a2a';
    statusEl.style.color = '#6fb386';
    statusEl.textContent = `✓ ${catalog.maps.length} carte(s) disponible(s)`;

    // Afficher chaque carte
    for (const mapEntry of catalog.maps) {
      const mapCard = document.createElement('div');
      mapCard.className = 'scene-card';
      mapCard.style.background = '#252525';
      mapCard.style.border = '1px solid #333';
      mapCard.style.borderRadius = '4px';
      mapCard.style.padding = '1rem';
      mapCard.style.display = 'flex';
      mapCard.style.flexDirection = 'column';
      mapCard.style.gap = '0.75rem';
      mapCard.style.cursor = 'pointer';
      mapCard.style.transition = 'border-color 0.2s';

      mapCard.addEventListener('mouseenter', () => {
        mapCard.style.borderColor = '#4a90e2';
      });

      mapCard.addEventListener('mouseleave', () => {
        mapCard.style.borderColor = '#333';
      });

      // En-tête : nom et compteurs
      const header = document.createElement('div');
      header.style.display = 'flex';
      header.style.alignItems = 'center';
      header.style.justifyContent = 'space-between';
      header.style.paddingBottom = '0.5rem';
      header.style.borderBottom = '1px solid #333';

      const nameEl = document.createElement('h3');
      nameEl.textContent = mapEntry.name;
      nameEl.style.margin = '0';
      nameEl.style.fontSize = '1rem';
      nameEl.style.color = '#fff';

      const countersEl = document.createElement('div');
      countersEl.style.display = 'flex';
      countersEl.style.gap = '1rem';
      countersEl.style.fontSize = '0.8rem';
      countersEl.style.color = '#aaa';

      const feats = mapEntry.features;
      countersEl.innerHTML = `
        <span title="Murs">🧱 ${feats.walls}</span>
        <span title="Portes">🚪 ${feats.portals}</span>
        <span title="Lumières">💡 ${feats.lights}</span>
        ${feats.bakedLighting ? '<span title="Éclairage cuit">✨</span>' : ''}
      `;

      header.appendChild(nameEl);
      header.appendChild(countersEl);
      mapCard.appendChild(header);

      // Boutons d'action
      const actions = document.createElement('div');
      actions.style.display = 'flex';
      actions.style.gap = '0.5rem';
      actions.style.flexWrap = 'wrap';

      const loadBtn = document.createElement('button');
      loadBtn.textContent = '📂 Charger';
      loadBtn.style.flex = '1';
      loadBtn.style.minWidth = '120px';
      loadBtn.style.padding = '0.5rem';
      loadBtn.style.background = '#4a90e2';
      loadBtn.style.color = '#fff';
      loadBtn.style.border = 'none';
      loadBtn.style.borderRadius = '4px';
      loadBtn.style.cursor = 'pointer';
      loadBtn.style.fontSize = '0.85rem';
      loadBtn.style.fontWeight = '500';

      loadBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleLoadScene(mapEntry, 'load');
      });

      const addBtn = document.createElement('button');
      addBtn.textContent = '➕ Ajouter étage';
      addBtn.style.flex = '1';
      addBtn.style.minWidth = '120px';
      addBtn.style.padding = '0.5rem';
      addBtn.style.background = '#6a6a6a';
      addBtn.style.color = '#fff';
      addBtn.style.border = 'none';
      addBtn.style.borderRadius = '4px';
      addBtn.style.cursor = 'pointer';
      addBtn.style.fontSize = '0.85rem';
      addBtn.style.fontWeight = '500';

      addBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleLoadScene(mapEntry, 'add');
      });

      actions.appendChild(loadBtn);
      actions.appendChild(addBtn);
      mapCard.appendChild(actions);

      listEl.appendChild(mapCard);
    }

    /**
     * Charge ou ajoute une scène depuis le catalogue.
     * Charge la scène JSON, valide, puis met à jour le store et publié via transport.
     */
    async function handleLoadScene(mapEntry, mode) {
      try {
        loadBtn.disabled = true;
        addBtn.disabled = true;

        const sceneUrl = resolveMapUrl(mapEntry.sceneUrl);
        const imageUrl = resolveMapUrl(mapEntry.imageUrl);

        // Charger la scène JSON
        const response = await fetch(sceneUrl);
        if (!response.ok) {
          throw new Error(`Erreur ${response.status} en chargeant ${mapEntry.sceneUrl}`);
        }

        const sceneData = await response.json();

        // Valider la scène
        const errors = validateCampaign(sceneData);
        if (errors.length > 0) {
          throw new Error(`Scène invalide : ${errors.join('; ')}`);
        }

        // Mettre à jour les imageUrl pour qu'elles soient absolues (résolues par rapport au catalogue)
        if (sceneData.levels && sceneData.levels.length > 0) {
          // Le premier niveau utilise l'imageUrl du catalogue
          sceneData.levels[0].imageUrl = imageUrl;
        }

        // Ajouter ou charger selon le mode
        if (mode === 'load') {
          // Remplacer la campagne entière
          store.loadCampaign(sceneData);
        } else if (mode === 'add') {
          // Ajouter chaque étage à la campagne courante
          if (sceneData.levels) {
            for (const level of sceneData.levels) {
              store.addLevel(level);
            }
          }
        }

        // Publier via transport si disponible
        if (transport) {
          transport.publish({
            type: mode === 'load' ? 'campaign.load' : 'level.add',
            payload:
              mode === 'load'
                ? { campaign: sceneData }
                : { levels: sceneData.levels },
            at: Date.now(),
            by: 'gm',
          });
        }

        // Feedback visuel
        const origText = mode === 'load' ? loadBtn.textContent : addBtn.textContent;
        const btn = mode === 'load' ? loadBtn : addBtn;
        btn.textContent = '✓ Fait !';
        btn.style.background = '#2a5a3a';
        setTimeout(() => {
          btn.textContent = origText;
          btn.style.background = mode === 'load' ? '#4a90e2' : '#6a6a6a';
          loadBtn.disabled = false;
          addBtn.disabled = false;
        }, 1500);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        alert(`Erreur en chargeant "${mapEntry.name}" :\n${errMsg}`);
        loadBtn.disabled = false;
        addBtn.disabled = false;
      }
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    statusEl.style.background = '#3a1a1a';
    statusEl.style.color = '#e07070';
    statusEl.textContent = `✗ Erreur : ${errMsg}`;
    listEl.innerHTML = '';
  }

  return {
    destroy: () => {
      listeners.abort();
    },
  };
}

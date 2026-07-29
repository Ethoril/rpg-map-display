// @ts-check
import { createImportPanel } from './importPanel.js';
import { createTokenMaker } from './tokenMaker.js';
import { VERSION } from '../../core/version.js';
import { mountGMVersionBadge } from '../versionBadge.js';
import * as store from '../../state/store.js';

/**
 * @typedef {import('../../transport/Transport.js').Transport} Transport
 */

/**
 * Options d'initialisation du panneau MJ.
 * @typedef {Object} GMPanelOptions
 * @property {Transport} [transport] Transport réseau optionnel pour la synchronisation
 */

/**
 * Monte le panneau latéral complet de la vue MJ.
 *
 * @param {HTMLElement} container Élément HTML conteneur
 * @param {GMPanelOptions} [options]
 */
export function createGMPanel(container, options = {}) {
  if (!container) {
    throw new Error('createGMPanel : conteneur HTML requis');
  }

  const { transport } = options;

  container.className = 'gm-panel-root';
  container.style.display = 'flex';
  container.style.flexDirection = 'column';
  container.style.height = '100%';
  container.style.background = '#1e1e1e';
  container.style.color = '#eee';
  container.style.fontFamily = 'system-ui, sans-serif';

  container.innerHTML = `
    <!-- Barre d'onglets du panneau MJ -->
    <div class="gm-tabs-header" style="display: flex; background: #2a2a2a; border-bottom: 1px solid #333;">
      <button class="gm-tab-btn active" data-tab="import-uvtt" style="flex: 1; padding: 0.6rem 0.25rem; font-size: 0.8rem; background: #333; color: #fff; border: none; border-bottom: 2px solid #4a90e2; cursor: pointer;">UVTT</button>
      <button class="gm-tab-btn" data-tab="import-image" style="flex: 1; padding: 0.6rem 0.25rem; font-size: 0.8rem; background: #2a2a2a; color: #aaa; border: none; border-bottom: 2px solid transparent; cursor: pointer;">Image</button>
      <button class="gm-tab-btn" data-tab="token-maker" style="flex: 1; padding: 0.6rem 0.25rem; font-size: 0.8rem; background: #2a2a2a; color: #aaa; border: none; border-bottom: 2px solid transparent; cursor: pointer;">Pions</button>
      <button class="gm-tab-btn" data-tab="grid-settings" style="flex: 1; padding: 0.6rem 0.25rem; font-size: 0.8rem; background: #2a2a2a; color: #aaa; border: none; border-bottom: 2px solid transparent; cursor: pointer;">Grille</button>
    </div>

    <!-- Conteneurs de contenu des onglets -->
    <div class="gm-tabs-content" style="flex: 1; overflow-y: auto; padding: 1rem;">
      <div id="tab-content-import-uvtt" class="gm-tab-pane" style="display: block;">
        <div id="import-uvtt-mount"></div>
      </div>

      <div id="tab-content-import-image" class="gm-tab-pane" style="display: none;">
        <div id="import-image-mount"></div>
      </div>

      <div id="tab-content-token-maker" class="gm-tab-pane" style="display: none;">
        <div id="token-maker-mount"></div>
      </div>

      <div id="tab-content-grid-settings" class="gm-tab-pane" style="display: none;">
        <div class="grid-settings-form" style="display: flex; flex-direction: column; gap: 1rem; background: #252525; padding: 1rem; border-radius: 6px; border: 1px solid #333;">
          <h3 style="margin: 0 0 0.5rem 0; font-size: 1rem; color: #4a90e2;">Réglages de la Grille</h3>

          <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer;">
            <input type="checkbox" id="grid-visible" checked />
            <span>Grille visible</span>
          </label>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; align-items: center;">
            <label for="grid-type">Type de grille :</label>
            <select id="grid-type">
              <option value="square">Carrée (Square)</option>
              <option value="hex">Hexagonale (Hex)</option>
            </select>

            <label for="grid-color">Couleur :</label>
            <input type="color" id="grid-color" value="#000000" />

            <label for="grid-opacity">Opacité (<span id="grid-opacity-val">0.25</span>) :</label>
            <input type="range" id="grid-opacity" min="0" max="1" step="0.05" value="0.25" />
          </div>
        </div>
      </div>
    </div>

    <!-- Pied de panneau : Affichage de la version -->
    <div class="gm-panel-footer" style="padding: 0.5rem 1rem; background: #181818; border-top: 1px solid #333; font-size: 0.75rem; color: #777; text-align: center;"></div>
  `;

  const footerEl = /** @type {HTMLElement} */ (container.querySelector('.gm-panel-footer'));
  if (footerEl) {
    mountGMVersionBadge(footerEl, { transport, role: 'gm' });
  }

  // --- Gestion de la navigation par onglets ---
  const tabButtons = container.querySelectorAll('.gm-tab-btn');
  const tabPanes = container.querySelectorAll('.gm-tab-pane');

  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-tab');
      tabButtons.forEach((b) => {
        const isTarget = b === btn;
        /** @type {HTMLElement} */ (b).style.background = isTarget ? '#333' : '#2a2a2a';
        /** @type {HTMLElement} */ (b).style.color = isTarget ? '#fff' : '#aaa';
        /** @type {HTMLElement} */ (b).style.borderBottomColor = isTarget ? '#4a90e2' : 'transparent';
        if (isTarget) b.classList.add('active');
        else b.classList.remove('active');
      });

      tabPanes.forEach((pane) => {
        const paneId = pane.id;
        if (paneId === `tab-content-${targetTab}`) {
          /** @type {HTMLElement} */ (pane).style.display = 'block';
        } else {
          /** @type {HTMLElement} */ (pane).style.display = 'none';
        }
      });
    });
  });

  // --- Montage des sous-composants ---
  const uvttMount = /** @type {HTMLElement} */ (container.querySelector('#import-uvtt-mount'));
  const imageMount = /** @type {HTMLElement} */ (container.querySelector('#import-image-mount'));
  const tokenMakerMount = /** @type {HTMLElement} */ (container.querySelector('#token-maker-mount'));

  // Initialisation des panneaux d'import UVTT et Image
  createImportPanel(uvttMount, {
    mode: 'uvtt',
    onImportUvtt: (result) => {
      if (transport) {
        transport.publish({
          type: 'level.add',
          payload: { level: result.level },
          at: Date.now(),
          by: 'gm',
        });
      }
    },
  });

  createImportPanel(imageMount, {
    mode: 'image',
    onImportImage: (level) => {
      if (transport) {
        transport.publish({
          type: 'level.add',
          payload: { level },
          at: Date.now(),
          by: 'gm',
        });
      }
    },
  });

  // Initialisation du générateur de pions avec ajout direct au store lors de la génération
  const tokenMaker = createTokenMaker(tokenMakerMount, {
    onGenerate: (token, _dataUrl) => {
      // Ajout automatique du pion généré au store
      store.addToken(token);

      // Envoi sur le réseau si transport disponible
      if (transport) {
        transport.publish({
          type: 'token.add',
          payload: { token },
          at: Date.now(),
          by: 'gm',
        });
      }
    },
  });

  // --- Réglages de la grille ---
  const gridVisibleInput = /** @type {HTMLInputElement} */ (container.querySelector('#grid-visible'));
  const gridTypeSelect = /** @type {HTMLSelectElement} */ (container.querySelector('#grid-type'));
  const gridColorInput = /** @type {HTMLInputElement} */ (container.querySelector('#grid-color'));
  const gridOpacityInput = /** @type {HTMLInputElement} */ (container.querySelector('#grid-opacity'));
  const gridOpacityVal = /** @type {HTMLElement} */ (container.querySelector('#grid-opacity-val'));

  function updateGridFromUI() {
    const visible = gridVisibleInput.checked;
    const type = /** @type {import('../../core/types.js').GridType} */ (gridTypeSelect.value === 'hex' ? 'hex' : 'square');
    const color = gridColorInput.value;
    const opacity = parseFloat(gridOpacityInput.value);

    gridOpacityVal.textContent = String(opacity);

    const activeLvl = store.getActiveLevel();
    const gridConfig = {
      visible,
      type,
      color,
      opacity,
      offsetX: activeLvl?.grid?.offsetX ?? 0,
      offsetY: activeLvl?.grid?.offsetY ?? 0,
    };

    store.updateActiveLevel({ grid: gridConfig });

    const activeLevel = store.getActiveLevel();
    if (transport && activeLevel) {
      transport.publish({
        type: 'level.grid',
        payload: {
          levelId: activeLevel.id,
          grid: gridConfig,
        },
        at: Date.now(),
        by: 'gm',
      });
    }
  }

  gridVisibleInput.addEventListener('change', updateGridFromUI);
  gridTypeSelect.addEventListener('change', updateGridFromUI);
  gridColorInput.addEventListener('input', updateGridFromUI);
  gridOpacityInput.addEventListener('input', updateGridFromUI);

  // Synchronisation initiale des champs de grille depuis le store si un étage est présent
  const activeLvl = store.getActiveLevel();
  if (activeLvl && activeLvl.grid) {
    gridVisibleInput.checked = activeLvl.grid.visible ?? true;
    gridTypeSelect.value = activeLvl.grid.type || 'square';
    gridColorInput.value = activeLvl.grid.color || '#000000';
    gridOpacityInput.value = String(activeLvl.grid.opacity ?? 0.25);
    gridOpacityVal.textContent = String(activeLvl.grid.opacity ?? 0.25);
  }

  // Écouter les changements dans le store pour mettre à jour les inputs de grille si besoin
  store.subscribe(() => {
    const currentLvl = store.getActiveLevel();
    if (currentLvl && currentLvl.grid) {
      gridVisibleInput.checked = currentLvl.grid.visible ?? true;
      gridTypeSelect.value = currentLvl.grid.type || 'square';
      gridColorInput.value = currentLvl.grid.color || '#000000';
      gridOpacityInput.value = String(currentLvl.grid.opacity ?? 0.25);
      gridOpacityVal.textContent = String(currentLvl.grid.opacity ?? 0.25);
    }
  });

  return {
    tokenMaker,
  };
}

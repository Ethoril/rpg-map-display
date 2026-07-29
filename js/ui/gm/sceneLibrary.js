// @ts-check
import { loadCatalog } from '../../import/catalog.js';
import { validateCampaign } from '../../core/schema.js';
import * as store from '../../state/store.js';

/**
 * @typedef {import('../../transport/Transport.js').Transport} Transport
 * @typedef {import('../../import/catalog.js').CatalogMap} CatalogMap
 */

/**
 * Options du composant sceneLibrary
 * @typedef {Object} SceneLibraryOptions
 * @property {Transport} [transport] Transport optionnel pour la synchronisation
 * @property {string} [catalogUrl='maps/catalog.json'] URL relative du catalogue
 */

/**
 * Monte une bibliothèque de cartes préparées.
 *
 * Charge `maps/catalog.json`, affiche les cartes disponibles et permet de
 * charger une scène préparée sans qu'aucune URL ne soit saisie par le MJ.
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

  /**
   * Affiche un message d'état dans le panneau. Les erreurs doivent rester
   * visibles dans l'interface (plan §7) et non dans la seule console.
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
   * Charge une scène préparée dans le store, de façon transactionnelle.
   *
   * Les URLs du catalogue restent RELATIVES : le navigateur les résout par
   * rapport au document, ce qui fonctionne aussi sous un sous-chemin.
   *
   * @param {CatalogMap} mapEntry
   * @param {'load'|'add'} mode
   * @param {HTMLButtonElement} loadBtn
   * @param {HTMLButtonElement} addBtn
   */
  async function handleLoadScene(mapEntry, mode, loadBtn, addBtn) {
    const btn = mode === 'load' ? loadBtn : addBtn;
    const originalLabel = btn.textContent;
    const originalBackground = btn.style.background;

    loadBtn.disabled = true;
    addBtn.disabled = true;

    try {
      const response = await fetch(mapEntry.sceneUrl);
      if (!response.ok) {
        throw new Error(
          `${response.status} ${response.statusText} en chargeant ${mapEntry.sceneUrl}`
        );
      }

      const sceneData = await response.json();

      // Valider AVANT toute mutation du store (plan §7.2)
      const errors = validateCampaign(sceneData);
      if (errors.length > 0) {
        throw new Error(`scène invalide — ${errors.join(' ; ')}`);
      }

      // Vérifier la cohérence scène/catalogue (plan §7.3). Un écart signale des
      // artefacts non régénérés : on le signale au lieu de l'écraser en silence.
      const sceneImageUrl = sceneData.levels?.[0]?.imageUrl;
      if (sceneImageUrl !== mapEntry.imageUrl) {
        throw new Error(
          `incohérence d'artefacts — la scène référence "${sceneImageUrl}" ` +
            `alors que le catalogue annonce "${mapEntry.imageUrl}". ` +
            'Relancez `pnpm maps:prepare`.'
        );
      }

      if (mode === 'load') {
        store.loadCampaign(sceneData);
      } else {
        for (const level of sceneData.levels) {
          store.addLevel(level);
        }
      }

      // Synchronisation joueurs (U-05). Les deux modes ne diffusent pas la même
      // chose parce qu'ils ne font pas la même chose côté MJ :
      //   — « Charger » *remplace* la campagne. Seul un instantané absolu
      //     propage aussi la disparition des étages précédents, qu'une suite de
      //     `level.add` ne peut pas exprimer.
      //   — « Ajouter comme étage » est additif : un `level.add` par étage, au
      //     format attendu par js/app/networkEvents.js (`{ level }` au singulier).
      //
      // `scene.load` est le type du cahier des charges §7 ; rien n'est inventé.
      // Le payload ne porte que l'état non recalculable (CONVENTIONS §4) : ni
      // étage actif dérivé, ni cases atteignables, ni pion sélectionné résolu.
      if (transport) {
        if (mode === 'load') {
          transport.publish({
            type: 'scene.load',
            payload: {
              campaign: store.getCampaign(),
              activeLevelId: store.getActiveLevelId(),
              selectedTokenId: null,
            },
            at: Date.now(),
            by: 'gm',
          });
        } else {
          for (const level of sceneData.levels) {
            transport.publish({
              type: 'level.add',
              payload: { level },
              at: Date.now(),
              by: 'gm',
            });
          }
        }
      }

      setStatus(
        'ok',
        mode === 'load'
          ? `✓ « ${mapEntry.name} » chargée — ${mapEntry.features.walls} murs, ${mapEntry.features.portals} portes`
          : `✓ « ${mapEntry.name} » ajoutée comme étage`
      );

      btn.textContent = '✓ Fait';
      btn.style.background = '#2a5a3a';
      setTimeout(() => {
        btn.textContent = originalLabel;
        btn.style.background = originalBackground;
      }, 1500);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setStatus('error', `✗ « ${mapEntry.name} » non chargée : ${errMsg}`);
    } finally {
      loadBtn.disabled = false;
      addBtn.disabled = false;
    }
  }

  /**
   * Construit la carte d'une entrée du catalogue.
   *
   * @param {CatalogMap} mapEntry
   * @returns {HTMLElement}
   */
  function renderMapCard(mapEntry) {
    const mapCard = document.createElement('div');
    mapCard.className = 'scene-card';
    mapCard.dataset.mapId = mapEntry.id;
    mapCard.style.background = '#252525';
    mapCard.style.border = '1px solid #333';
    mapCard.style.borderRadius = '4px';
    mapCard.style.padding = '1rem';
    mapCard.style.display = 'flex';
    mapCard.style.flexDirection = 'column';
    mapCard.style.gap = '0.75rem';

    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.style.justifyContent = 'space-between';
    header.style.paddingBottom = '0.5rem';
    header.style.borderBottom = '1px solid #333';

    const nameEl = document.createElement('h3');
    nameEl.className = 'scene-card-name';
    nameEl.textContent = mapEntry.name;
    nameEl.style.margin = '0';
    nameEl.style.fontSize = '1rem';
    nameEl.style.color = '#fff';

    const countersEl = document.createElement('div');
    countersEl.className = 'scene-card-counters';
    countersEl.style.display = 'flex';
    countersEl.style.gap = '0.75rem';
    countersEl.style.fontSize = '0.8rem';
    countersEl.style.color = '#aaa';

    const feats = mapEntry.features;
    const counters = [
      { label: 'Murs', icon: '🧱', value: feats.walls },
      { label: 'Portes', icon: '🚪', value: feats.portals },
      { label: 'Lumières', icon: '💡', value: feats.lights },
    ];
    for (const counter of counters) {
      const span = document.createElement('span');
      span.title = counter.label;
      span.textContent = `${counter.icon} ${counter.value}`;
      countersEl.appendChild(span);
    }
    if (feats.bakedLighting) {
      const span = document.createElement('span');
      span.title = 'Éclairage déjà intégré à l’image';
      span.textContent = '✨';
      countersEl.appendChild(span);
    }

    header.append(nameEl, countersEl);

    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.gap = '0.5rem';
    actions.style.flexWrap = 'wrap';

    /**
     * @param {string} className
     * @param {string} label
     * @param {string} background
     * @returns {HTMLButtonElement}
     */
    const makeButton = (className, label, background) => {
      const btn = document.createElement('button');
      btn.className = className;
      btn.textContent = label;
      btn.style.flex = '1';
      btn.style.minWidth = '120px';
      btn.style.padding = '0.5rem';
      btn.style.background = background;
      btn.style.color = '#fff';
      btn.style.border = 'none';
      btn.style.borderRadius = '4px';
      btn.style.cursor = 'pointer';
      btn.style.fontSize = '0.85rem';
      btn.style.fontWeight = '500';
      return btn;
    };

    const loadBtn = makeButton('scene-card-load', '📂 Charger', '#4a90e2');
    const addBtn = makeButton('scene-card-add', '➕ Ajouter étage', '#6a6a6a');

    loadBtn.addEventListener(
      'click',
      () => {
        void handleLoadScene(mapEntry, 'load', loadBtn, addBtn);
      },
      { signal: listeners.signal }
    );

    addBtn.addEventListener(
      'click',
      () => {
        void handleLoadScene(mapEntry, 'add', loadBtn, addBtn);
      },
      { signal: listeners.signal }
    );

    actions.append(loadBtn, addBtn);
    mapCard.append(header, actions);
    return mapCard;
  }

  try {
    const catalog = await loadCatalog(catalogUrl);

    if (catalog.maps.length === 0) {
      setStatus(
        'info',
        'Aucune carte disponible. Déposez un .uvtt dans maps/ puis lancez `pnpm maps:prepare`.'
      );
      return { destroy: () => listeners.abort() };
    }

    setStatus('ok', `✓ ${catalog.maps.length} carte(s) disponible(s)`);
    for (const mapEntry of catalog.maps) {
      listEl.appendChild(renderMapCard(mapEntry));
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

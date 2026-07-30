// @ts-check
import { createImportPanel } from './importPanel.js';
import { createTokenMaker } from './tokenMaker.js';
import { createSceneLibrary } from './sceneLibrary.js';
import { createTokenLibrary } from './tokenLibrary.js';
import { createHandouts } from './handouts.js';
import { VERSION } from '../../core/version.js';
import { GM_SESSION_STORAGE_KEY } from '../../core/constants.js';
import { mountGMVersionBadge } from '../versionBadge.js';
import * as store from '../../state/store.js';

/**
 * @typedef {import('../../transport/Transport.js').Transport} Transport
 */

/**
 * Options d'initialisation du panneau MJ.
 * @typedef {Object} GMPanelOptions
 * @property {Transport} [transport] Transport réseau optionnel pour la synchronisation
 * @property {string} [sessionId] Code de session, affiché pour être dicté à la tablette
 */

/**
 * Monte le panneau latéral complet de la vue MJ.
 *
 * @param {HTMLElement} container Élément HTML conteneur
 * @param {GMPanelOptions} [options]
 * @returns {{tokenMaker: ReturnType<typeof createTokenMaker>, destroy: () => void}}
 */
export function createGMPanel(container, options = {}) {
  if (!container) {
    throw new Error('createGMPanel : conteneur HTML requis');
  }

  const { transport, sessionId = '' } = options;
  const listeners = new AbortController();

  container.className = 'gm-panel-root';
  container.style.display = 'flex';
  container.style.flexDirection = 'column';
  container.style.height = '100%';
  container.style.background = '#1e1e1e';
  container.style.color = '#eee';
  container.style.fontFamily = 'system-ui, sans-serif';

  container.innerHTML = `
    <!-- Barre de session : le code à dicter, et le seul geste qui permette d'en changer.
         sessionStorage survivant à la restauration d'onglets, une session peut coller
         après un redémarrage complet ; sans ce bouton il n'existait aucun moyen de la
         quitter depuis l'interface. -->
    <div class="gm-session-bar" style="display: flex; align-items: center; gap: 0.75rem; padding: 0.6rem 0.75rem; background: #232323; border-bottom: 1px solid #333;">
      <span style="font-size: 0.7rem; color: #888; text-transform: uppercase; letter-spacing: 0.5px;">Session</span>
      <code id="gm-session-code" style="font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 1.15rem; letter-spacing: 0.2em; color: #4a90e2;">${sessionId || '—'}</code>
      <button id="gm-leave-session" style="margin-left: auto; padding: 0.35rem 0.7rem; font-size: 0.75rem; background: #3a2a2a; color: #e0a0a0; border: 1px solid #5a3a3a; border-radius: 4px; cursor: pointer;">Quitter la session</button>
    </div>

    <!-- Barre d'onglets du panneau MJ -->
    <div class="gm-tabs-header" style="display: flex; background: #2a2a2a; border-bottom: 1px solid #333;">
      <button class="gm-tab-btn" data-tab="scene-library" style="flex: 1; padding: 0.6rem 0.25rem; font-size: 0.8rem; background: #2a2a2a; color: #aaa; border: none; border-bottom: 2px solid transparent; cursor: pointer;">📂 Cartes</button>
      <button class="gm-tab-btn active" data-tab="import-uvtt" style="flex: 1; padding: 0.6rem 0.25rem; font-size: 0.8rem; background: #333; color: #fff; border: none; border-bottom: 2px solid #4a90e2; cursor: pointer;">UVTT</button>
      <button class="gm-tab-btn" data-tab="import-image" style="flex: 1; padding: 0.6rem 0.25rem; font-size: 0.8rem; background: #2a2a2a; color: #aaa; border: none; border-bottom: 2px solid transparent; cursor: pointer;">Image</button>
      <button class="gm-tab-btn" data-tab="token-maker" style="flex: 1; padding: 0.6rem 0.25rem; font-size: 0.8rem; background: #2a2a2a; color: #aaa; border: none; border-bottom: 2px solid transparent; cursor: pointer;">Pions</button>
      <button class="gm-tab-btn" data-tab="handouts" style="flex: 1; padding: 0.6rem 0.25rem; font-size: 0.8rem; background: #2a2a2a; color: #aaa; border: none; border-bottom: 2px solid transparent; cursor: pointer;">Handouts</button>
      <button class="gm-tab-btn" data-tab="grid-settings" style="flex: 1; padding: 0.6rem 0.25rem; font-size: 0.8rem; background: #2a2a2a; color: #aaa; border: none; border-bottom: 2px solid transparent; cursor: pointer;">Grille</button>
    </div>

    <!-- Conteneurs de contenu des onglets -->
    <div class="gm-tabs-content" style="flex: 1; overflow-y: auto; padding: 1rem;">
      <div id="tab-content-scene-library" class="gm-tab-pane" style="display: none;">
        <div id="scene-library-mount"></div>
      </div>

      <div id="tab-content-import-uvtt" class="gm-tab-pane" style="display: block;">
        <div id="import-uvtt-mount"></div>
      </div>

      <div id="tab-content-import-image" class="gm-tab-pane" style="display: none;">
        <div id="import-image-mount"></div>
      </div>

      <div id="tab-content-token-maker" class="gm-tab-pane" style="display: none;">
        <div class="token-elevation-section" style="margin-bottom: 1.5rem; background: #252525; padding: 1rem; border-radius: 6px; border: 1px solid #333;">
          <h3 style="margin: 0 0 0.75rem 0; font-size: 1rem; color: #4a90e2;">Élévation du pion sélectionné</h3>
          <div style="display: flex; align-items: center; gap: 0.75rem;">
            <label for="token-elevation" style="font-size: 0.85rem; color: #aaa;">Élévation :</label>
            <input type="number" id="token-elevation" class="token-elevation-input" value="0" disabled style="width: 80px; padding: 0.4rem; background: #1a1a1a; color: #fff; border: 1px solid #444; border-radius: 4px;" />
            <span id="token-elevation-label" style="font-size: 0.8rem; color: #888;">(aucun pion sélectionné)</span>
          </div>
        </div>
        <div class="token-library-section" style="margin-bottom: 1.5rem;">
          <h3 style="margin: 0 0 0.75rem 0; font-size: 1rem; color: #4a90e2;">Bibliothèque de pions</h3>
          <div id="token-library-mount"></div>
        </div>
        <div class="token-maker-section" style="border-top: 1px solid #333; padding-top: 1rem;">
          <h3 style="margin: 0 0 0.75rem 0; font-size: 1rem; color: #4a90e2;">Créer un pion</h3>
          <div id="token-maker-mount"></div>
        </div>
      </div>

      <div id="tab-content-handouts" class="gm-tab-pane" style="display: none;">
        <div id="handouts-mount"></div>
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
            <select id="grid-type" disabled title="Les grilles hexagonales sont hors du lot actuel">
              <option value="square">Carrée (Square)</option>
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
  /** @type {ReturnType<typeof mountGMVersionBadge>|null} */
  let versionBadge = null;
  if (footerEl) {
    versionBadge = mountGMVersionBadge(footerEl, { transport, role: 'gm' });
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
    }, { signal: listeners.signal });
  });

  // --- Montage des sous-composants ---
  const sceneLibraryMount = /** @type {HTMLElement} */ (container.querySelector('#scene-library-mount'));
  const tokenLibraryMount = /** @type {HTMLElement} */ (container.querySelector('#token-library-mount'));
  const uvttMount = /** @type {HTMLElement} */ (container.querySelector('#import-uvtt-mount'));
  const imageMount = /** @type {HTMLElement} */ (container.querySelector('#import-image-mount'));
  const tokenMakerMount = /** @type {HTMLElement} */ (container.querySelector('#token-maker-mount'));
  const handoutsMount = /** @type {HTMLElement} */ (container.querySelector('#handouts-mount'));

  // Panneaux d'import UVTT et Image — sections de DIAGNOSTIC uniquement.
  //
  // Aucune publication vers les joueurs ici : le plan §8 interdit d'ajouter une
  // scène partagée depuis un simple aperçu local. Le parcours de séance passe
  // par l'onglet « Cartes », alimenté par `pnpm maps:prepare`.
  createImportPanel(uvttMount, { mode: 'uvtt' });
  createImportPanel(imageMount, { mode: 'image' });

  // Initialisation du composant Handouts
  const handouts = handoutsMount ? createHandouts(handoutsMount, { transport }) : null;

  // Initialisation de la bibliothèque de pions
  /** @type {{destroy: () => void} | null} */
  let tokenLibrary = null;
  if (tokenLibraryMount) {
    createTokenLibrary(tokenLibraryMount, { transport })
      .then((lib) => {
        tokenLibrary = lib;
      })
      .catch((err) => {
        console.error('Erreur lors du chargement de la bibliothèque de pions :', err);
        tokenLibraryMount.innerHTML = `
          <div style="padding: 0.75rem; background: #3a1a1a; color: #e07070; border-radius: 4px; border: 1px solid #5a3a3a;">
            ✗ Erreur : Impossible de charger la bibliothèque de pions.
          </div>
        `;
      });
  }

  // Initialisation du générateur de pions avec ajout direct au store lors de la génération
  const tokenMaker = createTokenMaker(tokenMakerMount, {
    defaultLevelId: store.getActiveLevelId(),
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

  // Initialisation de la bibliothèque de cartes
  /** @type {{destroy: () => void} | null} */
  let sceneLibrary = null;
  createSceneLibrary(sceneLibraryMount, { transport })
    .then((lib) => {
      sceneLibrary = lib;
    })
    .catch((err) => {
      console.error('Erreur lors du chargement de la bibliothèque de cartes :', err);
      sceneLibraryMount.innerHTML = `
        <div style="padding: 1rem; background: #3a1a1a; color: #e07070; border-radius: 4px; border: 1px solid #5a3a3a;">
          ✗ Erreur : Impossible de charger la bibliothèque de cartes.
        </div>
      `;
    });

  // --- Réglages de la grille ---
  const gridVisibleInput = /** @type {HTMLInputElement} */ (container.querySelector('#grid-visible'));
  const gridTypeSelect = /** @type {HTMLSelectElement} */ (container.querySelector('#grid-type'));
  const gridColorInput = /** @type {HTMLInputElement} */ (container.querySelector('#grid-color'));
  const gridOpacityInput = /** @type {HTMLInputElement} */ (container.querySelector('#grid-opacity'));
  const gridOpacityVal = /** @type {HTMLElement} */ (container.querySelector('#grid-opacity-val'));

  function updateGridFromUI() {
    const visible = gridVisibleInput.checked;
    /** @type {import('../../core/types.js').GridType} */
    const type = 'square';
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

  gridVisibleInput.addEventListener('change', updateGridFromUI, { signal: listeners.signal });
  gridTypeSelect.addEventListener('change', updateGridFromUI, { signal: listeners.signal });
  gridColorInput.addEventListener('input', updateGridFromUI, { signal: listeners.signal });
  gridOpacityInput.addEventListener('input', updateGridFromUI, { signal: listeners.signal });

  // Synchronisation initiale des champs de grille depuis le store si un étage est présent
  const activeLvl = store.getActiveLevel();
  if (activeLvl && activeLvl.grid) {
    gridVisibleInput.checked = activeLvl.grid.visible ?? true;
    gridTypeSelect.value = activeLvl.grid.type || 'square';
    gridColorInput.value = activeLvl.grid.color || '#000000';
    gridOpacityInput.value = String(activeLvl.grid.opacity ?? 0.25);
    gridOpacityVal.textContent = String(activeLvl.grid.opacity ?? 0.25);
  }

  // --- Quitter la session ---
  //
  // Trois gestes, et surtout PAS de `resetStore()` : celui-ci notifierait les abonnés, donc
  // déclencherait `saveToLocalStorage` avec une campagne nulle, laquelle **supprime**
  // `rpg_campaign_<session>` (js/state/store.js). Quitter une session effacerait alors la
  // campagne qu'on vient de quitter. La page est déchargée juste après de toute façon, et
  // les données restent en place pour qui retape le code.
  const leaveSessionBtn = /** @type {HTMLButtonElement} */ (
    container.querySelector('#gm-leave-session')
  );
  leaveSessionBtn?.addEventListener(
    'click',
    () => {
      const code = sessionId || 'en cours';
      if (!window.confirm(`Quitter la session ${code} ?\n\nLa campagne reste enregistrée : retaper ce code y revient.`)) {
        return;
      }
      try {
        transport?.disconnect();
      } catch (err) {
        // Un transport déjà tombé ne doit pas empêcher de partir.
        console.warn('Déconnexion du transport en quittant la session :', err);
      }
      sessionStorage.removeItem(GM_SESSION_STORAGE_KEY);
      window.location.href = 'index.html';
    },
    { signal: listeners.signal }
  );

  // --- Contrôle d'élévation du pion sélectionné ---
  const tokenElevationInput = /** @type {HTMLInputElement} */ (container.querySelector('#token-elevation'));
  const tokenElevationLabel = /** @type {HTMLElement} */ (container.querySelector('#token-elevation-label'));

  function updateElevationUIFromStore() {
    const selectedToken = store.getSelectedToken();
    if (!selectedToken) {
      tokenElevationInput.disabled = true;
      tokenElevationInput.value = '0';
      tokenElevationLabel.textContent = '(aucun pion sélectionné)';
    } else {
      tokenElevationInput.disabled = false;
      tokenElevationInput.value = String(selectedToken.elevation ?? 0);
      tokenElevationLabel.textContent = selectedToken.label
        ? `Pion : ${selectedToken.label}`
        : `Pion ID : ${selectedToken.id}`;
    }
  }

  function handleElevationChange() {
    const selectedToken = store.getSelectedToken();
    if (!selectedToken) return;
    const val = parseFloat(tokenElevationInput.value);
    if (!Number.isFinite(val)) return;

    if (selectedToken.elevation === val) return;

    store.updateToken(selectedToken.id, { elevation: val });

    if (transport) {
      transport.publish({
        type: 'token.elevation',
        payload: {
          tokenId: selectedToken.id,
          elevation: val,
        },
        at: Date.now(),
        by: 'gm',
      });
    }
  }

  // `change` seul, jamais `input`. Sur `input`, chaque frappe publiait un
  // `token.elevation` : saisir « 12 » faisait passer le pion à +1 puis +12 sur les
  // trois écrans, et chaque frappe coûtait deux validations de la campagne entière
  // (celle d'`updateToken`, puis celle de `saveToLocalStorage`) plus une écriture
  // LocalStorage. Le CdC §7 classe cet événement « ponctuel », et CONVENTIONS.md
  // pose « aucune écriture haute fréquence ».
  tokenElevationInput.addEventListener('change', handleElevationChange, { signal: listeners.signal });

  updateElevationUIFromStore();

  // Écouter les changements dans le store pour mettre à jour les inputs de grille si besoin
  const unsubscribeStore = store.subscribe(() => {
    tokenMaker.setDefaultLevelId(store.getActiveLevelId());
    updateElevationUIFromStore();
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
    destroy: () => {
      listeners.abort();
      unsubscribeStore();
      versionBadge?.detach();
      sceneLibrary?.destroy();
      tokenLibrary?.destroy();
      handouts?.destroy();
      container.replaceChildren();
    },
  };
}

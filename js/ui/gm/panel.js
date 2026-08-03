// @ts-check
import { createImportPanel } from './importPanel.js';
import { createTokenMaker } from './tokenMaker.js';
import { createSceneLibrary } from './sceneLibrary.js';
import { createTokenLibrary } from './tokenLibrary.js';
import { createHandouts } from './handouts.js';
import { createFogTools } from './fogTools.js';
import { createWallEditor } from './wallEditor.js';
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
 * @property {(levelId: string) => import('../../vision/fog.js').ExploredFog|null} [getExploredFog]
 * @property {() => void} [scheduleFogPublish]
 * @property {() => void} [requestRender]
 * @property {(levelId: string, wall: import('../../core/types.js').CellPoint[]) => void} [onAddWall]
 * @property {(levelId: string, wall: import('../../core/types.js').CellPoint[]) => void} [onRemoveWall]
 */

/**
 * Monte le panneau latéral complet de la vue MJ.
 *
 * @param {HTMLElement} container Élément HTML conteneur
 * @param {GMPanelOptions} [options]
 * @returns {{tokenMaker: ReturnType<typeof createTokenMaker>, fogTools: ReturnType<typeof createFogTools>|null, wallEditor: ReturnType<typeof createWallEditor>|null, destroy: () => void}}
 */
export function createGMPanel(container, options = {}) {
  if (!container) {
    throw new Error('createGMPanel : conteneur HTML requis');
  }

  const {
    transport,
    sessionId = '',
    getExploredFog = () => null,
    scheduleFogPublish = () => {},
    requestRender = () => {},
  } = options;
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
      <button class="gm-tab-btn" data-tab="fog-tools" style="flex: 1; padding: 0.6rem 0.25rem; font-size: 0.8rem; background: #2a2a2a; color: #aaa; border: none; border-bottom: 2px solid transparent; cursor: pointer;">🌫️ Fog</button>
      <button class="gm-tab-btn" data-tab="wall-editor" style="flex: 1; padding: 0.6rem 0.25rem; font-size: 0.8rem; background: #2a2a2a; color: #aaa; border: none; border-bottom: 2px solid transparent; cursor: pointer;">🧱 Murs</button>
      <button class="gm-tab-btn" data-tab="grid-settings" style="flex: 1; padding: 0.6rem 0.25rem; font-size: 0.8rem; background: #2a2a2a; color: #aaa; border: none; border-bottom: 2px solid transparent; cursor: pointer;">Grille</button>
    </div>

    <!-- Conteneurs de contenu des onglets -->
    <div class="gm-tabs-content" style="flex: 1; overflow-y: auto; padding: 1rem;">
      <div id="tab-content-scene-library" class="gm-tab-pane" style="display: none;">
        <div id="scene-library-mount"></div>
      </div>

      <div id="tab-content-fog-tools" class="gm-tab-pane" style="display: none;">
        <div id="fog-tools-mount"></div>
      </div>

      <div id="tab-content-wall-editor" class="gm-tab-pane" style="display: none;">
        <div id="wall-editor-mount"></div>
      </div>

      <div id="tab-content-import-uvtt" class="gm-tab-pane" style="display: block;">
        <div id="import-uvtt-mount"></div>
      </div>

      <div id="tab-content-import-image" class="gm-tab-pane" style="display: none;">
        <div id="import-image-mount"></div>
      </div>

      <div id="tab-content-token-maker" class="gm-tab-pane" style="display: none;">
        <div class="token-elevation-section" style="margin-bottom: 1.5rem; background: #252525; padding: 1rem; border-radius: 6px; border: 1px solid #333;">
          <h3 style="margin: 0 0 0.75rem 0; font-size: 1rem; color: #4a90e2;">Pion sélectionné</h3>
          <div style="display: flex; align-items: center; gap: 0.75rem;">
            <label for="token-elevation" style="font-size: 0.85rem; color: #aaa;">Élévation :</label>
            <input type="number" id="token-elevation" class="token-elevation-input" value="0" disabled style="width: 80px; padding: 0.4rem; background: #1a1a1a; color: #fff; border: 1px solid #444; border-radius: 4px;" />
            <span id="token-elevation-label" style="font-size: 0.8rem; color: #888;">(aucun pion sélectionné)</span>
          </div>

          <div id="token-edit-fields" style="display: grid; grid-template-columns: auto 1fr; gap: 0.5rem 0.75rem; align-items: center; margin-top: 0.75rem; padding-top: 0.75rem; border-top: 1px solid #333;">
            <label for="token-edit-label" style="font-size: 0.85rem; color: #aaa;">Nom :</label>
            <input type="text" id="token-edit-label" disabled style="padding: 0.4rem; background: #1a1a1a; color: #fff; border: 1px solid #444; border-radius: 4px;" />

            <label for="token-edit-kind" style="font-size: 0.85rem; color: #aaa;">Type :</label>
            <select id="token-edit-kind" disabled style="padding: 0.4rem; background: #1a1a1a; color: #fff; border: 1px solid #444; border-radius: 4px;">
              <option value="pc">PJ (Joueur)</option>
              <option value="npc">PNJ (Non-Joueur)</option>
            </select>

            <label for="token-edit-border-color" style="font-size: 0.85rem; color: #aaa;">Bordure :</label>
            <input type="color" id="token-edit-border-color" disabled style="padding: 0; background: #1a1a1a; border: 1px solid #444; border-radius: 4px; height: 2rem;" />

            <label for="token-edit-size-cells" style="font-size: 0.85rem; color: #aaa;">Taille (cases) :</label>
            <input type="number" id="token-edit-size-cells" min="1" max="4" disabled style="padding: 0.4rem; background: #1a1a1a; color: #fff; border: 1px solid #444; border-radius: 4px;" />

            <label for="token-edit-speed-cells" style="font-size: 0.85rem; color: #aaa;">Vitesse (cases) :</label>
            <input type="number" id="token-edit-speed-cells" min="1" disabled style="padding: 0.4rem; background: #1a1a1a; color: #fff; border: 1px solid #444; border-radius: 4px;" />

            <label for="token-edit-hidden" style="font-size: 0.85rem; color: #aaa;">Masqué aux joueurs :</label>
            <input type="checkbox" id="token-edit-hidden" disabled style="justify-self: start; width: 1.1rem; height: 1.1rem;" />

            <label for="token-edit-player-movable" style="font-size: 0.85rem; color: #aaa;">Déplaçable par les joueurs :</label>
            <input type="checkbox" id="token-edit-player-movable" disabled style="justify-self: start; width: 1.1rem; height: 1.1rem;" />

            <label for="token-edit-locked" style="font-size: 0.85rem; color: #aaa;">Verrouillé :</label>
            <input type="checkbox" id="token-edit-locked" disabled style="justify-self: start; width: 1.1rem; height: 1.1rem;" />
          </div>

          <p id="token-edit-status" style="margin: 0.5rem 0 0 0; font-size: 0.75rem; color: #888; min-height: 1rem;"></p>

          <button id="btn-delete-token" disabled style="margin-top: 0.5rem; width: 100%; padding: 0.5rem; background: #5f2530; color: #fff; border: 1px solid #7a2f3c; border-radius: 4px; cursor: pointer;">
            Supprimer ce pion
          </button>
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
  const fogToolsMount = /** @type {HTMLElement} */ (container.querySelector('#fog-tools-mount'));

  // Panneaux d'import UVTT et Image — sections de DIAGNOSTIC uniquement.
  //
  // Aucune publication vers les joueurs ici : le plan §8 interdit d'ajouter une
  // scène partagée depuis un simple aperçu local. Le parcours de séance passe
  // par l'onglet « Cartes », alimenté par `pnpm maps:prepare`.
  createImportPanel(uvttMount, { mode: 'uvtt' });
  createImportPanel(imageMount, { mode: 'image' });

  // Initialisation du composant Handouts
  const handouts = handoutsMount ? createHandouts(handoutsMount, { transport }) : null;

  const wallEditorMount = /** @type {HTMLElement} */ (container.querySelector('#wall-editor-mount'));

  /** @type {ReturnType<typeof createWallEditor>|null} */
  let wallEditor = null;

  // Initialisation du composant FogTools
  const fogTools = fogToolsMount
    ? createFogTools(fogToolsMount, {
        getActiveLevelId: () => store.getActiveLevelId(),
        getExploredFog,
        scheduleFogPublish,
        requestRender,
        onToolChange: (tool) => {
          if (tool !== 'none' && wallEditor) {
            wallEditor.setArmed(false);
          }
        },
      })
    : null;

  // Initialisation du composant WallEditor
  if (wallEditorMount) {
    wallEditor = createWallEditor(wallEditorMount, {
      getActiveLevelId: () => store.getActiveLevelId(),
      onAddWall: (levelId, wall) => {
        store.addWall(levelId, wall);
        options.onAddWall?.(levelId, wall);
      },
      onRemoveWall: (levelId, wall) => {
        const removed = store.removeWall(levelId, wall);
        if (removed) {
          options.onRemoveWall?.(levelId, wall);
        }
        return removed;
      },
      onArmChange: (armed) => {
        if (armed && fogTools) {
          fogTools.disarm();
        }
      },
      requestRender,
    });
  }

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

  // --- Édition et suppression du pion sélectionné ---
  const tokenEditLabel = /** @type {HTMLInputElement} */ (container.querySelector('#token-edit-label'));
  const tokenEditKind = /** @type {HTMLSelectElement} */ (container.querySelector('#token-edit-kind'));
  const tokenEditBorderColor = /** @type {HTMLInputElement} */ (container.querySelector('#token-edit-border-color'));
  const tokenEditSizeCells = /** @type {HTMLInputElement} */ (container.querySelector('#token-edit-size-cells'));
  const tokenEditSpeedCells = /** @type {HTMLInputElement} */ (container.querySelector('#token-edit-speed-cells'));
  const tokenEditHidden = /** @type {HTMLInputElement} */ (container.querySelector('#token-edit-hidden'));
  const tokenEditPlayerMovable = /** @type {HTMLInputElement} */ (container.querySelector('#token-edit-player-movable'));
  const tokenEditLocked = /** @type {HTMLInputElement} */ (container.querySelector('#token-edit-locked'));
  const tokenEditStatus = /** @type {HTMLElement} */ (container.querySelector('#token-edit-status'));
  const btnDeleteToken = /** @type {HTMLButtonElement} */ (container.querySelector('#btn-delete-token'));

  const tokenEditControls = [
    tokenEditLabel,
    tokenEditKind,
    tokenEditBorderColor,
    tokenEditSizeCells,
    tokenEditSpeedCells,
    tokenEditHidden,
    tokenEditPlayerMovable,
    tokenEditLocked,
  ];

  function updateTokenEditUIFromStore() {
    const selectedToken = store.getSelectedToken();
    const disabled = !selectedToken;
    for (const control of tokenEditControls) control.disabled = disabled;
    btnDeleteToken.disabled = disabled;

    if (!selectedToken) {
      tokenEditLabel.value = '';
      tokenEditStatus.textContent = '';
      return;
    }

    // Ne jamais réécrire le champ que le MJ est en train de remplir. Sans cette garde,
    // une mise à jour venue du réseau — ou notre propre notification de store — écraserait
    // la frappe en cours au caractère près.
    for (const [control, value] of /** @type {[HTMLInputElement|HTMLSelectElement, string][]} */ ([
      [tokenEditLabel, selectedToken.label ?? ''],
      [tokenEditKind, selectedToken.kind],
      [tokenEditBorderColor, selectedToken.borderColor || '#ffffff'],
      [tokenEditSizeCells, String(selectedToken.sizeCells ?? 1)],
      [tokenEditSpeedCells, String(selectedToken.speedCells ?? 1)],
    ])) {
      if (document.activeElement !== control) control.value = value;
    }
    tokenEditHidden.checked = Boolean(selectedToken.hidden);
    tokenEditPlayerMovable.checked = Boolean(selectedToken.playerMovable);
    tokenEditLocked.checked = Boolean(selectedToken.locked);
  }

  /**
   * Applique un patch au pion sélectionné, puis le publie.
   *
   * Le store valide la campagne entière et **lève** si le patch la rend invalide — passer
   * un pion 1×1 en 4×4 au bord de la carte le sort de l'étage. Dans ce cas rien n'a muté,
   * et l'interface doit se remettre d'accord avec le store : afficher encore la valeur
   * refusée laisserait croire à un changement qui n'a pas eu lieu.
   *
   * @param {Partial<import('../../core/types.js').Token>} patch
   */
  function applyTokenPatch(patch) {
    const selectedToken = store.getSelectedToken();
    if (!selectedToken) return;

    try {
      store.updateToken(selectedToken.id, patch);
    } catch (err) {
      tokenEditStatus.style.color = '#e74c3c';
      tokenEditStatus.textContent = err instanceof Error ? err.message : String(err);
      updateTokenEditUIFromStore();
      return;
    }

    tokenEditStatus.style.color = '#2ecc71';
    tokenEditStatus.textContent = 'Modification appliquée.';

    transport?.publish({
      type: 'token.update',
      payload: { tokenId: selectedToken.id, patch },
      at: Date.now(),
      by: 'gm',
    });
  }

  // `change` et non `input`, pour la raison déjà écrite au-dessus pour l'élévation : le CdC
  // §7 classe `token.update` « ponctuel », et publier à chaque frappe ferait clignoter le
  // nom sur les trois écrans en revalidant la campagne à chaque caractère.
  tokenEditLabel.addEventListener(
    'change',
    () => {
      const value = tokenEditLabel.value.trim();
      if (!value) {
        tokenEditStatus.style.color = '#e74c3c';
        tokenEditStatus.textContent = 'Le nom ne peut pas être vide.';
        updateTokenEditUIFromStore();
        return;
      }
      if (value === store.getSelectedToken()?.label) return;
      applyTokenPatch({ label: value });
    },
    { signal: listeners.signal }
  );

  tokenEditKind.addEventListener(
    'change',
    () => {
      const kind = /** @type {'pc'|'npc'} */ (tokenEditKind.value === 'npc' ? 'npc' : 'pc');
      if (kind === store.getSelectedToken()?.kind) return;
      applyTokenPatch({ kind });
    },
    { signal: listeners.signal }
  );

  tokenEditBorderColor.addEventListener(
    'change',
    () => {
      const color = tokenEditBorderColor.value;
      if (color === store.getSelectedToken()?.borderColor) return;
      applyTokenPatch({ borderColor: color });
    },
    { signal: listeners.signal }
  );

  tokenEditSizeCells.addEventListener(
    'change',
    () => {
      const value = parseInt(tokenEditSizeCells.value, 10);
      if (!Number.isInteger(value) || value < 1) {
        tokenEditStatus.style.color = '#e74c3c';
        tokenEditStatus.textContent = 'La taille doit être un entier au moins égal à 1.';
        updateTokenEditUIFromStore();
        return;
      }
      if (value === store.getSelectedToken()?.sizeCells) return;
      applyTokenPatch({ sizeCells: value });
    },
    { signal: listeners.signal }
  );

  tokenEditSpeedCells.addEventListener(
    'change',
    () => {
      const value = parseFloat(tokenEditSpeedCells.value);
      if (!Number.isFinite(value) || value < 1) {
        tokenEditStatus.style.color = '#e74c3c';
        tokenEditStatus.textContent = 'La vitesse doit valoir au moins 1 case.';
        updateTokenEditUIFromStore();
        return;
      }
      if (value === store.getSelectedToken()?.speedCells) return;
      applyTokenPatch({ speedCells: value });
    },
    { signal: listeners.signal }
  );

  tokenEditHidden.addEventListener(
    'change',
    () => applyTokenPatch({ hidden: tokenEditHidden.checked }),
    { signal: listeners.signal }
  );

  tokenEditPlayerMovable.addEventListener(
    'change',
    () => applyTokenPatch({ playerMovable: tokenEditPlayerMovable.checked }),
    { signal: listeners.signal }
  );

  tokenEditLocked.addEventListener(
    'change',
    () => applyTokenPatch({ locked: tokenEditLocked.checked }),
    { signal: listeners.signal }
  );

  // La suppression est irréversible — il n'y a pas d'annulation dans le modèle — donc elle
  // se confirme, comme « quitter la session » plus haut.
  btnDeleteToken.addEventListener(
    'click',
    () => {
      const selectedToken = store.getSelectedToken();
      if (!selectedToken) return;

      const nom = selectedToken.label || selectedToken.id;
      if (!window.confirm(`Supprimer le pion « ${nom} » ?\n\nCette action est irréversible.`)) {
        return;
      }

      const tokenId = selectedToken.id;
      try {
        store.removeToken(tokenId);
      } catch (err) {
        tokenEditStatus.style.color = '#e74c3c';
        tokenEditStatus.textContent = err instanceof Error ? err.message : String(err);
        return;
      }

      transport?.publish({
        type: 'token.delete',
        payload: { tokenId },
        at: Date.now(),
        by: 'gm',
      });
    },
    { signal: listeners.signal }
  );

  updateTokenEditUIFromStore();

  // Écouter les changements dans le store pour mettre à jour les inputs de grille si besoin
  const unsubscribeStore = store.subscribe(() => {
    tokenMaker.setDefaultLevelId(store.getActiveLevelId());
    updateElevationUIFromStore();
    updateTokenEditUIFromStore();
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
    fogTools,
    wallEditor,
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

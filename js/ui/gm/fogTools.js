// @ts-check

/**
 * @typedef {import('../../vision/fog.js').ExploredFog} ExploredFog
 */

/**
 * Options du composant fogTools
 * @typedef {Object} FogToolsOptions
 * @property {() => string|null} getActiveLevelId Renvoie l'ID de l'étage actif
 * @property {(levelId: string) => ExploredFog|null} getExploredFog Renvoie l'instance ExploredFog d'un étage
 * @property {() => void} scheduleFogPublish Déclenche la publication du masque de l'étage courant
 * @property {() => void} requestRender Demande un rendu d'une frame Canvas
 * @property {(tool: 'none'|'reveal'|'hide') => void} [onToolChange] Callback lorsque l'outil actif change
 */

/**
 * Monte le composant d'outils de Fog du MJ.
 *
 * @param {HTMLElement} container Élément conteneur HTML
 * @param {FogToolsOptions} options
 */
export function createFogTools(container, options) {
  if (!container) {
    throw new Error('createFogTools : conteneur HTML requis');
  }

  const { getActiveLevelId, getExploredFog, scheduleFogPublish, requestRender } = options;

  /** @type {'none'|'reveal'|'hide'} */
  let activeTool = 'none';

  /** @type {1|3|5} */
  let brushRadiusCells = 1;

  /** @type {Map<string, string[]>} Pile d'undo par levelId (max 10 PNG base64 par étage) */
  const undoStacks = new Map();

  /**
   * Récupère la pile d'undo pour un étage donné.
   * @param {string} levelId
   * @returns {string[]}
   */
  function getUndoStack(levelId) {
    let stack = undoStacks.get(levelId);
    if (!stack) {
      stack = [];
      undoStacks.set(levelId, stack);
    }
    return stack;
  }

  /**
   * Enregistre l'état courant du masque de fog avant une action d'outil MJ.
   */
  async function pushUndoState() {
    try {
      const levelId = getActiveLevelId();
      if (!levelId) return;
      const fog = getExploredFog(levelId);
      if (!fog) return;

      const stack = getUndoStack(levelId);
      // exportPng() lit les pixels de manière synchrone avant le 1er await (A4)
      const png = await fog.exportPng();
      if (png) {
        stack.push(png);
        if (stack.length > 10) {
          stack.shift();
        }
        updateUI();
      }
    } catch (err) {
      console.error('Erreur pushUndoState :', err);
    }
  }

  /**
   * Vide la pile d'undo pour un étage (appelé lors d'une révélation automatique par déplacement).
   * @param {string} levelId
   */
  function clearUndoStack(levelId) {
    if (undoStacks.has(levelId)) {
      const stack = undoStacks.get(levelId);
      if (stack) {
        stack.length = 0;
      }
      updateUI();
    }
  }

  /**
   * Restaure l'état de fog précédent pour l'étage actif.
   */
  async function undo() {
    try {
      const levelId = getActiveLevelId();
      if (!levelId) return;
      const stack = getUndoStack(levelId);
      if (stack.length === 0) return;

      const previousPng = stack.pop();
      const fog = getExploredFog(levelId);
      if (fog && previousPng) {
        await fog.importPng(previousPng);
        scheduleFogPublish();
        requestRender();
        updateUI();
      }
    } catch (err) {
      console.error('Erreur undo :', err);
    }
  }

  // Structure HTML de l'onglet
  container.innerHTML = `
    <div class="fog-tools-root">

      <!-- Actions globales -->
      <div class="gm-section">
        <h4 class="gm-h">Actions globales</h4>
        <div class="gm-row">
          <button id="fog-btn-reveal-all" style="flex: 1;">Tout révéler</button>
          <button id="fog-btn-hide-all" class="gm-btn--danger" style="flex: 1;">Tout masquer</button>
        </div>
      </div>

      <!-- Pinceaux -->
      <div class="gm-section">
        <h4 class="gm-h">Pinceaux</h4>
        <div class="gm-row" style="margin-bottom: 10px;">
          <button id="fog-btn-tool-reveal" class="fog-tool-btn" data-tool="reveal" aria-pressed="false" style="flex: 1;">Révéler</button>
          <button id="fog-btn-tool-hide" class="fog-tool-btn" data-tool="hide" aria-pressed="false" style="flex: 1;">Masquer</button>
        </div>

        <div class="gm-muted" style="margin-bottom: 6px;">Taille du pinceau :</div>
        <div class="gm-row">
          <button class="fog-radius-btn" data-radius="1" aria-pressed="false" style="flex: 1;">1 case</button>
          <button class="fog-radius-btn" data-radius="3" aria-pressed="false" style="flex: 1;">3 cases</button>
          <button class="fog-radius-btn" data-radius="5" aria-pressed="false" style="flex: 1;">5 cases</button>
        </div>
      </div>

      <!-- Historique -->
      <div class="gm-section">
        <h4 class="gm-h">Historique (Undo)</h4>
        <button id="fog-btn-undo" class="gm-btn--block" disabled>Annuler (0)</button>
      </div>

    </div>
  `;

  const btnRevealAll = /** @type {HTMLButtonElement} */ (container.querySelector('#fog-btn-reveal-all'));
  const btnHideAll = /** @type {HTMLButtonElement} */ (container.querySelector('#fog-btn-hide-all'));
  const btnToolReveal = /** @type {HTMLButtonElement} */ (container.querySelector('#fog-btn-tool-reveal'));
  const btnToolHide = /** @type {HTMLButtonElement} */ (container.querySelector('#fog-btn-tool-hide'));
  const btnUndo = /** @type {HTMLButtonElement} */ (container.querySelector('#fog-btn-undo'));
  const radiusBtns = container.querySelectorAll('.fog-radius-btn');

  function updateUI() {
    // État des outils
    btnToolReveal.setAttribute('aria-pressed', String(activeTool === 'reveal'));
    btnToolHide.setAttribute('aria-pressed', String(activeTool === 'hide'));

    // État des rayons
    radiusBtns.forEach((btn) => {
      const b = /** @type {HTMLButtonElement} */ (btn);
      const r = Number(b.dataset.radius);
      b.setAttribute('aria-pressed', String(r === brushRadiusCells));
    });

    // État du bouton undo
    const levelId = getActiveLevelId();
    const stack = levelId ? getUndoStack(levelId) : [];
    if (stack.length > 0) {
      btnUndo.disabled = false;
      btnUndo.textContent = `Annuler (${stack.length})`;
    } else {
      btnUndo.disabled = true;
      btnUndo.textContent = 'Annuler';
    }
  }

  // Handlers événements UI
  btnRevealAll.addEventListener('click', async () => {
    const levelId = getActiveLevelId();
    if (!levelId) return;
    const fog = getExploredFog(levelId);
    if (!fog) return;

    await pushUndoState();
    fog.revealAll();
    scheduleFogPublish();
    requestRender();
  });

  btnHideAll.addEventListener('click', async () => {
    const levelId = getActiveLevelId();
    if (!levelId) return;
    const fog = getExploredFog(levelId);
    if (!fog) return;

    await pushUndoState();
    fog.clear();
    scheduleFogPublish();
    requestRender();
  });

  btnToolReveal.addEventListener('click', () => {
    activeTool = activeTool === 'reveal' ? 'none' : 'reveal';
    options.onToolChange?.(activeTool);
    updateUI();
  });

  btnToolHide.addEventListener('click', () => {
    activeTool = activeTool === 'hide' ? 'none' : 'hide';
    options.onToolChange?.(activeTool);
    updateUI();
  });

  radiusBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const b = /** @type {HTMLButtonElement} */ (btn);
      const r = Number(b.dataset.radius);
      if (r === 1 || r === 3 || r === 5) {
        brushRadiusCells = r;
        updateUI();
      }
    });
  });

  /**
   * Efface le masque de brouillard de l'étage actif et publie la mise à zéro (UX-13).
   * Vide également la pile d'undo de cet étage sans y empiler d'état préalable.
   */
  async function clearFog() {
    const levelId = getActiveLevelId();
    if (!levelId) return;
    const fog = getExploredFog(levelId);
    if (!fog) return;

    fog.clear();
    clearUndoStack(levelId);
    scheduleFogPublish();
    requestRender();
  }

  btnUndo.addEventListener('click', () => {
    undo();
  });

  updateUI();

  return {
    getActiveTool: () => activeTool,
    getBrushRadiusCells: () => brushRadiusCells,
    getUndoStackLength: (/** @type {string} */ levelId) => getUndoStack(levelId).length,
    pushUndoState,
    clearUndoStack,
    undo,
    clearFog,
    disarm: () => {
      activeTool = 'none';
      updateUI();
    },
    updateUI,
  };
}

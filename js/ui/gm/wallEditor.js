// @ts-check

/**
 * @typedef {import('../../core/types.js').Level} Level
 * @typedef {import('../../core/types.js').CellPoint} CellPoint
 * @typedef {import('../../core/types.js').MapPoint} MapPoint
 * @typedef {import('../../grid/GridAdapter.js').GridAdapter} GridAdapter
 */

/**
 * @typedef {'tracer'|'supprimer'} WallEditorSubMode
 */

/**
 * @typedef {Object} WallEditorOptions
 * @property {() => string|null} getActiveLevelId
 * @property {(levelId: string, wall: CellPoint[]) => void} onAddWall
 * @property {(levelId: string, wall: CellPoint[]) => boolean} onRemoveWall
 * @property {(armed: boolean, subMode?: 'tracer'|'supprimer') => void} [onArmChange]
 * @property {() => void} [requestRender]
 */

/**
 * Calcule la distance au carré entre un point P et un segment AB (en pixels carte).
 *
 * @param {MapPoint} p
 * @param {MapPoint} a
 * @param {MapPoint} b
 * @returns {number} Distance au carré en pixels carte
 */
function distSqToSegment(p, a, b) {
  const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  if (l2 === 0) return (p.x - a.x) ** 2 + (p.y - a.y) ** 2;
  let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  const projX = a.x + t * (b.x - a.x);
  const projY = a.y + t * (b.y - a.y);
  return (p.x - projX) ** 2 + (p.y - projY) ** 2;
}

/**
 * Longueur d'une case en pixels carte, mesurée par la grille elle-même, jamais par la densité
 * de l'étage lue directement.
 * @param {GridAdapter} grid
 * @returns {number}
 */
function uneCasePx(grid) {
  const o = grid.mapFromCellPoint({ cellX: 0, cellY: 0 });
  const x = grid.mapFromCellPoint({ cellX: 1, cellY: 0 });
  return Math.max(1, Math.hypot(x.x - o.x, x.y - o.y));
}

/**
 * Trouve le point d'accrochage pour une position carte (§4) :
 * 1. Extrémité existante de mur ou portail à moins de 0,5 case (prioritaire).
 * 2. Coin de case entier le plus proche (fallback).
 * Aucun point libre n'est autorisé.
 *
 * ⛔ Toutes les conversions passent par la grille (audit du 22/09, B7) — celle-là même qui
 * DESSINE les murs (`walls.js`, `grid.mapFromCellPoint`). L'éditeur convertissait lui-même avec
 * une origine forcée à (0,0) et l'échelle X seule : sur un étage décalé ou hexagonal,
 * l'accrochage et la zone de suppression tombaient à côté du mur affiché.
 *
 * @param {MapPoint} mapPos Position carte en pixels carte
 * @param {Level|null} level Étage courant
 * @param {GridAdapter} grid Grille de cet étage
 * @returns {CellPoint} Point accroché
 */
export function snapWallVertex(mapPos, level, grid) {
  const seuilPx = 0.5 * uneCasePx(grid);

  // 1. Recherche d'une extrémité existante à moins de 0,5 case
  if (level) {
    /** @type {CellPoint[]} */
    const existingEndpoints = [];

    if (Array.isArray(level.walls)) {
      for (const wall of level.walls) {
        if (!Array.isArray(wall) || wall.length === 0) continue;
        existingEndpoints.push(wall[0]);
        if (wall.length > 1) {
          existingEndpoints.push(wall[wall.length - 1]);
        }
      }
    }

    if (Array.isArray(level.portals)) {
      for (const portal of level.portals) {
        if (portal?.a) existingEndpoints.push({ cellX: portal.a.cellX, cellY: portal.a.cellY });
        if (portal?.b) existingEndpoints.push({ cellX: portal.b.cellX, cellY: portal.b.cellY });
      }
    }

    let bestEndpoint = null;
    let minEndpointDist = Infinity;

    for (const ep of existingEndpoints) {
      const pt = grid.mapFromCellPoint(ep);
      const d = Math.hypot(mapPos.x - pt.x, mapPos.y - pt.y);
      if (d <= seuilPx && d < minEndpointDist) {
        minEndpointDist = d;
        bestEndpoint = ep;
      }
    }

    if (bestEndpoint) {
      return { cellX: bestEndpoint.cellX, cellY: bestEndpoint.cellY };
    }
  }

  // 2. Coin de case entier le plus proche
  const brut = grid.cellPointFromMap(mapPos);
  return {
    cellX: Math.round(brut.cellX),
    cellY: Math.round(brut.cellY),
  };
}

/**
 * Trouve le mur d'un étage le plus proche d'un tap carte (capsule de 0,5 case). Mêmes
 * conversions que le dessin des murs — voir `snapWallVertex`.
 *
 * @param {MapPoint} mapPos Position carte en pixels carte
 * @param {Level|null} level Étage courant
 * @param {GridAdapter} grid Grille de cet étage
 * @returns {CellPoint[]|null} Mur trouvé ou null
 */
export function findWallAt(mapPos, level, grid) {
  if (!level || !Array.isArray(level.walls) || level.walls.length === 0) return null;

  const maxDistPxSq = (0.5 * uneCasePx(grid)) ** 2;

  let bestWall = null;
  let minDistSq = Infinity;

  for (const wall of level.walls) {
    if (!Array.isArray(wall) || wall.length < 2) continue;

    for (let i = 0; i < wall.length - 1; i++) {
      const pA = grid.mapFromCellPoint(wall[i]);
      const pB = grid.mapFromCellPoint(wall[i + 1]);

      const dSq = distSqToSegment(mapPos, pA, pB);
      if (dSq <= maxDistPxSq && dSq < minDistSq) {
        minDistSq = dSq;
        bestWall = wall;
      }
    }
  }

  return bestWall;
}

/**
 * Composant UI pour l'éditeur minimal de murs du MJ (7ème/8ème onglet du panneau).
 *
 * @param {HTMLElement} container
 * @param {WallEditorOptions} options
 */
export function createWallEditor(container, options) {
  let isArmed = false;
  /** @type {WallEditorSubMode} */
  let subMode = 'tracer';
  /** @type {CellPoint[]} */
  let draftVertices = [];

  container.innerHTML = `
    <div class="gm-section">
      <h3>🧱 Éditeur de murs</h3>
      <div class="gm-btn-group" style="margin-bottom: 12px;">
        <button id="wall-btn-arm" class="gm-btn" style="flex: 1;">Armer l'éditeur</button>
      </div>

      <div id="wall-tools-panel" style="display: none;">
        <div style="margin-bottom: 10px; font-weight: 500; font-size: 0.85rem; color: var(--color-text-subtle, #94a3b8);">
          Mode d'édition :
        </div>
        <div class="gm-btn-group" style="margin-bottom: 12px;">
          <button id="wall-btn-mode-trace" class="gm-btn gm-btn-active" style="flex: 1;">✏️ Tracer</button>
          <button id="wall-btn-mode-remove" class="gm-btn" style="flex: 1;">🗑️ Supprimer</button>
        </div>

        <div id="wall-draft-actions" style="margin-top: 10px;">
          <button id="wall-btn-commit" class="gm-btn gm-btn-primary" style="width: 100%; margin-bottom: 6px;" disabled>
            ✅ Valider le mur (0 sommet)
          </button>
          <button id="wall-btn-cancel" class="gm-btn" style="width: 100%;" disabled>
            ❌ Annuler le tracé
          </button>
        </div>
      </div>
    </div>
  `;

  const btnArm = /** @type {HTMLButtonElement} */ (container.querySelector('#wall-btn-arm'));
  const panelTools = /** @type {HTMLElement} */ (container.querySelector('#wall-tools-panel'));
  const btnModeTrace = /** @type {HTMLButtonElement} */ (container.querySelector('#wall-btn-mode-trace'));
  const btnModeRemove = /** @type {HTMLButtonElement} */ (container.querySelector('#wall-btn-mode-remove'));
  const btnCommit = /** @type {HTMLButtonElement} */ (container.querySelector('#wall-btn-commit'));
  const btnCancel = /** @type {HTMLButtonElement} */ (container.querySelector('#wall-btn-cancel'));

  function updateUI() {
    if (isArmed) {
      btnArm.textContent = 'Désarmer l\'éditeur';
      btnArm.classList.add('gm-btn-active');
      panelTools.style.display = 'block';
    } else {
      btnArm.textContent = 'Armer l\'éditeur';
      btnArm.classList.remove('gm-btn-active');
      panelTools.style.display = 'none';
    }

    if (subMode === 'tracer') {
      btnModeTrace.classList.add('gm-btn-active');
      btnModeRemove.classList.remove('gm-btn-active');
    } else {
      btnModeTrace.classList.remove('gm-btn-active');
      btnModeRemove.classList.add('gm-btn-active');
    }

    const n = draftVertices.length;
    btnCommit.textContent = `✅ Valider le mur (${n} sommet${n > 1 ? 's' : ''})`;
    btnCommit.disabled = n < 2;
    btnCancel.disabled = n === 0;
  }

  btnArm.addEventListener('click', () => {
    isArmed = !isArmed;
    if (!isArmed) {
      draftVertices = [];
    }
    options.onArmChange?.(isArmed, subMode);
    options.requestRender?.();
    updateUI();
  });

  btnModeTrace.addEventListener('click', () => {
    subMode = 'tracer';
    if (isArmed) {
      options.onArmChange?.(isArmed, subMode);
    }
    updateUI();
  });

  btnModeRemove.addEventListener('click', () => {
    subMode = 'supprimer';
    draftVertices = [];
    if (isArmed) {
      options.onArmChange?.(isArmed, subMode);
    }
    options.requestRender?.();
    updateUI();
  });

  btnCommit.addEventListener('click', () => {
    if (draftVertices.length >= 2) {
      const levelId = options.getActiveLevelId();
      if (levelId) {
        options.onAddWall(levelId, draftVertices);
      }
    }
    draftVertices = [];
    options.requestRender?.();
    updateUI();
  });

  btnCancel.addEventListener('click', () => {
    draftVertices = [];
    options.requestRender?.();
    updateUI();
  });

  updateUI();

  return {
    isArmed: () => isArmed,
    getSubMode: () => subMode,
    getDraft: () => draftVertices,
    setArmed: (/** @type {boolean} */ armed) => {
      isArmed = armed;
      if (!isArmed) draftVertices = [];
      updateUI();
    },
    addVertex: (/** @type {CellPoint} */ vertex) => {
      draftVertices.push(vertex);
      options.requestRender?.();
      updateUI();
    },
    cancelDraft: () => {
      draftVertices = [];
      options.requestRender?.();
      updateUI();
    },
    updateUI,
  };
}

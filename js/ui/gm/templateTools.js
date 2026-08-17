// @ts-check

/**
 * @typedef {import('../../core/types.js').TemplateShape} TemplateShape
 * @typedef {import('../../core/types.js').Template} Template
 */

/**
 * Options du composant templateTools
 * @typedef {Object} TemplateToolsOptions
 * @property {() => string|null} getActiveLevelId
 * @property {(levelId: string) => void} [onClearTemplates]
 * @property {() => Template[]} [getTemplates] Gabarits de la campagne, tous étages confondus
 * @property {(templateId: string) => void} [onRemoveTemplate]
 * @property {(armed: boolean) => void} [onArmChange]
 * @property {() => void} [requestRender]
 */

/** @type {Record<TemplateShape, string>} */
const SHAPE_LABEL_FR = {
  circle: 'Cercle',
  cone: 'Cône',
  line: 'Ligne',
};

let templateCounter = 0;

function generateTemplateId() {
  return `template-${Date.now()}-${++templateCounter}`;
}

/**
 * Monte le composant d'outils de Gabarits du MJ.
 *
 * @param {HTMLElement} container Élément conteneur HTML
 * @param {TemplateToolsOptions} options
 */
export function createTemplateTools(container, options) {
  if (!container) {
    throw new Error('createTemplateTools : conteneur HTML requis');
  }

  const {
    getActiveLevelId,
    onClearTemplates,
    getTemplates,
    onRemoveTemplate,
    onArmChange,
    requestRender,
  } = options;

  let armed = false;
  /** @type {TemplateShape} */
  let shape = 'circle';
  let radiusCells = 4;
  // ⛔ Défaut 1, décidé le 16/08 : c'est la ligne d'un souffle ou d'un tir, pas une nappe.
  let widthCells = 1;
  let color = '#ef4444';
  let visibleToPlayers = true;
  let currentTemplateId = generateTemplateId();

  container.innerHTML = `
    <div class="template-tools-panel" style="display: flex; flex-direction: column; gap: 0.8rem; padding: 0.5rem 0;">
      <div style="font-weight: 600; font-size: 0.9rem; color: #eee; border-bottom: 1px solid #333; padding-bottom: 0.4rem;">
        📐 Gabarits de zone d'effet
      </div>

      <div style="display: flex; flex-direction: column; gap: 0.3rem;">
        <label style="font-size: 0.75rem; color: #aaa;">Forme du gabarit</label>
        <select id="tpl-shape" style="background: #2a2a2a; color: #fff; border: 1px solid #444; padding: 0.4rem; border-radius: 4px; font-size: 0.85rem;">
          <option value="circle" selected>Cercle (disque)</option>
          <option value="cone">Cône (60°)</option>
          <option value="line">Ligne (rectangle)</option>
        </select>
      </div>

      <div style="display: flex; flex-direction: column; gap: 0.3rem;">
        <label style="font-size: 0.75rem; color: #aaa;">Rayon (cases)</label>
        <div style="display: flex; align-items: center; gap: 0.4rem;">
          <input id="tpl-radius" type="number" min="1" max="20" value="${radiusCells}" style="flex: 1; background: #2a2a2a; color: #fff; border: 1px solid #444; padding: 0.4rem; border-radius: 4px; font-size: 0.85rem;" />
          <div style="display: flex; gap: 0.2rem;">
            <button class="tpl-rad-preset" data-rad="1" style="padding: 0.3rem 0.5rem; font-size: 0.75rem; background: #333; color: #ccc; border: 1px solid #444; border-radius: 4px; cursor: pointer;">1</button>
            <button class="tpl-rad-preset" data-rad="2" style="padding: 0.3rem 0.5rem; font-size: 0.75rem; background: #333; color: #ccc; border: 1px solid #444; border-radius: 4px; cursor: pointer;">2</button>
            <button class="tpl-rad-preset" data-rad="4" style="padding: 0.3rem 0.5rem; font-size: 0.75rem; background: #333; color: #ccc; border: 1px solid #444; border-radius: 4px; cursor: pointer;">4</button>
            <button class="tpl-rad-preset" data-rad="6" style="padding: 0.3rem 0.5rem; font-size: 0.75rem; background: #333; color: #ccc; border: 1px solid #444; border-radius: 4px; cursor: pointer;">6</button>
          </div>
        </div>
      </div>

      <div id="tpl-width-row" style="display: none; flex-direction: column; gap: 0.3rem;">
        <label style="font-size: 0.75rem; color: #aaa;">Largeur de la ligne (cases)</label>
        <div style="display: flex; align-items: center; gap: 0.4rem;">
          <input id="tpl-width" type="number" min="1" max="20" step="1" value="${widthCells}" style="flex: 1; background: #2a2a2a; color: #fff; border: 1px solid #444; padding: 0.4rem; border-radius: 4px; font-size: 0.85rem;" />
          <div style="display: flex; gap: 0.2rem;">
            <button class="tpl-width-preset" data-width="1" style="padding: 0.3rem 0.5rem; font-size: 0.75rem; background: #333; color: #ccc; border: 1px solid #444; border-radius: 4px; cursor: pointer;">1</button>
            <button class="tpl-width-preset" data-width="2" style="padding: 0.3rem 0.5rem; font-size: 0.75rem; background: #333; color: #ccc; border: 1px solid #444; border-radius: 4px; cursor: pointer;">2</button>
            <button class="tpl-width-preset" data-width="3" style="padding: 0.3rem 0.5rem; font-size: 0.75rem; background: #333; color: #ccc; border: 1px solid #444; border-radius: 4px; cursor: pointer;">3</button>
          </div>
        </div>
      </div>

      <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;">
        <label style="font-size: 0.75rem; color: #aaa;">Couleur</label>
        <div style="display: flex; align-items: center; gap: 0.5rem;">
          <input id="tpl-color" type="color" value="${color}" style="background: none; border: none; width: 32px; height: 32px; cursor: pointer;" />
          <button class="tpl-color-preset" data-color="#ef4444" style="width: 20px; height: 20px; border-radius: 50%; background: #ef4444; border: 1px solid #fff; cursor: pointer;"></button>
          <button class="tpl-color-preset" data-color="#3b82f6" style="width: 20px; height: 20px; border-radius: 50%; background: #3b82f6; border: 1px solid #fff; cursor: pointer;"></button>
          <button class="tpl-color-preset" data-color="#10b981" style="width: 20px; height: 20px; border-radius: 50%; background: #10b981; border: 1px solid #fff; cursor: pointer;"></button>
          <button class="tpl-color-preset" data-color="#f59e0b" style="width: 20px; height: 20px; border-radius: 50%; background: #f59e0b; border: 1px solid #fff; cursor: pointer;"></button>
        </div>
      </div>

      <div style="display: flex; align-items: center; gap: 0.5rem; margin-top: 0.2rem;">
        <input id="tpl-visible" type="checkbox" ${visibleToPlayers ? 'checked' : ''} style="cursor: pointer;" />
        <label for="tpl-visible" style="font-size: 0.8rem; color: #eee; cursor: pointer;">Visible par les joueurs</label>
      </div>

      <div style="display: flex; flex-direction: column; gap: 0.5rem; margin-top: 0.5rem;">
        <button id="tpl-toggle-arm" style="padding: 0.6rem; font-size: 0.85rem; font-weight: 600; background: #3b82f6; color: #fff; border: none; border-radius: 4px; cursor: pointer; transition: background 0.2s;">
          Poser un gabarit (désarmé)
        </button>
        <button id="tpl-clear-level" style="padding: 0.5rem; font-size: 0.8rem; background: #3a2a2a; color: #e0a0a0; border: 1px solid #5a3a3a; border-radius: 4px; cursor: pointer;">
          Effacer les gabarits de l'étage
        </button>
      </div>

      <div style="border-top: 1px solid #333; margin-top: 0.4rem; padding-top: 0.6rem;">
        <strong style="font-size: 0.8rem; color: #eee;">Gabarits posés sur cet étage</strong>
        <div id="tpl-list" style="display: grid; gap: 0.35rem; margin-top: 0.45rem;"></div>
      </div>
    </div>
  `;

  const btnArm = /** @type {HTMLButtonElement} */ (container.querySelector('#tpl-toggle-arm'));
  const btnClear = /** @type {HTMLButtonElement} */ (container.querySelector('#tpl-clear-level'));
  const inputRadius = /** @type {HTMLInputElement} */ (container.querySelector('#tpl-radius'));
  const inputColor = /** @type {HTMLInputElement} */ (container.querySelector('#tpl-color'));
  const selectShape = /** @type {HTMLSelectElement} */ (container.querySelector('#tpl-shape'));
  const checkVisible = /** @type {HTMLInputElement} */ (container.querySelector('#tpl-visible'));
  const list = /** @type {HTMLElement} */ (container.querySelector('#tpl-list'));
  const inputWidth = /** @type {HTMLInputElement} */ (container.querySelector('#tpl-width'));
  const widthRow = /** @type {HTMLElement} */ (container.querySelector('#tpl-width-row'));

  /**
   * La largeur ne s'affiche que pour la ligne : elle est validée quelle que soit la forme, mais
   * seule la ligne la lit. Un champ visible qui ne changerait rien au cercle posé serait un
   * mensonge de la même famille que celui de l'onglet Image.
   */
  function updateWidthRow() {
    if (!widthRow?.style) return;
    widthRow.style.display = shape === 'line' ? 'flex' : 'none';
  }

  /**
   * Reconstruit la liste des gabarits posés, un bouton de retrait par ligne.
   *
   * ⭐ **C'est le filet de l'appui long, et il est demandé pour ça.** Un gabarit sous un pion,
   * ou hors de l'écran après un déplacement de caméra, n'est pas atteignable au doigt. Sans
   * cette liste il reste des cas sans issue — le genre qui se découvre en séance, devant la
   * table, avec pour seul remède d'effacer tout l'étage.
   *
   * ⛔ **Elle ne montre que l'étage actif**, comme le bouton d'effacement juste au-dessus.
   * Lister les gabarits des autres étages offrirait un retrait dont l'effet est invisible à
   * l'écran : on ne saurait pas si le bon a été retiré. Le filet des autres étages est la barre
   * d'étage, qui les rend visibles avant de les toucher.
   */
  function refresh() {
    const all = getTemplates?.();
    // Sans source de gabarits, il n'y a pas de liste à tenir : le composant reste utilisable
    // pour la seule pose (c'est ainsi qu'il est monté dans les tests unitaires).
    if (!all || !list) return;

    const levelId = getActiveLevelId?.() ?? null;
    const posed = levelId ? all.filter((t) => t && t.levelId === levelId) : [];

    if (posed.length === 0) {
      const vide = document.createElement('p');
      vide.style.cssText = 'margin: 0; font-size: 0.75rem; color: #888;';
      vide.textContent = 'Aucun gabarit posé sur cet étage.';
      list.replaceChildren(vide);
      return;
    }

    list.replaceChildren(
      ...posed.map((t) => {
        const row = document.createElement('div');
        row.className = 'tpl-row';
        row.setAttribute('data-template-id', t.id);
        row.style.cssText =
          'display: flex; gap: 0.4rem; align-items: center; padding: 0.3rem 0.35rem; border: 1px solid #444; border-radius: 4px;';

        const chip = document.createElement('span');
        chip.style.cssText = `width: 12px; height: 12px; border-radius: 50%; flex: none; border: 1px solid #fff; background: ${t.color};`;

        const text = document.createElement('span');
        text.style.cssText = 'flex: 1; font-size: 0.75rem; color: #ddd;';
        const forme = SHAPE_LABEL_FR[t.shape] ?? t.shape;
        const largeur = t.shape === 'line' ? `, largeur ${t.widthCells ?? 1}` : '';
        const cache = t.visibleToPlayers ? '' : ' · MJ seul';
        text.textContent = `${forme} — rayon ${t.radiusCells}${largeur}${cache}`;

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'tpl-remove';
        remove.setAttribute('data-template-id', t.id);
        remove.style.cssText =
          'padding: 0.25rem 0.5rem; font-size: 0.7rem; background: #3a2a2a; color: #e0a0a0; border: 1px solid #5a3a3a; border-radius: 4px; cursor: pointer;';
        remove.textContent = 'Retirer';
        remove.addEventListener('click', () => {
          onRemoveTemplate?.(t.id);
          requestRender?.();
        });

        row.append(chip, text, remove);
        return row;
      })
    );
  }

  function updateUI() {
    if (armed) {
      btnArm.style.background = '#ef4444';
      btnArm.textContent = '📐 Outil gabarit ARMÉ (tap pour poser)';
    } else {
      btnArm.style.background = '#3b82f6';
      btnArm.textContent = 'Poser un gabarit (désarmé)';
    }
  }

  /** @param {boolean} value */
  function setArmed(value) {
    const next = Boolean(value);
    if (armed !== next) {
      armed = next;
      if (armed) {
        currentTemplateId = generateTemplateId();
      }
      updateUI();
      onArmChange?.(armed);
      requestRender?.();
    }
  }

  btnArm.addEventListener('click', () => {
    setArmed(!armed);
  });

  btnClear.addEventListener('click', () => {
    const levelId = getActiveLevelId?.();
    if (levelId) {
      onClearTemplates?.(levelId);
      requestRender?.();
    }
  });

  inputRadius.addEventListener('change', () => {
    const val = Math.max(1, Math.min(20, parseInt(inputRadius.value, 10) || 1));
    radiusCells = val;
    inputRadius.value = String(val);
  });

  inputColor.addEventListener('input', () => {
    color = inputColor.value;
  });

  inputWidth?.addEventListener('change', () => {
    const val = Math.max(1, Math.min(20, parseInt(inputWidth.value, 10) || 1));
    widthCells = val;
    inputWidth.value = String(val);
  });

  selectShape.addEventListener('change', () => {
    const val = /** @type {TemplateShape} */ (selectShape.value);
    if (val === 'circle' || val === 'cone' || val === 'line') shape = val;
    updateWidthRow();
  });

  checkVisible.addEventListener('change', () => {
    visibleToPlayers = checkVisible.checked;
  });

  container.querySelectorAll('.tpl-rad-preset').forEach((btn) => {
    btn.addEventListener('click', () => {
      const rad = parseInt(btn.getAttribute('data-rad') || '4', 10);
      radiusCells = rad;
      inputRadius.value = String(rad);
    });
  });

  container.querySelectorAll('.tpl-width-preset').forEach((btn) => {
    btn.addEventListener('click', () => {
      const w = parseInt(btn.getAttribute('data-width') || '1', 10);
      widthCells = w;
      if (inputWidth) inputWidth.value = String(w);
    });
  });

  container.querySelectorAll('.tpl-color-preset').forEach((btn) => {
    btn.addEventListener('click', () => {
      const c = btn.getAttribute('data-color') || '#ef4444';
      color = c;
      inputColor.value = c;
    });
  });

  updateWidthRow();
  refresh();

  return {
    isArmed: () => armed,
    setArmed,
    disarm: () => setArmed(false),
    refresh,
    getConfig: () => ({
      templateId: currentTemplateId,
      shape,
      radiusCells,
      widthCells,
      color,
      visibleToPlayers,
    }),
  };
}

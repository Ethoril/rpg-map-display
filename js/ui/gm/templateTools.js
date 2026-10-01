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
    <div class="template-tools-panel gm-stack">
      <div class="gm-stack" style="gap: 4px;">
        <label class="gm-muted" for="tpl-shape">Forme du gabarit</label>
        <select id="tpl-shape">
          <option value="circle" selected>Cercle (disque)</option>
          <option value="cone">Cône (60°)</option>
          <option value="line">Ligne (rectangle)</option>
        </select>
      </div>

      <div class="gm-stack" style="gap: 4px;">
        <label class="gm-muted" for="tpl-radius">Rayon (cases)</label>
        <div class="gm-row" style="flex-wrap: nowrap;">
          <input id="tpl-radius" type="number" min="1" max="20" value="${radiusCells}" style="flex: 1; min-width: 0;" />
          <div class="gm-row" style="gap: 4px; flex-wrap: nowrap;">
            <button class="tpl-rad-preset gm-btn--sm" data-rad="1">1</button>
            <button class="tpl-rad-preset gm-btn--sm" data-rad="2">2</button>
            <button class="tpl-rad-preset gm-btn--sm" data-rad="4">4</button>
            <button class="tpl-rad-preset gm-btn--sm" data-rad="6">6</button>
          </div>
        </div>
      </div>

      <div id="tpl-width-row" hidden>
        <div class="gm-stack" style="gap: 4px;">
          <label class="gm-muted" for="tpl-width">Largeur de la ligne (cases)</label>
          <div class="gm-row" style="flex-wrap: nowrap;">
            <input id="tpl-width" type="number" min="1" max="20" step="1" value="${widthCells}" style="flex: 1; min-width: 0;" />
            <div class="gm-row" style="gap: 4px; flex-wrap: nowrap;">
              <button class="tpl-width-preset gm-btn--sm" data-width="1">1</button>
              <button class="tpl-width-preset gm-btn--sm" data-width="2">2</button>
              <button class="tpl-width-preset gm-btn--sm" data-width="3">3</button>
            </div>
          </div>
        </div>
      </div>

      <div class="gm-field">
        <label class="gm-muted" for="tpl-color">Couleur</label>
        <div class="gm-row">
          <input id="tpl-color" type="color" value="${color}" />
          <button class="tpl-color-preset" data-color="#ef4444" aria-label="Rouge" style="width: 20px; height: 20px; min-height: 0; padding: 0; border-radius: 50%; background: #ef4444; border: 1px solid var(--gm-texte);"></button>
          <button class="tpl-color-preset" data-color="#3b82f6" aria-label="Bleu" style="width: 20px; height: 20px; min-height: 0; padding: 0; border-radius: 50%; background: #3b82f6; border: 1px solid var(--gm-texte);"></button>
          <button class="tpl-color-preset" data-color="#10b981" aria-label="Vert" style="width: 20px; height: 20px; min-height: 0; padding: 0; border-radius: 50%; background: #10b981; border: 1px solid var(--gm-texte);"></button>
          <button class="tpl-color-preset" data-color="#f59e0b" aria-label="Ambre" style="width: 20px; height: 20px; min-height: 0; padding: 0; border-radius: 50%; background: #f59e0b; border: 1px solid var(--gm-texte);"></button>
        </div>
      </div>

      <label class="gm-check" for="tpl-visible">
        <input id="tpl-visible" type="checkbox" ${visibleToPlayers ? 'checked' : ''} />
        Visible par les joueurs
      </label>

      <div class="gm-stack">
        <button id="tpl-toggle-arm" class="gm-btn--primary gm-btn--block">
          Poser un gabarit (désarmé)
        </button>
        <button id="tpl-clear-level" class="gm-btn--danger gm-btn--block">
          Effacer les gabarits de l'étage
        </button>
      </div>

      <div class="gm-subsection">
        <h4 class="gm-h">Gabarits posés sur cet étage</h4>
        <div id="tpl-list" class="gm-stack" style="gap: 6px;"></div>
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
    if (!widthRow) return;
    widthRow.hidden = shape !== 'line';
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
  /** Signature de la dernière liste rendue — voir `refresh`. */
  let signatureRendue = /** @type {string|null} */ (null);

  function refresh() {
    const all = getTemplates?.();
    // Sans source de gabarits, il n'y a pas de liste à tenir : le composant reste utilisable
    // pour la seule pose (c'est ainsi qu'il est monté dans les tests unitaires).
    if (!all || !list) return;

    const levelId = getActiveLevelId?.() ?? null;
    const posed = levelId ? all.filter((t) => t && t.levelId === levelId) : [];

    // ⛔ Ne reconstruire que si la liste a changé (audit du 22/09, B8). Le panneau appelle
    // ceci à chaque notification du store, fog et vision compris : reconstruire à chaque fois
    // remplaçait le bouton « Retirer » entre l'appui et le relâchement, et le clic était perdu.
    const signature = JSON.stringify([levelId, posed]);
    if (signature === signatureRendue) return;
    signatureRendue = signature;

    if (posed.length === 0) {
      const vide = document.createElement('p');
      vide.className = 'gm-hint';
      vide.textContent = 'Aucun gabarit posé sur cet étage.';
      list.replaceChildren(vide);
      return;
    }

    list.replaceChildren(
      ...posed.map((t) => {
        const row = document.createElement('div');
        row.className = 'tpl-row gm-reserve-row';
        row.setAttribute('data-template-id', t.id);

        // Couleur de DONNÉES : celle que le MJ a choisie pour ce gabarit.
        const chip = document.createElement('span');
        chip.className = 'gm-reserve-swatch';
        chip.style.background = t.color;

        const text = document.createElement('span');
        text.className = 'gm-reserve-text';
        const forme = SHAPE_LABEL_FR[t.shape] ?? t.shape;
        const largeur = t.shape === 'line' ? `, largeur ${t.widthCells ?? 1}` : '';
        const cache = t.visibleToPlayers ? '' : ' · MJ seul';
        text.textContent = `${forme} — rayon ${t.radiusCells}${largeur}${cache}`;

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'tpl-remove gm-btn--danger gm-btn--sm';
        remove.setAttribute('data-template-id', t.id);
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
    btnArm.ariaPressed = String(armed);
    if (armed) {
      btnArm.textContent = 'Outil gabarit ARMÉ (tap pour poser)';
    } else {
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

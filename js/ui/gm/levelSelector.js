// @ts-check

/**
 * Options d'initialisation du sélecteur d'étage MJ.
 * @typedef {Object} LevelSelectorOptions
 * @property {() => { id: string, name?: string }[]} getLevels - Renvoie les résumés des étages de la campagne
 * @property {() => string | null} getActiveLevelId - Renvoie l'identifiant de l'étage actif
 * @property {(levelId: string) => void} onSelectLevel - Rappel lors de la sélection d'un étage par le MJ
 */

/**
 * Interface retournée par createLevelSelector.
 * @typedef {Object} LevelSelector
 * @property {() => void} update - Met à jour les options et la sélection en fonction de l'état
 * @property {() => boolean} isLevelFollowLocked - Le cadenas de bascule automatique est-il armé ?
 * @property {() => void} destroy - Nettoie les écouteurs d'événements
 */

/**
 * Crée le sélecteur d'étage du panneau MJ avec son cadenas de suivi.
 *
 * @param {HTMLElement} container Élément conteneur de la barre d'étage
 * @param {LevelSelectorOptions} options
 * @returns {LevelSelector}
 */
export function createLevelSelector(container, options) {
  if (!container) {
    throw new Error('createLevelSelector : conteneur HTML requis');
  }

  const listeners = new AbortController();

  container.innerHTML = `
    <span style="font-size: 0.7rem; color: #888; text-transform: uppercase; letter-spacing: 0.5px;">Étage</span>
    <select id="gm-level-select" style="flex: 1; padding: 0.35rem; background: #1a1a1a; color: #fff; border: 1px solid #444; border-radius: 4px; font-size: 0.85rem;"></select>
    <button id="gm-level-lock" type="button" aria-pressed="false" title="Cadenas : suspend la bascule automatique quand un pion change d'étage. Les pions montent quand même." style="padding: 0.3rem 0.55rem; font-size: 0.9rem; background: #1a1a1a; color: #888; border: 1px solid #444; border-radius: 4px; cursor: pointer;">🔓</button>
    <span id="gm-level-status" style="font-size: 0.7rem; color: #888;"></span>
  `;

  const levelSelect = /** @type {HTMLSelectElement} */ (container.querySelector('#gm-level-select'));
  const levelLockBtn = /** @type {HTMLButtonElement} */ (container.querySelector('#gm-level-lock'));
  const levelStatus = /** @type {HTMLElement} */ (container.querySelector('#gm-level-status'));

  // ── Cadenas de bascule automatique (Lot 3, S-04) ─────────────────────────────────────────
  //
  // Purement local au poste MJ, et **volontairement pas dans la campagne** : c'est un réglage de
  // conduite de séance, pas un fait de jeu. Le mettre dans le document le ferait voyager jusqu'aux
  // tablettes et survivre à la partie, alors qu'il ne concerne que ce que le MJ veut montrer dans
  // les dix prochaines minutes.
  let levelFollowLocked = false;

  function renderLevelLock() {
    levelLockBtn.textContent = levelFollowLocked ? '🔒' : '🔓';
    levelLockBtn.setAttribute('aria-pressed', String(levelFollowLocked));
    levelLockBtn.style.background = levelFollowLocked ? '#3a2f1a' : '#1a1a1a';
    levelLockBtn.style.color = levelFollowLocked ? '#e0c080' : '#888';
    levelLockBtn.style.borderColor = levelFollowLocked ? '#6a5530' : '#444';
    levelStatus.style.color = '#888';
    levelStatus.textContent = levelFollowLocked ? 'bascule auto suspendue' : '';
  }

  levelLockBtn.addEventListener(
    'click',
    () => {
      levelFollowLocked = !levelFollowLocked;
      renderLevelLock();
    },
    { signal: listeners.signal }
  );
  renderLevelLock();

  levelSelect.addEventListener(
    'change',
    () => {
      const cible = levelSelect.value;
      if (!cible || cible === options.getActiveLevelId()) return;
      try {
        options.onSelectLevel(cible);
        levelStatus.style.color = '#888';
        levelStatus.textContent = '';
      } catch (err) {
        levelStatus.style.color = '#e74c3c';
        levelStatus.textContent = err instanceof Error ? err.message : String(err);
        update();
      }
    },
    { signal: listeners.signal }
  );

  /**
   * Reflète les étages de la campagne et l'étage actif.
   *
   * ⚠ Ne reconstruit les options que si la **liste** a changé. Les reconstruire à chaque
   * notification du store — donc à chaque déplacement de pion — refermerait la liste déroulante
   * sous le doigt du MJ en pleine sélection, et ferait clignoter le champ pendant les animations.
   */
  function update() {
    const etages = options.getLevels();
    const actif = options.getActiveLevelId();

    // Un seul étage : la barre n'apporte rien, elle disparaît.
    container.style.display = etages.length > 1 ? 'flex' : 'none';
    if (etages.length === 0) return;

    // Signature explicite, lisible et sans caractères de contrôle littéraux.
    const signature = JSON.stringify(etages.map((l) => [l.id, l.name]));
    if (levelSelect.dataset.signature !== signature) {
      levelSelect.dataset.signature = signature;
      levelSelect.replaceChildren(
        ...etages.map((l) => {
          const opt = document.createElement('option');
          opt.value = l.id;
          opt.textContent = l.name || l.id;
          return opt;
        })
      );
    }
    if (actif && levelSelect.value !== actif) levelSelect.value = actif;
  }

  update();

  return {
    update,
    isLevelFollowLocked: () => levelFollowLocked,
    destroy: () => listeners.abort(),
  };
}

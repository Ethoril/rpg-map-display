// @ts-check

/**
 * Options d'initialisation du sélecteur d'étage MJ.
 * @typedef {Object} LevelSelectorOptions
 * @property {() => { id: string, name?: string }[]} getLevels - Renvoie les résumés des étages de la campagne
 * @property {() => string | null} getActiveLevelId - Renvoie l'identifiant de l'étage actif
 * @property {(levelId: string) => void} onSelectLevel - Rappel lors de la sélection d'un étage par le MJ
 * @property {(levelId: string) => void} [onShowLevel] - Rappel quand le MJ publie l'étage actif vers la tablette (UX-15).
 *   Sans transport dedans : ce module ne le connaît pas, le câblage se fait chez l'appelant.
 */

/**
 * Interface retournée par createLevelSelector.
 * @typedef {Object} LevelSelector
 * @property {() => void} update - Met à jour les options et la sélection en fonction de l'état
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
    <select id="gm-level-select" style="flex: 1; min-width: 0; padding: 0.35rem; background: #1a1a1a; color: #fff; border: 1px solid #444; border-radius: 4px; font-size: 0.85rem;"></select>
    <button id="gm-level-show" type="button" title="Publie cet étage sur la tablette des joueurs" style="flex-shrink: 0; white-space: nowrap; padding: 0.35rem 0.5rem; background: #1a1a1a; color: #fff; border: 1px solid #444; border-radius: 4px; font-size: 0.85rem;">Emmener la table</button>
    <span id="gm-level-status" style="font-size: 0.7rem; color: #888;"></span>
  `;

  const levelSelect = /** @type {HTMLSelectElement} */ (container.querySelector('#gm-level-select'));
  const showLevelBtn = /** @type {HTMLButtonElement} */ (container.querySelector('#gm-level-show'));
  const levelStatus = /** @type {HTMLElement} */ (container.querySelector('#gm-level-status'));

  // ⛔ **Le cadenas 🔒 a été retiré par UX-10 (18/08/2026).**
  //
  // Il ne servait qu'à se soustraire à la bascule automatique du MJ quand un pion changeait
  // d'étage. Cette bascule n'existe plus : un franchissement ne déplace désormais AUCUN écran,
  // parce que la vue joueurs est une seule tablette partagée et que suivre le pion qui monte
  // abandonnait les personnages restés en bas.
  //
  // ⚠ Ne pas le remettre « au cas où » : un cadenas qui ne suspend plus rien est un contrôle
  // qui ment, et c'est le défaut que ce lot corrige partout ailleurs. Ce qui reste vrai de son
  // commentaire d'origine — un réglage de conduite de séance n'entre pas dans la campagne —
  // vaut maintenant pour l'étage affiché de la vue joueurs, qui est local lui aussi.

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

  // ── UX-15 : emmener la table sur l'étage affiché du MJ ──────────────────────────────────
  //
  // ⛔ Un geste, pas un couplage restauré (« rien ne se déplace dans le dos de personne »).
  // Le bouton publie `level.show` avec l'étage **actuellement actif du MJ** ; il ne fait rien
  // de plus — aucun pion ne bouge, aucun étage du MJ ne change.
  showLevelBtn.addEventListener(
    'click',
    () => {
      const actif = options.getActiveLevelId();
      if (!actif || !options.onShowLevel) return;
      try {
        options.onShowLevel(actif);
        levelStatus.style.color = '#888';
        // ⚠ **Honnête, pas optimiste.** L'étage affiché par la tablette ne circule pas vers le
        // MJ — rien ne le lui dirait s'il se trompait de route ou perdait la connexion entre
        // la publication et l'écran. Le statut n'annonce donc que ce que CE poste vient de
        // PUBLIER, jamais ce que la table montre réellement : c'est le mensonge d'interface que
        // ce dépôt corrige partout ailleurs (fog, vision, lumière), pas une place pour en semer un.
        const nom = options.getLevels().find((l) => l.id === actif)?.name || actif;
        levelStatus.textContent = `publié : ${nom}`;
      } catch (err) {
        levelStatus.style.color = '#e74c3c';
        levelStatus.textContent = err instanceof Error ? err.message : String(err);
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
    destroy: () => listeners.abort(),
  };
}

// @ts-check

/**
 * Options du sélecteur d'étage de la vue joueurs (UX-12).
 *
 * @typedef {Object} PlayerLevelSelectorOptions
 * @property {() => { id: string, name?: string }[]} getLevels Résumés des étages de la campagne
 * @property {() => string | null} getActiveLevelId Étage affiché par la table
 * @property {(levelId: string) => boolean} isKnown L'étage est-il **connu des joueurs** ?
 * @property {(levelId: string) => void} onSelectLevel Choix local, qui ne publie rien
 */

/**
 * Barre d'onglets d'étage de la vue joueurs.
 *
 * ## ✅ Aucune dérogation à demander
 *
 * L'interdiction n°2 de `docs/CONVENTIONS.md` — « ne jamais ajouter d'élément d'interface à la
 * vue joueurs » — **liste déjà le sélecteur d'étage** parmi ce qui a le droit de s'afficher. La
 * convention l'avait prévu ; il n'avait jamais été construit.
 *
 * ## ⛔ Un étage inconnu est ABSENT, pas grisé
 *
 * Et pour une raison que la version grisée aurait ratée : un onglet « Étage 3 » verrouillé
 * apprend aux joueurs qu'il **existe** un troisième étage. C'est une fuite de la même famille que
 * celles que le fog empêche. Le projet de référence retire purement les étages non révélés ; on
 * fait parein, mais sans reprendre son retard d'accessibilité.
 *
 * ## ⛔ La forme est reprise de la référence, son accessibilité NON
 *
 * La référence n'a aucun `role`, aucun `aria-*`, aucune gestion des flèches. La barre d'onglets
 * MJ de ce dépôt est conforme depuis R0-04 : celle-ci l'est aussi. On reprend la forme, pas le
 * retard.
 *
 * @param {HTMLElement} container
 * @param {PlayerLevelSelectorOptions} options
 */
export function createPlayerLevelSelector(container, options) {
  if (!container) {
    throw new Error('createPlayerLevelSelector : conteneur HTML requis');
  }

  const listeners = new AbortController();

  container.setAttribute('role', 'tablist');
  container.setAttribute('aria-label', 'Étage affiché');

  /** @type {string[]} */
  let ordreAffiche = [];

  /**
   * @param {string} levelId
   * @param {string} nom
   * @param {boolean} actif
   * @returns {HTMLButtonElement}
   */
  function creerOnglet(levelId, nom, actif) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'player-level-tab';
    btn.dataset.levelId = levelId;
    btn.textContent = nom;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', String(actif));
    // ⚠ `tabindex` glissant, comme la barre MJ : un seul onglet est atteignable au Tab, et les
    // flèches circulent entre eux. Sans cela, une barre de six étages coûte six Tab pour la
    // traverser.
    btn.tabIndex = actif ? 0 : -1;
    btn.addEventListener('click', () => options.onSelectLevel(levelId), {
      signal: listeners.signal,
    });
    return btn;
  }

  container.addEventListener(
    'keydown',
    (evt) => {
      const touches = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
      if (!touches.includes(evt.key)) return;
      if (ordreAffiche.length === 0) return;
      evt.preventDefault();

      const actuel = options.getActiveLevelId();
      const index = Math.max(0, ordreAffiche.indexOf(actuel ?? ''));
      let cible = index;
      if (evt.key === 'ArrowLeft') cible = (index - 1 + ordreAffiche.length) % ordreAffiche.length;
      else if (evt.key === 'ArrowRight') cible = (index + 1) % ordreAffiche.length;
      else if (evt.key === 'Home') cible = 0;
      else if (evt.key === 'End') cible = ordreAffiche.length - 1;

      const idCible = ordreAffiche[cible];
      if (idCible && idCible !== actuel) options.onSelectLevel(idCible);
      const btn = /** @type {HTMLElement|null} */ (
        container.querySelector(`[data-level-id="${idCible}"]`)
      );
      btn?.focus();
    },
    { signal: listeners.signal }
  );

  /**
   * Reconstruit la barre depuis les étages **connus**.
   *
   * ⚠ Ne reconstruit que si la liste ou l'étage actif a changé. Le masque exploré de l'étage
   * affiché est republié environ une fois par seconde pendant qu'un pion bouge : reconstruire à
   * chaque notification ferait perdre le focus clavier et clignoter la barre sous le doigt.
   */
  function update() {
    const connus = options.getLevels().filter((l) => options.isKnown(l.id));
    const actif = options.getActiveLevelId();

    // Un seul étage connu : la barre n'apporte rien, elle disparaît — même règle que la barre
    // d'étage du MJ, et elle compte double ici, où l'écran doit rester une carte et rien d'autre.
    container.style.display = connus.length > 1 ? 'flex' : 'none';

    const signature = JSON.stringify([connus.map((l) => [l.id, l.name]), actif]);
    if (container.dataset.signature === signature) return;
    container.dataset.signature = signature;

    ordreAffiche = connus.map((l) => l.id);
    container.replaceChildren(
      ...connus.map((l) => creerOnglet(l.id, l.name || l.id, l.id === actif))
    );
  }

  update();

  return {
    update,
    destroy: () => {
      listeners.abort();
      container.replaceChildren();
    },
  };
}

// @ts-check

import { createLink } from '../../core/schema.js';

/** @typedef {import('../../core/types.js').Link} Link */
/** @typedef {import('../../core/types.js').Cell} Cell */
/** @typedef {{ levelId: string, at: { cellX: number, cellY: number } }} LinkEndpoint */
/** @typedef {{ a: LinkEndpoint|null, b: LinkEndpoint|null, attente: 'a'|'b'|null }} LinkDraft */

/**
 * Éditeur de liaisons d'étages — départ et arrivée désignés **du même geste**.
 *
 * ⭐ **Refonte du 19/11/2026, et c'est une refonte d'interface seule** : l'objet `Link` produit,
 * son écriture et la liste des liaisons existantes sont inchangés. Ce qui change est la façon de
 * désigner les deux points, parce que l'ancienne était **asymétrique et muette** :
 *
 *  1. Le départ se posait en armant puis en tapant la carte ; l'arrivée, elle, se remplissait par
 *     un clic **non armé** sur la carte — un geste que rien n'annonçait, et qui ressemblait trait
 *     pour trait à un clic perdu.
 *  2. L'étage d'arrivée avait **deux sources** qui pouvaient diverger : l'étage affiché, sur lequel
 *     on tapait la case, et un menu « Étage B » qui, lui, partait dans le fichier. C'est ce que le
 *     9 août 2026 a coûté — un escalier relié au mauvais niveau.
 *  3. La ligne d'état se rafraîchissait sur l'événement `input` des champs de case. Or remplir un
 *     champ depuis le code n'émet pas `input` : dans le seul chemin qui remplissait l'arrivée, elle
 *     restait **en retard d'un clic**, et affichait « case 0, 0 » pour une case vide — `Number('')`
 *     vaut 0. Elle mentait exactement là où on l'avait écrite pour relire.
 *
 * ⛔ **La règle qui remplace tout cela : une extrémité est l'étage affiché au moment de la tape.**
 * Un seul fait, lu au même endroit par l'œil et par le code, donc aucun écart possible. Le menu
 * « Étage B » et les champs de coordonnées n'existent plus — ⚠ ne pas les réintroduire « pour
 * dépanner » : ce sont eux, la deuxième source.
 *
 * L'affichage est rendu depuis l'état, jamais depuis les champs de saisie : il ne peut plus être
 * en retard sur ce qui est posé.
 *
 * @param {HTMLElement} container
 * @param {{
 *   getLevels: () => {id: string, name: string}[],
 *   getLinks: () => Link[],
 *   onAdd: (link: Link) => void,
 *   onRemove: (id: string) => void,
 *   onArmChange?: (armed: boolean) => void,
 *   onShowLevel?: (levelId: string) => void,
 *   getDisplayedLevelId?: () => string|null,
 *   requestRender?: () => void,
 * }} options
 */
export function createLinkEditor(container, options) {
  /**
   * Quelle extrémité attend une tape sur la carte, s'il y en a une.
   * `null` = aucune : une tape ne pose plus rien, et c'est ce que `isArmed()` rapporte aux hôtes.
   * @type {'a'|'b'|null}
   */
  let attente = null;
  /** @type {LinkEndpoint|null} */
  let endpointA = null;
  /** @type {LinkEndpoint|null} */
  let endpointB = null;
  /** @type {string|null} */
  let selectedLinkId = null;
  /**
   * Ce que le rendu de carte doit dessiner de la liaison **en cours de composition**.
   *
   * ⚠ Refabriqué dans `refresh()` seulement, jamais à la lecture : `getDraft()` est appelé à
   * chaque image par la boucle de rendu du MJ, et rendre un objet neuf à chaque appel ferait du
   * déchet à 60 images par seconde pour une valeur qui ne change qu'au clic.
   * @type {LinkDraft}
   */
  let draft = { a: null, b: null, attente: null };

  container.innerHTML = `
    <section class="gm-section">
      <h3>↕ Liaisons d'étages</h3>
      <p id="link-hint" style="font-size:.8rem;color:var(--gm-info, #9cc8ff);min-height:2.4rem;margin:.2rem 0 .6rem"></p>

      <div id="link-step-a" style="border:1px solid var(--gm-trait-fort, #444);border-radius:4px;padding:.45rem .55rem;margin-bottom:.4rem">
        <div style="display:flex;align-items:baseline;gap:.4rem">
          <strong style="font-size:.85rem">1. Départ</strong>
          <span id="link-a-state" style="flex:1;font-size:.8rem;color:var(--gm-texte, #eee)"></span>
        </div>
        <button id="link-pick-a" class="gm-btn" type="button" style="width:100%;margin-top:.4rem"></button>
      </div>

      <div id="link-step-b" style="border:1px solid var(--gm-trait-fort, #444);border-radius:4px;padding:.45rem .55rem">
        <div style="display:flex;align-items:baseline;gap:.4rem">
          <strong style="font-size:.85rem">2. Arrivée</strong>
          <span id="link-b-state" style="flex:1;font-size:.8rem;color:var(--gm-texte, #eee)"></span>
        </div>
        <div id="link-level-choices" style="display:flex;flex-wrap:wrap;gap:.3rem;margin-top:.4rem"></div>
        <button id="link-pick-b" class="gm-btn" type="button" style="width:100%;margin-top:.4rem"></button>
      </div>

      <div id="link-form" style="display:grid;grid-template-columns:auto 1fr;gap:.5rem .65rem;align-items:center;margin-top:.6rem">
        <label for="link-kind">Type</label><select id="link-kind"><option value="stairs">Escalier</option><option value="elevator">Ascenseur</option><option value="ladder">Échelle</option><option value="hatch">Trappe</option><option value="passage">Passage</option></select>
        <label for="link-label">Libellé</label><input id="link-label" type="text" maxlength="80" placeholder="Escalier nord" />
        <label for="link-one-way">Sens unique</label><input id="link-one-way" type="checkbox" />
        <label for="link-gm-only">MJ seul</label><input id="link-gm-only" type="checkbox" />
      </div>

      <button id="link-create" class="gm-btn gm-btn-primary" type="button" style="width:100%;margin-top:.75rem" disabled>Créer la liaison</button>
      <p id="link-error" style="min-height:1.2rem;color:var(--gm-sang, #f87171);font-size:.8rem"></p>
      <div style="border-top:1px solid var(--gm-trait-fort, #444);margin-top:.75rem;padding-top:.75rem"><strong style="font-size:.85rem">Liaisons existantes</strong><div id="link-list" style="display:grid;gap:.35rem;margin-top:.45rem"></div></div>
    </section>`;

  const hint = /** @type {HTMLElement} */ (container.querySelector('#link-hint'));
  const stepA = /** @type {HTMLElement} */ (container.querySelector('#link-step-a'));
  const stepB = /** @type {HTMLElement} */ (container.querySelector('#link-step-b'));
  const stateA = /** @type {HTMLElement} */ (container.querySelector('#link-a-state'));
  const stateB = /** @type {HTMLElement} */ (container.querySelector('#link-b-state'));
  const pickA = /** @type {HTMLButtonElement} */ (container.querySelector('#link-pick-a'));
  const pickB = /** @type {HTMLButtonElement} */ (container.querySelector('#link-pick-b'));
  const levelChoices = /** @type {HTMLElement} */ (container.querySelector('#link-level-choices'));
  const create = /** @type {HTMLButtonElement} */ (container.querySelector('#link-create'));
  const error = /** @type {HTMLElement} */ (container.querySelector('#link-error'));
  const list = /** @type {HTMLElement} */ (container.querySelector('#link-list'));
  const kind = /** @type {HTMLSelectElement} */ (container.querySelector('#link-kind'));
  const label = /** @type {HTMLInputElement} */ (container.querySelector('#link-label'));
  const oneWay = /** @type {HTMLInputElement} */ (container.querySelector('#link-one-way'));
  const gmOnly = /** @type {HTMLInputElement} */ (container.querySelector('#link-gm-only'));

  /** @param {string} levelId */
  const nomDe = (levelId) => options.getLevels().find((level) => level.id === levelId)?.name ?? levelId;

  /** @param {LinkEndpoint} endpoint */
  const direLExtremite = (endpoint) => `${nomDe(endpoint.levelId)} — case ${endpoint.at.cellX}, ${endpoint.at.cellY}`;

  /** Étages où l'arrivée peut se poser : tous sauf celui du départ. */
  function candidatsB() {
    const levels = options.getLevels();
    return endpointA ? levels.filter((level) => level.id !== endpointA?.levelId) : levels;
  }

  function refresh() {
    const candidats = candidatsB();
    const affiche = options.getDisplayedLevelId?.() ?? null;

    // ── Départ ────────────────────────────────────────────────────────────────────────────
    stateA.textContent = endpointA ? direLExtremite(endpointA) : 'à désigner';
    stateA.style.color = endpointA ? 'var(--gm-texte, #eee)' : 'var(--gm-texte-2, #aaa)';
    pickA.textContent = attente === 'a'
      ? 'Annuler'
      : endpointA
        ? 'Refaire le départ'
        : 'Désigner le départ';
    pickA.classList.toggle('gm-btn-active', attente === 'a');
    stepA.style.borderColor = attente === 'a' ? 'var(--gm-laiton, #f5a623)' : 'var(--gm-trait-fort, #444)';

    // ── Arrivée ───────────────────────────────────────────────────────────────────────────
    stateB.textContent = endpointB ? direLExtremite(endpointB) : 'à désigner';
    stateB.style.color = endpointB ? 'var(--gm-texte, #eee)' : 'var(--gm-texte-2, #aaa)';
    pickB.textContent = attente === 'b'
      ? 'Annuler'
      : endpointB
        ? 'Refaire l’arrivée'
        : 'Désigner l’arrivée';
    pickB.classList.toggle('gm-btn-active', attente === 'b');
    pickB.disabled = candidats.length === 0;
    stepB.style.borderColor = attente === 'b' ? 'var(--gm-laiton, #f5a623)' : 'var(--gm-trait-fort, #444)';

    // Les étages possibles, en boutons — et c'est ce qui rend « changez d'étage » faisable plutôt
    // qu'à lire : un clic emmène la vue sur l'étage, la tape suivante y pose l'arrivée.
    // ⛔ La vue ne se déplace que sur ce clic-là. Rien n'emmène l'écran ailleurs tout seul.
    levelChoices.replaceChildren(
      ...(attente === 'b'
        ? candidats.map((level) => {
            const bouton = document.createElement('button');
            bouton.type = 'button';
            bouton.className = 'gm-btn';
            bouton.dataset.levelId = level.id;
            bouton.textContent = level.name;
            bouton.style.fontSize = '.78rem';
            bouton.classList.toggle('gm-btn-active', level.id === affiche);
            bouton.addEventListener('click', () => {
              options.onShowLevel?.(level.id);
              refresh();
              options.requestRender?.();
            });
            return bouton;
          })
        : [])
    );

    // ── L'invite : ce qu'il reste à faire, en toutes lettres ───────────────────────────────
    if (candidats.length === 0) {
      hint.textContent = 'Cette scène n’a qu’un étage : il n’y a rien à relier.';
    } else if (attente === 'a') {
      hint.textContent = 'Tapez sur la carte la case du départ. Elle sera posée sur l’étage affiché.';
    } else if (attente === 'b') {
      hint.textContent = endpointA
        ? `Départ posé sur ${nomDe(endpointA.levelId)}. Allez sur l’étage d’arrivée — ci-dessous ou en haut — puis tapez la case.`
        : 'Allez sur l’étage d’arrivée, puis tapez la case.';
    } else if (endpointA && endpointB) {
      hint.textContent = 'Les deux extrémités sont posées : relisez-les, puis créez la liaison.';
    } else {
      hint.textContent = 'Une liaison relie une case d’un étage à une case d’un autre. Désignez le départ pour commencer.';
    }

    // ── Création ──────────────────────────────────────────────────────────────────────────
    create.disabled = !endpointA || !endpointB;
    create.title = create.disabled
      ? !endpointA
        ? 'Le départ n’est pas posé.'
        : 'L’arrivée n’est pas posée.'
      : '';

    // ── Liaisons existantes ───────────────────────────────────────────────────────────────
    // Les étages s'y lisent par leur NOM : `armes-du-templier-etage-1:18,10` demandait de traduire
    // de tête un identifiant de fichier pour relire ce qu'on vient de poser.
    list.replaceChildren(...options.getLinks().map((link) => {
      const row = document.createElement('div');
      row.style.cssText = `display:flex;gap:.35rem;align-items:center;padding:.35rem;border:1px solid ${selectedLinkId === link.id ? 'var(--gm-laiton, #f5a623)' : 'var(--gm-trait-fort, #444)'};border-radius:4px`;
      const text = document.createElement('span');
      text.style.flex = '1';
      text.style.fontSize = '.8rem';
      text.textContent =
        `${link.label || link.kind} (${direLExtremite(link.a)} ${link.bidirectional ? '↔' : '→'} ` +
        `${direLExtremite(link.b)})${link.gmOnly ? ' · MJ' : ''}`;
      const select = document.createElement('button');
      select.type = 'button';
      select.className = 'gm-btn';
      select.textContent = 'Voir';
      select.addEventListener('click', () => { selectedLinkId = link.id; options.requestRender?.(); refresh(); });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'gm-btn';
      remove.textContent = 'Supprimer';
      remove.addEventListener('click', () => { options.onRemove(link.id); if (selectedLinkId === link.id) selectedLinkId = null; refresh(); });
      row.append(text, select, remove);
      return row;
    }));

    draft = { a: endpointA, b: endpointB, attente };
  }

  /**
   * Met une extrémité en attente de tape, et une seule : armer l'arrivée désarme le départ.
   * @param {'a'|'b'} cible
   */
  function demander(cible) {
    error.textContent = '';
    attente = attente === cible ? null : cible;
    options.onArmChange?.(attente !== null);
    refresh();
    options.requestRender?.();
  }

  pickA.addEventListener('click', () => demander('a'));
  pickB.addEventListener('click', () => demander('b'));

  create.addEventListener('click', () => {
    error.textContent = '';
    if (!endpointA || !endpointB) {
      error.textContent = 'Les deux extrémités doivent être posées sur la carte.';
      return;
    }
    try {
      options.onAdd(createLink({
        kind: /** @type {any} */ (kind.value),
        label: label.value.trim(),
        a: endpointA,
        b: endpointB,
        bidirectional: !oneWay.checked,
        gmOnly: gmOnly.checked,
      }));
      // ⛔ Rien ne reste armé après une création : un outil encore actif reposerait une extrémité
      // au prochain clic, des minutes plus tard, sans que rien ne l'ait annoncé.
      endpointA = null;
      endpointB = null;
      attente = null;
      label.value = '';
      options.onArmChange?.(false);
      refresh();
      options.requestRender?.();
    } catch (cause) {
      error.textContent = cause instanceof Error ? cause.message : String(cause);
    }
  });

  refresh();

  return {
    isArmed: () => attente !== null,
    getSelectedLinkId: () => selectedLinkId,
    /** La liaison en cours de composition, à dessiner sur la carte. @returns {LinkDraft} */
    getDraft: () => draft,
    /**
     * Pose l'extrémité attendue sur la case tapée, à l'étage **affiché** — le même que celui sur
     * lequel la tape a eu lieu, puisque c'est l'hôte qui le fournit avec la case.
     *
     * ⛔ Sans attente en cours, une tape ne pose rien : c'est ce qui distingue « je désigne » de
     * « je regarde la carte », et son absence est précisément ce qui rendait l'ancien éditeur
     * illisible.
     *
     * @param {string} levelId
     * @param {Cell} cell
     */
    setEndpoint: (levelId, cell) => {
      if (!attente) return;
      error.textContent = '';
      const endpoint = { levelId, at: { cellX: cell.a, cellY: cell.b } };
      if (attente === 'a') {
        endpointA = endpoint;
        // Une arrivée déjà posée sur ce même étage ne peut pas survivre au nouveau départ : une
        // liaison relie deux étages. On la retire, et on le DIT plutôt que de laisser croire
        // qu'elle tient toujours.
        if (endpointB && endpointB.levelId === levelId) {
          endpointB = null;
          error.textContent = 'L’arrivée était sur ce même étage : elle a été retirée, redésignez-la.';
        }
        // Enchaînement : le départ posé, c'est l'arrivée qu'on attend. Personne n'a à deviner
        // qu'un clic non armé remplissait l'autre bout.
        attente = endpointB ? null : 'b';
      } else {
        if (endpointA && levelId === endpointA.levelId) {
          error.textContent = 'L’arrivée doit être sur un autre étage que le départ : changez d’étage, puis tapez.';
          refresh();
          options.requestRender?.();
          return;
        }
        endpointB = endpoint;
        attente = null;
      }
      options.onArmChange?.(attente !== null);
      refresh();
      options.requestRender?.();
    },
    /** @param {string|null} id */
    selectLink: (id) => { selectedLinkId = id; refresh(); options.requestRender?.(); },
    /**
     * Armement piloté de l'extérieur : le panneau MJ désarme ainsi quand un autre outil prend la
     * main. ⚠ Désarmer n'efface pas ce qui est posé — on retrouve sa liaison en cours en revenant.
     * @param {boolean} nextArmed
     */
    setArmed: (nextArmed) => {
      attente = nextArmed ? (endpointA ? 'b' : 'a') : null;
      refresh();
    },
    refresh,
  };
}

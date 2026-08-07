// @ts-check

import { createLink } from '../../core/schema.js';

/** @typedef {import('../../core/types.js').Link} Link */
/** @typedef {import('../../core/types.js').Cell} Cell */

/**
 * @param {HTMLElement} container
 * @param {{getLevels: () => {id: string, name: string}[], getLinks: () => Link[], onAdd: (link: Link) => void, onRemove: (id: string) => void, onArmChange?: (armed: boolean) => void, requestRender?: () => void}} options
 */
export function createLinkEditor(container, options) {
  let armed = false;
  /** @type {Link['a']|null} */
  let endpointA = null;
  /** @type {string|null} */
  let selectedLinkId = null;
  container.innerHTML = `
    <section class="gm-section">
      <h3>↕ Liaisons d'étages</h3>
      <p style="font-size:.8rem;color:#aaa">Armez, tapez la case A sur la carte, puis associez la destination B.</p>
      <button id="link-arm" class="gm-btn" type="button" style="width:100%">Poser l'extrémité A</button>
      <p id="link-a-status" style="min-height:1.2rem;font-size:.8rem;color:#9cc8ff"></p>
      <div id="link-form" style="display:grid;grid-template-columns:auto 1fr;gap:.5rem .65rem;align-items:center">
        <label for="link-kind">Type</label><select id="link-kind"><option value="stairs">Escalier</option><option value="elevator">Ascenseur</option><option value="ladder">Échelle</option><option value="hatch">Trappe</option><option value="passage">Passage</option></select>
        <label for="link-label">Libellé</label><input id="link-label" type="text" maxlength="80" placeholder="Escalier nord" />
        <label for="link-level-b">Étage B</label><select id="link-level-b"></select>
        <label for="link-cell-x">Case B</label><span><input id="link-cell-x" type="number" min="0" step="1" style="width:4.5rem" aria-label="Colonne B" /> <input id="link-cell-y" type="number" min="0" step="1" style="width:4.5rem" aria-label="Ligne B" /></span>
        <label for="link-one-way">Sens unique</label><input id="link-one-way" type="checkbox" />
        <label for="link-gm-only">MJ seul</label><input id="link-gm-only" type="checkbox" />
      </div>
      <button id="link-create" class="gm-btn gm-btn-primary" type="button" style="width:100%;margin-top:.75rem" disabled>Créer la liaison</button>
      <p id="link-error" style="min-height:1.2rem;color:#f87171;font-size:.8rem"></p>
      <div style="border-top:1px solid #444;margin-top:.75rem;padding-top:.75rem"><strong style="font-size:.85rem">Liaisons existantes</strong><div id="link-list" style="display:grid;gap:.35rem;margin-top:.45rem"></div></div>
    </section>`;
  const arm = /** @type {HTMLButtonElement} */ (container.querySelector('#link-arm'));
  const status = /** @type {HTMLElement} */ (container.querySelector('#link-a-status'));
  const levelB = /** @type {HTMLSelectElement} */ (container.querySelector('#link-level-b'));
  const cellX = /** @type {HTMLInputElement} */ (container.querySelector('#link-cell-x'));
  const cellY = /** @type {HTMLInputElement} */ (container.querySelector('#link-cell-y'));
  const create = /** @type {HTMLButtonElement} */ (container.querySelector('#link-create'));
  const error = /** @type {HTMLElement} */ (container.querySelector('#link-error'));
  const list = /** @type {HTMLElement} */ (container.querySelector('#link-list'));
  const kind = /** @type {HTMLSelectElement} */ (container.querySelector('#link-kind'));
  const label = /** @type {HTMLInputElement} */ (container.querySelector('#link-label'));
  const oneWay = /** @type {HTMLInputElement} */ (container.querySelector('#link-one-way'));
  const gmOnly = /** @type {HTMLInputElement} */ (container.querySelector('#link-gm-only'));

  function refresh() {
    const levels = options.getLevels();
    const previous = levelB.value;
    const originLevelId = endpointA?.levelId ?? null;
    const destinationLevels = originLevelId
      ? levels.filter((level) => level.id !== originLevelId)
      : levels;
    levelB.replaceChildren(...destinationLevels.map((level) => new Option(level.name, level.id)));
    if (destinationLevels.some((level) => level.id === previous)) levelB.value = previous;
    status.textContent = endpointA ? `A : ${endpointA.levelId} — case ${endpointA.at.cellX}, ${endpointA.at.cellY}` : 'Aucune extrémité A posée.';
    arm.textContent = armed ? 'Annuler la pose A' : 'Poser l’extrémité A';
    arm.classList.toggle('gm-btn-active', armed);
    create.disabled = !endpointA || destinationLevels.length === 0;
    list.replaceChildren(...options.getLinks().map((link) => {
      const row = document.createElement('div');
      row.style.cssText = `display:flex;gap:.35rem;align-items:center;padding:.35rem;border:1px solid ${selectedLinkId === link.id ? '#f5a623' : '#444'};border-radius:4px`;
      const text = document.createElement('span'); text.style.flex = '1'; text.textContent = `${link.label || link.kind} (${link.a.levelId}:${link.a.at.cellX},${link.a.at.cellY} → ${link.b.levelId}:${link.b.at.cellX},${link.b.at.cellY})${link.bidirectional ? '' : ' sens unique'}${link.gmOnly ? ' · MJ' : ''}`;
      const select = document.createElement('button'); select.type = 'button'; select.className = 'gm-btn'; select.textContent = 'Voir'; select.addEventListener('click', () => { selectedLinkId = link.id; options.requestRender?.(); refresh(); });
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'gm-btn'; remove.textContent = 'Supprimer'; remove.addEventListener('click', () => { options.onRemove(link.id); if (selectedLinkId === link.id) selectedLinkId = null; refresh(); });
      row.append(text, select, remove); return row;
    }));
  }
  arm.addEventListener('click', () => { armed = !armed; options.onArmChange?.(armed); refresh(); options.requestRender?.(); });
  create.addEventListener('click', () => {
    error.textContent = '';
    if (!endpointA || !Number.isInteger(Number(cellX.value)) || !Number.isInteger(Number(cellY.value))) { error.textContent = 'La case B doit être composée de deux entiers.'; return; }
    if (!levelB.value || levelB.value === endpointA.levelId) { error.textContent = 'La destination doit être sur un autre étage.'; return; }
    try {
      options.onAdd(createLink({ kind: /** @type {any} */ (kind.value), label: label.value.trim(), a: endpointA, b: { levelId: levelB.value, at: { cellX: Number(cellX.value), cellY: Number(cellY.value) } }, bidirectional: !oneWay.checked, gmOnly: gmOnly.checked }));
      endpointA = null; armed = false; options.onArmChange?.(false); refresh(); options.requestRender?.();
    } catch (cause) { error.textContent = cause instanceof Error ? cause.message : String(cause); }
  });
  refresh();
  return {
    isArmed: () => armed,
    getSelectedLinkId: () => selectedLinkId,
    setEndpointA: (/** @type {string} */ levelId, /** @type {Cell} */ cell) => { if (!armed) return; endpointA = { levelId, at: { cellX: cell.a, cellY: cell.b } }; armed = false; options.onArmChange?.(false); refresh(); options.requestRender?.(); },
    selectLink: (/** @type {string|null} */ id) => { selectedLinkId = id; refresh(); options.requestRender?.(); },
    setArmed: (/** @type {boolean} */ nextArmed) => { armed = nextArmed; refresh(); },
    refresh,
  };
}

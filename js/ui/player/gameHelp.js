// @ts-check

import { createLevel, createToken } from '../../core/schema.js';
import { movementRulesFor } from '../../state/selection.js';
import { createMovePlan, extendMovePlan } from '../../state/movePlan.js';
import { cellKey } from '../../core/cellKey.js';

const LESSON = [
  'Touche ton personnage. Les cases accessibles s’allument.',
  'Choisis ton arrivée. Le trajet se dessine et ton personnage reste en place.',
  'Retouche ici pour déplacer. Ton personnage rejoint la case choisie.',
];
const START = { a: 1, b: 2 };
const EXAMPLE = { a: 4, b: 2 };
const CONFIRM = 'Retoucher ici pour déplacer';

export function mountPlayerGameHelp() {
  const open = document.createElement('button');
  open.id = 'player-game-help';
  open.type = 'button';
  open.textContent = '?';
  open.title = 'Aide de jeu';
  open.setAttribute('aria-label', open.title);
  open.setAttribute('aria-haspopup', 'dialog');
  document.body.appendChild(open);

  const dialog = document.createElement('dialog');
  dialog.id = 'player-help-dialog';
  dialog.setAttribute('aria-labelledby', 'player-help-title');
  dialog.innerHTML = `
    <header>
      <h1 id="player-help-title">Aide de jeu</h1>
      <button type="button" data-help-close autofocus>Revenir à la partie</button>
    </header>
    <section aria-labelledby="player-help-lesson">
      <h2 id="player-help-lesson">Déplacer mon personnage</h2>
      <div class="player-help-content">
        <div class="player-help-board" aria-label="Carte d’exercice"></div>
        <div class="player-help-instructions">
          <ol aria-label="Étapes du déplacement">
            <li><button type="button" data-example="0">Sélectionner</button></li>
            <li><button type="button" data-example="1">Choisir l’arrivée</button></li>
            <li><button type="button" data-example="2">Confirmer</button></li>
          </ol>
          <p data-help-caption aria-live="polite"></p>
          <div class="player-help-actions">
            <button type="button" data-help-replay>Rejouer la démonstration</button>
            <button type="button" data-help-practice>À toi d’essayer</button>
          </div>
        </div>
      </div>
    </section>`;
  document.body.appendChild(dialog);

  /** @typedef {import('../../core/types.js').Cell} Cell */
  const board = /** @type {HTMLElement} */ (dialog.querySelector('.player-help-board'));
  const caption = /** @type {HTMLElement} */ (dialog.querySelector('[data-help-caption]'));
  const practiceButton = /** @type {HTMLButtonElement} */ (dialog.querySelector('[data-help-practice]'));
  const examples = [...dialog.querySelectorAll('button[data-example]')];
  const exerciseLevel = createLevel({ id: 'aide', widthCells: 7, heightCells: 5 });
  const exerciseToken = createToken({ id: 'aide-pion', levelId: exerciseLevel.id, label: 'Pion d’essai', cell: START, speedCells: 3 });
  const rules = movementRulesFor(exerciseToken, exerciseLevel);
  const initialPlan = createMovePlan(exerciseToken, exerciseLevel, rules);
  const sample = extendMovePlan(initialPlan, EXAMPLE, rules).plan;

  /** @type {{cell: Cell, control: HTMLButtonElement}[]} */
  const cells = [];
  const boardCells = rules.grid.allCells(exerciseLevel.widthCells, exerciseLevel.heightCells)
    .sort((a, b) => a.b - b.b || a.a - b.a);
  for (const cell of boardCells) {
    const control = document.createElement('button');
    control.type = 'button';
    control.setAttribute('aria-label', cellKey(cell) === cellKey(START) ? 'Pion d’essai' : `Case ${cell.a + 1}, ${cell.b + 1}`);
    control.addEventListener('click', () => practice(cell));
    cells.push({ cell, control });
    board.appendChild(control);
  }
  const pawn = document.createElement('span');
  pawn.className = 'player-help-pawn';
  pawn.setAttribute('aria-hidden', 'true');
  pawn.innerHTML = '<svg viewBox="0 0 36 36" width="32" height="32" aria-hidden="true"><path fill="currentColor" d="M18 5 30 10v8c0 6-5 11-12 14-7-3-12-8-12-14v-8z"/><path fill="#1f2931" d="M18 11 23 17h-3v8h-4v-8h-3z"/></svg>';
  const touch = document.createElement('span');
  touch.className = 'player-help-touch';
  touch.setAttribute('aria-hidden', 'true');
  const prompt = document.createElement('span');
  prompt.className = 'player-help-prompt';
  prompt.textContent = CONFIRM;
  board.append(pawn, touch, prompt);

  /** @type {ReturnType<typeof setTimeout>|null} */
  let replayTimer = null;
  let practicing = false;
  let selected = false;
  let finished = false;
  let current = initialPlan;

  function stopReplay() {
    if (replayTimer !== null) clearTimeout(replayTimer);
    replayTimer = null;
  }

  /** @param {HTMLElement} element @param {Cell} cell */
  function position(element, cell) {
    element.style.transform = `translate(${cell.a * 100}%, ${cell.b * 100}%)`;
  }

  /** @param {Cell} token @param {boolean} zone @param {Cell[]} route @param {Cell|null} point @param {Cell|null} arrival */
  function paint(token, zone, route, point, arrival) {
    const routeKeys = new Set(route.slice(1).map(cellKey));
    for (const { cell, control } of cells) {
      const key = cellKey(cell);
      control.disabled = !practicing || finished;
      control.classList.toggle('is-reachable', zone && (practicing ? current : initialPlan).reachable.has(key));
      control.classList.toggle('is-route', routeKeys.has(key));
      control.classList.toggle('is-arrival', arrival !== null && key === cellKey(arrival));
    }
    position(pawn, token);
    touch.hidden = !point;
    if (point) position(touch, point);
    prompt.hidden = !arrival;
    if (arrival) {
      prompt.style.setProperty('--help-prompt-x', `${(arrival.a + 0.5) / exerciseLevel.widthCells * 100}%`);
      prompt.style.top = `${(arrival.b + (arrival.b >= 3 ? -0.6 : 1.15)) / exerciseLevel.heightCells * 100}%`;
    }
  }

  /** @param {number} step */
  function showExample(step) {
    practicing = false;
    examples.forEach((el, index) => el.setAttribute('aria-pressed', String(index === step)));
    caption.textContent = LESSON[step];
    paint(step === 2 ? EXAMPLE : START, step < 2, step >= 1 ? (sample?.path ?? []) : [],
      step === 0 ? START : EXAMPLE, step === 1 ? EXAMPLE : null);
  }

  /** @param {number} [step] */
  function replay(step = 0) {
    showExample(step);
    if (step < LESSON.length - 1) replayTimer = setTimeout(() => replay(step + 1), 1800);
  }

  function startPractice() {
    stopReplay();
    practicing = true;
    selected = false;
    finished = false;
    current = initialPlan;
    examples.forEach((el) => el.setAttribute('aria-pressed', 'false'));
    caption.textContent = 'Touche le pion d’essai.';
    paint(START, false, [], null, null);
    cells.find(({ cell }) => cellKey(cell) === cellKey(START))?.control.focus();
  }

  /** @param {Cell} cell */
  function practice(cell) {
    if (!practicing || finished) return;
    const key = cellKey(cell);
    if (!selected) {
      if (key !== cellKey(START)) return;
      selected = true;
      caption.textContent = 'Choisis une des cases éclairées.';
      paint(START, true, [], null, null);
      return;
    }
    const arrival = current.steps.at(-1);
    if (arrival && key === cellKey(arrival)) {
      finished = true;
      caption.textContent = 'Ton personnage a rejoint l’arrivée.';
      paint(arrival, false, current.path, null, null);
      practiceButton.focus();
      return;
    }
    const next = extendMovePlan(current, cell, rules).plan;
    if (!next) return;
    current = next;
    caption.textContent = CONFIRM;
    paint(START, true, current.path, null, cell);
  }

  examples.forEach((element, index) => element.addEventListener('click', () => {
    stopReplay();
    showExample(index);
  }));
  dialog.querySelector('[data-help-close]')?.addEventListener('click', () => dialog.close());
  dialog.querySelector('[data-help-replay]')?.addEventListener('click', () => { stopReplay(); replay(); });
  practiceButton.addEventListener('click', startPractice);
  dialog.addEventListener('close', () => { stopReplay(); open.focus(); });
  open.addEventListener('click', () => {
    showExample(0);
    dialog.showModal();
  });

  return () => {
    stopReplay();
    dialog.remove();
    open.remove();
  };
}

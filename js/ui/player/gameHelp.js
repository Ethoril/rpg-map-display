// @ts-check

import { createLevel, createToken, isLinkedToken } from '../../core/schema.js';
import { cellKey } from '../../core/cellKey.js';
import {
  HEALTH_STATE_LABEL_FR,
  MOUNTED_ICON_URL,
  PING_DURATION_MS,
  RENDER_RESOLUTION_CAP,
  SELECTION_STRIP_LABEL_MS,
  STATUS_MARKER_LABEL_FR,
} from '../../core/constants.js';
import { distanceBetweenFootprints, gridFor } from '../../grid/index.js';
import { movementRulesFor } from '../../state/selection.js';
import {
  createMovePlan,
  extendMovePlan,
  ranStartIndex,
  removeLastMoveStep,
} from '../../state/movePlan.js';
import { Camera } from '../../render/camera.js';
import { GridLayer } from '../../render/layers/gridLayer.js';
import { PortalsLayer, boutonsPorte } from '../../render/layers/portals.js';
import { boutonLiaison } from '../../render/layers/links.js';
import { TemplatesLayer } from '../../render/layers/templates.js';
import { PingsLayer } from '../../render/layers/pings.js';
import { CAMP_FILL, campInitials } from '../../render/layers/tokens.js';
import { PointerInput } from '../../input/pointer.js';
import { findHitToken, isPlayerManipulableToken } from '../../input/tokenHit.js';
import {
  findHitTemplate,
  isPointInCone,
  normalizeAngleDeg,
  templateDragPose,
  withTemplatePreview,
} from '../../input/templateHit.js';

/** @typedef {import('../../core/types.js').Cell} Cell */
/** @typedef {import('../../core/types.js').Level} Level */
/** @typedef {import('../../core/types.js').Link} Link */
/** @typedef {import('../../core/types.js').MapPoint} MapPoint */
/** @typedef {import('../../core/types.js').Portal} Portal */
/** @typedef {import('../../core/types.js').Template} Template */
/** @typedef {import('../../core/types.js').Token} Token */
/** @typedef {import('../../core/constants.js').StatusMarker} StatusMarker */
/** @typedef {import('../../grid/GridAdapter.js').GridAdapter} GridAdapter */
/** @typedef {import('../../state/movePlan.js').MovePlan} MovePlan */

/**
 * @typedef {Object} HelpStepSpec
 * @property {string} label Libellé court du bouton d'étape
 * @property {string} caption Légende affichée et annoncée
 * @property {number} [durationMs] Cadence lors de la démonstration (défaut 1800 ms)
 * @property {string} [group] Sous-titre optionnel de séquence
 */

/**
 * @typedef {Object} HelpLessonController
 * @property {(step: number) => void} showExample Affiche une étape stable de démonstration
 * @property {() => void} startPractice Lance l'exercice interactif à partir d'un état propre
 * @property {() => void} destroy Libère minuteries, captures de pointeur et écouteurs locaux
 */

/**
 * @typedef {Object} HelpLessonContext
 * @property {HTMLElement} stage Conteneur de la scène à gauche
 * @property {HTMLElement} extra Zone d'actions secondaires / aide clavier
 * @property {HTMLButtonElement} practiceButton Bouton « À toi d’essayer »
 * @property {(text: string) => void} setCaption Met à jour la légende annoncée
 * @property {(text: string|null, link?: { label: string, lessonId: string }) => void} setNote Note ou renvoi
 * @property {() => void} stopReplay Interrompt la lecture automatique en cours
 * @property {(lessonId: string) => void} openLesson Ouvre une autre fiche par identifiant
 */

/**
 * @typedef {Object} HelpLessonDefinition
 * @property {string} id
 * @property {string} group
 * @property {string} title
 * @property {string} stepsAriaLabel
 * @property {HelpStepSpec[]} steps
 * @property {(ctx: HelpLessonContext) => HelpLessonController} mount
 */

const DEFAULT_STEP_MS = 1800;
const CONFIRM_LABEL = 'Retoucher ici pour déplacer';
const RUN_LABEL = 'Course : Action utilisée';
const MOUNT_LOCAL_PROMPT = 'Descendre de cheval';
const MOUNT_LINKED_PROMPT = 'Demander au MJ de vous faire descendre de cheval';

const SVG_PAWN =
  '<svg viewBox="0 0 36 36" width="32" height="32" aria-hidden="true"><path fill="currentColor" d="M18 5 30 10v8c0 6-5 11-12 14-7-3-12-8-12-14v-8z"/><path fill="#1f2931" d="M18 11 23 17h-3v8h-4v-8h-3z"/></svg>';

const SVG_UNDO =
  '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5 4 10l5 5M4 10h10a5 5 0 0 1 0 10h-3"/></svg>';

const SVG_FULLSCREEN_ENTER =
  '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>';

const SVG_FULLSCREEN_EXIT =
  '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8h3a2 2 0 0 0 2-2V3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M21 16h-3a2 2 0 0 0-2 2v3"/></svg>';

const SVG_SHARED_EMBLEM = `
  <svg class="player-help-share-art" viewBox="0 0 260 190" role="img" aria-label="Parchemin fictif avec blason de boussole">
    <defs>
      <linearGradient id="help-parchment" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#ece0c2"/>
        <stop offset="100%" stop-color="#cfb98c"/>
      </linearGradient>
    </defs>
    <rect x="14" y="10" width="232" height="170" rx="12" fill="url(#help-parchment)" stroke="#7a5e34" stroke-width="4"/>
    <rect x="24" y="20" width="212" height="150" rx="6" fill="none" stroke="#8a6c3e" stroke-width="1.5" stroke-dasharray="6 4"/>
    <path d="M130 34 176 54v36c0 30-19 52-46 66-27-14-46-36-46-66V54z" fill="#2c3e4f" stroke="#7a5e34" stroke-width="3"/>
    <path d="M130 52 141 84 170 95 141 106 130 138 119 106 90 95 119 84z" fill="#ffbf47" stroke="#151e26" stroke-width="2"/>
    <circle cx="130" cy="95" r="9" fill="#f4eee2" stroke="#151e26" stroke-width="2"/>
  </svg>`;

const SVG_MINI_MAP = `
  <svg class="player-help-share-map" viewBox="0 0 350 250" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <rect width="350" height="250" fill="#28333a"/>
    <g stroke="#43525c" stroke-width="1">
      <path d="M50 0v250M100 0v250M150 0v250M200 0v250M250 0v250M300 0v250"/>
      <path d="M0 50h350M0 100h350M0 150h350M0 200h350"/>
    </g>
    <path d="M0 125 C90 115, 160 150, 350 120" fill="none" stroke="#4f5f64" stroke-width="28"/>
    <rect x="40" y="36" width="110" height="72" rx="4" fill="#32414a" stroke="#758894" stroke-width="3"/>
    <circle cx="242" cy="156" r="18" fill="#36596e" stroke="#a6c4d4" stroke-width="3"/>
    <circle cx="242" cy="156" r="10" fill="#1b3545"/>
    <text x="242" y="190" text-anchor="middle" fill="#e6edf3" font-size="12" font-weight="700" font-family="system-ui, sans-serif">Puits</text>
    <circle cx="125" cy="125" r="16" fill="#2a5943" stroke="#fff2c8" stroke-width="2.5"/>
    <text x="125" y="130" text-anchor="middle" fill="#fff2c8" font-size="12" font-weight="700" font-family="system-ui, sans-serif">AR</text>
  </svg>`;

const TOC_GROUPS = Object.freeze([
  'Se déplacer',
  'Lire la carte',
  'Interagir',
  'Accéder à la table',
]);

const formatFrNumber = new Intl.NumberFormat('fr-FR');

/**
 * Formate une distance de consultation comme `selectionStrip.js`.
 * @param {number} cells
 * @param {string} referenceName
 * @returns {string}
 */
function formatInspectionDistance(cells, referenceName) {
  const safeName = referenceName || 'ton personnage';
  const prefix = /^[aeiouy]/i.test(safeName.normalize('NFD')) ? `d’${safeName}` : `de ${safeName}`;
  return `À ${formatFrNumber.format(cells)} ${cells <= 1 ? 'case' : 'cases'} ${prefix}`;
}

/**
 * Indique si deux cases ont les mêmes coordonnées discrètes.
 * @param {Cell|null|undefined} first
 * @param {Cell|null|undefined} second
 * @returns {boolean}
 */
function sameCell(first, second) {
  return Boolean(first && second && first.a === second.a && first.b === second.b);
}

/**
 * Teste si un point carte se trouve dans un rectangle carte (aligné sur `bootstrap.js`).
 * @param {MapPoint} pt
 * @param {{ x: number, y: number, width: number, height: number }} rect
 * @returns {boolean}
 */
function pointInRect(pt, rect) {
  return (
    pt.x >= rect.x &&
    pt.x <= rect.x + rect.width &&
    pt.y >= rect.y &&
    pt.y <= rect.y + rect.height
  );
}

/**
 * Positionne un élément en pourcentage de case sur une grille 7×5.
 * @param {HTMLElement} element
 * @param {Cell} cell
 */
function positionOnGrid(element, cell) {
  element.style.transform = `translate(${cell.a * 100}%, ${cell.b * 100}%)`;
}

/**
 * Trace un chemin pointillé SVG entre des cases sur une grille de `cols × rows`.
 * @param {SVGSVGElement} svg
 * @param {Cell[]} path
 * @param {number} cols
 * @param {number} rows
 * @param {number} [ranStart=-1]
 */
function drawBoardRouteSvg(svg, path, cols, rows, ranStart = -1) {
  if (!path || path.length < 2) {
    svg.innerHTML = '';
    return;
  }
  const width = cols * 100;
  const height = rows * 100;
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  const pts = path.map((cell) => ({ x: (cell.a + 0.5) * 100, y: (cell.b + 0.5) * 100 }));
  const walkEnd = ranStart > 0 ? ranStart : pts.length;
  const walkPoints = pts.slice(0, walkEnd).map((p) => `${p.x},${p.y}`).join(' ');
  const runPoints = ranStart > 0 ? pts.slice(ranStart - 1).map((p) => `${p.x},${p.y}`).join(' ') : '';
  const from = pts[pts.length - 2];
  const to = pts[pts.length - 1];
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const tipX = to.x - Math.cos(angle) * 20;
  const tipY = to.y - Math.sin(angle) * 20;
  const arrowSize = 16;
  const p1x = tipX - arrowSize * Math.cos(angle - 0.5);
  const p1y = tipY - arrowSize * Math.sin(angle - 0.5);
  const p2x = tipX - arrowSize * Math.cos(angle + 0.5);
  const p2y = tipY - arrowSize * Math.sin(angle + 0.5);
  const endColor = ranStart > 0 ? '#ff7a3d' : '#ffbf47';

  svg.innerHTML = `
    <polyline points="${walkPoints}" fill="none" stroke="#ffbf47" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="16 12"/>
    ${runPoints ? `<polyline points="${runPoints}" fill="none" stroke="#ff7a3d" stroke-width="11" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="8 12"/>` : ''}
    <polygon points="${tipX},${tipY} ${p1x},${p1y} ${p2x},${p2y}" fill="${endColor}"/>
    <circle cx="${to.x}" cy="${to.y}" r="11" fill="${endColor}"/>
  `;
}

/**
 * Construit les primitives SVG d'indicateurs tactiles (anneau, double tap, maintien, pincement, glisser).
 * Toutes ces couches restent `pointer-events: none`.
 */
const GESTURE_SVG = {
  /** @param {number} x @param {number} y */
  tap: (x, y) => `
    <g transform="translate(${x}, ${y})">
      <circle r="19" fill="none" stroke="#101820" stroke-width="6" opacity="0.78"/>
      <circle r="19" fill="none" stroke="#ffffff" stroke-width="3"/>
    </g>`,
  /** @param {number} x @param {number} y */
  doubleTap: (x, y) => `
    <g transform="translate(${x}, ${y})">
      <circle r="27" fill="none" stroke="#101820" stroke-width="5" opacity="0.65"/>
      <circle r="27" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-dasharray="8 5"/>
      <circle r="16" fill="none" stroke="#101820" stroke-width="6" opacity="0.8"/>
      <circle r="16" fill="none" stroke="#ffffff" stroke-width="3"/>
      <rect x="16" y="-30" width="28" height="19" rx="9" fill="#101820" stroke="#ffbf47" stroke-width="1.5"/>
      <text x="30" y="-17" text-anchor="middle" fill="#fff2c8" font-size="11" font-weight="700" font-family="system-ui, sans-serif">×2</text>
    </g>`,
  /** @param {number} x @param {number} y */
  hold: (x, y) => `
    <g transform="translate(${x}, ${y})">
      <circle r="23" fill="none" stroke="#101820" stroke-width="6" opacity="0.8"/>
      <circle r="23" fill="none" stroke="#ffbf47" stroke-width="3.5" stroke-dasharray="106 38"/>
      <circle r="15" fill="rgba(255,255,255,0.18)" stroke="#ffffff" stroke-width="2.5"/>
    </g>`,
  /** @param {number} x1 @param {number} y1 @param {number} x2 @param {number} y2 */
  drag: (x1, y1, x2, y2) => {
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const tipX = x2 - Math.cos(angle) * 20;
    const tipY = y2 - Math.sin(angle) * 20;
    const size = 12;
    const a1x = tipX - size * Math.cos(angle - 0.5);
    const a1y = tipY - size * Math.sin(angle - 0.5);
    const a2x = tipX - size * Math.cos(angle + 0.5);
    const a2y = tipY - size * Math.sin(angle + 0.5);
    return `
      <g>
        <line x1="${x1}" y1="${y1}" x2="${tipX}" y2="${tipY}" stroke="#101820" stroke-width="7" stroke-linecap="round" opacity="0.72"/>
        <line x1="${x1}" y1="${y1}" x2="${tipX}" y2="${tipY}" stroke="#ffffff" stroke-width="3" stroke-dasharray="8 6" stroke-linecap="round"/>
        <polygon points="${tipX},${tipY} ${a1x},${a1y} ${a2x},${a2y}" fill="#ffbf47" stroke="#101820" stroke-width="1.5"/>
        <circle cx="${x1}" cy="${y1}" r="15" fill="none" stroke="#101820" stroke-width="5.5" opacity="0.78"/>
        <circle cx="${x1}" cy="${y1}" r="15" fill="none" stroke="#ffffff" stroke-width="2.8"/>
        <circle cx="${x2}" cy="${y2}" r="17" fill="none" stroke="#101820" stroke-width="5.5" opacity="0.78"/>
        <circle cx="${x2}" cy="${y2}" r="17" fill="none" stroke="#ffbf47" stroke-width="2.8" stroke-dasharray="6 4"/>
      </g>`;
  },
  /** @param {number} cx @param {number} cy @param {'out'|'in'} mode */
  pinch: (cx, cy, mode) => {
    const dx = 44;
    const dy = 26;
    const p1x = cx - dx;
    const p1y = cy + dy;
    const p2x = cx + dx;
    const p2y = cy - dy;
    /** @param {number} x1 @param {number} y1 @param {number} x2 @param {number} y2 */
    const arrow = (x1, y1, x2, y2) => {
      const a = Math.atan2(y2 - y1, x2 - x1);
      const s = 10;
      const hx1 = x2 - s * Math.cos(a - 0.55);
      const hy1 = y2 - s * Math.sin(a - 0.55);
      const hx2 = x2 - s * Math.cos(a + 0.55);
      const hy2 = y2 - s * Math.sin(a + 0.55);
      return `
        <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#101820" stroke-width="6" stroke-linecap="round" opacity="0.78"/>
        <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#ffbf47" stroke-width="3" stroke-linecap="round"/>
        <polygon points="${x2},${y2} ${hx1},${hy1} ${hx2},${hy2}" fill="#ffbf47" stroke="#101820" stroke-width="1.2"/>`;
    };
    const a1 = mode === 'out'
      ? arrow(p1x - 14, p1y + 8, p1x - 42, p1y + 25)
      : arrow(p1x - 36, p1y + 21, p1x - 12, p1y + 7);
    const a2 = mode === 'out'
      ? arrow(p2x + 14, p2y - 8, p2x + 42, p2y - 25)
      : arrow(p2x + 36, p2y - 21, p2x + 12, p2y - 7);
    return `
      <g>
        ${a1}
        ${a2}
        <circle cx="${p1x}" cy="${p1y}" r="16" fill="none" stroke="#101820" stroke-width="5.5" opacity="0.8"/>
        <circle cx="${p1x}" cy="${p1y}" r="16" fill="none" stroke="#ffffff" stroke-width="2.8"/>
        <circle cx="${p2x}" cy="${p2y}" r="16" fill="none" stroke="#101820" stroke-width="5.5" opacity="0.8"/>
        <circle cx="${p2x}" cy="${p2y}" r="16" fill="none" stroke="#ffffff" stroke-width="2.8"/>
      </g>`;
  },
};

/**
 * Crée un canvas local autonome dans une fiche d'aide, avec mise à l'échelle DPR et `ResizeObserver`.
 * @param {HTMLElement} parent
 * @param {string} ariaLabel
 * @param {() => void} onRender
 */
function createHelpCanvasSurface(parent, ariaLabel, onRender) {
  const frame = document.createElement('div');
  frame.className = 'player-help-canvas-frame';

  const canvas = document.createElement('canvas');
  canvas.className = 'player-help-canvas';
  canvas.setAttribute('aria-label', ariaLabel);

  const gestureSvg = /** @type {SVGSVGElement} */ (
    document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  );
  gestureSvg.classList.add('player-help-gesture-svg');
  gestureSvg.setAttribute('aria-hidden', 'true');

  frame.append(canvas, gestureSvg);
  parent.appendChild(frame);

  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  const camera = new Camera(520, 372);
  let width = 520;
  let height = 372;
  let resolution = 1;

  function syncSize() {
    const rect = frame.getBoundingClientRect();
    const nextW = rect.width > 20 ? Math.round(rect.width) : 520;
    const nextH = rect.height > 20 ? Math.round(rect.height) : Math.round(nextW * (5 / 7));
    const nextRes = Math.min(window.devicePixelRatio || 1, RENDER_RESOLUTION_CAP);
    const changed = nextW !== width || nextH !== height || nextRes !== resolution;
    width = nextW;
    height = nextH;
    resolution = nextRes;
    const targetW = Math.max(1, Math.round(width * resolution));
    const targetH = Math.max(1, Math.round(height * resolution));
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }
    camera.setViewport(width, height);
    gestureSvg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    return changed;
  }

  /** @type {ResizeObserver|null} */
  let observer = null;
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(() => {
      if (syncSize()) onRender();
    });
    observer.observe(frame);
  }
  syncSize();

  /** @param {(ctx: CanvasRenderingContext2D, width: number, height: number) => void} drawWorld */
  function renderFrame(drawWorld) {
    syncSize();
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.scale(resolution, resolution);
    camera.applyToContext(ctx);
    drawWorld(ctx, width, height);
    ctx.restore();
  }

  /** @param {string} markup */
  function setGestureMarkup(markup) {
    gestureSvg.innerHTML = markup;
  }

  return {
    frame,
    canvas,
    ctx,
    camera,
    gestureSvg,
    getSize: () => ({ width, height }),
    syncSize,
    renderFrame,
    setGestureMarkup,
    destroy: () => {
      observer?.disconnect();
      observer = null;
    },
  };
}

/**
 * Dessine un pion fictif lisible sur un canvas d'aide (fond clair ou sombre).
 * @param {CanvasRenderingContext2D} ctx
 * @param {GridAdapter} grid
 * @param {Token} token
 * @param {{ selected?: boolean, mounted?: boolean, zoom?: number }} [options]
 */
function drawHelpCanvasToken(ctx, grid, token, options = {}) {
  const center = grid.cellCenter(token.cell);
  const bounds = grid.cellBounds({ cellX: token.cell.a, cellY: token.cell.b }, token.sizeCells || 1);
  const radius = Math.min(bounds.width, bounds.height) * 0.38;
  const zoom = Math.max(0.05, options.zoom ?? 1);
  const fill = (token.camp && CAMP_FILL[token.camp]) || (token.kind === 'pc' ? '#245642' : '#8b3a3a');

  ctx.save();
  if (options.selected) {
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius + 6 / zoom, 0, Math.PI * 2);
    ctx.strokeStyle = '#ffbf47';
    ctx.lineWidth = 3.5 / zoom;
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 3 / zoom;
  ctx.strokeStyle = token.borderColor || '#f4eee2';
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  ctx.font = `700 ${Math.max(12, radius * 0.72)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(campInitials(token.label), center.x, center.y + 1);

  if (token.label) {
    const labelY = center.y + radius + 14 / zoom;
    ctx.font = `700 ${13 / zoom}px system-ui, sans-serif`;
    ctx.lineWidth = 4 / zoom;
    ctx.strokeStyle = '#101820';
    ctx.strokeText(token.label, center.x, labelY);
    ctx.fillStyle = '#f4eee2';
    ctx.fillText(token.label, center.x, labelY);
  }
  ctx.restore();
}

/**
 * Bande de sélection locale, fidèle à `selectionStrip.js`, cloisonnée dans une scène d'aide.
 * @param {HTMLElement} host
 * @param {{
 *   onToggleMounted?: () => void,
 *   onBadgeTap?: (id: StatusMarker, label: string) => void,
 * }} [callbacks]
 */
function createHelpSelectionStrip(host, callbacks = {}) {
  const strip = document.createElement('div');
  strip.className = 'player-help-strip';
  strip.hidden = true;

  const popup = document.createElement('div');
  popup.className = 'player-help-strip-label';
  popup.setAttribute('role', 'status');
  popup.hidden = true;

  host.append(strip, popup);

  /** @type {ReturnType<typeof setTimeout>|null} */
  let popupTimer = null;

  function hidePopup() {
    if (popupTimer !== null) clearTimeout(popupTimer);
    popupTimer = null;
    popup.hidden = true;
    popup.textContent = '';
  }

  /** @param {string} text @param {boolean} [persist] */
  function showPopup(text, persist = false) {
    hidePopup();
    popup.textContent = text;
    popup.hidden = false;
    if (!persist) {
      popupTimer = setTimeout(hidePopup, SELECTION_STRIP_LABEL_MS);
    }
  }

  /**
   * @param {{
   *   token: Token|null,
   *   mode: 'selection'|'consultation',
   *   distanceText?: string,
   *   ringTarget?: 'mount'|'badge'|null,
   *   staticBadgeLabel?: string|null,
   * }} state
   */
  function update(state) {
    const { token, mode, distanceText = '', ringTarget = null, staticBadgeLabel = null } = state;
    if (!token) {
      strip.hidden = true;
      strip.replaceChildren();
      delete strip.dataset.mode;
      hidePopup();
      return;
    }
    strip.hidden = false;
    strip.dataset.mode = mode;

    const card = document.createElement('div');
    card.className = 'player-selection-card';
    const portrait = document.createElement('div');
    portrait.className = 'player-selection-portrait';
    portrait.style.background = (token.camp && CAMP_FILL[token.camp]) || (token.kind === 'pc' ? '#245642' : '#8b3a3a');
    portrait.textContent = campInitials(token.label);
    const name = document.createElement('div');
    name.className = 'player-selection-name';
    name.textContent = token.label;
    card.append(portrait, name);

    const vitalityText = token.kind === 'pc'
      ? (token.hp ? `PV ${token.hp.current}/${token.hp.max}` : '')
      : (HEALTH_STATE_LABEL_FR[token.health] ?? '');
    if (vitalityText) {
      const vit = document.createElement('div');
      vit.className = 'player-selection-vitality';
      vit.textContent = vitalityText;
      card.appendChild(vit);
    }
    if (distanceText) {
      const dist = document.createElement('div');
      dist.className = 'player-selection-distance';
      dist.textContent = distanceText;
      card.appendChild(dist);
    }

    /** @type {HTMLElement[]} */
    const children = [card];
    if (mode === 'selection') {
      const mounted = token.mounted === true;
      const linked = isLinkedToken(token);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = mounted ? 'player-selection-mount is-mounted' : 'player-selection-mount';
      if (ringTarget === 'mount') btn.classList.add('is-ringed');
      const label = mounted ? 'Descendre de cheval' : 'Monter à cheval';
      btn.setAttribute('aria-label', label);
      btn.title = linked ? 'Géré par l’outil MJ' : label;
      btn.disabled = linked;
      const img = document.createElement('img');
      img.src = MOUNTED_ICON_URL;
      img.alt = '';
      btn.appendChild(img);
      btn.addEventListener('click', () => {
        if (!linked) callbacks.onToggleMounted?.();
      });
      children.push(btn);
    }

    for (const marker of token.markers) {
      const id = /** @type {StatusMarker} */ (marker);
      const label = STATUS_MARKER_LABEL_FR[id];
      if (!label) continue;
      const badge = document.createElement('button');
      badge.type = 'button';
      badge.className = 'player-selection-badge';
      if (ringTarget === 'badge') badge.classList.add('is-ringed');
      badge.dataset.marker = id;
      badge.setAttribute('aria-label', label);
      const img = document.createElement('img');
      img.src = `assets/icons/status/${id}.svg`;
      img.alt = '';
      badge.appendChild(img);
      badge.addEventListener('click', () => {
        showPopup(label, false);
        callbacks.onBadgeTap?.(id, label);
      });
      children.push(badge);
    }

    strip.replaceChildren(...children);
    if (staticBadgeLabel) showPopup(staticBadgeLabel, true);
    else hidePopup();
  }

  return {
    strip,
    popup,
    update,
    showPopup,
    hidePopup,
    destroy: () => {
      hidePopup();
      strip.remove();
      popup.remove();
    },
  };
}

/**
 * Crée un bouton d'aide clavier clairement identifié dans la zone secondaire.
 * @param {string} label
 * @param {() => void} onClick
 * @param {string} [extraClass]
 * @returns {HTMLButtonElement}
 */
function makeExtraButton(label, onClick, extraClass = 'player-help-assist-btn') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = extraClass;
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

// ============================================================================================
// FICHE 1 — Déplacer mon personnage (modèle validé par le MJ, préservé fidèlement)
// ============================================================================================

/** @type {HelpLessonDefinition} */
const LESSON_MOVE = {
  id: 'move',
  group: 'Se déplacer',
  title: 'Déplacer mon personnage',
  stepsAriaLabel: 'Étapes du déplacement',
  steps: [
    { label: 'Sélectionner', caption: 'Touche ton personnage. Les cases accessibles s’allument.' },
    { label: 'Choisir l’arrivée', caption: 'Choisis ton arrivée. Le trajet se dessine et ton personnage reste en place.' },
    { label: 'Confirmer', caption: 'Retouche ici pour déplacer. Ton personnage rejoint la case choisie.' },
  ],
  mount(ctx) {
    const START = { a: 1, b: 2 };
    const EXAMPLE = { a: 4, b: 2 };
    const level = createLevel({ id: 'aide', widthCells: 7, heightCells: 5 });
    const token = createToken({ id: 'aide-pion', levelId: level.id, label: 'Pion d’essai', cell: START, speedCells: 3 });
    const rules = movementRulesFor(token, level);
    const initialPlan = createMovePlan(token, level, rules);
    const sample = extendMovePlan(initialPlan, EXAMPLE, rules).plan;

    const board = document.createElement('div');
    board.className = 'player-help-board';
    board.setAttribute('aria-label', 'Carte d’exercice');

    const routeSvg = /** @type {SVGSVGElement} */ (document.createElementNS('http://www.w3.org/2000/svg', 'svg'));
    routeSvg.classList.add('player-help-route-svg');
    routeSvg.setAttribute('aria-hidden', 'true');

    /** @type {{cell: Cell, control: HTMLButtonElement}[]} */
    const cells = [];
    const boardCells = rules.grid.allCells(level.widthCells, level.heightCells)
      .sort((a, b) => a.b - b.b || a.a - b.a);
    for (const cell of boardCells) {
      const control = document.createElement('button');
      control.type = 'button';
      control.className = 'player-help-cell';
      control.setAttribute('aria-label', sameCell(cell, START) ? 'Pion d’essai' : `Case ${cell.a + 1}, ${cell.b + 1}`);
      control.addEventListener('click', () => handlePractice(cell));
      cells.push({ cell, control });
      board.appendChild(control);
    }

    const pawn = document.createElement('span');
    pawn.className = 'player-help-pawn';
    pawn.setAttribute('aria-hidden', 'true');
    pawn.innerHTML = SVG_PAWN;
    const touch = document.createElement('span');
    touch.className = 'player-help-touch';
    touch.setAttribute('aria-hidden', 'true');
    const prompt = document.createElement('span');
    prompt.className = 'player-help-prompt';
    prompt.textContent = CONFIRM_LABEL;
    board.append(routeSvg, pawn, touch, prompt);
    ctx.stage.appendChild(board);

    let practicing = false;
    let selected = false;
    let finished = false;
    let current = initialPlan;

    /** @param {Cell} pawnCell @param {boolean} showZone @param {Cell[]} route @param {Cell|null} point @param {Cell|null} arrival */
    function paint(pawnCell, showZone, route, point, arrival) {
      const routeKeys = new Set(route.slice(1).map(cellKey));
      const activePlan = practicing ? current : initialPlan;
      for (const { cell, control } of cells) {
        const key = cellKey(cell);
        control.disabled = !practicing || finished;
        control.classList.toggle('is-reachable', showZone && activePlan.reachable.has(key));
        control.classList.toggle('is-route', routeKeys.has(key));
        control.classList.toggle('is-arrival', arrival !== null && key === cellKey(arrival));
      }
      drawBoardRouteSvg(routeSvg, route, level.widthCells, level.heightCells);
      positionOnGrid(pawn, pawnCell);
      touch.hidden = !point;
      if (point) positionOnGrid(touch, point);
      prompt.hidden = !arrival;
      if (arrival) {
        prompt.style.setProperty('--help-prompt-x', `${((arrival.a + 0.5) / level.widthCells) * 100}%`);
        prompt.style.top = `${((arrival.b + (arrival.b >= 3 ? -0.65 : 1.12)) / level.heightCells) * 100}%`;
      }
    }

    /** @param {Cell} cell */
    function handlePractice(cell) {
      if (!practicing || finished) return;
      if (!selected) {
        if (!sameCell(cell, START)) return;
        selected = true;
        ctx.setCaption('Choisis une des cases éclairées.');
        paint(START, true, [], null, null);
        return;
      }
      const arrival = current.steps.at(-1);
      if (arrival && sameCell(cell, arrival)) {
        finished = true;
        ctx.setCaption('Ton personnage a rejoint l’arrivée.');
        paint(arrival, false, current.path, null, null);
        ctx.practiceButton.focus();
        return;
      }
      const next = extendMovePlan(current, cell, rules).plan;
      if (!next) {
        if (current.steps.length > 0) {
          current = initialPlan;
          ctx.setCaption('Trajet annulé. Choisis une des cases éclairées.');
          paint(START, true, [], null, null);
        }
        return;
      }
      current = next;
      ctx.setCaption(CONFIRM_LABEL);
      paint(START, true, current.path, null, cell);
    }

    return {
      showExample(step) {
        practicing = false;
        ctx.extra.replaceChildren();
        ctx.extra.hidden = true;
        paint(
          step === 2 ? EXAMPLE : START,
          step < 2,
          step >= 1 ? (sample?.path ?? []) : [],
          step === 0 ? START : EXAMPLE,
          step === 1 ? EXAMPLE : null
        );
      },
      startPractice() {
        practicing = true;
        selected = false;
        finished = false;
        current = initialPlan;
        ctx.extra.replaceChildren();
        ctx.extra.hidden = true;
        ctx.setCaption('Touche le pion d’essai.');
        paint(START, false, [], null, null);
        cells.find(({ cell }) => sameCell(cell, START))?.control.focus();
      },
      destroy() {},
    };
  },
};

// ============================================================================================
// FICHE 2 — Corriger mon trajet (retrait de dernière étape, Marche / Course, aller-retour)
// ============================================================================================

/** @type {HelpLessonDefinition} */
const LESSON_UNDO = {
  id: 'undo-step',
  group: 'Se déplacer',
  title: 'Corriger mon trajet',
  stepsAriaLabel: 'Étapes de correction du trajet',
  steps: [
    { label: 'Trajet préparé', caption: 'Deux étapes sont prêtes. Tu peux encore corriger la dernière.' },
    { label: 'Retirer l’étape', caption: 'Touche la flèche de retour pour retirer la dernière étape.' },
    { label: 'Ajouter une nouvelle étape', caption: 'Choisis une autre arrivée, puis retouche-la pour déplacer ton pion.', durationMs: 2200 },
  ],
  mount(ctx) {
    const CELL_A = { a: 0, b: 2 };
    const CELL_B = { a: 1, b: 2 };
    const CELL_C = { a: 2, b: 2 };
    const CELL_D = { a: 3, b: 2 };
    /** @type {Record<string, string>} */
    const TAGS = {
      [cellKey(CELL_A)]: 'A',
      [cellKey(CELL_B)]: 'B',
      [cellKey(CELL_C)]: 'C',
      [cellKey(CELL_D)]: 'D',
    };

    const level = createLevel({ id: 'aide-undo', widthCells: 7, heightCells: 5 });
    const ariane = createToken({
      id: 'aide-ariane',
      levelId: level.id,
      label: 'Ariane',
      cell: CELL_A,
      speedCells: 2,
      runCells: 6,
      link: { source: 'outil-mj', ref: 'pj:ariane' },
    });
    const rules = movementRulesFor(ariane, level);
    const plan0 = createMovePlan(ariane, level, rules);
    const planAB = /** @type {MovePlan} */ (extendMovePlan(plan0, CELL_B, rules).plan);
    const planABC = /** @type {MovePlan} */ (extendMovePlan(planAB, CELL_C, rules).plan);
    const planABD = /** @type {MovePlan} */ (extendMovePlan(planAB, CELL_D, rules).plan);

    const board = document.createElement('div');
    board.className = 'player-help-board';
    board.setAttribute('aria-label', 'Carte de correction de trajet');

    const routeSvg = /** @type {SVGSVGElement} */ (document.createElementNS('http://www.w3.org/2000/svg', 'svg'));
    routeSvg.classList.add('player-help-route-svg');
    routeSvg.setAttribute('aria-hidden', 'true');

    /** @type {{cell: Cell, control: HTMLButtonElement}[]} */
    const cells = [];
    const boardCells = rules.grid.allCells(level.widthCells, level.heightCells)
      .sort((a, b) => a.b - b.b || a.a - b.a);
    for (const cell of boardCells) {
      const key = cellKey(cell);
      const tag = TAGS[key];
      const control = document.createElement('button');
      control.type = 'button';
      control.className = 'player-help-cell';
      control.setAttribute('aria-label', tag ? `Case ${tag}` : `Case ${cell.a + 1}, ${cell.b + 1}`);
      if (tag) {
        const badge = document.createElement('span');
        badge.className = 'player-help-cell-tag';
        badge.setAttribute('aria-hidden', 'true');
        badge.textContent = tag;
        control.appendChild(badge);
      }
      control.addEventListener('click', () => handleCellClick(cell));
      cells.push({ cell, control });
      board.appendChild(control);
    }

    const pawn = document.createElement('span');
    pawn.className = 'player-help-pawn';
    pawn.setAttribute('aria-hidden', 'true');
    pawn.innerHTML = SVG_PAWN;

    const touch = document.createElement('span');
    touch.className = 'player-help-touch';
    touch.setAttribute('aria-hidden', 'true');

    const undoButton = document.createElement('button');
    undoButton.type = 'button';
    undoButton.className = 'player-help-undo';
    undoButton.title = 'Retirer la dernière étape';
    undoButton.setAttribute('aria-label', 'Retirer la dernière étape');
    undoButton.innerHTML = SVG_UNDO;
    undoButton.addEventListener('click', () => handleUndo());

    const prompt = document.createElement('div');
    prompt.className = 'player-help-prompt';
    board.append(routeSvg, pawn, touch, undoButton, prompt);

    const legend = document.createElement('div');
    legend.className = 'player-help-legend';
    legend.innerHTML = `
      <span class="player-help-legend-item"><span class="player-help-swatch is-walk" aria-hidden="true"></span>Marche (aplat)</span>
      <span class="player-help-legend-item"><span class="player-help-swatch is-run" aria-hidden="true"></span>Course (hachures jaunes)</span>
      <span class="player-help-legend-item"><span class="player-help-swatch is-route" aria-hidden="true"></span>Trajet préparé</span>
    `;
    ctx.stage.append(board, legend);

    let practicing = false;
    /** @type {'undo'|'roundtrip'} */
    let trial = 'undo';
    let removedC = false;
    let finished = false;
    /** @type {MovePlan} */
    let current = planABC;
    let pawnPosition = CELL_A;

    /**
     * @param {MovePlan} plan
     * @param {{ showTouchCell?: Cell|null, ringUndo?: boolean, undoAnchorCell?: Cell|null, movedTo?: Cell|null }} [opts]
     */
    function paint(plan, opts = {}) {
      const arrival = plan.steps.at(-1) ?? null;
      const previous = opts.undoAnchorCell ?? (plan.steps.length > 0 ? (plan.steps.at(-2) ?? plan.start) : null);
      const walkRemaining = Math.max(0, plan.walkBudget - plan.cost);
      const routeKeys = new Set(plan.path.slice(1).map(cellKey));
      const ranIdx = ranStartIndex(plan.path, rules);
      const movedTo = opts.movedTo ?? null;

      for (const { cell, control } of cells) {
        const key = cellKey(cell);
        const cost = plan.reachable.get(key);
        const canReach = !movedTo && cost !== undefined;
        control.disabled = !practicing || finished;
        control.classList.toggle('is-reachable', canReach && cost <= walkRemaining + 1e-9);
        control.classList.toggle('is-run', canReach && cost > walkRemaining + 1e-9);
        control.classList.toggle('is-route', routeKeys.has(key));
        control.classList.toggle('is-arrival', !movedTo && arrival !== null && sameCell(cell, arrival));
      }

      drawBoardRouteSvg(routeSvg, plan.path, level.widthCells, level.heightCells, ranIdx);
      positionOnGrid(pawn, movedTo ?? pawnPosition);

      const showTouch = opts.showTouchCell ?? null;
      touch.hidden = !showTouch;
      if (showTouch) positionOnGrid(touch, showTouch);

      const showUndo = !movedTo && previous !== null;
      undoButton.hidden = !showUndo;
      undoButton.disabled = !practicing || finished;
      undoButton.classList.toggle('is-ringed', Boolean(opts.ringUndo));
      if (showUndo && previous) {
        // Place le bouton au-dessus de l'étape précédente (ou dessous si rangée haute).
        const anchorY = previous.b === 0 ? previous.b + 1.5 : previous.b - 0.5;
        undoButton.style.left = `${((previous.a + 0.5) / level.widthCells) * 100}%`;
        undoButton.style.top = `${(anchorY / level.heightCells) * 100}%`;
      }

      prompt.hidden = !arrival || Boolean(movedTo);
      if (arrival && !movedTo) {
        const remaining = String(Math.max(0, Math.round(plan.remaining * 100) / 100));
        prompt.innerHTML = `
          <span>${CONFIRM_LABEL}</span>
          <span class="player-help-prompt-sub">${remaining} de portée restante</span>
          ${ranIdx > 0 ? `<span class="player-help-prompt-run">${RUN_LABEL}</span>` : ''}
        `;
        prompt.style.setProperty('--help-prompt-x', `${((arrival.a + 0.5) / level.widthCells) * 100}%`);
        prompt.style.top = `${((arrival.b + (arrival.b >= 3 ? -0.95 : 1.08)) / level.heightCells) * 100}%`;
      }
    }

    function renderTrialControls() {
      ctx.extra.replaceChildren(
        makeExtraButton(
          trial === 'undo' ? 'Essai 2 : Aller-retour sur la case B' : 'Essai 1 : Retirer C puis choisir D',
          () => startTrial(trial === 'undo' ? 'roundtrip' : 'undo'),
          'player-help-assist-btn'
        )
      );
      ctx.extra.hidden = false;
    }

    /** @param {'undo'|'roundtrip'} nextTrial */
    function startTrial(nextTrial) {
      ctx.stopReplay();
      practicing = true;
      trial = nextTrial;
      removedC = false;
      finished = false;
      current = planABC;
      pawnPosition = CELL_A;
      renderTrialControls();
      if (trial === 'undo') {
        ctx.setCaption('Trajet A → B → C prêt (4 de portée restante). Touche la flèche de retour pour retirer C.');
      } else {
        ctx.setCaption('Essai 2 : touche la case B (pas la flèche) pour prolonger en aller-retour A → B → C → B.');
      }
      paint(current);
      if (trial === 'undo') undoButton.focus();
      else cells.find(({ cell }) => sameCell(cell, CELL_B))?.control.focus();
    }

    function handleUndo() {
      if (!practicing || finished || current.steps.length === 0) return;
      current = removeLastMoveStep(current, rules);
      const remaining = Math.round(current.remaining * 100) / 100;
      if (current.steps.length === 0) {
        ctx.setCaption(`Toutes les étapes sont retirées (${remaining} de portée restante). Choisis une nouvelle étape.`);
      } else if (trial === 'undo' && sameCell(current.steps.at(-1), CELL_B)) {
        removedC = true;
        ctx.setCaption(`Étape C retirée (${remaining} de portée restante). Touche maintenant la case D.`);
      } else {
        ctx.setCaption(`Dernière étape retirée (${remaining} de portée restante).`);
      }
      paint(current);
    }

    /** @param {Cell} cell */
    function handleCellClick(cell) {
      if (!practicing || finished) return;
      const arrival = current.steps.at(-1) ?? null;
      if (arrival && sameCell(cell, arrival)) {
        if (trial === 'undo' && removedC && sameCell(arrival, CELL_D)) {
          finished = true;
          pawnPosition = arrival;
          ctx.setCaption('Parfait ! Tu as retiré C, choisi D (Course) et confirmé le déplacement.');
          paint(current, { movedTo: arrival });
          ctx.practiceButton.focus();
          return;
        }
        if (trial === 'roundtrip' && current.steps.length >= 3 && sameCell(arrival, CELL_B)) {
          finished = true;
          pawnPosition = arrival;
          ctx.setCaption('Bravo ! Toucher la case B prolonge bien le trajet en aller-retour.');
          paint(current, { movedTo: arrival });
          ctx.practiceButton.focus();
          return;
        }
        finished = true;
        pawnPosition = arrival;
        ctx.setCaption('Déplacement validé sur la case choisie.');
        paint(current, { movedTo: arrival });
        return;
      }

      if (!current.reachable.has(cellKey(cell))) {
        if (current.steps.length > 0) {
          current = plan0;
          ctx.setCaption('Tap hors zone : la préparation entière est annulée.');
          paint(current);
        }
        return;
      }

      const extended = extendMovePlan(current, cell, rules).plan;
      if (!extended) return;
      current = extended;
      const remaining = Math.round(current.remaining * 100) / 100;
      const inRun = ranStartIndex(current.path, rules) > 0;
      if (trial === 'roundtrip' && sameCell(cell, CELL_B) && current.steps.length === 3) {
        ctx.setCaption(`Aller-retour A → B → C → B prêt (${remaining} de portée restante, Course). Retouche B pour confirmer.`);
      } else if (trial === 'undo' && removedC && sameCell(cell, CELL_D)) {
        ctx.setCaption(`Trajet A → B → D prêt (${remaining} de portée restante, ${RUN_LABEL}). Retouche D pour confirmer.`);
      } else {
        ctx.setCaption(`Étape ajoutée (${remaining} de portée restante${inRun ? ', Course' : ''}). Retouche l’arrivée pour confirmer.`);
      }
      paint(current);
    }

    return {
      showExample(step) {
        practicing = false;
        finished = false;
        pawnPosition = CELL_A;
        ctx.extra.replaceChildren();
        ctx.extra.hidden = true;
        if (step === 0) paint(planABC);
        else if (step === 1) paint(planAB, { ringUndo: true, undoAnchorCell: CELL_B });
        else paint(planABD, { showTouchCell: CELL_D });
      },
      startPractice() {
        startTrial('undo');
      },
      destroy() {},
    };
  },
};

// ============================================================================================
// FICHE 3 — Cadrer et zoomer (Caméra + PointerInput locaux : pan, pinch et relâchement 2→1)
// ============================================================================================

/** @type {HelpLessonDefinition} */
const LESSON_PAN_ZOOM = {
  id: 'pan-zoom',
  group: 'Se déplacer',
  title: 'Cadrer et zoomer',
  stepsAriaLabel: 'Étapes de cadrage et de zoom',
  steps: [
    { label: 'Glisser', caption: 'Pose un doigt sur la carte et fais-la glisser.', durationMs: 2200 },
    { label: 'Agrandir', caption: 'Écarte deux doigts pour agrandir autour du point que tu regardes.', durationMs: 2400 },
    { label: 'Réduire', caption: 'Rapproche les doigts pour voir plus de carte.', durationMs: 2200 },
  ],
  mount(ctx) {
    const level = createLevel({ id: 'aide-camera', widthCells: 14, heightCells: 10 });
    const grid = gridFor(level);
    const gridLayer = new GridLayer();
    const ariane = createToken({ id: 'aide-cam-ariane', levelId: level.id, label: 'Ariane', cell: { a: 3, b: 5 }, borderColor: '#22c55e', camp: 'pj' });
    const wellCell = { a: 11, b: 3 };
    const wellPos = grid.cellCenter(wellCell);
    const arianePos = grid.cellCenter(ariane.cell);
    const extent = grid.mapExtent();
    const cellPitch = grid.cellPitch().x;

    let practicing = false;
    let demoStep = 0;
    /** @type {'pan'|'zoomIn'|'zoomOut'|'done'} */
    let phase = 'pan';
    let refZoom = 0.7;
    let peakZoom = 0.7;
    let pannedDistance = 0;

    const statusPill = document.createElement('div');
    statusPill.className = 'player-help-status-pill';
    statusPill.hidden = true;

    const surface = createHelpCanvasSurface(ctx.stage, 'Carte de cadrage et de zoom', () => {
      if (!practicing) renderDemoStep(demoStep);
      else render();
    });
    surface.frame.appendChild(statusPill);
    surface.camera.minZoom = 0.25;
    surface.camera.maxZoom = 2.6;

    /** @param {number} step */
    function renderDemoStep(step) {
      surface.syncSize();
      const { width, height } = surface.getSize();
      const z = baseZoom();
      if (step === 0) {
        surface.camera.setZoom(z);
        surface.camera.setPan(cellPitch * 7.8, cellPitch * 4.5);
        render();
        surface.setGestureMarkup(GESTURE_SVG.drag(width * 0.72, height * 0.66, width * 0.34, height * 0.56));
      } else if (step === 1) {
        surface.camera.setZoom(z * 1.48);
        surface.camera.setPan(wellPos.x - cellPitch * 0.3, wellPos.y + cellPitch * 0.2);
        render();
        const pt = surface.camera.mapToScreen(wellPos);
        surface.setGestureMarkup(GESTURE_SVG.pinch(pt.screenX, pt.screenY, 'out'));
      } else {
        surface.camera.setZoom(z * 0.62);
        surface.camera.setPan(extent.width * 0.52, extent.height * 0.48);
        render();
        surface.setGestureMarkup(GESTURE_SVG.pinch(width * 0.5, height * 0.5, 'in'));
      }
    }

    function baseZoom() {
      const { width } = surface.getSize();
      return Math.max(0.45, width / (cellPitch * 5.6));
    }

    function setCameraData() {
      surface.canvas.dataset.cameraX = String(Math.round(surface.camera.x));
      surface.canvas.dataset.cameraY = String(Math.round(surface.camera.y));
      surface.canvas.dataset.cameraZoom = String(Math.round(surface.camera.zoom * 1000) / 1000);
      surface.canvas.dataset.practicePhase = practicing ? phase : 'demo';
      surface.canvas.dataset.pawnCell = `${ariane.cell.a},${ariane.cell.b}`;
    }

    /** @param {CanvasRenderingContext2D} c */
    function drawWorld(c) {
      c.fillStyle = '#253138';
      c.fillRect(0, 0, extent.width, extent.height);

      // Chemins et repères simples du décor pour rendre le mouvement de carte évident
      c.save();
      c.strokeStyle = '#485961';
      c.lineWidth = cellPitch * 0.7;
      c.lineCap = 'round';
      c.beginPath();
      c.moveTo(cellPitch * 1, cellPitch * 6);
      c.quadraticCurveTo(cellPitch * 6.5, cellPitch * 5.5, wellPos.x, wellPos.y);
      c.stroke();

      // Bosquets repères
      for (const tree of [{ a: 2, b: 2 }, { a: 5, b: 7 }, { a: 8, b: 2 }, { a: 10, b: 7 }]) {
        const pt = grid.cellCenter(tree);
        c.fillStyle = '#27463a';
        c.beginPath();
        c.arc(pt.x, pt.y, cellPitch * 0.38, 0, Math.PI * 2);
        c.fill();
        c.strokeStyle = '#3f6f5b';
        c.lineWidth = 3;
        c.stroke();
      }
      c.restore();

      gridLayer.render(c, grid);

      // Puits près du bord droit : repère principal de l'exercice
      c.save();
      c.fillStyle = '#3c5a6e';
      c.strokeStyle = '#ffbf47';
      c.lineWidth = 5;
      c.beginPath();
      c.arc(wellPos.x, wellPos.y, cellPitch * 0.42, 0, Math.PI * 2);
      c.fill();
      c.stroke();
      c.fillStyle = '#182b38';
      c.beginPath();
      c.arc(wellPos.x, wellPos.y, cellPitch * 0.24, 0, Math.PI * 2);
      c.fill();
      c.font = `700 ${15 / surface.camera.zoom}px system-ui, sans-serif`;
      c.textAlign = 'center';
      c.lineWidth = 4 / surface.camera.zoom;
      ctxStrokeText(c, 'Puits', wellPos.x, wellPos.y + cellPitch * 0.65);
      c.restore();

      drawHelpCanvasToken(c, grid, ariane, { zoom: surface.camera.zoom });
    }

    /** @param {CanvasRenderingContext2D} c @param {string} text @param {number} x @param {number} y */
    function ctxStrokeText(c, text, x, y) {
      c.strokeStyle = '#101820';
      c.strokeText(text, x, y);
      c.fillStyle = '#fff2c8';
      c.fillText(text, x, y);
    }

    function wellInFrame() {
      const { width, height } = surface.getSize();
      const s = surface.camera.mapToScreen(wellPos);
      return s.screenX >= 24 && s.screenX <= width - 24 && s.screenY >= 24 && s.screenY <= height - 24;
    }

    function updateStatusPill() {
      if (!practicing) {
        statusPill.hidden = true;
        return;
      }
      statusPill.hidden = false;
      const stepNum = phase === 'pan' ? '1/3 : Glisser vers le puits'
        : phase === 'zoomIn' ? '2/3 : Agrandir sur le puits'
          : phase === 'zoomOut' ? '3/3 : Réduire la vue'
            : 'Exercice réussi';
      statusPill.textContent = stepNum;
    }

    function render() {
      surface.renderFrame(drawWorld);
      setCameraData();
      updateStatusPill();
    }

    function evaluatePractice() {
      if (!practicing || phase === 'done') return;
      if (phase === 'pan') {
        if (pannedDistance >= 20 && wellInFrame()) {
          phase = 'zoomIn';
          refZoom = surface.camera.zoom;
          peakZoom = refZoom;
          ctx.setCaption('Le puits est dans le cadre ! Écarte deux doigts (ou la molette) pour agrandir.');
          render();
        }
      } else if (phase === 'zoomIn') {
        if (surface.camera.zoom > peakZoom) peakZoom = surface.camera.zoom;
        if (surface.camera.zoom >= refZoom * 1.18) {
          phase = 'zoomOut';
          peakZoom = surface.camera.zoom;
          ctx.setCaption('Bien agrandi ! Rapproche maintenant deux doigts pour réduire et voir plus de carte.');
          render();
        }
      } else if (phase === 'zoomOut') {
        if (surface.camera.zoom > peakZoom) peakZoom = surface.camera.zoom;
        if (surface.camera.zoom <= peakZoom * 0.85) {
          phase = 'done';
          ctx.setCaption('Parfait ! Tu sais déplacer la carte, agrandir et réduire sans bouger ton pion.');
          render();
        }
      }
    }

    /** @param {number} dx @param {number} dy */
    function applyPan(dx, dy) {
      if (!practicing) return;
      surface.camera.setPan(
        Math.max(0, Math.min(extent.width, surface.camera.x - dx / surface.camera.zoom)),
        Math.max(0, Math.min(extent.height, surface.camera.y - dy / surface.camera.zoom))
      );
      pannedDistance += Math.hypot(dx, dy);
      render();
      evaluatePractice();
    }

    /** @param {number} scaleFactor @param {{ screenX: number, screenY: number }} center */
    function applyZoom(scaleFactor, center) {
      if (!practicing) return;
      const before = surface.camera.screenToMap(center);
      surface.camera.setZoom(surface.camera.zoom * scaleFactor);
      const after = surface.camera.screenToMap(center);
      surface.camera.setPan(
        Math.max(0, Math.min(extent.width, surface.camera.x + before.x - after.x)),
        Math.max(0, Math.min(extent.height, surface.camera.y + before.y - after.y))
      );
      render();
      evaluatePractice();
    }

    const pointerInput = new PointerInput(surface.canvas, surface.camera, {
      role: 'players',
      onIntention(intention) {
        if (!practicing) return;
        if (intention.type === 'panBy') {
          applyPan(intention.deltaX, intention.deltaY);
        } else if (intention.type === 'pinchZoom') {
          applyZoom(intention.scaleFactor, intention.center);
        } else if (intention.type === 'tap' && phase === 'pan') {
          ctx.setCaption('Une simple pression ne suffit pas : pose un doigt et fais glisser la carte vers la gauche.');
        }
      },
    });

    function mountKeyboardAssist() {
      ctx.extra.replaceChildren(
        makeExtraButton('Aide clavier : Glisser vers le puits', () => {
          if (!practicing) return;
          pannedDistance += 120;
          surface.camera.setPan(wellPos.x - cellPitch * 0.4, wellPos.y + cellPitch * 0.2);
          render();
          evaluatePractice();
        }),
        makeExtraButton('Aide clavier : Agrandir', () => {
          const { width, height } = surface.getSize();
          applyZoom(1.3, { screenX: width / 2, screenY: height / 2 });
        }),
        makeExtraButton('Aide clavier : Réduire', () => {
          const { width, height } = surface.getSize();
          applyZoom(0.75, { screenX: width / 2, screenY: height / 2 });
        })
      );
      ctx.extra.hidden = false;
    }

    return {
      showExample(step) {
        practicing = false;
        demoStep = step;
        ctx.extra.replaceChildren();
        ctx.extra.hidden = true;
        renderDemoStep(step);
      },
      startPractice() {
        practicing = true;
        phase = 'pan';
        pannedDistance = 0;
        surface.syncSize();
        const z = baseZoom() * 1.05;
        refZoom = z;
        peakZoom = z;
        surface.camera.setZoom(z);
        surface.camera.setPan(arianePos.x + cellPitch * 0.4, arianePos.y);
        surface.setGestureMarkup('');
        mountKeyboardAssist();
        ctx.setCaption('Fais glisser la carte pour afficher le puits (vers la droite), puis agrandis et réduis.');
        render();
      },
      destroy() {
        pointerInput.detach();
        surface.destroy();
      },
    };
  },
};

// ============================================================================================
// FICHE 4 — Voir ou rejoindre un étage (onglets d'étage + franchissement d'escalier)
// ============================================================================================

/** @type {HelpLessonDefinition} */
const LESSON_LEVELS = {
  id: 'levels',
  group: 'Se déplacer',
  title: 'Voir ou rejoindre un étage',
  stepsAriaLabel: 'Étapes des étages et escaliers',
  steps: [
    { group: 'Regarder un étage', label: 'Regarder un étage', caption: 'Touche un onglet pour regarder un autre étage connu.' },
    { group: 'Prendre l’escalier', label: 'Aller jusqu’à l’escalier', caption: 'Amène ton personnage à pied sur la case de l’escalier.' },
    { group: 'Prendre l’escalier', label: 'Franchir', caption: 'Sans pion sélectionné, touche le bouton « Prendre l’escalier » au-dessus de ton personnage.' },
    { group: 'Prendre l’escalier', label: 'Voir l’arrivée', caption: 'Choisis l’étage d’arrivée pour retrouver ton personnage.' },
  ],
  mount(ctx) {
    const START = { a: 1, b: 2 };
    const STAIRS = { a: 4, b: 2 };
    const ARRIVAL = { a: 4, b: 2 };
    const levelRdc = createLevel({ id: 'rdc', name: 'Rez-de-chaussée', widthCells: 7, heightCells: 5 });
    const ariane = createToken({ id: 'aide-etage-ariane', levelId: 'rdc', label: 'Ariane', cell: START, speedCells: 4 });
    /** @type {Link} */
    const stairsLink = {
      id: 'aide-etage-escalier',
      kind: 'stairs',
      label: 'Escalier',
      a: { levelId: 'rdc', at: { cellX: STAIRS.a, cellY: STAIRS.b } },
      b: { levelId: 'etage', at: { cellX: ARRIVAL.a, cellY: ARRIVAL.b } },
      bidirectional: true,
      gmOnly: false,
    };
    const rules = movementRulesFor(ariane, levelRdc);
    const basePlan = createMovePlan(ariane, levelRdc, rules);
    const stairsPlan = createMovePlan({ ...ariane, cell: STAIRS }, levelRdc, rules);
    const toStairs = /** @type {MovePlan} */ (extendMovePlan(basePlan, STAIRS, rules).plan);

    const box = document.createElement('div');
    box.className = 'player-help-scene-box';

    const tabs = document.createElement('div');
    tabs.className = 'player-help-level-tabs';
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Étages connus');

    /** @param {'rdc'|'etage'} id @param {string} label */
    const makeTab = (id, label) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'player-help-level-tab';
      btn.setAttribute('role', 'tab');
      btn.dataset.levelId = id;
      btn.textContent = label;
      btn.addEventListener('click', () => handleTabClick(id));
      return btn;
    };
    const tabRdc = makeTab('rdc', 'Rez-de-chaussée');
    const tabUpper = makeTab('etage', 'Étage');
    tabs.append(tabRdc, tabUpper);

    const board = document.createElement('div');
    board.className = 'player-help-board';
    board.setAttribute('aria-label', 'Plan de l’étage fictif');

    const floorDecor = /** @type {SVGSVGElement} */ (document.createElementNS('http://www.w3.org/2000/svg', 'svg'));
    floorDecor.classList.add('player-help-floor-decor');
    floorDecor.setAttribute('viewBox', '0 0 700 500');
    floorDecor.setAttribute('aria-hidden', 'true');

    const routeSvg = /** @type {SVGSVGElement} */ (document.createElementNS('http://www.w3.org/2000/svg', 'svg'));
    routeSvg.classList.add('player-help-route-svg');
    routeSvg.setAttribute('aria-hidden', 'true');

    /** @type {{cell: Cell, control: HTMLButtonElement}[]} */
    const cells = [];
    for (const cell of rules.grid.allCells(7, 5).sort((a, b) => a.b - b.b || a.a - b.a)) {
      const control = document.createElement('button');
      control.type = 'button';
      control.className = 'player-help-cell';
      control.setAttribute('aria-label', sameCell(cell, STAIRS) ? 'Escalier' : `Case ${cell.a + 1}, ${cell.b + 1}`);
      control.addEventListener('click', () => handleCellClick(cell));
      cells.push({ cell, control });
      board.appendChild(control);
    }

    const linkMarker = document.createElement('span');
    linkMarker.className = 'player-help-link-marker';
    linkMarker.setAttribute('aria-hidden', 'true');
    linkMarker.innerHTML = '<span class="player-help-link-dot">↕</span>';
    positionOnGrid(linkMarker, STAIRS);

    const pawn = document.createElement('span');
    pawn.className = 'player-help-pawn';
    pawn.setAttribute('aria-hidden', 'true');
    pawn.innerHTML = SVG_PAWN;

    const touch = document.createElement('span');
    touch.className = 'player-help-touch';
    touch.setAttribute('aria-hidden', 'true');

    const prompt = document.createElement('span');
    prompt.className = 'player-help-prompt';
    prompt.textContent = CONFIRM_LABEL;

    const linkBtn = document.createElement('button');
    linkBtn.type = 'button';
    linkBtn.className = 'player-help-link-btn';
    linkBtn.hidden = true;
    linkBtn.style.setProperty('--help-link-x', `${((STAIRS.a + 0.5) / 7) * 100}%`);
    linkBtn.style.bottom = `calc(${((5 - STAIRS.b) / 5) * 100}% + 6px)`;
    linkBtn.addEventListener('click', () => handleLinkButtonClick());

    board.append(floorDecor, routeSvg, linkMarker, pawn, touch, prompt, linkBtn);
    box.append(tabs, board);
    ctx.stage.appendChild(box);

    ctx.setNote(
      'Seuls les étages connus apparaissent dans la barre (elle est absente si un seul étage est connu). Le bouton d’escalier disparaît dès qu’un pion est sélectionné. À cheval, descends d’abord :',
      { label: 'Voir « Monter ou descendre de cheval »', lessonId: 'mount' }
    );

    let practicing = false;
    /** @type {'rdc'|'etage'} */
    let viewedLevel = 'rdc';
    /** @type {'rdc'|'etage'} */
    let pawnLevel = 'rdc';
    let pawnCell = START;
    let selected = false;
    /** @type {MovePlan|null} */
    let planned = null;
    /** @type {'lookUp'|'lookDown'|'moveToStairs'|'traverse'|'seeArrival'|'done'} */
    let phase = 'lookUp';

    /** @param {'rdc'|'etage'} levelId */
    function renderFloorDecor(levelId) {
      board.classList.toggle('is-upper-floor', levelId === 'etage');
      if (levelId === 'rdc') {
        floorDecor.innerHTML = `
          <rect x="20" y="20" width="240" height="120" rx="8" fill="rgba(160,120,76,0.22)" stroke="#9b7d54" stroke-width="3"/>
          <text x="140" y="88" text-anchor="middle" fill="#cbd5df" font-size="22" font-weight="700" font-family="system-ui, sans-serif">Salle commune</text>
          <rect x="460" y="340" width="210" height="120" rx="8" fill="rgba(75,112,96,0.22)" stroke="#5b8473" stroke-width="3"/>
          <text x="565" y="408" text-anchor="middle" fill="#cbd5df" font-size="20" font-weight="600" font-family="system-ui, sans-serif">Entrée</text>`;
      } else {
        floorDecor.innerHTML = `
          <rect x="30" y="30" width="270" height="440" rx="8" fill="rgba(96,112,168,0.2)" stroke="#7c8ec4" stroke-width="3"/>
          <text x="165" y="96" text-anchor="middle" fill="#d7e1f7" font-size="22" font-weight="700" font-family="system-ui, sans-serif">Galerie haute</text>
          <line x1="30" y1="250" x2="300" y2="250" stroke="#7c8ec4" stroke-width="3" stroke-dasharray="10 8"/>
          <text x="165" y="370" text-anchor="middle" fill="#d7e1f7" font-size="20" font-weight="600" font-family="system-ui, sans-serif">Chambres</text>`;
      }
    }

    /**
     * @param {{
     *   view: 'rdc'|'etage',
     *   tokenFloor: 'rdc'|'etage',
     *   tokenAt: Cell,
     *   selected?: boolean,
     *   route?: Cell[],
     *   showZone?: boolean,
     *   promptText?: string|null,
     *   touchCell?: Cell|null,
     *   ringTab?: 'rdc'|'etage'|null,
     *   ringLinkBtn?: boolean,
     * }} st
     */
    function paint(st) {
      tabRdc.setAttribute('aria-selected', String(st.view === 'rdc'));
      tabUpper.setAttribute('aria-selected', String(st.view === 'etage'));
      tabRdc.disabled = !practicing;
      tabUpper.disabled = !practicing;
      tabRdc.classList.toggle('is-ringed', st.ringTab === 'rdc');
      tabUpper.classList.toggle('is-ringed', st.ringTab === 'etage');
      renderFloorDecor(st.view);

      const route = st.route ?? [];
      const routeKeys = new Set(route.slice(1).map(cellKey));
      const arrival = planned?.steps.at(-1) ?? null;
      const zonePlan = sameCell(st.tokenAt, STAIRS) ? stairsPlan : basePlan;

      for (const { cell, control } of cells) {
        const key = cellKey(cell);
        const isPawnHere = st.tokenFloor === st.view && sameCell(cell, st.tokenAt);
        control.disabled = !practicing || phase === 'done';
        control.classList.toggle('is-reachable', Boolean(st.showZone) && zonePlan.reachable.has(key));
        control.classList.toggle('is-route', routeKeys.has(key));
        control.classList.toggle('is-arrival', Boolean(arrival) && sameCell(cell, arrival));
        if (isPawnHere && sameCell(cell, STAIRS)) control.setAttribute('aria-label', 'Ariane sur l’escalier');
        else if (isPawnHere) control.setAttribute('aria-label', 'Ariane');
        else if (sameCell(cell, STAIRS)) control.setAttribute('aria-label', 'Escalier');
        else control.setAttribute('aria-label', `Case ${cell.a + 1}, ${cell.b + 1}`);
      }

      drawBoardRouteSvg(routeSvg, route, 7, 5);
      const showPawn = st.tokenFloor === st.view;
      pawn.hidden = !showPawn;
      if (showPawn) positionOnGrid(pawn, st.tokenAt);

      touch.hidden = !st.touchCell;
      if (st.touchCell) positionOnGrid(touch, st.touchCell);

      prompt.hidden = !st.promptText;
      if (st.promptText) {
        prompt.textContent = st.promptText;
        prompt.style.setProperty('--help-prompt-x', `${((st.tokenAt.a + 0.5) / 7) * 100}%`);
        prompt.style.top = `${((st.tokenAt.b - 0.68) / 5) * 100}%`;
      }

      // TJ-1 & TJ-8 : le bouton de liaison n'apparaît que sans sélection active et si `boutonLiaison` l'autorise.
      const hasSelection = Boolean(st.selected) || route.length > 0;
      const linkButton =
        !hasSelection && st.view === 'rdc'
          ? boutonLiaison(rules.grid, levelRdc, [stairsLink], {
              ...ariane,
              levelId: st.tokenFloor,
              cell: st.tokenAt,
            })
          : null;
      linkBtn.hidden = !linkButton;
      linkBtn.disabled = !practicing || phase === 'done';
      linkBtn.classList.toggle('is-ringed', Boolean(st.ringLinkBtn));
      if (linkButton) linkBtn.textContent = linkButton.label;
    }

    function paintPractice() {
      const showMovePrompt = Boolean(planned?.steps.length);
      paint({
        view: viewedLevel,
        tokenFloor: pawnLevel,
        tokenAt: pawnCell,
        selected,
        route: planned?.path ?? [],
        showZone: selected && pawnLevel === viewedLevel,
        promptText: showMovePrompt ? CONFIRM_LABEL : null,
      });
    }

    /** @param {'rdc'|'etage'} id */
    function handleTabClick(id) {
      if (!practicing) return;
      viewedLevel = id;
      if (phase === 'lookUp' && id === 'etage') {
        phase = 'lookDown';
        ctx.setCaption('L’étage s’affiche, mais Ariane est restée en bas. Reviens sur “Rez-de-chaussée”.');
      } else if (phase === 'lookDown' && id === 'rdc') {
        phase = 'moveToStairs';
        ctx.setCaption('Touche Ariane à pied, puis amène-la sur la case de l’escalier (↕) en deux taps.');
      } else if (phase === 'seeArrival' && id === 'etage') {
        phase = 'done';
        ctx.setCaption('Bravo ! Tu as retrouvé Ariane sur l’étage d’arrivée.');
      }
      paintPractice();
    }

    function handleLinkButtonClick() {
      if (!practicing || phase !== 'traverse' || selected || planned) return;
      if (viewedLevel !== 'rdc' || pawnLevel !== 'rdc' || !sameCell(pawnCell, STAIRS)) return;
      const currentToken = { ...ariane, levelId: pawnLevel, cell: pawnCell };
      if (!boutonLiaison(rules.grid, levelRdc, [stairsLink], currentToken)) return;
      pawnLevel = 'etage';
      pawnCell = ARRIVAL;
      selected = false;
      planned = null;
      phase = 'seeArrival';
      ctx.setCaption('Ariane a pris l’escalier. La vue reste au rez-de-chaussée : touche l’onglet “Étage”.');
      paintPractice();
      tabUpper.focus();
    }

    /** @param {Cell} cell */
    function handleCellClick(cell) {
      if (!practicing || phase === 'done') return;
      if (phase === 'lookUp' || phase === 'lookDown') {
        ctx.setCaption('Commence par toucher les onglets d’étage en haut de la carte.');
        return;
      }
      if (viewedLevel !== pawnLevel) return;

      if (!selected) {
        if (sameCell(cell, pawnCell)) {
          selected = true;
          if (phase === 'moveToStairs') ctx.setCaption('Choisis la case de l’escalier (↕).');
          else if (phase === 'traverse') {
            ctx.setCaption('Un pion sélectionné masque le bouton d’escalier. Touche une case vide pour désélectionner Ariane.');
          }
          paintPractice();
        }
        return;
      }

      // TJ-1 : retaper la case du pion sélectionné ne franchit plus la liaison.
      if (sameCell(cell, pawnCell)) {
        if (sameCell(pawnCell, STAIRS)) {
          ctx.setCaption('Retaper la case ne prend plus l’escalier. Touche une case vide pour désélectionner Ariane, puis touche le bouton « Prendre l’escalier ».');
        }
        return;
      }

      if (phase === 'traverse') {
        // Désélectionner sur une case vide fait réapparaître le bouton d'escalier (TJ-8).
        selected = false;
        planned = null;
        ctx.setCaption('Ariane est désélectionnée : touche le bouton « Prendre l’escalier » pour franchir.');
        paintPractice();
        return;
      }

      if (phase === 'moveToStairs') {
        const arrival = planned?.steps.at(-1) ?? null;
        if (arrival && sameCell(cell, arrival) && sameCell(arrival, STAIRS)) {
          pawnCell = STAIRS;
          selected = false;
          planned = null;
          phase = 'traverse';
          ctx.setCaption('Ariane est sur l’escalier. Touche le bouton « Prendre l’escalier » pour franchir.');
          paintPractice();
          linkBtn.focus();
          return;
        }
        if (sameCell(cell, STAIRS)) {
          planned = toStairs;
          ctx.setCaption('Retouche la case de l’escalier pour confirmer le déplacement.');
          paintPractice();
          return;
        }
        if (planned) {
          planned = null;
          ctx.setCaption('Trajet annulé. Choisis la case de l’escalier (↕).');
        } else {
          selected = false;
          ctx.setCaption('Touche Ariane à pied, puis amène-la sur la case de l’escalier (↕) en deux taps.');
        }
        paintPractice();
      }
    }

    return {
      showExample(step) {
        practicing = false;
        selected = false;
        planned = null;
        ctx.extra.replaceChildren();
        ctx.extra.hidden = true;
        if (step === 0) {
          paint({ view: 'etage', tokenFloor: 'rdc', tokenAt: START, ringTab: 'etage' });
        } else if (step === 1) {
          paint({ view: 'rdc', tokenFloor: 'rdc', tokenAt: START, selected: true, route: toStairs.path, showZone: true, promptText: CONFIRM_LABEL, touchCell: STAIRS });
        } else if (step === 2) {
          paint({ view: 'rdc', tokenFloor: 'rdc', tokenAt: STAIRS, selected: false, ringLinkBtn: true });
        } else {
          paint({ view: 'etage', tokenFloor: 'etage', tokenAt: ARRIVAL, ringTab: 'etage' });
        }
      },
      startPractice() {
        practicing = true;
        viewedLevel = 'rdc';
        pawnLevel = 'rdc';
        pawnCell = START;
        selected = false;
        planned = null;
        phase = 'lookUp';
        ctx.extra.replaceChildren();
        ctx.extra.hidden = true;
        ctx.setCaption('D’abord, touche l’onglet “Étage” pour regarder l’étage sans déplacer Ariane.');
        paintPractice();
        tabUpper.focus();
      },
      destroy() {},
    };
  },
};

// ============================================================================================
// FICHE 5 — Consulter un pion et ses états (encart lecture seule, badge, appui maintenu)
// ============================================================================================

/** @type {HelpLessonDefinition} */
const LESSON_INSPECT = {
  id: 'inspect',
  group: 'Lire la carte',
  title: 'Consulter un pion et ses états',
  stepsAriaLabel: 'Étapes de consultation d’un pion',
  steps: [
    { label: 'Consulter sans sélection', caption: 'Touche le garde visible pour ouvrir son encart.' },
    { label: 'Lire un badge', caption: 'Touche un badge pour lire le nom de l’état.' },
    { label: 'Consulter pendant un trajet', caption: 'Garde le doigt sur l’adversaire pour lire son encart et sa distance.', durationMs: 2600 },
    { label: 'Relâcher', caption: 'Relâche le doigt pour retrouver ton personnage et son trajet.' },
  ],
  mount(ctx) {
    const level = createLevel({ id: 'aide-inspect', widthCells: 7, heightCells: 5 });
    const grid = gridFor(level);
    const gridLayer = new GridLayer();
    const ariane = createToken({
      id: 'aide-ariane',
      levelId: level.id,
      label: 'Ariane',
      cell: { a: 2, b: 2 },
      kind: 'pc',
      camp: 'pj',
      borderColor: '#22c55e',
      speedCells: 3,
      hp: { current: 10, max: 12 },
    });
    const garde = createToken({
      id: 'aide-garde',
      levelId: level.id,
      label: 'Garde',
      cell: { a: 3, b: 2 },
      kind: 'npc',
      camp: 'ennemi',
      borderColor: '#ef4444',
      health: 'wounded',
      hp: { current: 4, max: 10 },
      markers: ['prone'],
    });
    const sentinelle = createToken({
      id: 'aide-sentinelle',
      levelId: level.id,
      label: 'Sentinelle',
      cell: { a: 5, b: 2 },
      kind: 'npc',
      camp: 'ennemi',
      borderColor: '#ef4444',
      health: 'unharmed',
      hidden: false,
    });
    const visibleIds = new Set([ariane.id, garde.id]);
    const allTokens = [ariane, garde, sentinelle];
    const rules = movementRulesFor(ariane, level);
    const planStart = createMovePlan(ariane, level, rules);
    const demoPlannedCell = { a: 0, b: 2 };
    const demoPlan = /** @type {MovePlan} */ (extendMovePlan(planStart, demoPlannedCell, rules).plan);

    const realDistance = distanceBetweenFootprints(level, ariane, garde);
    const distanceLabel = formatInspectionDistance(realDistance, ariane.label);

    let practicing = false;
    let demoStep = 0;
    /** @type {'inspectNpc'|'readBadge'|'selectAriane'|'planStep'|'touchHold'|'done'} */
    let phase = 'inspectNpc';
    let arianeSelected = false;
    /** @type {MovePlan|null} */
    let currentPlan = null;
    /** @type {Token|null} */
    let inspected = null;
    let holdActive = false;
    let holdInterrupted = false;
    let kbHolding = false;
    /** @type {{ x: number, y: number }|null} */
    let holdStartClient = null;
    let activePointerCount = 0;

    const surface = createHelpCanvasSurface(ctx.stage, 'Carte de consultation des pions', () => {
      if (!practicing) renderDemoStep(demoStep);
      else render();
    });
    const strip = createHelpSelectionStrip(surface.frame, {
      onBadgeTap(_id, label) {
        if (!practicing || phase !== 'readBadge') return;
        phase = 'selectAriane';
        ctx.setCaption(`État lu (« ${label} »). Touche maintenant Ariane pour préparer un déplacement.`);
        render();
      },
    });

    function fitCamera() {
      const extent = grid.mapExtent();
      const { width, height } = surface.getSize();
      const availWidth = Math.max(120, width - 116);
      const zoom = Math.min(availWidth / extent.width, height / extent.height) * 0.96;
      surface.camera.setZoom(zoom);
      surface.camera.setPan(extent.width / 2 + 55 / zoom, extent.height / 2);
    }

    /** @param {number} step */
    function renderDemoStep(step) {
      surface.syncSize();
      fitCamera();
      const gardeScreen = surface.camera.mapToScreen(grid.cellCenter(garde.cell));
      if (step === 0) {
        arianeSelected = false;
        currentPlan = null;
        inspected = garde;
        syncUi();
        surface.setGestureMarkup(GESTURE_SVG.tap(gardeScreen.screenX, gardeScreen.screenY));
      } else if (step === 1) {
        arianeSelected = false;
        currentPlan = null;
        inspected = garde;
        syncUi({ ringTarget: 'badge', staticBadgeLabel: 'À terre' });
        surface.setGestureMarkup('');
      } else if (step === 2) {
        arianeSelected = true;
        currentPlan = demoPlan;
        inspected = garde;
        syncUi();
        surface.setGestureMarkup(GESTURE_SVG.hold(gardeScreen.screenX, gardeScreen.screenY));
      } else {
        arianeSelected = true;
        currentPlan = demoPlan;
        inspected = null;
        syncUi();
        surface.setGestureMarkup('');
      }
    }

    /** @param {CanvasRenderingContext2D} c */
    function drawWorld(c) {
      const extent = grid.mapExtent();
      c.fillStyle = '#28333a';
      c.fillRect(0, 0, extent.width, extent.height);
      gridLayer.render(c, grid);

      // Zone atteignable et trajet préparé d'Ariane (conservés pendant l'appui maintenu)
      const showPlan = currentPlan;
      if (arianeSelected) {
        const activePlan = showPlan ?? planStart;
        c.save();
        c.fillStyle = 'rgba(34, 197, 94, 0.32)';
        c.strokeStyle = '#22c55e';
        c.lineWidth = 2 / surface.camera.zoom;
        for (const key of activePlan.reachable.keys()) {
          const [a, b] = key.split(',').map(Number);
          c.beginPath();
          grid.cellPath(c, { a, b });
          c.fill();
          c.stroke();
        }
        c.restore();
      }
      if (showPlan && showPlan.path.length >= 2) {
        const pts = showPlan.path.map((cell) => grid.cellCenter(cell));
        const dest = showPlan.path[showPlan.path.length - 1];
        c.save();
        c.strokeStyle = '#ffbf47';
        c.lineWidth = 4 / surface.camera.zoom;
        c.setLineDash([9 / surface.camera.zoom, 6 / surface.camera.zoom]);
        c.beginPath();
        pts.forEach((p, idx) => (idx === 0 ? c.moveTo(p.x, p.y) : c.lineTo(p.x, p.y)));
        c.stroke();
        c.setLineDash([]);
        c.beginPath();
        grid.cellPath(c, dest);
        c.stroke();
        c.restore();
      }

      // Pions visibles uniquement (la sentinelle hors vision reste sous le voile sombre)
      drawHelpCanvasToken(c, grid, ariane, { selected: arianeSelected, zoom: surface.camera.zoom });
      drawHelpCanvasToken(c, grid, garde, { zoom: surface.camera.zoom });

      // Brouillard sur les colonnes 5..6 pour montrer une zone hors vision courante
      const fogStart = grid.mapFromGeometryPoint({ cellX: 5, cellY: 0 });
      c.save();
      c.fillStyle = 'rgba(8, 12, 16, 0.9)';
      c.fillRect(fogStart.x, 0, extent.width - fogStart.x, extent.height);
      c.font = `600 ${12 / surface.camera.zoom}px system-ui, sans-serif`;
      c.fillStyle = '#9aa8b4';
      c.textAlign = 'center';
      c.fillText('Hors vision', (fogStart.x + extent.width) / 2, extent.height * 0.45);
      c.restore();
    }

    function render() {
      fitCamera();
      surface.renderFrame(drawWorld);
      surface.canvas.dataset.practicePhase = practicing ? phase : 'demo';
      surface.canvas.dataset.arianeSelected = String(arianeSelected);
      surface.canvas.dataset.plannedArrival = currentPlan?.steps.at(-1)
        ? cellKey(/** @type {Cell} */ (currentPlan.steps.at(-1)))
        : '';
      surface.canvas.dataset.inspected = inspected?.id ?? '';
    }

    /** @param {{ ringTarget?: 'badge'|null, staticBadgeLabel?: string|null }} [demoOpts] */
    function syncUi(demoOpts = {}) {
      render();
      if (inspected) {
        strip.update({
          token: inspected,
          mode: 'consultation',
          distanceText: arianeSelected ? distanceLabel : '',
          ringTarget: demoOpts.ringTarget ?? null,
          staticBadgeLabel: demoOpts.staticBadgeLabel ?? null,
        });
      } else if (arianeSelected) {
        strip.update({ token: ariane, mode: 'selection' });
      } else {
        strip.update({ token: null, mode: 'consultation' });
      }
      if (practicing && phase === 'touchHold') {
        const kbBtn = makeExtraButton(
          kbHolding ? 'Aide clavier : Relâcher le Garde' : 'Aide clavier : Maintenir sur le Garde',
          () => {
            if (!practicing || phase !== 'touchHold') return;
            if (!kbHolding) {
              kbHolding = true;
              inspected = garde;
              ctx.setCaption(`Encart du Garde affiché (${distanceLabel}). Relâche maintenant pour retrouver Ariane.`);
              syncUi();
            } else {
              kbHolding = false;
              inspected = null;
              phase = 'done';
              ctx.setCaption('Bravo ! Tu as consulté le Garde et retrouvé Ariane avec son trajet intact.');
              ctx.extra.replaceChildren();
              ctx.extra.hidden = true;
              syncUi();
            }
          }
        );
        ctx.extra.replaceChildren(kbBtn);
        ctx.extra.hidden = false;
      } else if (practicing) {
        ctx.extra.replaceChildren();
        ctx.extra.hidden = true;
      }
    }

    // Surveille les interruptions (glisser, second doigt, annulation) afin de ne valider qu'un vrai maintien suivi d'un relâchement.
    const guardAbort = new AbortController();
    surface.canvas.addEventListener('pointerdown', (e) => {
      activePointerCount++;
      if (activePointerCount === 1) holdStartClient = { x: e.clientX, y: e.clientY };
      if (holdActive && activePointerCount > 1) holdInterrupted = true;
    }, { capture: true, signal: guardAbort.signal });
    surface.canvas.addEventListener('pointermove', (e) => {
      if (holdActive && holdStartClient && Math.hypot(e.clientX - holdStartClient.x, e.clientY - holdStartClient.y) >= 5) {
        holdInterrupted = true;
      }
    }, { capture: true, signal: guardAbort.signal });
    surface.canvas.addEventListener('pointercancel', () => {
      if (holdActive) holdInterrupted = true;
      activePointerCount = Math.max(0, activePointerCount - 1);
    }, { capture: true, signal: guardAbort.signal });
    surface.canvas.addEventListener('pointerup', () => {
      activePointerCount = Math.max(0, activePointerCount - 1);
      if (activePointerCount === 0) holdStartClient = null;
    }, { capture: true, signal: guardAbort.signal });

    const pointerInput = new PointerInput(surface.canvas, surface.camera, {
      role: 'players',
      contextKey: () => `${practicing}:${arianeSelected}:${currentPlan?.revision ?? 0}`,
      startTouchHold(mapPos) {
        if (!practicing || !arianeSelected) return;
        const hit = findHitToken(grid, level, mapPos, surface.camera.zoom, allTokens, {
          filter: (t) => visibleIds.has(t.id),
        });
        if (!hit || isPlayerManipulableToken(hit.token)) return;
        holdActive = true;
        holdInterrupted = false;
        inspected = hit.token;
        ctx.setCaption(`Encart du Garde ouvert (${distanceLabel}). Relâche le doigt pour retrouver Ariane.`);
        render();
        strip.update({ token: inspected, mode: 'consultation', distanceText: distanceLabel });
        return () => {
          const wasInterrupted = holdInterrupted;
          holdActive = false;
          holdInterrupted = false;
          inspected = null;
          if (phase === 'touchHold' && !wasInterrupted && currentPlan) {
            phase = 'done';
            ctx.setCaption('Bravo ! Tu as consulté le Garde et retrouvé Ariane avec son trajet intact.');
            syncUi();
          } else if (wasInterrupted && phase === 'touchHold') {
            ctx.setCaption('Consultation fermée par le geste. Garde le doigt immobile sur le Garde puis relâche.');
            syncUi();
          } else {
            syncUi();
          }
        };
      },
      onIntention(intention) {
        if (!practicing || intention.type !== 'tap') return;
        const cell = grid.cellFromPoint(intention.mapPos);
        if (!cell) return;
        const hit = findHitToken(grid, level, intention.mapPos, surface.camera.zoom, allTokens, {
          filter: (t) => visibleIds.has(t.id),
          deprioritize: (t) => !isPlayerManipulableToken(t),
        });
        // Vérification de la règle de vision : la sentinelle hors vision ne s'ouvre jamais.
        if (!hit && sameCell(cell, sentinelle.cell)) {
          inspected = null;
          ctx.setCaption('Un pion hors de la vision courante ne peut pas être consulté.');
          syncUi();
          return;
        }
        if (!arianeSelected) {
          if (hit?.token.id === garde.id) {
            inspected = garde;
            if (phase === 'inspectNpc') {
              phase = 'readBadge';
              ctx.setCaption('Encart du Garde ouvert (sans chiffres de PV). Touche maintenant son badge à droite.');
            }
            syncUi();
          } else if (hit?.token.id === ariane.id && (phase === 'selectAriane' || phase === 'planStep' || phase === 'touchHold' || phase === 'done')) {
            inspected = null;
            arianeSelected = true;
            if (phase === 'selectAriane') {
              phase = 'planStep';
              ctx.setCaption('Ariane est sélectionnée. Touche une case éclairée pour préparer une arrivée.');
            }
            syncUi();
          } else {
            inspected = null;
            syncUi();
          }
          return;
        }
        // Ariane sélectionnée : préparer une case d'arrivée (sans déplacer le pion)
        if (phase === 'planStep') {
          if (hit?.token.id === garde.id) {
            ctx.setCaption('Prépare d’abord une case vide pour Ariane (par exemple à gauche).');
            return;
          }
          const next = extendMovePlan(planStart, cell, rules).plan;
          if (next) {
            currentPlan = next;
            phase = 'touchHold';
            ctx.setCaption('Trajet prêt. Maintiens maintenant le doigt posé sur le Garde, puis relâche.');
            syncUi();
          }
        } else if (phase === 'touchHold' && hit?.token.id === garde.id) {
          ctx.setCaption('Un simple tap ne suffit pas pendant un trajet : garde le doigt posé sur le Garde, puis relâche.');
        }
      },
    });

    return {
      showExample(step) {
        practicing = false;
        demoStep = step;
        kbHolding = false;
        ctx.extra.replaceChildren();
        ctx.extra.hidden = true;
        renderDemoStep(step);
      },
      startPractice() {
        practicing = true;
        phase = 'inspectNpc';
        arianeSelected = false;
        currentPlan = null;
        inspected = null;
        holdActive = false;
        holdInterrupted = false;
        kbHolding = false;
        surface.setGestureMarkup('');
        ctx.setCaption('Sans sélection, touche le Garde visible pour ouvrir son encart.');
        syncUi();
      },
      destroy() {
        guardAbort.abort();
        pointerInput.detach();
        strip.destroy();
        surface.destroy();
      },
    };
  },
};

// ============================================================================================
// FICHE 6 — Montrer un point ou retrouver un ping (double tap + flèche hors cadre du MJ)
// ============================================================================================

/** @type {HelpLessonDefinition} */
const LESSON_PING = {
  id: 'ping',
  group: 'Lire la carte',
  title: 'Montrer un point ou retrouver un ping',
  stepsAriaLabel: 'Étapes du ping',
  steps: [
    { label: 'Montrer un point', caption: 'Sans pion sélectionné, touche deux fois le même point pour le signaler à la table.', durationMs: 2200 },
    { label: 'Lire la direction', caption: 'La flèche indique où le MJ a pointé, au-delà de l’écran.', durationMs: 2200 },
    { label: 'Retrouver le point', caption: 'Si la flèche pointe à droite, fais glisser la carte vers la gauche pour retrouver le point.', durationMs: 2400 },
  ],
  mount(ctx) {
    const level = createLevel({ id: 'aide-ping', widthCells: 14, heightCells: 8 });
    const grid = gridFor(level);
    const gridLayer = new GridLayer();
    const pingsLayer = new PingsLayer();
    const extent = grid.mapExtent();
    const cellPitch = grid.cellPitch().x;
    const localTarget = grid.cellCenter({ a: 3, b: 4 });
    const gmTarget = grid.cellCenter({ a: 11, b: 4 });

    let practicing = false;
    let demoStep = 0;
    /** @type {'doubleTap'|'findGmPing'|'done'} */
    let phase = 'doubleTap';
    let testingOtherFloor = false;
    /** @type {{ levelId: string, mapPos: MapPoint, at: number, fromGm?: boolean }|null} */
    let activePing = null;
    /** @type {number|null} */
    let frozenAgeMs = null;
    /** @type {number|null} */
    let rafId = null;
    /** @type {ReturnType<typeof setTimeout>|null} */
    let gmRefreshTimer = null;
    let lastArrowDrawn = false;
    let lastDotDrawn = false;

    const surface = createHelpCanvasSurface(ctx.stage, 'Carte de démonstration des pings', () => {
      if (!practicing) renderDemoStep(demoStep);
      else render();
    });
    ctx.setNote('Un double tap sur l’arrivée d’un trajet déjà préparé valide le déplacement et ne lance pas de ping. La flèche indique un ping du MJ sur l’étage affiché uniquement.');

    /** @param {number} step */
    function renderDemoStep(step) {
      surface.syncSize();
      const { width, height } = surface.getSize();
      surface.camera.setZoom(baseZoom());
      frozenAgeMs = 1150;
      if (step === 0) {
        surface.camera.setPan(localTarget.x + cellPitch * 0.6, localTarget.y);
        activePing = { levelId: level.id, mapPos: localTarget, at: 1000, fromGm: false };
        render();
        const pt = surface.camera.mapToScreen(localTarget);
        surface.setGestureMarkup(GESTURE_SVG.doubleTap(pt.screenX, pt.screenY));
      } else if (step === 1) {
        surface.camera.setPan(localTarget.x + cellPitch * 0.6, localTarget.y);
        activePing = { levelId: level.id, mapPos: gmTarget, at: 1000, fromGm: true };
        render();
        surface.setGestureMarkup('');
      } else {
        surface.camera.setPan(gmTarget.x - cellPitch * 0.6, gmTarget.y);
        activePing = { levelId: level.id, mapPos: gmTarget, at: 1000, fromGm: true };
        render();
        surface.setGestureMarkup(GESTURE_SVG.drag(width * 0.72, height * 0.75, width * 0.3, height * 0.75));
      }
    }

    function baseZoom() {
      const { width } = surface.getSize();
      return Math.max(0.42, width / (cellPitch * 6.4));
    }

    function stopTimers() {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = null;
      if (gmRefreshTimer !== null) clearTimeout(gmRefreshTimer);
      gmRefreshTimer = null;
    }

    function scheduleFrame() {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        render();
      });
    }

    function emitGmPing() {
      activePing = { levelId: level.id, mapPos: gmTarget, at: Date.now(), fromGm: true };
      if (gmRefreshTimer !== null) clearTimeout(gmRefreshTimer);
      gmRefreshTimer = setTimeout(() => {
        if (practicing && phase === 'findGmPing') emitGmPing();
      }, PING_DURATION_MS + 120);
      render();
      checkGmPingFound();
    }

    /** @param {CanvasRenderingContext2D} c */
    function drawWorld(c) {
      c.fillStyle = '#253138';
      c.fillRect(0, 0, extent.width, extent.height);
      gridLayer.render(c, grid);

      // Deux repères clairs sur la carte
      for (const [pos, label, fill] of /** @type {const} */ ([
        [localTarget, 'Repère', '#395569'],
        [gmTarget, 'Tour', '#59423a'],
      ])) {
        c.save();
        c.fillStyle = fill;
        c.strokeStyle = '#9db1bf';
        c.lineWidth = 3;
        c.beginPath();
        c.arc(pos.x, pos.y, cellPitch * 0.34, 0, Math.PI * 2);
        c.fill();
        c.stroke();
        c.font = `700 ${14 / surface.camera.zoom}px system-ui, sans-serif`;
        c.textAlign = 'center';
        c.lineWidth = 4 / surface.camera.zoom;
        c.strokeStyle = '#101820';
        c.strokeText(label, pos.x, pos.y + cellPitch * 0.62);
        c.fillStyle = '#f4eee2';
        c.fillText(label, pos.x, pos.y + cellPitch * 0.62);
        c.restore();
      }

      const now = frozenAgeMs !== null && activePing ? activePing.at + frozenAgeMs : Date.now();
      const pingResult = pingsLayer.render(c, grid, level, {
        ping: activePing,
        now,
        zoom: surface.camera.zoom,
        edge: activePing?.fromGm ? { camera: surface.camera, top: 0 } : undefined,
      });
      const targetScreen = activePing ? surface.camera.mapToScreen(activePing.mapPos) : null;
      const { width, height } = surface.getSize();
      const targetInside = Boolean(
        targetScreen &&
        targetScreen.screenX >= 0 && targetScreen.screenX <= width &&
        targetScreen.screenY >= 0 && targetScreen.screenY <= height
      );
      lastArrowDrawn = pingResult.drawn && Boolean(activePing?.fromGm) && !targetInside;
      lastDotDrawn = pingResult.drawn && targetInside;

      if (practicing && pingResult.animationActive) {
        scheduleFrame();
      }
    }

    function render() {
      surface.renderFrame(drawWorld);
      surface.canvas.dataset.practicePhase = practicing ? phase : 'demo';
      surface.canvas.dataset.otherFloorPing = String(practicing && testingOtherFloor);
      surface.canvas.dataset.cameraZoom = String(Math.round(surface.camera.zoom * 1000) / 1000);
      surface.canvas.dataset.pingArrow = String(lastArrowDrawn);
      surface.canvas.dataset.pingDot = String(lastDotDrawn);
    }

    function resumeExercise() {
      if (!practicing || !testingOtherFloor) return;
      testingOtherFloor = false;
      if (phase === 'doubleTap') {
        activePing = null;
        ctx.setCaption('Exercice repris. Aucun pion n’est sélectionné : touche deux fois rapidement le repère pour lancer un ping.');
        mountPracticeExtras();
        render();
      } else if (phase === 'findGmPing') {
        ctx.setCaption('Exercice repris. Le MJ pointe hors cadre à droite : fais glisser la carte vers la gauche.');
        mountPracticeExtras();
        emitGmPing();
      } else {
        activePing = { levelId: level.id, mapPos: gmTarget, at: Date.now(), fromGm: true };
        ctx.setCaption('Bravo ! La flèche a cédé la place au ping du MJ dans le cadre.');
        mountPracticeExtras();
        render();
      }
    }

    function checkGmPingFound() {
      if (!practicing || phase !== 'findGmPing' || testingOtherFloor) return;
      const { width, height } = surface.getSize();
      const s = surface.camera.mapToScreen(gmTarget);
      if (s.screenX >= 36 && s.screenX <= width - 36 && s.screenY >= 24 && s.screenY <= height - 24) {
        if (gmRefreshTimer !== null) clearTimeout(gmRefreshTimer);
        gmRefreshTimer = null;
        activePing = { levelId: level.id, mapPos: gmTarget, at: Date.now(), fromGm: true };
        phase = 'done';
        ctx.setCaption('Bravo ! La flèche a cédé la place au ping du MJ dans le cadre.');
        mountPracticeExtras();
        render();
      }
    }

    const pointerInput = new PointerInput(surface.canvas, surface.camera, {
      role: 'players',
      canDoubleTap: () => practicing && phase === 'doubleTap',
      contextKey: () => `${practicing}:${phase}:${testingOtherFloor}`,
      onIntention(intention) {
        if (!practicing) return;
        if (intention.type === 'doubleTap' && phase === 'doubleTap') {
          testingOtherFloor = false;
          activePing = { levelId: level.id, mapPos: intention.mapPos, at: Date.now(), fromGm: false };
          phase = 'findGmPing';
          ctx.setCaption('Ping envoyé ! Le MJ pointe maintenant hors cadre à droite : fais glisser la carte vers la gauche.');
          mountPracticeExtras();
          render();
          // Déclenche le ping du MJ juste après pour laisser lire le ping local.
          gmRefreshTimer = setTimeout(() => {
            if (practicing && phase === 'findGmPing' && !testingOtherFloor) emitGmPing();
          }, 650);
        } else if (intention.type === 'tap' && phase === 'doubleTap' && !testingOtherFloor) {
          ctx.setCaption('Un seul tap ne lance pas de ping. Touche deux fois rapidement au même endroit.');
        } else if (intention.type === 'panBy') {
          if (testingOtherFloor && phase === 'findGmPing') {
            testingOtherFloor = false;
            mountPracticeExtras();
            emitGmPing();
          }
          surface.camera.setPan(
            Math.max(0, Math.min(extent.width, surface.camera.x - intention.deltaX / surface.camera.zoom)),
            Math.max(0, Math.min(extent.height, surface.camera.y - intention.deltaY / surface.camera.zoom))
          );
          render();
          checkGmPingFound();
        }
      },
    });

    function mountPracticeExtras() {
      const buttons = [];
      if (testingOtherFloor) {
        buttons.push(makeExtraButton('Reprendre l’exercice', () => {
          resumeExercise();
        }));
      } else {
        if (phase === 'doubleTap') {
          buttons.push(makeExtraButton('Aide clavier : Double tap sur le repère', () => {
            pointerInput.emit({ type: 'doubleTap', screenPos: surface.camera.mapToScreen(localTarget), mapPos: localTarget });
          }));
        } else if (phase === 'findGmPing') {
          buttons.push(makeExtraButton('Aide clavier : Glisser vers la flèche du MJ', () => {
            surface.camera.setPan(gmTarget.x - cellPitch * 0.4, gmTarget.y);
            render();
            checkGmPingFound();
          }));
        }
        buttons.push(makeExtraButton('Tester un ping d’un autre étage', () => {
          stopTimers();
          testingOtherFloor = true;
          activePing = { levelId: 'autre-etage', mapPos: gmTarget, at: Date.now(), fromGm: true };
          ctx.setCaption('Ping envoyé sur un autre étage : aucune flèche ne s’affiche sur l’étage courant. Touche “Reprendre l’exercice” pour continuer.');
          mountPracticeExtras();
          render();
          const resumeBtn = ctx.extra.querySelector('button');
          if (resumeBtn instanceof HTMLButtonElement) resumeBtn.focus();
        }));
      }
      ctx.extra.replaceChildren(...buttons);
      ctx.extra.hidden = false;
    }

    return {
      showExample(step) {
        stopTimers();
        practicing = false;
        testingOtherFloor = false;
        demoStep = step;
        ctx.extra.replaceChildren();
        ctx.extra.hidden = true;
        renderDemoStep(step);
      },
      startPractice() {
        stopTimers();
        practicing = true;
        phase = 'doubleTap';
        testingOtherFloor = false;
        frozenAgeMs = null;
        activePing = null;
        surface.syncSize();
        surface.camera.setZoom(baseZoom());
        surface.camera.setPan(localTarget.x + cellPitch * 0.6, localTarget.y);
        surface.setGestureMarkup('');
        ctx.setCaption('Aucun pion n’est sélectionné. Touche deux fois rapidement le repère pour lancer un ping.');
        mountPracticeExtras();
        render();
      },
      destroy() {
        stopTimers();
        pointerInput.detach();
        surface.destroy();
      },
    };
  },
};

// ============================================================================================
// FICHE 7 — Ouvrir ou fermer une porte (PortalsLayer + boutonsPorte + porte verrouillée)
// ============================================================================================

/** @type {HelpLessonDefinition} */
const LESSON_PORTAL = {
  id: 'portal',
  group: 'Lire la carte',
  title: 'Ouvrir ou fermer une porte',
  stepsAriaLabel: 'Étapes de manipulation d’une porte',
  steps: [
    { label: 'Porte fermée', caption: 'Sans pion sélectionné, touche le bouton « Ouvrir » de l’autre côté de la porte.' },
    { label: 'Porte ouverte', caption: 'Le passage est ouvert. Dès qu’un pion est sélectionné, le bouton disparaît.' },
    { label: 'Refermer', caption: 'Touche le bouton « Fermer » pour refermer. Porte verrouillée : aucun bouton n’apparaît, demande au MJ.', durationMs: 2200 },
  ],
  mount(ctx) {
    /** @type {Portal} */
    const portal = {
      id: 'aide-porte',
      a: { cellX: 3, cellY: 2 },
      b: { cellX: 3, cellY: 3 },
      state: 'closed',
      freestanding: false,
    };
    const level = createLevel({
      id: 'aide-portal',
      widthCells: 7,
      heightCells: 5,
      walls: [
        [{ cellX: 3, cellY: 0 }, { cellX: 3, cellY: 2 }],
        [{ cellX: 3, cellY: 3 }, { cellX: 3, cellY: 5 }],
      ],
      portals: [portal],
    });
    const grid = gridFor(level);
    const gridLayer = new GridLayer();
    const portalsLayer = new PortalsLayer();
    // Placée en (2, 2) pour être adjacente au segment (3,2)-(3,3) : `boutonsPorte` pose le bouton en (3, 2).
    const ariane = createToken({
      id: 'aide-porte-ariane',
      levelId: level.id,
      label: 'Ariane',
      cell: { a: 2, b: 2 },
      kind: 'pc',
      playerMovable: true,
      camp: 'pj',
      borderColor: '#22c55e',
    });

    let practicing = false;
    let demoStep = 0;
    /** @type {'toggle'|'locked'} */
    let trial = 'toggle';
    let arianeSelected = false;
    let renderedDoorButtons = 0;
    let openedOnce = false;
    let finished = false;

    const surface = createHelpCanvasSurface(ctx.stage, 'Carte d’ouverture de porte', () => {
      if (!practicing) renderDemoStep(demoStep);
      else render();
    });

    ctx.setNote('Les boutons de porte disparaissent dès qu’un pion est sélectionné, et n’apparaissent jamais sur une porte verrouillée.');

    /** @returns {MapPoint|null} */
    function activeDoorButtonCenter() {
      if (arianeSelected) return null;
      const btn = boutonsPorte(grid, level, [ariane], { zoom: surface.camera.zoom })[0];
      if (!btn) return null;
      return { x: btn.rect.x + btn.rect.width / 2, y: btn.rect.y + btn.rect.height / 2 };
    }

    /** @param {number} step */
    function renderDemoStep(step) {
      surface.syncSize();
      fitCamera();
      arianeSelected = false;
      if (step === 0) {
        portal.state = 'closed';
        lockInset.hidden = true;
        render();
        const btnCenter = activeDoorButtonCenter();
        if (btnCenter) {
          const btnScreen = surface.camera.mapToScreen(btnCenter);
          surface.setGestureMarkup(GESTURE_SVG.tap(btnScreen.screenX, btnScreen.screenY));
        } else {
          surface.setGestureMarkup('');
        }
      } else if (step === 1) {
        portal.state = 'open';
        lockInset.hidden = true;
        render();
        surface.setGestureMarkup('');
      } else {
        portal.state = 'open';
        lockInset.hidden = false;
        render();
        const btnCenter = activeDoorButtonCenter();
        if (btnCenter) {
          const btnScreen = surface.camera.mapToScreen(btnCenter);
          surface.setGestureMarkup(GESTURE_SVG.tap(btnScreen.screenX, btnScreen.screenY));
        } else {
          surface.setGestureMarkup('');
        }
      }
    }
    const lockInset = document.createElement('div');
    lockInset.className = 'player-help-portal-inset';
    lockInset.hidden = true;
    lockInset.innerHTML = `
      <svg width="36" height="18" viewBox="0 0 36 18" aria-hidden="true">
        <line x1="2" y1="9" x2="34" y2="9" stroke="#ef4444" stroke-width="4"/>
        <circle cx="18" cy="9" r="5" fill="#ef4444" stroke="#ffffff" stroke-width="1.5"/>
      </svg>
      <span>Porte verrouillée : aucun bouton, demande au MJ</span>`;
    surface.frame.appendChild(lockInset);

    function fitCamera() {
      const extent = grid.mapExtent();
      const { width, height } = surface.getSize();
      surface.camera.setPan(extent.width / 2, extent.height / 2);
      surface.camera.setZoom(Math.min(width / extent.width, height / extent.height) * 0.96);
    }

    /** @param {CanvasRenderingContext2D} c */
    function drawWorld(c) {
      const extent = grid.mapExtent();
      const wallX = grid.mapFromGeometryPoint({ cellX: 3, cellY: 0 }).x;
      // Pièce éclairée à gauche, pièce voisine à droite
      c.fillStyle = '#334047';
      c.fillRect(0, 0, wallX, extent.height);
      c.fillStyle = portal.state === 'open' ? '#364642' : '#182026';
      c.fillRect(wallX, 0, extent.width - wallX, extent.height);

      gridLayer.render(c, grid);

      // Mobilier simple dans la pièce voisine (visible seulement quand la porte est ouverte)
      if (portal.state === 'open') {
        const chest = grid.cellCenter({ a: 5, b: 2 });
        const pitch = grid.cellPitch().x;
        c.save();
        c.fillStyle = '#805a33';
        c.strokeStyle = '#d9b574';
        c.lineWidth = 3;
        c.fillRect(chest.x - pitch * 0.28, chest.y - pitch * 0.2, pitch * 0.56, pitch * 0.4);
        c.strokeRect(chest.x - pitch * 0.28, chest.y - pitch * 0.2, pitch * 0.56, pitch * 0.4);
        c.restore();
      } else {
        c.save();
        c.fillStyle = 'rgba(7, 11, 15, 0.72)';
        c.fillRect(wallX, 0, extent.width - wallX, extent.height);
        c.restore();
      }

      // Murs visibles comme décor de la pièce
      c.save();
      c.strokeStyle = '#94a3b8';
      c.lineWidth = 6 / surface.camera.zoom;
      c.lineCap = 'square';
      for (const poly of level.walls) {
        const p1 = grid.mapFromGeometryPoint(poly[0]);
        const p2 = grid.mapFromGeometryPoint(poly[1]);
        c.beginPath();
        c.moveTo(p1.x, p1.y);
        c.lineTo(p2.x, p2.y);
        c.stroke();
      }
      c.restore();

      portalsLayer.render(c, grid, level, { zoom: surface.camera.zoom });
      drawHelpCanvasToken(c, grid, ariane, { selected: arianeSelected, zoom: surface.camera.zoom });
      // TJ-2, TJ-4, TJ-8 : bouton d'adjacence peint au-dessus du brouillard, absent si verrouillé ou si pion sélectionné.
      renderedDoorButtons = arianeSelected
        ? 0
        : portalsLayer.renderButtons(c, grid, level, [ariane], { zoom: surface.camera.zoom });
    }

    function render() {
      fitCamera();
      surface.renderFrame(drawWorld);
      surface.canvas.dataset.portalState = portal.state;
      surface.canvas.dataset.pawnCell = `${ariane.cell.a},${ariane.cell.b}`;
      surface.canvas.dataset.arianeSelected = String(arianeSelected);
      surface.canvas.dataset.doorButtons = String(renderedDoorButtons);
      surface.canvas.dataset.practiceTrial = practicing ? trial : 'demo';
    }

    /** @param {MapPoint} mapPos */
    function handleTapMapPos(mapPos) {
      if (!practicing) return;
      const tokenHit = findHitToken(grid, level, mapPos, surface.camera.zoom, [ariane]);

      // TJ-8 : tant qu'un pion est sélectionné, aucun bouton de porte n'est actif.
      if (arianeSelected) {
        if (tokenHit) {
          ctx.setCaption('Ariane est sélectionnée : le bouton de porte reste masqué. Touche une case vide pour la désélectionner.');
          return;
        }
        arianeSelected = false;
        ctx.setCaption(
          portal.state === 'locked'
            ? 'Ariane est désélectionnée. Cette porte est verrouillée : aucun bouton n’apparaît.'
            : 'Ariane est désélectionnée : le bouton de porte réapparaît.'
        );
        render();
        return;
      }

      // TJ-2 & TJ-4 : ouverture uniquement via `boutonsPorte` (vide si verrouillée), jamais en touchant le seuil.
      const doorButtons = boutonsPorte(grid, level, [ariane], { zoom: surface.camera.zoom });
      const hitDoorButton = doorButtons.find((btn) => pointInRect(mapPos, btn.rect));
      if (hitDoorButton && hitDoorButton.enabled) {
        if (portal.state === 'closed') {
          portal.state = 'open';
          openedOnce = true;
          ctx.setCaption('La porte est ouverte et la pièce voisine apparaît. Touche le bouton « Fermer » pour la refermer.');
          render();
        } else if (portal.state === 'open') {
          portal.state = 'closed';
          if (openedOnce) {
            finished = true;
            ctx.setCaption('Parfait ! Tu as ouvert puis refermé la porte par son bouton, sans déplacer Ariane.');
          }
          render();
        }
        return;
      }

      if (tokenHit) {
        arianeSelected = true;
        ctx.setCaption(
          portal.state === 'locked'
            ? 'Ariane est sélectionnée. Cette porte est verrouillée : aucun bouton n’apparaît, demande au MJ pour l’ouvrir.'
            : 'Ariane est sélectionnée : le bouton de porte disparaît. Touche une case vide pour la désélectionner.'
        );
        render();
        return;
      }

      if (portal.state === 'locked') {
        finished = true;
        ctx.setCaption('Cette porte est verrouillée : aucun bouton n’apparaît et elle reste fermée. Demande au MJ pour l’ouvrir.');
        render();
        return;
      }

      const expectedLabel = portal.state === 'open' ? 'Fermer' : 'Ouvrir';
      ctx.setCaption(`Toucher le seuil de la porte ne l’ouvre plus. Touche le bouton « ${expectedLabel} » de l’autre côté.`);
    }

    const pointerInput = new PointerInput(surface.canvas, surface.camera, {
      role: 'players',
      onIntention(intention) {
        if (intention.type === 'tap') handleTapMapPos(intention.mapPos);
      },
    });

    /** @param {'toggle'|'locked'} nextTrial */
    function startTrial(nextTrial) {
      ctx.stopReplay();
      practicing = true;
      trial = nextTrial;
      arianeSelected = false;
      openedOnce = false;
      finished = false;
      lockInset.hidden = true;
      portal.state = trial === 'locked' ? 'locked' : 'closed';
      surface.setGestureMarkup('');
      const extras = [];
      if (trial === 'toggle') {
        extras.push(
          makeExtraButton('Aide clavier : Toucher le bouton de porte', () => {
            const btnCenter = activeDoorButtonCenter();
            if (!btnCenter) {
              ctx.setCaption('Aucun bouton de porte n’est affiché tant qu’Ariane est sélectionnée. Touche une case vide pour la désélectionner.');
              return;
            }
            handleTapMapPos(btnCenter);
          })
        );
      }
      extras.push(
        makeExtraButton(
          trial === 'toggle' ? 'Essai 2 : Porte verrouillée' : 'Essai 1 : Ouvrir et refermer',
          () => startTrial(trial === 'toggle' ? 'locked' : 'toggle')
        )
      );
      ctx.extra.replaceChildren(...extras);
      ctx.extra.hidden = false;
      ctx.setCaption(
        trial === 'locked'
          ? 'Essai 2 : cette porte est verrouillée (cadenas rouge). Aucun bouton n’apparaît : demande au MJ pour l’ouvrir.'
          : 'Touche le bouton « Ouvrir » de l’autre côté de la porte, puis le bouton « Fermer ».'
      );
      render();
    }

    return {
      showExample(step) {
        practicing = false;
        demoStep = step;
        ctx.extra.replaceChildren();
        ctx.extra.hidden = true;
        renderDemoStep(step);
      },
      startPractice() {
        startTrial('toggle');
      },
      destroy() {
        pointerInput.detach();
        surface.destroy();
      },
    };
  },
};

// ============================================================================================
// FICHE 8 — Monter ou descendre de cheval (autonome + lié MJ, lien avec l'escalier)
// ============================================================================================

/** @type {HelpLessonDefinition} */
const LESSON_MOUNT = {
  id: 'mount',
  group: 'Interagir',
  title: 'Monter ou descendre de cheval',
  stepsAriaLabel: 'Étapes de la monture',
  steps: [
    { group: 'Monture à la tablette', label: 'Monter', caption: 'Sélectionne ton personnage, puis touche le cheval pour monter.' },
    { group: 'Monture à la tablette', label: 'Descendre', caption: 'Touche le cheval barré pour descendre, par exemple avant l’escalier.' },
    { group: 'Monture gérée par le MJ', label: 'Monture liée', caption: 'Si l’outil MJ gère la monture, demande au MJ de te faire descendre.', durationMs: 2400 },
    { group: 'Monture gérée par le MJ', label: 'Descente par le MJ', caption: 'Une fois descendu par le MJ et sans sélection active, le bouton « Prendre l’escalier » apparaît.' },
  ],
  mount(ctx) {
    const STAIRS = { a: 2, b: 2 };
    const level = createLevel({ id: 'aide-mount', widthCells: 7, heightCells: 5 });
    const grid = gridFor(level);
    /** @type {Link} */
    const stairsLink = {
      id: 'aide-mount-escalier',
      kind: 'stairs',
      label: 'Escalier',
      a: { levelId: level.id, at: { cellX: STAIRS.a, cellY: STAIRS.b } },
      b: { levelId: 'aide-mount-etage', at: { cellX: STAIRS.a, cellY: STAIRS.b } },
      bidirectional: true,
      gmOnly: false,
    };

    const autonomousToken = createToken({
      id: 'aide-cavalier-libre',
      levelId: level.id,
      label: 'Ariane',
      cell: STAIRS,
      speedCells: 2,
      camp: 'pj',
      borderColor: '#22c55e',
      mounted: false,
      hp: { current: 10, max: 12 },
    });
    const linkedToken = createToken({
      id: 'aide-cavalier-lie',
      levelId: level.id,
      label: 'Ariane',
      cell: STAIRS,
      speedCells: 2,
      camp: 'pj',
      borderColor: '#22c55e',
      mounted: true,
      link: { source: 'outil-mj', ref: 'pj:ariane' },
      hp: { current: 10, max: 12 },
    });

    const box = document.createElement('div');
    box.className = 'player-help-scene-box';

    const board = document.createElement('div');
    board.className = 'player-help-board';
    board.setAttribute('aria-label', 'Carte de gestion de la monture');

    /** @type {{cell: Cell, control: HTMLButtonElement}[]} */
    const cells = [];
    for (const cell of grid.allCells(7, 5).sort((a, b) => a.b - b.b || a.a - b.a)) {
      const control = document.createElement('button');
      control.type = 'button';
      control.className = 'player-help-cell';
      control.setAttribute('aria-label', sameCell(cell, STAIRS) ? 'Ariane sur l’escalier' : `Case ${cell.a + 1}, ${cell.b + 1}`);
      control.addEventListener('click', () => handleCellClick(cell));
      cells.push({ cell, control });
      board.appendChild(control);
    }

    const linkMarker = document.createElement('span');
    linkMarker.className = 'player-help-link-marker';
    linkMarker.setAttribute('aria-hidden', 'true');
    linkMarker.innerHTML = '<span class="player-help-link-dot">↕</span>';
    positionOnGrid(linkMarker, STAIRS);

    const pawn = document.createElement('span');
    pawn.className = 'player-help-pawn';
    pawn.setAttribute('aria-hidden', 'true');
    pawn.innerHTML = `${SVG_PAWN}<span class="player-help-pawn-badge" hidden><img src="${MOUNTED_ICON_URL}" alt=""></span>`;
    const pawnMountBadge = /** @type {HTMLElement} */ (pawn.querySelector('.player-help-pawn-badge'));

    const prompt = document.createElement('span');
    prompt.className = 'player-help-prompt has-strip';

    const linkBtn = document.createElement('button');
    linkBtn.type = 'button';
    linkBtn.className = 'player-help-link-btn';
    linkBtn.hidden = true;
    linkBtn.style.setProperty('--help-link-x', `${((STAIRS.a + 0.5) / 7) * 100}%`);
    linkBtn.style.bottom = `calc(${((5 - STAIRS.b) / 5) * 100}% + 6px)`;
    linkBtn.addEventListener('click', () => handleLinkButtonClick());

    board.append(linkMarker, pawn, prompt, linkBtn);
    box.appendChild(board);
    ctx.stage.appendChild(box);

    let practicing = false;
    /** @type {'local'|'linked'} */
    let mode = 'local';
    let selected = true;
    let mounted = false;
    let traversed = false;
    /** @type {'mount'|'dismount'|'traverse'|'done'} */
    let phase = 'mount';

    const strip = createHelpSelectionStrip(box, {
      onToggleMounted() {
        if (!practicing || mode !== 'local' || traversed) return;
        mounted = !mounted;
        if (mounted && phase === 'mount') {
          phase = 'dismount';
          ctx.setCaption('Ariane est à cheval et sa portée s’actualise. À l’escalier, touche le cheval barré pour descendre.');
        } else if (!mounted && phase === 'dismount') {
          phase = 'traverse';
          ctx.setCaption('Ariane est descendue. Touche une case vide pour la désélectionner et afficher le bouton « Prendre l’escalier ».');
        }
        paintCurrent();
      },
    });

    /**
     * @param {{
     *   token: Token,
     *   selected: boolean,
     *   showZone: boolean,
     *   promptText: string|null,
     *   ringMount?: boolean,
     *   ringLinkBtn?: boolean,
     *   hiddenPawn?: boolean,
     * }} view
     */
    function paint(view) {
      const rules = movementRulesFor(view.token, level);
      const reachable = createMovePlan(view.token, level, rules).reachable;
      for (const { cell, control } of cells) {
        const key = cellKey(cell);
        control.disabled = !practicing || phase === 'done';
        control.classList.toggle('is-reachable', view.showZone && reachable.has(key));
      }
      pawn.hidden = Boolean(view.hiddenPawn);
      positionOnGrid(pawn, view.token.cell);
      pawnMountBadge.hidden = view.token.mounted !== true;
      prompt.hidden = !view.promptText || Boolean(view.hiddenPawn);
      if (view.promptText) {
        prompt.textContent = view.promptText;
        prompt.style.top = '10px';
      }
      // TJ-1 & TJ-8 : aucun bouton tant que le pion est sélectionné ou monté (`boutonLiaison` renvoie null si monté).
      const linkButton =
        !view.selected && !view.hiddenPawn
          ? boutonLiaison(grid, level, [stairsLink], view.token)
          : null;
      linkBtn.hidden = !linkButton;
      linkBtn.disabled = !practicing || phase === 'done';
      linkBtn.classList.toggle('is-ringed', Boolean(view.ringLinkBtn));
      if (linkButton) linkBtn.textContent = linkButton.label;
      strip.update({
        token: view.selected && !view.hiddenPawn ? view.token : null,
        mode: 'selection',
        ringTarget: view.ringMount ? 'mount' : null,
      });
    }

    function activeToken() {
      const base = mode === 'linked' ? linkedToken : autonomousToken;
      return { ...base, mounted };
    }

    function paintCurrent() {
      const token = activeToken();
      // Côté joueurs, la mention au-dessus de l'escalier se limite au seul cas pion monté (TJ-1).
      const promptText =
        selected && !traversed && token.mounted
          ? (mode === 'linked' ? MOUNT_LINKED_PROMPT : MOUNT_LOCAL_PROMPT)
          : null;
      paint({ token, selected, showZone: selected && !traversed, promptText, hiddenPawn: traversed });
    }

    function handleLinkButtonClick() {
      if (!practicing || traversed || selected || mounted) return;
      const token = activeToken();
      if (!boutonLiaison(grid, level, [stairsLink], token)) return;
      if (phase === 'traverse') {
        traversed = true;
        phase = 'done';
        ctx.setCaption('Bravo ! Ariane est descendue de cheval puis a franchi l’escalier.');
        paintCurrent();
      } else {
        ctx.setCaption('Sélectionne d’abord Ariane pour essayer de monter puis descendre de cheval.');
      }
    }

    /** @param {Cell} cell */
    function handleCellClick(cell) {
      if (!practicing || traversed) return;
      if (sameCell(cell, STAIRS)) {
        if (!selected) {
          selected = true;
          ctx.setCaption(
            phase === 'traverse'
              ? 'Ariane est sélectionnée : le bouton d’escalier disparaît. Touche une case vide pour la désélectionner.'
              : 'Ariane est sélectionnée sur l’escalier.'
          );
          paintCurrent();
          return;
        }
        if (mounted) {
          ctx.setCaption(
            mode === 'linked'
              ? 'À cheval sur un pion lié, seul le MJ peut te faire descendre avant l’escalier.'
              : 'À cheval, on ne franchit pas l’escalier : touche le cheval barré à droite pour descendre.'
          );
          return;
        }
        // TJ-1 : retaper la case d'Ariane sélectionnée ne franchit jamais l'escalier.
        ctx.setCaption('Retaper la case ne prend plus l’escalier. Touche une case vide pour désélectionner Ariane, puis touche le bouton « Prendre l’escalier ».');
        return;
      }

      if (selected) {
        // TJ-8 : désélectionner sur une case vide fait apparaître le bouton d'escalier si Ariane est à pied.
        selected = false;
        if (mounted) {
          ctx.setCaption('Ariane est désélectionnée mais reste à cheval : aucun bouton d’escalier n’apparaît. Resélectionne-la pour descendre.');
        } else if (phase === 'traverse') {
          ctx.setCaption('Ariane est désélectionnée : touche le bouton « Prendre l’escalier » pour franchir.');
        } else {
          ctx.setCaption('Ariane est désélectionnée. Touche-la pour afficher la bande à droite et monter à cheval.');
        }
        paintCurrent();
      }
    }

    /** @param {'local'|'linked'} nextMode */
    function startTrial(nextMode) {
      ctx.stopReplay();
      practicing = true;
      mode = nextMode;
      selected = true;
      traversed = false;
      mounted = mode === 'linked';
      phase = mode === 'linked' ? 'dismount' : 'mount';

      const controls = [];
      if (mode === 'linked') {
        controls.push(makeExtraButton('Le MJ fait descendre le personnage', () => {
          if (!practicing || mode !== 'linked' || !mounted) return;
          mounted = false;
          phase = 'traverse';
          ctx.setCaption(
            selected
              ? 'Le MJ a fait descendre Ariane. Touche une case vide pour la désélectionner et afficher le bouton « Prendre l’escalier ».'
              : 'Le MJ a fait descendre Ariane : touche le bouton « Prendre l’escalier » pour franchir.'
          );
          paintCurrent();
        }, 'player-help-gm-btn'));
        controls.push(makeExtraButton('Revenir à l’essai autonome', () => startTrial('local')));
        ctx.setCaption('Pion lié : le cheval à droite est grisé. Utilise le bouton MJ sous les actions pour faire descendre Ariane.');
      } else {
        controls.push(makeExtraButton('Voir l’exemple monture gérée par le MJ', () => startTrial('linked')));
        ctx.setCaption('Ariane est sélectionnée sur l’escalier. Touche le cheval à droite pour monter.');
      }
      ctx.extra.replaceChildren(...controls);
      ctx.extra.hidden = false;
      paintCurrent();
    }

    return {
      showExample(step) {
        practicing = false;
        traversed = false;
        ctx.extra.replaceChildren();
        ctx.extra.hidden = true;
        if (step === 0) {
          selected = true;
          paint({ token: { ...autonomousToken, mounted: false }, selected: true, showZone: true, promptText: null, ringMount: true });
        } else if (step === 1) {
          selected = true;
          paint({ token: { ...autonomousToken, mounted: true }, selected: true, showZone: true, promptText: MOUNT_LOCAL_PROMPT, ringMount: true });
        } else if (step === 2) {
          selected = true;
          paint({ token: { ...linkedToken, mounted: true }, selected: true, showZone: true, promptText: MOUNT_LINKED_PROMPT });
        } else {
          // TJ-8 : le bouton d'escalier n'apparaît qu'après désélection du pion descendu.
          selected = false;
          paint({ token: { ...linkedToken, mounted: false }, selected: false, showZone: false, promptText: null, ringLinkBtn: true });
        }
      },
      startPractice() {
        startTrial('local');
      },
      destroy() {
        strip.destroy();
      },
    };
  },
};

// ============================================================================================
// FICHE 9 — Orienter ou déplacer un gabarit (TemplatesLayer + findHitTemplate + PointerInput)
// ============================================================================================

/** @type {HelpLessonDefinition} */
const LESSON_TEMPLATE = {
  id: 'template',
  group: 'Interagir',
  title: 'Orienter ou déplacer un gabarit',
  stepsAriaLabel: 'Étapes de manipulation des gabarits',
  steps: [
    { label: 'Déplacer un cercle', caption: 'Fais glisser l’intérieur du cercle pour le déplacer.', durationMs: 2200 },
    { label: 'Déplacer un cône ou une ligne', caption: 'Saisis la pointe ou la poignée de départ pour déplacer le gabarit.', durationMs: 2200 },
    { label: 'Pivoter', caption: 'Glisse depuis le corps du gabarit pour le faire pivoter.', durationMs: 2200 },
    { label: 'Poser', caption: 'Relâche pour poser le gabarit à l’endroit choisi.' },
  ],
  mount(ctx) {
    const level = createLevel({ id: 'aide-tpl', widthCells: 9, heightCells: 6 });
    const grid = gridFor(level);
    const gridLayer = new GridLayer();
    const templatesLayer = new TemplatesLayer();
    const pitch = grid.cellPitch().x;
    const extent = grid.mapExtent();

    const circleStart = grid.cellCenter({ a: 2, b: 3 });
    const circleGoal = grid.cellCenter({ a: 6, b: 3 });
    const coneOrigin = grid.cellCenter({ a: 3, b: 3 });
    const coneGoalTarget = grid.cellCenter({ a: 6, b: 1 });

    /** @type {Template[]} */
    let templates = [];
    /** @type {{ templateId: string, origin: MapPoint, directionDeg: number }|null} */
    let dragPreview = null;
    /** @type {import('../../input/templateHit.js').TemplateDragState|null} */
    let dragState = null;

    let practicing = false;
    let demoStep = 0;
    /** @type {'moveCircle'|'rotateCone'|'done'} */
    let phase = 'moveCircle';
    /** @type {MapPoint|null} */
    let activeGoal = null;
    let activeGoalLabel = '';

    const surface = createHelpCanvasSurface(ctx.stage, 'Carte de manipulation de gabarit', () => {
      if (!practicing) renderDemoStep(demoStep);
      else render();
    });

    /** @param {number} step */
    function renderDemoStep(step) {
      surface.syncSize();
      fitCamera();
      if (step === 0) {
        templates = [{
          id: 'demo-cercle',
          levelId: level.id,
          shape: 'circle',
          origin: grid.cellCenter({ a: 5, b: 3 }),
          radiusCells: 1.5,
          directionDeg: 0,
          widthCells: 1,
          color: '#ef4444',
          visibleToPlayers: true,
        }];
        render();
        const from = surface.camera.mapToScreen(grid.cellCenter({ a: 2, b: 3 }));
        const to = surface.camera.mapToScreen(grid.cellCenter({ a: 5, b: 3 }));
        surface.setGestureMarkup(GESTURE_SVG.drag(from.screenX, from.screenY, to.screenX, to.screenY));
      } else if (step === 1) {
        templates = [{
          id: 'demo-cone',
          levelId: level.id,
          shape: 'cone',
          origin: grid.cellCenter({ a: 4, b: 3 }),
          radiusCells: 3.2,
          directionDeg: 0,
          widthCells: 1,
          color: '#f59e0b',
          visibleToPlayers: true,
        }];
        render();
        const from = surface.camera.mapToScreen(grid.cellCenter({ a: 2, b: 3 }));
        const to = surface.camera.mapToScreen(grid.cellCenter({ a: 4, b: 3 }));
        surface.setGestureMarkup(GESTURE_SVG.drag(from.screenX, from.screenY, to.screenX, to.screenY));
      } else if (step === 2) {
        templates = [{
          id: 'demo-cone',
          levelId: level.id,
          shape: 'cone',
          origin: coneOrigin,
          radiusCells: 3.4,
          directionDeg: 325,
          widthCells: 1,
          color: '#f59e0b',
          visibleToPlayers: true,
        }];
        render();
        const from = surface.camera.mapToScreen(grid.cellCenter({ a: 5, b: 4 }));
        const to = surface.camera.mapToScreen(grid.cellCenter({ a: 5, b: 2 }));
        surface.setGestureMarkup(GESTURE_SVG.drag(from.screenX, from.screenY, to.screenX, to.screenY));
      } else {
        templates = [{
          id: 'demo-cone',
          levelId: level.id,
          shape: 'cone',
          origin: coneOrigin,
          radiusCells: 3.4,
          directionDeg: 325,
          widthCells: 1,
          color: '#f59e0b',
          visibleToPlayers: true,
        }];
        render();
        surface.setGestureMarkup('');
      }
    }

    function fitCamera() {
      const { width, height } = surface.getSize();
      surface.camera.setPan(extent.width / 2, extent.height / 2);
      surface.camera.setZoom(Math.min(width / extent.width, height / extent.height) * 0.96);
    }

    /** @param {CanvasRenderingContext2D} c */
    function drawWorld(c) {
      c.fillStyle = '#253138';
      c.fillRect(0, 0, extent.width, extent.height);
      gridLayer.render(c, grid);

      if (activeGoal) {
        c.save();
        c.strokeStyle = '#ffbf47';
        c.lineWidth = 3 / surface.camera.zoom;
        c.setLineDash([7 / surface.camera.zoom, 5 / surface.camera.zoom]);
        c.beginPath();
        c.arc(activeGoal.x, activeGoal.y, pitch * 0.42, 0, Math.PI * 2);
        c.stroke();
        c.setLineDash([]);
        c.fillStyle = '#ffbf47';
        c.beginPath();
        c.arc(activeGoal.x, activeGoal.y, 6 / surface.camera.zoom, 0, Math.PI * 2);
        c.fill();
        c.font = `700 ${13 / surface.camera.zoom}px system-ui, sans-serif`;
        c.textAlign = 'center';
        c.lineWidth = 4 / surface.camera.zoom;
        c.strokeStyle = '#101820';
        c.strokeText(activeGoalLabel, activeGoal.x, activeGoal.y + pitch * 0.68);
        c.fillStyle = '#fff2c8';
        c.fillText(activeGoalLabel, activeGoal.x, activeGoal.y + pitch * 0.68);
        c.restore();
      }

      // Silhouette discrète de la pose avant pivot lors de l'étape « Pivoter »
      if (!practicing && demoStep === 2) {
        const startRad = (25 * Math.PI) / 180;
        const halfRad = (30 * Math.PI) / 180;
        c.save();
        c.beginPath();
        c.moveTo(coneOrigin.x, coneOrigin.y);
        c.arc(coneOrigin.x, coneOrigin.y, 3.4 * pitch, startRad - halfRad, startRad + halfRad);
        c.closePath();
        c.strokeStyle = 'rgba(245, 158, 11, 0.45)';
        c.lineWidth = 2 / surface.camera.zoom;
        c.setLineDash([8 / surface.camera.zoom, 6 / surface.camera.zoom]);
        c.stroke();
        c.restore();
      }

      templatesLayer.render(
        c,
        grid,
        level,
        withTemplatePreview(templates, dragPreview),
        true,
        surface.camera.zoom,
        null
      );
    }

    function render() {
      fitCamera();
      surface.renderFrame(drawWorld);
      const current = withTemplatePreview(templates, dragPreview)[0];
      surface.canvas.dataset.practicePhase = practicing ? phase : 'demo';
      surface.canvas.dataset.templateShape = current?.shape ?? '';
      surface.canvas.dataset.templateX = current ? String(Math.round(current.origin.x)) : '';
      surface.canvas.dataset.templateY = current ? String(Math.round(current.origin.y)) : '';
      surface.canvas.dataset.templateDir = current ? String(Math.round(current.directionDeg)) : '';
      surface.canvas.dataset.previewActive = String(Boolean(dragPreview));
    }

    function setupPhase(/** @type {'moveCircle'|'rotateCone'} */ nextPhase) {
      phase = nextPhase;
      dragPreview = null;
      dragState = null;
      if (phase === 'moveCircle') {
        templates = [{
          id: 'aide-cercle',
          levelId: level.id,
          shape: 'circle',
          origin: { ...circleStart },
          radiusCells: 1.4,
          directionDeg: 0,
          widthCells: 1,
          color: '#ef4444',
          visibleToPlayers: true,
        }];
        activeGoal = circleGoal;
        activeGoalLabel = 'Repère 1';
        ctx.setCaption('Fais glisser l’intérieur du cercle jusqu’au Repère 1.');
      } else {
        templates = [{
          id: 'aide-cone',
          levelId: level.id,
          shape: 'cone',
          origin: { ...coneOrigin },
          radiusCells: 3.4,
          directionDeg: 85,
          widthCells: 1,
          color: '#f59e0b',
          visibleToPlayers: true,
        }];
        activeGoal = coneGoalTarget;
        activeGoalLabel = 'Repère 2';
        ctx.setCaption('Glisse depuis le corps du cône pour l’orienter vers le Repère 2 (sa pointe le déplace).');
      }
      mountAssist();
      render();
    }

    function mountAssist() {
      if (!practicing || phase === 'done') {
        ctx.extra.replaceChildren();
        ctx.extra.hidden = true;
        return;
      }
      ctx.extra.replaceChildren(
        makeExtraButton(
          phase === 'moveCircle' ? 'Aide clavier : Déplacer le cercle sur le repère' : 'Aide clavier : Orienter le cône vers le repère',
          () => {
            if (phase === 'moveCircle') {
              templates = templates.map((t) => ({ ...t, origin: { ...circleGoal } }));
              setupPhase('rotateCone');
            } else if (phase === 'rotateCone') {
              const current = templates[0];
              const targetOrigin =
                current && Math.hypot(coneGoalTarget.x - current.origin.x, coneGoalTarget.y - current.origin.y) >= pitch * 1.5
                  ? current.origin
                  : { ...coneOrigin };
              const targetAngle = Math.round(
                ((Math.atan2(coneGoalTarget.y - targetOrigin.y, coneGoalTarget.x - targetOrigin.x) * 180) / Math.PI + 360) % 360
              );
              templates = templates.map((t) => ({ ...t, origin: targetOrigin, directionDeg: targetAngle }));
              phase = 'done';
              ctx.setCaption('Bravo ! Tu sais déplacer un cercle et orienter un cône.');
              mountAssist();
              render();
            }
          }
        )
      );
      ctx.extra.hidden = false;
    }

    const pointerInput = new PointerInput(surface.canvas, surface.camera, {
      role: 'players',
      canStartTemplateDrag(_screenPos, mapPos) {
        if (!practicing || phase === 'done') return null;
        const hit = findHitTemplate(level, templates, mapPos, surface.camera.zoom, pitch, true);
        return hit ? { templateId: hit.template.id, dragMode: hit.mode } : null;
      },
      onIntention(intention) {
        if (!practicing || phase === 'done') return;
        if (intention.type === 'tap') {
          ctx.setCaption('Un simple tap ne déplace pas le gabarit : maintiens et fais glisser.');
          return;
        }
        if (intention.type !== 'dragTemplate') return;
        if (intention.phase === 'cancel') {
          dragState = null;
          dragPreview = null;
          ctx.setCaption('Geste interrompu : le gabarit retrouve sa pose précédente.');
          render();
          return;
        }
        const tpl = templates.find((t) => t.id === intention.templateId);
        if (!tpl) return;
        if (intention.phase === 'start') {
          dragState = {
            templateId: tpl.id,
            dragMode: intention.dragMode,
            startMapPos: { ...intention.mapPos },
            initialOrigin: { ...tpl.origin },
            initialDirectionDeg: tpl.directionDeg,
          };
        }
        if (!dragState || dragState.templateId !== tpl.id) return;
        const pose = templateDragPose(dragState, intention.mapPos);
        if (intention.phase !== 'end') {
          dragPreview = { templateId: tpl.id, ...pose };
          render();
          return;
        }
        const completedDrag = dragState;
        dragState = null;
        dragPreview = null;
        templates = templates.map((t) => (t.id === tpl.id ? { ...t, origin: pose.origin, directionDeg: pose.directionDeg } : t));
        if (phase === 'moveCircle' && Math.hypot(pose.origin.x - circleGoal.x, pose.origin.y - circleGoal.y) <= pitch * 0.95) {
          setupPhase('rotateCone');
          return;
        }
        if (phase === 'rotateCone') {
          const updated = templates[0];
          const isAimedAtGoal = (/** @type {MapPoint} */ origin, /** @type {number} */ dirDeg) =>
            isPointInCone(origin, dirDeg, (updated.radiusCells + 1) * pitch, coneGoalTarget) ||
            Math.abs(normalizeAngleDeg(dirDeg - (Math.atan2(coneGoalTarget.y - origin.y, coneGoalTarget.x - origin.x) * 180) / Math.PI)) <= 26;
          const originFixed = Math.hypot(
            pose.origin.x - completedDrag.initialOrigin.x,
            pose.origin.y - completedDrag.initialOrigin.y
          ) < 1e-3;
          const rotatedEnough = Math.abs(normalizeAngleDeg(updated.directionDeg - completedDrag.initialDirectionDeg)) >= 5;
          const wasAimedBefore = isAimedAtGoal(completedDrag.initialOrigin, completedDrag.initialDirectionDeg);
          const aimed = isAimedAtGoal(updated.origin, updated.directionDeg);

          if (completedDrag.dragMode === 'move') {
            ctx.setCaption('La pointe déplace le cône sans le faire pivoter. Glisse depuis le corps du cône pour l’orienter vers le Repère 2.');
          } else if (completedDrag.dragMode === 'rotate' && originFixed && rotatedEnough && !wasAimedBefore && aimed) {
            phase = 'done';
            ctx.setCaption('Bravo ! Tu sais déplacer un cercle et orienter un cône.');
            mountAssist();
          } else if (completedDrag.dragMode === 'rotate' && wasAimedBefore && aimed) {
            ctx.setCaption('Le cône recouvrait déjà le repère après déplacement. Décale sa pointe ou pivote-le hors du repère puis vers le Repère 2.');
          } else if (completedDrag.dragMode === 'rotate') {
            ctx.setCaption('Continue à faire pivoter le corps du cône pour viser le Repère 2.');
          }
        }
        render();
      },
    });

    return {
      showExample(step) {
        practicing = false;
        demoStep = step;
        dragPreview = null;
        dragState = null;
        activeGoal = null;
        ctx.extra.replaceChildren();
        ctx.extra.hidden = true;
        renderDemoStep(step);
      },
      startPractice() {
        practicing = true;
        surface.setGestureMarkup('');
        setupPhase('moveCircle');
      },
      destroy() {
        pointerInput.detach();
        surface.destroy();
      },
    };
  },
};

// ============================================================================================
// FICHE 10 — Fermer une image partagée (croix isolée, carte témoin derrière)
// ============================================================================================

/** @type {HelpLessonDefinition} */
const LESSON_SHARED_IMAGE = {
  id: 'shared-image',
  group: 'Interagir',
  title: 'Fermer une image partagée',
  stepsAriaLabel: 'Étapes de fermeture d’une image partagée',
  steps: [
    { label: 'Voir l’image', caption: 'Quand le MJ partage une image, elle s’affiche sur la tablette et la TV.' },
    { label: 'Fermer', caption: 'Touche la croix pour fermer l’image pour la table.' },
  ],
  mount(ctx) {
    const frame = document.createElement('div');
    frame.className = 'player-help-share-frame';
    frame.innerHTML = `
      ${SVG_MINI_MAP}
      <div class="player-help-corner-chrome" aria-hidden="true">
        <span class="player-help-mini-icon">?</span>
        <span class="player-help-mini-icon is-fs">${SVG_FULLSCREEN_ENTER}</span>
      </div>`;

    const overlay = document.createElement('div');
    overlay.className = 'player-help-share-overlay';
    overlay.innerHTML = SVG_SHARED_EMBLEM;

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'player-help-share-close';
    closeBtn.setAttribute('aria-label', 'Fermer l’image');
    closeBtn.textContent = '✕';

    const closeRing = document.createElement('span');
    closeRing.className = 'player-help-share-ring';
    closeRing.setAttribute('aria-hidden', 'true');
    closeRing.hidden = true;

    overlay.appendChild(closeBtn);
    frame.append(overlay, closeRing);
    ctx.stage.appendChild(frame);

    let practicing = false;

    overlay.addEventListener('click', (event) => {
      if (!practicing) return;
      if (event.target instanceof Node && closeBtn.contains(event.target)) return;
      ctx.setCaption('Un appui sur l’image la garde ouverte. Touche la croix en haut à droite pour la fermer.');
    });

    closeBtn.addEventListener('click', () => {
      if (!practicing) return;
      overlay.hidden = true;
      ctx.setCaption('Image fermée ! Tu retrouves la carte exactement au même cadrage.');
      ctx.practiceButton.focus();
    });

    return {
      showExample(step) {
        practicing = false;
        ctx.extra.replaceChildren();
        ctx.extra.hidden = true;
        closeBtn.disabled = true;
        if (step === 0) {
          overlay.hidden = false;
          closeBtn.classList.remove('is-ringed');
          closeRing.hidden = true;
        } else {
          overlay.hidden = true;
          closeBtn.classList.remove('is-ringed');
          closeRing.hidden = false;
        }
      },
      startPractice() {
        practicing = true;
        ctx.extra.replaceChildren();
        ctx.extra.hidden = true;
        overlay.hidden = false;
        closeBtn.disabled = false;
        closeBtn.classList.remove('is-ringed');
        closeRing.hidden = true;
        ctx.setCaption('Touche la croix en haut à droite pour fermer l’image fictive.');
        closeBtn.focus();
      },
      destroy() {},
    };
  },
};

// ============================================================================================
// FICHE 11 — Rejoindre la table (simulation locale de l'accueil, code fictif K7M4T)
// ============================================================================================

/** @type {HelpLessonDefinition} */
const LESSON_JOIN = {
  id: 'join',
  group: 'Accéder à la table',
  title: 'Rejoindre la table',
  stepsAriaLabel: 'Étapes pour rejoindre la table',
  steps: [
    { label: 'Repérer le code', caption: 'Prends le code de session donné par le MJ.' },
    { label: 'Saisir le code', caption: 'Sur l’accueil, saisis le code dans la zone Joueur.' },
    { label: 'Rejoindre', caption: 'Touche “Rejoindre la Table”. Si une connexion Google t’est demandée, utilise le compte autorisé.', durationMs: 2200 },
    { label: 'Vue joueurs', caption: 'La vue joueurs s’affiche sur la tablette avec la carte de la table.', durationMs: 2200 },
  ],
  mount(ctx) {
    const SAMPLE_CODE = 'K7M4T';
    const frame = document.createElement('div');
    frame.className = 'player-help-join-frame';

    const title = document.createElement('div');
    title.className = 'player-help-join-title';
    title.textContent = 'RPG Map Display';

    const codeRef = document.createElement('div');
    codeRef.className = 'player-help-code-ref';
    codeRef.innerHTML = `<span>Code fictif d’exemple :</span><strong>${SAMPLE_CODE}</strong>`;

    const form = document.createElement('form');
    form.className = 'player-help-join-card';
    form.noValidate = true;
    form.innerHTML = `
      <h3>Joueur</h3>
      <label for="player-help-session-input">Code de session (obligatoire)</label>
      <input id="player-help-session-input" class="player-help-join-input" type="text" maxlength="5"
        autocapitalize="characters" autocomplete="off" autocorrect="off" spellcheck="false"
        placeholder="Ex. : K7M4T">
      <p class="player-help-join-error" data-join-error hidden></p>
      <button type="submit" class="player-help-join-submit">Rejoindre la Table</button>`;

    const input = /** @type {HTMLInputElement} */ (form.querySelector('#player-help-session-input'));
    const errorText = /** @type {HTMLElement} */ (form.querySelector('[data-join-error]'));
    const submitBtn = /** @type {HTMLButtonElement} */ (form.querySelector('.player-help-join-submit'));

    const demoTable = document.createElement('div');
    demoTable.className = 'player-help-join-table';
    demoTable.hidden = true;
    demoTable.innerHTML = `
      ${SVG_MINI_MAP}
      <span class="player-help-status-pill">Vue joueurs ouverte (démonstration)</span>`;

    frame.append(title, codeRef, form, demoTable);
    ctx.stage.appendChild(frame);
    ctx.setNote('Cet exercice reste entièrement local. En partie, la carte peut attendre la vision transmise par le MJ avant d’afficher les pions.');

    let practicing = false;

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!practicing) return;
      const value = input.value.trim().toUpperCase();
      if (!value) {
        errorText.textContent = `Saisis le code fictif ${SAMPLE_CODE} avant de continuer.`;
        errorText.hidden = false;
        ctx.setCaption(`Le champ est vide. Saisis ${SAMPLE_CODE} puis touche “Rejoindre la Table”.`);
        input.focus();
        return;
      }
      if (value !== SAMPLE_CODE) {
        errorText.textContent = `Pour l’exercice, utilise le code d’exemple ${SAMPLE_CODE}.`;
        errorText.hidden = false;
        ctx.setCaption(`Saisis le code fictif ${SAMPLE_CODE} pour terminer l’exercice.`);
        input.focus();
        return;
      }
      errorText.hidden = true;
      form.hidden = true;
      codeRef.hidden = true;
      demoTable.hidden = false;
      frame.dataset.joinStage = 'practice-table';
      ctx.setCaption('Parfait ! Tu es dans la vue joueurs de démonstration.');
      ctx.practiceButton.focus();
    });

    return {
      showExample(step) {
        practicing = false;
        ctx.extra.replaceChildren();
        ctx.extra.hidden = true;
        errorText.hidden = true;
        input.readOnly = true;
        submitBtn.disabled = true;
        input.classList.toggle('is-highlighted', step === 1);
        submitBtn.classList.toggle('is-ringed', step === 2);
        if (step === 0) {
          codeRef.hidden = false;
          form.hidden = false;
          demoTable.hidden = true;
          input.value = '';
          frame.dataset.joinStage = 'code';
        } else if (step === 1) {
          codeRef.hidden = false;
          form.hidden = false;
          demoTable.hidden = true;
          input.value = SAMPLE_CODE;
          frame.dataset.joinStage = 'input';
        } else if (step === 2) {
          codeRef.hidden = false;
          form.hidden = false;
          demoTable.hidden = true;
          input.value = SAMPLE_CODE;
          frame.dataset.joinStage = 'tap-submit';
        } else {
          codeRef.hidden = true;
          form.hidden = true;
          demoTable.hidden = false;
          frame.dataset.joinStage = 'table';
        }
      },
      startPractice() {
        practicing = true;
        ctx.extra.replaceChildren();
        ctx.extra.hidden = true;
        codeRef.hidden = false;
        form.hidden = false;
        demoTable.hidden = true;
        errorText.hidden = true;
        input.readOnly = false;
        input.value = '';
        input.classList.remove('is-highlighted');
        submitBtn.disabled = false;
        submitBtn.classList.remove('is-ringed');
        frame.dataset.joinStage = 'practice-form';
        ctx.setCaption(`Saisis le code fictif ${SAMPLE_CODE} dans la zone Joueur puis touche “Rejoindre la Table”.`);
        input.focus();
      },
      destroy() {},
    };
  },
};

// ============================================================================================
// FICHE 12 — Passer en plein écran (simulation locale du cadre de navigateur)
// ============================================================================================

/** @type {HelpLessonDefinition} */
const LESSON_FULLSCREEN = {
  id: 'fullscreen',
  group: 'Accéder à la table',
  title: 'Passer en plein écran',
  stepsAriaLabel: 'Étapes du plein écran',
  steps: [
    { label: 'Repérer le bouton', caption: 'Touche les quatre coins en haut à droite pour passer en plein écran.' },
    { label: 'Voir le résultat', caption: 'La carte occupe l’écran de la tablette.' },
    { label: 'Revenir', caption: 'Retouche les quatre coins pour quitter le plein écran.' },
  ],
  mount(ctx) {
    const frame = document.createElement('div');
    frame.className = 'player-help-fs-frame';

    const browserBar = document.createElement('div');
    browserBar.className = 'player-help-browser-bar';
    browserBar.innerHTML = `
      <span class="player-help-browser-dots" aria-hidden="true"><span></span><span></span><span></span></span>
      <span class="player-help-browser-url">player.html?session=K7M4T</span>`;

    const viewport = document.createElement('div');
    viewport.className = 'player-help-fs-viewport';
    viewport.innerHTML = `
      ${SVG_MINI_MAP}
      <div class="player-help-fs-tabs" aria-hidden="true">
        <span class="is-active">Rez-de-chaussée</span>
        <span>Étage</span>
      </div>`;

    const controls = document.createElement('div');
    controls.className = 'player-help-fs-controls';

    const helpBadge = document.createElement('span');
    helpBadge.className = 'player-help-fs-help-badge';
    helpBadge.setAttribute('aria-hidden', 'true');
    helpBadge.textContent = '?';

    const fsBtn = document.createElement('button');
    fsBtn.type = 'button';
    fsBtn.className = 'player-help-fs-btn';

    const callout = document.createElement('span');
    callout.className = 'player-help-fs-callout';
    callout.textContent = 'Plein écran';

    controls.append(helpBadge, fsBtn);
    viewport.append(controls, callout);
    frame.append(browserBar, viewport);
    ctx.stage.appendChild(frame);
    ctx.setNote('Sur un navigateur sans commande de plein écran, ce bouton n’apparaît pas et la carte reste utilisable normalement. La diffusion sur TV dépend des réglages de la tablette.');

    let practicing = false;
    let simulatedFs = false;
    let enteredOnce = false;

    /** @param {boolean} active @param {boolean} [ring] @param {boolean} [showCallout] */
    function renderFs(active, ring = false, showCallout = false) {
      frame.classList.toggle('is-fullscreen', active);
      frame.dataset.simulatedFullscreen = String(active);
      const label = active ? 'Quitter le plein écran' : 'Plein écran';
      fsBtn.innerHTML = active ? SVG_FULLSCREEN_EXIT : SVG_FULLSCREEN_ENTER;
      fsBtn.setAttribute('aria-label', label);
      fsBtn.title = label;
      fsBtn.classList.toggle('is-ringed', ring);
      callout.textContent = label;
      callout.hidden = !showCallout;
    }

    fsBtn.addEventListener('click', () => {
      if (!practicing) return;
      simulatedFs = !simulatedFs;
      if (simulatedFs) {
        enteredOnce = true;
        ctx.setCaption('La carte remplit l’aperçu. Retouche les quatre coins pour quitter le plein écran.');
      } else if (enteredOnce) {
        ctx.setCaption('Parfait ! Tu sais entrer en plein écran et revenir au cadre du navigateur.');
      }
      renderFs(simulatedFs, false, false);
    });

    return {
      showExample(step) {
        practicing = false;
        ctx.extra.replaceChildren();
        ctx.extra.hidden = true;
        fsBtn.disabled = true;
        if (step === 0) renderFs(false, true, true);
        else if (step === 1) renderFs(true, false, true);
        else renderFs(false, true, false);
      },
      startPractice() {
        practicing = true;
        simulatedFs = false;
        enteredOnce = false;
        ctx.extra.replaceChildren();
        ctx.extra.hidden = true;
        fsBtn.disabled = false;
        renderFs(false, false, false);
        ctx.setCaption('Touche les quatre coins en haut à droite pour passer en plein écran, puis retouche pour revenir.');
        fsBtn.focus();
      },
      destroy() {},
    };
  },
};

/** @type {readonly HelpLessonDefinition[]} */
const LESSONS = Object.freeze([
  LESSON_MOVE,
  LESSON_UNDO,
  LESSON_PAN_ZOOM,
  LESSON_LEVELS,
  LESSON_INSPECT,
  LESSON_PING,
  LESSON_PORTAL,
  LESSON_MOUNT,
  LESSON_TEMPLATE,
  LESSON_SHARED_IMAGE,
  LESSON_JOIN,
  LESSON_FULLSCREEN,
]);

const LESSONS_BY_ID = new Map(LESSONS.map((lesson) => [lesson.id, lesson]));

// ============================================================================================
// MONTAGE PRINCIPAL DU GUIDE JOUEURS
// ============================================================================================

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
      <div class="player-help-header-actions">
        <button type="button" data-help-toc hidden>Toutes les fiches</button>
        <button type="button" data-help-close autofocus>Revenir à la partie</button>
      </div>
    </header>
    <div class="player-help-body">
      <nav class="player-help-toc" aria-label="Sommaire de l’aide de jeu">
        <p class="player-help-toc-intro">Choisis une fiche pour voir le geste et l’essayer sans toucher à la partie en cours.</p>
        <div class="player-help-toc-grid"></div>
      </nav>
      <section class="player-help-lesson" aria-labelledby="player-help-lesson-title" hidden>
        <h2 id="player-help-lesson-title" tabindex="-1"></h2>
        <div class="player-help-content">
          <div class="player-help-stage"></div>
          <div class="player-help-instructions">
            <div class="player-help-steps-host"></div>
            <p class="player-help-caption" data-help-caption aria-live="polite"></p>
            <div class="player-help-note" data-help-note hidden></div>
            <div class="player-help-actions">
              <button type="button" data-help-replay>Rejouer la démonstration</button>
              <button type="button" data-help-practice>À toi d’essayer</button>
            </div>
            <div class="player-help-extra" data-help-extra hidden></div>
          </div>
        </div>
      </section>
    </div>`;
  document.body.appendChild(dialog);

  const tocButton = /** @type {HTMLButtonElement} */ (dialog.querySelector('[data-help-toc]'));
  const closeButton = /** @type {HTMLButtonElement} */ (dialog.querySelector('[data-help-close]'));
  const bodyEl = /** @type {HTMLElement} */ (dialog.querySelector('.player-help-body'));
  const tocNav = /** @type {HTMLElement} */ (dialog.querySelector('.player-help-toc'));
  const tocGrid = /** @type {HTMLElement} */ (dialog.querySelector('.player-help-toc-grid'));
  const lessonSection = /** @type {HTMLElement} */ (dialog.querySelector('.player-help-lesson'));
  const lessonTitle = /** @type {HTMLElement} */ (dialog.querySelector('#player-help-lesson-title'));
  const stageEl = /** @type {HTMLElement} */ (dialog.querySelector('.player-help-stage'));
  const stepsHost = /** @type {HTMLElement} */ (dialog.querySelector('.player-help-steps-host'));
  const captionEl = /** @type {HTMLElement} */ (dialog.querySelector('[data-help-caption]'));
  const noteEl = /** @type {HTMLElement} */ (dialog.querySelector('[data-help-note]'));
  const replayButton = /** @type {HTMLButtonElement} */ (dialog.querySelector('[data-help-replay]'));
  const practiceButton = /** @type {HTMLButtonElement} */ (dialog.querySelector('[data-help-practice]'));
  const extraEl = /** @type {HTMLElement} */ (dialog.querySelector('[data-help-extra]'));

  /** @type {ReturnType<typeof setTimeout>|null} */
  let replayTimer = null;
  /** @type {HelpLessonDefinition|null} */
  let currentDef = null;
  /** @type {HelpLessonController|null} */
  let currentController = null;
  /** @type {HTMLButtonElement[]} */
  let stepButtons = [];
  /** @type {string|null} */
  let lastOpenedLessonId = null;

  function stopReplay() {
    if (replayTimer !== null) clearTimeout(replayTimer);
    replayTimer = null;
  }

  function teardownLesson() {
    stopReplay();
    currentController?.destroy();
    currentController = null;
    currentDef = null;
    stepButtons = [];
    stageEl.replaceChildren();
    stepsHost.replaceChildren();
    extraEl.replaceChildren();
    extraEl.hidden = true;
    noteEl.replaceChildren();
    noteEl.hidden = true;
    captionEl.textContent = '';
  }

  // Construction du sommaire groupé par intention
  /** @type {Map<string, HTMLButtonElement>} */
  const tocButtonsById = new Map();
  for (const groupName of TOC_GROUPS) {
    const groupLessons = LESSONS.filter((lesson) => lesson.group === groupName);
    const groupEl = document.createElement('section');
    groupEl.className = 'player-help-toc-group';
    const heading = document.createElement('h2');
    heading.textContent = groupName;
    const list = document.createElement('ul');
    list.className = 'player-help-toc-list';

    for (const lesson of groupLessons) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = lesson.id === 'move' ? 'player-help-toc-item is-featured' : 'player-help-toc-item';
      btn.dataset.lessonId = lesson.id;
      btn.innerHTML = `<span>${lesson.title}</span><span class="player-help-toc-arrow" aria-hidden="true">→</span>`;
      btn.addEventListener('click', () => openLesson(lesson.id));
      tocButtonsById.set(lesson.id, btn);
      li.appendChild(btn);
      list.appendChild(li);
    }

    groupEl.append(heading, list);
    tocGrid.appendChild(groupEl);
  }

  /** @param {number} stepIndex */
  function showExampleStep(stepIndex) {
    if (!currentDef || !currentController) return;
    const clamped = Math.max(0, Math.min(currentDef.steps.length - 1, stepIndex));
    stepButtons.forEach((btn, idx) => btn.setAttribute('aria-pressed', String(idx === clamped)));
    captionEl.textContent = currentDef.steps[clamped].caption;
    currentController.showExample(clamped);
  }

  /** @param {number} [stepIndex] */
  function replayDemo(stepIndex = 0) {
    if (!currentDef || !currentController) return;
    showExampleStep(stepIndex);
    if (stepIndex < currentDef.steps.length - 1) {
      const delay = currentDef.steps[stepIndex].durationMs ?? DEFAULT_STEP_MS;
      replayTimer = setTimeout(() => replayDemo(stepIndex + 1), delay);
    }
  }

  /** @param {string|null} text @param {{ label: string, lessonId: string }} [link] */
  function setNote(text, link) {
    noteEl.replaceChildren();
    if (!text) {
      noteEl.hidden = true;
      return;
    }
    const p = document.createElement('div');
    p.textContent = text;
    noteEl.appendChild(p);
    if (link) {
      const linkBtn = document.createElement('button');
      linkBtn.type = 'button';
      linkBtn.className = 'player-help-note-link';
      linkBtn.textContent = link.label;
      linkBtn.addEventListener('click', () => openLesson(link.lessonId));
      noteEl.appendChild(linkBtn);
    }
    noteEl.hidden = false;
  }

  /** @param {HelpLessonDefinition} def */
  function buildStepControls(def) {
    stepsHost.replaceChildren();
    stepButtons = [];
    const hasGroups = def.steps.some((step) => Boolean(step.group));
    if (!hasGroups) {
      const ol = document.createElement('ol');
      ol.setAttribute('aria-label', def.stepsAriaLabel);
      def.steps.forEach((step, idx) => {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.dataset.example = String(idx);
        btn.textContent = step.label;
        btn.addEventListener('click', () => {
          stopReplay();
          showExampleStep(idx);
        });
        stepButtons.push(btn);
        li.appendChild(btn);
        ol.appendChild(li);
      });
      stepsHost.appendChild(ol);
      return;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'player-help-step-groups';
    /** @type {string|null} */
    let activeGroupName = null;
    /** @type {HTMLOListElement|null} */
    let activeList = null;

    def.steps.forEach((step, idx) => {
      const groupName = step.group ?? '';
      if (groupName !== activeGroupName || !activeList) {
        activeGroupName = groupName;
        const groupBox = document.createElement('div');
        groupBox.className = 'player-help-step-group';
        if (groupName) {
          const h3 = document.createElement('h3');
          h3.textContent = groupName;
          groupBox.appendChild(h3);
        }
        activeList = document.createElement('ol');
        activeList.setAttribute('aria-label', groupName || def.stepsAriaLabel);
        groupBox.appendChild(activeList);
        wrapper.appendChild(groupBox);
      }
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.example = String(idx);
      btn.textContent = step.label;
      btn.addEventListener('click', () => {
        stopReplay();
        showExampleStep(idx);
      });
      stepButtons.push(btn);
      li.appendChild(btn);
      activeList.appendChild(li);
    });
    stepsHost.appendChild(wrapper);
  }

  /** @param {string} lessonId */
  function openLesson(lessonId) {
    const def = LESSONS_BY_ID.get(lessonId);
    if (!def) return;
    teardownLesson();
    currentDef = def;
    lastOpenedLessonId = lessonId;

    tocNav.hidden = true;
    lessonSection.hidden = false;
    tocButton.hidden = false;
    lessonTitle.textContent = def.title;
    bodyEl.scrollTop = 0;

    buildStepControls(def);
    currentController = def.mount({
      stage: stageEl,
      extra: extraEl,
      practiceButton,
      setCaption: (text) => { captionEl.textContent = text; },
      setNote,
      stopReplay,
      openLesson,
    });
    showExampleStep(0);
    lessonTitle.focus();
  }

  /** @param {boolean} [restoreFocus] */
  function showToc(restoreFocus = false) {
    teardownLesson();
    lessonSection.hidden = true;
    tocNav.hidden = false;
    tocButton.hidden = true;
    bodyEl.scrollTop = 0;
    if (restoreFocus) {
      const target = (lastOpenedLessonId && tocButtonsById.get(lastOpenedLessonId)) || tocButtonsById.get('move');
      target?.focus();
    }
  }

  tocButton.addEventListener('click', () => showToc(true));
  closeButton.addEventListener('click', () => dialog.close());
  replayButton.addEventListener('click', () => {
    stopReplay();
    replayDemo(0);
  });
  practiceButton.addEventListener('click', () => {
    if (!currentController) return;
    stopReplay();
    stepButtons.forEach((btn) => btn.setAttribute('aria-pressed', 'false'));
    currentController.startPractice();
  });

  dialog.addEventListener('close', () => {
    teardownLesson();
    open.focus();
  });

  open.addEventListener('click', () => {
    showToc(false);
    dialog.showModal();
  });

  return () => {
    teardownLesson();
    dialog.remove();
    open.remove();
  };
}

// @ts-check

/**
 * Médaillon des pions liés à l'outil MJ (docs/CONTRAT-LIAISON-OUTIL-MJ.md §11, lot P2, étude E1
 * variante B, choix du MJ du 05/11/2026) : le personnage est posé sur un fond émaillé, dans un
 * cerclage ciselé **fin** (fenêtre à 69 %) qui reste **dans la case**, sans débord.
 *
 * - PJ : cerclage `pj-<nom>` générés par Magnific, choisi par la couleur du personnage
 *   (`token.color`, contrat §4) parmi {@link PJ_FRAMES}, sans teinte calculée ; une couleur
 *   inconnue garde le repli bronze teinté de cette couleur, à défaut de la teinte du camp ; la
 *   monture d'un PJ reçoit la même couleur, donc le même cerclage (décision du MJ du 06/11) ;
 * - allié : étain à laurier ; ennemi : fer à pointes ; neutre (ou sans camp) : bronze ;
 * - mort : le cerclage passe en gris, quel que soit le camp ;
 * - sous {@link MEDALLION_MIN_SCREEN_PX} à l'écran, repli sur le disque simple.
 *
 * Le liseré choisi à la main (`borderColor`) ne compte plus sur un pion lié : seule la teinte du
 * camp, ou celle du PJ.
 *
 * ⚠ Les teintes et les versions grises du cerclage se calculent **une fois**, dans une toile hors
 * écran mise en cache, jamais à chaque image. Le reste du module est de l'arithmétique pure,
 * vérifiable sous node:test.
 */

/** Taille à l'écran (px CSS) sous laquelle un pion lié revient au disque simple. */
export const MEDALLION_MIN_SCREEN_PX = 36;

/** Dossier des images de cerclage, relatif à la page (`assets/medaillons/SOURCES.md`). */
export const MEDALLION_IMAGE_DIR = 'assets/medaillons/';

/** Côté des images de cerclage, en pixels. */
export const MEDALLION_FRAME_PX = 256;

/** Côté de la toile du fond émaillé mise en cache. */
const ENAMEL_PX = 128;

/** Plafond des toiles mises en cache (3 cerclages × quelques teintes de PJ, plus les gris). */
const MEDALLION_CACHE_LIMIT = 32;

/**
 * @typedef {'bronze'|'etain'|'fer'|'pj-elysia'|'pj-hellaya'|'pj-wren'|'pj-caelel'|'pj-bhelgi'} MedallionFrame
 * @typedef {{ cx: number, cy: number, outer: number, inner: number }} FrameGeometry
 */

/**
 * Géométrie des cerclages fins dans leur image de 256 px, mesurée sur la maquette E1 : centre,
 * rayon extérieur de l'anneau, rayon de la fenêtre. Les pointes du fer et le laurier de l'étain
 * dépassent du cercle extérieur, en haut, comme sur la maquette.
 *
 * @type {Readonly<Record<MedallionFrame, Readonly<FrameGeometry>>>}
 */
export const FRAME_GEOMETRY = Object.freeze({
  bronze: Object.freeze({ cx: 127.7, cy: 131.2, outer: 124.8, inner: 87.0 }),
  etain: Object.freeze({ cx: 127.7, cy: 131.5, outer: 124.5, inner: 78.8 }),
  fer: Object.freeze({ cx: 127.9, cy: 140.6, outer: 115.4, inner: 80.5 }),
  'pj-elysia': Object.freeze({ cx: 127.7, cy: 131.2, outer: 124.8, inner: 87.0 }),
  'pj-hellaya': Object.freeze({ cx: 127.7, cy: 131.2, outer: 124.8, inner: 87.0 }),
  'pj-wren': Object.freeze({ cx: 127.7, cy: 131.2, outer: 124.8, inner: 87.0 }),
  'pj-caelel': Object.freeze({ cx: 127.7, cy: 131.2, outer: 124.8, inner: 87.0 }),
  'pj-bhelgi': Object.freeze({ cx: 127.7, cy: 131.2, outer: 124.8, inner: 87.0 }),
});

/**
 * Cerclages dédiés aux cinq PJ, par teinte `#rrggbb` envoyée par l'outil MJ (correspondance
 * validée par le MJ le 06/11). Géométrie de `cerclage-bronze-fin.webp`.
 *
 * @type {Readonly<Record<string, MedallionFrame>>}
 */
export const PJ_FRAMES = Object.freeze({
  '#b3262e': 'pj-elysia',
  '#2e9e6e': 'pj-hellaya',
  '#e8846a': 'pj-wren',
  '#2a4fa8': 'pj-caelel',
  '#6fb4e6': 'pj-bhelgi',
});

/**
 * Fichier image d'un cerclage, relatif au dossier des médaillons.
 *
 * @param {MedallionFrame} frame
 * @returns {string}
 */
export function frameFileName(frame) {
  return frame.startsWith('pj-') ? `cerclage-${frame}.webp` : `cerclage-${frame}-fin.webp`;
}

/**
 * Teinte du disque d'un pion lié sans image, par camp (contrat §6). Elles viennent de
 * `TOKEN_BORDER_PALETTE` et se lisent avec des initiales blanches (contraste WCAG ≥ 4,5) :
 * pj Bleu nuit 8,1 ; allié Vert forêt 5,9 ; ennemi Rouge brique 6,1 ; neutre Ardoise 4,9.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const CAMP_FILL = Object.freeze({
  pj: '#34507f',
  allie: '#3f6e4a',
  ennemi: '#a8402f',
  neutre: '#6b7178',
});

/** Teinte claire du fond émaillé, par camp (maquette E1). */
export const ENAMEL_LIGHT = Object.freeze({
  pj: '#7c9bd0',
  allie: '#86c095',
  ennemi: '#e0806c',
  neutre: '#b3b9c0',
});

/** Bord sombre du fond émaillé. */
const ENAMEL_DARK = '#0d0b08';

/** Liseré d'un pion lié mort, au petit zoom (le cerclage gris du grand zoom). */
export const DEAD_RING_COLOR = '#7a7a7a';

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/**
 * @param {unknown} value
 * @returns {value is string}
 */
export function isHexColor(value) {
  return typeof value === 'string' && HEX_COLOR.test(value);
}

/**
 * Mélange de deux couleurs `#rrggbb`, `t` = part de `b`.
 *
 * @param {string} a
 * @param {string} b
 * @param {number} t
 * @returns {string}
 */
export function mixHex(a, b, t) {
  const channel = (/** @type {string} */ hex, /** @type {number} */ i) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  return `#${[0, 1, 2]
    .map((i) => Math.round(channel(a, i) * (1 - t) + channel(b, i) * t).toString(16).padStart(2, '0'))
    .join('')}`;
}

/**
 * @typedef {{ link?: unknown, camp?: string, color?: string|null, dead?: boolean, borderColor?: string }} MedallionSubject
 */

/**
 * Teinte propre d'un pion lié : `color` si l'outil MJ l'envoie (un PJ ou la monture d'un PJ,
 * contrat §4), sinon celle du camp ; `undefined` sans l'une ni l'autre.
 *
 * @param {MedallionSubject} token
 * @returns {string|undefined}
 */
export function linkedTint(token) {
  if (isHexColor(token.color)) return token.color.toLowerCase();
  return token.camp ? CAMP_FILL[token.camp] : undefined;
}

/**
 * Cerclage d'un pion lié et sa teinte : un des cinq cerclages `pj-<nom>` (sans teinte) pour les
 * couleurs connues ; sinon seul le bronze des PJ inconnus (et de leurs montures) est teinté.
 *
 * @param {MedallionSubject} token
 * @returns {{ frame: MedallionFrame, tint: string|null }}
 */
export function medallionFrameOf(token) {
  if (isHexColor(token.color)) {
    const own = PJ_FRAMES[token.color.toLowerCase()];
    if (own) return { frame: own, tint: null };
  }
  if (token.camp === 'pj' || isHexColor(token.color)) return { frame: 'bronze', tint: linkedTint(token) ?? CAMP_FILL.pj };
  if (token.camp === 'allie') return { frame: 'etain', tint: null };
  if (token.camp === 'ennemi') return { frame: 'fer', tint: null };
  return { frame: 'bronze', tint: null };
}

/**
 * Teinte claire du fond émaillé : la couleur du PJ éclaircie, sinon celle du camp.
 *
 * @param {MedallionSubject} token
 * @returns {string}
 */
export function enamelLightOf(token) {
  if (isHexColor(token.color)) return mixHex(token.color.toLowerCase(), '#ffffff', 0.35);
  return (token.camp && /** @type {Record<string, string>} */ (ENAMEL_LIGHT)[token.camp]) || ENAMEL_LIGHT.neutre;
}

/**
 * Le médaillon se dessine-t-il ? Pion lié seulement, et assez grand à l'écran.
 *
 * @param {MedallionSubject} token
 * @param {number} widthMap largeur du pion en unités de carte
 * @param {number} zoom
 * @returns {boolean}
 */
export function wantsMedallion(token, widthMap, zoom) {
  return Boolean(token.link) && widthMap * zoom >= MEDALLION_MIN_SCREEN_PX;
}

/**
 * Mise en place du cerclage dans la case : le cercle extérieur de l'anneau touche le bord de la
 * case, la fenêtre est le disque intérieur (+0,5 unité pour couvrir le bord anticrénelé).
 *
 * @param {MedallionFrame} frame
 * @param {number} centerX
 * @param {number} centerY
 * @param {number} widthMap
 * @returns {{ windowRadius: number, frameX: number, frameY: number, frameSize: number }}
 */
export function medallionLayout(frame, centerX, centerY, widthMap) {
  const g = FRAME_GEOMETRY[frame];
  const k = widthMap / 2 / g.outer;
  return {
    windowRadius: g.inner * k + 0.5,
    frameX: centerX - g.cx * k,
    frameY: centerY - g.cy * k,
    frameSize: MEDALLION_FRAME_PX * k,
  };
}

/**
 * Clé de cache d'un cerclage : le gris efface la teinte.
 *
 * @param {MedallionFrame} frame
 * @param {string|null} tint
 * @param {boolean} dead
 * @returns {string}
 */
export function frameCacheKey(frame, tint, dead) {
  return dead ? `${frame}|mort` : `${frame}|${tint ?? ''}`;
}

/**
 * @typedef {{
 *   width: number, height: number,
 *   getContext: (type: '2d') => CanvasRenderingContext2D|null
 * }} MedallionCanvas
 * @typedef {{
 *   onload: ((this: any, ev?: any) => any)|null,
 *   onerror: ((this: any, ev?: any) => any)|null,
 *   src: string
 * }} MedallionImage
 */

/**
 * Images de cerclage et toiles hors écran (cerclages teintés ou gris, fonds émaillés), calculées
 * une fois et mises en cache. Sans fabrique d'image (node:test), aucun cerclage n'est jamais
 * prêt : le pion garde le disque simple.
 */
export class MedallionCache {
  /**
   * @param {{
   *   imageFactory?: (() => MedallionImage)|null,
   *   canvasFactory?: ((width: number, height: number) => MedallionCanvas)|null,
   *   invalidate?: () => void,
   *   baseUrl?: string
   * }} [options]
   */
  constructor(options = {}) {
    this.imageFactory = options.imageFactory !== undefined
      ? options.imageFactory
      : (typeof Image === 'function' ? () => new Image() : null);
    this.canvasFactory = options.canvasFactory !== undefined
      ? options.canvasFactory
      : (typeof document === 'object' && document
        ? (/** @type {number} */ width, /** @type {number} */ height) => {
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          return canvas;
        }
        : null);
    this.invalidate = options.invalidate ?? (() => {});
    this.baseUrl = options.baseUrl ?? MEDALLION_IMAGE_DIR;
    /** @type {Map<MedallionFrame, { status: 'loading'|'ready'|'error', image: MedallionImage, promise: Promise<void> }>} */
    this.images = new Map();
    /** @type {Map<string, MedallionCanvas>} */
    this.canvases = new Map();
    /** Nombre de toiles calculées : sert aux tests (« une fois, jamais à chaque image »). */
    this.builds = 0;
  }

  /**
   * @param {MedallionFrame} frame
   * @returns {Promise<void>}
   */
  load(frame) {
    const known = this.images.get(frame);
    if (known) return known.promise;
    if (!this.imageFactory) return Promise.resolve();
    const image = this.imageFactory();
    /** @type {{ status: 'loading'|'ready'|'error', image: MedallionImage, promise: Promise<void> }} */
    const entry = { status: 'loading', image, promise: Promise.resolve() };
    entry.promise = new Promise((resolve) => {
      image.onload = () => { entry.status = 'ready'; this.invalidate(); resolve(); };
      image.onerror = () => { entry.status = 'error'; resolve(); };
    });
    this.images.set(frame, entry);
    image.src = `${this.baseUrl}${frameFileName(frame)}`;
    return entry.promise;
  }

  /** @returns {Promise<void>} */
  preloadAll() {
    return Promise.all(/** @type {MedallionFrame[]} */ (['bronze', 'etain', 'fer', ...Object.values(PJ_FRAMES)]).map((f) => this.load(f))).then(() => {});
  }

  /** @param {string} key @param {MedallionCanvas} canvas */
  _remember(key, canvas) {
    this.canvases.set(key, canvas);
    while (this.canvases.size > MEDALLION_CACHE_LIMIT) {
      const oldest = this.canvases.keys().next().value;
      if (oldest !== undefined) this.canvases.delete(oldest);
    }
  }

  /**
   * Cerclage prêt à poser (teinté, ou gris pour un mort), ou `null` tant que l'image n'est pas
   * chargée — le premier appel lance le chargement.
   *
   * @param {MedallionFrame} frame
   * @param {string|null} tint
   * @param {boolean} dead
   * @returns {MedallionCanvas|null}
   */
  frameCanvas(frame, tint, dead) {
    const key = frameCacheKey(frame, tint, dead);
    const cached = this.canvases.get(key);
    if (cached) return cached;
    const entry = this.images.get(frame);
    if (!entry) { void this.load(frame); return null; }
    if (entry.status !== 'ready' || !this.canvasFactory) return null;
    const canvas = this.canvasFactory(MEDALLION_FRAME_PX, MEDALLION_FRAME_PX);
    const x = canvas.getContext('2d');
    if (!x) return null;
    const src = /** @type {CanvasImageSource} */ (/** @type {unknown} */ (entry.image));
    const size = MEDALLION_FRAME_PX;
    x.drawImage(src, 0, 0, size, size);
    if (tint && !dead) {
      // Mode « color » : la teinte remplace la couleur du bronze et garde sa luminosité, donc la
      // ciselure ; puis on redécoupe à la silhouette du cerclage.
      x.globalCompositeOperation = 'color';
      x.globalAlpha = 0.85;
      x.fillStyle = tint;
      x.fillRect(0, 0, size, size);
      x.globalAlpha = 1;
      x.globalCompositeOperation = 'destination-in';
      x.drawImage(src, 0, 0, size, size);
    }
    if (dead) {
      x.globalCompositeOperation = 'saturation';
      x.fillStyle = '#808080';
      x.fillRect(0, 0, size, size);
      x.globalCompositeOperation = 'source-atop';
      x.fillStyle = 'rgba(0, 0, 0, 0.35)';
      x.fillRect(0, 0, size, size);
      x.globalCompositeOperation = 'destination-in';
      x.drawImage(src, 0, 0, size, size);
    }
    x.globalCompositeOperation = 'source-over';
    this.builds += 1;
    this._remember(key, canvas);
    return canvas;
  }

  /**
   * Fond émaillé : dégradé radial de la teinte claire vers le bord sombre, éclairé par le haut.
   *
   * @param {string} light
   * @returns {MedallionCanvas|null}
   */
  enamelCanvas(light) {
    const key = `email|${light}`;
    const cached = this.canvases.get(key);
    if (cached) return cached;
    if (!this.canvasFactory) return null;
    const canvas = this.canvasFactory(ENAMEL_PX, ENAMEL_PX);
    const x = canvas.getContext('2d');
    if (!x) return null;
    const r = ENAMEL_PX / 2;
    const gradient = x.createRadialGradient(r, r - r * 0.3, r * 0.1, r, r, r);
    gradient.addColorStop(0, light);
    gradient.addColorStop(1, ENAMEL_DARK);
    x.fillStyle = gradient;
    x.fillRect(0, 0, ENAMEL_PX, ENAMEL_PX);
    this.builds += 1;
    this._remember(key, canvas);
    return canvas;
  }
}

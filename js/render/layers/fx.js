// @ts-check

/**
 * @typedef {import('../../core/types.js').Level} Level
 * @typedef {import('../../core/types.js').Token} Token
 * @typedef {import('../../grid/GridAdapter.js').GridAdapter} GridAdapter
 */

/**
 * Effets de blessure et de mort (docs/CONTRAT-LIAISON-OUTIL-MJ.md §9).
 *
 * ## Ce que cette couche n'est pas
 *
 * ⛔ **Elle ne lit pas l'état de la campagne pour décider quoi jouer, et rien ici n'est persisté.**
 * Un effet est un événement, pas une donnée : il vit en variable locale de la vue, comme un ping,
 * et un rechargement l'efface — tache de sang comprise (contrat §9.1). L'âge se compte depuis la
 * réception **locale** (`now` du poste qui affiche), jamais depuis l'horloge de l'émetteur : la
 * tablette a été mesurée 5,3 s en avance (voir `pings.js`).
 *
 * ## Technique d'image
 *
 * Les images sont des WebP carrés, vus de dessus. Le sang, le feu et le poison sont sur fond blanc
 * et se posent en `multiply` : le blanc disparaît sans détourage. La magie est sur fond noir et se
 * pose en `screen`. Provenance : `assets/fx/SOURCES.md`.
 *
 * ## Mouvement réduit
 *
 * Avec `prefers-reduced-motion`, un effet se réduit à son image principale, sans zoom, sans
 * rotation, en un fondu bref ; la tache de sang ne persiste pas.
 */

/** Dossier des images, relatif à la page (gm.html, player.html). */
export const FX_IMAGE_DIR = 'assets/fx/';

/** Seuil de la grosse gerbe : perte d'au moins ¼ du maximum (contrat §9.1). */
export const FX_HEAVY_WOUND_RATIO = 0.25;

/** Durée de la gerbe avant qu'elle ne devienne tache au sol. */
export const FX_BURST_MS = 450;

/** Durée d'estompage de la tache de sang : 90 s, dans la fourchette de 1 à 2 minutes du contrat. */
export const FX_STAIN_FADE_MS = 90_000;

/** Durée du fondu en mouvement réduit. */
export const FX_REDUCED_MS = 400;

/** Causes de mort connues (contrat §9.2). `blood` est la valeur par défaut. */
export const FX_DEATH_CAUSES = /** @type {const} */ (['blood', 'fire', 'magic', 'poison', 'decapitation', 'dismemberment']);

/** @typedef {'blood'|'fire'|'magic'|'poison'|'decapitation'|'dismemberment'} DeathCause */

/**
 * Un calque d'image dans le temps d'un effet.
 * @typedef {Object} FxSprite
 * @property {string} file       nom de base de l'image (`gerbe`, `flaque`, `feu`, `flammes-1`, `flammes-2`, `magie`, `poison`)
 * @property {'multiply'|'screen'} blend
 * @property {number} size       côté en cases du pion
 * @property {number} delay      ms avant le début
 * @property {number} grow       ms d'apparition (zoom depuis `scaleFrom`, opacité de 0 à `peak`)
 * @property {number} hold       ms à pleine opacité
 * @property {number} fade       ms d'estompage jusqu'à 0
 * @property {number} peak       opacité maximale
 * @property {number} scaleFrom  échelle au début
 * @property {number} scaleEnd   échelle à la fin de l'estompage
 * @property {number} [rotationShift] radians ajoutés à la rotation de l'effet, pour varier deux calques d'une même image
 * @property {number} [flicker]  amplitude du vacillement (0 à 1) de l'opacité et de l'échelle ; en phase décalée par calque
 * @property {number} [phase]    décalage du vacillement, en radians
 * @property {{ dx: number, dy: number }} [offset] décalage en fraction de `size`
 */

/**
 * @param {Partial<FxSprite> & { file: string }} s
 * @returns {FxSprite}
 */
function sprite(s) {
  return { blend: 'multiply', size: 2, delay: 0, grow: 0, hold: 0, fade: 0, peak: 1, scaleFrom: 1, scaleEnd: 1, ...s };
}

/**
 * `prefers-reduced-motion: reduce` demandé par le système ?
 * @returns {boolean}
 */
export function prefersReducedMotion() {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * Intensité d'une blessure : petite gerbe sous ¼ du maximum, grosse au-delà.
 *
 * @param {number} hpLost
 * @param {number} maxHp
 * @returns {'light'|'heavy'}
 */
export function woundIntensity(hpLost, maxHp) {
  if (!(maxHp > 0)) return 'light';
  return hpLost / maxHp >= FX_HEAVY_WOUND_RATIO ? 'heavy' : 'light';
}

/**
 * Calques d'une blessure : la gerbe, qui devient tache au sol et s'estompe lentement.
 *
 * @param {'light'|'heavy'} intensity
 * @returns {FxSprite[]}
 */
export function woundSprites(intensity) {
  return [sprite({
    file: 'gerbe',
    size: intensity === 'heavy' ? 2.4 : 1.4,
    grow: FX_BURST_MS,
    fade: FX_STAIN_FADE_MS,
    peak: 0.85,
    scaleFrom: 0.2,
  })];
}

/**
 * Calques d'une mort, une animation par cause. ⚠ `decapitation` et `dismemberment` n'ont pas
 * encore d'image à eux : ils recomposent la grosse gerbe et la flaque du sang (proposition du lot
 * L4, en attente du MJ : image dédiée à générer, ou conserver cette composition).
 *
 * @param {DeathCause} cause
 * @returns {FxSprite[]}
 */
export function deathSprites(cause) {
  switch (cause) {
    case 'fire':
      // Deux couches : la brûlure au sol (multiply, trace durable) et deux nappes de flammes vues
      // de dessus (screen, sur fond noir) qui vacillent en opposition de phase.
      return [
        sprite({ file: 'feu', size: 1.9, grow: 1400, hold: 3000, fade: 3000, scaleFrom: 0.6 }),
        sprite({ file: 'flammes-1', blend: 'screen', size: 1.7, grow: 500, hold: 2400, fade: 1800, scaleFrom: 0.5, flicker: 0.25, phase: 0 }),
        sprite({ file: 'flammes-2', blend: 'screen', size: 1.5, delay: 150, grow: 500, hold: 2250, fade: 1800, peak: 0.8, scaleFrom: 0.5, flicker: 0.25, phase: Math.PI, rotationShift: 2.1 }),
      ];
    case 'magic':
      return [sprite({ file: 'magie', blend: 'screen', size: 2.6, grow: 720, fade: 1080, scaleFrom: 0.3, scaleEnd: 1.3 })];
    case 'poison':
      return [sprite({ file: 'poison', size: 2, grow: 2200, hold: 3000, fade: 3000, peak: 0.9, scaleFrom: 0.2 })];
    case 'decapitation':
      return [
        sprite({ file: 'gerbe', size: 2.8, grow: FX_BURST_MS, hold: 600, fade: 2500, scaleFrom: 0.2 }),
        sprite({ file: 'flaque', size: 2.2, delay: 300, grow: 2600, hold: 3000, fade: 3000, peak: 0.95, scaleFrom: 0.15 }),
      ];
    case 'dismemberment':
      return [
        sprite({ file: 'gerbe', size: 2.6, grow: FX_BURST_MS, hold: 500, fade: 2500, scaleFrom: 0.2 }),
        sprite({ file: 'gerbe', size: 2.2, delay: 150, grow: FX_BURST_MS, hold: 500, fade: 2500, scaleFrom: 0.2, rotationShift: 1.7, offset: { dx: 0.18, dy: -0.12 } }),
        sprite({ file: 'flaque', size: 2.6, delay: 400, grow: 2600, hold: 3000, fade: 3000, peak: 0.95, scaleFrom: 0.15 }),
      ];
    case 'blood':
    default:
      return [sprite({ file: 'flaque', size: 2.2, grow: 2600, hold: 4000, fade: 3000, peak: 0.95, scaleFrom: 0.15 })];
  }
}

/**
 * Version « mouvement réduit » : l'image principale seule, sans zoom, en un fondu bref.
 *
 * @param {FxSprite[]} sprites
 * @returns {FxSprite[]}
 */
export function reduceSprites(sprites) {
  const main = sprites[sprites.length - 1];
  return [{ ...main, delay: 0, grow: FX_REDUCED_MS / 3, hold: 0, fade: (FX_REDUCED_MS * 2) / 3, scaleFrom: 1, scaleEnd: 1, offset: undefined }];
}

/**
 * Durée totale d'un calque.
 * @param {FxSprite} s
 * @returns {number}
 */
export function spriteDuration(s) {
  return s.delay + s.grow + s.hold + s.fade;
}

/**
 * Opacité et échelle d'un calque à un âge donné, ou `null` s'il n'est pas (ou plus) visible.
 *
 * @param {FxSprite} s
 * @param {number} age ms depuis le début de l'effet
 * @returns {{ alpha: number, scale: number }|null}
 */
export function spriteFrame(s, age) {
  const t = age - s.delay;
  if (t < 0 || t >= s.grow + s.hold + s.fade) return null;
  if (t < s.grow) {
    const p = t / s.grow;
    const eased = 1 - (1 - p) * (1 - p) * (1 - p);
    const grown = s.scaleFrom + (1 - s.scaleFrom) * eased;
    return { alpha: s.peak * Math.min(1, p * 2.5), scale: grown };
  }
  const wobble = s.flicker ? Math.sin(age / 85 + (s.phase ?? 0)) : 0;
  const flickerAlpha = 1 - (s.flicker ?? 0) * (0.5 + 0.5 * wobble);
  const flickerScale = 1 + (s.flicker ?? 0) * 0.16 * wobble;
  if (t < s.grow + s.hold) return { alpha: s.peak * flickerAlpha, scale: flickerScale };
  const p = (t - s.grow - s.hold) / s.fade;
  return { alpha: s.peak * flickerAlpha * (1 - p * p), scale: (1 + (s.scaleEnd - 1) * p) * flickerScale };
}

/**
 * Un effet doit-il se jouer pour ce pion sur cet écran ? Un pion caché ne joue aucun effet sur la
 * tablette (contrat §9) ; l'écran MJ le voit toujours.
 *
 * @param {Pick<Token, 'hidden'>|null|undefined} token
 * @param {boolean} isPlayerView
 * @returns {boolean}
 */
export function shouldPlayFx(token, isPlayerView) {
  if (!token) return false;
  return !(isPlayerView && token.hidden === true);
}

/**
 * Normalise un message `fx.*` de l'outil MJ (ou l'événement republié vers la tablette) en une
 * description d'effet, ou `null` s'il est malformé. Une cause inconnue vaut `blood`.
 *
 * @param {string} kind `wound` ou `death`
 * @param {any} payload
 * @returns {{ kind: 'wound', hpLost: number, maxHp: number }|{ kind: 'death', cause: DeathCause }|null}
 */
export function parseFx(kind, payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (kind === 'wound') {
    const { hpLost, maxHp } = payload;
    if (!Number.isFinite(hpLost) || hpLost <= 0 || !Number.isFinite(maxHp)) return null;
    return { kind: 'wound', hpLost, maxHp };
  }
  if (kind === 'death') {
    const cause = /** @type {readonly string[]} */ (FX_DEATH_CAUSES).includes(payload.cause) ? payload.cause : 'blood';
    return { kind: 'death', cause };
  }
  return null;
}

/**
 * @typedef {Object} ActiveFx
 * @property {string} tokenId
 * @property {FxSprite[]} sprites
 * @property {number} at              instant local de réception
 * @property {number} rotation        radians, tirée une fois
 * @property {boolean} reduced
 * @property {{ levelId: string, x: number, y: number, unit: number }|null} anchor  posée au premier rendu
 */

export class FxLayer {
  /**
   * @param {{
   *   loadImage?: (url: string) => { complete: boolean, naturalWidth: number } & CanvasImageSource,
   *   random?: () => number,
   * }} [options]
   */
  constructor(options = {}) {
    this.loadImage = options.loadImage ?? ((url) => {
      const image = new Image();
      image.src = url;
      return image;
    });
    this.random = options.random ?? Math.random;
    /** @type {Map<string, { complete: boolean, naturalWidth: number } & CanvasImageSource>} */
    this.images = new Map();
    /** @type {ActiveFx[]} */
    this.active = [];
    /** @type {ReturnType<typeof setTimeout>|null} */
    this.slowTimer = null;
  }

  /**
   * Lance l'effet d'un pion. Rien n'est joué si le pion est inconnu ou, côté tablette, caché.
   *
   * @param {{ kind: 'wound', hpLost: number, maxHp: number }|{ kind: 'death', cause: DeathCause }} fx
   * @param {{ tokenId: string, now: number, reducedMotion?: boolean }} context
   */
  play(fx, context) {
    const full = fx.kind === 'wound' ? woundSprites(woundIntensity(fx.hpLost, fx.maxHp)) : deathSprites(fx.cause);
    const reduced = context.reducedMotion === true;
    // Mouvement réduit : pas de tache persistante pour une blessure, un simple fondu.
    const sprites = reduced ? reduceSprites(full) : full;
    for (const s of sprites) this.imageFor(s);
    this.active.push({
      tokenId: context.tokenId,
      sprites,
      at: context.now,
      rotation: reduced ? 0 : this.random() * Math.PI * 2,
      reduced,
      anchor: null,
    });
  }

  /**
   * @param {FxSprite} s
   */
  imageFor(s) {
    const url = `${FX_IMAGE_DIR}${s.file}.webp`;
    let image = this.images.get(url);
    if (!image) {
      image = this.loadImage(url);
      this.images.set(url, image);
    }
    return image;
  }

  /** Oublie tous les effets (changement de campagne). */
  clear() {
    this.active = [];
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {GridAdapter} grid
   * @param {Level|null} level
   * @param {{
   *   tokens?: readonly Token[],
   *   now?: number,
   *   requestRender?: () => void,
   * }} [options]
   * @returns {{ drawn: boolean, animationActive: boolean }}
   */
  render(ctx, grid, level, options = {}) {
    const result = { drawn: false, animationActive: false };
    if (!ctx || !level || this.active.length === 0) return result;
    const now = options.now ?? 0;
    const tokens = options.tokens ?? [];
    let slow = false;

    this.active = this.active.filter((fx) => {
      const age = now - fx.at;
      if (age < 0) return false;
      if (!fx.anchor) {
        const token = tokens.find((t) => t.id === fx.tokenId);
        // Pion absent au premier rendu : l'effet est perdu (jamais rejoué, contrat §2.2).
        if (!token || !token.cell) return age < 1000;
        const sizeCells = Math.max(1, token.sizeCells || 1);
        const bounds = grid.cellBounds({ cellX: token.cell.a, cellY: token.cell.b }, sizeCells);
        fx.anchor = { levelId: token.levelId, x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2, unit: bounds.width / sizeCells };
      }
      return fx.sprites.some((s) => age < spriteDuration(s));
    });

    for (const fx of this.active) {
      const anchor = fx.anchor;
      if (!anchor || anchor.levelId !== level.id) continue;
      const age = now - fx.at;
      for (const s of fx.sprites) {
        const frame = spriteFrame(s, age);
        if (!frame) continue;
        // Un fondu lent (la tache de sang) ne justifie pas 60 images par seconde : un rafraîchissement par seconde.
        if (age - s.delay >= s.grow + s.hold && s.fade > 5000) slow = true;
        else result.animationActive = true;
        const image = this.imageFor(s);
        if (!image.complete || !image.naturalWidth) continue;
        const side = s.size * anchor.unit * frame.scale;
        ctx.save();
        ctx.globalCompositeOperation = s.blend;
        ctx.globalAlpha = Math.max(0, Math.min(1, frame.alpha));
        ctx.translate(anchor.x + (s.offset?.dx ?? 0) * s.size * anchor.unit, anchor.y + (s.offset?.dy ?? 0) * s.size * anchor.unit);
        ctx.rotate(fx.rotation + (s.rotationShift ?? 0));
        ctx.drawImage(image, -side / 2, -side / 2, side, side);
        ctx.restore();
        result.drawn = true;
      }
    }

    if (slow && !this.slowTimer && options.requestRender) {
      const request = options.requestRender;
      this.slowTimer = setTimeout(() => {
        this.slowTimer = null;
        request();
      }, 1000);
    }
    return result;
  }
}

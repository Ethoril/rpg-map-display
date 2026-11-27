// @ts-check

/**
 * @typedef {import('../../core/types.js').Level} Level
 * @typedef {import('../../core/types.js').Token} Token
 * @typedef {import('../../core/types.js').Cell} Cell
 * @typedef {import('../../grid/GridAdapter.js').GridAdapter} GridAdapter
 */

// H-4 : le masque de vision, la MÊME source que la couche des pions. Seule dépendance de
// cette couche, et elle ne lui fait rien lire de la campagne : un tableau d'alpha déjà calculé.
import { getOrExtractMaskAlpha, isCellVisibleInMask } from '../../vision/fog.js';

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

/** Durée de vie d'un trait d'attaque, en ms (rendu provisoire, CdC §7 `attack`). */
export const FX_ATTACK_MS = 700;

/**
 * Une couleur par issue d'attaque (contrat §9.3), cinq valeurs distinctes et lisibles sur une
 * carte sombre. ⚠ Provisoire : le vocabulaire visuel des cinq issues n'est pas arbitré
 * (§11 point 12) — seule la distinction compte, à juger à la table.
 */
export const FX_ATTACK_COLORS = Object.freeze({
  hit: '#ffd166',
  miss: '#8a8f98',
  critical: '#ff4d4d',
  parried: '#4da3ff',
  dodged: '#5ad66f',
});

/** Causes de mort connues (contrat §9.2). `blood` est la valeur par défaut. */
export const FX_DEATH_CAUSES = /** @type {const} */ (['blood', 'fire', 'magic', 'poison', 'decapitation', 'dismemberment']);

/** @typedef {'blood'|'fire'|'magic'|'poison'|'decapitation'|'dismemberment'} DeathCause */

/**
 * Issues reconnues d'une attaque (contrat §9.3), sensibles à la casse.
 * @typedef {'hit'|'miss'|'critical'|'parried'|'dodged'} AttackOutcome
 */

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
 * Une case bien formée : un objet avec `a` et `b` finis.
 *
 * @param {any} c
 * @returns {c is Cell}
 */
function celluleValide(c) {
  return !!c && typeof c === 'object' && Number.isFinite(c.a) && Number.isFinite(c.b);
}

/**
 * @typedef {Object} ActiveFx
 * @property {string} tokenId
 * @property {FxSprite[]} sprites
 * @property {number} at              instant local de réception
 * @property {number} rotation        radians, tirée une fois
 * @property {boolean} reduced
 * @property {{ levelId: string, parts: { cell: Cell, sizeCells: number }[] }|null} target
 *   H-6 : la cible est **l'étage et les cases**, relevés au premier rendu — jamais une position
 *   en pixels. La géométrie se recalcule à chaque image avec la grille de CET étage-là : une
 *   ancre figée au premier rendu l'était avec la grille de l'étage *affiché*, qui peut être un
 *   autre, et l'effet se dessinait ensuite à cette place fausse.
 *
 *   ⚠ `parts` est une LISTE dès maintenant, alors qu'un effet n'a aujourd'hui qu'une seule
 *   partie (l'emprise du pion touché). L'arbitrage à venir sur les projectiles porte sur un
 *   trajet à DEUX extrémités : un garde construit pour une seule case devrait être rouvert.
 * @property {{ outcome: AttackOutcome, damage?: number }} [attack]
 *   Présent seulement pour une attaque (contrat §9.3) : un trait droit sans aucun sprite, qui
 *   vit `FX_ATTACK_MS`. Sa cible est posée dès le départ — les DEUX cases — et n'est jamais
 *   cherchée par pion : `partiesVues` exige alors que les deux extrémités soient vues.
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
      target: null,
    });
  }

  /**
   * Lance le trait d'une attaque (contrat §9.3, CdC §7 `attack`) : une ligne droite de la case
   * de l'attaquant à celle de la cible, une couleur par issue, et le chiffre des dégâts près
   * de la cible quand l'outil MJ le chiffre. Rendu sobre et provisoire. Rien n'est joué si le
   * message est malformé : issue inconnue, étage absent, ou une extrémité qui n'est pas une
   * case à `a` et `b` finis.
   *
   * @param {{ from: Cell, to: Cell, levelId: string, outcome: string, damage?: number }} op
   * @param {{ now: number, reducedMotion?: boolean }} context
   */
  playAttack(op, context) {
    if (!op || typeof op !== 'object') return;
    const { from, to, levelId, outcome } = op;
    if (typeof levelId !== 'string' || levelId === '') return;
    if (!celluleValide(from) || !celluleValide(to)) return;
    const couleurs = /** @type {Record<string, string>} */ (FX_ATTACK_COLORS);
    if (!Object.prototype.hasOwnProperty.call(couleurs, outcome)) return;
    const damage = typeof op.damage === 'number' && Number.isFinite(op.damage) && op.damage > 0 ? op.damage : undefined;
    this.active.push({
      tokenId: '',
      sprites: [],
      at: context.now,
      rotation: 0,
      reduced: context.reducedMotion === true,
      target: {
        levelId,
        // DEUX parties : c'est ce qui fait exiger par `partiesVues` que les deux extrémités
        // soient vues — une arrivée en clair donnerait la direction d'un attaquant non vu.
        parts: [
          { cell: { a: from.a, b: from.b }, sizeCells: 1 },
          { cell: { a: to.a, b: to.b }, sizeCells: 1 },
        ],
      },
      attack: { outcome: /** @type {AttackOutcome} */ (outcome), damage },
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
 *   role?: 'gm'|'players',
 *   visibleCanvas?: { width: number, height: number, maskAlpha?: Uint8Array|null }|null,
 *   activeLevelWidthCells?: number,
 *   activeLevelHeightCells?: number,
 *   visionPublished?: boolean,
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
      // Une attaque n'a aucun sprite : elle vit exactement `FX_ATTACK_MS`, et sa cible est
      // déjà posée (les deux cases) — elle ne passe pas par la recherche de pion ci-dessous.
      if (fx.attack) return age < FX_ATTACK_MS;
      if (!fx.target) {
        const token = tokens.find((t) => t.id === fx.tokenId);
        // Pion absent au premier rendu : l'effet est perdu (jamais rejoué, contrat §2.2).
        if (!token || !token.cell) return age < 1000;
        // H-6 : on ne retient que l'étage et la case. La case est bien FIGÉE — une tache de
        // sang reste là où le coup a porté et ne suit pas le pion — mais sa traduction en
        // pixels, non : elle dépend du pas de l'étage, et se refait donc à chaque image.
        fx.target = {
          levelId: token.levelId,
          parts: [{ cell: { a: token.cell.a, b: token.cell.b }, sizeCells: Math.max(1, token.sizeCells || 1) }],
        };
      }
      return fx.sprites.some((s) => age < spriteDuration(s));
    });

    // H-4, arbitrage B du 26/11/2026 : l'effet ET sa tache ne sont dessinés que sur les cases
    // ACTUELLEMENT visibles, et le test est refait à chaque image — invisible au moment du coup,
    // la tache apparaît si les joueurs éclairent la pièce dans les 90 s de son fondu. Entrer
    // dans une salle où il y a du sang est une information de jeu, pas une fuite.
    //
    // ⛔ Le filtre est DANS la couche, pas dans l'ordre des calques : `fx` est déjà rangé sous
    // le fog, mais D-12 (03/10/2026) a rendu l'exploré non éclairé translucide — le voile n'y
    // masque donc plus rien, et l'effet transparaissait.
    //
    // ⭐ Aucun mécanisme nouveau : `isCellVisibleInMask` sur l'emprise, exactement la règle de
    // la couche des pions, décision du MJ du 22/11/2026 comprise (un grand pion est vu dès
    // qu'UNE case de son emprise l'est). Et comme pour les pions, un appelant qui ne passe PAS
    // de masque garde l'ancien comportement : l'écran MJ voit toujours l'effet (contrat §9).
    const isPlayerView = options.role === 'players';
    const largeurCases = options.activeLevelWidthCells;
    const hauteurCases = options.activeLevelHeightCells;
    const maskAlpha = isPlayerView && options.visibleCanvas && largeurCases && hauteurCases
      ? getOrExtractMaskAlpha(options.visibleCanvas, largeurCases, hauteurCases)
      : null;
    const aucuneVisionPubliee = isPlayerView && options.visionPublished === false;
    /** @param {{ cell: Cell, sizeCells: number }[]} parts */
    const partiesVues = (parts) => {
      if (aucuneVisionPubliee) return false;
      if (!maskAlpha || !largeurCases || !hauteurCases) return true;
      const shift = grid.maskLatticeShift();
      // Chaque partie doit être vue : une seule extrémité en clair suffirait à donner la
      // direction de l'autre. Chaque partie suit la règle des pions — vue dès qu'une case l'est.
      return parts.every((part) => grid.cellsOccupied(part.cell, part.sizeCells)
        .some((c) => isCellVisibleInMask(c, maskAlpha, largeurCases, hauteurCases, grid.type, shift)));
    };

    for (const fx of this.active) {
      const target = fx.target;
      if (!target || target.levelId !== level.id) continue;
      if (!partiesVues(target.parts)) continue;
      const age = now - fx.at;
      // Attaque (contrat §9.3) : un seul trait, aucun sprite à dessiner.
      if (fx.attack) {
        // H-6 : les deux centres sont recalculés à CHAQUE image avec la grille de CET étage,
        // jamais mis en cache en pixels.
        const depart = grid.cellCenter(target.parts[0].cell);
        const arrivee = grid.cellCenter(target.parts[1].cell);
        const pas = grid.cellBounds({ cellX: 0, cellY: 0 }, 1).width;
        const couleur = FX_ATTACK_COLORS[fx.attack.outcome];
        // Fondu de pleine opacité à transparent sur `FX_ATTACK_MS` ; en mouvement réduit, une
        // opacité constante, aucune animation.
        const alpha = fx.reduced ? 1 : Math.max(0, 1 - age / FX_ATTACK_MS);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = couleur;
        // Largeur proportionnée au pas de l'étage, pour rester lisible vu de loin.
        ctx.lineWidth = Math.max(2, pas * 0.06);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(depart.x, depart.y);
        ctx.lineTo(arrivee.x, arrivee.y);
        ctx.stroke();
        // Le chiffre des dégâts, une seule fois, du côté de la CIBLE : strictement plus proche
        // du centre de la cible que de celui de l'attaquant.
        if (fx.attack.damage !== undefined) {
          ctx.fillStyle = couleur;
          ctx.font = `${Math.max(12, pas * 0.35)}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(fx.attack.damage), depart.x + (arrivee.x - depart.x) * 0.75, depart.y + (arrivee.y - depart.y) * 0.75);
        }
        ctx.restore();
        result.drawn = true;
        result.animationActive = true;
        continue;
      }
      // H-6 : la géométrie se calcule ICI, avec la grille de l'étage affiché — qui est bien
      // celui de la cible, le test ci-dessus venant de l'établir.
      const tete = target.parts[0];
      const bounds = grid.cellBounds({ cellX: tete.cell.a, cellY: tete.cell.b }, tete.sizeCells);
      const anchor = {
        x: bounds.x + bounds.width / 2,
        y: bounds.y + bounds.height / 2,
        unit: bounds.width / tete.sizeCells,
      };
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

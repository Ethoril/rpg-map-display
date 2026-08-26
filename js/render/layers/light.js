// @ts-check

import { LightField, cappedLightRange } from '../../vision/lightField.js';

/** @typedef {import('../../core/types.js').Level} Level */
/** @typedef {import('../../core/types.js').Token} Token */
/** @typedef {import('../../core/types.js').MapPoint} MapPoint */
/** @typedef {import('../../core/types.js').Segment} Segment */
/** @typedef {import('../../vision/lightField.js').PreparedLight} PreparedLight */

// Couche d'éclairage — tranche Z-03 du chantier Z.
//
// Elle occupe le **rang 3** de la pile, juste au-dessus du décor (fond et quadrillage) et
// SOUS les murs, les portes, les liaisons, les gabarits et les pions. Décision du mainteneur
// du 26/08/2026 : la lisibilité de tout ce qui est au-dessus a été validée en séance, et les
// teinter la remettrait en jeu.
//
// ⭐ **Le quadrillage, lui, est éclairé** — une pièce noire n'a pas à montrer une grille en
// pleine lumière.

/**
 * Rassemble les sources d'un étage, converties en **pixels carte**.
 *
 * Deux familles, et elles se comportent exactement pareil une fois ici : les sources fixes de
 * la carte (`level.lights`, importées de l'UVTT) et les torches portées par les pions
 * (`token.emitsLight`). ⛔ Une torche est centrée sur le pion, pas sur le coin de sa case —
 * un pion 2×2 éclaire depuis son milieu.
 *
 * @param {Level|null} level
 * @param {Token[]} tokens
 * @param {any} adaptateur Adaptateur de pavage, pour la conversion cellule → carte
 * @returns {PreparedLight[]}
 */
export function collectLightSources(level, tokens, adaptateur) {
  if (!level || !adaptateur) return [];

  const origine = adaptateur.mapFromCellPoint({ cellX: 0, cellY: 0 });
  /**
   * Convertit une portée en cases vers des pixels carte, en passant par l'adaptateur : c'est
   * lui qui sait ce que vaut une case, et il n'y a pas d'autre endroit où le savoir.
   * @param {number} cases
   */
  const porteeEnPixels = (cases) => {
    const bout = adaptateur.mapFromCellPoint({ cellX: cases, cellY: 0 });
    return Math.hypot(bout.x - origine.x, bout.y - origine.y);
  };

  /** @type {PreparedLight[]} */
  const sources = [];

  for (const light of Array.isArray(level.lights) ? level.lights : []) {
    if (!light || !light.at) continue;
    const cases = cappedLightRange(light.range);
    if (cases <= 0) continue;
    sources.push({
      center: adaptateur.mapFromCellPoint(light.at),
      radiusPx: porteeEnPixels(cases),
      intensity: Number.isFinite(light.intensity) ? light.intensity : 1,
      color: light.color,
    });
  }

  for (const token of Array.isArray(tokens) ? tokens : []) {
    if (!token || token.levelId !== level.id || !token.cell) continue;
    const emise = token.emitsLight;
    const cases = cappedLightRange(emise?.range);
    if (cases <= 0) continue;
    const taille = Math.max(1, token.sizeCells || 1);
    sources.push({
      center: adaptateur.mapFromCellPoint({
        cellX: token.cell.a + taille / 2,
        cellY: token.cell.b + taille / 2,
      }),
      radiusPx: porteeEnPixels(cases),
      intensity: Number.isFinite(emise?.intensity) ? Number(emise?.intensity) : 1,
      color: String(emise?.color ?? '#ffffff'),
    });
  }

  return sources;
}

/**
 * Signature de cache du champ lumineux.
 *
 * ⭐ **Elle ne contient AUCUN pion joueur, et c'est le cœur du modèle.** Le champ est une
 * propriété de la carte : une lampe éclaire qu'on la regarde ou non. Déplacer un PJ ne
 * recompose donc rien — à la différence de `buildVisionSignature`, qui doit suivre chaque
 * déplacement parce que la vision, elle, dépend de l'observateur.
 *
 * C'est cette séparation qui fait tomber la question 9 du §12 (voir §4.6 du chantier), et
 * c'est elle qu'un test doit protéger : la confondre avec la signature de vision ferait
 * recomposer 93 sources à chaque pas d'un pion.
 *
 * ⚠ Les **portes** en font partie avec leur état : ouvrir une porte change l'occlusion, donc
 * la forme du champ. Les **murs** aussi, que l'éditeur de murs peut modifier en séance.
 *
 * ⛔ `shadows` n'y figure PAS : toutes les sources sont occluses (décision §4.4b), donc ce
 * champ ne change jamais le résultat. L'y mettre ferait recomposer pour rien.
 *
 * @param {Level|null} level
 * @param {Token[]} tokens
 * @param {any} adaptateur
 * @returns {string}
 */
export function buildLightSignature(level, tokens, adaptateur) {
  if (!level || !adaptateur) return '';

  /** @type {string[]} */
  const parts = [`level:${level.id || 'default'}`];

  // Même raison que pour la vision : les positions sont en pixels carte, donc un réimport qui
  // garde l'identifiant mais change la densité ou l'origine doit invalider le cache.
  const origine = adaptateur.mapFromCellPoint({ cellX: 0, cellY: 0 });
  const axeA = adaptateur.mapFromCellPoint({ cellX: 1, cellY: 0 });
  const axeB = adaptateur.mapFromCellPoint({ cellX: 0, cellY: 1 });
  parts.push(
    `geom:${origine.x},${origine.y}|${axeA.x},${axeA.y}|${axeB.x},${axeB.y}:` +
    `size=${level.widthCells}x${level.heightCells}`
  );

  // ⭐ L'ambiante entre par sa VALEUR, pas par un prédicat « allumé / éteint » : depuis la
  // décision §4.3 le moteur la lit comme un continu, et 0,35 doit se distinguer de 1.
  parts.push(`ambient:level=${level.ambient?.level}:baked=${level.ambient?.baked}`);

  if (Array.isArray(level.walls)) {
    for (const polyligne of level.walls) {
      if (!Array.isArray(polyligne)) continue;
      for (const point of polyligne) {
        if (point) parts.push(`w:${point.cellX},${point.cellY}`);
      }
    }
  }

  if (Array.isArray(level.portals)) {
    for (const portail of level.portals) {
      if (!portail) continue;
      parts.push(
        `p:${portail.id}:${portail.a?.cellX},${portail.a?.cellY}-${portail.b?.cellX},${portail.b?.cellY}:${portail.state}`
      );
    }
  }

  const lumieres = Array.isArray(level.lights) ? [...level.lights] : [];
  lumieres.sort((a, b) => String(a?.id).localeCompare(String(b?.id)));
  for (const light of lumieres) {
    if (!light) continue;
    parts.push(
      `l:${light.id}:at=${light.at?.cellX},${light.at?.cellY}:range=${light.range}:` +
      `intensity=${light.intensity}:color=${light.color}`
    );
  }

  const porteurs = (Array.isArray(tokens) ? tokens : []).filter(
    (t) => t && t.levelId === level.id && cappedLightRange(t.emitsLight?.range) > 0
  );
  porteurs.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  for (const token of porteurs) {
    const taille = Math.max(1, token.sizeCells || 1);
    parts.push(
      `torche:${token.id}:cell=${token.cell?.a},${token.cell?.b}:size=${taille}:` +
      `range=${token.emitsLight?.range}:intensity=${token.emitsLight?.intensity}:color=${token.emitsLight?.color}`
    );
  }

  return parts.join(';');
}

/**
 * Fabrique un canvas hors écran, en reprenant la fabrique de l'appelant quand il en fournit
 * une — c'est ce qui rend la couche éprouvable sans DOM.
 *
 * @param {number} width @param {number} height
 * @param {any} mainCtx @param {((w: number, h: number) => any)} [fabrique]
 */
function canvasHorsEcran(width, height, mainCtx, fabrique) {
  if (typeof fabrique === 'function') return fabrique(width, height);
  const proprietaire = mainCtx?.canvas?.ownerDocument;
  const doc = proprietaire ?? (typeof document !== 'undefined' ? document : null);
  if (!doc || typeof doc.createElement !== 'function') return null;
  const canvas = doc.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export class LightLayer {
  /** @param {Object} [options] @param {((w: number, h: number) => any)} [options.createCanvas] */
  constructor(options = {}) {
    this._fabrique = options.createCanvas;
    /** @type {LightField|null} */
    this._field = null;
    /** @type {string} */
    this._signature = '';
    /** @type {any} Tampon de modulation : opaque, noir là où rien n'éclaire. */
    this._modulation = null;
    this._modulationCtx = null;
    /** @type {number} Révision du champ dont le tampon de modulation est issu. */
    this._modulationRevision = -1;
    /** @type {any} Tampon de voile, pour le chemin « fond animé ». */
    this._voile = null;
    this._voileCtx = null;
    /** @type {number} Révision du champ dont le tampon de voile est issu. */
    this._voileRevision = -1;
    /** @type {number} Sources peintes au dernier calcul, pour observation extérieure. */
    this.lastSourceCount = 0;
  }

  /** Force le recalcul au prochain passage. */
  invalidate() {
    this._signature = '';
    this._modulationRevision = -1;
    this._voileRevision = -1;
  }

  /**
   * Recompose le champ **si sa signature a changé**, et rien d'autre.
   *
   * ⚠ Coût mesuré par M2 sur Tab S9 FE : **1,80 ms** pour les 93 sources du village. C'est le
   * prix d'une mutation, pas d'une image — et c'est toute la raison d'être de la signature.
   *
   * ⛔ **`extractSegments` est une fonction, pas un tableau, et ce n'est pas un détail.**
   * L'extraction des obstacles coûte cher — 1338 murs sur `testbig150` — et la passer déjà
   * évaluée la ferait payer à **chaque image**, y compris les 99 % où rien n'a bougé. Elle
   * n'est appelée qu'**après** le test de signature. C'est exactement ce que fait déjà
   * `FogLayer.updateVision`, et pour la même raison.
   *
   * @param {any} adaptateur
   * @param {Level|null} level
   * @param {Token[]} tokens
   * @param {Object} [options]
   * @param {Segment[]} [options.segments] Obstacles déjà extraits, s'ils le sont par ailleurs
   * @param {(lvl: Level, a: any) => Segment[]} [options.extractSegments] Extracteur paresseux
   * @returns {boolean} `true` si le champ a été recomposé
   */
  update(adaptateur, level, tokens, options = {}) {
    if (!adaptateur || !level) return false;

    const signature = buildLightSignature(level, tokens || [], adaptateur);
    if (signature === this._signature && this._field) return false;
    this._signature = signature;

    if (
      !this._field ||
      this._field.widthCells !== level.widthCells ||
      this._field.heightCells !== level.heightCells
    ) {
      this._field = new LightField(level.widthCells, level.heightCells, this._fabrique);
      // Le champ change de taille : le tampon de modulation qui en dérivait est caduc.
      this._modulation = null;
      this._modulationRevision = -1;
    }

    const sources = collectLightSources(level, tokens || [], adaptateur);
    this.lastSourceCount = sources.length;

    const origine = adaptateur.mapFromCellPoint({ cellX: 0, cellY: 0 });
    const uneCase = adaptateur.mapFromCellPoint({ cellX: 1, cellY: 0 });
    const echelle = Math.hypot(uneCase.x - origine.x, uneCase.y - origine.y);

    // Extraction PARESSEUSE : on n'arrive ici que si la signature a changé.
    const segments = options.segments
      || (typeof options.extractSegments === 'function' ? options.extractSegments(level, adaptateur) : []);

    this._field.compose(sources, {
      ambientLevel: Number(level.ambient?.baked ? 1 : level.ambient?.level) || 0,
      segments,
      mapOrigin: origine,
      gridScale: echelle,
    });
    return true;
  }

  /**
   * Construit le tampon de **modulation** : opaque, noir là où rien n'éclaire, coloré là où
   * une source porte.
   *
   * ⭐ Pourquoi un second tampon plutôt que le champ lui-même : `LightField` produit *la
   * lumière*, donc du **transparent** là où il n'y en a pas — c'est honnête, et c'est ce que
   * ses tests épinglent. Or `multiply` sur du transparent ne fait rien. La modulation est donc
   * « noir opaque + le champ en additif », construite **une fois par recomposition** et non
   * par image, à la résolution du masque : 336 × 336 pour le village, négligeable.
   *
   * @param {any} mainCtx
   */
  _construireModulation(mainCtx) {
    const champ = this._field;
    if (!champ || !champ.canvas) return null;
    if (this._modulation && this._modulationRevision === champ.revision) return this._modulation;

    if (
      !this._modulation ||
      this._modulation.width !== champ.maskWidth ||
      this._modulation.height !== champ.maskHeight
    ) {
      this._modulation = canvasHorsEcran(champ.maskWidth, champ.maskHeight, mainCtx, this._fabrique);
      if (this._modulation) {
        this._modulation.width = champ.maskWidth;
        this._modulation.height = champ.maskHeight;
        this._modulationCtx = this._modulation.getContext('2d');
      }
    }
    const ctx = this._modulationCtx;
    if (!ctx) return null;

    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, champ.maskWidth, champ.maskHeight);
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(champ.canvas, 0, 0);
    ctx.globalCompositeOperation = 'source-over';

    this._modulationRevision = champ.revision;
    return this._modulation;
  }

  /**
   * Applique l'éclairage au décor déjà peint.
   *
   * **Deux chemins, et le second n'est pas un raffinement : sans lui la lumière ne ferait
   * rien du tout au-dessus d'un fond animé.**
   *
   * 1. **`multiply`** — le modèle juste, *décor × éclairement* : une zone non éclairée devient
   *    noire, une zone éclairée prend la teinte de sa source, une zone en pleine lumière
   *    blanche reste elle-même. Une seule passe.
   * 2. **Voile `source-over`** quand le fond animé joue. `background.render` se tait alors
   *    (`suppressed`) pour laisser voir la vidéo posée SOUS le canvas : le décor y est donc
   *    **transparent**.
   *
   *    ⭐ **Et c'est là que le `multiply` casse — pas comme on le croirait.** Le réflexe est
   *    de dire « multiplier du transparent ne fait rien » : c'est vrai d'une *source*
   *    transparente, pas d'une *destination* transparente. Le terme `as·(1−ab)·Cs` de la
   *    composition dit qu'une source **opaque** posée sur du transparent s'y écrit **telle
   *    quelle**. Le tampon de modulation étant opaque, il donnerait du noir la nuit — juste
   *    par accident — mais **du blanc en plein jour**, effaçant la vidéo derrière un aplat.
   *    Constaté en écrivant le test n°8 de `lightLayer.test.mjs`, qui a rougi sur la
   *    prémisse fausse avant de la corriger.
   *
   *    Le voile, lui, peint par-dessus et son opacité est le complément de l'éclairement :
   *    transparent en plein jour, noir dans le noir. C'est exactement ce que fait déjà
   *    `fogLayer`, et un test e2e épingle que le brouillard couvre le fond animé. ⚠ Ce chemin
   *    **assombrit sans teinter** : la teinte d'une source est perdue au-dessus d'une vidéo.
   *
   * @param {CanvasRenderingContext2D} ctx Contexte de scène, déjà transformé par la caméra
   * @param {any} adaptateur
   * @param {Level|null} level
   * @param {Object} [options]
   * @param {'gm'|'players'} [options.role]
   * @param {'play'|'prep'} [options.mode] Mode du panneau MJ (UX-03). ⚠ 'prep', pas
   *        'prepare' : c'est la valeur que `createGMPanel().getMode()` rend réellement.
   * @param {boolean} [options.suppressed] Le fond animé peint sous le canvas
   * @returns {boolean} `true` si quelque chose a été peint
   */
  render(ctx, adaptateur, level, options = {}) {
    if (!ctx || !adaptateur || !level) return false;

    // ⭐ Décision §4.5 : à plat en « Préparer », éclairé en « Jouer ». Poser des murs dans une
    // cave non éclairée ne doit pas se faire à l'aveugle. La vue joueurs, elle, est TOUJOURS
    // éclairée — elle n'a pas de mode.
    const role = options.role || 'gm';
    if (role === 'gm' && options.mode === 'prep') return false;

    const champ = this._field;
    if (!champ || !champ.canvas) return false;

    const coinBas = adaptateur.mapFromCellPoint({
      cellX: level.widthCells,
      cellY: level.heightCells,
    });
    const largeurCarte = Math.ceil(coinBas.x);
    const hauteurCarte = Math.ceil(coinBas.y);
    if (largeurCarte <= 0 || hauteurCarte <= 0) return false;

    if (options.suppressed) {
      // Voile : noir, d'opacité complémentaire à l'éclairement. `destination-out` retire du
      // noir opaque exactement ce que le champ apporte de lumière.
      const voile = this._construireVoile(ctx);
      if (!voile) return false;
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(voile, 0, 0, champ.maskWidth, champ.maskHeight, 0, 0, largeurCarte, hauteurCarte);
      ctx.restore();
      return true;
    }

    const modulation = this._construireModulation(ctx);
    if (!modulation) return false;

    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(modulation, 0, 0, champ.maskWidth, champ.maskHeight, 0, 0, largeurCarte, hauteurCarte);
    ctx.restore();
    return true;
  }

  /**
   * Tampon de voile : du noir dont l'opacité est le complément de l'éclairement.
   * Construit à la même cadence que la modulation — une fois par recomposition.
   *
   * @param {any} mainCtx
   */
  _construireVoile(mainCtx) {
    const champ = this._field;
    if (!champ || !champ.canvas) return null;
    if (this._voile && this._voileRevision === champ.revision) return this._voile;

    if (!this._voile || this._voile.width !== champ.maskWidth || this._voile.height !== champ.maskHeight) {
      this._voile = canvasHorsEcran(champ.maskWidth, champ.maskHeight, mainCtx, this._fabrique);
      if (this._voile) {
        this._voile.width = champ.maskWidth;
        this._voile.height = champ.maskHeight;
        this._voileCtx = this._voile.getContext('2d');
      }
    }
    const ctx = this._voileCtx;
    if (!ctx) return null;

    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, champ.maskWidth, champ.maskHeight);
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, champ.maskWidth, champ.maskHeight);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.drawImage(champ.canvas, 0, 0);
    ctx.globalCompositeOperation = 'source-over';

    this._voileRevision = champ.revision;
    return this._voile;
  }
}

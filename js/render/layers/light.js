// @ts-check

import {
  LIGHT_GM_DARKNESS_RATIO,
  LIGHT_NIGHT_VISION_FLOOR,
  LIGHT_COLOR_VISION_GAIN,
} from '../../core/constants.js';
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
//
// ── Le stencil « vu sans lumière » (décision du mainteneur du 07/09/2026) ─────────────────
//
// La règle tactique de `vision/fog.js` est : visible = (ligne de vue ∩ éclairé) ∪ portée
// propre dans le noir (`visionDim`, Terme 2, ajouté SANS condition). Le brouillard révèle donc
// déjà honnêtement le disque de vision nocturne d'un PJ — mais jusqu'ici cette couche peignait
// la zone en noir opaque, faute d'y distinguer « pas vu » de « vu, mais pas éclairé ».
//
// La démonstration qui règle ça est courte : visible ∧ ¬éclairé = (LoS ∩ éclairé ∪ portée
// propre) ∧ ¬éclairé = portée propre ∧ ¬éclairé, puisque (LoS ∩ éclairé) ∧ ¬éclairé est vide.
// **C'est exactement la zone à peindre en niveaux de gris**, et elle ne demande aucune
// plomberie de polygones : masque visible ∧ ¬champ lumineux, tous deux déjà disponibles à la
// résolution du masque (`FOG_MASK_PX_PER_CELL`).

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
    // Amendement C-2 : une lampe ÉTEINTE n'émet RIEN — ni lumière, ni contribution à la
    // vision, puisque ce champ nourrit la règle tactique. `on` est normalisé par
    // `normalizeLevel` (schema.js) ; `!== false` reste la ceinture d'un document non repassé
    // par cette normalisation.
    if (light.on === false) continue;
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
    // G-1 : le centre de la torche portée vient de la boîte DESSINÉE (`cellBounds`), jamais
    // d'une arithmétique sur `mapFromCellPoint` — ce dernier rend un point du réseau de la
    // grille, pas le centre d'une case (C-5). L'écart mesuré : rien en carré, mais jusqu'à
    // une case entière (100 px en x, 36,6 px en y à 140 px/case) pour un pion de taille 2 en
    // hexagonal. Sans ce détour, la lumière portée éclaire depuis un endroit où le pion n'est
    // pas dessiné.
    const boiteToken = adaptateur.cellBounds({ cellX: token.cell.a, cellY: token.cell.b }, taille);
    sources.push({
      center: { x: boiteToken.x + boiteToken.width / 2, y: boiteToken.y + boiteToken.height / 2 },
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
    // ⛔ `on` DOIT figurer ici — piège nommé par l'amendement C-2. Sans lui, basculer une
    // lampe ne changerait ni la géométrie ni les couleurs qui composent le reste de la
    // signature : le cache la jugerait identique et court-circuiterait la recomposition,
    // laissant la lampe visuellement allumée après qu'on l'a éteinte.
    parts.push(
      `l:${light.id}:at=${light.at?.cellX},${light.at?.cellY}:range=${light.range}:` +
      `intensity=${light.intensity}:color=${light.color}:on=${light.on !== false}`
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
    /** @type {number|null} Révision du stencil nocturne dont la modulation est issue. */
    this._modulationStencilRev = null;
    /** @type {any} Tampon de voile, pour le chemin « fond animé ». */
    this._voile = null;
    this._voileCtx = null;
    /** @type {number} Révision du champ dont le tampon de voile est issu. */
    this._voileRevision = -1;
    /** @type {number|null} Révision du stencil nocturne dont le voile est issu. */
    this._voileStencilRev = null;
    /** @type {any} Tampon du stencil « vu sans lumière » : masque visible ∧ ¬champ lumineux.
     *  ⭐ Consommé UNIQUEMENT par le plancher de luminosité (`_construireModulation`,
     *  `_construireVoile`) — la clarté du décor suit le champ RÉEL, décision du 10/09/2026. */
    this._stencilNocturne = null;
    this._stencilNocturneCtx = null;
    /** @type {number} Révision du champ dont le stencil est issu. */
    this._stencilChampRev = -1;
    /** @type {any} Révision du masque visible dont le stencil est issu (`__fogRevision` ou l'objet lui-même). */
    this._stencilVisibleRev = null;
    /** @type {number} Compteur de reconstruction du stencil, estampillé sur son canvas — même
     *  convention que `__fogRevision` de `fogLayer.js` : le stencil est mutable EN PLACE, sa
     *  référence ne change donc jamais, et c'est ce compteur qui rend sa mutation observable. */
    this._stencilRevisionCounter = 0;
    /** @type {any} Champ lumineux AMPLIFIÉ (`LIGHT_COLOR_VISION_GAIN`) — ne nourrit QUE le
     *  stencil de désaturation ci-dessous, jamais le plancher. Voir `_construireChampAmplifie`. */
    this._champAmplifie = null;
    this._champAmplifieCtx = null;
    /** @type {number} Révision du champ dont l'amplifié est issu. */
    this._champAmplifieRevision = -1;
    /** @type {any} Tampon du stencil de DÉSATURATION — décision du mainteneur du 10/09/2026 :
     *  masque visible ∧ ¬champ AMPLIFIÉ, à seuil plutôt qu'à dégradé. Distinct de
     *  `_stencilNocturne` : la couleur revient vite, la clarté du décor reste progressive. */
    this._stencilCouleur = null;
    this._stencilCouleurCtx = null;
    /** @type {number} Révision du champ dont le stencil couleur est issu. */
    this._stencilCouleurChampRev = -1;
    /** @type {any} Révision du masque visible dont le stencil couleur est issu. */
    this._stencilCouleurVisibleRev = null;
    /** @type {number} Compteur de reconstruction du stencil couleur, même convention que
     *  `_stencilRevisionCounter` ci-dessus. */
    this._stencilCouleurRevisionCounter = 0;
    /** @type {boolean} Ambiante pleine au dernier `update` : le stencil y serait vide. */
    this._pleineLumiere = false;
    /** @type {number} Sources peintes au dernier calcul, pour observation extérieure. */
    this.lastSourceCount = 0;
  }

  /**
   * Le canvas du champ lumineux, à la résolution du masque — ou `null` s'il n'existe pas
   * encore. C'est ce que le calcul de vision intersecte en mode tactique.
   *
   * ⚠ `null` n'est pas une erreur : au tout premier passage, le champ n'est pas encore
   * composé. Le consommateur doit alors se replier sur la ligne de vue entière, jamais sur
   * le noir — voir `composeVisibleMask`.
   *
   * @returns {any}
   */
  getFieldCanvas() {
    return this._field?.canvas ?? null;
  }

  /** Force le recalcul au prochain passage. */
  invalidate() {
    this._signature = '';
    this._modulationRevision = -1;
    this._voileRevision = -1;
    this._stencilChampRev = -1;
    this._champAmplifieRevision = -1;
    this._stencilCouleurChampRev = -1;
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

    // ⭐ **Une ambiante PLEINE ne balaie aucune source**, et c'est un invariant, pas un drapeau.
    //
    // À `ambientLevel >= 1` le champ est déjà uniformément blanc, et l'additif plafonné rend
    // toute source invisible : les composer reviendrait à payer un sweep par source — 185 sur
    // `testbig150` — pour un résultat que le remplissage a déjà écrit.
    //
    // ⛔ Cette condition portait sur `level.ambient.baked` jusqu'au 27/08/2026. Le drapeau de
    // Dungeon Alchemist vaut `true` en toutes circonstances : la garde ne s'appuie donc plus
    // sur lui mais sur la seule chose qui décide vraiment — le niveau d'ambiante.
    const pleineLumiere = (Number(level.ambient?.level) || 0) >= 1;
    this._pleineLumiere = pleineLumiere;
    const sources = pleineLumiere ? [] : collectLightSources(level, tokens || [], adaptateur);
    this.lastSourceCount = sources.length;

    const origine = adaptateur.mapFromCellPoint({ cellX: 0, cellY: 0 });
    const uneCase = adaptateur.mapFromCellPoint({ cellX: 1, cellY: 0 });
    const echelle = Math.hypot(uneCase.x - origine.x, uneCase.y - origine.y);

    // Extraction PARESSEUSE : on n'arrive ici que si la signature a changé. ⛔ Et pas du tout
    // sur une carte cuite, qui n'a aucune source à occlure.
    const segments = pleineLumiere ? [] : options.segments
      || (typeof options.extractSegments === 'function' ? options.extractSegments(level, adaptateur) : []);

    this._field.compose(sources, {
      ambientLevel: Number(level.ambient?.level) || 0,
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
   * ⭐ **Le stencil « vu sans lumière » y ajoute un plancher, APRÈS le champ, et c'est l'ordre
   * qui compte** : multiplier par du noir détruit le décor (§ci-dessus), et un plancher ajouté
   * AVANT le champ serait ensuite recouvert par lui là où le champ porte peu. Le stencil est
   * peint en `lighter` à l'opacité `LIGHT_NIGHT_VISION_FLOOR` — sa propre alpha (qui décroît
   * déjà avec l'éclairement, voir `_construireStencilNocturne`) fait que ce plancher s'estompe
   * de lui-même dans une pénombre plutôt que de basculer net.
   *
   * @param {any} mainCtx
   * @param {any} stencil Le stencil « vu sans lumière », ou `null` s'il n'y a rien à peindre.
   */
  _construireModulation(mainCtx, stencil) {
    const champ = this._field;
    if (!champ || !champ.canvas) return null;
    const stencilRev = stencil ? stencil.__stencilRevision : null;
    if (
      this._modulation &&
      this._modulationRevision === champ.revision &&
      this._modulationStencilRev === stencilRev
    ) {
      return this._modulation;
    }

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
    if (stencil) {
      ctx.globalAlpha = LIGHT_NIGHT_VISION_FLOOR;
      ctx.drawImage(stencil, 0, 0);
      ctx.globalAlpha = 1;
    }
    ctx.globalCompositeOperation = 'source-over';

    this._modulationRevision = champ.revision;
    this._modulationStencilRev = stencilRev;
    return this._modulation;
  }

  /**
   * Construit le stencil « vu sans lumière » : masque visible ∧ ¬champ lumineux (voir la
   * démonstration en tête de fichier). Gris opaque, réduit à la zone VUE (`destination-in`
   * sur le masque visible) puis rongé par ce que le champ éclaire (`destination-out` sur son
   * canvas) : il reste de l'alpha exactement là où c'est vu et non éclairé, et
   * **partiellement** dans une pénombre — c'est voulu, et c'est ce que ce stencil-ci doit
   * garder : `destination-out` retire de l'alpha proportionnellement à celle du champ, donc le
   * PLANCHER de luminosité qui le consomme (`_construireModulation`, `_construireVoile`)
   * s'estompe à mesure que la lumière monte au lieu de basculer net.
   *
   * ⛔ **Ne consomme plus la désaturation depuis le 10/09/2026.** Ronger par le champ BRUT
   * rendait la désaturation, elle aussi, proportionnelle — la plus grande partie d'un halo
   * restait grise (voir `LIGHT_COLOR_VISION_GAIN`, `core/constants.js`). La clarté du décor
   * doit rester progressive, mais la vision des couleurs a un SEUIL : c'est ce que
   * `_construireStencilCouleur` ci-dessous fournit désormais à `render`.
   *
   * En cache, à la résolution du masque, reconstruit seulement quand le champ OU la révision
   * du masque visible ont changé — même convention `__fogRevision` que `fogLayer.js`.
   *
   * @param {any} mainCtx
   * @param {any} visibleCanvas Le masque visible, à la résolution du masque (8 px/case).
   */
  _construireStencilNocturne(mainCtx, visibleCanvas) {
    const champ = this._field;
    if (!champ || !champ.canvas || !visibleCanvas) return null;

    const visibleRev = visibleCanvas.__fogRevision ?? visibleCanvas;
    if (
      this._stencilNocturne &&
      this._stencilChampRev === champ.revision &&
      this._stencilVisibleRev === visibleRev
    ) {
      return this._stencilNocturne;
    }

    if (
      !this._stencilNocturne ||
      this._stencilNocturne.width !== champ.maskWidth ||
      this._stencilNocturne.height !== champ.maskHeight
    ) {
      this._stencilNocturne = canvasHorsEcran(champ.maskWidth, champ.maskHeight, mainCtx, this._fabrique);
      if (this._stencilNocturne) {
        this._stencilNocturne.width = champ.maskWidth;
        this._stencilNocturne.height = champ.maskHeight;
        this._stencilNocturneCtx = this._stencilNocturne.getContext('2d');
      }
    }
    const ctx = this._stencilNocturneCtx;
    if (!ctx) return null;

    // Gris opaque — ici blanc : achromatique (R=G=B), ce qui compte est son ALPHA pour le
    // plancher et sa saturation NULLE pour la désaturation, jamais sa teinte exacte.
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, champ.maskWidth, champ.maskHeight);
    // Ne garde que la zone VUE.
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(visibleCanvas, 0, 0);
    // Ronge par ce que le champ éclaire.
    ctx.globalCompositeOperation = 'destination-out';
    ctx.drawImage(champ.canvas, 0, 0);
    ctx.globalCompositeOperation = 'source-over';

    this._stencilChampRev = champ.revision;
    this._stencilVisibleRev = visibleRev;
    this._stencilRevisionCounter += 1;
    this._stencilNocturne.__stencilRevision = this._stencilRevisionCounter;
    return this._stencilNocturne;
  }

  /**
   * Construit le champ AMPLIFIÉ — décision du mainteneur du 10/09/2026 : le champ lumineux
   * dessiné `LIGHT_COLOR_VISION_GAIN` fois sur lui-même en `lighter`, ce qui additionne son
   * alpha et le sature vite vers 1 (`alpha' = min(1, GAIN × alpha)`). Voir la constante,
   * `core/constants.js`, pour le tableau de chiffres qui justifie le gain.
   *
   * ⛔ **Sert UNIQUEMENT à ronger le stencil de désaturation** (`_construireStencilCouleur`
   * ci-dessous). Ni la modulation ni le voile n'en tiennent compte : le plancher de luminosité
   * continue de suivre le champ RÉEL, non amplifié — c'est la moitié de la séparation demandée
   * (clarté progressive, couleur à seuil).
   *
   * En cache, à la résolution du masque, reconstruit seulement quand le champ a changé — même
   * convention que les autres tampons de cette classe.
   *
   * @param {any} mainCtx
   * @returns {any}
   */
  _construireChampAmplifie(mainCtx) {
    const champ = this._field;
    if (!champ || !champ.canvas) return null;
    if (this._champAmplifie && this._champAmplifieRevision === champ.revision) {
      return this._champAmplifie;
    }

    if (
      !this._champAmplifie ||
      this._champAmplifie.width !== champ.maskWidth ||
      this._champAmplifie.height !== champ.maskHeight
    ) {
      this._champAmplifie = canvasHorsEcran(champ.maskWidth, champ.maskHeight, mainCtx, this._fabrique);
      if (this._champAmplifie) {
        this._champAmplifie.width = champ.maskWidth;
        this._champAmplifie.height = champ.maskHeight;
        this._champAmplifieCtx = this._champAmplifie.getContext('2d');
      }
    }
    const ctx = this._champAmplifieCtx;
    if (!ctx) return null;

    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, champ.maskWidth, champ.maskHeight);
    ctx.globalCompositeOperation = 'lighter';
    for (let passe = 0; passe < LIGHT_COLOR_VISION_GAIN; passe++) {
      ctx.drawImage(champ.canvas, 0, 0);
    }
    ctx.globalCompositeOperation = 'source-over';

    this._champAmplifieRevision = champ.revision;
    return this._champAmplifie;
  }

  /**
   * Construit le stencil de DÉSATURATION : masque visible ∧ ¬champ AMPLIFIÉ — décision du
   * mainteneur du 10/09/2026, jumeau de `_construireStencilNocturne` ci-dessus mais rongé par
   * le champ **amplifié** (`_construireChampAmplifie`) plutôt que par le champ brut.
   *
   * ⭐ **C'est ce qui rend la désaturation à SEUIL plutôt qu'à dégradé.** Le champ amplifié
   * sature vite vers 1, donc ce qu'il reste à ronger ici tombe vite à 0 : une pénombre à mi-
   * rayon (alpha brut 0,5) est déjà entièrement ôtée du stencil, donc entièrement en couleur.
   * Seule la frange extérieure du halo, où le champ amplifié n'a pas encore saturé, garde un
   * dégradé.
   *
   * ⛔ **Distinct de `_stencilNocturne`, et c'est voulu** : celui-ci ne nourrit QUE la
   * désaturation (`render`, passe `saturation`), jamais le plancher de luminosité — ronger le
   * plancher par le champ amplifié le ferait basculer net lui aussi, ce que le mainteneur n'a
   * pas demandé et que le §9.3 du chantier Z interdit désormais explicitement.
   *
   * En cache, à la résolution du masque, reconstruit seulement quand le champ OU la révision
   * du masque visible ont changé — même convention que `_construireStencilNocturne`.
   *
   * @param {any} mainCtx
   * @param {any} visibleCanvas Le masque visible, à la résolution du masque (8 px/case).
   */
  _construireStencilCouleur(mainCtx, visibleCanvas) {
    const champ = this._field;
    if (!champ || !champ.canvas || !visibleCanvas) return null;

    const champAmplifie = this._construireChampAmplifie(mainCtx);
    if (!champAmplifie) return null;

    const visibleRev = visibleCanvas.__fogRevision ?? visibleCanvas;
    if (
      this._stencilCouleur &&
      this._stencilCouleurChampRev === champ.revision &&
      this._stencilCouleurVisibleRev === visibleRev
    ) {
      return this._stencilCouleur;
    }

    if (
      !this._stencilCouleur ||
      this._stencilCouleur.width !== champ.maskWidth ||
      this._stencilCouleur.height !== champ.maskHeight
    ) {
      this._stencilCouleur = canvasHorsEcran(champ.maskWidth, champ.maskHeight, mainCtx, this._fabrique);
      if (this._stencilCouleur) {
        this._stencilCouleur.width = champ.maskWidth;
        this._stencilCouleur.height = champ.maskHeight;
        this._stencilCouleurCtx = this._stencilCouleur.getContext('2d');
      }
    }
    const ctx = this._stencilCouleurCtx;
    if (!ctx) return null;

    // Même construction que `_construireStencilNocturne` : gris opaque, réduit à la zone
    // VUE, puis rongé — ici par le champ AMPLIFIÉ, pas le brut.
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, champ.maskWidth, champ.maskHeight);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(visibleCanvas, 0, 0);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.drawImage(champAmplifie, 0, 0);
    ctx.globalCompositeOperation = 'source-over';

    this._stencilCouleurChampRev = champ.revision;
    this._stencilCouleurVisibleRev = visibleRev;
    this._stencilCouleurRevisionCounter += 1;
    this._stencilCouleur.__stencilRevision = this._stencilCouleurRevisionCounter;
    return this._stencilCouleur;
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
   *    ⛔ **Et il ne peut pas non plus désaturer.** La vidéo joue SOUS le canvas ; rien ici ne
   *    peut moduler la couleur de ses pixels, seulement l'opacité du voile posé par-dessus. Le
   *    voile peut donc porter le plancher de vision nocturne (une `destination-out`
   *    supplémentaire, à hauteur du plancher, qui l'éclaircit localement), mais jamais la
   *    désaturation — même limite que celle déjà consignée sur la teinte ci-dessus. Ne pas
   *    essayer de la contourner.
   *
   * @param {CanvasRenderingContext2D} ctx Contexte de scène, déjà transformé par la caméra
   * @param {any} adaptateur
   * @param {Level|null} level
   * @param {Object} [options]
   * @param {'gm'|'players'} [options.role]
   * @param {'play'|'prep'} [options.mode] Mode du panneau MJ (UX-03). ⚠ 'prep', pas
   *        'prepare' : c'est la valeur que `createGMPanel().getMode()` rend réellement.
   * @param {boolean} [options.suppressed] Le fond animé peint sous le canvas
   * @param {any} [options.visibleCanvas] Le masque visible courant (MJ : `visibleFogMap`,
   *        joueurs : `getPlayerVisibleCanvas`) — à la résolution du masque. Sans lui, aucun
   *        stencil « vu sans lumière » n'est construit : voir l'économie plus bas.
   * @returns {boolean} `true` si quelque chose a été peint
   */
  render(ctx, adaptateur, level, options = {}) {
    if (!ctx || !adaptateur || !level) return false;

    // ⛔ **La garde sur `baked` est retirée le 27/08/2026.**
    //
    // Elle disait : « une carte à l'éclairage cuit ignore la lumière et s'en remet au fog » —
    // décision du mainteneur du 26/08, prise quand nous croyions tous deux que le drapeau
    // portait une information. Relevé le lendemain sur les cinq exports réels : Dungeon
    // Alchemist écrit `baked_lighting: true` de jour comme de nuit et quel que soit le mode
    // d'export. L'honorer rendait donc l'éclairage inerte **partout et pour toujours**.
    //
    // ⭐ Ce qui la remplace ne coûte rien : à ambiante pleine, le champ est blanc, et un
    // `multiply` par du blanc laisse le décor **exactement intact**. Une carte de jour est donc
    // rendue à l'identique sans qu'aucun cas particulier ne le décide — et une carte réglée sur
    // Nuit s'assombrit, ce que le drapeau interdisait.

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

    // ⭐ Le MJ est assombri DEUX FOIS MOINS que la table — le rapport que le fog applique déjà
    // dans ses deux états depuis L-04. Sans cela, un donjon sans source rendrait sa vue
    // entièrement noire et il ne pourrait plus mener la partie. La table, elle, voit le noir.
    const attenuation = role === 'gm' ? LIGHT_GM_DARKNESS_RATIO : 1;

    // ⭐ Stencil « vu sans lumière ». ⛔ **Économie, et elle protège un invariant existant** :
    // à ambiante pleine ou sans masque visible fourni, le stencil serait vide de toute façon
    // (rien de non-éclairé, ou rien à y découper) — on ne le construit ni ne le peint. Sans
    // cette garde, le test « plein jour, décor intact, sans cas particulier » verrait passer
    // un stencil vide à chaque image pour rien.
    const stencil = (this._pleineLumiere || !options.visibleCanvas)
      ? null
      : this._construireStencilNocturne(ctx, options.visibleCanvas);

    // ⭐ Stencil de DÉSATURATION — décision du 10/09/2026, même économie que ci-dessus : à
    // ambiante pleine ou sans masque, il serait vide de toute façon. Distinct de `stencil`,
    // qui ne nourrit plus que le plancher de luminosité (voir `_construireStencilCouleur`).
    const stencilCouleur = (this._pleineLumiere || !options.visibleCanvas)
      ? null
      : this._construireStencilCouleur(ctx, options.visibleCanvas);

    if (options.suppressed) {
      // Voile : noir, d'opacité complémentaire à l'éclairement. `destination-out` retire du
      // noir opaque exactement ce que le champ apporte de lumière.
      const voile = this._construireVoile(ctx, stencil);
      if (!voile) return false;
      ctx.save();
      ctx.globalAlpha = attenuation;
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(voile, 0, 0, champ.maskWidth, champ.maskHeight, 0, 0, largeurCarte, hauteurCarte);
      ctx.restore();
      return true;
    }

    const modulation = this._construireModulation(ctx, stencil);
    if (!modulation) return false;

    ctx.save();
    ctx.globalAlpha = attenuation;
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(modulation, 0, 0, champ.maskWidth, champ.maskHeight, 0, 0, largeurCarte, hauteurCarte);
    ctx.restore();

    if (stencilCouleur) {
      // Désaturation, APRÈS le multiply : une seule passe. Un gris est de saturation NULLE,
      // donc la destination perd sa couleur en gardant sa luminance — exactement la
      // « vision nocturne en niveaux de gris » demandée. ⭐ Ce stencil-ci est rongé par le champ
      // AMPLIFIÉ (`LIGHT_COLOR_VISION_GAIN`), pas le brut — décision du 10/09/2026 : la
      // désaturation bascule à SEUIL plutôt que de s'estomper proportionnellement à
      // l'éclairement, seule la frange extérieure d'un halo garde un dégradé.
      ctx.save();
      ctx.globalAlpha = attenuation;
      ctx.globalCompositeOperation = 'saturation';
      ctx.drawImage(stencilCouleur, 0, 0, champ.maskWidth, champ.maskHeight, 0, 0, largeurCarte, hauteurCarte);
      ctx.restore();
    }
    return true;
  }

  /**
   * Tampon de voile : du noir dont l'opacité est le complément de l'éclairement.
   * Construit à la même cadence que la modulation — une fois par recomposition.
   *
   * ⭐ Le stencil, s'il y en a un, y ajoute une seconde `destination-out` à hauteur du
   * plancher : elle éclaircit le voile (donc la zone qu'il assombrit) exactement là où
   * c'est vu et non éclairé. ⛔ **Il ne peut porter que ça** — voir la limite consignée
   * dans `render`, chemin `suppressed` : rien ici ne peut désaturer une vidéo posée sous
   * le canvas.
   *
   * @param {any} mainCtx
   * @param {any} stencil Le stencil « vu sans lumière », ou `null`.
   */
  _construireVoile(mainCtx, stencil) {
    const champ = this._field;
    if (!champ || !champ.canvas) return null;
    const stencilRev = stencil ? stencil.__stencilRevision : null;
    if (
      this._voile &&
      this._voileRevision === champ.revision &&
      this._voileStencilRev === stencilRev
    ) {
      return this._voile;
    }

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
    if (stencil) {
      ctx.globalAlpha = LIGHT_NIGHT_VISION_FLOOR;
      ctx.drawImage(stencil, 0, 0);
      ctx.globalAlpha = 1;
    }
    ctx.globalCompositeOperation = 'source-over';

    this._voileRevision = champ.revision;
    this._voileStencilRev = stencilRev;
    return this._voile;
  }
}

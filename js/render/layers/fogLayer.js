// @ts-check

import {
  FOG_MASK_PX_PER_CELL,
  FOG_VEIL_GM_EXPLORED,
  FOG_VEIL_GM_UNEXPLORED,
  FOG_VEIL_PLAYER_EXPLORED,
  FOG_VEIL_PLAYER_UNEXPLORED,
  VISION_MAX_RANGE_CELLS,
} from '../../core/constants.js';
import { sweep } from '../../vision/sweep.js';

/** @typedef {import('../../core/types.js').Level} Level */
/** @typedef {import('../../core/types.js').Token} Token */
/** @typedef {import('../../core/types.js').MapPoint} MapPoint */
/** @typedef {import('../../core/types.js').Segment} Segment */
/** @typedef {import('../../grid/GridAdapter.js').GridAdapter} GridAdapter */

let computeCount = 0;

/**
 * Deux segments se croisent-ils ?
 *
 * Copie locale et volontaire du test de `js/import/blockedEdges.js` : la couche de rendu
 * n'a pas à dépendre de la couche d'import pour trois lignes d'arithmétique, et
 * `ARCHITECTURE.md` §2 tient à ce que ces dépendances restent lisibles.
 *
 * @param {MapPoint} a @param {MapPoint} b @param {MapPoint} c @param {MapPoint} d
 * @returns {boolean}
 */
function segmentsSeCroisent(a, b, c, d) {
  const orientation = (/** @type {MapPoint} */ p, /** @type {MapPoint} */ q, /** @type {MapPoint} */ r) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = orientation(c, d, a);
  const d2 = orientation(c, d, b);
  const d3 = orientation(a, b, c);
  const d4 = orientation(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/**
 * Compteur du nombre de recalculs réels de vision effectués (pour les tests).
 * @returns {number}
 */
export function getVisionComputeCount() {
  return computeCount;
}

/**
 * Réinitialise le compteur de recalculs de vision.
 * @returns {void}
 */
export function resetVisionComputeCount() {
  computeCount = 0;
}

/**
 * Génère la signature de mémoïsation incluant l'étage, les obstacles et les pions PJ porteurs de vision.
 *
 * @param {Level} level
 * @param {Token[]} tokens
 * @param {GridAdapter} grid
 * @returns {string}
 */
function buildVisionSignature(level, tokens, grid) {
  if (!level) return '';

  /** @type {string[]} */
  const parts = [`level:${level.id || 'default'}`];
  // Les polygones sont en pixels carte. Un réimport qui garde le même id mais change la
  // densité, l'origine, la topologie ou les dimensions doit donc invalider le cache, même si
  // murs, pions et lumières conservent exactement les mêmes coordonnées en cases.
  const gridOrigin = grid.mapFromCellPoint({ cellX: 0, cellY: 0 });
  const gridAxisA = grid.mapFromCellPoint({ cellX: 1, cellY: 0 });
  const gridAxisB = grid.mapFromCellPoint({ cellX: 0, cellY: 1 });
  parts.push(
    `grid:type=${level.grid?.type}:hex=${level.grid?.hexOrientation}:` +
    `map=${gridOrigin.x},${gridOrigin.y}|${gridAxisA.x},${gridAxisA.y}|${gridAxisB.x},${gridAxisB.y}:` +
    `size=${level.widthCells}x${level.heightCells}`
  );
  // Modèle binaire : une ambiante non nulle éclaire l'étage ; baked force ce même état pour
  // éviter d'assombrir une image dont la lumière est déjà peinte.
  const ambientLit = Boolean(level.ambient?.baked) || Number(level.ambient?.level) > 0;
  parts.push(`ambient:${ambientLit ? 'lit' : 'dark'}:level=${level.ambient?.level}:baked=${level.ambient?.baked}`);

  if (Array.isArray(level.walls)) {
    for (let i = 0; i < level.walls.length; i++) {
      const poly = level.walls[i];
      if (Array.isArray(poly)) {
        for (let j = 0; j < poly.length; j++) {
          const p = poly[j];
          if (p) parts.push(`w:${p.cellX},${p.cellY}`);
        }
      }
    }
  }

  if (Array.isArray(level.portals)) {
    for (let i = 0; i < level.portals.length; i++) {
      const p = level.portals[i];
      if (p) {
        parts.push(`p:${p.id}:${p.a?.cellX},${p.a?.cellY}-${p.b?.cellX},${p.b?.cellY}:${p.closed}:${p.state}`);
      }
    }
  }

  const levelLights = Array.isArray(level.lights) ? [...level.lights] : [];
  levelLights.sort((a, b) => String(a?.id).localeCompare(String(b?.id)));
  for (const light of levelLights) {
    if (!light) continue;
    parts.push(
      `l:${light.id}:at=${light.at?.cellX},${light.at?.cellY}:range=${light.range}:intensity=${light.intensity}:color=${light.color}:shadows=${light.shadows}`
    );
  }

  const pcTokens = tokens.filter(
    (t) =>
      t &&
      t.levelId === level.id &&
      t.kind === 'pc' &&
      (ambientLit || (typeof t.visionDim === 'number' && t.visionDim > 0))
  );
  pcTokens.sort((a, b) => a.id.localeCompare(b.id));

  for (const t of pcTokens) {
    const size = Math.max(1, t.sizeCells || 1);
    parts.push(
      `t:${t.id}:kind=${t.kind}:lvl=${t.levelId}:cell=${t.cell?.a},${t.cell?.b}:size=${size}:vDim=${t.visionDim}`
    );
    if (t.move) {
      parts.push(`m:${t.move.from?.a},${t.move.from?.b}->${t.move.to?.a},${t.move.to?.b}:${t.move.startedAt}`);
    }
  }

  const emittingTokens = tokens.filter(
    (t) => t && t.levelId === level.id && Number(t.emitsLight?.range) > 0
  );
  emittingTokens.sort((a, b) => a.id.localeCompare(b.id));
  for (const t of emittingTokens) {
    const size = Math.max(1, t.sizeCells || 1);
    parts.push(
      `light-token:${t.id}:cell=${t.cell?.a},${t.cell?.b}:size=${size}:range=${t.emitsLight?.range}:intensity=${t.emitsLight?.intensity}:color=${t.emitsLight?.color}`
    );
  }

  return parts.join(';');
}

/**
 * L'ambiante est binaire, et c'est ici que ça se décide : toute valeur strictement positive donne
 * la visibilité « éclairée », zéro laisse uniquement les portées de vision dans le noir et les
 * sources. `baked` force l'état éclairé sans modifier les données importées.
 *
 * ⭐ **Exporté depuis UX-07** : le panneau MJ n'offre plus qu'une bascule à deux états, parce que
 * ce prédicat est tout ce que le moteur distingue — le curseur à 21 crans promettait 21 rendus
 * dont 20 étaient identiques. La lecture reste tolérante aux valeurs fractionnaires des campagnes
 * enregistrées ; seule l'écriture est devenue binaire.
 *
 * @param {Level} level
 */
export function isAmbientLit(level) {
  return Boolean(level?.ambient?.baked) || Number(level?.ambient?.level) > 0;
}

/** @param {number|undefined} range */
function cappedRange(range) {
  return Math.min(Math.max(0, Number(range) || 0), VISION_MAX_RANGE_CELLS);
}

/**
 * Fabrique d'élément canvas hors écran autonome.
 *
 * @param {number} width
 * @param {number} height
 * @param {CanvasRenderingContext2D} mainCtx
 * @param {((w: number, h: number) => any)} [factory]
 * @returns {any}
 */
function createOffscreenCanvas(width, height, mainCtx, factory) {
  if (typeof factory === 'function') {
    return factory(width, height);
  }
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  if (mainCtx?.canvas?.ownerDocument?.createElement) {
    const canvas = mainCtx.canvas.ownerDocument.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  return null;
}

/**
 * Opacité à peindre à l'étape A pour que le voile des zones **jamais explorées** vaille
 * exactement `veilUnexplored` une fois l'étape B passée.
 *
 * ⚠ L'étape B pose le voile exploré **sous** ce qui reste de l'étape A (`destination-over`).
 * Dans les zones jamais explorées, où l'étape A n'a rien effacé, les deux voiles
 * s'additionnent au lieu de se remplacer : peindre directement l'opacité visée affiche
 * `1−(1−U)(1−E)`. C'est ce qui rendait la vue MJ bien plus opaque que ses propres valeurs ne
 * le disaient — 0,70 et 0,45 donnaient un voile réel de 0,835, et la zone non découverte était
 * illisible. On ne peint donc que le **complément**.
 *
 * Sans masque exploré, l'étape B n'a pas lieu : la valeur visée se peint telle quelle. Et côté
 * joueurs, `U` vaut 1, donc le complément vaut 1 aussi : rien ne change.
 *
 * ⭐ **Extraite de `render()` le 23/08/2026 pour être testable.** Elle y vivait en ligne, donc
 * hors de portée d'un test unitaire : sa seule garde était `tests/fogVeil.spec.mjs`, un e2e. Or
 * c'est un jugement purement arithmétique et reproductible — il a sa place dans la porte, pas
 * dans un test navigateur qui mesure aussi la machine.
 *
 * @param {number} veilUnexplored Opacité visée pour « jamais exploré »
 * @param {number} veilExplored Opacité du voile « exploré hors vision »
 * @param {boolean} aMasqueExplore Un masque exploré est-il fourni ? (sinon l'étape B n'a pas lieu)
 * @returns {number} L'opacité à peindre à l'étape A
 */
export function alphaNonExplore(veilUnexplored, veilExplored, aMasqueExplore) {
  if (!aMasqueExplore || veilExplored >= 1) return veilUnexplored;
  return Math.max(0, (veilUnexplored - veilExplored) / (1 - veilExplored));
}

/**
 * Couche de rendu du masque de fog / voile de vision à trois états (L-04).
 */
export class FogLayer {
  /**
   * @param {{ createOffscreenCanvas?: (w: number, h: number) => any }} [options]
   */
  constructor(options = {}) {
    /** @type {string} */
    this._lastSignature = '';
    /** @type {MapPoint[][]} */
    this._cachedPolygons = [];
    /** @type {any} */
    this._offscreenCanvas = null;
    /** @type {CanvasRenderingContext2D|null} */
    this._offscreenCtx = null;
    /** @type {((w: number, h: number) => any)|undefined} */
    this._offscreenFactory = options.createOffscreenCanvas;
    /**
     * Empreinte de la dernière composition faite dans `_offscreenCanvas`, pour ne
     * recomposer que quand quelque chose que la porte ci-dessous liste a changé. Voir
     * `render()`, étape « composition » — `null` tant que rien n'a encore été composé.
     * @type {{exploredCanvas: any, exploredRev: any, visibleCanvas: any, visibleRev: any,
     *   polygons: MapPoint[][], maskWidth: number, maskHeight: number,
     *   veilUnexplored: number, veilExplored: number}|null}
     */
    this._composeCache = null;
  }

  /**
   * Efface le cache de calcul interne.
   */
  invalidate() {
    this._lastSignature = '';
    this._cachedPolygons = [];
    this._composeCache = null;
  }

  /**
   * Retourne les polygones de vision actuellement mis en cache.
   * @returns {MapPoint[][]}
   */
  getVisiblePolygons() {
    return this._cachedPolygons;
  }

  /**
   * Signature de la vision courante, pour que l'appelant sache si elle a changé
   * **sans avoir à encoder le masque pour s'en apercevoir**.
   *
   * Sans elle, la publication encodait un PNG à chaque image — `getImageData` plus
   * deflate, environ 6 ms sur la grande carte — avant de constater que la chaîne
   * produite était identique à la précédente. Comparer la signature coûte une
   * comparaison de chaînes ; comparer le PNG coûtait tout l'encodage.
   *
   * @returns {string}
   */
  getVisionSignature() {
    return this._lastSignature;
  }

  /**
   * Recalcule la vision courante si elle a changé, **sans rien dessiner**.
   *
   * ⚠ Ce calcul ne doit surtout pas rester prisonnier du rendu. Côté MJ il est
   * autoritaire : c'est lui qui alimente le masque publié aux tablettes. Tant qu'il ne
   * vivait que dans `render()`, un onglet MJ caché, occulté ou minimisé — le navigateur
   * suspend alors `requestAnimationFrame` — cessait de recalculer la vision, et le fog
   * de toutes les tablettes restait figé jusqu'au retour de la fenêtre au premier plan.
   * Mesuré : privé de frames, le MJ ne publiait plus aucun `vision.update`.
   *
   * La mémoïsation par signature est conservée : appeler cette méthode à chaque mutation
   * du store coûte une construction de chaîne quand rien de visuel n'a bougé.
   *
   * @param {GridAdapter} grid
   * @param {Level|null} level
   * @param {Token[]} tokens
   * @param {Object} [options]
   * @param {Segment[]} [options.segments]
   * @param {(lvl: Level, g: GridAdapter) => Segment[]} [options.extractSegments]
   * @returns {boolean} true si la vision a réellement été recalculée
   */
  updateVision(grid, level, tokens, options = {}) {
    if (!grid || !level) return false;

    const signature = buildVisionSignature(level, tokens || [], grid);
    if (signature === this._lastSignature) return false;
    this._lastSignature = signature;
    computeCount++;

    const ambientLit = isAmbientLit(level);
    const pcTokens = (tokens || []).filter((t) => t && t.levelId === level.id && t.kind === 'pc');
    const levelLights = Array.isArray(level.lights) ? level.lights : [];
    const emittingTokens = (tokens || []).filter(
      (t) => t && t.levelId === level.id && cappedRange(t.emitsLight?.range) > 0
    );

    // Sans PJ sur l'étage, rien n'est visible — mais ⚠ **ce n'est pas cette ligne qui le
    // garantit**, c'est `vuParUnPJ` dans `addSource` : sans observateur, aucune source ne
    // trouve de ligne de vue et le résultat est vide de toute façon. Vérifié par mutation,
    // supprimer ce bloc ne change aucun comportement.
    //
    // Il reste parce qu'il évite de balayer 94 sources pour jeter le résultat. C'est une
    // optimisation, et elle doit être lue comme telle.
    if (pcTokens.length === 0) {
      this._cachedPolygons = [];
      return true;
    }

    /** @type {Segment[]} */
    const segments =
      options.segments ||
      (typeof options.extractSegments === 'function' ? options.extractSegments(level, grid) : []);

    const origin0 = grid.mapFromCellPoint({ cellX: 0, cellY: 0 });

    /** @type {MapPoint[][]} */
    const polygons = [];
    // Une ambiante active laisse chaque PJ voir jusqu'au plafond technique. Dans le noir, sa
    // portée propre (`visionDim`) est conservée : c'est la vision nocturne déclarée par le pion.
    for (const t of pcTokens) {
      const rangeCells = ambientLit ? VISION_MAX_RANGE_CELLS : cappedRange(t.visionDim ?? 0);
      if (rangeCells <= 0) continue;

      const originR = grid.mapFromCellPoint({ cellX: rangeCells, cellY: 0 });
      const rangePx = Math.hypot(originR.x - origin0.x, originR.y - origin0.y);

      const size = Math.max(1, t.sizeCells || 1);
      const centerPoint = grid.mapFromCellPoint({
        cellX: t.cell.a + size / 2,
        cellY: t.cell.b + size / 2,
      });

      const poly = sweep(centerPoint, segments, rangePx);
      if (Array.isArray(poly) && poly.length > 0) {
        polygons.push(poly);
      }
    }

    // Les sources fixes UVTT et les torches portées sont des disques de visibilité additionnels.
    // Elles passent toutes par le même sweep que les PJ : murs et portes fermées restent donc des
    // obstacles identiques, sans lecture de pixels ni travail dépendant de rAF.
    //
    // ⭐ **Mais une lumière n'est pas un œil.** Jusqu'au 11/08/2026 elles étaient ajoutées sans
    // condition : une carte Dungeon Alchemist — qui en place systématiquement — se dévoilait
    // donc toute seule, **sans le moindre pion sur le plateau**. Constaté en séance sur
    // `testvideo-3` : quatre lampes dans une tour, et des cônes de vision projetés à travers
    // ses portes alors que personne n'était là pour regarder.
    //
    // La règle correcte, et c'est celle du mainteneur : l'éclairage **aide les joueurs à voir
    // plus loin**, il ne révèle rien par lui-même. Une source ne contribue donc que si un PJ
    // a une ligne de vue dégagée jusqu'à elle. Sans PJ sur l'étage, rien n'est visible.
    //
    // ⚠ **Approximation assumée, et décision ouverte — CdC §12 question 9.** Le test porte sur
    // le **centre** de la source : voir la lampe révèle tout son halo, y compris ce que le PJ
    // ne verrait pas lui-même. La version stricte croiserait les polygones ; son coût est
    // chiffré dans le CdC, ainsi que le déclencheur pour y revenir.
    const centresPJ = pcTokens.map((t) => {
      const size = Math.max(1, t.sizeCells || 1);
      return grid.mapFromCellPoint({ cellX: t.cell.a + size / 2, cellY: t.cell.b + size / 2 });
    });

    /**
     * Un PJ voit-il ce point ? Test de segment dégagé, pas de sweep : c'est une question
     * binaire, et la poser 6 × 94 fois coûte moins qu'un seul balayage.
     *
     * @param {MapPoint} point
     */
    const vuParUnPJ = (point) => {
      for (const centre of centresPJ) {
        let bloque = false;
        for (const s of segments) {
          if (segmentsSeCroisent(centre, point, s.p1, s.p2)) { bloque = true; break; }
        }
        if (!bloque) return true;
      }
      return false;
    };

    /**
     * @param {import('../../core/types.js').CellPoint|undefined} at
     * @param {number|undefined} range
     */
    const addSource = (at, range) => {
      const rangeCells = cappedRange(range);
      if (!at || !Number.isFinite(at.cellX) || !Number.isFinite(at.cellY) || rangeCells <= 0) return;
      const centerPoint = grid.mapFromCellPoint(at);
      // Personne pour la voir : la source éclaire peut-être, mais elle ne révèle rien.
      if (!vuParUnPJ(centerPoint)) return;
      const originR = grid.mapFromCellPoint({ cellX: rangeCells, cellY: 0 });
      const rangePx = Math.hypot(originR.x - origin0.x, originR.y - origin0.y);
      const poly = sweep(centerPoint, segments, rangePx);
      if (Array.isArray(poly) && poly.length > 0) polygons.push(poly);
    };

    for (const light of levelLights) addSource(light?.at, light?.range);
    for (const t of emittingTokens) {
      const size = Math.max(1, t.sizeCells || 1);
      addSource({ cellX: t.cell.a + size / 2, cellY: t.cell.b + size / 2 }, t.emitsLight?.range);
    }
    this._cachedPolygons = polygons;
    return true;
  }

  /**
   * Rendu du voile à trois états (vu maintenant, exploré-hors-vision, jamais exploré).
   *
   * @param {CanvasRenderingContext2D} ctx Contexte de scène principal
   * @param {GridAdapter} grid Adaptateur de grille
   * @param {Level|null} level Étage actif
   * @param {Token[]} tokens Liste des pions
   * @param {Object} [options]
   * @param {'gm'|'players'} [options.role] Rôle d'affichage ('gm' ou 'players')
   * @param {any} [options.exploredCanvas] Canvas du masque exploré (8 px/case)
   * @param {any} [options.visibleCanvas] Canvas du masque de vision courante (8 px/case)
   * @param {MapPoint[][]} [options.visiblePolygons] Polygones de vision transmis si calculés ailleurs
   * @param {Segment[]} [options.segments] Segments d'obstacles pré-extraits
   * @param {(lvl: Level, g: GridAdapter) => Segment[]} [options.extractSegments] Injecteur d'extraction
   */
  render(ctx, grid, level, tokens, options = {}) {
    if (!ctx || !grid || !level) return;

    const role = options.role || 'gm';
    const isPlayer = role === 'players';

    // 1. Calcul / mise à jour des polygones de vision courante (Mac / GM autoritaire).
    // Le calcul lui-même vit dans `updateVision`, que le MJ appelle aussi hors rendu.
    if (options.visiblePolygons) {
      this._cachedPolygons = options.visiblePolygons;
    } else if (role === 'gm') {
      this.updateVision(grid, level, tokens, options);
    }

    const bottomRight = grid.mapFromCellPoint({
      cellX: level.widthCells,
      cellY: level.heightCells,
    });
    const mapWidth = Math.ceil(bottomRight.x);
    const mapHeight = Math.ceil(bottomRight.y);

    if (mapWidth <= 0 || mapHeight <= 0) return;

    // Le tampon de composition travaille à la résolution du masque (8 px/case), pas à
    // celle de la carte — c'est tout le sujet de cette tranche
    // (BRIEF-FOG-BASSE-RESOLUTION.md) : les masques exploré et visible sont déjà à cette
    // résolution, et le composer à la taille de la carte ne faisait qu'étirer deux fois
    // un contenu de 520×568 vers un tampon 200 fois plus grand, balayé deux à trois fois
    // par image. Un seul agrandissement reste nécessaire, à l'étape D, une fois par image.
    const maskWidth = Math.max(1, Math.round(level.widthCells * FOG_MASK_PX_PER_CELL));
    const maskHeight = Math.max(1, Math.round(level.heightCells * FOG_MASK_PX_PER_CELL));

    if (
      !this._offscreenCanvas ||
      this._offscreenCanvas.width !== maskWidth ||
      this._offscreenCanvas.height !== maskHeight
    ) {
      this._offscreenCanvas = createOffscreenCanvas(maskWidth, maskHeight, ctx, this._offscreenFactory);
      if (this._offscreenCanvas) {
        this._offscreenCtx = this._offscreenCanvas.getContext('2d');
      }
      // Le tampon change de taille ⇒ tout ce qu'il portait est perdu, même si rien
      // d'autre n'a bougé : le cache de composition ne peut plus être valide.
      this._composeCache = null;
    }

    const offCtx = this._offscreenCtx;
    if (!offCtx || !this._offscreenCanvas) return;

    // Opacités visées selon la vue (CdC §5.6 / L-04 §7). Elles se règlent dans
    // `core/constants.js`, où le lien entre elles est documenté — vue MJ : trois états
    // qui doivent rester discernables ; vue joueurs : opacité pleine qui masque les pions.
    const veilUnexplored = isPlayer ? FOG_VEIL_PLAYER_UNEXPLORED : FOG_VEIL_GM_UNEXPLORED;
    const veilExplored = isPlayer ? FOG_VEIL_PLAYER_EXPLORED : FOG_VEIL_GM_EXPLORED;

    // ⚠ L'étape B pose le voile exploré **sous** ce qui reste de l'étape A
    // (`destination-over`). Dans les zones jamais explorées, où l'étape A n'a rien
    // effacé, les deux voiles s'additionnent donc au lieu de se remplacer : peindre
    // l'étape A directement à l'opacité visée affichait `1-(1-U)(1-E)`. C'est ce qui
    // rendait la vue MJ bien plus opaque que ses propres valeurs ne le disaient —
    // 0,70 et 0,45 donnaient un voile réel de 0,835, et la zone non découverte était
    // illisible. On ne peint ici que le **complément**, pour que la somme vaille U.
    //
    // Sans masque exploré, l'étape B n'a pas lieu : la valeur visée se peint telle
    // quelle. Et côté joueurs, U vaut 1 : le complément vaut 1 aussi, rien ne change.
    const unexploredAlpha = alphaNonExplore(veilUnexplored, veilExplored, Boolean(options.exploredCanvas));

    // Le masque exploré et le masque visible sont mutables **en place** : `reveal()`,
    // `paintDisc()` etc. (`js/vision/fog.js`) dessinent sur le même objet canvas d'un
    // appel à l'autre, sans jamais changer sa référence. Comparer les seules références
    // laisserait donc le cache figé sur le premier fog révélé — exactement le défaut que
    // le brief interdit. `__fogRevision` est l'estampille que `ExploredFog` pose sur son
    // canvas à chaque mutation ; à défaut (masque construit autrement, p.ex. décodé d'un
    // PNG reçu par la vue joueurs — un nouvel objet à chaque changement), la référence
    // seule suffit puisqu'elle change alors avec le contenu.
    const exploredRev = options.exploredCanvas
      ? options.exploredCanvas.__fogRevision ?? options.exploredCanvas
      : null;
    const visibleRev = options.visibleCanvas
      ? options.visibleCanvas.__fogRevision ?? options.visibleCanvas
      : null;

    const cache = this._composeCache;
    const cacheValide =
      cache !== null &&
      cache.exploredCanvas === options.exploredCanvas &&
      cache.exploredRev === exploredRev &&
      cache.visibleCanvas === options.visibleCanvas &&
      cache.visibleRev === visibleRev &&
      cache.polygons === this._cachedPolygons &&
      cache.maskWidth === maskWidth &&
      cache.maskHeight === maskHeight &&
      cache.veilUnexplored === veilUnexplored &&
      cache.veilExplored === veilExplored;

    if (!cacheValide) {
      offCtx.save();
      offCtx.clearRect(0, 0, maskWidth, maskHeight);

      // Étape A : Remplir tout le canvas avec le voile non exploré
      offCtx.fillStyle = `rgba(0, 0, 0, ${unexploredAlpha})`;
      offCtx.fillRect(0, 0, maskWidth, maskHeight);

      // Étape B : Si le masque exploré existe, remplacer le voile non exploré par le voile exploré
      if (options.exploredCanvas) {
        // Effacer le voile non exploré dans les zones explorées avec destination-out
        offCtx.globalCompositeOperation = 'destination-out';
        offCtx.drawImage(options.exploredCanvas, 0, 0, maskWidth, maskHeight);

        // Appliquer le voile exploré dans ces zones libérées
        offCtx.globalCompositeOperation = 'destination-over';
        offCtx.fillStyle = `rgba(0, 0, 0, ${veilExplored})`;
        offCtx.fillRect(0, 0, maskWidth, maskHeight);
      }

      // Étape C : Percer le masque de vision courante (visible) avec destination-out
      if (options.visibleCanvas) {
        offCtx.globalCompositeOperation = 'destination-out';
        offCtx.drawImage(options.visibleCanvas, 0, 0, maskWidth, maskHeight);
      } else if (this._cachedPolygons.length > 0) {
        offCtx.globalCompositeOperation = 'destination-out';
        offCtx.beginPath();

        // Piège n°1 (BRIEF-FOG-BASSE-RESOLUTION.md §3) : ces polygones sont en pixels
        // carte (`MapPoint`), tracés ici tels quels ils seraient 17,5× trop grands à
        // 140 px/case. Même conversion que `ExploredFog.reveal()` : l'origine de
        // l'étage et l'échelle de la grille ramènent chaque point à l'espace du masque.
        const origin0 = grid.mapFromCellPoint({ cellX: 0, cellY: 0 });
        const origin1 = grid.mapFromCellPoint({ cellX: 1, cellY: 0 });
        const gridScale = Math.abs(origin1.x - origin0.x);
        const scale = FOG_MASK_PX_PER_CELL / Math.max(1, gridScale);

        for (const poly of this._cachedPolygons) {
          if (!poly || poly.length === 0) continue;
          const first = poly[0];
          offCtx.moveTo((first.x - origin0.x) * scale, (first.y - origin0.y) * scale);
          for (let i = 1; i < poly.length; i++) {
            const pt = poly[i];
            offCtx.lineTo((pt.x - origin0.x) * scale, (pt.y - origin0.y) * scale);
          }
          offCtx.closePath();
        }

        offCtx.fillStyle = '#000000';
        offCtx.fill();
      }

      offCtx.restore();

      this._composeCache = {
        exploredCanvas: options.exploredCanvas,
        exploredRev,
        visibleCanvas: options.visibleCanvas,
        visibleRev,
        polygons: this._cachedPolygons,
        maskWidth,
        maskHeight,
        veilUnexplored,
        veilExplored,
      };
    }

    // Étape D : Déposer le voile final à trois états sur le contexte de scène en
    // source-over — le seul agrandissement de tout ce chemin, qu'il y ait eu
    // recomposition ou non.
    ctx.drawImage(this._offscreenCanvas, 0, 0, mapWidth, mapHeight);
  }
}

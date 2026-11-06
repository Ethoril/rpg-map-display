// @ts-check

import { getOrExtractMaskAlpha, isCellVisibleInMask } from '../../vision/fog.js';
import {
  TOKEN_BORDER_SCREEN_PX,
  TOKEN_SELECTION_RING_SCREEN_PX,
  TOKEN_SELECTION_OFFSET_SCREEN_PX,
} from '../../core/constants.js';
import {
  computeElevationBadgeLayout,
  drawStatusBadges,
  computeHpBadgeLayout,
  computeCopyBadgeLayout,
} from '../statusBadges.js';
import {
  CAMP_FILL,
  DEAD_RING_COLOR,
  MedallionCache,
  enamelLightOf,
  linkedTint,
  medallionFrameOf,
  medallionLayout,
  wantsMedallion,
} from '../medallion.js';

export { CAMP_FILL } from '../medallion.js';

const TOKEN_IMAGE_CACHE_LIMIT = 64;
export const TOKEN_MOVE_STEP_MS = 160;

/**
 * @typedef {import('../../core/types.js').Token} Token
 * @typedef {import('../../core/types.js').Cell} Cell
 * @typedef {import('../../grid/GridAdapter.js').GridAdapter} GridAdapter
 * @typedef {'loading'|'ready'|'error'} ImageStatus
 * @typedef {{
 *   status: ImageStatus,
 *   image: HTMLImageElement|null,
 *   error: Error|null,
 *   promise: Promise<void>
 * }} TokenImageEntry
 *
 * @typedef {{
 *   tokenId?: string|null,
 *   selectedTokenId?: string|null
 * }} SelectionOption
 *
 * @typedef {{
 *   role?: 'gm'|'players',
 *   isGM?: boolean,
 *   isPlayerView?: boolean,
 *   activeLevelId: string,
 *   now?: number,
 *   dragPreview?: { tokenId: string, mapPos: import('../../core/types.js').MapPoint }|null,
 *   visibleCanvas?: any,
 *   visibleAlpha?: Uint8Array|null,
 *   visionPublished?: boolean,
 *   activeLevelWidthCells?: number,
 *   activeLevelHeightCells?: number,
 *   zoom?: number,
 *   resolution?: number,
 *   invalidate?: () => void
 * }} RenderOptions
 */

/** @param {unknown} value @returns {Error} */
function asError(value) {
  return value instanceof Error ? value : new Error('Impossible de charger l’image du pion');
}

/** @param {Cell} a @param {Cell} b @param {number} ratio */
function interpolateCell(a, b, ratio) {
  return {
    cellX: a.a + (b.a - a.a) * ratio,
    cellY: a.b + (b.b - a.b) * ratio,
  };
}

/**
 * Calcule une position purement déterministe depuis les données réseau.
 *
 * @param {Token} token
 * @param {number} now
 * @returns {{ cellX: number, cellY: number, active: boolean }}
 */
function tokenPosition(token, now) {
  const move = token.move;
  if (!move || !Number.isFinite(move.startedAt)) {
    return { cellX: token.cell.a, cellY: token.cell.b, active: false };
  }

  /** @type {Cell[]} */
  const path = Array.isArray(move.path) && move.path.length > 0
    ? move.path
    : [move.from, move.to];
  if (path.length < 2) {
    return { cellX: token.cell.a, cellY: token.cell.b, active: false };
  }

  const elapsed = Math.max(0, now - move.startedAt);
  const duration = (path.length - 1) * TOKEN_MOVE_STEP_MS;
  if (elapsed >= duration) {
    return { cellX: move.to.a, cellY: move.to.b, active: false };
  }

  const progress = elapsed / TOKEN_MOVE_STEP_MS;
  const segment = Math.min(path.length - 2, Math.floor(progress));
  const ratio = Math.max(0, Math.min(1, progress - segment));
  return { ...interpolateCell(path[segment], path[segment + 1], ratio), active: true };
}

/**
 * Initiales d'un nom : deux lettres pour deux mots ou plus (premier et deuxième mot), une sinon.
 *
 * @param {string|undefined} label
 * @returns {string}
 */
export function campInitials(label) {
  // Seuls lettres et chiffres comptent : « Elysia (test) » → « ET ».
  const words = (label ?? '').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (words.length === 0) return '?';
  return words.slice(0, 2).map((w) => Array.from(w)[0]).join('').toUpperCase();
}

/**
 * Couleur du liseré d'un pion. Un pion lié prend la couleur propre du PJ (`color`, contrat §4) ou
 * la teinte de son camp : le liseré choisi à la main (`borderColor`) ne compte plus sur un pion
 * lié (décision du MJ, étude E1, lot P2). Sans camp, ou pion ordinaire : le liseré choisi. La
 * même couleur sert aux pastilles du panneau MJ.
 *
 * @param {Pick<Token, 'borderColor'|'link'|'camp'|'color'>} token
 * @returns {string}
 */
export function tokenRingColor(token) {
  const tint = token.link ? linkedTint(token) : undefined;
  return tint ?? (token.borderColor || '#ffffff');
}

/**
 * Marqueurs d'un pion monté (contrat de liaison §8.1) : ceux du cavalier et de sa monture réunis,
 * au plus haut des deux niveaux. Sans monture fusionnée, ceux du pion.
 *
 * @param {Token} token
 * @returns {{ markers: Token['markers'], markerLevels: Record<string, number>|undefined }}
 */
export function mergedMarkers(token) {
  const rider = token.rider;
  if (!rider) return { markers: token.markers ?? [], markerLevels: token.markerLevels };
  const markers = [...new Set([...(token.markers ?? []), ...rider.markers])];
  /** @type {Record<string, number>} */
  const markerLevels = { ...(token.markerLevels ?? {}) };
  for (const [id, level] of Object.entries(rider.markerLevels)) markerLevels[id] = Math.max(level, markerLevels[id] ?? 0);
  return { markers, markerLevels };
}

/** Part du diamètre du pion qu'occupe le médaillon du cavalier sur un pion monté (contrat §8.1). */
export const RIDER_MEDALLION_RATIO = 0.42;

/**
 * Rendu Canvas des pions, avec cache d'images borné et invalidation asynchrone.
 */
export class TokensLayer {
  /**
   * @param {{
   *   invalidate?: () => void,
   *   imageFactory?: () => HTMLImageElement,
   *   maxCacheEntries?: number,
   *   medallionImageFactory?: (() => import('../medallion.js').MedallionImage)|null,
   *   canvasFactory?: ((width: number, height: number) => import('../medallion.js').MedallionCanvas)|null
   * }} [options]
   */
  constructor(options = {}) {
    this.invalidate = options.invalidate ?? (() => {});
    this.imageFactory = options.imageFactory ?? (() => new Image());
    this.maxCacheEntries = Math.max(1, options.maxCacheEntries ?? TOKEN_IMAGE_CACHE_LIMIT);
    /** @type {Map<string, TokenImageEntry>} */
    this.imageCache = new Map();
    /** Cerclages des pions liés et leurs teintes, calculés une fois (lot P2). */
    this.medallions = new MedallionCache({
      invalidate: () => this.invalidate(),
      ...(options.medallionImageFactory !== undefined ? { imageFactory: options.medallionImageFactory } : {}),
      ...(options.canvasFactory !== undefined ? { canvasFactory: options.canvasFactory } : {}),
    });
  }

  /** @param {string} url @param {TokenImageEntry} entry */
  _remember(url, entry) {
    this.imageCache.delete(url);
    this.imageCache.set(url, entry);
    while (this.imageCache.size > this.maxCacheEntries) {
      const oldest = this.imageCache.keys().next().value;
      if (oldest !== undefined) this.imageCache.delete(oldest);
    }
  }

  /**
   * @param {string|null|undefined} imageUrl
   * @param {{ retry?: boolean }} [options]
   * @returns {Promise<void>}
   */
  preload(imageUrl, options = {}) {
    const url = imageUrl?.trim() ?? '';
    if (!url) return Promise.resolve();
    if (options.retry) this.imageCache.delete(url);

    const cached = this.imageCache.get(url);
    if (cached) {
      this._remember(url, cached);
      return cached.promise;
    }

    const image = this.imageFactory();
    /** @type {TokenImageEntry} */
    const entry = {
      status: 'loading',
      image: null,
      error: null,
      promise: Promise.resolve(),
    };
    entry.promise = new Promise((resolve) => {
      image.onload = () => {
        entry.status = 'ready';
        entry.image = image;
        this._remember(url, entry);
        this.invalidate();
        resolve();
      };
      image.onerror = (reason) => {
        entry.status = 'error';
        entry.error = asError(reason);
        this._remember(url, entry);
        this.invalidate();
        resolve();
      };
      image.src = url;
    });
    this._remember(url, entry);
    return entry.promise;
  }

  /** @param {string} url @returns {Promise<void>} */
  retry(url) {
    return this.preload(url, { retry: true });
  }

  /** @param {string|null|undefined} url @returns {'idle'|ImageStatus} */
  imageStatus(url) {
    if (!url) return 'idle';
    return this.imageCache.get(url)?.status ?? 'idle';
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {GridAdapter} grid
   * @param {Token[]} tokens
   * @param {SelectionOption|string|null} selection
   * @param {RenderOptions} options
   * @returns {{ renderedTokenIds: string[], animationActive: boolean }}
   */
  render(ctx, grid, tokens, selection, options) {
    const result = { renderedTokenIds: /** @type {string[]} */ ([]), animationActive: false };
    if (!ctx || !grid || !Array.isArray(tokens) || !options?.activeLevelId) return result;

    const selectedTokenId = typeof selection === 'string'
      ? selection
      : selection?.tokenId ?? selection?.selectedTokenId ?? null;
    const isPlayerView = options.role === 'players' || options.isPlayerView === true || (options.isGM === false);
    const now = options.now ?? Date.now();
    const visibleTokens = tokens.filter(
      (token) =>
        token?.levelId === options.activeLevelId &&
        !(isPlayerView && token.hidden)
    );

    // Filtrage discret pion par pion côté joueurs (Option A / CORRECTIF) :
    // Aucun canvas hors écran n'est alloué, aucune composition destination-in sur la carte complète.
    // Pour chaque pion, on vérifie si la case d'ancrage token.cell est vue dans le masque.
    let maskAlpha = null;
    if (isPlayerView && (options.visibleAlpha || options.visibleCanvas)) {
      if (options.visibleAlpha && options.visibleAlpha instanceof Uint8Array) {
        maskAlpha = options.visibleAlpha;
      } else if (options.visibleCanvas && options.activeLevelWidthCells && options.activeLevelHeightCells) {
        maskAlpha = getOrExtractMaskAlpha(options.visibleCanvas, options.activeLevelWidthCells, options.activeLevelHeightCells);
      }
    }

    // ⛔ **Aucune vision publiée pour cet étage : la vue joueurs n'y montre AUCUN pion.**
    //
    // Sans ce garde-fou, l'absence de masque ouvre la porte au lieu de la fermer — le filtre
    // ci-dessous ne s'applique que `if (maskAlpha)`. C'est sans conséquence tant que la tablette
    // suit l'étage du MJ, qui publie toujours la vision de l'étage qu'il regarde ; la fenêtre est
    // alors de quelques centaines de millisecondes au démarrage.
    //
    // Elle devient permanente dès que les joueurs peuvent choisir un étage **où aucun PJ ne se
    // trouve** (lot 3, sélecteur joueurs) : le MJ n'y calcule aucune vision, et la table verrait
    // alors tous les PNJ qui l'y attendent. L'arbitrage du mainteneur est explicite — sur un tel
    // étage, on montre « le dernier état connu, le fog tel qu'il était, et aucune zone de vision
    // directe ». Un pion est une information vive : il n'a pas sa place dans un souvenir.
    //
    // ⚠ Le drapeau est **explicite** et non déduit de `maskAlpha == null`, parce que les deux cas
    // sont indiscernables au niveau de la couche : un appelant qui ne passe simplement pas de
    // masque — rendu hors fog, contrôle de visibilité par rôle — doit garder l'ancien
    // comportement. Seule l'application joueurs sait qu'un masque était attendu.
    const aucuneVisionPubliee = isPlayerView && options.visionPublished === false;

    ctx.save();
    for (const token of visibleTokens) {
      if (!token.cell) continue;
      if (aucuneVisionPubliee) continue;

      if (isPlayerView && maskAlpha && options.activeLevelWidthCells && options.activeLevelHeightCells) {
        if (!isCellVisibleInMask(token.cell, maskAlpha, options.activeLevelWidthCells, options.activeLevelHeightCells, grid.type, grid.maskLatticeShift())) {
          continue;
        }
      }

      let position = tokenPosition(token, now);
      if (options.dragPreview?.tokenId === token.id) {
        const cellPoint = grid.cellPointFromMap(options.dragPreview.mapPos);
        const halfSize = Math.max(1, token.sizeCells || 1) / 2;
        position = {
          cellX: cellPoint.cellX - halfSize,
          cellY: cellPoint.cellY - halfSize,
          active: false,
        };
      }
      result.animationActive ||= position.active;
      result.renderedTokenIds.push(token.id);
      this._drawToken(ctx, grid, token, position, selectedTokenId === token.id, {
        ...options,
        isPlayerView,
      });
    }
    ctx.restore();

    return result;
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {GridAdapter} grid
   * @param {Token} token
   * @param {{cellX: number, cellY: number}} position
   * @param {boolean} selected
   * @param {RenderOptions} [options]
   */
  _drawToken(ctx, grid, token, position, selected, options) {
    const sizeCells = Math.max(1, token.sizeCells || 1);
    // G-1 : boîte englobante via l'API sans ambiguïté (`cellBounds`), jamais par différence
    // de deux `mapFromCellPoint` — c'est cette différence qui rendait les pions hexagonaux
    // faux selon la parité de rangée (docs/QUESTIONS-EN-ATTENTE.md, C-5).
    const bounds = grid.cellBounds(position, sizeCells);
    const p0 = { x: bounds.x, y: bounds.y };
    const width = bounds.width;
    const height = bounds.height;
    const centerX = p0.x + width / 2;
    const centerY = p0.y + height / 2;
    // Pion lié mort : liseré gris, comme son cerclage (lot P2).
    const borderColor = token.link && token.dead === true ? DEAD_RING_COLOR : tokenRingColor(token);
    // Pion monté (contrat §8.1) : le fond est la monture, le cavalier passe en médaillon.
    const mount = token.rider ?? null;
    const imageUrl = (mount ? mount.imageUrl : token.imageUrl)?.trim() ?? '';
    const discLabel = mount ? mount.label : token.label;
    const imageEntry = imageUrl ? this.imageCache.get(imageUrl) : undefined;
    if (imageUrl && !imageEntry) void this.preload(imageUrl);

    const zoom = options?.zoom && options.zoom > 0 ? options.zoom : 1;
    const resolution = options?.resolution && options.resolution > 0 ? options.resolution : 1;
    const isPlayerView = options?.isPlayerView === true;

    // ⛔ Plus aucune barre d'état autour du pion (01/10/2026, demande du mainteneur) : ni la
    // châsse du Chantier R (bande, arc de PV, anneau d'état, encoches), ni l'anneau fin de repli
    // du Chantier Q. Seul le cartouche chiffré reste. Le portrait reprend donc tout le rayon.
    // Ce code a été supprimé : la chasse est abandonnée pour de bon (lot P1, décision du MJ).
    // Le liseré se trace entièrement en dedans : centré sur le bord, il débordait à moitié dans
    // la case voisine, et dans son brouillard.
    // Médaillon d'un pion lié (lot P2, contrat §11) : le portrait se découpe dans la fenêtre du
    // cerclage ; sinon, ou tant que le cerclage n'est pas chargé, le disque simple.
    const medallion = this._medallionFor(token, width, zoom);
    const layout = medallion ? medallionLayout(medallion.frame, centerX, centerY, width) : null;
    const imageRadius = layout ? layout.windowRadius : width / 2 - TOKEN_BORDER_SCREEN_PX / (2 * zoom);

    // 1. Découpe & Dessin de l'illustration (réduite à imageRadius)
    ctx.save();
    if (token.hidden) ctx.globalAlpha = 0.45;
    ctx.beginPath();
    ctx.ellipse(centerX, centerY, imageRadius, imageRadius, 0, 0, Math.PI * 2);
    ctx.clip();

    // Fond émaillé du médaillon (variante B) : il se voit autour d'un personnage détouré.
    if (medallion?.enamel) {
      ctx.drawImage(
        /** @type {CanvasImageSource} */ (/** @type {unknown} */ (medallion.enamel)),
        centerX - imageRadius, centerY - imageRadius, imageRadius * 2, imageRadius * 2
      );
    }

    if (imageEntry?.status === 'ready' && imageEntry.image) {
      const image = imageEntry.image;
      const sourceWidth = image.naturalWidth || image.width;
      const sourceHeight = image.naturalHeight || image.height;
      // Médaillon : l'image couvre la fenêtre, pas la case.
      const boxWidth = medallion ? imageRadius * 2 : width;
      const boxHeight = medallion ? imageRadius * 2 : height;
      const scale = Math.max(boxWidth / sourceWidth, boxHeight / sourceHeight);
      const drawWidth = sourceWidth * scale;
      const drawHeight = sourceHeight * scale;
      ctx.drawImage(
        image,
        centerX - drawWidth / 2,
        centerY - drawHeight / 2,
        drawWidth,
        drawHeight
      );
    } else {
      const campFill = token.camp ? CAMP_FILL[token.camp] : undefined;
      // Sur le médaillon, les initiales se posent sur l'émail ; une image en erreur reste signalée.
      if (!medallion?.enamel || imageEntry?.status === 'error') {
        ctx.fillStyle = imageEntry?.status === 'error' ? '#5f2530' : (campFill ?? '#555d68');
        ctx.fillRect(p0.x, p0.y, width, height);
      }
      // Pion lié sans image (contrat §6) : initiales du nom, deux lettres pour deux mots ; sans
      // camp, la lettre unique d'avant.
      const initial = campFill ? campInitials(discLabel) : ((discLabel || token.kind || '?').trim().charAt(0).toUpperCase() || '?');
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${Math.max(12, Math.round(medallion ? imageRadius * 0.7 : Math.min(width, height) * 0.35))}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(initial, centerX, centerY);
    }
    // Rendu « mort » d'un pion lié (docs/CONTRAT-LIAISON-OUTIL-MJ.md §7) : portrait désaturé
    // puis assombri, dans la découpe du portrait. Le mode de fusion « saturation » retire la
    // couleur sans dépendre de `ctx.filter`, absent de certains Safari.
    if (token.dead === true) {
      ctx.globalCompositeOperation = 'saturation';
      ctx.fillStyle = '#808080';
      ctx.fillRect(p0.x, p0.y, width, height);
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
      ctx.fillRect(p0.x, p0.y, width, height);
    }
    ctx.restore();

    // 3.5. Liseré d'identité du pion (tracé à imageRadius, épaisseur écran TOKEN_BORDER_SCREEN_PX),
    // ou cerclage du médaillon, qui en tient lieu.
    const ringWidth = TOKEN_BORDER_SCREEN_PX / zoom;
    ctx.save();
    if (token.hidden) ctx.globalAlpha = 0.45;
    if (!medallion) {
      ctx.beginPath();
      ctx.ellipse(centerX, centerY, imageRadius, imageRadius, 0, 0, Math.PI * 2);
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = ringWidth;
      ctx.stroke();
    }
    // Pion monté (contrat §8.1) : deux anneaux, l'extérieur pour la monture (le liseré ci-dessus,
    // ou le cerclage du médaillon), l'intérieur, clair, pour le cavalier, séparés d'un filet
    // sombre. Deux anneaux de la même teinte de camp ne se distinguaient pas (contrôle à l'écran
    // du 05/11). Sur le médaillon, le filet sombre longe le bord de la fenêtre.
    if (mount) {
      const darkRadius = medallion ? imageRadius - ringWidth * 0.5 : imageRadius - ringWidth * 1.5;
      ctx.beginPath();
      ctx.ellipse(centerX, centerY, darkRadius, darkRadius, 0, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.lineWidth = ringWidth;
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(centerX, centerY, darkRadius - ringWidth, darkRadius - ringWidth, 0, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.lineWidth = ringWidth;
      ctx.stroke();
    }
    // Cerclage du médaillon : une toile déjà teinte (ou grise), posée d'un seul drawImage.
    if (medallion && layout) {
      ctx.drawImage(
        /** @type {CanvasImageSource} */ (/** @type {unknown} */ (medallion.canvas)),
        layout.frameX, layout.frameY, layout.frameSize, layout.frameSize
      );
    }
    ctx.restore();

    if (mount) this._drawRiderMedallion(ctx, token, p0, width, zoom, borderColor);

    // 3.6. Croix discrète du pion mort (contrat §7), épaisseur constante à l'écran.
    if (token.dead === true) {
      const arm = imageRadius * 0.5;
      ctx.save();
      if (token.hidden) ctx.globalAlpha = 0.45;
      ctx.beginPath();
      ctx.moveTo(centerX - arm, centerY - arm);
      ctx.lineTo(centerX + arm, centerY + arm);
      ctx.moveTo(centerX + arm, centerY - arm);
      ctx.lineTo(centerX - arm, centerY + arm);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.lineWidth = TOKEN_BORDER_SCREEN_PX / zoom;
      ctx.stroke();
      ctx.restore();
    }

    // 4. Anneau de sélection (Épaisseur constante à l'écran)
    if (selected) {
      const selectionRadius = (width / 2) + TOKEN_SELECTION_OFFSET_SCREEN_PX / zoom;
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(centerX, centerY, selectionRadius, selectionRadius, 0, 0, Math.PI * 2);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = TOKEN_SELECTION_RING_SCREEN_PX / zoom;
      ctx.stroke();
      ctx.restore();
    }

    // 5. Badges (élévation, marqueurs, compteur chiffré)
    if (typeof token.elevation === 'number' && token.elevation !== 0) {
      const { badgeX, badgeY, badgeRadiusMap, badgeRadiusScreen, visible } = computeElevationBadgeLayout(width, zoom);
      if (visible) {
        const cx = p0.x + badgeX;
        const cy = p0.y + badgeY;
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, badgeRadiusMap, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1 / zoom;
        ctx.stroke();
        ctx.font = `bold ${Math.max(9, Math.round(badgeRadiusScreen * 1.1)) / zoom}px sans-serif`;
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(token.elevation > 0 ? `+${token.elevation}` : `${token.elevation}`, cx, cy);
        ctx.restore();
      }
    }

    drawStatusBadges(ctx, mount ? { ...token, ...mergedMarkers(token) } : token, p0, {
      widthMap: width,
      zoom,
      resolution,
      invalidate: options?.invalidate ?? this.invalidate.bind(this),
    });

    // ── Compteur chiffré (Chantier Q §5.5 & §4 Qui voit quoi) ──────────────────────────────
    // Visible sur PJ pour tout le monde, sur PNJ pour la vue MJ uniquement.
    const canSeeHpDigits = token.kind === 'pc' || !isPlayerView;
    if (canSeeHpDigits && token.hp && typeof token.hp.current === 'number' && typeof token.hp.max === 'number') {
      const hpBadge = computeHpBadgeLayout(width, zoom, token.hp.current, token.hp.max);
      if (hpBadge.visible) {
        ctx.save();
        if (token.hidden) ctx.globalAlpha = 0.45;
        ctx.font = `bold ${hpBadge.fontSizeMap}px sans-serif`;
        const textMetrics = ctx.measureText(hpBadge.text);
        const textWidthMap = textMetrics.width;
        const bgWidthMap = textWidthMap + hpBadge.paddingXMap * 2;
        const bgHeightMap = hpBadge.heightMap;

        // Ancrer le coin bas-droit de la pastille à (p0.x + hpBadge.badgeX, p0.y + hpBadge.badgeY)
        const badgeLeft = p0.x + hpBadge.badgeX - bgWidthMap;
        const badgeTop = p0.y + hpBadge.badgeY - bgHeightMap;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(badgeLeft, badgeTop, bgWidthMap, bgHeightMap, 3 / zoom);
        } else {
          ctx.rect(badgeLeft, badgeTop, bgWidthMap, bgHeightMap);
        }
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.lineWidth = 1 / zoom;
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(
          hpBadge.text,
          badgeLeft + bgWidthMap / 2,
          badgeTop + bgHeightMap / 2 + 0.5 / zoom
        );
        ctx.restore();
      }
    }

    // ── Numéro d'exemplaire (C-15) : vu de tous, joueurs compris — ils suivent « le 2 » eux aussi.
    if (typeof token.copyNumber === 'number') {
      const copie = computeCopyBadgeLayout(width, zoom);
      const cx = p0.x + copie.centerX;
      const cy = p0.y + copie.centerY;
      ctx.save();
      if (token.hidden) ctx.globalAlpha = 0.45;
      ctx.beginPath();
      ctx.arc(cx, cy, copie.radiusMap, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.lineWidth = 1 / zoom;
      ctx.stroke();
      ctx.font = `bold ${copie.fontSizeMap}px sans-serif`;
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(token.copyNumber), cx, cy + 0.5 / zoom);
      ctx.restore();
    }
  }

  /**
   * Cerclage et fond émaillé d'un pion lié (lot P2), ou `null` : pion ordinaire, trop petit à
   * l'écran, ou cerclage pas encore chargé (son chargement relance une image).
   *
   * @param {Token} token
   * @param {number} width
   * @param {number} zoom
   * @returns {{ frame: import('../medallion.js').MedallionFrame, canvas: import('../medallion.js').MedallionCanvas, enamel: import('../medallion.js').MedallionCanvas|null }|null}
   */
  _medallionFor(token, width, zoom) {
    if (!wantsMedallion(token, width, zoom)) return null;
    const { frame, tint } = medallionFrameOf(token);
    const canvas = this.medallions.frameCanvas(frame, tint, token.dead === true);
    if (!canvas) return null;
    return { frame, canvas, enamel: this.medallions.enamelCanvas(enamelLightOf(token)) };
  }

  /**
   * Médaillon du portrait du cavalier, en haut à droite d'un pion monté (contrat §8.1) — le haut
   * gauche porte les PV, le bas la rangée d'états et le numéro. Le badge d'élévation, dessiné
   * après, reste lisible par-dessus.
   * Sans portrait chargé : disque du camp et initiales du cavalier.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {Token} token
   * @param {{ x: number, y: number }} p0
   * @param {number} width
   * @param {number} zoom
   * @param {string} borderColor
   */
  _drawRiderMedallion(ctx, token, p0, width, zoom, borderColor) {
    const radius = (width * RIDER_MEDALLION_RATIO) / 2;
    const cx = p0.x + width - radius;
    const cy = p0.y + radius;
    const url = token.imageUrl?.trim() ?? '';
    const entry = url ? this.imageCache.get(url) : undefined;
    if (url && !entry) void this.preload(url);
    ctx.save();
    if (token.hidden) ctx.globalAlpha = 0.45;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.save();
    ctx.clip();
    if (entry?.status === 'ready' && entry.image) {
      const image = entry.image;
      const sw = image.naturalWidth || image.width;
      const sh = image.naturalHeight || image.height;
      const scale = Math.max((radius * 2) / sw, (radius * 2) / sh);
      ctx.drawImage(image, cx - (sw * scale) / 2, cy - (sh * scale) / 2, sw * scale, sh * scale);
    } else {
      ctx.fillStyle = (token.camp && CAMP_FILL[token.camp]) || '#555d68';
      ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${Math.max(8, Math.round(radius * 0.8))}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(campInitials(token.label), cx, cy);
    }
    ctx.restore();
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = TOKEN_BORDER_SCREEN_PX / zoom;
    ctx.stroke();
    ctx.restore();
  }
}

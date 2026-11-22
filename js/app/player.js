// @ts-check

import { initStage, renderLayerStack } from '../render/stage.js';
import { Camera } from '../render/camera.js';
import { FrameLoop } from '../render/frame.js';
import { FrameProbe } from '../render/probe.js';
import { BackgroundLayer } from '../render/layers/background.js';
import { VideoBackdrop } from '../render/videoBackdrop.js';
import { GridLayer } from '../render/layers/gridLayer.js';
import { LightLayer } from '../render/layers/light.js';
import { MoveZoneLayer } from '../render/layers/moveZone.js';
import { MovePlanLayer } from '../render/layers/movePlan.js';
import { TokensLayer } from '../render/layers/tokens.js';
import { FogLayer } from '../render/layers/fogLayer.js';
import { PortalsLayer } from '../render/layers/portals.js';
import { LinksLayer } from '../render/layers/links.js';
import { TemplatesLayer } from '../render/layers/templates.js';
import { PingsLayer } from '../render/layers/pings.js';
import { FxLayer, parseFx, prefersReducedMotion, shouldPlayFx } from '../render/layers/fx.js';
import { decodeFogPng, getOrExtractMaskAlpha, isCellVisibleInMask } from '../vision/fog.js';
import { createPlayerLevelSelector } from '../ui/player/levelSelector.js';
import { createSelectionStrip } from '../ui/player/selectionStrip.js';
import { mountPlayerGameHelp } from '../ui/player/gameHelp.js';
import { distanceBetweenFootprints, gridFor } from '../grid/index.js';
import { extractBlockedSegments } from '../import/blockedEdges.js';
import { bootstrapPlayerView } from '../ui/player/bootstrap.js';
import { isPlayerManipulableToken } from '../input/tokenHit.js';
import { withTemplatePreview } from '../input/templateHit.js';
import { mountPlayerVersionBadge } from '../ui/versionBadge.js';
import { mountImageShareOverlay } from '../ui/player/imageShareOverlay.js';
import { VISION_REQUEST_EVENT } from '../core/constants.js';
import { isLinkedToken } from '../core/schema.js';
import {
  createNetworkStatus,
  connectSession,
  normalizeSessionId,
  withDeadline,
  attendreConnexion,
  createSnapshotSaver,
  CONNEXION_DEADLINE_MS,
} from './session.js';
import { applyNetworkEvent, createSnapshotPayload } from './networkEvents.js';
import * as store from '../state/store.js';
import { listOtherGmClients } from '../state/presence.js';
import { MovePlanningController, walkLimitFor, bondZoneForDisplay, ranStartResolver } from './movePlanning.js';
import { movePlanPreview } from '../state/movePlan.js';

/** @typedef {import('../transport/Transport.js').Transport} Transport */

// Icônes du bouton plein écran : quatre coins qui s'écartent (entrer) ou se rejoignent
// (sortir). Dessinées en SVG plutôt qu'en caractère Unicode — les glyphes « plein écran »
// ne sont pas dans toutes les fontes système, et un carré tofu au-dessus de la carte est
// pire que pas de bouton.
const ICON_FULLSCREEN_ENTER =
  '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>';
const ICON_FULLSCREEN_EXIT =
  '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8h3a2 2 0 0 0 2-2V3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M21 16h-3a2 2 0 0 0-2 2v3"/></svg>';
const ICON_TURN_UNDO =
  '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>';

/**
 * Sélection, consultation et aperçus suivent la visibilité de `TokensLayer` : étage courant,
 * pion non masqué, case d'ancrage dans le masque de vision courante publié.
 * @param {import('../core/types.js').Token|null|undefined} token
 * @param {import('../core/types.js').Level} activeLevel
 * @param {Uint8Array|null} maskAlpha
 * @returns {boolean}
 */
function visibleALaTable(token, activeLevel, maskAlpha) {
  if (!token || token.levelId !== activeLevel.id || token.hidden || !maskAlpha) return false;
  return isCellVisibleInMask(
    token.cell,
    maskAlpha,
    activeLevel.widthCells,
    activeLevel.heightCells,
    activeLevel.grid?.type === 'hex' ? 'hex' : 'square',
    gridFor(activeLevel).maskLatticeShift()
  );
}

/**
 * @returns {Promise<() => void>}
 */
async function setupMobileLocks() {
  if (typeof window === 'undefined') return () => {};
  /** @type {any|null} */
  let wakeLock = null;

  async function lockOrientation() {
    const orientation = /** @type {any} */ (screen.orientation);
    if (!orientation || typeof orientation.lock !== 'function') return;
    try {
      await orientation.lock('landscape');
    } catch {
      // Une nouvelle tentative a lieu au premier geste.
    }
  }

  async function acquireWakeLock() {
    if (!('wakeLock' in navigator) || !window.isSecureContext || document.hidden) return;
    try {
      wakeLock = await /** @type {any} */ (navigator).wakeLock.request('screen');
    } catch {
      wakeLock = null;
    }
  }

  async function activateFromGesture() {
    await lockOrientation();
    await acquireWakeLock();
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      try {
        await document.documentElement.requestFullscreen();
      } catch {
        // La PWA peut être déjà plein écran ou le navigateur peut refuser.
      }
    }
  }

  // Bouton de bascule plein écran, en haut à droite.
  //
  // Deuxième dérogation tapable au zéro-UI de la vue joueurs (cf. CONVENTIONS.md §8,
  // interdiction 2), demandée le 30 juillet 2026. Le plein écran n'était tenté qu'au tout
  // premier geste : un refus du navigateur, ou une sortie par le geste système de la
  // tablette, laissait la carte en fenêtré sans aucun moyen d'y revenir hors rechargement.
  const documentElement = document.documentElement;
  const requestFullscreen =
    documentElement.requestFullscreen ||
    /** @type {any} */ (documentElement).webkitRequestFullscreen;
  const exitFullscreen =
    document.exitFullscreen || /** @type {any} */ (document).webkitExitFullscreen;
  // Sur un navigateur sans API plein écran (Safari iOS), le bouton ne pourrait rien faire :
  // on n'en met pas. Le zéro-UI reste alors intact.
  const fullscreenSupported =
    typeof requestFullscreen === 'function' &&
    typeof exitFullscreen === 'function' &&
    document.fullscreenEnabled !== false;

  const isFullscreen = () =>
    Boolean(document.fullscreenElement || /** @type {any} */ (document).webkitFullscreenElement);

  /** @type {HTMLButtonElement|null} */
  let fullscreenButton = null;

  if (fullscreenSupported) {
    fullscreenButton = document.createElement('button');
    fullscreenButton.id = 'player-fullscreen-btn';
    fullscreenButton.type = 'button';
    fullscreenButton.style.position = 'fixed';
    fullscreenButton.style.top = '12px';
    fullscreenButton.style.right = '12px';
    // Au-dessus de l'image partagée (9000), sous l'avertissement de version (9999) : une image
    // révélée ne doit pas piéger la tablette en fenêtré, mais rien ne masque une alerte.
    fullscreenButton.style.zIndex = '9500';
    fullscreenButton.style.width = '44px';
    fullscreenButton.style.height = '44px';
    fullscreenButton.style.display = 'flex';
    fullscreenButton.style.alignItems = 'center';
    fullscreenButton.style.justifyContent = 'center';
    fullscreenButton.style.padding = '0';
    fullscreenButton.style.border = '0';
    fullscreenButton.style.borderRadius = '8px';
    fullscreenButton.style.background = 'rgba(0, 0, 0, 0.45)';
    fullscreenButton.style.color = '#ffffff';
    // Discret par défaut : présent pour la main qui le cherche, oublié par les yeux.
    fullscreenButton.style.opacity = '0.4';
    fullscreenButton.style.transition = 'opacity 0.2s ease';
    fullscreenButton.style.cursor = 'pointer';
    fullscreenButton.style.touchAction = 'manipulation';
    fullscreenButton.style.setProperty('-webkit-tap-highlight-color', 'transparent');
    document.body.appendChild(fullscreenButton);
  }

  function renderFullscreenButton() {
    if (!fullscreenButton) return;
    const actif = isFullscreen();
    fullscreenButton.innerHTML = actif ? ICON_FULLSCREEN_EXIT : ICON_FULLSCREEN_ENTER;
    const libelle = actif ? 'Quitter le plein écran' : 'Plein écran';
    fullscreenButton.title = libelle;
    fullscreenButton.setAttribute('aria-label', libelle);
  }

  const onToggleFullscreen = async () => {
    if (!fullscreenButton) return;
    fullscreenButton.style.opacity = '1';
    try {
      if (isFullscreen()) {
        await exitFullscreen.call(document);
      } else {
        await requestFullscreen.call(documentElement);
        // Le plein écran est le moment où l'orientation et la veille comptent le plus.
        await lockOrientation();
        await acquireWakeLock();
      }
    } catch (err) {
      // Le navigateur peut refuser (hors geste utilisateur, mode PiP…). On le dit, et la
      // carte continue de fonctionner en fenêtré.
      console.warn('Bascule plein écran refusée par le navigateur :', err);
    }
    renderFullscreenButton();
    fullscreenButton.style.opacity = '0.4';
  };

  const onFullscreenChange = () => renderFullscreenButton();

  const onVisibilityChange = () => {
    if (!document.hidden) void acquireWakeLock();
  };
  let firstGestureDone = false;
  /** @param {Event} event */
  const onFirstGesture = (event) => {
    // Le bouton est maître de sa propre bascule : le laisser déclencher aussi l'activation
    // « au premier geste » ferait entrer puis ressortir du plein écran sur le même tap,
    // `pointerdown` précédant `click`.
    if (
      fullscreenButton &&
      event.target instanceof Node &&
      fullscreenButton.contains(event.target)
    ) {
      return;
    }
    // Le bouton « ? » et le dialogue d'aide restent isolés : un premier tap sur l'aide (ou
    // dans le guide ouvert au clavier) ne doit pas déclencher le plein écran de la partie.
    const targetElement =
      event.target instanceof Element
        ? event.target
        : event.target instanceof Node
          ? event.target.parentElement
          : null;
    if (targetElement?.closest('#player-game-help, #player-help-dialog, #player-turn-undo-btn')) {
      return;
    }
    if (firstGestureDone) return;
    firstGestureDone = true;
    document.removeEventListener('pointerdown', onFirstGesture);
    void activateFromGesture();
  };

  document.addEventListener('visibilitychange', onVisibilityChange);
  document.addEventListener('pointerdown', onFirstGesture);
  if (fullscreenButton) {
    fullscreenButton.addEventListener('click', () => void onToggleFullscreen());
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);
    renderFullscreenButton();
  }
  await lockOrientation();
  await acquireWakeLock();

  return () => {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    document.removeEventListener('pointerdown', onFirstGesture);
    document.removeEventListener('fullscreenchange', onFullscreenChange);
    document.removeEventListener('webkitfullscreenchange', onFullscreenChange);
    fullscreenButton?.remove();
    fullscreenButton = null;
    try {
      wakeLock?.release?.();
    } catch {
      // Déjà libéré.
    }
    wakeLock = null;
  };
}

/**
 * @param {Object} [options]
 * @param {HTMLCanvasElement} [options.canvas]
 * @param {Transport} [options.transport]
 * @param {Record<string, any>} [options.firebaseConfig]
 * @param {string} [options.sessionId]
 * @param {number} [options.connexionDelaiMs] Échéance de la connexion au démarrage (C4) ; les tests la raccourcissent
 */
export async function bootstrapPlayerApp(options = {}) {
  const cleanupMobileLocks = await setupMobileLocks();
  const canvas =
    options.canvas ||
    /** @type {HTMLCanvasElement|null} */ (document.querySelector('#board')) ||
    document.createElement('canvas');
  const stage = await initStage(canvas);
  const camera = new Camera(stage.width, stage.height);
  /** @type {FrameLoop} */
  let frameLoop;
  const requestRender = () => frameLoop?.requestFrame();

  const backgroundLayer = new BackgroundLayer({ invalidate: requestRender });
  const videoBackdrop = new VideoBackdrop({
    invalidate: requestRender,
    onWarning: (message) => console.warn(`[fond animé] ${message}`),
  });
  videoBackdrop.attach(canvas.parentElement, canvas);
  const gridLayer = new GridLayer();
  const lightLayer = new LightLayer();
  const portalsLayer = new PortalsLayer();
  const linksLayer = new LinksLayer();
  const moveZoneLayer = new MoveZoneLayer();
  const movePlanLayer = new MovePlanLayer();
  /** @type {(reason:string)=>void} */
  let notifyMoveInvalidation = (_reason) => {};
  /** @type {(error:unknown)=>void} */
  let notifyMovePublicationError = (_error) => {};
  const movePlanning = new MovePlanningController({
    onChange: requestRender,
    onInvalidated: (reason) => notifyMoveInvalidation(reason),
    onPublicationError: (error) => notifyMovePublicationError(error),
  });
  const templatesLayer = new TemplatesLayer();
  /**
   * Pose d'aperçu du gabarit que la table fait glisser (B4) — transitoire, ni store ni réseau.
   * @type {{ templateId: string, origin: import('../core/types.js').MapPoint, directionDeg: number }|null}
   */
  let templateDragPreview = null;
  const pingsLayer = new PingsLayer();
  /** Effets de blessure et de mort (contrat §9) : éphémères, `at` posé à la réception locale. */
  const fxLayer = new FxLayer();
  /**
   * Ping courant. ⛔ `at` est posé à la **réception locale**, jamais lu de `event.at` : c'est le
   * poste où la règle compte le plus, la tablette de ce projet ayant été mesurée 5,3 s en avance.
   * Un ping jugé sur l'horloge du MJ n'apparaîtrait jamais ici. Voir `PING_DURATION_MS`.
   * @type {{levelId: string, mapPos: {x: number, y: number}, at: number, fromGm?: boolean}|null}
   */
  let currentPing = null;
  const tokensLayer = new TokensLayer({ invalidate: requestRender });
  const fogLayer = new FogLayer();
  // Passive, comme côté MJ : aucun timer ni rAF ne vient entretenir la tablette au repos.
  const frameProbe = new FrameProbe();
  /** @type {Record<string, number>} */
  const layerDurations = {
    snapshot: 0,
    background: 0,
    grid: 0,
    light: 0,
    portals: 0,
    links: 0,
    moveZone: 0,
    templates: 0,
    tokens: 0,
    fog: 0,
    feedback: 0,
  };
  let lStart = 0;

  // ⚠ Déclaré AVANT le décodeur de masques, et c'est nécessaire : la connaissance d'un étage
  // (UX-12) ne devient vraie qu'au retour d'un décodage **asynchrone**, qui ne passe pas par le
  // store. Sans ce rafraîchissement depuis le , la barre resterait vide jusqu'à la
  // prochaine mutation — c'est-à-dire, sur un étage quitté, jamais.
  /** @type {{ update: () => void, destroy: () => void }|null} */
  let playerLevelSelector = null;

  /** @type {Map<string, { png: string, canvas: any }>} */
  const playerExploredCanvasMap = new Map();

  /**
   * PNG en cours de décodage, par étage et par nature de masque.
   *
   * ⛔ Audit du 22/09, G4 : le cache ne se remplit qu'au RETOUR du décodage, et le masque visible
   * est demandé quatre fois par image. Pendant une animation, chaque image relançait donc quatre
   * décodages du même PNG, chacun avec son canvas et son tampon, jusqu'à ce que le premier
   * aboutisse. Un décodage déjà lancé pour ce PNG n'est pas relancé.
   * @type {Map<string, string>}
   */
  const decodagesEnCours = new Map();

  /**
   * @param {import('../core/types.js').Level|null} level
   */
  function getPlayerExploredCanvas(level) {
    if (!level) return null;
    const png = store.getSessionFog(level.id);
    if (!png) return null;

    const existing = playerExploredCanvasMap.get(level.id);
    if (existing && existing.png === png) {
      return existing.canvas;
    }

    const cleExploree = `explore:${level.id}`;
    if (decodagesEnCours.get(cleExploree) === png) return existing ? existing.canvas : null;
    decodagesEnCours.set(cleExploree, png);
    void decodeFogPng(png, level.widthCells, level.heightCells).then((canvas) => {
      // Plusieurs PNG peuvent décoder dans le désordre. Ne jamais laisser un ancien masque
      // écraser la valeur que le transport a déjà remplacée dans le store.
      if (store.getSessionFog(level.id) !== png) return;
      playerExploredCanvasMap.set(level.id, { png, canvas });
      playerLevelSelector?.update();
      requestRender();
    }).finally(() => {
      if (decodagesEnCours.get(cleExploree) === png) decodagesEnCours.delete(cleExploree);
    });

    return existing ? existing.canvas : null;
  }

  /** @type {Map<string, { png: string, canvas: any }>} */
  const playerVisibleCanvasMap = new Map();
  let refreshTokenVisibility = () => {};

  /**
   * @param {import('../core/types.js').Level|null} level
   */
  function getPlayerVisibleCanvas(level) {
    if (!level) return null;
    const png = store.getSessionVision(level.id);
    if (!png) return null;

    const existing = playerVisibleCanvasMap.get(level.id);
    if (existing && existing.png === png) {
      return existing.canvas;
    }

    const cleVisible = `visible:${level.id}`;
    if (decodagesEnCours.get(cleVisible) === png) return existing ? existing.canvas : null;
    decodagesEnCours.set(cleVisible, png);
    void decodeFogPng(png, level.widthCells, level.heightCells).then((canvas) => {
      // Même garde que pour le fog exploré : une torche ou une porte peut générer plusieurs
      // `vision.update` successifs alors que les décompressions précédentes sont encore actives.
      if (store.getSessionVision(level.id) !== png) return;
      playerVisibleCanvasMap.set(level.id, { png, canvas });
      if (store.getActiveLevelId() === level.id) refreshTokenVisibility();
      requestRender();
    }).finally(() => {
      if (decodagesEnCours.get(cleVisible) === png) decodagesEnCours.delete(cleVisible);
    });

    return existing ? existing.canvas : null;
  }

  /** @param {import('../core/types.js').Level} level */
  function currentVisionAlpha(level) {
    const canvas = getPlayerVisibleCanvas(level);
    return canvas ? getOrExtractMaskAlpha(canvas, level.widthCells, level.heightCells) : null;
  }

  /** @param {import('../core/types.js').Token} token @param {import('../core/types.js').Level} level */
  function isTokenVisible(token, level) {
    return visibleALaTable(token, level, currentVisionAlpha(level));
  }

  const urlParams = new URLSearchParams(window.location.search);
  const probeOnStart = urlParams.get('probe') === '1';

  // Même normalisation que côté MJ : le code est recopié à la main sur la tablette, la
  // casse ne doit pas décider silencieusement d'une autre session.
  const sessionId =
    options.sessionId || normalizeSessionId(urlParams.get('session')) || 'local-player';
  store.setSessionId(sessionId);

  // ── UX-10 : la vue joueurs a SON étage affiché ────────────────────────────────────────────
  //
  // ⛔ **C'est un point de vue, pas un fait de jeu.** Il ne voyage donc pas sur le réseau et
  // n'entre pas dans le document de campagne — exactement la raison qui gardait le cadenas du MJ
  // hors de la campagne : le mettre dans le document le ferait voyager jusqu'aux autres postes et
  // survivre à la partie.
  //
  // Le stockage local suffit, et il est nécessaire : sans lui, un F5 de la tablette la ramènerait
  // sur l'étage que le MJ regardait au moment de l'instantané, c'est-à-dire précisément le
  // couplage qu'on vient de couper.
  const CLE_ETAGE_JOUEURS = `rpg_player_level_${sessionId}`;

  const lireEtageMemorise = () => {
    try {
      return localStorage.getItem(CLE_ETAGE_JOUEURS) || null;
    } catch {
      return null;
    }
  };

  /** @param {string|null} levelId */
  const memoriserEtage = (levelId) => {
    try {
      if (levelId) localStorage.setItem(CLE_ETAGE_JOUEURS, levelId);
      else localStorage.removeItem(CLE_ETAGE_JOUEURS);
    } catch {
      // Un stockage plein ou refusé ne doit pas empêcher de jouer : on perd la mémoire de
      // l'étage au prochain rechargement, rien de plus.
    }
  };

  let restoredCamera = false;
  try {
    const saved = localStorage.getItem(`rpg_camera_${sessionId}`);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (
        typeof parsed.x === 'number' &&
        typeof parsed.y === 'number' &&
        typeof parsed.zoom === 'number'
      ) {
        camera.setPan(parsed.x, parsed.y);
        camera.setZoom(parsed.zoom);
        restoredCamera = true;
      }
    }
  } catch {
    restoredCamera = false;
  }

  /** @type {string|null} */
  let lastActiveLevelId = null;
  // La table a-t-elle CHOISI sa caméra — restaurée d'un F5, ou déplacée au doigt depuis le
  // dernier cadrage automatique ? Un redimensionnement ne recadre que si elle ne l'a pas fait
  // (audit du 22/09, B10) : le passage en plein écran au premier geste déclenche un `resize`,
  // et recadrer à ce moment effaçait la caméra que la table venait de retrouver ou de régler.
  let cameraChoisie = restoredCamera;
  /** @param {import('../core/types.js').Level|null} activeLevel */
  function fitActiveLevel(activeLevel) {
    if (!activeLevel || activeLevel.id === lastActiveLevelId) return;
    lastActiveLevelId = activeLevel.id;
    if (restoredCamera) {
      restoredCamera = false;
      return;
    }
    const grid = gridFor(activeLevel);
    // ⛔ `mapExtent()`, jamais le coin bas-droit — E-13 : `mapFromCellPoint` porte le décalage
    // odd-r de la rangée, qui n'a rien à voir avec la taille de la carte. Sur une carte
    // hexagonale à nombre de rangées IMPAIR, il rendait une demi-case de trop, et c'est le
    // DÉCOR lui-même qui s'en trouvait étiré, désaligné de la grille.
    const etendue = grid.mapExtent();
    camera.setPan(etendue.width / 2, etendue.height / 2);
    camera.setZoom(
      Math.min(stage.width / Math.max(1, etendue.width), stage.height / Math.max(1, etendue.height))
    );
    cameraChoisie = false;
  }

  function renderAll() {
    const tStart = typeof performance !== 'undefined' ? performance.now() : Date.now();
    stage.context.save();
    stage.context.setTransform(1, 0, 0, 1, 0, 0);
    stage.context.clearRect(0, 0, stage.canvas.width, stage.canvas.height);
    stage.context.restore();

    lStart = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const state = store.getRenderSnapshot();
    layerDurations.snapshot =
      (typeof performance !== 'undefined' ? performance.now() : Date.now()) - lStart;
    fitActiveLevel(state.activeLevel);
    const activeLevel = state.activeLevel;
    // ⛔ **Avant** le retour anticipé. La frame a déjà fait `clearRect` : sortir ici sans
    // couper la vidéo laisserait le fond animé de l'étage précédent seul à l'écran, en
    // lecture, sans grille ni pions. Pas un vide — pire : une carte orpheline.
    videoBackdrop.sync(activeLevel);
    if (!activeLevel) {
      undoStepButton.hidden = true;
      return;
    }

    const grid = gridFor(activeLevel);
    const plan = movePlanning.getPlan();
    const campaignTokens = state.campaign?.tokens ?? [];
    const maskAlpha = currentVisionAlpha(activeLevel);
    const ranStartOf = ranStartResolver(campaignTokens, activeLevel);
    const selected = state.selectedToken;
    const selectedIsVisible = visibleALaTable(selected, activeLevel, maskAlpha);
    const visibleLocalPreview = plan?.steps.length && plan.levelId === activeLevel.id &&
      selected?.id === plan.tokenId && selected.cell.a === plan.start.a && selected.cell.b === plan.start.b &&
      selectedIsVisible ? movePlanPreview(plan) : null;
    const confirmation = plan?.status === 'ready' ? visibleLocalPreview : null;
    if (confirmation && plan) {
      placeUndoButton(grid, plan.steps.at(-2) ?? plan.start, confirmation.destination);
    } else {
      undoStepButton.hidden = true;
    }
    // ⛔ `mapExtent()`, jamais le coin bas-droit — E-13 : `mapFromCellPoint` porte le décalage
    // odd-r de la rangée, qui n'a rien à voir avec la taille de la carte. Sur une carte
    // hexagonale à nombre de rangées IMPAIR, il rendait une demi-case de trop, et c'est le
    // DÉCOR lui-même qui s'en trouvait étiré, désaligné de la grille.
    const etendue = grid.mapExtent();
    void backgroundLayer.load(activeLevel.imageUrl);

    stage.context.save();
    stage.context.scale(stage.resolution, stage.resolution);
    camera.applyToContext(stage.context);
    // ⛔ **Après** `applyToContext`, jamais avant : cette méthode **borne `camera.zoom` en
    // le mutant**. Voir le commentaire jumeau dans `gm.js`.
    videoBackdrop.place(camera, etendue.width, etendue.height, stage.width, stage.height);
    let animationActive = false;
    let tokensAnimating = false;
    layerDurations.background = 0;
    layerDurations.grid = 0;
    layerDurations.portals = 0;
    layerDurations.links = 0;
    layerDurations.moveZone = 0;
    layerDurations.templates = 0;
    layerDurations.tokens = 0;
    layerDurations.fog = 0;
    layerDurations.feedback = 0;
    renderLayerStack({
      background: () => {
        lStart = typeof performance !== 'undefined' ? performance.now() : Date.now();
        backgroundLayer.render(stage.context, etendue.width, etendue.height, {
          role: 'players',
          suppressed: videoBackdrop.active,
        });
        layerDurations.background = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - lStart;
      },
      grid: () => {
        lStart = typeof performance !== 'undefined' ? performance.now() : Date.now();
        gridLayer.render(stage.context, grid);
        layerDurations.grid = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - lStart;
      },
      // ⭐ Le champ lumineux se calcule **localement**, et ce n'est pas une entorse à
      // l'autorité du MJ. Un champ lumineux ne dépend d'aucun observateur : il se déduit des
      // murs, des portes et des sources, que la tablette a déjà toutes. Deux entrées
      // identiques donnent deux champs identiques — rien à publier, rien à désynchroniser.
      //
      // ⛔ La VISION, elle, reste publiée par le MJ : c'est elle qui décide de ce que la
      // table a le droit de voir, et elle ne se recalcule pas ici.
      //
      // La vue joueurs n'a pas de mode : elle est toujours éclairée.
      light: () => {
        lStart = typeof performance !== 'undefined' ? performance.now() : Date.now();
        lightLayer.update(grid, activeLevel, state.campaign?.tokens ?? [], {
          extractSegments: extractBlockedSegments,
        });
        lightLayer.render(stage.context, grid, activeLevel, {
          role: 'players',
          suppressed: videoBackdrop.active,
          // ⭐ Même masque que la couche de fog utilise plus bas — le stencil « vu sans
          // lumière » en a besoin pour savoir ce que la table VOIT (voir `light.js`).
          visibleCanvas: getPlayerVisibleCanvas(activeLevel),
          // ⭐ L'exploré aussi (décision du 03/10/2026) : de nuit, une zone révélée au pinceau ou
          // déjà vue montre son décor en gris sous son voile. Les pions, eux, suivent le visible.
          exploredCanvas: getPlayerExploredCanvas(activeLevel),
        });
        layerDurations.light = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - lStart;
      },
      // Pas de battement côté joueurs : verrouiller est réservé au MJ (CdC §12 Q3), donc un
      // tap joueurs sur une porte verrouillée n'a rien à signaler qu'il puisse changer.
      portals: () => {
        lStart = typeof performance !== 'undefined' ? performance.now() : Date.now();
        portalsLayer.render(stage.context, grid, activeLevel, { zoom: camera.zoom });
        layerDurations.portals = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - lStart;
      },
      links: () => {
        lStart = typeof performance !== 'undefined' ? performance.now() : Date.now();
        linksLayer.render(stage.context, grid, activeLevel, state.campaign?.links ?? [], {
          role: 'players',
          zoom: camera.zoom,
        });
        layerDurations.links = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - lStart;
      },
      moveZone: () => {
        lStart = typeof performance !== 'undefined' ? performance.now() : Date.now();
        moveZoneLayer.render(stage.context, grid, {
          selectedToken: state.selectedToken,
          reachableCells: plan ? plan.reachable : state.reachableCells,
          walkLimit: walkLimitFor(plan, state.selectedToken, activeLevel),
          bondCells: bondZoneForDisplay(plan, state.selectedToken, activeLevel),
        }, camera.zoom);
        layerDurations.moveZone = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - lStart;
      },
      movePlan: () => {
        const previewOwnerIsVisible = /** @param {import('../core/types.js').MovePreview} preview */ (preview) => {
          const owner = campaignTokens.find((token) => token.id === preview.tokenId);
          return owner && owner.cell.a === preview.start.a && owner.cell.b === preview.start.b &&
            visibleALaTable(owner, activeLevel, maskAlpha);
        };
        const remotes = Object.fromEntries(Object.entries(movePlanning.getRemotePreviews()).filter(([, preview]) => {
          return preview.levelId === activeLevel.id && previewOwnerIsVisible(preview);
        }));
        movePlanLayer.render(stage.context, grid, activeLevel.id, visibleLocalPreview, remotes, camera.zoom, ranStartOf, !confirmation);
      },
      templates: () => {
        lStart = typeof performance !== 'undefined' ? performance.now() : Date.now();
        templatesLayer.render(
          stage.context, grid, activeLevel,
          withTemplatePreview(state.campaign?.templates ?? [], templateDragPreview), true, camera.zoom, null
        );
        layerDurations.templates = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - lStart;
      },
      tokens: () => {
        lStart = typeof performance !== 'undefined' ? performance.now() : Date.now();
        const visibleCanvas = getPlayerVisibleCanvas(activeLevel);
        const result = tokensLayer.render(
          stage.context,
          grid,
          state.campaign?.tokens ?? [],
          state.selectedTokenId,
          {
            role: 'players',
            activeLevelId: activeLevel.id,
            activeLevelWidthCells: activeLevel.widthCells,
            activeLevelHeightCells: activeLevel.heightCells,
            visibleCanvas,
            // ⛔ Aucun masque de vision publié pour cet étage ⇒ aucun pion dessiné.
            //
            // La couche ne peut pas déduire cette règle de l'absence de masque : un appelant qui
            // n'en passe pas volontairement — rendu hors fog, contrôle par rôle — doit garder
            // l'ancien comportement. Seule la vue joueurs sait qu'un masque était **attendu**.
            //
            // Le cas devient courant avec le sélecteur d'étage joueurs : sur un étage sans PJ, le
            // MJ ne calcule aucune vision, et sans ce drapeau la table y verrait tous les PNJ.
            visionPublished: store.getSessionVision(activeLevel.id) !== null,
            now: Date.now(),
            zoom: camera.zoom,
            resolution: stage.resolution,
          }
        );
        // `||=` et non `=`, par symétrie avec la vue MJ : les pions ne sont plus la seule
        // couche susceptible de s'animer, et une affectation effacerait le drapeau d'une couche
        // dessinée avant eux. Rien ne s'anime avant eux ici aujourd'hui — c'est justement pour
        // que ce ne soit pas un piège demain.
        tokensAnimating = result.animationActive;
        animationActive ||= result.animationActive;
        layerDurations.tokens = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - lStart;
      },
      fog: () => {
        lStart = typeof performance !== 'undefined' ? performance.now() : Date.now();
        fogLayer.render(
          stage.context,
          grid,
          activeLevel,
          state.campaign?.tokens ?? [],
          {
            role: 'players',
            exploredCanvas: getPlayerExploredCanvas(activeLevel),
            visibleCanvas: getPlayerVisibleCanvas(activeLevel),
          }
        );
        layerDurations.fog = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - lStart;
      },
      fx: () => {
        const result = fxLayer.render(stage.context, grid, activeLevel, {
          tokens: state.campaign?.tokens ?? [],
          now: Date.now(),
          requestRender,
        });
        animationActive ||= result.animationActive;
      },
      feedback: () => {
        lStart = typeof performance !== 'undefined' ? performance.now() : Date.now();
        animationActive ||= moveZoneLayer.renderDestinationFeedback(stage.context, grid, {
          now: Date.now(),
          zoom: camera.zoom,
        });
        const turn = store.getTurn();
        // Une préparation commence dès la sélection du pion (zone affichée) : aucun bouton de porte
        // ni de liaison ne doit recouvrir une case atteignable juste derrière une porte ouverte ou
        // au-dessus d'un escalier (CA1, CA11).
        const hasPreparation = Boolean(selected || plan);
        const insetTop = levelTabsMount?.offsetHeight ?? 0;
        // ⛔ Au-dessus du brouillard (rang `feedback`), et jamais pendant une préparation ou une
        // animation de déplacement (CA8, CA11). Ne réveille jamais `animationActive`.
        if (!hasPreparation && !tokensAnimating) {
          const visibleTokens = campaignTokens.filter((token) => visibleALaTable(token, activeLevel, maskAlpha));
          portalsLayer.renderButtons(stage.context, grid, activeLevel, visibleTokens, {
            zoom: camera.zoom,
            turn,
          });
          const links = state.campaign?.links ?? [];
          for (const token of visibleTokens) {
            linksLayer.renderButton(stage.context, grid, activeLevel, links, token, {
              zoom: camera.zoom,
              turn,
              camera,
              insetTop,
            });
          }
        }
        // Pion monté sur une liaison : mention non tapable (CA4).
        if (selected && selectedIsVisible && selected.mounted && isPlayerManipulableToken(selected, turn)) {
          linksLayer.renderPrompt(stage.context, grid, activeLevel, state.campaign?.links ?? [], {
            zoom: camera.zoom,
            promptAtCell: selected.cell,
            mounted: isLinkedToken(selected) ? 'linked' : 'local',
            camera,
            insetTop,
          });
        }
        if (confirmation) {
          const strip = selectionStripMount?.getBoundingClientRect();
          movePlanLayer.renderConfirmation(stage.context, grid, confirmation, camera, ranStartOf(confirmation), {
            top: levelTabsMount?.offsetHeight ?? 0,
            selectionStrip: strip?.width ? strip : undefined,
          });
        }
        layerDurations.feedback = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - lStart;
      },
      pings: () => {
        const strip = currentPing?.fromGm ? selectionStripMount?.getBoundingClientRect() : null;
        const result = pingsLayer.render(stage.context, grid, activeLevel, {
          ping: currentPing,
          now: Date.now(),
          zoom: camera.zoom,
          edge: currentPing?.fromGm ? { camera, top: levelTabsMount?.offsetHeight ?? 0, strip: strip?.width ? strip : undefined } : undefined,
        });
        animationActive ||= result.animationActive;
        if (currentPing && !result.animationActive) currentPing = null;
      },
    });

    stage.context.restore();
    if (animationActive) requestRender();
    const tEnd = typeof performance !== 'undefined' ? performance.now() : Date.now();
    frameProbe.recordFrame(tEnd, tEnd - tStart, layerDurations);
  }
  frameLoop = new FrameLoop(renderAll);
  if (probeOnStart) {
    const showProbeOnce = () => {
      frameLoop.removeListener(showProbeOnce);
      frameProbe.toggleOverlay();
    };
    frameLoop.addListener(showProbeOnce);
  }

  const networkStatus = createNetworkStatus('players', sessionId);
  notifyMoveInvalidation = (reason) => networkStatus.update('warning', `Trajet préparé annulé : ${reason}`);
  notifyMovePublicationError = (error) => networkStatus.update('warning', `Aperçu non synchronisé : ${String(error || 'erreur réseau')}`);
  /** @type {Transport|null} */
  let transport = null;
  // ── C4 : démarrage hors ligne — local, puis reprise (D-10) — même règle que `gm.js` ────────
  //
  // Passé l'échéance, la partie de ce poste s'affiche avec le bandeau « hors ligne », et la
  // tentative continue. Quand elle aboutit, la page redémarre en ligne et RELIT l'état partagé :
  // c'est le MJ qui fait autorité, la table ne pousse jamais le sien.
  const tentative = connectSession({
    injectedTransport: options.transport || null,
    firebaseConfig: options.firebaseConfig || null,
    sessionId,
    role: 'players',
    loginHost: document.body,
    onStatus: networkStatus.update,
  });
  const connexion = await attendreConnexion(tentative, options.connexionDelaiMs ?? CONNEXION_DEADLINE_MS);
  transport = connexion.transport;
  movePlanning.setTransport(transport);
  networkStatus.bindTransport(transport);
  if (connexion.delaiDepasse) {
    networkStatus.update('offline');
    tentative.then(
      (tardif) => {
        if (tardif) location.reload();
      },
      () => {}
    );
  }

  const transportExtended = /** @type {any} */ (transport);
  let applyingRemote = false;
  // Mutations de campagne hors instantané relu : une reprise qui voit ce compteur bouger pendant
  // son attente n'applique pas son instantané, plus vieux que l'écran (audit du 08/11, A8).
  let generationCampagne = 0;
  // Une écriture en vol à la fois, comme au MJ (A15) : sans MJ, c'est la table qui persiste.
  const snapshotSaver = createSnapshotSaver({
    capture: () => {
      // ⛔ D-5 (tranché le 23/09/2026) : la tablette n'écrit l'instantané QUE si aucun MJ n'est
      // présent. Tant qu'un MJ l'est, il reçoit chaque coup de la table et persiste seul : une
      // tablette réveillée ne peut plus écraser son état avec des données périmées. Sans MJ — son
      // onglet fermé, ou le temps de son F5 —, la table persiste, et aucun coup n'est perdu.
      //
      // ⚠ Fenêtre résiduelle : un coup joué dans la seconde où le MJ recharge, avant que le serveur
      // n'ait retiré sa présence, n'est écrit par personne. La présence se lit au DÉPART de
      // l'écriture, pas à sa programmation, pour la réduire au minimum.
      if (listOtherGmClients().length > 0) return null;
      if (!store.getCampaign()) return null;
      const snapshot = { ...createSnapshotPayload(), eventCursor: transportExtended.getSnapshotEventCursor?.() };
      const diagnostic = transportExtended.getSnapshotSizeDiagnostic?.(snapshot);
      if (diagnostic?.severity === 'warning') networkStatus.update('warning', diagnostic.message);
      return snapshot;
    },
    save: async (snapshot) => {
      await transportExtended.saveSnapshot(snapshot);
      networkStatus.diagnostics.recovered('firestore', 'Sauvegarde');
    },
    onError: (error) => {
      networkStatus.diagnostics.failed('firestore', 'Sauvegarde');
      networkStatus.update('error', error);
    },
  });

  function scheduleSnapshot() {
    if (!transportExtended?.saveSnapshot || applyingRemote) return;
    snapshotSaver.schedule();
  }

// ── UX-12 : « connu des joueurs » se DÉRIVE, il ne s'invente pas ──────────────────────────
  //
  // Un étage est connu si son masque **exploré** existe et n'est pas vide. C'est exactement la
  // notion demandée — « un pion PJ **a obtenu** une ligne de vue » — prise au passé : un étage
  // visité puis quitté reste connu, et s'affiche dans son brouillard, ce que le fog sait peindre
  // depuis L-04.
  //
  // ⛔ **Ni champ de schéma, ni événement réseau, ni migration.** Tout est déjà là.
  //
  // ⚠ L'existence du masque ne suffit pas : le MJ peut tout remasquer d'un étage (« Masquer
  // tout »), ce qui publie un masque **présent et vide**. Un étage entièrement remasqué doit
  // redevenir inconnu, sans quoi la barre offrirait un onglet menant à un écran noir.
  //
  /** @type {Map<string, { png: string, connu: boolean }>} */
  const connuCache = new Map();

  /** @param {string} levelId */
  function estConnuDesJoueurs(levelId) {
    const png = store.getSessionFog(levelId);
    if (!png) return false;

    const enCache = connuCache.get(levelId);
    if (enCache && enCache.png === png) return enCache.connu;

    const level = store.getRenderSnapshot().campaign?.levels.find((l) => l.id === levelId) ?? null;
    if (!level) return false;

    // Réutilise le cache de décodage du rendu : le masque n'est décodé qu'une fois par PNG, et
    // `getOrExtractMaskAlpha` met en cache le tableau d'alpha sur le canvas lui-même. Le seul
    // coût répété est le parcours ci-dessous, sur un tableau à l'échelle de la CASE et non du
    // pixel de carte.
    const canvas = getPlayerExploredCanvas(level);

    // ⛔ **Ne jamais conclure depuis un canvas qui ne correspond pas à ce PNG.** Le décodage est
    // asynchrone : tant qu'il est en vol, `getPlayerExploredCanvas` rend le canvas du masque
    // PRÉCÉDENT. Conclure là-dessus puis mettre en cache sous le nouveau PNG figeait la réponse
    // pour toujours — un étage remasqué puis révélé de nouveau ne redevenait jamais connu, et le
    // rafraîchissement qui suit le décodage ne pouvait plus rien y changer.
    const dejaDecode = playerExploredCanvasMap.get(levelId);
    if (!canvas || dejaDecode?.png !== png) return enCache?.connu ?? false;

    const alpha = getOrExtractMaskAlpha(canvas, level.widthCells, level.heightCells);
    const connu = Boolean(alpha && alpha.some((a) => a > 0));
    connuCache.set(levelId, { png, connu });
    return connu;
  }

  const levelTabsMount = /** @type {HTMLElement|null} */ (
    document.getElementById('player-level-tabs')
  );
  playerLevelSelector = levelTabsMount
    ? createPlayerLevelSelector(levelTabsMount, {
        getLevels: () => store.getLevelSummaries(),
        getActiveLevelId: () => store.getActiveLevelId(),
        isKnown: estConnuDesJoueurs,
        // ⛔ Choix **local** : il ne publie rien et ne déplace pas la vue MJ. C'est un point de
        // vue, pas un fait de jeu — même raison qu'UX-10, dont ce sélecteur est la moitié
        // visible.
        onSelectLevel: (levelId) => {
          try {
            store.selectLevel(levelId);
          } catch (err) {
            console.error('Choix d’étage refusé :', err);
          }
        },
      })
    : null;

  // Chantier C-9 : la bande de sélection, 5e dérogation de `CONVENTIONS.md` §8 n°2.
  const selectionStripMount = /** @type {HTMLElement|null} */ (
    document.getElementById('player-selection-strip')
  );
  const undoStepButton = document.createElement('button');
  undoStepButton.type = 'button';
  undoStepButton.id = 'player-undo-step';
  undoStepButton.hidden = true;
  undoStepButton.title = 'Retirer la dernière étape';
  undoStepButton.setAttribute('aria-label', undoStepButton.title);
  undoStepButton.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5 4 10l5 5M4 10h10a5 5 0 0 1 0 10h-3"/></svg>';
  canvas.parentElement?.appendChild(undoStepButton);
  undoStepButton.onclick = () => {
    const { selectedToken, activeLevel } = store.getState();
    if (selectedToken && activeLevel && isTokenVisible(selectedToken, activeLevel)) {
      movePlanning.undoLastStep(selectedToken, activeLevel);
    }
  };

  /**
   * Le bouton jouxte l'étape précédente. Les deux cases restent des cibles de déplacement.
   * @param {import('../grid/GridAdapter.js').GridAdapter} grid
   * @param {import('../core/types.js').Cell} previous
   * @param {import('../core/types.js').Cell} destination
   */
  function placeUndoButton(grid, previous, destination) {
    const radius = 22;
    const margin = 8;
    const bounds = grid.cellBounds({ cellX: previous.a, cellY: previous.b }, 1);
    const end = grid.cellBounds({ cellX: destination.a, cellY: destination.b }, 1);
    const startCorner = camera.mapToScreen({ x: bounds.x, y: bounds.y });
    const endCorner = camera.mapToScreen({ x: end.x, y: end.y });
    const center = camera.mapToScreen(grid.cellCenter(previous));
    const pad = radius + margin;
    const strip = selectionStripMount?.getBoundingClientRect();
    const top = (levelTabsMount?.offsetHeight ?? 0) + pad;
    const candidates = [
      { x: center.screenX, y: startCorner.screenY - pad },
      { x: startCorner.screenX - pad, y: center.screenY },
      { x: center.screenX, y: startCorner.screenY + bounds.height * camera.zoom + pad },
      { x: startCorner.screenX + bounds.width * camera.zoom + pad, y: center.screenY },
    ];
    const target = candidates.find(({ x, y }) => {
      if (x < pad || x > stage.width - pad || y < top || y > stage.height - pad) return false;
      if (strip?.width && x + radius > strip.left && y + radius > strip.top && y - radius < strip.bottom) return false;
      return x + radius <= endCorner.screenX || y + radius <= endCorner.screenY ||
        x - radius >= endCorner.screenX + end.width * camera.zoom ||
        y - radius >= endCorner.screenY + end.height * camera.zoom;
    });
    undoStepButton.hidden = !target;
    if (!target) return;
    undoStepButton.style.left = `${target.x - radius}px`;
    undoStepButton.style.top = `${target.y - radius}px`;
  }
  // Pion consulté (combat du 21/11/2026) : état LOCAL à la tablette, jamais publié ni persisté.
  /** @type {{tokenId: string, selectedTokenId: string|null}|null} */
  let inspection = null;
  /** @returns {import('../core/types.js').Token|null} */
  const inspectedToken = () => {
    if (!inspection) return null;
    const { tokenId, selectedTokenId } = inspection;
    const state = store.getState();
    const token = state.campaign?.tokens.find((t) => t.id === tokenId) ?? null;
    // Sorti de la vue, caché, retiré, étage changé : l'encart se ferme pour de bon. Il ne se
    // rouvrira pas tout seul quand le pion réapparaîtra.
    if (state.selectedTokenId !== selectedTokenId || !token || !state.activeLevel ||
        !isTokenVisible(token, state.activeLevel)) {
      inspection = null;
      return null;
    }
    return token;
  };
  const selectionStrip = selectionStripMount
    ? createSelectionStrip(selectionStripMount, {
        getSelectedToken: () => store.getSelectedToken(),
        getInspectedToken: inspectedToken,
        getInspectionDistance: (from, to) => {
          const level = store.getActiveLevel();
          return level && from.levelId === level.id && to.levelId === level.id
            ? distanceBetweenFootprints(level, from, to) : null;
        },
        // État ABSOLU publié, comme le bouton du MJ : `token.mounted` est rejouable. La zone se
        // recalcule d'elle-même, `setTokenMounted` appelant `rafraichirZoneAtteignable`.
        onToggleMounted: (token) => {
          const suivant = !(token.mounted === true);
          try {
            store.setTokenMounted(token.id, suivant);
          } catch (err) {
            console.error('Monture refusée :', err);
            return;
          }
          transport?.publish({
            type: 'token.mounted',
            payload: { tokenId: token.id, mounted: suivant },
            at: Date.now(),
            by: 'players',
          });
        },
      })
    : null;

  let invalidatePendingMoveTap = () => {};

  refreshTokenVisibility = () => {
    const { selectedToken, activeLevel } = store.getState();
    if (selectedToken && (!isPlayerManipulableToken(selectedToken, store.getTurn()) || !activeLevel ||
        !isTokenVisible(selectedToken, activeLevel))) {
      movePlanning.cancel();
      store.selectToken(null);
    }
    selectionStrip?.update();
  };

  // Bouton d'annulation du mouvement du tour (décision 7 du 22/11/2026, CA22–CA27) :
  // même moule que `player-fullscreen-btn`, à `right: 116px` (à gauche de l'aide et du plein
  // écran). N'existe dans le DOM que si `getTurn()` désigne un PJ de cette tablette avec
  // `spentCells > 0`.
  const turnUndoButton = document.createElement('button');
  turnUndoButton.id = 'player-turn-undo-btn';
  turnUndoButton.type = 'button';
  turnUndoButton.style.position = 'fixed';
  turnUndoButton.style.top = '12px';
  turnUndoButton.style.right = '116px';
  turnUndoButton.style.zIndex = '9500';
  turnUndoButton.style.width = '44px';
  turnUndoButton.style.height = '44px';
  turnUndoButton.style.display = 'flex';
  turnUndoButton.style.alignItems = 'center';
  turnUndoButton.style.justifyContent = 'center';
  turnUndoButton.style.padding = '0';
  // Thème du chantier C-10 (`css/gm.css`) : brun sombre, liseré de laiton, texte parchemin.
  // ⛔ `border-box` explicite : avec le `border-box` par défaut (`content-box`), le liseré d'un
  // pixel porterait la boîte à 46 px et la cible tactile de 44 px annoncée au CdC serait fausse —
  // l'e2e mesure cette boîte.
  turnUndoButton.style.boxSizing = 'border-box';
  turnUndoButton.style.border = '1px solid rgba(217, 168, 78, 0.55)';
  turnUndoButton.style.borderRadius = '6px';
  turnUndoButton.style.background = 'rgba(32, 27, 23, 0.74)';
  turnUndoButton.style.color = '#ece4d6';
  turnUndoButton.style.opacity = '0.4';
  turnUndoButton.style.transition = 'opacity 0.2s ease';
  turnUndoButton.style.cursor = 'pointer';
  turnUndoButton.style.touchAction = 'manipulation';
  turnUndoButton.style.setProperty('-webkit-tap-highlight-color', 'transparent');
  turnUndoButton.title = 'Annuler le mouvement du tour';
  turnUndoButton.setAttribute('aria-label', turnUndoButton.title);
  turnUndoButton.innerHTML = ICON_TURN_UNDO;
  turnUndoButton.addEventListener('pointerdown', () => { turnUndoButton.style.opacity = '1'; });
  turnUndoButton.addEventListener('pointerenter', () => { turnUndoButton.style.opacity = '1'; });
  turnUndoButton.addEventListener('pointerup', () => { turnUndoButton.style.opacity = '0.4'; });
  turnUndoButton.addEventListener('pointerleave', () => { turnUndoButton.style.opacity = '0.4'; });
  turnUndoButton.addEventListener('pointercancel', () => { turnUndoButton.style.opacity = '0.4'; });

  function syncTurnUndoButton() {
    // ⛔ Pas de bouton tant qu'une image partagée est à l'écran. La croix de fermeture est à
    // `right: 124px` sur 64 px de large (124 → 188) ; ce bouton occupe 116 → 160 et porte un
    // `z-index` de 9500 contre 9000 pour l'overlay : il recouvrirait la moitié gauche de la
    // croix et volerait le tap qui ferme l'image. Les deux ne coexistent donc jamais — l'image
    // se ferme d'abord, le bouton revient ensuite.
    if (typeof document !== 'undefined' && document.getElementById('image-share-overlay')) {
      if (turnUndoButton.isConnected) turnUndoButton.remove();
      return;
    }
    const turn = store.getTurn();
    const token = turn
      ? store.getRenderSnapshot().campaign?.tokens.find((t) => t.id === turn.tokenId) ?? null
      : null;
    const show = Boolean(
      turn &&
      turn.spentCells > 0 &&
      token &&
      isLinkedToken(token) &&
      !token.hidden &&
      isPlayerManipulableToken(token, turn)
    );
    if (show) {
      if (!turnUndoButton.isConnected) document.body.appendChild(turnUndoButton);
    } else if (turnUndoButton.isConnected) {
      turnUndoButton.remove();
    }
  }

  turnUndoButton.addEventListener('click', () => {
    const turn = store.getTurn();
    if (!turn || turn.spentCells <= 0) {
      syncTurnUndoButton();
      return;
    }
    const token = store.getRenderSnapshot().campaign?.tokens.find((t) => t.id === turn.tokenId) ?? null;
    if (!token || !isLinkedToken(token) || token.hidden || !isPlayerManipulableToken(token, turn)) {
      syncTurnUndoButton();
      return;
    }
    movePlanning.cancel();
    try {
      store.undoTurnMove(turn.tokenId);
    } catch {
      const feedbackCell = store.getActiveLevelId() === turn.startLevelId ? turn.startCell : token.cell;
      moveZoneLayer.showDestinationFeedback(feedbackCell, 'refused');
      requestRender();
      return;
    }
    transport?.publish({
      type: 'turn.undo',
      payload: { tokenId: turn.tokenId },
      at: Date.now(),
      by: 'players',
    });
    syncTurnUndoButton();
    requestRender();
  });

  let lastTurnSignature = '';
  const unsubscribeStore = store.subscribe((change) => {
    const moveState = store.getState();
    movePlanning.clearIfLevelDiffers(moveState.activeLevelId || '');
    const turn = store.getTurn();
    const turnSignature = turn ? `${turn.tokenId}:${turn.spentCells}` : '';
    const turnChanged = turnSignature !== lastTurnSignature;
    lastTurnSignature = turnSignature;
    if (!change?.session || turnChanged) {
      movePlanning.reconcile(moveState.selectedToken, moveState.activeLevel, true);
    }
    refreshTokenVisibility();
    syncTurnUndoButton();
    invalidatePendingMoveTap();
    requestRender();
    // Un masque de session n'est pas dans l'instantané : rien à réécrire dans Firestore (C2).
    if (!change?.session) {
      if (!applyingRemote) generationCampagne += 1;
      scheduleSnapshot();
    }
    // L'étage affiché est mémorisé à chaque changement, et pas seulement quand la table en
    // choisit un : c'est ce qui fait qu'un F5 retrouve l'étage où la séance en était, y
    // compris avant qu'un sélecteur existe pour en changer (UX-12).
    memoriserEtage(store.getActiveLevelId());
    playerLevelSelector?.update();
  });

  /** @type {(() => void)|null} */
  let unsubscribeEvents = null;
  if (transport) {
    unsubscribeEvents = transport.subscribe((event) => {
      if (!event.recovered && transportExtended.isOwnEvent?.(event)) return;
      // ⛔ Plus de `view.change` (D-6, tranché le 23/09/2026) : chaque écran déplace et zoome sa
      // vue indépendamment, toujours. Un événement de ce type encore présent dans la file d'une
      // ancienne session est ignoré par `applyNetworkEvent`, qui ne le connaît pas.
      // Un ping n'est pas une mutation de l'état de jeu : il ne passe pas par `applyNetworkEvent`,
      // qui le laisserait tomber silencieusement. Traité ici, à part,
      // pour la même raison — un effet local, sans persistance et sans rejeu. Un joueur qui rejoint
      // la séance ne doit surtout pas voir un vieux ping ressurgir.
      if (event.type === 'ping') {
        const p = /** @type {any} */ (event.payload) || {};
        if (p.mapPos && Number.isFinite(p.mapPos.x) && Number.isFinite(p.mapPos.y)) {
          // ⛔ `Date.now()` local, pas `event.at`. Voir `PING_DURATION_MS`.
          currentPing = { levelId: p.levelId, mapPos: p.mapPos, at: Date.now(), fromGm: event.by === 'gm' };
          requestRender();
        }
        return;
      }
      // Effets de blessure et de mort (contrat §9) : éphémères, hors `applyNetworkEvent`, jamais
      // rejoués. Un pion caché ou inconnu ne joue rien sur la tablette.
      if (event.type === 'fx') {
        const p = /** @type {any} */ (event.payload) || {};
        const fx = parseFx(p.kind, p);
        const token = typeof p.tokenId === 'string' ? store.getRenderSnapshot().campaign?.tokens.find((t) => t.id === p.tokenId) : null;
        if (fx && token && shouldPlayFx(token, true)) {
          fxLayer.play(fx, { tokenId: token.id, now: Date.now(), reducedMotion: prefersReducedMotion() });
          requestRender();
        }
        return;
      }
      // ⛔ **`level.select` est ignoré ici, et c'est tout UX-10.** Le MJ change d'étage pour
      // vérifier une carte ou préparer la suite ; la table n'a aucune raison d'y être emmenée.
      // L'événement continue d'exister et de circuler — il porte l'étage du MJ, dont son propre
      // instantané a besoin — mais il ne décide plus de ce que six personnes regardent.
      //
      // ⚠ Il est écarté **avant** `applyNetworkEvent` et non dans le réducteur : le réducteur est
      // partagé par les deux vues, et le MJ, lui, doit continuer de l'appliquer.
      if (event.type === 'level.select') return;

      applyingRemote = true;
      try {
        applyNetworkEvent(event);
      } finally {
        applyingRemote = false;
      }
      // C3 (D-10) : le MJ a refusé le coup de la table — la case était prise. Le pion vient de
      // revenir ; le même retour transitoire qu'un refus local dit pourquoi.
      const donnees = /** @type {any} */ (event.payload);
      if (event.type === 'token.move' && donnees?.refus === 'occupied' && donnees.from) {
        moveZoneLayer.showDestinationFeedback(donnees.from, 'occupied');
        requestRender();
      }
    });

    try {
      const snapshot = /** @type {any} */ (await transport.snapshot());
      applyingRemote = true;
      try {
        if (snapshot && (snapshot.campaign || snapshot.levels)) {
          // ⭐ L'étage mémorisé localement **prime sur celui de l'instantané**, qui est celui du
          // MJ. Sans cette ligne, chaque rechargement de la tablette la ramènerait sur l'étage du
          // MJ : le découplage tiendrait pendant la séance et se déferait au premier F5.
          // `restoreFromSnapshot` retombe sur le premier étage si l'identifiant mémorisé ne
          // désigne plus rien — un étage supprimé entre deux séances, par exemple.
          store.restoreFromSnapshot(snapshot, {
            sessionId,
            activeLevelId: lireEtageMemorise() ?? undefined,
          });
        } else {
          store.loadFromLocalStorage(sessionId);
          const persistenceError = store.getLastPersistenceError();
          if (persistenceError) networkStatus.update('error', persistenceError);
        }
      } finally {
        applyingRemote = false;
      }
    } catch (error) {
      networkStatus.update('error', error);
      store.loadFromLocalStorage(sessionId);
    }
  } else {
    store.loadFromLocalStorage(sessionId);
    const persistenceError = store.getLastPersistenceError();
    if (persistenceError) networkStatus.update('error', persistenceError);
  }

  /**
   * Réclame au MJ la rediffusion du masque de vision courante.
   *
   * Le masque exploré remonte de `localStorage`, la vision non — et le canal ne rejoue rien.
   * Sans cette demande, la tablette affiche le voile « exploré mais non visible » là où les PJ
   * voient, jusqu'à ce qu'un déplacement change la signature côté MJ et le décide à publier.
   * C'est le défaut de séance du 6 août 2026.
   *
   * Appelée à deux moments, qui ne se recouvrent pas :
   *  - au démarrage, y compris après un F5 ou un contexte d'onglet abandonné par le système ;
   *  - au retour au premier plan, car les événements publiés pendant que la tablette dormait
   *    ne sont pas rejoués — l'écoute reprend strictement après la dernière clé connue.
   *
   * ⚠ Amendement C-8 (10/09/2026) : plus de `levelId` dans le payload. La réponse du MJ ne se
   * limite plus à l'étage affiché — il republie l'exploré de tous les étages qu'il détient
   * (`QUESTIONS-EN-ATTENTE.md` C-8) — donc un champ que personne ne lit mentirait à chaque
   * relecture.
   */
  function requestVisionResend() {
    if (!transport) return;
    transport.publish({
      type: VISION_REQUEST_EVENT,
      payload: {},
      at: Date.now(),
      by: 'players',
    });
  }

  // ⛔ Réessai d'une reprise ÉCHOUÉE (audit du 22/09, C5). Une resynchro qui lève laissait le
  // client sans écoute, et rien ne réessayait avant le prochain `visibilitychange` — or la
  // tablette castée ne se masque jamais : elle restait figée jusqu'au F5. Le réessai porte sur
  // TOUTE la reprise (resynchro, instantané, restauration), pas sur le seul canal : rouvrir
  // l'écoute sans relire l'état laisserait perdus les événements manqués. Délai doublé à chaque
  // échec, de 2 s à 30 s ; un simple dépassement d'échéance n'en déclenche pas, la reprise
  // continuant alors sa route.
  /** @type {ReturnType<typeof setTimeout>|null} */
  let repriseDiffereeTimer = null;
  let delaiReprise = 2000;
  // Vrai quand la reprise précédente a écarté son instantané parce que la table jouait pendant
  // l'attente (A8) : le bail est alors rafraîchi, mais l'état manqué reste à relire.
  let relectureDue = false;
  const planifierNouvelleReprise = () => {
    if (repriseDiffereeTimer !== null) return;
    repriseDiffereeTimer = setTimeout(() => {
      repriseDiffereeTimer = null;
      void onVisibilityRestored();
    }, delaiReprise);
    delaiReprise = Math.min(30_000, delaiReprise * 2);
  };

  const onVisibilityRestored = async () => {
    if (typeof document !== 'undefined' && document.hidden) return;
    // ⛔ Ne relire l'instantané QUE si le bail de rétention a réellement péri. L'instantané est
    // réécrit 250 ms après chaque mutation : il peut donc être en retard sur un événement déjà
    // appliqué ici. Le relire à chaque réveil ferait RÉGRESSER l'état — une porte rouverte, un
    // pion revenu en arrière — et définitivement, puisque cet événement ne sera pas redélivré.
    if (relectureDue || transportExtended?.mayHaveMissedEvents?.()) {
      relectureDue = false;
      const repere = generationCampagne;
      // ⛔ Attente BORNÉE. Le transport rouvre son canal par des opérations réseau qui ne
      // rejettent pas hors connexion : sans échéance, ce `await` pourrait ne jamais rendre la
      // main et `requestVisionResend()` ne partirait plus JAMAIS. Au dépassement on journalise
      // et on continue ; la resynchro poursuit sa route et s'appliquera si elle aboutit.
      const reprise = (async () => {
        await transportExtended.resync();
        const snapshot = /** @type {any} */ (await transportExtended.snapshot());
        // ⛔ Audit du 08/11, A8 : la table a joué pendant l'attente. L'instantané, lu avant ce
        // coup, le défairait sous ses yeux (règle 4). On l'écarte et on relit plus tard : le coup
        // est parti au MJ, qui l'écrit (A4), et la relecture suivante le contiendra.
        if (generationCampagne !== repere) {
          relectureDue = true;
          return;
        }
        applyingRemote = true;
        try {
          if (snapshot && (snapshot.campaign || snapshot.levels)) {
            // ⛔ L'étage de la TABLE, comme au démarrage (audit du 22/09, A3) : l'instantané
            // porte celui du MJ, et le relire tel quel faisait basculer l'écran des joueurs.
            store.restoreFromSnapshot(snapshot, {
              sessionId,
              activeLevelId: lireEtageMemorise() ?? undefined,
            });
          }
        } finally {
          applyingRemote = false;
        }
      })();
      reprise.then(
        // Relecture écartée (A8) : on retente seul, sans attendre un nouveau réveil — la tablette
        // castée ne se masque jamais.
        () => { if (relectureDue) planifierNouvelleReprise(); else delaiReprise = 2000; },
        () => planifierNouvelleReprise()
      );
      try {
        await withDeadline(reprise, 'resynchro au réveil');
      } catch (error) {
        networkStatus.update('error', error);
      }
    }
    // Toujours, et APRÈS la resynchro quand il y en a une : la demande doit partir alors que
    // l'écoute est rebranchée, sans quoi la réponse du MJ n'atteindrait personne.
    requestVisionResend();
  };
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityRestored);
  }
  requestVisionResend();

  const playerControls = bootstrapPlayerView({
    element: canvas,
    camera,
    transport: transport || undefined,
    movePlanning,
    onMovePlanChanged: requestRender,
    onDestinationRejected: (cell, kind) => {
      moveZoneLayer.showDestinationFeedback(cell, kind);
      requestRender();
    },
    onTemplatePreview: (preview) => {
      templateDragPreview = preview;
      requestRender();
    },
    isTokenVisible,
    getInsetTop: () => levelTabsMount?.offsetHeight ?? 0,
    onInspectToken: (token) => {
      inspection = token ? { tokenId: token.id, selectedTokenId: store.getSelectedToken()?.id ?? null } : null;
      selectionStrip?.update();
    },
  });
  invalidatePendingMoveTap = () => playerControls.pointerInput.invalidatePendingTapIfContextChanged();
  const versionBadge = mountPlayerVersionBadge({
    transport: transport || undefined,
    role: 'players',
  });
  const imageShareOverlay = mountImageShareOverlay({
    transport: transport || undefined,
    // Le bouton d'annulation du tour partage le coin haut-droit avec la croix de l'image : il se
    // retire pendant l'affichage et revient à la fermeture (voir `syncTurnUndoButton`).
    onVisibility: () => syncTurnUndoButton(),
  });
  const destroyGameHelp = mountPlayerGameHelp();

  function persistCamera() {
    try {
      localStorage.setItem(
        `rpg_camera_${sessionId}`,
        JSON.stringify({ x: camera.x, y: camera.y, zoom: camera.zoom })
      );
    } catch {
      // Le rendu continue ; la caméra sera simplement réinitialisée au prochain chargement.
    }
  }

  const originalEmit = playerControls.pointerInput.emit.bind(playerControls.pointerInput);
  playerControls.pointerInput.emit = (intention) => {
    if (intention.type === 'doubleTap') {
      const activeLevel = store.getActiveLevel();
      if (activeLevel && !store.getSelectedToken()) {
        currentPing = { levelId: activeLevel.id, mapPos: intention.mapPos, at: Date.now() };
        transport?.publish({
          type: 'ping', payload: { levelId: activeLevel.id, mapPos: intention.mapPos },
          at: Date.now(), by: 'players',
        });
        requestRender();
      }
    } else if (intention.type === 'panBy') {
      camera.setPan(
        camera.x - intention.deltaX / camera.zoom,
        camera.y - intention.deltaY / camera.zoom
      );
      cameraChoisie = true;
      persistCamera();
      requestRender();
    } else if (intention.type === 'pinchZoom') {
      const before = camera.screenToMap(intention.center);
      camera.setZoom(camera.zoom * intention.scaleFactor);
      const after = camera.screenToMap(intention.center);
      camera.setPan(camera.x + before.x - after.x, camera.y + before.y - after.y);
      cameraChoisie = true;
      persistCamera();
      requestRender();
    }
    originalEmit(intention);
  };

  const onResize = () => {
    stage.resize();
    camera.setViewport(stage.width, stage.height);
    if (!cameraChoisie) lastActiveLevelId = null;
    requestRender();
  };
  const onKeyDown = (/** @type {KeyboardEvent} */ event) => {
    const target = /** @type {HTMLElement|null} */ (event.target);
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
      return;
    }
    if (event.key === 'p' || event.key === 'P') frameProbe.toggleOverlay();
  };
  if (typeof document !== 'undefined') document.addEventListener('keydown', onKeyDown);
  window.addEventListener('resize', onResize);
  syncTurnUndoButton();
  requestRender();

  const destroy = () => {
    if (typeof document !== 'undefined') document.removeEventListener('keydown', onKeyDown);
    if (repriseDiffereeTimer !== null) clearTimeout(repriseDiffereeTimer);
    refreshTokenVisibility = () => {};
    playerControls.detach();
    movePlanning.dispose();
    versionBadge.detach();
    imageShareOverlay.detach();
    destroyGameHelp();
    playerLevelSelector?.destroy();
    undoStepButton.remove();
    turnUndoButton.remove();
    selectionStrip?.destroy();
    cleanupMobileLocks();
    unsubscribeStore();
    unsubscribeEvents?.();
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibilityRestored);
    }
    snapshotSaver.stop();
    window.removeEventListener('resize', onResize);
    frameLoop.stop();
    // Sans ceci, le flux vidéo survit à la destruction de la vue : Chromium continue de
    // décoder tant que l'élément existe avec une source. Sur la tablette, c'est de la
    // batterie et de la mémoire vidéo consommées pour une vue qui n'existe plus.
    videoBackdrop.detach();
    frameProbe.stop();
    transport?.disconnect();
    networkStatus.remove();
  };

  return {
    canvas: stage.canvas,
    context: stage.context,
    camera,
    frameLoop,
    frameProbe,
    pointerInput: playerControls.pointerInput,
    backgroundLayer,
    tokensLayer,
    getPlayerVisibleCanvas,
    getPlayerExploredCanvas,
    transport,
    sessionId,
    destroy,
  };
}

function autoStart() {
  const globalOptions =
    typeof window !== 'undefined'
      ? /** @type {any} */ (window).__RPG_APP_OPTIONS__ || {}
      : {};
  const promise = bootstrapPlayerApp(globalOptions).then((app) => {
    /** @type {any} */ (window).__RPG_APP__ = app;
    return app;
  });
  /** @type {any} */ (window).__RPG_APP_PROMISE__ = promise;
}

if (typeof document !== 'undefined' && document.readyState !== 'loading') {
  autoStart();
} else if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', autoStart, { once: true });
}

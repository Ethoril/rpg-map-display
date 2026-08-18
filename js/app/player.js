// @ts-check

import { initStage, renderLayerStack } from '../render/stage.js';
import { Camera } from '../render/camera.js';
import { FrameLoop } from '../render/frame.js';
import { FrameProbe } from '../render/probe.js';
import { BackgroundLayer } from '../render/layers/background.js';
import { VideoBackdrop } from '../render/videoBackdrop.js';
import { GridLayer } from '../render/layers/gridLayer.js';
import { MoveZoneLayer } from '../render/layers/moveZone.js';
import { TokensLayer } from '../render/layers/tokens.js';
import { FogLayer } from '../render/layers/fogLayer.js';
import { PortalsLayer } from '../render/layers/portals.js';
import { LinksLayer } from '../render/layers/links.js';
import { TemplatesLayer } from '../render/layers/templates.js';
import { PingsLayer } from '../render/layers/pings.js';
import { decodeFogPng, getOrExtractMaskAlpha, isCellVisibleInMask } from '../vision/fog.js';
import { createPlayerLevelSelector } from '../ui/player/levelSelector.js';
import { gridFor } from '../grid/index.js';
import { bootstrapPlayerView } from '../ui/player/bootstrap.js';
import { isPlayerManipulableToken } from '../input/tokenHit.js';
import { mountPlayerVersionBadge } from '../ui/versionBadge.js';
import { mountHandoutOverlay } from '../ui/player/handoutOverlay.js';
import { VISION_REQUEST_EVENT } from '../core/constants.js';
import { createNetworkStatus, connectSession, normalizeSessionId, withDeadline } from './session.js';
import { applyNetworkEvent, createSnapshotPayload } from './networkEvents.js';
import * as store from '../state/store.js';

/** @typedef {import('../transport/Transport.js').Transport} Transport */

// Icônes du bouton plein écran : quatre coins qui s'écartent (entrer) ou se rejoignent
// (sortir). Dessinées en SVG plutôt qu'en caractère Unicode — les glyphes « plein écran »
// ne sont pas dans toutes les fontes système, et un carré tofu au-dessus de la carte est
// pire que pas de bouton.
const ICON_FULLSCREEN_ENTER =
  '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>';
const ICON_FULLSCREEN_EXIT =
  '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8h3a2 2 0 0 0 2-2V3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M21 16h-3a2 2 0 0 0-2 2v3"/></svg>';

/**
 * La case sur laquelle une invite de franchissement a le droit de s'allumer, ou `null`.
 *
 * ⚠ Ces conditions doivent rester l'exact équivalent de la branche de franchissement de
 * `ui/player/bootstrap.js` (« Lot 3, S-03 »). Les dissocier ferait promettre à l'écran un geste
 * que le tap refuserait ensuite en silence, et le joueur retaperait indéfiniment — c'est-à-dire
 * précisément le défaut de séance que cette invite existe pour corriger.
 *
 * `hidden` en fait partie, et la branche de franchissement de `bootstrap.js` le teste désormais
 * aussi. Les deux ont été alignées le 16 août 2026 : l'écran se taisait pour un PJ rendu invisible
 * par le MJ, mais le tap le franchissait quand même — `updateToken` ne purge pas la sélection,
 * contrairement à `removeToken`, donc une sélection d'avant le masquage survit. Le personnage
 * changeait d'étage sans que rien n'apparaisse à l'écran.
 *
 * ⛔ La visibilité en fait partie aussi, et pour une raison de fond : l'invite se rend AU-DESSUS
 * du brouillard, donc rien ne la masque. Or `findHitToken` ne consulte pas le fog : un joueur peut
 * sélectionner son pion à l'aveugle sur un écran noir. Sans garde, « Retaper pour prendre
 * l'escalier » s'y écrivait, sous un pion que la couche des pions avait écarté — et apprenait au
 * joueur qu'il y a une liaison là.
 *
 * ⚠ Les DEUX conditions de `TokensLayer`, pas une seule. Une première version ne testait que le
 * masque publié ; c'est nécessaire mais pas suffisant, car la couche des pions écarte en plus tout
 * pion dont la case d'ancrage n'est pas dans ce masque — PJ hors de toute lumière, masque calculé
 * pour d'autres, masque en retard d'une publication. L'invite se serait peinte sur du noir dans
 * tous ces cas-là.
 *
 * @param {{selectedToken: import('../core/types.js').Token|null}} state
 * @param {import('../core/types.js').Level} activeLevel
 * @param {HTMLCanvasElement|null} visibleCanvas Masque de vision courant de cet étage
 * @returns {{a: number, b: number}|null}
 */
function promptAtCellOf(state, activeLevel, visibleCanvas) {
  const porteur = state.selectedToken;
  if (!porteur || porteur.levelId !== activeLevel.id) return null;
  if (porteur.hidden) return null;
  if (!isPlayerManipulableToken(porteur)) return null;
  if (store.getSessionVision(activeLevel.id) === null) return null;
  const maskAlpha = visibleCanvas
    ? getOrExtractMaskAlpha(visibleCanvas, activeLevel.widthCells, activeLevel.heightCells)
    : null;
  if (!maskAlpha) return null;
  if (
    !isCellVisibleInMask(
      porteur.cell,
      maskAlpha,
      activeLevel.widthCells,
      activeLevel.heightCells
    )
  ) {
    return null;
  }
  return porteur.cell;
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
    // Au-dessus du handout (9000), sous l'avertissement de version (9999) : une image
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
  const portalsLayer = new PortalsLayer();
  const linksLayer = new LinksLayer();
  const moveZoneLayer = new MoveZoneLayer();
  const templatesLayer = new TemplatesLayer();
  const pingsLayer = new PingsLayer();
  /**
   * Ping courant. ⛔ `at` est posé à la **réception locale**, jamais lu de `event.at` : c'est le
   * poste où la règle compte le plus, la tablette de ce projet ayant été mesurée 5,3 s en avance.
   * Un ping jugé sur l'horloge du MJ n'apparaîtrait jamais ici. Voir `PING_DURATION_MS`.
   * @type {{levelId: string, mapPos: {x: number, y: number}, at: number}|null}
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

    void decodeFogPng(png, level.widthCells, level.heightCells).then((canvas) => {
      // Plusieurs PNG peuvent décoder dans le désordre. Ne jamais laisser un ancien masque
      // écraser la valeur que le transport a déjà remplacée dans le store.
      if (store.getSessionFog(level.id) !== png) return;
      playerExploredCanvasMap.set(level.id, { png, canvas });
      playerLevelSelector?.update();
      requestRender();
    });

    return existing ? existing.canvas : null;
  }

  /** @type {Map<string, { png: string, canvas: any }>} */
  const playerVisibleCanvasMap = new Map();

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

    void decodeFogPng(png, level.widthCells, level.heightCells).then((canvas) => {
      // Même garde que pour le fog exploré : une torche ou une porte peut générer plusieurs
      // `vision.update` successifs alors que les décompressions précédentes sont encore actives.
      if (store.getSessionVision(level.id) !== png) return;
      playerVisibleCanvasMap.set(level.id, { png, canvas });
      requestRender();
    });

    return existing ? existing.canvas : null;
  }

  const urlParams = new URLSearchParams(window.location.search);
  const probeOnStart = urlParams.get('probe') === '1';

  // Même normalisation que côté MJ : le code est recopié à la main sur la tablette, la
  // casse ne doit pas décider silencieusement d'une autre session.
  const sessionId =
    options.sessionId || normalizeSessionId(urlParams.get('session')) || 'local-player';
  const cameraFollow = urlParams.get('camera') === 'follow';
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
  /** @param {import('../core/types.js').Level|null} activeLevel */
  function fitActiveLevel(activeLevel) {
    if (!activeLevel || activeLevel.id === lastActiveLevelId) return;
    lastActiveLevelId = activeLevel.id;
    if (restoredCamera) {
      restoredCamera = false;
      return;
    }
    const grid = gridFor(activeLevel);
    const bottomRight = grid.mapFromCellPoint({
      cellX: activeLevel.widthCells,
      cellY: activeLevel.heightCells,
    });
    camera.setPan(bottomRight.x / 2, bottomRight.y / 2);
    camera.setZoom(
      Math.min(stage.width / Math.max(1, bottomRight.x), stage.height / Math.max(1, bottomRight.y))
    );
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
    if (!activeLevel) return;

    const grid = gridFor(activeLevel);
    const bottomRight = grid.mapFromCellPoint({
      cellX: activeLevel.widthCells,
      cellY: activeLevel.heightCells,
    });
    void backgroundLayer.load(activeLevel.imageUrl);

    stage.context.save();
    stage.context.scale(stage.resolution, stage.resolution);
    camera.applyToContext(stage.context);
    // ⛔ **Après** `applyToContext`, jamais avant : cette méthode **borne `camera.zoom` en
    // le mutant**. Voir le commentaire jumeau dans `gm.js`.
    videoBackdrop.place(camera, bottomRight.x, bottomRight.y, stage.width, stage.height);
    let animationActive = false;
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
        backgroundLayer.render(stage.context, bottomRight.x, bottomRight.y, {
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
          reachableCells: state.reachableCells,
        });
        layerDurations.moveZone = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - lStart;
      },
      templates: () => {
        lStart = typeof performance !== 'undefined' ? performance.now() : Date.now();
        templatesLayer.render(stage.context, grid, activeLevel, state.campaign?.templates ?? [], true);
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
      feedback: () => {
        lStart = typeof performance !== 'undefined' ? performance.now() : Date.now();
        animationActive ||= moveZoneLayer.renderDestinationFeedback(stage.context, grid, {
          now: Date.now(),
          zoom: camera.zoom,
        });
        // ⛔ Au-dessus du brouillard, et pas avec le reste des liaisons au rang 5. L'invite
        // s'écrit dans la case du VOISIN, que rien ne garantit explorée — voir `renderPrompt`.
        linksLayer.renderPrompt(stage.context, grid, activeLevel, state.campaign?.links ?? [], {
          zoom: camera.zoom,
          promptAtCell: promptAtCellOf(state, activeLevel, getPlayerVisibleCanvas(activeLevel)),
        });
        layerDurations.feedback = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - lStart;
      },
      pings: () => {
        const result = pingsLayer.render(stage.context, grid, activeLevel, {
          ping: currentPing,
          now: Date.now(),
          zoom: camera.zoom,
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
  /** @type {Transport|null} */
  let transport = null;
  try {
    transport = await connectSession({
      injectedTransport: options.transport || null,
      firebaseConfig: options.firebaseConfig || null,
      sessionId,
      role: 'players',
      loginHost: document.body,
      onStatus: networkStatus.update,
    });
  } catch {
    transport = null;
  }

  const transportExtended = /** @type {any} */ (transport);
  let applyingRemote = false;
  /** @type {ReturnType<typeof setTimeout>|null} */
  let snapshotTimer = null;

  function scheduleSnapshot() {
    if (!transportExtended?.saveSnapshot || applyingRemote) return;
    if (snapshotTimer !== null) clearTimeout(snapshotTimer);
    snapshotTimer = setTimeout(() => {
      snapshotTimer = null;
      const snapshot = createSnapshotPayload();
      const diagnostic = transportExtended.getSnapshotSizeDiagnostic?.(snapshot);
      if (diagnostic?.severity === 'warning') networkStatus.update('warning', diagnostic.message);
      Promise.resolve(transportExtended.saveSnapshot(snapshot)).catch((error) =>
        networkStatus.update('error', error)
      );
    }, 250);
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

  const unsubscribeStore = store.subscribe(() => {
    requestRender();
    scheduleSnapshot();
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
      if (transportExtended.isOwnEvent?.(event)) return;
      if (cameraFollow && event.type === 'view.change') {
        const payload = /** @type {any} */ (event.payload);
        if (payload?.camera) {
          camera.setPan(payload.camera.x, payload.camera.y);
          camera.setZoom(payload.camera.zoom);
          requestRender();
        }
        return;
      }
      // Un ping n'est pas une mutation de l'état de jeu : il ne passe pas par `applyNetworkEvent`,
      // qui le laisserait tomber silencieusement. Traité ici comme `view.change` juste au-dessus,
      // pour la même raison — un effet local, sans persistance et sans rejeu. Un joueur qui rejoint
      // la séance ne doit surtout pas voir un vieux ping ressurgir.
      if (event.type === 'ping') {
        const p = /** @type {any} */ (event.payload) || {};
        if (p.mapPos && Number.isFinite(p.mapPos.x) && Number.isFinite(p.mapPos.y)) {
          // ⛔ `Date.now()` local, pas `event.at`. Voir `PING_DURATION_MS`.
          currentPing = { levelId: p.levelId, mapPos: p.mapPos, at: Date.now() };
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
   */
  function requestVisionResend() {
    if (!transport) return;
    transport.publish({
      type: VISION_REQUEST_EVENT,
      payload: { levelId: store.getActiveLevel()?.id ?? null },
      at: Date.now(),
      by: 'players',
    });
  }

  const onVisibilityRestored = async () => {
    if (typeof document !== 'undefined' && document.hidden) return;
    // ⛔ Ne relire l'instantané QUE si le bail de rétention a réellement péri. L'instantané est
    // réécrit 250 ms après chaque mutation : il peut donc être en retard sur un événement déjà
    // appliqué ici. Le relire à chaque réveil ferait RÉGRESSER l'état — une porte rouverte, un
    // pion revenu en arrière — et définitivement, puisque cet événement ne sera pas redélivré.
    if (transportExtended?.mayHaveMissedEvents?.()) {
      // ⛔ Attente BORNÉE. Le transport rouvre son canal par des opérations réseau qui ne
      // rejettent pas hors connexion : sans échéance, ce `await` pourrait ne jamais rendre la
      // main et `requestVisionResend()` ne partirait plus JAMAIS. Au dépassement on journalise
      // et on continue ; la resynchro poursuit sa route et s'appliquera si elle aboutit.
      const reprise = (async () => {
        await transportExtended.resync();
        const snapshot = /** @type {any} */ (await transportExtended.snapshot());
        applyingRemote = true;
        try {
          if (snapshot && (snapshot.campaign || snapshot.levels)) {
            store.restoreFromSnapshot(snapshot, { sessionId });
          }
        } finally {
          applyingRemote = false;
        }
      })();
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
    onDestinationRejected: (cell, kind) => {
      moveZoneLayer.showDestinationFeedback(cell, kind);
      requestRender();
    },
  });
  const versionBadge = mountPlayerVersionBadge({
    transport: transport || undefined,
    role: 'players',
  });
  const handoutOverlay = mountHandoutOverlay();

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
    if (intention.type === 'panBy') {
      camera.setPan(
        camera.x - intention.deltaX / camera.zoom,
        camera.y - intention.deltaY / camera.zoom
      );
      persistCamera();
      requestRender();
    } else if (intention.type === 'pinchZoom') {
      const before = camera.screenToMap(intention.center);
      camera.setZoom(camera.zoom * intention.scaleFactor);
      const after = camera.screenToMap(intention.center);
      camera.setPan(camera.x + before.x - after.x, camera.y + before.y - after.y);
      persistCamera();
      requestRender();
    }
    originalEmit(intention);
  };

  const onResize = () => {
    stage.resize();
    camera.setViewport(stage.width, stage.height);
    lastActiveLevelId = null;
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
  requestRender();

  const destroy = () => {
    if (typeof document !== 'undefined') document.removeEventListener('keydown', onKeyDown);
    playerControls.detach();
    versionBadge.detach();
    handoutOverlay.detach();
    playerLevelSelector?.destroy();
    cleanupMobileLocks();
    unsubscribeStore();
    unsubscribeEvents?.();
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibilityRestored);
    }
    if (snapshotTimer !== null) clearTimeout(snapshotTimer);
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

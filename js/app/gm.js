// @ts-check

import { initStage, renderLayerStack } from '../render/stage.js';
import { Camera } from '../render/camera.js';
import { FrameLoop } from '../render/frame.js';
import { BackgroundLayer } from '../render/layers/background.js';
import { GridLayer } from '../render/layers/gridLayer.js';
import { MoveZoneLayer } from '../render/layers/moveZone.js';
import { TokensLayer } from '../render/layers/tokens.js';
import { FogLayer } from '../render/layers/fogLayer.js';
import { PortalsLayer } from '../render/layers/portals.js';
import { LinksLayer } from '../render/layers/links.js';
import { WallsLayer } from '../render/layers/walls.js';
import { TemplatesLayer } from '../render/layers/templates.js';

import { PointerInput } from '../input/pointer.js';
import { findHitPortal } from '../input/portalHit.js';
import { findHitTemplate } from '../input/templateHit.js';
import { findHitToken } from '../input/tokenHit.js';
import { FrameProbe } from '../render/probe.js';
import { gridFor } from '../grid/index.js';
import { extractBlockedSegments } from '../import/blockedEdges.js';
import {
  GM_SESSION_STORAGE_KEY,
  VISION_MAX_RANGE_CELLS,
  SESSION_EVICT_GM_EVENT,
  VISION_REQUEST_EVENT,
} from '../core/constants.js';

import { createGMPanel } from '../ui/gm/panel.js';
import { snapWallVertex, findWallAt } from '../ui/gm/wallEditor.js';
import { ExploredFog } from '../vision/fog.js';

import {
  createNetworkStatus,
  connectSession,
  createSessionCode,
  normalizeSessionId,
  showEvictionOverlay,
} from './session.js';
import { applyNetworkEvent, createSnapshotPayload } from './networkEvents.js';
import * as store from '../state/store.js';
import { getPresenceList, listOtherGmClients } from '../state/presence.js';

/** @typedef {import('../transport/Transport.js').Transport} Transport */
/** @typedef {import('../core/types.js').MapPoint} MapPoint */

/**
 * @param {import('../core/types.js').Campaign|null} campaign
 * @param {import('../core/types.js').Level|null} activeLevel
 * @param {import('../core/types.js').Cell|null} cell
 */
function tokenAtCell(campaign, activeLevel, cell) {
  if (!campaign || !activeLevel || !cell) return null;
  return (
    campaign.tokens.find((token) => {
      if (token.levelId !== activeLevel.id) return false;
      const size = Math.max(1, token.sizeCells || 1);
      return (
        cell.a >= token.cell.a &&
        cell.a < token.cell.a + size &&
        cell.b >= token.cell.b &&
        cell.b < token.cell.b + size
      );
    }) ?? null
  );
}

function defaultGmSessionId() {
  const existing = sessionStorage.getItem(GM_SESSION_STORAGE_KEY);
  if (existing) return existing;
  // Un UUID était illisible et intypable : le MJ doit dicter ce code, ou le recopier à la
  // main sur la tablette, en n'ayant aucun moyen de le copier-coller d'un appareil à
  // l'autre. Cf. createSessionCode dans app/session.js.
  const created = createSessionCode();
  sessionStorage.setItem(GM_SESSION_STORAGE_KEY, created);
  return created;
}

/**
 * Initialise l'application MJ.
 *
 * @param {Object} [options]
 * @param {HTMLCanvasElement} [options.canvas]
 * @param {HTMLElement} [options.panelContainer]
 * @param {Transport} [options.transport]
 * @param {Record<string, any>} [options.firebaseConfig]
 * @param {string} [options.sessionId]
 */
export async function bootstrapGMApp(options = {}) {
  const canvas =
    options.canvas ||
    /** @type {HTMLCanvasElement|null} */ (document.querySelector('#board')) ||
    document.createElement('canvas');
  const panelContainer =
    options.panelContainer ||
    /** @type {HTMLElement|null} */ (document.querySelector('#gm-panel'));

  const stage = await initStage(canvas);
  const camera = new Camera(stage.width, stage.height);
  /** @type {FrameLoop} */
  let frameLoop;
  const requestRender = () => frameLoop?.requestFrame();

  const backgroundLayer = new BackgroundLayer({ invalidate: requestRender });
  const gridLayer = new GridLayer();
  const wallsLayer = new WallsLayer();
  const portalsLayer = new PortalsLayer();
  const linksLayer = new LinksLayer();
  const moveZoneLayer = new MoveZoneLayer();
  const templatesLayer = new TemplatesLayer();
  const tokensLayer = new TokensLayer({ invalidate: requestRender });
  const fogLayer = new FogLayer();

  /** @type {Map<string, ExploredFog>} */
  const exploredFogMap = new Map();
  /** @type {Map<string, number>} */
  const lastFogPublishTime = new Map();
  /** @type {Map<string, any>} */
  const fogPublishTrailing = new Map();

  /**
   * Obtient ou crée l'instance `ExploredFog` pour un étage donné (Level ou levelId string).
   * Domicile unique de cette création : toute réécriture directe d'un masque exploré
   * en dehors de cette fonction ferait dériver l'état en mémoire.
   *
   * @param {import('../core/types.js').Level|string|null} levelOrId
   * @returns {ExploredFog|null}
   */
  function getExploredFog(levelOrId) {
    if (!levelOrId) return null;
    const level = typeof levelOrId === 'string'
      ? (store.getCampaign()?.levels.find((l) => l.id === levelOrId) ?? null)
      : levelOrId;
    if (!level) return null;
    let fog = exploredFogMap.get(level.id);
    if (!fog || fog.widthCells !== level.widthCells || fog.heightCells !== level.heightCells) {
      fog = new ExploredFog(level.widthCells, level.heightCells);
      exploredFogMap.set(level.id, fog);
      // Le masque qui vient de naître est vierge : la vision courante doit y être
      // reversée, ce que `syncVision` ne fait que sur changement de signature.
      fogLayer.invalidate();

      const savedFog = store.getSessionFog(level.id);
      if (savedFog) {
        // ⚠ `importPng` efface puis redessine : tout ce qui a été révélé entre la
        // création du masque et l'atterrissage de l'import serait perdu **en silence**.
        // On resynchronise donc derrière lui, plutôt que de parier sur l'ordonnancement.
        void fog.importPng(savedFog).then(() => {
          fogLayer.invalidate();
          syncVision();
          requestRender();
        });
      }
    }
    return fog;
  }

  /**
   * Publication du masque exploré au réseau, throttlée à 1 Hz (CdC §7) sauf si immediate est vrai.
   *
   * ⚠ **Traîne (trailing call)** : un déplacement rapide qui s'arrête verrait son
   * dernier état bloqué par le throttle sans ce rappel différé. Le timer envoie le
   * dernier état calculé dès que la fenêtre d'une seconde se libère.
   *
   * @param {string} levelId
   * @param {ExploredFog} exploredFog
   * @param {boolean} [immediate=false]
   */
  function scheduleFogPublish(levelId, exploredFog, immediate = false) {
    const now = Date.now();
    const lastTime = lastFogPublishTime.get(levelId) || 0;
    const reste = 1000 - (now - lastTime);

    if (fogPublishTrailing.has(levelId)) {
      clearTimeout(fogPublishTrailing.get(levelId));
      fogPublishTrailing.delete(levelId);
    }

    if (!immediate && reste > 0) {
      fogPublishTrailing.set(
        levelId,
        setTimeout(() => {
          fogPublishTrailing.delete(levelId);
          scheduleFogPublish(levelId, exploredFog);
        }, reste)
      );
      return;
    }

    lastFogPublishTime.set(levelId, now);
    void exploredFog.exportPng().then((png) => {
      if (!png) return;
      store.setSessionFog(levelId, png);
      transport?.publish({
        type: 'fog.update',
        payload: { levelId, png },
        at: Date.now(),
        by: 'gm',
      });
    });
  }

  /** @type {Map<string, ExploredFog>} */
  const visibleFogMap = new Map();
  /** @type {Map<string, string>} */
  const lastVisibleSignatureMap = new Map();

  /** @type {ReturnType<typeof setTimeout>|null} */
  let visionResendTimer = null;

  /**
   * Rediffuse le masque de vision à la demande d'une vue joueurs.
   *
   * Le cache de signature est **vidé en entier**, pas seulement pour l'étage annoncé par le
   * demandeur : son étage peut être en retard sur celui du MJ, qui est l'autorité. Vider tout
   * un cache de dédoublonnage est sans conséquence — au pire une publication de plus si le MJ
   * change d'étage ensuite — alors que se tromper d'étage laisserait la tablette dans le noir
   * sans que rien ne le signale.
   *
   * ⚠ **Coalescé.** Sans ce délai, dix tablettes qui reviennent ensemble — ou une seule qui
   * répète sa demande — feraient autant de rediffusions d'environ 13 Kio. C'est exactement le
   * régime que la garde anti-rebouclage de `syncVision` existe pour éviter ; on ne le
   * réintroduit pas par la porte de service.
   */
  function scheduleVisionResend() {
    if (visionResendTimer !== null) return;
    visionResendTimer = setTimeout(() => {
      visionResendTimer = null;
      lastVisibleSignatureMap.clear();
      syncVision();
    }, 250);
  }

  /**
   * Publication en temps réel du masque de vision courante (visible).
   *
   * ⚠ La comparaison se fait sur la **signature**, donc AVANT l'encodage. Une première
   * version appelait `exportPng()` à chaque image puis comparait la chaîne obtenue :
   * `getImageData` et deflate — environ 6 ms sur la grande carte — tournaient à chaque
   * image pendant l'animation d'un déplacement, pour presque toujours conclure « rien
   * n'a changé ». C'est aussi un `getImageData` sur le chemin de déplacement, que le
   * critère 8 interdit. `scheduleFogPublish`, juste au-dessus, avait déjà le bon
   * réflexe : filtrer avant de payer.
   *
   * Contrairement au masque exploré, `visible` n'est **pas** throttlé : le critère 10
   * exige qu'ouvrir une porte étende la vision en moins de 300 ms.
   *
   * @param {string} levelId
   * @param {ExploredFog} visibleFog
   * @param {string} signature Signature de la vision courante
   */
  function publishVisibleVision(levelId, visibleFog, signature) {
    if (!transport) return;
    if (lastVisibleSignatureMap.get(levelId) === signature) return;
    lastVisibleSignatureMap.set(levelId, signature);

    void visibleFog.exportPng().then((png) => {
      // `encodeFogPng` est asynchrone. Une mutation plus récente peut avoir changé la
      // signature pendant la compression ; dans ce cas publier ce PNG réinstallerait une
      // vision ancienne chez les joueurs après la vision récente.
      if (lastVisibleSignatureMap.get(levelId) !== signature) return;
      store.setSessionVision(levelId, png);
      transport?.publish({
        type: 'vision.update',
        payload: { levelId, png },
        at: Date.now(),
        by: 'gm',
      });
    });
  }

  /**
   * Passe d'autorité du fog : recalcule la vision, la verse dans le masque exploré,
   * et publie les deux masques aux tablettes.
   *
   * ⚠ **Elle ne vit pas dans la boucle de rendu, et ne doit pas y retourner.** Le MJ est
   * l'autorité de vision de toute la session ; tant que ce travail était fait depuis
   * `renderAll`, il dépendait de `requestAnimationFrame`, que le navigateur suspend dès
   * que la fenêtre MJ est cachée, occultée par une autre fenêtre ou minimisée. Le MJ
   * cessait alors de publier : les tablettes gardaient un fog figé, et il ne se
   * débloquait qu'au retour de la fenêtre au premier plan ou à un F5 — exactement le
   * défaut observé le 2 août 2026. Mesuré par mutation : MJ privé de frames, zéro
   * `vision.update` publié ; frames rendues, publication immédiate.
   *
   * Garde anti-rebouclage : la révélation du masque exploré est conditionnée au changement réel
   * de la vision (change && polygons.length > 0), et la publication de la vision visible au changement
   * de sa signature (lastVisibleSignatureMap). Les appeler inconditionnellement rebouclerait :
   * publier écrit dans le store, le store notifie, la notification rappelle cette fonction — et le
   * MJ diffusait alors un masque de 13 Kio par seconde, indéfiniment, même partie à l'arrêt.
   */
  function syncVision() {
    const visionStart = typeof performance !== 'undefined' ? performance.now() : Date.now();
    try {
      const state = store.getRenderSnapshot();
      const activeLevel = state.activeLevel;
      if (!activeLevel) return;

      const grid = gridFor(activeLevel);
      const exploredFog = getExploredFog(activeLevel);
      if (!exploredFog) return;

      const change = fogLayer.updateVision(grid, activeLevel, state.campaign?.tokens ?? [], {
        extractSegments: extractBlockedSegments,
      });

      const polygons = fogLayer.getVisiblePolygons();
      const origin0 = grid.mapFromCellPoint({ cellX: 0, cellY: 0 });
      const origin1 = grid.mapFromCellPoint({ cellX: 1, cellY: 0 });
      const gridScale = Math.abs(origin1.x - origin0.x);

      if (change && polygons.length > 0) {
        exploredFog.reveal(polygons, origin0, gridScale);
        // Amendement A1 & A2 : la vision s'est versée dans le masque, vider l'undo de cet étage
        gmPanel?.fogTools?.clearUndoStack(activeLevel.id);
        scheduleFogPublish(activeLevel.id, exploredFog);
      }

      const currentSig = fogLayer.getVisionSignature();
      if (transport && lastVisibleSignatureMap.get(activeLevel.id) !== currentSig) {
        let visibleFog = visibleFogMap.get(activeLevel.id);
        if (
          !visibleFog ||
          visibleFog.widthCells !== activeLevel.widthCells ||
          visibleFog.heightCells !== activeLevel.heightCells
        ) {
          visibleFog = new ExploredFog(activeLevel.widthCells, activeLevel.heightCells);
          visibleFogMap.set(activeLevel.id, visibleFog);
        }
        visibleFog.clear();
        if (polygons.length > 0) {
          visibleFog.reveal(polygons, origin0, gridScale);
        }
        publishVisibleVision(activeLevel.id, visibleFog, currentSig);
      }
    } finally {
      const visionEnd = typeof performance !== 'undefined' ? performance.now() : Date.now();
      frameProbe.recordVision(visionEnd - visionStart);
    }
  }

  /**
   * Cases traversées par un déplacement, extrémités comprises.
   *
   * Repli utilisé quand un `token.move` arrive **sans** chemin : la droite entre les deux
   * cases. Le chemin publié par la vue joueurs, lui, est le vrai trajet marché — c'est
   * celui-là qu'il faut révéler, et il est préféré dès qu'il est là.
   *
   * @param {import('../core/types.js').Cell} from
   * @param {import('../core/types.js').Cell} to
   * @returns {import('../core/types.js').Cell[]}
   */
  function cellsAlongPath(from, to) {
    const da = to.a - from.a;
    const db = to.b - from.b;
    const pas = Math.max(Math.abs(da), Math.abs(db));
    if (pas === 0) return [{ a: from.a, b: from.b }];

    /** @type {import('../core/types.js').Cell[]} */
    const cases = [];
    for (let i = 0; i <= pas; i++) {
      cases.push({
        a: from.a + Math.round((da * i) / pas),
        b: from.b + Math.round((db * i) / pas),
      });
    }
    return cases;
  }

  /**
   * Révèle le fog exploré sur **toute** la trajectoire d'un pion porteur de vision.
   *
   * Critère 7 : sans cette passe, traverser un couloir ne révélerait que le départ et
   * l'arrivée, et le milieu resterait noir. `syncVision`, lui, ne connaît que la position
   * courante — il ne peut pas rattraper les cases déjà quittées.
   *
   * ⚠ **Elle appartient au déplacement joueur, pas au glisser du MJ.** Un joueur *marche*
   * son trajet : chaque case traversée est vécue, et ce qu'il a aperçu en chemin lui reste
   * acquis. Le MJ, lui, franchit les murs et pose un pion où il veut — privilège assumé
   * (`PLAN-LOT2.md`) — donc son glisser n'est pas un trajet marché, et n'a rien à révéler
   * d'autre que ce qui se voit depuis la case d'arrivée. Le code faisait exactement
   * l'inverse jusqu'au 02/08/2026 : le glisser MJ ouvrait un couloir de fog que personne
   * n'avait parcouru, et le déplacement du joueur n'en ouvrait aucun.
   *
   * @param {import('../core/types.js').Level} level
   * @param {import('../core/types.js').Token} token
   * @param {import('../core/types.js').Cell[]} cells Cases traversées, extrémités comprises
   * @returns {number} Nombre de cases balayées, 0 si le pion ne porte pas de vision
   */
  function revealAlongMove(level, token, cells) {
    if (!level || !token || token.kind !== 'pc') return 0;
    if (!Array.isArray(cells) || cells.length === 0) return 0;
    const rangeCells = Math.min(token.visionDim ?? 0, VISION_MAX_RANGE_CELLS);
    if (rangeCells <= 0) return 0;

    const grid = gridFor(level);
    const origin0 = grid.mapFromCellPoint({ cellX: 0, cellY: 0 });
    const origin1 = grid.mapFromCellPoint({ cellX: 1, cellY: 0 });
    const gridScale = Math.abs(origin1.x - origin0.x);
    const originR = grid.mapFromCellPoint({ cellX: rangeCells, cellY: 0 });
    const rangePx = Math.hypot(originR.x - origin0.x, originR.y - origin0.y);

    const size = Math.max(1, token.sizeCells || 1);
    const origins = cells.map((cell) =>
      grid.mapFromCellPoint({ cellX: cell.a + size / 2, cellY: cell.b + size / 2 })
    );

    const exploredFog = getExploredFog(level);
    if (!exploredFog) return 0;

    const balayees = exploredFog.revealPath(
      origins,
      extractBlockedSegments(level, grid),
      rangePx,
      origin0,
      gridScale
    );
    if (balayees > 0) {
      // Amendement A1 & A2 : trajet marché par pion, vider l'undo pour cet étage
      gmPanel?.fogTools?.clearUndoStack(level.id);
      scheduleFogPublish(level.id, exploredFog);
    }
    return balayees;
  }

  /** @type {{tokenId: string, mapPos: MapPoint}|null} */
  let dragPreview = null;
  /**
   * Porte verrouillée que le MJ vient de taper en vain, et l'instant du tap. État de rendu
   * transitoire, comme `dragPreview` : il ne va ni dans le store ni sur le réseau — l'autre MJ
   * n'a pas à voir clignoter un geste qui n'est pas le sien.
   * @type {{portalId: string, at: number}|null}
   */
  let lockedPortalFlash = null;
  /** @type {string|null} */
  let lastActiveLevelId = null;
  let restoredCamera = false;
  // Sonde du chantier N. Les deux variables ci-dessous sont hissées hors de `renderAll` pour que
  // la mesure n'alloue rien par frame (brief N §5.2) : un objet littéral et huit fermetures créés
  // à chaque image feraient fabriquer par la sonde la pression mémoire qu'elle cherche.
  const frameProbe = new FrameProbe();
  /** @type {Record<string, number>} */
  const layerDurations = {
    snapshot: 0,
    background: 0,
    grid: 0,
    walls: 0,
    portals: 0,
    links: 0,
    moveZone: 0,
    templates: 0,
    tokens: 0,
    fog: 0,
  };
  // Chronomètre partagé par les huit couches. Il n'est juste que parce que `renderLayerStack` les
  // exécute strictement en séquence et qu'aucune ne rend une autre : une couche imbriquée
  // écraserait silencieusement la borne de départ de celle qui l'englobe.
  let lStart = 0;


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

    let animationActive = false;
    layerDurations.background = 0;
    layerDurations.grid = 0;
    layerDurations.walls = 0;
    layerDurations.portals = 0;
    layerDurations.links = 0;
    layerDurations.moveZone = 0;
    layerDurations.templates = 0;
    layerDurations.tokens = 0;
    layerDurations.fog = 0;

    renderLayerStack({
      background: () => {
        lStart = typeof performance !== 'undefined' ? performance.now() : Date.now();
        backgroundLayer.render(stage.context, bottomRight.x, bottomRight.y, { role: 'gm' });
        layerDurations.background = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - lStart;
      },
      grid: () => {
        lStart = typeof performance !== 'undefined' ? performance.now() : Date.now();
        gridLayer.render(stage.context, grid);
        layerDurations.grid = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - lStart;
      },
      walls: () => {
        lStart = typeof performance !== 'undefined' ? performance.now() : Date.now();
        const draft = gmPanel?.wallEditor?.isArmed() ? gmPanel.wallEditor.getDraft() : null;
        wallsLayer.render(stage.context, grid, activeLevel, draft);
        layerDurations.walls = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - lStart;
      },
      portals: () => {
        lStart = typeof performance !== 'undefined' ? performance.now() : Date.now();
        const result = portalsLayer.render(stage.context, grid, activeLevel, {
          zoom: camera.zoom,
          flash: lockedPortalFlash,
          now: Date.now(),
        });
        animationActive ||= result.animationActive;
        layerDurations.portals = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - lStart;
      },
      links: () => {
        lStart = typeof performance !== 'undefined' ? performance.now() : Date.now();
        linksLayer.render(stage.context, grid, activeLevel, state.campaign?.links ?? [], {
          role: 'gm', zoom: camera.zoom, selectedLinkId: gmPanel?.linkEditor?.getSelectedLinkId() ?? null,
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
        templatesLayer.render(stage.context, grid, activeLevel, state.campaign?.templates ?? [], false);
        layerDurations.templates = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - lStart;
      },
      tokens: () => {
        lStart = typeof performance !== 'undefined' ? performance.now() : Date.now();
        const result = tokensLayer.render(
          stage.context,
          grid,
          state.campaign?.tokens ?? [],
          state.selectedTokenId,
          {
            role: 'gm',
            activeLevelId: activeLevel.id,
            now: Date.now(),
            dragPreview,
            zoom: camera.zoom,
            resolution: stage.resolution,
          }
        );
        // `||=` et non `=` : les pions ne sont plus la seule couche qui s'anime. Écrite en
        // affectation, cette ligne effaçait le drapeau posé par les portes — qui se dessinent
        // AVANT les pions —, la boucle à la demande s'arrêtait après une frame et le battement
        // du verrou restait figé à l'écran au lieu de s'éteindre.
        animationActive ||= result.animationActive;
        layerDurations.tokens = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - lStart;
      },
      // Rendu pur : ni révélation, ni publication ici. Elles appartiennent à
      // `syncVision`, qui doit tourner même quand le navigateur ne donne plus de frame
      // à cette fenêtre. `fogLayer` recalcule au besoin, et sa mémoïsation par
      // signature fait que ce recalcul n'a normalement plus rien à faire.
      fog: () => {
        lStart = typeof performance !== 'undefined' ? performance.now() : Date.now();
        const exploredFog = getExploredFog(activeLevel);
        if (exploredFog) {
          fogLayer.render(
            stage.context,
            grid,
            activeLevel,
            state.campaign?.tokens ?? [],
            {
              role: 'gm',
              extractSegments: extractBlockedSegments,
              exploredCanvas: exploredFog.canvas,
            }
          );
        }
        layerDurations.fog = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - lStart;
      },
    });

    stage.context.restore();
    if (animationActive) requestRender();

    const tEnd = typeof performance !== 'undefined' ? performance.now() : Date.now();
    frameProbe.recordFrame(tEnd, tEnd - tStart, layerDurations);
  }

  frameLoop = new FrameLoop(renderAll);

  const urlParams = new URLSearchParams(window.location.search);
  const sessionId =
    options.sessionId || normalizeSessionId(urlParams.get('session')) || defaultGmSessionId();
  store.setSessionId(sessionId);
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

  function persistCamera() {
    try {
      localStorage.setItem(
        `rpg_camera_${sessionId}`,
        JSON.stringify({ x: camera.x, y: camera.y, zoom: camera.zoom })
      );
    } catch {
      // Le rendu continue avec la caméra en mémoire.
    }
  }

  const networkStatus = createNetworkStatus('gm', sessionId);
  /** @type {Transport|null} */
  let transport = null;
  /** @type {ReturnType<typeof createGMPanel>|null} */
  let gmPanel = null;
  try {
    transport = await connectSession({
      injectedTransport: options.transport || null,
      firebaseConfig: options.firebaseConfig || null,
      sessionId,
      role: 'gm',
      loginHost: panelContainer,
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

  // Toute mutation du store est une occasion, pour l'autorité de vision, de constater
  // qu'elle a changé — déplacement de pion venu du réseau compris. C'est ce qui rend la
  // publication indépendante des frames que le navigateur veut bien accorder.
  const unsubscribeStore = store.subscribe(() => {
    syncVision();
    requestRender();
    scheduleSnapshot();
  });

  /** @type {(() => void)|null} */
  let unsubscribeEvents = null;

  /**
   * Congédie cette session MJ, parce qu'un autre poste a repris la main.
   *
   * L'ordre compte : on cesse d'abord d'écouter, puis on coupe le transport — l'inverse
   * laisserait passer les événements déjà en vol vers un store qu'on vient d'abandonner. Le
   * minuteur d'instantané est annulé pour la même raison : il écrirait l'état d'un poste qui
   * n'a plus autorité.
   *
   * @param {string} [label] Étiquette du poste qui a demandé l'éviction, si connue
   */
  function acceptEviction(label) {
    unsubscribeEvents?.();
    unsubscribeEvents = null;
    if (snapshotTimer !== null) {
      clearTimeout(snapshotTimer);
      snapshotTimer = null;
    }
    try {
      transport?.disconnect();
    } catch (err) {
      // Un transport déjà tombé ne doit pas empêcher l'écran de s'afficher.
      console.warn('Déconnexion du transport après éviction :', err);
    }
    networkStatus.update('error', 'session MJ reprise sur un autre écran');
    showEvictionOverlay({ sessionId, label });
  }

  if (transport) {
    unsubscribeEvents = transport.subscribe((event) => {
      if (transportExtended.isOwnEvent?.(event)) return;

      // Une éviction n'est pas une mutation de l'état de jeu : elle ne passe pas par
      // `applyNetworkEvent`, qui l'ignore d'ailleurs silencieusement côté joueurs. Et le test
      // d'événement propre ci-dessus suffit à ne pas se congédier soi-même — c'est lui qui
      // distingue l'écho de sa propre publication de la demande d'un autre poste.
      if (event.type === SESSION_EVICT_GM_EVENT) {
        // L'étiquette du poste qui congédie n'est pas dans le payload : elle est lue dans le
        // registre de présence à partir du `clientId` que le transport attache à tout
        // événement. Un poste qui se décrirait lui-même dans son payload donnerait une
        // deuxième source à tenir d'accord avec la première.
        const auteur = getPresenceList().find((c) => c.clientId === event.clientId);
        acceptEviction(auteur?.label);
        return;
      }

      // Une demande de vision n'est pas une mutation de l'état de jeu : elle ne passe pas par
      // `applyNetworkEvent`, qui la laisserait tomber silencieusement. Elle est traitée ici,
      // parce que c'est ici que vivent le cache de signature et l'autorité qui recalcule.
      if (event.type === VISION_REQUEST_EVENT) {
        scheduleVisionResend();
        return;
      }


      // Position d'avant, lue AVANT que l'événement ne la remplace. Le payload porte
      // normalement `from`, mais s'y fier seul laisserait le trajet non révélé sur un
      // client qui l'omet — et rien ne le signalerait.
      const payload = /** @type {any} */ (event.payload) || {};
      const avant =
        event.type === 'token.move'
          ? store.getCampaign()?.tokens.find((t) => t.id === payload.tokenId)?.cell ?? null
          : null;

      applyingRemote = true;
      let mute = false;
      try {
        mute = applyNetworkEvent(event);
      } finally {
        applyingRemote = false;
      }

      // ── Lot 3, S-04 : la bascule automatique appartient au MJ ──────────────────────────
      //
      // ⚠ **Après `applyNetworkEvent`, et c'est essentiel** : avant, le franchissement n'est pas
      // encore appliqué et le pion porte toujours son ancien étage. Placé plus haut, ce bloc
      // aurait comparé l'étage de départ à l'étage actif et n'aurait jamais rien basculé.
      //
      // Le franchissement lui-même est appliqué par tous — c'est une mutation de l'état de jeu.
      // Mais **où la table regarde** est une décision, et elle revient au MJ seul : lui seul sait
      // si le groupe s'est séparé volontairement. Laisser chaque poste basculer de son côté
      // donnerait autant de vues que d'écrans dès qu'un pion monte pendant que les autres restent.
      //
      // Le cadenas suspend la bascule sans empêcher le franchissement : les pions montent, la vue
      // reste où le MJ l'a laissée.
      if (mute && event.type === 'link.traverse' && !gmPanel?.isLevelFollowLocked?.()) {
        const pionDeplace = store.getCampaign()?.tokens.find((t) => t.id === payload.tokenId);
        if (pionDeplace && pionDeplace.levelId !== store.getActiveLevelId()) {
          try {
            store.selectLevel(pionDeplace.levelId);
            transport?.publish({
              type: 'level.select',
              payload: { levelId: pionDeplace.levelId },
              at: Date.now(),
              by: 'gm',
            });
          } catch (err) {
            networkStatus.update('error', err);
          }
        }
      }

      // Un déplacement venu de la table est un trajet **marché** : tout ce qui a été
      // aperçu en chemin reste acquis (critère 7). C'est ici, et nulle part ailleurs,
      // que le MJ — seule autorité de vision — peut le savoir : la mutation ne lui
      // laisse que la case d'arrivée.
      if (mute && event.type === 'token.move') {
        const level = store.getActiveLevel();
        const token = store.getCampaign()?.tokens.find((t) => t.id === payload.tokenId) ?? null;
        if (level && token && token.levelId === level.id) {
          const depart = payload.from ?? avant;
          const trajet =
            Array.isArray(payload.path) && payload.path.length > 0
              ? payload.path
              : depart
                ? cellsAlongPath(depart, token.cell)
                : [];
          revealAlongMove(level, token, trajet);
        }
      }
    });
    try {
      const snapshot = /** @type {any} */ (await transport.snapshot());
      applyingRemote = true;
      try {
        if (snapshot && (snapshot.campaign || snapshot.levels)) {
          store.restoreFromSnapshot(snapshot, { sessionId });
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

  gmPanel = panelContainer
    ? createGMPanel(panelContainer, {
        transport: transport || undefined,
        sessionId,
        getExploredFog: (levelId) => getExploredFog(levelId || store.getActiveLevelId() || ''),
        scheduleFogPublish: (immediate = true) => {
          const activeLvl = store.getActiveLevel();
          if (activeLvl) {
            const fog = getExploredFog(activeLvl);
            if (fog) scheduleFogPublish(activeLvl.id, fog, immediate);
          }
        },
        requestRender: () => requestRender(),
        onAddWall: (levelId, wall) => {
          if (transport) {
            transport.publish({
              type: 'wall.add',
              payload: { levelId, wall },
              at: Date.now(),
              by: 'gm',
            });
          }
        },
        onRemoveWall: (levelId, wall) => {
          if (transport) {
            transport.publish({
              type: 'wall.remove',
              payload: { levelId, wall },
              at: Date.now(),
              by: 'gm',
            });
          }
        },
        onAddLink: (link) => {
          transport?.publish({ type: 'link.add', payload: { link }, at: Date.now(), by: 'gm' });
        },
        onRemoveLink: (linkId) => {
          transport?.publish({ type: 'link.delete', payload: { linkId }, at: Date.now(), by: 'gm' });
        },
        // Le panneau affiche et demande ; il ne connaît ni le registre de présence ni le
        // `clientId` du transport. Les deux restent ici.
        getOtherGmSessions: () => listOtherGmClients(transportExtended?.clientId ?? ''),
        onEvictOtherGms: () => {
          if (!transport) return false;
          transport.publish({
            type: SESSION_EVICT_GM_EVENT,
            payload: {},
            at: Date.now(),
            by: 'gm',
          });
          return true;
        },
      })
    : null;

  if (!store.getActiveLevelId()) {
    const firstLvl = store.getCampaign()?.levels[0];
    if (firstLvl) store.selectLevel(firstLvl.id);
  }

  const initLevel = store.getActiveLevel();
  if (initLevel) {
    const initFog = getExploredFog(initLevel);
    if (initFog) scheduleFogPublish(initLevel.id, initFog, true);
  }
  syncVision();

  /**
   * @param {import('../input/gestures.js').InputIntention} intention
   */
  function handleIntention(intention) {
    if (intention.type === 'brushStroke') {
      const activeTool = gmPanel?.getActiveToolName?.() ?? 'none';
      if (activeTool !== 'fog-reveal' && activeTool !== 'fog-hide') return;

      const activeLevel = store.getActiveLevel();
      if (!activeLevel) return;
      const fog = getExploredFog(activeLevel);
      if (!fog) return;

      const grid = gridFor(activeLevel);
      const origin0 = grid.mapFromCellPoint({ cellX: 0, cellY: 0 });
      const origin1 = grid.mapFromCellPoint({ cellX: 1, cellY: 0 });
      const gridScale = Math.abs(origin1.x - origin0.x);

      const radiusCells = gmPanel?.fogTools?.getBrushRadiusCells() ?? 1;
      const radiusPx = radiusCells * gridScale;

      if (intention.phase === 'start') {
        gmPanel?.fogTools?.pushUndoState();
      }

      if (activeTool === 'fog-reveal') {
        fog.paintDisc(intention.mapPos, radiusPx, origin0, gridScale);
      } else if (activeTool === 'fog-hide') {
        fog.eraseDisc(intention.mapPos, radiusPx, origin0, gridScale);
      }

      // Amendment A3: requestRender() à chaque coup de pinceau (start/move/end)
      requestRender();

      if (intention.phase === 'end') {
        scheduleFogPublish(activeLevel.id, fog);
      }
      return;
    }

    if (intention.type === 'panBy') {
      camera.setPan(
        camera.x - intention.deltaX / camera.zoom,
        camera.y - intention.deltaY / camera.zoom
      );
      persistCamera();
      requestRender();
      transport?.publish({
        type: 'view.change',
        payload: { camera: { x: camera.x, y: camera.y, zoom: camera.zoom } },
        at: Date.now(),
        by: 'gm',
      });
      return;
    }

    if (intention.type === 'pinchZoom') {
      const before = camera.screenToMap(intention.center);
      camera.setZoom(camera.zoom * intention.scaleFactor);
      const after = camera.screenToMap(intention.center);
      camera.setPan(camera.x + before.x - after.x, camera.y + before.y - after.y);
      persistCamera();
      requestRender();
      transport?.publish({
        type: 'view.change',
        payload: { camera: { x: camera.x, y: camera.y, zoom: camera.zoom } },
        at: Date.now(),
        by: 'gm',
      });
      return;
    }

    if (intention.type === 'tap') {
      const state = store.getState();
      if (!state.activeLevel) return;
      const activeLevel = state.activeLevel;
      const activeToolName = gmPanel?.getActiveToolName?.() ?? 'none';

      if (activeToolName === 'template-place') {
        if (gmPanel?.templateTools) {
          const cfg = gmPanel.templateTools.getConfig();
          /** @type {import('../core/types.js').Template} */
          const template = {
            id: cfg.templateId,
            levelId: activeLevel.id,
            shape: cfg.shape,
            origin: intention.mapPos,
            radiusCells: cfg.radiusCells,
            directionDeg: 0,
            widthCells: 1,
            color: cfg.color,
            visibleToPlayers: cfg.visibleToPlayers,
          };
          store.placeTemplate(template);
          transport?.publish({
            type: 'template.place',
            payload: { template },
            at: Date.now(),
            by: 'gm',
          });
          gmPanel.templateTools.disarm();
          requestRender();
        }
        return;
      }

      if (activeToolName === 'link-place') {
        const grid = gridFor(activeLevel);
        const cell = grid.cellFromPoint(intention.mapPos);
        if (cell) gmPanel?.linkEditor?.setEndpointA(activeLevel.id, cell);
        return;
      }

      if (activeToolName === 'wall-draw' || activeToolName === 'wall-delete') {
        const grid = gridFor(activeLevel);
        const origin0 = grid.mapFromCellPoint({ cellX: 0, cellY: 0 });
        const origin1 = grid.mapFromCellPoint({ cellX: 1, cellY: 0 });
        const gridScale = Math.abs(origin1.x - origin0.x);

        const subMode = gmPanel?.wallEditor?.getSubMode() ?? (activeToolName === 'wall-delete' ? 'supprimer' : 'tracer');
        if (subMode === 'tracer') {
          const snapPt = snapWallVertex(intention.mapPos, activeLevel, { x: 0, y: 0 }, gridScale);
          gmPanel?.wallEditor?.addVertex(snapPt);
        } else if (subMode === 'supprimer') {
          const targetWall = findWallAt(intention.mapPos, activeLevel, { x: 0, y: 0 }, gridScale);
          if (targetWall) {
            const removed = store.removeWall(activeLevel.id, targetWall);
            if (removed && transport) {
              transport.publish({
                type: 'wall.remove',
                payload: { levelId: activeLevel.id, wall: targetWall },
                at: Date.now(),
                by: 'gm',
              });
            }
          }
        }
        return;
      }

      const grid = gridFor(state.activeLevel);
      // Aucun `filter` : le MJ doit pouvoir désigner un PNJ caché. Seul `locked` est déclassé —
      // il reste sélectionnable (c'est le geste qui sert à le déverrouiller) mais ne vole pas la
      // désignation d'un voisin libre. ⛔ Ne pas y mettre la manipulabilité *joueur* : elle
      // déclasserait les PNJ, que le MJ manipule autant que les PJ.
      const token = findHitToken(
        grid,
        state.activeLevel,
        intention.mapPos,
        camera.zoom,
        state.campaign?.tokens ?? [],
        { deprioritize: (t) => !!t.locked }
      );
      if (token) {
        store.selectToken(token.id);
        return;
      }

      const hitPortal = findHitPortal(grid, state.activeLevel, intention.mapPos);
      if (hitPortal) {
        /** @type {'open'|'closed'|null} */
        let targetState = null;
        if (hitPortal.state === 'closed') {
          targetState = 'open';
        } else if (hitPortal.state === 'open') {
          targetState = 'closed';
        }
        // Depuis `locked`, un tap ne fait rien **et le signale** (TRANCHE-L05-PORTES.md §7.6).
        // La seconde moitié de cette exigence manquait : le code sortait en silence, et un
        // geste sans effet ni explication ne se distingue pas d'une panne. C'est ce qui a fait
        // conclure que l'état verrouillé n'était pas implémenté, alors qu'il l'était.
        if (!targetState && hitPortal.state === 'locked') {
          lockedPortalFlash = { portalId: hitPortal.id, at: Date.now() };
          requestRender();
        }
        if (targetState) {
          store.setPortalState(state.activeLevel.id, hitPortal.id, targetState);
          transport?.publish({
            type: 'portal.toggle',
            payload: {
              levelId: state.activeLevel.id,
              portalId: hitPortal.id,
              state: targetState,
            },
            at: Date.now(),
            by: 'gm',
          });
        }
        return;
      }

      store.selectToken(null);
      return;
    }

    if (intention.type === 'longPress') {
      const state = store.getState();
      if (!state.activeLevel) return;
      const grid = gridFor(state.activeLevel);
      const hitPortal = findHitPortal(grid, state.activeLevel, intention.mapPos);
      if (hitPortal) {
        const targetState = hitPortal.state === 'locked' ? 'closed' : 'locked';
        store.setPortalState(state.activeLevel.id, hitPortal.id, targetState);
        transport?.publish({
          type: 'portal.toggle',
          payload: {
            levelId: state.activeLevel.id,
            portalId: hitPortal.id,
            state: targetState,
          },
          at: Date.now(),
          by: 'gm',
        });
      }
      return;
    }

    if (intention.type === 'dragToken') {
      if (intention.phase !== 'end') {
        dragPreview = { tokenId: intention.tokenId, mapPos: intention.mapPos };
        requestRender();
        return;
      }

      dragPreview = null;
      const state = store.getState();
      if (!state.activeLevel || !state.campaign) {
        requestRender();
        return;
      }
      const grid = gridFor(state.activeLevel);
      const targetCell = grid.cellFromPoint(intention.mapPos);
      const token = state.campaign.tokens.find((item) => item.id === intention.tokenId);
      if (!targetCell || !token || token.levelId !== state.activeLevel.id) {
        requestRender();
        return;
      }

      const from = { a: token.cell.a, b: token.cell.b };
      const startedAt = Date.now();
      store.moveTokenToCell(token.id, targetCell, {
        from,
        to: targetCell,
        path: [from, targetCell],
        startedAt,
      });

      // Pas de révélation le long du trajet ici : le MJ franchit les murs et pose son
      // pion où il veut, ce glisser n'est pas un trajet marché. `syncVision`, déclenché
      // par la mutation ci-dessus, révèle ce qui se voit depuis la case d'arrivée — et
      // c'est tout ce qui doit l'être.

      transport?.publish({
        type: 'token.move',
        payload: { tokenId: token.id, from, to: targetCell, path: [from, targetCell], startedAt },
        at: startedAt,
        by: 'gm',
      });
      return;
    }

    if (intention.type === 'dragTemplate') {
      const state = store.getState();
      if (!state.activeLevel || !state.campaign) return;
      const activeLevel = state.activeLevel;
      const t = (state.campaign.templates || []).find((item) => item.id === intention.templateId);
      if (!t || t.levelId !== activeLevel.id) return;

      if (intention.phase === 'start') {
        gmTemplateDragState = {
          templateId: t.id,
          startMapPos: { ...intention.mapPos },
          initialOrigin: { ...t.origin },
          initialDirectionDeg: t.directionDeg || 0,
        };
      }

      if (!gmTemplateDragState || gmTemplateDragState.templateId !== t.id) return;

      if (intention.dragMode === 'move') {
        const dx = intention.mapPos.x - gmTemplateDragState.startMapPos.x;
        const dy = intention.mapPos.y - gmTemplateDragState.startMapPos.y;
        const newOrigin = {
          x: gmTemplateDragState.initialOrigin.x + dx,
          y: gmTemplateDragState.initialOrigin.y + dy,
        };
        store.moveTemplate(t.id, newOrigin, t.directionDeg);
      } else if (intention.dragMode === 'rotate') {
        const dx = intention.mapPos.x - t.origin.x;
        const dy = intention.mapPos.y - t.origin.y;
        const angleRad = Math.atan2(dy, dx);
        const angleDeg = Math.round(((angleRad * 180) / Math.PI + 360) % 360);
        store.moveTemplate(t.id, t.origin, angleDeg);
      }

      requestRender();

      if (intention.phase === 'end') {
        transport?.publish({
          type: 'template.move',
          payload: {
            templateId: t.id,
            origin: t.origin,
            directionDeg: t.directionDeg || 0,
          },
          at: Date.now(),
          by: 'gm',
        });
        gmTemplateDragState = null;
      }
      return;
    }
  }

  /** @type {{ templateId: string, startMapPos: import('../core/types.js').MapPoint, initialOrigin: import('../core/types.js').MapPoint, initialDirectionDeg: number }|null} */
  let gmTemplateDragState = null;

  const pointerInput = new PointerInput(canvas, camera, {
    role: 'gm',
    onIntention: handleIntention,
    canStartBrush: (_screenPos, _mapPos) => {
      const tool = gmPanel?.getActiveToolName?.() ?? 'none';
      return tool === 'fog-reveal' || tool === 'fog-hide';
    },
    canStartTokenDrag: (_screenPos, mapPos) => {
      if (gmPanel?.getActiveToolName?.() !== 'none') return null;
      const state = store.getState();
      if (!state.activeLevel || !state.campaign) return null;
      const grid = gridFor(state.activeLevel);
      // Même règle qu'au tap : c'est le même point d'entrée pour les deux gestes (brief O §2).
      const hit = findHitToken(
        grid,
        state.activeLevel,
        mapPos,
        camera.zoom,
        state.campaign.tokens || [],
        { deprioritize: (t) => !!t.locked }
      );
      return hit?.id ?? null;
    },
    canStartTemplateDrag: (_screenPos, mapPos) => {
      if (gmPanel?.getActiveToolName?.() !== 'none') return null;
      const state = store.getState();
      if (!state.activeLevel || !state.campaign) return null;
      const hit = findHitTemplate(state.activeLevel, state.campaign.templates || [], mapPos, camera.zoom, 0, false);
      return hit ? { templateId: hit.template.id, dragMode: hit.mode } : null;
    },
  });

  const onKeyDown = (/** @type {KeyboardEvent} */ e) => {
    const target = /** @type {HTMLElement|null} */ (e.target);
    if (
      target &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
    ) {
      return;
    }
    if (e.key === 'Escape' || e.key === 'Esc') {
      if (gmPanel?.getActiveToolName?.() !== 'none') {
        gmPanel?.disarmActiveTool?.();
        requestRender();
      }
    }
    if (e.key === 'p' || e.key === 'P') {
      frameProbe.toggleOverlay();
    }
  };
  if (typeof document !== 'undefined') {
    document.addEventListener('keydown', onKeyDown);
  }

  const onResize = () => {
    stage.resize();
    camera.setViewport(stage.width, stage.height);
    lastActiveLevelId = null;
    requestRender();
  };
  window.addEventListener('resize', onResize);
  // Première passe d'autorité explicite : une fenêtre MJ ouverte déjà en arrière-plan
  // n'obtiendrait aucune frame, et n'aurait donc jamais publié l'état initial du fog.
  syncVision();
  requestRender();

  const destroy = () => {
    if (typeof document !== 'undefined') {
      document.removeEventListener('keydown', onKeyDown);
    }
    pointerInput.detach();
    frameProbe.stop();
    unsubscribeStore();
    unsubscribeEvents?.();
    if (snapshotTimer !== null) clearTimeout(snapshotTimer);
    window.removeEventListener('resize', onResize);
    frameLoop.stop();
    persistCamera();
    gmPanel?.destroy();
    transport?.disconnect();
    networkStatus.remove();
  };

  return {
    canvas: stage.canvas,
    context: stage.context,
    camera,
    frameLoop,
    frameProbe,
    pointerInput,
    backgroundLayer,
    tokensLayer,
    templatesLayer,
    gmPanel,
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
  const promise = bootstrapGMApp(globalOptions).then((app) => {
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

// `findHitPortal` et `distancePointToSegment` vivaient ici en double avec la vue joueurs.
// Elles sont désormais dans `js/input/portalHit.js`, avec leur tolérance.

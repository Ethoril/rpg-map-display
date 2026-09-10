// @ts-check

import { initStage, renderLayerStack } from '../render/stage.js';
import { Camera } from '../render/camera.js';
import { FrameLoop } from '../render/frame.js';
import { BackgroundLayer } from '../render/layers/background.js';
import { VideoBackdrop } from '../render/videoBackdrop.js';
import { GridLayer } from '../render/layers/gridLayer.js';
import { LightLayer } from '../render/layers/light.js';
import { MoveZoneLayer } from '../render/layers/moveZone.js';
import { TokensLayer } from '../render/layers/tokens.js';
import { FogLayer, buildVisionSignature } from '../render/layers/fogLayer.js';
import { PortalsLayer } from '../render/layers/portals.js';
import { LinksLayer } from '../render/layers/links.js';
import { LightMarkersLayer } from '../render/layers/lightMarkers.js';
import { WallsLayer } from '../render/layers/walls.js';
import { TemplatesLayer } from '../render/layers/templates.js';
import { PingsLayer } from '../render/layers/pings.js';
import { MeasureLayer } from '../render/layers/measure.js';

import { PointerInput } from '../input/pointer.js';
import { findHitPortal } from '../input/portalHit.js';
import { findHitTemplate } from '../input/templateHit.js';
import { findHitToken, exactTokenAtCell } from '../input/tokenHit.js';
import { findHitLight } from '../input/lightHit.js';
import { FrameProbe } from '../render/probe.js';
import { gridFor } from '../grid/index.js';
import { extractBlockedSegments } from '../import/blockedEdges.js';
import {
  GM_SESSION_STORAGE_KEY,
  VISION_MAX_RANGE_CELLS,
  SESSION_EVICT_GM_EVENT,
  VISION_REQUEST_EVENT,
  LIGHT_DEFAULT,
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
  withDeadline,
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
  const videoBackdrop = new VideoBackdrop({
    invalidate: requestRender,
    onWarning: (message) => console.warn(`[fond animé] ${message}`),
  });
  videoBackdrop.attach(canvas.parentElement, canvas);
  const gridLayer = new GridLayer();
  const lightLayer = new LightLayer();
  const wallsLayer = new WallsLayer();
  const portalsLayer = new PortalsLayer();
  const linksLayer = new LinksLayer();
  const lightMarkersLayer = new LightMarkersLayer();
  const moveZoneLayer = new MoveZoneLayer();
  const templatesLayer = new TemplatesLayer();
  const pingsLayer = new PingsLayer();
  const measureLayer = new MeasureLayer();
  /** @type {{ levelId: string, start: import('../core/types.js').MapPoint, end: import('../core/types.js').MapPoint|null, distance: number }|null} */
  let currentMeasure = null;
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
      // reversée, ce que `syncVision` ne fait que sur changement de signature. Effacer
      // `fogLayer` seul ne force plus rien depuis la garde par étage : il faut aussi
      // effacer l'entrée de cet étage dans `lastVisionSyncSignatureMap`.
      fogLayer.invalidate();
      lastVisionSyncSignatureMap.delete(level.id);

      const savedFog = store.getSessionFog(level.id);
      if (savedFog) {
        // ⚠ `importPng` efface puis redessine : tout ce qui a été révélé entre la
        // création du masque et l'atterrissage de l'import serait perdu **en silence**.
        // On resynchronise donc derrière lui, plutôt que de parier sur l'ordonnancement.
        void fog.importPng(savedFog).then(() => {
          fogLayer.invalidate();
          lastVisionSyncSignatureMap.delete(level.id);
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

  /**
   * Signature de vision avec laquelle la dernière passe de `syncVisionForLevel` s'est
   * terminée, PAR ÉTAGE — indépendante de `fogLayer._lastSignature`, qui appartient à
   * l'instance PARTAGÉE et se fait écraser par le voisin non actif (`invalidate()` en fin
   * de passe). Sans cette garde séparée, un étage non actif qui republie à 1 Hz effaçait
   * aussi la garde de l'étage actif au tour suivant : `updateVision` ne reconnaissait plus
   * rien, `change` valait `true` pour tous les étages, et la mutation du store rappelait
   * `syncVision` sans fin — les « 13 Kio par seconde », partie à l'arrêt.
   * @type {Map<string, string>}
   */
  const lastVisionSyncSignatureMap = new Map();

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
      // La garde par étage de `syncVisionForLevel` sortirait avant même d'atteindre la
      // décision de publier, si rien n'a changé depuis la dernière passe : sans la vider
      // aussi, une tablette qui revient sur une table à l'arrêt ne recevrait jamais rien.
      lastVisionSyncSignatureMap.clear();
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
   * Garde anti-rebouclage : `syncVisionForLevel` sort tôt, PAR ÉTAGE, sur
   * `lastVisionSyncSignatureMap` — jamais sur l'état de `fogLayer`, qui est une instance
   * PARTAGÉE et se fait invalider par le voisin non actif à chaque passage. S'y fier a
   * réellement régressé une fois (correctif UX-15) : `change` valait alors `true` pour
   * tous les étages dès qu'un PJ occupait un étage non actif, la publication du masque
   * exploré rappelait `store.setSessionFog`, le store notifiait, la notification
   * rappelait cette fonction — et le MJ diffusait un masque de 13 Kio par seconde,
   * indéfiniment, même partie à l'arrêt. La garde par étage coupe le cycle avant le
   * premier calcul ; la publication de la vision visible garde en plus son propre
   * changement de signature (lastVisibleSignatureMap).
   *
   * ⛔ **`fogLayer` et `lightLayer` sont des instances PARTAGÉES**, réutilisées à chaque passage
   * pour ne pas garder d'état. Les faire tourner pour un étage qui n'est pas `isActiveLevel`
   * écraserait l'état de l'étage affiché — c'est le piège que `syncVision`, plus bas, contourne
   * en traitant l'étage actif EN DERNIER et en effaçant `fogLayer` (`invalidate()`) après
   * chaque étage non actif. `lightLayer`, lui, n'est jamais touché pour un étage non actif :
   * une `LightLayer` temporaire porte son champ, comme le faisait déjà le bloc `link.traverse`.
   *
   * @param {import('../core/types.js').Level} level
   * @param {boolean} isActiveLevel
   * @param {import('../core/types.js').Token[]} tokens
   */
  function syncVisionForLevel(level, isActiveLevel, tokens) {
    const grid = gridFor(level);
    const exploredFog = getExploredFog(level);
    if (!exploredFog) return;

    // ⭐ Garde PAR ÉTAGE, AVANT tout calcul — voir `lastVisionSyncSignatureMap` plus haut.
    // `fogLayer` est une instance PARTAGÉE : sa propre signature interne se fait écraser
    // par le voisin non actif (`invalidate()` en fin de passe, plus bas), donc s'y fier
    // ferait recalculer — et republier — tous les étages à chaque mutation du store, même
    // au repos. La garde ici ne dépend que de cet étage : sortir tôt règle les deux à la
    // fois, plus d'effet de bord au repos et plus de recalcul pour un étage qui n'a pas
    // bougé. `fogLayer` retrouvera de toute façon la bonne vision au rendu suivant : son
    // `render()` rappelle `updateVision` lui-même, mémoïsé par sa propre signature.
    const signature = buildVisionSignature(level, tokens, grid);
    if (lastVisionSyncSignatureMap.get(level.id) === signature) return;
    lastVisionSyncSignatureMap.set(level.id, signature);

    // ⭐ **Le champ lumineux se compose ICI, avant la vision, et jamais dans `rAF`.**
    // C'est la règle du projet depuis le fog — un calcul sur mutation du store, mis en
    // cache par signature. La couche de rendu le redemandera à l'image suivante et
    // trouvera le même champ : son `update` est gardé par la même signature.
    const lumiere = isActiveLevel ? lightLayer : new LightLayer();
    lumiere.update(grid, level, tokens, { extractSegments: extractBlockedSegments });

    fogLayer.updateVision(grid, level, tokens, {
      extractSegments: extractBlockedSegments,
    });

    // ⛔ DEUX échelles, jamais une seule — E-11 : voir `js/vision/fog.js`.
    const origin0 = grid.mapFromCellPoint({ cellX: 0, cellY: 0 });
    const origin1 = grid.mapFromCellPoint({ cellX: 1, cellY: 0 });
    const origin1B = grid.mapFromCellPoint({ cellX: 0, cellY: 1 });
    const gridScaleX = Math.abs(origin1.x - origin0.x);
    const gridScaleY = Math.abs(origin1B.y - origin0.y);

    // La règle du mode tactique, assemblée une seule fois et servie deux fois : au masque
    // exploré, qui la mémorise, et à la vision publiée, qui ne mémorise rien.
    //
    //     visible = (ligne de vue ∩ éclairé)  ∪  (ce que le PJ voit dans le noir)
    //
    // ⚠ `getFieldCanvas()` rend `null` au tout premier passage. `composeVisibleMask` se
    // replie alors sur la ligne de vue ENTIÈRE : mieux vaut le comportement d'avant le
    // chantier qu'un écran noir en pleine séance.
    const entreesVision = {
      losPolygons: fogLayer.getLosPolygons(),
      nearPolygons: fogLayer.getNearPolygons(),
      litCanvas: lumiere.getFieldCanvas(),
      mapOrigin: origin0,
      gridScaleX,
      gridScaleY,
    };

    let visibleFog = visibleFogMap.get(level.id);
    if (
      !visibleFog ||
      visibleFog.widthCells !== level.widthCells ||
      visibleFog.heightCells !== level.heightCells
    ) {
      visibleFog = new ExploredFog(level.widthCells, level.heightCells);
      visibleFogMap.set(level.id, visibleFog);
    }

    const currentSig = fogLayer.getVisionSignature();
    // ⚠ La garde anti-rebouclage joue PAR ÉTAGE : `lastVisibleSignatureMap` est indexée par
    // `level.id`, donc un étage qui n'a pas changé ne republie rien, même si un autre étage
    // vient d'être traité dans la même passe.
    const aPublier = transport && lastVisibleSignatureMap.get(level.id) !== currentSig;

    // La garde par étage, tout en haut de cette fonction, a déjà établi que cet étage a
    // changé — plus besoin de reconditionner sur la valeur de retour de
    // `fogLayer.updateVision`, qui appartient à l'instance PARTAGÉE et pas à cet étage
    // précis. Composer, reverser dans l'exploré et vider l'undo sont donc inconditionnels
    // ici ; seule la publication de la vision visible garde sa propre condition, sur SA
    // signature (`lastVisibleSignatureMap`), qui peut différer (cf. `scheduleVisionResend`).
    visibleFog.composeVisible(entreesVision);

    // ⭐ `revealMask` fait l'UNION avec ce qui était exploré ; `composeVisible` REMPLACE.
    // Les confondre ferait s'accumuler la vision courante d'une image à l'autre, et la
    // table verrait encore ce qu'elle a quitté.
    exploredFog.revealMask(visibleFog.canvas);
    // Amendement A1 & A2 : la vision s'est versée dans le masque, vider l'undo de cet étage
    gmPanel?.fogTools?.clearUndoStack(level.id);
    scheduleFogPublish(level.id, exploredFog);

    if (aPublier) {
      publishVisibleVision(level.id, visibleFog, currentSig);
    }

    // Étage non actif : `fogLayer` a servi de passage, on n'y laisse rien traîner pour que
    // l'étage suivant — actif ou non — reparte sur une signature vide plutôt que la sienne.
    if (!isActiveLevel) fogLayer.invalidate();
  }

  /**
   * Passe d'autorité du fog : recalcule la vision de chaque étage qui la réclame, la verse
   * dans son masque exploré, et publie les deux masques aux tablettes.
   *
   * ⭐ **Chaque étage qui porte au moins un pion PJ entre dans la boucle, plus l'étage actif du
   * MJ.** Sans ça, un groupe séparé — qu'un franchissement de liaison rend normal, cf. UX-10 —
   * laissait un étage entier sans aucune vision publiée tant que le MJ n'y était pas lui-même :
   * la table n'y voyait aucun pion, même après que l'étage soit devenu « connu » (UX-12).
   * L'étage actif, lui, entre toujours dans la boucle même sans PJ dessus : lui seul est rendu
   * à l'écran du MJ, et c'est le seul dont l'absence de pion doit vider la vision affichée.
   *
   * ⭐ **Un étage qui a déjà publié un masque visible y entre aussi, même sans PJ dessus.**
   * Le défaut miroir : un étage qui vient de perdre son dernier PJ (celui-ci a franchi une
   * liaison) sortait alors de la boucle et sa vision publiée n'était plus jamais recalculée —
   * la tablette gardait le dernier masque visible, celui que le PJ parti voyait, et un PNJ
   * qui y entrait ensuite s'affichait à la table alors que plus personne n'y regardait.
   * `lastVisibleSignatureMap` porte une entrée pour tout étage déjà publié : la tester suffit,
   * pas besoin d'un registre séparé. Le coût reste borné : sans PJ, la signature de vision de
   * cet étage ne bouge plus d'un passage à l'autre, donc `updateVision` sort par son test de
   * signature sans extraire un seul mur, et `publishVisibleVision` ne republie rien — un étage
   * vidé ne coûte qu'une passe UNE FOIS, celle qui publie le masque vide, pas à chaque mutation
   * suivante du store.
   *
   * ⭐ **L'étage actif est traité EN DERNIER**, voir `syncVisionForLevel` : les instances
   * partagées doivent finir la passe en portant l'état de l'étage que le MJ rend réellement.
   *
   * ⚠ **AUCUN TEST NE DISTINGUE CET ORDRE, et il faut le dire ici.** Mutation faite le
   * 09/09/2026 : étage actif traité en premier, les tests restent verts. La raison est
   * structurelle : traiter l'actif en premier laisse seulement `fogLayer` invalidé en fin de
   * passe (dernier étage non actif traité), donc un recalcul redondant — mais pas faux — au
   * rendu suivant, pour un résultat identique. C'est une garantie de code, pas un comportement
   * observable — même profil que la dette E-10 de `QUESTIONS-EN-ATTENTE.md`.
   *
   * ⚠ Elle ne vit pas dans la boucle de rendu, et ne doit pas y retourner — voir la note
   * d'origine plus haut sur le 2 août 2026.
   */
  function syncVision() {
    const visionStart = typeof performance !== 'undefined' ? performance.now() : Date.now();
    try {
      const state = store.getRenderSnapshot();
      const activeLevel = state.activeLevel;
      if (!activeLevel) return;

      const tokens = state.campaign?.tokens ?? [];
      const levels = state.campaign?.levels ?? [];

      for (const level of levels) {
        if (level.id === activeLevel.id) continue;
        const aUnPJ = tokens.some((t) => t && t.levelId === level.id && t.kind === 'pc');
        const dejaPublie = lastVisibleSignatureMap.has(level.id);
        if (aUnPJ || dejaPublie) syncVisionForLevel(level, false, tokens);
      }

      syncVisionForLevel(activeLevel, true, tokens);
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
    // ⛔ DEUX échelles, jamais une seule — E-11 : voir `js/vision/fog.js`.
    const origin0 = grid.mapFromCellPoint({ cellX: 0, cellY: 0 });
    const origin1 = grid.mapFromCellPoint({ cellX: 1, cellY: 0 });
    const origin1B = grid.mapFromCellPoint({ cellX: 0, cellY: 1 });
    const gridScaleX = Math.abs(origin1.x - origin0.x);
    const gridScaleY = Math.abs(origin1B.y - origin0.y);
    const originR = grid.mapFromCellPoint({ cellX: rangeCells, cellY: 0 });
    const rangePx = Math.hypot(originR.x - origin0.x, originR.y - origin0.y);

    const size = Math.max(1, token.sizeCells || 1);
    // G-1 : chaque origine de balayage vient de la boîte DESSINÉE (`cellBounds`), jamais
    // d'une arithmétique sur `mapFromCellPoint` — ce dernier rend un point du réseau de la
    // grille, pas le centre d'une case (C-5). L'écart mesuré : rien en carré, mais jusqu'à
    // une case entière (100 px en x, 36,6 px en y à 140 px/case) pour un pion de taille 2 en
    // hexagonal. Sans ce détour, le trajet marché révèle le fog depuis un endroit où le pion
    // n'est pas dessiné.
    const origins = cells.map((cell) => {
      const bounds = grid.cellBounds({ cellX: cell.a, cellY: cell.b }, size);
      return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    });

    const exploredFog = getExploredFog(level);
    if (!exploredFog) return 0;

    const balayees = exploredFog.revealPath(
      origins,
      extractBlockedSegments(level, grid),
      rangePx,
      origin0,
      gridScaleX,
      gridScaleY
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
  /**
   * Ping courant, s'il est encore dans sa fenêtre d'affichage.
   *
   * ⛔ **`at` est posé ici, localement, jamais lu de l'événement reçu.** Le MJ estampille avec sa
   * propre horloge, la tablette avec la sienne, et c'est précisément ce qui rend le ping immunisé
   * au décalage d'horloge — 5,3 s mesurés sur cette tablette. Voir `PING_DURATION_MS`.
   * @type {{levelId: string, mapPos: {x: number, y: number}, at: number}|null}
   */
  let currentPing = null;
  /**
   * Compteur de lampes posées en séance (C-2, tranche 2) — même rôle que le compteur de
   * gabarits de `templateTools.js` : rendre chaque identifiant généré unique sans dépendre
   * seulement de l'horloge, que deux taps rapprochés pourraient faire coïncider.
   */
  let lightPlaceCounter = 0;
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
    light: 0,
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
    // le mutant**. Placer la vidéo d'abord la calait sur le zoom non borné pendant que le
    // canvas utilisait le zoom borné — un décalage d'une frame, invisible en usage normal
    // mais bien réel au bout d'un pincement qui dépasse les butées.
    videoBackdrop.place(camera, bottomRight.x, bottomRight.y, stage.width, stage.height);

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
        backgroundLayer.render(stage.context, bottomRight.x, bottomRight.y, {
          role: 'gm',
          suppressed: videoBackdrop.active,
        });
        layerDurations.background = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - lStart;
      },
      grid: () => {
        lStart = typeof performance !== 'undefined' ? performance.now() : Date.now();
        gridLayer.render(stage.context, grid);
        layerDurations.grid = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - lStart;
      },
      // ⭐ Rang 3 : la lumière module le DÉCOR — le fond et le quadrillage — et rien d'autre.
      // Tout ce qui suit (murs, portes, liaisons, gabarits, pions) reste à ses couleurs propres,
      // parce que sa lisibilité à trois écrans a été validée en séance. Décision du 26/08/2026.
      light: () => {
        lStart = typeof performance !== 'undefined' ? performance.now() : Date.now();
        // `update` est gardé par sa propre signature : il ne recompose que si une lumière, un
        // mur, une porte ou l'ambiante a bougé. Un PJ qui se déplace ne le réveille pas.
        lightLayer.update(grid, activeLevel, state.campaign?.tokens ?? [], {
          extractSegments: extractBlockedSegments,
        });
        lightLayer.render(stage.context, grid, activeLevel, {
          role: 'gm',
          mode: gmPanel?.getMode(),
          suppressed: videoBackdrop.active,
          // ⭐ La vision courante, déjà composée par `syncVision` : c'est elle qui donne au
          // stencil « vu sans lumière » sa zone (voir `light.js`). Sans elle, aucun stencil.
          visibleCanvas: visibleFogMap.get(activeLevel.id)?.canvas,
        });
        layerDurations.light = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - lStart;
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
              // ⭐ La vision courante composée par `syncVision`, déjà découpée par
              // l'éclairage. Sans elle, la couche se rabattrait sur son repli conservateur
              // et le MJ ne verrait que les portées nocturnes — jamais les pièces éclairées.
              visibleCanvas: visibleFogMap.get(activeLevel.id)?.canvas,
            }
          );
        }
        layerDurations.fog = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - lStart;
      },
      // ⛔ Vue MJ SEULE (rang 12) : `player.js` ne branche jamais cette couche.
      lightMarkers: () => {
        lightMarkersLayer.render(stage.context, grid, activeLevel, { zoom: camera.zoom });
      },
      measure: () => {
        measureLayer.render(stage.context, grid, activeLevel, {
          measure: currentMeasure,
          camera,
        });
      },
      pings: () => {
        const result = pingsLayer.render(stage.context, grid, activeLevel, {
          ping: currentPing,
          now: Date.now(),
          zoom: camera.zoom,
        });
        // ⚠ `||=`, jamais `=`. Un accumulateur écrasé ici éteindrait l'animation des couches
        // précédentes — le défaut a déjà été commis une fois sur ce projet.
        animationActive ||= result.animationActive;
        // Le ping expiré est relâché pour que la boucle puisse s'arrêter : sans ça, la couche
        // rendrait `animationActive: false` mais l'objet resterait, et le prochain rendu le
        // réévaluerait pour rien.
        if (currentPing && !result.animationActive) currentPing = null;
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
    // Le transport va être coupé : sans ce retrait, un MJ congédié qui revient au premier plan
    // relancerait une resynchro sur un transport déconnecté et se verrait afficher une erreur
    // réseau purement cosmétique par-dessus l'écran d'éviction.
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibilityRestored);
    }
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
        // Amendement C-8 (10/09/2026) : la demande signifie « je n'ai rien, envoie tout ce que
        // tu as », pas « je n'ai rien pour MON étage ». `scheduleVisionResend` ne republie, via
        // `syncVision`, que les étages porteurs d'un PJ — un étage exploré puis quitté n'a plus
        // de signature qui bouge et ne serait donc jamais rediffusé par cette seule voie. On
        // republie ici, directement, le masque exploré de CHAQUE étage détenu dans
        // `exploredFogMap`, qui est l'autorité. ⚠ Publier trois à huit étages d'un coup est
        // volontaire, pas une rafale à corriger : `scheduleFogPublish` throttle chaque étage
        // séparément (1 Hz, un minuteur par `levelId`).
        for (const [levelId, fog] of exploredFogMap) {
          scheduleFogPublish(levelId, fog);
        }
        return;
      }

      // Un ping n'est pas une mutation de l'état de jeu : il ne passe pas par
      // `applyNetworkEvent`, il n'a rien à persister et il ne doit surtout pas se rejouer. Le cas
      // n'arrive qu'entre deux postes MJ — l'émission est réservée au MJ (CdC §5.5) — mais le
      // traiter coûte trois lignes et évite qu'un second écran reste muet sans qu'on sache pourquoi.
      if (event.type === 'ping') {
        const p = /** @type {any} */ (event.payload) || {};
        if (p.mapPos && Number.isFinite(p.mapPos.x) && Number.isFinite(p.mapPos.y)) {
          // ⛔ `Date.now()` local, pas `event.at`. Voir `PING_DURATION_MS`.
          currentPing = { levelId: p.levelId, mapPos: p.mapPos, at: Date.now() };
          requestRender();
        }
        return;
      }


      // ⛔ **`level.show` est ignoré ici, et c'est le miroir exact d'UX-10.** L'étage affiché du
      // MJ est son propre point de vue : ce n'est pas parce qu'il vient d'emmener la table sur un
      // étage que le sien doit y basculer aussi — les deux vues restent aussi découplées dans ce
      // sens qu'elles le sont déjà dans l'autre.
      //
      // ⚠ Il est écarté **avant** `applyNetworkEvent` et non dans le réducteur, exactement comme
      // `level.select` l'est côté joueurs dans `js/app/player.js` : le réducteur est partagé par
      // les deux vues, et la tablette, elle, doit continuer de l'appliquer.
      //
      // ⚠ **AUCUN TEST NE DISTINGUE CE FILTRE, et il faut le dire ici.** Mutation faite le
      // 07/09/2026 : filtre retiré, les cinq tests de `levelSwitch.spec.mjs` restent verts.
      // La raison est structurelle, pas un trou de couverture : le bouton publie toujours
      // l'étage **actif du MJ**, et `level.select` synchronise déjà les postes MJ entre eux —
      // un second MJ est donc TOUJOURS déjà sur cet étage quand le `level.show` lui arrive.
      // Le garde est défensif : il tient si un émetteur publie un jour un autre étage. Même
      // profil que la dette E-3 de `QUESTIONS-EN-ATTENTE.md`. ⛔ Ne pas le retirer au motif
      // qu'il est vert sous mutation.
      if (event.type === 'level.show') return;

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

      // ── UX-10 : le franchissement ne fait plus basculer AUCUN écran ────────────────────
      //
      // ⛔ **Le bloc de bascule automatique du lot 3 (S-04) est retiré ici, cadenas compris.**
      // Il faisait suivre le MJ au pion qui montait, et publiait un `level.select` qui emmenait
      // la table avec lui.
      //
      // La raison est la règle qui gouverne toute cette vague : **rien ne se déplace dans le dos
      // de personne**. Et elle mord plus fort ici qu'ailleurs, parce que la vue joueurs est **une
      // seule tablette partagée** : suivre le pion qui monte emmenait toute la table et
      // abandonnait les personnages restés en bas.
      //
      // L'étage d'arrivée devient simplement **connu** — son masque exploré existe dès que le
      // pion y voit — et il est donc offert dans le sélecteur des joueurs (UX-12). La table y va
      // quand elle décide d'y aller. Le pion monté cesse d'apparaître sur l'étage affiché :
      // c'est vrai, et c'est lisible.
      //
      // ⚠ Le cadenas 🔒 disparaît avec ce bloc : il n'existait que pour se soustraire à cette
      // bascule. Un cadenas qui ne suspend plus rien serait un contrôle qui ment, exactement le
      // défaut que ce lot corrige ailleurs.
      //
      // ── UX-10 : l'étage d'arrivée devient CONNU, sans que personne n'y soit emmené ────────
      //
      // ⭐ Ce n'est plus câblé ICI. `applyNetworkEvent`, juste au-dessus, a déjà muté le store —
      // et cette mutation a déjà notifié `syncVision` **synchroniquement**, avant que ce point du
      // code soit atteint (`notifySubscribers` dans `state/store.js` appelle ses abonnés en
      // ligne). `syncVision` calcule désormais la vision de tout étage qui porte un PJ, celui
      // d'arrivée compris, la publie — masque exploré ET masque visible, pas seulement le premier
      // comme le faisait ce bloc — et rend donc ce recalcul spécifique redondant. Un bloc dupliqué
      // manuellement ici referait le même travail deux fois pour rien.
      //
      // Preuve par mutation, gardée dans le rapport de la tranche qui a retiré ce bloc (09/09) :
      // le supprimer laisse verts `tests/multiLevelJourney.spec.mjs` (l'étage devient connu) et
      // `tests/levelSwitch.spec.mjs` (franchissement, groupe séparé).

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

  /**
   * Le poste MJ dort aussi — c'est même celui dont on change d'onglet. Onglet masqué, il cesse
   * de rafraîchir son bail de rétention ; passé le délai de péremption, un autre poste purge
   * des événements qu'il n'a jamais lus et que le canal ne rejouera pas.
   *
   * ⛔ La relecture est conditionnée au bail réellement périmé, jamais au simple réveil :
   * l'instantané est réécrit 250 ms après chaque mutation, donc le relire sans raison ferait
   * régresser l'état de façon permanente. Voir la même garde dans `player.js`.
   */
  const onVisibilityRestored = async () => {
    if (typeof document !== 'undefined' && document.hidden) return;
    if (!transportExtended?.mayHaveMissedEvents?.()) return;
    // ⛔ Attente BORNÉE, comme dans `player.js` : la réouverture du canal passe par des
    // opérations réseau qui ne rejettent pas hors connexion, et ce code s'exécute justement
    // quand le réseau se rétablit à peine. Sans échéance, ce `await` pourrait ne jamais rendre
    // la main.
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
  };
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityRestored);
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
      // ⛔ DEUX échelles, jamais une seule — E-11 : voir `js/vision/fog.js`.
      const origin0 = grid.mapFromCellPoint({ cellX: 0, cellY: 0 });
      const origin1 = grid.mapFromCellPoint({ cellX: 1, cellY: 0 });
      const origin1B = grid.mapFromCellPoint({ cellX: 0, cellY: 1 });
      const gridScaleX = Math.abs(origin1.x - origin0.x);
      const gridScaleY = Math.abs(origin1B.y - origin0.y);

      const radiusCells = gmPanel?.fogTools?.getBrushRadiusCells() ?? 1;
      const radiusPx = radiusCells * gridScaleX;

      if (intention.phase === 'start') {
        gmPanel?.fogTools?.pushUndoState();
      }

      if (activeTool === 'fog-reveal') {
        fog.paintDisc(intention.mapPos, radiusPx, origin0, gridScaleX, gridScaleY);
      } else if (activeTool === 'fog-hide') {
        fog.eraseDisc(intention.mapPos, radiusPx, origin0, gridScaleX, gridScaleY);
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

      if (activeToolName === 'ping') {
        // Affichage local immédiat, sans attendre l'aller-retour réseau : le MJ doit voir que son
        // geste a porté, y compris hors ligne. C'est aussi ce qui rend le critère des 500 ms
        // mesurable sur le seul poste distant, sans confondre les deux délais.
        currentPing = { levelId: activeLevel.id, mapPos: intention.mapPos, at: Date.now() };
        // ⛔ `at` est envoyé pour l'ordonnancement du canal, PAS pour le rendu : chaque poste
        // réhorodate à la réception. Envoyer l'instant d'émission sans cette règle rendrait le
        // ping invisible sur une tablette dont l'horloge avance.
        transport?.publish({
          type: 'ping',
          payload: { levelId: activeLevel.id, mapPos: intention.mapPos },
          at: Date.now(),
          by: 'gm',
        });
        // Un ping est un geste ponctuel, pas un mode : rester armé ferait pointer au clic suivant,
        // qui est presque toujours destiné à autre chose.
        gmPanel?.disarmActiveTool?.();
        requestRender();
        return;
      }

      if (activeToolName === 'measure') {
        const grid = gridFor(activeLevel);
        if (!currentMeasure || currentMeasure.levelId !== activeLevel.id || currentMeasure.end !== null) {
          currentMeasure = {
            levelId: activeLevel.id,
            start: intention.mapPos,
            end: null,
            distance: 0,
          };
        } else {
          const cellA = grid.cellFromPoint(currentMeasure.start);
          const cellB = grid.cellFromPoint(intention.mapPos);
          const distance = (cellA && cellB) ? grid.distance(cellA, cellB) : 0;
          currentMeasure = {
            levelId: activeLevel.id,
            start: currentMeasure.start,
            end: intention.mapPos,
            distance,
          };
          // ⛔ Zéro publication réseau pour la mesure : c'est un geste local au MJ.
          gmPanel?.disarmActiveTool?.();
        }
        requestRender();
        return;
      }

      if (activeToolName === 'template-place') {
        if (gmPanel?.templateTools) {
          const cfg = gmPanel.templateTools.getConfig();

          // ⭐ **Une règle de geste, et aucun champ de plus** (UX-06) : l'outil de pose étant
          // armé, si le tap tombe sur un pion, l'origine s'accroche au centre de ce pion ;
          // sinon elle reste sous le doigt. Un souffle part d'une gueule, un tir part d'un
          // tireur, et viser le centre d'un pion à la main coûte un geste à chaque sort.
          //
          // ⛔ Le gabarit ne RESTE PAS attaché au pion : une fois posé, il se déplace et pivote
          // à la main comme les autres. L'option « la ligne suit le pion » a été écartée avec
          // ses trois cas non tranchés — pion supprimé, pion qui change d'étage, pion masqué —
          // et son conflit avec le glisser de gabarit qui existe déjà côté joueurs. Il n'y a
          // donc **ni identifiant de pion dans le gabarit, ni case à cocher**.
          //
          // ⚠ Le centre se calcule comme le milieu du RECTANGLE que `findHitToken` teste, avec
          // les deux mêmes appels à `mapFromCellPoint` : ce qui est désigné et là où l'origine
          // se pose ne peuvent alors pas diverger. C'est volontairement solidaire de la
          // désignation, y compris de son défaut connu C-5 sur grille hexagonale — corriger
          // l'un sans l'autre les ferait se contredire.
          //
          // ⛔ **Désignation EXACTE, pas la tolérance de `findHitToken`.** Celle-ci applique une
          // marge de 24 px écran, plafonnée à 0,75 case : elle est faite pour *viser* un pion,
          // geste indulgent et réversible. Ancrer une origine demande l'inverse — de la
          // précision. Avec la marge, poser un mur de feu dans la case VOISINE du guerrier
          // faisait sauter l'origine sur le guerrier, et la ligne partait un demi-pas trop tôt.
          // Le brief dit « si le tap tombe sur un pion » : c'est la case, pas son voisinage.
          // ⛔ **Le CERCLE est exclu de l'accrochage, et c'est une décision du mainteneur
          // (17/08/2026) : « le cercle doit être 100 % libre par définition ».** Un cône part
          // d'une gueule et une ligne d'un tireur — leur origine EST un personnage. Un disque,
          // lui, se centre sur un point du terrain qu'on choisit, et le faire sauter sur un pion
          // parce que le doigt est tombé dessus retirerait au MJ le seul geste qui compte pour
          // cette forme.
          const accrochable = cfg.shape !== 'circle';
          const posGrid = gridFor(activeLevel);
          const tapCell = accrochable ? posGrid.cellFromPoint(intention.mapPos) : null;
          const hitToken = tapCell
            ? exactTokenAtCell(activeLevel, tapCell, state.campaign?.tokens ?? [])
            : null;
          let origin = intention.mapPos;
          if (hitToken) {
            const size = hitToken.sizeCells || 1;
            const coinA = posGrid.mapFromCellPoint({ cellX: hitToken.cell.a, cellY: hitToken.cell.b });
            const coinB = posGrid.mapFromCellPoint({
              cellX: hitToken.cell.a + size,
              cellY: hitToken.cell.b + size,
            });
            origin = { x: (coinA.x + coinB.x) / 2, y: (coinA.y + coinB.y) / 2 };
          }

          /** @type {import('../core/types.js').Template} */
          const template = {
            id: cfg.templateId,
            levelId: activeLevel.id,
            shape: cfg.shape,
            origin,
            radiusCells: cfg.radiusCells,
            directionDeg: 0,
            widthCells: cfg.widthCells,
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

      if (activeToolName === 'token-place') {
        // UX-08 : le pion généré se pose sur la case tapée. La construction et la publication
        // restent dans le panneau, qui tient le pion en attente et le transport — ici on ne
        // fournit que ce que seule la vue connaît : l'étage courant et la case sous le doigt.
        const grid = gridFor(activeLevel);
        const cell = grid.cellFromPoint(intention.mapPos);
        if (cell) gmPanel?.placePendingTokenAt?.(activeLevel.id, cell);
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

      if (activeToolName === 'light-place') {
        // ⭐ Poser (C-2, tranche 2) : le MJ tape une case → une lampe naît là, allumée, avec les
        // valeurs de `LIGHT_DEFAULT` — une seule source décide de ce qu'est « une lampe par
        // défaut » (constants.js), comme `TOKEN_TORCH_DEFAULT` pour la torche.
        const grid = gridFor(activeLevel);
        const cell = grid.cellFromPoint(intention.mapPos);
        if (cell) {
          const light = {
            id: `light-${Date.now()}-${++lightPlaceCounter}`,
            at: { cellX: cell.a, cellY: cell.b },
            ...LIGHT_DEFAULT,
          };
          store.placeLight(activeLevel.id, light);
          transport?.publish({
            type: 'light.place',
            payload: { levelId: activeLevel.id, light },
            at: Date.now(),
            by: 'gm',
          });
          requestRender();
        }
        return;
      }

      if (activeToolName === 'light-delete') {
        // Supprimer (C-2, tranche 2) : le MJ tape une lampe → elle disparaît, sans confirmation
        // — contrairement à un étage, une lampe se repose d'un tap (brief C-2 §4).
        const grid = gridFor(activeLevel);
        const hit = findHitLight(grid, activeLevel, intention.mapPos, camera.zoom);
        if (hit) {
          const removed = store.removeLight(activeLevel.id, hit.light.id);
          if (removed) {
            transport?.publish({
              type: 'light.delete',
              payload: { levelId: activeLevel.id, lightId: hit.light.id },
              at: Date.now(),
              by: 'gm',
            });
            requestRender();
          }
        }
        return;
      }

      const grid = gridFor(state.activeLevel);
      // Aucun `filter` : le MJ doit pouvoir désigner un PNJ caché. Seul `locked` est déclassé —
      // il reste sélectionnable (c'est le geste qui sert à le déverrouiller) mais ne vole pas la
      // désignation d'un voisin libre. ⛔ Ne pas y mettre la manipulabilité *joueur* : elle
      // déclasserait les PNJ, que le MJ manipule autant que les PJ.
      const tokenHit = findHitToken(
        grid,
        state.activeLevel,
        intention.mapPos,
        camera.zoom,
        state.campaign?.tokens ?? [],
        { deprioritize: (t) => !!t.locked }
      );

      // Même arbitrage par distance que la vue joueurs (js/ui/player/bootstrap.js) : le plus
      // proche gagne, comparé en unités CARTE — c'est elle qui porte la géométrie. Avant ce
      // chantier, le pion gagnait toujours ici, sans même la borne d'exactitude qu'avait la vue
      // joueurs ; un pion à portée de marge mais plus loin qu'une porte volait la désignation.
      const hitPortal = findHitPortal(grid, state.activeLevel, intention.mapPos, camera.zoom);

      // ⭐ La lampe (C-2) est un TROISIÈME candidat dans CETTE MÊME comparaison — ⛔ ne pas la
      // tester « avant » ou « après » les deux autres : c'est précisément l'ordre des branches
      // qui rendait une porte inatteignable derrière un pion, corrigé aujourd'hui, et que le
      // même défaut recréerait ici pour la lampe.
      const hitLight = findHitLight(grid, state.activeLevel, intention.mapPos, camera.zoom);

      /** @type {Array<{ kind: 'token'|'light'|'portal', dist: number }>} */
      const candidates = [];
      // Priorité au premier candidat de la liste à distance égale — c'est le biais qui existait
      // déjà pour porte/pion (le pion gagnait une égalité stricte).
      if (tokenHit) candidates.push({ kind: 'token', dist: tokenHit.dist });
      if (hitLight) candidates.push({ kind: 'light', dist: hitLight.dist });
      if (hitPortal) candidates.push({ kind: 'portal', dist: hitPortal.dist });
      candidates.sort((a, b) => a.dist - b.dist);
      const winner = candidates.length > 0 ? candidates[0].kind : null;

      if (winner === 'token' && tokenHit) {
        store.selectToken(tokenHit.token.id);
        return;
      }

      if (winner === 'light' && hitLight) {
        const light = hitLight.light;
        // Bascule (C-2) : l'état ABSOLU est publié, jamais « inverse-le » (comme
        // `portal.toggle`) — c'est ce qui rend l'événement rejouable sans diverger.
        const targetOn = !(light.on !== false);
        store.setLightState(state.activeLevel.id, light.id, targetOn);
        transport?.publish({
          type: 'light.toggle',
          payload: { levelId: state.activeLevel.id, lightId: light.id, on: targetOn },
          at: Date.now(),
          by: 'gm',
        });
        return;
      }

      if (winner === 'portal' && hitPortal) {
        const portal = hitPortal.portal;
        /** @type {'open'|'closed'|null} */
        let targetState = null;
        if (portal.state === 'closed') {
          targetState = 'open';
        } else if (portal.state === 'open') {
          targetState = 'closed';
        }
        // Depuis `locked`, un tap ne fait rien **et le signale** (TRANCHE-L05-PORTES.md §7.6).
        // La seconde moitié de cette exigence manquait : le code sortait en silence, et un
        // geste sans effet ni explication ne se distingue pas d'une panne. C'est ce qui a fait
        // conclure que l'état verrouillé n'était pas implémenté, alors qu'il l'était.
        if (!targetState && portal.state === 'locked') {
          lockedPortalFlash = { portalId: portal.id, at: Date.now() };
          requestRender();
        }
        if (targetState) {
          store.setPortalState(state.activeLevel.id, portal.id, targetState);
          transport?.publish({
            type: 'portal.toggle',
            payload: {
              levelId: state.activeLevel.id,
              portalId: portal.id,
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

      // ⛔ **L'appui long arbitre en faveur de la PORTE, et c'est ici que ça se décide.**
      //
      // Deux gestes partagent désormais cet appui : verrouiller une porte (L-05) et retirer un
      // gabarit (UX-05). Un gabarit posé sur une porte — le cas courant, on souffle dans un
      // couloir — les rend ambigus. La porte gagne parce que c'est le geste le plus ancien et
      // le plus utilisé, et parce que ses conséquences sont asymétriques : une porte qu'on
      // rate se retape, un gabarit retiré par erreur se repose de zéro avec son rayon, sa
      // couleur et son orientation.
      //
      // ⚠ Ne pas « améliorer » cet ordre en départageant par distance ou par ce qui est
      // dessiné au-dessus : la règle doit rester lisible sans mesurer, sinon le MJ ne peut
      // pas prévoir ce que son doigt va faire.
      const hitPortal = findHitPortal(grid, state.activeLevel, intention.mapPos, camera.zoom);
      if (hitPortal) {
        const portal = hitPortal.portal;
        const targetState = portal.state === 'locked' ? 'closed' : 'locked';
        store.setPortalState(state.activeLevel.id, portal.id, targetState);
        transport?.publish({
          type: 'portal.toggle',
          payload: {
            levelId: state.activeLevel.id,
            portalId: portal.id,
            state: targetState,
          },
          at: Date.now(),
          by: 'gm',
        });
        return;
      }

      const hitTemplate = findHitTemplate(
        state.activeLevel,
        state.campaign?.templates ?? [],
        intention.mapPos,
        camera.zoom,
        0,
        false
      );
      if (hitTemplate && store.removeTemplate(hitTemplate.template.id)) {
        transport?.publish({
          type: 'template.remove',
          payload: { templateId: hitTemplate.template.id },
          at: Date.now(),
          by: 'gm',
        });
        requestRender();
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
      return hit?.token.id ?? null;
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
      document.removeEventListener('visibilitychange', onVisibilityRestored);
    }
    pointerInput.detach();
    // Sans ceci, le flux vidéo survit à la destruction de la vue : Chromium continue de
    // décoder tant que l'élément existe avec une source. Toutes les autres ressources de
    // cette fonction sont libérées ici ; celle-ci est la plus coûteuse.
    videoBackdrop.detach();
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
    getCurrentMeasure: () => currentMeasure,
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

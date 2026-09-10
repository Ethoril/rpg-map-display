// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeCampaign, normalizeLevel, validateCampaign, createCampaign, createLevel, createToken } from '../js/core/schema.js';
import * as store from '../js/state/store.js';
import { computeBlockedEdges } from '../js/import/blockedEdges.js';
import { gridFor } from '../js/grid/index.js';
import { applyNetworkEvent } from '../js/app/networkEvents.js';
import { findHitPortal } from '../js/input/portalHit.js';
import {
  PORTAL_HIT_CELL_RATIO,
  PORTAL_HIT_SCREEN_FLOOR_PX,
  PORTAL_HIT_MAX_CELL_RATIO,
} from '../js/core/constants.js';

function makeValidPortalCampaign() {
  const level = createLevel({
    id: 'level-1',
    name: 'Étage 1',
    portals: [
      {
        id: 'portal-1',
        a: { cellX: 2, cellY: 2 },
        b: { cellX: 3, cellY: 2 },
        state: 'closed',
        freestanding: false,
      },
      {
        id: 'portal-2',
        a: { cellX: 5, cellY: 5 },
        b: { cellX: 5, cellY: 6 },
        state: 'open',
        freestanding: false,
      },
    ],
  });
  const token = createToken({
    id: 'token-1',
    label: 'Héro',
    kind: 'pc',
    levelId: 'level-1',
    cell: { a: 1, b: 1 },
  });
  return createCampaign({
    levels: [level],
    tokens: [token],
  });
}

test('1. Normalisation des portails dans les campagnes et étages', () => {
  const legacyCampaign = {
    version: 1,
    name: 'Legacy Campaign',
    levels: [
      {
        id: 'lvl',
        name: 'Lvl',
        order: 0,
        widthCells: 5,
        heightCells: 5,
        pxPerCell: 50,
        grid: { type: 'square', offsetX: 0, offsetY: 0 },
        walls: [],
        portals: [
          { id: 'p1', a: { cellX: 0, cellY: 0 }, b: { cellX: 1, cellY: 0 }, closed: true, freestanding: false },
          { id: 'p2', a: { cellX: 1, cellY: 0 }, b: { cellX: 2, cellY: 0 }, closed: false, freestanding: false },
          { id: 'p3', a: { cellX: 2, cellY: 0 }, b: { cellX: 3, cellY: 0 }, state: 'locked', freestanding: false },
        ],
        lights: [],
        ambient: { color: '#ffffff', level: 1.0, baked: false },
        animatedOverlays: [],
      },
    ],
    tokens: [],
    templates: [],
    tokenLibrary: [],
  };

  const normalized = normalizeCampaign(legacyCampaign);
  const portals = normalized.levels[0].portals;
  assert.equal(portals[0].state, 'closed');
  assert.equal(portals[1].state, 'open');
  assert.equal(portals[2].state, 'locked');

  // Test normalizeLevel directement
  const levelCopy = structuredClone(legacyCampaign.levels[0]);
  delete levelCopy.portals[0].state;
  normalizeLevel(levelCopy);
  assert.equal(levelCopy.portals[0].state, 'closed');
});

test('2. Validation stricte de validateCampaign sur state et structure de portail', () => {
  const invalidCampaign = makeValidPortalCampaign();
  // @ts-ignore
  invalidCampaign.levels[0].portals[0].state = 'ajar';

  const errors = validateCampaign(invalidCampaign);
  assert.ok(errors.length > 0);
  assert.ok(errors.some((e) => e.includes('level-1') && e.includes('portal-1')));
});

test('3. store.setPortalState et rafraîchissement des cases atteignables', () => {
  store.loadCampaign(makeValidPortalCampaign());
  const activeLvl = store.getState().activeLevel;
  assert.ok(activeLvl);

  // Sélectionner le pion
  const token = store.getCampaign()?.tokens[0];
  assert.ok(token);

  // Basculer l'état du portail
  store.setPortalState('level-1', 'portal-1', 'open');
  const updatedCampaign = store.getCampaign();
  assert.equal(updatedCampaign?.levels[0].portals[0].state, 'open');

  // Portails inexistants ou état illégal
  assert.throws(() => store.setPortalState('level-1', 'portal-unknown', 'open'), /Portail inconnu/);
  assert.throws(() => store.setPortalState('level-1', 'portal-1', /** @type {any} */ ('invalid')), /État de portail invalide/);
});

test('4. computeBlockedEdges prend en compte les états closed, locked et open', () => {
  const campaign = makeValidPortalCampaign();
  const level = campaign.levels[0];
  const grid = gridFor(level);

  level.portals[0].state = 'closed';
  const blockedClosed = computeBlockedEdges(level, grid);
  assert.ok(blockedClosed.size > 0);

  level.portals[0].state = 'locked';
  const blockedLocked = computeBlockedEdges(level, grid);
  assert.equal(blockedLocked.size, blockedClosed.size);

  level.portals[0].state = 'open';
  level.portals[1].state = 'open';
  const blockedOpen = computeBlockedEdges(level, grid);
  assert.equal(blockedOpen.size, 0);
});

test('5. Événement réseau portal.toggle', () => {
  store.loadCampaign(makeValidPortalCampaign());

  const applied = applyNetworkEvent({
    type: 'portal.toggle',
    payload: { levelId: 'level-1', portalId: 'portal-1', state: 'open' },
    at: Date.now(),
    by: 'gm',
  });
  assert.equal(applied, true);

  // Rejeu identique -> false (idempotence)
  const replayed = applyNetworkEvent({
    type: 'portal.toggle',
    payload: { levelId: 'level-1', portalId: 'portal-1', state: 'open' },
    at: Date.now(),
    by: 'gm',
  });
  assert.equal(replayed, false);

  // Invalide -> false
  const invalid = applyNetworkEvent({
    type: 'portal.toggle',
    payload: { levelId: 'level-1', portalId: 'portal-1', state: 'invalid' },
    at: Date.now(),
    by: 'gm',
  });
  assert.equal(invalid, false);
});

test('6. Capsule de désignation d\'une porte, et la case du pion voisin qui lui échappe', () => {
  const campaign = makeValidPortalCampaign();
  const level = campaign.levels[0];
  const grid = gridFor(level);
  const px = level.pxPerCell;

  // portal-1 est le segment horizontal du coin (2,2) au coin (3,2). En pixels carte, il court
  // donc le long de y = 2 px/case, entre x = 2 et x = 3 px/case.
  const onSegment = { x: 2.5 * px, y: 2 * px };
  assert.equal(findHitPortal(grid, level, onSegment)?.portal?.id, 'portal-1');

  // La tolérance est un ratio de case, pas une valeur en dur : le test la relit plutôt que de
  // la recopier, sinon il ne vérifierait que sa propre copie.
  const inside = PORTAL_HIT_CELL_RATIO * 0.8;
  const outside = PORTAL_HIT_CELL_RATIO * 1.2;
  assert.equal(findHitPortal(grid, level, { x: 2.5 * px, y: (2 + inside) * px })?.portal?.id, 'portal-1');
  assert.equal(findHitPortal(grid, level, { x: 2.5 * px, y: (2 + outside) * px }), null);

  // Le point qui motive le réglage, et il demande de la précision. Le centre exact de la case
  // voisine ne déclenchait DÉJÀ rien à 0,5 : il est à une demi-case pile du segment, et le
  // test est `dist < maxDist`, strict. La zone-piège n'était donc pas le centre mais tout ce
  // qui se trouve ENTRE la porte et lui — le doigt qui manque le pion d'un tiers de case
  // tombait dans la capsule et ouvrait la porte au lieu de ne rien sélectionner.
  const nearMiss = { x: 2.5 * px, y: (2 + 0.35) * px };
  assert.equal(findHitPortal(grid, level, nearMiss), null);

  // Et le centre de la case voisine, lui, était et reste hors capsule — la frontière exclusive
  // n'est pas un hasard qu'il faudrait « corriger ».
  const neighbourCentre = grid.pointFromCell({ a: 2, b: 2 });
  assert.equal(Math.abs(neighbourCentre.y - 2 * px), 0.5 * px);
  assert.equal(findHitPortal(grid, level, neighbourCentre), null);

  // Départage entre deux portes à égalité, par identifiant, pour ne pas dépendre de l'ordre
  // du tableau. Les deux segments sont ici équidistants du point choisi.
  const tie = createLevel({
    id: 'tie',
    portals: [
      { id: 'portal-b', a: { cellX: 4, cellY: 4 }, b: { cellX: 5, cellY: 4 }, state: 'closed', freestanding: false },
      { id: 'portal-a', a: { cellX: 4, cellY: 4 }, b: { cellX: 4, cellY: 5 }, state: 'closed', freestanding: false },
    ],
  });
  const tieGrid = gridFor(tie);
  const corner = { x: 4 * tie.pxPerCell, y: 4 * tie.pxPerCell };
  assert.equal(findHitPortal(tieGrid, tie, corner)?.portal?.id, 'portal-a');

  // Un étage sans porte ne désigne rien, et ne jette pas.
  assert.equal(findHitPortal(grid, createLevel({ id: 'vide' }), { x: 0, y: 0 }), null);
});

test('7. Capsule de désignation d\'une porte, à trois zooms — plancher écran et plafond carte', () => {
  // Décision du mainteneur du 10/09/2026 : la capsule vaut
  // `min(max(PORTAL_HIT_CELL_RATIO * échelle, PORTAL_HIT_SCREEN_FLOOR_PX / zoom), PORTAL_HIT_MAX_CELL_RATIO * échelle)`.
  // Ce test relit les trois constantes plutôt que de recopier leurs chiffres, sinon il ne
  // vérifierait que sa propre copie.
  const campaign = makeValidPortalCampaign();
  const level = campaign.levels[0];
  const grid = gridFor(level);
  const px = level.pxPerCell; // 140 : l'échelle de grille en unités carte par case.
  const cellFloor = PORTAL_HIT_CELL_RATIO * px; // 35
  const cellCap = PORTAL_HIT_MAX_CELL_RATIO * px; // 105

  /**
   * Sonde un point sur la normale à portal-1, à distance `d` unités carte de son segment.
   * @param {number} d
   * @param {number} [zoom]
   */
  function probe(d, zoom) {
    return findHitPortal(grid, level, { x: 2.5 * px, y: 2 * px + d }, zoom);
  }

  // Au cadrage joueurs mesuré (zoom 0,193) : `PORTAL_HIT_CELL_RATIO` ne vaut plus que 6,8 px
  // écran, sous ce que couvre un doigt. Le plancher écran domine et fixe la capsule à
  // `PORTAL_HIT_SCREEN_FLOOR_PX / zoom` (~104 unités carte), largement sous le plafond.
  const zoomCadrage = 0.193;
  const screenFloorAtCadrage = PORTAL_HIT_SCREEN_FLOOR_PX / zoomCadrage;
  assert.ok(screenFloorAtCadrage > cellFloor && screenFloorAtCadrage < cellCap);
  assert.ok(probe(screenFloorAtCadrage * 0.99, zoomCadrage) !== null);
  assert.equal(probe(screenFloorAtCadrage * 1.01, zoomCadrage), null);

  // À zoom 1, le plancher écran (20 unités) est sous le plancher carte (35 unités) : c'est ce
  // dernier qui fixe la capsule, comme avant ce chantier.
  assert.ok(probe(cellFloor * 0.99, 1) !== null);
  assert.equal(probe(cellFloor * 1.01, 1), null);

  // À zoom très faible (0,1), le plancher écran (200 unités) dépasserait le plafond sans lui :
  // la capsule est bornée à `PORTAL_HIT_MAX_CELL_RATIO` case (105 unités), strictement sous une
  // case entière (140 unités), et ne déborde donc jamais dans la case voisine.
  const zoomFaible = 0.1;
  assert.ok(PORTAL_HIT_SCREEN_FLOOR_PX / zoomFaible > cellCap);
  assert.ok(probe(cellCap * 0.99, zoomFaible) !== null);
  assert.equal(probe(cellCap * 1.01, zoomFaible), null);
  assert.ok(cellCap < px);

  // Sans zoom passé, comportement d'avant ce chantier : équivalent à zoom 1.
  assert.ok(probe(cellFloor * 0.99, undefined) !== null);
  assert.equal(probe(cellFloor * 1.01, undefined), null);
});

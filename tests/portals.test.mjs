// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeCampaign, normalizeLevel, validateCampaign, createCampaign, createLevel, createToken } from '../js/core/schema.js';
import * as store from '../js/state/store.js';
import { computeBlockedEdges } from '../js/import/blockedEdges.js';
import { gridFor } from '../js/grid/index.js';
import { applyNetworkEvent } from '../js/app/networkEvents.js';

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

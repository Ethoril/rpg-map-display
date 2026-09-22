// @ts-check
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { snapWallVertex, findWallAt } from '../js/ui/gm/wallEditor.js';
import { computeBlockedEdges } from '../js/import/blockedEdges.js';
import { gridFor } from '../js/grid/index.js';
import { validateCampaign, createCampaign, createLevel, createToken } from '../js/core/schema.js';
import { applyNetworkEvent } from '../js/app/networkEvents.js';
import * as store from '../js/state/store.js';

/**
 * Fabrique une campagne de test minimale et valide.
 * @returns {import('../js/core/types.js').Campaign}
 */
function makeTestCampaign() {
  const level1 = createLevel({
    id: 'level-1',
    name: 'Étage 1',
    widthCells: 8,
    heightCells: 8,
    walls: [
      [
        { cellX: 0, cellY: 0 },
        { cellX: 4, cellY: 0 },
      ],
    ],
    portals: [
      {
        id: 'portal-1',
        a: { cellX: 6, cellY: 6 },
        b: { cellX: 7, cellY: 6 },
        state: 'closed',
        freestanding: false,
      },
    ],
  });

  const token1 = createToken({
    id: 'token-1',
    label: 'Guerrier',
    levelId: 'level-1',
    cell: { a: 2, b: 2 },
    speedCells: 6,
  });

  return createCampaign({
    campaignId: 'camp-test',
    name: 'Campagne de Test',
    levels: [level1],
    tokens: [token1],
  });
}

describe('Tranche L-07 — Éditeur minimal de murs (Unit tests)', () => {
  beforeEach(() => {
    store.resetStore();
  });

  describe('1. Accrochage géométrique (§4)', () => {
    it('s\'accroche aux coins de case entiers par défaut', () => {
      const mapPos = { x: 104, y: 151 }; // raw cellX = 2.08, raw cellY = 3.02 (scale = 50)
      const level = makeTestCampaign().levels[0];
      const snap = snapWallVertex(mapPos, level, gridFor({ ...level, pxPerCell: 50 }));

      assert.deepEqual(snap, { cellX: 2, cellY: 3 });
    });

    it('accorde la priorité à une extrémité existante de mur dans le rayon de 0,5 case', () => {
      // Mur existant à (4, 0). Click à raw cellX = 4.15, cellY = 0.1 (dist < 0.5)
      const mapPos = { x: 4.15 * 50, y: 0.1 * 50 };
      const level = makeTestCampaign().levels[0];
      const snap = snapWallVertex(mapPos, level, gridFor({ ...level, pxPerCell: 50 }));

      assert.deepEqual(snap, { cellX: 4, cellY: 0 });
    });

    it('accorde la priorité à une extrémité existante de portail dans le rayon de 0,5 case', () => {
      // Portail existant à (6, 6). Click à raw cellX = 6.1, cellY = 6.1 (dist < 0.5)
      const mapPos = { x: 6.1 * 50, y: 6.1 * 50 };
      const level = makeTestCampaign().levels[0];
      const snap = snapWallVertex(mapPos, level, gridFor({ ...level, pxPerCell: 50 }));

      assert.deepEqual(snap, { cellX: 6, cellY: 6 });
    });
  });

  // B7 (audit du 22/09/2026) — l'éditeur convertissait avec une origine forcée à (0,0) et
  // l'échelle X seule. Sur un étage DÉCALÉ, l'accrochage et la suppression tombaient à côté du
  // mur dessiné (lequel passe par `grid.mapFromCellPoint`, offset compris).
  describe('1bis. Étage décalé : accrochage et suppression suivent le mur DESSINÉ (B7)', () => {
    const decale = () => {
      const level = { ...makeTestCampaign().levels[0], pxPerCell: 50,
        grid: { ...makeTestCampaign().levels[0].grid, offsetX: 30, offsetY: 20 } };
      return { level, grid: gridFor(level) };
    };

    it('le coin accroché est celui sous le doigt, offset compris', () => {
      const { level, grid } = decale();
      // Coin (2, 3) dessiné en x = 30 + 100 = 130, y = 20 + 150 = 170.
      assert.deepEqual(snapWallVertex({ x: 134, y: 172 }, level, grid), { cellX: 2, cellY: 3 });
    });

    it('un tap sur le mur dessiné le trouve, un tap à sa place « sans offset » non', () => {
      const { level, grid } = decale();
      // Le mur (0,0)→(4,0) est dessiné sur y = 20, de x = 30 à x = 230.
      assert.ok(findWallAt({ x: 225, y: 22 }, level, grid), 'sur le mur dessiné');
      assert.equal(findWallAt({ x: 225, y: -10 }, level, grid), null, 'là où il serait sans offset');
    });
  });

  describe('2. Mesure des arêtes bloquées (§1)', () => {
    it('y = 3 — frontière de case entière : exactement 14 arêtes bloquées', () => {
      const level = createLevel({
        id: 'test-8x8-1',
        name: 'Test 8x8',
        widthCells: 8,
        heightCells: 8,
        walls: [
          [
            { cellX: 2, cellY: 3 },
            { cellX: 6, cellY: 3 },
          ],
        ],
      });

      const edges = computeBlockedEdges(level, gridFor(level));
      assert.equal(edges.size, 14);
    });

    it('y = 3,5 — ligne des centres de case : exactement 29 arêtes bloquées', () => {
      const level = createLevel({
        id: 'test-8x8-2',
        name: 'Test 8x8',
        widthCells: 8,
        heightCells: 8,
        walls: [
          [
            { cellX: 2, cellY: 3.5 },
            { cellX: 6, cellY: 3.5 },
          ],
        ],
      });

      const edges = computeBlockedEdges(level, gridFor(level));
      assert.equal(edges.size, 29);
    });

    it('y = 3,1 — décalage de 0,1 : exactement 12 arêtes bloquées (perte des diagonales d\'extrémité)', () => {
      const level = createLevel({
        id: 'test-8x8-3',
        name: 'Test 8x8',
        widthCells: 8,
        heightCells: 8,
        walls: [
          [
            { cellX: 2, cellY: 3.1 },
            { cellX: 6, cellY: 3.1 },
          ],
        ],
      });

      const edges = computeBlockedEdges(level, gridFor(level));
      assert.equal(edges.size, 12);
    });
  });

  describe('3. Mutations Store addWall / removeWall (§9)', () => {
    it('refuse d\'ajouter une polyligne de moins de 2 points ou avec des coordonnées non finies', () => {
      store.loadCampaign(makeTestCampaign());

      assert.throws(
        () => store.addWall('level-1', [{ cellX: 1, cellY: 1 }]),
        /au moins 2 sommets/
      );
      assert.throws(
        () => store.addWall('level-1', [{ cellX: 1, cellY: NaN }, { cellX: 2, cellY: 2 }]),
        /Sommet de mur invalide/
      );
    });

    it('addWall ajoute la polyligne et rafraîchit les cases atteignables du pion sélectionné', () => {
      store.loadCampaign(makeTestCampaign());
      store.selectToken('token-1');

      const reachableBefore = store.getState().reachableCells;
      assert.ok(reachableBefore && reachableBefore.size > 0);

      const newWall = [
        { cellX: 2, cellY: 1 },
        { cellX: 2, cellY: 4 },
      ];
      store.addWall('level-1', newWall);

      const activeLevel = store.getActiveLevel();
      assert.equal(activeLevel?.walls.length, 2);
      assert.deepEqual(activeLevel?.walls[1], newWall);

      const reachableAfter = store.getState().reachableCells;
      assert.notEqual(reachableBefore, reachableAfter);
    });

    it('removeWall supprime la polyligne par égalité exacte de valeurs (idempotent)', () => {
      store.loadCampaign(makeTestCampaign());
      const wallToRemove = [
        { cellX: 0, cellY: 0 },
        { cellX: 4, cellY: 0 },
      ];

      const removed = store.removeWall('level-1', wallToRemove);
      assert.equal(removed, true);
      assert.equal(store.getActiveLevel()?.walls.length, 0);

      // Second retrait de la même polyligne : idempotent, rend false sans lever d'erreur
      const secondRemoved = store.removeWall('level-1', wallToRemove);
      assert.equal(secondRemoved, false);
    });
  });

  describe('4. Validation par Schéma (§9.2)', () => {
    it('refuse une polyligne à 1 seul sommet', () => {
      const camp = makeTestCampaign();
      camp.levels[0].walls = [[{ cellX: 1, cellY: 1 }]];

      const errors = validateCampaign(camp);
      assert.ok(errors.some((e) => e.includes('mur à l\'index 0') && e.includes('au moins 2 sommets')));
    });

    it('refuse un sommet avec coordonnée non finie', () => {
      const camp = makeTestCampaign();
      camp.levels[0].walls = [[{ cellX: 1, cellY: Infinity }, { cellX: 2, cellY: 2 }]];

      const errors = validateCampaign(camp);
      assert.ok(errors.some((e) => e.includes('mur à l\'index 0') && e.includes('sommet invalide')));
    });
  });

  describe('5. Événements réseau networkEvents (§8)', () => {
    it('traite wall.add et wall.remove avec succès', () => {
      store.loadCampaign(makeTestCampaign());

      /** @type {import('../js/core/types.js').NetEvent} */
      const addEvent = {
        type: 'wall.add',
        payload: {
          levelId: 'level-1',
          wall: [
            { cellX: 1, cellY: 1 },
            { cellX: 3, cellY: 1 },
          ],
        },
        at: Date.now(),
        by: 'gm',
      };

      const appliedAdd = applyNetworkEvent(addEvent);
      assert.equal(appliedAdd, true);
      assert.equal(store.getActiveLevel()?.walls.length, 2);

      /** @type {import('../js/core/types.js').NetEvent} */
      const removeEvent = {
        type: 'wall.remove',
        payload: {
          levelId: 'level-1',
          wall: [
            { cellX: 1, cellY: 1 },
            { cellX: 3, cellY: 1 },
          ],
        },
        at: Date.now(),
        by: 'gm',
      };

      const appliedRemove = applyNetworkEvent(removeEvent);
      assert.equal(appliedRemove, true);
      assert.equal(store.getActiveLevel()?.walls.length, 1);
    });

    it('refuse les événements avec payload malformé', () => {
      store.loadCampaign(makeTestCampaign());

      /** @type {import('../js/core/types.js').NetEvent} */
      const badAddEvent = {
        type: 'wall.add',
        payload: { levelId: 'level-1', wall: [{ cellX: 1, cellY: 1 }] },
        at: Date.now(),
        by: 'gm',
      };

      const applied = applyNetworkEvent(badAddEvent);
      assert.equal(applied, false);
    });
  });
});

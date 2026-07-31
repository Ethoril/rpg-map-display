// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLevel } from '../js/core/schema.js';
import { gridFor } from '../js/grid/index.js';
import { edgeKey } from '../js/core/cellKey.js';
import {
  computeBlockedEdges,
  isPortalOpen,
  segmentsIntersect,
  invalidateBlockedEdgesCache,
  getBlockedEdgesComputeCount,
  resetBlockedEdgesComputeCount,
} from '../js/import/blockedEdges.js';

test('isPortalOpen normalise correctement tous les formats de porte', () => {
  // Portal legacy (booléen closed)
  assert.equal(isPortalOpen({ id: 'p1', a: { cellX: 0, cellY: 0 }, b: { cellX: 1, cellY: 0 }, closed: false, freestanding: false }), true);
  assert.equal(isPortalOpen({ id: 'p2', a: { cellX: 0, cellY: 0 }, b: { cellX: 1, cellY: 0 }, closed: true, freestanding: false }), false);

  // Portal L-05 (state: 'open' | 'closed' | 'locked')
  assert.equal(isPortalOpen({ id: 'p3', a: { cellX: 0, cellY: 0 }, b: { cellX: 1, cellY: 0 }, closed: false, state: 'open', freestanding: false }), true);
  assert.equal(isPortalOpen({ id: 'p4', a: { cellX: 0, cellY: 0 }, b: { cellX: 1, cellY: 0 }, closed: true, state: 'closed', freestanding: false }), false);
  assert.equal(isPortalOpen({ id: 'p5', a: { cellX: 0, cellY: 0 }, b: { cellX: 1, cellY: 0 }, closed: true, state: 'locked', freestanding: false }), false);
});

test('segmentsIntersect traite correctement les cas limites (chevauchement colinéaire et contact)', () => {
  // Intersection orthogonale simple
  assert.equal(segmentsIntersect({ x: 0, y: 1 }, { x: 2, y: 1 }, { x: 1, y: 0 }, { x: 1, y: 2 }), true);

  // Contact sur l'extrémité du segment
  assert.equal(segmentsIntersect({ x: 0, y: 0 }, { x: 2, y: 2 }, { x: 2, y: 2 }, { x: 3, y: 3 }), true);

  // Mur passant exactement sur le centre d'une case
  assert.equal(segmentsIntersect({ x: 0, y: 1.5 }, { x: 3, y: 1.5 }, { x: 1.5, y: 1.5 }, { x: 1.5, y: 2.5 }), true);

  // Segments disjoints
  assert.equal(segmentsIntersect({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }), false);
});

test('Murs à coordonnées entières (manoir-rdc) : compte exact d arêtes bloquées', () => {
  // Mur vertical x = 2 de y = 0 à y = 5 sur une grille 5x5
  const level = createLevel({
    id: 'level-integer',
    widthCells: 5,
    heightCells: 5,
    walls: [
      [
        { cellX: 2, cellY: 0 },
        { cellX: 2, cellY: 5 },
      ],
    ],
  });
  const grid = gridFor(level);
  const edges = computeBlockedEdges(level, grid);

  // Sur une grille 5x5 avec un mur vertical à x=2:
  // - 5 arêtes orthogonales entre (1, b) et (2, b) pour b=0..4
  // - 4 arêtes diagonales entre (1, b) et (2, b+1) pour b=0..3
  // - 4 arêtes diagonales entre (1, b+1) et (2, b) pour b=0..3
  // Total exact = 13 arêtes bloquées
  assert.equal(edges.size, 13, 'Le mur vertical entier à x=2 doit bloquer exactement 13 arêtes');

  // Vérification de quelques clés canoniques spécifiques
  const eOrtho0 = edgeKey({ a: 1, b: 0 }, { a: 2, b: 0 });
  const eDiag0 = edgeKey({ a: 1, b: 0 }, { a: 2, b: 1 });
  assert.ok(edges.has(eOrtho0), 'L arête orthogonale (1,0)|(2,0) doit être bloquée');
  assert.ok(edges.has(eDiag0), 'L arête diagonale (1,0)|(2,1) doit être bloquée');
});

test('Murs à coordonnées fractionnaires (Dungeon Alchemist) : compte exact d arêtes bloquées', () => {
  // Mur vertical décalé à x = 2.070 (0.07 case de la ligne de grille) de y = 0 à y = 5 sur grille 5x5
  const level = createLevel({
    id: 'level-fractional',
    widthCells: 5,
    heightCells: 5,
    walls: [
      [
        { cellX: 2.07, cellY: 0 },
        { cellX: 2.07, cellY: 5 },
      ],
    ],
  });
  const grid = gridFor(level);
  const edges = computeBlockedEdges(level, grid);

  // Le mur décalé est situé entre les centres x=1.5 (col 1) et x=2.5 (col 2).
  // Il croise exactement les mêmes 13 segments centre-à-centre.
  // Une approche par accrochage trouverait 0 arête ; le test centre-à-centre en trouve exactement 13.
  assert.equal(edges.size, 13, 'Le mur fractionnaire décalé à x=2.07 doit bloquer exactement 13 arêtes');
});

test('Mur oblique : bloque au moins les arêtes traversées par son tracé', () => {
  // Mur diagonal de (0, 0) à (3, 3) sur une grille 3x3
  const level = createLevel({
    id: 'level-oblique',
    widthCells: 3,
    heightCells: 3,
    walls: [
      [
        { cellX: 0, cellY: 0 },
        { cellX: 3, cellY: 3 },
      ],
    ],
  });
  const grid = gridFor(level);
  const edges = computeBlockedEdges(level, grid);

  // Le mur croise l'arête diagonale reliant (0,1) et (1,0) [centres (0.5, 1.5) et (1.5, 0.5)] en (1.0, 1.0)
  const eDiag1 = edgeKey({ a: 0, b: 1 }, { a: 1, b: 0 });
  // Et l'arête diagonale reliant (1,2) et (2,1) [centres (1.5, 2.5) et (2.5, 1.5)] en (2.0, 2.0)
  const eDiag2 = edgeKey({ a: 1, b: 2 }, { a: 2, b: 1 });

  assert.ok(edges.has(eDiag1), 'L arête diagonale (0,1)|(1,0) doit être bloquée par le mur oblique');
  assert.ok(edges.has(eDiag2), 'L arête diagonale (1,2)|(2,1) doit être bloquée par le mur oblique');
  assert.ok(edges.size > 0, 'Le mur oblique doit produire des arêtes bloquées');
});

test('Porte ouverte ne bloque pas, la même porte fermée/verrouillée bloque', () => {
  const levelData = {
    id: 'level-door',
    widthCells: 3,
    heightCells: 3,
    portals: [
      {
        id: 'door-1',
        a: { cellX: 1, cellY: 0 },
        b: { cellX: 1, cellY: 1 },
        closed: false,
        freestanding: false,
      },
    ],
  };

  // 1. Porte ouverte (closed: false)
  const levelOpen = createLevel(levelData);
  const gridOpen = gridFor(levelOpen);
  const edgesOpen = computeBlockedEdges(levelOpen, gridOpen);
  assert.equal(edgesOpen.size, 0, 'Une porte ouverte ne doit bloquer aucune arête');

  // 2. Même porte fermée (closed: true)
  const levelClosed = createLevel({
    ...levelData,
    portals: [{ ...levelData.portals[0], closed: true }],
  });
  const gridClosed = gridFor(levelClosed);
  const edgesClosed = computeBlockedEdges(levelClosed, gridClosed);
  assert.ok(edgesClosed.size > 0, 'La porte fermée doit bloquer au moins 1 arête');

  // 3. Même porte avec state: 'locked'
  const levelLocked = createLevel({
    ...levelData,
    portals: [
      { ...levelData.portals[0], closed: true, state: 'locked' },
    ],
  });
  const gridLocked = gridFor(levelLocked);
  const edgesLocked = computeBlockedEdges(levelLocked, gridLocked);
  assert.deepEqual(Array.from(edgesLocked), Array.from(edgesClosed), 'Porte verrouillée et fermée ont le même masque');
});

test('Cache par étage (computeBlockedEdges) et réévaluation lors des changements', () => {
  invalidateBlockedEdgesCache();
  resetBlockedEdgesComputeCount();

  const level = createLevel({
    id: 'test-level-cache',
    widthCells: 5,
    heightCells: 5,
    walls: [
      [
        { cellX: 2, cellY: 0 },
        { cellX: 2, cellY: 5 },
      ],
    ],
  });
  const grid = gridFor(level);

  // Premier appel : calcul réel et mise en cache
  const edges1 = computeBlockedEdges(level, grid);
  assert.equal(edges1.size, 13);
  assert.equal(getBlockedEdgesComputeCount(), 1, 'Premier appel doit déclencher 1 calcul réel');

  // Second appel sans modification géométrique : servi depuis le cache
  const edges2 = computeBlockedEdges(level, grid);
  assert.equal(edges2.size, 13);
  assert.deepEqual(Array.from(edges1), Array.from(edges2));
  assert.equal(getBlockedEdgesComputeCount(), 1, 'Second appel ne doit PAS incrémenter le compteur de calculs');

  // Invalidation forcée
  invalidateBlockedEdgesCache(level.id);
  const edges3 = computeBlockedEdges(level, grid);
  assert.equal(edges3.size, 13);
  assert.equal(getBlockedEdgesComputeCount(), 2, 'Troisième appel après invalidation doit recalculer (compteur=2)');
});

test('Test de mutation : la modification du Set retourné depuis le cache ne corrompt pas les appels suivants', () => {
  invalidateBlockedEdgesCache();

  const level = createLevel({
    id: 'test-level-mutation',
    widthCells: 5,
    heightCells: 5,
    walls: [
      [
        { cellX: 2, cellY: 0 },
        { cellX: 2, cellY: 5 },
      ],
    ],
  });
  const grid = gridFor(level);

  // 1er appel : remplit le cache
  computeBlockedEdges(level, grid);

  // 2e appel : extrait une copie du Set depuis le cache
  const edgesFromCache = computeBlockedEdges(level, grid);
  const fakeKey = '99,99|100,100';

  // Mutation sauvage sur le Set obtenu du cache
  edgesFromCache.add(fakeKey);
  assert.ok(edgesFromCache.has(fakeKey), 'Le Set local a bien été muté');

  // 3e appel : vérifie que le cache interne n'a pas été contaminé par la mutation de edgesFromCache
  const edgesClean = computeBlockedEdges(level, grid);
  assert.equal(edgesClean.has(fakeKey), false, 'Le cache doit restituer un Set propre sans la fausse clé');
  assert.equal(edgesClean.size, 13);
});

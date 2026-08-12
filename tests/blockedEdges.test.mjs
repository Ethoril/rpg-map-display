// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLevel } from '../js/core/schema.js';
import { gridFor } from '../js/grid/index.js';
import { edgeKey } from '../js/core/cellKey.js';
import {
  computeBlockedEdges,
  extractBlockedSegments,
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
        state: /** @type {'open'} */ ('open'),
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
    portals: [{ ...levelData.portals[0], state: 'closed', closed: true }],
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

// R-08 : ce test n'asserte **que le compte**. La durée, elle, est une mesure — elle dépend de la
// charge de la machine et n'a donc pas sa place dans la porte : elle a rougi une fois sur du code
// juste, pendant un audit qui lançait deux suites en parallèle. Elle vit maintenant dans
// `tests/mesures/blockedEdgesIndex.spec.mjs`, qui imprime des nombres et n'affirme aucun seuil.
test('R-01 : computeBlockedEdges rend exactement 2701 arêtes sur testbig150', async () => {
  const fs = await import('node:fs');
  assert.ok(
    fs.existsSync('maps/generated/testbig150.scene.json'),
    'la scène testbig150 est suivie par git : son absence est une anomalie, pas une raison de sauter le test'
  );
  const campaignData = JSON.parse(fs.readFileSync('maps/generated/testbig150.scene.json', 'utf8'));
  const level = campaignData.levels[0];
  const grid = gridFor(level);

  invalidateBlockedEdgesCache(level.id);
  const edges = computeBlockedEdges(level, grid);
  assert.equal(edges.size, 2701, 'exactement 2701 arêtes bloquées sur testbig150');
});

test('R-04a : computeBlockedEdges lève si l’adaptateur ne fournit pas allCells', () => {
  const level = createLevel({
    id: 'lvl-sans-allcells',
    grid: { type: 'square', offsetX: 0, offsetY: 0, color: '#000000', opacity: 0.25, visible: true },
    widthCells: 5,
    heightCells: 5,
    pxPerCell: 140,
    walls: [[{ cellX: 2, cellY: 0 }, { cellX: 2, cellY: 5 }]],
  });
  const complet = gridFor(level);

  // Le contrat `GridAdapter` garantit `allCells`. Si elle manque, c'est une erreur de
  // programmation : rendre un ensemble vide ferait rendre zéro arête bloquée, donc **les murs
  // cesseraient de bloquer en silence**. On exige donc une levée, pas un repli.
  const ampute = /** @type {any} */ ({
    type: complet.type,
    pointFromCell: complet.pointFromCell.bind(complet),
    mapFromCellPoint: complet.mapFromCellPoint.bind(complet),
    cellPointFromMap: complet.cellPointFromMap.bind(complet),
    neighbors: complet.neighbors.bind(complet),
  });

  invalidateBlockedEdgesCache(level.id);
  // ⛔ Le motif est **le message du contrat**, pas le simple mot « allCells ». Sans le garde
  // explicite, l'exécution atteindrait `grid.allCells(...)` douze lignes plus bas et V8 lèverait
  // « grid.allCells is not a function » — qu'un motif large accepterait, laissant croire que le
  // garde est éprouvé alors qu'on peut le supprimer sans rien faire rougir.
  assert.throws(
    () => computeBlockedEdges(level, ampute),
    /GridAdapter\.allCells\(\) est requis/,
    'un adaptateur sans allCells doit lever le message du contrat, jamais rendre un ensemble vide'
  );

  // Et l'adaptateur complet, lui, bloque bien quelque chose : sans cette seconde moitié, la
  // levée pourrait venir d'un étage qui n'a de toute façon aucune arête à bloquer.
  invalidateBlockedEdgesCache(level.id);
  assert.ok(computeBlockedEdges(level, complet).size > 0);
});

test('Le cache d’arêtes tient compte du pavage et des dimensions, pas seulement des murs', () => {
  const murs = [[{ cellX: 2, cellY: 0 }, { cellX: 2, cellY: 5 }]];
  /** @param {'square'|'hex'} type @param {number} h */
  const etage = (type, h) => createLevel({
    id: 'lvl-signature', // ⚠ le MÊME identifiant : c'est tout l'objet du test
    grid: { type, offsetX: 0, offsetY: 0, color: '#000000', opacity: 0.25, visible: true },
    widthCells: 5,
    heightCells: h,
    pxPerCell: 140,
    walls: murs,
  });

  /**
   * Ce que rend un étage seul, cache vidé — la référence.
   * @param {import('../js/core/types.js').Level} level
   * @returns {number}
   */
  const seul = (level) => {
    invalidateBlockedEdgesCache();
    return computeBlockedEdges(level, gridFor(level)).size;
  };

  // 1. Changement de pavage, à identifiant et murs identiques.
  const carre = etage('square', 5);
  const hex = etage('hex', 5);
  const refCarre = seul(carre);
  const refHex = seul(hex);
  assert.notEqual(refCarre, refHex, 'les deux pavages doivent bien différer, sinon le test ne prouve rien');

  invalidateBlockedEdgesCache();
  computeBlockedEdges(carre, gridFor(carre)); // remplit le cache sous l'identifiant partagé
  assert.equal(
    computeBlockedEdges(hex, gridFor(hex)).size,
    refHex,
    'le cache doit être invalidé par le changement de pavage, pas resservir le masque du carré'
  );

  // 2. Changement de dimensions, qui arrive à chaque recalibrage d'une carte.
  const haut = etage('square', 5);
  const bas = etage('square', 2);
  const refBas = seul(bas);
  assert.notEqual(seul(haut), refBas, 'les deux hauteurs doivent bien différer');

  invalidateBlockedEdgesCache();
  computeBlockedEdges(haut, gridFor(haut));
  assert.equal(
    computeBlockedEdges(bas, gridFor(bas)).size,
    refBas,
    'le cache doit être invalidé par le changement de dimensions'
  );
});

test('R-06 : Équivalence stricte index spatial vs force brute (9 formes carré/hex, 122 murs déterministes)', () => {
  // PRNG LCG déterministe
  /** @param {number} seed @returns {() => number} */
  function createLcg(seed) {
    let s = seed;
    return () => {
      s = (s * 1664525 + 1013904223) % 4294967296;
      return s / 4294967296;
    };
  }

  // Force brute pure
  /**
   * @param {import('../js/core/types.js').Level} level
   * @param {import('../js/grid/GridAdapter.js').GridAdapter} grid
   * @returns {Set<string>}
   */
  function computeBruteForce(level, grid) {
    const blocked = new Set();
    const rawSegments = extractBlockedSegments(level, grid);
    if (rawSegments.length === 0) return blocked;

    const width = level.widthCells;
    const height = level.heightCells;
    const cells = grid.allCells(width, height);
    const processedEdges = new Set();

    for (const cell of cells) {
      const centerA = grid.pointFromCell(cell);
      const neighbors = grid.neighbors(cell);

      for (const n of neighbors) {
        const key = edgeKey(cell, n);
        if (processedEdges.has(key)) continue;
        processedEdges.add(key);

        const centerB = grid.pointFromCell(n);

        for (let i = 0; i < rawSegments.length; i++) {
          const seg = rawSegments[i];
          if (segmentsIntersect(seg.p1, seg.p2, centerA, centerB)) {
            blocked.add(key);
            break;
          }
        }
      }
    }
    return blocked;
  }

  /**
   * Murs déterministes couvrant l'étage, denses assez pour couper la plupart des arêtes.
   * @param {number} graine
   * @param {number} w
   * @param {number} h
   */
  const murs = (graine, w, h) => {
    const nextRand = createLcg(graine);
    /** @type {Array<Array<{ cellX: number, cellY: number }>>} */
    const res = [];
    // ⛔ La plage déborde de **1,5 case de chaque côté**, et ce n'est pas de la générosité. Des
    // murs strictement contenus dans `[0,w] × [0,h]` ne peuvent pas produire le défaut du
    // 12/08/2026 : un mur dont les DEUX extrémités ont `cellX < 0` — cas courant d'un UVTT importé
    // qui longe le bord gauche — donnait une plage de seaux vide et n'était rangé nulle part.
    // 11 arêtes bloquées perdues en silence sur un hex 10 × 8. Un jeu de murs positif est aveugle
    // à cette classe **par construction**, pas par malchance.
    /** @param {number} n @returns {number} */
    const etale = (n) => Math.floor(nextRand() * (n + 3) * 10) / 10 - 1.5;
    for (let i = 0; i < 120; i++) {
      res.push([
        { cellX: etale(w), cellY: etale(h) },
        { cellX: etale(w), cellY: etale(h) },
      ]);
    }
    // Deux murs de bord posés à la main, pour que la classe soit couverte même si le générateur
    // change : l'un entièrement à gauche de la carte, l'autre entièrement au-dessus.
    res.push([{ cellX: -0.5, cellY: -0.5 }, { cellX: -0.5, cellY: h + 0.5 }]);
    res.push([{ cellX: -0.5, cellY: -0.5 }, { cellX: w + 0.5, cellY: -0.5 }]);
    return res;
  };

  // ⭐ Les **petites** formes ne sont pas de la décoration. Deux défauts trouvés le 12 août ne se
  // voyaient que sur elles :
  //   — `hex 4 × 2` est la plus petite forme où la clé de déduplication d'arête, si l'un de ses
  //     deux termes n'est pas un index de case, perd une arête (2,0)|(3,0) **en silence** ;
  //   — les formes non carrées séparent l'index de boucle de l'index de case, que les 20 × 20
  //     confondent à la diagonale près.
  // ⚠ La densité et le décalage varient aussi : `102,4 px/case` est une densité réelle du dépôt
  // (`heterogeneousLevels`), et un décalage non nul déplace toute l'arithmétique de seau.
  const FORMES = /** @type {Array<['square'|'hex', number, number, number, number, number]>} */ ([
    ['square', 20, 20, 140, 0, 0],
    ['hex', 20, 20, 140, 0, 0],
    ['hex', 4, 2, 140, 0, 0],
    ['hex', 5, 3, 140, 0, 0],
    ['square', 13, 7, 140, 0, 0],
    ['hex', 13, 7, 140, 0, 0],
    ['hex', 10, 8, 102.4, 37.5, -12.25],
    ['hex', 1, 9, 140, 0, 0],
    ['square', 9, 1, 102.4, -8.5, 3.25],
  ]);

  for (const [gridType, w, h, px, ox, oy] of FORMES) {
    const nom = `${gridType} ${w}×${h} @${px}px (${ox},${oy})`;
    const level = createLevel({
      id: `lvl-r06-${gridType}-${w}x${h}-${px}-${ox}`,
      grid: { type: gridType, offsetX: ox, offsetY: oy, color: '#000000', opacity: 0.25, visible: true },
      widthCells: w,
      heightCells: h,
      pxPerCell: px,
      walls: murs(12345, w, h),
    });
    const grid = gridFor(level);

    invalidateBlockedEdgesCache(level.id);
    const indexedEdges = computeBlockedEdges(level, grid);
    const bruteEdges = computeBruteForce(level, grid);

    assert.ok(
      bruteEdges.size > 0,
      `[${nom}] la force brute doit trouver des arêtes bloquées, sinon la comparaison est vide de sens`
    );

    assert.deepEqual(
      Array.from(indexedEdges).sort(),
      Array.from(bruteEdges).sort(),
      `[${nom}] l'index doit égaler exactement la force brute (0 manquée, 0 en trop) — ${bruteEdges.size} arêtes attendues`
    );
  }
});

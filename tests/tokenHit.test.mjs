// @ts-check

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  findHitToken,
  exactTokenAtCell,
  distancePointToRectangle,
  isPlayerManipulableToken,
} from '../js/input/tokenHit.js';
import { SquareGrid } from '../js/grid/SquareGrid.js';
import { createLevel, createToken } from '../js/core/schema.js';
import { TOKEN_HIT_MARGIN_SCREEN_PX, TOKEN_HIT_MAX_CELL_RATIO } from '../js/core/constants.js';

const mockLevel = createLevel({
  id: 'level-1',
  name: 'Étage 1',
  imageUrl: 'test.jpg',
  pxPerCell: 100,
  widthCells: 20,
  heightCells: 20,
});

const grid = new SquareGrid(mockLevel);

/**
 * @param {Partial<import('../js/core/types.js').Token> & { id: string }} overrides
 * @returns {import('../js/core/types.js').Token}
 */
function makeToken(overrides) {
  return createToken({ levelId: 'level-1', ...overrides });
}

test('distancePointToRectangle — calcul exact de la distance au rectangle', () => {
  const rect = { x: 100, y: 100, w: 100, h: 100 }; // case (1,1) de 100x100

  assert.equal(distancePointToRectangle({ x: 150, y: 150 }, rect), 0);
  assert.equal(distancePointToRectangle({ x: 100, y: 150 }, rect), 0);
  assert.equal(distancePointToRectangle({ x: 220, y: 150 }, rect), 20);
  assert.equal(
    Math.round(distancePointToRectangle({ x: 210, y: 210 }, rect) * 100),
    1414
  );
});

test('exactTokenAtCell — sélection stricte par appartenance de case & filtre', () => {
  const tokens = [
    makeToken({ id: 't1', levelId: 'level-1', cell: { a: 2, b: 2 }, sizeCells: 1, label: 'Gobelin', kind: 'npc' }),
    makeToken({ id: 't-hidden', levelId: 'level-1', cell: { a: 3, b: 3 }, sizeCells: 1, hidden: true, label: 'Ombre', kind: 'npc' }),
  ];

  assert.equal(exactTokenAtCell(mockLevel, { a: 2, b: 2 }, tokens)?.id, 't1');
  assert.equal(exactTokenAtCell(mockLevel, { a: 2, b: 3 }, tokens), null);
  assert.equal(exactTokenAtCell(mockLevel, { a: 3, b: 3 }, tokens)?.id, 't-hidden');

  // Test du filtre
  assert.equal(exactTokenAtCell(mockLevel, { a: 3, b: 3 }, tokens, { filter: (t) => !t.hidden }), null);
});

test('findHitToken — tap au centre vs dans la marge vs au-delà (constante dynamique)', () => {
  const tokens = [
    makeToken({ id: 't1', levelId: 'level-1', cell: { a: 5, b: 5 }, sizeCells: 1, label: 'Héros', kind: 'pc' }),
  ];
  // Pion t1 à (5,5), rectangle carte (500, 500) à (600, 600).
  const zoom = 1.0;
  const marginPx = TOKEN_HIT_MARGIN_SCREEN_PX; // Ex: 24

  // 1. Tap au centre (550, 550) -> hit
  const hitCenter = findHitToken(grid, mockLevel, { x: 550, y: 550 }, zoom, tokens);
  assert.equal(hitCenter?.id, 't1');

  // 2. Tap dans la marge (600 + marginPx - 4, 550) -> hit
  const hitMargin = findHitToken(grid, mockLevel, { x: 600 + marginPx - 4, y: 550 }, zoom, tokens);
  assert.equal(hitMargin?.id, 't1');

  // 3. Tap au-delà de la marge (600 + marginPx + 4, 550) -> miss
  const missFar = findHitToken(grid, mockLevel, { x: 600 + marginPx + 4, y: 550 }, zoom, tokens);
  assert.equal(missFar, null);
});

test('findHitToken — le plafond en cases borne la marge au zoom lointain', () => {
  // Sans plafond, 24 px d'écran couvrent plusieurs cases dès que la carte est très dézoomée, et un
  // tap attraperait un pion à deux cases de là (brief O §3). C'est le plafond qui l'interdit, et
  // c'est la seule règle que la marge seule ne protège pas.
  const origine = grid.mapFromCellPoint({ cellX: 0, cellY: 0 });
  const caseMap = Math.abs(grid.mapFromCellPoint({ cellX: 1, cellY: 0 }).x - origine.x);
  const zoom = 0.1;
  const margeSansPlafond = TOKEN_HIT_MARGIN_SCREEN_PX / zoom;
  const plafond = TOKEN_HIT_MAX_CELL_RATIO * caseMap;

  // Témoin : à ce zoom, c'est bien le plafond qui doit limiter, pas la marge.
  assert.ok(margeSansPlafond > plafond);

  const tokens = [makeToken({ id: 'loin', cell: { a: 3, b: 1 } })]; // rectangle (300,100)-(400,200)

  // Au-delà du plafond mais en dessous de la marge brute : rien ne doit être désigné.
  assert.equal(findHitToken(grid, mockLevel, { x: 300 - (plafond + 20), y: 150 }, zoom, tokens), null);

  // Juste en dessous du plafond : le pion est désigné.
  assert.equal(
    findHitToken(grid, mockLevel, { x: 300 - (plafond - 5), y: 150 }, zoom, tokens)?.id,
    'loin'
  );
});

test('findHitToken — pion 1x1 vs grand pion 3x3 (mesure au rectangle discriminante)', () => {
  const tokens = [
    makeToken({ id: 'gobelin', levelId: 'level-1', cell: { a: 2, b: 1 }, sizeCells: 1, label: 'Gobelin', kind: 'npc' }),
    makeToken({ id: 'ogre', levelId: 'level-1', cell: { a: 3, b: 1 }, sizeCells: 3, label: 'Ogre', kind: 'npc' }),
  ];
  // Gobelin en (2,1) -> rect (200,100)-(300,200), centre (250,150)
  // Ogre en (3,1) 3x3 -> rect (300,100)-(600,400), centre (450,250)
  // Point testé: (310, 150)
  // Distance au rectangle de l'Ogre = 0 (à l'intérieur de l'Ogre).
  // Distance au rectangle du Gobelin = 10 px.
  // Si la mesure se faisait au centre: Gobelin = 60 px vs Ogre = 172 px (le Gobelin l'emporterait à tort).
  // Avec la mesure au rectangle: Ogre (dist 0) gagne !

  const hitCorner = findHitToken(grid, mockLevel, { x: 310, y: 150 }, 1.0, tokens);
  assert.equal(hitCorner?.id, 'ogre');
});

test('findHitToken — PNJ sous le doigt (dist=0) l’emporte sur un PC manipulable dans la marge', () => {
  const tokens = [
    makeToken({ id: 'pnj-under-finger', levelId: 'level-1', cell: { a: 2, b: 1 }, sizeCells: 1, label: 'PNJ', kind: 'npc', playerMovable: false }),
    makeToken({ id: 'pc-in-margin', levelId: 'level-1', cell: { a: 1, b: 1 }, sizeCells: 1, label: 'PC', kind: 'pc', playerMovable: true }),
  ];
  // pnj-under-finger: (200,100)-(300,200). Point (205,150) -> dist = 0.
  // pc-in-margin: (100,100)-(200,200). Point (205,150) -> dist = 5.
  //
  // Configuration exacte de la vue joueurs : le PNJ est déclassé, et il gagne quand même parce
  // qu'aucun déclassement ne passe devant l'inclusion (brief O §7.4). C'est le sens de l'ordre des
  // règles dans `findHitToken` ; l'inverser rend ce test rouge, et c'est le but.
  const hit = findHitToken(grid, mockLevel, { x: 205, y: 150 }, 1.0, tokens, {
    deprioritize: (t) => !isPlayerManipulableToken(t),
  });
  assert.equal(hit?.id, 'pnj-under-finger');
});

/**
 * Deux pions équidistants du point (250, 150) : celui de la case (1,1) — rectangle
 * (100,100)-(200,200) — et celui de la case (3,1) — rectangle (300,100)-(400,200). À zoom 0,3 la
 * marge vaut min(24 / 0,3 ; 0,75 × 100) = 75 px carte, donc les deux sont candidats à 50 px.
 *
 * ⚠ Les identifiants sont choisis pour que le **départage par identifiant désigne l'autre** pion
 * que celui attendu. Sans cela le test passerait sans que `deprioritize` soit consulté : c'est
 * exactement le piège dans lequel la première version de ce test était tombée, en nommant le pion
 * attendu `token-pc` face à un `token-pnj` que l'ordre alphabétique écartait déjà.
 *
 * @param {import('../js/core/types.js').Token} attendu
 * @param {import('../js/core/types.js').Token} evince
 * @param {(token: import('../js/core/types.js').Token) => boolean} deprioritize
 */
function departageDansLaMarge(attendu, evince, deprioritize) {
  const tokens = [attendu, evince];
  const pt = { x: 250, y: 150 };
  const zoom = 0.3;

  // Témoin : sans prédicat, l'identifiant tranche et c'est l'AUTRE qui gagne.
  assert.equal(findHitToken(grid, mockLevel, pt, zoom, tokens)?.id, evince.id);

  return findHitToken(grid, mockLevel, pt, zoom, tokens, { deprioritize })?.id;
}

test('findHitToken — vue joueurs : à distance égale, le pion manipulable par le joueur passe devant', () => {
  const pc = makeToken({ id: 'z-pc', cell: { a: 3, b: 1 }, kind: 'pc', playerMovable: true });
  const pnj = makeToken({ id: 'a-pnj', cell: { a: 1, b: 1 }, kind: 'npc', playerMovable: false });

  assert.equal(
    departageDansLaMarge(pc, pnj, (t) => !isPlayerManipulableToken(t)),
    'z-pc'
  );
});

test('findHitToken — vue MJ : à distance égale, le pion verrouillé passe derrière, PJ comme PNJ', () => {
  // Le geste qui sert à déverrouiller un pion doit rester possible : `locked` est déclassé, pas
  // exclu (brief O §5b).
  const libre = makeToken({ id: 'z-libre', cell: { a: 3, b: 1 }, kind: 'pc' });
  const verrouille = makeToken({ id: 'a-verrouille', cell: { a: 1, b: 1 }, kind: 'pc', locked: true });
  assert.equal(departageDansLaMarge(libre, verrouille, (t) => !!t.locked), 'z-libre');

  // ⭐ Le cas qui a été livré à l'envers : avec la manipulabilité *joueur* comme critère, un PNJ
  // libre — que le MJ manipule autant qu'un PJ — perdait contre un PJ VERROUILLÉ. Le prédicat du
  // MJ ne regarde que `locked`, donc le PNJ libre gagne.
  const pnjLibre = makeToken({ id: 'z-pnj-libre', cell: { a: 3, b: 1 }, kind: 'npc' });
  const pcVerrouille = makeToken({ id: 'a-pc-verrouille', cell: { a: 1, b: 1 }, kind: 'pc', locked: true });
  assert.equal(departageDansLaMarge(pnjLibre, pcVerrouille, (t) => !!t.locked), 'z-pnj-libre');
});

test('findHitToken — vue MJ : un PNJ n’est jamais déclassé face à un PJ', () => {
  // Aucun prédicat côté MJ ne doit pénaliser un PNJ : deux pions libres et équidistants se
  // départagent par identifiant, et le PNJ gagne quand son identifiant vient en premier.
  const tokens = [
    makeToken({ id: 'a-pnj', cell: { a: 1, b: 1 }, kind: 'npc' }),
    makeToken({ id: 'z-pc', cell: { a: 3, b: 1 }, kind: 'pc' }),
  ];

  const hit = findHitToken(grid, mockLevel, { x: 250, y: 150 }, 0.3, tokens, {
    deprioritize: (t) => !!t.locked,
  });
  assert.equal(hit?.id, 'a-pnj');
});

test('findHitToken — un pion `hidden` reste désignable par le MJ, jamais par les joueurs', () => {
  // Critère O-5. Le filtre est un paramètre, précisément pour que les deux vues divergent ici :
  // un helper qui filtrerait `hidden` en dur ferait disparaître les PNJ cachés de la vue MJ.
  const tokens = [
    makeToken({ id: 'pnj-cache', cell: { a: 5, b: 5 }, hidden: true, kind: 'npc' }),
  ];

  assert.equal(findHitToken(grid, mockLevel, { x: 550, y: 550 }, 1.0, tokens)?.id, 'pnj-cache');
  assert.equal(
    findHitToken(grid, mockLevel, { x: 550, y: 550 }, 1.0, tokens, { filter: (t) => !t.hidden }),
    null
  );
});

test('isPlayerManipulableToken — un PJ libre seulement', () => {
  assert.equal(isPlayerManipulableToken(makeToken({ id: 'pc' })), true);
  assert.equal(isPlayerManipulableToken(makeToken({ id: 'pnj', kind: 'npc' })), false);
  assert.equal(isPlayerManipulableToken(makeToken({ id: 'interdit', playerMovable: false })), false);
  assert.equal(isPlayerManipulableToken(makeToken({ id: 'verrouille', locked: true })), false);
});

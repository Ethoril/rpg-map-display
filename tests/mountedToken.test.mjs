// @ts-check

/**
 * Chantier C-9 — le pion monté : modèle, règles de déplacement, événement, rendu du pion.
 *
 * Chaque test regarde le COMPORTEMENT (une case atteinte ou non, un masque, un appel de dessin à
 * une position), jamais le seul drapeau `mounted` : un drapeau bien posé sur un mécanisme cassé
 * passerait au vert.
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { assertPaintsWhiteOnly } from '../scripts/install-status-icons.mjs';
import {
  createCampaign,
  createLevel,
  createToken,
  normalizeToken,
  validateCampaign,
} from '../js/core/schema.js';
import { edgeKey, cellKey } from '../js/core/cellKey.js';
import { SquareGrid } from '../js/grid/SquareGrid.js';
import { TokensLayer } from '../js/render/layers/tokens.js';
import { Camera } from '../js/render/camera.js';
import { computeBlockedEdges } from '../js/import/blockedEdges.js';
import { movementRulesFor } from '../js/state/selection.js';
import {
  loadCampaign,
  resetStore,
  setSelection,
  setTokenMounted,
  updateToken,
  getState,
  getCampaign,
  subscribe,
} from '../js/state/store.js';
import { applyNetworkEvent } from '../js/app/networkEvents.js';
import {
  filterAndSortMarkers,
  computeBadgeRowLayout,
  computeMountedBadgeRowLayout,
  drawStatusBadges,
} from '../js/render/statusBadges.js';
import { BADGE_ROW_SLOTS, MOUNTED_ICON_URL } from '../js/core/constants.js';

beforeEach(() => {
  resetStore();
});

/**
 * Étage carré coupé en deux par un mur vertical en x = 5, percé d'UNE porte entre (4,4) et (5,4).
 * Aucun contournement possible : seule la porte relie les deux moitiés.
 *
 * @param {string} id
 * @param {'open'|'closed'|'locked'} state
 */
function etageAPorte(id, state) {
  return createLevel({
    id,
    widthCells: 12,
    heightCells: 10,
    walls: [
      [{ cellX: 5, cellY: 0 }, { cellX: 5, cellY: 4 }],
      [{ cellX: 5, cellY: 5 }, { cellX: 5, cellY: 10 }],
    ],
    portals: [
      { id: `${id}-porte`, a: { cellX: 5, cellY: 4 }, b: { cellX: 5, cellY: 5 }, state, freestanding: false },
    ],
  });
}

/** @param {Partial<import('../js/core/types.js').Token>} overrides */
const pion = (overrides) => createToken({ id: 'cavalier', levelId: 'rdc', cell: { a: 4, b: 4 }, speedCells: 3, ...overrides });

/**
 * @param {import('../js/core/types.js').Token} token
 * @param {import('../js/core/types.js').Level} level
 */
function zone(token, level) {
  const { grid, budget, blockedEdges, terrainCost } = movementRulesFor(token, level);
  return grid.cellsInRange(token.cell, budget, blockedEdges, terrainCost);
}

// ── 1. Schéma ──────────────────────────────────────────────────────────────────────────────

test('C-9 schéma : mounted absent se normalise à false, passe la validation ; non booléen refusé', () => {
  const ancien = /** @type {any} */ (createToken({ id: 'ancien', levelId: 'rdc' }));
  delete ancien.mounted;
  assert.equal(normalizeToken({ ...ancien }).mounted, false);
  assert.equal(normalizeToken({ ...ancien, mounted: true }).mounted, true, 'une valeur présente est conservée');

  const campagne = createCampaign({ levels: [createLevel({ id: 'rdc' })], tokens: [ancien] });
  assert.deepEqual(validateCampaign(campagne), [], 'un pion sans mounted, enregistré avant C-9, ne se refuse pas');

  campagne.tokens = [/** @type {any} */ ({ ...ancien, mounted: 'oui' })];
  const erreurs = validateCampaign(campagne);
  assert.equal(erreurs.length, 1);
  assert.match(erreurs[0], /Pion "ancien" : mounted doit être un booléen/);

  campagne.tokens = [/** @type {any} */ ({ ...ancien, mounted: 1 })];
  assert.match(validateCampaign(campagne)[0] ?? '', /mounted doit être un booléen/, 'un truthy non booléen est refusé');
});

// ── 3. Règles de déplacement ───────────────────────────────────────────────────────────────

test('C-9 règles : monté, le budget double — la case à 2 × speedCells est atteinte, pas au-delà', () => {
  const level = createLevel({ id: 'c9-budget', widthCells: 12, heightCells: 4 });
  const aPied = createToken({ id: 'p', levelId: 'c9-budget', cell: { a: 0, b: 0 }, speedCells: 3 });
  const monte = { ...aPied, mounted: true };

  const zPied = zone(aPied, level);
  assert.equal(zPied.has('3,0'), true);
  assert.equal(zPied.has('4,0'), false);

  const zMonte = zone(monte, level);
  assert.equal(zMonte.get('6,0'), 6, 'la case à 6 cases en ligne droite est atteinte pour un coût de 6');
  assert.equal(zMonte.has('7,0'), false, 'pas au-delà du budget doublé');
  assert.equal(movementRulesFor(monte, level).budget, 6);
  assert.equal(movementRulesFor({ ...aPied, mounted: false }, level).budget, 3);
});

test('C-9 règles : une porte OUVERTE arrête le pion monté, pas le pion à pied', () => {
  const level = etageAPorte('c9-porte-ouverte', 'open');
  const aPied = pion({ levelId: level.id });
  assert.equal(zone(aPied, level).has('5,4'), true, 'à pied, la porte ouverte se franchit');
  const zMonte = zone({ ...aPied, mounted: true }, level);
  assert.equal(zMonte.has('5,4'), false, 'monté, la porte ouverte ne se franchit pas');
  assert.equal(
    [...zMonte.keys()].some((k) => Number(k.split(',')[0]) >= 5),
    false,
    'aucune case de l’autre moitié n’est atteinte'
  );
  // Le cheval garde son budget doublé de ce côté-ci : la règle des portes ne l'a pas immobilisé.
  assert.equal(zMonte.has('4,9'), true);
});

test('C-9 règles : une porte fermée ou verrouillée arrête les deux', () => {
  for (const state of /** @type {const} */ (['closed', 'locked'])) {
    const level = etageAPorte(`c9-porte-${state}`, state);
    const aPied = pion({ levelId: level.id });
    assert.equal(zone(aPied, level).has('5,4'), false, `${state} : à pied, arrêté`);
    assert.equal(zone({ ...aPied, mounted: true }, level).has('5,4'), false, `${state} : monté, arrêté`);
  }
});

test('C-9 règles (hexagone) : une porte ouverte arrête le pion monté, pas le pion à pied', () => {
  // Même géométrie que le mur de G-04 (hexGrid.test.mjs), portée par une PORTE ouverte.
  const level = createLevel({
    id: 'c9-hex',
    grid: { type: 'hex', offsetX: 0, offsetY: 0, color: '#000000', opacity: 0.25, visible: true },
    widthCells: 5,
    heightCells: 5,
    pxPerCell: 140,
    portals: [
      { id: 'hex-porte', a: { cellX: 2.5, cellY: 1.0 }, b: { cellX: 2.5, cellY: 1.6 }, state: 'open', freestanding: false },
    ],
  });
  const aPied = createToken({ id: 'h', levelId: 'c9-hex', cell: { a: 1, b: 1 }, speedCells: 1 });
  const derriere = cellKey({ a: 2, b: 1 });
  const arete = edgeKey({ a: 1, b: 1 }, { a: 2, b: 1 });
  assert.equal(movementRulesFor(aPied, level).blockedEdges.has(arete), false);
  assert.equal(movementRulesFor({ ...aPied, mounted: true }, level).blockedEdges.has(arete), true);
  assert.equal(zone(aPied, level).get(derriere), 1, 'à pied, la porte ouverte se franchit : un pas');
  const zMonte = zone({ ...aPied, mounted: true }, level);
  // Le portail est court : le cheval en fait le tour, en deux pas — jamais à travers.
  assert.equal(zMonte.get(derriere), 2, 'monté, la porte ouverte ne se franchit pas : le détour coûte 2');
  // Budget doublé en hexagonal aussi : la case à deux pas, hors de portée à pied, est atteinte.
  const deuxPas = { a: 1, b: 3 };
  assert.equal(movementRulesFor(aPied, level).grid.distance(aPied.cell, deuxPas), 2);
  assert.equal(zone(aPied, level).has(cellKey(deuxPas)), false);
  assert.equal(zMonte.has(cellKey(deuxPas)), true);
});

// ── 4. Cache des arêtes ────────────────────────────────────────────────────────────────────

test('C-9 cache : les variantes "closed" et "all" d’un même étage ne se contaminent pas', () => {
  const porte = edgeKey({ a: 4, b: 4 }, { a: 5, b: 4 });

  // 'all' d'abord, puis 'closed'.
  const l1 = etageAPorte('c9-cache-1', 'open');
  const grid1 = movementRulesFor(pion({ levelId: l1.id }), l1).grid;
  const tout1 = computeBlockedEdges(l1, grid1, { portals: 'all' });
  const ferme1 = computeBlockedEdges(l1, grid1, { portals: 'closed' });
  assert.equal(tout1.has(porte), true, '"all" bloque la porte ouverte');
  assert.equal(ferme1.has(porte), false, '"closed" calculé APRÈS "all" ne reçoit pas son masque');
  assert.equal(computeBlockedEdges(l1, grid1).has(porte), false, 'le défaut reste "closed"');
  assert.equal(computeBlockedEdges(l1, grid1, { portals: 'all' }).has(porte), true, '"all" relu depuis le cache');

  // 'closed' d'abord, puis 'all'.
  const l2 = etageAPorte('c9-cache-2', 'open');
  const ferme2 = computeBlockedEdges(l2, grid1, { portals: 'closed' });
  const tout2 = computeBlockedEdges(l2, grid1, { portals: 'all' });
  assert.equal(ferme2.has(porte), false);
  assert.equal(tout2.has(porte), true, '"all" calculé APRÈS "closed" ne reçoit pas son masque');
  // Les murs restent dans les deux variantes.
  const mur = edgeKey({ a: 4, b: 2 }, { a: 5, b: 2 });
  assert.equal(ferme2.has(mur) && tout2.has(mur), true);

  assert.throws(
    () => computeBlockedEdges(l2, grid1, { portals: /** @type {any} */ ('ouvertes') }),
    /options\.portals inconnu/
  );
});

// ── 2. Store ───────────────────────────────────────────────────────────────────────────────

function campagneDeStore() {
  return createCampaign({
    levels: [createLevel({ id: 'rdc', widthCells: 20, heightCells: 10 })],
    tokens: [createToken({ id: 'hero-1', levelId: 'rdc', cell: { a: 2, b: 2 }, speedCells: 3 })],
  });
}

/** @param {string} id */
const monture = (id) => getCampaign()?.tokens.find((t) => t.id === id)?.mounted;

test('C-9 store : setTokenMounted pose et retire ; lève sur pion inconnu et sur non-booléen', () => {
  loadCampaign(campagneDeStore());
  setTokenMounted('hero-1', true);
  assert.equal(monture('hero-1'), true);
  setTokenMounted('hero-1', false);
  assert.equal(monture('hero-1'), false);

  assert.throws(() => setTokenMounted('fantome', true), /Pion inconnu : "fantome"/);
  assert.throws(() => setTokenMounted('hero-1', /** @type {any} */ ('true')), /État de monture invalide/);
  assert.throws(() => setTokenMounted('hero-1', /** @type {any} */ (1)), /État de monture invalide/);
  assert.equal(monture('hero-1'), false, 'un refus ne mute rien');
});

test('C-9 store : updateToken refuse mounted — un seul écrivain', () => {
  loadCampaign(campagneDeStore());
  assert.throws(
    () => updateToken('hero-1', /** @type {any} */ ({ mounted: true })),
    /champ non autorisé "mounted"/
  );
  assert.equal(monture('hero-1'), false);
});

test('C-9 store : la zone du pion sélectionné change après setTokenMounted (A4)', () => {
  loadCampaign(campagneDeStore());
  setSelection('hero-1');
  const avant = getState().reachableCells;
  assert.equal(avant.has('8,2'), false, 'à pied (3 cases), la case à 6 n’est pas dans la zone');

  setTokenMounted('hero-1', true);
  const apres = getState().reachableCells;
  assert.ok(apres.size > avant.size, `la zone grandit (${avant.size} → ${apres.size})`);
  assert.equal(apres.has('8,2'), true, 'monté, la case à 6 entre dans la zone sans resélection');

  setTokenMounted('hero-1', false);
  assert.equal(getState().reachableCells.size, avant.size, 'descendu, la zone revient à celle d’avant');
});

// ── 7. Réseau ──────────────────────────────────────────────────────────────────────────────

test('C-9 réseau : token.mounted s’applique, son rejeu est inoffensif, un payload fautif est refusé', (t) => {
  const erreurs = t.mock.method(console, 'error', () => {});
  loadCampaign(campagneDeStore());
  let signaux = 0;
  const desabonner = subscribe(() => signaux++);

  /** @param {any} payload */
  const evt = (payload) => ({ type: 'token.mounted', payload, at: 0, by: /** @type {'gm'} */ ('gm') });

  assert.equal(applyNetworkEvent(evt({ tokenId: 'hero-1', mounted: true })), true);
  assert.equal(monture('hero-1'), true);
  assert.equal(signaux, 1);

  assert.equal(applyNetworkEvent(evt({ tokenId: 'hero-1', mounted: true })), false, 'le rejeu rend false');
  assert.equal(signaux, 1, 'le rejeu ne notifie pas : aucune mutation');

  for (const payload of [
    { tokenId: 'hero-1', mounted: 'false' },
    { tokenId: 'hero-1' },
    { mounted: false },
    { tokenId: 42, mounted: false },
  ]) {
    assert.equal(applyNetworkEvent(evt(payload)), false, `refusé : ${JSON.stringify(payload)}`);
  }
  assert.equal(applyNetworkEvent(evt({ tokenId: 'fantome', mounted: false })), false, 'pion inconnu refusé');
  assert.equal(monture('hero-1'), true, 'aucun refus n’a muté le pion');
  assert.equal(signaux, 1);
  assert.equal(erreurs.mock.callCount(), 5, 'chaque refus est journalisé');

  assert.equal(applyNetworkEvent(evt({ tokenId: 'hero-1', mounted: false })), true, 'descendre s’applique');
  assert.equal(monture('hero-1'), false);
  desabonner();
});

// ── 9. Rendu ───────────────────────────────────────────────────────────────────────────────

test('C-9 rendu : filterAndSortMarkers à 2 places, appel par défaut inchangé', () => {
  assert.deepEqual(filterAndSortMarkers(['bleeding', 'unconscious'], 2), {
    visibleMarkers: ['unconscious', 'bleeding'],
    overflowCount: 0,
  });
  assert.deepEqual(filterAndSortMarkers(['bleeding', 'unconscious', 'prone'], 2), {
    visibleMarkers: ['unconscious'],
    overflowCount: 2,
  });
  assert.deepEqual(filterAndSortMarkers(['bleeding', 'unconscious', 'prone']), {
    visibleMarkers: ['unconscious', 'prone', 'bleeding'],
    overflowCount: 0,
  });
});

test('C-9 rendu : disposition montée — cheval au dernier emplacement, marqueurs collés à sa gauche', () => {
  const rangee = computeBadgeRowLayout(140, BADGE_ROW_SLOTS);
  for (const n of [0, 1, 2]) {
    const l = computeMountedBadgeRowLayout(140, n);
    assert.deepEqual(l.horse, rangee.centers[BADGE_ROW_SLOTS - 1], `${n} : le cheval occupe le dernier emplacement`);
    assert.equal(l.badgeRadiusMap, rangee.badgeRadiusMap);
    assert.equal(l.items.length, n);
  }
  assert.deepEqual(computeMountedBadgeRowLayout(140, 1).items, [rangee.centers[1]], '1 élément : emplacement du milieu');
  assert.deepEqual(computeMountedBadgeRowLayout(140, 2).items, [rangee.centers[0], rangee.centers[1]]);
  assert.throws(() => computeMountedBadgeRowLayout(140, 3), /au plus 2/);
});

/**
 * Contexte 2D enregistreur : chaque disque, image et texte dessiné, avec sa position.
 * @returns {{ ctx: CanvasRenderingContext2D, log: any[] }}
 */
function contexteEnregistreur() {
  /** @type {any[]} */
  const log = [];
  const ctx = /** @type {any} */ ({
    save() {}, restore() {}, beginPath() {}, fill() {}, stroke() {},
    /** @param {number} x @param {number} y @param {number} r */
    arc(x, y, r) { log.push({ op: 'arc', x, y, r }); },
    /** @param {any} img @param {number} x @param {number} y @param {number} w @param {number} h */
    drawImage(img, x, y, w, h) { log.push({ op: 'image', icon: img.icon, x: x + w / 2, y: y + h / 2 }); },
    /** @param {string} text @param {number} x @param {number} y */
    fillText(text, x, y) { log.push({ op: 'text', text, x, y }); },
  });
  return { ctx, log };
}

/** Cache d'icônes factice : rend un canvas étiqueté par l'URL demandée (ou l'id d'état). */
const cacheFactice = /** @type {any} */ ({
  /** @param {string} id @param {number} _px @param {unknown} _inv @param {string} [url] */
  getRasterCanvas(id, _px, _inv, url) {
    return { icon: url ?? `status:${id}` };
  },
});

/**
 * @param {Partial<import('../js/core/types.js').Token>} overrides
 * @param {number} [zoom]
 */
function dessiner(overrides, zoom = 1) {
  const { ctx, log } = contexteEnregistreur();
  const token = createToken({ id: 'b', levelId: 'rdc', ...overrides });
  drawStatusBadges(ctx, token, { x: 0, y: 0 }, { widthMap: 140, zoom, iconCache: cacheFactice });
  return log;
}

test('C-9 rendu : un pion monté SANS marqueur dessine son cheval, en bas à droite', () => {
  const log = dessiner({ markers: [], mounted: true });
  const coin = computeBadgeRowLayout(140, BADGE_ROW_SLOTS).centers[BADGE_ROW_SLOTS - 1];
  const images = log.filter((e) => e.op === 'image');
  assert.deepEqual(images, [{ op: 'image', icon: MOUNTED_ICON_URL, x: coin.x, y: coin.y }]);
  assert.equal(log.filter((e) => e.op === 'arc').length, 1, 'un seul disque : celui du cheval');
});

test('C-9 rendu : pion monté avec marqueurs — 2 places, compteur compris, cheval au coin', () => {
  const c = computeBadgeRowLayout(140, BADGE_ROW_SLOTS).centers;

  const un = dessiner({ markers: ['prone'], mounted: true }).filter((e) => e.op === 'image');
  assert.deepEqual(un, [
    { op: 'image', icon: 'status:prone', x: c[1].x, y: c[1].y },
    { op: 'image', icon: MOUNTED_ICON_URL, x: c[2].x, y: c[2].y },
  ], 'un marqueur : collé au cheval, à l’emplacement du milieu');

  const trois = dessiner({ markers: ['bleeding', 'prone', 'unconscious'], mounted: true });
  assert.deepEqual(trois.filter((e) => e.op === 'image'), [
    { op: 'image', icon: 'status:unconscious', x: c[0].x, y: c[0].y },
    { op: 'image', icon: MOUNTED_ICON_URL, x: c[2].x, y: c[2].y },
  ]);
  assert.deepEqual(trois.filter((e) => e.op === 'text'), [{ op: 'text', text: '+2', x: c[1].x, y: c[1].y }],
    'le compteur prend la deuxième place, pas celle du cheval');
});

test('C-9 rendu : pion à pied — rendu strictement inchangé, aucun cheval', () => {
  const centre = computeBadgeRowLayout(140, 1).centers[0];
  const absent = dessiner({ markers: ['prone'] });
  const faux = dessiner({ markers: ['prone'], mounted: false });
  assert.deepEqual(faux, absent, 'mounted: false et mounted absent se dessinent pareil');
  assert.deepEqual(absent.filter((e) => e.op === 'image'), [{ op: 'image', icon: 'status:prone', x: centre.x, y: centre.y }],
    'un marqueur seul reste centré');

  const c3 = computeBadgeRowLayout(140, 3).centers;
  const trois = dessiner({ markers: ['bleeding', 'prone', 'unconscious'] }).filter((e) => e.op === 'image');
  assert.deepEqual(trois.map((e) => [e.icon, e.x]), [
    ['status:unconscious', c3[0].x], ['status:prone', c3[1].x], ['status:bleeding', c3[2].x],
  ], 'à pied, trois marqueurs gardent leurs trois places');

  assert.deepEqual(dessiner({ markers: [] }), [], 'à pied sans marqueur : rien');
});

/** Pion fusionné : le cavalier en médaillon sur la monture (contrat §8.1), `rider` présent. */
const CAVALIER = { ref: 'p:m1', label: 'Destrier', imageUrl: null, hp: null, health: /** @type {const} */ ('unharmed'), markers: [], markerLevels: {} };

test('rendu : un pion FUSIONNÉ (monture en médaillon) ne dessine plus le cheval — le pion symbolise déjà la monte', () => {
  // Demande du MJ (18/11/2026). L'état `mounted` est toujours reçu et conservé ; seule l'icône disparaît.
  assert.deepEqual(dessiner({ markers: [], mounted: true, rider: CAVALIER }), [], 'fusionné sans marqueur : rien');
  const centre = computeBadgeRowLayout(140, 1).centers[0];
  assert.deepEqual(
    dessiner({ markers: ['prone'], mounted: true, rider: CAVALIER }).filter((e) => e.op === 'image'),
    [{ op: 'image', icon: 'status:prone', x: centre.x, y: centre.y }],
    'un marqueur seul : centré, sans la place réservée au cheval'
  );
  const c3 = computeBadgeRowLayout(140, 3).centers;
  const trois = dessiner({ markers: ['bleeding', 'prone', 'unconscious'], mounted: true, rider: CAVALIER });
  assert.deepEqual(trois.filter((e) => e.op === 'image').map((e) => [e.icon, e.x]), [
    ['status:unconscious', c3[0].x], ['status:prone', c3[1].x], ['status:bleeding', c3[2].x],
  ], 'trois marqueurs : les trois places, comme à pied');
  assert.equal(trois.some((e) => e.op === 'image' && e.icon === MOUNTED_ICON_URL), false);
});

test('rendu : un cavalier SEUL marqué monté (monture hors de la carte) garde son cheval', () => {
  const coin = computeBadgeRowLayout(140, BADGE_ROW_SLOTS).centers[BADGE_ROW_SLOTS - 1];
  assert.deepEqual(
    dessiner({ markers: [], mounted: true, rider: null }).filter((e) => e.op === 'image'),
    [{ op: 'image', icon: MOUNTED_ICON_URL, x: coin.x, y: coin.y }]
  );
});

test('C-9 rendu : aux paliers des points, pas de cheval', () => {
  // 140 × 0,24 = 33,6 px : palier 'category-dots' ; 140 × 0,1 = 14 px : 'single-dot'.
  for (const zoom of [0.24, 0.1]) {
    assert.deepEqual(dessiner({ markers: [], mounted: true }, zoom), [], `zoom ${zoom} : monté sans marqueur, rien`);
    assert.deepEqual(
      dessiner({ markers: ['prone'], mounted: true }, zoom),
      dessiner({ markers: ['prone'] }, zoom),
      `zoom ${zoom} : monté ou à pied, mêmes points`
    );
  }
});

// ── 10. Icône ──────────────────────────────────────────────────────────────────────────────

test('C-9 icône : assets/icons/mounted.svg ne peint que du blanc, hors du dossier des 14 états', () => {
  const svg = readFileSync(fileURLToPath(new URL('../assets/icons/mounted.svg', import.meta.url)), 'utf8').trim();
  const { size, whiteRefs } = assertPaintsWhiteOnly(svg, 'mounted');
  assert.ok(size > 0);
  assert.ok(whiteRefs > 0);
  assert.equal(MOUNTED_ICON_URL, 'assets/icons/mounted.svg');
  assert.equal(existsSync(fileURLToPath(new URL('../assets/icons/status/mounted.svg', import.meta.url))), false);
});

// ── H-5 : un pion monté au zoom minimum ne doit pas interrompre l'image ────────────────────
//
// Défaut relevé par l'audit du 26/11/2026. L'anneau intérieur du cavalier a pour rayon
// `largeurCase/2 − 9/zoom` : `imageRadius` retire déjà `TOKEN_BORDER_SCREEN_PX/(2·zoom)`, puis
// l'anneau sombre `1,5·ringWidth` et l'anneau clair `1·ringWidth` de plus. Il devient NÉGATIF dès
// que `zoom < 18/largeurCase`.
//
// ⭐ Le zoom minimum de la caméra vaut 0,10 : pour une carte à 140 px/case le seuil est 0,1286, donc
// la borne basse du zoom est DANS la zone de panne, pas à côté. `ctx.ellipse` lève alors
// `IndexSizeError` — la spécification l'impose sur un rayon négatif — et le rendu s'arrête net.
//
// ⛔ Le faux contexte ci-dessous LÈVE sur un rayon négatif, exactement comme le vrai. Un faux
// contexte permissif rendrait ce test vert sur la panne réelle.

/** @returns {{ ctx: any, rayons: number[] }} Contexte 2D minimal, fidèle sur les rayons négatifs. */
function contexteQuiLeveSurRayonNegatif() {
  /** @type {number[]} */
  const rayons = [];
  /** @param {number} r @param {string} methode */
  const verifier = (r, methode) => {
    rayons.push(r);
    if (!(r >= 0)) {
      // Le vrai CanvasRenderingContext2D lève ceci ; le rendu de l'image s'arrête alors.
      const erreur = new Error(`IndexSizeError: ${methode} avec un rayon négatif (${r})`);
      erreur.name = 'IndexSizeError';
      throw erreur;
    }
  };
  // ⛔ Une `clip()` sur un chemin VIDE ne lève rien et découpe TOUT : le pion disparaît en
  // silence. C'est l'autre moitié de H-5, et elle ne se voit pas à 140 px/case. On la compte.
  let operationsDuChemin = 0;
  let clipsVides = 0;
  const ctx = {
    canvas: /** @type {any} */ (null),
    globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: '',
    textBaseline: '', shadowBlur: 0, shadowColor: '', filter: '', globalCompositeOperation: '',
    get clipsVides() { return clipsVides; },
    save: () => {}, restore: () => {}, closePath: () => {},
    beginPath: () => { operationsDuChemin = 0; },
    clip: () => { if (operationsDuChemin === 0) clipsVides += 1; },
    moveTo: () => { operationsDuChemin += 1; }, lineTo: () => { operationsDuChemin += 1; },
    fill: () => {}, stroke: () => {},
    fillRect: () => {}, strokeRect: () => {}, fillText: () => {}, strokeText: () => {},
    drawImage: () => {}, translate: () => {}, rotate: () => {}, scale: () => {},
    setTransform: () => {}, resetTransform: () => {}, setLineDash: () => {},
    createLinearGradient: () => ({ addColorStop: () => {} }),
    createRadialGradient: () => ({ addColorStop: () => {} }),
    measureText: () => ({ width: 10 }),
    getImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
    /** @param {number} _x @param {number} _y @param {number} rx @param {number} ry */
    ellipse: (_x, _y, rx, ry) => { operationsDuChemin += 1; verifier(rx, 'ellipse'); verifier(ry, 'ellipse'); },
    /** @param {number} _x @param {number} _y @param {number} r */
    arc: (_x, _y, r) => { operationsDuChemin += 1; verifier(r, 'arc'); },
    /** @param {number} _x @param {number} _y @param {number} r */
    arcTo: (_x, _y, r) => { verifier(r, 'arcTo'); },
    roundRect: () => {},
  };
  ctx.canvas = { width: 1200, height: 900, getContext: () => ctx };
  return { ctx, rayons };
}

/**
 * @param {any} token @param {number} zoom @param {number} [pxPerCell]
 * @returns {{ rayons: number[], dessines: string[], clipsVides: number }}
 */
function rendreAuZoom(token, zoom, pxPerCell = 140) {
  const level = createLevel({ id: 'h5', widthCells: 10, heightCells: 10, pxPerCell });
  const grid = new SquareGrid(level);
  const layer = new TokensLayer();
  const { ctx, rayons } = contexteQuiLeveSurRayonNegatif();
  const res = layer.render(ctx, grid, [token], null, {
    role: 'gm', activeLevelId: 'h5', activeLevelWidthCells: 10, activeLevelHeightCells: 10, zoom,
  });
  return { rayons, dessines: res.renderedTokenIds, clipsVides: ctx.clipsVides };
}

/** @param {boolean} monte @returns {any} */
function pionH5(monte) {
  return createToken({
    id: 'h5-pion', levelId: 'h5', cell: { a: 2, b: 2 }, sizeCells: 1, label: 'Cavalier',
    mounted: monte,
    ...(monte ? { rider: { ref: 'p:h5', label: 'Cavalier', imageUrl: null, hp: null, health: 'unharmed', markers: [], markerLevels: {} } } : {}),
  });
}

test('H-5 — un pion monté se dessine au zoom MINIMUM de la caméra sans interrompre l’image', () => {
  // Le seuil se lit dans la caméra, pas en dur : si le plancher de zoom bouge, le test suit.
  const zoomMinimum = new Camera(1200, 900).minZoom;
  assert.ok(zoomMinimum > 0 && zoomMinimum < 1, `plancher de zoom inattendu : ${zoomMinimum}`);
  // ⚠ Et il faut que ce plancher soit bien DANS la zone de panne, sinon le test ne prouve rien :
  // 140/2 − 9/zoom < 0 ⇔ zoom < 18/140.
  assert.ok(zoomMinimum < 18 / 140, 'le plancher de zoom est sorti de la zone de panne : revoir ce test');

  const { rayons, dessines } = rendreAuZoom(pionH5(true), zoomMinimum);
  assert.deepEqual(dessines, ['h5-pion'], 'le pion monté doit être dessiné au zoom minimum');
  const negatifs = rayons.filter((r) => !(r >= 0));
  assert.deepEqual(negatifs, [], `rayons négatifs passés au contexte 2D : ${negatifs.join(', ')}`);
});

test('H-5 — aucun rayon négatif à AUCUN zoom entre le plancher et le plafond de la caméra', () => {
  const camera = new Camera(1200, 900);
  // Les deux extrêmes, et quelques pas au travers : l'audit demande les deux bouts, pas le repos.
  for (const zoom of [camera.minZoom, 0.11, 0.1286, 0.13, 0.25, 0.5, 1, 2, camera.maxZoom]) {
    for (const monte of [true, false]) {
      const { rayons, dessines } = rendreAuZoom(pionH5(monte), zoom);
      assert.deepEqual(dessines, ['h5-pion'], `zoom ${zoom}, monté=${monte} : pion non dessiné`);
      assert.deepEqual(
        rayons.filter((r) => !(r >= 0)),
        [],
        `zoom ${zoom}, monté=${monte} : rayon négatif passé au contexte 2D`
      );
    }
  }
});

test('H-5 — le cavalier reste distinguable au zoom de repos : borner n’est pas effacer', () => {
  // ⛔ Anti-triche. Supprimer les deux anneaux du cavalier ferait passer les deux tests ci-dessus
  // au vert tout en détruisant le contrat §8.1. À zoom 1, un pion monté doit donc passer
  // STRICTEMENT plus de rayons au contexte qu'un pion à pied — ce sont ses deux anneaux.
  const monte = rendreAuZoom(pionH5(true), 1).rayons.length;
  const aPied = rendreAuZoom(pionH5(false), 1).rayons.length;
  assert.ok(
    monte >= aPied + 2,
    `au zoom 1, le pion monté ne dessine plus ses anneaux : ${monte} rayons contre ${aPied} à pied`
  );
});

test('H-5 — sur une carte à petite échelle, le pion ne disparaît pas derrière une découpe vide', () => {
  // ⛔ L'autre moitié de H-5, invisible à 140 px/case. `imageRadius = largeurCase/2 − 1,5/zoom`
  // devient lui aussi négatif quand `largeurCase ≤ 3/zoom` : à 20 px/case et au plancher de zoom,
  // 10 − 15 = −5. Sauter l'`ellipse` sans sauter le `clip()` qui suit laisse un chemin VIDE, et
  // une découpe sur chemin vide masque tout ce qui vient après — le pion s'efface sans une erreur.
  // Borner le rayon, comme le demande l'audit, est la seule issue qui dessine quelque chose.
  const camera = new Camera(1200, 900);
  for (const pxPerCell of [20, 30, 50, 140]) {
    for (const zoom of [camera.minZoom, 0.2, 1, camera.maxZoom]) {
      for (const monte of [true, false]) {
        const { rayons, dessines, clipsVides } = rendreAuZoom(pionH5(monte), zoom, pxPerCell);
        const cas = `${pxPerCell} px/case, zoom ${zoom}, monté=${monte}`;
        assert.deepEqual(dessines, ['h5-pion'], `${cas} : pion non dessiné`);
        assert.deepEqual(rayons.filter((r) => !(r >= 0)), [], `${cas} : rayon négatif`);
        assert.equal(clipsVides, 0, `${cas} : découpe sur chemin vide — le pion est effacé`);
      }
    }
  }
});

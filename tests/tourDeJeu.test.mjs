// @ts-check
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createCampaign, createLevel, createLink, createToken } from '../js/core/schema.js';
import * as store from '../js/state/store.js';
import { bondZoneFor, movementRulesFor } from '../js/state/selection.js';
import { isPlayerManipulableToken } from '../js/input/tokenHit.js';
import { applyNetworkEvent, createSnapshotPayload } from '../js/app/networkEvents.js';
import { startMjLink, MJ_LINK_VERSION, MJ_LINK_TIMEOUT_MS } from '../js/app/mjLink.js';
import { gridFor } from '../js/grid/index.js';
import { boutonsPorte, PortalsLayer } from '../js/render/layers/portals.js';
import { boutonLiaison, LinksLayer } from '../js/render/layers/links.js';

const LINK_A = /** @type {{ source: 'outil-mj', ref: string }} */ ({ source: 'outil-mj', ref: 'pj:a' });
const LINK_B = /** @type {{ source: 'outil-mj', ref: string }} */ ({ source: 'outil-mj', ref: 'pj:b' });

/** @param {Partial<import('../js/core/types.js').Token>} [patch] */
function makeLinkedPc(patch = {}) {
  return {
    ...createToken({
      id: 'pj-a',
      levelId: 'rdc',
      cell: { a: 2, b: 2 },
      kind: 'pc',
      speedCells: 4,
      playerMovable: true,
      locked: false,
    }),
    link: LINK_A,
    runCells: 8,
    ...patch,
  };
}

function loadTwoLevelCampaign() {
  const rdc = createLevel({ id: 'rdc', name: 'RDC', widthCells: 12, heightCells: 10 });
  const et1 = createLevel({ id: 'et1', name: 'Étage 1', widthCells: 12, heightCells: 10 });
  const pjA = makeLinkedPc({ id: 'pj-a', levelId: 'rdc', cell: { a: 2, b: 2 } });
  const pjB = makeLinkedPc({ id: 'pj-b', levelId: 'rdc', cell: { a: 6, b: 2 }, link: LINK_B });
  const escalier = createLink({
    id: 'stairs-1',
    kind: 'stairs',
    a: { levelId: 'rdc', at: { cellX: 4, cellY: 2 } },
    b: { levelId: 'et1', at: { cellX: 4, cellY: 2 } },
    bidirectional: true,
    gmOnly: false,
  });
  store.loadCampaign(createCampaign({
    levels: [rdc, et1],
    links: [escalier],
    tokens: [pjA, pjB],
  }));
  return { rdc, et1, pjA, pjB, escalier };
}

beforeEach(() => {
  store.resetStore();
});

// ── T5 : bridage par le tour (`isPlayerManipulableToken`) ────────────────────────────────────

test('isPlayerManipulableToken(pj, null) rend true sans tour actif', () => {
  const pj = makeLinkedPc();
  assert.equal(isPlayerManipulableToken(pj, null), true);
});

test('isPlayerManipulableToken(pj, { tokenId: "autre" }) rend false pour un PJ lié hors tour', () => {
  const pj = makeLinkedPc({ id: 'pj-a' });
  assert.equal(isPlayerManipulableToken(pj, { tokenId: 'autre' }), false);
});

test('isPlayerManipulableToken(pj, { tokenId: pj.id }) rend true pour le PJ actif', () => {
  const pj = makeLinkedPc({ id: 'pj-a' });
  assert.equal(isPlayerManipulableToken(pj, { tokenId: pj.id }), true);
});

test('isPlayerManipulableToken : un PJ sans link n’est jamais bridé par un tour sur un autre pion', () => {
  const pjLibre = createToken({
    id: 'pj-libre',
    levelId: 'rdc',
    cell: { a: 1, b: 1 },
    kind: 'pc',
    playerMovable: true,
    locked: false,
  });
  assert.equal(isPlayerManipulableToken(pjLibre, { tokenId: 'autre' }), true);
});

// ── T4 : budget amputé des cases déjà parcourues (`movementRulesFor`) ────────────────────────

test('movementRulesFor(token, level, 3) retranche 3 de budget et de walkBudget, plancher 0', () => {
  const level = createLevel({ id: 'rdc', widthCells: 12, heightCells: 10 });
  const token = makeLinkedPc({ speedCells: 4, runCells: 8 });

  const apres3 = movementRulesFor(token, level, 3);
  assert.equal(apres3.budget, 5, 'budget 8 - 3 = 5');
  assert.equal(apres3.walkBudget, 1, 'walkBudget 4 - 3 = 1 (la Course commence après 1 case)');

  const apres5 = movementRulesFor(token, level, 5);
  assert.equal(apres5.budget, 3, 'budget 8 - 5 = 3');
  assert.equal(apres5.walkBudget, 0, 'walkBudget plancher à 0, jamais négatif');

  const apres12 = movementRulesFor(token, level, 12);
  assert.equal(apres12.budget, 0, 'budget plancher à 0, jamais négatif');
  assert.equal(apres12.walkBudget, 0, 'walkBudget plancher à 0, jamais négatif');
});

test('movementRulesFor(token, level, 0) est identique à l’appel à deux arguments', () => {
  const level = createLevel({ id: 'rdc', widthCells: 12, heightCells: 10 });
  const token = makeLinkedPc({ speedCells: 4, runCells: 8 });

  const deuxArgs = movementRulesFor(token, level);
  const troisArgs = movementRulesFor(token, level, 0);
  assert.equal(troisArgs.budget, deuxArgs.budget);
  assert.equal(troisArgs.walkBudget, deuxArgs.walkBudget);
  assert.deepEqual([...troisArgs.blockedEdges], [...deuxArgs.blockedEdges]);
  assert.deepEqual([...troisArgs.terrainCost.entries()], [...deuxArgs.terrainCost.entries()]);
});

// ── T3 : état de tour dans le store (non persisté) ───────────────────────────────────────────

test('setTurn(id) deux fois de suite conserve spentCells inchangé la seconde fois', () => {
  loadTwoLevelCampaign();

  store.setTurn('pj-a');
  store.addTurnSpent('pj-a', 3);
  assert.equal(store.getTurnSpent('pj-a'), 3);
  assert.equal(store.getTurnSpent('pj-b'), 0);

  // Réannonce du même pion : ne remet pas à zéro.
  store.setTurn('pj-a');
  assert.equal(store.getTurn()?.tokenId, 'pj-a');
  assert.equal(store.getTurn()?.spentCells, 3, 'spentCells inchangé sur le même tokenId');
  assert.equal(store.getTurnSpent('pj-a'), 3);
});

test('setTurn(autre) remet spentCells à 0 et relit startCell et startLevelId sur le pion', () => {
  loadTwoLevelCampaign();

  store.setTurn('pj-a');
  store.addTurnSpent('pj-a', 3);
  store.moveTokenToCell('pj-b', { a: 7, b: 4 });

  store.setTurn('pj-b');
  const turn = store.getTurn();
  assert.deepEqual(turn, {
    tokenId: 'pj-b',
    startCell: { a: 7, b: 4 },
    startLevelId: 'rdc',
    spentCells: 0,
  });

  // null efface le tour.
  store.setTurn(null);
  assert.equal(store.getTurn(), null);
});

test('undoTurnMove(id) rend la case et l’étage de début de tour et remet spentCells à 0', () => {
  loadTwoLevelCampaign();

  store.setTurn('pj-a');
  // Déplacement jusqu'à l'escalier (4,2), puis changement d'étage vers et1.
  store.moveTokenToCell('pj-a', { a: 4, b: 2 });
  store.addTurnSpent('pj-a', 2);
  store.traverseLink('pj-a', 'stairs-1');
  assert.equal(store.getCampaign()?.tokens.find((t) => t.id === 'pj-a')?.levelId, 'et1');

  const startCell = store.undoTurnMove('pj-a');
  assert.deepEqual(startCell, { a: 2, b: 2 });

  const pj = store.getCampaign()?.tokens.find((t) => t.id === 'pj-a');
  assert.equal(pj?.levelId, 'rdc', 'étage de début de tour restauré');
  assert.deepEqual(pj?.cell, { a: 2, b: 2 }, 'case de début de tour restaurée');
  assert.equal(store.getTurn()?.spentCells, 0, 'spentCells remis à 0');
});

test('undoTurnMove(id) lève sans aucune mutation si la case de départ est occupée', () => {
  loadTwoLevelCampaign();

  store.setTurn('pj-a');
  store.moveTokenToCell('pj-a', { a: 4, b: 2 });
  store.addTurnSpent('pj-a', 2);
  // Un autre pion vient occuper la case de départ (2,2).
  store.moveTokenToCell('pj-b', { a: 2, b: 2 });

  assert.throws(() => store.undoTurnMove('pj-a'));

  const pj = store.getCampaign()?.tokens.find((t) => t.id === 'pj-a');
  assert.deepEqual(pj?.cell, { a: 4, b: 2 }, 'aucune mutation de position');
  assert.equal(pj?.levelId, 'rdc');
  assert.equal(store.getTurn()?.spentCells, 2, 'aucune mutation de spentCells');
});

test('le tour n’entre jamais dans createSnapshotPayload et est effacé par resetStore', () => {
  loadTwoLevelCampaign();

  store.setTurn('pj-a');
  store.addTurnSpent('pj-a', 2);
  const snapshot = createSnapshotPayload();
  assert.equal('turn' in snapshot, false, 'aucun champ turn dans createSnapshotPayload');
  assert.equal(JSON.stringify(snapshot).includes('spentCells'), false);

  store.resetStore();
  assert.equal(store.getTurn(), null, 'resetStore efface le tour');
});

// ── T6 : réducteurs `turn.select` / `turn.undo`, `mjLink` et glisser libre MJ ────────────────

test('réducteur turn.select : payload malformé ou pion inconnu refusé bruyamment, rejeu inoffensif', () => {
  loadTwoLevelCampaign();
  /** @type {string[]} */
  const errors = [];
  const origError = console.error;
  console.error = (...args) => errors.push(args.join(' '));
  try {
    assert.equal(
      applyNetworkEvent({ type: 'turn.select', payload: { tokenId: 42 }, at: Date.now(), by: 'gm' }),
      false
    );
    assert.equal(
      applyNetworkEvent({ type: 'turn.select', payload: { tokenId: 'pj-a', spentCells: -1 }, at: Date.now(), by: 'gm' }),
      false
    );
    assert.equal(
      applyNetworkEvent({ type: 'turn.select', payload: { tokenId: 'inconnu' }, at: Date.now(), by: 'gm' }),
      false
    );
    assert.equal(errors.length, 3, 'les trois refus doivent journaliser sur console.error');
    assert.equal(store.getTurn(), null);

    // Application nominale puis rejeu inoffensif.
    assert.equal(
      applyNetworkEvent({ type: 'turn.select', payload: { tokenId: 'pj-a', spentCells: 2 }, at: Date.now(), by: 'gm' }),
      true
    );
    assert.equal(store.getTurn()?.tokenId, 'pj-a');
    assert.equal(store.getTurn()?.spentCells, 2);
    assert.equal(
      applyNetworkEvent({ type: 'turn.select', payload: { tokenId: 'pj-a', spentCells: 2 }, at: Date.now(), by: 'gm' }),
      false,
      'rejeu identique inoffensif'
    );
    assert.equal(
      applyNetworkEvent({ type: 'turn.select', payload: { tokenId: 'pj-a' }, at: Date.now(), by: 'gm' }),
      false,
      'réannonce sans spentCells ne remet pas à zéro'
    );
    assert.equal(store.getTurn()?.spentCells, 2);

    // Fin de tour (`tokenId: null`) puis rejeu.
    assert.equal(
      applyNetworkEvent({ type: 'turn.select', payload: { tokenId: null }, at: Date.now(), by: 'gm' }),
      true
    );
    assert.equal(store.getTurn(), null);
    assert.equal(
      applyNetworkEvent({ type: 'turn.select', payload: { tokenId: null }, at: Date.now(), by: 'gm' }),
      false,
      'rejeu de fin de tour inoffensif'
    );
  } finally {
    console.error = origError;
  }
});

test('turn.select reçu AVANT le token.add de la pose : le Tour démarre sur la case de pose, et l’annulation y revient', () => {
  const rdc = createLevel({ id: 'rdc', name: 'RDC', widthCells: 12, heightCells: 10 });
  const reserve = makeLinkedPc({ id: 'pj-r', levelId: 'rdc', cell: { a: 0, b: 0 } });
  store.loadCampaign(createCampaign({ levels: [rdc], tokens: [], reserve: [reserve] }));
  const origError = console.error;
  console.error = () => {};
  try {
    // Ordre réel du MJ : la mutation du store déclenche `turn.select`, puis `token.add` est publié.
    assert.equal(applyNetworkEvent({ type: 'turn.select', payload: { tokenId: 'pj-r', spentCells: 0 }, at: Date.now(), by: 'gm' }), false);
    assert.equal(store.getTurn(), null);
    const pose = { ...reserve, cell: { a: 3, b: 4 } };
    assert.equal(applyNetworkEvent({ type: 'token.add', payload: { token: pose }, at: Date.now(), by: 'gm' }), true);
    assert.deepEqual(store.getTurn()?.startCell, { a: 3, b: 4 });
    assert.equal(store.getTurn()?.tokenId, 'pj-r');
    store.moveTokenToCell('pj-r', { a: 5, b: 4 });
    store.undoTurnMove('pj-r');
    assert.deepEqual(store.getCampaign()?.tokens.find((t) => t.id === 'pj-r')?.cell, { a: 3, b: 4 });
  } finally {
    console.error = origError;
  }
});

test('turn.select retenu : un autre turn.select ou la fin de tour l’abandonne, un autre pion ne le déclenche pas', () => {
  const rdc = createLevel({ id: 'rdc', name: 'RDC', widthCells: 12, heightCells: 10 });
  const r = makeLinkedPc({ id: 'pj-r', levelId: 'rdc', cell: { a: 0, b: 0 } });
  store.loadCampaign(createCampaign({ levels: [rdc], tokens: [], reserve: [r] }));
  const origError = console.error;
  console.error = () => {};
  try {
    applyNetworkEvent({ type: 'turn.select', payload: { tokenId: 'pj-r' }, at: Date.now(), by: 'gm' });
    applyNetworkEvent({ type: 'turn.select', payload: { tokenId: null }, at: Date.now(), by: 'gm' });
    applyNetworkEvent({ type: 'token.add', payload: { token: { ...r, cell: { a: 1, b: 1 } } }, at: Date.now(), by: 'gm' });
    assert.equal(store.getTurn(), null, 'fin de tour reçue entre-temps : rien à démarrer');
  } finally {
    console.error = origError;
  }
});

test('réducteur turn.undo : payload malformé/inconnu refusé bruyamment, relit sa case de départ, rejeu inoffensif', () => {
  loadTwoLevelCampaign();
  /** @type {string[]} */
  const errors = [];
  const origError = console.error;
  console.error = (...args) => errors.push(args.join(' '));
  try {
    assert.equal(
      applyNetworkEvent({ type: 'turn.undo', payload: {}, at: Date.now(), by: 'players' }),
      false
    );
    assert.equal(
      applyNetworkEvent({ type: 'turn.undo', payload: { tokenId: 'inconnu' }, at: Date.now(), by: 'players' }),
      false
    );
    assert.equal(errors.length, 2, 'refus bruyants sur console.error');

    store.setTurn('pj-a');
    store.moveTokenToCell('pj-a', { a: 5, b: 2 });
    store.addTurnSpent('pj-a', 3);

    // Même si un client tentait de glisser une fausse case de départ, le MJ relit la sienne (2,2).
    assert.equal(
      applyNetworkEvent({ type: 'turn.undo', payload: { tokenId: 'pj-a' }, at: Date.now(), by: 'players' }),
      true
    );
    assert.deepEqual(store.getCampaign()?.tokens.find((t) => t.id === 'pj-a')?.cell, { a: 2, b: 2 });
    assert.equal(store.getTurn()?.spentCells, 0);

    // Rejeu inoffensif sans nouvelle erreur.
    const errorsBeforeReplay = errors.length;
    assert.equal(
      applyNetworkEvent({ type: 'turn.undo', payload: { tokenId: 'pj-a' }, at: Date.now(), by: 'players' }),
      false
    );
    assert.equal(errors.length, errorsBeforeReplay);
  } finally {
    console.error = origError;
  }
});

test('reportMove incrémente spentCells et publie turn.select ; le glisser MJ ne consomme rien', () => {
  loadTwoLevelCampaign();
  /** @type {{ type: string, payload: any }[]} */
  const published = [];
  /** @type {any} */
  let channelInstance = null;
  let clock = 1000;
  class FakeChannel {
    constructor() {
      this.onmessage = null;
      channelInstance = this;
    }
    postMessage() {}
    close() {}
  }

  const lien = startMjLink({
    store,
    publish: (type, payload) => published.push({ type, payload }),
    createToken,
    activeLevelId: () => store.getActiveLevelId(),
    sessionId: 'sess-t6',
    Channel: /** @type {any} */ (FakeChannel),
    now: () => clock,
  });
  assert.ok(lien);

  try {
    // 1. L'outil MJ annonce le tour de pj-a.
    channelInstance.onmessage({
      data: { v: MJ_LINK_VERSION, from: 'outil-mj', type: 'mj.turn', payload: { ref: 'pj:a' } },
    });
    assert.equal(store.getTurn()?.tokenId, 'pj-a');
    assert.equal(store.getTurn()?.spentCells, 0);
    assert.deepEqual(published.at(-1), {
      type: 'turn.select',
      payload: { tokenId: 'pj-a', spentCells: 0 },
    });

    // 2. Glisser libre MJ (moveTokenToCell sans reportMove) : ne consomme rien (décision 6).
    store.moveTokenToCell('pj-a', { a: 4, b: 2 });
    assert.equal(store.getTurnSpent('pj-a'), 0, 'le glisser MJ ne consomme rien');

    // 3. Trajet marché (reportMove) de 3 cases : consomme 3 et publie turn.select.
    const path3 = [{ a: 4, b: 2 }, { a: 5, b: 2 }, { a: 6, b: 2 }, { a: 7, b: 2 }];
    lien.reportMove('pj-a', path3);
    assert.equal(store.getTurnSpent('pj-a'), 3, 'reportMove incrémente le compteur');
    assert.deepEqual(published.at(-1), {
      type: 'turn.select',
      payload: { tokenId: 'pj-a', spentCells: 3 },
    });

    // 4. Réannonce du même ref par l'outil MJ : compteur conservé.
    channelInstance.onmessage({
      data: { v: MJ_LINK_VERSION, from: 'outil-mj', type: 'mj.turn', payload: { ref: 'pj:a' } },
    });
    assert.equal(store.getTurnSpent('pj-a'), 3);

    // 5. Déconnexion de la liaison outil MJ : tour effacé et turn.select { tokenId: null } publié.
    clock += MJ_LINK_TIMEOUT_MS + 1000;
    lien.tick();
    assert.equal(store.getTurn(), null);
    assert.deepEqual(published.at(-1), {
      type: 'turn.select',
      payload: { tokenId: null },
    });
  } finally {
    lien.close();
  }
});

test('reportTurnReset : un seul map.turnReset { ref } par annulation, rien pour un pion non lié ou inconnu', () => {
  const { rdc, pjA } = loadTwoLevelCampaign();
  store.loadCampaign(createCampaign({
    levels: [rdc],
    tokens: [pjA, createToken({ id: 'libre', levelId: 'rdc', cell: { a: 8, b: 2 }, speedCells: 4 })],
  }));
  /** @type {any[]} */
  const sent = [];
  class FakeChannel {
    /** @param {any} m */ postMessage(m) { sent.push(m); }
    close() {}
  }
  const lien = startMjLink({
    store,
    publish() {},
    createToken,
    activeLevelId: () => store.getActiveLevelId(),
    sessionId: 'sess-reset',
    Channel: /** @type {any} */ (FakeChannel),
  });
  assert.ok(lien);
  try {
    const resets = () => sent.filter((m) => m.type === 'map.turnReset');
    assert.equal(lien.reportTurnReset('libre'), false, 'pion non lié');
    assert.equal(lien.reportTurnReset('inconnu'), false, 'pion inconnu');
    assert.equal(resets().length, 0);
    assert.equal(lien.reportTurnReset('pj-a'), true);
    assert.equal(resets().length, 1, 'un seul message');
    assert.deepEqual(resets()[0].payload, { ref: 'pj:a' });
    assert.equal(resets()[0].from, 'map');
    assert.equal(resets()[0].v, MJ_LINK_VERSION);
  } finally {
    lien.close();
  }
});

// ── T7 : boutons de porte — géométrie pure et rendu (carré et hexagonal) ─────────────────────

/**
 * Produit vectoriel signé (pB - pA) × (pt - pA) : indique de quel côté du segment `[pA, pB]`
 * se trouve `pt`.
 * @param {{ x: number, y: number }} pA
 * @param {{ x: number, y: number }} pB
 * @param {{ x: number, y: number }} pt
 */
function sideOfSegment(pA, pB, pt) {
  return (pB.x - pA.x) * (pt.y - pA.y) - (pB.y - pA.y) * (pt.x - pA.x);
}

test('boutonsPorte : côté opposé sur les 4 orientations en carré et en hexagonal, taille 44 / zoom', () => {
  for (const gridType of /** @type {const} */ (['square', 'hex'])) {
    const level = createLevel({
      id: `lvl-${gridType}`,
      pxPerCell: 100,
      widthCells: 10,
      heightCells: 10,
      grid: { type: gridType, offsetX: 0, offsetY: 0 },
    });
    const grid = gridFor(level);
    const pjCell = { a: 3, b: 2 };
    const pjCenter = grid.pointFromCell(pjCell);
    const pj = makeLinkedPc({ id: 'pj-a', levelId: level.id, cell: pjCell });

    // Quatre orientations autour de la case du PJ (est, ouest, nord, sud), exprimées en
    // géométrie carrée (amendement D-11 : `mapFromGeometryPoint`).
    const p = (/** @type {number} */ x, /** @type {number} */ y) => grid.geometryPointFromMap({ x, y });
    const pitch = grid.cellPitch();
    const orientations = [
      {
        nom: 'Est',
        a: p(pjCenter.x + pitch.x * 0.5, pjCenter.y - pitch.y * 0.45),
        b: p(pjCenter.x + pitch.x * 0.5, pjCenter.y + pitch.y * 0.45),
      },
      {
        nom: 'Ouest',
        a: p(pjCenter.x - pitch.x * 0.5, pjCenter.y - pitch.y * 0.45),
        b: p(pjCenter.x - pitch.x * 0.5, pjCenter.y + pitch.y * 0.45),
      },
      {
        nom: 'Nord',
        a: p(pjCenter.x - pitch.x * 0.5, pjCenter.y - pitch.y * 0.5),
        b: p(pjCenter.x + pitch.x * 0.5, pjCenter.y - pitch.y * 0.5),
      },
      {
        nom: 'Sud',
        a: p(pjCenter.x - pitch.x * 0.5, pjCenter.y + pitch.y * 0.5),
        b: p(pjCenter.x + pitch.x * 0.5, pjCenter.y + pitch.y * 0.5),
      },
    ];

    for (const o of orientations) {
      const portal = { id: `door-${o.nom}`, a: o.a, b: o.b, state: /** @type {'closed'} */ ('closed'), freestanding: false };
      const lvl = { ...level, portals: [portal] };
      const zoom = 0.5;
      const btns = boutonsPorte(grid, lvl, [pj], { zoom, turn: null });
      assert.equal(btns.length, 1, `${gridType} ${o.nom} : un bouton attendu`);
      assert.equal(btns[0].portalId, portal.id);
      assert.equal(btns[0].tokenId, pj.id);
      assert.equal(btns[0].enabled, true);
      assert.ok(Math.abs(btns[0].rect.width - 44 / zoom) < 1e-6, 'largeur = 44 / zoom');
      assert.ok(Math.abs(btns[0].rect.height - 44 / zoom) < 1e-6, 'hauteur = 44 / zoom');

      const pA = grid.mapFromGeometryPoint(o.a);
      const pB = grid.mapFromGeometryPoint(o.b);
      const btnCenter = {
        x: btns[0].rect.x + btns[0].rect.width / 2,
        y: btns[0].rect.y + btns[0].rect.height / 2,
      };
      assert.ok(
        sideOfSegment(pA, pB, pjCenter) * sideOfSegment(pA, pB, btnCenter) < 0,
        `${gridType} ${o.nom} : le bouton doit être de l’autre côté du segment par rapport au PJ`
      );
    }
  }
});

test('boutonsPorte : deux PJ de part et d’autre donnent un seul bouton décalé d’un demi-bouton', () => {
  const level = createLevel({
    id: 'rdc',
    pxPerCell: 100,
    widthCells: 10,
    heightCells: 10,
    portals: [
      { id: 'porte-milieu', a: { cellX: 3, cellY: 2 }, b: { cellX: 3, cellY: 3 }, state: 'closed', freestanding: false },
    ],
  });
  const grid = gridFor(level);
  const pjGauche = makeLinkedPc({ id: 'pj-a', levelId: 'rdc', cell: { a: 2, b: 2 } });
  const pjDroite = makeLinkedPc({ id: 'pj-b', levelId: 'rdc', cell: { a: 3, b: 2 }, link: LINK_B });

  const zoom = 1;
  const btns = boutonsPorte(grid, level, [pjGauche, pjDroite], { zoom, turn: null });
  assert.equal(btns.length, 1, 'deux PJ de part et d’autre : un seul bouton');

  const pA = grid.mapFromGeometryPoint(level.portals[0].a);
  const pB = grid.mapFromGeometryPoint(level.portals[0].b);
  const mid = { x: (pA.x + pB.x) / 2, y: (pA.y + pB.y) / 2 };
  const btnCenter = {
    x: btns[0].rect.x + btns[0].rect.width / 2,
    y: btns[0].rect.y + btns[0].rect.height / 2,
  };
  const shift = Math.hypot(btnCenter.x - mid.x, btnCenter.y - mid.y);
  assert.ok(Math.abs(shift - 22 / zoom) < 1e-6, 'décalage exact d’un demi-bouton (22 / zoom)');
});

test('boutonsPorte : porte verrouillée sans bouton, bouton grisé hors tour, libellés Ouvrir/Fermer', () => {
  const level = createLevel({
    id: 'rdc',
    pxPerCell: 100,
    widthCells: 10,
    heightCells: 10,
    portals: [
      { id: 'fermee', a: { cellX: 3, cellY: 2 }, b: { cellX: 3, cellY: 3 }, state: 'closed', freestanding: false },
      { id: 'ouverte', a: { cellX: 2, cellY: 2 }, b: { cellX: 2, cellY: 3 }, state: 'open', freestanding: false },
      { id: 'verrou', a: { cellX: 2, cellY: 3 }, b: { cellX: 3, cellY: 3 }, state: 'locked', freestanding: false },
    ],
  });
  const grid = gridFor(level);
  const pj = makeLinkedPc({ id: 'pj-a', levelId: 'rdc', cell: { a: 2, b: 2 } });

  const btnsLibre = boutonsPorte(grid, level, [pj], { zoom: 1, turn: null });
  assert.deepEqual(btnsLibre.map((b) => b.portalId).sort(), ['fermee', 'ouverte'], 'porte locked exclue');
  assert.ok(btnsLibre.every((b) => b.enabled === true));

  const btnsHorsTour = boutonsPorte(grid, level, [pj], { zoom: 1, turn: { tokenId: 'pj-b' } });
  assert.equal(btnsHorsTour.length, 2);
  assert.ok(btnsHorsTour.every((b) => b.enabled === false), 'hors tour : boutons grisés (enabled: false)');

  // Vérification du rendu : libellés Ouvrir / Fermer et opacité grisée hors tour.
  /** @type {string[]} */
  const texts = [];
  /** @type {number[]} */
  const alphas = [];
  const ctx = /** @type {any} */ ({
    globalAlpha: 1,
    save() {},
    restore() {},
    beginPath() {},
    roundRect() {},
    fill() {},
    stroke() {},
    fillText(/** @type {string} */ t) {
      texts.push(t);
      alphas.push(this.globalAlpha);
    },
  });
  const layer = new PortalsLayer();
  assert.equal(layer.renderButtons(ctx, grid, level, [pj], { zoom: 1, turn: { tokenId: 'pj-b' } }), 2);
  assert.deepEqual(texts.sort(), ['Fermer', 'Ouvrir']);
  assert.ok(alphas.every((a) => a < 1), 'les boutons hors tour sont dessinés en grisé');
});

// ── T8 : bouton de liaison — géométrie pure et mention pion monté ────────────────────────────

test('boutonLiaison : bouton sur extrémité franchissable, refusé sur gmOnly, entrée B sens unique et pion monté', () => {
  const level = createLevel({ id: 'rdc', pxPerCell: 100, widthCells: 10, heightCells: 10 });
  const grid = gridFor(level);
  const pj = makeLinkedPc({ id: 'pj-a', levelId: 'rdc', cell: { a: 3, b: 3 } });

  const escalier = createLink({
    id: 'escalier',
    kind: 'stairs',
    a: { levelId: 'rdc', at: { cellX: 3, cellY: 3 } },
    b: { levelId: 'et1', at: { cellX: 3, cellY: 3 } },
    bidirectional: true,
    gmOnly: false,
  });
  const trappe = createLink({
    id: 'trappe',
    kind: 'hatch',
    a: { levelId: 'rdc', at: { cellX: 3, cellY: 3 } },
    b: { levelId: 'cave', at: { cellX: 3, cellY: 3 } },
    bidirectional: true,
    gmOnly: false,
  });
  const secrete = createLink({
    id: 'secrete',
    kind: 'stairs',
    a: { levelId: 'rdc', at: { cellX: 3, cellY: 3 } },
    b: { levelId: 'et1', at: { cellX: 3, cellY: 3 } },
    bidirectional: true,
    gmOnly: true,
  });
  const sensUniqueEntreeB = createLink({
    id: 'sens-unique',
    kind: 'stairs',
    a: { levelId: 'et1', at: { cellX: 3, cellY: 3 } },
    b: { levelId: 'rdc', at: { cellX: 3, cellY: 3 } },
    bidirectional: false,
    gmOnly: false,
  });

  // Extrémité franchissable par les joueurs.
  const btn = boutonLiaison(grid, level, [escalier], pj, { zoom: 0.5 });
  assert.ok(btn, 'un bouton attendu sur une extrémité franchissable');
  assert.equal(btn.linkId, 'escalier');
  assert.equal(btn.label, 'Prendre l’escalier');
  assert.ok(Math.abs(btn.rect.height - 44 / 0.5) < 1e-6, 'hauteur = 44 / zoom');

  // Première liaison trouvée dans l'ordre du store quand deux liaisons partagent la case.
  const premier = boutonLiaison(grid, level, [trappe, escalier], pj, { zoom: 1 });
  assert.equal(premier?.linkId, 'trappe');
  assert.equal(premier?.label, 'Passer la trappe');

  // Liaison MJ seule et entrée B d'un sens unique : aucun bouton.
  assert.equal(boutonLiaison(grid, level, [secrete], pj, { zoom: 1 }), null, 'liaison gmOnly écartée');
  assert.equal(
    boutonLiaison(grid, level, [sensUniqueEntreeB], pj, { zoom: 1 }),
    null,
    'entrée B d’un sens unique écartée'
  );

  // Pion monté : aucun bouton, mais renderPrompt garde la mention non tapable.
  const pjMonte = makeLinkedPc({ id: 'pj-a', levelId: 'rdc', cell: { a: 3, b: 3 }, mounted: true });
  assert.equal(boutonLiaison(grid, level, [escalier], pjMonte, { zoom: 1 }), null, 'pion monté : aucun bouton');

  /** @type {string[]} */
  const rendered = [];
  const ctx = /** @type {any} */ ({
    save() {},
    restore() {},
    beginPath() {},
    roundRect() {},
    fill() {},
    stroke() {},
    strokeText() {},
    fillText(/** @type {string} */ t) { rendered.push(t); },
  });
  const layer = new LinksLayer();
  assert.equal(
    layer.renderPrompt(ctx, grid, level, [escalier], { promptAtCell: { a: 3, b: 3 }, mounted: 'local' }),
    1
  );
  assert.equal(
    layer.renderPrompt(ctx, grid, level, [escalier], { promptAtCell: { a: 3, b: 3 }, mounted: 'linked' }),
    1
  );
  assert.deepEqual(rendered, [
    'Descendre de cheval',
    'Demander au MJ de vous faire descendre de cheval',
  ]);
  // Hors cas monté côté joueurs, renderPrompt ne peint rien (le bouton a pris le relais).
  assert.equal(
    layer.renderPrompt(ctx, grid, level, [escalier], { promptAtCell: { a: 3, b: 3 } }),
    0
  );
});

// ── Revue du 22/11/2026 : la couronne de Bond recule comme le budget ─────────────────────────

test('bondZoneFor recule du mouvement déjà parcouru, sans trou entre la zone et l’anneau', () => {
  const level = createLevel({ id: 'rdc', widthCells: 24, heightCells: 6 });
  const pion = {
    ...createToken({ id: 'g1', levelId: 'rdc', cell: { a: 1, b: 2 }, speedCells: 4 }),
    link: LINK_A,
    runCells: 8,
    bondCells: 16,
  };

  // Au repos : budget 8, anneau sur ]8, 16].
  const neuf = bondZoneFor(pion, level, 0);
  assert.ok(neuf, 'anneau attendu au repos');
  assert.ok([...neuf.values()].every((c) => c > 8 && c <= 16), 'coûts dans ]Course, Bond]');

  // Après 3 cases marchées : budget 5, anneau sur ]5, 13] — l’anneau part là où la zone s’arrête,
  // et ne promet plus la case 17 que le budget refuse.
  const rules = movementRulesFor(pion, level, 3);
  assert.equal(rules.budget, 5);
  const apres = bondZoneFor(pion, level, 3);
  assert.ok(apres, 'anneau attendu après 3 cases');
  const couts = [...apres.values()];
  assert.ok(couts.every((c) => c > 5 && c <= 13), `coûts dans ]5, 13] : ${Math.min(...couts)}–${Math.max(...couts)}`);
  // ⚠ Les deux bornes, et pas la seule haute : avec la borne basse laissée à 8 (budget non
  // reculé), tous les coûts restent « > 5 » et l'assertion passait quand même — faux vert
  // attrapé par mutation le 22/11/2026. La case 7 est à 6 cases de la case 1 : elle n'entre dans
  // l'anneau que si celui-ci démarre bien au budget REculé.
  assert.ok(apres.has('7,2'), 'l’anneau démarre au budget reculé (5), donc la case à 6 y est');
  // Borne basse réelle : la diagonale carrée coûte 1,5, donc le premier coût de l'anneau tombe
  // entre 5 et 6 (3 diagonales + 1 pas droit = 5,5). Budget non reculé, il serait au-delà de 8.
  assert.ok(Math.min(...couts) <= 6, `anneau démarré au budget reculé : min ${Math.min(...couts)}`);
  assert.ok(apres.has('14,2'), 'portée 13 depuis la case 1 : jusqu’à la case 14');
  assert.ok(!apres.has('15,2'), 'et pas au-delà');

  // Mouvement entièrement consommé : plus d’anneau du tout.
  assert.equal(bondZoneFor(pion, level, 16), null, 'Bond épuisé : aucun anneau');
});

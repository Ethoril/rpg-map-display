// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';

import { createCampaign, createLevel, createToken, createLink } from '../js/core/schema.js';
import { applyNetworkEvent } from '../js/app/networkEvents.js';
import * as store from '../js/state/store.js';
import { createFogTools } from '../js/ui/gm/fogTools.js';
import { ExploredFog } from '../js/vision/fog.js';

function createMockElement() {
  return {
    style: {},
    dataset: {},
    classList: { add() {}, remove() {} },
    getAttribute: () => null,
    setAttribute: () => {},
    addEventListener: () => {},
    querySelector: () => createMockElement(),
    querySelectorAll: () => [createMockElement()],
  };
}

function createMockCanvas(width = 100, height = 100) {
  const pixels = new Uint8Array(width * height * 4);

  const ctx = {
    width,
    height,
    pixels,
    fillStyle: '#000000',
    globalCompositeOperation: 'source-over',

    save() {},
    restore() {},
    clearRect(x = 0, y = 0, w = width, h = height) {
      for (let r = Math.max(0, Math.floor(y)); r < Math.min(height, Math.floor(y + h)); r++) {
        for (let c = Math.max(0, Math.floor(x)); c < Math.min(width, Math.floor(x + w)); c++) {
          const idx = (r * width + c) * 4;
          pixels[idx + 3] = 0;
        }
      }
    },
    fillRect(x = 0, y = 0, w = width, h = height) {
      const isErase = ctx.globalCompositeOperation === 'destination-out';
      for (let r = Math.max(0, Math.floor(y)); r < Math.min(height, Math.floor(y + h)); r++) {
        for (let c = Math.max(0, Math.floor(x)); c < Math.min(width, Math.floor(x + w)); c++) {
          const idx = (r * width + c) * 4;
          pixels[idx + 3] = isErase ? 0 : 255;
        }
      }
    },
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    arc() {},
    fill() {},
    stroke() {},
    drawImage() {},
    getImageData(x = 0, y = 0, w = width, h = height) {
      return { data: pixels, width: w, height: h };
    },
    putImageData() {},
  };

  return {
    width,
    height,
    getContext: () => ctx,
    ctx,
  };
}

/**
 * Prépare une campagne avec 2 étages, des pions sur les 2 étages et de la géométrie sur l'étage 1.
 */
function setupCampagneTest() {
  store.resetStore();
  const rdc = createLevel({
    id: 'rdc',
    name: 'Rez-de-chaussée',
    imageUrl: 'maps/rdc.webp',
    widthCells: 10,
    heightCells: 8,
    pxPerCell: 100,
    walls: [
      [
        { cellX: 1, cellY: 1 },
        { cellX: 5, cellY: 1 },
      ],
    ],
    portals: [
      {
        id: 'porte-1',
        a: { cellX: 2, cellY: 2 },
        b: { cellX: 3, cellY: 2 },
        state: 'closed',
        freestanding: false,
      },
    ],
    lights: [
      {
        id: 'lampe-1',
        at: { cellX: 4, cellY: 4 },
        range: 5,
        intensity: 1,
        color: '#ffaa00',
        shadows: true,
        on: true,
      },
    ],
  });

  const etage1 = createLevel({
    id: 'et1',
    name: 'Étage 1',
    imageUrl: 'maps/etage1.webp',
    widthCells: 12,
    heightCells: 10,
    pxPerCell: 120,
  });

  const heros = createToken({
    id: 'heros-rdc',
    levelId: 'rdc',
    kind: 'pc',
    cell: { a: 2, b: 2 },
    label: 'Héros',
    hp: { current: 15, max: 25 },
    markers: ['prone'],
  });

  const garde = createToken({
    id: 'garde-rdc',
    levelId: 'rdc',
    kind: 'npc',
    cell: { a: 4, b: 4 },
    label: 'Garde',
    hp: { current: 5, max: 10 },
    markers: ['stunned'],
  });

  const spectre = createToken({
    id: 'spectre-et1',
    levelId: 'et1',
    kind: 'npc',
    cell: { a: 6, b: 6 },
    label: 'Spectre',
    hp: { current: 8, max: 8 },
  });

  const campaign = createCampaign({
    levels: [rdc, etage1],
    tokens: [heros, garde, spectre],
  });

  store.loadCampaign(campaign);
  store.selectLevel('rdc');
  return { rdc, etage1, heros, garde, spectre };
}

test('UX-13 : store.replaceLevelMap remplace la carte, vide la géométrie et déplace les pions en réserve', () => {
  setupCampagneTest();
  store.selectToken('heros-rdc');
  assert.equal(store.getState().selectedTokenId, 'heros-rdc');

  const patch = {
    imageUrl: 'maps/nouveau-rdc.webp',
    widthCells: 20,
    heightCells: 15,
    pxPerCell: 140,
    grid: {
      type: /** @type {'square'} */ ('square'),
      offsetX: 10,
      offsetY: 15,
      color: '#000000',
      opacity: 0.3,
      visible: true,
    },
  };

  const reservedIds = store.replaceLevelMap('rdc', patch);

  // 1. Les pions du RDC sont en réserve, l'autre pion n'a pas bougé
  assert.deepEqual(reservedIds.sort(), ['garde-rdc', 'heros-rdc']);
  const reserve = store.getReserve();
  assert.equal(reserve.length, 2);

  const herosReserve = reserve.find((t) => t.id === 'heros-rdc');
  assert.equal(herosReserve?.label, 'Héros');
  assert.deepEqual(herosReserve?.hp, { current: 15, max: 25 }, 'les PV voyagent en réserve');
  assert.deepEqual(herosReserve?.markers, ['prone'], 'les marqueurs voyagent en réserve');

  const tokensSurPlateau = store.getState().campaign?.tokens ?? [];
  assert.equal(tokensSurPlateau.length, 1);
  assert.equal(tokensSurPlateau[0].id, 'spectre-et1', 'le pion de l étage 1 est resté sur le plateau');

  // 2. Le pion sélectionné qui était sur le RDC est désélectionné
  assert.equal(store.getState().selectedTokenId, null);

  // 3. L'étage a reçu son nouveau contenu, son identifiant ne change pas, aucun étage n'est ajouté
  const campaignLevels = store.getState().campaign?.levels ?? [];
  assert.equal(campaignLevels.length, 2);

  const rdcApres = campaignLevels.find((l) => l.id === 'rdc');
  assert.ok(rdcApres);
  assert.equal(rdcApres?.imageUrl, 'maps/nouveau-rdc.webp');
  assert.equal(rdcApres?.widthCells, 20);
  assert.equal(rdcApres?.heightCells, 15);
  assert.equal(rdcApres?.pxPerCell, 140);
  assert.deepEqual(rdcApres?.grid, {
    type: 'square',
    offsetX: 10,
    offsetY: 15,
    color: '#000000',
    opacity: 0.3,
    visible: true,
  });

  // 4. Murs, portails et lumières sont vidés
  assert.deepEqual(rdcApres?.walls, []);
  assert.deepEqual(rdcApres?.portals, []);
  assert.deepEqual(rdcApres?.lights, []);
});

test('UX-13 : Critère 8 — Atomicité de replaceLevelMap en cas de refus', () => {
  setupCampagneTest();

  // Patch invalide (largeur négative)
  const patchInvalide = {
    imageUrl: 'maps/invalide.webp',
    widthCells: -5,
  };

  assert.throws(
    () => store.replaceLevelMap('rdc', /** @type {any} */ (patchInvalide)),
    /widthCells/i
  );

  // Vérifier qu'absolument rien n'a été muté
  assert.equal(store.getReserve().length, 0, 'aucun pion ne doit avoir été déplacé en réserve');
  const tokens = store.getState().campaign?.tokens ?? [];
  assert.equal(tokens.length, 3, 'les 3 pions sont toujours sur le plateau');
  assert.ok(tokens.some((t) => t.id === 'heros-rdc'));
  assert.ok(tokens.some((t) => t.id === 'garde-rdc'));

  const rdc = store.getState().campaign?.levels.find((l) => l.id === 'rdc');
  assert.equal(rdc?.imageUrl, 'maps/rdc.webp', 'l ancienne carte est conservée');
  assert.equal(rdc?.walls.length, 1, 'les murs sont conservés');
  assert.equal(rdc?.portals.length, 1, 'les portails sont conservés');
});

test('UX-13 : Réseau — applyNetworkEvent avec level.replace', () => {
  setupCampagneTest();

  const patch = {
    imageUrl: 'maps/remote-replaced.webp',
    widthCells: 15,
    heightCells: 12,
    pxPerCell: 110,
  };

  // Événement valide
  const resOk = applyNetworkEvent({
    type: 'level.replace',
    payload: { levelId: 'rdc', patch },
    at: Date.now(),
    by: 'gm',
  });
  assert.equal(resOk, true);

  const rdc = store.getState().campaign?.levels.find((l) => l.id === 'rdc');
  assert.equal(rdc?.imageUrl, 'maps/remote-replaced.webp');
  assert.equal(rdc?.widthCells, 15);
  assert.equal(store.getReserve().length, 2, 'les pions ont été rangés en réserve');

  // Payload malformé (patch manquant)
  const resBad1 = applyNetworkEvent({
    type: 'level.replace',
    payload: { levelId: 'rdc' },
    at: Date.now(),
    by: 'gm',
  });
  assert.equal(resBad1, false);

  // Étage inconnu
  const resBad2 = applyNetworkEvent({
    type: 'level.replace',
    payload: { levelId: 'inexistant', patch },
    at: Date.now(),
    by: 'gm',
  });
  assert.equal(resBad2, false);
});

test('UX-15 : Réseau — applyNetworkEvent avec level.show refuse un étage inconnu, bruyamment et sans muter', () => {
  setupCampagneTest();
  store.selectLevel('rdc');

  const avant = store.getActiveLevelId();
  const journal = console.error;
  /** @type {string[]} */
  const messages = [];
  console.error = (...args) => messages.push(String(args[0]));
  try {
    const res = applyNetworkEvent({
      type: 'level.show',
      payload: { levelId: 'inexistant' },
      at: Date.now(),
      by: 'gm',
    });
    assert.equal(res, false, 'un étage inconnu doit être refusé');
    assert.equal(store.getActiveLevelId(), avant, 'le store ne doit pas avoir muté');
    assert.ok(
      messages.some((m) => m.includes('level.show') && m.includes('inexistant')),
      'le refus doit être journalisé, pas silencieux'
    );
  } finally {
    console.error = journal;
  }

  // Et un étage connu, lui, est bien appliqué — c'est le réducteur partagé par les deux vues.
  const res = applyNetworkEvent({
    type: 'level.show',
    payload: { levelId: 'et1' },
    at: Date.now(),
    by: 'gm',
  });
  assert.equal(res, true);
  assert.equal(store.getActiveLevelId(), 'et1');
});

test('UX-13 : fogTools.clearFog vide le masque exploré et la pile undo de l étage actif sans lever', async () => {
  const fogMap = new Map();
  const fogRdc = new ExploredFog(10, 8, createMockCanvas);
  fogRdc.revealAll(); // rendre exploré
  fogMap.set('rdc', fogRdc);

  let published = 0;
  let rendered = 0;

  const mockContainer = createMockElement();

  const fogTools = createFogTools(/** @type {any} */ (mockContainer), {
    getActiveLevelId: () => 'rdc',
    getExploredFog: (id) => fogMap.get(id) || null,
    scheduleFogPublish: () => {
      published++;
    },
    requestRender: () => {
      rendered++;
    },
  });

  // Empiler un état undo
  await fogTools.pushUndoState();
  assert.equal(fogTools.getUndoStackLength('rdc'), 1);

  // Appeler clearFog
  await fogTools.clearFog();

  assert.equal(published, 1, 'scheduleFogPublish a été appelé');
  assert.equal(rendered, 1, 'requestRender a été appelé');
  assert.equal(fogTools.getUndoStackLength('rdc'), 0, 'la pile d undo a été vidée');

  // Vérifier que le canvas du fog est vidé (alpha = 0)
  const png = await fogRdc.exportPng();
  assert.ok(typeof png === 'string');
});

/**
 * Amendement UX-16 — `store.removeLevel` et `level.delete`.
 *
 * Trois étages en ordre (rdc, et1, et2), une liaison entre chaque paire d'étages voisins, un
 * pion posé sur chacun, et un pion en réserve dont la provenance est `et1`. C'est le montage
 * minimal qui exerce à la fois le retrait des pions posés, celui des liaisons pendantes et la
 * survie des pions rangés.
 */
function setupCampagneEtages() {
  store.resetStore();
  const rdc = createLevel({ id: 'rdc', name: 'Rez-de-chaussée', order: 0, imageUrl: 'maps/rdc.webp' });
  const et1 = createLevel({ id: 'et1', name: 'Étage 1', order: 1, imageUrl: 'maps/et1.webp' });
  const et2 = createLevel({ id: 'et2', name: 'Étage 2', order: 2, imageUrl: 'maps/et2.webp' });

  const heros = createToken({ id: 'heros-rdc', levelId: 'rdc', kind: 'pc', cell: { a: 1, b: 1 } });
  const garde = createToken({ id: 'garde-et1', levelId: 'et1', kind: 'npc', cell: { a: 2, b: 2 } });
  const spectre = createToken({ id: 'spectre-et2', levelId: 'et2', kind: 'npc', cell: { a: 3, b: 3 } });
  const enReserve = createToken({ id: 'garde-en-reserve', levelId: 'et1', kind: 'npc', cell: { a: 9, b: 9 } });

  const escalierBas = createLink({
    id: 'escalier-bas',
    a: { levelId: 'rdc', at: { cellX: 1, cellY: 1 } },
    b: { levelId: 'et1', at: { cellX: 2, cellY: 2 } },
  });
  const escalierHaut = createLink({
    id: 'escalier-haut',
    a: { levelId: 'et1', at: { cellX: 5, cellY: 5 } },
    b: { levelId: 'et2', at: { cellX: 3, cellY: 3 } },
  });

  const campaign = createCampaign({
    levels: [rdc, et1, et2],
    tokens: [heros, garde, spectre],
    links: [escalierBas, escalierHaut],
  });
  campaign.reserve = [enReserve];

  store.loadCampaign(campaign);
  store.selectLevel('rdc');
}

test('UX-16 : store.removeLevel emporte les pions posés et toute liaison pendante, épargne la réserve', () => {
  setupCampagneEtages();

  const retire = store.removeLevel('et1');
  assert.equal(retire, true);

  const etat = store.getState();
  assert.deepEqual(
    (etat.campaign?.levels ?? []).map((l) => l.id).sort(),
    ['et2', 'rdc'].sort(),
    'et1 a disparu de la liste des étages'
  );

  const tokenIds = (etat.campaign?.tokens ?? []).map((t) => t.id).sort();
  assert.deepEqual(tokenIds, ['heros-rdc', 'spectre-et2'], 'le pion posé sur et1 a disparu avec lui');

  assert.deepEqual(
    etat.campaign?.links ?? [],
    [],
    'aucune liaison ne doit plus pointer vers un étage retiré, des deux côtés'
  );

  // ⛔ UX-14 : le pion en réserve conserve son `levelId` comme trace de provenance, pas comme
  // position. Sa provenance disparaît ; lui, non.
  const reserve = store.getReserve();
  assert.equal(reserve.length, 1);
  assert.equal(reserve[0].id, 'garde-en-reserve');
  assert.equal(reserve[0].levelId, 'et1', 'la trace de provenance reste intacte, sans validation');
});

test('UX-16 : ⭐ la table affichait l’étage retiré, elle retombe sur un autre et pas sur un fantôme', () => {
  setupCampagneEtages();
  store.selectLevel('et1');
  assert.equal(store.getActiveLevelId(), 'et1');

  store.removeLevel('et1');

  const nouvelActif = store.getActiveLevelId();
  assert.notEqual(nouvelActif, 'et1', 'ne doit plus pointer vers l’étage disparu');
  assert.ok(nouvelActif, 'un étage doit rester sélectionné');
  const niveau = store.getState().campaign?.levels.find((l) => l.id === nouvelActif);
  assert.ok(niveau, 'l’étage actif doit exister réellement dans la campagne — pas un fantôme');
  assert.equal(nouvelActif, 'rdc', 'le premier étage restant dans l’ordre (rdc, order 0)');
});

test('UX-16 : le dernier étage ne se retire pas, et le refus se dit', () => {
  store.resetStore();
  const seul = createLevel({ id: 'seul', name: 'Seul étage', order: 0 });
  store.loadCampaign(createCampaign({ levels: [seul] }));

  assert.throws(() => store.removeLevel('seul'), /dernier/i);
  assert.equal(store.getState().campaign?.levels.length, 1, 'rien n’a été muté');

  const journal = console.error;
  /** @type {string[]} */
  const messages = [];
  console.error = (...args) => messages.push(String(args[0]));
  try {
    const res = applyNetworkEvent({
      type: 'level.delete',
      payload: { levelId: 'seul' },
      at: Date.now(),
      by: 'gm',
    });
    assert.equal(res, false);
    assert.ok(
      messages.some((m) => m.includes('level.delete')),
      'le refus doit être journalisé, pas silencieux'
    );
  } finally {
    console.error = journal;
  }
});

/**
 * ⛔ **Le brouillard de l'étage retiré doit être PURGÉ, et rien ne le défendait.**
 *
 * Trouvé le 10/09/2026 par mutation : retirer la purge de `sessionFogMap` laissait les neuf tests
 * de cette tranche au vert. Or l'amendement UX-16 en fait une garantie explicite — sans elle, un
 * étage réimporté plus tard **sous le même identifiant** hériterait du masque exploré de son
 * prédécesseur, donc révélerait à la table des zones d'une carte qu'elle n'a jamais vue.
 *
 * ⚠ L'assertion porte sur ce que `getSessionFog` rend **après** le retrait, c'est-à-dire sur la
 * mémoire que le prochain étage lirait — pas sur un drapeau interne.
 */
test('UX-16 : le brouillard de l étage retiré est purgé, y compris pour un étage réimporté au même identifiant', () => {
  setupCampagneEtages();
  const PNG_BIDON = 'iVBORw0KGgoAAAANSUhEUg==';
  store.setSessionFog('et1', PNG_BIDON);
  assert.equal(store.getSessionFog('et1'), PNG_BIDON, 'le masque est bien posé au départ');

  store.removeLevel('et1');
  assert.equal(
    store.getSessionFog('et1'),
    null,
    '⛔ le masque exploré de l étage retiré doit disparaître avec lui'
  );

  // Le cas qui donne son sens à la purge : un étage revient sous le MÊME identifiant.
  store.addLevel(createLevel({ id: 'et1', name: 'Étage 1 (réimporté)', order: 1, imageUrl: 'maps/et1-bis.webp' }));
  assert.equal(
    store.getSessionFog('et1'),
    null,
    '⛔ un étage réimporté au même identifiant ne doit RIEN hériter du brouillard de son prédécesseur'
  );
});

test('UX-16 : Réseau — rejouer level.delete converge sans lever', () => {
  setupCampagneEtages();

  const res1 = applyNetworkEvent({
    type: 'level.delete',
    payload: { levelId: 'et1' },
    at: Date.now(),
    by: 'gm',
  });
  assert.equal(res1, true);

  // Rejeu : l'étage est déjà absent, ça ne doit ni lever ni re-muter.
  const res2 = applyNetworkEvent({
    type: 'level.delete',
    payload: { levelId: 'et1' },
    at: Date.now(),
    by: 'gm',
  });
  assert.equal(res2, false);

  assert.deepEqual(
    (store.getState().campaign?.levels ?? []).map((l) => l.id).sort(),
    ['et2', 'rdc'].sort()
  );

  // Payload malformé, refusé bruyamment.
  const journal = console.error;
  /** @type {string[]} */
  const messages = [];
  console.error = (...args) => messages.push(String(args[0]));
  try {
    const resBad = applyNetworkEvent({
      type: 'level.delete',
      payload: {},
      at: Date.now(),
      by: 'gm',
    });
    assert.equal(resBad, false);
    assert.ok(messages.some((m) => m.includes('level.delete')));
  } finally {
    console.error = journal;
  }
});

// ── C-16 : level.grid porte les dimensions recalculées ─────────────────────────────────

test('C-16 : Réseau — level.grid applique widthCells/heightCells, garde les cases et range les pions sortis', () => {
  setupCampagneTest();
  const grilleHex = { type: 'hex', offsetX: 0, offsetY: 0, color: '#000000', opacity: 0.25, visible: true };

  // Passage en hexagonal : la grille grandit, aucun pion ne sort, aucun ne bouge.
  assert.equal(
    applyNetworkEvent({
      type: 'level.grid',
      payload: { levelId: 'rdc', grid: grilleHex, widthCells: 10, heightCells: 9 },
      at: Date.now(),
      by: 'gm',
    }),
    true
  );
  let rdc = store.getState().campaign?.levels.find((l) => l.id === 'rdc');
  assert.equal(rdc?.grid.type, 'hex');
  assert.equal(rdc?.widthCells, 10);
  assert.equal(rdc?.heightCells, 9);
  assert.deepEqual(store.getState().campaign?.tokens.find((t) => t.id === 'garde-rdc')?.cell, { a: 4, b: 4 });
  assert.equal(store.getReserve().length, 0);

  // Retour en carré sur 4 rangées : le garde (rangée 4) n'est plus dans la grille. Il part en
  // réserve **ici même** — sinon la validation refuserait la hauteur réduite tant que son
  // `token.reserve` n'est pas arrivé. Le héros garde sa case ; le spectre est sur un autre étage.
  const grilleCarree = { ...grilleHex, type: 'square' };
  assert.equal(
    applyNetworkEvent({
      type: 'level.grid',
      payload: { levelId: 'rdc', grid: grilleCarree, widthCells: 10, heightCells: 4 },
      at: Date.now(),
      by: 'gm',
    }),
    true
  );
  rdc = store.getState().campaign?.levels.find((l) => l.id === 'rdc');
  assert.equal(rdc?.heightCells, 4);
  assert.deepEqual(store.getReserve().map((t) => t.id), ['garde-rdc']);
  assert.deepEqual(store.getState().campaign?.tokens.find((t) => t.id === 'heros-rdc')?.cell, { a: 2, b: 2 });
  assert.ok(store.getState().campaign?.tokens.some((t) => t.id === 'spectre-et1'));

  // Le `token.reserve` du MJ, qui suit, et le rejeu de `level.grid` : inoffensifs.
  assert.equal(
    applyNetworkEvent({ type: 'token.reserve', payload: { tokenId: 'garde-rdc' }, at: Date.now(), by: 'gm' }),
    false
  );
  applyNetworkEvent({
    type: 'level.grid',
    payload: { levelId: 'rdc', grid: grilleCarree, widthCells: 10, heightCells: 4 },
    at: Date.now(),
    by: 'gm',
  });
  assert.deepEqual(store.getReserve().map((t) => t.id), ['garde-rdc']);
  assert.equal(store.getState().campaign?.tokens.filter((t) => t.levelId === 'rdc').length, 1);
});

test('C-16 : Réseau — un level.grid sans dimensions, ou avec des dimensions invalides, les laisse intactes', () => {
  setupCampagneTest();
  const grille = { type: 'square', offsetX: 0, offsetY: 0, color: '#ff0000', opacity: 0.5, visible: true };

  applyNetworkEvent({ type: 'level.grid', payload: { levelId: 'rdc', grid: grille }, at: Date.now(), by: 'gm' });
  let rdc = store.getState().campaign?.levels.find((l) => l.id === 'rdc');
  assert.equal(rdc?.grid.color, '#ff0000', 'la couleur, elle, est appliquée');
  assert.equal(rdc?.widthCells, 10);
  assert.equal(rdc?.heightCells, 8);

  for (const invalide of [0, -3, 2.5, '7', null]) {
    applyNetworkEvent({
      type: 'level.grid',
      payload: { levelId: 'rdc', grid: grille, widthCells: invalide, heightCells: invalide },
      at: Date.now(),
      by: 'gm',
    });
    rdc = store.getState().campaign?.levels.find((l) => l.id === 'rdc');
    assert.equal(rdc?.widthCells, 10, `widthCells ${String(invalide)} aurait dû être ignoré`);
    assert.equal(rdc?.heightCells, 8, `heightCells ${String(invalide)} aurait dû être ignoré`);
  }
  assert.equal(store.getReserve().length, 0);
});

test('C-16 : regridLevel applique la règle de bornes D-8 — en hexagonal, seul l’ancrage compte', () => {
  store.resetStore();
  const level = createLevel({ id: 'plaine', widthCells: 10, heightCells: 10, pxPerCell: 100 });
  const grand = createToken({ id: 'ogre', levelId: 'plaine', kind: 'npc', cell: { a: 3, b: 4 }, sizeCells: 2 });
  store.loadCampaign(createCampaign({ levels: [level], tokens: [grand] }));
  store.selectLevel('plaine');

  // Hexagonal sur 5 rangées : l'ancrage (rangée 4) est dans la grille, l'ogre reste.
  const rangesHex = store.regridLevel('plaine', { grid: { type: 'hex' }, heightCells: 5 });
  assert.deepEqual(rangesHex, []);

  // Carré sur 5 rangées : le bloc 2 × 2 déborde de la dernière rangée, il part en réserve.
  const rangesCarre = store.regridLevel('plaine', { grid: { type: 'square' }, heightCells: 5 });
  assert.deepEqual(rangesCarre, ['ogre']);
  assert.deepEqual(store.getReserve()[0]?.cell, { a: 3, b: 4 }, 'le pion rangé garde sa case');
});

// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { createCampaign, createLevel, createToken, validateCampaign } from '../js/core/schema.js';
import { applyNetworkEvent } from '../js/app/networkEvents.js';
import * as store from '../js/state/store.js';
import { gridFor } from '../js/grid/index.js';

/**
 * UX-14 — la réserve de pions.
 *
 * Un `Token` porte un `levelId` **et** une `cell`, tous deux obligatoires et validés : un pion est
 * toujours quelque part. Il n'existait aucun endroit où poser un pion qui n'est sur aucune carte.
 *
 * ⛔ **Collection séparée, et non un `levelId` nul** — décision du mainteneur du 18/08/2026.
 * L'invariant reste vrai pour `tokens`, et surtout **aucun balayage de pions ne change** : c'est ce
 * qui rend structurellement impossible qu'un pion rangé éclaire une pièce, au lieu d'être une garde
 * qu'on peut oublier dans l'un des cinq endroits qui balaient les pions.
 */

function campagneAvecDeuxPions() {
  store.resetStore();
  const rdc = createLevel({ id: 'rdc', name: 'RDC', widthCells: 10, heightCells: 8 });
  const heros = createToken({
    id: 'heros',
    levelId: 'rdc',
    kind: 'pc',
    cell: { a: 1, b: 1 },
    label: 'Héros',
    hp: { current: 12, max: 20 },
  });
  const gobelin = createToken({
    id: 'gobelin',
    levelId: 'rdc',
    kind: 'npc',
    cell: { a: 4, b: 4 },
    label: 'Gobelin',
    hp: { current: 3, max: 7 },
    markers: ['stunned'],
    emitsLight: { range: 4, intensity: 1, color: '#ffcc66' },
  });
  store.loadCampaign(createCampaign({ levels: [rdc], tokens: [heros, gobelin] }));
  return { heros, gobelin };
}

test('UX-14 : ranger un pion le retire du plateau AVEC tout son état, et le ressortir le rend intact', () => {
  campagneAvecDeuxPions();

  assert.equal(store.getReserve().length, 0, 'une campagne neuve a une réserve vide');

  assert.equal(store.reserveToken('gobelin'), true);
  assert.deepEqual(
    store.getState().campaign?.tokens.map((t) => t.id),
    ['heros'],
    'seul le pion désigné quitte le plateau'
  );

  const range = store.getReserve();
  assert.equal(range.length, 1);
  // ⭐ Ce qui distingue la réserve de la bibliothèque : ce sont CES pions-là, avec leur histoire.
  assert.equal(range[0].label, 'Gobelin');
  assert.deepEqual(range[0].hp, { current: 3, max: 7 }, 'les PV voyagent avec le pion');
  assert.deepEqual(range[0].markers, ['stunned'], 'les marqueurs aussi');
  assert.deepEqual(
    range[0].emitsLight,
    { range: 4, intensity: 1, color: '#ffcc66' },
    'sa lampe est conservée — elle ne doit simplement éclairer nulle part'
  );

  // Absence idempotente et silencieuse, comme `removeTemplate` : le rejeu réseau est inoffensif.
  assert.equal(store.reserveToken('gobelin'), false);
  assert.equal(store.reserveToken('inexistant'), false);
  assert.throws(() => store.reserveToken(''), /Identifiant de pion requis/);

  // Ressortie : le pion revient sur la case demandée, et avec son état.
  assert.equal(store.placeTokenFromReserve('gobelin', 'rdc', { a: 2, b: 3 }), true);
  assert.equal(store.getReserve().length, 0, 'il ne reste pas AUSSI en réserve');
  const revenu = store.getState().campaign?.tokens.find((t) => t.id === 'gobelin');
  assert.deepEqual(revenu?.cell, { a: 2, b: 3 });
  assert.deepEqual(revenu?.hp, { current: 3, max: 7 }, 'il revient blessé, comme il est parti');
  assert.deepEqual(revenu?.markers, ['stunned']);

  assert.equal(store.placeTokenFromReserve('gobelin', 'rdc', { a: 5, b: 5 }), false);
});

test('UX-14 : une case hors carte refuse la pose et LAISSE le pion en réserve', () => {
  campagneAvecDeuxPions();
  store.reserveToken('gobelin');

  // ⚠ La transaction est ce qui compte : sans elle, un pion pourrait disparaître des DEUX
  // collections sur une case invalide, et il n'y aurait aucun moyen de le récupérer.
  assert.throws(
    () => store.placeTokenFromReserve('gobelin', 'rdc', { a: 40, b: 40 }),
    /hors limites/
  );
  assert.equal(store.getReserve().length, 1, 'le pion doit être resté en réserve');
  assert.equal(
    store.getState().campaign?.tokens.some((t) => t.id === 'gobelin'),
    false,
    'et ne pas avoir atterri sur le plateau'
  );

  assert.throws(
    () => store.placeTokenFromReserve('gobelin', 'rdc', { a: 1.5, b: 2 }),
    /Case valide requise/
  );
  assert.equal(store.getReserve().length, 1);
});

test('UX-14 : un pion rangé ne peut pas rester sélectionné', () => {
  campagneAvecDeuxPions();
  store.selectToken('gobelin');
  assert.equal(store.getState().selectedTokenId, 'gobelin');

  store.reserveToken('gobelin');
  assert.equal(
    store.getState().selectedTokenId,
    null,
    'la barre de vitalité désignerait un pion qui n’est sur aucune carte'
  );
});

test('UX-14 : le schéma valide la réserve par les mêmes règles, sauf ce qui n’a pas de sens hors du plateau', () => {
  const rdc = createLevel({ id: 'rdc', widthCells: 10, heightCells: 8 });
  const base = createToken({ id: 'range', levelId: 'rdc', cell: { a: 2, b: 2 }, label: 'Rangé' });

  // 1. Un pion en réserve dont l'étage n'existe PLUS reste valide : son levelId n'est qu'une
  //    trace de provenance. Exiger l'étage rendrait la campagne invalide dès qu'on le supprime.
  assert.deepEqual(
    validateCampaign(
      createCampaign({ levels: [rdc], reserve: [{ ...base, levelId: 'etage-supprime' }] })
    ),
    [],
    'un étage disparu ne doit pas invalider un pion en réserve'
  );

  // 2. Ni les bornes de la case : le pion n'est nulle part.
  assert.deepEqual(
    validateCampaign(createCampaign({ levels: [rdc], reserve: [{ ...base, cell: { a: 99, b: 99 } }] })),
    [],
    'une case hors bornes ne doit pas invalider un pion en réserve'
  );

  // 3. Le reste de la forme, si : un pion en réserve doit rester re-posable.
  const errsForme = validateCampaign(
    createCampaign({
      levels: [rdc],
      reserve: [/** @type {any} */ ({ ...base, sizeCells: 0, borderColor: 'rouge' })],
    })
  );
  assert.ok(
    errsForme.some((e) => e.includes('range')),
    'une forme cassée en réserve doit être refusée en nommant le pion'
  );

  // 4. ⭐ Le même identifiant ne peut pas être sur le plateau ET en réserve : c'est l'état
  //    incohérent le plus probable, et le jeu d'identifiants est commun aux deux collections.
  const errsDouble = validateCampaign(
    createCampaign({ levels: [rdc], tokens: [base], reserve: [base] })
  );
  assert.ok(
    errsDouble.some((e) => e.toLowerCase().includes('dupliqu') || e.includes('range')),
    `un pion présent deux fois doit être refusé — reçu : ${JSON.stringify(errsDouble)}`
  );

  // 5. Compatibilité : une campagne enregistrée avant UX-14 ne porte pas `reserve`.
  const ancienne = createCampaign({ levels: [rdc], tokens: [base] });
  delete /** @type {any} */ (ancienne).reserve;
  assert.deepEqual(validateCampaign(ancienne), [], 'une campagne sans réserve reste valide');
});

test('UX-14 : les événements réseau — token.reserve, et token.add qui SORT de la réserve', () => {
  campagneAvecDeuxPions();

  /** @param {string} type @param {object} payload */
  const envoyer = (type, payload) =>
    applyNetworkEvent({ type, payload, at: 1, by: 'gm' });

  assert.equal(envoyer('token.reserve', { tokenId: 'gobelin' }), true);
  assert.equal(store.getReserve().length, 1);

  // Rejeu : sans effet, et sans lever — le réducteur ne doit pas emporter le lot d'événements
  // qui le suit (`CONVENTIONS.md` §4 et §6).
  assert.equal(envoyer('token.reserve', { tokenId: 'gobelin' }), false);
  assert.equal(envoyer('token.reserve', { tokenId: 42 }), false);
  assert.equal(store.getReserve().length, 1);

  // ⭐ `token.add` sur un pion en réserve le SORT de la réserve au lieu de le dupliquer. Sans
  // cette branche, le pion existerait dans les deux collections et le schéma refuserait la
  // campagne suivante.
  const pionRange = store.getReserve()[0];
  assert.equal(
    envoyer('token.add', { token: { ...pionRange, cell: { a: 6, b: 6 } } }),
    true
  );
  assert.equal(store.getReserve().length, 0, 'il ne doit plus être en réserve');
  assert.equal(
    store.getState().campaign?.tokens.filter((t) => t.id === 'gobelin').length,
    1,
    'et n’exister qu’une fois sur le plateau'
  );
});

test('UX-14 : ⛔ AUCUN balayage de pions ne voit la réserve, vérifié par recherche', () => {
  // ⛔ Vérification par **recherche dans les sources**, et c'est le seul moyen de prouver une
  // absence. Le brief exige qu'un pion en réserve n'émette ni vision ni lumière et ne compte dans
  // aucun calcul. La décision de collection séparée le garantit **par construction** : ces
  // fichiers parcourent `tokens` et ne connaissent pas `reserve`. Si l'un d'eux venait à la lire,
  // c'est que quelqu'un a réintroduit le risque, et ce test doit rougir avant la séance.
  const surveilles = [
    'js/vision/sweep.js',
    'js/vision/fog.js',
    'js/render/layers/fogLayer.js',
    'js/render/layers/tokens.js',
    'js/render/layers/moveZone.js',
    'js/import/blockedEdges.js',
    'js/state/selection.js',
  ];

  for (const chemin of surveilles) {
    if (!fs.existsSync(chemin)) continue;
    const source = fs.readFileSync(chemin, 'utf8');
    assert.equal(
      /\breserve\b/.test(source),
      false,
      `${chemin} mentionne la réserve : un pion rangé risque d’émettre vision ou lumière`
    );
  }

  // Et la garantie côté données : après rangement, le tableau que ces balayages reçoivent ne
  // contient plus le pion. C'est la même vérité, prise par le comportement.
  campagneAvecDeuxPions();
  store.reserveToken('gobelin');
  const balayes = store.getRenderSnapshot().campaign?.tokens ?? [];
  assert.equal(
    balayes.some((t) => t.id === 'gobelin'),
    false,
    'le pion rangé ne doit plus figurer dans les pions balayés'
  );
  assert.equal(
    balayes.some((t) => t.emitsLight !== null),
    false,
    'la seule source de lumière de la scène était le pion rangé'
  );
});

/**
 * C-6 ⭐ UNE CASE, UN PION, POUR TOUS LES PIONS — décision du mainteneur du 10/09/2026
 * (`docs/QUESTIONS-EN-ATTENTE.md`). L'empilement devient impossible, entre tous les pions,
 * joueurs comme PNJ. L'invariant vit dans une seule fonction du store (`findStackingConflict`),
 * appelée par les cinq chemins qui posent ou déplacent un pion, et par la normalisation au
 * chargement (`resolveStackedTokens`).
 */

test('C-6 : les cinq chemins refusent l’empilement, y compris `updateToken` qui ferait grossir un pion sur un voisin', () => {
  store.resetStore();
  const rdc = createLevel({ id: 'rdc', widthCells: 10, heightCells: 8 });
  const et1 = createLevel({ id: 'et1', widthCells: 10, heightCells: 8 });
  const a = createToken({ id: 'a', levelId: 'rdc', cell: { a: 1, b: 1 }, kind: 'pc' });
  const b = createToken({ id: 'b', levelId: 'rdc', cell: { a: 2, b: 1 }, kind: 'npc' });
  const c = createToken({ id: 'c', levelId: 'et1', cell: { a: 3, b: 3 }, kind: 'npc' });
  const escalier = {
    id: 'stairs',
    kind: 'stairs',
    label: 'Montée',
    a: { levelId: 'rdc', at: { cellX: 1, cellY: 1 } },
    b: { levelId: 'et1', at: { cellX: 3, cellY: 3 } },
    bidirectional: true,
    gmOnly: false,
  };
  store.loadCampaign(
    createCampaign({ levels: [rdc, et1], tokens: [a, b, c], links: [/** @type {any} */ (escalier)] })
  );

  // 1. addToken : poser un pion neuf sur une case déjà occupée.
  assert.throws(
    () => store.addToken(createToken({ id: 'd', levelId: 'rdc', cell: { a: 1, b: 1 } })),
    /occup/i
  );
  assert.equal(store.getState().campaign?.tokens.length, 3, 'le pion refusé ne doit pas apparaître');

  // 2. moveTokenToCell : déplacer un pion sur la case d'un autre.
  assert.throws(() => store.moveTokenToCell('b', { a: 1, b: 1 }), /occup/i);
  assert.deepEqual(
    store.getState().campaign?.tokens.find((t) => t.id === 'b')?.cell,
    { a: 2, b: 1 },
    'un déplacement refusé ne doit pas bouger le pion'
  );

  // 3. traverseLink : l'arrivée de l'escalier est occupée par « c ».
  assert.throws(() => store.traverseLink('a', 'stairs'), /occup/i);
  assert.equal(
    store.getState().campaign?.tokens.find((t) => t.id === 'a')?.levelId,
    'rdc',
    'un franchissement refusé ne doit pas déplacer le pion'
  );

  // 4. placeTokenFromReserve : ressortir un pion rangé sur une case occupée — il reste en réserve.
  store.reserveToken('b');
  assert.throws(() => store.placeTokenFromReserve('b', 'rdc', { a: 1, b: 1 }), /occup/i);
  assert.equal(store.getReserve().length, 1, 'le pion doit être resté en réserve');

  // 5. updateToken : faire grossir « a » (1×1 → 2×2) le ferait recouvrir « b », remis sur le
  //    plateau juste pour ce dernier cas.
  assert.equal(store.placeTokenFromReserve('b', 'rdc', { a: 2, b: 1 }), true);
  assert.throws(() => store.updateToken('a', { sizeCells: 2 }), /occup|recouvr/i);
  assert.equal(
    store.getState().campaign?.tokens.find((t) => t.id === 'a')?.sizeCells,
    1,
    'une mise à jour refusée ne doit pas changer la taille'
  );
});

test('C-6 : l’emprise entière compte, pas la seule case d’ancrage — un pion 2×2 ne peut pas recouvrir un voisin 1×1 (carré)', () => {
  store.resetStore();
  const rdc = createLevel({ id: 'rdc', widthCells: 10, heightCells: 8 });
  const voisin = createToken({ id: 'voisin', levelId: 'rdc', cell: { a: 3, b: 3 }, sizeCells: 1 });
  store.loadCampaign(createCampaign({ levels: [rdc], tokens: [voisin] }));

  // L'ancre (2,2) n'est PAS occupée ; mais l'emprise 2×2 posée là couvre (2,2)(3,2)(2,3)(3,3),
  // et « voisin » est sur (3,3). Une règle qui ne regarderait que l'ancre laisserait passer.
  assert.throws(
    () =>
      store.addToken(createToken({ id: 'gros', levelId: 'rdc', cell: { a: 2, b: 2 }, sizeCells: 2 })),
    /occup/i
  );
  assert.equal(store.getState().campaign?.tokens.length, 1, 'le pion refusé ne doit pas apparaître');
});

test('C-6 : l’emprise entière compte aussi en hexagonal, où elle est une rosette', () => {
  store.resetStore();
  const cave = createLevel({
    id: 'cave',
    widthCells: 12,
    heightCells: 12,
    grid: { type: 'hex', offsetX: 0, offsetY: 0 },
  });
  const rosette = gridFor(cave).cellsOccupied({ a: 5, b: 5 }, 2);
  // Un pion 1×1 posé sur la COURONNE de la rosette, jamais son centre — c'est justement la
  // partie de l'emprise qu'une règle bornée à l'ancre laisserait passer.
  const surLaCouronne = rosette.find((c) => c.a !== 5 || c.b !== 5);
  assert.ok(surLaCouronne, 'une rosette de taille 2 doit avoir une couronne');

  const voisin = createToken({
    id: 'voisin',
    levelId: 'cave',
    cell: /** @type {any} */ (surLaCouronne),
    sizeCells: 1,
  });
  store.loadCampaign(createCampaign({ levels: [cave], tokens: [voisin] }));

  assert.throws(
    () =>
      store.addToken(createToken({ id: 'gros', levelId: 'cave', cell: { a: 5, b: 5 }, sizeCells: 2 })),
    /occup/i
  );
});

test('C-6 : une campagne enregistrée avec un empilement se charge SANS ÊTRE REFUSÉE — le plus petit identifiant reste, l’autre part en réserve, et c’est dit', () => {
  store.resetStore();
  const rdc = createLevel({ id: 'rdc', widthCells: 10, heightCells: 8 });
  // « zzz-second » est inséré EN TÊTE du tableau, exprès : si la normalisation se fiait à
  // l'ordre du tableau plutôt qu'à l'identifiant, elle garderait celui-ci et non « alpha ».
  const zzzSecond = createToken({ id: 'zzz-second', levelId: 'rdc', cell: { a: 2, b: 2 }, kind: 'pc' });
  const alpha = createToken({ id: 'alpha', levelId: 'rdc', cell: { a: 2, b: 2 }, kind: 'pc' });
  const campagneHeritee = createCampaign({ levels: [rdc], tokens: [zzzSecond, alpha] });

  /** @type {string[]} */
  const avertissements = [];
  const warnOrigine = console.warn;
  console.warn = (/** @type {any[]} */ ...args) => {
    avertissements.push(args.join(' '));
  };
  try {
    assert.doesNotThrow(
      () => store.loadCampaign(campagneHeritee),
      'refuser une campagne existante serait une régression plus chère que le défaut corrigé'
    );
  } finally {
    console.warn = warnOrigine;
  }

  const tokens = store.getState().campaign?.tokens ?? [];
  assert.deepEqual(
    tokens.map((t) => t.id),
    ['alpha'],
    'le plus petit identifiant reste sur le plateau, quel que soit l’ordre du tableau'
  );

  const reserve = store.getReserve();
  assert.deepEqual(reserve.map((t) => t.id), ['zzz-second'], 'l’autre part en réserve, pas ailleurs');

  assert.ok(
    avertissements.some((m) => m.includes('zzz-second') && m.includes('alpha')),
    `un avertissement doit nommer le pion déplacé et pourquoi. Reçu : ${JSON.stringify(avertissements)}`
  );
});

test('C-6 : getStackingNormalizationReport() tient ce que le chargement a déplacé, et se remet à zéro au chargement suivant — le `console.warn` seul est invisible pour le mainteneur', () => {
  store.resetStore();
  const rdc = createLevel({ id: 'rdc', widthCells: 10, heightCells: 8 });
  const monture = createToken({ id: 'monture', levelId: 'rdc', cell: { a: 2, b: 2 }, kind: 'pc', label: 'Monture' });
  const familier = createToken({ id: 'familier', levelId: 'rdc', cell: { a: 2, b: 2 }, kind: 'pc', label: 'Familier' });

  const avertirOriginal = console.warn;
  console.warn = () => {};
  try {
    store.loadCampaign(createCampaign({ levels: [rdc], tokens: [monture, familier] }));
  } finally {
    console.warn = avertirOriginal;
  }

  assert.deepEqual(
    store.getStackingNormalizationReport(),
    [{ id: 'monture', label: 'Monture' }],
    'le rapport nomme le pion déplacé, pas seulement son identifiant'
  );

  // Une campagne saine chargée par-dessus : l'avertissement de la précédente ne doit pas
  // survivre — sinon un rechargement sain resterait signalé à tort.
  const alpha = createToken({ id: 'alpha', levelId: 'rdc', cell: { a: 1, b: 1 }, kind: 'pc' });
  store.loadCampaign(createCampaign({ levels: [rdc], tokens: [alpha] }));

  assert.deepEqual(
    store.getStackingNormalizationReport(),
    [],
    'une campagne saine remet le rapport à zéro'
  );
});

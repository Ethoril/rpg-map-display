// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { createCampaign, createLevel, createToken, validateCampaign } from '../js/core/schema.js';
import { applyNetworkEvent } from '../js/app/networkEvents.js';
import * as store from '../js/state/store.js';

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

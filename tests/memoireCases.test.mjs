// @ts-check
/**
 * Mémoire des cases (contrat de liaison §7, révision du 24/11/2026, amendement n° 11) : la carte retient
 * la place d'un pion lié retiré par `token.remove` et l'y repose si `token.add` le ramène avec le même `ref`.
 *
 * Chaque test pose la question par l'EFFET (où est le pion après `token.add`), jamais par l'étiquette
 * (le contenu du champ de mémoire) — sauf pour l'effacement, que seul un second parcours distingue.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCampaign, createLevel, createToken, validateCampaign } from '../js/core/schema.js';
import { LINKED_PLACES_MAX } from '../js/core/constants.js';
import { planMjMessage, executeMjOperations } from '../js/app/mjLink.js';
import * as store from '../js/state/store.js';

/** @param {string} type @param {any} payload */
const msg = (type, payload) => ({ v: 3, type, seq: 1, at: 0, from: 'outil-mj', payload });

/** @param {string} ref @param {Record<string, any>} [patch] */
const etat = (ref, patch = {}) => ({
  ref, label: ref, camp: 'ennemi', kind: 'npc', visionSource: false, imageUrl: null, sizeCells: 1,
  speedCells: 4, runCells: 8, visionDim: 1, hp: { current: 8, max: 8 }, health: 'unharmed',
  markers: [], markerLevels: {}, dead: false, ...patch,
});

/** @param {string} id @param {string} ref @param {{ a: number, b: number }} cell @param {Record<string, any>} [patch] */
const pionLie = (id, ref, cell, patch = {}) => ({
  ...createToken({ id, levelId: 'rdc', cell, kind: 'npc', camp: 'ennemi' }),
  link: { source: /** @type {const} */ ('outil-mj'), ref },
  ...patch,
});

/** @param {Record<string, any>} [overrides] */
function campagne(overrides = {}) {
  const level = createLevel({ id: 'rdc', widthCells: 12, heightCells: 12 });
  return createCampaign({ levels: [level], tokens: [], ...overrides });
}

/** @param {any[]} [published] */
function lanceur(published = []) {
  let n = 0;
  const deps = {
    store,
    publish: (/** @type {string} */ type, /** @type {any} */ payload) => { published.push([type, payload]); },
    createToken,
    newTokenId: () => `neuf-${++n}`,
    trace: { levelId: 'rdc', cell: { a: 0, b: 0 } },
  };
  return (/** @type {string} */ type, /** @type {any} */ payload) =>
    executeMjOperations(planMjMessage(/** @type {any} */ (store.getCampaign()), msg(type, payload)), deps);
}

/** @param {string} ref */
const surPlateau = (ref) => store.getCampaign()?.tokens.find((t) => t.link?.ref === ref);
/** @param {string} ref */
const enReserve = (ref) => store.getCampaign()?.reserve?.find((t) => t.link?.ref === ref);

test('mémoire : retiré puis rajouté avec le même ref, le pion revient à son étage et à sa case', () => {
  store.loadCampaign(campagne({ tokens: [pionLie('g1', 'p:g1', { a: 4, b: 5 })] }));
  /** @type {any[]} */
  const published = [];
  const run = lanceur(published);
  run('token.remove', { ref: 'p:g1' });
  assert.equal(surPlateau('p:g1'), undefined);
  run('token.add', etat('p:g1'));
  const pion = surPlateau('p:g1');
  assert.ok(pion, 'le pion est reposé sur le plateau');
  assert.deepEqual([pion.levelId, pion.cell], ['rdc', { a: 4, b: 5 }]);
  assert.equal(enReserve('p:g1'), undefined, 'et non dans la réserve');
  assert.deepEqual(published.map(([t]) => t), ['token.delete', 'token.add'], 'la tablette suit : pose par token.add');
});

test('mémoire : un pion caché reste caché', () => {
  store.loadCampaign(campagne({ tokens: [pionLie('g1', 'p:g1', { a: 4, b: 5 }, { hidden: true })] }));
  const run = lanceur();
  run('token.remove', { ref: 'p:g1' });
  run('token.add', etat('p:g1'));
  assert.equal(surPlateau('p:g1')?.hidden, true);
});

test('mémoire : un pion visible reste visible', () => {
  store.loadCampaign(campagne({ tokens: [pionLie('g1', 'p:g1', { a: 4, b: 5 })] }));
  const run = lanceur();
  run('token.remove', { ref: 'p:g1' });
  run('token.add', etat('p:g1'));
  assert.equal(surPlateau('p:g1')?.hidden, false);
});

test('mémoire : le pion revient à jour de l’état reçu (PV, taille), pas figé à son départ', () => {
  store.loadCampaign(campagne({ tokens: [pionLie('g1', 'p:g1', { a: 4, b: 5 })] }));
  const run = lanceur();
  run('token.remove', { ref: 'p:g1' });
  run('token.add', etat('p:g1', { hp: { current: 3, max: 8 }, health: 'critical' }));
  assert.equal(surPlateau('p:g1')?.hp?.current, 3);
});

test('mémoire : case occupée entre-temps → réserve', () => {
  store.loadCampaign(campagne({ tokens: [pionLie('g1', 'p:g1', { a: 4, b: 5 })] }));
  const run = lanceur();
  run('token.remove', { ref: 'p:g1' });
  const apres = /** @type {any} */ (structuredClone(store.getCampaign()));
  apres.tokens.push(createToken({ id: 'intrus', levelId: 'rdc', cell: { a: 4, b: 5 } }));
  store.loadCampaign(apres);
  run('token.add', etat('p:g1'));
  assert.equal(surPlateau('p:g1'), undefined);
  assert.ok(enReserve('p:g1'), 'le pion va dans la réserve');
  assert.equal(store.getCampaign()?.tokens.find((t) => t.id === 'intrus')?.cell.a, 4, 'l’occupant n’a pas bougé');
});

test('mémoire : étage supprimé entre-temps → réserve', () => {
  const autre = createLevel({ id: 'cave', widthCells: 12, heightCells: 12 });
  store.loadCampaign(campagne({
    levels: [createLevel({ id: 'rdc', widthCells: 12, heightCells: 12 }), autre],
    tokens: [pionLie('g1', 'p:g1', { a: 4, b: 5 }, { levelId: 'cave' })],
  }));
  const run = lanceur();
  run('token.remove', { ref: 'p:g1' });
  const apres = /** @type {any} */ (structuredClone(store.getCampaign()));
  apres.levels = apres.levels.filter((/** @type {any} */ l) => l.id !== 'cave');
  store.loadCampaign(apres);
  run('token.add', etat('p:g1'));
  assert.equal(surPlateau('p:g1'), undefined);
  assert.ok(enReserve('p:g1'));
});

test('mémoire : un ref différent va dans la réserve', () => {
  store.loadCampaign(campagne({ tokens: [pionLie('g1', 'p:g1', { a: 4, b: 5 })] }));
  const run = lanceur();
  run('token.remove', { ref: 'p:g1' });
  run('token.add', etat('p:g2'));
  assert.equal(surPlateau('p:g2'), undefined);
  assert.ok(enReserve('p:g2'));
  assert.equal(surPlateau('p:g1'), undefined, 'et rien ne revient pour l’autre ref');
});

test('mémoire : un ref reposé est effacé — retiré de la réserve puis rajouté, il n’y a plus de case', () => {
  store.loadCampaign(campagne({ tokens: [pionLie('g1', 'p:g1', { a: 4, b: 5 })] }));
  const run = lanceur();
  run('token.remove', { ref: 'p:g1' });
  run('token.add', etat('p:g1'));
  // Le MJ le range puis l'outil le retire : il part de la réserve, qui ne retient aucune case.
  const id = /** @type {string} */ (surPlateau('p:g1')?.id);
  store.reserveToken(id);
  run('token.remove', { ref: 'p:g1' });
  assert.equal(enReserve('p:g1'), undefined);
  run('token.add', etat('p:g1'));
  assert.equal(surPlateau('p:g1'), undefined, 'l’ancienne case est oubliée');
  assert.ok(enReserve('p:g1'));
});

test('mémoire : un second retrait suivi d’un ajout repart de la nouvelle case', () => {
  store.loadCampaign(campagne({ tokens: [pionLie('g1', 'p:g1', { a: 4, b: 5 })] }));
  const run = lanceur();
  run('token.remove', { ref: 'p:g1' });
  run('token.add', etat('p:g1'));
  const id = /** @type {string} */ (surPlateau('p:g1')?.id);
  store.moveTokenToCell(id, { a: 8, b: 9 });
  run('token.remove', { ref: 'p:g1' });
  run('token.add', etat('p:g1'));
  assert.deepEqual(surPlateau('p:g1')?.cell, { a: 8, b: 9 });
});

test('mémoire : bornée — pleine, l’entrée la plus ancienne sort', () => {
  const total = LINKED_PLACES_MAX + 2;
  const level = createLevel({ id: 'rdc', widthCells: 30, heightCells: 30 });
  const tokens = Array.from({ length: total }, (_, i) => pionLie(`g${i}`, `p:g${i}`, { a: i % 30, b: Math.floor(i / 30) }));
  store.loadCampaign(createCampaign({ levels: [level], tokens }));
  const run = lanceur();
  for (let i = 0; i < total; i++) run('token.remove', { ref: `p:g${i}` });
  assert.equal(store.getCampaign()?.tokens.length, 0);
  run('token.add', etat('p:g0'));
  run('token.add', etat('p:g1'));
  run('token.add', etat(`p:g${total - 1}`));
  assert.ok(enReserve('p:g0') && enReserve('p:g1'), 'les deux plus anciens ont été oubliés');
  assert.deepEqual(surPlateau(`p:g${total - 1}`)?.cell, { a: (total - 1) % 30, b: Math.floor((total - 1) / 30) }, 'le plus récent est resté');
  run('token.add', etat('p:g2'));
  assert.ok(surPlateau('p:g2'), 'la première entrée conservée est la troisième');
});

test('mémoire : les PJ ne sont jamais concernés', () => {
  store.loadCampaign(campagne({ tokens: [pionLie('c1', 'pj:c1', { a: 1, b: 1 }, { kind: 'pc', camp: 'pj' })] }));
  const run = lanceur();
  run('token.remove', { ref: 'pj:c1' });
  assert.ok(surPlateau('pj:c1'), 'un PJ ne se retire pas');
  assert.ok(!store.getCampaign()?.removedLinkedPlaces?.length, 'aucune case retenue');
  // Même une mémoire forgée à la main ne reposerait pas un PJ : elle est refusée par la validation.
  const forgee = /** @type {any} */ (structuredClone(store.getCampaign()));
  forgee.removedLinkedPlaces = [{ ref: 'pj:c2', levelId: 'rdc', cell: { a: 3, b: 3 }, hidden: false }];
  assert.ok(validateCampaign(forgee).some((e) => e.includes('removedLinkedPlaces')));
});

test('mémoire : une monture fusionnée retirée avec son cavalier — le cavalier reprend sa case', () => {
  const overlay = { ref: 'p:m1', label: 'Destrier', imageUrl: null, hp: { current: 9, max: 9 }, health: 'unharmed', markers: [], markerLevels: {} };
  const cavalier = pionLie('cav', 'p:c1', { a: 6, b: 3 }, { mounted: true, sizeCells: 2, rider: overlay });
  const monture = pionLie('mon', 'p:m1', { a: 0, b: 0 });
  store.loadCampaign(campagne({ tokens: [cavalier], reserve: [monture] }));
  const run = lanceur();
  run('token.remove', { ref: 'p:c1' });
  run('token.remove', { ref: 'p:m1' });
  assert.equal(store.getCampaign()?.tokens.length, 0);
  assert.equal(store.getCampaign()?.reserve?.length, 0);
  run('token.add', etat('p:m1'));
  run('token.add', etat('p:c1', { sizeCells: 2, mounted: true, rider: overlay }));
  assert.deepEqual(surPlateau('p:c1')?.cell, { a: 6, b: 3 }, 'le cavalier reprend la case du pion fusionné');
  assert.ok(enReserve('p:m1'), 'la monture, jamais posée, attend en réserve (§8.1)');
});

test('mémoire : le snapshot qui clôt une rencontre retient aussi les cases', () => {
  store.loadCampaign(campagne({ tokens: [pionLie('g1', 'p:g1', { a: 4, b: 5 })] }));
  const run = lanceur();
  run('mj.snapshot', { tokens: [] });
  assert.equal(surPlateau('p:g1'), undefined);
  run('token.add', etat('p:g1'));
  assert.deepEqual(surPlateau('p:g1')?.cell, { a: 4, b: 5 });
});

test('mémoire : survit au JSON de l’enregistrement et au rechargement de la campagne', () => {
  store.loadCampaign(campagne({ tokens: [pionLie('g1', 'p:g1', { a: 4, b: 5 }, { hidden: true })] }));
  lanceur()('token.remove', { ref: 'p:g1' });
  const relu = JSON.parse(JSON.stringify(store.getCampaign()));
  assert.deepEqual(validateCampaign(relu), []);
  store.loadCampaign(relu);
  lanceur()('token.add', etat('p:g1'));
  assert.deepEqual(surPlateau('p:g1')?.cell, { a: 4, b: 5 });
  assert.equal(surPlateau('p:g1')?.hidden, true);
});

test('mémoire : survit à saveToLocalStorage puis loadFromLocalStorage', () => {
  store.setSessionId('memoire-cases');
  store.loadCampaign(campagne({ tokens: [pionLie('g1', 'p:g1', { a: 4, b: 5 })] }));
  lanceur()('token.remove', { ref: 'p:g1' });
  store.saveToLocalStorage('memoire-cases');
  // Autre session pendant qu'on vide la mémoire : un autosave écraserait ce que l'on veut relire.
  store.setSessionId(null);
  store.loadCampaign(campagne());
  assert.equal(store.getCampaign()?.removedLinkedPlaces, undefined, 'mémoire vidée avant la relecture');
  store.loadFromLocalStorage('memoire-cases');
  lanceur()('token.add', etat('p:g1'));
  assert.deepEqual(surPlateau('p:g1')?.cell, { a: 4, b: 5 });
});

test('mémoire : une campagne ancienne sans le champ se lit comme vide, sans être réécrite', () => {
  const ancienne = /** @type {any} */ (campagne());
  assert.equal('removedLinkedPlaces' in ancienne, false, 'la fabrique n’ajoute pas le champ');
  store.loadCampaign(ancienne);
  assert.equal('removedLinkedPlaces' in /** @type {any} */ (store.getCampaign()), false, 'chargée telle quelle');
  const run = lanceur();
  run('token.add', etat('p:g1'));
  assert.ok(enReserve('p:g1'), 'mémoire vide : réserve, comme avant');
  assert.equal('removedLinkedPlaces' in /** @type {any} */ (store.getCampaign()), false, 'un ajout n’écrit pas le champ');
});

test('schéma : removedLinkedPlaces mal formée refusée', () => {
  const base = () => /** @type {any} */ (campagne());
  const bonne = { ref: 'p:g1', levelId: 'rdc', cell: { a: 1, b: 2 }, hidden: false };
  assert.deepEqual(validateCampaign({ ...base(), removedLinkedPlaces: [bonne] }), []);
  /** @type {[string, any][]} */
  const refusees = [
    ['pas un tableau', { ...bonne }],
    ['ref vide', [{ ...bonne, ref: '' }]],
    ['ref PJ', [{ ...bonne, ref: 'pj:c1' }]],
    ['case non entière', [{ ...bonne, cell: { a: 1.5, b: 2 } }]],
    ['hidden absent', [{ ref: 'p:g1', levelId: 'rdc', cell: { a: 1, b: 2 } }]],
    ['ref en double', [bonne, bonne]],
    ['trop longue', Array.from({ length: LINKED_PLACES_MAX + 1 }, (_, i) => ({ ...bonne, ref: `p:g${i}` }))],
  ];
  for (const [nom, valeur] of refusees) {
    assert.ok(validateCampaign({ ...base(), removedLinkedPlaces: valeur }).some((e) => e.includes('removedLinkedPlaces')), nom);
  }
});

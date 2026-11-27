// @ts-check
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  planFirestoreV3Write,
  FIRESTORE_BATCH_MAX_OPERATIONS,
  FIRESTORE_V3_SCHEMA_VERSION,
  createFirestoreV3TransitionParent,
  joinSnapshotFromFirestoreV3,
  measureFirestoreSnapshot,
  nextFirestoreV3Revision,
  splitSnapshotForFirestoreV3,
} from '../js/transport/FirebaseTransport.js';

/** @param {string} id @param {number} order @returns {any} */
function level(id, order) {
  return {
    id, name: id, order, imageUrl: `maps/${id}.webp`, videoUrl: null, animatedOverlays: [],
    pxPerCell: 140, widthCells: 10, heightCells: 8,
    grid: { type: 'square', offsetX: 0, offsetY: 0, color: '#000000', opacity: 0.25, visible: true },
    terrainCost: null,
    walls: [[{ cellX: 0, cellY: 0 }, { cellX: 3, cellY: 0 }]],
    portals: [], lights: [], ambient: { level: 1, baked: false },
  };
}

/** @returns {any} */
function snapshot() {
  return {
    campaign: {
      schemaVersion: 2, campaignId: 'three-levels', name: 'Fixture trois étages',
      levels: [level('rdc', 0), level('etage', 1), level('cave', -1)],
      links: [{ id: 'stairs', kind: 'stairs', label: 'Escalier', a: { levelId: 'rdc', at: { cellX: 2, cellY: 2 } }, b: { levelId: 'etage', at: { cellX: 2, cellY: 2 } }, bidirectional: true, gmOnly: false }],
      tokens: [{ id: 'hero', levelId: 'rdc', cell: { a: 2, b: 2 }, sizeCells: 1, kind: 'pc', imageUrl: 'maps/hero.webp', borderColor: '#ffffff', label: 'Héros', hidden: false, visionBright: 5, visionDim: 10, emitsLight: null, speedCells: 6, playerMovable: true, locked: false, elevation: 0, markers: [], hp: null, health: 'unharmed' }],
      templates: [{ id: 'template', levelId: 'cave', shape: 'circle', origin: { x: 280, y: 280 }, radiusCells: 2, directionDeg: 0, widthCells: 1, color: '#ff0000', visibleToPlayers: true }],
      settings: {},
    },
    activeLevelId: 'rdc', selectedTokenId: 'hero',
  };
}

test('v3 répartit puis reconstitue trois étages sans relire les sous-documents obsolètes', () => {
  const source = snapshot();
  const v3 = splitSnapshotForFirestoreV3(source, 'session-three', 42);
  assert.equal(v3.parent.schemaVersion, FIRESTORE_V3_SCHEMA_VERSION);
  assert.deepEqual(v3.parent.levelIds, ['rdc', 'etage', 'cave']);
  assert.deepEqual(v3.parent.tokenIds, ['hero']);
  assert.equal('levels' in v3.parent, false);
  assert.equal('tokens' in v3.parent, false);
  assert.deepEqual(v3.levels[0].data.level.walls, [{ points: [{ cellX: 0, cellY: 0 }, { cellX: 3, cellY: 0 }] }]);

  const restored = joinSnapshotFromFirestoreV3(
    v3.parent,
    [...v3.levels, { id: 'obsolete-level', data: level('obsolete-level', 99) }],
    [...v3.tokens, { id: 'obsolete-token', data: { id: 'obsolete-token' } }],
    v3.state
  );
  assert.deepEqual(restored.campaign.levels.map((/** @type {any} */ item) => item.id), ['rdc', 'etage', 'cave']);
  assert.deepEqual(restored.campaign.tokens.map((/** @type {any} */ item) => item.id), ['hero']);
  assert.deepEqual(restored.campaign.templates, source.campaign.templates);
});

test('la transition conserve le secours v2 jusqu au nettoyage de la revision relue', () => {
  const source = snapshot();
  const legacyV2 = { schemaVersion: 2, campaign: source.campaign };
  const v3 = splitSnapshotForFirestoreV3(source, 'session-three', 99);
  const transition = createFirestoreV3TransitionParent(legacyV2, v3.parent);

  assert.equal(transition.schemaVersion, FIRESTORE_V3_SCHEMA_VERSION);
  assert.equal(transition.revision, 99);
  assert.equal(transition.migration.legacyV2CleanupPending, true);
  assert.strictEqual(transition.campaign, source.campaign);
  assert.deepEqual(joinSnapshotFromFirestoreV3(transition, v3.levels, v3.tokens, v3.state), source);
});

test('une migration concurrente rebase sa revision et conserve le secours v2 du parent courant', () => {
  const source = snapshot();
  const legacyV2 = { schemaVersion: 2, campaign: source.campaign };
  const first = splitSnapshotForFirestoreV3(source, 'session-three', nextFirestoreV3Revision(legacyV2));
  const parentAfterFirst = createFirestoreV3TransitionParent(legacyV2, first.parent);
  const second = splitSnapshotForFirestoreV3(source, 'session-three', nextFirestoreV3Revision(parentAfterFirst));
  const parentAfterRetry = createFirestoreV3TransitionParent(parentAfterFirst, second.parent);

  assert.equal(first.parent.revision, 1);
  assert.equal(second.parent.revision, 2);
  assert.strictEqual(parentAfterRetry.campaign, source.campaign);
  assert.equal(parentAfterRetry.migration.revision, 2);
});

test('v3 échoue explicitement sur parent corrompu ou sous-document référencé manquant', () => {
  const v3 = splitSnapshotForFirestoreV3(snapshot(), 'session-three', 1);
  assert.throws(
    () => joinSnapshotFromFirestoreV3({ ...v3.parent, levelIds: ['rdc', 4] }, v3.levels, v3.tokens, v3.state),
    /corrompu/
  );
  assert.throws(
    () => joinSnapshotFromFirestoreV3(v3.parent, v3.levels.filter((item) => item.id !== 'cave'), v3.tokens, v3.state),
    /incomplet.*étage/
  );
  assert.throws(
    () => joinSnapshotFromFirestoreV3(v3.parent, v3.levels, [], v3.state),
    /incomplet.*pion/
  );
});

test('v3 refuse un batch dépassant 500 opérations avant toute écriture SDK', () => {
  const tooMany = snapshot();
  tooMany.campaign.tokens = Array.from({ length: FIRESTORE_BATCH_MAX_OPERATIONS }, (_, i) => ({ id: `token-${i}` }));
  assert.throws(() => splitSnapshotForFirestoreV3(tooMany, 'overflow'), /dépassent la limite de lot/);
});

test('la fixture synthétique à trois étages est transportable sans assets réels', () => {
  const fixturePath = fileURLToPath(new URL('../fixtures/three-level-transport-v3.json', import.meta.url));
  /** @type {any} */
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const v3 = splitSnapshotForFirestoreV3(fixture, 'fixture-three-levels', 7);
  assert.deepEqual(v3.parent.levelIds, ['cave', 'rdc', 'etage']);
  const ground = v3.levels.find((entry) => entry.id === 'rdc');
  assert.ok(ground);
  assert.equal(ground.data.level.portals[0].locked, true);
  // La fixture, figée, porte encore `activeHandout` : C-13 l'a retiré, il ne fait plus l'aller-retour.
  const { activeHandout: _retire, ...attendu } = fixture;
  assert.deepEqual(joinSnapshotFromFirestoreV3(v3.parent, v3.levels, v3.tokens, v3.state), attendu);
});

test('replay transport : teleport, suivi, selection et verrou restent independants par etage', () => {
  const fixturePath = fileURLToPath(new URL('../fixtures/three-level-transport-v3.json', import.meta.url));
  /** @type {any} */
  const campaign = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  // Le lien est le declencheur du teleport ; le transport ne calcule pas l interaction UI.
  campaign.campaign.tokens[0].levelId = campaign.campaign.links[0].b.levelId;
  campaign.activeLevelId = 'etage'; // suivi camera/selection apres teleport
  const v3 = splitSnapshotForFirestoreV3(campaign, 'replay-three-levels', 12);
  const replayed = joinSnapshotFromFirestoreV3(v3.parent, v3.levels, v3.tokens, v3.state);

  assert.equal(replayed.campaign.tokens[0].levelId, 'etage');
  assert.equal(replayed.activeLevelId, 'etage');
  assert.equal(replayed.selectedTokenId, 'hero');
  assert.equal(replayed.campaign.levels.find((/** @type {any} */ item) => item.id === 'rdc').portals[0].locked, true);
  assert.equal('fog' in v3.state, false);
});

test('v3 accepte une campagne globale trop grande si chaque document réparti reste sous le plafond', () => {
  const source = snapshot();
  source.campaign.levels = ['rdc', 'etage', 'cave'].map((id, order) => ({
    ...level(id, order),
    notes: 'x'.repeat(360_000),
  }));
  assert.equal(measureFirestoreSnapshot(source, 'single-doc').severity, 'error');
  assert.doesNotThrow(() => splitSnapshotForFirestoreV3(source, 'distributed', 8));
});

test('v3 refuse de joindre des sous-documents d une autre révision', () => {
  const v3 = splitSnapshotForFirestoreV3(snapshot(), 'session-three', 10);
  const newer = splitSnapshotForFirestoreV3(snapshot(), 'session-three', 11);
  assert.throws(
    () => joinSnapshotFromFirestoreV3(v3.parent, newer.levels, v3.tokens, v3.state),
    /incomplet.*étage/
  );
  assert.throws(
    () => joinSnapshotFromFirestoreV3(v3.parent, v3.levels, v3.tokens, newer.state),
    /incohérent/
  );
});

test('la révision v3 est monotone depuis le parent transactionnel, jamais dérivée de l horloge', () => {
  assert.equal(nextFirestoreV3Revision(null), 1);
  assert.equal(nextFirestoreV3Revision({ schemaVersion: 2 }), 1);
  assert.equal(nextFirestoreV3Revision({ schemaVersion: FIRESTORE_V3_SCHEMA_VERSION, revision: 41 }), 42);
  assert.throws(
    () => nextFirestoreV3Revision({ schemaVersion: FIRESTORE_V3_SCHEMA_VERSION, revision: 1.5 }),
    /révision entière/
  );
});

// C7 (audit du 22/09/2026 ; amendement ADR-012 du 23/09, D-10) — chaque sauvegarde réécrivait
// TOUS les documents. Seuls les documents modifiés le sont désormais ; le parent annonce la
// révision de chacun, et la garde d'incohérence reste entière.
test('C7 : seuls les documents modifiés sont réécrits, et la lecture reste cohérente', () => {
  const campagne = (/** @type {number} */ caseDuHeros) => ({
    campaign: {
      campaignId: 'c7', name: 'C7', links: [], settings: {}, templates: [],
      levels: [{ id: 'rdc', walls: [] }, { id: 'cave', walls: [] }],
      tokens: [
        { id: 'heros', levelId: 'rdc', cell: { a: caseDuHeros, b: 0 } },
        { id: 'garde', levelId: 'rdc', cell: { a: 9, b: 9 } },
      ],
    },
    activeLevelId: 'rdc', selectedTokenId: null, activeHandout: null,
  });

  // Première sauvegarde : aucun parent précédent, tout s'écrit.
  const v1 = splitSnapshotForFirestoreV3(campagne(1), 'c7', 1);
  const plan1 = planFirestoreV3Write(null, v1);
  assert.equal(plan1.levels.length, 2);
  assert.equal(plan1.tokens.length, 2);

  // Seconde sauvegarde : le héros a bougé, rien d'autre.
  const v2 = splitSnapshotForFirestoreV3(campagne(2), 'c7', 2);
  const plan2 = planFirestoreV3Write(plan1.parent, v2);
  assert.deepEqual(plan2.levels, [], 'aucun étage réécrit');
  assert.deepEqual(plan2.tokens.map((t) => t.id), ['heros'], 'seul le pion déplacé est réécrit');
  assert.equal(plan2.parent.tokenRevisions.garde, 1, 'le pion inchangé garde sa révision');
  assert.equal(plan2.parent.tokenRevisions.heros, 2);

  // La base contient maintenant : étages et garde en révision 1, héros en révision 2.
  const base = {
    levels: plan1.levels,
    tokens: /** @type {Array<{id: string, data: any}>} */ ([plan1.tokens.find((t) => t.id === 'garde'), plan2.tokens[0]]),
  };
  const lu = joinSnapshotFromFirestoreV3(plan2.parent, base.levels, base.tokens, v2.state);
  assert.equal(lu.campaign.tokens.find((/** @type {any} */ t) => t.id === 'heros').cell.a, 2);
  assert.equal(lu.campaign.levels.length, 2);

  // ⛔ La garde reste entière : un document d'une autre révision que celle annoncée est refusé.
  const perime = /** @type {Array<{id: string, data: any}>} */ ([plan1.tokens.find((t) => t.id === 'garde'), plan1.tokens.find((t) => t.id === 'heros')]);
  assert.throws(() => joinSnapshotFromFirestoreV3(plan2.parent, base.levels, perime, v2.state), /incomplet/);
});

test('C7 : un parent d’avant l’amendement (sans tables) se relit, et fait tout réécrire une fois', () => {
  const snap = {
    campaign: { campaignId: 'x', name: 'x', links: [], settings: {}, templates: [],
      levels: [{ id: 'rdc', walls: [] }], tokens: [{ id: 't', levelId: 'rdc', cell: { a: 0, b: 0 } }] },
    activeLevelId: 'rdc', selectedTokenId: null, activeHandout: null,
  };
  const ancien = splitSnapshotForFirestoreV3(snap, 'x', 5);
  // Lecture d'une sauvegarde d'avant le 23/09 : pas de tables, tout porte la révision du parent.
  const lu = joinSnapshotFromFirestoreV3(ancien.parent, ancien.levels, ancien.tokens, ancien.state);
  assert.equal(lu.campaign.tokens.length, 1);
  const suivant = splitSnapshotForFirestoreV3(snap, 'x', 6);
  const plan = planFirestoreV3Write(ancien.parent, suivant);
  assert.equal(plan.levels.length + plan.tokens.length, 2, 'sans empreintes précédentes, tout est réécrit');
});

test('C-15 — numéros d’exemplaire et compteur de campagne survivent à l’aller-retour Firestore v3', async () => {
  // ⚠ Le trou qui avait avalé la bibliothèque de handouts : un champ de campagne que le découpage
  // v3 n'écrit pas disparaît au premier F5 du MJ, sans erreur. Ce test le ferme pour C-15.
  const schema = await import('../js/core/schema.js');
  const campaign = schema.createCampaign({
    campaignId: 'c15',
    name: 'C15',
    levels: [schema.createLevel({ id: 'l1', name: 'N' })],
    tokens: [schema.createToken({ id: 'a', levelId: 'l1', libraryId: 'gob', copyNumber: 2, label: 'Gob 2' })],
    settings: { copyCounters: { gob: 3 } },
  });
  const v3 = splitSnapshotForFirestoreV3({ campaign, activeLevelId: 'l1' }, 's1', 5);
  const relu = joinSnapshotFromFirestoreV3(
    v3.parent,
    v3.levels.map((/** @type {any} */ e) => ({ id: e.id, data: e.data })),
    v3.tokens.map((/** @type {any} */ e) => ({ id: e.id, data: e.data })),
    v3.state
  );
  assert.equal(relu.campaign.tokens[0].libraryId, 'gob');
  assert.equal(relu.campaign.tokens[0].copyNumber, 2);
  assert.deepEqual(relu.campaign.settings, { copyCounters: { gob: 3 } });
});

test('D-11 — le décalage du réseau hexagonal survit à l’aller-retour Firestore v3, et la validation le borne', async () => {
  // Même trou que C-15 : un champ que le découpage v3 n'écrirait pas disparaîtrait au premier F5 du
  // MJ — et les hexagones reviendraient sur les murs.
  const schema = await import('../js/core/schema.js');
  const campaign = schema.createCampaign({
    campaignId: 'd11',
    name: 'D11',
    levels: [schema.createLevel({ id: 'l1', name: 'N', grid: { type: 'hex', hexShiftX: -35 } })],
  });
  assert.deepEqual(schema.validateCampaign(campaign), []);
  const v3 = splitSnapshotForFirestoreV3({ campaign, activeLevelId: 'l1' }, 's1', 5);
  const relu = joinSnapshotFromFirestoreV3(
    v3.parent,
    v3.levels.map((/** @type {any} */ e) => ({ id: e.id, data: e.data })),
    v3.tokens.map((/** @type {any} */ e) => ({ id: e.id, data: e.data })),
    v3.state
  );
  assert.equal(relu.campaign.levels[0].grid.hexShiftX, -35);
  // Et le repli LocalStorage, qui est du JSON.
  assert.equal(JSON.parse(JSON.stringify(campaign)).levels[0].grid.hexShiftX, -35);

  for (const invalide of [Number.NaN, Infinity, '-35']) {
    const fausse = structuredClone(campaign);
    fausse.levels[0].grid.hexShiftX = /** @type {any} */ (invalide);
    assert.notDeepEqual(schema.validateCampaign(fausse), [], `hexShiftX ${String(invalide)} accepté`);
  }
});

// ── H-1 : la réserve et la mémoire des cases doivent survivre à l'aller-retour v3 ──────────
//
// ⛔ TROISIÈME occurrence du même trou, après C-15 et D-11 ci-dessus : `splitSnapshotForFirestoreV3`
// et `joinSnapshotFromFirestoreV3` énumèrent les champs un par un, donc tout champ ajouté à
// `Campaign` disparaît au premier aller-retour tant que personne n'a pensé à l'inscrire aux deux
// endroits. Ici ce sont `campaign.reserve` et `campaign.removedLinkedPlaces` (livrée le 24/11).
// Au démarrage en ligne l'instantané serveur prime et s'enregistre localement : le garde mis en
// réserve avant la séance disparaît sans un mot.
//
// ⛔ Les deux tests portent sur le CONTENU relu, pas sur la présence d'une clé : une campagne
// rendue avec `reserve: []` les fait rougir autant qu'une campagne sans `reserve`.

/** @returns {any} Un garde en réserve, hors plateau, blessé — tel que le MJ le prépare. */
function gardeEnReserve() {
  return {
    id: 'garde-reserve', levelId: 'rdc', cell: { a: 3, b: 4 }, sizeCells: 1, kind: 'npc',
    imageUrl: 'maps/garde.webp', borderColor: '#b91c1c', label: 'Garde blessé', hidden: false,
    visionBright: 4, visionDim: 8, emitsLight: null, speedCells: 4, playerMovable: false,
    locked: false, elevation: 0, markers: [], hp: { current: 7, max: 12 }, health: 'wounded',
  };
}

/** @returns {any} Une place retenue pour un pion lié retiré du plateau. */
function placeRetenue() {
  return { ref: 'pnj/garde-1', levelId: 'rdc', cell: { a: 5, b: 6 }, hidden: true };
}

test('H-1 — la réserve et la mémoire des cases survivent à un aller-retour Firestore v3', async () => {
  const schema = await import('../js/core/schema.js');
  const avant = snapshot();
  avant.campaign.reserve = [gardeEnReserve()];
  avant.campaign.removedLinkedPlaces = [placeRetenue()];
  assert.deepEqual(schema.validateCampaign(avant.campaign), [], 'la fixture doit être valide');

  // ⛔ Le `move` transitoire doit tomber, comme pour un pion du plateau. `store.js` le retire à la
  // mise en réserve parce qu'un pion rangé puis reposé ailleurs se redessinait sur son ANCIENNE
  // case, par-dessus sa monture (trace du MJ, 18/11/2026) ; le transport ne doit pas le ressusciter.
  avant.campaign.reserve[0].move = { from: { a: 3, b: 4 }, to: { a: 9, b: 9 }, startedAt: 1 };

  const v3 = splitSnapshotForFirestoreV3(avant, 'session-h1', 4242);
  assert.equal(
    'move' in v3.state.reserve[0],
    false,
    'le `move` transitoire d’un pion de réserve ne doit pas être écrit dans Firestore'
  );
  const apres = joinSnapshotFromFirestoreV3(v3.parent, v3.levels, v3.tokens, v3.state);

  assert.deepEqual(
    apres.campaign.reserve,
    [gardeEnReserve()],
    'le pion mis en réserve par le MJ ne survit pas à l’aller-retour v3'
  );
  assert.deepEqual(
    apres.campaign.removedLinkedPlaces,
    [placeRetenue()],
    'la mémoire des cases des pions retirés ne survit pas à l’aller-retour v3'
  );
  assert.deepEqual(schema.validateCampaign(apres.campaign), []);
});

test('H-1 — une campagne écrite avant le correctif se relit, lue comme vide et jamais refusée', async () => {
  const schema = await import('../js/core/schema.js');
  const avant = snapshot();
  avant.campaign.reserve = [gardeEnReserve()];
  avant.campaign.removedLinkedPlaces = [placeRetenue()];

  const v3 = splitSnapshotForFirestoreV3(avant, 'session-h1-ancienne', 777);
  // Un `state/current` d'avant le correctif : révision et gabarits, rien d'autre.
  const stateAncien = { revision: v3.state.revision, templates: v3.state.templates };
  const apres = joinSnapshotFromFirestoreV3(v3.parent, v3.levels, v3.tokens, stateAncien);

  assert.deepEqual(apres.campaign.reserve ?? [], [], 'une réserve absente doit se lire vide');
  assert.deepEqual(
    apres.campaign.removedLinkedPlaces ?? [],
    [],
    'une mémoire des cases absente doit se lire vide'
  );
  assert.deepEqual(
    schema.validateCampaign(apres.campaign),
    [],
    'une campagne ancienne doit rester valide après relecture'
  );
});

// ── Garde structurel : aucun champ de `Campaign` ne peut être oublié par l'aller-retour v3 ──
//
// ⛔ Les trois tests ci-dessus — C-15, D-11, H-1 — sont le MÊME défaut relevé trois fois :
// `splitSnapshotForFirestoreV3` et `joinSnapshotFromFirestoreV3` énumèrent les champs de la
// campagne à la main, chacune de son côté, et un champ ajouté au modèle sans être inscrit aux deux
// endroits disparaît en silence au premier aller-retour. Le mode de panne est le pire possible :
// tout marche en local, le travail se perd au premier démarrage en ligne, sans une erreur.
//
// Ce test ferme la CLASSE, pas une quatrième occurrence. Son point d'accroche est le typedef
// `Campaign` de `js/core/types.js`, et non `createCampaign` : `removedLinkedPlaces` n'a **pas** de
// valeur par défaut dans la fabrique, donc un garde accroché à `Object.keys(createCampaign())`
// aurait laissé passer la moitié de H-1. Le typedef, lui, est incontournable — le dépôt est en
// `// @ts-check` strict, et lire ou écrire un champ non déclaré échoue au typecheck.

/**
 * Relève les propriétés déclarées par un typedef `{Object}` de `js/core/types.js`.
 *
 * Le type est sauté par comptage d'accolades plutôt que par expression régulière : un futur
 * `{Record<string, {a: number}>}` ne doit pas faire manquer silencieusement un champ — un garde
 * qui s'aveugle vaut moins que pas de garde.
 *
 * @param {string} nom
 * @returns {string[]}
 */
function proprietesDuTypedef(nom) {
  const chemin = fileURLToPath(new URL('../js/core/types.js', import.meta.url));
  const source = fs.readFileSync(chemin, 'utf8').replace(/\r\n/g, '\n');
  // ⚠ L'ancre porte le saut de ligne : sans lui, `Campaign` se trouve d'abord dans
  // `CampaignSettings`, déclaré juste au-dessus, et on relèverait les champs du voisin.
  const debut = source.indexOf(`@typedef {Object} ${nom}\n`);
  assert.ok(debut >= 0, `typedef ${nom} introuvable dans js/core/types.js`);
  const fin = source.indexOf('*/', debut);
  assert.ok(fin > debut, `bloc de commentaire du typedef ${nom} non terminé`);

  /** @type {string[]} */
  const releves = [];
  for (const ligne of source.slice(debut, fin).split('\n')) {
    const amorce = /^\s*\*\s*@property\s*\{/.exec(ligne);
    if (!amorce) continue;
    let i = amorce[0].length - 1;
    let profondeur = 0;
    for (; i < ligne.length; i += 1) {
      if (ligne[i] === '{') profondeur += 1;
      else if (ligne[i] === '}') {
        profondeur -= 1;
        if (profondeur === 0) { i += 1; break; }
      }
    }
    const identifiant = /^\[?([A-Za-z0-9_$]+)/.exec(ligne.slice(i).trim());
    assert.ok(identifiant, `propriété illisible dans le typedef ${nom} : ${ligne.trim()}`);
    releves.push(identifiant[1]);
  }
  return releves;
}

test('garde structurel — tout champ de `Campaign` est éprouvé par l’aller-retour Firestore v3', async () => {
  const schema = await import('../js/core/schema.js');

  const niveaux = [
    schema.createLevel({ id: 'garde-rdc', name: 'Rez témoin' }),
    schema.createLevel({ id: 'garde-etage', name: 'Étage témoin' }),
  ];

  // Une valeur DISTINCTIVE par champ : un champ perdu ne doit pas pouvoir coïncider par hasard
  // avec ce que la relecture fabrique par défaut (`[]`, `{}`, `null`).
  /** @type {Record<string, { valeur?: any, constante?: string }>} */
  const champsEprouves = {
    // La jointure réécrit `schemaVersion` en littéral `2` : le trou énuméré ne peut pas le perdre,
    // et aucune valeur distinctive n'est possible. Exemption assumée, et la seule.
    schemaVersion: { constante: 'réécrit en littéral par joinSnapshotFromFirestoreV3' },
    campaignId: { valeur: 'garde-structurel-v3' },
    name: { valeur: 'Campagne témoin du garde structurel' },
    levels: { valeur: niveaux },
    links: {
      valeur: [{
        id: 'garde-escalier', kind: 'stairs', label: 'Escalier témoin',
        a: { levelId: 'garde-rdc', at: { cellX: 1, cellY: 1 } },
        b: { levelId: 'garde-etage', at: { cellX: 1, cellY: 1 } },
        bidirectional: true, gmOnly: false,
      }],
    },
    tokens: {
      valeur: [schema.createToken({
        id: 'garde-pion', levelId: 'garde-rdc', cell: { a: 2, b: 2 }, label: 'Pion témoin',
      })],
    },
    reserve: {
      valeur: [schema.createToken({
        id: 'garde-reserve', levelId: 'garde-rdc', cell: { a: 3, b: 4 }, kind: 'npc',
        label: 'Réserve témoin',
      })],
    },
    removedLinkedPlaces: {
      valeur: [{ ref: 'pnj/garde-temoin', levelId: 'garde-etage', cell: { a: 5, b: 6 }, hidden: true }],
    },
    templates: {
      valeur: [{
        id: 'garde-gabarit', levelId: 'garde-etage', shape: 'circle',
        origin: { x: 140, y: 140 }, radiusCells: 3, directionDeg: 0, widthCells: 1,
        color: '#2563eb', visibleToPlayers: true,
      }],
    },
    settings: { valeur: { copyCounters: { 'garde-temoin': 9 } } },
  };

  // ⛔ Le cœur du garde, dans les DEUX sens : un champ ajouté au typedef sans être inscrit ici fait
  // rougir ce test, et un champ retiré du typedef mais laissé ici le fait rougir aussi. Personne ne
  // peut donc ajouter un champ de campagne sans se poser la question de l'aller-retour v3.
  const declarees = proprietesDuTypedef('Campaign');
  // Et le relevé lui-même doit mordre : un parseur qui rendrait une liste vide rendrait la
  // comparaison ci-dessous verte à vide. Ces trois champs ne disparaîtront pas du modèle.
  for (const ancre of ['levels', 'tokens', 'settings']) {
    assert.ok(declarees.includes(ancre), `relevé du typedef Campaign cassé : ${ancre} manquant`);
  }
  assert.deepEqual(
    [...declarees].sort(),
    Object.keys(champsEprouves).sort(),
    'un champ de `Campaign` n’est pas éprouvé par l’aller-retour v3 — l’inscrire au découpage, à la '
      + 'jointure ET dans `champsEprouves` ci-dessus (ou y documenter pourquoi il en est exempté)'
  );

  /** @type {any} */
  const campagne = { schemaVersion: 2 };
  for (const [champ, cas] of Object.entries(champsEprouves)) {
    if (cas.valeur !== undefined) campagne[champ] = cas.valeur;
  }
  assert.deepEqual(
    schema.validateCampaign(campagne),
    [],
    'la campagne témoin du garde doit être valide, sinon le garde ne prouve rien'
  );

  const v3 = splitSnapshotForFirestoreV3({ campaign: campagne, activeLevelId: 'garde-rdc' }, 'garde-v3', 7);
  const relu = joinSnapshotFromFirestoreV3(
    v3.parent,
    v3.levels.map((/** @type {any} */ e) => ({ id: e.id, data: e.data })),
    v3.tokens.map((/** @type {any} */ e) => ({ id: e.id, data: e.data })),
    v3.state
  );

  /** @type {Record<string, any>} */
  const reluCampagne = relu.campaign;
  for (const [champ, cas] of Object.entries(champsEprouves)) {
    if (cas.constante) continue;
    assert.deepEqual(
      reluCampagne[champ],
      campagne[champ],
      `champ \`${champ}\` perdu ou altéré par l’aller-retour Firestore v3`
    );
  }
  assert.deepEqual(
    schema.validateCampaign(relu.campaign),
    [],
    'la campagne relue doit rester valide'
  );
});

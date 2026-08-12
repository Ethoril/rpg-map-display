// @ts-check
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ColdDecodeTrial,
  COLD_IDLE_MINIMUM_MS,
  COLD_DRAW_BUDGET_MS,
  EnduranceJournal,
  resumeDecodageFroid,
} from '../js/app/endurance.js';

test('R2-03 : le test de décodage attend deux minutes sans programmer d’activité', async () => {
  let now = 0;
  let decodes = 0;
  const image = { src: '', async decode() { decodes++; } };
  const trial = new ColdDecodeTrial({ now: () => now, imageFactory: () => /** @type {any} */ (image) });

  await trial.arm('maps/generated/test.webp');
  assert.equal(decodes, 1, 'une chauffe initiale explicite');
  assert.equal(trial.remainingMs(), COLD_IDLE_MINIMUM_MS);
  now = COLD_IDLE_MINIMUM_MS - 1;
  await assert.rejects(trial.measure(), /Inactivité insuffisante/);
  assert.equal(decodes, 1, 'pas de second decode avant le délai');

  now = COLD_IDLE_MINIMUM_MS + 42;
  const result = await trial.measure();
  assert.equal(result.idleMs, COLD_IDLE_MINIMUM_MS + 42);
  assert.equal(decodes, 2);
  await assert.rejects(trial.measure(), /Armer le test/, 'une mesure exige un nouvel armement');
});

test('R2-05/R2-06 : le journal n’échantillonne que les constats manuels', () => {
  let now = 0;
  const journal = new EnduranceJournal({ now: () => now });
  journal.start();
  now = 45 * 60_000;
  const row = journal.record({
    fps: 30,
    temperature: 'dos chaud, pas de coupure',
    wakeLock: 'observed',
    fullscreen: 'observed',
    cast: 'observed',
    resumed: 'not-checked',
    notes: 'animation de déplacement lisible',
  });
  assert.equal(row.elapsedMs, 45 * 60_000);
  assert.match(journal.toText(), /45\.0 min/);
  assert.match(journal.toText(), /température dos chaud/);
  assert.throws(() => journal.record({ fps: -1 }), /fps/);
  assert.throws(() => journal.record({ cast: /** @type {any} */ ('active') }), /invalide/);
});

test('R2-03 : takeArmedImage rend l’image sans appeler decode() et consomme l’armement', async () => {
  let now = 0;
  let decodes = 0;
  const image = { src: '', async decode() { decodes++; } };
  const trial = new ColdDecodeTrial({ now: () => now, imageFactory: () => /** @type {any} */ (image) });

  await trial.arm('maps/generated/test.webp');
  assert.equal(decodes, 1, 'une chauffe initiale explicite');

  now = COLD_IDLE_MINIMUM_MS - 1;
  assert.throws(() => trial.takeArmedImage(), /Inactivité insuffisante/);
  assert.equal(decodes, 1, 'pas de decode supplementaire');

  now = COLD_IDLE_MINIMUM_MS + 100;
  const result = trial.takeArmedImage();
  assert.equal(result.image, /** @type {any} */ (image));
  assert.equal(result.idleMs, COLD_IDLE_MINIMUM_MS + 100);
  assert.equal(decodes, 1, 'takeArmedImage n’a PAS appelé decode() une seconde fois');

  assert.throws(() => trial.takeArmedImage(), /Armer le test/, 'deux appels d’affilée échouent au second');
});

test('R2-03 : le coût net retranche la relecture, et cette soustraction décide du verdict', () => {
  // ⭐ Le cas qui compte : **la soustraction fait basculer le verdict**. 6,4 ms de brut sont
  // au-dessus du seuil de 5 ms, 2,1 ms de relecture ramènent le net à 4,3 ms, donc en dessous.
  // Retirer la soustraction dans `resumeDecodageFroid` fait rougir ces trois assertions à la fois.
  // ⛔ Le seuil est épinglé sur le **littéral** 5, pas sur la constante importée : comparer
  // `bascule.seuilMs` à `COLD_DRAW_BUDGET_MS` serait une tautologie, et porter la constante à 7
  // laissait tout vert — alors que 6,4 ms passerait alors sous le seuil de lui-même et que le cas
  // de bascule cesserait d'en être un.
  assert.equal(COLD_DRAW_BUDGET_MS, 5, 'le seuil du critère R2-03 est de 5 ms');
  assert.ok(6.4 >= COLD_DRAW_BUDGET_MS, 'le cas ci-dessous n’est une bascule que si le brut dépasse le seuil');

  const bascule = resumeDecodageFroid(6.4, 2.1);
  assert.equal(Math.round(bascule.netMs * 10) / 10, 4.3, 'le net est bien le brut moins la relecture');
  assert.equal(bascule.tenu, true, 'le verdict porte sur le net, pas sur le brut');
  assert.equal(bascule.seuilMs, 5);

  // La frontière exacte : à net === seuil, le critère n'est pas tenu (comparaison stricte).
  assert.equal(resumeDecodageFroid(7, 2).netMs, 5);
  assert.equal(resumeDecodageFroid(7, 2).tenu, false, 'net === seuil ne tient pas le critère');
  assert.match(bascule.verdict, /OUI — critère R2-03 tenu/, 'la phrase affichée suit le net');
  assert.doesNotMatch(bascule.verdict, /PAS tenu/);

  // Et l'autre sens : un brut réellement au-dessus du seuil ne doit pas être blanchi par une
  // relecture insignifiante. Sinon le critère serait tenu par construction.
  const depasse = resumeDecodageFroid(490, 0.4);
  assert.equal(Math.round(depasse.netMs * 10) / 10, 489.6);
  assert.equal(depasse.tenu, false, 'les 490 ms du chantier N restent un dépassement');
  assert.match(depasse.verdict, /n'est PAS tenu/);
  assert.match(depasse.verdict, /489\.6 ms/, 'la phrase cite le net, pas le brut');

  // Une relecture plus chère que le tracé ne rend pas un temps négatif.
  assert.equal(resumeDecodageFroid(0.3, 1.2).netMs, 0);

  // Une mesure absente ou absurde ne se transforme pas en verdict favorable.
  assert.throws(() => resumeDecodageFroid(NaN, 1), /durées finies/);
  assert.throws(() => resumeDecodageFroid(1, Number.POSITIVE_INFINITY), /durées finies/);
  assert.throws(() => resumeDecodageFroid(-1, 0), /négative/);
  // Les deux arguments, pas seulement le premier : une relecture négative **gonflerait** le net
  // et pousserait le verdict du mauvais côté. Ne garder que `brutMs < 0` laissait ce sens ouvert.
  assert.throws(() => resumeDecodageFroid(1, -1), /négative/);
});


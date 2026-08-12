// @ts-check
import assert from 'node:assert/strict';
import test from 'node:test';

import { ColdDecodeTrial, COLD_IDLE_MINIMUM_MS, EnduranceJournal } from '../js/app/endurance.js';

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


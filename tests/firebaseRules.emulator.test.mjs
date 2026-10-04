// @ts-check

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import { get, goOffline, goOnline, onValue, ref, set } from 'firebase/database';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { FirebaseTransport } from '../js/transport/FirebaseTransport.js';

const enabled = Boolean(
  process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_DATABASE_EMULATOR_HOST
);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ⛔ En CI, des émulateurs absents sont une PANNE (audit du 22/09, D8) : si les variables
// `*_EMULATOR_HOST` changent de nom, l'étape `test:firebase-rules` passait avec zéro test exécuté.
// Seulement dans l'étape qui LANCE les émulateurs : ce fichier tourne aussi dans `test:unit`,
// sans eux, où ses tests doivent rester sautés.
const etapeEmulateurs = process.env.npm_lifecycle_event === 'test:firebase-rules';
test('CI : les émulateurs Firebase sont joignables', { skip: !process.env.CI || !etapeEmulateurs }, () => {
  assert.ok(enabled, 'FIRESTORE_EMULATOR_HOST et FIREBASE_DATABASE_EMULATOR_HOST requis en CI');
});

test('émulateurs : les règles autorisent seulement les deux identités et les chemins prévus', { skip: !enabled }, async () => {
  const environment = await initializeTestEnvironment({
    projectId: 'demo-rpg-map-display-rules',
    firestore: { rules: fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8') },
    database: { rules: fs.readFileSync(path.join(root, 'database.rules.json'), 'utf8') },
  });

  try {
    const anonymous = environment.unauthenticatedContext();
    const outsider = environment.authenticatedContext('outsider', {
      email: 'intrus@example.test',
      email_verified: true,
    });
    const mainUnverified = environment.authenticatedContext('main-unverified', {
      email: 'ethoril@gmail.com',
      email_verified: false,
    });
    const main = environment.authenticatedContext('main', {
      email: 'ethoril@gmail.com',
      email_verified: true,
    });
    // Ce compte E-mail/Mot de passe est volontairement admis sans vérification : voir ETAT.md.
    const technical = environment.authenticatedContext('technical', {
      email: 'et.horil@gmail.com',
      email_verified: false,
    });

    for (const context of [anonymous, outsider, mainUnverified]) {
      await assertFails(getDoc(doc(context.firestore(), 'campaigns', 'refus')));
      await assertFails(get(ref(context.database(), 'session/refus/events')));
    }

    for (const context of [main, technical]) {
      await assertSucceeds(setDoc(doc(context.firestore(), 'campaigns', 'autorise'), { ok: true }));
      await assertSucceeds(setDoc(doc(context.firestore(), 'campaigns', 'autorise', 'levels', 'rdc'), { ok: true }));
      await assertSucceeds(setDoc(doc(context.firestore(), 'campaigns', 'autorise', 'tokens', 'hero'), { ok: true }));
      await assertSucceeds(setDoc(doc(context.firestore(), 'campaigns', 'autorise', 'state', 'current'), { ok: true }));
      await assertSucceeds(set(ref(context.database(), 'session/autorise/events/e1'), { ok: true }));
      await assertSucceeds(getDoc(doc(context.firestore(), 'campaigns', 'autorise')));
      await assertSucceeds(get(ref(context.database(), 'session/autorise/events')));

      await assertFails(setDoc(doc(context.firestore(), 'autre', 'interdit'), { ok: false }));
      await assertFails(setDoc(doc(context.firestore(), 'campaigns', 'autorise', 'other', 'interdit'), { ok: false }));
      await assertFails(setDoc(doc(context.firestore(), 'campaigns', 'autorise', 'state', 'historique'), { ok: false }));
      await assertFails(set(ref(context.database(), 'hors-session/interdit'), { ok: false }));
    }

    // Exerce les méthodes publiques sur le SDK RTDB réel. L'identité/câblage est injecté comme
    // après connect() afin de tester les transactions, onDisconnect et les règles sans auth mock.
    const transport = new FirebaseTransport({
      apiKey: 'test', authDomain: 'test.invalid', databaseURL: 'http://127.0.0.1',
      projectId: 'demo-rpg-map-display-rules', appId: 'test',
    });
    const wiring = /** @type {any} */ (transport);
    wiring._db = main.database();
    wiring._sessionId = 'aperçus-transport';
    wiring._clientId = 'client_autorise';
    wiring._sessionEpoch = 1;
    wiring._errorHandlers.add(() => {});
    const aperçu = {
      planId: 'plan-1', revision: 1, levelId: 'rdc', tokenId: 'hero',
      start: { a: 1, b: 2 }, path: [{ a: 1, b: 2 }, { a: 2, b: 2 }],
      destination: { a: 2, b: 2 }, remaining: 4,
    };
    const aperçuReçu = new Promise((resolve) => {
      const unsubscribe = transport.subscribeMovePreviews((previews) => {
        if (previews.client_autorise?.revision === 1) {
          unsubscribe();
          resolve(previews);
        }
      });
    });
    assert.deepEqual(await transport.publishMovePreview(aperçu), { ok: true });
    assert.equal((await aperçuReçu).client_autorise.planId, 'plan-1');
    const previewsRef = ref(main.database(), 'session/aperçus-transport/movePreviews/client_autorise');
    const first = await get(previewsRef);
    assert.equal(first.val().revision, 1);
    assert.equal(first.val().tokenId, 'hero');
    assert.deepEqual(await transport.publishMovePreview({ ...aperçu, revision: 2, destination: { a: 3, b: 2 }, path: [...aperçu.path, { a: 3, b: 2 }] }), { ok: true });
    assert.equal((await get(previewsRef)).val().revision, 2);
    assert.equal((await transport.publishMovePreview(aperçu)).ok, false, 'une révision ancienne ne réécrit pas le nœud');
    assert.equal((await get(previewsRef)).val().revision, 2);
    const retireAncien = await transport.clearMovePreview('plan-vieux');
    assert.deepEqual(retireAncien, { ok: true });
    assert.equal((await get(previewsRef)).val().planId, 'plan-1', 'une fermeture tardive laisse le nouveau trajet');
    assert.deepEqual(await transport.clearMovePreview('plan-1'), { ok: true });
    assert.equal((await get(previewsRef)).exists(), false);

    const refusTransport = new FirebaseTransport({
      apiKey: 'test', authDomain: 'test.invalid', databaseURL: 'http://127.0.0.1',
      projectId: 'demo-rpg-map-display-rules', appId: 'test',
    });
    const refusWiring = /** @type {any} */ (refusTransport);
    refusWiring._db = outsider.database();
    refusWiring._sessionId = 'aperçus-transport';
    refusWiring._clientId = 'client_refuse';
    refusWiring._sessionEpoch = 1;
    refusWiring._errorHandlers.add(() => {});
    assert.equal((await refusTransport.publishMovePreview(aperçu)).ok, false);
    assert.equal((await refusTransport.clearMovePreview('plan-1')).ok, false);

    // Une vraie coupure RTDB exécute onDisconnect. Après reprise, le transport doit armer une
    // nouvelle suppression avant ses publications suivantes.
    wiring._watchMovePreviewConnection(1);
    /** @param {boolean} exists */
    const attendrePresencePreview = async (exists) => {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        if ((await get(ref(technical.database(), 'session/aperçus-transport/movePreviews/client_autorise'))).exists() === exists) return;
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      assert.fail(`onDisconnect n'a pas ${exists ? 'créé' : 'retiré'} l'aperçu dans le délai attendu`);
    };
    assert.deepEqual(await transport.publishMovePreview({ ...aperçu, planId: 'plan-coupure-1' }), { ok: true });
    await attendrePresencePreview(true);
    goOffline(main.database());
    await attendrePresencePreview(false);
    goOnline(main.database());
    await new Promise((resolve, reject) => {
      const unsubscribe = onValue(ref(main.database(), '.info/connected'), (snap) => {
        if (snap.val() === true) {
          unsubscribe();
          resolve(undefined);
        }
      }, reject);
    });
    await wiring._movePreviewWriteQueue;
    assert.deepEqual(await transport.publishMovePreview({ ...aperçu, planId: 'plan-coupure-2', revision: 1 }), { ok: true });
    await attendrePresencePreview(true);
    goOffline(main.database());
    await attendrePresencePreview(false);
    goOnline(main.database());
  } finally {
    await environment.cleanup();
  }
});

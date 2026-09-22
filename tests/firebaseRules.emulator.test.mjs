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
import { get, ref, set } from 'firebase/database';
import { doc, getDoc, setDoc } from 'firebase/firestore';

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
  } finally {
    await environment.cleanup();
  }
});

// @ts-check

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const firebase = JSON.parse(fs.readFileSync(path.join(root, 'firebase.json'), 'utf8'));
const firestoreRules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');
const databaseRules = fs.readFileSync(path.join(root, 'database.rules.json'), 'utf8');

test('les deux moteurs Firebase déploient les règles versionnées du dépôt', () => {
  assert.equal(firebase.firestore.rules, 'firestore.rules');
  assert.equal(firebase.database.rules, 'database.rules.json');
  assert.ok(fs.existsSync(path.join(root, firebase.firestore.rules)));
  assert.ok(fs.existsSync(path.join(root, firebase.database.rules)));
});

test('les règles Firestore refusent statiquement l’anonyme, le compte non listé et les autres collections', () => {
  assert.match(firestoreRules, /rules_version\s*=\s*'2'/);
  assert.match(firestoreRules, /match\s+\/campaigns\/\{sessionId\}/);
  assert.match(firestoreRules, /request\.auth\s*!=\s*null/);
  assert.match(firestoreRules, /auth\.token\.email\s*==\s*'ethoril@gmail\.com'/);
  assert.match(firestoreRules, /auth\.token\.email_verified\s*==\s*true/);
  assert.match(firestoreRules, /auth\.token\.email\s*==\s*'et\.horil@gmail\.com'/);
  assert.doesNotMatch(firestoreRules, /match\s+\/\{document=\*\*\}/);
  assert.doesNotMatch(firestoreRules, /allow\s+read\s*,\s*write\s*:\s*if\s+true/);
  assert.doesNotMatch(firestoreRules, /allow\s+read\s*,\s*write\s*:\s*if\s+request\.auth\s*!=\s*null\s*;/);
});

test('les règles RTDB refusent statiquement l’anonyme et tout chemin hors session', () => {
  const rules = JSON.parse(databaseRules);
  assert.deepEqual(Object.keys(rules.rules), ['session']);
  const sessionRules = rules.rules.session.$sessionId;
  assert.match(sessionRules['.read'], /^auth != null && /);
  assert.match(sessionRules['.write'], /^auth != null && /);
  assert.match(sessionRules['.read'], /auth\.token\.email/);
  assert.match(sessionRules['.write'], /auth\.token\.email_verified === true/);
  assert.doesNotMatch(databaseRules, /"\.read"\s*:\s*"true"/);
  assert.doesNotMatch(databaseRules, /"\.write"\s*:\s*"true"/);
});

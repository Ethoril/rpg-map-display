// @ts-check

import test from 'node:test';
import assert from 'node:assert/strict';

import { createSessionCode, normalizeSessionId } from '../js/app/session.js';

/** Caractères bannis parce que confondus à la lecture ou à la dictée. */
const AMBIGUS = ['0', '1', 'I', 'L', 'O', 'U'];

test('createSessionCode : 5 caractères, aucun caractère ambigu', () => {
  for (let i = 0; i < 500; i++) {
    const code = createSessionCode();
    assert.equal(code.length, 5, `longueur inattendue pour "${code}"`);
    assert.match(code, /^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{5}$/, `alphabet violé : "${code}"`);
    for (const c of AMBIGUS) {
      assert.ok(!code.includes(c), `"${code}" contient le caractère ambigu "${c}"`);
    }
  }
});

test('createSessionCode : engendre bien du hasard et non une constante', () => {
  const codes = new Set();
  for (let i = 0; i < 500; i++) codes.add(createSessionCode());
  // Le seuil est très bas à dessein : il ne mesure pas la qualité du hasard, il attrape un
  // générateur bloqué sur une valeur ou sur un compteur trivial.
  assert.ok(codes.size > 400, `seulement ${codes.size} codes distincts sur 500 tirages`);
});

test('normalizeSessionId : la casse est pardonnée sur un code court', () => {
  assert.equal(normalizeSessionId('a7k2m'), 'A7K2M');
  assert.equal(normalizeSessionId('A7K2M'), 'A7K2M');
  assert.equal(normalizeSessionId('  a7k2m  '), 'A7K2M');
});

test('normalizeSessionId : un identifiant hérité passe INCHANGÉ', () => {
  // Le point de régression qui compte. Les sessions d'avant ce changement sont des UUID en
  // minuscules ; les mettre en majuscules les ferait pointer vers un document Firestore
  // inexistant, donc vers un plateau vide sans message d'erreur.
  const uuid = '550e8400-e29b-41d4-a716-446655440000';
  assert.equal(normalizeSessionId(uuid), uuid);
  assert.equal(normalizeSessionId('local-player'), 'local-player');
  assert.equal(normalizeSessionId('diag-1753876543210'), 'diag-1753876543210');
});

test('normalizeSessionId : 5 caractères hors alphabet ne sont pas normalisés', () => {
  // « abcio » a la bonne longueur mais contient I et O : ce n'est pas un code engendré par
  // l'application, donc on n'y touche pas plutôt que de fabriquer un identifiant qui
  // n'existe nulle part.
  assert.equal(normalizeSessionId('abcio'), 'abcio');
  assert.equal(normalizeSessionId('ab-cd'), 'ab-cd');
});

test('normalizeSessionId : absence d’identifiant donne une chaîne vide', () => {
  assert.equal(normalizeSessionId(null), '');
  assert.equal(normalizeSessionId(undefined), '');
  assert.equal(normalizeSessionId(''), '');
});

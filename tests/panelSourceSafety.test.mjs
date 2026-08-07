import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('R0-06 : panel.js ne contient pas de séparateurs NUL ou SOH littéraux', () => {
  const source = fs.readFileSync(new URL('../js/ui/gm/panel.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /[\x00\x01]/);
  assert.match(source, /JSON\.stringify\(etages\.map/);
});

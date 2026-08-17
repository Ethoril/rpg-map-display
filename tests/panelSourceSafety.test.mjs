import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('R0-06 : panel.js et levelSelector.js ne contiennent pas de séparateurs NUL ou SOH littéraux', () => {
  const panelSource = fs.readFileSync(new URL('../js/ui/gm/panel.js', import.meta.url), 'utf8');
  const selectorSource = fs.readFileSync(
    new URL('../js/ui/gm/levelSelector.js', import.meta.url),
    'utf8'
  );
  assert.doesNotMatch(panelSource, /[\x00\x01]/);
  assert.doesNotMatch(selectorSource, /[\x00\x01]/);
  assert.match(selectorSource, /JSON\.stringify\(etages\.map/);
});

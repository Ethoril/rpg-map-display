// @ts-check
import assert from 'node:assert/strict';
import test from 'node:test';
import { MOVE_ZONE_FILL_ALPHA, MOVE_ZONE_OUTLINE_PX } from '../js/core/constants.js';
import { createToken } from '../js/core/schema.js';
import { MoveZoneLayer } from '../js/render/layers/moveZone.js';

test('MoveZoneLayer groupe le remplissage et garde le contour en pixels écran selon le zoom', () => {
  for (const zoom of [0.5, 1, 2]) {
    /** @type {{kind: string, alpha?: number, width?: number}[]} */
    const calls = [];
    const context = /** @type {any} */ ({
      globalAlpha: 1,
      lineWidth: 1,
      save() {},
      restore() {},
      beginPath() {},
      moveTo() {},
      lineTo() {},
      closePath() {},
      fill() { calls.push({ kind: 'fill', alpha: this.globalAlpha }); },
      stroke() { calls.push({ kind: 'stroke', alpha: this.globalAlpha, width: this.lineWidth }); },
    });
    const grid = /** @type {any} */ ({ cellPath() {} });
    const layer = new MoveZoneLayer();
    const rendered = layer.render(context, grid, {
      selectedToken: createToken({ id: 'probe', levelId: 'level', borderColor: '#f00' }),
      reachableCells: new Map([['0,0', 1], ['1,0', 2]]),
    }, zoom);

    assert.equal(rendered, 2);
    assert.deepEqual(calls.filter((call) => call.kind === 'fill'), [
      { kind: 'fill', alpha: MOVE_ZONE_FILL_ALPHA },
    ]);
    const strokes = calls.filter((call) => call.kind === 'stroke');
    assert.equal(strokes.length, 2);
    for (const stroke of strokes) {
      assert.equal(stroke.alpha, 1);
      assert.equal(stroke.width, MOVE_ZONE_OUTLINE_PX / zoom);
    }
  }
});

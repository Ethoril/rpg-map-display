import test from 'node:test';
import assert from 'node:assert/strict';
import { Camera } from '../js/render/camera.js';
import { FrameLoop } from '../js/render/frame.js';

test('Camera: conversion carte <-> écran et roundtrip', () => {
  const camera = new Camera(800, 600);
  camera.setPan(100, 200);
  camera.setZoom(2);
  assert.deepEqual(camera.mapToScreen({ x: 100, y: 200 }), { screenX: 400, screenY: 300 });

  const source = { x: 350, y: 450 };
  const result = camera.screenToMap(camera.mapToScreen(source));
  assert.ok(Math.abs(result.x - source.x) < 1e-6);
  assert.ok(Math.abs(result.y - source.y) < 1e-6);
});

test('Camera: convergence progressive vers cible', () => {
  const camera = new Camera(800, 600);
  camera.setPan(0, 0);
  camera.setZoom(1);
  for (let index = 0; index < 15; index++) {
    camera.convergeTo({ x: 200, y: 100, zoom: 2 }, 0.3);
  }
  assert.ok(Math.abs(camera.x - 200) < 1);
  assert.ok(Math.abs(camera.y - 100) < 1);
  assert.ok(Math.abs(camera.zoom - 2) < 0.05);
});

test('Camera: application des transformations au contexte Canvas 2D', () => {
  const camera = new Camera(1000, 800);
  camera.setPan(50, 50);
  camera.setZoom(1.5);
  /** @type {Array<[string, number, number]>} */
  const calls = [];
  const context = {
    /** @param {number} x @param {number} y */
    translate(x, y) { calls.push(['translate', x, y]); },
    /** @param {number} x @param {number} y */
    scale(x, y) { calls.push(['scale', x, y]); },
  };
  camera.applyToContext(/** @type {CanvasRenderingContext2D} */ (/** @type {unknown} */ (context)));
  assert.deepEqual(calls, [
    ['translate', 500, 400],
    ['scale', 1.5, 1.5],
    ['translate', -50, -50],
  ]);
});

test('FrameLoop: callback obligatoire, coalescence et aucune boucle autonome', () => {
  const previousRaf = globalThis.requestAnimationFrame;
  const previousCancel = globalThis.cancelAnimationFrame;
  /** @type {FrameRequestCallback[]} */
  const callbacks = [];
  globalThis.requestAnimationFrame = (callback) => {
    callbacks.push(callback);
    return callbacks.length;
  };
  globalThis.cancelAnimationFrame = () => {};

  try {
    assert.throws(() => new (/** @type {any} */ (FrameLoop))(), /callback de rendu/);
    let renderCount = 0;
    const loop = new FrameLoop(() => renderCount++);

    assert.equal(loop.requestFrame(), true);
    assert.equal(loop.requestFrame(), false);
    assert.equal(loop.requestFrame(), false);
    assert.equal(callbacks.length, 1);
    callbacks.shift()?.(123);

    assert.equal(renderCount, 1);
    assert.equal(loop.frameCount, 1);
    assert.equal(loop.running, false);
    assert.equal(callbacks.length, 0);
  } finally {
    if (previousRaf === undefined) Reflect.deleteProperty(globalThis, 'requestAnimationFrame');
    else globalThis.requestAnimationFrame = previousRaf;
    if (previousCancel === undefined) Reflect.deleteProperty(globalThis, 'cancelAnimationFrame');
    else globalThis.cancelAnimationFrame = previousCancel;
  }
});

test('FrameLoop: une invalidation pendant le rendu planifie une seule frame suivante', () => {
  const previousRaf = globalThis.requestAnimationFrame;
  const previousCancel = globalThis.cancelAnimationFrame;
  /** @type {FrameRequestCallback[]} */
  const callbacks = [];
  globalThis.requestAnimationFrame = (callback) => {
    callbacks.push(callback);
    return callbacks.length;
  };
  globalThis.cancelAnimationFrame = () => {};

  try {
    /** @type {FrameLoop} */
    let loop;
    loop = new FrameLoop(() => {
      if (loop.frameCount === 1) {
        loop.requestFrame();
        loop.requestFrame();
      }
    });
    loop.requestFrame();
    callbacks.shift()?.(1);
    assert.equal(callbacks.length, 1);
    callbacks.shift()?.(2);
    assert.equal(loop.frameCount, 2);
    assert.equal(loop.running, false);
    assert.equal(callbacks.length, 0);
  } finally {
    if (previousRaf === undefined) Reflect.deleteProperty(globalThis, 'requestAnimationFrame');
    else globalThis.requestAnimationFrame = previousRaf;
    if (previousCancel === undefined) Reflect.deleteProperty(globalThis, 'cancelAnimationFrame');
    else globalThis.cancelAnimationFrame = previousCancel;
  }
});

test('FrameLoop: les erreurs de rendu remontent sans bloquer son état interne', () => {
  const previousRaf = globalThis.requestAnimationFrame;
  const previousCancel = globalThis.cancelAnimationFrame;
  /** @type {FrameRequestCallback[]} */
  const callbacks = [];
  globalThis.requestAnimationFrame = (callback) => {
    callbacks.push(callback);
    return callbacks.length;
  };
  globalThis.cancelAnimationFrame = () => {};

  try {
    const loop = new FrameLoop(() => {
      throw new Error('rendu cassé');
    });
    loop.requestFrame();
    assert.throws(() => callbacks.shift()?.(10), /rendu cassé/);
    assert.equal(loop.running, false);
    assert.equal(loop.requested, false);
  } finally {
    if (previousRaf === undefined) Reflect.deleteProperty(globalThis, 'requestAnimationFrame');
    else globalThis.requestAnimationFrame = previousRaf;
    if (previousCancel === undefined) Reflect.deleteProperty(globalThis, 'cancelAnimationFrame');
    else globalThis.cancelAnimationFrame = previousCancel;
  }
});

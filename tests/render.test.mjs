import test from 'node:test';
import assert from 'node:assert/strict';
import { Camera } from '../js/render/camera.js';
import { FrameLoop } from '../js/render/frame.js';
import { initStage } from '../js/render/stage.js';

test('Camera: conversion carte <-> écran et roundtrip', () => {
  const camera = new Camera(800, 600);
  camera.setPan(100, 200);
  camera.setZoom(2.0);

  // Le point carte (100, 200) doit se retrouver au centre de l'écran (400, 300)
  const centerScreen = camera.mapToScreen({ x: 100, y: 200 });
  assert.equal(centerScreen.screenX, 400);
  assert.equal(centerScreen.screenY, 300);

  // Roundtrip pour un point quelconque
  const originalMapPoint = { x: 350, y: 450 };
  const screenPoint = camera.mapToScreen(originalMapPoint);
  const backToMapPoint = camera.screenToMap(screenPoint);

  assert.ok(Math.abs(backToMapPoint.x - originalMapPoint.x) < 1e-6);
  assert.ok(Math.abs(backToMapPoint.y - originalMapPoint.y) < 1e-6);
});

test('Camera: convergence progressive vers cible', () => {
  const camera = new Camera(800, 600);
  camera.setPan(0, 0);
  camera.setZoom(1.0);

  const target = { x: 200, y: 100, zoom: 2.0 };

  // Faire converger sur 15 étapes
  for (let i = 0; i < 15; i++) {
    camera.convergeTo(target, 0.3);
  }

  assert.ok(Math.abs(camera.x - 200) < 1);
  assert.ok(Math.abs(camera.y - 100) < 1);
  assert.ok(Math.abs(camera.zoom - 2.0) < 0.05);
});

test('Camera: application des transformations au conteneur', () => {
  const camera = new Camera(1000, 800);
  camera.setPan(50, 50);
  camera.setZoom(1.5);

  const mockContainer = {
    scale: { x: 1, y: 1, set(/** @type {any} */ s) { this.x = s; this.y = s; } },
    position: { x: 0, y: 0 },
  };

  camera.applyToContainer(mockContainer);

  assert.equal(mockContainer.scale.x, 1.5);
  assert.equal(mockContainer.scale.y, 1.5);
  assert.equal(mockContainer.position.x, -50 * 1.5 + 500); // 425
  assert.equal(mockContainer.position.y, -50 * 1.5 + 400); // 325
});

test('FrameLoop: coalescence des requêtes et arrêt automatique en cas d inactivité', async () => {
  let renderCallCount = 0;
  const mockApp = {
    render() {
      renderCallCount++;
    },
  };

  const loop = new FrameLoop(mockApp);

  // Appels multiples simultanés
  loop.requestFrame();
  loop.requestFrame();
  loop.requestFrame();

  assert.equal(loop.running, true);
  assert.equal(loop.requested, true);

  // Attendre l'exécution du tick
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.equal(renderCallCount, 1, 'Les 3 appels requestFrame() doivent être coalescés en 1 seul rendu');
  assert.equal(loop.running, false, 'La boucle doit être arrêtée si aucune nouvelle frame n est demandée');
  assert.equal(loop.frameCount, 1);

  // Inactivité pendant 100ms : le compteur de frame ne doit pas augmenter
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(renderCallCount, 1, 'Inactivité : aucune frame supplémentaire ne doit être rendue');
});

test('Stage: initialisation et ordre des couches', async () => {
  const { app, layers } = await initStage();

  assert.ok(app);
  assert.ok(layers.background);
  assert.ok(layers.gridLayer);
  assert.ok(layers.moveZone);
  assert.ok(layers.templates);
  assert.ok(layers.tokens);
  assert.ok(layers.fogLayer);

  // Vérification de l'ordre des enfants dans app.stage (ARCHITECTURE.md §5)
  const children = app.stage.children;
  assert.equal(children[0], layers.background);
  assert.equal(children[1], layers.gridLayer);
  assert.equal(children[2], layers.moveZone);
  assert.equal(children[3], layers.templates);
  assert.equal(children[4], layers.tokens);
  assert.equal(children[5], layers.fogLayer);
});

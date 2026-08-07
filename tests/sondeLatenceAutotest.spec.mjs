// @ts-check
import fs from 'node:fs';
import { test, expect } from '@playwright/test';
import { installBrowserTransport, waitForApp } from './browserTestTransport.mjs';

/**
 * La sonde de `docs/SONDE-LATENCE.md` s'exécute-t-elle réellement ?
 *
 * Le document ne duplique plus le module : ce test vérifie la ligne d'import recommandée, puis
 * exécute le vrai fichier dans une page MJ et qualifie aussi le cas d'un onglet masqué.
 */
test('la sonde de latence documentée s\'exécute et relève un déplacement', async ({ browser }) => {
  const doc = fs.readFileSync('docs/SONDE-LATENCE.md', 'utf8');
  expect(doc).toContain("import('./js/app/sondeLatence.js')");

  const context = await browser.newContext();
  const sessionId = `sonde-${Date.now()}`;
  const snapshot = {
    campaign: {
      schemaVersion: 2,
      campaignId: 'c-sonde',
      name: 'Sonde',
      levels: [
        {
          id: 'rdc', name: 'RDC', order: 0, imageUrl: 'maps/minimal.webp', videoUrl: null,
          animatedOverlays: [], pxPerCell: 100, widthCells: 12, heightCells: 10,
          grid: { type: 'square', offsetX: 0, offsetY: 0, color: '#000000', opacity: 0.25, visible: true },
          terrainCost: null, walls: [], portals: [], lights: [],
          ambient: { color: '#ffffff', level: 1, baked: false },
        },
      ],
      links: [],
      tokens: [{
        id: 'pj-1', levelId: 'rdc', cell: { a: 2, b: 2 }, sizeCells: 1, kind: 'pc', imageUrl: '',
        borderColor: '#00ff00', label: 'PJ', hidden: false, visionBright: 8, visionDim: 12,
        emitsLight: null, speedCells: 30, playerMovable: true, locked: false, elevation: 0,
        markers: [], hp: null, health: 'unharmed',
      }],
      templates: [], settings: { ambientLevel: 1 },
    },
    activeLevelId: 'rdc', selectedTokenId: null, activeHandout: null,
  };

  /** @type {string[]} */
  const erreurs = [];
  const mj = await context.newPage();
  mj.on('pageerror', (e) => erreurs.push(e.message));
  await installBrowserTransport(mj, sessionId, snapshot);
  await mj.goto('/gm.html');
  await waitForApp(mj);

  const joueur = await context.newPage();
  await installBrowserTransport(joueur, sessionId, snapshot);
  await joueur.goto('/player.html?probe=1');
  await waitForApp(joueur);
  await expect
    .poll(() => joueur.evaluate(() => Boolean(document.querySelector('#probe-overlay'))), { timeout: 5000 })
    .toBe(true);
  expect(await joueur.evaluate(() => Boolean(/** @type {any} */ (window).__RPG_APP__.frameProbe))).toBe(true);

  // ── 1. Le module recommandé utilise le callback de la vraie boucle, jamais un rAF autonome.
  const module = fs.readFileSync('js/app/sondeLatence.js', 'utf8');
  expect(module).toContain('loop.addListener(renduExecute)');
  expect(module).not.toContain('requestAnimationFrame(');

  // ── 2. Le chemin recommandé : une seule ligne, celle que le mainteneur tapera.
  //
  // ⭐ La version « bloc à coller » lui a valu un `ReferenceError: js is not defined` — il avait
  // copié la clôture Markdown avec le code. Ce constat vérifie la ligne, pas seulement le code.
  // ⚠ L'import rend la main AVANT que la sonde soit armée : le module lance une fonction
  // asynchrone qu'il n'attend pas. C'est sans conséquence en console — le message « Sonde armée »
  // dit quand c'est prêt — mais un test qui vérifierait dans la foulée échouerait à tort.
  // Le spécificateur passe par une variable : écrit en clair, TypeScript le résoudrait depuis ce
  // fichier de test alors qu'il se résout depuis la page. C'est la ligne exacte que le mainteneur
  // tape dans sa console.
  await mj.evaluate((chemin) => import(/* @vite-ignore */ chemin), './js/app/sondeLatence.js');
  await expect
    .poll(() => mj.evaluate(() => Boolean(/** @type {any} */ (window).sonde)), { timeout: 5000 })
    .toBe(true);

  // Un déplacement venu du joueur, ce que la sonde guette.
  await joueur.evaluate(async () => {
    const store = await import('../js/state/store.js');
    store.moveTokenToCell('pj-1', { a: 5, b: 2 }, null);
    /** @type {any} */ (window).__RPG_APP_OPTIONS__.transport.publish({
      type: 'token.move',
      payload: { tokenId: 'pj-1', from: { a: 2, b: 2 }, to: { a: 5, b: 2 }, path: [] },
      at: Date.now(), by: 'players',
    });
  });

  await expect
    .poll(() => mj.evaluate(() => /** @type {any} */ (window).sonde.releves.length), { timeout: 10000 })
    .toBeGreaterThan(0);

  const releve = await mj.evaluate(() => /** @type {any} */ (window).sonde.releves[0]);
  console.log('\nRELEVÉ DE LA SONDE :', JSON.stringify(releve));
  expect(releve['attente rAF (ms)']).toBeGreaterThanOrEqual(0);
  expect(releve['présentation']).toContain('frame exécutée');

  // Le bilan et l'arrêt doivent fonctionner : ce sont les deux gestes que le mainteneur fera.
  await mj.evaluate(() => /** @type {any} */ (window).sonde.bilan());
  await mj.evaluate(() => /** @type {any} */ (window).sonde.stop());

  // Un délai rAF alors que la page est déclarée masquée est un délai de scheduling, pas une
  // preuve que les couches Canvas sont lentes. Le navigateur de test reste volontairement au
  // premier plan : on teste ici la qualification de la mesure sans fabriquer une attente lente.
  await mj.evaluate(async () => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    const specifier = `./js/app/sondeLatence.js?masquee=${Date.now()}`;
    await import(/* @vite-ignore */ specifier);
  });
  await expect
    .poll(() => mj.evaluate(() => Boolean(/** @type {any} */ (window).sonde?._actif)), { timeout: 5000 })
    .toBe(true);
  await joueur.evaluate(async () => {
    const store = await import('../js/state/store.js');
    store.moveTokenToCell('pj-1', { a: 6, b: 2 }, null);
    /** @type {any} */ (window).__RPG_APP_OPTIONS__.transport.publish({
      type: 'token.move',
      payload: { tokenId: 'pj-1', from: { a: 5, b: 2 }, to: { a: 6, b: 2 }, path: [] },
      at: Date.now(), by: 'players',
    });
  });
  await expect
    .poll(() => mj.evaluate(() => /** @type {any} */ (window).sonde.releves.length), { timeout: 10000 })
    .toBeGreaterThan(0);
  const releveMasque = await mj.evaluate(() => /** @type {any} */ (window).sonde.releves[0]);
  expect(releveMasque['présentation']).toContain('non mesurable');
  await mj.evaluate(() => {
    /** @type {any} */ (window).sonde.stop();
    Reflect.deleteProperty(document, 'visibilityState');
  });

  expect(erreurs).toEqual([]);
  await context.close();
});

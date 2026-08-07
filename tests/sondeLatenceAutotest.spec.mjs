// @ts-check
import fs from 'node:fs';
import { test, expect } from '@playwright/test';
import { installBrowserTransport, waitForApp } from './browserTestTransport.mjs';

/**
 * La sonde de `docs/SONDE-LATENCE.md` s'exécute-t-elle réellement ?
 *
 * ⭐ Ce test **extrait le bloc du document** et le colle dans une vraie page MJ. Livrer au
 * mainteneur un morceau à coller dans sa console sans l'avoir exécuté une fois, c'est lui faire
 * perdre sa soirée sur une faute de frappe. Et le document et le code ne peuvent plus diverger :
 * si quelqu'un modifie l'un sans l'autre, ce test rougit.
 */
test('la sonde de latence documentée s\'exécute et relève un déplacement', async ({ browser }) => {
  const doc = fs.readFileSync('docs/SONDE-LATENCE.md', 'utf8');
  const bloc = doc.match(/```js\n([\s\S]*?)```/);
  expect(bloc, 'le bloc `js` doit exister dans docs/SONDE-LATENCE.md').not.toBeNull();
  const source = /** @type {RegExpMatchArray} */ (bloc)[1];

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
  await joueur.goto('/player.html');
  await waitForApp(joueur);

  // ── 1. Le fichier servi et le bloc publié sont le MÊME code.
  //
  // Sans cette égalité, corriger l'un laisserait l'autre faux, et le mainteneur tomberait sur la
  // version périmée — précisément le genre de piège que ce fichier existe pour fermer.
  const module = fs.readFileSync('js/app/sondeLatence.js', 'utf8');
  const corpsDuModule = module.slice(module.indexOf('(async () => {'));

  // ⚠ Une seule ligne diffère légitimement : l'import du store se résout depuis la PAGE dans la
  // console, et depuis le MODULE dans le fichier. On la neutralise des deux côtés avant de
  // comparer — une première version exigeait l'identité stricte, et la « corriger » aurait
  // consisté à remettre dans le module un chemin qui n'y marche pas.
  const neutraliser = (/** @type {string} */ code) =>
    code
      .replace(/await import\((['"]).*store\.js\1\)/, 'await import(STORE)')
      // Le module porte en plus le commentaire qui explique cette différence.
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/\s+/g, ' ')
      .trim();

  expect(
    neutraliser(corpsDuModule),
    'js/app/sondeLatence.js et le bloc de docs/SONDE-LATENCE.md doivent rester le même code'
  ).toBe(neutraliser(source));

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

  // Le bilan et l'arrêt doivent fonctionner : ce sont les deux gestes que le mainteneur fera.
  await mj.evaluate(() => /** @type {any} */ (window).sonde.bilan());
  await mj.evaluate(() => /** @type {any} */ (window).sonde.stop());

  expect(erreurs).toEqual([]);
  await context.close();
});

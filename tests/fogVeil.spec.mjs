// @ts-check
import { test, expect } from '@playwright/test';

/**
 * Les trois états du voile, mesurés dans un **vrai** canvas.
 *
 * Le mock de `tests/fogLayer.test.mjs` ignore `globalCompositeOperation` sur
 * `drawImage` : il ne peut donc pas voir ce que l'étape B fait réellement du masque
 * exploré, et c'est précisément là que se cachait le défaut — le voile « non exploré »
 * de la vue MJ s'additionnait au voile « exploré » posé en `destination-over` et
 * s'affichait à 0,835 au lieu des 0,70 annoncés. Cette mesure ne peut se faire que dans
 * un navigateur.
 *
 * Le module de mesure est injecté par `addScriptTag`, comme les autres suites du dépôt :
 * un `import()` écrit dans `page.evaluate` serait résolu par `tsc` depuis `tests/`, où
 * ces chemins n'existent pas.
 */
test('Vue MJ : les trois états valent exactement les opacités déclarées', async ({ page }) => {
  /** @type {string[]} */
  const erreurs = [];
  page.on('pageerror', (err) => erreurs.push(err.message));

  await page.goto('/gm.html');
  await page.addScriptTag({
    type: 'module',
    content: `
      import { FogLayer } from './js/render/layers/fogLayer.js';
      import { gridFor } from './js/grid/index.js';
      import { createLevel, createToken } from './js/core/schema.js';
      import { ExploredFog } from './js/vision/fog.js';
      import { FOG_VEIL_GM_UNEXPLORED, FOG_VEIL_GM_EXPLORED } from './js/core/constants.js';

      // Carte plate et sans mur : la géométrie n'est pas le sujet, l'opacité l'est.
      const level = createLevel({
        id: 'rdc', widthCells: 30, heightCells: 10, pxPerCell: 10,
        ambient: { level: 0, baked: false },
      });
      const grid = gridFor(level);
      // Le PJ voit autour de la case (2,5) ; le reste de la carte lui est inconnu.
      const pc = createToken({ id: 'pj', levelId: 'rdc', kind: 'pc', cell: { a: 2, b: 5 }, visionDim: 4 });

      // Masque exploré : la bande de gauche a été visitée, la droite jamais.
      const explored = new ExploredFog(level.widthCells, level.heightCells);
      explored.ctx.fillStyle = 'rgba(0, 0, 0, 1)';
      explored.ctx.fillRect(0, 0, 12 * 8, explored.maskHeight);

      const scene = document.createElement('canvas');
      scene.width = 300;
      scene.height = 100;
      const ctx = scene.getContext('2d');
      ctx.fillStyle = 'rgb(200, 200, 200)'; // fond clair connu
      ctx.fillRect(0, 0, scene.width, scene.height);

      new FogLayer().render(ctx, grid, level, [pc], {
        role: 'gm',
        exploredCanvas: explored.canvas,
      });

      // Opacité déduite du fond clair : 200 * (1 - alpha).
      const alpha = (x, y) => 1 - ctx.getImageData(x, y, 1, 1).data[0] / 200;

      window.__mesuresVoile = {
        vu: alpha(25, 55),          // sous le pion : vision directe
        explore: alpha(105, 55),    // bande visitée, hors du champ de vision courant
        nonExplore: alpha(250, 55), // jamais découvert
        declares: { nonExplore: FOG_VEIL_GM_UNEXPLORED, explore: FOG_VEIL_GM_EXPLORED },
      };
    `,
  });

  await page.waitForFunction(() => Boolean(/** @type {any} */ (window).__mesuresVoile));
  const mesures = await page.evaluate(() => /** @type {any} */ (window).__mesuresVoile);

  // Vu maintenant : aucun voile, le MJ lit la carte telle quelle.
  expect(mesures.vu).toBeCloseTo(0, 2);
  // Les deux autres états valent ce que les constantes annoncent, à l'arrondi 8 bits près.
  expect(mesures.explore).toBeCloseTo(mesures.declares.explore, 2);
  expect(mesures.nonExplore).toBeCloseTo(mesures.declares.nonExplore, 2);

  // Et ils restent franchement discernables : c'est la contrainte qui interdit de
  // baisser le non-exploré seul. 0,15 d'écart minimum entre deux états voisins.
  expect(mesures.nonExplore - mesures.explore).toBeGreaterThan(0.15);
  expect(mesures.explore - mesures.vu).toBeGreaterThan(0.15);

  // Le non-exploré doit rester lisible : le MJ joue à travers.
  expect(mesures.nonExplore).toBeLessThan(0.6);

  expect(erreurs).toEqual([]);
});

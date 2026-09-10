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

/**
 * C-5 — l'ancre des masques sur carte HEXAGONALE, mesurée en pixels.
 *
 * `mapFromCellPoint({0,0})` est l'ancre passée à `ExploredFog.reveal/paintDisc` et à
 * `LightField.compose` : c'est le point de la carte que le masque place à son pixel 0. Et
 * l'étape D de `FogLayer` dépose ce masque à l'origine de la scène — donc l'ancre DOIT être
 * l'origine de la carte. `HexGrid` rendait un centre de case : le masque était posé une
 * demi-case à côté de tout ce qui vient de la vraie géométrie (un doigt, un `cellCenter`).
 */
test('C-5 : sur carte hexagonale, le masque exploré est ancré sur l’origine de la carte, pas une demi-case à côté', async ({ page }) => {
  /** @type {string[]} */
  const erreurs = [];
  page.on('pageerror', (err) => erreurs.push(err.message));

  await page.goto('/gm.html');
  await page.addScriptTag({
    type: 'module',
    content: `
      import { gridFor } from './js/grid/index.js';
      import { createLevel } from './js/core/schema.js';
      import { ExploredFog } from './js/vision/fog.js';
      import { FOG_MASK_PX_PER_CELL } from './js/core/constants.js';

      const level = createLevel({
        id: 'marais', widthCells: 20, heightCells: 6, pxPerCell: 40,
        grid: { type: 'hex', offsetX: 0, offsetY: 0, color: '#000', opacity: 0, visible: false },
      });
      const grid = gridFor(level);

      // Le point peint est un point de carte VRAI — celui qu'un doigt du MJ produit sur le
      // centre d'une case, et que l'outil « révéler » passe tel quel à paintDisc.
      const centre = grid.cellCenter({ a: 12, b: 3 });
      const origine = grid.mapFromCellPoint({ cellX: 0, cellY: 0 });
      const uneCase = grid.mapFromCellPoint({ cellX: 1, cellY: 0 });
      const uneRangee = grid.mapFromCellPoint({ cellX: 0, cellY: 1 });
      const echelle = Math.abs(uneCase.x - origine.x);
      // ⭐ E-11 : les rangees hexagonales ne sont PAS espacees d'une case. L'echelle du masque
      // se prend donc par axe, et toujours a l'adaptateur — jamais √3/2 ecrit ici.
      const echelleY = Math.abs(uneRangee.y - origine.y);

      const fog = new ExploredFog(level.widthCells, level.heightCells);
      // ⛔ **Un rayon qui tient dans le masque**, sinon ce test ne mesure plus ce qu'il croit.
      // Il valait 3 cases : en projection par axe (E-11) cela fait 27,7 px de masque de rayon
      // vertical pour un demi-masque de 24 — le disque etait ROGNE en bas, et le centre de la
      // boite englobante remontait de 4,1 px. Le defaut etait dans la fixture, pas dans l'ancre.
      fog.paintDisc(centre, level.pxPerCell, origine, echelle, echelleY);

      // Boîte englobante de ce qui a été peint, en pixels de masque.
      const data = fog.ctx.getImageData(0, 0, fog.maskWidth, fog.maskHeight).data;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (let y = 0; y < fog.maskHeight; y++) {
        for (let x = 0; x < fog.maskWidth; x++) {
          if (data[(y * fog.maskWidth + x) * 4 + 3] > 128) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }

      window.__ancreHex = {
        peint: { x: (minX + maxX + 1) / 2, y: (minY + maxY + 1) / 2 },
        // ⭐ Remonte la boite brute : si elle touche un bord, le centre mesure un rognage et
        // non une ancre. C'est le piege qui a fait rougir ce test — il se signale desormais.
        boite: { minX, maxX, minY, maxY },
        masque: { largeur: fog.maskWidth, hauteur: fog.maskHeight },
        // Là où ce point de carte DOIT tomber dans le masque : l'étape D pose le masque à
        // l'origine de la scène, donc pixel de masque 0 = pixel de carte 0, à l'échelle
        // FOG_MASK_PX_PER_CELL par case.
        attendu: {
          x: centre.x * FOG_MASK_PX_PER_CELL / echelle,
          y: centre.y * FOG_MASK_PX_PER_CELL / echelleY,
        },
        echelle,
        echelleY,
      };
    `,
  });

  await page.waitForFunction(() => Boolean(/** @type {any} */ (window).__ancreHex));
  const ancre = await page.evaluate(() => /** @type {any} */ (window).__ancreHex);

  expect(ancre.echelle).toBe(40);
  // ⛔ Sans cette ligne, le test passerait aussi sur une grille carree et ne prouverait plus
  // rien de l'anisotropie : c'est elle qui rend les deux attendus ci-dessous distincts (E-11).
  expect(ancre.echelleY).toBeLessThan(ancre.echelle);
  // ⛔ La zone peinte doit etre strictement interieure au masque : une boite qui touche un
  // bord est rognee, et son centre ne dit plus rien de l'ancrage (voir le commentaire du
  // rayon, cote page). Ce garde-fou fait echouer la FIXTURE plutot que l'ancre.
  expect(ancre.boite.minX).toBeGreaterThan(0);
  expect(ancre.boite.minY).toBeGreaterThan(0);
  expect(ancre.boite.maxX).toBeLessThan(ancre.masque.largeur - 1);
  expect(ancre.boite.maxY).toBeLessThan(ancre.masque.hauteur - 1);
  // ⭐ Un pixel de masque de tolérance : la convention centre décalait de 4 pixels de masque
  // (une demi-case = 8/2) dans CHAQUE axe.
  expect(Math.abs(ancre.peint.x - ancre.attendu.x)).toBeLessThan(1);
  expect(Math.abs(ancre.peint.y - ancre.attendu.y)).toBeLessThan(1);

  expect(erreurs).toEqual([]);
});

test('C-5 : sur carte hexagonale, la zone révélée autour d’un pion est centrée sur sa case', async ({ page }) => {
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

      // ⚠ Le pion est placé LOIN de l'origine et en rangée 0. Loin, parce que le décalage
      // d'ancre se lit à l'écran multiplié par la distance à l'origine — c'est l'étape D qui
      // étire le masque sur la largeur de carte, elle-même issue de mapFromCellPoint.
      //
      // ⭐ La rangée 0 était choisie pour ESQUIVER la compression verticale du masque, décrite
      // ici comme un défaut préexistant et hors chantier. ✅ Ce défaut est CORRIGÉ : c'était
      // E-11, et le masque se projette désormais avec une échelle PAR AXE. La rangée 0 reste,
      // parce que rien n'oblige ce test à changer de sujet.
      //
      // ⛔ Et une limite à connaître : les sondes ci-dessous sont toutes RELATIVES à
      // cellCenter, donc une translation commune du masque et du pion s'y annule. Ce test ne
      // défend PAS à lui seul l'ancrage — remettre le centrage d'une demi-case dans
      // mapFromCellPoint le laisse vert. C'est le test qui précède qui mord là-dessus, en
      // comparant la zone peinte à une position ABSOLUE dans le masque.
      const level = createLevel({
        id: 'marais', widthCells: 20, heightCells: 6, pxPerCell: 40,
        ambient: { level: 0, baked: false },
        grid: { type: 'hex', offsetX: 0, offsetY: 0, color: '#000', opacity: 0, visible: false },
      });
      const grid = gridFor(level);
      const cell = { a: 19, b: 0 };
      const porteeCases = 3;
      const pc = createToken({ id: 'pj', levelId: 'marais', kind: 'pc', cell, visionDim: porteeCases });

      const scene = document.createElement('canvas');
      scene.width = 800;
      scene.height = 208;
      const ctx = scene.getContext('2d');
      ctx.fillStyle = 'rgb(200, 200, 200)';
      ctx.fillRect(0, 0, scene.width, scene.height);

      new FogLayer().render(ctx, grid, level, [pc], { role: 'gm' });

      const alpha = (p) => 1 - ctx.getImageData(Math.round(p.x), Math.round(p.y), 1, 1).data[0] / 200;
      const centre = grid.cellCenter(cell);
      const px = level.pxPerCell;

      window.__voileHex = {
        // Le centre de la case du pion : révélé.
        centre: alpha(centre),
        // Une demi-case AU-DELÀ de la portée : encore voilé.
        auDela: alpha({ x: centre.x - (porteeCases + 0.5) * px, y: centre.y }),
        // ⭐ La sonde qui compte : JUSTE EN DEÇÀ de la portée, du côté de l'origine. C'est
        // celle que perd un masque ancré une demi-case trop loin — le disque entier glisse
        // vers l'extérieur de la carte et abandonne son bord intérieur.
        enDeca: alpha({ x: centre.x - (porteeCases - 0.2) * px, y: centre.y }),
      };
    `,
  });

  await page.waitForFunction(() => Boolean(/** @type {any} */ (window).__voileHex));
  const voile = await page.evaluate(() => /** @type {any} */ (window).__voileHex);

  expect(voile.centre).toBeLessThan(0.15);
  expect(voile.enDeca).toBeLessThan(0.15);
  expect(voile.auDela).toBeGreaterThan(0.4);

  expect(erreurs).toEqual([]);
});

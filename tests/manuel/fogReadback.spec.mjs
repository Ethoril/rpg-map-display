// @ts-check
import { test, expect } from '@playwright/test';

/**
 * MESURE — `willReadFrequently` change-t-il le coût de la publication du fog ?
 *
 * Chromium avertit au démarrage de la vue MJ : « Multiple readback operations using getImageData
 * are faster with the willReadFrequently attribute set to true ». C'est le premier des trois
 * points du lot 2 sciemment non traités (`ETAT.md`), avec la consigne d'y revenir « le jour où le
 * fog coûtera trop cher, pas avant : y toucher maintenant serait optimiser sans mesure ».
 *
 * ⚠ Ce jour est peut-être arrivé — ce `getImageData` est sur le **chemin de publication**, donc
 * exactement là où le poste MJ travaille quand un joueur déplace un pion. Mais la consigne tient :
 * on mesure d'abord, on décide ensuite. Ce fichier ne corrige rien.
 *
 * Le masque mesuré fait 520 × 568 px, soit la taille réelle du masque de `testbig150`
 * (65 × 71 cases à 8 px/case).
 */
test('MESURE — coût de getImageData sur le canvas de fog, avec et sans willReadFrequently', async ({
  page,
}) => {
  await page.goto('/gm.html');

  const mesure = await page.evaluate(() => {
    const W = 520;
    const H = 568;
    const TOURS = 40;

    /** @param {boolean} flag */
    const banc = (flag) => {
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      const ctx = /** @type {CanvasRenderingContext2D} */ (
        c.getContext('2d', flag ? { willReadFrequently: true } : undefined)
      );
      // Un masque à moitié révélé, comme en séance : ni vierge ni plein.
      ctx.fillStyle = 'rgba(255,255,255,1)';
      ctx.fillRect(0, 0, W / 2, H);

      // Chauffe, pour ne pas mesurer la première allocation.
      for (let i = 0; i < 5; i++) ctx.getImageData(0, 0, W, H);

      const t0 = performance.now();
      for (let i = 0; i < TOURS; i++) {
        // Une écriture entre deux lectures : c'est le vrai régime, le masque étant révélé
        // puis relu à chaque publication. Sans elle, le navigateur servirait un cache.
        ctx.fillRect(i % 100, 0, 1, 1);
        ctx.getImageData(0, 0, W, H);
      }
      return (performance.now() - t0) / TOURS;
    };

    // Alterné, pour ne pas attribuer à l'attribut une dérive de la machine.
    const sans1 = banc(false);
    const avec1 = banc(true);
    const sans2 = banc(false);
    const avec2 = banc(true);

    return {
      sans: (sans1 + sans2) / 2,
      avec: (avec1 + avec2) / 2,
      detail: { sans1, avec1, sans2, avec2 },
    };
  });

  const gain = mesure.sans - mesure.avec;
  const pct = (gain / mesure.sans) * 100;

  console.log('\n===== getImageData 520×568, moyenne sur 40 lectures =====');
  console.log(`  sans willReadFrequently : ${mesure.sans.toFixed(3)} ms`);
  console.log(`  avec willReadFrequently : ${mesure.avec.toFixed(3)} ms`);
  console.log(`  écart                   : ${gain.toFixed(3)} ms (${pct.toFixed(1)} %)`);
  console.log(`  détail : ${JSON.stringify(mesure.detail)}`);
  console.log('=========================================================\n');

  // Aucun seuil : ce fichier mesure, il ne juge pas.
  expect(mesure.sans).toBeGreaterThan(0);
  expect(mesure.avec).toBeGreaterThan(0);
});

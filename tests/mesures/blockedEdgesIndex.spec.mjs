// @ts-check
import { test, expect } from '@playwright/test';

/**
 * MESURE — ce que rapporte l'index spatial de `computeBlockedEdges`, en navigateur.
 *
 * ## Pourquoi ce fichier existe
 *
 * ⭐ Créé le 12/08/2026 pour **sortir une durée de la porte**. `tests/blockedEdges.test.mjs`
 * assertait `duration < 60` sur `testbig150` : une mesure, pas un jugement reproductible. Elle a
 * rougi pendant un audit qui lançait deux suites en parallèle, **sur du code juste** — exactement
 * le mode de panne que la séparation `tests/mesures/` existe pour éviter. La porte ne garde donc
 * plus que le **compte** d'arêtes (2701), qui est reproductible ; le temps est imprimé ici.
 *
 * ## Pourquoi la mesure est en navigateur et non en node
 *
 * `computeBlockedEdges` est recalculé **à chaque trait** de l'éditeur de murs de L-07, dans
 * Chromium, sur le poste MJ. C'est là que la latence se paie, pas dans node.
 *
 * ⚠ Aucun seuil n'est affirmé ici. Le repère utile, relevé le 12/08/2026 sur le poste Windows du
 * mainteneur, en node : **~334 ms sans index, ~25 ms avec l'index d'origine, ~13 ms** après la
 * correction de la clé de déduplication d'arête (R-06). Un chiffre de cette page qui s'en écarte
 * beaucoup mérite un regard — il ne fait pas échouer la porte pour autant.
 */
test('MESURE — computeBlockedEdges sur testbig150 : index spatial contre force brute', async ({
  page,
}) => {
  await page.goto('/gm.html');

  const mesure = await page.evaluate(async () => {
    // Chemins **relatifs** : `page.evaluate` s'exécute dans la page servie à la racine, donc
    // `../js/…` depuis `/gm.html` retombe sur `/js/…` — et `tsc` les résout depuis `tests/`.
    // Une URL absolue `/js/…` marcherait dans le navigateur mais ferait rougir le typecheck.
    const { gridFor } = await import('../../js/grid/index.js');
    const { computeBlockedEdges, extractBlockedSegments, segmentsIntersect, invalidateBlockedEdgesCache } =
      await import('../../js/import/blockedEdges.js');
    const { edgeKey } = await import('../../js/core/cellKey.js');

    const scene = await (await fetch('/maps/generated/testbig150.scene.json')).json();
    const level = scene.levels[0];
    const grid = gridFor(level);

    /** L'index, tel que le produit vraiment le module. */
    const avecIndex = () => {
      invalidateBlockedEdgesCache(level.id);
      const t0 = performance.now();
      const edges = computeBlockedEdges(level, grid);
      return { ms: performance.now() - t0, taille: edges.size };
    };

    /** La force brute : chaque arête contre chaque segment, sans aucun élagage. */
    const forceBrute = () => {
      const segs = extractBlockedSegments(level, grid);
      const t0 = performance.now();
      const blocked = new Set();
      const vues = new Set();
      for (const cell of grid.allCells(level.widthCells, level.heightCells)) {
        const A = grid.pointFromCell(cell);
        for (const n of grid.neighbors(cell)) {
          const k = edgeKey(cell, n);
          if (vues.has(k)) continue;
          vues.add(k);
          const B = grid.pointFromCell(n);
          for (const s of segs) {
            if (segmentsIntersect(s.p1, s.p2, A, B)) { blocked.add(k); break; }
          }
        }
      }
      return { ms: performance.now() - t0, taille: blocked.size, segments: segs.length };
    };

    // Chauffe : ne pas mesurer la première compilation du code.
    avecIndex();
    const index = [];
    for (let i = 0; i < 9; i++) index.push(avecIndex());
    const brute = forceBrute();

    const ms = index.map((r) => r.ms).sort((a, b) => a - b);
    return {
      cases: `${level.widthCells}×${level.heightCells}`,
      segments: brute.segments,
      indexTaille: index[0].taille,
      bruteTaille: brute.taille,
      median: ms[4],
      min: ms[0],
      max: ms[8],
      bruteMs: brute.ms,
    };
  });

  const facteur = mesure.bruteMs / mesure.median;

  console.log('\n===== computeBlockedEdges — testbig150 =====');
  console.log(`  étage                  : ${mesure.cases} cases, ${mesure.segments} segments de mur`);
  console.log(`  arêtes bloquées        : ${mesure.indexTaille} (index) / ${mesure.bruteTaille} (force brute)`);
  console.log(`  index spatial          : médiane ${mesure.median.toFixed(1)} ms  (min ${mesure.min.toFixed(1)}, max ${mesure.max.toFixed(1)}, 9 relevés)`);
  console.log(`  force brute            : ${mesure.bruteMs.toFixed(1)} ms`);
  console.log(`  facteur                : ×${facteur.toFixed(1)}`);
  console.log('===========================================\n');

  // Aucun seuil de durée : ce fichier mesure, il ne juge pas. La seule chose affirmée est que les
  // deux chemins décrivent le même étage — sinon les deux durées ne seraient pas comparables.
  expect(mesure.indexTaille).toBe(mesure.bruteTaille);
  // Épinglé sur la valeur, pas seulement sur l'égalité : deux zéros satisferaient l'égalité, et
  // ce fichier deviendrait alors une mesure de rien du tout.
  expect(mesure.indexTaille).toBe(2701);
  expect(mesure.median).toBeGreaterThan(0);
});

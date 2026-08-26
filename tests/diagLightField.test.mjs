// @ts-check
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  discSourceEnEspaceMasque,
  champLumineuxEnEspaceMasque,
  resumeCompositionChampLumineux,
  LIGHT_FIELD_COMPOSE_BUDGET_MS,
  LIGHT_FIELD_ITERATIONS,
} from '../js/app/diag.js';
import { FOG_MASK_PX_PER_CELL } from '../js/core/constants.js';

test('M2 — position et rayon d’une source, dans l’espace du masque (piège n°5)', () => {
  // Position en cases, comme dans une scène publiée réelle ; range en cases également.
  const source = { at: { cellX: 10, cellY: 4 }, range: 5 };
  const disc = discSourceEnEspaceMasque(source);

  assert.equal(disc.mx, 10 * FOG_MASK_PX_PER_CELL);
  assert.equal(disc.my, 4 * FOG_MASK_PX_PER_CELL);
  assert.equal(disc.rayon, 5 * FOG_MASK_PX_PER_CELL);

  // ⭐ Le piège nommé par le brief : à 140 px/case, un rayon exprimé en pixels CARTE au lieu
  // de pixels de MASQUE est 140 / 8 = 17,5 fois trop grand. On l'épingle en dur : si demain
  // le calcul se mettait à multiplier par l'échelle de la carte plutôt que par
  // `FOG_MASK_PX_PER_CELL`, ce rayon bondit de 17,5×, et le test ci-dessous le voit.
  assert.equal(disc.rayon, 40, 'le rayon doit être en pixels de masque, pas en pixels carte');
});

test('M2 — la surface peinte est calculée depuis les sources RÉELLES, jamais un compte figé (piège n°2)', () => {
  const level = {
    widthCells: 10,
    heightCells: 6,
    lights: [
      { at: { cellX: 1, cellY: 1 }, range: 2 },
      { at: { cellX: 8, cellY: 4 }, range: 1 },
    ],
  };
  const champ = champLumineuxEnEspaceMasque(level);

  assert.equal(champ.maskWidth, 10 * FOG_MASK_PX_PER_CELL);
  assert.equal(champ.maskHeight, 6 * FOG_MASK_PX_PER_CELL);
  assert.equal(champ.sourceCount, 2, 'le compte doit être celui du tableau réellement lu');
  assert.equal(champ.disques.length, 2);

  // ⭐ Preuve par mutation n°2 : si l'implémentation utilisait le rayon en pixels CARTE
  // (`source.range * 140`) au lieu du rayon en pixels de MASQUE (`source.range * 8`), la
  // surface calculée exploserait d'un facteur (140/8)² ≈ 306. On fixe donc la valeur exacte
  // attendue avec l'échelle correcte : un calcul en pixels carte la manquerait de très loin,
  // et pas seulement d'un arrondi.
  const r1 = 2 * FOG_MASK_PX_PER_CELL; // 16
  const r2 = 1 * FOG_MASK_PX_PER_CELL; // 8
  const surfaceAttendue = Math.PI * r1 * r1 + Math.PI * r2 * r2;
  assert.ok(
    Math.abs(champ.surfaceTotale - surfaceAttendue) < 1e-9,
    `surface attendue ${surfaceAttendue}, obtenue ${champ.surfaceTotale}`
  );
  // Le garde-fou explicite : une surface calculée en pixels carte dépasserait de très loin
  // l'aire du masque lui-même (10×6 cases → 80×48 px de masque, 3840 px² au total).
  assert.ok(champ.surfaceTotale < champ.maskWidth * champ.maskHeight * 10);

  // ⭐ Preuve par mutation n°3 : remplacer le compte réel par une constante (ex. 93, codée en
  // dur) doit rougir ici — le niveau de contrôle ci-dessus ne porte que 2 sources, jamais 93.
  assert.notEqual(champ.sourceCount, 93);
});


test('M2 — 0 source déclarée : la mesure n’a pas eu lieu, aucun chiffre inventé', () => {
  const champ = champLumineuxEnEspaceMasque({ widthCells: 4, heightCells: 4, lights: [] });
  assert.equal(champ.sourceCount, 0);
  assert.equal(champ.surfaceTotale, 0);

  const resume = resumeCompositionChampLumineux({
    releves: [{ surfaceMpx: 0.31, dureeTotaleMs: 999, iterations: 30 }],
    vidageMs: 0,
    sourceCount: 0,
  });
  assert.equal(resume.tenu, false);
  assert.match(resume.verdict, /mesure n'a pas eu lieu/);
});

test('M2 — ⭐ le régime qui rendait le verdict incapable de basculer (26/08)', () => {
  // ⭐ LE test de non-régression du défaut trouvé le 26/08 sur le poste Windows. La version du
  // 18/08 chronométrait UNE opération encadrée d'un `getImageData`, puis retranchait le coût de
  // cette relecture — technique juste pour G-01 (décodage ~490 ms, vidage ~5 ms), fausse ici :
  //
  //     relecture seule 13,1 ms  |  composition brute 6,2 ms  |  net = max(0, 6,2 − 13,1) = 0
  //
  // Le net tombait à 0 quoi qu'il arrive, donc « ça tient » ne pouvait pas basculer.
  //
  // La correction est d'amortir le vidage sur N cycles. On reprend ici les chiffres RÉELS de ce
  // relevé : 30 cycles en 60 ms, avec le même vidage de 13,1 ms.
  const resume = resumeCompositionChampLumineux({
    releves: [{ surfaceMpx: 0.92, dureeTotaleMs: 60, iterations: 30 }],
    vidageMs: 13.1,
    sourceCount: 93,
  });

  // (60 − 13,1) / 30 = 1,563 ms par image. L'ancienne arithmétique — retrancher le vidage à
  // CHAQUE image — donnerait max(0, 2 − 13,1) = 0. C'est l'assertion qui rougit si quelqu'un
  // remet la soustraction par image, ou le plancher `Math.max(0, …)` qui la rendait muette.
  assert.ok(Math.abs(resume.parImage[0].msParImage - 1.5633) < 1e-3, `obtenu ${resume.parImage[0].msParImage}`);
  assert.notEqual(resume.parImage[0].msParImage, 0, 'un vidage plus cher qu’une image ne doit plus annuler la mesure');

  // Et la part du vidage dans le résultat est désormais un trentième : c'est tout l'objet du
  // changement. Si `iterations` cessait d'être pris en compte, cet écart bondirait.
  const sansVidage = resumeCompositionChampLumineux({
    releves: [{ surfaceMpx: 0.92, dureeTotaleMs: 60, iterations: 30 }],
    vidageMs: 0,
    sourceCount: 93,
  });
  assert.ok(Math.abs(sansVidage.parImage[0].msParImage - resume.parImage[0].msParImage) < 0.5,
    'le vidage doit être amorti, donc marginal — pas décisif');
});

test('M2 — ⛔ un vidage plus cher que la fenêtre entière est REFUSÉ, jamais ramené à zéro', () => {
  // ⛔ C'est le plancher `Math.max(0, brut − vidage)` qui a rendu le défaut du 18/08 silencieux :
  // il transformait une mesure absurde en un joli 0 ms, et 0 ms tient toujours dans le budget.
  // Une mesure dont le vidage dépasse la fenêtre n'est pas à rectifier, elle est à refuser.
  assert.throws(
    () => resumeCompositionChampLumineux({
      releves: [{ surfaceMpx: 0.92, dureeTotaleMs: 6.2, iterations: 1 }],
      vidageMs: 13.1,
      sourceCount: 93,
    }),
    /dépasse la fenêtre mesurée/
  );

  // Preuve par mutation : remplacer ce refus par un plancher à zéro rendrait `tenu` vrai avec
  // une mesure qui ne veut rien dire. On épingle donc qu'aucun verdict n'en sort.
  assert.throws(() => resumeCompositionChampLumineux({
    releves: [
      { surfaceMpx: 0.31, dureeTotaleMs: 500, iterations: 30 },
      { surfaceMpx: 4.1, dureeTotaleMs: 2, iterations: 30 },
    ],
    vidageMs: 5,
    sourceCount: 93,
  }), /Relevé 1/, 'le relevé fautif doit être nommé, même s’il n’est pas le premier');
});

test('M2 — ⭐ le verdict porte sur la PLUS GRANDE destination, pas sur la première ni sur la moyenne', () => {
  // ⚠ Le second défaut du 18/08 : l'agrandissement visait un canvas figé à 640×480. Sur la
  // tablette, c'est cinq fois moins de pixels de destination que l'écran réel — donc le mauvais
  // terme, celui dont tout le raisonnement « une composition coûte en proportion de sa surface
  // de destination » dit qu'il gouverne la dépense.
  //
  // La petite destination coûte 1 ms par image, la grande 350 : le verdict doit suivre la grande.
  const resume = resumeCompositionChampLumineux({
    releves: [
      { surfaceMpx: 0.31, dureeTotaleMs: 10, iterations: 10 },    // 1 ms / image
      { surfaceMpx: 4.1, dureeTotaleMs: 3500, iterations: 10 },   // 350 ms / image
    ],
    vidageMs: 0,
    sourceCount: 93,
  });
  assert.equal(resume.pireMsParImage, 350);
  assert.equal(resume.tenu, false, 'la grande destination dépasse le budget : le verdict doit le dire');
  assert.match(resume.verdict, /NE tient PAS/);
  // Une moyenne des deux donnerait 175,5 ms — sous le budget. Cette assertion rougit si le
  // verdict se met à moyenner au lieu de prendre le pire.
  assert.ok((1 + 350) / 2 < LIGHT_FIELD_COMPOSE_BUDGET_MS, 'le cas n’est une bascule que si la moyenne, elle, tenait');

  // L'ordre des relevés ne doit rien changer : le pire est le pire.
  const inverse = resumeCompositionChampLumineux({
    releves: [
      { surfaceMpx: 4.1, dureeTotaleMs: 3500, iterations: 10 },
      { surfaceMpx: 0.31, dureeTotaleMs: 10, iterations: 10 },
    ],
    vidageMs: 0,
    sourceCount: 93,
  });
  assert.equal(inverse.tenu, false);
  assert.equal(inverse.pireMsParImage, 350);
});

test('M2 — la bascule du budget, dans les deux sens et à la frontière stricte', () => {
  assert.equal(LIGHT_FIELD_COMPOSE_BUDGET_MS, 300);

  const tient = resumeCompositionChampLumineux({
    releves: [{ surfaceMpx: 2.3, dureeTotaleMs: 30 * 299, iterations: 30 }],
    vidageMs: 0,
    sourceCount: 93,
  });
  assert.equal(tient.tenu, true);
  assert.match(tient.verdict, /tient\.$/);

  const depasse = resumeCompositionChampLumineux({
    releves: [{ surfaceMpx: 2.3, dureeTotaleMs: 30 * 301, iterations: 30 }],
    vidageMs: 0,
    sourceCount: 93,
  });
  assert.equal(depasse.tenu, false);
  assert.match(depasse.verdict, /NE tient PAS/);

  // Frontière stricte : par image === budget ne tient pas.
  const frontiere = resumeCompositionChampLumineux({
    releves: [{ surfaceMpx: 2.3, dureeTotaleMs: 30 * LIGHT_FIELD_COMPOSE_BUDGET_MS, iterations: 30 }],
    vidageMs: 0,
    sourceCount: 93,
  });
  assert.equal(frontiere.pireMsParImage, LIGHT_FIELD_COMPOSE_BUDGET_MS);
  assert.equal(frontiere.tenu, false, 'par image === budget ne tient pas le critère (comparaison stricte)');
});

test('M2 — part fixe et part variable se lisent par la pente, sur les surfaces de DESTINATION', () => {
  // Deux relevés construits sur une droite connue : 0,5 ms de coût plat + 0,2 ms par mégapixel
  // de destination. C'est le raisonnement déjà écrit pour le défaut jumeau des pions — une
  // composition coûte en proportion de sa surface de destination — appliqué à la mesure.
  const resume = resumeCompositionChampLumineux({
    releves: [
      { surfaceMpx: 1, dureeTotaleMs: 0.7 * 10 + 2, iterations: 10 },
      { surfaceMpx: 3, dureeTotaleMs: 1.1 * 10 + 2, iterations: 10 },
    ],
    vidageMs: 2,
    sourceCount: 93,
  });
  assert.ok(Math.abs(/** @type {number} */ (resume.coutParMpxMs) - 0.2) < 1e-9, `pente obtenue ${resume.coutParMpxMs}`);
  assert.ok(Math.abs(/** @type {number} */ (resume.coutFixeMs) - 0.5) < 1e-9, `part fixe obtenue ${resume.coutFixeMs}`);

  // ⭐ Preuve par mutation : si la pente était calculée sur les DURÉES DE FENÊTRE au lieu des
  // ms par image, elle vaudrait (13 − 9) / (3 − 1) = 2 — dix fois trop. L'écart est franc.
  assert.ok(/** @type {number} */ (resume.coutParMpxMs) < 1, 'la pente doit porter sur le coût par image, pas sur la fenêtre');

  // Un seul relevé ne permet aucune décomposition : il faut le dire, pas l'inventer.
  const seul = resumeCompositionChampLumineux({
    releves: [{ surfaceMpx: 2.3, dureeTotaleMs: 30, iterations: 30 }],
    vidageMs: 0,
    sourceCount: 93,
  });
  assert.equal(seul.coutParMpxMs, null);
  assert.equal(seul.coutFixeMs, null);

  // Deux relevés à la MÊME surface non plus : la pente serait une division par zéro.
  const memeSurface = resumeCompositionChampLumineux({
    releves: [
      { surfaceMpx: 2.3, dureeTotaleMs: 30, iterations: 30 },
      { surfaceMpx: 2.3, dureeTotaleMs: 45, iterations: 30 },
    ],
    vidageMs: 0,
    sourceCount: 93,
  });
  assert.equal(memeSurface.coutParMpxMs, null);
  assert.equal(memeSurface.coutFixeMs, null);
  assert.equal(memeSurface.pireMsParImage, 1.5, 'le verdict, lui, reste calculable');
});

test('M2 — mesures absurdes : aucun verdict favorable par accident', () => {
  const releveValide = { surfaceMpx: 2.3, dureeTotaleMs: 30, iterations: 30 };

  assert.throws(() => resumeCompositionChampLumineux({
    releves: [releveValide], vidageMs: NaN, sourceCount: 93,
  }), /durée finie/);
  assert.throws(() => resumeCompositionChampLumineux({
    releves: [releveValide], vidageMs: -1, sourceCount: 93,
  }), /négatif/);
  assert.throws(() => resumeCompositionChampLumineux({
    releves: [releveValide], vidageMs: 0, sourceCount: -1,
  }), /sourceCount/);
  assert.throws(() => resumeCompositionChampLumineux({
    releves: [], vidageMs: 0, sourceCount: 93,
  }), /Aucun relevé/);

  // `iterations` doit être un entier strictement positif : à zéro, la division rendrait
  // l'infini, et l'infini ne tient dans aucun budget — mais par accident, pas par mesure.
  assert.throws(() => resumeCompositionChampLumineux({
    releves: [{ surfaceMpx: 2.3, dureeTotaleMs: 30, iterations: 0 }], vidageMs: 0, sourceCount: 93,
  }), /iterations/);
  assert.throws(() => resumeCompositionChampLumineux({
    releves: [{ surfaceMpx: 2.3, dureeTotaleMs: 30, iterations: 1.5 }], vidageMs: 0, sourceCount: 93,
  }), /iterations/);

  // Une surface de destination nulle ou négative n'est pas une destination.
  assert.throws(() => resumeCompositionChampLumineux({
    releves: [{ surfaceMpx: 0, dureeTotaleMs: 30, iterations: 30 }], vidageMs: 0, sourceCount: 93,
  }), /surfaceMpx/);
  assert.throws(() => resumeCompositionChampLumineux({
    releves: [{ surfaceMpx: 2.3, dureeTotaleMs: NaN, iterations: 30 }], vidageMs: 0, sourceCount: 93,
  }), /durée finie/);
});

test('M2 — le nombre de cycles est assez grand pour que le vidage cesse de décider', () => {
  // ⚠ `LIGHT_FIELD_ITERATIONS` n'est pas un réglage cosmétique : c'est lui qui a réparé le
  // défaut. On l'épingle contre une dérive vers 1 ou 2, où l'on retomberait exactement dans le
  // régime du 18/08 — un vidage de 13 ms face à une image de 2 ms.
  assert.ok(LIGHT_FIELD_ITERATIONS >= 20, `${LIGHT_FIELD_ITERATIONS} cycles ne suffisent pas à amortir un vidage de 13 ms`);
  assert.ok(Number.isInteger(LIGHT_FIELD_ITERATIONS));

  // Avec le vidage le plus cher jamais observé (51,1 ms, 1ʳᵉ exécution à froid le 26/08) et le
  // coût par image le plus bas plausible, la part du vidage doit rester une fraction du signal.
  const vidagePire = 51.1;
  assert.ok(vidagePire / LIGHT_FIELD_ITERATIONS < 2,
    'même le vidage à froid doit peser moins de 2 ms par image après amortissement');
});

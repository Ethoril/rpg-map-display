// @ts-check
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  discSourceEnEspaceMasque,
  champLumineuxEnEspaceMasque,
  resumeCompositionChampLumineux,
  LIGHT_FIELD_COMPOSE_BUDGET_MS,
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
    compositionBrutMs: 999,
    agrandissementBrutMs: 999,
    relectureMs: 0,
    sourceCount: 0,
  });
  assert.equal(resume.tenu, false);
  assert.match(resume.verdict, /mesure n'a pas eu lieu/);
});

test('M2 — le net retranche la relecture, et cette soustraction décide seule du verdict (piège n°1)', () => {
  // ⭐ Le cas construit pour faire basculer le verdict : composition et agrandissement bruts
  // dépassent largement le budget (290 + 290 = 580 ms ≥ 300 ms), mais une relecture de vidage
  // de 250 ms — mesurée une fois sur un bitmap 1×1 — ramène chacun des deux nets à 40 ms, soit
  // 80 ms au total : sous le budget. Retirer la soustraction dans
  // `resumeCompositionChampLumineux` fait rougir les trois assertions qui suivent d'un coup.
  assert.equal(LIGHT_FIELD_COMPOSE_BUDGET_MS, 300);
  assert.ok(290 + 290 >= LIGHT_FIELD_COMPOSE_BUDGET_MS, 'le cas n’est une bascule que si le brut dépasse le budget');

  const bascule = resumeCompositionChampLumineux({
    compositionBrutMs: 290,
    agrandissementBrutMs: 290,
    relectureMs: 250,
    sourceCount: 93,
  });
  assert.equal(bascule.compositionNetMs, 40);
  assert.equal(bascule.agrandissementNetMs, 40);
  assert.equal(bascule.totalNetMs, 80);
  assert.equal(bascule.tenu, true, 'le verdict doit porter sur le NET, pas sur le brut');
  assert.match(bascule.verdict, /tient\.$/);

  // Et l'autre sens : un brut réellement au-dessus du budget ne doit pas être blanchi par une
  // relecture insignifiante — sinon le critère serait tenu par construction.
  const depasse = resumeCompositionChampLumineux({
    compositionBrutMs: 200,
    agrandissementBrutMs: 200,
    relectureMs: 0.4,
    sourceCount: 93,
  });
  assert.ok(depasse.totalNetMs >= LIGHT_FIELD_COMPOSE_BUDGET_MS);
  assert.equal(depasse.tenu, false);
  assert.match(depasse.verdict, /NE tient PAS/);

  // Frontière stricte : net === budget ne tient pas.
  const frontiere = resumeCompositionChampLumineux({
    compositionBrutMs: 150,
    agrandissementBrutMs: 150,
    relectureMs: 0,
    sourceCount: 1,
  });
  assert.equal(frontiere.totalNetMs, LIGHT_FIELD_COMPOSE_BUDGET_MS);
  assert.equal(frontiere.tenu, false, 'net === budget ne tient pas le critère (comparaison stricte)');

  // Une relecture plus chère que l'opération ne rend pas un temps négatif.
  assert.equal(resumeCompositionChampLumineux({
    compositionBrutMs: 0.3, agrandissementBrutMs: 0.3, relectureMs: 1.2, sourceCount: 1,
  }).totalNetMs, 0);

  // Mesures absurdes : pas de verdict favorable par accident.
  assert.throws(() => resumeCompositionChampLumineux({
    compositionBrutMs: NaN, agrandissementBrutMs: 1, relectureMs: 1, sourceCount: 1,
  }), /durée finie/);
  assert.throws(() => resumeCompositionChampLumineux({
    compositionBrutMs: -1, agrandissementBrutMs: 1, relectureMs: 1, sourceCount: 1,
  }), /négatif/);
  assert.throws(() => resumeCompositionChampLumineux({
    compositionBrutMs: 1, agrandissementBrutMs: 1, relectureMs: 1, sourceCount: -1,
  }), /sourceCount/);
});

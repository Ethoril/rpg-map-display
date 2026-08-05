// @ts-check

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ICONS, assertPaintsWhiteOnly } from '../scripts/install-status-icons.mjs';

import {
  getBadgeTier,
  filterAndSortMarkers,
  getCategoryDots,
  computeBadgeRowLayout,
  computeElevationBadgeLayout,
} from '../js/render/statusBadges.js';

import {
  STATUS_MARKER_IDS,
  BADGE_ROW_SLOTS,
} from '../js/core/constants.js';

import {
  createCampaign,
  createLevel,
  createToken,
  validateCampaign,
  isStatusMarker,
} from '../js/core/schema.js';

test('1. statusBadges.js s\'importe sous Node sans dépendance au DOM', () => {
  assert.equal(typeof getBadgeTier, 'function');
  assert.equal(typeof filterAndSortMarkers, 'function');
  assert.equal(typeof getCategoryDots, 'function');
  assert.equal(typeof computeBadgeRowLayout, 'function');
  assert.equal(typeof computeElevationBadgeLayout, 'function');
});

test('2. Choix du palier d\'affichage selon le diamètre du pion à l\'écran', () => {
  // Pion 1 case (pxPerCell = 140)
  // D = 140 * zoom
  // Tier 'icons' si D * 0.26 >= 14, soit D >= 53.84 px
  // Tier 'category-dots' si 20 <= D < 53.84 px
  // Tier 'single-dot' si D < 20 px

  // Zoom 0.10x -> D = 14 px -> 'single-dot'
  assert.equal(getBadgeTier(140 * 0.10), 'single-dot');
  assert.equal(getBadgeTier(19.9), 'single-dot');

  // Zoom 0.24x (carte entière) -> D = 33.6 px -> 'category-dots'
  assert.equal(getBadgeTier(20), 'category-dots');
  assert.equal(getBadgeTier(140 * 0.24), 'category-dots');
  assert.equal(getBadgeTier(53), 'category-dots');

  // Zoom 0.40x -> D = 56 px -> 'icons'
  assert.equal(getBadgeTier(54), 'icons');
  assert.equal(getBadgeTier(140 * 0.40), 'icons');
  assert.equal(getBadgeTier(140 * 1.00), 'icons');

  // Pion 3 cases (sizeCells = 3, pxPerCell = 140, D = 420 * zoom)
  // Zoom 0.10x -> D = 42 px -> 'category-dots' (alors que le pion 1 case est en single-dot)
  assert.equal(getBadgeTier(420 * 0.10), 'category-dots');
  // Zoom 0.24x -> D = 100.8 px -> 'icons' (alors que le pion 1 case est en category-dots)
  assert.equal(getBadgeTier(420 * 0.24), 'icons');
});

test('3. Ordre canonique et règle des 3 emplacements (BADGE_ROW_SLOTS = 3)', () => {
  // 1 marqueur -> 1 icône, 0 overflow
  const res1 = filterAndSortMarkers(['bleeding']);
  assert.deepEqual(res1.visibleMarkers, ['bleeding']);
  assert.equal(res1.overflowCount, 0);

  // 3 marqueurs non triés -> 3 icônes triées selon l'ordre canonique
  const res3 = filterAndSortMarkers(['bleeding', 'unconscious', 'prone']);
  // Ordre canonique : unconscious (idx 0), prone (idx 1), bleeding (idx 11)
  assert.deepEqual(res3.visibleMarkers, ['unconscious', 'prone', 'bleeding']);
  assert.equal(res3.overflowCount, 0);

  // 5 marqueurs -> 2 icônes (les 2 premières canoniques) + compte +3 (3 emplacements au total)
  const res5 = filterAndSortMarkers(['surprised', 'poisoned', 'unconscious', 'prone', 'stunned']);
  // Canonique complet : unconscious, prone, stunned, poisoned, surprised
  assert.deepEqual(res5.visibleMarkers, ['unconscious', 'prone']);
  assert.equal(res5.overflowCount, 3);
});

test('4. Dédoublonnage par catégorie pour le palier intermédiaire (category-dots)', () => {
  // 3 marqueurs de catégorie 'damage' (ablaze, bleeding, poisoned) -> 1 seul point rouge 'damage'
  const cats1 = getCategoryDots(['ablaze', 'bleeding', 'poisoned']);
  assert.deepEqual(cats1, ['damage']);

  // Mélange multi-catégories -> ordonnées selon le rang canonique des catégories
  const cats2 = getCategoryDots(['surprised', 'bleeding', 'fear', 'deafened']);
  // Categories: control, damage, mind, senses -> Canonical: damage, control, senses, mind
  assert.deepEqual(cats2, ['damage', 'control', 'senses', 'mind']);
});

test('5. Géométrie et invariance de la taille à l\'écran sous divers zooms', () => {
  const tokenWidthMap = 140; // 1 case (ex: 140 px sur la carte)

  // (a) Valeurs absolues en dur calculées pour l'élévation et son seuil de visibilité D >= 40px
  const res10 = computeElevationBadgeLayout(140, 0.10);
  assert.equal(res10.badgeRadiusScreen, 8);
  assert.equal(res10.visible, false);

  const res24 = computeElevationBadgeLayout(140, 0.24);
  assert.equal(res24.badgeRadiusScreen, 8);
  assert.equal(res24.visible, false);

  const res50 = computeElevationBadgeLayout(140, 0.50);
  assert.ok(Math.abs(res50.badgeRadiusScreen - 8.4) < 1e-6);
  assert.equal(res50.visible, true);

  const res100 = computeElevationBadgeLayout(140, 1.00);
  assert.equal(res100.badgeRadiusScreen, 14);
  assert.equal(res100.visible, true);

  const res420_24 = computeElevationBadgeLayout(420, 0.24);
  assert.ok(Math.abs(res420_24.badgeRadiusScreen - 12.096) < 1e-6);
  assert.equal(res420_24.visible, true);

  const res420_100 = computeElevationBadgeLayout(420, 1.00);
  assert.equal(res420_100.badgeRadiusScreen, 14);
  assert.equal(res420_100.visible, true);

  // (b) Occupation exacte de la largeur du pion (0.832 x D pour 3 badges, 0.946 x D pour 4 points)
  const layout3 = computeBadgeRowLayout(tokenWidthMap, 3);
  const rowWidth3 = (layout3.centers[2].x - layout3.centers[0].x) + layout3.badgeRadiusMap * 2;
  assert.ok(Math.abs(rowWidth3 - tokenWidthMap * 0.832) < 1e-6);

  const layout4 = computeBadgeRowLayout(tokenWidthMap, 4, 0.22);
  const rowWidth4 = (layout4.centers[3].x - layout4.centers[0].x) + layout4.badgeRadiusMap * 2;
  assert.ok(Math.abs(rowWidth4 - tokenWidthMap * 0.946) < 1e-6);

  // Aucun badge ne déborde du pion
  for (const c of layout3.centers) {
    assert.ok(c.x - layout3.badgeRadiusMap >= -1e-6);
    assert.ok(c.x + layout3.badgeRadiusMap <= tokenWidthMap + 1e-6);
  }

  // (c) Frontières de palier strictes à 53.85 px (14/0.26) et 20 px
  assert.equal(getBadgeTier(53.85), 'icons');
  assert.equal(getBadgeTier(53.84), 'category-dots');
  assert.equal(getBadgeTier(20.0), 'category-dots');
  assert.equal(getBadgeTier(19.9), 'single-dot');

  // Test de la taille écran des marqueurs (badgeRadiusMap * zoom) sous divers zooms
  const zooms = [0.1, 0.24, 0.5, 1.0, 2.5, 5.0];

  for (const z of zooms) {
    const layout = computeBadgeRowLayout(tokenWidthMap, 3);
    const tokenDiameterScreen = tokenWidthMap * z;
    const screenRadiusMeasured = layout.badgeRadiusMap * z;
    // Ratio relatif sur la largeur du pion : exactement 0.13 (diamètre 26 %)
    assert.ok(
      Math.abs(screenRadiusMeasured / tokenDiameterScreen - 0.13) < 1e-6,
      `Ratio écran du badge par rapport au pion constant à zoom ${z}`
    );
  }
});

test('6. Validation du Schéma pour token.markers', () => {
  // Valide isStatusMarker
  assert.equal(isStatusMarker('prone'), true);
  assert.equal(isStatusMarker('unconscious'), true);
  assert.equal(isStatusMarker('poisonned'), false); // Faute de frappe
  assert.equal(isStatusMarker(123), false);

  const campaign = createCampaign();
  const level = createLevel({ id: 'rdc' });
  campaign.levels = [level];

  // Token valide avec markers
  const validToken = createToken({
    id: 'tok-1',
    levelId: 'rdc',
    markers: ['prone', 'unconscious'],
  });
  campaign.tokens = [validToken];
  assert.deepEqual(validateCampaign(campaign), []);

  // Marker inconnu
  const invalidToken1 = createToken({
    id: 'tok-2',
    levelId: 'rdc',
    // @ts-ignore
    markers: ['poisonned'],
  });
  campaign.tokens = [invalidToken1];
  const errs1 = validateCampaign(campaign);
  assert.equal(errs1.length, 1);
  assert.match(errs1[0], /marqueur d'état inconnu "poisonned"/);

  // Doublon de marker
  const invalidToken2 = createToken({
    id: 'tok-3',
    levelId: 'rdc',
    markers: ['prone', 'prone'],
  });
  campaign.tokens = [invalidToken2];
  const errs2 = validateCampaign(campaign);
  assert.equal(errs2.length, 1);
  assert.match(errs2[0], /marqueur d'état en doublon "prone"/);
});

test('7. Les quatorze fichiers d\'icônes existent et ne peignent que du blanc', () => {
  // Le nom de fichier EST l'identifiant (CdC Q7) : la table de l'installateur et la liste
  // close des marqueurs n'ont donc pas le droit de diverger.
  assert.deepEqual(Object.keys(ICONS).sort(), [...STATUS_MARKER_IDS].sort());

  for (const id of STATUS_MARKER_IDS) {
    const path = fileURLToPath(new URL(`../assets/icons/status/${id}.svg`, import.meta.url));
    const svg = readFileSync(path, 'utf8').trim();
    // Un fond noir laissé en place masquerait le pion, et une icône sans dimension
    // intrinsèque ne se dessine pas de façon fiable via drawImage : les deux échouent à
    // la table de jeu, pas à l'exécution. D'où le contrôle ici, sur les fichiers réels.
    const { size, whiteRefs } = assertPaintsWhiteOnly(svg, id);
    assert.ok(size > 0, `${id} : dimension nulle`);
    assert.ok(whiteRefs > 0, `${id} : aucune couleur`);
  }

  // Et la vérification mord : un anneau blanc sans `fill` se remplirait de noir.
  assert.throws(
    () =>
      assertPaintsWhiteOnly(
        '<svg width="256" height="256" viewBox="0 0 256 256"><circle stroke="#fff" r="101"/></svg>',
        'sonde'
      ),
    /peindrait en noir/
  );
  // …et un carré de fond conservé, de même.
  assert.throws(
    () =>
      assertPaintsWhiteOnly(
        '<svg width="512" height="512" viewBox="0 0 512 512"><path d="M0 0h512v512H0z"/><path fill="#fff" d="M1 1"/></svg>',
        'sonde'
      ),
    /peindrait en noir/
  );
});

// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseUvtt } from '../js/import/uvtt.js';
import { createCampaign, validateCampaign } from '../js/core/schema.js';
import {
  SUPPORTED_EXTENSIONS,
  isVttSource,
  findSidecarVideo,
  posterPathFor,
} from '../scripts/prepare-maps.mjs';

// Exigence de FIXTURES.md §1 : un export réel doit être parsé sans erreur. Les fixtures
// synthétiques ne reproduisent pas ce que produit Dungeondraft — polylignes dégénérées,
// listes de lumières vides, `grid_type` absent, `map_origin` non entier, casse variable.
//
// ⭐ **Deux sources, et c'est ce qui décide si ce test existe.** `fixtures/real/` est ignoré par
// git — les cartes peuvent être sous licence tierce —, donc ce test s'ignorait sur toute machine
// fraîchement clonée **et en CI**. `FIXTURES.md` §1 l'écrivait sans détour : « tant qu'il s'ignore,
// le parsing UVTT n'est validé qu'en théorie ». Il l'a été de sa création, le 28/07/2026, au
// 06/08/2026 : la garantie ne tenait que sur la machine où l'export avait été déposé à la main.
//
// Or le dépôt **versionne** de vrais exports Dungeondraft dans `maps/` — c'est la matière du
// catalogue et de l'outil de préparation. Le test regardait donc au seul endroit où rien n'est
// commité, alors qu'il en avait sous la main. Il lit désormais les deux : `maps/` pour la garantie
// reproductible partout, `fixtures/real/` pour les exports privés que le mainteneur veut éprouver
// sans les publier.
//
// ⚠ Il ne s'ignore plus qu'en l'absence des deux, ce qui n'arrive pas sur un dépôt intact. Si cette
// raison réapparaît un jour, c'est que `maps/` a perdu ses exports — et c'est un défaut, pas une
// configuration.

/** Dossiers fouillés, du plus fiable au plus optionnel. */
const DOSSIERS = ['maps', 'fixtures/real'];

/** @type {{ dossier: string, nom: string, chemin: string }[]} */
const fichiers = [];
for (const rel of DOSSIERS) {
  const dossier = path.resolve(rel);
  if (!fs.existsSync(dossier)) continue;
  for (const nom of fs.readdirSync(dossier)) {
    if (nom.startsWith('.') || !isVttSource(nom)) continue;
    fichiers.push({ dossier: rel, nom, chemin: path.join(dossier, nom) });
  }
}

const raison =
  fichiers.length === 0
    ? `aucun export VTT réel trouvé dans ${DOSSIERS.join(' ni ')} ` +
      `(extensions reconnues : ${SUPPORTED_EXTENSIONS.join(', ')}). ` +
      'Le parsing VTT n\'est validé qu\'en théorie tant que ce test s\'ignore — et `maps/` ' +
      'en versionne normalement, donc cette raison signale un dépôt amputé (cf. docs/FIXTURES.md §1).'
    : undefined;

test('les exports UVTT réels se parsent et produisent une campagne valide', { skip: raison }, () => {
  for (const { dossier, nom, chemin } of fichiers) {
    const brut = fs.readFileSync(chemin, 'utf8');
    const res = parseUvtt(brut);
    const niveau = res.level;
    const contexte = `export réel "${dossier}/${nom}"`;

    // Grille : `grid_type` est souvent absent d'un export Dungeondraft — le carré est le défaut.
    assert.equal(niveau.grid.type, 'square', `${contexte} : type de grille`);
    assert.ok(niveau.pxPerCell > 0, `${contexte} : pxPerCell`);
    assert.ok(niveau.widthCells > 0 && niveau.heightCells > 0, `${contexte} : dimensions`);

    // LE piège du format : la géométrie est en unités de CASE, jamais en pixels. Une
    // conversion accidentelle donnerait des valeurs de l'ordre de widthCells × pxPerCell.
    const limite = Math.max(niveau.widthCells, niveau.heightCells) + 1;
    for (const polyligne of niveau.walls) {
      assert.ok(polyligne.length >= 2, `${contexte} : polyligne dégénérée conservée`);
      for (const p of polyligne) {
        assert.ok(
          Math.abs(p.cellX) <= limite && Math.abs(p.cellY) <= limite,
          `${contexte} : coordonnée de mur hors bornes (${p.cellX}, ${p.cellY}) — ` +
            `unités de case attendues, pas des pixels`
        );
      }
    }

    // Portails : `bounds` (deux points) devient a/b. Une porte perdue est une porte
    // franchissable au lot 2.
    for (const portail of niveau.portals) {
      assert.equal(typeof portail.a.cellX, 'number', `${contexte} : portail sans point a`);
      assert.equal(typeof portail.b.cellX, 'number', `${contexte} : portail sans point b`);
      assert.equal(typeof portail.closed, 'boolean', `${contexte} : portail sans état`);
    }

    // L'offset vient exclusivement de map_origin : aucun champ d'offset n'existe en UVTT.
    assert.equal(typeof niveau.grid.offsetX, 'number', `${contexte} : offsetX`);
    assert.equal(typeof niveau.grid.offsetY, 'number', `${contexte} : offsetY`);

    // L'image est transportée en base64, jamais décodée ici : parseUvtt est pure.
    //
    // ⚠ Exception unique et **conditionnée** : un export vidéo de Dungeon Alchemist porte
    // `"image": ""` — la géométrie est dans le JSON, les pixels dans le fichier vidéo. La
    // garde n'est pas levée pour autant : elle exige alors la présence effective de la
    // vidéo jumelle ET de son affiche. Un export sans image et sans vidéo reste une faute,
    // parce que c'est une carte qui ne s'affichera jamais.
    const video = findSidecarVideo(chemin);
    if (res.imageBase64.length === 0) {
      assert.ok(video, `${contexte} : image absente et aucune vidéo jumelle`);
      assert.ok(
        fs.existsSync(posterPathFor(chemin)),
        `${contexte} : export vidéo sans affiche — lancer scripts/extract-poster.mjs`
      );
    } else {
      assert.ok(res.imageBase64.length > 0, `${contexte} : image absente`);
    }

    // Et le tout doit constituer une campagne acceptée par la validation.
    const erreurs = validateCampaign(createCampaign({ levels: [niveau], tokens: [] }));
    assert.deepEqual(erreurs, [], `${contexte} : campagne invalide`);
  }
});

/**
 * Garde-fou du test ci-dessus, et il ne s'ignore JAMAIS.
 *
 * ⭐ Le défaut réparé le 06/08/2026 n'était pas une assertion fausse, c'était un **skip** : le test
 * ne trouvait rien à parser et s'écartait poliment, si bien que « le parsing UVTT n'est validé qu'en
 * théorie » pouvait rester vrai pendant dix jours sans qu'aucune porte ne rougisse.
 *
 * ⛔ Un `skip` n'est pas un échec. Si la découverte des fichiers se casse — extensions renommées,
 * dossier déplacé, exports retirés de `maps/` —, le test ci-dessus redeviendrait silencieusement
 * inoffensif. Celui-ci est là pour que cette situation soit **rouge** et non « ignorée » : il
 * affirme qu'au moins un export réel **versionné** a bien été trouvé.
 *
 * C'est la leçon de la journée appliquée à elle-même : ce qui garde une garantie doit être gardé à
 * son tour.
 */
test('au moins un export VTT réel versionné est trouvé (le test ci-dessus ne doit jamais s\'ignorer)', () => {
  const versionnes = fichiers.filter((f) => f.dossier === 'maps');
  assert.ok(
    versionnes.length > 0,
    `aucun export VTT réel trouvé dans maps/ — le test de parsing réel s'ignorerait donc, ` +
      `et le format ne serait plus validé que par des fixtures synthétiques. ` +
      `Fichiers vus : ${fichiers.map((f) => `${f.dossier}/${f.nom}`).join(', ') || '(aucun)'}`
  );
});

// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseUvtt } from '../js/import/uvtt.js';
import { createCampaign, validateCampaign } from '../js/core/schema.js';

// Exigence de FIXTURES.md §1 : un export réel doit être parsé sans erreur. Les fixtures
// synthétiques ne reproduisent pas ce que produit Dungeondraft — polylignes dégénérées,
// listes de lumières vides, `grid_type` absent, `map_origin` non entier, casse variable.
//
// `fixtures/real/` est ignoré par git : les cartes peuvent être sous licence tierce. Le test
// s'ignore donc avec une raison explicite quand le dossier est vide, plutôt que d'échouer sur
// une machine fraîchement clonée.

const dossier = path.resolve('fixtures/real');
const fichiers = fs.existsSync(dossier)
  ? fs.readdirSync(dossier).filter((f) => f.toLowerCase().endsWith('.uvtt'))
  : [];

const raison =
  fichiers.length === 0
    ? 'fixtures/real/ est vide : déposer un export UVTT réel (cf. docs/FIXTURES.md §1). ' +
      'Le parsing UVTT n\'est validé qu\'en théorie tant que ce test s\'ignore.'
    : undefined;

test('les exports UVTT réels se parsent et produisent une campagne valide', { skip: raison }, () => {
  for (const nom of fichiers) {
    const brut = fs.readFileSync(path.join(dossier, nom), 'utf8');
    const res = parseUvtt(brut);
    const niveau = res.level;
    const contexte = `fixture réelle "${nom}"`;

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
    assert.ok(res.imageBase64.length > 0, `${contexte} : image absente`);

    // Et le tout doit constituer une campagne acceptée par la validation.
    const erreurs = validateCampaign(createCampaign({ levels: [niveau], tokens: [] }));
    assert.deepEqual(erreurs, [], `${contexte} : campagne invalide`);
  }
});

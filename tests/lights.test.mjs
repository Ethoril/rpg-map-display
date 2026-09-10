// @ts-check

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createCampaign, createLevel, createToken, validateCampaign } from '../js/core/schema.js';
import { applyNetworkEvent } from '../js/app/networkEvents.js';
import { FogLayer, isAmbientLit } from '../js/render/layers/fogLayer.js';
import { collectLightSources } from '../js/render/layers/light.js';
import { gridFor } from '../js/grid/index.js';
import { extractBlockedSegments } from '../js/import/blockedEdges.js';
import { validateTokenCatalog, createTokenFromLibraryEntry } from '../js/import/tokenCatalog.js';
import * as store from '../js/state/store.js';

test('Lumière R3 : ambiante et torche passent par les mutations store/réseau validées', () => {
  store.resetStore();
  const level = createLevel({
    id: 'rdc',
    ambient: { level: 0, baked: false },
  });
  const token = createToken({ id: 'torche', levelId: 'rdc', kind: 'npc', cell: { a: 2, b: 2 } });
  store.loadCampaign(createCampaign({ levels: [level], tokens: [token] }));

  assert.equal(
    applyNetworkEvent({
      type: 'level.ambient',
      payload: { levelId: 'rdc', ambient: { color: '#ffffff', level: 0.5, baked: false } },
      at: Date.now(), by: 'gm',
    }),
    true
  );
  assert.equal(store.getRenderSnapshot().activeLevel?.ambient.level, 0.5);

  assert.equal(
    applyNetworkEvent({
      type: 'token.update',
      payload: {
        tokenId: 'torche',
        patch: { emitsLight: { range: 4, intensity: 1, color: '#ffcc66' } },
      },
      at: Date.now(), by: 'gm',
    }),
    true
  );
  assert.deepEqual(store.getRenderSnapshot().campaign?.tokens[0].emitsLight, {
    range: 4, intensity: 1, color: '#ffcc66',
  });

  assert.equal(
    applyNetworkEvent({
      type: 'level.ambient',
      payload: { levelId: 'rdc', ambient: { color: '#ffffff', level: 2, baked: false } },
      at: Date.now(), by: 'gm',
    }),
    false,
    'une ambiance hors 0..1 reste refusée avant mutation'
  );
  assert.equal(store.getRenderSnapshot().activeLevel?.ambient.level, 0.5);

  assert.equal(
    applyNetworkEvent({
      type: 'token.update',
      payload: { tokenId: 'torche', patch: { emitsLight: { range: 21, intensity: 1, color: '#ffcc66' } } },
      at: Date.now(), by: 'gm',
    }),
    false,
    'une torche au-delà du plafond est refusée avant mutation'
  );
  assert.deepEqual(store.getRenderSnapshot().campaign?.tokens[0].emitsLight, {
    range: 4, intensity: 1, color: '#ffcc66',
  });
  store.resetStore();
});

test('Lumière R3 : le schéma refuse explicitement les sources fixes et portées malformées', () => {
  const level = createLevel({
    id: 'rdc',
    widthCells: 10,
    heightCells: 8,
    lights: [
      /** @type {any} */ ({ id: '', at: { cellX: 11, cellY: -1 }, range: 21, intensity: 2, color: 'orange', shadows: 'oui' }),
      { id: 'dupe', at: { cellX: 2, cellY: 2 }, range: 2, intensity: 1, color: '#ffffff', shadows: true },
      { id: 'dupe', at: { cellX: 3, cellY: 3 }, range: 2, intensity: 1, color: '#ffffff', shadows: true },
    ],
  });
  const token = createToken({
    id: 'torche', levelId: 'rdc', kind: 'npc', cell: { a: 2, b: 2 },
    emitsLight: { range: Infinity, intensity: -1, color: '#gg0000' },
  });
  const malformedEmitter = createToken({
    id: 'pas-objet', levelId: 'rdc', kind: 'npc', cell: { a: 3, b: 2 }, emitsLight: /** @type {any} */ ([]),
  });
  const errors = validateCampaign(createCampaign({ levels: [level], tokens: [token, malformedEmitter] }));

  assert.ok(errors.includes('Étage "rdc" : lumière "inconnue" : id doit être une chaîne non vide'));
  assert.ok(errors.includes('Étage "rdc" : lumière "inconnue" : coordonnées hors limites de l\'étage'));
  assert.ok(errors.includes('Étage "rdc" : lumière "inconnue" : range invalide (nombre entre 0 et 20 attendu)'));
  assert.ok(errors.includes('Étage "rdc" : lumière "inconnue" : intensity invalide (nombre entre 0 et 1 attendu)'));
  assert.ok(errors.includes('Étage "rdc" : lumière "inconnue" : color invalide "orange" (format #RRGGBB attendu)'));
  assert.ok(errors.includes('Étage "rdc" : lumière "inconnue" : shadows doit être un booléen'));
  assert.ok(errors.includes('Étage "rdc" : lumière "dupe" : id dupliqué'));
  assert.ok(errors.includes('Pion "torche" : emitsLight.range invalide (nombre entre 0 et 20 attendu)'));
  assert.ok(errors.includes('Pion "torche" : emitsLight.intensity invalide (nombre entre 0 et 1 attendu)'));
  assert.ok(errors.includes('Pion "torche" : emitsLight.color invalide "#gg0000" (format #RRGGBB attendu)'));
  assert.ok(errors.includes('Pion "pas-objet" : emitsLight doit être null ou un objet'));
});

test('UX-07 : le moteur ne distingue que deux ambiances, et une campagne fractionnaire vaut « jour »', () => {
  /** @param {object} ambient */
  const eclaire = (ambient) =>
    isAmbientLit(createLevel({ id: 'rdc', ambient: /** @type {any} */ (ambient) }));

  // ⭐ Le curseur offrait 21 positions de 0 à 1 par pas de 0,05, et `fogLayer` n'en lisait
  // qu'une chose : `baked || level > 0`. 0,05 et 1,00 étaient rigoureusement indistinguables ;
  // le seul cran qui changeait quoi que ce soit était le passage par zéro.
  assert.equal(eclaire({ level: 0, baked: false }), false, 'nuit');
  assert.equal(eclaire({ level: 1, baked: false }), true, 'jour');

  // Critère 2 : une campagne enregistrée avec une valeur fractionnaire se charge et vaut jour.
  for (const valeur of [0.05, 0.35, 0.5, 0.95]) {
    assert.equal(eclaire({ level: valeur, baked: false }), true, `level ${valeur} vaut « jour »`);
    assert.deepEqual(
      validateCampaign(createCampaign({ levels: [createLevel({ id: 'rdc', ambient: /** @type {any} */ ({ level: valeur, baked: false }) })] })),
      [],
      `une campagne à level ${valeur} doit continuer de se valider`
    );
  }

  // ⛔ **Un étage cuit n'est PLUS éclairé par son seul drapeau — corrigé le 27/08/2026.**
  //
  // Cette ligne disait « la lumière est déjà dans l'image ». Relevé sur les cinq exports réels
  // du dépôt : Dungeon Alchemist écrit `baked_lighting: true` de jour COMME DE NUIT, et quel
  // que soit le mode d'export. Le drapeau ne distingue rien, et l'honorer forçait le plein jour
  // sur la totalité des cartes du mainteneur — y compris celles qu'il venait de régler sur
  // « Nuit », dont le réglage restait sans effet.
  //
  // ⚠ Le champ reste importé, persisté et AFFICHÉ au MJ : l'image peut porter sa lumière
  // peinte, et l'assombrir la doublerait. Mais c'est un avertissement, plus un veto.
  assert.equal(
    eclaire({ level: 0, baked: true }), false,
    '⛔ un étage réglé sur Nuit reste sombre, même annoncé cuit'
  );
  assert.equal(eclaire({ level: 1, baked: true }), true, 'et clair s’il est réglé sur Jour');
});

test('UX-07 critère 4 : aucun rendu ne lit ambient.color, vérifié par recherche', () => {
  // ⛔ Vérification par **recherche dans les sources**, comme le demande le critère : un test de
  // comportement ne pourrait pas prouver l'absence d'une lecture. Le champ est supprimé du
  // modèle, mais les campagnes enregistrées en portent un — si un rendu venait à le relire, il
  // se remettrait à dépendre d'une donnée que plus rien n'alimente.
  const fichiers = fs
    .readdirSync('js/render/layers')
    .filter((nom) => nom.endsWith('.js'))
    .map((nom) => `js/render/layers/${nom}`)
    .concat(['js/render/renderer.js', 'js/app/gm.js', 'js/app/player.js']);

  for (const chemin of fichiers) {
    if (!fs.existsSync(chemin)) continue;
    const source = fs.readFileSync(chemin, 'utf8');
    // On cherche la LECTURE du champ, sous ses deux écritures possibles.
    assert.equal(
      /ambient\s*(\?\.)?\s*\.\s*color|ambient\[['"]color['"]\]/.test(source),
      false,
      `${chemin} lit ambient.color, or ce champ n'existe plus dans le modèle`
    );
  }
});

test('MESURE R3 — testbig150, six PJ et huit sources restent un profil exécutable', () => {
  const campaign = JSON.parse(fs.readFileSync('maps/generated/testbig150.scene.json', 'utf8'));
  const level = campaign.levels[0];
  level.ambient = { color: '#ffffff', level: 0, baked: false };
  level.lights = Array.from({ length: 8 }, (_, index) => ({
    id: `fixed-${index}`,
    at: { cellX: 6 + index * 7, cellY: 10 + (index % 3) * 16 },
    range: 8, intensity: 1, color: '#ffffff', shadows: true,
  }));
  const tokens = Array.from({ length: 6 }, (_, index) =>
    createToken({
      id: `pc-${index}`, levelId: level.id, kind: 'pc', cell: { a: 5 + index * 9, b: 5 + (index % 3) * 18 },
      visionDim: 6, emitsLight: index % 2 ? { range: 5, intensity: 1, color: '#ffcc66' } : null,
    })
  );
  const fogLayer = new FogLayer();
  const started = performance.now();
  fogLayer.updateVision(gridFor(level), level, tokens, { extractSegments: extractBlockedSegments });
  const elapsed = performance.now() - started;
  console.log(
    `[R3] testbig150 — 6 PJ + 8 sources (+3 torches) : ${elapsed.toFixed(2)} ms, `
    + `${fogLayer.getLosPolygons().length} lignes de vue + ${fogLayer.getNearPolygons().length} portées nocturnes`
  );
  assert.ok(Number.isFinite(elapsed));

  // ⭐ **Le décompte est passé de 17 à 6 + 6, et c'est le résultat, pas une régression.**
  //
  // Les 17 d'avant étaient 6 PJ + 8 sources fixes + 3 torches : chaque LUMIÈRE produisait son
  // propre polygone de révélation, parce qu'une lumière était traitée comme un ŒIL. C'est
  // précisément ce que la tranche Z-05 supprime — et avec, la question 9 du §12.
  //
  // Il reste donc exactement deux polygones par PJ, et **rien** pour les onze sources : elles
  // éclairent, elles ne révèlent plus. Le champ lumineux qu'elles composent est intersecté
  // avec ces lignes de vue à la rasterisation, dans `composeVisibleMask`.
  assert.equal(fogLayer.getLosPolygons().length, 6, 'une ligne de vue par PJ, éclairé ou non');
  assert.equal(fogLayer.getNearPolygons().length, 6, 'et une portée nocturne, les six ayant visionDim 6');

  // ⛔ La mutation qui compte : si une seule source redevenait un œil, ce compte bondirait de
  // 11. Les huit sources fixes et les trois torches sont bien là — le test ne serait pas
  // probant si la scène n'en portait aucune.
  assert.equal(level.lights.length, 8);
  assert.equal(tokens.filter((t) => t.emitsLight).length, 3);
  assert.equal(
    fogLayer.getLosPolygons().length + fogLayer.getNearPolygons().length,
    12,
    '⛔ 12, jamais 17 : aucune lumière ne révèle plus par elle-même'
  );
});

test('⭐ Chantier Z — `visionBright` est retiré du modèle, mais une campagne qui en porte un est ACCEPTÉE', () => {
  // ⛔ Le moteur n'a jamais lu qu'un seul rayon de vision. Décision du mainteneur du
  // 26/08/2026 : il n'y en aura qu'un. Dans une zone non éclairée un pion voit jusqu'à
  // `visionDim` ; dans une zone éclairée, jusqu'à sa ligne de vue. `visionBright` sort donc
  // du modèle exécutable — même profil que `settings.ambientLevel` (§12 q.4) et
  // `ambient.color` (UX-07).
  //
  // ⚠ **Mais refuser une campagne enregistrée serait une régression bien plus chère que le
  // défaut corrigé.** C'est ce que ce test protège.

  // 1. La fabrique ne le pose plus.
  const neuf = createToken({ id: 'pj', levelId: 'rdc' });
  assert.equal('visionBright' in neuf, false, 'un pion neuf ne porte plus le champ');
  assert.equal(neuf.visionDim, 12, 'le rayon unique garde sa valeur par défaut');

  // 2. Une campagne ANCIENNE, qui en porte un, est acceptée telle quelle.
  const ancienne = createCampaign({
    levels: [createLevel({ id: 'rdc' })],
    tokens: [/** @type {any} */ ({ ...createToken({ id: 'vieux', levelId: 'rdc' }), visionBright: 6 })],
  });
  const erreurs = validateCampaign(ancienne);
  assert.deepEqual(erreurs, [], `⛔ une campagne enregistrée ne doit JAMAIS être refusée : ${erreurs.join(' | ')}`);

  // 3. Et elle traverse sans être touchée ni relue — c'est exactement ce que fait déjà
  //    `ambient.color` depuis UX-07, et on ne veut pas de deux comportements différents.
  assert.equal(/** @type {any} */ (ancienne.tokens[0]).visionBright, 6);

  // 4. ⭐ La mutation qui compte : remettre `!Number.isFinite(token.visionBright)` dans la
  //    validation ferait rougir le point 2 — un pion neuf n'a plus le champ, donc toute
  //    campagne fraîche serait refusée. C'est le sens de la garde.
  const fraiche = createCampaign({
    levels: [createLevel({ id: 'rdc' })],
    tokens: [createToken({ id: 'neuf', levelId: 'rdc' })],
  });
  assert.deepEqual(validateCampaign(fraiche), [], 'une campagne SANS le champ doit passer');
});

test('⭐ Chantier Z — le catalogue de pions accepte un `visionBright` résiduel sur disque', () => {
  // Les catalogues déjà écrits en portent un ; le refuser casserait la bibliothèque de pions
  // du mainteneur pour un champ que le moteur n'a jamais lu.
  const entree = {
    id: 'gobelin', name: 'Gobelin', imageUrl: 'maps/tokens/gob.webp',
    kind: 'npc', sizeCells: 1, speedCells: 3, visionDim: 10,
    emitsLight: null, borderColor: '#e74c3c', maxHp: 7,
    visionBright: 5,
  };
  const errors = validateTokenCatalog({ version: 1, tokens: [entree] });
  assert.deepEqual(errors, [], '⛔ un champ résiduel ne doit produire AUCUNE erreur');

  // Et la projection vers un pion ne le fait pas revivre.
  const pion = createTokenFromLibraryEntry(/** @type {any} */ (entree), { levelId: 'rdc', cell: { a: 0, b: 0 } });
  assert.equal('visionBright' in pion, false, 'la projection ne ressuscite pas le champ');
  assert.equal(pion.visionDim, 10);
});

/**
 * ⛔ **C-2 — LE TROU DE RÉCEPTION, trouvé le 11/09/2026, et il avait traversé deux tranches.**
 *
 * Les tranches 1 et 2 **publiaient** `light.toggle`, `light.place` et `light.delete` sans que
 * `applyNetworkEvent` n'en applique aucun : le `default` de son `switch` rend `false` **sans un
 * mot**. Sur 34 types publiés dans le projet, ces trois-là étaient les seuls sans destinataire.
 *
 * ⛔ Et ce n'est pas cosmétique : `js/app/player.js` **recalcule son propre champ lumineux**
 * depuis sa copie de `level.lights`, en s'appuyant sur une prémisse écrite — « des sources, que
 * la tablette a déjà toutes ». Fausse tant que ces événements ne lui parviennent pas. Le MJ
 * éteignait une lampe et **le halo restait allumé sur la tablette**, en couleur, jusqu'au F5
 * suivant qui relisait Firestore.
 *
 * ⭐ **Pourquoi rien ne l'a vu** : tous les tests de lumière étaient à UNE SEULE page, côté MJ.
 * Aucun ne faisait franchir la frontière réseau à un événement de lumière. C'est la leçon, plus
 * que le défaut — un chantier réseau testé d'un seul côté ne prouve que la moitié.
 *
 * ⚠ L'assertion porte sur `collectLightSources` — la fonction dont la couche de lumière se sert
 * pour savoir CE QUI ÉCLAIRE — et pas seulement sur le champ `on` du store. Une assertion sur le
 * seul drapeau serait une étiquette ; le nombre de sources retenues est l'effet.
 */
test('⛔ C-2 réception : les QUATRE événements de lampe sont appliqués — sinon la tablette garde son halo', () => {
  store.resetStore();
  const level = createLevel({
    id: 'rdc',
    ambient: { level: 0, baked: false },
    lights: [
      { id: 'l1', at: { cellX: 5, cellY: 5 }, range: 3, intensity: 1, color: '#ffffff', shadows: true, on: true },
    ],
  });
  store.loadCampaign(createCampaign({ levels: [level], tokens: [] }));

  /** Ce que la couche de lumière retiendrait comme sources, à cet instant. */
  const sources = () => {
    const courant = store.getRenderSnapshot().activeLevel;
    if (!courant) return -1;
    return collectLightSources(courant, [], gridFor(courant)).length;
  };
  /** @param {string} id */
  const lampe = (id) =>
    (store.getRenderSnapshot().activeLevel?.lights || []).find((li) => li.id === id) ?? null;

  assert.equal(sources(), 1, 'au départ la lampe allumée éclaire');

  // 1. ÉTEINDRE — le cas exact du défaut : sans ce branchement, la tablette gardait son halo.
  assert.equal(
    applyNetworkEvent({
      type: 'light.toggle',
      payload: { levelId: 'rdc', lightId: 'l1', on: false },
      at: Date.now(), by: 'gm',
    }),
    true,
    '⛔ light.toggle doit être APPLIQUÉ à la réception'
  );
  assert.equal(lampe('l1')?.on, false);
  assert.equal(sources(), 0, '⛔ une lampe éteinte ne doit plus éclairer la tablette');

  // 2. Rejouer la MÊME bascule ne mute rien : état absolu, donc idempotent.
  assert.equal(
    applyNetworkEvent({
      type: 'light.toggle',
      payload: { levelId: 'rdc', lightId: 'l1', on: false },
      at: Date.now(), by: 'gm',
    }),
    false,
    'une lampe déjà éteinte ne remute pas'
  );

  // 3. POSER une seconde lampe : elle doit éclairer chez le destinataire.
  assert.equal(
    applyNetworkEvent({
      type: 'light.place',
      payload: {
        levelId: 'rdc',
        light: { id: 'l2', at: { cellX: 2, cellY: 2 }, range: 4, intensity: 1, color: '#ffdca8', shadows: true, on: true },
      },
      at: Date.now(), by: 'gm',
    }),
    true,
    '⛔ light.place doit être APPLIQUÉ à la réception'
  );
  assert.equal(sources(), 1, 'la lampe posée éclaire, l1 étant toujours éteinte');

  // 4. ⛔ L'INVARIANT DU §7 : `light.place` sur une lampe existante ne RALLUME pas.
  //    C'est « un champ, un écrivain » — `light.toggle` est seul à écrire `on`.
  assert.equal(
    applyNetworkEvent({
      type: 'light.place',
      payload: {
        levelId: 'rdc',
        light: { id: 'l1', at: { cellX: 5, cellY: 5 }, range: 6, intensity: 1, color: '#ffffff', shadows: true, on: true },
      },
      at: Date.now(), by: 'gm',
    }),
    true
  );
  assert.equal(lampe('l1')?.on, false, '⛔ light.place ne doit JAMAIS rallumer une lampe éteinte');
  assert.equal(lampe('l1')?.range, 6, 'mais il corrige bien sa géométrie');
  assert.equal(sources(), 1, 'et elle reste hors du champ, éteinte');

  // 5. DÉPLACER : la position reçue est celle qui compte.
  assert.equal(
    applyNetworkEvent({
      type: 'light.move',
      payload: { levelId: 'rdc', lightId: 'l2', at: { cellX: 7, cellY: 1 } },
      at: Date.now(), by: 'gm',
    }),
    true
  );
  assert.deepEqual(lampe('l2')?.at, { cellX: 7, cellY: 1 });
  assert.equal(lampe('l2')?.on, true, '⛔ light.move ne touche pas non plus à `on`');

  // 6. SUPPRIMER, puis rejouer : idempotent, et sans lever.
  assert.equal(
    applyNetworkEvent({
      type: 'light.delete',
      payload: { levelId: 'rdc', lightId: 'l2' },
      at: Date.now(), by: 'gm',
    }),
    true,
    '⛔ light.delete doit être APPLIQUÉ à la réception'
  );
  assert.equal(lampe('l2'), null);
  assert.equal(sources(), 0, 'plus aucune source : l1 éteinte, l2 supprimée');
  assert.equal(
    applyNetworkEvent({
      type: 'light.delete',
      payload: { levelId: 'rdc', lightId: 'l2' },
      at: Date.now(), by: 'gm',
    }),
    false,
    'une lampe déjà absente rend false sans lever'
  );

  // 7. Et RALLUMER ramène bien la lumière — la bascule marche dans les deux sens.
  assert.equal(
    applyNetworkEvent({
      type: 'light.toggle',
      payload: { levelId: 'rdc', lightId: 'l1', on: true },
      at: Date.now(), by: 'gm',
    }),
    true
  );
  assert.equal(sources(), 1, '⛔ rallumer doit rendre la source au champ');
});

/**
 * ⚠ **Ce test a d'abord été écrit sur une prémisse fausse**, et c'est pour cela qu'il existe sous
 * cette forme. Je croyais qu'une lampe importée arrivait dans le store **sans** champ `on` —
 * les exports UVTT n'en ont pas — et que la garde d'idempotence de `light.toggle` devait donc
 * comparer `(light.on !== false)` à la charge sous peine de remuter toute la carte à chaque
 * rejeu. ⛔ Faux : `normalizeLevel` pose `on = true` au chargement.
 *
 * ⭐ Ce qui rend la garde sûre est donc la **normalisation**, pas le détour dans la garde. C'est
 * ça qui mérite un test : si `normalizeLevel` cessait de poser `on`, une lampe importée porterait
 * `undefined`, et la comparaison stricte d'un autre appelant la ferait muter à chaque rejeu.
 */
test('C-2 réception : une lampe importée SANS champ `on` est NORMALISÉE à allumée, ce qui rend la garde sûre', () => {
  store.resetStore();
  const level = createLevel({
    id: 'rdc',
    ambient: { level: 0, baked: false },
    // ⚠ La conversion est le SUJET du test, pas un contournement : le type `Light` exige `on`,
    // et une scène déjà sur disque — ou n'importe quel export UVTT — ne le porte pas. C'est
    // `normalizeLevel` qui rend cet objet conforme, et c'est ce qu'on vérifie juste après.
    lights: [
      /** @type {any} */ ({ id: 'uvtt', at: { cellX: 3, cellY: 3 }, range: 3, intensity: 1, color: '#ffffff', shadows: true }),
    ],
  });
  store.loadCampaign(createCampaign({ levels: [level], tokens: [] }));

  const lampe = () => (store.getRenderSnapshot().activeLevel?.lights || [])[0];
  assert.equal(
    lampe().on,
    true,
    '⛔ une lampe sans `on` doit arriver NORMALISÉE à allumée — c\'est ce qui rend la garde sûre'
  );
  assert.equal(collectLightSources(
    /** @type {any} */ (store.getRenderSnapshot().activeLevel),
    [],
    gridFor(/** @type {any} */ (store.getRenderSnapshot().activeLevel))
  ).length, 1, 'et elle éclaire');

  // La garde mord donc : « allume-la » sur une lampe déjà allumée ne mute rien.
  assert.equal(
    applyNetworkEvent({
      type: 'light.toggle',
      payload: { levelId: 'rdc', lightId: 'uvtt', on: true },
      at: Date.now(), by: 'gm',
    }),
    false,
    'une lampe déjà allumée ne remute pas'
  );

  // Mais l'éteindre mute, et retire la source du champ.
  assert.equal(
    applyNetworkEvent({
      type: 'light.toggle',
      payload: { levelId: 'rdc', lightId: 'uvtt', on: false },
      at: Date.now(), by: 'gm',
    }),
    true
  );
  assert.equal(lampe().on, false);
  assert.equal(collectLightSources(
    /** @type {any} */ (store.getRenderSnapshot().activeLevel),
    [],
    gridFor(/** @type {any} */ (store.getRenderSnapshot().activeLevel))
  ).length, 0, '⛔ éteinte, elle ne doit plus éclairer');
});

// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { createCampaign, createLevel, validateCampaign } from '../js/core/schema.js';
import { findHitTemplate } from '../js/input/templateHit.js';
import { gridFor } from '../js/grid/index.js';
import { extractBlockedSegments } from '../js/import/blockedEdges.js';
import { sweep } from '../js/vision/sweep.js';
import * as store from '../js/state/store.js';
import { applyNetworkEvent } from '../js/app/networkEvents.js';

test('Occlusion par les murs (L-10) : manoir-rdc à l\'origine {x: 4410, y: 4410}, sweep produit un polygone découpé par les obstacles', () => {
  const scenePath = path.resolve('maps/generated/manoir-rdc.scene.json');
  assert.equal(fs.existsSync(scenePath), true, 'Fichier de scène manoir-rdc.scene.json requis');

  const campaignData = JSON.parse(fs.readFileSync(scenePath, 'utf8'));
  const level = createLevel(campaignData.levels[0]);
  const grid = gridFor(level);
  // (31 + 0.5) * 140 = 4410
  const origin = { x: 4410, y: 4410 };
  const radiusPx = 4 * level.pxPerCell; // 560 px

  const segments = extractBlockedSegments(level, grid);
  assert.ok(segments.length > 0, 'La scène doit comporter des segments d\'obstacles');

  const sweepPoly = sweep(origin, segments, radiusPx);
  assert.ok(Array.isArray(sweepPoly) && sweepPoly.length >= 3, 'Le sweep doit produire un polygone valide');

  // Sans obstacle, un cercle aurait ses sommets à distance exacte du rayon.
  // Avec obstacles (murs), certains sommets sont à distance nettement inférieure au rayon (occultation).
  const hasShortVertex = sweepPoly.some((pt) => {
    const dist = Math.hypot(pt.x - origin.x, pt.y - origin.y);
    return dist < radiusPx - 5;
  });
  assert.equal(hasShortVertex, true, 'Un mur doit arrêter la visibilité du sweep en deçà du rayon maximum');
});

test('Store placeTemplate, moveTemplate et clearTemplates (idempotence, déplacement, pivot, isolation)', () => {
  store.resetStore();
  const lvl1 = createLevel({ id: 'lvl1', name: 'Étage 1' });
  const lvl2 = createLevel({ id: 'lvl2', name: 'Étage 2' });
  const campaign = createCampaign({ levels: [lvl1, lvl2] });
  store.loadCampaign(campaign);

  const t1 = {
    id: 'tpl-1',
    levelId: 'lvl1',
    shape: /** @type {const} */ ('circle'),
    origin: { x: 350, y: 350 },
    radiusCells: 3,
    directionDeg: 0,
    widthCells: 1,
    color: '#ef4444',
    visibleToPlayers: true,
  };

  let notifCount = 0;
  const unsub = store.subscribe(() => {
    notifCount++;
  });

  // Placement d'un premier gabarit
  store.placeTemplate(t1);
  const state1 = store.getState();
  assert.equal(state1.campaign?.templates.length, 1);
  assert.equal(state1.campaign?.templates[0].id, 'tpl-1');
  assert.deepEqual(state1.campaign?.templates[0].origin, { x: 350, y: 350 });

  // Reposer le même id remplace l'existant sans le dupliquer
  const t1Modified = { ...t1, radiusCells: 5 };
  store.placeTemplate(t1Modified);
  const state2 = store.getState();
  assert.equal(state2.campaign?.templates.length, 1);
  assert.equal(state2.campaign?.templates[0].radiusCells, 5);

  // Déplacement et rotation via moveTemplate
  store.moveTemplate('tpl-1', { x: 400, y: 450 }, 90);
  const stateMove = store.getState();
  assert.deepEqual(stateMove.campaign?.templates[0].origin, { x: 400, y: 450 });
  assert.equal(stateMove.campaign?.templates[0].directionDeg, 90);

  // Ajouter un gabarit sur l'étage 2
  const t2 = {
    id: 'tpl-2',
    levelId: 'lvl2',
    shape: /** @type {const} */ ('cone'),
    origin: { x: 1400, y: 1400 },
    radiusCells: 2,
    directionDeg: 180,
    widthCells: 1,
    color: '#3b82f6',
    visibleToPlayers: false,
  };
  store.placeTemplate(t2);
  assert.equal(store.getState().campaign?.templates.length, 2);

  // Effacer uniquement l'étage 1 laisse l'étage 2 intact
  store.clearTemplates('lvl1');
  const state3 = store.getState();
  assert.equal(state3.campaign?.templates.length, 1);
  assert.equal(state3.campaign?.templates[0].id, 'tpl-2');

  // Effacer un étage inconnu lève une erreur
  assert.throws(() => store.clearTemplates('lvl-inconnu'), /Étage inconnu/);

  unsub();
});

test('UX-05 : store.removeTemplate retire le gabarit désigné, et lui seul', () => {
  store.resetStore();
  const lvl1 = createLevel({ id: 'lvl1', name: 'Étage 1' });
  const campaign = createCampaign({ levels: [lvl1] });
  store.loadCampaign(campaign);

  /** @param {string} id */
  const gabarit = (id) => ({
    id,
    levelId: 'lvl1',
    shape: /** @type {const} */ ('circle'),
    origin: { x: 350, y: 350 },
    radiusCells: 3,
    directionDeg: 0,
    widthCells: 1,
    color: '#ef4444',
    visibleToPlayers: true,
  });

  // ⚠ Trois gabarits, et on retire celui du MILIEU : avec un seul, un code qui retirerait
  // `templates[0]` au lieu du désigné passerait au vert. C'est la faute que ce test défend.
  store.placeTemplate(gabarit('tpl-a'));
  store.placeTemplate(gabarit('tpl-b'));
  store.placeTemplate(gabarit('tpl-c'));

  let notifs = 0;
  const unsub = store.subscribe(() => {
    notifs++;
  });

  assert.equal(store.removeTemplate('tpl-b'), true);
  assert.deepEqual(
    store.getState().campaign?.templates.map((t) => t.id),
    ['tpl-a', 'tpl-c'],
    'seul le gabarit désigné doit partir'
  );
  assert.equal(notifs, 1, 'un retrait effectif notifie une fois');

  // Absence idempotente et silencieuse, sur le modèle de `removeLink` : ni erreur, ni
  // notification. C'est ce qui rend le rejeu de `template.remove` inoffensif.
  assert.equal(store.removeTemplate('tpl-b'), false);
  assert.equal(store.getState().campaign?.templates.length, 2);
  assert.equal(notifs, 1, 'une absence ne doit pas notifier');

  assert.throws(() => store.removeTemplate(''), /Identifiant de gabarit requis/);

  unsub();
});

test('UX-05 : événement réseau template.remove — validé, idempotent au rejeu, malformé refusé', () => {
  store.resetStore();
  const level = createLevel({ id: 'lvl1' });
  store.loadCampaign(createCampaign({ levels: [level] }));

  const template = {
    id: 'tpl-net-remove',
    levelId: 'lvl1',
    shape: /** @type {const} */ ('cone'),
    origin: { x: 700, y: 700 },
    radiusCells: 3,
    directionDeg: 0,
    widthCells: 1,
    color: '#10b981',
    visibleToPlayers: true,
  };
  const autre = { ...template, id: 'tpl-net-garde', origin: { x: 100, y: 100 } };
  store.placeTemplate(template);
  store.placeTemplate(autre);

  /** @param {object} payload */
  const remove = (payload) =>
    applyNetworkEvent({ type: 'template.remove', payload, at: Date.now(), by: 'gm' });

  assert.equal(remove({ templateId: 'tpl-net-remove' }), true);
  assert.deepEqual(
    store.getState().campaign?.templates.map((t) => t.id),
    ['tpl-net-garde'],
    'le voisin du gabarit retiré doit rester'
  );

  // Rejeu : même état, aucun jet. Un réducteur qui lèverait ici emporterait tous les
  // événements suivants du lot (`CONVENTIONS.md` §4 et §6).
  assert.equal(remove({ templateId: 'tpl-net-remove' }), false);
  assert.equal(store.getState().campaign?.templates.length, 1);

  assert.equal(remove({ templateId: 42 }), false);
  assert.equal(remove({}), false);
  assert.equal(store.getState().campaign?.templates.length, 1);
});

test('Schema : validateCampaign valide les origin MapPoint et refuse les gabarits malformés (L-10)', () => {
  const level = createLevel({ id: 'lvl1' });
  const campaign = createCampaign({ levels: [level] });

  // 1. shape inconnue
  const c1 = {
    ...campaign,
    templates: [
      {
        id: 'tpl-bad-shape',
        levelId: 'lvl1',
        shape: 'triangle',
        origin: { x: 100, y: 100 },
        radiusCells: 2,
        directionDeg: 0,
        visibleToPlayers: true,
        color: '#ef4444',
      },
    ],
  };
  const err1 = validateCampaign(c1);
  assert.equal(err1.some((e) => e.includes('tpl-bad-shape') && e.includes('shape invalide')), true);

  // 2. origin invalide (pas un MapPoint avec x et y finis)
  const c2 = {
    ...campaign,
    templates: [
      {
        id: 'tpl-bad-origin',
        levelId: 'lvl1',
        shape: 'circle',
        origin: { a: 1, b: 2 }, // Ancienne forme non migrée
        radiusCells: 2,
        directionDeg: 0,
        visibleToPlayers: true,
        color: '#ef4444',
      },
    ],
  };
  const err2 = validateCampaign(c2);
  assert.equal(err2.some((e) => e.includes('tpl-bad-origin') && e.includes('origin invalide')), true);

  // 3. radiusCells nul ou négatif
  const c3 = {
    ...campaign,
    templates: [
      {
        id: 'tpl-neg-radius',
        levelId: 'lvl1',
        shape: 'circle',
        origin: { x: 100, y: 100 },
        radiusCells: -3,
        directionDeg: 0,
        visibleToPlayers: true,
        color: '#ef4444',
      },
    ],
  };
  const err3 = validateCampaign(c3);
  assert.equal(err3.some((e) => e.includes('tpl-neg-radius') && e.includes('radiusCells invalide')), true);

  // 4. directionDeg invalide
  const c4 = {
    ...campaign,
    templates: [
      {
        id: 'tpl-bad-dir',
        levelId: 'lvl1',
        shape: 'cone',
        origin: { x: 100, y: 100 },
        radiusCells: 2,
        directionDeg: 'nord',
        visibleToPlayers: true,
        color: '#ef4444',
      },
    ],
  };
  const err4 = validateCampaign(c4);
  assert.equal(err4.some((e) => e.includes('tpl-bad-dir') && e.includes('directionDeg invalide')), true);
});

test('UX-06 : widthCells — absent vaut 1 sans erreur, invalide refusé en nommant le gabarit', () => {
  const level = createLevel({ id: 'lvl1' });
  const campaign = createCampaign({ levels: [level] });

  /** @param {object} extra */
  const avecGabarit = (extra) => ({
    ...campaign,
    templates: [
      {
        id: 'tpl-largeur',
        levelId: 'lvl1',
        shape: 'line',
        origin: { x: 100, y: 100 },
        radiusCells: 4,
        directionDeg: 0,
        color: '#ef4444',
        visibleToPlayers: true,
        ...extra,
      },
    ],
  });

  // ⛔ Critère 5 : une campagne enregistrée AVANT UX-06 ne porte pas le champ. La rejeter
  // serait une régression plus chère que la forme ajoutée.
  assert.deepEqual(validateCampaign(avecGabarit({})), [], 'un gabarit sans widthCells doit se valider');
  assert.deepEqual(validateCampaign(avecGabarit({ widthCells: 3 })), []);

  // Critère 6 : zéro, négatif, fractionnaire — refusés, et le message nomme le gabarit.
  for (const mauvais of [0, -2, 1.5, '3', null, Number.NaN]) {
    const errs = validateCampaign(avecGabarit({ widthCells: mauvais }));
    assert.equal(
      errs.some((e) => e.includes('tpl-largeur') && e.includes('widthCells invalide')),
      true,
      `widthCells ${JSON.stringify(mauvais)} doit être refusé en nommant le gabarit`
    );
  }
});

test('UX-06 : findHitTemplate désigne une ligne — poignée, corps, et la largeur compte', () => {
  const level = createLevel({ id: 'lvl1', pxPerCell: 140 });
  /** @param {number} widthCells */
  const ligne = (widthCells) => ({
    id: 'tpl-ligne',
    levelId: 'lvl1',
    shape: /** @type {const} */ ('line'),
    origin: { x: 700, y: 700 },
    radiusCells: 4, // 560 px vers l'Est
    directionDeg: 0,
    widthCells,
    color: '#ef4444',
    visibleToPlayers: true,
  });

  // Poignée d'origine : déplacement, comme la pointe du cône.
  const surLaPoignee = findHitTemplate(level, [ligne(1)], { x: 700, y: 700 }, 1, 140, false);
  assert.equal(surLaPoignee?.mode, 'move');

  // Corps : pivot.
  const surLeCorps = findHitTemplate(level, [ligne(1)], { x: 1100, y: 700 }, 1, 140, false);
  assert.equal(surLeCorps?.mode, 'rotate');

  // Au-delà de la longueur : rien. 700 + 560 = 1260.
  assert.equal(findHitTemplate(level, [ligne(1)], { x: 1300, y: 700 }, 1, 140, false), null);

  // ⭐ La largeur compte, et c'est ce qui distingue la ligne du segment : à 100 px de l'axe, le
  // point est DEHORS pour une largeur de 1 case (±70 px) et DEDANS pour 3 cases (±210 px).
  assert.equal(
    findHitTemplate(level, [ligne(1)], { x: 1000, y: 800 }, 1, 140, false),
    null,
    'largeur 1 : un point à 100 px de l\'axe est hors de la ligne'
  );
  assert.equal(
    findHitTemplate(level, [ligne(3)], { x: 1000, y: 800 }, 1, 140, false)?.mode,
    'rotate',
    'largeur 3 : le même point est dans la ligne'
  );

  // Une ligne pivotée : le test se fait dans le repère de l'axe, pas en coordonnées carte.
  const versLeSud = { ...ligne(1), directionDeg: 90 };
  assert.equal(findHitTemplate(level, [versLeSud], { x: 700, y: 1100 }, 1, 140, false)?.mode, 'rotate');
  assert.equal(findHitTemplate(level, [versLeSud], { x: 1100, y: 700 }, 1, 140, false), null);
});

test('Événements réseau template.place et template.move dans networkEvents.js', () => {
  store.resetStore();
  const level = createLevel({ id: 'lvl1' });
  const campaign = createCampaign({ levels: [level] });
  store.loadCampaign(campaign);

  // Payload valide template.place (sans champ cells)
  const template = {
    id: 'tpl-net-1',
    levelId: 'lvl1',
    shape: /** @type {const} */ ('cone'),
    origin: { x: 700, y: 700 },
    radiusCells: 3,
    directionDeg: 0,
    widthCells: 1,
    color: '#10b981',
    visibleToPlayers: true,
  };

  const res1 = applyNetworkEvent({
    type: 'template.place',
    payload: { template },
    at: Date.now(),
    by: 'gm',
  });
  assert.equal(res1, true);
  assert.equal(store.getState().campaign?.templates.length, 1);

  // Événement template.move
  const resMove = applyNetworkEvent({
    type: 'template.move',
    payload: { templateId: 'tpl-net-1', origin: { x: 800, y: 850 }, directionDeg: 45 },
    at: Date.now(),
    by: 'players',
  });
  assert.equal(resMove, true);
  const tplMoved = store.getState().campaign?.templates[0];
  assert.deepEqual(tplMoved?.origin, { x: 800, y: 850 });
  assert.equal(tplMoved?.directionDeg, 45);

  // Payload malformé refusé
  const res2 = applyNetworkEvent({
    type: 'template.move',
    payload: { templateId: 'tpl-net-1', origin: null },
    at: Date.now(),
    by: 'players',
  });
  assert.equal(res2, false);

  // Effacement valide template.clear
  const resClear = applyNetworkEvent({
    type: 'template.clear',
    payload: { levelId: 'lvl1' },
    at: Date.now(),
    by: 'gm',
  });
  assert.equal(resClear, true);
  assert.equal(store.getState().campaign?.templates.length, 0);
});

test('Vérification d\'isolation (L-10) : aucun résidu d\'énumération de cases dans templates.js', () => {
  const codeTemplates = fs.readFileSync('js/render/layers/templates.js', 'utf8');

  assert.equal(codeTemplates.includes('computeTemplateCells'), false, 'templates.js ne doit plus exporter ni utiliser computeTemplateCells');
  assert.equal(codeTemplates.includes('getSessionTemplateCells'), false, 'templates.js ne doit plus lire getSessionTemplateCells');
});

// @ts-check
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createCampaign, createLevel, createLink, createToken } from '../js/core/schema.js';
import { addLink, findLinkAtCell, getCampaign, removeLink, resetStore, traverseLink } from '../js/state/store.js';
import { applyNetworkEvent } from '../js/app/networkEvents.js';
import { LinksLayer } from '../js/render/layers/links.js';

function campaign() {
  return createCampaign({ levels: [createLevel({ id: 'rdc', widthCells: 10, heightCells: 8 }), createLevel({ id: 'et1', widthCells: 10, heightCells: 8 })], tokens: [createToken({ id: 'hero', levelId: 'rdc', cell: { a: 1, b: 1 } })] });
}
/** @param {string} type @param {object} payload @returns {import('../js/core/types.js').NetEvent} */
const event = (type, payload) => ({ type, payload, at: Date.now(), by: 'gm' });
beforeEach(() => resetStore());

test('liaisons : ajout transactionnel, bornes et suppression idempotente', () => {
  const data = campaign();
  // Chargement par l'événement scène : même chemin validé que le réseau.
  assert.equal(applyNetworkEvent(event('scene.load', { campaign: data })), true);
  const link = createLink({ id: 'stairs', a: { levelId: 'rdc', at: { cellX: 1, cellY: 1 } }, b: { levelId: 'et1', at: { cellX: 2, cellY: 3 } }, bidirectional: false, gmOnly: true });
  addLink(link);
  assert.equal(getCampaign()?.links[0].bidirectional, false);
  assert.equal(getCampaign()?.links[0].gmOnly, true);
  assert.throws(() => addLink(createLink({ ...link, id: 'outside', b: { levelId: 'et1', at: { cellX: 10, cellY: 3 } } })), /hors limites/);
  assert.throws(() => addLink(createLink({ ...link, id: 'fraction', b: { levelId: 'et1', at: { cellX: 2.5, cellY: 3 } } })), /extrémité "b" invalide/);
  assert.throws(() => addLink(createLink({ ...link, id: 'same-level', b: { levelId: 'rdc', at: { cellX: 2, cellY: 3 } } })), /deux étages distincts/);
  assert.equal(removeLink('stairs'), true);
  assert.equal(removeLink('stairs'), false);
});

test('événements link.add/link.delete sont validés et idempotents; traverseLink reste fonctionnel', () => {
  assert.equal(applyNetworkEvent(event('scene.load', { campaign: campaign() })), true);
  const link = createLink({ id: 'stairs', a: { levelId: 'rdc', at: { cellX: 1, cellY: 1 } }, b: { levelId: 'et1', at: { cellX: 2, cellY: 3 } } });
  assert.equal(applyNetworkEvent(event('link.add', { link })), true);
  assert.equal(applyNetworkEvent(event('link.add', { link })), false);
  assert.deepEqual(traverseLink('hero', 'stairs'), { levelId: 'et1', cell: { a: 2, b: 3 } });
  assert.equal(applyNetworkEvent(event('link.delete', { linkId: 'stairs' })), true);
  assert.equal(applyNetworkEvent(event('link.delete', { linkId: 'stairs' })), false);
  assert.equal(applyNetworkEvent(event('link.add', { link: { id: 'bad' } })), false);
});

test('liaisons : le sens unique est réellement pris de A vers B seulement', () => {
  const data = campaign();
  data.links = [createLink({
    id: 'one-way', bidirectional: false,
    a: { levelId: 'rdc', at: { cellX: 1, cellY: 1 } },
    b: { levelId: 'et1', at: { cellX: 2, cellY: 3 } },
  })];
  assert.equal(applyNetworkEvent(event('scene.load', { campaign: data })), true);
  assert.equal(findLinkAtCell('rdc', { a: 1, b: 1 })?.link.id, 'one-way');
  assert.equal(findLinkAtCell('et1', { a: 2, b: 3 }), null);
  assert.deepEqual(traverseLink('hero', 'one-way'), { levelId: 'et1', cell: { a: 2, b: 3 } });
  assert.throws(() => traverseLink('hero', 'one-way'), /sens unique/);
});

test('link.traverse : destination absolue, rejeu eventId et contradiction sont traités avant mutation', () => {
  const link = createLink({
    id: 'stairs', a: { levelId: 'rdc', at: { cellX: 1, cellY: 1 } },
    b: { levelId: 'et1', at: { cellX: 2, cellY: 3 } },
  });
  assert.equal(applyNetworkEvent(event('scene.load', { campaign: campaign() })), true);
  const add = event('link.add', { link });
  assert.equal(applyNetworkEvent(add), true);
  const traverser = {
    ...event('link.traverse', {
      tokenId: 'hero', linkId: 'stairs', destination: { levelId: 'et1', cell: { a: 2, b: 3 } },
    }),
    eventId: 'link-traverse-once',
  };
  assert.equal(applyNetworkEvent(traverser), true);
  assert.equal(getCampaign()?.tokens[0].levelId, 'et1');
  assert.equal(applyNetworkEvent(traverser), false, 'le rejeu n’inverse pas une liaison bidirectionnelle');
  assert.equal(getCampaign()?.tokens[0].levelId, 'et1');
  assert.equal(
    applyNetworkEvent({ ...traverser, eventId: 'link-traverse-déjà-dans-snapshot' }),
    false,
    'un delta reçu après un snapshot déjà à destination converge sans erreur ni retour'
  );
  assert.equal(getCampaign()?.tokens[0].levelId, 'et1');

  resetStore();
  assert.equal(applyNetworkEvent(event('scene.load', { campaign: campaign() })), true);
  assert.equal(applyNetworkEvent(event('link.add', { link })), true);
  assert.equal(
    applyNetworkEvent({
      ...event('link.traverse', {
        tokenId: 'hero', linkId: 'stairs', destination: { levelId: 'et1', cell: { a: 9, b: 7 } },
      }),
      eventId: 'link-traverse-contradiction',
    }),
    false
  );
  assert.equal(getCampaign()?.tokens[0].levelId, 'rdc', 'une destination contradictoire ne mute rien');
});

test('LinksLayer masque gmOnly aux joueurs et garde le repère explicite au MJ', () => {
  /** @type {string[]} */ const calls = [];
  const context = /** @type {any} */ ({ save() {}, restore() {}, beginPath() {}, arc() {}, fill() {}, stroke() {}, fillText(/** @type {string} */ text) { calls.push(text); }, strokeText() {} });
  const grid = /** @type {any} */ ({ pointFromCell: (/** @type {{a:number,b:number}} */ { a, b }) => ({ x: a * 10, y: b * 10 }) });
  const level = /** @type {any} */ ({ id: 'rdc' });
  const links = [createLink({ id: 'public', label: 'Public', a: { levelId: 'rdc', at: { cellX: 1, cellY: 1 } }, b: { levelId: 'et1', at: { cellX: 1, cellY: 1 } } }), createLink({ id: 'secret', label: 'Secret', gmOnly: true, a: { levelId: 'rdc', at: { cellX: 2, cellY: 2 } }, b: { levelId: 'et1', at: { cellX: 2, cellY: 2 } } })];
  const layer = new LinksLayer();
  assert.equal(layer.render(context, grid, level, links, { role: 'players' }), 1);
  assert.equal(layer.render(context, grid, level, links, { role: 'gm', selectedLinkId: 'secret' }), 2);
  assert.ok(calls.includes('Secret ↔'));

  const oneWay = createLink({ id: 'one-way', bidirectional: false, a: { levelId: 'et1', at: { cellX: 1, cellY: 1 } }, b: { levelId: 'rdc', at: { cellX: 2, cellY: 2 } } });
  assert.equal(layer.render(context, grid, level, [oneWay], { role: 'players' }), 0, 'l’entrée B d’un sens unique est masquée aux joueurs');
  assert.equal(layer.render(context, grid, level, [oneWay], { role: 'gm' }), 1);
});

test('l’invite de franchissement ne s’allume que sur l’extrémité réellement franchissable', () => {
  /** @type {string[]} */ let calls = [];
  const context = /** @type {any} */ ({ save() {}, restore() {}, beginPath() {}, arc() {}, fill() {}, stroke() {}, fillText(/** @type {string} */ text) { calls.push(text); }, strokeText() {} });
  const grid = /** @type {any} */ ({ pointFromCell: (/** @type {{a:number,b:number}} */ { a, b }) => ({ x: a * 10, y: b * 10 }) });
  const level = /** @type {any} */ ({ id: 'rdc' });
  const layer = new LinksLayer();
  // ⚠ L'invite se rend en DEUX passes : le repère au rang `links`, le texte au rang `feedback`,
  // au-dessus du brouillard. Le test suit le même chemin que `js/app/player.js`, sinon il
  // vérifierait un assemblage qui n'existe nulle part.
  /** @param {any} links @param {any} options */
  const rendu = (links, options) => {
    calls = [];
    layer.render(context, grid, level, links, options);
    // Comme `js/app/player.js` : seule la vue joueurs rend l'invite. Le MJ n'a aucun
    // franchissement à faire au doigt, et lui en proposer un serait une invitation morte.
    // `renderPrompt` n'a volontairement pas de paramètre `role` — c'est l'appelant qui décide.
    if (options.role === 'players') {
      layer.renderPrompt(context, grid, level, links, { zoom: options.zoom, promptAtCell: options.promptAtCell });
    }
    return calls;
  };

  const escalier = createLink({ id: 'escalier', kind: 'stairs', a: { levelId: 'rdc', at: { cellX: 3, cellY: 3 } }, b: { levelId: 'et1', at: { cellX: 3, cellY: 3 } } });
  const trappe = createLink({ id: 'trappe', kind: 'hatch', a: { levelId: 'rdc', at: { cellX: 5, cellY: 5 } }, b: { levelId: 'cave', at: { cellX: 5, cellY: 5 } } });

  // Sans pion posé dessus, l'escalier reste le repère discret d'avant : le symbole, rien d'autre.
  assert.deepEqual(rendu([escalier], { role: 'players' }), ['↕']);
  // Pion posé sur une AUTRE case : toujours rien. L'invite suit le pion, pas la sélection.
  assert.deepEqual(rendu([escalier], { role: 'players', promptAtCell: { a: 4, b: 3 } }), ['↕']);

  // ⭐ Le libellé vient du `kind`, que le MJ choisit lui-même dans l'éditeur de liaisons. Il ne
  // vient PLUS du rang de l'étage : `level.order` est une clé de tri d'affichage, à 0 par défaut,
  // et `prepare-maps.mjs` la remplit avec l'index dans le pack — un donjon listant la surface
  // puis les sous-sols aurait fait afficher « monter » à qui descend.
  assert.deepEqual(rendu([escalier], { role: 'players', promptAtCell: { a: 3, b: 3 } }), ['↕', 'Retaper pour prendre l’escalier']);
  assert.deepEqual(rendu([trappe], { role: 'players', promptAtCell: { a: 5, b: 5 } }), ['⇳', 'Retaper pour passer la trappe']);
  const inconnu = createLink({ id: 'inconnu', a: { levelId: 'rdc', at: { cellX: 3, cellY: 3 } }, b: { levelId: 'et1', at: { cellX: 3, cellY: 3 } } });
  inconnu.kind = /** @type {any} */ ('téléporteur');
  assert.deepEqual(rendu([inconnu], { role: 'players', promptAtCell: { a: 3, b: 3 } }), ['↕', 'Retaper pour franchir']);

  // ⭐ Le cœur de ce test : l'invite ne peut promettre que ce que le tap fera. Une liaison MJ
  // seule et l'entrée B d'un sens unique ne sont pas franchissables par les joueurs — et le
  // `store.findLinkAtCell` du tap les refuse. L'écran doit les refuser aussi, sinon un joueur
  // retape indéfiniment un escalier qui ne répondra jamais.
  const secrete = createLink({ id: 'secrete', gmOnly: true, a: { levelId: 'rdc', at: { cellX: 3, cellY: 3 } }, b: { levelId: 'et1', at: { cellX: 3, cellY: 3 } } });
  assert.deepEqual(rendu([secrete], { role: 'players', promptAtCell: { a: 3, b: 3 } }), []);
  const sortie = createLink({ id: 'sortie', bidirectional: false, a: { levelId: 'et1', at: { cellX: 3, cellY: 3 } }, b: { levelId: 'rdc', at: { cellX: 3, cellY: 3 } } });
  assert.deepEqual(rendu([sortie], { role: 'players', promptAtCell: { a: 3, b: 3 } }), []);

  // ⭐ Deux liaisons sur la même case : rien ne l'interdit, et `store.findLinkAtCell` n'en rend
  // qu'une — la première. Deux invites superposées seraient illisibles et l'une des deux
  // mentirait. Une seule, celle que le tap prendra.
  const doublon = createLink({ id: 'doublon', kind: 'ladder', a: { levelId: 'rdc', at: { cellX: 3, cellY: 3 } }, b: { levelId: 'cave', at: { cellX: 3, cellY: 3 } } });
  assert.deepEqual(
    rendu([escalier, doublon], { role: 'players', promptAtCell: { a: 3, b: 3 } }),
    ['↕', '⇵', 'Retaper pour prendre l’escalier']
  );

  // Et le MJ garde son libellé : l'invite est un geste de joueur, il n'en a aucun à faire.
  assert.deepEqual(rendu([escalier], { role: 'gm', promptAtCell: { a: 3, b: 3 } }), ['↕', 'stairs ↔']);
});

test('le repère de liaison ne change pas d’aspect quand le pion se tient dessus', () => {
  // ⭐ Mesuré sur la vue joueurs : le disque ambre d'une première version rendait des pixels
  // **identiques octet pour octet** avant et après sélection. Il fait 10 px écran de rayon au
  // centre de la case, et le pion — qui remplit la case et se dessine trois rangs plus haut — le
  // recouvre entièrement. Ce test fige la simplification : `render` ne connaît plus l'invite du
  // tout, et personne ne doit la lui rendre en croyant ajouter un signal visible.
  /** @type {string[]} */ const ops = [];
  const context = /** @type {any} */ ({
    save() {}, restore() {}, beginPath() {}, arc() {}, fill() {}, stroke() {},
    fillText() {}, strokeText() {},
    set globalAlpha(/** @type {number} */ v) { ops.push(`alpha=${v}`); },
    set fillStyle(/** @type {string} */ v) { ops.push(`fill=${v}`); },
    set strokeStyle(/** @type {string} */ v) { ops.push(`stroke=${v}`); },
    set lineWidth(/** @type {number} */ v) { ops.push(`line=${v}`); },
    set font(/** @type {string} */ v) { ops.push(`font=${v}`); },
  });
  const grid = /** @type {any} */ ({ pointFromCell: (/** @type {{a:number,b:number}} */ { a, b }) => ({ x: a * 10, y: b * 10 }) });
  const level = /** @type {any} */ ({ id: 'rdc' });
  const layer = new LinksLayer();
  const escalier = createLink({ id: 'escalier', a: { levelId: 'rdc', at: { cellX: 3, cellY: 3 } }, b: { levelId: 'et1', at: { cellX: 3, cellY: 3 } } });

  layer.render(context, grid, level, [escalier], { role: 'players', zoom: 1 });
  const sansPion = ops.splice(0, ops.length);
  layer.render(
    context, grid, level, [escalier],
    /** @type {any} */ ({ role: 'players', zoom: 1, promptAtCell: { a: 3, b: 3 } })
  );
  assert.deepEqual(
    ops.splice(0, ops.length),
    sansPion,
    'aucun réglage de contexte ne doit dépendre de la présence du pion : le disque est invisible'
  );
  assert.ok(sansPion.includes('alpha=0.48'), 'le repère joueurs garde son opacité discrète');
});

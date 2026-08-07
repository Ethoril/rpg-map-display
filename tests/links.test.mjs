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

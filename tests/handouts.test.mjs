// @ts-check

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import * as store from '../js/state/store.js';
import { applyNetworkEvent, createSnapshotPayload } from '../js/app/networkEvents.js';
import { createCampaign, createLevel, createToken, validateCampaign } from '../js/core/schema.js';

/** @typedef {import('../js/core/types.js').NetEvent} NetEvent */

beforeEach(() => {
  store.resetStore();
});

test('1. applyNetworkEvent handout.show et handout.hide (idempotence & rejeu)', () => {
  /** @type {NetEvent} */
  const showEvent = {
    type: 'handout.show',
    payload: {
      handout: {
        id: 'handout-1',
        name: 'Lettre du roi',
        imageUrl: './assets/lettre.jpg',
      },
    },
    at: Date.now(),
    by: 'gm',
  };

  // Premier appel
  const changed1 = applyNetworkEvent(showEvent);
  assert.equal(changed1, true);

  const active1 = store.getActiveHandout();
  assert.notEqual(active1, null);
  assert.equal(active1?.id, 'handout-1');
  assert.equal(active1?.name, 'Lettre du roi');
  assert.equal(active1?.imageUrl, './assets/lettre.jpg');

  // Rejeu (idempotence)
  const changed2 = applyNetworkEvent(showEvent);
  assert.equal(changed2, true);
  const active2 = store.getActiveHandout();
  assert.deepEqual(active1, active2);

  // Masquage
  /** @type {NetEvent} */
  const hideEvent = {
    type: 'handout.hide',
    payload: {},
    at: Date.now(),
    by: 'gm',
  };

  const changedHide1 = applyNetworkEvent(hideEvent);
  assert.equal(changedHide1, true);
  assert.equal(store.getActiveHandout(), null);

  // Rejeu masquage
  const changedHide2 = applyNetworkEvent(hideEvent);
  assert.equal(changedHide2, true);
  assert.equal(store.getActiveHandout(), null);
});

test('2. Refus des URLs data: et blob: par le store et networkEvents (sans mutation)', () => {
  assert.equal(store.getActiveHandout(), null);

  // Tentative data: direct store
  assert.throws(() => {
    store.setActiveHandout({
      id: 'bad-1',
      name: 'Image data',
      imageUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    });
  }, /imageUrl/i);
  assert.equal(store.getActiveHandout(), null);

  // Tentative blob: direct store
  assert.throws(() => {
    store.setActiveHandout({
      id: 'bad-2',
      name: 'Image blob',
      imageUrl: 'blob:http://localhost:3000/550e8400-e29b-41d4-a716-446655440000',
    });
  }, /imageUrl/i);
  assert.equal(store.getActiveHandout(), null);

  // Tentative networkEvent data:
  /** @type {NetEvent} */
  const badEvent = {
    type: 'handout.show',
    payload: {
      handout: {
        id: 'bad-3',
        name: 'Network Data',
        imageUrl: 'data:image/png;base64,12345',
      },
    },
    at: Date.now(),
    by: 'gm',
  };

  const res = applyNetworkEvent(badEvent);
  assert.equal(res, false);
  assert.equal(store.getActiveHandout(), null);
});

test('3. Aller-retour createSnapshotPayload -> restoreFromSnapshot conservant le handout', () => {
  store.setActiveHandout({
    id: 'snap-handout',
    name: 'Carte du trésor',
    imageUrl: './maps/treasure.jpg',
  });

  const snapshot = createSnapshotPayload();
  assert.notEqual(snapshot.activeHandout, null);
  assert.equal(snapshot.activeHandout?.id, 'snap-handout');

  // Réinitialiser le store
  store.resetStore();
  assert.equal(store.getActiveHandout(), null);

  // Restaurer
  store.restoreFromSnapshot(snapshot);
  const restored = store.getActiveHandout();
  assert.notEqual(restored, null);
  assert.equal(restored?.id, 'snap-handout');
  assert.equal(restored?.name, 'Carte du trésor');
  assert.equal(restored?.imageUrl, './maps/treasure.jpg');
});

test('4. applyNetworkEvent token.elevation (idempotence & rejeu)', () => {
  const level = createLevel({ id: 'l1', name: 'Niveau 1' });
  const token = createToken({
    id: 't-ele-1',
    levelId: 'l1',
    cell: { a: 1, b: 1 },
    label: 'Mage',
  });

  store.loadCampaign(
    createCampaign({
      campaignId: 'c-ele',
      name: 'Campagne Elevation',
      levels: [level],
      tokens: [token],
    })
  );

  /** @type {NetEvent} */
  const eventElevation = {
    type: 'token.elevation',
    payload: {
      tokenId: 't-ele-1',
      elevation: 4,
    },
    at: Date.now(),
    by: 'gm',
  };

  // Premier appel
  const res1 = applyNetworkEvent(eventElevation);
  assert.equal(res1, true);
  assert.equal(store.getCampaign()?.tokens[0].elevation, 4);

  // Rejeu (idempotence)
  const res2 = applyNetworkEvent(eventElevation);
  assert.equal(res2, true);
  assert.equal(store.getCampaign()?.tokens[0].elevation, 4);
});

test('5. applyNetworkEvent token.elevation refuse pion inconnu ou valeur non finie sans muter le store', () => {
  const level = createLevel({ id: 'l1', name: 'Niveau 1' });
  const token = createToken({
    id: 't-ele-2',
    levelId: 'l1',
    cell: { a: 1, b: 1 },
    label: 'Guerrier',
  });

  store.loadCampaign(
    createCampaign({
      campaignId: 'c-ele-2',
      name: 'Campagne Elevation 2',
      levels: [level],
      tokens: [token],
    })
  );

  // Pion inconnu
  /** @type {NetEvent} */
  const unknownTokenEvent = {
    type: 'token.elevation',
    payload: { tokenId: 'pion-inconnu', elevation: 2 },
    at: Date.now(),
    by: 'gm',
  };
  const resUnknown = applyNetworkEvent(unknownTokenEvent);
  assert.equal(resUnknown, false);
  assert.equal(store.getCampaign()?.tokens[0].elevation, 0);

  // Valeur non finie (NaN / Infinity)
  /** @type {NetEvent} */
  const nonFiniteEvent = {
    type: 'token.elevation',
    payload: { tokenId: 't-ele-2', elevation: Infinity },
    at: Date.now(),
    by: 'gm',
  };
  const resNonFinite = applyNetworkEvent(nonFiniteEvent);
  assert.equal(resNonFinite, false);
  assert.equal(store.getCampaign()?.tokens[0].elevation, 0);
});

/**
 * Charge une campagne d'un étage et d'un pion, pour les scénarios token.update / token.delete.
 * @param {string} tokenId
 */
function loadOneTokenCampaign(tokenId) {
  store.loadCampaign(
    createCampaign({
      campaignId: `c-${tokenId}`,
      name: 'Campagne pion',
      levels: [createLevel({ id: 'l1', name: 'Niveau 1' })],
      tokens: [createToken({ id: tokenId, levelId: 'l1', cell: { a: 1, b: 1 }, label: 'Mage' })],
    })
  );
}

test('6. applyNetworkEvent token.update porte un patch absolu, donc rejouable', () => {
  loadOneTokenCampaign('t-upd-1');

  /** @type {NetEvent} */
  const event = {
    type: 'token.update',
    payload: { tokenId: 't-upd-1', patch: { label: 'Archimage', hidden: true, sizeCells: 2 } },
    at: Date.now(),
    by: 'gm',
  };

  assert.equal(applyNetworkEvent(event), true);
  assert.equal(store.getCampaign()?.tokens[0].label, 'Archimage');
  assert.equal(store.getCampaign()?.tokens[0].hidden, true);
  assert.equal(store.getCampaign()?.tokens[0].sizeCells, 2);

  // Rejeu : le patch portant des valeurs absolues et non des deltas, l'état converge.
  assert.equal(applyNetworkEvent(event), true);
  assert.equal(store.getCampaign()?.tokens[0].label, 'Archimage');
  assert.equal(store.getCampaign()?.tokens[0].sizeCells, 2);
});

test('7. applyNetworkEvent token.update refuse pion inconnu, patch absent et champ hors liste blanche', () => {
  loadOneTokenCampaign('t-upd-2');
  const avant = store.getCampaign();

  /** @param {any} payload */
  const refuse = (payload) => {
    const res = applyNetworkEvent({ type: 'token.update', payload, at: Date.now(), by: 'gm' });
    assert.equal(res, false);
    assert.deepStrictEqual(store.getCampaign(), avant);
  };

  refuse({ tokenId: 'pion-inconnu', patch: { label: 'X' } });
  refuse({ tokenId: 't-upd-2' });
  refuse({ tokenId: 't-upd-2', patch: 'pas-un-objet' });
  // Un tableau est un objet en JS : sans garde explicite il traverserait la validation.
  refuse({ tokenId: 't-upd-2', patch: [] });
  // La liste blanche du store reste seule juge, et son refus ne doit pas remonter en
  // exception jusqu'à la boucle réseau.
  refuse({ tokenId: 't-upd-2', patch: { cell: { a: 9, b: 9 } } });
  refuse({ tokenId: 't-upd-2', patch: { levelId: 'l2' } });
});

test('8. applyNetworkEvent token.delete converge, et son rejeu n’est pas une anomalie', () => {
  loadOneTokenCampaign('t-del-1');

  /** @type {NetEvent} */
  const event = {
    type: 'token.delete',
    payload: { tokenId: 't-del-1' },
    at: Date.now(),
    by: 'gm',
  };

  assert.equal(applyNetworkEvent(event), true);
  assert.equal(store.getCampaign()?.tokens.length, 0);

  // Rejeu : `false` parce que rien n'a changé — le pion est déjà absent, donc l'état visé
  // est atteint. C'est le cas nominal d'une reconnexion qui rejoue les événements.
  assert.equal(applyNetworkEvent(event), false);
  assert.equal(store.getCampaign()?.tokens.length, 0);

  // tokenId manquant ou non textuel : refusé sans toucher au store.
  loadOneTokenCampaign('t-del-2');
  const avant = store.getCampaign();
  assert.equal(
    applyNetworkEvent({ type: 'token.delete', payload: {}, at: Date.now(), by: 'gm' }),
    false
  );
  assert.equal(
    applyNetworkEvent({ type: 'token.delete', payload: { tokenId: 42 }, at: Date.now(), by: 'gm' }),
    false
  );
  assert.deepStrictEqual(store.getCampaign(), avant);
});

// ── Chantier C-3, tranche A — la bibliothèque d'images de séance ─────────────────────────

/**
 * Campagne d'un étage, sans aucun pion : le décor minimal des scénarios de bibliothèque.
 * @param {string} campaignId
 */
function campagneVide(campaignId) {
  return createCampaign({
    campaignId,
    name: 'Campagne handouts',
    levels: [createLevel({ id: 'l1', name: 'Niveau 1' })],
    tokens: [],
  });
}

test('9. Une campagne enregistrée SANS bibliothèque charge, et rend une bibliothèque vide', () => {
  const heritee = campagneVide('c-h9');
  // Le champ n'existait pas avant C-3 : on retire celui que `createCampaign` pose aujourd'hui,
  // pour tenir en main exactement ce qui dort sur le disque du mainteneur.
  delete heritee.handoutLibrary;
  assert.equal('handoutLibrary' in heritee, false);

  // Le validateur ne doit pas produire une seule erreur à cause de cette absence.
  assert.deepEqual(validateCampaign(heritee), []);

  // Et le chargement passe, au lieu de refuser la campagne en bloc.
  store.loadCampaign(heritee);
  assert.deepEqual(store.getHandoutLibrary(), []);
});

test('10. Ajouter une entrée la persiste, et son identifiant l\'adresse encore après un F5', () => {
  store.setSessionId('sess-handout-lib');
  store.loadCampaign(campagneVide('c-h10'));

  const ajoutee = store.addHandoutToLibrary({
    name: 'Lettre du roi',
    imageUrl: './maps/minimal.webp',
  });
  assert.ok(ajoutee.id);
  assert.ok(Number.isFinite(ajoutee.addedAt));

  // Révélation depuis l'entrée : c'est l'identifiant de la bibliothèque qui part, pas un
  // identifiant refabriqué pour l'occasion.
  const reveler = () => {
    const entree = store.getHandoutLibrary()[0];
    store.setActiveHandout({ id: entree.id, name: entree.name, imageUrl: entree.imageUrl });
    return store.getActiveHandout();
  };

  const premiere = reveler();
  store.setActiveHandout(null);
  const seconde = reveler();
  assert.equal(premiere?.id, seconde?.id);
  // L'identifiant ADRESSE l'entrée : c'est ce qui manquait avant C-3.
  assert.ok(store.getHandoutLibrary().some((e) => e.id === seconde?.id));

  // F5 : le store est vidé, puis relu depuis le stockage local. ⚠ La session est détachée
  // AVANT, sinon `resetStore` sauvegarde son propre vide par-dessus l'enregistrement — ce qu'un
  // vrai rechargement de page ne fait pas, puisqu'il repart d'un module neuf.
  store.setSessionId(null);
  store.resetStore();
  assert.deepEqual(store.getHandoutLibrary(), []);
  assert.equal(store.loadFromLocalStorage('sess-handout-lib'), true);

  const relue = store.getHandoutLibrary();
  assert.equal(relue.length, 1);
  assert.equal(relue[0].id, ajoutee.id, 'l\'identifiant doit survivre à la persistance');
  assert.equal(relue[0].name, 'Lettre du roi');
  assert.equal(relue[0].imageUrl, './maps/minimal.webp');
  assert.equal(relue[0].addedAt, ajoutee.addedAt);

  // Et il adresse toujours l'entrée relue, donc une révélation d'avant le F5 reste reconnue.
  assert.ok(relue.some((e) => e.id === premiere?.id));

  store.setSessionId(null);
});

test('11. Révéler une entrée alors qu\'une autre est affichée remplace l\'affichage', () => {
  store.loadCampaign(campagneVide('c-h11'));
  const a = store.addHandoutToLibrary({ name: 'Plan A', imageUrl: './maps/minimal.webp' });
  const b = store.addHandoutToLibrary({ name: 'Plan B', imageUrl: './maps/minimal.json' });

  store.setActiveHandout({ id: a.id, name: a.name, imageUrl: a.imageUrl });
  store.setActiveHandout({ id: b.id, name: b.name, imageUrl: b.imageUrl });

  // Un seul emplacement, donc jamais deux images : c'est B, et A n'est plus affichée.
  assert.equal(store.getActiveHandout()?.id, b.id);
  assert.equal(store.getActiveHandout()?.imageUrl, './maps/minimal.json');
  // La bibliothèque, elle, garde les deux : révéler n'est pas retirer.
  assert.equal(store.getHandoutLibrary().length, 2);
});

test('12. Retirer l\'entrée affichée la fait cesser d\'être affichée ; retirer une autre n\'y touche pas', () => {
  store.loadCampaign(campagneVide('c-h12'));
  const a = store.addHandoutToLibrary({ name: 'Plan A', imageUrl: './maps/minimal.webp' });
  const b = store.addHandoutToLibrary({ name: 'Plan B', imageUrl: './maps/minimal.json' });

  store.setActiveHandout({ id: b.id, name: b.name, imageUrl: b.imageUrl });

  // Retirer une AUTRE entrée ne doit rien changer à ce qui est à l'écran.
  assert.equal(store.removeHandoutFromLibrary(a.id), true);
  assert.equal(store.getActiveHandout()?.id, b.id);

  // Retirer celle qui est affichée la retire aussi de l'écran, sinon la TV garderait une image
  // que le MJ croit supprimée — et plus aucune entrée ne permettrait de la masquer.
  assert.equal(store.removeHandoutFromLibrary(b.id), true);
  assert.equal(store.getActiveHandout(), null);
  assert.deepEqual(store.getHandoutLibrary(), []);

  // Identifiant inconnu : rien retiré, rien masqué, aucune exception.
  assert.equal(store.removeHandoutFromLibrary('handout-inexistant'), false);
});

test('13. Le validateur refuse une bibliothèque mal formée, et nomme l\'entrée fautive', () => {
  /** @param {any} handoutLibrary */
  const erreurs = (handoutLibrary) => {
    const c = campagneVide('c-h13');
    c.handoutLibrary = handoutLibrary;
    return validateCampaign(c);
  };

  assert.deepEqual(erreurs([]), []);
  assert.ok(erreurs('pas-un-tableau').some((e) => /handoutLibrary doit être un tableau/.test(e)));

  const baseValide = { id: 'h1', name: 'A', imageUrl: './maps/minimal.webp', addedAt: 1 };
  assert.deepEqual(erreurs([baseValide]), []);

  // ⛔ Une image de séance ne s'embarque pas dans le document de campagne.
  assert.ok(
    erreurs([{ ...baseValide, imageUrl: 'data:image/png;base64,AAAA' }]).some((e) =>
      /imageUrl non persistable/.test(e)
    )
  );
  assert.ok(erreurs([{ ...baseValide, addedAt: 'hier' }]).some((e) => /addedAt invalide/.test(e)));
  assert.ok(erreurs([{ ...baseValide, id: '' }]).some((e) => /id requis/.test(e)));
  // Deux entrées de même identifiant : on révélerait l'une en croyant retirer l'autre.
  assert.ok(erreurs([baseValide, { ...baseValide }]).some((e) => /id dupliqué/.test(e)));
});



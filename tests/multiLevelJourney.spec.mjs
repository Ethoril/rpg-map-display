// @ts-check
import { test, expect } from '@playwright/test';
import { installBrowserTransport, waitForApp, waitForPlayerVision, setPlayerTestVision } from './browserTestTransport.mjs';

/** @param {string} id @param {string} name @param {number} order */
const level = (id, name, order) => ({ id, name, order, imageUrl: '', videoUrl: null, animatedOverlays: [], pxPerCell: 80, widthCells: 10, heightCells: 8, grid: { type: 'square', offsetX: 0, offsetY: 0, color: '#000000', opacity: 0.25, visible: true }, terrainCost: null, walls: [], portals: [], lights: [], ambient: { level: 1, baked: false } });
const snapshot = {
  campaign: {
    schemaVersion: 2, campaignId: 'journey-3', name: 'Parcours trois étages',
    levels: [level('rdc', 'RDC', 0), level('et1', 'Étage 1', 1), level('cave', 'Cave', -1)],
    links: [
      { id: 'stairs-up', kind: 'stairs', label: 'Montée', a: { levelId: 'rdc', at: { cellX: 2, cellY: 2 } }, b: { levelId: 'et1', at: { cellX: 2, cellY: 2 } }, bidirectional: true, gmOnly: false },
    ],
    tokens: [{ id: 'hero', levelId: 'rdc', cell: { a: 2, b: 2 }, sizeCells: 1, kind: 'pc', imageUrl: '', borderColor: '#00ff00', label: 'Héros', hidden: false, visionBright: 4, visionDim: 6, emitsLight: null, speedCells: 6, playerMovable: true, locked: false, elevation: 0, markers: [], hp: null, health: 'unharmed' }],
    templates: [], settings: {},
  }, activeLevelId: 'rdc', selectedTokenId: null, activeHandout: null,
};

/** @param {import('@playwright/test').Page} page */
const state = (page) => page.evaluate(async () => {
  const store = await import('../js/state/store.js');
  return { activeLevelId: store.getState().activeLevelId, token: store.getCampaign()?.tokens.find((t) => t.id === 'hero') };
});
/** @param {import('@playwright/test').Page} page */
const tapLink = (page) => page.evaluate(() => /** @type {any} */ (window).__RPG_APP__.pointerInput.emit({ type: 'tap', mapPos: { x: 200, y: 200 }, screenPos: { x: 0, y: 0 } }));
/**
 * Tape le bouton de liaison du pion côté joueurs (décision 1 du 22/11/2026, CA1–CA3).
 * @param {import('@playwright/test').Page} page
 * @param {string} [tokenId]
 */
const tapLinkButton = (page, tokenId = 'hero') => page.evaluate(async (id) => {
  const [store, gridMod, linksMod] = await Promise.all([
    import('../js/state/store.js'),
    import('../js/grid/index.js'),
    import('../js/render/layers/links.js'),
  ]);
  const app = /** @type {any} */ (window).__RPG_APP__;
  const { campaign, activeLevel } = store.getState();
  const token = campaign?.tokens.find((t) => t.id === id);
  if (!campaign || !activeLevel || !token) throw new Error(`Pion "${id}" introuvable`);
  const btn = linksMod.boutonLiaison(gridMod.gridFor(activeLevel), activeLevel, campaign.links ?? [], token, {
    zoom: app.camera.zoom,
    turn: store.getTurn(),
    camera: app.camera,
    insetTop: document.getElementById('player-level-tabs')?.offsetHeight ?? 0,
  });
  if (!btn) throw new Error(`Bouton de liaison absent pour "${id}"`);
  app.pointerInput.emit({
    type: 'tap',
    mapPos: { x: btn.rect.x + btn.rect.width / 2, y: btn.rect.y + btn.rect.height / 2 },
    screenPos: { x: 0, y: 0 },
  });
}, tokenId);

test('R3-03/UX-10 — téléportation, découplage des deux vues et fog restauré sur trois étages', async ({ browser }) => {
  const context = await browser.newContext();
  const sessionId = `journey-r3-${Date.now()}`;
  const gm = await context.newPage();
  const player = await context.newPage();
  await Promise.all([installBrowserTransport(gm, sessionId, snapshot), installBrowserTransport(player, sessionId, snapshot)]);
  await Promise.all([gm.goto(`/gm.html?session=${sessionId}`), player.goto(`/player.html?session=${sessionId}`)]);
  await Promise.all([waitForApp(gm), waitForApp(player)]);

  // Le fog est bien indexé par étage : le MJ produit un masque pour le RDC.
  await expect.poll(() => gm.evaluate(async () => (await import('../js/state/store.js')).getSessionFog('rdc')), { timeout: 8000 }).not.toBeNull();

  // Franchir l'escalier par le bouton de liaison (décision 1 du 22/11/2026).
  await waitForPlayerVision(player);
  await tapLinkButton(player);

  // ⭐ UX-10 : le pion monte, **aucun écran ne bouge**. Ce test asseyait l'inverse jusqu'au
  // 18/08/2026 — « Le MJ suit le pion » — et c'est précisément le couplage qu'on a coupé : la
  // vue joueurs est une seule tablette partagée, la faire suivre abandonnait ceux restés en bas.
  await expect.poll(() => state(player), { timeout: 8000 }).toMatchObject({ activeLevelId: 'rdc', token: { levelId: 'et1', cell: { a: 2, b: 2 } } });
  await expect.poll(() => state(gm), { timeout: 8000 }).toMatchObject({ activeLevelId: 'rdc', token: { levelId: 'et1' } });

  // ⭐ Et pourtant l'étage d'arrivée devient CONNU : son masque exploré naît à l'instant où le PJ
  // y obtient une ligne de vue, sans que le MJ ait eu à y aller. Sans cela, le découplage aurait
  // rendu l'étage inatteignable pour la table — un étage sans masque n'est pas « connu » (UX-12).
  await expect.poll(() => gm.evaluate(async () => (await import('../js/state/store.js')).getSessionFog('et1')), { timeout: 8000 }).not.toBeNull();

  // ⭐ **Pour redescendre, la table doit d'abord aller voir là-haut.** C'est la conséquence
  // assumée du découplage : le pion monté ne s'affiche plus sur l'étage affiché, donc on ne peut
  // ni le désigner ni le faire redescendre sans changer d'étage. Le geste qui manque est le
  // sélecteur d'étage de la vue joueurs (UX-12) ; en attendant, on appelle ce que ce sélecteur
  // appellera. ⚠ Ce choix d'étage est **local** : il ne publie rien, et la vue MJ ne bouge pas.
  await player.evaluate(async () => {
    const store = await import('../js/state/store.js');
    store.selectLevel('et1');
  });
  await expect.poll(() => state(player), { timeout: 8000 }).toMatchObject({ activeLevelId: 'et1' });
  expect(await state(gm), 'le choix de la table ne doit pas déplacer le MJ').toMatchObject({ activeLevelId: 'rdc' });

  // Le pion redescend par le bouton de liaison : là encore, aucun écran ne suit.
  await waitForPlayerVision(player);
  await tapLinkButton(player);
  await expect.poll(() => state(player), { timeout: 8000 }).toMatchObject({ activeLevelId: 'et1', token: { levelId: 'rdc' } });
  await expect.poll(() => state(gm), { timeout: 8000 }).toMatchObject({ activeLevelId: 'rdc', token: { levelId: 'rdc' } });

  const fogBeforeReload = await gm.evaluate(async () => { const store = await import('../js/state/store.js'); return [store.getSessionFog('rdc'), store.getSessionFog('et1')]; });
  expect(fogBeforeReload[0]).not.toBeNull(); expect(fogBeforeReload[1]).not.toBeNull();
  await gm.reload(); await waitForApp(gm);
  await expect.poll(() => gm.evaluate(async () => { const store = await import('../js/state/store.js'); return [store.getSessionFog('rdc'), store.getSessionFog('et1')]; }), { timeout: 8000 }).toEqual(fogBeforeReload);
  await context.close();
});

/**
 * Encre blanche dans la bande où seule l'invite peut écrire.
 *
 * ⚠ Cette sonde a d'abord échantillonné **à l'intérieur** de la case, 12 à 34 px au-dessus de son
 * centre. Elle est passée au vert sans l'invite : ce qu'elle mesurait était l'anneau de sélection
 * blanc du pion, qui apparaît au même tap. Un seuil franchi pour la mauvaise raison — le piège
 * exact que la mutation systématique existe pour attraper.
 *
 * La bande est donc calée sur le BORD SUPÉRIEUR de la case et s'arrête 20 px écran au-dessus :
 * l'anneau de sélection culmine à 5,5 px du bord (rayon = demi-case + 4, épaisseur 3), et le
 * disque bleu du repère avec son « ↕ » restent bien plus bas. Il ne reste que l'invite.
 *
 * @param {import('@playwright/test').Page} page
 */
const encreInvite = (page) => page.evaluate(() => {
  const app = /** @type {any} */ (window).__RPG_APP__;
  // Case (2,2), pxPerCell 80 : centre en (200,200), bord supérieur en y = 160.
  const centre = app.camera.mapToScreen({ x: 200, y: 200 });
  const bordHaut = app.camera.mapToScreen({ x: 200, y: 160 });
  const res = app.stage?.resolution ?? 1;
  const largeur = 220;
  const d = app.context.getImageData(
    Math.round((centre.screenX - largeur / 2) * res),
    Math.round((bordHaut.screenY - 48) * res),
    Math.round(largeur * res),
    Math.round(28 * res)
  ).data;
  // Seuil à 150 et non à 200 : garde la sonde valable si l'invite retombait un jour sous une
  // couche teintée. Elle avait bien été mesurée à 178, 255, 178 — du blanc pur vu à travers le
  // vert à 30 % de la zone de déplacement — et un seuil à 200 ne voyait alors AUCUN pixel d'une
  // invite pourtant peinte. L'invite se rend désormais au-dessus du fog, donc après cette zone,
  // et le blanc y est pur ; le seuil bas ne coûte rien et couvre les deux cas.
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] > 150 && d[i + 1] > 150 && d[i + 2] > 150) n++;
  return n / (res * res);
});

test('R3-03 — l’escalier sous un PJ visible affiche son bouton de liaison et disparaît au franchissement', async ({ browser }) => {
  // Amendé le 22/11/2026 (décision 1, CA1–CA3) : le bouton de liaison s'affiche directement
  // au-dessus de tout PJ manipulable posé sur une extrémité franchissable (sans sélection préalable),
  // et son tap franchit la liaison.
  const context = await browser.newContext();
  const sessionId = `journey-invite-${Date.now()}`;
  const gm = await context.newPage();
  const player = await context.newPage();
  await Promise.all([installBrowserTransport(gm, sessionId, snapshot), installBrowserTransport(player, sessionId, snapshot)]);
  await Promise.all([gm.goto(`/gm.html?session=${sessionId}`), player.goto(`/player.html?session=${sessionId}`)]);
  await Promise.all([waitForApp(gm), waitForApp(player)]);

  // PRÉCONDITION, et pas un détail : la vue joueurs dessine les liaisons SOUS le brouillard.
  // Tant que le MJ n'a pas publié de vision, tout est noir et la sonde mesurerait zéro des deux
  // côtés — c'est-à-dire exactement ce qu'une invite absente mesurerait. On attend donc que le
  // pion soit réellement peint, ce qui prouve à la fois la vision reçue et la case dans le cadre.
  await expect.poll(() => player.evaluate(() => {
    const app = /** @type {any} */ (window).__RPG_APP__;
    const p = app.camera.mapToScreen({ x: 200, y: 200 });
    const res = app.stage?.resolution ?? 1;
    const d = app.context.getImageData(Math.round(p.screenX * res), Math.round(p.screenY * res), Math.round(4 * res), Math.round(4 * res)).data;
    let somme = 0;
    for (let i = 0; i < d.length; i += 4) somme += (d[i] + d[i + 1] + d[i + 2]) / 3;
    return somme / (d.length / 4);
  }), { timeout: 8000 }).toBeGreaterThan(20);

  // Le calage de la bande dépend du zoom, que ce test ne fixe pas — il vient de `fitActiveLevel`,
  // donc du viewport et de la taille de l'étage. La bande reste juste entre 0,15 et 2,25 ; hors de
  // là le texte en sortirait par le haut et la sonde mesurerait zéro sur un rendu correct.
  const zoom = await player.evaluate(() => /** @type {any} */ (window).__RPG_APP__.camera.zoom);
  expect(zoom, 'zoom hors du domaine de validité de la sonde').toBeGreaterThan(0.2);
  expect(zoom, 'zoom hors du domaine de validité de la sonde').toBeLessThan(2);

  // Pion visible posé sur l'escalier : le bouton de liaison est immédiatement peint au-dessus.
  await expect.poll(() => encreInvite(player), { timeout: 8000 }).toBeGreaterThan(40);

  // Et il disparaît avec le franchissement, déclenché par son tap.
  await tapLinkButton(player);
  await expect.poll(() => state(player), { timeout: 8000 }).toMatchObject({ token: { levelId: 'et1' } });
  await expect.poll(() => encreInvite(player), { timeout: 8000 }).toBeLessThanOrEqual(2);

  await context.close();
});

test('R3-03 — le MJ bride le pion pendant qu’il est sélectionné : l’invite s’éteint et le tap refuse', async ({ browser }) => {
  // ⭐ Ce test comble un trou prouvé par mutation le 16/08/2026 : en supprimant les deux gardes de
  // `promptAtCellOf`, toute la suite restait verte. Le test voisin « ne traverse ni une liaison MJ
  // seule ni un pion verrouillé » ne regarde que le store et les événements publiés, jamais
  // l'écran — or « l'écran promet ce que le tap refuse » est exactement le défaut que ce lot
  // supprime.
  //
  // ⚠ Et il faut brider le pion APRÈS la sélection, pas dans l'instantané de départ. Une première
  // version partait d'un pion déjà verrouillé et passait au vert **même sans les gardes** : un
  // pion verrouillé ou caché n'est jamais sélectionnable au premier tap, donc `selectedToken`
  // restait nul et les gardes n'étaient jamais atteintes. Le seul chemin qui les atteint est
  // celui de la vraie séance : le MJ change le drapeau alors que le joueur tient déjà le pion —
  // et `updateToken` ne purge pas la sélection, contrairement à `removeToken`.
  for (const interdit of ['locked', 'hidden']) {
    const context = await browser.newContext();
    const sessionId = `journey-bride-${interdit}-${Date.now()}`;
    const gm = await context.newPage();
    const player = await context.newPage();
    await Promise.all([installBrowserTransport(gm, sessionId, snapshot), installBrowserTransport(player, sessionId, snapshot)]);
    await Promise.all([gm.goto(`/gm.html?session=${sessionId}`), player.goto(`/player.html?session=${sessionId}`)]);
    await Promise.all([waitForApp(gm), waitForApp(player)]);
    await waitForPlayerVision(player);
    await expect.poll(() => gm.evaluate(async () => (await import('../js/state/store.js')).getSessionFog('rdc')), { timeout: 8000 }).not.toBeNull();

    // Pion visible posé sur l'escalier (hors préparation) : le bouton de liaison est allumé.
    await expect.poll(() => encreInvite(player), { timeout: 8000 }).toBeGreaterThan(40);
    const rectAvant = await player.evaluate(async () => {
      const [store, gridMod, linksMod] = await Promise.all([
        import('../js/state/store.js'),
        import('../js/grid/index.js'),
        import('../js/render/layers/links.js'),
      ]);
      const app = /** @type {any} */ (window).__RPG_APP__;
      const { campaign, activeLevel } = store.getState();
      const token = campaign?.tokens.find((t) => t.id === 'hero');
      if (!campaign || !activeLevel || !token) return null;
      return linksMod.boutonLiaison(gridMod.gridFor(activeLevel), activeLevel, campaign.links ?? [], token, {
        zoom: app.camera.zoom,
        turn: store.getTurn(),
        camera: app.camera,
        insetTop: document.getElementById('player-level-tabs')?.offsetHeight ?? 0,
      })?.rect ?? null;
    });
    if (!rectAvant) throw new Error('Rectangle du bouton de liaison attendu avant bridage');

    // Le MJ bride le pion. L'événement est celui que publie réellement son panneau.
    await player.evaluate(async (drapeau) => {
      const { applyNetworkEvent } = await import('../js/app/networkEvents.js');
      applyNetworkEvent({
        type: 'token.update',
        payload: { tokenId: 'hero', patch: { [drapeau]: true } },
        at: Date.now(),
        by: 'gm',
      });
    }, interdit);

    // Le bouton s'éteint…
    await expect.poll(() => encreInvite(player), { timeout: 8000 }).toBeLessThanOrEqual(2);
    // …et taper son ancien rectangle refuse aussi.
    await player.evaluate((r) => {
      /** @type {any} */ (window).__RPG_APP__.pointerInput.emit({
        type: 'tap',
        mapPos: { x: r.x + r.width / 2, y: r.y + r.height / 2 },
        screenPos: { x: 0, y: 0 },
      });
    }, rectAvant);
    await player.waitForTimeout(200);
    expect(await state(player), `pion « ${interdit} » : le franchissement doit être refusé`).toMatchObject({
      token: { levelId: 'rdc' },
    });
    await context.close();
  }
});

test('R3-03 — une campagne chargée avec deux PJ empilés se normalise : le second part en réserve, le premier franchit seul', async ({ browser }) => {
  // ⭐ Ce test défendait un comportement que le mainteneur a supprimé À LA RACINE le 10/09/2026
  // — C-6, `docs/QUESTIONS-EN-ATTENTE.md` : « UNE CASE, UN PION, POUR TOUS LES PIONS ». L'empilement
  // devient impossible, entre tous les pions, joueurs comme PNJ ; il n'y a donc plus de second PJ
  // à désigner au doigt. Une campagne ENREGISTRÉE qui en contenait un ne se refuse pas pour
  // autant — précédent `visionBright`/`ambient.color` : la normaliser au chargement coûte moins
  // cher qu'un import refusé. Le pion au plus petit identifiant reste sur la case, l'autre part
  // en réserve.
  const empiles = structuredClone(snapshot);
  empiles.campaign.tokens.unshift(/** @type {any} */ ({
    ...structuredClone(empiles.campaign.tokens[0]), id: 'zzz-second', label: 'Second',
  }));

  const context = await browser.newContext();
  const sessionId = `journey-deuxpj-${Date.now()}`;
  const player = await context.newPage();
  await installBrowserTransport(player, sessionId, empiles);
  await player.goto(`/player.html?session=${sessionId}`);
  await waitForApp(player);

  // « hero » < « zzz-second » : c'est lui qui reste sur le plateau, quel que soit l'ordre du
  // tableau — « zzz-second » a pourtant été inséré EN TÊTE, exprès.
  const etatChargement = await player.evaluate(async () => {
    const store = await import('../js/state/store.js');
    return {
      surLePlateau: store.getState().campaign?.tokens.map((t) => t.id),
      enReserve: store.getReserve().map((t) => t.id),
    };
  });
  expect(etatChargement.surLePlateau).toEqual(['hero']);
  expect(etatChargement.enReserve).toEqual(['zzz-second']);

  // Le survivant franchit l'escalier par le bouton de liaison comme n'importe quel pion seul sur sa case.
  await setPlayerTestVision(player);
  await tapLinkButton(player);
  await expect.poll(() => state(player), { timeout: 8000 }).toMatchObject({
    token: { levelId: 'et1', cell: { a: 2, b: 2 } },
  });
  await context.close();
});

test('R3-03 — une campagne chargée avec un PNJ sur la case d’un PJ se normalise aussi', async ({ browser }) => {
  // ⭐ Même normalisation que le test précédent, mais entre un PNJ et un PJ : C-6 est explicite,
  // la règle porte sur TOUS les pions et pas seulement les PJ entre eux. Avant le 10/09/2026, ce
  // montage reproduisait un vrai défaut — rien n'empêchait le MJ de poser un PNJ sur la case d'un
  // PJ, et l'ordre du tableau décidait ensuite du sort du joueur au tap suivant. Le défaut n'a
  // plus d'objet : l'empilement ne peut plus exister, même par import d'une campagne ancienne.
  const empile = structuredClone(snapshot);
  empile.campaign.tokens.unshift(/** @type {any} */ ({
    id: 'garde', levelId: 'rdc', cell: { a: 2, b: 2 }, sizeCells: 1, kind: 'npc', imageUrl: '',
    borderColor: '#ff0000', label: 'Garde', hidden: false, visionBright: 0, visionDim: 0,
    emitsLight: null, speedCells: 6, playerMovable: false, locked: false, elevation: 0,
    markers: [], hp: null, health: 'unharmed',
  }));

  const context = await browser.newContext();
  const sessionId = `journey-empile-${Date.now()}`;
  const player = await context.newPage();
  await installBrowserTransport(player, sessionId, empile);
  await player.goto(`/player.html?session=${sessionId}`);
  await waitForApp(player);

  // « garde » < « hero » : c'est lui qui reste sur le plateau, « hero » part en réserve.
  const etatChargement = await player.evaluate(async () => {
    const store = await import('../js/state/store.js');
    return {
      surLePlateau: store.getState().campaign?.tokens.map((t) => t.id),
      enReserve: store.getReserve().map((t) => t.id),
    };
  });
  expect(etatChargement.surLePlateau).toEqual(['garde']);
  expect(etatChargement.enReserve).toEqual(['hero']);
  await context.close();
});

test('R3-03 — l’UI joueurs ne traverse ni une liaison MJ seule ni un pion verrouillé', async ({ browser }) => {
  for (const restricted of ['gmOnly', 'locked']) {
    const restrictedSnapshot = structuredClone(snapshot);
    restrictedSnapshot.campaign.links[0].gmOnly = restricted === 'gmOnly';
    restrictedSnapshot.campaign.tokens[0].locked = restricted === 'locked';
    const context = await browser.newContext();
    const player = await context.newPage();
    const sessionId = `journey-restricted-${restricted}-${Date.now()}`;
    await installBrowserTransport(player, sessionId, restrictedSnapshot);
    await player.goto(`/player.html?session=${sessionId}`);
    await waitForApp(player);
    await setPlayerTestVision(player);

    await tapLink(player); await tapLink(player);
    await expect.poll(() => state(player), { timeout: 8000 }).toMatchObject({
      activeLevelId: 'rdc', token: { levelId: 'rdc', cell: { a: 2, b: 2 } },
    });
    await expect(player.evaluate(() =>
      /** @type {any} */ (window).__RPG_TEST_WIRE__.published.filter((/** @type {any} */ event) => event.type === 'link.traverse')
    )).resolves.toHaveLength(0);
    await context.close();
  }
});

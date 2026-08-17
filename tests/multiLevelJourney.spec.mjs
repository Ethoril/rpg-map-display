// @ts-check
import { test, expect } from '@playwright/test';
import { installBrowserTransport, waitForApp } from './browserTestTransport.mjs';

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

test('R3-03 — téléportation, suivi/cadenas MJ et fog restauré restent cohérents sur trois étages', async ({ browser }) => {
  const context = await browser.newContext();
  const sessionId = `journey-r3-${Date.now()}`;
  const gm = await context.newPage();
  const player = await context.newPage();
  await Promise.all([installBrowserTransport(gm, sessionId, snapshot), installBrowserTransport(player, sessionId, snapshot)]);
  await Promise.all([gm.goto(`/gm.html?session=${sessionId}`), player.goto(`/player.html?session=${sessionId}`)]);
  await Promise.all([waitForApp(gm), waitForApp(player)]);

  // Le fog est bien indexé par étage : le MJ produit un masque pour le RDC, puis pour l'étage 1.
  await expect.poll(() => gm.evaluate(async () => (await import('../js/state/store.js')).getSessionFog('rdc')), { timeout: 8000 }).not.toBeNull();

  // Deux taps : sélectionner le pion puis franchir exactement l'escalier. Le MJ suit le pion.
  await tapLink(player); await tapLink(player);
  await expect.poll(() => state(player), { timeout: 8000 }).toMatchObject({ activeLevelId: 'et1', token: { levelId: 'et1', cell: { a: 2, b: 2 } } });
  await expect.poll(() => state(gm), { timeout: 8000 }).toMatchObject({ activeLevelId: 'et1', token: { levelId: 'et1' } });
  await expect.poll(() => gm.evaluate(async () => (await import('../js/state/store.js')).getSessionFog('et1')), { timeout: 8000 }).not.toBeNull();

  // Le cadenas suspend seulement le suivi visuel : le pion redescend mais le MJ reste à l'étage 1.
  await gm.click('#gm-level-lock');
  await expect(gm.locator('#gm-level-lock')).toHaveAttribute('aria-pressed', 'true');
  await tapLink(player); await tapLink(player);
  await expect.poll(() => state(player), { timeout: 8000 }).toMatchObject({ token: { levelId: 'rdc' } });
  await expect.poll(() => state(gm), { timeout: 8000 }).toMatchObject({ activeLevelId: 'et1', token: { levelId: 'rdc' } });

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

test('R3-03 — l’escalier sous le pion sélectionné invite au second tap', async ({ browser }) => {
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

  // Pion non sélectionné : rien au-dessus de la case.
  expect(await encreInvite(player)).toBeLessThanOrEqual(2);

  // Un tap sélectionne le pion, déjà posé sur l'escalier : l'invite s'allume.
  await tapLink(player);
  await expect.poll(() => encreInvite(player), { timeout: 8000 }).toBeGreaterThan(40);

  // Et elle disparaît avec le franchissement, qui emporte la sélection.
  await tapLink(player);
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
    await expect.poll(() => gm.evaluate(async () => (await import('../js/state/store.js')).getSessionFog('rdc')), { timeout: 8000 }).not.toBeNull();

    // Le joueur sélectionne son pion, posé sur l'escalier : l'invite s'allume.
    await tapLink(player);
    await expect.poll(() => encreInvite(player), { timeout: 8000 }).toBeGreaterThan(40);

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

    // L'invite s'éteint…
    await expect.poll(() => encreInvite(player), { timeout: 8000 }).toBeLessThanOrEqual(2);
    // …et le tap refuse aussi. Les deux doivent se taire ensemble : une seule des deux moitiés
    // ferait soit une promesse morte, soit un franchissement invisible.
    await tapLink(player);
    await player.waitForTimeout(200);
    expect(await state(player), `pion « ${interdit} » : le franchissement doit être refusé`).toMatchObject({
      token: { levelId: 'rdc' },
    });
    await context.close();
  }
});

test('R3-03 — deux PJ empilés : taper la case passe de l’un à l’autre', async ({ browser }) => {
  // ⭐ Ce test fige un comportement que le chantier du 16/08/2026 a cassé puis réparé, et que rien
  // ne défendait : la branche « je tape ma propre case » avait d'abord été remontée AVANT la
  // resélection, ce qui rendait le second PJ insélectionnable au doigt tant que le premier l'était.
  // Balayage des 51 specs : aucune ne posait deux `kind: 'pc'` sur la même case. La régression
  // serait donc repassée en silence.
  //
  // ⚠ Ce test décrit le comportement ACTUEL, pas un idéal : voir C-6 dans
  // `docs/QUESTIONS-EN-ATTENTE.md` — `exactTokenAtCell` prend le premier du tableau tandis que
  // `findHitToken` départage par identifiant, et ce désaccord fait franchir le mauvais pion.
  // Le second PJ est en TÊTE du tableau et porte l'identifiant le PLUS GRAND : c'est ce qui met
  // les deux fonctions de désignation en désaccord, et c'est le seul agencement qui atteint la
  // branche de resélection. `findHitToken` départage par identifiant croissant et choisira
  // « hero » ; `exactTokenAtCell` prend le premier du tableau et rendra « zzz-second ».
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

  const selection = () => player.evaluate(async () =>
    (await import('../js/state/store.js')).getState().selectedTokenId);

  // Tap 1 : `findHitToken` départage par identifiant, donc « hero » l'emporte sur « zzz-second ».
  await tapLink(player);
  await expect.poll(selection, { timeout: 8000 }).toBe('hero');
  // Tap 2 : la case porte un autre PJ manipulable, la sélection lui passe. Sans cette branche, on
  // franchirait directement et le second PJ ne serait jamais désignable.
  await tapLink(player);
  await expect.poll(selection, { timeout: 8000 }).toBe('zzz-second');
  await context.close();
});

test('R3-03 — un PNJ posé sur la même case n’empêche pas de prendre l’escalier', async ({ browser }) => {
  // ⭐ Rien n'interdit au MJ de poser un PNJ sur la case où se tient déjà un PJ : `moveTokenToCell`
  // n'interdit pas l'empilement. `exactTokenAtCell` rendait alors le PREMIER pion du tableau, et
  // le tap partait en « case occupée » puis désélectionnait — alors que le joueur avait seulement
  // retapé sa propre case. Il resélectionnait, l'invite se rallumait, le tap refusait encore :
  // boucle sans issue devant toute la table. L'ordre du PNJ dans le tableau décidait du sort du
  // joueur, ce qui est exactement le genre de dépendance qu'un test doit figer.
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

  // Le PNJ est en TÊTE du tableau : c'est lui que `exactTokenAtCell` désigne.
  await tapLink(player); await tapLink(player);
  await expect.poll(() => state(player), { timeout: 8000 }).toMatchObject({
    token: { levelId: 'et1', cell: { a: 2, b: 2 } },
  });
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

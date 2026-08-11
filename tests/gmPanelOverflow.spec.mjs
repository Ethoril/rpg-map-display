// @ts-check
import fs from 'node:fs';
import { test, expect } from '@playwright/test';
import { installBrowserTransport, waitForApp } from './browserTestTransport.mjs';

/**
 * Le panneau MJ ne doit rien laisser dépasser à droite.
 *
 * Constaté en séance le 11/08/2026 : « l'interface disparaît en partie à droite de l'écran,
 * et ça s'est corrigé quand j'ai commencé à entrer des valeurs pour créer un pion ».
 *
 * Cause trouvée : le formulaire du créateur de pions est une grille
 * `grid-template-columns: 140px 1fr`, et **un champ de saisie ne descend pas sous sa largeur
 * intrinsèque** — environ vingt caractères — tant qu'on ne lui donne pas `min-width: 0`. La
 * colonne `1fr` refusait donc de rétrécir, `#token-id` sortait de 26 px, et `#gm-app` étant
 * en `overflow: hidden`, la partie droite était coupée net.
 *
 * ⚠ Pourquoi une garde générale plutôt qu'un test sur ce champ : le piège est structurel. Tout
 * champ ajouté demain dans une grille ou un flex le reproduira, et personne ne s'en souviendra.
 * On vérifie donc l'invariant — rien ne dépasse — onglet par onglet.
 */

const scene = JSON.parse(fs.readFileSync('maps/generated/testvideo-3.scene.json', 'utf8'));
const niveau = scene.levels[0];

const SNAPSHOT = {
  campaign: {
    schemaVersion: 2,
    campaignId: 'panneau-debordement',
    name: 'Panneau',
    levels: [niveau],
    links: [],
    tokens: [],
    templates: [],
    settings: { ambientLevel: 1 },
  },
  activeLevelId: niveau.id,
  selectedTokenId: null,
  activeHandout: null,
};

/** Onglets du panneau, par leur libellé exact tel que rendu. */
const ONGLETS = ['📂 Cartes', 'UVTT', 'Image', 'Pions', 'Handouts', '🌫️ Fog', '🧱 Murs', '↕ Liaisons', '📐 Gabarits', 'Grille'];

// 1024 est la largeur basse annoncée tenue par la phase R0 ; 1440 est le poste du MJ.
for (const largeur of [1024, 1440]) {
  test(`panneau MJ : aucun débordement à droite, tous onglets, ${largeur} px`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: largeur, height: 900 } });
    const page = await context.newPage();
    /** @type {string[]} */
    const erreurs = [];
    page.on('pageerror', (e) => erreurs.push(e.message));
    // ⚠ Un code de session **réaliste** : `createSessionCode` en produit un de 5 caractères,
    // fait pour être dicté. Un identifiant long et bavard poussait le bouton « Quitter la
    // session » hors du panneau et faisait échouer ce test pour une raison qui n'arrive
    // jamais en séance. La fragilité de l'en-tête aux noms longs est réelle mais distincte,
    // et elle ne doit pas masquer l'invariant qu'on cherche à tenir ici.
    await installBrowserTransport(page, `T${largeur}A`.slice(0, 5).toUpperCase(), SNAPSHOT);
    await page.goto('/gm.html');
    await waitForApp(page);

    /** @returns {Promise<{ debordement: number, coupable: string }>} */
    const mesure = () =>
      page.evaluate(() => {
        const panel = /** @type {HTMLElement} */ (document.getElementById('gm-panel'));
        const rp = panel.getBoundingClientRect();
        let pire = 0;
        let coupable = '';
        for (const el of panel.querySelectorAll('*')) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          const depassement = r.right - rp.right;
          if (depassement > pire) {
            pire = depassement;
            coupable = `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}`;
          }
        }
        return { debordement: pire, coupable };
      });

    /** @type {string[]} */
    const vus = [];
    for (const nom of ONGLETS) {
      const bouton = page.locator('#gm-panel button', { hasText: nom }).first();
      if ((await bouton.count()) === 0) continue;
      await bouton.click();
      await page.waitForTimeout(250);
      const { debordement, coupable } = await mesure();
      vus.push(nom);
      // 1 px de tolérance : les rectangles sont fractionnaires.
      expect(debordement, `onglet « ${nom} » — ${coupable} dépasse de ${Math.round(debordement)} px`)
        .toBeLessThan(1);
    }

    // ⛔ Sans ce contrôle, un changement de libellé d'onglet viderait la boucle et le test
    // deviendrait vert en ne vérifiant plus rien.
    expect(vus.length, `onglets réellement visités : ${vus.join(', ')}`).toBeGreaterThanOrEqual(8);
    expect(erreurs).toEqual([]);
    await context.close();
  });
}

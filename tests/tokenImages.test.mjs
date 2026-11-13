// @ts-check
// Garde-fou de publication des images de pions (chantier « images des pions », CA23) : chaque image que l'outil MJ
// peut envoyer (table copiée de l'outil) et chaque image du catalogue de pions doit exister dans le dépôt.
// ⚠ En local, la bibliothèque `maps/tokens/` est là (non versionnée) et le test passe. Sur un checkout git — la CI —
// il échoue tant que le MJ n'a pas versionné les images : c'est voulu, la publication attend (Pages afficherait des
// pions sans image).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TOKEN_IMAGES } from '../js/core/token-images.js';
import { isTokenLibraryPath } from '../js/core/schema.js';

const racine = fileURLToPath(new URL('../', import.meta.url));
/** @param {string} chemin */
const existe = (chemin) => existsSync(racine + chemin);

test('table des images : chemins valides au contrat, sans doublon', () => {
  assert.ok(TOKEN_IMAGES.length > 0);
  const chemins = TOKEN_IMAGES.map((e) => e.path);
  assert.deepEqual(chemins.filter((c) => !isTokenLibraryPath(c)), [], 'chemin hors contrat §6');
  assert.equal(new Set(chemins).size, chemins.length, 'chemin en double');
});

test('CA23 : chaque image de la table existe dans le dépôt de la carte', () => {
  const absentes = TOKEN_IMAGES.map((e) => e.path).filter((c) => !existe(c));
  assert.deepEqual(absentes, [], `${absentes.length} image(s) de la table absente(s) du dépôt (à versionner par le MJ avant publication)`);
});

test('CA23 : chaque imageUrl de maps/tokens/catalog.json existe dans le dépôt de la carte', () => {
  const catalogue = JSON.parse(readFileSync(`${racine}maps/tokens/catalog.json`, 'utf8'));
  const chemins = /** @type {{ imageUrl: string }[]} */ (catalogue.tokens).map((t) => t.imageUrl);
  assert.ok(chemins.length > 0);
  const absentes = chemins.filter((c) => !existe(c));
  assert.deepEqual(absentes, [], `${absentes.length} image(s) du catalogue absente(s) du dépôt (à versionner par le MJ avant publication)`);
});

test('publication : ce que build-site publie couvre chaque image de la table et du catalogue (Pages sert une liste blanche)', async () => {
  const { publishedTokenAssets } = await import('../scripts/build-site.mjs');
  const publiees = new Set(publishedTokenAssets());
  const catalogue = JSON.parse(readFileSync(`${racine}maps/tokens/catalog.json`, 'utf8'));
  const attendues = [
    ...TOKEN_IMAGES.map((e) => e.path),
    ...(/** @type {{ imageUrl: string }[]} */ (catalogue.tokens)).map((t) => t.imageUrl),
  ];
  const manquantes = attendues.filter((c) => !publiees.has(c));
  assert.deepEqual(manquantes, [], `${manquantes.length} image(s) ne seraient pas publiées : le pion sortirait sans image en production`);
});

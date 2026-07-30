// @ts-check

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(rootDir, 'firebase-config.js'), 'utf8');

/** Les cinq champs sans lesquels FirebaseTransport refuse de se construire. */
const CHAMPS_REQUIS = ['apiKey', 'authDomain', 'databaseURL', 'projectId', 'appId'];

const PAGES_APPLICATIVES = ['gm.html', 'player.html', 'diag.html'];

test('firebase-config.js déclare les cinq champs requis', () => {
  for (const champ of CHAMPS_REQUIS) {
    assert.match(source, new RegExp(`\\b${champ}\\s*:`), `champ manquant : ${champ}`);
  }
});

test('firebase-config.js ne porte AUCUN identifiant du compte technique', () => {
  // Ces valeurs vivent dans le secret GitHub, lu par la CI comme variable d'environnement.
  // Les voir ici signifierait qu'un mot de passe a été commité.
  assert.doesNotMatch(source, /testEmail/i, 'testEmail présent dans un fichier commité');
  assert.doesNotMatch(source, /testPassword/i, 'testPassword présent dans un fichier commité');
  assert.doesNotMatch(source, /password/i, 'un champ « password » figure dans un fichier commité');
});

test('firebase-config.js se désactive sous navigateur piloté', () => {
  // Sans cette garde, les tests e2e qui n'injectent pas de transport trouveraient une
  // configuration, construiraient un FirebaseTransport et attendraient une connexion Google
  // (js/app/session.js:196-201) au lieu de rester en mode local. La suite se bloquerait.
  assert.match(source, /navigator\.webdriver/, 'garde navigator.webdriver absente');
});

test('firebase-config.js n’écrase pas une configuration déjà posée', () => {
  assert.match(
    source,
    /if\s*\(\s*window\.RPG_FIREBASE_CONFIG\s*\)\s*return/,
    'la garde contre l’écrasement a disparu'
  );
});

test('firebase-config.js n’est pas un module ES', () => {
  // Il doit s'exécuter AVANT les modules différés des pages : un `export` ou un `import`
  // en ferait un module, donc différé lui aussi, donc trop tard.
  assert.doesNotMatch(source, /^\s*(export|import)\s/m, 'le fichier est devenu un module ES');
});

test('les trois pages applicatives chargent la configuration avant leur module', () => {
  for (const page of PAGES_APPLICATIVES) {
    const html = fs.readFileSync(path.join(rootDir, page), 'utf8');
    const posConfig = html.indexOf('firebase-config.js');
    const posModule = html.search(/<script\s+type="module"/);

    assert.notEqual(posConfig, -1, `${page} ne charge pas firebase-config.js`);
    assert.notEqual(posModule, -1, `${page} n'a aucun script de module`);
    assert.ok(
      posConfig < posModule,
      `${page} charge firebase-config.js après son module : la configuration arriverait trop tard`
    );
    assert.doesNotMatch(
      html,
      /<script[^>]*firebase-config\.js[^>]*type="module"/,
      `${page} charge firebase-config.js comme un module`
    );
  }
});

test('index.html ne charge PAS la configuration et reste sans script', () => {
  // La page d'accueil n'a besoin d'aucun module, et c'est ce qui l'exempte de la comparaison
  // d'import map de check-deps.mjs. Y ajouter un script casserait cette exemption.
  const html = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /firebase-config\.js/, 'index.html charge la configuration');
  assert.doesNotMatch(html, /<script/, 'index.html contient un script');
});

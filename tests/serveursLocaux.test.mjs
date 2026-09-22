// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';

/**
 * F2 (audit du 22/09/2026) — `decodeURIComponent` était appelé hors `try` dans les deux serveurs
 * locaux. `GET /%E0` levait une `URIError` : exception non rattrapée dans `serve.mjs`, rejet non
 * géré dans `prepare-server.mjs`, et le processus s'arrêtait. Avec `--host 0.0.0.0`, n'importe
 * qui sur le réseau local pouvait le faire tomber d'une seule requête.
 */

/**
 * @param {number} port
 * @param {string} chemin
 * @returns {Promise<number>} code HTTP
 */
function requete(port, chemin) {
  return new Promise((ok, ko) => {
    const req = http.get({ host: '127.0.0.1', port, path: chemin }, (res) => {
      res.resume();
      ok(res.statusCode ?? 0);
    });
    req.on('error', ko);
    req.setTimeout(3000, () => req.destroy(new Error('délai dépassé')));
  });
}

/**
 * @param {string} script
 * @param {string[]} args
 * @param {number} port
 */
async function lancer(script, args, port) {
  const enfant = spawn(process.execPath, [script, '--port', String(port), ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // Attendre que le serveur écoute.
  for (let i = 0; i < 50; i++) {
    try {
      await requete(port, '/');
      return enfant;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  enfant.kill();
  throw new Error(`${script} n'a pas démarré`);
}

for (const [script, args] of /** @type {const} */ ([
  ['scripts/serve.mjs', []],
  ['scripts/prepare-server.mjs', ['--no-open']],
])) {
  test(`F2 : ${script} répond 400 à une URL malformée, et reste debout`, async () => {
    const port = 20000 + Math.floor(Math.random() * 20000);
    const enfant = await lancer(script, [...args], port);
    try {
      assert.equal(await requete(port, '/%E0'), 400);
      assert.ok((await requete(port, '/')) < 500, 'le serveur répond encore après la requête malformée');
    } finally {
      enfant.kill();
    }
  });
}

/**
 * @param {number} port
 * @param {string} chemin
 * @param {Record<string, string>} entetes
 * @param {string} corps
 * @returns {Promise<number>}
 */
function poster(port, chemin, entetes, corps) {
  return new Promise((ok, ko) => {
    const req = http.request({ host: '127.0.0.1', port, path: chemin, method: 'POST', headers: entetes }, (res) => {
      res.resume();
      ok(res.statusCode ?? 0);
    });
    req.on('error', ko);
    req.end(corps);
  });
}

// F3 (audit du 22/09/2026) — l'API de l'outil écrit et supprime des fichiers du dépôt ; une page
// tierce ouverte dans le même navigateur pouvait l'appeler par une requête « simple ».
test('F3 : prepare-server refuse une requête d’API venue d’ailleurs que sa page', async () => {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const enfant = await lancer('scripts/prepare-server.mjs', ['--no-open'], port);
  const corps = JSON.stringify({ id: 'inexistant-f3' });
  try {
    // Page tierce : text/plain, origine étrangère — la requête « simple » du navigateur.
    assert.equal(await poster(port, '/api/maps/delete', { 'content-type': 'text/plain', origin: 'http://evil.example' }, corps), 403);
    // Même en JSON, une origine étrangère est refusée.
    assert.equal(await poster(port, '/api/maps/delete', { 'content-type': 'application/json', origin: 'http://evil.example' }, corps), 403);
    // Rebinding DNS : un nom tiers résolu vers 127.0.0.1.
    assert.equal(await poster(port, '/api/maps/delete', { 'content-type': 'application/json', host: `evil.example:${port}` }, corps), 403);
    // La page de l'outil, elle, passe la garde (l'id inconnu est refusé plus loin, pas par elle).
    const legitime = await poster(port, '/api/maps/delete', { 'content-type': 'application/json', origin: `http://127.0.0.1:${port}` }, corps);
    assert.notEqual(legitime, 403);
  } finally {
    enfant.kill();
  }
});

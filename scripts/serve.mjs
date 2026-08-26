// @ts-check
// Serveur statique minimal pour les tests Playwright et le développement local.
// `STACK.md` §5 autorise « npx serve ou équivalent statique » : c'est l'équivalent, sans
// dépendance et sans installation à la volée. L'application reste du statique pur — ce
// serveur ne fait rien d'autre que servir des fichiers du dépôt.
//
//   node scripts/serve.mjs [--port 4173] [--root .]

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

/**
 * Lit une option `--nom valeur` sur la ligne de commande.
 * @param {string} name
 * @param {string} fallback
 * @returns {string}
 */
function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  const value = i !== -1 ? process.argv[i + 1] : undefined;
  return value ?? fallback;
}

const port = Number(arg('port', '4173'));
const root = path.resolve(repoRoot, arg('root', '.'));

// ⭐ **`--host 0.0.0.0` pour éprouver une branche sur la tablette, sans passer par Pages.**
//
// Le défaut reste `127.0.0.1` : servir sur toutes les interfaces expose le dépôt — cartes et
// portraits compris — à tout le réseau local, et ça ne doit jamais arriver sans l'avoir demandé.
//
// ⚠ Ce chemin existe parce que valider une tranche de rendu **exige** l'écran réel : la porte ne
// juge pas « le rendu est visuellement identique ». Fusionner sur `main` pour regarder reviendrait
// à publier avant d'avoir vu, donc à inverser l'ordre.
const host = arg('host', '127.0.0.1');

/** Types MIME utiles au projet. Un type inconnu est servi en octet-stream, jamais devine. */
const MIME = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.webp', 'image/webp'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.svg', 'image/svg+xml'],
  ['.uvtt', 'application/json; charset=utf-8'],
  // Fonds animés. Chromium accepte parfois un `application/octet-stream` pour un média,
  // par reniflage — mais « parfois » n'est pas un contrat, et la politique de cette table
  // est justement de ne rien deviner. Sans ces deux lignes, la lecture du fond animé tenait
  // à une tolérance du navigateur, non à une déclaration du serveur.
  ['.webm', 'video/webm'],
  ['.mp4', 'video/mp4'],
]);

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
  const relative = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const filePath = path.resolve(root, relative);

  // Traversée de répertoire : refusée. Le serveur ne sort jamais de la racine servie.
  if (filePath !== root && !filePath.startsWith(root + path.sep)) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('403 Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(`404 Not Found: ${relative}`);
      return;
    }
    res.writeHead(200, {
      'content-type': MIME.get(path.extname(filePath).toLowerCase()) ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(data);
  });
});

server.listen(port, host, () => {
  console.log(`Serveur statique : http://${host === '0.0.0.0' ? '<ip-du-poste>' : host}:${port}/  (racine ${root})`);
  if (host !== '127.0.0.1') {
    // Le dire, et pas seulement le faire : quelqu'un qui a tapé `--host` pour une manipulation
    // de cinq minutes ne doit pas laisser le dépôt ouvert au réseau tout l'après-midi sans y penser.
    console.log(`⚠ Écoute sur ${host} : le dépôt est accessible depuis tout le réseau local.`);
  }
});

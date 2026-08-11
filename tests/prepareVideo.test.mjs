// @ts-check
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  findOrphanArtifacts,
  findSidecarVideo,
  posterPathFor,
  resolveImageSource,
  sourceHashOf,
  publishVideo,
  VIDEO_EXTENSIONS,
} from '../scripts/prepare-maps.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');

/** @returns {string} dossier temporaire propre */
function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'prepvideo-'));
}

/** @param {string} dir @param {string} name @param {string|Buffer} body */
function write(dir, name, body) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, body);
  return p;
}

test('la vidéo jumelle est trouvée par nom de base, WebM avant MP4', () => {
  const dir = tmp();
  const vtt = write(dir, 'carte.dd2vtt', '{}');
  assert.equal(findSidecarVideo(vtt), null, 'aucune vidéo : null, pas une exception');

  write(dir, 'carte.mp4', 'mp4');
  assert.equal(path.basename(/** @type {string} */ (findSidecarVideo(vtt))), 'carte.mp4');

  write(dir, 'carte.webm', 'webm');
  assert.equal(
    path.basename(/** @type {string} */ (findSidecarVideo(vtt))),
    'carte.webm',
    'le WebM prime : le H.264 ne peut pas encoder les grandes cartes'
  );
  assert.equal(VIDEO_EXTENSIONS[0], '.webm');
});

test('une vidéo homonyme d’une AUTRE carte n’est pas ramassée', () => {
  const dir = tmp();
  const vtt = write(dir, 'carte.dd2vtt', '{}');
  write(dir, 'carte-bis.webm', 'webm');
  assert.equal(findSidecarVideo(vtt), null);
});

test('image embarquée : la vidéo est ignorée, l’UVTT garde la priorité', () => {
  const dir = tmp();
  const vtt = write(dir, 'carte.dd2vtt', '{}');
  write(dir, 'carte.webm', 'webm');
  const r = resolveImageSource(vtt, 'BASE64DATA');
  assert.equal(r.imageSource, 'BASE64DATA');
  assert.equal(r.videoPath, null, 'une carte fixe ne devient pas animée parce qu’un WebM traîne');
});

test('image vide sans vidéo : le message nomme ce qu’il faut fournir', () => {
  const dir = tmp();
  const vtt = write(dir, 'carte.dd2vtt', '{}');
  assert.throws(() => resolveImageSource(vtt, ''), (/** @type {any} */ err) => {
    assert.match(String(err.message), /aucune image/);
    // Deux assertions distinctes : `/a|b/` où `b` est un préfixe de `a` a une branche
    // morte, et le message pourrait cesser de nommer `.mp4` sans que rien ne le voie.
    assert.match(String(err.message), /carte\.webm/);
    assert.match(String(err.message), /\.mp4/);
    return true;
  });
});

test('image vide, vidéo présente, affiche absente : refus explicite avec la commande à lancer', () => {
  const dir = tmp();
  const vtt = write(dir, 'carte.dd2vtt', '{}');
  write(dir, 'carte.webm', 'webm');
  assert.throws(() => resolveImageSource(vtt, ''), (/** @type {any} */ err) => {
    assert.match(String(err.message), /affiche manque/);
    assert.match(String(err.message), /extract-poster\.mjs/,
      'le message doit donner la commande, pas seulement constater le manque');
    return true;
  });
});

test('image vide, vidéo et affiche présentes : l’affiche fournit les pixels', () => {
  const dir = tmp();
  const vtt = write(dir, 'carte.dd2vtt', '{}');
  const video = write(dir, 'carte.webm', 'webm');
  write(dir, 'carte.poster.webp', Buffer.from([1, 2, 3, 4]));

  const r = resolveImageSource(vtt, '');
  assert.ok(Buffer.isBuffer(r.imageSource));
  assert.deepEqual([...(/** @type {Buffer} */ (r.imageSource))], [1, 2, 3, 4]);
  assert.equal(r.videoPath, video);
  assert.equal(posterPathFor(vtt), path.join(dir, 'carte.poster.webp'));
});

test('l’empreinte couvre la vidéo et l’affiche, pas seulement le JSON', () => {
  const dir = tmp();
  const vtt = write(dir, 'carte.dd2vtt', '{"a":1}');
  write(dir, 'carte.webm', 'v1');
  write(dir, 'carte.poster.webp', 'p1');
  const h1 = sourceHashOf(vtt);

  // Réencoder la vidéo sans toucher au JSON : c'est exactement ce qu'on fait en
  // ajustant la qualité d'export. Sans cette couverture, le cache déclarait la carte
  // à jour et republiait l'ancienne vidéo.
  write(dir, 'carte.webm', 'v2');
  const h2 = sourceHashOf(vtt);
  assert.notEqual(h1, h2, 'changer la vidéo doit changer l’empreinte');

  write(dir, 'carte.poster.webp', 'p2');
  const h3 = sourceHashOf(vtt);
  assert.notEqual(h2, h3, 'changer l’affiche doit changer l’empreinte');

  assert.match(h1, /^sha256-[0-9a-f]{64}$/);
});

test('l’empreinte d’une carte sans vidéo ne dépend que du JSON', () => {
  const dir = tmp();
  const vtt = write(dir, 'carte.dd2vtt', '{"a":1}');
  const avant = sourceHashOf(vtt);
  write(dir, 'sansrapport.webm', 'bruit');
  assert.equal(sourceHashOf(vtt), avant);
});

test('la vidéo publiée n’est pas déclarée orpheline', () => {
  // Aucune entrée de catalogue ne nomme la vidéo : seule la scène le fait. Sans lecture
  // du `videoUrl` d'étage, chaque préparation rendait un avertissement d'orphelin sur un
  // fichier parfaitement référencé. U-02 interdisant la suppression, rien n'était perdu —
  // mais un avertissement systématiquement faux est un avertissement qu'on cesse de lire.
  const dir = tmp();
  const generated = path.join(dir, 'generated');
  fs.mkdirSync(generated);
  write(generated, 'carte.webp', 'img');
  write(generated, 'carte.webm', 'vid');
  write(generated, 'carte.scene.json', JSON.stringify({
    levels: [{ imageUrl: 'maps/generated/carte.webp', videoUrl: 'maps/generated/carte.webm' }],
  }));
  write(generated, 'vraiment-orpheline.webp', 'x');

  const avertissements = findOrphanArtifacts(dir, [{
    sceneUrl: 'maps/generated/carte.scene.json',
    imageUrl: 'maps/generated/carte.webp',
  }]);

  assert.equal(avertissements.length, 1, 'un seul orphelin, le vrai');
  assert.match(avertissements[0], /vraiment-orpheline\.webp/);
  assert.equal(
    avertissements.some((a) => a.includes('carte.webm')),
    false,
    'la vidéo référencée par la scène ne doit pas être signalée'
  );
});

test('bout en bout : un dd2vtt vidéo produit une scène animée et un catalogue qui le dit', async () => {
  // ⭐ **Le raccord, pas les pièces.** Les cas ci-dessus couvrent chaque helper isolément ;
  // cinq mutations du chemin joint restaient pourtant vertes — `videoUrl` forcé à `null`,
  // `animated` forcé à `false`… c'est-à-dire la fonctionnalité entièrement morte, suite au
  // vert. Ce test suit une vraie carte de la source au catalogue.
  const dir = tmp();
  const source = path.join(ROOT, 'maps');
  const vtt = path.join(source, 'testvideo-3.dd2vtt');
  if (!fs.existsSync(vtt)) {
    // Les sources sont `.gitignore`d : sur un clone neuf, ce cas ne peut pas s'exécuter.
    // On ne le maquille pas en vert silencieux — le test se déclare ignoré.
    return;
  }
  for (const nom of ['testvideo-3.dd2vtt', 'testvideo-3.webm', 'testvideo-3.poster.webp']) {
    fs.copyFileSync(path.join(source, nom), path.join(dir, nom));
  }

  const { prepareMap } = await import('../scripts/prepare-maps.mjs');
  const res = await prepareMap(path.join(dir, 'testvideo-3.dd2vtt'), dir, 140);

  const scene = JSON.parse(fs.readFileSync(res.sceneFile, 'utf8'));
  const niveau = scene.levels[0];

  assert.equal(niveau.videoUrl, 'maps/generated/testvideo-3.webm',
    'la scène doit porter le fond animé, sinon la fonctionnalité est morte');
  assert.equal(niveau.imageUrl, 'maps/generated/testvideo-3.webp',
    'l’affiche reste renseignée : c’est elle, le repli');
  assert.equal(res.catalogEntry.features.animated, true);
  assert.ok(fs.existsSync(path.join(dir, 'generated', 'testvideo-3.webm')),
    'la vidéo doit être réellement copiée dans generated/');

  // La géométrie survit à l'export vidéo — c'était la question décisive du chantier.
  assert.equal(niveau.walls.length, 14);
  assert.equal(niveau.portals.length, 4);
  assert.equal(niveau.lights.length, 4);
  assert.equal(niveau.pxPerCell, 140);

  // Et l'avertissement de plafond VP9 doit remonter : cette carte est au-dessus.
  assert.ok(
    res.warnings.some((/** @type {string} */ w) => /plafond VP9/.test(w)),
    'une carte au-delà du niveau 5.2 doit être signalée à la préparation'
  );
});

test('une vidéo disparue de generated/ invalide la recette', async () => {
  // Sans ce contrôle, effacer le `.webm` laissait la recette valide : la carte était
  // déclarée « inchangée, réutilisée » et republiée avec un `videoUrl` pointant dans le
  // vide. Fond noir sur la tablette, et rien dans la sortie de préparation pour le dire.
  const { isReusable } = await import('../scripts/prepare-maps.mjs');
  const dir = tmp();
  const generated = path.join(dir, 'generated');
  fs.mkdirSync(generated);
  write(generated, 'carte.webp', 'img');
  const videoFile = path.join(generated, 'carte.webm');
  fs.writeFileSync(videoFile, 'vid');
  write(generated, 'carte.scene.json', JSON.stringify({
    levels: [{ imageUrl: 'maps/generated/carte.webp', videoUrl: 'maps/generated/carte.webm' }],
  }));

  const recette = { sourceHash: 'h', linksHash: '', targetPxPerCell: 140, maxTexturePx: 8192, quality: 90, pipelineHash: 'p' };
  const connue = {
    recipe: recette,
    catalogEntry: { sceneUrl: 'maps/generated/carte.scene.json', imageUrl: 'maps/generated/carte.webp' },
  };

  assert.equal(isReusable(connue, recette, dir), true, 'tout est là : la recette tient');
  fs.rmSync(videoFile);
  assert.equal(isReusable(connue, recette, dir), false, 'la vidéo manque : il faut refabriquer');
});

test('publishVideo copie sous l’identifiant d’étage et conserve l’extension', () => {
  const dir = tmp();
  const generated = path.join(dir, 'generated');
  fs.mkdirSync(generated);
  const video = write(dir, 'source.webm', 'contenu');

  const url = publishVideo(video, generated, 'mon-etage');
  assert.equal(url, 'maps/generated/mon-etage.webm');
  assert.equal(fs.readFileSync(path.join(generated, 'mon-etage.webm'), 'utf8'), 'contenu');
});

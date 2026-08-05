// @ts-check
/**
 * Installe les icônes d'états dans `assets/icons/status/` depuis game-icons.net.
 *
 * Le nom de fichier EST l'identifiant attendu dans `token.markers` (CdC Q7). La table
 * ci-dessous fait donc autorité sur deux choses à la fois : le vocabulaire clos des
 * quatorze états, et le dessin retenu pour chacun.
 *
 * Usage :
 *   node scripts/install-status-icons.mjs             # les quatorze
 *   node scripts/install-status-icons.mjs broken fear # seulement ceux-là
 *
 * Le script applique les trois normalisations décrites dans
 * `assets/icons/status/SOURCES.md`, puis les vérifie. Il échoue plutôt que d'écrire un
 * fichier douteux : une icône noire ou sans dimension intrinsèque ne se voit pas à
 * l'exécution, elle se voit à la table de jeu.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'assets', 'icons', 'status');
const BASE_URL = 'https://raw.githubusercontent.com/game-icons/icons/master';

/**
 * @typedef {Object} IconSpec
 * @property {string} label Libellé français de l'état
 * @property {string} source Chemin dans le dépôt game-icons, sans `.svg`
 * @property {string} author Auteur, pour l'attribution CC BY
 */

/**
 * Les quatorze. L'ordre est celui du document de prompts, pas celui de
 * `STATUS_MARKER_IDS` — celui-là ne concerne que l'ordre d'affichage des badges.
 *
 * @type {Record<string, IconSpec>}
 */
export const ICONS = {
  prone: { label: 'À terre', source: 'sbed/falling', author: 'Sbed' },
  deafened: { label: 'Assourdi', source: 'skoll/hearing-disabled', author: 'Skoll' },
  blinded: { label: 'Aveuglé', source: 'skoll/sight-disabled', author: 'Skoll' },
  broken: { label: 'Brisé', source: 'delapouite/shattered-heart', author: 'Delapouite' },
  entangled: { label: 'Empêtré', source: 'lorc/spider-web', author: 'Lorc' },
  poisoned: { label: 'Empoisonné', source: 'lorc/poison-bottle', author: 'Lorc' },
  ablaze: { label: 'En flammes', source: 'carl-olsen/flame', author: 'Carl Olsen' },
  bleeding: { label: 'Hémorragique', source: 'sbed/water-drop', author: 'Sbed' },
  unconscious: { label: 'Inconscient', source: 'delapouite/night-sleep', author: 'Delapouite' },
  stunned: { label: 'Sonné', source: 'lorc/star-swirl', author: 'Lorc' },
  surprised: { label: 'Surpris', source: 'badges/exclamation', author: 'game-icons.net' },
  frenzy: { label: 'Frénésie', source: 'lorc/crossed-axes', author: 'Lorc' },
  fear: { label: 'Peur', source: 'lorc/terror', author: 'Lorc' },
  terror: { label: 'Terreur', source: 'skoll/burning-skull', author: 'Skoll' },
};

/**
 * Les fonds à retirer. Le premier est le carré pleine page des icônes d'auteurs ; le
 * second est le disque des `badges/`, qui n'est pas un carré et se serait donc glissé
 * à travers une vérification écrite pour le seul carré.
 *
 * @type {{ what: string, pattern: RegExp }[]}
 */
const BACKGROUNDS = [
  { what: 'carré noir pleine page', pattern: /<path d="M0 0h(\d+)v(\d+)H0z"\/>/ },
  { what: 'disque noir de fond', pattern: /<circle cx="128" cy="128" r="128"\/>/ },
];

/** Éléments qui peignent quelque chose. Sans `fill`, ils peignent en noir. */
const SHAPE_TAGS = ['path', 'circle', 'ellipse', 'rect', 'polygon', 'polyline', 'line'];

/**
 * @param {string} source
 * @returns {Promise<string>}
 */
async function fetchSource(source) {
  const url = `${BASE_URL}/${source}.svg`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} → HTTP ${response.status}`);
  }
  const svg = await response.text();
  if (!svg.startsWith('<svg')) {
    throw new Error(`${url} ne renvoie pas un SVG (${svg.slice(0, 40)}…)`);
  }
  return svg.trim();
}

/**
 * Chaque forme peint-elle du blanc, et rien d'autre ? Vérification pure, sans écriture,
 * pour que le test du dépôt rejoue exactement le contrôle de l'installateur.
 *
 * Le piège est ici : `fill` absent ne veut pas dire « pas de remplissage », il vaut
 * **noir**. Un anneau écrit `<circle stroke="#fff" …/>` contient bien « #fff » et se
 * dessinerait pourtant en disque noir. Chercher la chaîne ne suffit donc pas.
 *
 * @param {string} svg
 * @param {string} id Identifiant de l'état, pour les messages d'erreur
 * @returns {{ size: number, whiteRefs: number }}
 */
export function assertPaintsWhiteOnly(svg, id) {
  const dimensions = /<svg width="(\d+)" height="(\d+)"[^>]*viewBox="0 0 (\d+) (\d+)"/.exec(svg);
  if (!dimensions) {
    throw new Error(`${id} : dimensions intrinsèques absentes ou viewBox non conforme`);
  }
  const [, width, height, viewWidth, viewHeight] = dimensions;
  if (new Set([width, height, viewWidth, viewHeight]).size !== 1) {
    throw new Error(`${id} : ${width}×${height} pour une viewBox ${viewWidth}×${viewHeight}`);
  }

  for (const tag of SHAPE_TAGS) {
    for (const element of svg.matchAll(new RegExp(`<${tag}\\b[^>]*>`, 'g'))) {
      const attrs = element[0];
      const fill = /\sfill="([^"]*)"/.exec(attrs);
      if (fill && fill[1] === '#fff') continue;
      if (fill && fill[1] === 'none' && attrs.includes('stroke="#fff"')) continue;
      throw new Error(`${id} : <${tag}> peindrait en noir → ${attrs.slice(0, 80)}`);
    }
  }

  const dark = /#000|black/i.exec(svg);
  if (dark) {
    throw new Error(`${id} : couleur sombre résiduelle « ${dark[0]} »`);
  }

  const whiteRefs = (svg.match(/#fff/g) ?? []).length;
  if (whiteRefs === 0) {
    throw new Error(`${id} : plus aucune couleur, le dessin a disparu avec le fond`);
  }

  return { size: Number(width), whiteRefs };
}

/**
 * Applique les normalisations, puis les vérifie sur le résultat.
 *
 * @param {string} svg Contenu d'origine
 * @param {string} id Identifiant de l'état, pour les messages d'erreur
 * @returns {{ svg: string, size: number, whiteRefs: number, outlines: number, background: string }}
 */
export function normalize(svg, id) {
  // 1. Le fond noir, retiré : conservé, il masquerait le pion sous le badge.
  const found = BACKGROUNDS.find((candidate) => candidate.pattern.test(svg));
  if (!found) {
    throw new Error(`${id} : aucun fond noir reconnu, la source a changé de forme`);
  }
  let out = svg.replace(found.pattern, '');

  // 2. width/height, ajoutés : un SVG sans dimension intrinsèque ne se dessine pas de
  //    façon fiable via drawImage, et le rendu du projet est Canvas 2D natif.
  const viewBox = /viewBox="0 0 (\d+) (\d+)"/.exec(out);
  if (!viewBox) {
    throw new Error(`${id} : viewBox absente ou non carrée à l'origine`);
  }
  const [, width, height] = viewBox;
  if (width !== height) {
    throw new Error(`${id} : viewBox ${width}×${height} non carrée, le badge est rond`);
  }
  out = out.replace('<svg ', `<svg width="${width}" height="${height}" `);

  // 3. Les contours sans `fill` passés en `fill="none"`, sans quoi ils se rempliraient
  //    de noir (cf. assertPaintsWhiteOnly).
  let outlines = 0;
  for (const tag of SHAPE_TAGS) {
    for (const element of [...out.matchAll(new RegExp(`<${tag}\\b[^>]*>`, 'g'))].reverse()) {
      const attrs = element[0];
      if (/\sfill="/.test(attrs) || !attrs.includes('stroke="#fff"')) continue;
      const fixed = attrs.replace(`<${tag}`, `<${tag} fill="none"`);
      out = out.slice(0, element.index) + fixed + out.slice(element.index + attrs.length);
      outlines += 1;
    }
  }

  // 4. Et le résultat est contrôlé, pas supposé.
  const { size, whiteRefs } = assertPaintsWhiteOnly(out, id);

  return { svg: out, size, whiteRefs, outlines, background: found.what };
}

/**
 * @param {string[]} ids
 */
async function main(ids) {
  const unknown = ids.filter((id) => !(id in ICONS));
  if (unknown.length > 0) {
    throw new Error(`identifiants inconnus : ${unknown.join(', ')}`);
  }
  const targets = ids.length > 0 ? ids : Object.keys(ICONS);

  await mkdir(OUT_DIR, { recursive: true });

  for (const id of targets) {
    const spec = ICONS[id];
    const original = await fetchSource(spec.source);
    const { svg, size, whiteRefs, outlines, background } = normalize(original, id);
    await writeFile(join(OUT_DIR, `${id}.svg`), `${svg}\n`, 'utf8');
    const notes = [`${size}px`, `${background} retiré`];
    if (whiteRefs > 1) notes.push(`${whiteRefs} références #fff`);
    if (outlines > 0) notes.push(`${outlines} contour(s) passé(s) en fill="none"`);
    console.log(`✔ ${id}.svg ← ${spec.source} (${notes.join(', ')}, ${svg.length} o)`);
  }
}

// Garde d'entrée : `normalize` et `ICONS` sont importables (planche de comparaison,
// tests) et l'import ne doit pas réinstaller les quatorze au passage.
if (import.meta.main) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`✘ ${error.message}`);
    process.exit(1);
  });
}

// @ts-check
/**
 * Lecture des dimensions d'un fond animé, sans dépendance ni décodage.
 *
 * Existe pour une raison précise : `resample.mjs` plafonne les images à
 * `MAX_PREPARED_TEXTURE_PX = 8192`, valeur **mesurée** sur la Tab S9 FE, et prévient quand
 * elle mord. Le chemin vidéo n'avait aucun équivalent — on copiait le fichier sans jamais
 * le regarder. Or une vidéo a elle aussi un plafond, et il est plus bas qu'on ne croit.
 */
import fs from 'node:fs';
import path from 'node:path';

/**
 * Plafond d'échantillons de luminance du VP9 jusqu'au **niveau 5.2 inclus**.
 *
 * Au-delà, il faut du niveau 6.0 — qui existe dans la norme mais que les décodeurs
 * matériels des SoC mobiles ne gèrent couramment pas. Un flux au-dessus de ce seuil
 * risque donc le décodage **logiciel**, et c'est le pire scénario : ce n'est pas un
 * échec, c'est une lenteur. Le fond continue de rendre des images, très lentement,
 * en brûlant le processeur.
 *
 * Repère : 8 912 896 échantillons, c'est 3 984 × 2 237, ou 28 × 20 cases à 140 px/case.
 */
export const VP9_MAX_LUMA_LEVEL_52 = 8912896;

/**
 * Dimensions d'un WebM, lues dans l'en-tête EBML.
 *
 * Analyseur réel — identifiants et longueurs à taille variable —, pas une recherche de
 * motif : une première version par balayage d'octets rendait des valeurs plausibles et
 * fausses (18117 × 12370 sur un fichier de 2800 × 8120).
 *
 * @param {Buffer} buf
 * @returns {{ width: number, height: number }|null}
 */
export function webmDimensions(buf) {
  let width = 0;
  let height = 0;

  /** @param {number} p @param {boolean} keepMarker */
  function vint(p, keepMarker) {
    const first = buf[p];
    if (first === undefined || first === 0) return null;
    let len = 1;
    let mask = 0x80;
    while (!(first & mask) && len <= 8) {
      mask >>= 1;
      len++;
    }
    if (len > 8) return null;
    let v = keepMarker ? first : first & (mask - 1);
    for (let i = 1; i < len; i++) v = v * 256 + buf[p + i];
    return { v, len };
  }

  // Seuls les conteneurs sont descendus ; le reste est sauté par sa longueur déclarée.
  const MASTER = [0x18538067, 0x1654ae6b, 0xae, 0xe0];

  /** @param {number} start @param {number} end @param {number} depth */
  function parse(start, end, depth) {
    let p = start;
    while (p < end && depth < 8) {
      const id = vint(p, true);
      if (!id) return;
      const sz = vint(p + id.len, false);
      if (!sz) return;
      const dataStart = p + id.len + sz.len;
      const unknown = sz.v >= Math.pow(2, 7 * sz.len) - 1;
      let dataEnd = dataStart + sz.v;
      if (unknown || dataEnd > end) dataEnd = end;

      if (MASTER.includes(id.v)) {
        parse(dataStart, dataEnd, depth + 1);
      } else if (id.v === 0xb0 || id.v === 0xba) {
        let v = 0;
        for (let i = 0; i < sz.v; i++) v = v * 256 + buf[dataStart + i];
        if (id.v === 0xb0) width = v;
        else height = v;
      }
      if (width && height) return;
      p = dataStart + sz.v;
      if (unknown) break;
    }
  }

  parse(0, buf.length, 0);
  return width > 0 && height > 0 ? { width, height } : null;
}

/**
 * Dimensions d'un fond animé, ou `null` si le conteneur n'est pas reconnu.
 *
 * Seul le WebM est analysé : c'est le format recommandé et le seul dans lequel une
 * grande carte peut être encodée. Rendre `null` sur un MP4 est un aveu d'ignorance
 * assumé — mieux vaut ne pas avertir que d'avertir sur des chiffres inventés.
 *
 * @param {string} videoPath
 * @returns {{ width: number, height: number }|null}
 */
export function videoDimensions(videoPath) {
  if (path.extname(videoPath).toLowerCase() !== '.webm') return null;
  // 4 Mio d'en-tête : les pistes sont déclarées bien avant, mais un fichier muxé
  // largement peut repousser `Tracks`. Lire tout le fichier coûterait 20 Mio par passe.
  const fd = fs.openSync(videoPath, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const n = Math.min(size, 4 * 1024 * 1024);
    const buf = Buffer.alloc(n);
    fs.readSync(fd, buf, 0, n, 0);
    return webmDimensions(buf);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Avertissements sur un fond animé, dans le même esprit que ceux de `resample`.
 *
 * @param {string} videoPath
 * @returns {string[]}
 */
export function videoWarnings(videoPath) {
  const dims = videoDimensions(videoPath);
  if (!dims) return [];
  const luma = dims.width * dims.height;
  if (luma <= VP9_MAX_LUMA_LEVEL_52) return [];
  return [
    `Fond animé ${path.basename(videoPath)} : ${dims.width}x${dims.height} = ` +
      `${luma.toLocaleString('fr-FR')} échantillons, au-delà du plafond VP9 niveau 5.2 ` +
      `(${VP9_MAX_LUMA_LEVEL_52.toLocaleString('fr-FR')}). Le niveau 6.0 requis est rarement ` +
      `géré en matériel sur mobile : décodage logiciel probable, donc lecture lente et ` +
      `processeur chargé. À éprouver sur la tablette avant de compter dessus.`,
  ];
}

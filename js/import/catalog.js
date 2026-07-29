// @ts-check

/**
 * @typedef {import('../core/types.js').Campaign} Campaign
 */

/**
 * @typedef {object} CatalogMap
 * @property {string} id - Identifiant unique et stable
 * @property {string} name - Nom affiché de la carte
 * @property {string} sourceUrl - URL relative du fichier UVTT source
 * @property {string} sceneUrl - URL relative du JSON de scène
 * @property {string} imageUrl - URL relative de l'image (WebP, PNG, etc.)
 * @property {string} sourceHash - Hash SHA256 de la source : "sha256-xxx"
 * @property {number} levelCount - Nombre d'étages dans cette scène
 * @property {object} features
 * @property {number} features.walls - Nombre de murs/polylignes
 * @property {number} features.portals - Nombre de portails
 * @property {number} features.lights - Nombre de lumières
 * @property {boolean} features.bakedLighting - Éclairage cuit activé
 */

/**
 * @typedef {object} Catalog
 * @property {number} version - Version du format du catalogue
 * @property {CatalogMap[]} maps - Liste des cartes disponibles
 */

/**
 * Valide un objet de catalogue.
 * Retourne un tableau d'erreurs (vide = valide).
 *
 * @param {unknown} obj
 * @returns {string[]}
 */
export function validateCatalog(obj) {
  const errors = [];

  if (!obj || typeof obj !== 'object') {
    errors.push('Catalogue : un objet est attendu');
    return errors;
  }

  if (!('version' in obj)) {
    errors.push('Catalogue : version manquante');
  } else if (typeof obj.version !== 'number' || obj.version < 1) {
    errors.push('Catalogue : version invalide ou non supportée');
  }

  if (!Array.isArray(obj.maps)) {
    errors.push('Catalogue : maps doit être un tableau');
    return errors;
  }

  const ids = new Set();
  for (let i = 0; i < obj.maps.length; i++) {
    const map = obj.maps[i];
    const prefix = `Catalogue[maps[${i}]]`;

    if (!map || typeof map !== 'object') {
      errors.push(`${prefix} : objet attendu`);
      continue;
    }

    const id = map.id;
    if (!id || typeof id !== 'string') {
      errors.push(`${prefix} : id manquant ou invalide`);
    } else if (ids.has(id)) {
      errors.push(`${prefix} : id dupliqué "${id}"`);
    } else {
      ids.add(id);
    }

    if (!map.name || typeof map.name !== 'string') {
      errors.push(`${prefix} : name manquant`);
    }

    const checkUrl = (field) => {
      const url = map[field];
      if (!url || typeof url !== 'string') {
        errors.push(`${prefix} : ${field} manquant`);
        return false;
      }
      if (url.startsWith('data:')) {
        errors.push(`${prefix} : ${field} ne doit pas être une data: URL`);
        return false;
      }
      if (url.startsWith('blob:')) {
        errors.push(`${prefix} : ${field} ne doit pas être une blob: URL`);
        return false;
      }
      return true;
    };

    checkUrl('sourceUrl');
    checkUrl('sceneUrl');
    checkUrl('imageUrl');

    if (map.sourceHash && typeof map.sourceHash !== 'string') {
      errors.push(`${prefix} : sourceHash invalide`);
    }

    if (typeof map.levelCount !== 'number' || map.levelCount < 1) {
      errors.push(`${prefix} : levelCount invalide`);
    }

    if (!map.features || typeof map.features !== 'object') {
      errors.push(`${prefix} : features manquant`);
    } else {
      const feat = map.features;
      if (typeof feat.walls !== 'number' || feat.walls < 0) {
        errors.push(`${prefix}.features : walls invalide`);
      }
      if (typeof feat.portals !== 'number' || feat.portals < 0) {
        errors.push(`${prefix}.features : portals invalide`);
      }
      if (typeof feat.lights !== 'number' || feat.lights < 0) {
        errors.push(`${prefix}.features : lights invalide`);
      }
      if (typeof feat.bakedLighting !== 'boolean') {
        errors.push(`${prefix}.features : bakedLighting invalide`);
      }
    }
  }

  return errors;
}

/**
 * Charge un catalogue depuis une URL.
 * L'URL est relative au document courant (resolveUrl gère /rpg-map-display/).
 *
 * @param {string} catalogUrl - URL relative du catalogue
 * @param {string} [baseUrl=window.location.href] - URL de base pour résolution
 * @returns {Promise<Catalog>}
 * @throws {Error} Si l'URL est invalide, le chargement échoue, ou le catalogue est invalide
 */
export async function loadCatalog(catalogUrl, baseUrl = globalThis.location?.href) {
  if (!catalogUrl || typeof catalogUrl !== 'string') {
    throw new Error('loadCatalog: catalogUrl est requis');
  }

  // Résoudre l'URL relative
  let resolvedUrl = catalogUrl;
  if (baseUrl && typeof baseUrl === 'string' && !catalogUrl.startsWith('http')) {
    // Si l'URL est relative, la résoudre par rapport à baseUrl
    try {
      const base = new URL(baseUrl);
      resolvedUrl = new URL(catalogUrl, base).href;
    } catch (err) {
      throw new Error(
        `loadCatalog: Impossible de résoudre ${catalogUrl} par rapport à ${baseUrl}`
      );
    }
  }

  let response;
  try {
    response = await fetch(resolvedUrl);
  } catch (err) {
    throw new Error(
      `loadCatalog: Erreur réseau en chargeant ${resolvedUrl}: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (!response.ok) {
    throw new Error(
      `loadCatalog: ${response.status} ${response.statusText} en chargeant ${resolvedUrl}`
    );
  }

  let data;
  try {
    data = await response.json();
  } catch (err) {
    throw new Error(
      `loadCatalog: JSON invalide depuis ${resolvedUrl}: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const errors = validateCatalog(data);
  if (errors.length > 0) {
    throw new Error(`loadCatalog: Catalogue invalide:\n${errors.join('\n')}`);
  }

  return data;
}

/**
 * Résout une URL de scène/image relative au catalogue.
 * Gère le cas où le site est servi sous un sous-chemin (e.g., /rpg-map-display/).
 *
 * @param {string} relativeUrl - URL relative dans le catalogue
 * @param {string} [baseUrl=window.location.href]
 * @returns {string} URL absolue résolue
 */
export function resolveMapUrl(relativeUrl, baseUrl = globalThis.location?.href) {
  if (!relativeUrl || typeof relativeUrl !== 'string') {
    return relativeUrl;
  }

  try {
    const base = new URL(baseUrl || globalThis.location?.href || 'http://localhost/');
    return new URL(relativeUrl, base).href;
  } catch {
    // Fallback : retourner l'URL relative telle quelle
    return relativeUrl;
  }
}

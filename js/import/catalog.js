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
  /** @type {string[]} */
  const errors = [];

  if (!obj || typeof obj !== 'object') {
    errors.push('Catalogue : un objet est attendu');
    return errors;
  }

  /** @type {any} */
  const cat = obj;

  if (!('version' in cat)) {
    errors.push('Catalogue : version manquante');
  } else if (typeof cat.version !== 'number' || cat.version < 1) {
    errors.push('Catalogue : version invalide ou non supportée');
  }

  if (!Array.isArray(cat.maps)) {
    errors.push('Catalogue : maps doit être un tableau');
    return errors;
  }

  const ids = new Set();
  for (let i = 0; i < cat.maps.length; i++) {
    const map = cat.maps[i];
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

    /** @param {string} field */
    const checkUrl = (field) => {
      const url = map[field];
      if (!url) {
        errors.push(`${prefix} : ${field} manquant`);
        return false;
      }
      const urls = Array.isArray(url) ? url : [url];
      if (urls.length === 0) {
        errors.push(`${prefix} : ${field} ne doit pas être vide`);
        return false;
      }
      for (const u of urls) {
        if (typeof u !== 'string' || !u) {
          errors.push(`${prefix} : ${field} contient une valeur non-chaîne ou vide`);
          return false;
        }
        if (u.startsWith('data:')) {
          errors.push(`${prefix} : ${field} ne doit pas être une data: URL`);
          return false;
        }
        if (u.startsWith('blob:')) {
          errors.push(`${prefix} : ${field} ne doit pas être une blob: URL`);
          return false;
        }
      }
      return true;
    };

    checkUrl('sourceUrl');
    checkUrl('sceneUrl');
    checkUrl('imageUrl');

    if (map.sourceHash) {
      const hashes = Array.isArray(map.sourceHash) ? map.sourceHash : [map.sourceHash];
      if (hashes.length === 0 || hashes.some((/** @type {any} */ h) => typeof h !== 'string' || !h)) {
        errors.push(`${prefix} : sourceHash invalide`);
      }
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

/*
 * Pas de resolveMapUrl() ici, volontairement.
 *
 * Les URLs du catalogue sont relatives au site (plan §4). Le navigateur les
 * résout déjà par rapport au document courant, ce qui couvre nativement le cas
 * d'un site servi sous un sous-chemin (`/rpg-map-display/`) : `fetch()` comme
 * `img.src` acceptent le relatif.
 *
 * Les transformer en URL absolue serait activement nuisible : une URL
 * `http://…` est refusée par `isPersistableAssetUrl()` et une URL `https://…`
 * figerait l'origine dans le document persisté et synchronisé.
 */

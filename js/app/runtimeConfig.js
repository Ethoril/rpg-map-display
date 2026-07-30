// @ts-check

const STORAGE_KEYS = ['rpg-firebase-config', 'rpg-diag-firebase-config'];
const REQUIRED_FIELDS = ['apiKey', 'authDomain', 'databaseURL', 'projectId', 'appId'];

/**
 * @param {unknown} candidate
 * @returns {Record<string, any>|null}
 */
function normalizeConfig(candidate) {
  if (!candidate || typeof candidate !== 'object') return null;
  const config = /** @type {Record<string, any>} */ (candidate);
  if (!REQUIRED_FIELDS.every((field) => typeof config[field] === 'string' && config[field])) {
    return null;
  }

  // Les identifiants du compte technique ne doivent jamais entrer dans le runtime public.
  const { testEmail: _testEmail, testPassword: _testPassword, ...publicConfig } = config;
  return publicConfig;
}

/**
 * Résout la configuration Firebase publique depuis un domicile explicite.
 *
 * Ordre :
 * 1. option injectée par les tests ou l'hôte ;
 * 2. `window.RPG_FIREBASE_CONFIG` pour un hébergement statique configuré ;
 * 3. configuration collée une fois dans diag.html sur le même appareil.
 *
 * @param {Record<string, any>|null|undefined} injected
 * @returns {Record<string, any>|null}
 */
export function resolveFirebaseConfig(injected) {
  const direct = normalizeConfig(injected);
  if (direct) return direct;

  if (typeof window !== 'undefined') {
    const globalConfig = normalizeConfig(
      /** @type {any} */ (window).RPG_FIREBASE_CONFIG
    );
    if (globalConfig) return globalConfig;
  }

  if (typeof localStorage === 'undefined') return null;
  for (const key of STORAGE_KEYS) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const stored = normalizeConfig(JSON.parse(raw));
      if (stored) return stored;
    } catch {
      // Une valeur locale illisible n'est pas une configuration utilisable.
    }
  }
  return null;
}

/**
 * Persiste uniquement la configuration Web publique.
 *
 * Retourne la configuration normalisée pour que l'appelant puisse la réutiliser sans
 * jamais retoucher à l'objet d'origine — lequel peut porter `testEmail`/`testPassword`
 * si l'utilisateur a collé le JSON destiné à la CI.
 *
 * @param {Record<string, any>} config
 * @returns {Record<string, any>} la configuration publique effectivement persistée
 */
export function saveFirebaseConfig(config) {
  const normalized = normalizeConfig(config);
  if (!normalized) {
    throw new Error(
      `Configuration Firebase invalide : champs requis ${REQUIRED_FIELDS.join(', ')}`
    );
  }
  if (typeof localStorage === 'undefined') {
    throw new Error('LocalStorage indisponible : configuration Firebase non enregistrée');
  }
  localStorage.setItem(STORAGE_KEYS[0], JSON.stringify(normalized));
  return normalized;
}


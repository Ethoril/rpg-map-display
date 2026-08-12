// @ts-check

export const COLD_IDLE_MINIMUM_MS = 120_000;

/** Seuil du critère R2-03 : coût du premier tracé du fond, dans une frame. */
export const COLD_DRAW_BUDGET_MS = 5;

/**
 * Coût **net** du premier tracé d'un fond froid, et verdict R2-03 associé.
 *
 * ⛔ **La soustraction n'est pas cosmétique, elle décide du verdict.** Le chronomètre encadre
 * `drawImage` **plus** un `getImageData` qui vide le pipeline GPU — sans ce vidage on mesurerait
 * une mise en file, pas une peinture. Mais la relecture coûte elle-même quelques millisecondes,
 * et le seuil est à 5 ms : la garder dans le total fait basculer le verdict à lui seul.
 *
 * Cette fonction est pure et vit ici, hors de `diag.js`, précisément pour être éprouvable sans
 * navigateur — la mutation « retirer la soustraction » doit faire rougir un test, pas passer
 * inaperçue dans une page qui touche `document` et `performance`.
 *
 * La **phrase de verdict** est rendue ici, et non composée dans la page : c'est la seule façon
 * qu'un test sans navigateur puisse prouver qu'elle se prononce sur le net. Tant qu'elle était
 * construite dans `diag.js`, la faire porter sur le brut ne faisait rougir aucun test — les durées
 * réelles d'un Chromium sans charge sont trop petites pour que les deux verdicts diffèrent.
 *
 * @param {number} brutMs Durée mesurée de `drawImage` + `getImageData` sur le bitmap froid.
 * @param {number} relectureMs Durée du même `getImageData` seul, sur un bitmap 1×1 déjà chaud.
 * @returns {{ netMs: number, tenu: boolean, seuilMs: number, verdict: string }}
 */
export function resumeDecodageFroid(brutMs, relectureMs) {
  if (!Number.isFinite(brutMs) || !Number.isFinite(relectureMs)) {
    throw new TypeError('Deux durées finies sont requises.');
  }
  if (brutMs < 0 || relectureMs < 0) {
    throw new RangeError('Une durée négative n’est pas une mesure.');
  }
  const netMs = Math.max(0, brutMs - relectureMs);
  const tenu = netMs < COLD_DRAW_BUDGET_MS;
  return {
    netMs,
    tenu,
    seuilMs: COLD_DRAW_BUDGET_MS,
    verdict: tenu
      ? `Fond < ${COLD_DRAW_BUDGET_MS} ms : OUI — critère R2-03 tenu sur cette mesure.`
      : `Fond ≥ ${COLD_DRAW_BUDGET_MS} ms (${netMs.toFixed(1)} ms) : le seuil R2-03 n'est PAS tenu.`,
  };
}

/**
 * Mesure un second `Image.decode()` après une période sans action de la sonde.
 *
 * L'API Web ne permet pas de forcer ni d'observer l'éviction du décodeur d'image : ce
 * protocole constate donc le coût réellement payé par le navigateur après deux minutes
 * sans timer, rAF ou mise à jour DOM émis par la sonde. Il ne déclare jamais à lui seul
 * qu'un bitmap a été évincé physiquement.
 */
export class ColdDecodeTrial {
  /**
   * @param {{ now?: () => number, imageFactory?: () => HTMLImageElement, minimumIdleMs?: number }} [options]
   */
  constructor(options = {}) {
    this.now = options.now ?? (() => performance.now());
    this.imageFactory = options.imageFactory ?? (() => new Image());
    this.minimumIdleMs = options.minimumIdleMs ?? COLD_IDLE_MINIMUM_MS;
    /** @type {HTMLImageElement|null} */
    this.image = null;
    this.armedAt = null;
  }

  /** @param {string} url */
  async arm(url) {
    if (!url.trim()) throw new TypeError('Une URL d’image est requise.');
    // Un nouvel armement remplace explicitement le précédent. Si le décodage échoue, il ne
    // doit pas rester possible de mesurer par erreur l'ancienne image avec son ancien délai.
    this.image = null;
    this.armedAt = null;
    const image = this.imageFactory();
    image.src = url;
    await image.decode();
    this.image = image;
    this.armedAt = this.now();
    return { armedAt: this.armedAt, minimumIdleMs: this.minimumIdleMs };
  }

  remainingMs() {
    if (this.armedAt === null) return null;
    return Math.max(0, this.minimumIdleMs - (this.now() - this.armedAt));
  }

  async measure() {
    if (!this.image || this.armedAt === null) throw new Error('Armer le test avant la mesure.');
    const idleMs = this.now() - this.armedAt;
    if (idleMs < this.minimumIdleMs) {
      throw new RangeError(`Inactivité insuffisante : ${Math.ceil((this.minimumIdleMs - idleMs) / 1000)} s restantes.`);
    }
    const image = this.image;
    // Une mesure est à usage unique : la recommencer exige une nouvelle chauffe et un nouveau
    // silence de 120 s, sinon le second résultat serait artificiellement chaud.
    this.image = null;
    this.armedAt = null;
    const startedAt = this.now();
    await image.decode();
    const decodeMs = this.now() - startedAt;
    return { idleMs, decodeMs };
  }

  takeArmedImage() {
    if (!this.image || this.armedAt === null) throw new Error('Armer le test avant la mesure.');
    const idleMs = this.now() - this.armedAt;
    if (idleMs < this.minimumIdleMs) {
      throw new RangeError(`Inactivité insuffisante : ${Math.ceil((this.minimumIdleMs - idleMs) / 1000)} s restantes.`);
    }
    const image = this.image;
    this.image = null;
    this.armedAt = null;
    return { image, idleMs };
  }
}

/** @typedef {'observed'|'not-observed'|'not-checked'} ObservationState */

const OBSERVATION_STATES = new Set(['observed', 'not-observed', 'not-checked']);

/**
 * Journal sans minuterie : il n'échantillonne rien tout seul. Chaque ligne est un
 * constat humain à un instant choisi, afin de ne pas fausser une séance de cast longue.
 */
export class EnduranceJournal {
  /**
   * @param {{ now?: () => number, storage?: Storage|null, storageKey?: string }} [options]
   *   `storage` : ⭐ **le journal doit survivre à un rechargement d'onglet.** Sur une séance
   *   de 4 h, Chrome Android peut recharger la page à tout moment ; un journal en mémoire
   *   pure perdait alors les huit relevés, c'est-à-dire toute la séance. C'est le mode de
   *   défaillance le plus probable de la mesure la plus longue.
   */
  constructor(options = {}) {
    this.now = options.now ?? (() => performance.now());
    this.storage = options.storage !== undefined
      ? options.storage
      : (typeof localStorage !== 'undefined' ? localStorage : null);
    this.storageKey = options.storageKey ?? 'rpg-diag-endurance';
    this.startedAt = null;
    /** @type {Array<{ elapsedMs: number, fps: number|null, temperature: string, wakeLock: ObservationState, fullscreen: ObservationState, cast: ObservationState, resumed: ObservationState, notes: string }>} */
    this.observations = [];
    /** Lignes automatiques : Wake Lock, plein écran, cycle de vie. @type {Array<{ elapsedMs: number, label: string }>} */
    this.events = [];
  }

  start() {
    this.startedAt = this.now();
    this.observations = [];
    this.events = [];
    this._persist();
    return this.startedAt;
  }

  /**
   * Enregistre un fait **observé par la page**, pas par la personne : relâchement du
   * Wake Lock, sortie de plein écran, gel ou reprise de l'onglet.
   *
   * ⛔ Ne déclenche aucune minuterie : ces lignes ne naissent que d'un événement du
   * navigateur, donc la page reste inerte pendant les silences — condition posée par le
   * protocole d'endurance pour ne pas fausser sa propre mesure.
   *
   * @param {string} label
   */
  recordEvent(label) {
    if (this.startedAt === null) return null;
    const entry = { elapsedMs: this.now() - this.startedAt, label };
    this.events.push(entry);
    this._persist();
    return entry;
  }

  /** Recharge un journal interrompu. @returns {boolean} vrai si quelque chose a été repris */
  restore() {
    if (!this.storage) return false;
    try {
      const brut = this.storage.getItem(this.storageKey);
      if (!brut) return false;
      const data = JSON.parse(brut);
      if (typeof data?.startedAt !== 'number') return false;
      this.startedAt = data.startedAt;
      this.observations = Array.isArray(data.observations) ? data.observations : [];
      this.events = Array.isArray(data.events) ? data.events : [];
      return true;
    } catch {
      return false;
    }
  }

  /** @private */
  _persist() {
    if (!this.storage) return;
    try {
      this.storage.setItem(
        this.storageKey,
        JSON.stringify({ startedAt: this.startedAt, observations: this.observations, events: this.events })
      );
    } catch {
      // Quota plein ou stockage refusé : le journal en mémoire reste utilisable, et
      // l'échec ne doit pas interrompre une séance de quatre heures.
    }
  }

  /**
   * @param {{ fps?: number|null, temperature?: string, wakeLock?: ObservationState, fullscreen?: ObservationState, cast?: ObservationState, resumed?: ObservationState, notes?: string }} observation
   */
  record(observation = {}) {
    if (this.startedAt === null) throw new Error('Démarrer le journal avant un relevé.');
    const states = ['wakeLock', 'fullscreen', 'cast', 'resumed'];
    for (const key of states) {
      const value = observation[/** @type {'wakeLock'|'fullscreen'|'cast'|'resumed'} */ (key)] ?? 'not-checked';
      if (!OBSERVATION_STATES.has(value)) throw new TypeError(`État de relevé invalide : ${value}`);
    }
    const fps = observation.fps ?? null;
    if (fps !== null && (!Number.isFinite(fps) || fps < 0)) throw new TypeError('Les fps doivent être un nombre positif.');
    const recorded = {
      elapsedMs: this.now() - this.startedAt,
      fps,
      temperature: observation.temperature?.trim() ?? '',
      wakeLock: observation.wakeLock ?? 'not-checked',
      fullscreen: observation.fullscreen ?? 'not-checked',
      cast: observation.cast ?? 'not-checked',
      resumed: observation.resumed ?? 'not-checked',
      notes: observation.notes?.trim() ?? '',
    };
    this.observations.push(recorded);
    this._persist();
    return recorded;
  }

  toText() {
    if (this.startedAt === null) return 'Journal non démarré.';
    const lines = ['Journal endurance — relevés manuels (aucune température ni session Cast n’est lue par le navigateur).'];
    for (const row of this.observations) {
      lines.push(
        `${(row.elapsedMs / 60000).toFixed(1)} min | fps ${row.fps ?? '—'} | température ${row.temperature || '—'} | ` +
        `Wake Lock ${row.wakeLock} | plein écran ${row.fullscreen} | cast ${row.cast} | reprise ${row.resumed}` +
        (row.notes ? ` | ${row.notes}` : '')
      );
    }
    if (this.events.length > 0) {
      lines.push('', 'Constaté par la page, sans intervention :');
      for (const e of this.events) lines.push(`${(e.elapsedMs / 60000).toFixed(1)} min | ${e.label}`);
    }
    return lines.join('\n');
  }

  /**
   * Rend le journal sous la forme du tableau de `docs/RAPPORT-ENDURANCE.md`, prêt à coller.
   *
   * La recopie à la main, huit relevés de huit colonnes, se faisait depuis un `<pre>` sur
   * une tablette, en fin de séance de quatre heures. C'est le moment et l'endroit où l'on
   * se trompe.
   */
  toMarkdown() {
    if (this.startedAt === null) return 'Journal non démarré.';
    const etat = (/** @type {ObservationState} */ v) =>
      v === 'observed' ? 'oui' : v === 'not-observed' ? 'NON' : '—';
    const lignes = [
      '| Temps | fps | Température | Wake Lock | Plein écran | Cast | Reprise | Notes |',
      '|---|---|---|---|---|---|---|---|',
    ];
    for (const r of this.observations) {
      lignes.push(
        `| ${(r.elapsedMs / 60000).toFixed(0)} min | ${r.fps ?? '—'} | ${r.temperature || '—'} | ` +
        `${etat(r.wakeLock)} | ${etat(r.fullscreen)} | ${etat(r.cast)} | ${etat(r.resumed)} | ${r.notes || '—'} |`
      );
    }
    if (this.events.length > 0) {
      lignes.push('', '### Constaté par la page', '');
      for (const e of this.events) lignes.push(`- **${(e.elapsedMs / 60000).toFixed(1)} min** — ${e.label}`);
    }
    return lignes.join('\n');
  }
}

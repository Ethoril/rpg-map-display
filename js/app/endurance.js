// @ts-check

export const COLD_IDLE_MINIMUM_MS = 120_000;

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
}

/** @typedef {'observed'|'not-observed'|'not-checked'} ObservationState */

const OBSERVATION_STATES = new Set(['observed', 'not-observed', 'not-checked']);

/**
 * Journal sans minuterie : il n'échantillonne rien tout seul. Chaque ligne est un
 * constat humain à un instant choisi, afin de ne pas fausser une séance de cast longue.
 */
export class EnduranceJournal {
  /** @param {{ now?: () => number }} [options] */
  constructor(options = {}) {
    this.now = options.now ?? (() => performance.now());
    this.startedAt = null;
    /** @type {Array<{ elapsedMs: number, fps: number|null, temperature: string, wakeLock: ObservationState, fullscreen: ObservationState, cast: ObservationState, resumed: ObservationState, notes: string }>} */
    this.observations = [];
  }

  start() {
    this.startedAt = this.now();
    this.observations = [];
    return this.startedAt;
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
    return lines.join('\n');
  }
}

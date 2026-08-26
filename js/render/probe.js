// @ts-check

/**
 * Empilement du cartouche de la sonde.
 *
 * ⛔ **Au-dessus du plateau, mais SOUS tout ce que le produit a à dire.** Il valait 99 999,
 * donc il passait devant l'état réseau (900), l'overlay de connexion (1 000) et l'overlay
 * bloquant (1 100) — un outil de mesure masquait les messages d'erreur du produit. Constaté le
 * 23/08/2026 sur la tablette : une erreur réseau illisible, cachée derrière le cartouche, au
 * moment précis où elle importait.
 *
 * Une sonde qui cache la réponse est pire qu'une sonde absente : on croit observer alors qu'on
 * masque. Voir `js/app/session.js` pour les trois valeurs au-dessus de celle-ci.
 */
export const PROBE_Z_INDEX = 800;

/**
 * Sonde passive de mesure de la première frame post-inactivité (Chantier N).
 * Enregistre les métriques de rendu sans provoquer de frame ni allouer de mémoire.
 */
export class FrameProbe {
  /**
   * @param {number} [capacity=64]
   */
  constructor(capacity = 64) {
    this.capacity = capacity;
    this.head = 0;
    this.count = 0;
    this.frameCount = 0;
    this.lastFrameTime = 0;
    this.visible = false;
    /** @type {HTMLDivElement|null} */
    this.overlayEl = null;

    /**
     * Tampon circulaire d'objets pré-alloués (zéro allocation en boucle de rendu).
     * @type {Array<{
     *   frameCount: number,
     *   timestamp: number,
     *   gap: number,
     *   total: number,
     *   layers: Record<string, number>,
     *   sumLayers: number,
     *   residual: number
     * }>}
     */
    this.records = new Array(capacity);
    for (let i = 0; i < capacity; i++) {
      this.records[i] = {
        frameCount: 0,
        timestamp: 0,
        gap: 0,
        total: 0,
        layers: {},
        sumLayers: 0,
        residual: 0,
      };
    }

    // Travail de vision déclenché par une mutation, avant la prochaine image. Il ne planifie
    // rien : la souscription applicative existante reste la seule à demander une frame.
    this.pendingVision = 0;
  }

  /**
   * Enregistre le travail de vision produit hors du renderer. Il est consommé une seule fois par
   * l'image suivante, pour ne pas l'attribuer aux frames ultérieures d'une animation.
   *
   * @param {number} duration Durée monotone en millisecondes
   */
  recordVision(duration) {
    if (Number.isFinite(duration) && duration >= 0) this.pendingVision += duration;
  }

  /**
   * Enregistre les durées mesurées pour une frame de rendu.
   *
   * @param {number} timestamp - Temps performance.now() actuel
   * @param {number} totalDuration - Durée totale de renderAll (ms)
   * @param {Record<string, number>} layersBreakdown - Durées individuelles des couches (ms)
   */
  recordFrame(timestamp, totalDuration, layersBreakdown) {
    this.frameCount++;

    // La frame #1 (chargement initial) est exclue des statistiques post-inactivité.
    if (this.frameCount === 1) {
      this.lastFrameTime = timestamp;
      // Le travail de vision qui a préparé le chargement initial ne doit pas être attribué à la
      // première interaction suivante, laquelle serait alors faussement qualifiée post-silence.
      this.pendingVision = 0;
      return;
    }

    const gap = this.lastFrameTime > 0 ? timestamp - this.lastFrameTime : 0;
    this.lastFrameTime = timestamp;

    const rec = this.records[this.head];
    rec.frameCount = this.frameCount;
    rec.timestamp = timestamp;
    rec.gap = gap;
    rec.total = totalDuration;

    // La vision est volontairement hors de `renderAll`, afin de rester active quand rAF est
    // suspendu dans un onglet caché. Elle n'entre donc pas dans le résidu du rendu Canvas.
    rec.layers.vision = this.pendingVision;
    this.pendingVision = 0;

    let sum = 0;
    for (const k in layersBreakdown) {
      rec.layers[k] = layersBreakdown[k];
      // La vision est la seule mesure hors de `renderAll`; le snapshot, lui, appartient bien au
      // total de la frame et doit donc contribuer au résidu.
      sum += layersBreakdown[k];
    }
    rec.sumLayers = sum;
    // Résidu exact (non masqué par Math.max pour révéler une incohérence de mesure)
    rec.residual = totalDuration - sum;

    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) {
      this.count++;
    }
  }

  /**
   * Bascule l'overlay de diagnostic DOM. Ce qui s'affiche est un **instantané** des frames déjà
   * enregistrées : pour le rafraîchir, on presse la touche deux fois.
   *
   * ⛔ Ne pas rafraîchir sur minuterie. Reconstruire ce tableau chaque seconde ferait du style, du
   * layout et du paint **pendant l'inactivité même qu'on mesure** — donc ferait vivre la page
   * pendant le silence, avec deux conséquences : la pression mémoire que le brief §5.2 interdit à
   * la sonde de fabriquer, et surtout la possibilité d'empêcher le navigateur de libérer le bitmap
   * décodé du fond, c'est-à-dire de **faire disparaître le symptôme** qu'on cherche à attraper.
   * Une sonde qui redessine à heure fixe supprime l'inactivité qu'elle prétend observer, tout
   * comme celle qui demanderait une frame (brief §5.1).
   */
  toggleOverlay() {
    this.visible = !this.visible;
    if (this.visible) {
      this._updateOverlay();
    } else if (this.overlayEl) {
      this.overlayEl.style.display = 'none';
    }
  }

  /**
   * Retire l'overlay du document. Appelé au démontage de la vue : sans ça l'élément survit à la
   * fenêtre qui l'a créé.
   */
  stop() {
    this.visible = false;
    if (this.overlayEl) {
      this.overlayEl.remove();
      this.overlayEl = null;
    }
  }

  /** @private */
  _updateOverlay() {
    if (!this.overlayEl) {
      this.overlayEl = document.createElement('div');
      this.overlayEl.id = 'probe-overlay';
      this.overlayEl.style.cssText = `
        position: fixed;
        bottom: 12px;
        left: 12px;
        z-index: ${PROBE_Z_INDEX};
        background: rgba(15, 23, 42, 0.94);
        color: #e2e8f0;
        font-family: monospace;
        font-size: 11px;
        line-height: 1.4;
        padding: 10px;
        border-radius: 6px;
        border: 1px solid #475569;
        max-width: 520px;
        max-height: 320px;
        overflow-y: auto;
        pointer-events: auto;
        box-shadow: 0 4px 12px rgba(0,0,0,0.5);
      `;
      document.body.appendChild(this.overlayEl);
      // Le relevé est volontairement figé : ce tap ne demande pas de frame, ne démarre pas de
      // minuterie et ne change donc pas l'inactivité que l'on veut observer.
      this.overlayEl.addEventListener('click', () => this._updateOverlay());
    }

    this.overlayEl.style.display = 'block';

    let html = `<div style="font-weight:bold;margin-bottom:6px;color:#38bdf8;">📊 Sonde rendu — instantané à ${this.frameCount} frames. Touchez l'encart pour actualiser ; P le ferme sur desktop.</div>`;
    html += `<table style="width:100%;border-collapse:collapse;">
      <tr style="border-bottom:1px solid #475569;text-align:left;">
        <th>#</th>
        <th>Écart</th>
        <th>Total</th>
        <th>Store/snapshot</th>
        <th>Vision</th>
        <th>Fond</th>
        <th>Grille</th>
        <th>Portes</th>
        <th>Pions</th>
        <th>Fog</th>
        <th>Autres</th>
        <th>Résidu</th>
      </tr>`;

    // Parcourir du plus récent au plus ancien
    for (let i = 0; i < this.count; i++) {
      const idx = (this.head - 1 - i + this.capacity) % this.capacity;
      const r = this.records[idx];

      let rowStyle = 'color:#cbd5e1;';
      if (r.gap > 30000) {
        rowStyle = 'color:#f87171;font-weight:bold;'; // post-30s inactivité (>30s)
      } else if (r.gap > 5000) {
        rowStyle = 'color:#facc15;font-weight:bold;'; // post-5s inactivité
      } else if (i === 0) {
        rowStyle = 'color:#4ade80;';
      }

      /** @param {string} key */
      const value = (key) => (r.layers[key] || 0).toFixed(1);
      const others =
        (r.layers.walls || 0) +
        (r.layers.moveZone || 0) +
        (r.layers.templates || 0) +
        (r.layers.feedback || 0);
      const gapSec = (r.gap / 1000).toFixed(1);

      html += `<tr style="${rowStyle}border-bottom:1px solid #334155;">
        <td>${r.frameCount}</td>
        <td>${gapSec}s</td>
        <td>${r.total.toFixed(1)}ms</td>
        <td>${value('snapshot')}ms</td>
        <td>${value('vision')}ms</td>
        <td>${value('background')}ms</td>
        <td>${value('grid')}ms</td>
        <td>${value('portals')}ms</td>
        <td>${value('tokens')}ms</td>
        <td>${value('fog')}ms</td>
        <td>${others.toFixed(1)}ms</td>
        <td>${r.residual.toFixed(1)}ms</td>
      </tr>`;
    }

    html += `</table>`;
    this.overlayEl.innerHTML = html;
  }
}

// @ts-check

import { FOG_MASK_PX_PER_CELL, VISION_MAX_RANGE_CELLS } from '../core/constants.js';
import { sweep } from './sweep.js';

/** @typedef {import('../core/types.js').MapPoint} MapPoint */
/** @typedef {import('../core/types.js').Segment} Segment */

// Ce module compose le CHAMP LUMINEUX de l'étage, à la résolution du masque de fog
// (`FOG_MASK_PX_PER_CELL`, 8 px/case). C'est la tranche Z-02 du chantier Z.
//
// ⭐ **Le champ ne dépend d'AUCUN observateur.** Une lampe éclaire qu'on la regarde ou non :
// c'est une propriété de la carte, pas de la table. C'est ce qui le distingue de la vision,
// et c'est ce qui fait tomber la question 9 du §12 du cahier des charges — voir le §4.6 du
// chantier. Conséquence directe et vérifiée par test : **déplacer un PJ ne recompose pas le
// champ.**
//
// ⚠ Comme `fog.js`, ce module ne connaît pas la grille : les centres et les rayons lui
// arrivent **déjà en pixels carte**, et il reçoit `mapOrigin` et `gridScale` pour se ramener
// à l'espace du masque. Le calcul des positions appartient à la couche de rendu.

/**
 * Une source prête à composer.
 *
 * @typedef {Object} PreparedLight
 * @property {MapPoint} center Centre, en pixels carte
 * @property {number} radiusPx Portée, en pixels carte
 * @property {number} intensity Intensité normalisée, 0 → 1
 * @property {string} color Couleur `#RRGGBB`, telle que l'import la normalise
 */

/**
 * Plafonne une portée exprimée en cases, comme le fait déjà le chemin de vision.
 *
 * ⭐ Le plafond vient de la tranche L-02 : sans lui, un sweep sur une carte dense passait de
 * 2 ms à 347 ms. Aucune source du corpus réel ne l'atteint — la plus longue du village porte
 * à 10 cases — mais une scène éditée à la main le pourrait.
 *
 * @param {number|undefined} range
 * @returns {number}
 */
export function cappedLightRange(range) {
  return Math.min(Math.max(0, Number(range) || 0), VISION_MAX_RANGE_CELLS);
}

/**
 * Décompose une couleur `#RRGGBB` en trois canaux.
 *
 * ⚠ **Une couleur illisible rend du blanc, jamais rien.** Une source muette serait un trou
 * noir dans le champ, donc — en mode tactique — une zone que la table ne verrait plus, et le
 * défaut serait invisible en relecture. `js/import/uvtt.js` normalise déjà vers `#RRGGBB` à
 * l'import et signale ce qu'il a corrigé ; cette fonction est la ceinture, pas la bretelle.
 *
 * @param {string|undefined} color
 * @returns {{ red: number, green: number, blue: number }}
 */
export function parseLightColor(color) {
  const blanc = { red: 255, green: 255, blue: 255 };
  if (typeof color !== 'string') return blanc;
  const court = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(color.trim());
  if (court) {
    return {
      red: parseInt(court[1] + court[1], 16),
      green: parseInt(court[2] + court[2], 16),
      blue: parseInt(court[3] + court[3], 16),
    };
  }
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color.trim());
  if (!long) return blanc;
  return {
    red: parseInt(long[1], 16),
    green: parseInt(long[2], 16),
    blue: parseInt(long[3], 16),
  };
}

/**
 * Champ lumineux d'un étage, en cache, à la résolution du masque.
 *
 * Le patron est celui d'`ExploredFog` — fabrique de canvas injectable, révision recopiée sur
 * le canvas — parce que le consommateur ne voit jamais l'instance, seulement `.canvas`, et
 * qu'un cache qui ne comparerait que la référence resterait bloqué sur le premier champ
 * composé.
 */
export class LightField {
  /**
   * @param {number} widthCells
   * @param {number} heightCells
   * @param {((w: number, h: number) => any)} [createCanvas]
   */
  constructor(widthCells, heightCells, createCanvas) {
    this.widthCells = widthCells;
    this.heightCells = heightCells;
    this.maskWidth = widthCells * FOG_MASK_PX_PER_CELL;
    this.maskHeight = heightCells * FOG_MASK_PX_PER_CELL;
    this.createCanvas = createCanvas;

    if (typeof createCanvas === 'function') {
      this.canvas = createCanvas(this.maskWidth, this.maskHeight);
    } else if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
      this.canvas = document.createElement('canvas');
      this.canvas.width = this.maskWidth;
      this.canvas.height = this.maskHeight;
    } else {
      this.canvas = null;
    }

    this.ctx = this.canvas?.getContext?.('2d') ?? this.canvas?._ctx ?? null;
    /** @type {number} Révision du contenu, voir `_touch()`. */
    this.revision = 0;
    /** @type {number} Sources réellement peintes à la dernière composition. */
    this.paintedCount = 0;
    this.clear();
  }

  /**
   * Marque le champ comme modifié. Même mécanique que `ExploredFog._touch()` : le canvas est
   * muté **en place**, son identité ne change donc jamais quand son contenu change.
   */
  _touch() {
    this.revision++;
    if (this.canvas) this.canvas.__lightRevision = this.revision;
  }

  /** Éteint le champ : plus aucune lumière nulle part. */
  clear() {
    if (this.ctx) this.ctx.clearRect(0, 0, this.maskWidth, this.maskHeight);
    this.paintedCount = 0;
    this._touch();
  }

  /**
   * Compose le champ : une ambiante uniforme, puis une source après l'autre en **additif
   * plafonné**.
   *
   * ⭐ **Le polygone de sweep EST la forme de la lumière.** `sweep` échantillonne le cercle
   * complet (64 sommets) avant de le découper sur les murs : sans obstacle il rend un disque,
   * avec obstacles il rend le disque amputé de ce que les murs cachent. Remplir ce polygone
   * d'un dégradé radial donne donc l'occlusion **sans `clip()` et sans second tracé** — un
   * seul `fill` par source, exactement le profil de coût mesuré par M2 (1,80 ms pour
   * 93 sources sur Tab S9 FE).
   *
   * ⛔ **Toutes les sources sont occluses, y compris celles marquées `shadows: false`** —
   * décision §4.4b du 26/08/2026. Le champ nourrissant la vision, une lumière qui traverse un
   * mur ferait voir à travers ce mur. Le champ `shadows` reste importé et persisté ; c'est le
   * rapport d'import qui signale qu'il n'est pas honoré, jamais un silence.
   *
   * ⚠ **La rasterisation reste native.** La leçon de `fog.js` est chiffrée : une boucle de
   * pixels en JavaScript coûtait 51 ms par case là où un `fill()` natif en coûte 0,12.
   *
   * @param {PreparedLight[]} sources
   * @param {Object} options
   * @param {number} [options.ambientLevel] Ambiante de l'étage, 0 → 1
   * @param {Segment[]} [options.segments] Obstacles, en pixels carte
   * @param {MapPoint} options.mapOrigin Origine de la carte, en pixels carte
   * @param {number} options.gridScale Pixels carte par case
   * @returns {boolean} `true` si le champ a été recomposé
   */
  compose(sources, options) {
    if (!this.ctx) return false;
    const { ambientLevel = 0, segments = [], mapOrigin, gridScale } = options;
    if (!mapOrigin || !Number.isFinite(gridScale)) return false;

    const scale = FOG_MASK_PX_PER_CELL / Math.max(1, gridScale);
    const ctx = this.ctx;

    ctx.clearRect(0, 0, this.maskWidth, this.maskHeight);

    // L'ambiante est le plancher du champ, pas une source parmi d'autres : elle se pose en
    // `source-over` avant que quoi que ce soit ne s'y ajoute.
    //
    // ⭐ Elle est lue comme un vrai continu, décision §4.3 du 26/08/2026 : une carte importée
    // avec `ambient.level: 0.35` est rendue à 0,35 au lieu d'être traitée comme du plein jour.
    // Le panneau MJ, lui, n'écrit toujours que 0 ou 1 — UX-07 n'est pas défait.
    const ambiante = Math.min(Math.max(0, Number(ambientLevel) || 0), 1);
    if (ambiante > 0) {
      ctx.fillStyle = `rgba(255, 255, 255, ${ambiante})`;
      ctx.fillRect(0, 0, this.maskWidth, this.maskHeight);
    }

    let peintes = 0;
    ctx.save();
    // Additif plafonné — décision §4.4c. `lighter` borne chaque canal à sa valeur maximale,
    // ce qui EST le plafonnement : aucune arithmétique à écrire pour l'obtenir.
    ctx.globalCompositeOperation = 'lighter';

    for (const source of sources || []) {
      if (!source || !source.center) continue;
      const intensite = Math.min(Math.max(0, Number(source.intensity) || 0), 1);
      const rayonPx = Number(source.radiusPx) || 0;
      if (intensite <= 0 || rayonPx <= 0) continue;

      const polygone = sweep(source.center, segments, rayonPx);
      if (!Array.isArray(polygone) || polygone.length === 0) continue;

      const centreX = (source.center.x - mapOrigin.x) * scale;
      const centreY = (source.center.y - mapOrigin.y) * scale;
      const rayonMasque = Math.max(1, rayonPx * scale);
      const { red, green, blue } = parseLightColor(source.color);

      const degrade = ctx.createRadialGradient(centreX, centreY, 0, centreX, centreY, rayonMasque);
      degrade.addColorStop(0, `rgba(${red}, ${green}, ${blue}, ${intensite})`);
      degrade.addColorStop(1, `rgba(${red}, ${green}, ${blue}, 0)`);
      ctx.fillStyle = degrade;

      ctx.beginPath();
      const premier = polygone[0];
      ctx.moveTo((premier.x - mapOrigin.x) * scale, (premier.y - mapOrigin.y) * scale);
      for (let i = 1; i < polygone.length; i++) {
        const point = polygone[i];
        ctx.lineTo((point.x - mapOrigin.x) * scale, (point.y - mapOrigin.y) * scale);
      }
      ctx.closePath();
      ctx.fill();
      peintes++;
    }

    ctx.restore();
    this.paintedCount = peintes;
    this._touch();
    return true;
  }
}

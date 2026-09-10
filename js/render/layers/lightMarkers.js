// @ts-check

/**
 * @typedef {import('../../core/types.js').Level} Level
 * @typedef {import('../../grid/GridAdapter.js').GridAdapter} GridAdapter
 */

// Couche de marqueurs des lampes — chantier C-2, tranche 1 (modèle et marqueurs, aucune
// interaction : les gestes viennent après).
//
// ⛔ **Vue MJ SEULE**, décision du mainteneur du 10/09/2026. La couche `links.js` a déjà le
// précédent d'un rendu par rôle, suivi ici : c'est l'appelant (`gm.js`) qui décide de brancher
// cette couche, `player.js` ne la branche jamais.
//
// ⭐ **Les DEUX états se dessinent, allumée comme éteinte** — l'écart assumé au patron des
// portes (`portals.js`) : une porte fermée n'a pas besoin de se dessiner, le décor la montre
// déjà. Une lampe éteinte, si : rien dans le décor ne la signale.

/**
 * Couleurs des deux états. Choisies pour rester distinctes l'une de l'autre à l'œil, pas
 * seulement à l'analyse des canaux — la leçon du chantier Q (`statusBadges.js`) est qu'un
 * marqueur lu à trois écrans se juge par contraste, pas par nuance.
 */
const LIGHT_ON_FILL = '#fbbf24';
const LIGHT_ON_STROKE = '#78350f';
const LIGHT_OFF_FILL = '#374151';
const LIGHT_OFF_STROKE = '#d1d5db';

/**
 * Rendu des marqueurs de lampe d'un étage, sur l'écran du MJ.
 *
 * **Toutes ses grandeurs sont écrites en pixels écran puis divisées par le zoom** — même
 * convention que `links.js` et `portals.js` : le contexte reçu est déjà mis à l'échelle par
 * `camera.applyToContext`, une grandeur écrite crûment y serait juste à zoom 1 et fausse
 * partout ailleurs (leçon L-09).
 */
export class LightMarkersLayer {
  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {GridAdapter} grid
   * @param {Level} level
   * @param {{
   *   zoom?: number,
   *   dragPreview?: { lightId: string, mapPos: import('../../core/types.js').MapPoint }|null,
   * }} [options]
   * @returns {number} Nombre de marqueurs rendus.
   */
  render(ctx, grid, level, options = {}) {
    if (!ctx || !grid || !level || !Array.isArray(level.lights) || level.lights.length === 0) {
      return 0;
    }

    const zoom = Math.max(0.01, options.zoom ?? 1);
    const radius = 9 / zoom;
    let rendered = 0;

    ctx.save();
    for (const light of level.lights) {
      if (!light || !light.at) continue;
      // ⛔ `mapFromCellPoint` rend l'ORIGINE de la case (un coin), pas son centre — leçon du
      // jour (C-5). `cellCenter` prend un `Cell {a,b}` et rend toujours un centre, dans les
      // deux pavages ; `light.at` est un `CellPoint {cellX,cellY}`, d'où la conversion.
      // ⭐ Pendant un glisser MJ, SEUL ce marqueur suit le doigt — le champ éclairé reste où il
      // est, faute de mutation du store. Même patron que l'aperçu de pion (`tokens.js`) : la
      // position est celle du doigt, non accrochée à la grille, l'accrochage se fait au relâcher.
      const point =
        options.dragPreview?.lightId === light.id
          ? options.dragPreview.mapPos
          : grid.cellCenter({ a: light.at.cellX, b: light.at.cellY });
      // ⭐ Booléen à deux états, jamais un troisième : `on !== false` traite une valeur absente
      // comme allumée, ceinture de la normalisation faite par `schema.normalizeLevel`.
      const on = light.on !== false;

      ctx.save();
      ctx.globalAlpha = on ? 0.92 : 0.78;
      ctx.fillStyle = on ? LIGHT_ON_FILL : LIGHT_OFF_FILL;
      ctx.strokeStyle = on ? LIGHT_ON_STROKE : LIGHT_OFF_STROKE;
      ctx.lineWidth = 2 / zoom;
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      rendered++;
    }
    ctx.restore();

    return rendered;
  }
}

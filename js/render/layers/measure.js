// @ts-check

/**
 * @typedef {import('../../core/types.js').Level} Level
 * @typedef {import('../../core/types.js').MapPoint} MapPoint
 * @typedef {import('../../grid/GridAdapter.js').GridAdapter} GridAdapter
 * @typedef {import('../camera.js').Camera} Camera
 */

/**
 * Couche de rendu de l'outil de mesure de distance du MJ.
 *
 * Transitoire, locale au MJ, ne lit pas le store et ne publie aucun événement.
 */
export class MeasureLayer {
  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {GridAdapter} grid
   * @param {Level|null} level
   * @param {Object} options
   * @param {{ levelId: string, start: MapPoint, end: MapPoint|null, distance?: number }|null} [options.measure]
   * @param {Camera} [options.camera]
   */
  render(ctx, grid, level, options = {}) {
    const measure = options.measure ?? null;
    if (!ctx || !level || !grid || !measure || !measure.start) return;

    if (measure.levelId && measure.levelId !== level.id) return;

    const start = measure.start;
    const end = measure.end;
    if (!end) {
      // Un seul point armé : dessiner une pastille de départ
      ctx.save();
      ctx.beginPath();
      ctx.arc(start.x, start.y, 8, 0, Math.PI * 2);
      ctx.fillStyle = '#3b82f6';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
      return;
    }

    const cellA = grid.cellFromPoint(start);
    const cellB = grid.cellFromPoint(end);
    const distance = (cellA && cellB) ? grid.distance(cellA, cellB) : (measure.distance ?? 0);

    ctx.save();

    // Ligne de liaison en pointillés
    ctx.beginPath();
    ctx.setLineDash([8, 6]);
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.setLineDash([]);

    // Pastille de départ
    ctx.beginPath();
    ctx.arc(start.x, start.y, 7, 0, Math.PI * 2);
    ctx.fillStyle = '#3b82f6';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Pastille d'arrivée
    ctx.beginPath();
    ctx.arc(end.x, end.y, 7, 0, Math.PI * 2);
    ctx.fillStyle = '#3b82f6';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Pastille / Badge du texte de distance au milieu
    const midX = (start.x + end.x) / 2;
    const midY = (start.y + end.y) / 2;
    const label = `${distance} case${distance > 1 ? 's' : ''}`;

    ctx.font = 'bold 14px system-ui, sans-serif';
    const metrics = ctx.measureText(label);
    const padX = 8;
    const padY = 5;
    const boxW = metrics.width + padX * 2;
    const boxH = 22;

    ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
    ctx.beginPath();
    ctx.roundRect(midX - boxW / 2, midY - boxH / 2, boxW, boxH, 4);
    ctx.fill();
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, midX, midY);

    ctx.restore();
  }
}

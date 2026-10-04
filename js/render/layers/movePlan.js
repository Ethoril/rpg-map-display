// @ts-check

/** @typedef {import('../../core/types.js').Cell} Cell */
/** @typedef {import('../../core/types.js').MovePreview} MovePreview */
/** @typedef {import('../../grid/GridAdapter.js').GridAdapter} GridAdapter */

/** Dessine les préparations sans interaction, sous les gabarits, pions et brouillard. */
export class MovePlanLayer {
  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {GridAdapter} grid
   * @param {string} levelId
   * @param {MovePreview|null} localPreview
   * @param {Record<string,MovePreview>} remotePreviews
   * @param {number} zoom
   * @returns {number} nombre de trajets dessinés
   */
  render(ctx, grid, levelId, localPreview, remotePreviews = {}, zoom = 1) {
    if (!ctx || !grid) return 0;
    const previews = [localPreview, ...Object.values(remotePreviews)].filter(
      /** @returns {preview is MovePreview} */ (preview) => preview?.levelId === levelId && preview.path?.length > 1
    );
    for (let i = 0; i < previews.length; i++) this.draw(ctx, grid, previews[i], zoom, i === 0 && previews[i] === localPreview);
    return previews.length;
  }

  /** @param {CanvasRenderingContext2D} ctx @param {GridAdapter} grid @param {MovePreview} preview @param {number} zoom @param {boolean} local */
  draw(ctx, grid, preview, zoom, local) {
    const points = preview.path.map((cell) => grid.cellCenter(cell));
    const destination = preview.destination;
    const center = grid.cellCenter(destination);
    const bounds = grid.cellBounds({ cellX: destination.a, cellY: destination.b }, 1);
    const unit = Math.max(0.01, zoom);
    ctx.save();
    ctx.globalAlpha = local ? 0.95 : 0.68;
    ctx.strokeStyle = local ? '#ffbf47' : '#63d8ff';
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = 3 / unit;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.setLineDash([7 / unit, 4 / unit]);
    ctx.beginPath();
    points.forEach((point, index) => index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y));
    ctx.stroke();
    ctx.setLineDash([]);

    if (points.length >= 2) {
      const from = points[points.length - 2];
      const to = points[points.length - 1];
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const segmentLength = Math.hypot(dx, dy);
      const angle = Math.atan2(dy, dx);
      // Le point d'arrivée est dessiné ensuite au centre de la case. Placer la pointe
      // exactement à `to` la cachait sous son disque, surtout sur les grandes grilles.
      // On la recule du rayon du disque + une marge, en limitant le recul à ce segment.
      const markerRadius = Math.min(bounds.width, bounds.height) * 0.13;
      const size = Math.min(9 / unit, segmentLength * 0.35);
      const tipOffset = Math.min(segmentLength * 0.8, markerRadius + size * 0.65);
      const tipX = to.x - Math.cos(angle) * tipOffset;
      const tipY = to.y - Math.sin(angle) * tipOffset;
      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(tipX - size * Math.cos(angle - 0.48), tipY - size * Math.sin(angle - 0.48));
      ctx.lineTo(tipX - size * Math.cos(angle + 0.48), tipY - size * Math.sin(angle + 0.48));
      ctx.closePath();
      ctx.fill();
    }

    // Le contour de la case garde une arrivée identifiable sur les deux topologies.
    ctx.lineWidth = 3 / unit;
    ctx.beginPath();
    grid.cellPath(ctx, destination);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(center.x, center.y, Math.min(bounds.width, bounds.height) * 0.13, 0, Math.PI * 2);
    ctx.fill();

    const fontSize = 15 / unit;
    ctx.font = `700 ${fontSize}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 4 / unit;
    ctx.strokeStyle = '#101820';
    const label = String(Math.max(0, Math.round(preview.remaining * 100) / 100));
    const labelX = center.x + bounds.width * 0.28;
    const labelY = center.y - bounds.height * 0.28;
    ctx.strokeText(label, labelX, labelY);
    ctx.fillStyle = local ? '#fff2c8' : '#d8f6ff';
    ctx.fillText(label, labelX, labelY);
    ctx.restore();
  }
}

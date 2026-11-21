// @ts-check

/** @typedef {import('../../core/types.js').Cell} Cell */
/** @typedef {import('../../core/types.js').MovePreview} MovePreview */
/** @typedef {import('../../grid/GridAdapter.js').GridAdapter} GridAdapter */
/** @typedef {import('../camera.js').Camera} Camera */

const CONFIRM_LABEL = 'Retoucher ici pour déplacer';
const RUN_LABEL = 'Course : Action utilisée';

/** @param {MovePreview} preview */
const remainingLabel = (preview) => String(Math.max(0, Math.round(preview.remaining * 100) / 100));

/** Dessine les préparations sans interaction, sous les gabarits, pions et brouillard. */
export class MovePlanLayer {
  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {GridAdapter} grid
   * @param {string} levelId
   * @param {MovePreview|null} localPreview
   * @param {Record<string,MovePreview>} remotePreviews
   * @param {number} zoom
   * @param {((preview: MovePreview) => number)|null} [ranStartOf] Index du trajet où commence la Course
   *   (`ranStartIndex`), -1 si tout est à la Marche. Absent : un seul style, comme avant.
   * @param {boolean} [localLabels] Dessine les libellés locaux sous le brouillard. Désactivé si
   *   `renderConfirmation` les dessine avec l'invite au-dessus du brouillard.
   * @returns {number} nombre de trajets dessinés
   */
  render(ctx, grid, levelId, localPreview, remotePreviews = {}, zoom = 1, ranStartOf = null, localLabels = true) {
    if (!ctx || !grid) return 0;
    const previews = [localPreview, ...Object.values(remotePreviews)].filter(
      /** @returns {preview is MovePreview} */ (preview) => preview?.levelId === levelId && preview.path?.length > 1
    );
    for (const preview of previews) {
      const local = preview === localPreview;
      this.draw(ctx, grid, preview, zoom, local, ranStartOf?.(preview) ?? -1, !local || localLabels);
    }
    return previews.length;
  }

  /** @param {CanvasRenderingContext2D} ctx @param {GridAdapter} grid @param {MovePreview} preview @param {number} zoom @param {boolean} local @param {number} [ranStart] @param {boolean} [labels] */
  draw(ctx, grid, preview, zoom, local, ranStart = -1, labels = true) {
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
    const walkEnd = ranStart > 0 ? ranStart : points.length;
    points.slice(0, walkEnd).forEach((point, index) => index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y));
    ctx.stroke();
    if (ranStart > 0) {
      // Au-delà de la Marche : trait plus épais, en pointillés serrés, d'une autre teinte.
      ctx.save();
      ctx.strokeStyle = local ? '#ff7a3d' : '#b69bff';
      ctx.lineWidth = 5 / unit;
      ctx.setLineDash([3 / unit, 5 / unit]);
      ctx.beginPath();
      points.slice(ranStart - 1).forEach((point, index) => index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y));
      ctx.stroke();
      ctx.restore();
    }
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

    if (!labels) {
      ctx.restore();
      return;
    }

    const fontSize = 15 / unit;
    ctx.font = `700 ${fontSize}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 4 / unit;
    ctx.strokeStyle = '#101820';
    const label = remainingLabel(preview);
    const labelX = center.x + bounds.width * 0.28;
    const labelY = center.y - bounds.height * 0.28;
    ctx.strokeText(label, labelX, labelY);
    ctx.fillStyle = local ? '#fff2c8' : '#d8f6ff';
    ctx.fillText(label, labelX, labelY);
    if (ranStart > 0) {
      // Courir coûte l'Action du Tour : dit en toutes lettres, sur l'écran MJ comme sur la tablette.
      const runY = center.y + bounds.height * 0.62;
      ctx.font = `700 ${14 / unit}px system-ui, sans-serif`;
      ctx.lineWidth = 4 / unit;
      ctx.strokeStyle = '#101820';
      ctx.strokeText(RUN_LABEL, center.x, runY);
      ctx.fillStyle = '#ffd9b8';
      ctx.fillText(RUN_LABEL, center.x, runY);
    }
    ctx.restore();
  }

  /**
   * Invite de l'écran qui détient le trajet, au-dessus du brouillard et à taille écran constante.
   * @param {CanvasRenderingContext2D} ctx Contexte avec le zoom et le pan de la carte
   * @param {GridAdapter} grid
   * @param {MovePreview} preview
   * @param {Camera} camera
   * @param {number} ranStart
   * @param {{top?: number, selectionStrip?: {left: number, top: number, bottom: number}}} [insets]
   */
  renderConfirmation(ctx, grid, preview, camera, ranStart, insets = {}) {
    const { a, b } = preview.destination;
    const center = grid.cellCenter(preview.destination);
    const { screenX, screenY } = camera.mapToScreen(center);
    const { zoom, screenWidth, screenHeight } = camera;
    if (screenX < 0 || screenX > screenWidth || screenY < 0 || screenY > screenHeight) return;

    const margin = 8;
    const padding = 10;
    const top = (insets.top ?? 0) + margin;
    const bottom = screenHeight - margin;
    const bounds = grid.cellBounds({ cellX: a, cellY: b }, 1);
    const cellEdge = bounds.height * zoom / 2;
    const height = ranStart > 0 ? 66 : 48;
    if (bottom - top < height) return;
    const below = screenY + cellEdge + margin;
    const above = screenY - cellEdge - margin;
    const placeBelow = below + height <= bottom || above - height < top;
    const y = Math.max(top, Math.min(bottom - height, placeBelow ? below : above - height));
    const strip = insets.selectionStrip;
    const right = (strip && y < strip.bottom && y + height > strip.top ? strip.left : screenWidth) - margin;
    if (right - margin <= padding * 2) return;

    ctx.save();
    // La case visée est déjà connue du joueur. Son contour doit rester repérable même si le
    // brouillard masque la carte et la fin du trajet sous l'invite.
    ctx.strokeStyle = '#ffbf47';
    ctx.lineWidth = 2.5 / zoom;
    ctx.beginPath();
    grid.cellPath(ctx, preview.destination);
    ctx.stroke();
    ctx.translate(center.x, center.y);
    ctx.scale(1 / zoom, 1 / zoom);
    ctx.translate(-screenX, -screenY);
    ctx.font = '700 16px system-ui, sans-serif';
    const width = Math.min(right - margin, Math.ceil(ctx.measureText(CONFIRM_LABEL).width) + padding * 2);
    const x = Math.max(margin, Math.min(right - width, screenX - width / 2));
    const boxEdge = placeBelow ? y : y + height;

    // Le trait relie l'invite à l'arrivée quand le bord de l'écran décale le texte.
    if (placeBelow ? boxEdge > screenY + cellEdge : boxEdge < screenY - cellEdge) {
      ctx.beginPath();
      ctx.moveTo(screenX, screenY + (placeBelow ? cellEdge : -cellEdge));
      ctx.lineTo(Math.max(x + padding, Math.min(x + width - padding, screenX)), boxEdge);
      ctx.strokeStyle = '#ffbf47';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, 6);
    ctx.fillStyle = '#101820';
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff2c8';
    const textX = x + width / 2;
    const textWidth = width - padding * 2;
    ctx.fillText(CONFIRM_LABEL, textX, y + 14, textWidth);
    ctx.font = '600 15px system-ui, sans-serif';
    ctx.fillText(`${remainingLabel(preview)} de portée restante`, textX, y + 34, textWidth);
    if (ranStart > 0) {
      ctx.fillStyle = '#ffd9b8';
      ctx.fillText(RUN_LABEL, textX, y + 52, textWidth);
    }
    ctx.restore();
  }
}

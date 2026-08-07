// @ts-check

/** @typedef {import('../../core/types.js').Link} Link */
/** @typedef {import('../../core/types.js').Level} Level */
/** @typedef {import('../../grid/GridAdapter.js').GridAdapter} GridAdapter */

const LINK_SYMBOL = Object.freeze({
  stairs: '↕', elevator: '⇅', ladder: '⇵', hatch: '⇳', passage: '↔',
});

/** Rendu des extrémités de liaison. Le MJ obtient libellé et sens ; les joueurs un repère discret. */
export class LinksLayer {
  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {GridAdapter} grid
   * @param {Level} level
   * @param {Link[]} links
   * @param {{role?: 'gm'|'players', selectedLinkId?: string|null, zoom?: number}} [options]
   */
  render(ctx, grid, level, links, options = {}) {
    if (!ctx || !grid || !level || !Array.isArray(links)) return 0;
    const role = options.role ?? 'gm';
    const zoom = Math.max(0.01, options.zoom ?? 1);
    const radius = 10 / zoom;
    let rendered = 0;
    ctx.save();
    ctx.font = `${12 / zoom}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const link of links) {
      if (role === 'players' && link.gmOnly) continue;
      const isA = link.a.levelId === level.id;
      const isB = link.b.levelId === level.id;
      // Une sortie à sens unique ne doit pas inviter les joueurs à retaper une
      // entrée B qui ne les mènera nulle part.
      if (role === 'players' && !link.bidirectional && isB) continue;
      const endpoint = isA ? link.a : isB ? link.b : null;
      if (!endpoint) continue;
      const point = grid.pointFromCell({ a: endpoint.at.cellX, b: endpoint.at.cellY });
      const selected = role === 'gm' && options.selectedLinkId === link.id;
      ctx.save();
      ctx.globalAlpha = role === 'players' ? 0.48 : 0.9;
      ctx.fillStyle = selected ? '#f5a623' : '#2563eb';
      ctx.strokeStyle = selected ? '#fff7d6' : '#dbeafe';
      ctx.lineWidth = (selected ? 3 : 2) / zoom;
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.fillText(LINK_SYMBOL[link.kind] ?? '↕', point.x, point.y + 0.5 / zoom);
      if (role === 'gm') {
        const direction = link.bidirectional ? '↔' : endpoint === link.a ? 'A→B' : 'B';
        const label = `${link.label || link.kind} ${direction}`;
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#111827';
        ctx.lineWidth = 3 / zoom;
        ctx.strokeText(label, point.x, point.y - 18 / zoom);
        ctx.fillText(label, point.x, point.y - 18 / zoom);
      }
      ctx.restore();
      rendered++;
    }
    ctx.restore();
    return rendered;
  }
}

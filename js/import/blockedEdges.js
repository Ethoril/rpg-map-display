// @ts-check

import { edgeKey } from '../core/cellKey.js';

/** @typedef {import('../core/types.js').Level} Level */
/** @typedef {import('../core/types.js').Portal} Portal */
/** @typedef {import('../grid/GridAdapter.js').GridAdapter} GridAdapter */
/** @typedef {{ x: number, y: number }} Point */

/**
 * Cache privé du masque d'arêtes bloquées par étage (clé = levelId).
 * L'instance de Map reste encapsulée et non exposée à l'extérieur.
 *
 * @type {Map<string, { signature: string, edges: Set<string> }>}
 */
const cache = new Map();

let computeCount = 0;

/**
 * Compteur du nombre de calculs géométriques réels effectués.
 * @returns {number}
 */
export function getBlockedEdgesComputeCount() {
  return computeCount;
}

/**
 * Réinitialise le compteur de calculs réels.
 * @returns {void}
 */
export function resetBlockedEdgesComputeCount() {
  computeCount = 0;
}

/**
 * Indique si un portail/porte est ouvert.
 * Supporte `portal.closed` (booléen) et le futur `portal.state` ('open' | 'closed' | 'locked').
 * Une porte n'est ouverte que si state === 'open' ou (!state && closed === false).
 *
 * @param {Portal} portal
 * @returns {boolean}
 */
export function isPortalOpen(portal) {
  if (!portal) return false;
  if (typeof portal.state === 'string') {
    return portal.state === 'open';
  }
  return portal.closed === false;
}

/**
 * Calcule l'empreinte géométrique d'un étage pour valider le cache.
 *
 * @param {Level} level
 * @returns {string}
 */
function getGeometrySignature(level) {
  if (!level) return '';

  /** @type {string[]} */
  const wallParts = [];
  if (Array.isArray(level.walls)) {
    for (let i = 0; i < level.walls.length; i++) {
      const poly = level.walls[i];
      if (Array.isArray(poly)) {
        for (let j = 0; j < poly.length; j++) {
          const p = poly[j];
          if (p) {
            wallParts.push(`${p.cellX},${p.cellY}`);
          }
        }
      }
    }
  }

  /** @type {string[]} */
  const portalParts = [];
  if (Array.isArray(level.portals)) {
    for (let i = 0; i < level.portals.length; i++) {
      const p = level.portals[i];
      if (p) {
        portalParts.push(`${p.id}:${p.a?.cellX},${p.a?.cellY}-${p.b?.cellX},${p.b?.cellY}:${isPortalOpen(p)}`);
      }
    }
  }

  return `${level.id || 'default'}_w:${wallParts.join(';')}_p:${portalParts.join(';')}`;
}

/**
 * Invalide le cache d'un étage spécifique (ex. lors d'un `portal.toggle`)
 * ou vider le cache entier si aucun `levelId` n'est spécifié.
 *
 * @param {string} [levelId]
 * @returns {void}
 */
export function invalidateBlockedEdgesCache(levelId) {
  if (levelId) {
    cache.delete(levelId);
  } else {
    cache.clear();
  }
}

/**
 * Teste si le point P est sur le segment [A, B] (bornes incluses) avec une tolérance epsilon.
 *
 * @param {Point} P
 * @param {Point} A
 * @param {Point} B
 * @param {number} [eps]
 * @returns {boolean}
 */
function isPointOnSegment(P, A, B, eps = 1e-9) {
  return (
    P.x >= Math.min(A.x, B.x) - eps &&
    P.x <= Math.max(A.x, B.x) + eps &&
    P.y >= Math.min(A.y, B.y) - eps &&
    P.y <= Math.max(A.y, B.y) + eps &&
    Math.abs((B.x - A.x) * (P.y - A.y) - (B.y - A.y) * (P.x - A.x)) <= eps
  );
}

/**
 * Teste si le segment [A, B] croise le segment [C, D].
 * Traitement explicite des chevauchements colinéaires et des contacts aux extrémités.
 *
 * @param {Point} A
 * @param {Point} B
 * @param {Point} C
 * @param {Point} D
 * @param {number} [eps]
 * @returns {boolean}
 */
export function segmentsIntersect(A, B, C, D, eps = 1e-9) {
  const minAxBx = Math.min(A.x, B.x);
  const maxAxBx = Math.max(A.x, B.x);
  const minAyBy = Math.min(A.y, B.y);
  const maxAyBy = Math.max(A.y, B.y);

  const minCxDx = Math.min(C.x, D.x);
  const maxCxDx = Math.max(C.x, D.x);
  const minCyDy = Math.min(C.y, D.y);
  const maxCyDy = Math.max(C.y, D.y);

  // Pré-filtre par boîtes englobantes
  if (
    maxAxBx < minCxDx - eps ||
    minAxBx > maxCxDx + eps ||
    maxAyBy < minCyDy - eps ||
    minAyBy > maxCyDy + eps
  ) {
    return false;
  }

  const cp1 = (B.x - A.x) * (C.y - A.y) - (B.y - A.y) * (C.x - A.x);
  const cp2 = (B.x - A.x) * (D.y - A.y) - (B.y - A.y) * (D.x - A.x);
  const cp3 = (D.x - C.x) * (A.y - C.y) - (D.y - C.y) * (A.x - C.x);
  const cp4 = (D.x - C.x) * (B.y - C.y) - (D.y - C.y) * (B.x - C.x);

  // Cas général : chevauchement strict
  if (
    ((cp1 > eps && cp2 < -eps) || (cp1 < -eps && cp2 > eps)) &&
    ((cp3 > eps && cp4 < -eps) || (cp3 < -eps && cp4 > eps))
  ) {
    return true;
  }

  // Cas de contact ou de colinéarité
  if (Math.abs(cp1) <= eps && isPointOnSegment(C, A, B, eps)) return true;
  if (Math.abs(cp2) <= eps && isPointOnSegment(D, A, B, eps)) return true;
  if (Math.abs(cp3) <= eps && isPointOnSegment(A, C, D, eps)) return true;
  if (Math.abs(cp4) <= eps && isPointOnSegment(B, C, D, eps)) return true;

  return false;
}

/**
 * Structure représentant un segment de mur ou de portail.
 * @typedef {{ A: Point, B: Point, id: number }} Segment
 */

/**
 * Extrait tous les segments d'obstacles (murs et portails non ouverts) d'un étage.
 * Si un GridAdapter est fourni, les coordonnées sont converties en pixels carte ({ p1, p2 }).
 * Sinon, elles restent en coordonnées de case ({ A, B }).
 *
 * @param {Level} level
 * @param {GridAdapter} [grid]
 * @returns {Array<any>}
 */
export function extractBlockedSegments(level, grid) {
  if (!level) return [];

  /** @type {Array<any>} */
  const segments = [];

  if (Array.isArray(level.walls)) {
    for (const polyline of level.walls) {
      if (!Array.isArray(polyline) || polyline.length < 2) continue;
      for (let i = 0; i < polyline.length - 1; i++) {
        const p1 = polyline[i];
        const p2 = polyline[i + 1];
        if (p1 && p2) {
          if (grid) {
            segments.push({
              p1: grid.mapFromCellPoint(p1),
              p2: grid.mapFromCellPoint(p2),
            });
          } else {
            segments.push({
              A: { x: p1.cellX, y: p1.cellY },
              B: { x: p2.cellX, y: p2.cellY },
            });
          }
        }
      }
    }
  }

  if (Array.isArray(level.portals)) {
    for (const portal of level.portals) {
      if (portal && !isPortalOpen(portal)) {
        if (grid) {
          segments.push({
            p1: grid.mapFromCellPoint(portal.a),
            p2: grid.mapFromCellPoint(portal.b),
          });
        } else {
          segments.push({
            A: { x: portal.a.cellX, y: portal.a.cellY },
            B: { x: portal.b.cellX, y: portal.b.cellY },
          });
        }
      }
    }
  }

  return segments;
}

/**
 * Calcul du masque d'arêtes de grille bloquées à partir de la géométrie de l'étage.
 * Utilise un cache interne basé sur l'identifiant et l'empreinte géométrique de l'étage.
 * Retourne TOUJOURS une copie défensive (`new Set`) pour empêcher toute corruption externe du cache.
 *
 * @param {Level} level
 * @param {GridAdapter} grid
 * @returns {Set<string>} Set de clés d'arêtes canoniques (obtenues via `edgeKey`)
 */
export function computeBlockedEdges(level, grid) {
  if (!level || !grid) return new Set();

  const levelId = level.id || 'default';
  const signature = getGeometrySignature(level);

  const cached = cache.get(levelId);
  if (cached && cached.signature === signature) {
    return new Set(cached.edges);
  }

  computeCount++;

  const blocked = new Set();

  const rawSegments = extractBlockedSegments(level);
  /** @type {Segment[]} */
  const segments = rawSegments.map((seg, idx) => ({ ...seg, id: idx }));

  if (segments.length > 0) {

    const width = level.widthCells;
    const height = level.heightCells;

    // 3. Indexation spatiale (buckets par case)
    /** @type {Map<number, Segment[]>} */
    const buckets = new Map();

    for (const seg of segments) {
      const minCol = Math.max(0, Math.floor(Math.min(seg.A.x, seg.B.x) - 1e-9));
      const maxCol = Math.min(width - 1, Math.floor(Math.max(seg.A.x, seg.B.x) + 1e-9));
      const minRow = Math.max(0, Math.floor(Math.min(seg.A.y, seg.B.y) - 1e-9));
      const maxRow = Math.min(height - 1, Math.floor(Math.max(seg.A.y, seg.B.y) + 1e-9));

      for (let col = minCol; col <= maxCol; col++) {
        for (let row = minRow; row <= maxRow; row++) {
          const cellIdx = row * width + col;
          let bucket = buckets.get(cellIdx);
          if (!bucket) {
            bucket = [];
            buckets.set(cellIdx, bucket);
          }
          bucket.push(seg);
        }
      }
    }

    const processedEdges = new Set();
    /** @type {Segment[]} */
    const candidateSegs = [];

    // 4. Parcourir toutes les cases de la grille et leurs 8 voisines
    for (let a = 0; a < width; a++) {
      for (let b = 0; b < height; b++) {
        const cell = { a, b };
        const cellIdx = b * width + a;
        const cellBucket = buckets.get(cellIdx);

        const neighbors = grid.neighbors(cell);
        const centerA = { x: a + 0.5, y: b + 0.5 };

        for (const n of neighbors) {
          const key = edgeKey(cell, n);
          if (processedEdges.has(key)) continue;
          processedEdges.add(key);

          const neighborIdx = n.b * width + n.a;
          const neighborBucket = buckets.get(neighborIdx);

          if (!cellBucket && !neighborBucket) continue;

          const centerB = { x: n.a + 0.5, y: n.b + 0.5 };

          candidateSegs.length = 0;
          if (cellBucket) {
            for (let i = 0; i < cellBucket.length; i++) {
              candidateSegs.push(cellBucket[i]);
            }
          }
          if (neighborBucket) {
            for (let i = 0; i < neighborBucket.length; i++) {
              const seg = neighborBucket[i];
              if (!cellBucket || !cellBucket.includes(seg)) {
                candidateSegs.push(seg);
              }
            }
          }

          // Test d'intersection avec les candidats
          for (let i = 0; i < candidateSegs.length; i++) {
            const seg = candidateSegs[i];
            if (segmentsIntersect(seg.A, seg.B, centerA, centerB)) {
              blocked.add(key);
              break;
            }
          }
        }
      }
    }
  }

  cache.set(levelId, {
    signature,
    edges: new Set(blocked),
  });

  return new Set(blocked);
}
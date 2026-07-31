// @ts-check

/** @typedef {import('../core/types.js').MapPoint} MapPoint */
/** @typedef {import('../core/types.js').Segment} Segment */

/**
 * Justification du choix de EPSILON_ANGLE (§3 de TRANCHE-L02-SWEEP-VISIBILITE.md) :
 * À une portée maximale d ≈ 2800 px (20 cases), un décalage angulaire de 1e-5 rad produit
 * un déplacement tangentiel d * ε ≈ 0.028 px. Ce décalage est largement sous le seuil
 * sous-pixel (0.1 px) et évite tout décalage visible, tout en restant supérieur à la
 * précision machine (1e-12) pour franchir de façon robuste l'extrémité d'un mur sans fuite.
 */
const EPSILON_ANGLE = 1e-5;

/** Nombre d'échantillons angulaires de base pour la discrétisation du cercle de portée */
const BASE_CIRCLE_SAMPLES = 64;

let lastEvalSegmentCount = 0;

/**
 * Compteur du nombre de segments effectivement retenus à portée lors du dernier sweep.
 * Utilisé pour la vérification non-instable de la portée dans les tests unitaires.
 * @returns {number}
 */
export function getLastEvalSegmentCount() {
  return lastEvalSegmentCount;
}

/**
 * Distance au carré entre un point P et un segment [A, B].
 *
 * @param {MapPoint} P
 * @param {MapPoint} A
 * @param {MapPoint} B
 * @returns {number}
 */
function distPointToSegmentSq(P, A, B) {
  const vx = B.x - A.x;
  const vy = B.y - A.y;
  const wx = P.x - A.x;
  const wy = P.y - A.y;

  const c1 = wx * vx + wy * vy;
  if (c1 <= 0) {
    return wx * wx + wy * wy;
  }

  const c2 = vx * vx + vy * vy;
  if (c2 <= c1) {
    const bx = P.x - B.x;
    const by = P.y - B.y;
    return bx * bx + by * by;
  }

  const b = c1 / c2;
  const projX = A.x + b * vx;
  const projY = A.y + b * vy;
  const dx = P.x - projX;
  const dy = P.y - projY;
  return dx * dx + dy * dy;
}

/**
 * Normalise un angle en radians dans l'intervalle [0, 2π).
 *
 * @param {number} angle
 * @returns {number}
 */
function normalizeAngle(angle) {
  const twoPi = Math.PI * 2;
  let a = angle % twoPi;
  if (a < 0) a += twoPi;
  return a;
}

/**
 * Calcule le polygone de visibilité d'un point dans un ensemble de segments avec portée.
 *
 * Contrat §1 :
 * sweep(origin: MapPoint, segments: Segment[], maxRangePx: number) -> MapPoint[]
 *
 * @param {MapPoint} origin Origine du regard (pixels carte)
 * @param {Segment[]} segments Segments faisant obstacle (pixels carte)
 * @param {number} maxRangePx Portée maximale de la vision (pixels carte)
 * @returns {MapPoint[]} Polygone fermé de visibilité (sommets ordonnés en pixels carte)
 */
export function sweep(origin, segments, maxRangePx) {
  if (!origin || typeof origin.x !== 'number' || typeof origin.y !== 'number') {
    return [];
  }
  if (!Array.isArray(segments) || typeof maxRangePx !== 'number' || maxRangePx <= 0) {
    return [];
  }

  const maxRangeSq = maxRangePx * maxRangePx;

  // 1. Tri par portée : isoler uniquement les segments interceptant le disque de portée
  /** @type {Segment[]} */
  const inRangeSegments = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (!seg || !seg.p1 || !seg.p2) continue;
    if (distPointToSegmentSq(origin, seg.p1, seg.p2) <= maxRangeSq) {
      inRangeSegments.push(seg);
    }
  }

  lastEvalSegmentCount = inRangeSegments.length;

  // 2. Collecte des angles de lancer de rayons
  /** @type {Set<number>} */
  const anglesSet = new Set();

  // 2a. Échantillonnage uniforme du cercle pour garantir un polygone discrétisé fermé (Critère 4)
  for (let i = 0; i < BASE_CIRCLE_SAMPLES; i++) {
    anglesSet.add((i * Math.PI * 2) / BASE_CIRCLE_SAMPLES);
  }

  // 2b. Triplet (θ-ε, θ, θ+ε) pour chaque sommet de segment situé dans la portée
  for (let i = 0; i < inRangeSegments.length; i++) {
    const seg = inRangeSegments[i];
    const pts = [seg.p1, seg.p2];
    for (let j = 0; j < 2; j++) {
      const pt = pts[j];
      const dx = pt.x - origin.x;
      const dy = pt.y - origin.y;
      const dSq = dx * dx + dy * dy;
      if (dSq <= maxRangeSq) {
        const theta = Math.atan2(dy, dx);
        anglesSet.add(normalizeAngle(theta - EPSILON_ANGLE));
        anglesSet.add(normalizeAngle(theta));
        anglesSet.add(normalizeAngle(theta + EPSILON_ANGLE));
      }
    }
  }

  const sortedAngles = Array.from(anglesSet).sort((a, b) => a - b);

  // 3. Lancer des rayons et calcul de l'intersection la plus proche
  /** @type {Array<{ angle: number, point: MapPoint }>} */
  const rayHits = [];

  for (let i = 0; i < sortedAngles.length; i++) {
    const angle = sortedAngles[i];
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);

    let minT = maxRangePx;

    for (let j = 0; j < inRangeSegments.length; j++) {
      const seg = inRangeSegments[j];
      const p1 = seg.p1;
      const p2 = seg.p2;

      const wx = p2.x - p1.x;
      const wy = p2.y - p1.y;

      const det = cosA * wy - sinA * wx;
      if (Math.abs(det) < 1e-12) continue; // Rayon parallèle au segment

      const dx = p1.x - origin.x;
      const dy = p1.y - origin.y;

      const t = (dx * wy - dy * wx) / det;
      const u = (dx * sinA - dy * cosA) / det;

      if (t > 1e-9 && t < minT && u >= -1e-9 && u <= 1 + 1e-9) {
        minT = t;
      }
    }

    rayHits.push({
      angle,
      point: {
        x: origin.x + minT * cosA,
        y: origin.y + minT * sinA,
      },
    });
  }

  // 4. Nettoyage des points quasi-dupliqués consécutifs
  /** @type {MapPoint[]} */
  const polygon = [];

  for (let i = 0; i < rayHits.length; i++) {
    const pt = rayHits[i].point;
    if (polygon.length === 0) {
      polygon.push(pt);
    } else {
      const prev = polygon[polygon.length - 1];
      const distSq = (pt.x - prev.x) ** 2 + (pt.y - prev.y) ** 2;
      if (distSq > 1e-6) {
        polygon.push(pt);
      }
    }
  }

  // Fermer proprement si le dernier point est très proche du premier
  if (polygon.length > 1) {
    const first = polygon[0];
    const last = polygon[polygon.length - 1];
    if ((first.x - last.x) ** 2 + (first.y - last.y) ** 2 <= 1e-6) {
      polygon.pop();
    }
  }

  return polygon;
}

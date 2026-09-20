import type { Point2D } from './PolygonSlicingEngine';

const EPS = 1e-7;
const cross = (a: Point2D, b: Point2D, c: Point2D) =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

function triangulate(points: Point2D[]): Point2D[][] {
  const polygon = points.filter((p, i) => Math.hypot(p.x - points[(i + 1) % points.length].x,
    p.y - points[(i + 1) % points.length].y) > EPS);
  const area = polygon.reduce((sum, p, i) => {
    const next = polygon[(i + 1) % polygon.length];
    return sum + p.x * next.y - next.x * p.y;
  }, 0);
  if (area < 0) polygon.reverse();
  const triangles: Point2D[][] = [];
  while (polygon.length > 3) {
    let removed = false;
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[(i + polygon.length - 1) % polygon.length];
      const b = polygon[i], c = polygon[(i + 1) % polygon.length];
      const turn = cross(a, b, c);
      if (turn < -EPS) continue;
      if (turn > EPS && polygon.some(p => p !== a && p !== b && p !== c &&
        cross(a, b, p) >= -EPS && cross(b, c, p) >= -EPS && cross(c, a, p) >= -EPS)) continue;
      if (turn > EPS) triangles.push([a, b, c]);
      polygon.splice(i, 1);
      removed = true;
      break;
    }
    // Invalid/self-intersecting input must not be treated as free material.
    if (!removed) return [];
  }
  if (polygon.length === 3 && Math.abs(cross(polygon[0], polygon[1], polygon[2])) > EPS) {
    triangles.push(polygon);
  }
  return triangles;
}

function trianglesOverlap(a: Point2D[], b: Point2D[]): boolean {
  for (const polygon of [a, b]) {
    for (let i = 0; i < polygon.length; i++) {
      const p = polygon[i], q = polygon[(i + 1) % polygon.length];
      const length = Math.hypot(q.x - p.x, q.y - p.y);
      const projection = (point: Point2D) => ((q.y - p.y) * point.x - (q.x - p.x) * point.y) / length;
      const pa = a.map(projection), pb = b.map(projection);
      if (Math.min(Math.max(...pa), Math.max(...pb)) - Math.max(Math.min(...pa), Math.min(...pb)) <= EPS) return false;
    }
  }
  return true;
}

function pointSegmentDistance(p: Point2D, a: Point2D, b: Point2D): number {
  const dx = b.x - a.x, dy = b.y - a.y, lengthSq = dx * dx + dy * dy;
  const t = lengthSq ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

/** True for disjoint simple polygons, with the requested edge-to-edge clearance in mm. */
export function polygonsSeparated(a: Point2D[], b: Point2D[], clearance: number): boolean {
  const ta = triangulate(a), tb = triangulate(b);
  if (!ta.length || !tb.length || ta.some(x => tb.some(y => trianglesOverlap(x, y)))) return false;
  if (clearance <= EPS) return true;
  for (let i = 0; i < a.length; i++) {
    const p = a[i], q = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j++) {
      const r = b[j], s = b[(j + 1) % b.length];
      if (Math.min(pointSegmentDistance(p, r, s), pointSegmentDistance(q, r, s),
        pointSegmentDistance(r, p, q), pointSegmentDistance(s, p, q)) < clearance - EPS) return false;
    }
  }
  return true;
}

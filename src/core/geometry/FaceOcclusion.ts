export interface DepthPoint { x: number; y: number; depth: number }
interface DepthPlane { x: number; y: number; offset: number }
interface Bounds { left: number; right: number; top: number; bottom: number }
export interface OccludingFace {
  points: DepthPoint[];
  plane: DepthPlane;
  bounds: Bounds;
}

// Orthographic depth increases towards the camera, including camera elevation.
export function cameraDepth(p: { x: number; y: number; z: number }, angle: number, elevation: number): number {
  const a = angle * Math.PI / 180, e = elevation * Math.PI / 180;
  return (p.x * Math.sin(a) + p.z * Math.cos(a)) * Math.cos(e) + p.y * Math.sin(e);
}

function bounds(points: DepthPoint[]): Bounds {
  return { left: Math.min(...points.map(p => p.x)), right: Math.max(...points.map(p => p.x)),
    top: Math.min(...points.map(p => p.y)), bottom: Math.max(...points.map(p => p.y)) };
}

export function occludingFace(points: DepthPoint[]): OccludingFace | null {
  if (points.length < 3) return null;
  const origin = points[0];
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const ax = a.x - origin.x, ay = a.y - origin.y;
    const bx = b.x - origin.x, by = b.y - origin.y;
    const determinant = ax * by - ay * bx;
    if (Math.abs(determinant) < 1e-8) continue;
    const ad = a.depth - origin.depth, bd = b.depth - origin.depth;
    const x = (ad * by - ay * bd) / determinant;
    const y = (ax * bd - ad * bx) / determinant;
    return { points, plane: { x, y, offset: origin.depth - x * origin.x - y * origin.y }, bounds: bounds(points) };
  }
  return null;
}

/** Portions of solid faces closer than the surface being drawn. Coplanar faces stay visible. */
export function hiddenFaceRegions(surface: DepthPoint[], occluders: OccludingFace[]): DepthPoint[][] {
  const face = occludingFace(surface);
  if (!face) return [];
  const regions: DepthPoint[][] = [];
  for (const other of occluders) {
    if (other.bounds.right <= face.bounds.left || other.bounds.left >= face.bounds.right ||
        other.bounds.bottom <= face.bounds.top || other.bounds.top >= face.bounds.bottom) continue;
    const difference = (p: DepthPoint) => (other.plane.x - face.plane.x) * p.x +
      (other.plane.y - face.plane.y) * p.y + other.plane.offset - face.plane.offset - 0.1;
    const polygon: DepthPoint[] = [];
    for (let i = 0; i < other.points.length; i++) {
      const a = other.points[i], b = other.points[(i + 1) % other.points.length];
      const da = difference(a), db = difference(b);
      if (da > 0) polygon.push(a);
      if ((da > 0) !== (db > 0)) {
        const u = da / (da - db);
        polygon.push({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u,
          depth: a.depth + (b.depth - a.depth) * u });
      }
    }
    if (polygon.length >= 3) regions.push(polygon);
  }
  return regions;
}

interface ScreenPoint { x: number; y: number }

function signedArea(points: ScreenPoint[]): number {
  return points.reduce((area, a, i) => {
    const b = points[(i + 1) % points.length];
    return area + a.x * b.y - b.x * a.y;
  }, 0) / 2;
}

/** Subtract a convex occluder, retaining disjoint convex pieces outside each edge. */
function subtractOccluder(polygon: ScreenPoint[], occluder: ScreenPoint[]): ScreenPoint[][] {
  const result: ScreenPoint[][] = [];
  const orientation = Math.sign(signedArea(occluder));
  if (orientation === 0) return [polygon];
  let remainder = polygon;
  for (let edge = 0; edge < occluder.length && remainder.length >= 3; edge++) {
    const a = occluder[edge], b = occluder[(edge + 1) % occluder.length];
    const distance = (p: ScreenPoint) => orientation * ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x));
    const inside: ScreenPoint[] = [], outside: ScreenPoint[] = [];
    for (let i = 0; i < remainder.length; i++) {
      const p = remainder[i], q = remainder[(i + 1) % remainder.length];
      const dp = distance(p), dq = distance(q);
      (dp >= 0 ? inside : outside).push(p);
      if ((dp >= 0) !== (dq >= 0)) {
        const u = dp / (dp - dq);
        const intersection = { x: p.x + (q.x - p.x) * u, y: p.y + (q.y - p.y) * u };
        inside.push(intersection);
        outside.push(intersection);
      }
    }
    if (outside.length >= 3 && Math.abs(signedArea(outside)) > 1e-8) result.push(outside);
    remainder = inside;
  }
  return result;
}

/** A small local mask avoids repeatedly clipping the whole canvas for each hidden face.
 * Subtract from a rectangle so this also works for concave panel outlines. */
export function visibleFaceRegions(surface: DepthPoint[], occluders: OccludingFace[], padding = 2): ScreenPoint[][] | null {
  const hidden = hiddenFaceRegions(surface, occluders);
  if (!hidden.length) return null;
  const box = bounds(surface);
  let visible: ScreenPoint[][] = [[
    { x: box.left - padding, y: box.top - padding }, { x: box.right + padding, y: box.top - padding },
    { x: box.right + padding, y: box.bottom + padding }, { x: box.left - padding, y: box.bottom + padding },
  ]];
  for (const region of hidden) {
    visible = visible.flatMap(polygon => subtractOccluder(polygon, region));
    if (!visible.length) break;
  }
  return visible;
}

export function clipHiddenFaces(ctx: CanvasRenderingContext2D, surface: DepthPoint[], occluders: OccludingFace[]): void {
  const visible = visibleFaceRegions(surface, occluders);
  if (visible === null) return;
  ctx.beginPath();
  for (const region of visible) {
    ctx.moveTo(region[0].x, region[0].y);
    for (let i = 1; i < region.length; i++) ctx.lineTo(region[i].x, region[i].y);
    ctx.closePath();
  }
  // One combined mask; overlapping hidden regions cannot cancel out.
  ctx.clip();
}

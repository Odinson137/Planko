import { Point2D, PolygonSlicingEngine as Geometry } from '../../core/geometry/PolygonSlicingEngine';
import { DrawingBox } from './PanelPageLayout';

export interface PartBadge {
  text: string;
  polygon: Point2D[];
  cutouts?: Point2D[][];
  invalid?: boolean;
}
export interface PlacedBadge extends DrawingBox {
  text: string; fontSize: number; vertical: boolean; invalid?: boolean;
  anchor?: Point2D;
}

export function boxesOverlap(a: DrawingBox, b: DrawingBox, gap = 3): boolean {
  return a.x < b.x + b.width + gap && a.x + a.width + gap > b.x &&
    a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;
}
const bounds = (points: Point2D[]): DrawingBox => {
  const x = Math.min(...points.map(p => p.x)), y = Math.min(...points.map(p => p.y));
  return { x, y, width: Math.max(...points.map(p => p.x)) - x, height: Math.max(...points.map(p => p.y)) - y };
};
export const boxPolygon = (b: DrawingBox): Point2D[] => [
  { x: b.x, y: b.y }, { x: b.x + b.width, y: b.y },
  { x: b.x + b.width, y: b.y + b.height }, { x: b.x, y: b.y + b.height },
];

function fitsPolygon(box: DrawingBox, polygon: Point2D[]): boolean {
  const corners = boxPolygon(box);
  if (!corners.every(p => Geometry.isPointInPolygon(p, polygon))) return false;
  // A concave notch must not pass through the badge even if all four corners fit.
  return !polygon.some((p, i) => {
    const q = polygon[(i + 1) % polygon.length];
    let low = 0, high = 1;
    for (const [start, delta, min, max] of [
      [p.x, q.x - p.x, box.x + 0.01, box.x + box.width - 0.01],
      [p.y, q.y - p.y, box.y + 0.01, box.y + box.height - 0.01],
    ]) {
      if (Math.abs(delta) < 1e-8) { if (start < min || start > max) return false; }
      else {
        const a = (min - start) / delta, b = (max - start) / delta;
        low = Math.max(low, Math.min(a, b)); high = Math.min(high, Math.max(a, b));
      }
    }
    return low <= high;
  });
}

/** Place labels after all geometry; rotate narrow labels and use leaders for tiny fragments. */
export function placePartBadges(parts: PartBadge[], region: DrawingBox, measure: (text: string, size: number) => number): PlacedBadge[] {
  const placed: PlacedBadge[] = [];
  for (const part of parts) {
    const b = bounds(part.polygon);
    const cutouts = (part.cutouts ?? []).map(bounds);
    const centroid = Geometry.calculateCentroid(part.polygon);
    const candidates: Point2D[] = [centroid];
    // Include slivers beside/above cutouts, not just the bounding-box centre.
    const xs = [b.x, b.x + b.width, ...cutouts.flatMap(c => [c.x, c.x + c.width])].filter(x => x >= b.x && x <= b.x + b.width).sort((a, c) => a - c);
    const ys = [b.y, b.y + b.height, ...cutouts.flatMap(c => [c.y, c.y + c.height])].filter(y => y >= b.y && y <= b.y + b.height).sort((a, c) => a - c);
    for (let i = 1; i < xs.length; i++) for (let j = 1; j < ys.length; j++)
      candidates.push({ x: (xs[i - 1] + xs[i]) / 2, y: (ys[j - 1] + ys[j]) / 2 });
    for (const fy of [0.5, 0.35, 0.65, 0.2, 0.8, 0.1, 0.9])
      for (const fx of [0.5, 0.35, 0.65, 0.2, 0.8, 0.1, 0.9]) candidates.push({ x: b.x + b.width * fx, y: b.y + b.height * fy });
    const free = (box: DrawingBox) => !placed.some(other => boxesOverlap(box, other)) && !cutouts.some(c => boxesOverlap(box, c, 1));
    let result: PlacedBadge | undefined;
    for (const size of [20, 18, 16]) {
      for (const vertical of [false, true]) {
        const textWidth = measure(part.text, size) + 8;
        const width = vertical ? size + 6 : textWidth, height = vertical ? textWidth : size + 6;
        for (const center of candidates) {
          const box = { x: center.x - width / 2, y: center.y - height / 2, width, height };
          if (fitsPolygon(box, part.polygon) && free(box)) {
            result = { ...box, text: part.text, fontSize: size, vertical, invalid: part.invalid }; break;
          }
        }
        if (result) break;
      }
      if (result) break;
    }
    if (!result) {
      const anchor = candidates.find(p => Geometry.isPointInPolygon(p, part.polygon) && !cutouts.some(c => p.x >= c.x && p.x <= c.x + c.width && p.y >= c.y && p.y <= c.y + c.height)) ?? centroid;
      const width = measure(part.text, 16) + 8, height = 22;
      const spots: Point2D[] = [];
      for (let y = region.y; y + height <= region.y + region.height; y += height + 5)
        for (let x = region.x; x + width <= region.x + region.width; x += width + 5) spots.push({ x, y });
      spots.sort((a, c) => Math.hypot(a.x + width / 2 - anchor.x, a.y + height / 2 - anchor.y) - Math.hypot(c.x + width / 2 - anchor.x, c.y + height / 2 - anchor.y));
      const spot = spots.find(p => free({ ...p, width, height }));
      if (!spot) throw new Error('Недостаточно места для номеров деталей на чертеже');
      result = { ...spot, width, height, text: part.text, fontSize: 16, vertical: false, invalid: part.invalid, anchor };
    }
    placed.push(result);
  }
  return placed;
}

export function drawPartBadges(ctx: CanvasRenderingContext2D, parts: PartBadge[], region: DrawingBox): void {
  ctx.save();
  const placed = placePartBadges(parts, region, (text, size) => {
    ctx.font = `${size}px "Segoe UI", Arial, sans-serif`; return ctx.measureText(text).width;
  });
  for (const badge of placed) {
    const cx = badge.x + badge.width / 2, cy = badge.y + badge.height / 2;
    if (badge.anchor) {
      ctx.strokeStyle = '#475569'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(badge.anchor.x, badge.anchor.y); ctx.lineTo(cx, cy); ctx.stroke();
    }
    ctx.save(); ctx.translate(cx, cy);
    if (badge.vertical) ctx.rotate(-Math.PI / 2);
    const width = badge.vertical ? badge.height : badge.width, height = badge.vertical ? badge.width : badge.height;
    ctx.fillStyle = badge.invalid ? '#e11d48' : '#ffffff'; ctx.fillRect(-width / 2, -height / 2, width, height);
    ctx.strokeStyle = badge.invalid ? '#be123c' : '#334155'; ctx.lineWidth = 1;
    ctx.strokeRect(-width / 2, -height / 2, width, height);
    ctx.fillStyle = badge.invalid ? '#ffffff' : '#0f172a';
    ctx.font = `${badge.fontSize}px "Segoe UI", Arial, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(badge.text, 0, 0); ctx.restore();
  }
  ctx.restore();
}

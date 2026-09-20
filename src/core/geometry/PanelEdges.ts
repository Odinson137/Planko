import type { Point2D } from './PolygonSlicingEngine';
import type { PanelEdgesConfig, PanelEdgeSide, WallPanelPiece } from '../models/Wall';

const near = (a: number, b: number) => Math.abs(a - b) < 1e-5;
const names = { left: 'Левый торец', right: 'Правый торец', top: 'Верхний торец', bottom: 'Нижний торец' };

/** The same real contour edges are used by the inspector, layout and gap calculation. */
export function getPanelEdges(points: Point2D[], configs?: PanelEdgesConfig) {
  const minX = Math.min(...points.map(p => p.x)), maxX = Math.max(...points.map(p => p.x));
  const minY = Math.min(...points.map(p => p.y)), maxY = Math.max(...points.map(p => p.y));
  const edges = points.map((p1, index) => {
    const p2 = points[(index + 1) % points.length];
    const side: PanelEdgeSide | undefined = near(p1.x, minX) && near(p2.x, minX) ? 'left'
      : near(p1.x, maxX) && near(p2.x, maxX) ? 'right'
      : near(p1.y, minY) && near(p2.y, minY) ? 'bottom'
      : near(p1.y, maxY) && near(p2.y, maxY) ? 'top' : undefined;
    const length = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const angle = (Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180 / Math.PI + 180) % 180;
    return { index, p1, p2, side, length, angle, config: configs?.[index] ?? (side ? configs?.[side] : undefined) };
  });
  const rectangle = edges.length === 4 && new Set(edges.map(e => e.side).filter(Boolean)).size === 4;
  return edges.filter(e => e.length > 1e-5).map(e => ({ ...e,
    key: (rectangle ? e.side! : e.index) as PanelEdgeSide | number,
    label: rectangle ? names[e.side!] : `Грань ${e.index + 1}`,
    shortLabel: rectangle ? names[e.side!].replace(' торец', '') : `Грань ${e.index + 1}`,
  }));
}

export function findPanelForEdge(panels: WallPanelPiece[] | undefined, id: string) {
  return panels?.find(p => p.id === id) ?? panels?.filter(p => id.startsWith(`${p.id}-part-`))
    .sort((a, b) => b.id.length - a.id.length)[0];
}

/** Offset each selected contour line inward and intersect it with its neighbors. */
export function insetPanelEdges(points: Point2D[], configs?: PanelEdgesConfig): Point2D[] {
  if (points.length < 3 || !configs) return points;
  const edges = getPanelEdges(points, configs);
  if (!edges.some(e => (e.config?.width ?? 0) > 0)) return points;
  const signedArea = (poly: Point2D[]) => poly.reduce((sum, p, i) => {
    const next = poly[(i + 1) % poly.length];
    return sum + p.x * next.y - next.x * p.y;
  }, 0) / 2;
  const area = signedArea(points), direction = area >= 0 ? 1 : -1;
  const lines = edges.map(e => {
    const dx = (e.p2.x - e.p1.x) / e.length, dy = (e.p2.y - e.p1.y) / e.length;
    const width = Math.max(0, e.config?.width ?? 0);
    return { x: e.p1.x - direction * dy * width, y: e.p1.y + direction * dx * width, dx, dy };
  });
  const result = lines.map((b, index) => {
    const a = lines[(index + lines.length - 1) % lines.length];
    const cross = a.dx * b.dy - a.dy * b.dx;
    if (Math.abs(cross) < 1e-8) return { x: b.x, y: b.y };
    const t = ((b.x - a.x) * b.dy - (b.y - a.y) * b.dx) / cross;
    return { x: a.x + t * a.dx, y: a.y + t * a.dy };
  });
  if (result.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y)) || signedArea(result) * direction <= 1e-5) return [];
  const convex = edges.every((e, i) => {
    const next = edges[(i + 1) % edges.length];
    return direction * ((e.p2.x - e.p1.x) * (next.p2.y - next.p1.y) - (e.p2.y - e.p1.y) * (next.p2.x - next.p1.x)) >= -1e-5;
  });
  if (convex && result.some(p => lines.some(l => direction * (l.dx * (p.y - l.y) - l.dy * (p.x - l.x)) < -1e-5))) return [];
  return result;
}

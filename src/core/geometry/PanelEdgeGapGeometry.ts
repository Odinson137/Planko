import type { Wall, WallJointLine, WallPanelPiece, PanelEdgesConfig } from '../models/Wall';
import { getPanelEdges } from './PanelEdges';
import { PolygonSlicingEngine as Geometry, type Point2D } from './PolygonSlicingEngine';
import { polygonsSeparated } from './PolygonCollision';

const EPS = 1e-5;
const cross = (a: Point2D, b: Point2D) => a.x * b.y - a.y * b.x;
const vector = (a: Point2D, b: Point2D) => ({ x: b.x - a.x, y: b.y - a.y });
const area = (points: Point2D[]) => points.reduce((sum, p, i) => sum + cross(p, points[(i + 1) % points.length]), 0);

/** Change one panel boundary. Neighboring panels and the other gaps stay fixed. */
export function resizePanelEdgeGap(wall: Wall, panel: WallPanelPiece, edgeIndex: number, joint: WallJointLine, width: number) {
  const edges = getPanelEdges(panel.points, panel.edges);
  const selected = edges.find(e => e.index === edgeIndex)!;
  const direction = area(panel.points) >= 0 ? 1 : -1;
  const inward = { x: -direction * (selected.p2.y - selected.p1.y) / selected.length,
    y: direction * (selected.p2.x - selected.p1.x) / selected.length };
  const delta = width - joint.width;
  const lines = edges.map(edge => ({ edge, v: vector(edge.p1, edge.p2),
    p: edge === selected ? { x: edge.p1.x + inward.x * delta, y: edge.p1.y + inward.y * delta } : edge.p1 }));
  let points = Math.abs(delta) < EPS ? panel.points : lines.map((line, i) => {
    const prev = lines[(i + lines.length - 1) % lines.length];
    const determinant = cross(prev.v, line.v);
    if (Math.abs(determinant) < EPS) return line.p;
    const t = cross(vector(prev.p, line.p), line.v) / determinant;
    return { x: prev.p.x + t * prev.v.x, y: prev.p.y + t * prev.v.y };
  });
  if (points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y)) || area(points) * direction <= EPS) {
    throw new Error('Зазор слишком велик для выбранной панели.');
  }
  // An expanding diagonal may reach a wall corner; clip it without moving the neighbor.
  const bounds = [{ x: 0, y: 0 }, { x: wall.width, y: 0 }, { x: wall.width, y: wall.height }, { x: 0, y: wall.height }];
  if (points.some(p => p.x < -EPS || p.x > wall.width + EPS || p.y < -EPS || p.y > wall.height + EPS)) {
    bounds.forEach((p, i) => { points = Geometry.clipPolygonByHalfPlane(points, p, bounds[(i + 1) % 4], false); });
  }
  if (points.length < 3 || area(points) * direction <= EPS || (wall.panels ?? []).some(other =>
    other.id !== panel.id && !polygonsSeparated(points, other.points, 0))) {
    throw new Error('Зазор слишком велик или выбранная панель пересекает соседнюю.');
  }
  const onLine = (p: Point2D, line: typeof lines[number]) => Math.abs(cross(line.v, vector(line.p, p))) / line.edge.length < EPS;
  const nextEdges: PanelEdgesConfig = {};
  let edgeKey = selected.key;
  getPanelEdges(points).forEach(edge => {
    const source = lines.find(line => onLine(edge.p1, line) && onLine(edge.p2, line));
    if (source?.edge === selected) edgeKey = edge.key;
    else if (source?.edge.config) nextEdges[edge.key] = source.edge.config;
  });
  const nextPanel = { ...panel, points, ...(panel.edges ? { edges: nextEdges } : {}) };
  const axis = vector(joint.p1, joint.p2), length = Math.hypot(axis.x, axis.y);
  const unit = { x: axis.x / length, y: axis.y / length };
  const normal = { x: -unit.y, y: unit.x };
  const distance = (p: Point2D) => (p.x - joint.p1.x) * normal.x + (p.y - joint.p1.y) * normal.y;
  const side = inward.x * normal.x + inward.y * normal.y;
  const shift = distance(selected.p1) - side * joint.width / 2 + side * delta / 2;
  const along = (p: Point2D) => (p.x - joint.p1.x) * unit.x + (p.y - joint.p1.y) * unit.y;
  const moved = getPanelEdges(points).find(e => e.key === edgeKey)!;
  const at = (t: number) => ({ x: joint.p1.x + normal.x * shift + unit.x * t,
    y: joint.p1.y + normal.y * shift + unit.y * t });
  const updated = { ...joint, width, p1: at(Math.min(0, along(moved.p1), along(moved.p2))),
    p2: at(Math.max(length, along(moved.p1), along(moved.p2))) };
  return { panel: nextPanel, joint: updated, edgeKey };
}

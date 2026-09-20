import type { Point2D } from './PolygonSlicingEngine';
import type { WallJointLine, WallPanelPiece } from '../models/Wall';
import type { Opening } from '../models/Opening';
import { getPanelEdges } from './PanelEdges';
import { edgeBelongsToJoint } from './PanelJointBinding';

const EPS = 1e-5;
const cross = (a: Point2D, b: Point2D) => a.x * b.y - a.y * b.x;
const subtract = (a: Point2D, b: Point2D) => ({ x: a.x - b.x, y: a.y - b.y });

/** Full-height/width cuts move a chain; only the last piece at the wall changes size. */
function resizeFullSpanGap(panels: WallPanelPiece[], joints: WallJointLine[], target: WallJointLine,
  oldWidth: number, newWidth: number, wallWidth: number, wallHeight: number, openings: Opening[]) {
  const vertical = Math.abs(target.p1.x - target.p2.x) < EPS;
  const horizontal = Math.abs(target.p1.y - target.p2.y) < EPS;
  const fullSpan = vertical
    ? Math.min(target.p1.y, target.p2.y) < EPS && Math.max(target.p1.y, target.p2.y) >= wallHeight - EPS
    : horizontal && Math.min(target.p1.x, target.p2.x) < EPS && Math.max(target.p1.x, target.p2.x) >= wallWidth - EPS;
  if (!fullSpan || target.isOuterEdge || openings.some(o => o.isCutout !== false) || target.takeSide === 'BOTH') return;
  const span = vertical ? wallWidth : wallHeight;
  const takeSide = target.takeSide ?? (vertical ? 'RIGHT' : 'BOTTOM');
  const reversed = takeSide === 'LEFT' || takeSide === 'BOTTOM';
  const coordinate = (p: Point2D) => reversed ? span - (vertical ? p.x : p.y) : vertical ? p.x : p.y;
  const withCoordinate = (p: Point2D, value: number) => vertical
    ? { x: reversed ? span - value : value, y: p.y } : { x: p.x, y: reversed ? span - value : value };
  const center = coordinate(target.p1), boundary = center + oldWidth / 2, delta = newWidth - oldWidth;
  const incident = panels.flatMap(p => getPanelEdges(p.points).filter(e => edgeBelongsToJoint(e, { ...target, width: oldWidth })));
  if (!incident.some(e => coordinate(e.p1) <= center + EPS) || !incident.some(e => coordinate(e.p1) >= center - EPS)) return;
  const move = (p: Point2D) => {
    const value = coordinate(p);
    if (value < boundary - EPS || value >= span - EPS) return p;
    if (value + delta > span + EPS || value + delta < -EPS) throw new Error('Зазор слишком велик для соседней панели.');
    return withCoordinate(p, value + delta);
  };
  const nextPanels = panels.map(panel => {
    if (panel.points.reduce((sum, p) => sum + coordinate(p), 0) / panel.points.length <= center) return panel;
    const points = panel.points.map(move);
    let textureMapping = panel.textureMapping;
    const anchor = textureMapping?.anchor;
    if (anchor) {
      const corners = [move({ x: anchor.x, y: anchor.y }), move({ x: anchor.x + anchor.width, y: anchor.y + anchor.height })];
      textureMapping = { ...textureMapping!, anchor: { x: Math.min(...corners.map(p => p.x)), y: Math.min(...corners.map(p => p.y)),
        width: Math.abs(corners[1].x - corners[0].x), height: Math.abs(corners[1].y - corners[0].y) } };
    }
    return { ...panel, points, ...(textureMapping ? { textureMapping } : {}) };
  });
  return { panels: nextPanels, joints: joints.map(joint => joint.id === target.id ? { ...joint, width: newWidth,
    p1: withCoordinate(joint.p1, center + delta / 2), p2: withCoordinate(joint.p2, center + delta / 2) }
    : (coordinate(joint.p1) + coordinate(joint.p2)) / 2 > center
      ? { ...joint, p1: move(joint.p1), p2: move(joint.p2) } : joint) };
}

/** Resize the incident boundaries and keep all panels sharing their endpoints connected. */
export function resizeJointGap(panels: WallPanelPiece[], joints: WallJointLine[], target: WallJointLine,
  oldWidth: number, newWidth: number, wallWidth: number, wallHeight: number, openings: Opening[] = []) {
  if (Math.abs(newWidth - oldWidth) < EPS) return { panels, joints };
  const chain = resizeFullSpanGap(panels, joints, target, oldWidth, newWidth, wallWidth, wallHeight, openings);
  if (chain) return chain;
  const vector = subtract(target.p2, target.p1), length = Math.hypot(vector.x, vector.y);
  if (length < EPS) return { panels, joints };
  const normal = { x: -vector.y / length, y: vector.x / length };
  const distance = (p: Point2D) => {
    const relative = subtract(p, target.p1);
    return relative.x * normal.x + relative.y * normal.y;
  };
  const movedVertices: { before: Point2D; after: Point2D; side: number }[] = [];
  const nextPanels = panels.map(panel => {
    const edges = getPanelEdges(panel.points, panel.edges);
    const affected = edges.filter(edge => edgeBelongsToJoint(edge, { ...target, width: oldWidth }));
    if (!affected.length) return panel;
    const centroidDistance = panel.points.reduce((sum, p) => sum + distance(p), 0) / panel.points.length;
    const side = centroidDistance >= 0 ? 1 : -1;
    const fraction = (() => {
      if (target.takeSide === 'LEFT') return normal.x * side < -EPS ? 1 : 0;
      if (target.takeSide === 'RIGHT') return normal.x * side > EPS ? 1 : 0;
      if (target.takeSide === 'TOP') return normal.y * side > EPS ? 1 : 0;
      if (target.takeSide === 'BOTTOM') return normal.y * side < -EPS ? 1 : 0;
      return 0.5;
    })();
    const lines = edges.map(edge => {
      const delta = affected.includes(edge) ? side * newWidth * fraction - distance(edge.p1) : 0;
      return { p: { x: edge.p1.x + normal.x * delta, y: edge.p1.y + normal.y * delta },
        v: subtract(edge.p2, edge.p1) };
    });
    const axisAligned = Math.abs(vector.x) < EPS || Math.abs(vector.y) < EPS;
    const points = axisAligned ? panel.points.map(point => {
      const incident = affected.find(edge => Math.hypot(edge.p1.x - point.x, edge.p1.y - point.y) < EPS ||
        Math.hypot(edge.p2.x - point.x, edge.p2.y - point.y) < EPS);
      if (!incident) return point;
      const delta = side * newWidth * fraction - distance(point);
      return { x: point.x + normal.x * delta, y: point.y + normal.y * delta };
    }) : lines.map((line, i) => {
      const previous = lines[(i + lines.length - 1) % lines.length];
      const determinant = cross(previous.v, line.v);
      if (Math.abs(determinant) < EPS) return line.p;
      const t = cross(subtract(line.p, previous.p), line.v) / determinant;
      return { x: previous.p.x + t * previous.v.x, y: previous.p.y + t * previous.v.y };
    });
    if (points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y) ||
      p.x < -EPS || p.y < -EPS || p.x > wallWidth + EPS || p.y > wallHeight + EPS)) {
      throw new Error('Зазор выходит за границы стены. Уменьшите его ширину.');
    }
    const area = (poly: Point2D[]) => poly.reduce((sum, p, i) => sum + cross(p, poly[(i + 1) % poly.length]), 0);
    if (area(points) * area(panel.points) <= EPS) throw new Error('Зазор слишком велик для соседней панели.');
    points.forEach((after, i) => {
      if (Math.hypot(after.x - panel.points[i].x, after.y - panel.points[i].y) > EPS) {
        movedVertices.push({ before: panel.points[i], after, side });
      }
    });
    return { ...panel, points };
  });
  const moveEndpoint = (point: Point2D) => movedVertices.find(v =>
    Math.hypot(v.before.x - point.x, v.before.y - point.y) < EPS)?.after ?? point;
  const connectedPanels = nextPanels.map((panel, i) => {
    if (panel !== panels[i]) return panel;
    const side = panel.points.reduce((sum, p) => sum + distance(p), 0) >= 0 ? 1 : -1;
    const points = panel.points.map(point => movedVertices.find(v => v.side === side &&
      Math.hypot(v.before.x - point.x, v.before.y - point.y) < EPS)?.after ?? point);
    return points.some((point, j) => point !== panel.points[j]) ? { ...panel, points } : panel;
  });
  return { panels: connectedPanels, joints: joints.map(joint => joint.id === target.id
    ? { ...joint, width: newWidth }
    : { ...joint, p1: moveEndpoint(joint.p1), p2: moveEndpoint(joint.p2) }) };
}

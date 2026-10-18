import type { Wall, WallJointLine, WallPanelPiece } from '../models/Wall';
import { MATERIAL_NONE_ID } from '../models/Material';
import { getPanelEdges } from './PanelEdges';
import { edgeBelongsToJoint, effectiveWallJoint, getPanelEdgeJoint, getPanelJointSide } from './PanelJointBinding';
import { previewPanelCut } from './PanelCutEngine';
import { PolygonSlicingEngine as Geometry, type Point2D, type SnapResult } from './PolygonSlicingEngine';

const EPS = 1e-5;
const distance = (a: Point2D, b: Point2D) => Math.hypot(a.x - b.x, a.y - b.y);
type Segment = { p1: Point2D; p2: Point2D };
export interface PanelCutGuide extends Segment {
  intersections: { point: Point2D; edge: Segment; sourcePoint?: Point2D }[];
}

/** The fixed panel boundary is where a one-sided gap starts, even though its stored axis moves. */
function jointStartLine(wall: Wall, joint: WallJointLine): Segment {
  const dx = joint.p2.x - joint.p1.x, dy = joint.p2.y - joint.p1.y;
  const length = Math.hypot(dx, dy);
  if (length < EPS) return joint;
  const normal = { x: -dy / length, y: dx / length };
  const takeDirection = joint.takeSide === 'TOP' ? normal.y : joint.takeSide === 'BOTTOM' ? -normal.y
    : joint.takeSide === 'RIGHT' ? normal.x : joint.takeSide === 'LEFT' ? -normal.x : 0;
  const ownerSide = joint.gapOwnerSide ?? (Math.abs(takeDirection) > EPS ? Math.sign(takeDirection) : undefined);
  if (!ownerSide) return joint;
  const fixedEdge = wall.panels?.filter(panel => !panel.isVoid && panel.materialId !== MATERIAL_NONE_ID &&
    getPanelJointSide(panel, joint) !== ownerSide).flatMap(panel => getPanelEdges(panel.points))
    .find(edge => edgeBelongsToJoint(edge, joint));
  const offset = fixedEdge
    ? (fixedEdge.p1.x - joint.p1.x) * normal.x + (fixedEdge.p1.y - joint.p1.y) * normal.y
    : -ownerSide * joint.width / 2;
  const shift = (p: Point2D) => ({ x: p.x + normal.x * offset, y: p.y + normal.y * offset });
  return { p1: shift(joint.p1), p2: shift(joint.p2) };
}

/** Build once per wall/panel change; hovering only checks the prepared boundary intersections. */
export function getPanelCutGuides(wall: Wall, panel: WallPanelPiece): PanelCutGuide[] {
  const joints = new Map((wall.joints ?? []).map(joint => [joint.id, effectiveWallJoint(wall, joint)]));
  // Touching panels can have a shared cut before it has been saved as a joint.
  for (const neighbor of wall.panels ?? []) {
    if (neighbor.id === panel.id || neighbor.isVoid || neighbor.materialId === MATERIAL_NONE_ID) continue;
    for (const edge of getPanelEdges(neighbor.points, neighbor.edges)) {
      const joint = getPanelEdgeJoint(wall, edge, neighbor);
      if (joint && !joints.has(joint.id)) joints.set(joint.id, joint);
    }
  }
  const edges = getPanelEdges(panel.points);
  return [...joints.values()].flatMap(joint => {
    if (joint.isOuterEdge || distance(joint.p1, joint.p2) < EPS) return [];
    const line = jointStartLine(wall, joint);
    const intersections = edges.flatMap(edge => {
      const point = Geometry.infiniteLineWithSegmentIntersection(line.p1, line.p2, edge.p1, edge.p2);
      const sourcePoint = Geometry.infiniteLineWithSegmentIntersection(joint.p1, joint.p2, edge.p1, edge.p2) ?? undefined;
      return point ? [{ point, edge, sourcePoint }] : [];
    }).sort((a, b) => (a.point.x - b.point.x) * (line.p2.x - line.p1.x) +
      (a.point.y - b.point.y) * (line.p2.y - line.p1.y));
    // Extend the neighboring segment across the panel; tangent lines must not become cut guides.
    if (intersections.length < 2 || !previewPanelCut(panel, intersections[0].point,
      intersections[intersections.length - 1].point)) return [];
    return [{ ...line, intersections }];
  });
}

export function snapPanelCutPoint(raw: Point2D, panel: WallPanelPiece, guides: PanelCutGuide[],
  startPoint: Point2D | null, snapRadius: number, angleLocked = false): SnapResult {
  const base = Geometry.snapPoint(raw, [panel.points], [], 0, 0, startPoint, snapRadius);
  const edges = getPanelEdges(panel.points);
  let reference = base.point;
  const direction = startPoint && { x: raw.x - startPoint.x, y: raw.y - startPoint.y };
  if (!startPoint) {
    // Other magnets must not enlarge the seam's attraction radius.
    let closest = Infinity;
    for (const edge of edges) {
      const dx = edge.p2.x - edge.p1.x, dy = edge.p2.y - edge.p1.y;
      if (edge.length < EPS) continue;
      const t = Math.max(0, Math.min(1, ((raw.x - edge.p1.x) * dx + (raw.y - edge.p1.y) * dy) / edge.length ** 2));
      const point = { x: edge.p1.x + t * dx, y: edge.p1.y + t * dy };
      const delta = distance(raw, point);
      if (delta < closest) { closest = delta; reference = point; }
    }
  } else if (direction) {
    if (distance(raw, startPoint) < 10) return base;
    // Compare against the pointer's ray before the ordinary 45°/90° magnet changes its angle.
    const hits = edges.flatMap(edge => {
      const point = Geometry.raySegmentIntersection(startPoint, direction, edge.p1, edge.p2);
      return point && distance(point, startPoint) > 5 ? [point] : [];
    }).sort((a, b) => distance(a, startPoint) - distance(b, startPoint));
    if (hits[0]) reference = hits[0];
  }
  let bestDistance = snapRadius;
  let result = base;
  for (const guide of guides) {
    const dx = guide.p2.x - guide.p1.x, dy = guide.p2.y - guide.p1.y;
    // Once the start is set, only attract to continuations passing through it.
    if (startPoint && Math.abs((startPoint.x - guide.p1.x) * dy - (startPoint.y - guide.p1.y) * dx) /
      Math.hypot(dx, dy) > EPS) continue;
    for (const { point, edge, sourcePoint } of guide.intersections) {
      if (startPoint && direction) {
        const vx = point.x - startPoint.x, vy = point.y - startPoint.y;
        if (Math.hypot(vx, vy) <= 5 || vx * direction.x + vy * direction.y <= 0) continue;
        if (angleLocked && Math.abs(vx * direction.y - vy * direction.x) /
          (Math.hypot(vx, vy) * Math.hypot(direction.x, direction.y)) > EPS) continue;
      }
      // Users aim at the drawn seam axis. Catch it too, but place the cut at the fixed start boundary.
      const delta = Math.min(distance(point, reference), !startPoint && sourcePoint ? distance(sourcePoint, reference) : Infinity);
      if (delta >= bestDistance) continue;
      bestDistance = delta;
      result = { point, snapped: true, snapType: 'INTERSECTION', label: 'Начало соседнего шва',
        jointGuide: { p1: guide.p1, p2: guide.p2 },
        edgeSegment: { ...edge, dist1: Math.round(distance(edge.p1, point)),
          dist2: Math.round(distance(point, edge.p2)), totalLen: Math.round(distance(edge.p1, edge.p2)) } };
    }
  }
  return result;
}

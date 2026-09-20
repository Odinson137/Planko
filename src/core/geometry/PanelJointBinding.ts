import type { PanelEdgeJointConfig, Wall, WallJointLine, WallPanelPiece } from '../models/Wall';
import { getPanelEdges } from './PanelEdges';

type Edge = ReturnType<typeof getPanelEdges>[number];
const EPS = 1e-4;

export function effectiveWallJoint(wall: Wall, joint: WallJointLine): WallJointLine {
  const baseId = joint.id.split('-part-')[0].split('-merged-')[0];
  return { ...joint, ...(wall.customJoints[joint.id] ?? wall.customJoints[baseId]),
    id: joint.id, p1: joint.p1, p2: joint.p2 };
}

/** A cut owns the whole shared gap; panel edges lie on either boundary of it. */
export function edgeBelongsToJoint(edge: Edge, joint: WallJointLine): boolean {
  const dx = joint.p2.x - joint.p1.x, dy = joint.p2.y - joint.p1.y;
  const length = Math.hypot(dx, dy);
  if (length < EPS) return false;
  const along = (p: { x: number; y: number }) => ((p.x - joint.p1.x) * dx + (p.y - joint.p1.y) * dy) / length;
  const normal = (p: { x: number; y: number }) => ((p.x - joint.p1.x) * -dy + (p.y - joint.p1.y) * dx) / length;
  const a = along(edge.p1), b = along(edge.p2), d1 = normal(edge.p1), d2 = normal(edge.p2);
  if (Math.abs(d1 - d2) > EPS || Math.min(a, b) < -EPS || Math.max(a, b) > length + EPS) return false;
  // Accept centered and explicitly one-sided cuts, but never a merely nearby parallel edge.
  return [0, joint.width / 2, joint.width].some(offset => Math.abs(Math.abs(d1) - offset) < EPS);
}

export function getPanelEdgeJoint(wall: Wall, edge: Edge): WallJointLine | undefined {
  return wall.joints?.map(j => effectiveWallJoint(wall, j)).find(j => edgeBelongsToJoint(edge, j));
}

/** Shared by the sidebar and the canvas badges. Missing edge settings do not mean a zero cut. */
export function getResolvedPanelEdges(wall: Wall, panel: WallPanelPiece) {
  return getPanelEdges(panel.points, panel.edges).map(edge => {
    const joint = getPanelEdgeJoint(wall, edge);
    const config: PanelEdgeJointConfig | undefined = joint ? {
      isLED: joint.isLED, profileArticle: joint.profileArticle, profileColor: joint.profileColor,
      ...edge.config,
      // Edge widths are additional insets in older projects, not replacements for a cut gap.
      width: joint.width + (edge.config?.width ?? 0),
    } : edge.config;
    return { ...edge, config, joint };
  });
}

import type { PanelEdgeJointConfig, Wall, WallJointLine, WallPanelPiece } from '../models/Wall';
import { isGapConfigured } from '../models/Wall';
import { getPanelEdges } from './PanelEdges';
import { MATERIAL_NONE_ID } from '../models/Material';

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

/** Recover missing zero-gap cuts from touching contours, independently of panel materials. */
function inferSharedJoint(wall: Wall, panel: WallPanelPiece, selected: Edge): WallJointLine | undefined {
  if (panel.isVoid || panel.materialId === MATERIAL_NONE_ID) return;
  const a = selected.p1, b = selected.p2;
  const forward = b.x > a.x + EPS || (Math.abs(b.x - a.x) < EPS && b.y > a.y);
  const origin = forward ? a : b, end = forward ? b : a;
  const ux = (end.x - origin.x) / selected.length, uy = (end.y - origin.y) / selected.length;
  const along = (p: typeof a) => (p.x - origin.x) * ux + (p.y - origin.y) * uy;
  const distance = (p: typeof a) => (p.x - origin.x) * -uy + (p.y - origin.y) * ux;
  const candidates = (wall.panels ?? []).filter(p => !p.isVoid && p.materialId !== MATERIAL_NONE_ID).flatMap(p => {
    const direction = p.points.reduce((sum, pt, i) => {
      const next = p.points[(i + 1) % p.points.length];
      return sum + pt.x * next.y - pt.y * next.x;
    }, 0) >= 0 ? 1 : -1;
    return getPanelEdges(p.points, p.edges).filter(e => Math.abs(distance(e.p1)) < EPS && Math.abs(distance(e.p2)) < EPS)
      .map(e => ({ panel: p, edge: e, start: Math.min(along(e.p1), along(e.p2)), end: Math.max(along(e.p1), along(e.p2)),
        side: (direction * ((e.p2.x - e.p1.x) * ux + (e.p2.y - e.p1.y) * uy) >= 0 ? 1 : -1) as 1 | -1 }));
  });
  const first = candidates.find(c => c.panel.id === panel.id && c.edge.index === selected.index);
  if (!first) return;
  const connected = new Set([first]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const candidate of candidates) {
      if (connected.has(candidate)) continue;
      if ([...connected].some(c => c.panel.id !== candidate.panel.id && c.side !== candidate.side &&
        Math.min(c.end, candidate.end) - Math.max(c.start, candidate.start) > EPS)) {
        connected.add(candidate); changed = true;
      }
    }
  }
  if (connected.size < 2) return;
  const adjacent = [...connected].sort((c, d) => `${c.panel.id}:${c.edge.index}`.localeCompare(`${d.panel.id}:${d.edge.index}`));
  // Separate legacy insets already remove material in the renderer. Show their physical sum.
  const widths = (side: number) => adjacent.filter(c => c.side === side).map(c => c.edge.config?.width ?? 0);
  const positive = widths(1), negative = widths(-1);
  if ([positive, negative].some(values => values.some(width => Math.abs(width - values[0]) > EPS))) return;
  const plusWidth = positive[0] ?? 0, minusWidth = negative[0] ?? 0;
  const configuredEdges = adjacent.filter(c => isGapConfigured(c.edge.config));
  const donor = [...adjacent].sort((c, d) => (d.edge.config?.width ?? 0) - (c.edge.config?.width ?? 0))
    .find(c => c.edge.config?.profileArticle || c.edge.config?.isLED || (c.edge.config?.width ?? 0) > 0);
  const at = (t: number) => ({ x: origin.x + ux * t, y: origin.y + uy * t });
  return {
    id: `joint-shared-${adjacent.map(c => `${encodeURIComponent(c.panel.id)}:${c.edge.index}`).join('|')}`,
    p1: at(Math.min(...adjacent.map(c => c.start))), p2: at(Math.max(...adjacent.map(c => c.end))),
    width: plusWidth + minusWidth, isLED: donor?.edge.config?.isLED ?? false,
    gapConfigured: configuredEdges.length > 0,
    profileArticle: donor?.edge.config?.profileArticle, profileColor: donor?.edge.config?.profileColor,
    orientation: Math.abs(ux) < EPS ? 'VERTICAL' : Math.abs(uy) < EPS ? 'HORIZONTAL' : 'DIAGONAL',
    gapOwnerSide: plusWidth > 0 && minusWidth === 0 ? 1 : minusWidth > 0 && plusWidth === 0 ? -1
      : configuredEdges.length === 1 ? configuredEdges[0].side : undefined,
  };
}

export function getPanelEdgeJoint(wall: Wall, edge: Edge, panel?: WallPanelPiece): WallJointLine | undefined {
  return wall.joints?.map(j => effectiveWallJoint(wall, j)).find(j => edgeBelongsToJoint(edge, j))
    ?? (panel ? inferSharedJoint(wall, panel, edge) : undefined);
}

/** The side survives changing panel IDs, splitting panels and closing the gap to zero. */
export function getPanelJointSide(panel: WallPanelPiece, joint: WallJointLine): 1 | -1 {
  const dx = joint.p2.x - joint.p1.x, dy = joint.p2.y - joint.p1.y;
  const distance = panel.points.reduce((sum, p) => sum +
    (p.x - joint.p1.x) * -dy + (p.y - joint.p1.y) * dx, 0);
  return distance >= 0 ? 1 : -1;
}

export function getJointGapOwners(panels: WallPanelPiece[], joint: WallJointLine) {
  if (!joint.gapOwnerSide) return [];
  return panels.flatMap(panel => {
    if (getPanelJointSide(panel, joint) !== joint.gapOwnerSide) return [];
    const edge = getPanelEdges(panel.points, panel.edges).find(e => edgeBelongsToJoint(e, joint));
    return edge ? [{ panel, edge }] : [];
  });
}

/** Shared by the sidebar and the canvas badges. Missing edge settings do not mean a zero cut. */
export function getResolvedPanelEdges(wall: Wall, panel: WallPanelPiece) {
  return getPanelEdges(panel.points, panel.edges).map(edge => {
    const joint = getPanelEdgeJoint(wall, edge, panel);
    const inferred = joint && !wall.joints?.some(j => j.id === joint.id);
    const config: PanelEdgeJointConfig | undefined = joint ? {
      isLED: joint.isLED, profileArticle: joint.profileArticle, profileColor: joint.profileColor,
      ...(!inferred ? edge.config : {}),
      // Edge widths are additional insets in older projects, not replacements for a cut gap.
      width: joint.width + (!inferred ? edge.config?.width ?? 0 : 0),
      gapConfigured: isGapConfigured(joint) || isGapConfigured(edge.config),
    } : edge.config;
    return { ...edge, config, joint };
  });
}

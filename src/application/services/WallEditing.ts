import { LayoutEngine } from '../../core/layout/LayoutEngine';
import type { Project } from '../../core/models/Project';
import type { Wall, WallPanelPiece } from '../../core/models/Wall';
import { resolvePathBends } from '../../core/geometry/WallPath';

function layoutFor(project: Project, wall: Wall) {
  const material = project.materials.find(m => m.id === wall.zone.materialId) ?? project.materials[0];
  return LayoutEngine.calculateWallLayout(wall, material, project.materials, project.walls.findIndex(w => w.id === wall.id) + 1);
}
export function wallPlanBends(project: Project, wall: Wall) {
  const legacy = !wall.bends?.length && (wall.panels?.some(p => p.radiusConfig) || Object.values(wall.customPanels).some(p => p.radiusConfig));
  return resolvePathBends(wall, legacy ? layoutFor(project, wall).panels : []);
}

/** Freeze legacy procedural layouts before inserting distance into the unfolded surface. */
export function materializeWall(project: Project, wall: Wall): Wall {
  const bends = wall.bends?.length ? wall.bends : wallPlanBends(project, wall).map(b => ({ id: b.id, x: b.sStart, type: b.type, radius: b.radius, angleDeg: b.angleDeg }));
  if (wall.panels?.length) return { ...wall, bends };
  const layout = layoutFor(project, wall);
  const panels: WallPanelPiece[] = layout.panels.map(p => {
    const column = wall.customPanels[p.originalColumnIndex];
    const segment = column?.segments?.[p.originalSegmentIndex];
    const source = [...(column?.subPieces ?? []), ...(segment?.subPieces ?? [])].find(s => s.id === p.subPieceId);
    return {
      id: p.id, points: p.polygonPoints ?? [{ x: p.x, y: p.y }, { x: p.x+p.width, y: p.y },
        { x: p.x+p.width, y: p.y+p.height }, { x: p.x, y: p.y+p.height }],
      materialId: p.materialId, isVoid: p.isVoid, color: p.materialColor, decorCode: p.decorCode, decorName: p.decorName,
      thickness: p.thickness, reliefType: p.reliefType as WallPanelPiece['reliefType'], textureCategory: p.textureCategory,
      partLabel: p.partLabel, textureMapping: p.textureMapping, textureStockWidth: p.textureStockWidth,
      textureStockHeight: p.textureStockHeight, patternAngleDeg: p.patternAngleDeg, patternFlipX: p.patternFlipX,
      note: p.note, edges: source?.edges ?? segment?.edges,
    };
  });
  return { ...wall, bends, panels, customPanels: {}, customJoints: {}, joints: layout.joints.map(j => ({
    id: j.id, p1: j.p1 ?? { x: j.x, y: j.y },
    p2: j.p2 ?? (j.orientation === 'HORIZONTAL' ? { x: j.x+j.length, y: j.y } : { x: j.x, y: j.y+j.length }),
    width: j.width, isLED: j.isLED, orientation: j.orientation, profileArticle: j.profileArticle,
    profileColor: j.profileColor, groupId: j.groupId, isOuterEdge: j.isOuterEdge, takeSide: j.takeSide,
  })) };
}

import type { Opening } from '../../core/models/Opening';
import { isDoorOrPortal } from '../../core/models/Opening';
import type { Wall, WallPanelPiece, WallJointLine } from '../../core/models/Wall';
import type { Material } from '../../core/models/Material';
import { MATERIAL_NONE_ID } from '../../core/models/Material';
import { cuttableWall, findCutPanel, panelBounds } from '../../core/geometry/PanelCutEngine';
import { openingPlacementError } from '../../core/geometry/OpeningPlacement';
import { polygonsSeparated, triangulate } from '../../core/geometry/PolygonCollision';
import { PolygonSlicingEngine as Geometry, type Point2D } from '../../core/geometry/PolygonSlicingEngine';

type Bounds = ReturnType<typeof panelBounds>;
export type WallClipboard = { projectId: string; bounds: Bounds } & (
  { kind: 'openings'; openings: Opening[] } |
  { kind: 'panels'; panels: WallPanelPiece[]; joints: WallJointLine[] }
);

function selectedMaterialPanels(wall: Wall, materials: Material[], panelIds: string[]) {
  if (!panelIds.length) return { source: wall, panels: [] };
  const source = cuttableWall(wall, materials);
  const ids = new Set(panelIds.map(id => findCutPanel(source, id)?.id).filter(Boolean));
  const panels = source.panels?.filter(p => ids.has(p.id) && !p.isVoid && p.materialId !== MATERIAL_NONE_ID) ?? [];
  return { source, panels };
}

export function canCopyWallObjects(wall: Wall, materials: Material[], openingIds: string[], panelIds: string[]): boolean {
  return wall.openings.some(op => openingIds.includes(op.id)) || selectedMaterialPanels(wall, materials, panelIds).panels.length > 0;
}

export function copyWallObjects(projectId: string, wall: Wall, materials: Material[], openingIds: string[], panelIds: string[]): WallClipboard | null {
  const openings = wall.openings.filter(op => openingIds.includes(op.id));
  if (openings.length) {
    const bounds = panelBounds(openings.flatMap(op => [{ x: op.x, y: op.y }, { x: op.x + op.width, y: op.y + op.height }]));
    return structuredClone({ projectId, kind: 'openings', openings, bounds });
  }
  const { source, panels } = selectedMaterialPanels(wall, materials, panelIds);
  if (!panels.length) return null;
  const onEdge = (point: Point2D, a: Point2D, b: Point2D) => {
    const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
    return length > 0 && Math.abs((point.x - a.x) * dy - (point.y - a.y) * dx) / length < 0.1 &&
      (point.x - a.x) * dx + (point.y - a.y) * dy >= -0.1 &&
      (point.x - b.x) * dx + (point.y - b.y) * dy <= 0.1;
  };
  const joints = (source.joints ?? []).filter(j => !j.id.startsWith('joint-op-') && panels.some(p =>
    p.points.some((a, i) => onEdge(j.p1, a, p.points[(i + 1) % p.points.length]) && onEdge(j.p2, a, p.points[(i + 1) % p.points.length]))));
  return structuredClone({ projectId, kind: 'panels', panels, joints, bounds: panelBounds(panels.flatMap(p => p.points)) });
}

export function clipboardAt(content: WallClipboard, position: Point2D): WallClipboard {
  const dx = position.x - content.bounds.x;
  // Keep a group containing a doorway at its original floor height.
  const dy = content.kind === 'openings' && content.openings.some(isDoorOrPortal) ? 0 : position.y - content.bounds.y;
  const move = (p: Point2D) => ({ x: p.x + dx, y: p.y + dy });
  const bounds = { ...content.bounds, ...move(content.bounds) };
  if (content.kind === 'openings') return { ...content, bounds,
    openings: content.openings.map(op => ({ ...op, ...move(op), isApplied: false })) };
  return { ...content, bounds, panels: content.panels.map(p => ({ ...p, points: p.points.map(move),
    textureMapping: p.textureMapping ? { ...p.textureMapping, anchor: p.textureMapping.anchor
      ? { ...p.textureMapping.anchor, ...move(p.textureMapping.anchor) } : undefined } : undefined })),
    joints: content.joints.map(j => ({ ...j, p1: move(j.p1), p2: move(j.p2) })) };
}

export function clipboardPlacementError(wall: Wall, content: WallClipboard, materials: Material[]): string | null {
  const b = content.bounds;
  if (![b.x, b.y, b.width, b.height].every(Number.isFinite) || b.x < 0 || b.y < 0 || b.x + b.width > wall.width + 0.01 || b.y + b.height > wall.height + 0.01)
    return 'Копия не помещается в границах стены. Размеры сохранены.';
  if (content.kind === 'openings') {
    // Preview uses temporary identities so the originals still participate in collision checks.
    return openingPlacementError(wall, content.openings.map((op, i) => ({ ...op, id: `clipboard-preview-${i}` })));
  }
  const source = cuttableWall(wall, materials);
  if (content.panels.some(p => (source.panels ?? []).some(existing =>
    !existing.isVoid && existing.materialId !== MATERIAL_NONE_ID && !polygonsSeparated(p.points, existing.points, 0))))
    return 'Панели можно вставить на свободный участок стены. Здесь уже есть материал.';
  return null;
}

/** Subtract simple polygon cutters from void cells without replacing the surrounding material. */
function subtractPolygon(subject: Point2D[], cutter: Point2D[]): Point2D[][] {
  if (polygonsSeparated(subject, cutter, 0)) return [subject];
  const triangles = triangulate(cutter);
  if (!triangles.length) throw new Error('Некорректный контур копируемой панели.');
  let pieces = [subject];
  for (const triangle of triangles) {
    let partition = pieces;
    for (let i = 0; i < 3; i++) {
      const a = triangle[i], b = triangle[(i + 1) % 3];
      partition = partition.flatMap(poly => {
        const split = Geometry.splitPolygonByLine(poly, a, b, 0);
        return split ? split.allPieces ?? [split.pieceA, split.pieceB] : [poly];
      });
    }
    pieces = partition.filter(poly => !poly.every(p => triangle.every((a, i) => {
      const b = triangle[(i + 1) % 3];
      return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) >= -0.01;
    })));
  }
  return pieces.filter(poly => Geometry.calculatePolygonArea(poly) > 0.01);
}

export function pasteWallObjects(wall: Wall, content: WallClipboard, materials: Material[]): { wall: Wall; ids: string[] } {
  const error = clipboardPlacementError(wall, content, materials);
  if (error) throw new Error(error);
  if (content.kind === 'openings') {
    const names = new Set(wall.openings.map(op => op.name));
    const openings = content.openings.map(item => {
      const op = structuredClone(item);
      const base = op.name.replace(/ \(копия(?: \d+)?\)$/, '');
      let name = `${base} (копия)`, index = 2;
      while (names.has(name)) name = `${base} (копия ${index++})`;
      names.add(name);
      const id = `op-${crypto.randomUUID()}`;
      return { ...op, name, id, isApplied: false };
    });
    return { wall: { ...wall, openings: [...wall.openings, ...openings] }, ids: openings.map(op => op.id) };
  }
  const source = cuttableWall(wall, materials);
  const panels = content.panels.map(p => ({ ...structuredClone(p), id: `panel-${crypto.randomUUID()}`, partLabel: '' }));
  const remaining = (source.panels ?? []).flatMap(p => {
    if (!p.isVoid && p.materialId !== MATERIAL_NONE_ID) return [p];
    let polygons = [p.points];
    for (const inserted of panels) polygons = polygons.flatMap(poly => subtractPolygon(poly, inserted.points));
    return polygons.map((points, i) => ({ ...p, id: i ? `void-${crypto.randomUUID()}` : p.id, points, edges: undefined }));
  });
  const groups = new Map<string, string>();
  const joints = content.joints.map(j => {
    if (j.groupId && !groups.has(j.groupId)) groups.set(j.groupId, `group-${crypto.randomUUID()}`);
    return { ...structuredClone(j), id: `joint-${crypto.randomUUID()}`, groupId: j.groupId ? groups.get(j.groupId) : undefined, isOuterEdge: false };
  });
  return { wall: { ...source, panels: [...remaining, ...panels], joints: [...(source.joints ?? []), ...joints] }, ids: panels.map(p => p.id) };
}

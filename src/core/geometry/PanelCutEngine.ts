import { Material } from '../models/Material';
import { Wall, WallPanelPiece, PanelEdgesConfig } from '../models/Wall';
import { LayoutEngine } from '../layout/LayoutEngine';
import { Point2D, PolygonSlicingEngine as Geometry } from './PolygonSlicingEngine';
import { hasPhotoTexture } from '../textures/TextureMapping';

export function cuttableWall(wall: Wall, materials: Material[]): Wall {
  if (wall.panels?.length) return wall;
  const material = materials.find(m => m.id === wall.zone.materialId) ?? materials[0];
  if (!material) return wall;
  return { ...wall, ...LayoutEngine.convertLegacyWallToPanels(wall, material, materials) };
}

export function findCutPanel(wall: Wall, id: string | null): WallPanelPiece | undefined {
  if (!id) return undefined;
  return wall.panels?.find(p => p.id === id) ?? wall.panels
    ?.filter(p => id.startsWith(`${p.id}-part-`)).sort((a, b) => b.id.length - a.id.length)[0];
}

export function panelBounds(points: Point2D[]) {
  const x = Math.min(...points.map(p => p.x)), y = Math.min(...points.map(p => p.y));
  return { x, y, width: Math.max(...points.map(p => p.x)) - x, height: Math.max(...points.map(p => p.y)) - y };
}

// Keep an edge treatment only on a child edge that lies on that original edge.
function inheritedEdges(panel: WallPanelPiece, points: Point2D[]): PanelEdgesConfig {
  const result: PanelEdgesConfig = {};
  const bounds = panelBounds(panel.points);
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-5;
  panel.points.forEach((a, index) => {
    const b = panel.points[(index + 1) % panel.points.length];
    const side = near(a.x, bounds.x) && near(b.x, bounds.x) ? 'left'
      : near(a.x, bounds.x + bounds.width) && near(b.x, bounds.x + bounds.width) ? 'right'
      : near(a.y, bounds.y) && near(b.y, bounds.y) ? 'bottom'
      : near(a.y, bounds.y + bounds.height) && near(b.y, bounds.y + bounds.height) ? 'top' : undefined;
    const config = panel.edges?.[index] ?? (side ? panel.edges?.[side] : undefined);
    if (!config) return;
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
    if (len < 1e-5) return;
    const onEdge = (p: Point2D) => {
      const distance = Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
      const projection = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (len * len);
      return distance < 1e-5 && projection >= -1e-6 && projection <= 1 + 1e-6;
    };
    points.forEach((p, childIndex) => {
      if (onEdge(p) && onEdge(points[(childIndex + 1) % points.length])) result[childIndex] = { ...config };
    });
  });
  return result;
}

/** A cut has no mounting gap until the user assigns one through the joint editor. */
export function previewPanelCut(panel: WallPanelPiece, p1: Point2D, p2: Point2D) {
  if (![p1.x, p1.y, p2.x, p2.y].every(Number.isFinite)) return null;
  const split = Geometry.splitPolygonByLine(panel.points, p1, p2, 0);
  if (!split || !split.cutSegments?.length) return null;
  const polygons = split.allPieces ?? [split.pieceA, split.pieceB];
  // Reject incomplete cuts and numerical slivers that would lose panel material.
  const beforeArea = Geometry.calculatePolygonArea(panel.points);
  const afterArea = polygons.reduce((sum, p) => sum + Geometry.calculatePolygonArea(p), 0);
  if (polygons.length < 2 || Math.abs(beforeArea - afterArea) > Math.max(0.01, beforeArea * 1e-8)) return null;
  return { polygons, segments: split.cutSegments };
}

export function cutPanelOnWall(wall: Wall, materials: Material[], panelId: string, p1: Point2D, p2: Point2D): Wall | null {
  const source = cuttableWall(wall, materials);
  const panel = findCutPanel(source, panelId);
  if (!panel) return null;
  const preview = previewPanelCut(panel, p1, p2);
  if (!preview) return null;
  const bounds = panelBounds(panel.points);
  const material = materials.find(m => m.id === panel.materialId);
  // Preserve fixed sheet crops, but keep schematic materials available for free nesting.
  const mapping = panel.textureMapping ?? (hasPhotoTexture(panel.textureCategory ?? material?.textureCategory, panel.decorCode)
    ? { offsetX: 0, offsetY: 0, angleDeg: panel.patternAngleDeg ?? 0 } : undefined);
  const id = crypto.randomUUID();
  const children = preview.polygons.map((points, index): WallPanelPiece => ({
    ...panel, id: `panel-cut-${id}-${index}`, points,
    partLabel: `${panel.partLabel}.${index + 1}`,
    textureMapping: mapping ? { ...mapping, anchor: mapping.anchor ?? bounds } : undefined,
    edges: inheritedEdges(panel, points),
  }));
  const orientation = Math.abs(p1.x - p2.x) < 1e-5 ? 'VERTICAL'
    : Math.abs(p1.y - p2.y) < 1e-5 ? 'HORIZONTAL' : 'DIAGONAL';
  return {
    ...source,
    panels: source.panels!.flatMap(p => p.id === panel.id ? children : [p]),
    joints: [...(source.joints ?? []), ...preview.segments.map((segment, index) => ({
      id: `joint-cut-${id}-${index}`, ...segment, width: 0, isLED: false, orientation,
    } as const))],
  };
}

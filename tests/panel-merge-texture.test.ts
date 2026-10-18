import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { useProjectStore } from '../src/application/stores/useProjectStore';
import { createDefaultProject } from '../src/core/models/Project';
import { createDefaultOpening } from '../src/core/models/Opening';
import { LayoutEngine } from '../src/core/layout/LayoutEngine';
import { PolygonSlicingEngine as Geometry } from '../src/core/geometry/PolygonSlicingEngine';
import { cutPanelOnWall, panelBounds } from '../src/core/geometry/PanelCutEngine';
import { mergeTextureMapping, resolveTextureMapping, textureMappingError } from '../src/core/textures/TextureMapping';
import { close, panel, sheet, wallWithPanel } from './helpers/business';

const original = useProjectStore.getState();
afterEach(() => useProjectStore.setState(original));
const material = { ...sheet, textureCategory: 'WOOD' as const, decorCode: '5189' };

function fixture(first = 'right', enabled?: boolean) {
  const wall = wallWithPanel(1800, 2600);
  const parts = [panel('right', 1200, 0, 150, 2208), panel('header', 300, 2100, 900, 108),
    panel('left', 150, 0, 150, 2208)];
  wall.panels = [...parts.sort((a, b) => Number(b.id === first) - Number(a.id === first)), panel('above', 150, 2208, 1200, 392)]
    .map(p => ({ ...p, textureMapping: { offsetX: 0, offsetY: 0, angleDeg: 0, enabled, anchor: panelBounds(p.points) } }));
  wall.openings = [{ ...createDefaultOpening('PORTAL', wall.width, wall.height), id: 'portal',
    x: 300, y: 0, width: 900, height: 2100, isApplied: true }];
  return wall;
}

for (const first of ['right', 'left', 'header']) for (const enabled of [undefined, false, true]) {
  test(`merging a portal surround starts a complete sheet crop, first=${first}, fixed=${enabled}`, () => {
    const wall = fixture(first, enabled);
    useProjectStore.setState({ ...original, project: { ...createDefaultProject(), walls: [wall], materials: [material],
      selectedWallId: wall.id }, selectedPieceIds: ['right', 'header', 'left'], selectedCellKeys: [], isDirty: false });
    const before = structuredClone(useProjectStore.getState().project.walls[0]);
    useProjectStore.getState().mergeSelectedCells(wall.id);
    const state = useProjectStore.getState(), after = state.project.walls[0];
    assert.equal(after.panels!.length, 2);
    const merged = after.panels!.find(p => p.id.endsWith('-merged'))!;
    const layout = LayoutEngine.calculateWallLayout(after, material, [material]);
    const piece = layout.panels.find(p => p.id === merged.id)!;
    assert.ok(piece);
    assert.deepEqual([piece.width, piece.height], [1200, 2208]);
    assert.equal(textureMappingError(piece), undefined);
    assert.deepEqual(resolveTextureMapping(piece), { offsetX: 0, offsetY: 0, angleDeg: 0, enabled: false });
    close(Geometry.calculatePolygonArea(piece.polygonPoints!), 2 * 150 * 2208 + 900 * 108);
    assert.ok(Geometry.isPointInPolygon({ x: 220, y: 1200 }, piece.polygonPoints!));
    assert.ok(Geometry.isPointInPolygon({ x: 700, y: 2150 }, piece.polygonPoints!));
    assert.equal(Geometry.isPointInPolygon({ x: 700, y: 1200 }, piece.polygonPoints!), false);
    assert.deepEqual(after.openings, before.openings);
    assert.deepEqual(state.selectedPieceIds, [merged.id]);
    assert.equal(state.isDirty, true);
    assert.ok(state.undo());
    assert.deepEqual(useProjectStore.getState().project.walls[0], before);
    assert.ok(state.redo());
    assert.deepEqual(useProjectStore.getState().project.walls[0], after);
  });
}

test('an already saved automatic merge with a small inherited anchor recovers without changing saved geometry', () => {
  const wall = fixture();
  const originalPanel = wall.panels![0];
  wall.panels = [wall.panels!.find(p => p.id === 'above')!, { ...originalPanel, id: 'old-merged',
    points: Geometry.unionPolygons(wall.panels!.filter(p => p.id !== 'above').map(p => p.points)) }];
  const before = structuredClone(wall);
  const piece = LayoutEngine.calculateWallLayout(wall, material, [material]).panels.find(p => p.id === 'old-merged')!;
  assert.equal(textureMappingError(piece), undefined);
  close(resolveTextureMapping(piece).offsetX, 0);
  close(resolveTextureMapping(piece).offsetY, 0);
  assert.deepEqual(wall, before);
  const cut = cutPanelOnWall(wall, [material], 'old-merged', { x: 150, y: 2150 }, { x: 1350, y: 2150 })!;
  assert.ok(cut);
  const children = LayoutEngine.calculateWallLayout(cut, material, [material]).panels;
  assert.ok(children.every(p => textureMappingError(p) === undefined));
});

test('reuniting cuts from a common manually positioned source preserves its crop and rotation', () => {
  for (const angleDeg of [0, 90, 27.5]) {
    const wall = wallWithPanel(600, 800);
    wall.panels![0].textureMapping = { offsetX: 20, offsetY: 30, angleDeg, enabled: true };
    const cut = cutPanelOnWall(wall, [material], 'panel-1', { x: 300, y: 0 }, { x: 300, y: 800 })!;
    const pieces = cut.panels!.map(p => ({ ...p, ...panelBounds(p.points), textureCategory: 'WOOD', decorCode: '5189' }));
    const merged = { ...pieces[0], ...panelBounds(wall.panels![0].points), textureStockWidth: 1220, textureStockHeight: 2800 };
    const mapping = mergeTextureMapping(pieces, merged)!;
    assert.deepEqual(resolveTextureMapping({ ...merged, textureMapping: mapping }),
      { offsetX: 20, offsetY: 30, angleDeg, enabled: true });
  }
});

test('automatic stale-anchor recovery does not hide explicit invalid offsets or a too-large merged panel', () => {
  const source = { x: 150, y: 0, width: 1200, height: 2208, textureCategory: 'WOOD', decorCode: '5189',
    textureMapping: { offsetX: 50, offsetY: 0, angleDeg: 0, enabled: true,
      anchor: { x: 1200, y: 0, width: 150, height: 2208 } } };
  assert.ok(textureMappingError(source));
  const automatic = { ...source, width: 1500, textureMapping: { ...source.textureMapping, offsetX: 0, enabled: false } };
  assert.ok(textureMappingError(automatic));
  assert.equal(mergeTextureMapping([{ ...source, textureMapping: undefined }], source), undefined);
});

test('an unsuccessful union leaves every selected panel and the undo history intact', () => {
  const wall = wallWithPanel(1000, 1200);
  // The selection permits a 20 mm neighborhood; the union only bridges a 16 mm seam.
  wall.panels = [panel('a', 0, 0, 400, 1200), panel('b', 419, 0, 400, 1200)];
  useProjectStore.setState({ ...original, project: { ...createDefaultProject(), walls: [wall], materials: [material],
    selectedWallId: wall.id }, selectedPieceIds: ['a', 'b'], selectedCellKeys: [], isDirty: false });
  const before = useProjectStore.getState();
  useProjectStore.getState().mergeSelectedCells(wall.id);
  assert.equal(useProjectStore.getState().project, before.project);
  assert.equal(useProjectStore.getState().history, before.history);
  assert.equal(useProjectStore.getState().isDirty, false);
});

test('fractional cut bounds keep their source crop despite display dimension rounding', () => {
  const wall = wallWithPanel(1200.06, 2000.04);
  const cut = cutPanelOnWall(wall, [material], 'panel-1', { x: 600, y: 0 }, { x: 600, y: 2000.04 })!;
  const right = LayoutEngine.calculateWallLayout(cut, material, [material]).panels.find(p => Math.abs(p.x - 600) < 1e-6)!;
  close(resolveTextureMapping(right).offsetX, 600);
});

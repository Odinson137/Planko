import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { cutPanelOnWall, cuttableWall, previewPanelCut, panelBounds } from '../src/core/geometry/PanelCutEngine';
import { PolygonSlicingEngine as Geometry } from '../src/core/geometry/PolygonSlicingEngine';
import { LayoutEngine } from '../src/core/layout/LayoutEngine';
import { createDefaultProject } from '../src/core/models/Project';
import { createDefaultOpening } from '../src/core/models/Opening';
import { useProjectStore } from '../src/application/stores/useProjectStore';
import { usePanelCutStore } from '../src/application/stores/usePanelCutStore';
import { useEditorStore } from '../src/application/stores/useEditorStore';
import { resolveTextureMapping } from '../src/core/textures/TextureMapping';
import { sheet, wallWithPanel, panel, rectangle, close } from './helpers/business';

const original = useProjectStore.getState(), originalCut = usePanelCutStore.getState(), originalEditor = useEditorStore.getState();
beforeEach(() => {
  const wall = wallWithPanel(1000, 1000);
  useProjectStore.setState({ ...original, isDirty: false, project: { ...createDefaultProject(),
    id: 'cut-project', walls: [wall], selectedWallId: wall.id, materials: [sheet] } });
  usePanelCutStore.setState(originalCut);
  useEditorStore.setState(originalEditor);
});
afterEach(() => {
  useProjectStore.setState(original); usePanelCutStore.setState(originalCut); useEditorStore.setState(originalEditor);
});
const currentWall = () => useProjectStore.getState().project.walls[0];
const area = (wall: ReturnType<typeof currentWall>) => wall.panels!.reduce((sum, p) => sum + Geometry.calculatePolygonArea(p.points), 0);

for (const [name, p1, p2] of [
  ['vertical', { x: 345.67, y: 0 }, { x: 345.67, y: 1000 }],
  ['horizontal', { x: 0, y: 812.34 }, { x: 1000, y: 812.34 }],
  ['diagonal', { x: 0, y: 123.45 }, { x: 1000, y: 876.54 }],
] as const) {
  test(`wall knife creates ${name} cut without a gap, preserving neighboring panels and metadata`, () => {
    const wall = currentWall();
    wall.panels![0] = { ...wall.panels![0], color: '#123456', thickness: 16, note: 'Keep', decorCode: 'CUSTOM' };
    wall.panels!.push(panel('neighbor', 1000, 0, 500, 1000));
    const before = structuredClone(wall);
    const result = cutPanelOnWall(wall, [sheet], 'panel-1', p1, p2)!;
    assert.ok(result);
    assert.equal(result.panels!.length, 3);
    close(area(result), area(wall));
    assert.equal(result.panels![2], wall.panels![1]);
    assert.ok(result.panels!.slice(0, 2).every(p => p.note === 'Keep' && p.thickness === 16 && p.decorCode === 'CUSTOM'));
    assert.equal(result.joints!.length, 1);
    assert.equal(result.joints![0].width, 0);
    assert.equal(result.joints![0].profileArticle, undefined);
    assert.deepEqual(wall, before);
  });
}

test('cut uses absolute wall coordinates for a panel away from the origin', () => {
  const wall = currentWall();
  wall.panels = [panel('offset', 700, 400, 1000, 1000)];
  const result = cutPanelOnWall(wall, [sheet], 'offset', { x: 1200, y: 400 }, { x: 1200, y: 1400 })!;
  assert.ok(result);
  assert.ok(result.panels!.every(p => panelBounds(p.points).width === 500));
  assert.ok(result.panels!.every(p => p.points.every(pt => pt.x >= 700 && pt.y >= 400)));
});

test('concave panel produces all separate pieces and a joint for each cut interval', () => {
  const wall = currentWall();
  wall.panels![0].points = [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 },
    { x: 700, y: 1000 }, { x: 700, y: 300 }, { x: 300, y: 300 }, { x: 300, y: 1000 }, { x: 0, y: 1000 }];
  const result = cutPanelOnWall(wall, [sheet], 'panel-1', { x: 0, y: 600 }, { x: 1000, y: 600 })!;
  assert.equal(result.panels!.length, 3);
  assert.equal(result.joints!.length, 2);
  close(area(result), area(wall));
});

test('diagonal cut keeps edge profiles on original edges and never adds them to the cut', () => {
  const wall = currentWall();
  wall.panels![0].edges = { left: { width: 0, profileArticle: 'MC-06' }, top: { width: 0, profileArticle: 'DL-13' } };
  const result = cutPanelOnWall(wall, [sheet], 'panel-1', { x: 0, y: 0 }, { x: 1000, y: 1000 })!;
  const inherited = result.panels!.flatMap(p => Object.entries(p.edges!).map(([edge, config]) => {
    const a = p.points[Number(edge)], b = p.points[(Number(edge) + 1) % p.points.length];
    assert.ok((a.x === 0 && b.x === 0) || (a.y === 1000 && b.y === 1000));
    return config!.profileArticle;
  }));
  assert.deepEqual(inherited.sort(), ['DL-13', 'MC-06']);
});

test('cut retains the original texture anchor so children show contiguous sheet regions', () => {
  const wall = currentWall();
  wall.panels![0].textureMapping = { offsetX: 50, offsetY: 70, angleDeg: 0 };
  const result = cutPanelOnWall(wall, [sheet], 'panel-1', { x: 400, y: 0 }, { x: 400, y: 1000 })!;
  const children = result.panels!.map(p => ({ ...p, ...panelBounds(p.points) })).sort((a, b) => a.x - b.x);
  assert.equal(resolveTextureMapping(children[0]).offsetX, 50);
  assert.equal(resolveTextureMapping(children[1]).offsetX, 450);
  assert.equal(resolveTextureMapping(children[1]).offsetY, 70);
});

test('cut keeps schematic materials free for nesting without assigning a fixed sheet crop', () => {
  const wall = wallWithPanel(3600, 2750);
  const result = cutPanelOnWall(wall, [sheet], 'panel-1', { x: 1200, y: 0 }, { x: 1200, y: 2750 })!;
  assert.ok(result.panels!.every(p => p.textureMapping === undefined));
});

test('photo material keeps its sheet position even when the default crop was implicit', () => {
  const wall = currentWall();
  wall.panels![0].textureCategory = 'WOOD';
  wall.panels![0].decorCode = '5007';
  const result = cutPanelOnWall(wall, [sheet], 'panel-1', { x: 400, y: 0 }, { x: 400, y: 1000 })!;
  const right = result.panels!.map(p => ({ ...p, ...panelBounds(p.points) })).find(p => p.x === 400)!;
  assert.equal(resolveTextureMapping(right).offsetX, 400);
});

test('draft openings remain in place and net panel area is unchanged by a cut', () => {
  const wall = currentWall();
  wall.openings = [{ ...createDefaultOpening('WINDOW', 1000, 1000), x: 200, y: 300, width: 300, height: 300 }];
  const result = cutPanelOnWall(wall, [sheet], 'panel-1', { x: 400, y: 0 }, { x: 400, y: 1000 })!;
  assert.equal(result.openings, wall.openings);
  const before = LayoutEngine.calculateWallLayout(wall, sheet, [sheet]);
  const after = LayoutEngine.calculateWallLayout(result, sheet, [sheet]);
  close(after.summary.coveredAreaSqM, before.summary.coveredAreaSqM);
});

test('legacy wall cutting preserves its existing profile products and other panels', () => {
  const wall = currentWall();
  wall.width = 2500; wall.panels = undefined; wall.joints = undefined;
  wall.customJoints = { 'edge-v-1': { id: 'edge-v-1', orientation: 'VERTICAL', width: 3, isLED: false, profileArticle: 'MC-06', profileColor: '#121212' } };
  const source = cuttableWall(wall, [sheet]);
  assert.ok(source.panels!.length > 1);
  const b = panelBounds(source.panels![0].points);
  const result = cutPanelOnWall(wall, [sheet], source.panels![0].id,
    { x: b.x, y: b.y + b.height / 2 }, { x: b.x + b.width, y: b.y + b.height / 2 })!;
  assert.equal(result.panels!.length, source.panels!.length + 1);
  close(area(result), area(source));
  assert.ok(result.joints!.some(j => j.profileArticle === 'MC-06' && j.profileColor === '#121212'));
});

test('zero-length, nonfinite, outside and tangent strokes leave geometry unchanged', () => {
  const wall = currentWall();
  for (const [p1, p2] of [
    [{ x: 10, y: 10 }, { x: 10, y: 10 }], [{ x: NaN, y: 0 }, { x: 1000, y: 1000 }],
    [{ x: 0, y: 1100 }, { x: 1000, y: 1100 }], [{ x: 0, y: 0 }, { x: 1000, y: 0 }],
  ]) assert.equal(cutPanelOnWall(wall, [sheet], 'panel-1', p1, p2), null);
  assert.equal(cutPanelOnWall(wall, [sheet], 'missing', { x: 500, y: 0 }, { x: 500, y: 1000 }), null);
});

function prepareCut(panelId = 'panel-1') {
  const cut = usePanelCutStore.getState();
  cut.begin(currentWall().id, panelId);
  cut.setPoint('p1', { x: 500, y: 0 }); cut.setPoint('p2', { x: 500, y: 1000 });
  return cut;
}

test('preview and cancellation do not dirty or alter the project', () => {
  const before = useProjectStore.getState().project;
  const cut = prepareCut();
  assert.ok(previewPanelCut(currentWall().panels![0], { x: 500, y: 0 }, { x: 500, y: 1000 }));
  cut.clearLine(); cut.finish();
  assert.equal(useProjectStore.getState().project, before);
  assert.equal(useProjectStore.getState().isDirty, false);
  assert.equal(useEditorStore.getState().activeTool, 'SELECT');
});

test('apply marks dirty, exposes the new joint for the existing profile menu, and undo restores the original', () => {
  const before = structuredClone(currentWall());
  const cut = prepareCut();
  assert.equal(cut.apply(), true);
  assert.equal(currentWall().panels!.length, 2);
  assert.equal(useProjectStore.getState().isDirty, true);
  const layout = LayoutEngine.calculateWallLayout(currentWall(), sheet, [sheet]);
  assert.ok(layout.joints.some(j => j.id === currentWall().joints![0].id && j.width === 0));
  assert.equal(cut.undo(), true);
  assert.deepEqual(currentWall(), before);
});

test('multiple cuts can be undone one at a time', () => {
  const cut = prepareCut();
  cut.apply();
  const once = structuredClone(currentWall());
  cut.choosePanel(currentWall().panels![0].id);
  cut.setPoint('p1', { x: 0, y: 400 }); cut.setPoint('p2', { x: 1000, y: 400 });
  assert.equal(cut.apply(), true);
  assert.equal(currentWall().panels!.length, 3);
  assert.equal(cut.undo(), true);
  assert.deepEqual(currentWall(), once);
  assert.equal(cut.undo(), true);
  assert.deepEqual(currentWall().panels![0].points, rectangle(0, 0, 1000, 1000));
});

test('undo walks later edits before cuts and never crosses into another project', () => {
  const cut = prepareCut(); cut.apply();
  useProjectStore.getState().updateWallName(currentWall().id, 'Later edit');
  assert.equal(cut.undo(), true);
  assert.notEqual(currentWall().name, 'Later edit');
  assert.equal(currentWall().panels!.length, 2);
  assert.equal(cut.undo(), true);
  assert.equal(currentWall().panels!.length, 1);
  useProjectStore.getState().setProject({ ...createDefaultProject(), id: 'another' });
  assert.equal(cut.undo(), false); assert.equal(cut.apply(), false);
});

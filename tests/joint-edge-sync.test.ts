import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { useProjectStore } from '../src/application/stores/useProjectStore';
import { PdfExportService } from '../src/application/services/PdfExportService';
import { createDefaultProject } from '../src/core/models/Project';
import { cutPanelOnWall } from '../src/core/geometry/PanelCutEngine';
import { getResolvedPanelEdges } from '../src/core/geometry/PanelJointBinding';
import { PolygonSlicingEngine as Geometry } from '../src/core/geometry/PolygonSlicingEngine';
import { LayoutEngine } from '../src/core/layout/LayoutEngine';
import { panel, sheet, wallWithPanel, close } from './helpers/business';

const original = useProjectStore.getState();
afterEach(() => useProjectStore.setState(original));
const current = () => useProjectStore.getState().project.walls[0];
function load(wall: ReturnType<typeof wallWithPanel>) {
  useProjectStore.setState({ ...original, project: { ...createDefaultProject(), walls: [wall], materials: [sheet] } });
}
function fixture() {
  const wall = wallWithPanel(3600, 2750);
  wall.panels = [panel('left', 0, 0, 1218.5, 2750), panel('middle', 1221.5, 0, 1220, 2750),
    panel('right', 2444.5, 0, 1155.5, 2750)];
  wall.panels.forEach((p, i) => { p.partLabel = `1.${i + 1}`; });
  wall.joints = [1220, 2443].map((x, i) => ({ id: `joint-${i}`, p1: { x, y: 0 }, p2: { x, y: 2750 },
    width: 3, isLED: false, profileArticle: 'MC-06', orientation: 'VERTICAL' }));
  return wall;
}

test('editing a middle panel edge leaves its opposite edge, neighbors and other joint unchanged', () => {
  load(fixture());
  const before = structuredClone(current());
  const store = useProjectStore.getState();
  store.setPanelEdgeWidth(current().id, 'middle', 'left', 56);
  const wall = current();
  assert.deepEqual(wall.panels![0], before.panels![0]);
  assert.deepEqual(wall.panels![2], before.panels![2]);
  close(Math.max(...wall.panels![1].points.map(p => p.x)), 2441.5);
  close(Math.min(...wall.panels![1].points.map(p => p.x)), 1274.5);
  assert.deepEqual(wall.joints![1], before.joints![1]);
  assert.equal(wall.joints!.length, before.joints!.length);
  assert.equal(getResolvedPanelEdges(wall, wall.panels![1]).find(e => e.key === 'right')!.config!.width, 3);
  assert.equal(LayoutEngine.calculateWallLayout(wall, sheet, [sheet]).joints.filter(j => !j.isOuterEdge).length, 2);
});

test('selecting another panel or wall never retains a previously selected edge or changes the project geometry', () => {
  load(fixture());
  const store = useProjectStore.getState(), before = structuredClone(current());
  store.selectPanel('left', 0, 0);
  store.setSelectedPanelEdge({ wallId: current().id, panelId: 'left', edge: 'right' });
  store.selectPanel('middle', 0, 1);
  assert.equal(useProjectStore.getState().selectedPanelEdge, null);
  store.setSelectedPanelEdge({ wallId: current().id, panelId: 'middle', edge: 'left' });
  store.selectWall(current().id);
  assert.equal(useProjectStore.getState().selectedPanelEdge, null);
  assert.deepEqual(current(), before);
});

test('changing either edge of the middle panel keeps the other gap and profile independent', () => {
  load(fixture());
  const store = useProjectStore.getState();
  store.setPanelEdgeWidth(current().id, 'middle', 'left', 56);
  store.setPanelEdgeProfile(current().id, 'middle', 'left', 'MC-06', '#123456');
  const left = structuredClone(current().joints![0]);
  const neighbors = [structuredClone(current().panels![0]), structuredClone(current().panels![2])];
  store.setSelectedPanelEdge({ wallId: current().id, panelId: 'middle', edge: 'left' });
  store.setPanelEdgeWidth(current().id, 'middle', 'right', 20);
  store.setPanelEdgeProfile(current().id, 'middle', 'right', 'MC-06-7', '#abcdef');
  assert.deepEqual(current().joints![0], left);
  assert.deepEqual([current().panels![0], current().panels![2]], neighbors);
  const edges = getResolvedPanelEdges(current(), current().panels![1]);
  assert.equal(edges.find(e => e.key === 'left')!.config!.width, 56);
  assert.equal(edges.find(e => e.key === 'right')!.config!.width, 20);
  assert.equal(useProjectStore.getState().selectedPanelEdge!.edge, 'left');
  assert.equal(current().joints!.length, 2);
});

test('a gap that consumes the selected panel is rejected without altering any panel or joint', () => {
  const wall = wallWithPanel(100, 100);
  wall.panels = [panel('left', 0, 0, 50, 100), panel('right', 50, 0, 50, 100)];
  wall.joints = [{ id: 'joint', p1: { x: 50, y: 0 }, p2: { x: 50, y: 100 }, width: 0, isLED: false }];
  load(wall);
  const before = structuredClone(current());
  assert.throws(() => useProjectStore.getState().setPanelEdgeWidth(wall.id, 'right', 'left', 60), /Зазор/);
  assert.deepEqual(current(), before);
});

test('saved cut gaps appear on both adjacent edges even when edge settings are missing or zero', () => {
  const wall = fixture();
  wall.panels![0].edges = { right: { width: 0 } };
  for (const [id, side] of [['left', 'right'], ['middle', 'left'], ['middle', 'right'], ['right', 'left']]) {
    const edge = getResolvedPanelEdges(wall, wall.panels!.find(p => p.id === id)!).find(e => e.side === side)!;
    assert.equal(edge.config!.width, 3);
    assert.equal(edge.config!.profileArticle, 'MC-06');
  }
  assert.equal(getResolvedPanelEdges(wall, wall.panels![0])[3].joint, undefined, 'exterior edge is not the cut');
});

test('editing either panel edge closes the saved three millimeter cuts in the store, layout and PDF', () => {
  load(fixture());
  const store = useProjectStore.getState();
  store.setPanelEdgeWidth(current().id, 'left', 'right', 0);
  store.setPanelEdgeWidth(current().id, 'right', 'left', 0);
  const wall = current(), layout = LayoutEngine.calculateWallLayout(wall, sheet, [sheet]);
  assert.ok(wall.joints!.every(j => j.width === 0));
  for (const x of wall.joints!.map(j => j.p1.x)) {
    assert.ok(wall.panels!.filter(p => p.points.some(pt => Math.abs(pt.x - x) < 1e-5)).length >= 2);
  }
  assert.equal(layout.panels.find(p => p.id === 'left')!.width, 1221.5, 'closing the gap grows only the selected panel');
  assert.equal(layout.panels.find(p => p.id === 'middle')!.width, 1220, 'the neighboring stock stays in place');
  close(wall.panels!.reduce((sum, p) => sum + Geometry.calculatePolygonArea(p.points), 0), wall.width * wall.height);
  assert.ok(layout.joints.filter(j => j.id.startsWith('joint-')).every(j => j.width === 0));
  const texts: string[] = [];
  const ctx = new Proxy({}, { get: (_, key) => key === 'fillText' ? (s: string) => texts.push(s)
    : key === 'measureText' ? (s: string) => ({ width: s.length * 9 }) : () => undefined, set: () => true });
  (PdfExportService as any).drawWall2DOnCanvas(ctx, wall, layout, 0, 0, 2830, 840, true, [sheet]);
  assert.ok(!texts.includes('3'), 'the zero-gap drawing has no phantom three millimeter dimension');
});

test('fractional gap edits round trip through either side without duplicate edge insets', () => {
  load(fixture());
  const store = useProjectStore.getState(), initial = structuredClone(current().panels);
  for (const gap of [0, 0.8, 7, 3]) {
    store.setPanelEdgeWidth(current().id, 'middle', 'left', gap);
    const wall = current();
    const right = Math.min(...wall.panels![1].points.map(p => p.x));
    const left = Math.max(...wall.panels![0].points.map(p => p.x));
    close(right - left, gap);
    assert.equal(getResolvedPanelEdges(wall, wall.panels![0]).find(e => e.side === 'right')!.config!.width, gap);
    assert.equal(wall.customJoints['joint-0'].width, gap);
  }
  current().panels!.forEach((p, i) => p.points.forEach((point, j) => {
    close(point.x, initial![i].points[j].x); close(point.y, initial![i].points[j].y);
  }));
  store.setPanelEdgeProfile(current().id, 'left', 'right', 'DL-13', '#123456');
  const before = structuredClone(current().panels);
  store.setPanelEdgeColor(current().id, 'middle', 'left', '#abcdef');
  assert.deepEqual(current().panels, before, 'profile color never changes geometry');
  assert.equal(current().joints![0].profileColor, '#abcdef');
});

test('bulk zero-gap editing uses the shifted position of each subsequent joint', () => {
  load(fixture());
  const store = useProjectStore.getState();
  store.selectJoint('joint-0'); store.selectJoint('joint-1', true);
  store.setJointWidthForSelected(current().id, 0);
  const wall = current();
  for (const joint of wall.joints!) {
    assert.equal(joint.width, 0);
    assert.equal(wall.panels!.filter(p => p.points.some(point => Math.abs(point.x - joint.p1.x) < 1e-5)).length, 2);
  }
  close(wall.panels!.reduce((sum, p) => sum + Geometry.calculatePolygonArea(p.points), 0), wall.width * wall.height);
});

for (const direction of ['HORIZONTAL', 'DIAGONAL'] as const) {
  test(`${direction} shared cut supports zero and fractional gaps without moving unrelated panels`, () => {
    const wall = wallWithPanel(1000, 1000);
    const p1 = { x: 0, y: direction === 'HORIZONTAL' ? 500 : 0 }, p2 = { x: 1000, y: direction === 'HORIZONTAL' ? 500 : 1000 };
    load(cutPanelOnWall(wall, [sheet], 'panel-1', p1, p2)!);
    useProjectStore.getState().setJointWidth(wall.id, current().joints![0].id, 3);
    const originalPoints = structuredClone(current().panels!.map(p => p.points));
    for (const gap of [0, 0.8, 3]) {
      const target = current().panels![0];
      const edge = getResolvedPanelEdges(current(), target).find(e => e.joint)!;
      useProjectStore.getState().setPanelEdgeWidth(wall.id, target.id, edge.key, gap);
      close(current().joints![0].width, gap);
      for (const p of current().panels!) assert.ok(getResolvedPanelEdges(current(), p).some(e => e.joint && e.config!.width === gap));
    }
    current().panels!.forEach((p, i) => {
      const order = (points: typeof p.points) => [...points].sort((a, b) => a.x - b.x || a.y - b.y);
      const actual = order(p.points), expected = order(originalPoints[i]);
      assert.equal(actual.length, expected.length, JSON.stringify({ actual, expected }));
      actual.forEach((point, j) => { close(point.x, expected[j].x); close(point.y, expected[j].y); });
    });
  });
}

test('closing vertical cuts updates the endpoints of incident diagonal cuts', () => {
  const wall = fixture();
  const cut = Geometry.splitWallPanel(wall.panels![1], { x: 1221.5, y: 0 }, { x: 2441.5, y: 2750 }, 0)!;
  wall.panels = [wall.panels![0], ...cut.newPanels, wall.panels![2]];
  wall.joints!.push({ id: 'diagonal', p1: { x: 1221.5, y: 0 }, p2: { x: 2441.5, y: 2750 }, width: 0, isLED: false, orientation: 'DIAGONAL' });
  load(wall);
  useProjectStore.getState().setPanelEdgeWidth(wall.id, 'left', 'right', 0);
  const diagonal = current().joints!.find(j => j.id === 'diagonal')!;
  assert.ok(current().panels!.some(p => p.points.some(pt => Math.hypot(pt.x - diagonal.p1.x, pt.y - diagonal.p1.y) < 1e-5)));
});

test('PDF bottom chain keeps fractional dimensions and small gaps', () => {
  const wall = fixture();
  wall.panels = [panel('a', 0, 0, 1218.5, 2750), panel('b', 1219.3, 0, 1220, 2750)];
  const layout = LayoutEngine.calculateWallLayout(wall, sheet, [sheet]);
  const texts: string[] = [];
  const ctx = new Proxy({}, { get: (_, key) => key === 'fillText' ? (s: string) => texts.push(s)
    : key === 'measureText' ? (s: string) => ({ width: s.length * 9 }) : () => undefined, set: () => true });
  (PdfExportService as any).drawWall2DOnCanvas(ctx, wall, layout, 0, 0, 2830, 840, true, [sheet]);
  assert.ok(texts.includes('1218.5')); assert.ok(texts.includes('0.8'));
});

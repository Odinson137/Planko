import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { useProjectStore } from '../src/application/stores/useProjectStore';
import { PdfExportService } from '../src/application/services/PdfExportService';
import { createDefaultProject } from '../src/core/models/Project';
import { cutPanelOnWall } from '../src/core/geometry/PanelCutEngine';
import { getResolvedPanelEdges, getJointGapOwners } from '../src/core/geometry/PanelJointBinding';
import { PolygonSlicingEngine as Geometry } from '../src/core/geometry/PolygonSlicingEngine';
import { LayoutEngine } from '../src/core/layout/LayoutEngine';
import { panel, sheet, wallWithPanel, close } from './helpers/business';

const original = useProjectStore.getState();
afterEach(() => useProjectStore.setState(original));
const current = () => useProjectStore.getState().project.walls[0];
function ownerFixture() {
  const wall = wallWithPanel(1000, 800);
  wall.panels = [panel('left', 0, 0, 500, 800), panel('right', 500, 0, 500, 800)];
  wall.panels[1].partLabel = '1.2';
  wall.joints = [{ id: 'shared', p1: { x: 500, y: 0 }, p2: { x: 500, y: 800 }, width: 0, isLED: false }];
  return wall;
}
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

for (const first of ['left', 'right'] as const) {
  test(`first ${first} panel remains the master when the opposite side changes 15 to 30 mm`, () => {
    load(ownerFixture());
    const store = useProjectStore.getState();
    const other = first === 'left' ? 'right' : 'left';
    const firstEdge = first === 'left' ? 'right' : 'left';
    const otherEdge = first === 'left' ? 'left' : 'right';
    const fixed = structuredClone(current().panels!.find(p => p.id === other));
    store.setPanelEdgeWidth(current().id, first, firstEdge, 15);
    const owner = current().joints![0].gapOwnerSide;
    store.setSelectedPanelEdge({ wallId: current().id, panelId: other, edge: otherEdge });
    store.setPanelEdgeWidth(current().id, other, otherEdge, 30);
    assert.equal(current().joints![0].gapOwnerSide, owner);
    assert.equal(current().customJoints.shared.gapOwnerSide, owner);
    assert.deepEqual(current().panels!.find(p => p.id === other), fixed);
    const master = current().panels!.find(p => p.id === first)!;
    close(Math.max(...master.points.map(p => p.x)) - Math.min(...master.points.map(p => p.x)), 470);
    for (const p of current().panels!) {
      assert.equal(getResolvedPanelEdges(current(), p).find(e => e.joint)!.config!.width, 30);
    }
    close(Math.min(...current().panels![1].points.map(p => p.x)) - Math.max(...current().panels![0].points.map(p => p.x)), 30);
    assert.equal(useProjectStore.getState().selectedPanelEdge!.panelId, other);
    assert.equal(useProjectStore.getState().selectedPanelEdge!.edge, otherEdge);
  });
}

test('ownership survives a zero gap, profile and color edits, save/load, undo and redo', () => {
  load(ownerFixture());
  const store = useProjectStore.getState(), fixed = structuredClone(current().panels![1]);
  store.setPanelEdgeProfile(current().id, 'right', 'left', 'MC-06');
  assert.equal(current().joints![0].gapOwnerSide, undefined, 'profile alone does not claim the gap');
  store.setPanelEdgeWidth(current().id, 'left', 'right', 15);
  const owner = current().joints![0].gapOwnerSide;
  store.setPanelEdgeWidth(current().id, 'right', 'left', 0);
  store.setPanelEdgeProfile(current().id, 'right', 'left', 'DL-13');
  store.setPanelEdgeColor(current().id, 'right', 'left', '#123456');
  store.setProject(JSON.parse(JSON.stringify(useProjectStore.getState().project)));
  store.setPanelEdgeWidth(current().id, 'right', 'left', 30);
  assert.equal(current().joints![0].gapOwnerSide, owner);
  assert.equal(current().joints![0].profileArticle, 'DL-13');
  assert.equal(current().joints![0].profileColor, '#123456');
  assert.deepEqual(current().panels![1], fixed);
  assert.ok(store.undo());
  assert.equal(current().joints![0].width, 0);
  assert.equal(current().joints![0].gapOwnerSide, owner);
  assert.ok(store.redo());
  assert.equal(current().joints![0].width, 30);
  assert.deepEqual(current().panels![1], fixed);
});

test('direct and bulk joint editors preserve the master and reject direction overrides', () => {
  load(ownerFixture());
  const store = useProjectStore.getState(), fixed = structuredClone(current().panels![1]);
  store.setPanelEdgeWidth(current().id, 'left', 'right', 15);
  store.setJointTakeSide(current().id, 'shared', 'RIGHT');
  store.setJointWidth(current().id, 'shared', 30);
  assert.deepEqual(current().panels![1], fixed);
  close(Math.max(...current().panels![0].points.map(p => p.x)), 470);
  store.selectJoint('shared');
  store.setJointTakeSideForSelected(current().id, 'RIGHT');
  store.setJointWidthForSelected(current().id, 45);
  close(Math.max(...current().panels![0].points.map(p => p.x)), 455);
  store.setJointPresetForSelected(current().id, '7');
  close(Math.max(...current().panels![0].points.map(p => p.x)), 493);
  assert.equal(current().joints![0].profileArticle, 'MC-06-7');
  assert.deepEqual(current().panels![1], fixed);
});

test('an oversized gap edited on the linked panel is rejected using the master panel capacity', () => {
  const wall = ownerFixture();
  wall.panels = [panel('left', 0, 0, 40, 800), panel('right', 40, 0, 960, 800)];
  wall.joints![0].p1.x = wall.joints![0].p2.x = 40;
  load(wall);
  const store = useProjectStore.getState();
  store.setPanelEdgeWidth(wall.id, 'left', 'right', 15);
  const before = structuredClone(current());
  assert.throws(() => store.setPanelEdgeWidth(wall.id, 'right', 'left', 50), /главной панели/);
  assert.deepEqual(current(), before);
});

for (const width of [0, 0.8, 15, 30]) {
  test(`refresh transfers the full ${width} mm gap, profile and ownership and can be undone`, () => {
    load(ownerFixture());
    const store = useProjectStore.getState();
    store.setPanelEdgeWidth(current().id, 'left', 'right', width);
    store.setPanelEdgeProfile(current().id, 'left', 'right', 'DL-13', '#123456');
    store.setSelectedPanelEdge({ wallId: current().id, panelId: 'left', edge: 'right' });
    const before = structuredClone(current()), owner = before.joints![0].gapOwnerSide;
    store.switchJointGapOwner(current().id, 'shared');
    const after = structuredClone(current());
    close(Math.max(...after.panels![0].points.map(p => p.x)), 500);
    close(Math.min(...after.panels![1].points.map(p => p.x)), 500 + width);
    close(after.joints![0].p1.x, before.joints![0].p1.x + width);
    assert.equal(after.joints![0].gapOwnerSide, -owner!);
    assert.equal(after.customJoints.shared.gapOwnerSide, -owner!);
    assert.equal(after.joints![0].width, width);
    assert.equal(after.joints![0].profileArticle, 'DL-13');
    assert.equal(after.joints![0].profileColor, '#123456');
    assert.equal(after.joints![0].isLED, true);
    assert.equal(useProjectStore.getState().selectedPanelEdge!.edge, 'right');
    assert.ok(store.undo()); assert.deepEqual(current(), before);
    assert.ok(store.redo()); assert.deepEqual(current(), after);
    store.setProject(JSON.parse(JSON.stringify(useProjectStore.getState().project)));
    store.setPanelEdgeWidth(current().id, 'left', 'right', width + 5);
    close(Math.max(...current().panels![0].points.map(p => p.x)), 500);
    close(Math.min(...current().panels![1].points.map(p => p.x)), 505 + width);
  });
}

test('refresh twice restores panel dimensions and the original profile position', () => {
  load(ownerFixture());
  const store = useProjectStore.getState();
  store.setPanelEdgeWidth(current().id, 'left', 'right', 15);
  const before = structuredClone(current());
  store.switchJointGapOwner(current().id, 'shared');
  store.switchJointGapOwner(current().id, 'shared');
  current().panels!.forEach((panel, i) => panel.points.forEach((p, j) => {
    close(p.x, before.panels![i].points[j].x); close(p.y, before.panels![i].points[j].y);
  }));
  close(current().joints![0].p1.x, before.joints![0].p1.x);
  close(current().joints![0].p2.x, before.joints![0].p2.x);
  assert.equal(current().joints![0].gapOwnerSide, before.joints![0].gapOwnerSide);
  assert.equal(current().joints![0].width, before.joints![0].width);
});

test('refresh refuses an exhausted new owner without partially restoring the old owner', () => {
  const wall = ownerFixture();
  wall.panels = [panel('left', 0, 0, 980, 800), panel('right', 980, 0, 20, 800)];
  wall.joints![0].p1.x = wall.joints![0].p2.x = 980;
  load(wall);
  const store = useProjectStore.getState();
  store.setPanelEdgeWidth(wall.id, 'left', 'right', 30);
  const before = structuredClone(current()), history = useProjectStore.getState().history;
  assert.throws(() => store.switchJointGapOwner(wall.id, 'shared'), /Зазор/);
  assert.deepEqual(current(), before);
  assert.equal(useProjectStore.getState().history, history);
});

for (const direction of ['HORIZONTAL', 'DIAGONAL'] as const) {
  test(`${direction} refresh transfers the full gap and restores the original contour when switched back`, () => {
    const wall = wallWithPanel(1000, 1000);
    const cut = cutPanelOnWall(wall, [sheet], 'panel-1', { x: 0, y: direction === 'HORIZONTAL' ? 500 : 0 },
      { x: 1000, y: direction === 'HORIZONTAL' ? 500 : 1000 })!;
    load(cut);
    const store = useProjectStore.getState(), first = current().panels![0];
    const edge = getResolvedPanelEdges(current(), first).find(e => e.joint)!;
    store.setPanelEdgeWidth(wall.id, first.id, edge.key, 15);
    const before = structuredClone(current()), joint = before.joints![0];
    store.switchJointGapOwner(wall.id, joint.id);
    close(Geometry.calculatePolygonArea(current().panels![0].points), 500000);
    assert.ok(Geometry.calculatePolygonArea(current().panels![1].points) < 500000);
    close(Math.hypot(current().joints![0].p1.x - joint.p1.x, current().joints![0].p1.y - joint.p1.y), 15);
    assert.equal(getJointGapOwners(current().panels!, current().joints![0])[0].panel.id, current().panels![1].id);
    store.switchJointGapOwner(wall.id, joint.id);
    current().panels!.forEach((p, i) => close(Geometry.calculatePolygonArea(p.points), Geometry.calculatePolygonArea(before.panels![i].points)));
    close(current().joints![0].p1.x, joint.p1.x); close(current().joints![0].p1.y, joint.p1.y);
  });
}

test('synchronizing joint widths keeps each joint attached to its own master side', () => {
  load(fixture());
  const store = useProjectStore.getState(), fixed = structuredClone(current().panels![1]);
  store.setPanelEdgeWidth(current().id, 'left', 'right', 15);
  store.setPanelEdgeWidth(current().id, 'right', 'left', 30);
  const owners = current().joints!.map(j => j.gapOwnerSide);
  store.selectJoint('joint-0'); store.selectJoint('joint-1', true);
  store.syncSelectedJointsParams(current().id, 'joint-0');
  assert.deepEqual(current().panels![1], fixed);
  assert.deepEqual(current().joints!.map(j => j.gapOwnerSide), owners);
  close(Math.min(...current().panels![2].points.map(p => p.x)), 2456.5);
  for (const p of current().panels!) {
    assert.ok(getResolvedPanelEdges(current(), p).some(e => e.joint && e.config!.width === 15));
  }
});

test('splitting the master preserves its side and keeps incident cuts attached during later gap changes', () => {
  load(ownerFixture());
  const store = useProjectStore.getState();
  store.setPanelEdgeWidth(current().id, 'left', 'right', 15);
  load(cutPanelOnWall(current(), [sheet], 'left', { x: 0, y: 400 }, { x: 485, y: 400 })!);
  const fixed = structuredClone(current().panels!.find(p => p.id === 'right')!.points);
  for (const gap of [30, 0, 15]) {
    store.setPanelEdgeWidth(current().id, 'right', 'left', gap);
    assert.deepEqual(current().panels!.find(p => p.id === 'right')!.points, fixed);
    for (const p of current().panels!.filter(p => p.id !== 'right')) close(Math.max(...p.points.map(p => p.x)), 500 - gap);
    const incident = current().joints!.find(j => j.id !== 'shared')!;
    close(Math.max(incident.p1.x, incident.p2.x), 500 - gap);
  }
});

for (const direction of ['HORIZONTAL', 'DIAGONAL'] as const) {
  test(`${direction} joint keeps its master when edited from the opposite panel`, () => {
    const wall = wallWithPanel(1000, 1000);
    const y = direction === 'HORIZONTAL' ? 500 : 0;
    load(cutPanelOnWall(wall, [sheet], 'panel-1', { x: 0, y }, { x: 1000, y: direction === 'HORIZONTAL' ? 500 : 1000 })!);
    const store = useProjectStore.getState(), fixedPoints = structuredClone(current().panels![1].points);
    const setGap = (index: number, gap: number) => {
      const p = current().panels![index];
      const edge = getResolvedPanelEdges(current(), p).find(e => e.joint)!;
      store.setPanelEdgeWidth(wall.id, p.id, edge.key, gap);
    };
    setGap(0, 15);
    const after15 = Geometry.calculatePolygonArea(current().panels![0].points);
    setGap(1, 30);
    assert.ok(Geometry.calculatePolygonArea(current().panels![0].points) < after15);
    assert.deepEqual(current().panels![1].points, fixedPoints);
    setGap(1, 0);
    assert.deepEqual(current().panels![1].points, fixedPoints);
    close(Geometry.calculatePolygonArea(current().panels![0].points), 500000);
  });
}

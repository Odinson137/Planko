import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { useProjectStore } from '../src/application/stores/useProjectStore';
import { getResolvedPanelEdges, getJointGapOwners } from '../src/core/geometry/PanelJointBinding';
import { cutPanelOnWall, panelBounds } from '../src/core/geometry/PanelCutEngine';
import { createDefaultProject } from '../src/core/models/Project';
import { MATERIAL_NONE_ID } from '../src/core/models/Material';
import { LayoutEngine } from '../src/core/layout/LayoutEngine';
import { panel, sheet, wallWithPanel, close } from './helpers/business';

const original = useProjectStore.getState();
afterEach(() => useProjectStore.setState(original));
const otherMaterial = { ...sheet, id: 'other-sheet', name: 'Другой материал', color: '#ccb788' };
const current = () => useProjectStore.getState().project.walls[0];
const load = (wall: ReturnType<typeof wallWithPanel>) => useProjectStore.setState({ ...original,
  project: { ...createDefaultProject(), walls: [wall], materials: [sheet, otherMaterial], selectedWallId: wall.id } });
function missingJoint() {
  const wall = wallWithPanel(1000, 800);
  wall.panels = [panel('left', 0, 0, 500, 800), { ...panel('right', 500, 0, 500, 800), materialId: otherMaterial.id, partLabel: '1.2' }];
  wall.joints = [];
  return wall;
}
const shared = (index: number) => getResolvedPanelEdges(current(), current().panels![index]).find(e => e.joint)!;

test('touching panels of different materials expose the same missing joint without mutating the project', () => {
  const wall = missingJoint();
  wall.panels![0].edges = { right: { width: 0, profileArticle: 'EC-02', profileColor: '#123456' } };
  load(wall);
  const before = structuredClone(current());
  assert.equal(shared(0).joint!.id, shared(1).joint!.id);
  assert.equal(shared(0).config!.profileArticle, 'EC-02');
  assert.deepEqual(shared(0).config, shared(1).config);
  assert.deepEqual(current(), before);
});

test('recovered joint shares profile, gap and owner after editing either material and after save/load', () => {
  load(missingJoint());
  const store = useProjectStore.getState();
  store.setPanelEdgeProfile(current().id, 'right', 'left', 'EC-02', '#123456');
  assert.equal(current().joints!.length, 1);
  assert.equal(shared(0).config!.profileArticle, 'EC-02');
  assert.equal(shared(1).config!.profileArticle, 'EC-02');
  store.setPanelEdgeWidth(current().id, 'left', 'right', 15);
  store.setPanelEdgeWidth(current().id, 'right', 'left', 30);
  close(panelBounds(current().panels![0].points).width, 470);
  close(panelBounds(current().panels![1].points).width, 500);
  store.selectPanel('left', 0, 0);
  store.setCellMaterial(current().id, 0, 0, otherMaterial.id);
  store.setProject(JSON.parse(JSON.stringify(useProjectStore.getState().project)));
  assert.equal(shared(0).joint!.id, shared(1).joint!.id);
  store.switchJointGapOwner(current().id, current().joints![0].id);
  close(panelBounds(current().panels![0].points).width, 500);
  close(panelBounds(current().panels![1].points).width, 470);
  assert.equal(shared(0).config!.width, 30);
  assert.equal(shared(1).config!.width, 30);
  assert.equal(shared(1).config!.profileArticle, 'EC-02');
});

for (const direction of ['HORIZONTAL', 'VERTICAL'] as const) {
  test(`${direction} quick split stores the zero-width joint before any profile is selected`, () => {
    load(wallWithPanel(1000, 800));
    const store = useProjectStore.getState();
    store.selectPanel('panel-1', 0, 0);
    if (direction === 'HORIZONTAL') store.splitPanelHorizontally(current().id, 0, 0, 400);
    else store.splitColumnVertically(current().id, 0, 500);
    assert.equal(current().panels!.length, 2);
    assert.equal(current().joints!.length, 1);
    assert.equal(current().joints![0].width, 0);
    assert.equal(shared(0).joint!.id, current().joints![0].id);
    assert.equal(shared(1).joint!.id, current().joints![0].id);
    const first = current().panels![0], edge = shared(0);
    store.setPanelEdgeWidth(current().id, first.id, edge.key, 15);
    assert.equal(shared(1).config!.width, 15);
  });
}

test('legacy edge inset becomes a shared physical gap without doubling it or losing its profile', () => {
  const wall = missingJoint();
  wall.panels![0].edges = { right: { width: 15, profileArticle: 'EC-02', profileColor: '#123456' },
    top: { width: 2, profileArticle: 'EC-08' } };
  load(wall);
  assert.equal(shared(0).config!.width, 15);
  assert.equal(shared(1).config!.width, 15);
  const store = useProjectStore.getState();
  store.setPanelEdgeWidth(wall.id, 'right', 'left', 30);
  close(panelBounds(current().panels![0].points).width, 470);
  close(panelBounds(current().panels![1].points).width, 500);
  assert.equal(current().panels![0].edges?.right, undefined);
  assert.deepEqual(current().panels![0].edges?.top, wall.panels![0].edges.top);
  assert.equal(shared(0).config!.profileArticle, 'EC-02');
  const layout = LayoutEngine.calculateWallLayout(current(), sheet, [sheet, otherMaterial]);
  assert.equal(layout.joints.filter(j => j.profileArticle === 'EC-02').length, 1);
  close(layout.panels.find(p => p.id === 'left')!.width, 470);
});

test('refresh can directly recover and transfer a legacy inset and undo restores the original project', () => {
  const wall = missingJoint();
  wall.panels![0].edges = { right: { width: 15, profileArticle: 'EC-02' } };
  load(wall);
  const before = structuredClone(current()), store = useProjectStore.getState();
  store.switchJointGapOwner(wall.id, shared(0).joint!.id);
  close(panelBounds(current().panels![0].points).width, 500);
  close(panelBounds(current().panels![1].points).width, 485);
  assert.equal(current().joints![0].profileArticle, 'EC-02');
  assert.equal(current().customJoints[current().joints![0].id].width, 15);
  assert.ok(store.undo()); assert.deepEqual(current(), before);
});

test('two old per-edge insets are consolidated into their actual total gap once', () => {
  const wall = missingJoint();
  wall.panels![0].edges = { right: { width: 15, profileArticle: 'MC-06' } };
  wall.panels![1].edges = { left: { width: 30, profileArticle: 'MC-06' } };
  load(wall);
  assert.equal(shared(0).config!.width, 45);
  assert.equal(shared(1).config!.width, 45);
  useProjectStore.getState().setPanelEdgeWidth(wall.id, 'left', 'right', 50);
  close(panelBounds(current().panels![0].points).width, 480);
  close(panelBounds(current().panels![1].points).x, 530);
  assert.equal(shared(0).config!.width, 50);
  assert.equal(shared(1).config!.width, 50);
});

test('a missing seam across a T junction has one identity from all incident panels', () => {
  const wall = missingJoint();
  wall.panels = [wall.panels![0], panel('lower', 500, 0, 500, 400), panel('upper', 500, 400, 500, 400)];
  load(wall);
  const edges = current().panels!.map(p => getResolvedPanelEdges(current(), p).find(e => e.side === (p.id === 'left' ? 'right' : 'left'))!);
  assert.ok(edges.every(e => e.joint?.id === edges[0].joint?.id));
  const store = useProjectStore.getState();
  store.setPanelEdgeWidth(wall.id, 'lower', 'left', 15);
  assert.equal(getJointGapOwners(current().panels!, current().joints![0]).length, 2);
  close(panelBounds(current().panels![0].points).width, 500);
  for (const p of current().panels!.slice(1)) close(panelBounds(p.points).width, 485);
});

test('missing diagonal contact binds both panels and supports fractional editing', () => {
  const wall = cutPanelOnWall(wallWithPanel(1000, 1000), [sheet], 'panel-1', { x: 0, y: 0 }, { x: 1000, y: 1000 })!;
  wall.joints = [];
  wall.panels![1].materialId = otherMaterial.id;
  load(wall);
  const edge = shared(0);
  assert.equal(edge.joint!.id, shared(1).joint!.id);
  useProjectStore.getState().setPanelEdgeWidth(wall.id, wall.panels![0].id, edge.key, 0.8);
  assert.equal(shared(0).config!.width, 0.8);
  assert.equal(shared(1).config!.width, 0.8);
});

for (const kind of ['empty-space', 'corner-only', 'same-side', 'void'] as const) {
  test(`recovery never binds ${kind} as a neighboring panel`, () => {
    const wall = missingJoint();
    if (kind === 'empty-space') wall.panels![1] = panel('right', 501, 0, 499, 800);
    if (kind === 'corner-only') wall.panels![1] = panel('right', 500, 800, 500, 100);
    if (kind === 'same-side') wall.panels![1] = panel('right', 300, 0, 200, 800);
    if (kind === 'void') wall.panels![1] = { ...wall.panels![1], materialId: MATERIAL_NONE_ID, isVoid: true };
    load(wall);
    assert.equal(getResolvedPanelEdges(current(), current().panels![0]).find(e => e.side === 'right')!.joint, undefined);
    assert.equal(getResolvedPanelEdges(current(), current().panels![0]).find(e => e.side === 'left')!.joint, undefined);
  });
}

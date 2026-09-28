import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { useProjectStore } from '../src/application/stores/useProjectStore';
import { createDefaultProject } from '../src/core/models/Project';
import { isGapConfigured } from '../src/core/models/Wall';
import { getJointGapOwners, getResolvedPanelEdges } from '../src/core/geometry/PanelJointBinding';
import { LayoutEngine } from '../src/core/layout/LayoutEngine';
import { panel, sheet, wallWithPanel, close } from './helpers/business';

const original = useProjectStore.getState();
afterEach(() => useProjectStore.setState(original));
const current = () => useProjectStore.getState().project.walls[0];
function load(savedJoint = true) {
  const wall = wallWithPanel(1000, 800);
  wall.panels = [panel('left', 0, 0, 500, 800), panel('right', 500, 0, 500, 800)];
  wall.joints = savedJoint ? [{ id: 'shared', p1: { x: 500, y: 0 }, p2: { x: 500, y: 800 }, width: 0, isLED: false }] : [];
  useProjectStore.setState({ ...original, project: { ...createDefaultProject(), walls: [wall], materials: [sheet] } });
  return useProjectStore.getState();
}
const edge = (index: number, key: string) => getResolvedPanelEdges(current(), current().panels![index]).find(e => e.key === key)!;
const reload = () => useProjectStore.getState().setProject(JSON.parse(JSON.stringify(useProjectStore.getState().project)));

for (const savedJoint of [true, false]) {
  test(`${savedJoint ? 'saved' : 'recovered'} joint: profile alone leaves gap unset; explicit zero claims its owner`, () => {
    const store = load(savedJoint), before = structuredClone(current().panels);
    assert.equal(isGapConfigured(edge(0, 'right').config), false);
    store.setPanelEdgeProfile(current().id, 'left', 'right', 'EC-02');
    reload();
    assert.equal(isGapConfigured(edge(0, 'right').config), false);
    assert.equal(isGapConfigured(edge(1, 'left').config), false);
    assert.equal(current().joints![0].gapOwnerSide, undefined);
    store.setPanelEdgeWidth(current().id, 'left', 'right', 0);
    assert.deepEqual(current().panels!.map(p => p.points), before!.map(p => p.points));
    assert.equal(isGapConfigured(edge(0, 'right').config), true);
    assert.equal(isGapConfigured(edge(1, 'left').config), true);
    assert.equal(getJointGapOwners(current().panels!, current().joints![0])[0].panel.id, 'left');
    store.setPanelEdgeProfile(current().id, 'right', 'left', 'MC-06');
    reload();
    assert.equal(edge(0, 'right').config!.width, 0);
    assert.equal(isGapConfigured(edge(0, 'right').config), true);
    assert.equal(edge(0, 'right').config!.profileArticle, 'MC-06');
    store.setPanelEdgeWidth(current().id, 'right', 'left', 30);
    close(Math.max(...current().panels![0].points.map(p => p.x)), 470);
    close(Math.min(...current().panels![1].points.map(p => p.x)), 500);
  });
}

test('undo explicit zero returns to an unset gap; redo and owner switch retain zero', () => {
  const store = load();
  store.setPanelEdgeProfile(current().id, 'left', 'right', 'MC-06');
  store.setPanelEdgeWidth(current().id, 'left', 'right', 0);
  assert.ok(store.undo());
  assert.equal(isGapConfigured(edge(0, 'right').config), false);
  assert.equal(current().joints![0].gapOwnerSide, undefined);
  assert.ok(store.redo());
  store.switchJointGapOwner(current().id, 'shared');
  reload();
  assert.equal(isGapConfigured(edge(0, 'right').config), true);
  store.setPanelEdgeWidth(current().id, 'left', 'right', 15);
  close(Math.max(...current().panels![0].points.map(p => p.x)), 500);
  close(Math.min(...current().panels![1].points.map(p => p.x)), 515);
});

test('outer edge distinguishes profile-only zero from explicit zero after save/load', () => {
  const store = load();
  store.setPanelEdgeProfile(current().id, 'left', 'left', 'EC-02');
  reload();
  assert.equal(isGapConfigured(edge(0, 'left').config), false);
  store.setPanelEdgeWidth(current().id, 'left', 'left', 0);
  store.setPanelEdgeProfile(current().id, 'left', 'left', 'MC-06');
  reload();
  assert.equal(isGapConfigured(edge(0, 'left').config), true);
  assert.equal(edge(0, 'left').config!.width, 0);
  const layout = LayoutEngine.calculateWallLayout(current(), sheet, [sheet]);
  assert.equal(isGapConfigured(layout.joints.find(j => j.panelEdge?.panelId === 'left')), true);
});

test('direct and bulk zero settings survive profile changes and layout conversion', () => {
  const store = load();
  store.setJointProfile(current().id, 'shared', 'MC-06');
  assert.equal(isGapConfigured(edge(0, 'right').config), false);
  store.setJointWidth(current().id, 'shared', 0);
  store.setJointProfile(current().id, 'shared', 'EC-02');
  reload();
  assert.equal(isGapConfigured(edge(0, 'right').config), true);
  const layout = LayoutEngine.calculateWallLayout(current(), sheet, [sheet]);
  assert.equal(isGapConfigured(layout.joints.find(j => j.id === 'shared')), true);
  load();
  useProjectStore.setState({ selectedJointIds: ['shared'] });
  store.setJointWidthForSelected(current().id, 0);
  store.setJointProfileForSelected(current().id, 'EC-02');
  reload();
  assert.equal(isGapConfigured(edge(0, 'right').config), true);
});

test('existing positive gaps and old zero-gap owners remain configured without the new flag', () => {
  assert.equal(isGapConfigured({ width: 0 }), false);
  assert.equal(isGapConfigured({ width: 0.8 }), true);
  assert.equal(isGapConfigured({ width: 0, gapOwnerSide: -1 }), true);
});

test('a previously configured zero on a touching edge supplies the recovered owner', () => {
  const store = load(false);
  const wall = current();
  wall.panels![1].edges = { left: { width: 0, gapConfigured: true, profileArticle: 'MC-06' } };
  assert.equal(isGapConfigured(edge(0, 'right').config), true);
  store.setPanelEdgeWidth(wall.id, 'left', 'right', 15);
  assert.equal(getJointGapOwners(current().panels!, current().joints![0])[0].panel.id, 'right');
  close(Math.max(...current().panels![0].points.map(p => p.x)), 500);
  close(Math.min(...current().panels![1].points.map(p => p.x)), 515);
});

import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { useProjectStore } from '../src/application/stores/useProjectStore';
import { createDefaultProject } from '../src/core/models/Project';
import { createDefaultOpening } from '../src/core/models/Opening';
import { cutPanelOnWall } from '../src/core/geometry/PanelCutEngine';
import { getResolvedPanelEdges } from '../src/core/geometry/PanelJointBinding';
import { LayoutEngine } from '../src/core/layout/LayoutEngine';
import { ProfileSpecificationEngine } from '../src/core/layout/ProfileSpecificationEngine';
import { sheet, wallWithPanel } from './helpers/business';

const original = useProjectStore.getState();
beforeEach(() => {
  const wall = cutPanelOnWall(wallWithPanel(1000, 1000), [sheet], 'panel-1', { x: 500, y: 0 }, { x: 500, y: 1000 })!;
  useProjectStore.setState({ ...original, project: { ...createDefaultProject(), walls: [wall], materials: [sheet], selectedWallId: wall.id } });
});
afterEach(() => useProjectStore.setState(original));
const wall = () => useProjectStore.getState().project.walls[0];

for (const gap of [0, 0.8, 2.35]) {
  test(`assigning, replacing and removing a joint profile preserves the ${gap} mm gap and geometry`, () => {
    const store = useProjectStore.getState(), id = wall().joints![0].id;
    store.setJointWidth(wall().id, id, gap);
    const before = structuredClone(wall().panels);
    for (const article of ['MC-06-7', 'DL-13', '']) {
      store.setJointProfile(wall().id, id, article);
      assert.equal(wall().customJoints[id].width, gap);
      assert.equal(wall().joints![0].width, gap);
      assert.deepEqual(wall().panels, before);
      assert.equal(wall().joints![0].profileArticle, article);
    }
  });
}

test('zero-gap profile is visible at its catalog face width and included in the order', () => {
  const store = useProjectStore.getState(), id = wall().joints![0].id;
  store.setJointProfile(wall().id, id, 'MC-06-7');
  const joint = LayoutEngine.calculateWallLayout(wall(), sheet, [sheet]).joints.find(j => j.id === id)!;
  assert.equal(joint.width, 0); assert.equal(joint.visibleWidth, 7);
  const item = ProfileSpecificationEngine.calculateWallProfiles(wall(), sheet, [sheet]).items.find(i => i.article === 'MC-06-7')!;
  assert.equal(item.totalLengthMm, 1000);
});

test('changing a joint gap to zero preserves the selected profile, color and LED flag', () => {
  const store = useProjectStore.getState(), id = wall().joints![0].id;
  store.setJointProfile(wall().id, id, 'DL-13', '#123456');
  for (const gap of [10, 0.8, 0]) store.setJointWidth(wall().id, id, gap);
  for (const joint of [wall().joints![0], wall().customJoints[id]]) {
    assert.equal(joint.width, 0); assert.equal(joint.profileArticle, 'DL-13');
    assert.equal(joint.profileColor, '#123456'); assert.equal(joint.isLED, true);
  }
});

test('panel edge profile and gap can be edited independently, including zero', () => {
  const store = useProjectStore.getState(), panelId = wall().panels![0].id;
  const edge = () => getResolvedPanelEdges(wall(), wall().panels!.find(p => p.id === panelId)!).find(e => e.key === 'left')!.config!;
  store.setPanelEdgeProfile(wall().id, panelId, 'left', 'MC-06-7');
  assert.equal(edge().width, 0);
  for (const gap of [0.8, 0]) {
    store.setPanelEdgeWidth(wall().id, panelId, 'left', gap);
    assert.equal(edge().profileArticle, 'MC-06-7');
  }
  store.setPanelEdgeWidth(wall().id, panelId, 'left', 2.35);
  store.setPanelEdgeProfile(wall().id, panelId, 'left', '');
  assert.equal(edge().width, 2.35);
});

test('bulk profile assignment and removal preserve each selected gap and the unselected joint', () => {
  const store = useProjectStore.getState();
  const w = wall();
  w.joints = [0, 0.8, 3].map((width, i) => ({ id: `j-${i}`, p1: { x: 100 + i * 100, y: 0 }, p2: { x: 100 + i * 100, y: 1000 },
    orientation: 'VERTICAL' as const, isLED: false, width }));
  const before = structuredClone(w.panels!.map(p => p.points));
  store.selectJoint('j-0'); store.selectJoint('j-1', true);
  for (const article of ['MC-06-7', '']) {
    store.setJointProfileForSelected(w.id, article);
    assert.deepEqual(wall().joints!.map(j => j.width), [0, 0.8, 3]);
    assert.equal(wall().joints![2].profileArticle, undefined);
    assert.deepEqual(wall().panels!.map(p => p.points), before);
  }
  store.setJointProfileForSelected(w.id, 'MC-06');
  store.setJointWidthForSelected(w.id, 0);
  assert.ok(wall().joints!.slice(0, 2).every(j => j.width === 0 && j.profileArticle === 'MC-06'));
});

test('linked joint profile changes preserve different gaps and diagonal orientation', () => {
  const store = useProjectStore.getState(), w = wall();
  w.joints = [0, 0.8].map((width, i) => ({ id: `diag-${i}`, p1: { x: 0, y: i * 100 }, p2: { x: 900, y: 900 + i * 100 },
    orientation: 'DIAGONAL' as const, isLED: false, width, groupId: 'linked' }));
  store.setJointProfile(w.id, 'diag-0', 'MC-06-7');
  assert.deepEqual(wall().joints!.map(j => j.width), [0, 0.8]);
  assert.ok(wall().joints!.every(j => j.profileArticle === 'MC-06-7'));
  assert.ok(Object.values(wall().customJoints).every(j => j.orientation === 'DIAGONAL'));
});

test('opening framing retains its profile at zero gap and counts it in the order', () => {
  const store = useProjectStore.getState(), w = wall();
  const op = { ...createDefaultOpening('WINDOW', 1000, 1000), x: 200, y: 200, width: 300, height: 300 };
  w.openings = [op];
  store.setOpeningFramingSide(w.id, op.id, 'top', { width: 0, profileArticle: 'MC-06-7' });
  store.setOpeningFramingSide(w.id, op.id, 'top', { width: 0.8 });
  store.setOpeningFramingSide(w.id, op.id, 'top', { width: 0 });
  assert.equal(wall().openings[0].framing!.top!.profileArticle, 'MC-06-7');
  assert.equal(wall().joints!.find(j => j.id === `joint-op-${op.id}-top`)!.width, 0);
  const item = ProfileSpecificationEngine.calculateWallProfiles(wall(), sheet, [sheet]).items.find(i => i.article === 'MC-06-7')!;
  assert.equal(item.totalLengthMm, 300);
});

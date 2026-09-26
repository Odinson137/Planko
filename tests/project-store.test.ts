import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { useProjectStore } from '../src/application/stores/useProjectStore';
import { createDefaultProject } from '../src/core/models/Project';
import { LayoutEngine } from '../src/core/layout/LayoutEngine';
import { PolygonSlicingEngine } from '../src/core/geometry/PolygonSlicingEngine';
import { localCatalogRepository } from '../src/infrastructure/repositories/LocalCatalogRepository';
import { sheet, wallWithPanel, rectangle, close } from './helpers/business';

const original = useProjectStore.getState();
beforeEach(() => {
  const wall = wallWithPanel();
  useProjectStore.setState({ ...original, isDirty: false,
    project: { ...createDefaultProject(), walls: [wall], materials: [sheet], selectedWallId: wall.id } });
});
afterEach(() => useProjectStore.setState(original));
const currentWall = () => useProjectStore.getState().project.walls[0];

test('new project dimensions initialize the whole surface, including walls larger than the default', () => {
  const project = createDefaultProject('Large wall', 5000, 3200);
  assert.deepEqual(project.walls[0].panels![0].points, rectangle(0, 0, 5000, 3200));
});

test('resizing an intact wall updates its polygon and marks the project dirty', () => {
  useProjectStore.getState().updateWallDimensions(currentWall().id, 3200, 2700);
  assert.deepEqual(currentWall().panels![0].points, rectangle(0, 0, 3200, 2700));
  assert.equal(useProjectStore.getState().isDirty, true);
});

test('draft opening can be moved and removed without altering the source panels', () => {
  const wallId = currentWall().id;
  const before = structuredClone(currentWall().panels);
  useProjectStore.getState().addOpening(wallId, 'WINDOW');
  const id = currentWall().openings[0].id;
  useProjectStore.getState().updateOpening(wallId, { id, x: 100, y: 500, width: 800, height: 900 });
  assert.equal(LayoutEngine.calculateWallLayout(currentWall(), sheet, [sheet]).summary.coveredAreaSqM, 4.28);
  assert.deepEqual(currentWall().panels, before);
  useProjectStore.getState().removeOpening(wallId, id);
  assert.deepEqual(currentWall().panels, before);
  assert.equal(LayoutEngine.calculateWallLayout(currentWall(), sheet, [sheet]).summary.coveredAreaSqM, 5);
  assert.equal(useProjectStore.getState().project.selectedOpeningId, null);
});

test('doors and portals are added and edited as separate objects', () => {
  const store = useProjectStore.getState();
  const wallId = currentWall().id;
  store.addOpening(wallId, 'DOOR');
  const door = structuredClone(currentWall().openings[0]);
  store.addOpening(wallId, 'PORTAL');
  const portal = currentWall().openings[1];
  assert.notEqual(portal.id, door.id);
  assert.equal(portal.type, 'PORTAL');
  assert.equal(portal.name, 'Портал');
  assert.equal(useProjectStore.getState().project.selectedOpeningId, portal.id);
  store.updateOpening(wallId, { id: portal.id, width: 1200, depth: 250 });
  store.setOpeningFramingPreset(wallId, portal.id, 'LED_10');
  const updatedPortal = currentWall().openings[1];
  assert.equal(updatedPortal.width, 1200);
  assert.equal(updatedPortal.depth, 250);
  assert.equal(updatedPortal.framing!.top!.isLED, true);
  assert.equal(updatedPortal.framing!.bottom!.isLED, false);
  assert.equal(updatedPortal.framing!.bottom!.width, 0);
  assert.deepEqual(currentWall().openings[0], door);
});

for (const type of ['DOOR', 'PORTAL'] as const) {
  test(`applying a ${type} twice does not subtract the opening twice`, () => {
    const wallId = currentWall().id;
    useProjectStore.getState().addOpening(wallId, type);
    const id = currentWall().openings[0].id;
    useProjectStore.getState().applyOpening(wallId, id);
    const once = structuredClone(currentWall());
    close(once.panels!.reduce((sum, p) => sum + PolygonSlicingEngine.calculatePolygonArea(p.points), 0), 3110000);
    useProjectStore.getState().applyOpening(wallId, id);
    assert.deepEqual(currentWall(), once);
  });
}

for (const applied of [false, true]) {
  test(`switching a ${applied ? 'built-in' : 'draft'} door to a portal preserves its cutout and cladding`, () => {
    const store = useProjectStore.getState();
    const wallId = currentWall().id;
    store.addOpening(wallId, 'DOOR');
    const id = currentWall().openings[0].id;
    store.updateOpening(wallId, { id, x: 300, width: 1100, height: 2200, depth: 240 });
    store.setOpeningFramingSide(wallId, id, 'top', { width: 3, profileArticle: 'MC-06' });
    if (applied) store.applyOpening(wallId, id);
    const before = structuredClone(currentWall());
    const layoutBefore = LayoutEngine.calculateWallLayout(before, sheet, [sheet]);
    useProjectStore.setState({ isDirty: false });

    store.updateOpening(wallId, { id, isPortal: true });
    assert.equal(useProjectStore.getState().isDirty, true);
    assert.deepEqual(currentWall().openings[0], { ...before.openings[0], isPortal: true, name: 'Портал' });
    assert.deepEqual(currentWall().panels, before.panels);
    assert.deepEqual(currentWall().joints, before.joints);
    const layout = LayoutEngine.calculateWallLayout(currentWall(), sheet, [sheet]);
    assert.deepEqual(layout.summary, layoutBefore.summary);
    assert.deepEqual(layout.panels, layoutBefore.panels);
    assert.deepEqual(layout.slopes!.map(s => [s.side, s.width, s.depth, s.materialId]),
      layoutBefore.slopes!.map(s => [s.side, s.width, s.depth, s.materialId]));
    assert.deepEqual(layout.slopes!.map(s => s.side).sort(), ['LEFT', 'RIGHT', 'TOP']);

    store.updateOpening(wallId, { id, isPortal: false });
    assert.deepEqual(currentWall().openings[0], { ...before.openings[0], isPortal: false });
    assert.deepEqual(currentWall().panels, before.panels);
  });
}

test('portal conversion keeps a custom name and turns a decorative door into a cutout', () => {
  const store = useProjectStore.getState();
  const wallId = currentWall().id;
  store.addOpening(wallId, 'DOOR');
  const id = currentWall().openings[0].id;
  store.updateOpening(wallId, { id, name: 'Проход в гостиную', isCutout: false });
  store.updateOpening(wallId, { id, isPortal: true });
  assert.equal(currentWall().openings[0].isCutout, true);
  assert.equal(currentWall().openings[0].name, 'Проход в гостиную');
  assert.equal(LayoutEngine.calculateWallLayout(currentWall(), sheet, [sheet]).summary.cutoutsAreaSqM, 1.89);
  store.updateOpening(wallId, { id, isPortal: false });
  assert.equal(currentWall().openings[0].name, 'Проход в гостиную');
});

test('custom 1200 × 600 material controls subsequent sheet slicing', t => {
  t.mock.method(localCatalogRepository, 'savePanel', () => undefined);
  const wallId = currentWall().id;
  const custom = { ...sheet, id: 'custom-1200-600', width: 1200, height: 600 };
  useProjectStore.getState().addCustomCatalogPanel(custom);
  useProjectStore.getState().setWallMaterial(wallId, custom.id);
  useProjectStore.getState().slicePanelToSheetFormat(wallId, 'panel-1', 0, 0);
  const layout = LayoutEngine.calculateWallLayout(currentWall(), custom, [custom]);
  assert.ok(layout.panels.length > 1);
  assert.ok(layout.panels.every(p => p.width <= 1200 && p.height <= 600 && p.materialId === custom.id));
});

test('joint validation rejects mixed widths and non-collinear tracks without mutating the project', () => {
  const wall = currentWall();
  // Outer-edge tracks keep this validation fixture independent of panel seam hiding.
  wall.joints = [
    { id: 'a', p1: { x: 0, y: 0 }, p2: { x: 800, y: 0 }, width: 3, isLED: false, isOuterEdge: true },
    { id: 'b', p1: { x: 800, y: 100 }, p2: { x: 1600, y: 100 }, width: 7, isLED: false, isOuterEdge: true },
  ];
  useProjectStore.setState({ selectedJointIds: ['a', 'b'] });
  const before = structuredClone(useProjectStore.getState().project);
  const validation = useProjectStore.getState().validateSelectedJoints(wall.id);
  assert.equal(validation.canMerge, false);
  assert.equal(validation.sameWidth, false);
  assert.equal(validation.isCollinear, false);
  assert.equal(useProjectStore.getState().mergeSelectedJoints(wall.id).success, false);
  assert.deepEqual(useProjectStore.getState().project, before);
});

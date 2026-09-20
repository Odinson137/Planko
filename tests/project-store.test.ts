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

test('applying a door twice does not subtract the opening twice', () => {
  const wallId = currentWall().id;
  useProjectStore.getState().addOpening(wallId, 'DOOR');
  const id = currentWall().openings[0].id;
  useProjectStore.getState().applyOpening(wallId, id);
  const once = structuredClone(currentWall());
  close(once.panels!.reduce((sum, p) => sum + PolygonSlicingEngine.calculatePolygonArea(p.points), 0), 3110000);
  useProjectStore.getState().applyOpening(wallId, id);
  assert.deepEqual(currentWall(), once);
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

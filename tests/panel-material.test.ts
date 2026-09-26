import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { useProjectStore } from '../src/application/stores/useProjectStore';
import { LayoutEngine } from '../src/core/layout/LayoutEngine';
import { MATERIAL_NONE, MATERIAL_NONE_ID } from '../src/core/models/Material';
import { createDefaultProject } from '../src/core/models/Project';
import { panel, sheet, wallWithPanel } from './helpers/business';

const original = useProjectStore.getState();
const materials = [sheet, MATERIAL_NONE];
const currentWall = () => useProjectStore.getState().project.walls[0];
const layout = () => LayoutEngine.calculateWallLayout(currentWall(), sheet, materials);

beforeEach(() => {
  const wall = wallWithPanel();
  useProjectStore.setState({ ...original, isDirty: false,
    project: { ...createDefaultProject(), walls: [wall], materials, selectedWallId: wall.id } });
});
afterEach(() => useProjectStore.setState(original));

test('clearing a selected panel removes its material from the layout and allows reassignment', () => {
  const wall = currentWall();
  wall.panels = [panel('left', 0, 0, 1000, 2500), panel('right', 1000, 0, 1000, 2500)];
  wall.panels[1].note = 'Keep this note';
  wall.joints = [{ id: 'seam', p1: { x: 1000, y: 0 }, p2: { x: 1000, y: 2500 }, width: 0, isLED: false }];
  const before = structuredClone(wall);
  const selected = layout().panels.find(p => p.id === 'right')!;
  const store = useProjectStore.getState();
  store.selectPanel(selected.id, selected.originalColumnIndex, selected.originalSegmentIndex, selected.subPieceId);
  store.clearCellMaterial(wall.id, selected.originalColumnIndex, selected.originalSegmentIndex);

  const cleared = currentWall().panels![1];
  assert.equal(cleared.materialId, MATERIAL_NONE_ID);
  assert.equal(cleared.isVoid, true);
  assert.equal(cleared.partLabel, 'ПУСТО');
  assert.equal(cleared.note, before.panels![1].note);
  assert.deepEqual(cleared.points, before.panels![1].points);
  assert.deepEqual(currentWall().panels![0], before.panels![0]);
  assert.deepEqual(currentWall().joints, before.joints);
  assert.equal(currentWall().zone.materialId, sheet.id);
  assert.equal(useProjectStore.getState().isDirty, true);
  assert.equal(layout().panels.find(p => p.id === selected.id)!.isVoid, true);
  assert.equal(layout().summary.coveredAreaSqM, 2.5);
  assert.equal(layout().summary.totalPanelsNeeded, 1);

  store.setCellProperties(wall.id, selected.originalColumnIndex, selected.originalSegmentIndex, { materialId: sheet.id });
  assert.equal(currentWall().panels![1].materialId, sheet.id);
  assert.equal(Boolean(currentWall().panels![1].isVoid), false);
  assert.deepEqual(currentWall().panels![1].points, before.panels![1].points);
  assert.equal(layout().summary.coveredAreaSqM, 5);
  assert.equal(layout().summary.totalPanelsNeeded, 2);
});

test('clearing an intact wall panel makes the entire surface empty', () => {
  const wall = currentWall();
  const before = structuredClone(wall.panels![0].points);
  const store = useProjectStore.getState();
  store.selectPanel(wall.panels![0].id, 0, 0);
  store.clearCellMaterial(wall.id, 0, 0);
  assert.equal(currentWall().panels![0].materialId, MATERIAL_NONE_ID);
  assert.deepEqual(currentWall().panels![0].points, before);
  assert.equal(layout().summary.coveredAreaSqM, 0);
  assert.equal(layout().summary.totalPanelsNeeded, 0);
});

test('clearing a legacy cut piece preserves the other pieces and their geometry', () => {
  const wall = currentWall();
  wall.panels = undefined;
  wall.customPanels = { 0: { columnIndex: 0, customWidth: wall.width, segments: [{
    id: 'segment', height: wall.height, customMaterialId: sheet.id,
    subPieces: [panel('left', 0, 0, 1000, 2500), panel('right', 1000, 0, 1000, 2500)],
  }] } };
  const before = structuredClone(wall.customPanels[0].segments![0].subPieces!);
  const store = useProjectStore.getState();
  store.selectPanel(null, 0, 0, 'right');
  store.clearCellMaterial(wall.id, 0, 0);
  const pieces = currentWall().customPanels[0].segments![0].subPieces!;
  assert.deepEqual(pieces[0], before[0]);
  assert.deepEqual(pieces[1].points, before[1].points);
  assert.equal(pieces[1].materialId, MATERIAL_NONE_ID);
  assert.equal(pieces[1].isVoid, true);
});

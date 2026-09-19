import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renumberProjectWalls, renumberWallPanels } from '../src/core/layout/WallNumberingEngine';
import { createDefaultProject } from '../src/core/models/Project';
import { MATERIAL_NONE_ID } from '../src/core/models/Material';
import { panel, wallWithPanel } from './helpers/business';

test('production numbering follows geometry, excludes voids and does not mutate saved panels', () => {
  const wall = wallWithPanel(2000, 2000);
  wall.panels = [panel('right', 1000, 0, 1000, 2000), panel('bottom', 0, 0, 1000, 800),
    { ...panel('void', 0, 800, 1000, 200), materialId: MATERIAL_NONE_ID }, panel('top', 0, 1000, 1000, 1000)];
  const before = structuredClone(wall);
  const result = renumberWallPanels(wall, 3);
  assert.deepEqual(Object.fromEntries(result.panels!.map(p => [p.id, p.partLabel])),
    { right: '3.3', bottom: '3.2', void: 'ПУСТО', top: '3.1' });
  assert.deepEqual(wall, before);
  assert.deepEqual(renumberWallPanels(result, 3), result);
});

test('reordering walls changes label prefixes without changing panel IDs or geometry', () => {
  const project = { ...createDefaultProject(), walls: [wallWithPanel(1000, 1000, 'b'), wallWithPanel(1000, 1000, 'a')] };
  project.walls[0].panels![0].id = 'b-panel';
  project.walls[1].panels![0].id = 'a-panel';
  const result = renumberProjectWalls(project);
  assert.deepEqual(result.walls.map(w => [w.panels![0].id, w.panels![0].partLabel]), [['b-panel', '1.1'], ['a-panel', '2.1']]);
  assert.deepEqual(result.walls.map(w => w.panels![0].points), project.walls.map(w => w.panels![0].points));
});

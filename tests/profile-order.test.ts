import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ProfileSpecificationEngine } from '../src/core/layout/ProfileSpecificationEngine';
import { LayoutEngine } from '../src/core/layout/LayoutEngine';
import { panel, sheet, wallWithPanel } from './helpers/business';

function profileWall(id: string, lengths: number[]) {
  const wall = wallWithPanel(lengths.length * 500, 3000, id);
  wall.panels = lengths.map((height, i) => ({ ...panel(`${id}-${i}`, i * 500, 0, 400, height),
    edges: { left: { width: 3, profileArticle: 'MC-06' } } }));
  return wall;
}

test('three separate 1600 mm profile segments require three 3000 mm bars', () => {
  const wall = profileWall('one', [1600, 1600, 1600]);
  const report = ProfileSpecificationEngine.calculateWallProfiles(wall, sheet, [sheet]);
  assert.equal(report.items[0].totalLengthMm, 4800);
  assert.equal(report.items[0].segmentsCount, 3);
  assert.equal(report.totalStockBars, 3);
});

test('project profile order retains individual segment lengths across walls', () => {
  const walls = ['a', 'b', 'c'].map(id => profileWall(id, [1600]));
  assert.equal(ProfileSpecificationEngine.calculateProjectProfiles(walls, [sheet]).totalStockBars, 3);
});

test('matching profile offcuts can supply a shorter segment on another wall', () => {
  const walls = [profileWall('a', [1800]), profileWall('b', [1000])];
  assert.equal(ProfileSpecificationEngine.calculateProjectProfiles(walls, [sheet]).totalStockBars, 1);
});

test('a selected profile with zero mounting gap still appears in the order and meter total', () => {
  const wall = profileWall('zero-gap', [2000]);
  wall.panels![0].edges!.left!.width = 0;
  const layout = LayoutEngine.calculateWallLayout(wall, sheet, [sheet]);
  assert.equal(layout.summary.profileLinearMeters, 2);
  const report = ProfileSpecificationEngine.calculateWallProfiles(wall, sheet, [sheet]);
  assert.equal(report.items.find(i => i.article === 'MC-06')?.totalLengthMm, 2000);
});

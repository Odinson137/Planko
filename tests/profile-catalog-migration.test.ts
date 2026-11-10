import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ALLWALL_PROFILES_CATALOG, findProfileByArticle, getProfilesByRole } from '../src/core/models/Profile';
import { createDefaultProject } from '../src/core/models/Project';
import { migrateProjectProfiles } from '../src/core/models/ProfileMigration';
import { createDefaultOpening } from '../src/core/models/Opening';
import { ProfileSpecificationEngine } from '../src/core/layout/ProfileSpecificationEngine';
import { useProjectStore } from '../src/application/stores/useProjectStore';
import { sheet, wallWithPanel, rectangle } from './helpers/business';

test('MC-04 replaces the former catalog choice with one three-meter end profile', () => {
  const catalog = ALLWALL_PROFILES_CATALOG;
  assert.equal(catalog.filter(p => p.article === 'MC-04').length, 1);
  assert.equal(catalog.some(p => p.article === 'MC-01'), false);
  assert.ok(getProfilesByRole('END').some(p => p.article === 'MC-04'));
  for (const article of ['MC-04', 'MC-01', ' mc-01 ', 'МС-01', 'МС-04']) {
    const profile = findProfileByArticle(article)!;
    assert.equal(profile.article, 'MC-04');
    assert.equal(profile.stockLength, 3000);
  }
});

test('old and current references share stock across walls, including a full three-meter cut', () => {
  const walls = ['MC-01', 'MC-04', 'МС-01'].map((article, i) => {
    const wall = wallWithPanel(500, i === 0 ? 3000 : 1500, `wall-${i}`);
    wall.panels![0].edges = { left: { width: 0, profileArticle: article } };
    return wall;
  });
  const report = ProfileSpecificationEngine.calculateProjectProfiles(walls, [sheet]);
  assert.equal(report.byCategorySummary.length, 1);
  const item = report.byCategorySummary[0];
  assert.equal(item.article, 'MC-04');
  assert.equal(item.stockLengthMm, 3000);
  assert.deepEqual(item.segmentLengthsMm, [3000, 1500, 1500]);
  assert.equal(item.stockBarsCount, 2);
});

function legacyProject() {
  const wall = wallWithPanel();
  const edge = { width: 0.8, profileArticle: 'MC-01', profileColor: '#c9a25b', isLED: false };
  wall.panels![0].edges = { left: { ...edge }, 2: { ...edge } };
  wall.joints = [{ ...edge, id: 'joint', p1: { x: 200, y: 0 }, p2: { x: 200, y: 2500 } }];
  wall.customJoints = { joint: { ...edge, id: 'joint', orientation: 'VERTICAL' } };
  wall.customPanels = { 0: { columnIndex: 0,
    subPieces: [{ id: 'sub', materialId: sheet.id, points: rectangle(0, 0, 500, 500), edges: { top: { ...edge } } }],
    segments: [{ id: 'segment', edges: { right: { ...edge } },
      subPieces: [{ id: 'nested', materialId: sheet.id, points: rectangle(0, 0, 500, 500), edges: { bottom: { ...edge } } }] }],
  } };
  const opening = createDefaultOpening('WINDOW', wall.width, wall.height);
  opening.framing!.top = { ...edge };
  opening.slopes!.joints = { 'top-left': { ...edge, takeSide: 'BOTH' } };
  wall.openings = [opening];
  return { ...createDefaultProject('MC-01 in a name stays unchanged'), walls: [wall], materials: [sheet] };
}

test('migration covers mesh, legacy, framing and slope configs without changing geometry or user settings', () => {
  const input = legacyProject();
  const before = structuredClone(input);
  const migrated = migrateProjectProfiles(input);
  // This fixture puts the old article at every supported profile config location.
  const expected = JSON.parse(JSON.stringify(input).replace(/"profileArticle":"MC-01"/g, '"profileArticle":"MC-04"'));
  assert.deepEqual(JSON.parse(JSON.stringify(migrated)), expected);
  assert.deepEqual(input, before);
  assert.equal(migrated.name, input.name);
  assert.equal(migrated.materials, input.materials);
  assert.equal(migrated.walls[0].panels![0].points, input.walls[0].panels![0].points);
  assert.equal(migrateProjectProfiles(migrated), migrated);
});

test('setting a project migrates profile controls and the exported project without creating an undo action', () => {
  const input = legacyProject();
  useProjectStore.getState().setProject(input);
  const state = useProjectStore.getState();
  assert.equal(state.project.walls[0].panels![0].edges!.left!.profileArticle, 'MC-04');
  assert.equal(state.project.walls[0].openings[0].framing!.top!.profileArticle, 'MC-04');
  assert.equal(state.isDirty, false);
  assert.equal(state.canUndo, false);
  assert.equal(input.walls[0].panels![0].edges!.left!.profileArticle, 'MC-01');
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LayoutEngine } from '../src/core/layout/LayoutEngine';
import { createDefaultOpening, ensureOpeningSlopes } from '../src/core/models/Opening';
import { MATERIAL_NONE } from '../src/core/models/Material';
import { ProfileSpecificationEngine } from '../src/core/layout/ProfileSpecificationEngine';
import { sheet, wallWithPanel, panel, close } from './helpers/business';

for (const legacy of [false, true]) {
  test(`${legacy ? 'legacy' : 'polygon'} layout measures net cladding around a floor-level door`, () => {
    const wall = wallWithPanel(1200, 2500);
    if (legacy) wall.panels = undefined;
    wall.openings = [{ ...createDefaultOpening('DOOR', 1200, 2500), x: 200, width: 800, height: 2000 }];
    const layout = LayoutEngine.calculateWallLayout(wall, sheet, [sheet]);
    assert.equal(layout.summary.wallAreaSqM, 3);
    assert.equal(layout.summary.coveredAreaSqM, 1.4);
    assert.equal(layout.summary.cutoutsAreaSqM, 1.6);
  });
}

test('TV overlay leaves cladding intact and adds neither slopes nor cutout area', () => {
  const wall = wallWithPanel();
  wall.openings = [createDefaultOpening('TV_ZONE', wall.width, wall.height)];
  const layout = LayoutEngine.calculateWallLayout(wall, sheet, [sheet]);
  assert.equal(layout.summary.coveredAreaSqM, 5);
  assert.equal(layout.summary.cutoutsAreaSqM, 0);
  assert.deepEqual(layout.slopes, []);
});

test('doors and portals have three slopes, windows have four; dimensions and stock orientation are preserved', () => {
  for (const type of ['DOOR', 'PORTAL', 'WINDOW'] as const) {
    const wall = wallWithPanel();
    const opening = createDefaultOpening(type, wall.width, wall.height);
    wall.openings = [opening];
    const layout = LayoutEngine.calculateWallLayout(wall, sheet, [sheet], 2);
    const slopes = layout.slopes!;
    assert.equal(slopes.length, type === 'WINDOW' ? 4 : 3);
    assert.equal(slopes.some(p => p.side === 'BOTTOM'), type === 'WINDOW');
    for (const p of slopes) {
      assert.equal(p.width, p.side === 'LEFT' || p.side === 'RIGHT' ? opening.height : opening.width);
      assert.equal(p.depth, opening.depth);
      assert.equal(p.textureStockWidth, 1220);
      assert.equal(p.textureStockHeight, 2800);
      close(p.areaSqM, p.width * p.depth / 1e6);
    }
    const labels = [...layout.panels.filter(p => !p.isVoid), ...slopes].map(p => p.partLabel);
    assert.equal(new Set(labels).size, labels.length);
    assert.ok(labels.every(label => label.startsWith('2.')));
  }
});

test('slope depth follows opening depth until independent depth is explicitly enabled', () => {
  const wall = wallWithPanel();
  const opening = createDefaultOpening('WINDOW', wall.width, wall.height);
  opening.depth = 310;
  opening.slopes!.depth = 999;
  wall.openings = [opening];
  assert.ok(LayoutEngine.calculateWallLayout(wall, sheet, [sheet]).slopes!.every(s => s.depth === 310));
  opening.slopes!.fitToOpeningDepth = false;
  opening.slopes!.depth = 420;
  assert.ok(LayoutEngine.calculateWallLayout(wall, sheet, [sheet]).slopes!.every(s => s.depth === 420));
});

test('custom slope sides use their own depth and material and skip disabled or zero-depth sides', () => {
  const other = { ...sheet, id: 'other', thickness: 8, width: 1200, height: 600 };
  const wall = wallWithPanel();
  const opening = createDefaultOpening('WINDOW', wall.width, wall.height);
  Object.assign(opening.slopes!, { fitToOpeningDepth: false, depthMode: 'CUSTOM', materialMode: 'CUSTOM' });
  opening.slopes!.top = { enabled: true, depth: 300, materialId: other.id };
  opening.slopes!.left = { enabled: true, depth: 250, materialId: null };
  opening.slopes!.right.enabled = false;
  opening.slopes!.bottom.depth = 0;
  wall.openings = [opening];
  const slopes = LayoutEngine.calculateWallLayout(wall, sheet, [sheet, other]).slopes!;
  assert.deepEqual(slopes.map(s => [s.side, s.depth, s.materialId]), [['TOP', 300, other.id], ['LEFT', 250, sheet.id]]);
  assert.equal(slopes[0].thickness, 8);
  assert.equal(slopes[0].textureStockHeight, 600);
});

test('legacy door slope normalization keeps three sides and the saved depth', () => {
  const opening = createDefaultOpening('DOOR', 2000, 2500);
  delete opening.slopes;
  opening.slopeDepth = 275;
  const slopes = ensureOpeningSlopes(opening);
  assert.equal(slopes.depth, 275);
  assert.equal(slopes.bottom.enabled, false);
  assert.ok(slopes.top.enabled && slopes.left.enabled && slopes.right.enabled);
});

test('disabled slope cladding contributes no parts, area or internal profiles', () => {
  const wall = wallWithPanel();
  const opening = createDefaultOpening('WINDOW', wall.width, wall.height);
  opening.slopes!.enabled = false;
  opening.slopes!.jointProfileType = 'CORNER';
  wall.openings = [opening];
  const layout = LayoutEngine.calculateWallLayout(wall, sheet, [sheet]);
  assert.deepEqual(layout.slopes, []);
  assert.equal(layout.summary.slopeAreaSqM, 0);
  assert.equal(layout.summary.slopeProfileLinearMeters, 0);
  assert.equal(ProfileSpecificationEngine.calculateWallProfiles(wall, sheet, [sheet]).totalStockBars, 0);
});

test('SAME slope depth produces the same internal-profile length in layout and specification', () => {
  const wall = wallWithPanel();
  const opening = createDefaultOpening('WINDOW', wall.width, wall.height);
  Object.assign(opening.slopes!, { fitToOpeningDepth: false, depthMode: 'SAME', depth: 400, jointProfileType: 'JOINT_3' });
  wall.openings = [opening];
  const layout = LayoutEngine.calculateWallLayout(wall, sheet, [sheet]);
  const report = ProfileSpecificationEngine.calculateWallProfiles(wall, sheet, [sheet]);
  assert.equal(layout.summary.slopeProfileLinearMeters, 1.6);
  assert.equal(report.items.find(i => i.article === 'MC-06')?.totalLengthMm, 1600);
});

for (const type of ['OUTER_CORNER', 'INNER_CORNER'] as const) {
  test(`${type} bend survives polygon layout and spans adjacent production parts`, () => {
    const wall = wallWithPanel(2000, 2500);
    wall.panels = [panel('left', 0, 0, 1000, 2500), panel('right', 1000, 0, 1000, 2500)];
    wall.bends = [{ id: 'bend', x: 800, radius: 300, angleDeg: 90, type }];
    const layout = LayoutEngine.calculateWallLayout(wall, sheet, [sheet]);
    const bends = layout.panels.map(p => p.bendsInfo?.[0]);
    assert.ok(bends[0]);
    assert.ok(bends[1]);
    assert.equal(bends[0].bendWidth, 200);
    assert.equal(bends[1].bendWidth, 271);
    assert.equal(bends[0].bendOffsetInSheet, 800);
    assert.equal(bends[1].bendOffsetInSheet, 0);
    assert.ok(bends.every(b => b?.type === type && b?.radius === 300));
  });
}

test('void regions contribute no cladding or stock count', () => {
  const wall = wallWithPanel(2000, 2500);
  wall.panels = [panel('solid', 0, 0, 1000, 2500),
    { ...panel('void', 1000, 0, 1000, 2500), materialId: MATERIAL_NONE.id, isVoid: true, partLabel: 'ПУСТО' }];
  const layout = LayoutEngine.calculateWallLayout(wall, sheet, [sheet, MATERIAL_NONE]);
  assert.equal(layout.summary.coveredAreaSqM, 2.5);
  assert.equal(layout.summary.voidAreaSqM, 2.5);
  assert.equal(layout.summary.totalPanelsNeeded, 1);
});

test('profile totals use the visible segments remaining after cutting an opening', () => {
  const wall = wallWithPanel(2000, 2500);
  wall.panels = [panel('left', 0, 0, 997, 2500), panel('right', 1003, 0, 997, 2500)];
  wall.joints = [{ id: 'joint', p1: { x: 1000, y: 0 }, p2: { x: 1000, y: 2500 }, width: 3, isLED: false, profileArticle: 'MC-06' }];
  const opening = createDefaultOpening('WINDOW', 2000, 2500);
  Object.assign(opening, { x: 800, y: 500, width: 400, height: 1000 });
  opening.slopes!.enabled = false;
  wall.openings = [opening];
  const layout = LayoutEngine.calculateWallLayout(wall, sheet, [sheet]);
  assert.equal(layout.joints.filter(j => j.profileArticle === 'MC-06').reduce((sum, j) => sum + j.length, 0), 1500);
  assert.equal(layout.summary.profileLinearMeters, 1.5);
});

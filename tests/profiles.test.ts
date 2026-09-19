import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findProfileByArticle, getProfileMountingGap } from '../src/core/models/Profile';
import { createDefaultWall, WallPanelPiece } from '../src/core/models/Wall';
import { DEFAULT_MATERIALS } from '../src/core/models/Material';
import { PolygonSlicingEngine } from '../src/core/geometry/PolygonSlicingEngine';
import { ProfileSpecificationEngine } from '../src/core/layout/ProfileSpecificationEngine';
import { useProjectStore } from '../src/application/stores/useProjectStore';
import { LayoutEngine } from '../src/core/layout/LayoutEngine';
import { createDefaultOpening } from '../src/core/models/Opening';
import { PdfExportService } from '../src/application/services/PdfExportService';
import { NestingEngine } from '../src/core/layout/NestingEngine';

const material = DEFAULT_MATERIALS.find((m) => !m.isVoid && m.type === 'SHEET')!;

test('PDF rejects oversized parts but allows rotated and exact-size parts', () => {
  for (const [width, height, invalid] of [[3450, 300, true], [2870, 310, true], [1300, 1300, true], [2800, 300, false], [1220, 2800, false]] as const) {
    const result = NestingEngine.optimizeProjectNesting([{
      id: 'slope', wallId: 'wall', wallName: 'Стена 1', partLabel: '1.36',
      materialId: material.id, width, height, note: 'Окно (Подоконник)',
    }]);
    const texts: string[] = [];
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (_, key) => key === 'fillText' ? (text: string) => texts.push(text)
        : key === 'measureText' ? (text: string) => ({ width: text.length * 7 }) : () => undefined,
      set: () => true,
    });
    (PdfExportService as any).drawNestingSheetsOnCanvas(ctx, result.allSheets.map((sheet) => ({ sheet, otherWallNames: [] })), [], 'wall', 0, 0, 600, 600);
    assert.equal(texts.includes('Нельзя разместить'), invalid, `${width} × ${height}`);
    if (invalid) {
      assert.ok(texts.includes('! Элемент 1.36'));
      assert.ok(texts.includes(`Деталь: ${width} × ${height} мм`));
      assert.ok(!texts.some((text) => text.includes('Исп:')));
    }
  }
});
function panel(width = 2500): WallPanelPiece {
  return { id: 'panel-test', points: [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: 2000 }, { x: 0, y: 2000 }], materialId: material.id, partLabel: '1.1' };
}
function wallWithProfile(id: string, article: string, width: number, color = '#212529') {
  const wall = createDefaultWall(id);
  wall.zone.materialId = material.id;
  wall.panels = [{ ...panel(), edges: { left: { width, profileArticle: article, profileColor: color, isLED: false } } }];
  wall.openings = [];
  return wall;
}

test('metal thickness and face width are separate for both connector families', () => {
  for (const [article, width] of [['MC-06', 3], ['MC-06-7', 7], ['DL-17', 3], ['DL-17-7', 7]] as const) {
    const profile = findProfileByArticle(article)!;
    assert.equal(profile.metalThickness, 0.8);
    assert.equal(profile.visibleWidth, width);
    assert.equal(getProfileMountingGap(profile), width);
    assert.equal(getProfileMountingGap({ ...profile, mountingGap: 0.8 }), 0.8);
  }
});

test('specification preserves 7 mm face width despite a 0.8 mm mounting gap', () => {
  const wall = wallWithProfile('wall-7', 'MC-06-7', 0.8);
  const report = ProfileSpecificationEngine.calculateWallProfiles(wall, material, DEFAULT_MATERIALS);
  const item = report.items.find((i) => i.article === 'MC-06-7')!;
  assert.ok(item);
  assert.equal(item.visibleWidth, 7);
  assert.equal(item.metalThickness, 0.8);
  assert.equal(item.totalLengthMm, 2000);
  const layout = LayoutEngine.calculateWallLayout(wall, material, DEFAULT_MATERIALS);
  const joint = layout.joints.find((j) => j.profileArticle === 'MC-06-7')!;
  assert.equal(joint.width, 0.8);
  assert.equal(joint.visibleWidth, 7);
  assert.equal(joint.metalThickness, 0.8);
  assert.equal(layout.panels[0].width, 2499.2);
});

test('project order separates variants and colors and combines matching products', () => {
  const walls = [wallWithProfile('a', 'MC-06', 3), wallWithProfile('b', 'MC-06-7', 7), wallWithProfile('c', 'MC-06', 3, '#c9a25b'), wallWithProfile('d', 'MC-06', 3)];
  const report = ProfileSpecificationEngine.calculateProjectProfiles(walls, DEFAULT_MATERIALS);
  assert.equal(report.byCategorySummary.length, 3);
  const black3 = report.byCategorySummary.find((i) => i.article === 'MC-06' && i.profileColor === '#212529')!;
  assert.equal(black3.totalLengthMm, 4000);
  assert.equal(black3.stockBarsCount, 2);
  assert.equal(report.totalStockBars, 4);
});

test('stock lengths are taken from the selected product', () => {
  const wall = wallWithProfile('stock', 'MC-01', 1.5);
  wall.panels![0].points[2].y = 2800;
  wall.panels![0].points[3].y = 2800;
  wall.height = 3000;
  const item = ProfileSpecificationEngine.calculateWallProfiles(wall, material, DEFAULT_MATERIALS).items.find((i) => i.article === 'MC-01')!;
  assert.equal(item.stockLengthMm, 2700);
  assert.equal(item.stockBarsCount, 2);
});

test('sheet slicing returns joints and subtracts the specified gap, not 8 mm', () => {
  for (const gap of [0.8, 3, 7]) {
    const result = PolygonSlicingEngine.slicePanelByMaxSheetDimensions(panel(), 1220, 2800, gap);
    assert.equal(result.newPanels.length, 3);
    assert.equal(result.joints.length, 2);
    assert.ok(result.joints.every((j) => j.width === gap));
    const area = result.newPanels.reduce((sum, p) => sum + PolygonSlicingEngine.calculatePolygonArea(p.points), 0);
    assert.ok(Math.abs(area - (2500 - 2 * gap) * 2000) < 1);
  }
});

test('editing mounting gap retains the selected variant in the store', () => {
  const wall = wallWithProfile('store', 'MC-06-7', 7);
  const state = useProjectStore.getState();
  useProjectStore.setState({ project: { ...state.project, walls: [wall] } });
  useProjectStore.getState().setPanelEdgeWidth(wall.id, 'panel-test', 'left', 0.8);
  const edge = useProjectStore.getState().project.walls[0].panels![0].edges!.left!;
  assert.equal(edge.width, 0.8);
  assert.equal(edge.profileArticle, 'MC-06-7');
});

test('opening framing and slope profiles retain their specific variants', () => {
  const wall = createDefaultWall('opening');
  wall.zone.materialId = material.id;
  const opening = createDefaultOpening('DOOR', wall.width, wall.height);
  opening.framing!.top = { width: 0.8, profileArticle: 'DL-17-7' };
  opening.slopes!.jointProfileType = 'JOINT_3';
  wall.openings = [opening];
  const items = ProfileSpecificationEngine.calculateWallProfiles(wall, material, DEFAULT_MATERIALS).items;
  const frame = items.find((i) => i.article === 'DL-17-7')!;
  assert.equal(frame.visibleWidth, 7);
  assert.equal(frame.totalLengthMm, opening.width);
  const slope = items.find((i) => i.article === 'MC-06')!;
  assert.equal(slope.metalThickness, 0.8);
  assert.equal(slope.totalLengthMm, 300);
});

test('PDF table prints actual face width and metal thickness in separate values', () => {
  const wall = wallWithProfile('pdf', 'MC-06-7', 0.8);
  const project = { ...useProjectStore.getState().project, walls: [wall] };
  const report = ProfileSpecificationEngine.calculateProjectProfiles([wall], DEFAULT_MATERIALS);
  const texts: string[] = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (_, key) => key === 'fillText' ? (text: string) => texts.push(text) : () => undefined,
    set: () => true,
  });
  (PdfExportService as any).renderInstallerCoverPage(ctx, 2970, 2100, project, {
    materialResults: [], totalSheetsCount: 0, totalPartsCount: 0, allSheets: [],
  }, report, 2, 4);
  assert.ok(texts.includes('7 мм / 0,8 мм'));
  assert.ok(texts.includes('Лист 2 / 4 (Сводный)'));
  assert.ok(texts.some((text) => text.includes('MC-06-7')));
});

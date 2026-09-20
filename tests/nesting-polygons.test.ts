import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NestingEngine, type NestingPartInput, type ProjectNestingResult } from '../src/core/layout/NestingEngine';
import { LayoutEngine } from '../src/core/layout/LayoutEngine';
import { createDefaultProject } from '../src/core/models/Project';
import { createDefaultWall, type WallPanelPiece } from '../src/core/models/Wall';
import { DEFAULT_MATERIALS } from '../src/core/models/Material';
import { PdfExportService } from '../src/application/services/PdfExportService';
import { rectangle, close } from './helpers/business';

// Geometry and inherited source crop from the saved project "авпвап".
const diagonalY = 914.504548045168;
const source = { offsetX: 0, offsetY: 0, angleDeg: 180,
  anchor: { x: 1221.5, y: 0, width: 1220, height: 2750 } };
const contours = [
  [{ x: 1221.5, y: 0 }, { x: 2441.5, y: 0 }, { x: 2441.5, y: diagonalY }],
  [{ x: 2441.5, y: diagonalY }, { x: 1221.5, y: 1375 }, { x: 1221.5, y: 0 }],
  [{ x: 2441.5, y: diagonalY }, { x: 2441.5, y: 1375 }, { x: 1221.5, y: 1375 }],
];

function triangles(): NestingPartInput[] {
  return contours.map((polygonPoints, i) => ({
    id: `triangle-${i}`, wallId: 'wall-1', wallName: 'Стена 1', partLabel: `1.${6 - i}`,
    materialId: 'wood', textureCategory: 'WOOD', decorCode: '5189',
    width: 1220, height: Math.round((Math.max(...polygonPoints.map(p => p.y)) - Math.min(...polygonPoints.map(p => p.y))) * 10) / 10,
    x: 1221.5, y: Math.min(...polygonPoints.map(p => p.y)),
    polygonPoints, textureMapping: structuredClone(source),
  }));
}

test('inherited triangle contours share one blank with two common cuts and no cuts through their bounds', () => {
  const inputs = triangles(), before = structuredClone(inputs);
  const result = NestingEngine.optimizeProjectNesting(inputs);
  assert.equal(result.totalSheetsCount, 1);
  assert.equal(result.totalPartsCount, 3);
  const stock = result.allSheets[0];
  close(stock.usedAreaSqM, 1.678, 0.001);
  assert.deepEqual(stock.commonCutPartLabels, ['1.4', '1.5', '1.6']);
  assert.equal(stock.cutLines.filter(c => c.orientation === 'DIAGONAL').length, 2);
  assert.equal(stock.cutLines.length, 3, 'only the two common diagonals and the bottom of the source blank need cutting');
  assert.ok(stock.cutLines.filter(c => c.orientation === 'HORIZONTAL').every(c => Math.abs(c.p1.y - 1425) < 1e-6));
  const first = stock.placedParts.find(p => p.part.id === 'triangle-0')!;
  close(first.height, diagonalY);
  assert.deepEqual(inputs, before);
});

test('source identity never allows overlaps, while touching crops from different walls can share stock', () => {
  const [a, b] = triangles();
  for (const other of [{ ...a, id: 'duplicate' },
    { ...a, id: 'shifted', textureMapping: { ...source, offsetY: 1 } }]) {
    assert.equal(NestingEngine.optimizeProjectNesting([a, other]).totalSheetsCount, 2);
  }
  const shared = NestingEngine.optimizeProjectNesting([a, { ...b, wallId: 'other-wall' }]);
  assert.equal(shared.totalSheetsCount, 1);
  assert.equal(shared.allSheets[0].commonCutPartLabels, undefined);
});

test('independent fixed triangles use actual contours and can share a diagonal boundary', () => {
  const base = { ...triangles()[0], x: 0, y: 0, width: 1000, height: 1000,
    textureMapping: { offsetX: 0, offsetY: 0, angleDeg: 0 } };
  const a = { ...base, polygonPoints: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 0, y: 1000 }] };
  for (const gap of [0, 0.5, 4, 6]) {
    const b = { ...base, id: 'other', polygonPoints: [{ x: 1000, y: gap }, { x: 1000, y: 1000 }, { x: gap, y: 1000 }],
      textureMapping: { offsetX: gap, offsetY: 0, angleDeg: 0 } };
    assert.equal(NestingEngine.optimizeProjectNesting([a, b]).totalSheetsCount, 1);
  }
});

test('common source cuts survive arbitrary rotation and reversed contour winding', () => {
  const inputs = triangles().map(p => ({ ...p,
    polygonPoints: p.polygonPoints!.slice().reverse(),
    textureMapping: { ...source, offsetX: 30, offsetY: 40, angleDeg: 27.5,
      anchor: { ...source.anchor, height: 1375 } },
  }));
  const result = NestingEngine.optimizeProjectNesting(inputs, 2500, 3000);
  assert.equal(result.totalSheetsCount, 1);
  assert.equal(result.allSheets[0].commonCutPartLabels?.length, 3);
  assert.ok(result.allSheets[0].placedParts.every(p => p.textureAngleDeg === 27.5));
});

test('both PDF exports preserve the source crop and count five sheets for the saved project geometry', async (t) => {
  const wood = { ...DEFAULT_MATERIALS.find(m => m.id === 'aw-sheet-wood')! };
  const fabric = { ...DEFAULT_MATERIALS.find(m => m.id === 'aw-sheet-fabric')! };
  const wall = createDefaultWall('wall-1');
  wall.width = 3600; wall.height = 2750; wall.zone.materialId = fabric.id;
  const rect = (label: string, x: number, y: number, width: number, height: number): WallPanelPiece => ({
    id: label, partLabel: label, materialId: fabric.id, decorCode: '7029', textureCategory: 'FABRIC',
    points: rectangle(x, y, width, height),
  });
  wall.panels = [rect('1.1', 0, 0, 1218.5, 2750),
    ...triangles().map(p => ({ id: p.id, partLabel: p.partLabel, materialId: wood.id, decorCode: '5189',
      textureCategory: 'WOOD', points: p.polygonPoints!, textureMapping: p.textureMapping })),
    ...[[1375, 688, 420, '1.3'], [2063, 687, 60, '1.2']].map(([y, height, angleDeg, label]) => ({
      ...rect(String(label), 1221.5, Number(y), 1220, Number(height)), materialId: wood.id, decorCode: '5189', textureCategory: 'WOOD',
      textureMapping: { offsetX: 0, offsetY: 0, angleDeg: Number(angleDeg),
        anchor: { x: 1221.5, y: Number(y), width: 1220, height: Number(height) } },
    })),
    rect('1.9', 2444.5, 0, 578, 1375), rect('1.10', 3022.5, 0, 577.5, 1375),
    rect('1.8', 2444.5, 1375, 1155.5, 688), rect('1.7', 2444.5, 2063, 1155.5, 687),
  ];
  const project = { ...createDefaultProject(), name: 'авпвап', walls: [wall], materials: [wood, fabric] };
  assert.equal(LayoutEngine.calculateWallLayout(wall, fabric, project.materials).panels.length, 10);
  const original = NestingEngine.optimizeProjectNesting.bind(NestingEngine);
  const stop = new Error('captured nesting before rendering');
  let result: ProjectNestingResult | undefined;
  t.mock.method(NestingEngine, 'optimizeProjectNesting', (...args: Parameters<typeof original>) => {
    result = original(...args);
    throw stop;
  });
  for (const exportPdf of [PdfExportService.exportPanelsLayoutPdf, PdfExportService.exportInstallerPdf]) {
    await assert.rejects(exportPdf.call(PdfExportService, project), error => error === stop);
    assert.equal(result!.totalSheetsCount, 5);
    assert.equal(result!.totalPartsCount, 10);
    assert.deepEqual(result!.allSheets.find(s => s.commonCutPartLabels)?.commonCutPartLabels, ['1.4', '1.5', '1.6']);
  }
});

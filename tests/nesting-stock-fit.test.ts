import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NestingEngine, type NestingPartInput, type NestingSheet } from '../src/core/layout/NestingEngine';
import { PdfExportService } from '../src/application/services/PdfExportService';

test('stock fit ignores floating point noise in either orientation and in slat dimensions', () => {
  assert.ok(NestingEngine.fitsStock(1220.0000000000002, 1374.9999999999998));
  assert.ok(NestingEngine.fitsStock(2800.0000000000005, 1220.0000000000002));
  assert.ok(NestingEngine.fitsStock(145.00000000000003, 3000.0000000000005, 145, 3000, 'SLAT'));
});

test('stock fit still rejects actual oversize dimensions and a rotated slat', () => {
  for (const excess of [0.00001, 0.01, 1]) {
    assert.equal(NestingEngine.fitsStock(1220 + excess, 1375), false);
    assert.equal(NestingEngine.fitsStock(1220, 2800 + excess), false);
    assert.equal(NestingEngine.fitsStock(2800, 1220 + excess), false);
    assert.equal(NestingEngine.fitsStock(145 + excess, 3000, 145, 3000, 'SLAT'), false);
  }
  assert.equal(NestingEngine.fitsStock(3000, 145, 145, 3000, 'SLAT'), false);
});

function nestingTexts(sheet: NestingSheet): string[] {
  const texts: string[] = [];
  const ctx = new Proxy({}, {
    get: (_, key) => key === 'fillText' ? (text: string) => texts.push(text)
      : key === 'measureText' ? (text: string) => ({ width: text.length * 9 }) : () => undefined,
    set: () => true,
  });
  (PdfExportService as any).drawNestingSheetsOnCanvas(ctx, [{ sheet, otherWallNames: [] }], [], 'wall-1', 0, 0, 1000, 1800);
  return texts;
}

test('PDF renders the saved zero-gap triangle instead of a false oversize warning', () => {
  // Exact contour and source crop of element 1.6 in the reported project.
  const part: NestingPartInput = {
    id: 'triangle', wallId: 'wall-1', wallName: 'Стена 1', partLabel: '1.6',
    materialId: 'wood', textureCategory: 'WOOD', decorCode: '5189',
    width: 1220, height: 1375, x: 1218.5, y: 0,
    polygonPoints: [
      { x: 2438.5, y: 914.5045480451679 },
      { x: 1218.4999999999998, y: 1374.9999999999998 },
      { x: 1218.5, y: 0 },
    ],
    textureMapping: { offsetX: 0, offsetY: 0, angleDeg: 180,
      anchor: { x: 1218.5, y: 0, width: 1220, height: 2750 } },
  };
  const result = NestingEngine.optimizeProjectNesting([part]);
  assert.equal(result.totalSheetsCount, 1);
  const sheet = result.allSheets[0];
  assert.ok(sheet.placedParts[0].part.width > 1220, 'retain exact contour coordinates for packing');
  const texts = nestingTexts(sheet);
  assert.ok(!texts.includes('Нельзя разместить'));
  assert.ok(texts.includes('1.6'));

  const oversized = structuredClone(sheet);
  oversized.placedParts[0].part.width = 1220.01;
  assert.ok(nestingTexts(oversized).includes('Нельзя разместить'));
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NestingEngine, type NestingPartInput } from '../src/core/layout/NestingEngine';
import { sheet, close } from './helpers/business';

function part(id: string, width: number, height: number, wallNumber = 1): NestingPartInput {
  return { id, width, height, wallId: `wall-${wallNumber}`, wallName: `Wall ${wallNumber}`,
    partLabel: `${wallNumber}.${id}`, materialId: sheet.id, thickness: sheet.thickness };
}

test('custom 1200 × 600 stock is used for the entire cutting calculation', () => {
  const stock = { ...sheet, width: 1200, height: 600 };
  const result = NestingEngine.optimizeProjectNesting([part('a', 600, 600), part('b', 600, 600)], undefined, undefined, [stock]);
  assert.equal(result.totalSheetsCount, 1);
  const packed = result.allSheets[0];
  assert.equal(packed.sheetWidth, 1200);
  assert.equal(packed.sheetHeight, 600);
  close(packed.totalAreaSqM, 0.72);
  assert.equal(packed.placedParts.length, 2);
  assert.deepEqual(packed.placedParts.map(p => p.x).sort((a, b) => a - b), [0, 600]);
});

test('matching material reuses stock across walls and preserves each production label', () => {
  const inputs = [part('one', 600, 1000, 2), part('two', 600, 1000, 1)];
  const before = structuredClone(inputs);
  const result = NestingEngine.optimizeProjectNesting(inputs, undefined, undefined, [sheet]);
  assert.equal(result.totalSheetsCount, 1);
  assert.deepEqual(result.allSheets[0].placedParts.map(p => p.part.partLabel).sort(), ['1.two', '2.one']);
  assert.deepEqual(inputs, before);
});

test('fractional millimeters are retained rather than rounding a too-large pair into one sheet', () => {
  const stock = { ...sheet, width: 1200, height: 600 };
  const result = NestingEngine.optimizeProjectNesting([part('a', 600.4, 600), part('b', 600.4, 600)], undefined, undefined, [stock]);
  assert.equal(result.totalSheetsCount, 2);
  assert.ok(result.allSheets.every(s => s.placedParts.every(p => p.width === 600.4 && p.height === 600)));
});

test('usable offcuts start at the finished part edge without an extra allowance', () => {
  const stock = { ...sheet, width: 1000, height: 1000 };
  const result = NestingEngine.optimizeProjectNesting([part('square', 600, 600)], undefined, undefined, [stock]);
  const offcuts = result.allSheets[0].offcuts;
  assert.ok(offcuts.length > 0);
  for (const offcut of offcuts) {
    assert.ok(offcut.x >= 600 || offcut.y >= 600);
    assert.ok(offcut.x + offcut.width <= 1000);
    assert.ok(offcut.y + offcut.height <= 1000);
  }
  close(offcuts.reduce((area, p) => area + p.width * p.height, 0), 1000 * 1000 - 600 * 600);
});

test('a rotated window cutout can supply a piece matching its exact dimensions', () => {
  const stock = { ...sheet, width: 1000, height: 1500 };
  const frame = { ...part('frame', 1500, 1000), cutouts: [{ x: 100, y: 200, width: 600, height: 500 }] };
  const result = NestingEngine.optimizeProjectNesting([frame, part('insert', 500, 600)], undefined, undefined, [stock]);
  assert.equal(result.totalSheetsCount, 1);
  const placed = result.allSheets[0].placedParts;
  const insert = placed.find(p => p.part.id === 'insert')!;
  // After a quarter turn, x = original y and y = original width - original x.
  assert.deepEqual([insert.x, insert.y, insert.width, insert.height], [200, 800, 500, 600]);
});

test('same decor with different thickness or texture category cannot share a sheet', () => {
  const inputs = [
    { ...part('a', 200, 300), decorCode: 'code', thickness: 5, textureCategory: 'WOOD' },
    { ...part('b', 200, 300), decorCode: 'code', thickness: 8, textureCategory: 'WOOD' },
    { ...part('c', 200, 300), decorCode: 'code', thickness: 5, textureCategory: 'FABRIC' },
  ];
  const result = NestingEngine.optimizeProjectNesting(inputs, undefined, undefined, [sheet]);
  assert.equal(result.materialResults.length, 3);
  assert.equal(result.totalSheetsCount, 3);
});

test('blank regions and zero-size pieces are excluded from the order', () => {
  const result = NestingEngine.optimizeProjectNesting([
    { ...part('void', 1000, 1000), materialId: 'mat-none' },
    { ...part('label', 1000, 1000), partLabel: 'ПУСТО' },
    part('zero-width', 0, 1000), part('zero-height', 1000, 0),
  ]);
  assert.deepEqual(result, { totalSheetsCount: 0, totalPartsCount: 0, materialResults: [], allSheets: [] });
});

test('net production area uses the cut polygon area instead of its bounding box', () => {
  const triangle = { ...part('triangle', 1000, 1000), areaSqM: 0.5 };
  const window = { ...part('window', 1000, 1000), cutouts: [{ x: 200, y: 200, width: 500, height: 400 }] };
  close(NestingEngine.getPartNetAreaSqM(triangle), 0.5);
  close(NestingEngine.getPartNetAreaSqM(window), 0.8);
});

test('mixed-size packing places every part once within stock without overlaps', () => {
  const inputs = [[800, 1600], [400, 1100], [500, 600], [250, 2700], [1000, 300], [180, 900], [700, 700]]
    .map(([width, height], i) => part(String(i), width, height));
  const result = NestingEngine.optimizeProjectNesting(inputs, undefined, undefined, [sheet]);
  assert.deepEqual(result.allSheets.flatMap(s => s.placedParts.map(p => p.part.id)).sort(), inputs.map(p => p.id).sort());
  for (const stock of result.allSheets) {
    assert.ok(stock.efficiencyPct > 0 && stock.efficiencyPct <= 100);
    for (const [index, placed] of stock.placedParts.entries()) {
      assert.ok(placed.x >= 0 && placed.y >= 0);
      assert.ok(placed.x + placed.width <= stock.sheetWidth + 0.01);
      assert.ok(placed.y + placed.height <= stock.sheetHeight + 0.01);
      for (const other of stock.placedParts.slice(index + 1)) {
        assert.ok(placed.x + placed.width <= other.x || other.x + other.width <= placed.x ||
          placed.y + placed.height <= other.y || other.y + other.height <= placed.y);
      }
    }
    for (const [index, offcut] of stock.offcuts.entries()) {
      for (const placed of stock.placedParts) {
        assert.ok(offcut.x + offcut.width <= placed.x || placed.x + placed.width <= offcut.x ||
          offcut.y + offcut.height <= placed.y || placed.y + placed.height <= offcut.y);
      }
      for (const other of stock.offcuts.slice(index + 1)) {
        assert.ok(offcut.x + offcut.width <= other.x || other.x + other.width <= offcut.x ||
          offcut.y + offcut.height <= other.y || other.y + other.height <= offcut.y);
      }
    }
  }
});

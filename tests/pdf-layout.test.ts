import assert from 'node:assert/strict';
import { test } from 'node:test';
import { packStocks, planPanelPages, DrawingBox, STOCK_PADDING } from '../src/application/services/PanelPageLayout';
import { boxPolygon, boxesOverlap, placePartBadges, PartBadge } from '../src/application/services/PartBadges';
import { PolygonSlicingEngine as Geometry } from '../src/core/geometry/PolygonSlicingEngine';
import { createDefaultProject } from '../src/core/models/Project';
import { PdfExportService } from '../src/application/services/PdfExportService';
import { NestingEngine, ProjectNestingResult } from '../src/core/layout/NestingEngine';

const sheet = { sheetWidth: 1220, sheetHeight: 2800 };
const slat = { sheetWidth: 158, sheetHeight: 3000 };
const measure = (text: string, size: number) => text.length * size * 0.56;
const nonOverlapping = (boxes: DrawingBox[]) => boxes.forEach((box, i) => boxes.slice(i + 1).forEach(other => assert.equal(boxesOverlap(box, other, -0.01), false)));

test('two sheets and seven slats use one row with proportional widths', () => {
  const stocks = [sheet, sheet, ...Array.from({ length: 7 }, () => slat)];
  const packed = packStocks(stocks, { x: 60, y: 1000, width: 2850, height: 1000 });
  assert.equal(packed.boxes.length, 9);
  assert.ok(packed.scale > 0.3);
  assert.equal(new Set(packed.boxes.map(box => box.y)).size, 1);
  assert.ok(packed.boxes[0].width > packed.boxes[2].width * 3);
  nonOverlapping(packed.boxes);
});

test('dense stock paginates without omissions, reordering, clipping, or shrinking to thumbnails', () => {
  const stocks = Array.from({ length: 75 }, (_, i) => i % 3 ? slat : sheet);
  const pages = planPanelPages({ width: 3600, height: 2750 }, stocks);
  assert.ok(pages.length > 1);
  assert.deepEqual(pages.flatMap(page => page.stocks.map(stock => stock.index)), stocks.map((_, i) => i));
  assert.ok(pages[0].wall);
  assert.ok((pages[0].wall.width - 290) / 3600 >= 0.28 && (pages[0].wall.height - 270) / 2750 >= 0.28);
  for (const page of pages) {
    nonOverlapping([...(page.wall ? [page.wall] : []), ...page.stocks]);
    for (const stock of page.stocks) {
      assert.ok(stock.scale >= 0.20);
      assert.ok(stock.x >= 59.99 && stock.x + stock.width <= 2910.01);
      assert.ok(stock.y >= 99.99 && stock.y + stock.height <= 2030.01);
      assert.ok(stocks[stock.index].sheetHeight * stock.scale + STOCK_PADDING.top + STOCK_PADDING.bottom <= stock.height + 0.01);
    }
  }
});

test('a wall without new sheets uses the whole drawing area', () => {
  const pages = planPanelPages({ width: 900, height: 3000 }, []);
  assert.equal(pages.length, 1);
  assert.equal(pages[0].wall?.width, 2850);
  assert.equal(pages[0].stocks.length, 0);
});

test('adjacent narrow slats keep every full number inside its own contour', () => {
  const parts: PartBadge[] = Array.from({ length: 30 }, (_, i) => ({
    text: `1.${100 + i}`, polygon: boxPolygon({ x: i * 31, y: 0, width: 29, height: 300 }),
  }));
  const badges = placePartBadges(parts, { x: 0, y: 0, width: 1000, height: 300 }, measure);
  assert.equal(badges.length, parts.length);
  nonOverlapping(badges);
  badges.forEach((badge, i) => {
    assert.equal(badge.text, parts[i].text);
    assert.ok(badge.vertical);
    assert.ok(!badge.anchor);
    assert.ok(boxPolygon(badge).every(point => Geometry.isPointInPolygon(point, parts[i].polygon)));
  });
});

test('diagonal slats, a cutout through the centroid, and tiny fragments keep readable labels', () => {
  const cutout = { x: 10, y: 150, width: 150, height: 240 };
  const parts: PartBadge[] = [
    { text: '1.1', polygon: boxPolygon({ x: 0, y: 0, width: 170, height: 400 }), cutouts: [boxPolygon(cutout)] },
    ...Array.from({ length: 12 }, (_, i) => ({ text: `1.${i + 2}`,
      polygon: [{ x: 200 + i * 34, y: 0 }, { x: 232 + i * 34, y: 0 },
        { x: 232 + i * 34, y: 130 + i * 10 }, { x: 200 + i * 34, y: 110 + i * 10 }] })),
    { text: '1.99', polygon: boxPolygon({ x: 700, y: 190, width: 4, height: 5 }) },
  ];
  const badges = placePartBadges(parts, { x: 0, y: 0, width: 900, height: 420 }, measure);
  nonOverlapping(badges);
  assert.equal(boxesOverlap(badges[0], cutout, 0), false);
  assert.ok(badges[badges.length - 1].anchor, 'tiny fragments receive a leader');
  assert.ok(badges.every(badge => badge.fontSize >= 16));
});

test('overview drops descriptions and cut badges while keeping IDs, stock dimensions, and shared-sheet references', () => {
  const project = createDefaultProject('Project');
  const wall = project.walls[0];
  const material = project.materials.find(m => m.type === 'SHEET')!;
  const nesting = NestingEngine.optimizeProjectNesting([
    { id: 'part', wallId: wall.id, wallName: wall.name, partLabel: '1.1', materialId: material.id,
      width: 400, height: 1000, note: 'PRIVATE_DESCRIPTION', polygonPoints: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 0, y: 1000 }] },
  ], undefined, undefined, [material]);
  const texts: string[] = [];
  const ctx = new Proxy({}, { get: (_, key) => key === 'fillText' ? (text: string) => texts.push(text)
    : key === 'measureText' ? (text: string) => ({ width: measure(text, 20) }) : () => undefined, set: () => true });
  (PdfExportService as any).drawNestingSheetsOnCanvas(ctx, nesting.allSheets.map(sheet => ({ sheet, otherWallNames: [] })), [], wall.id, 0, 0, 1000, 1800);
  assert.ok(texts.includes('1.1'));
  assert.ok(texts.includes(String(material.width)) && texts.includes(String(material.height)));
  assert.ok(texts.every(text => !/PRIVATE_DESCRIPTION|Исп:|Арт:|✂| мм|X |Y /.test(text)));

  const borrowedWall = { ...wall, id: 'borrower', panels: [], openings: [] };
  project.walls.push(borrowedWall);
  nesting.allSheets[0].placedParts.push({ ...nesting.allSheets[0].placedParts[0], part: { ...nesting.allSheets[0].placedParts[0].part, wallId: borrowedWall.id } });
  (PdfExportService as any).renderPanelLayoutPage(ctx, 2970, 2100, project, borrowedWall, nesting, 2, 2);
  assert.ok(texts.some(text => text.includes(`См. также: ${nesting.allSheets[0].sheetLabel}`)));
});

test('public PDF export writes every planned continuation page and leaves project data untouched', async t => {
  const project = createDefaultProject('Page export');
  const original = structuredClone(project);
  const wall = project.walls[0];
  const stock = NestingEngine.optimizeProjectNesting([{ id: 'part', partLabel: '1.1', wallId: wall.id, wallName: wall.name,
    materialId: 'wood', width: 1220, height: 2800 }]).allSheets[0];
  const nesting: ProjectNestingResult = { allSheets: Array.from({ length: 28 }, (_, i) => ({ ...stock, sheetIndex: i + 1, sheetLabel: `Лист ${i + 1}` })),
    totalSheetsCount: 28, totalPartsCount: 28, materialResults: [] };
  t.mock.method(NestingEngine, 'optimizeProjectNesting', () => nesting);
  const rendered: { number: number; total: number; indices: number[] }[] = [];
  t.mock.method(PdfExportService as any, 'renderPanelLayoutPage', (_ctx: unknown, _w: number, _h: number, _project: unknown, _wall: unknown, _nesting: unknown, number: number, total: number, page: { stocks: { index: number }[] }) => {
    rendered.push({ number, total, indices: page.stocks.map(stock => stock.index) });
  });
  const doc = globalThis.document;
  const { jsPDF } = await import('jspdf');
  // Exercise pagination without a browser, image encoding, or filesystem writes.
  const api = jsPDF.API as unknown as { save?: () => unknown; addImage: () => unknown };
  const save = api.save;
  api.save = function() { return this; };
  t.mock.method(api, 'addImage', function(this: unknown) { return this; });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({ getContext: () => ({}), toDataURL: () => '' }) } });
  try {
    await PdfExportService.exportPanelsLayoutPdf(project);
    assert.ok(rendered.length > 1);
    assert.deepEqual(rendered.flatMap(page => page.indices), nesting.allSheets.map((_, i) => i));
    assert.ok(rendered.every((page, i) => page.number === i + 1 && page.total === rendered.length));
    assert.deepEqual(project, original);
  } finally {
    if (save === undefined) delete api.save; else api.save = save;
    if (doc === undefined) Reflect.deleteProperty(globalThis, 'document');
    else Object.defineProperty(globalThis, 'document', { configurable: true, value: doc });
  }
});

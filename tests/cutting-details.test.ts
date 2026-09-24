import assert from 'node:assert/strict';
import { test } from 'node:test';
import { jsPDF } from 'jspdf';
import { buildCuttingDetails, cuttingDetailCardBoxes, detailDimensions, placeDimensionLabels, planCuttingDetailPages, renderCuttingDetailPage, CuttingDetailPage } from '../src/application/services/CuttingDetails';
import { boxesOverlap } from '../src/application/services/PartBadges';
import { PdfExportService } from '../src/application/services/PdfExportService';
import { NestingEngine, NestingPartInput, ProjectNestingResult } from '../src/core/layout/NestingEngine';
import { createDefaultProject } from '../src/core/models/Project';
import { ensureOpeningSlopes, Opening } from '../src/core/models/Opening';
import { LayoutEngine } from '../src/core/layout/LayoutEngine';

const emptyNesting: ProjectNestingResult = { allSheets: [], materialResults: [], totalPartsCount: 0, totalSheetsCount: 0 };
const slat: NestingPartInput = { id: 'slat', partLabel: '1.19', wallId: 'wall-1', wallName: 'Стена 1', materialId: 'slat',
  x: 2440, y: 2138, width: 158, height: 612,
  polygonPoints: [{ x: 2440, y: 2210 }, { x: 2598, y: 2138 }, { x: 2598, y: 2750 }, { x: 2440, y: 2750 }] };
const lower: NestingPartInput = { id: 'lower', partLabel: '1.18', wallId: 'wall-1', wallName: 'Стена 1', materialId: 'sheet',
  x: 1220, y: 0, width: 1220, height: 200 };
const close = (a: number | undefined, b: number) => assert.ok(a !== undefined && Math.abs(a - b) < 1e-6, `${a} != ${b}`);
const recordingContext = (texts: string[]) => new Proxy({} as CanvasRenderingContext2D, {
  get: (_, key) => key === 'fillText' ? (text: string) => texts.push(text)
    : key === 'measureText' ? (text: string) => ({ width: text.length * 10 }) : () => undefined,
  set: () => true,
});

test('a bevelled slat has both side lengths, exact cut length and angle, not just its bounding height', () => {
  const input = structuredClone(slat);
  const detail = buildCuttingDetails([input], emptyNesting)[0];
  close(detail.width, 158); close(detail.height, 612);
  close(detail.leftHeight, 540); close(detail.rightHeight, 612);
  const cut = detail.edges.find(edge => edge.angle > 0 && edge.angle < 90)!;
  close(cut.length, Math.hypot(158, 72)); close(cut.angle, Math.atan2(72, 158) * 180 / Math.PI);
  assert.deepEqual(detail.contours[0].points, [{ x: 0, y: 612 }, { x: 158, y: 612 }, { x: 158, y: 0 }, { x: 0, y: 72 }]);
  assert.deepEqual(input, slat);
});

test('a 200 mm lower strip retains its height and a rotated stock allocation does not swap finished dimensions', () => {
  const nesting = NestingEngine.optimizeProjectNesting([lower]);
  const placed = nesting.allSheets[0].placedParts[0];
  placed.rotated = true; placed.width = 200; placed.height = 1220; placed.x = 80; placed.y = 90;
  const detail = buildCuttingDetails([lower], nesting)[0];
  close(detail.width, 1220); close(detail.height, 200);
  close(detail.leftHeight, 200); close(detail.rightHeight, 200);
  assert.equal(detail.stockLabels[0], nesting.allSheets[0].sheetLabel);
  assert.deepEqual(detail.stockPlacements[0], { label: nesting.allSheets[0].sheetLabel, x: 80, top: 1490, clockwiseAngle: 90 });
  placed.textureAngleDeg = 420;
  assert.equal(buildCuttingDetails([lower], nesting)[0].stockPlacements[0].clockwiseAngle, 60);
});

test('cutout coordinates use the same local origin as the outer contour and every edge closes', () => {
  const source: NestingPartInput = { ...lower, x: 1000, y: 400, height: 1800,
    cutouts: [{ x: 300, y: 250, width: 400, height: 650 }] };
  const detail = buildCuttingDetails([source], emptyNesting)[0];
  assert.equal(detail.contours.length, 2);
  assert.deepEqual(detail.contours[1].points, [{ x: 300, y: 900 }, { x: 700, y: 900 }, { x: 700, y: 250 }, { x: 300, y: 250 }]);
  assert.equal(detail.edges.length, 8);
  for (const contour of detail.contours) {
    const edges = detail.edges.filter(edge => edge.contour === contour.name);
    assert.equal(edges[edges.length - 1].to, edges[0].from);
  }
});

test('complex contours and multiple bends continue without dropping dimensions or mixing walls', () => {
  const detailed: NestingPartInput = { ...lower, height: 900, polygonPoints: Array.from({ length: 33 }, (_, i) => ({
    x: 600 + Math.cos(i * 2 * Math.PI / 33) * 500, y: 450 + Math.sin(i * 2 * Math.PI / 33) * 400,
  })), bendsInfo: Array.from({ length: 8 }, (_, i) => ({ bendId: String(i), type: 'INNER_CORNER', radius: 30,
    angleDeg: 90, flatLeft: 30, flatRight: 500, bendOffsetInSheet: i * 60, bendWidth: 47.1 })) };
  const details = buildCuttingDetails([detailed, { ...slat, wallId: 'wall-2', wallName: 'Стена 2' }], emptyNesting);
  const pages = planCuttingDetailPages(details);
  const cards = pages.filter(page => page.wallId === 'wall-1').flatMap(page => page.cards);
  assert.deepEqual(cards.flatMap(card => card.dimensions), detailDimensions(details[0]));
  assert.equal(cards.flatMap(card => card.dimensions).filter(dim => dim.kind === 'bend').length, 16);
  assert.ok(cards.every(card => card.dimensions.length <= 12));
  assert.equal(pages[pages.length - 1].wallId, 'wall-2');
  assert.ok(pages.every(page => page.cards.length <= 2));
});

test('31 simple details share six pages with every card rendered in a separate bounded cell', () => {
  const parts = Array.from({ length: 31 }, (_, i) => ({ ...slat, id: `slat-${i}`, partLabel: `1.${i + 1}` }));
  const pages = planCuttingDetailPages(buildCuttingDetails(parts, emptyNesting));
  assert.equal(pages.length, 6);
  assert.deepEqual(pages.map(page => page.cards.length), [6, 6, 6, 6, 6, 1]);
  assert.deepEqual(pages.flatMap(page => page.cards.map(card => card.detail.part.id)), parts.map(p => p.id));
  const texts: string[] = [];
  for (const [index, page] of pages.entries()) {
    const boxes = cuttingDetailCardBoxes(page, 2970, 2100);
    boxes.forEach((box, i) => {
      assert.ok(box.x >= 60 && box.y >= 120 && box.x + box.width <= 2910 && box.y + box.height <= 2010);
      boxes.slice(i + 1).forEach(other => assert.equal(boxesOverlap(box, other), false));
    });
    renderCuttingDetailPage(recordingContext(texts), 2970, 2100, page, index + 1, pages.length);
  }
  for (const part of parts) assert.equal(texts.filter(text => text === `Деталь ${part.partLabel}`).length, 1);
  assert.equal(texts.filter(text => text === '173.6 мм; 24.5°').length, 31);
});

test('printed drawings give short/long sides, strip height and cut angle without a coordinate table', () => {
  const texts: string[] = [];
  const pages = planCuttingDetailPages(buildCuttingDetails([slat, lower], emptyNesting));
  pages.forEach((page, i) => renderCuttingDetailPage(recordingContext(texts), 2970, 2100, page, i + 1, pages.length));
  for (const text of ['Деталь 1.19', 'Деталь 1.18', '540', '612', '200', 'Габарит 1220 × 200 мм', '173.6 мм; 24.5°'])
    assert.ok(texts.includes(text), text);
  assert.ok(!texts.some(text => /A\.1|Точка|Ребро|Слева|Справа/.test(text)));
});

test('an applied notch is dimensioned once and its short edge callouts stay apart', () => {
  const part: NestingPartInput = { ...lower, width: 156.5, height: 2750, x: 0, y: 0,
    polygonPoints: [{ x: 0, y: 0 }, { x: 156.5, y: 0 }, { x: 156.5, y: 200 }, { x: 110, y: 200 },
      { x: 110, y: 1700 }, { x: 156.5, y: 1700 }, { x: 156.5, y: 2750 }, { x: 0, y: 2750 }],
    cutouts: [{ x: 110, y: 200, width: 46.5, height: 1500 }] };
  const detail = buildCuttingDetails([part], emptyNesting)[0];
  assert.equal(detail.contours.length, 1, 'notch already belongs to the outer contour');
  const region = { x: 70, y: 300, width: 2830, height: 1590 };
  const drawing = { x: 1450, y: 395, width: 80, height: 1400 };
  const labels = placeDimensionLabels(detailDimensions(detail), p => ({ x: drawing.x + p.x * .5, y: drawing.y + (2750 - p.y) * .5 }),
    region, drawing, text => text.length * 18);
  assert.equal(labels.length, 8);
  assert.equal(labels.filter(label => label.text === '46.5').length, 2);
  for (const [i, a] of labels.entries()) {
    assert.ok(a.x >= region.x && a.y >= region.y && a.x + a.width <= region.x + region.width && a.y + a.height <= region.y + region.height);
    for (const b of labels.slice(i + 1)) assert.equal(boxesOverlap(a, b, 0), false, `${a.text} / ${b.text}`);
  }
});

test('cutouts include position dimensions and oversized details explain the red warning', () => {
  const part = { ...lower, width: 1300, height: 2900, stockWidth: 1220, stockHeight: 2800,
    cutouts: [{ x: 300, y: 250, width: 400, height: 650 }] };
  const detail = buildCuttingDetails([part], emptyNesting)[0];
  const dims = detailDimensions(detail);
  assert.ok(dims.some(dim => dim.label === '300 от левого края'));
  assert.ok(dims.some(dim => dim.label === '250 от низа'));
  const texts: string[] = [];
  renderCuttingDetailPage(recordingContext(texts), 2970, 2100, planCuttingDetailPages([detail])[0], 1, 1);
  assert.ok(texts.some(text => text.startsWith('Нельзя разместить на выбранной заготовке')));
});

test('compact wall drawing explains unplaceable red slope badges', () => {
  const project = createDefaultProject('Warnings');
  const wall = project.walls[0], mat = project.materials.find(m => m.type === 'SHEET')!;
  wall.width = 3600; wall.height = 2750; wall.zone.materialId = mat.id;
  const opening: Opening = { id: 'opening', name: 'Окно', type: 'WINDOW', isApplied: true, isCutout: true,
    x: 110, y: 200, width: 3100, height: 1500 };
  opening.slopes = { ...ensureOpeningSlopes(opening), enabled: true, materialId: mat.id };
  wall.openings = [opening];
  const layout = LayoutEngine.calculateWallLayout(wall, mat, project.materials, 1);
  const texts: string[] = [];
  (PdfExportService as any).drawWall2DOnCanvas(recordingContext(texts), wall, layout, 60, 80, 2850, 1950, true, project.materials, true);
  assert.ok(texts.includes('Нельзя разместить'));
  assert.ok(texts.includes('Красные номера: элементы нельзя разместить на выбранной заготовке.'));
});

test('the same collector carries opening cutouts into both export booklets', () => {
  const project = createDefaultProject('Cutout');
  const wall = project.walls[0];
  const material = project.materials.find(m => m.type === 'SHEET')!;
  wall.width = 1000; wall.height = 1800; wall.zone.materialId = material.id;
  wall.panels = [{ id: 'frame', partLabel: '1.1', materialId: material.id,
    points: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1800 }, { x: 0, y: 1800 }] }];
  const opening: Opening = { id: 'window', name: 'Окно', type: 'WINDOW', isCutout: true, isApplied: true,
    x: 200, y: 400, width: 500, height: 800 };
  opening.slopes = { ...ensureOpeningSlopes(opening), enabled: false };
  wall.openings = [opening];
  const before = structuredClone(project);
  const parts = (PdfExportService as any).collectCuttingParts(project) as NestingPartInput[];
  assert.ok(parts.some(part => part.cutouts?.some(cut => cut.width === 500 && cut.height === 800)));
  assert.deepEqual(project, before);
});

test('only the separate cutting export contains detail pages, with consistent page totals', async t => {
  const project = createDefaultProject('Booklet');
  const parts = [slat, lower];
  t.mock.method(PdfExportService as any, 'collectCuttingParts', () => parts);
  const allPages: { number: number; total: number; details?: CuttingDetailPage }[] = [];
  t.mock.method(PdfExportService as any, 'renderPanelLayoutPage', (_c: unknown, _w: number, _h: number, _p: unknown, _wall: unknown, _n: unknown, number: number, total: number) => {
    allPages.push({ number, total });
  });
  for (const method of ['renderInstallerCoverPage', 'renderInstallerWallPage']) t.mock.method(PdfExportService as any, method, (...args: any[]) => {
    allPages.push({ number: args[6], total: args[7] });
  });
  t.mock.method(PdfExportService as any, 'renderCuttingDetailsPage', (_ctx: unknown, _w: number, _h: number, page: CuttingDetailPage, number: number, total: number) => {
    allPages.push({ number, total, details: page });
  });
  const api = jsPDF.API as unknown as { save?: () => unknown; addImage: () => unknown };
  const save = api.save, doc = globalThis.document;
  api.save = function() { return this; };
  t.mock.method(api, 'addImage', function(this: unknown) { return this; });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({ getContext: () => ({}), toDataURL: () => '' }) } });
  try {
    for (const exportPdf of [PdfExportService.exportPanelsLayoutPdf, PdfExportService.exportInstallerPdf, PdfExportService.exportCuttingDetailsPdf]) {
      allPages.length = 0;
      await exportPdf.call(PdfExportService, project);
      assert.deepEqual(allPages.map(page => page.number), allPages.map((_, i) => i + 1));
      assert.ok(allPages.every(page => page.total === allPages.length));
      assert.deepEqual(allPages.flatMap(page => page.details?.cards.map(card => card.detail.part.partLabel) ?? []),
        exportPdf === PdfExportService.exportCuttingDetailsPdf ? ['1.18', '1.19'] : []);
    }
  } finally {
    if (save === undefined) delete api.save; else api.save = save;
    if (doc === undefined) Reflect.deleteProperty(globalThis, 'document');
    else Object.defineProperty(globalThis, 'document', { configurable: true, value: doc });
  }
});

test('empty cutting export reports that materials must be assigned instead of saving a blank PDF', async () => {
  await assert.rejects(PdfExportService.exportCuttingDetailsPdf(createDefaultProject('Empty')), /Нет деталей для раскроя/);
});

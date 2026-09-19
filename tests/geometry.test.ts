import assert from 'node:assert/strict';
import { test } from 'node:test';
import { subtractRectangles, intersects } from '../src/core/geometry/Rect2D';
import { PolygonSlicingEngine as Geometry } from '../src/core/geometry/PolygonSlicingEngine';
import { close, panel, rectangle } from './helpers/business';

test('overlapping and out-of-wall rectangular openings subtract only their union', () => {
  const pieces = subtractRectangles({ x: 0, y: 0, width: 1000, height: 1000 }, [
    { x: -100, y: 200, width: 600, height: 400 },
    { x: 300, y: 400, width: 500, height: 400 },
  ]);
  close(pieces.reduce((sum, p) => sum + p.width * p.height, 0), 640000);
  for (let i = 0; i < pieces.length; i++) {
    assert.ok(pieces[i].x >= 0 && pieces[i].y >= 0);
    for (const other of pieces.slice(i + 1)) assert.equal(intersects(pieces[i], other), false);
  }
});

test('a door touching the floor leaves its exact opening and a continuous lintel', () => {
  const source = panel('door-panel', 0, 0, 1200, 2500);
  const before = structuredClone(source);
  const result = Geometry.cutOpeningFromWallPanels([source], { id: 'door', x: 200, y: 0, width: 800, height: 2000 });
  close(result.newPanels.reduce((sum, p) => sum + Geometry.calculatePolygonArea(p.points), 0), 1400000);
  assert.equal(result.newPanels.length, 1);
  assert.equal(Geometry.isPointInPolygon({ x: 600, y: 1000 }, result.newPanels[0].points), false);
  assert.equal(Geometry.isPointInPolygon({ x: 600, y: 2300 }, result.newPanels[0].points), true);
  assert.deepEqual(source, before);
});

test('an internal window removes its area without adding artificial joints', () => {
  const result = Geometry.cutOpeningFromWallPanels([panel('window-panel', 0, 0, 2000, 2500)], {
    id: 'window', x: 400, y: 800, width: 1000, height: 1200,
  });
  close(result.newPanels.reduce((sum, p) => sum + Geometry.calculatePolygonArea(p.points), 0), 3800000);
  assert.equal(result.joints.length, 0);
  assert.ok(result.newPanels.every(p => !Geometry.isPointInPolygon({ x: 900, y: 1400 }, p.points)));
});

test('knife preserves area on a diagonal through the two opposite vertices', () => {
  const result = Geometry.splitWallPanel(panel('diagonal', 0, 0, 1000, 1000), { x: 0, y: 0 }, { x: 1000, y: 1000 });
  assert.ok(result);
  assert.equal(result.newPanels.length, 2);
  for (const p of result.newPanels) close(Geometry.calculatePolygonArea(p.points), 500000);
});

test('knife splits a concave U shape into three independent pieces', () => {
  const points = [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 },
    { x: 700, y: 1000 }, { x: 700, y: 300 }, { x: 300, y: 300 },
    { x: 300, y: 1000 }, { x: 0, y: 1000 }];
  const result = Geometry.splitWallPanel({ ...panel('concave', 0, 0, 1000, 1000), points },
    { x: -100, y: 600 }, { x: 1100, y: 600 });
  assert.ok(result);
  assert.equal(result.newPanels.length, 3);
  close(result.newPanels.reduce((sum, p) => sum + Geometry.calculatePolygonArea(p.points), 0), 720000);
});

test('knife subtracts the specified seam and keeps exterior edge profiles on exterior children', () => {
  const source = { ...panel('seam', 0, 0, 1000, 1000), edges: {
    left: { width: 3, profileArticle: 'MC-06' }, right: { width: 7, profileArticle: 'MC-06-7' },
    top: { width: 10, profileArticle: 'DL-13', isLED: true },
  } };
  const result = Geometry.splitWallPanel(source, { x: 400, y: 0 }, { x: 400, y: 1000 }, 7)!;
  close(result.newPanels.reduce((sum, p) => sum + Geometry.calculatePolygonArea(p.points), 0), 993000);
  assert.equal(result.joint?.width, 7);
  assert.equal(result.newPanels[0].edges?.right, undefined);
  assert.equal(result.newPanels[1].edges?.left, undefined);
  assert.deepEqual(result.newPanels[0].edges?.left, source.edges.left);
  assert.deepEqual(result.newPanels[1].edges?.right, source.edges.right);
  assert.ok(result.newPanels.every(p => p.edges?.top?.isLED));
});

test('tangent and zero-length knife strokes do not create pieces', () => {
  const square = rectangle(0, 0, 1000, 1000);
  assert.equal(Geometry.splitPolygonByLine(square, { x: 0, y: 0 }, { x: 1000, y: 0 }), null);
  assert.equal(Geometry.splitPolygonByLine(square, { x: 500, y: 500 }, { x: 500, y: 500 }), null);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { polygonsSeparated } from '../src/core/geometry/PolygonCollision';
import { rectangle } from './helpers/business';

test('polygon clearance measures perpendicular distance to a diagonal, not bounding boxes', () => {
  const lower = [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 0, y: 1000 }];
  const upper = (gap: number) => [{ x: 1000, y: gap }, { x: 1000, y: 1000 }, { x: gap, y: 1000 }];
  assert.equal(polygonsSeparated(lower, upper(0), 0), true);
  assert.equal(polygonsSeparated(lower, upper(0), 4), false);
  assert.equal(polygonsSeparated(lower, upper(4), 4), false);
  assert.equal(polygonsSeparated(lower, upper(4 * Math.SQRT2), 4), true);
});

test('coincident, contained and crossing polygons cannot share material', () => {
  const square = rectangle(0, 0, 100, 100);
  for (const other of [square, [...square].reverse(), rectangle(10, 10, 20, 20), rectangle(-50, 40, 200, 20)]) {
    assert.equal(polygonsSeparated(square, other, 0), false);
  }
});

test('concave contours allow a piece in their empty region but reject overlap with either arm', () => {
  const l = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 20 },
    { x: 20, y: 20 }, { x: 20, y: 100 }, { x: 0, y: 100 }];
  assert.equal(polygonsSeparated(l, rectangle(24, 24, 50, 50), 4), true);
  assert.equal(polygonsSeparated([...l].reverse(), rectangle(24, 24, 50, 50), 4), true);
  assert.equal(polygonsSeparated(l, rectangle(19, 24, 50, 50), 0), false);
  assert.equal(polygonsSeparated(l, rectangle(24, 19, 50, 50), 0), false);
  assert.equal(polygonsSeparated(l, l, 0), false);
});

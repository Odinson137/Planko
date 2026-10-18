import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getPanelCutGuides, snapPanelCutPoint } from '../src/core/geometry/PanelCutSnapping';
import { cutPanelOnWall } from '../src/core/geometry/PanelCutEngine';
import { getPanelJointSide } from '../src/core/geometry/PanelJointBinding';
import { resizeOwnedJointGap } from '../src/core/geometry/PanelEdgeGapGeometry';
import { PolygonSlicingEngine as Geometry, type Point2D } from '../src/core/geometry/PolygonSlicingEngine';
import { close, panel, sheet, wallWithPanel } from './helpers/business';

function fixture(vertical = false, reversed = false, seam = 700) {
  const wall = wallWithPanel(1400, 1200);
  wall.panels = [panel('target', 0, 0, 400, 1200), panel('lower', 400, 0, 1000, seam),
    panel('upper', 400, seam, 1000, 1200 - seam)];
  wall.joints = [{ id: 'neighbor', p1: { x: 400, y: seam }, p2: { x: 1400, y: seam }, width: 0, isLED: false },
    { id: 'border', p1: { x: 400, y: 0 }, p2: { x: 400, y: 1200 }, width: 0, isLED: false }];
  if (reversed) [wall.joints[0].p1, wall.joints[0].p2] = [wall.joints[0].p2, wall.joints[0].p1];
  if (vertical) {
    [wall.width, wall.height] = [wall.height, wall.width];
    wall.panels.forEach(p => { p.points = p.points.map(swap); });
    wall.joints.forEach(j => { j.p1 = swap(j.p1); j.p2 = swap(j.p2); });
  }
  return wall;
}
const swap = (p: Point2D) => ({ x: p.y, y: p.x });
function withGap(wall: ReturnType<typeof fixture>, ownerId: string, width: number) {
  const joint = wall.joints![0];
  const owner = wall.panels!.find(p => p.id === ownerId)!;
  const result = resizeOwnedJointGap(wall, { ...joint, gapOwnerSide: getPanelJointSide(owner, joint) }, width);
  return { ...wall, panels: result.panels, joints: result.joints };
}

for (const vertical of [false, true]) for (const reversed of [false, true]) {
  for (const owner of ['upper', 'lower']) for (const width of [0, 0.8, 24]) {
    test(`${vertical ? 'vertical' : 'horizontal'} continuation uses the start of ${width} mm gap from ${owner}, reversed=${reversed}`, () => {
      const wall = withGap(fixture(vertical, reversed), owner, width);
      const before = structuredClone(wall), target = wall.panels![0];
      const orient = vertical ? swap : (p: Point2D) => p;
      const guides = getPanelCutGuides(wall, target);
      assert.equal(guides.length, 1, 'the selected panel border must not become a cut guide');
      const first = snapPanelCutPoint(orient({ x: 399, y: 704 }), target, guides, null, 9);
      assert.deepEqual(first.point, orient({ x: 400, y: 700 }));
      assert.equal(first.label, 'Начало соседнего шва');
      assert.ok(first.jointGuide);
      const second = snapPanelCutPoint(orient({ x: 1, y: 703 }), target, guides, first.point, 9);
      assert.deepEqual(second.point, orient({ x: 0, y: 700 }));
      assert.ok(second.jointGuide);
      const result = cutPanelOnWall(wall, [sheet], target.id, first.point, second.point)!;
      assert.ok(result);
      assert.equal(result.panels!.length, wall.panels!.length + 1);
      assert.equal(result.joints!.at(-1)!.width, 0);
      assert.deepEqual(result.panels!.slice(-2), wall.panels!.slice(-2));
      assert.deepEqual(wall, before, 'hovering and cutting must not mutate the source');
    });
  }
}

test('switching the gap owner preserves the start boundary while the stored axis moves', () => {
  const wall = withGap(fixture(), 'upper', 24);
  const closed = resizeOwnedJointGap(wall, wall.joints![0], 0);
  const opened = resizeOwnedJointGap({ ...wall, ...closed },
    { ...closed.joint, gapOwnerSide: closed.joint.gapOwnerSide === 1 ? -1 : 1 }, 24);
  const next = { ...wall, panels: opened.panels, joints: opened.joints };
  assert.notEqual(next.joints![0].p1.y, wall.joints![0].p1.y);
  const snapped = snapPanelCutPoint({ x: 400, y: 704 }, next.panels[0], getPanelCutGuides(next, next.panels[0]), null, 9);
  close(snapped.point.y, 700);
  assert.ok(snapped.jointGuide);
});

test('a shared contact is available without a saved joint, including an old one-sided edge gap', () => {
  const wall = fixture();
  wall.joints = [];
  wall.panels![2].edges = { bottom: { width: 24 } };
  const target = wall.panels![0];
  const snap = snapPanelCutPoint({ x: 400, y: 704 }, target, getPanelCutGuides(wall, target), null, 9);
  assert.deepEqual(snap.point, { x: 400, y: 700 });
  assert.ok(snap.jointGuide);
  assert.equal(wall.joints.length, 0, 'building guides must not materialize joints');
});

test('neighboring seam takes priority over a nearby midpoint magnet', () => {
  const wall = fixture(false, false, 606), target = wall.panels![0];
  const snap = snapPanelCutPoint({ x: 400, y: 605 }, target, getPanelCutGuides(wall, target), null, 9);
  assert.deepEqual(snap.point, { x: 400, y: 606 });
  assert.ok(snap.jointGuide);
  const outside = snapPanelCutPoint({ x: 400, y: 593 }, target, getPanelCutGuides(wall, target), null, 9);
  assert.equal(outside.jointGuide, undefined, 'the midpoint must not extend the seam attraction radius');
});

test('seam attraction radius stays at nine screen pixels at different zoom levels', () => {
  const wall = fixture(), target = wall.panels![0], guides = getPanelCutGuides(wall, target);
  for (const zoom of [0.25, 1, 4]) {
    const inside = snapPanelCutPoint({ x: 400, y: 700 + 8 / zoom }, target, guides, null, 9 / zoom);
    assert.ok(inside.jointGuide);
    close(inside.point.y, 700);
    const outside = snapPanelCutPoint({ x: 400, y: 700 + 10 / zoom }, target, guides, null, 9 / zoom);
    assert.equal(outside.jointGuide, undefined);
  }
});

for (const owner of ['upper', 'lower']) {
  test(`first point catches the visible axis of a wide gap taken from ${owner}`, () => {
    for (const vertical of [false, true]) for (const width of [24, 60]) for (const zoom of [0.5, 1, 3]) {
      const wall = withGap(fixture(vertical), owner, width), target = wall.panels![0];
      const orient = vertical ? swap : (p: Point2D) => p;
      const axis = vertical ? wall.joints![0].p1.x : wall.joints![0].p1.y;
      const raw = orient({ x: 400, y: axis + 3 / zoom });
      const snapped = snapPanelCutPoint(raw, target, getPanelCutGuides(wall, target), null, 9 / zoom);
      assert.deepEqual(snapped.point, orient({ x: 400, y: 700 }), JSON.stringify({ owner, vertical, width, zoom, raw }));
      assert.ok(snapped.jointGuide);
    }
  });
}

test('an unrelated first point, outer edge and zero-length joint do not attract a cut', () => {
  const wall = fixture(), target = wall.panels![0];
  const guides = getPanelCutGuides(wall, target);
  const raw = { x: 0, y: 701 }, start = { x: 400, y: 800 };
  assert.deepEqual(snapPanelCutPoint(raw, target, guides, start, 9),
    Geometry.snapPoint(raw, [target.points], [], 0, 0, start, 9));
  wall.joints![0].isOuterEdge = true;
  wall.joints!.push({ id: 'empty', p1: { x: 500, y: 300 }, p2: { x: 500, y: 300 }, width: 0, isLED: false });
  assert.equal(getPanelCutGuides(wall, target).length, 0);
});

test('diagonal continuation uses the fixed boundary and respects a forced Shift angle', () => {
  const wall = wallWithPanel(1000, 1200);
  wall.panels = [panel('target', 0, 0, 400, 1200),
    { ...panel('lower', 400, 0, 600, 700), points: [{ x: 400, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 700 }, { x: 400, y: 500 }] },
    { ...panel('upper', 400, 500, 600, 700), points: [{ x: 400, y: 500 }, { x: 1000, y: 700 }, { x: 1000, y: 1200 }, { x: 400, y: 1200 }] }];
  wall.joints = [{ id: 'diagonal', p1: { x: 400, y: 500 }, p2: { x: 1000, y: 700 }, width: 0, isLED: false }];
  const next = withGap(wall, 'upper', 18), target = next.panels![0], guides = getPanelCutGuides(next, target);
  const first = snapPanelCutPoint({ x: 400, y: 502 }, target, guides, null, 9);
  close(first.point.y, 500);
  const second = snapPanelCutPoint({ x: 0, y: 368 }, target, guides, first.point, 9);
  close(second.point.y, 500 - 400 / 3);
  assert.ok(second.jointGuide);
  const locked = snapPanelCutPoint({ x: 0, y: 500 }, target, guides, first.point, 9, true);
  assert.equal(locked.jointGuide, undefined);
  close(locked.point.y, 500);
});

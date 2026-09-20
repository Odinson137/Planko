import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LayoutEngine } from '../src/core/layout/LayoutEngine';
import { ProfileSpecificationEngine } from '../src/core/layout/ProfileSpecificationEngine';
import { createDefaultOpening, type Opening } from '../src/core/models/Opening';
import { close, sheet, wallWithPanel } from './helpers/business';

function opening(id: string, x: number, y: number, width: number, height: number): Opening {
  const result = { ...createDefaultOpening('WINDOW', 2000, 2000), id, x, y, width, height };
  result.slopes!.enabled = false;
  return result;
}

const scenarios = [
  { name: 'opening away from the midpoint', openings: [opening('a', 100, 100, 400, 400)], ranges: [[0, 100], [500, 2000]] },
  { name: 'opening covering the midpoint', openings: [opening('a', 800, 800, 400, 400)], ranges: [[0, 800], [1200, 2000]] },
  { name: 'overlapping and separate openings', openings: [opening('a', 100, 100, 400, 400), opening('b', 400, 400, 400, 400), opening('c', 1200, 1200, 200, 200)], ranges: [[0, 100], [800, 1200], [1400, 2000]] },
  { name: 'opening containing the start', openings: [opening('a', 0, 0, 400, 400)], ranges: [[400, 2000]] },
  { name: 'opening containing the whole profile', openings: [opening('a', 0, 0, 2000, 2000)], ranges: [] },
  { name: 'touching only an opening corner', openings: [opening('a', 500, 0, 200, 500)], ranges: [[0, 2000]] },
  { name: 'overlay that does not cut the wall', openings: [{ ...opening('tv', 800, 800, 400, 400), isCutout: false }], ranges: [[0, 2000]] },
];

for (const scenario of scenarios) {
  test(`diagonal profile clips correctly with ${scenario.name}`, () => {
    const wall = wallWithPanel(2000, 2000);
    wall.joints = [{ id: 'diagonal', p1: { x: 0, y: 0 }, p2: { x: 2000, y: 2000 },
      orientation: 'DIAGONAL', width: 10, isLED: true, profileArticle: 'DL-13', profileColor: '#c9a25b' }];
    wall.openings = scenario.openings;
    const before = structuredClone(wall);
    const layout = LayoutEngine.calculateWallLayout(wall, sheet, [sheet]);
    const joints = layout.joints.filter(j => j.orientation === 'DIAGONAL');
    assert.equal(joints.length, scenario.ranges.length);
    assert.equal(new Set(joints.map(j => j.id)).size, joints.length);
    for (const [index, joint] of joints.entries()) {
      const [start, end] = scenario.ranges[index];
      close(joint.p1!.x, start);
      close(joint.p1!.y, start);
      close(joint.p2!.x, end);
      close(joint.p2!.y, end);
      close(joint.length, (end - start) * Math.sqrt(2));
      close(joint.x, start);
      close(joint.y, start);
      assert.equal(joint.profileArticle, 'DL-13');
      assert.equal(joint.profileColor, '#c9a25b');
      assert.equal(joint.isLED, true);
      assert.equal(joint.width, 10);
      assert.equal(joint.sourceJointId, 'diagonal');
    }
    const length = scenario.ranges.reduce((sum, [start, end]) => sum + (end - start) * Math.sqrt(2), 0);
    assert.equal(layout.summary.profileLinearMeters, Math.round(length / 100) / 10);
    const report = ProfileSpecificationEngine.calculateWallProfiles(wall, sheet, [sheet]);
    close(report.items.find(i => i.article === 'DL-13')?.totalLengthMm ?? 0, length);
    assert.deepEqual(wall, before);
  });
}

test('descending and reversed diagonal profiles preserve their direction after clipping an applied opening', () => {
  for (const reverse of [false, true]) {
    const wall = wallWithPanel(2000, 2000);
    const points = [{ x: 0, y: 2000 }, { x: 2000, y: 0 }];
    if (reverse) points.reverse();
    wall.joints = [{ id: 'diagonal', p1: points[0], p2: points[1], width: 3, isLED: false, profileArticle: 'MC-06' }];
    wall.openings = [{ ...opening('applied', 500, 1000, 500, 500), isApplied: true }];
    const joints = LayoutEngine.calculateWallLayout(wall, sheet, [sheet]).joints.filter(j => j.orientation === 'DIAGONAL');
    assert.equal(joints.length, 2);
    close(joints.reduce((sum, j) => sum + j.length, 0), 1500 * Math.sqrt(2));
    const expected = reverse
      ? [[2000, 0, 1000, 1000], [500, 1500, 0, 2000]]
      : [[0, 2000, 500, 1500], [1000, 1000, 2000, 0]];
    joints.forEach((joint, index) => {
      const actual = [joint.p1!.x, joint.p1!.y, joint.p2!.x, joint.p2!.y];
      actual.forEach((coordinate, axis) => close(coordinate, expected[index][axis]));
    });
  }
});

test('grouped diagonal profiles keep their endpoints when clipped instead of becoming vertical', () => {
  const wall = wallWithPanel(2000, 2000);
  wall.joints = [
    { id: 'first', p1: { x: 0, y: 0 }, p2: { x: 1000, y: 1000 }, width: 3, isLED: false, orientation: 'DIAGONAL' },
    { id: 'second', p1: { x: 1000, y: 1000 }, p2: { x: 2000, y: 2000 }, width: 3, isLED: false, orientation: 'DIAGONAL' },
  ];
  for (const joint of wall.joints) {
    wall.customJoints[joint.id] = { id: joint.id, orientation: 'DIAGONAL', width: 3, isLED: false, groupId: 'group' };
  }
  wall.openings = [opening('middle', 800, 800, 400, 400)];
  const joints = LayoutEngine.calculateWallLayout(wall, sheet, [sheet]).joints.filter(j => j.groupId === 'group');
  assert.equal(joints.length, 2);
  assert.ok(joints.every(j => j.orientation === 'DIAGONAL'));
  close(joints[0].p2!.x, 800);
  close(joints[0].p2!.y, 800);
  close(joints[1].p1!.x, 1200);
  close(joints[1].p1!.y, 1200);
});

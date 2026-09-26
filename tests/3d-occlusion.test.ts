import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cameraDepth, clipHiddenFaces, hiddenFaceRegions, occludingFace, visibleFaceRegions, type DepthPoint } from '../src/core/geometry/FaceOcclusion';
import { wallOcclusionFaces, wallSurfaceSlices } from '../src/core/geometry/WallOcclusion';
import { buildWallPath, resolvePathBends, type WallPoint } from '../src/core/geometry/WallPath';
import { PolygonSlicingEngine } from '../src/core/geometry/PolygonSlicingEngine';
import { createDefaultWall } from '../src/core/models/Wall';
import type { Opening } from '../src/core/models/Opening';
import { close } from './helpers/business';

function quad(depth: number | ((x: number) => number), left = 0, right = 10): DepthPoint[] {
  return [[left, 0], [right, 0], [right, 10], [left, 10]].map(([x, y]) =>
    ({ x, y, depth: typeof depth === 'number' ? depth : depth(x) }));
}
const face = (points: DepthPoint[]) => occludingFace(points)!;
const contains = (regions: DepthPoint[][], x: number, y: number) =>
  regions.some(region => PolygonSlicingEngine.isPointInPolygon({ x, y }, region));
function project(p: WallPoint, angle = 0, elevation = 0): DepthPoint {
  const a = angle * Math.PI / 180, e = elevation * Math.PI / 180;
  return { x: p.x * Math.cos(a) - p.z * Math.sin(a),
    y: -p.y * Math.cos(e) + (p.x * Math.sin(a) + p.z * Math.cos(a)) * Math.sin(e),
    depth: cameraDepth(p, angle, elevation) };
}

test('a transparent face behind a solid wall is hidden, but a face in front stays visible', () => {
  const wall = face(quad(10));
  assert.ok(contains(hiddenFaceRegions(quad(0), [wall]), 5, 5));
  assert.deepEqual(hiddenFaceRegions(quad(20), [wall]), []);
  assert.deepEqual(hiddenFaceRegions(quad(10), [wall]), []);
});

test('only the overlapped portion is masked, including overlapping solid walls', () => {
  const regions = hiddenFaceRegions(quad(0), [face(quad(10, 4, 7)), face(quad(20, 6, 9))]);
  assert.equal(contains(regions, 2, 5), false);
  assert.equal(contains(regions, 5, 5), true);
  assert.equal(contains(regions, 6.5, 5), true);
  assert.equal(contains(regions, 8, 5), true);
});

test('intersecting faces are clipped at their depth crossing instead of sorting by their centers', () => {
  const regions = hiddenFaceRegions(quad(5), [face(quad(x => x))]);
  assert.equal(contains(regions, 3, 5), false);
  assert.equal(contains(regions, 8, 5), true);
});

test('a single visible mask subtracts the union of overlapping occluders without holes', () => {
  const occluders = [face(quad(10, 4, 7)), face(quad(20, 6, 9))];
  const regions = visibleFaceRegions(quad(0), occluders, 0)!;
  close(regions.reduce((sum, region) => sum + PolygonSlicingEngine.calculatePolygonArea(region), 0), 50);
  for (const [x, expected] of [[2, true], [5, false], [6.5, false], [8, false], [9.5, true]] as const) {
    assert.equal(regions.some(region => PolygonSlicingEngine.isPointInPolygon({ x, y: 5 }, region)), expected);
  }
  assert.deepEqual(visibleFaceRegions(quad(0), [face(quad(10))], 0), []);
  assert.equal(visibleFaceRegions(quad(20), occluders), null);
});

test('visibility masks agree with depth tests across slanted, reversed and overlapping faces', () => {
  const occluders = [face(quad(x => x * 2, 2, 8)), face(quad(10, 6, 9).reverse())];
  const hidden = hiddenFaceRegions(quad(5), occluders);
  const visible = visibleFaceRegions(quad(5), occluders, 0)!;
  for (let x = 0.25; x < 10; x += 0.5) for (let y = 0.25; y < 10; y += 0.5) {
    assert.equal(visible.some(region => PolygonSlicingEngine.isPointInPolygon({ x, y }, region)), !contains(hidden, x, y));
  }
});

test('drawing uses one local clip for many occluders, and no clip for an unobscured face', () => {
  let clips = 0;
  const ctx = { beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, clip() { clips++; } } as unknown as CanvasRenderingContext2D;
  const occluders = Array.from({ length: 30 }, (_, i) => face(quad(10 + i, 4, 7)));
  clipHiddenFaces(ctx, quad(0), occluders);
  assert.equal(clips, 1);
  clipHiddenFaces(ctx, quad(100), occluders);
  assert.equal(clips, 1);
});

test('camera depth respects rotation and elevation, including views from below', () => {
  close(cameraDepth({ x: 0, y: 0, z: 10 }, 0, 0), 10);
  close(cameraDepth({ x: 0, y: 0, z: 10 }, 180, 0), -10);
  close(cameraDepth({ x: 10, y: 0, z: 0 }, 90, 0), 10);
  assert.ok(cameraDepth({ x: 0, y: 10, z: 0 }, 0, 45) > 0);
  assert.ok(cameraDepth({ x: 0, y: 10, z: 0 }, 0, -45) < 0);
});

test('edge-on faces are harmless and leading collinear vertices still define a depth plane', () => {
  assert.equal(occludingFace([{ x: 0, y: 0, depth: 1 }, { x: 0, y: 1, depth: 2 }, { x: 0, y: 2, depth: 3 }]), null);
  const polygon = quad(10);
  polygon.splice(1, 0, { x: 5, y: 0, depth: 10 });
  assert.ok(contains(hiddenFaceRegions(quad(0), [face(polygon)]), 5, 5));
});

for (const type of ['PORTAL', 'DOOR', 'WINDOW'] as const) {
  test(`${type} openings remain visible through the wall, including legacy door portals`, () => {
    const wall = createDefaultWall('opening-wall');
    wall.width = 1000; wall.height = 1000;
    wall.openings = [{ id: 'opening', name: type, type, isPortal: type === 'DOOR',
      x: 400, y: 0, width: 200, height: 800, isCutout: true }];
    const path = buildWallPath(wall, []);
    const occluders = wallOcclusionFaces(wall, path.pathSections, 150).map(points => face(points.map(p => project(p))));
    const surface = [{ x: 0, y: 0, z: -300 }, { x: 1000, y: 0, z: -300 },
      { x: 1000, y: 1000, z: -300 }, { x: 0, y: 1000, z: -300 }].map(p => project(p));
    const regions = hiddenFaceRegions(surface, occluders.filter(Boolean));
    assert.equal(contains(regions, 200, -400), true);
    assert.equal(contains(regions, 500, -400), false);
    assert.equal(contains(regions, 500, -900), true);
  });
}

test('a niche and an empty panel retain the opaque wall backing', () => {
  const wall = createDefaultWall('niche-wall');
  wall.width = 1000; wall.height = 1000;
  wall.openings = [{ id: 'niche', name: 'Niche', type: 'NICHE', x: 400, y: 0,
    width: 200, height: 800, isCutout: true } satisfies Opening];
  const path = buildWallPath(wall, []);
  const occluders = wallOcclusionFaces(wall, path.pathSections, 150)
    .map(points => occludingFace(points.map(p => project(p)))).filter(p => p !== null);
  const surface = [{ x: 0, y: 0, z: -300 }, { x: 1000, y: 0, z: -300 },
    { x: 1000, y: 1000, z: -300 }, { x: 0, y: 1000, z: -300 }].map(p => project(p));
  const regions = hiddenFaceRegions(surface, occluders);
  assert.equal(contains(regions, 500, -400), true);
  assert.equal(contains(regions, 200, -400), true);
});

test('a single straight wall has both end caps and hides panels when viewed from behind', () => {
  const wall = createDefaultWall('straight');
  const path = buildWallPath(wall, []);
  const surfaces = wallOcclusionFaces(wall, path.pathSections, 150);
  assert.ok(surfaces.some(points => points.every(p => p.x === 0)));
  assert.ok(surfaces.some(points => points.every(p => p.x === wall.width)));
  for (const angle of [0, 180]) {
    const panel = [path.getPointAtS(0, 0, -5), path.getPointAtS(wall.width, 0, -5),
      path.getPointAtS(wall.width, wall.height, -5), path.getPointAtS(0, wall.height, -5)].map(p => project(p, angle));
    const regions = hiddenFaceRegions(panel, surfaces.map(points => occludingFace(points.map(p => project(p, angle)))).filter(p => p !== null));
    const center = project(path.getPointAtS(wall.width / 2, wall.height / 2, -5), angle);
    assert.equal(contains(regions, center.x, center.y), angle === 180);
  }
});

test('partial empty panels on bends share the wall tessellation without self-occlusion', () => {
  const wall = createDefaultWall('bend');
  wall.width = 2785;
  wall.bends = [{ id: 'bend', x: 1000, type: 'OUTER_CORNER', radius: 500, angleDeg: 90 }];
  const path = buildWallPath(wall, resolvePathBends(wall));
  const slices = wallSurfaceSlices(path.pathSections, [1123, 1377]);
  const surfaces = wallOcclusionFaces(wall, path.pathSections, 150, slices);
  const arc = path.pathSections.find(section => section.isBend)!;
  const local = slices.filter(s => s >= 1123 && s <= 1377);
  for (let i = 0; i < local.length - 1; i++) {
    const panel = [arc.getPoint(local[i], 0), arc.getPoint(local[i + 1], 0),
      arc.getPoint(local[i + 1], wall.height), arc.getPoint(local[i], wall.height)];
    const ownFace = surfaces.find(points => JSON.stringify(points) === JSON.stringify(panel));
    assert.ok(ownFace);
    const projected = panel.map(p => project(p, 39, 26));
    assert.deepEqual(hiddenFaceRegions(projected, [face(ownFace.map(p => project(p, 39, 26)))]), []);
  }
});

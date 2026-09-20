import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getPanelEdges, insetPanelEdges } from '../src/core/geometry/PanelEdges';
import { PolygonSlicingEngine as Geometry } from '../src/core/geometry/PolygonSlicingEngine';
import { LayoutEngine } from '../src/core/layout/LayoutEngine';
import { ProfileSpecificationEngine } from '../src/core/layout/ProfileSpecificationEngine';
import { useProjectStore } from '../src/application/stores/useProjectStore';
import { createDefaultProject } from '../src/core/models/Project';
import { createDefaultOpening } from '../src/core/models/Opening';
import { sheet, rectangle, wallWithPanel, close } from './helpers/business';

const triangle = [{ x: 100, y: 100 }, { x: 1100, y: 100 }, { x: 1100, y: 1100 }];
const wall = () => {
  const w = wallWithPanel(1500, 1500);
  w.panels![0].points = structuredClone(triangle);
  return w;
};

test('triangle inspector exposes exactly three real edges, including index zero and the diagonal', () => {
  const edges = getPanelEdges(triangle);
  assert.deepEqual(edges.map(e => e.key), [0, 1, 2]);
  assert.deepEqual(edges.map(e => e.label), ['Грань 1', 'Грань 2', 'Грань 3']);
  close(edges[2].length, Math.sqrt(2) * 1000);
  close(edges[2].angle, 45);
});

test('rotated and concave polygons expose their full contours rather than four bounding sides', () => {
  const diamond = [{ x: 0, y: 500 }, { x: 500, y: 0 }, { x: 1000, y: 500 }, { x: 500, y: 1000 }];
  assert.deepEqual(getPanelEdges(diamond).map(e => e.key), [0, 1, 2, 3]);
  const concave = [...rectangle(0, 0, 1000, 1000).slice(0, 3), { x: 500, y: 1000 }, { x: 500, y: 500 }, { x: 0, y: 500 }];
  assert.equal(getPanelEdges(concave).length, 6);
  const inset = insetPanelEdges(concave, { 3: { width: 10 } });
  close(inset[3].x, 510); close(inset[4].x, 510);
  assert.ok(Geometry.calculatePolygonArea(inset) < Geometry.calculatePolygonArea(concave));
});

for (const clockwise of [false, true]) {
  test(`diagonal gap is perpendicular and preserves the other contour lines (clockwise=${clockwise})`, () => {
    const points = clockwise ? [...triangle].reverse() : triangle;
    const edge = getPanelEdges(points).find(e => Math.abs(e.angle - 45) < 1e-5)!;
    const inset = insetPanelEdges(points, { [edge.index]: { width: 10 } });
    assert.equal(inset.length, 3);
    const shifted = getPanelEdges(inset).find(e => Math.abs(e.angle - 45) < 1e-5)!;
    close(Math.abs(shifted.p1.x - shifted.p1.y) / Math.sqrt(2), 10);
    close(Math.abs(shifted.p2.x - shifted.p2.y) / Math.sqrt(2), 10);
    assert.ok(inset.some(p => p.x === 1100 && p.y === 100));
    close(Geometry.calculatePolygonArea(inset), Math.pow(1000 - Math.sqrt(2) * 10, 2) / 2);
  });
}

test('rectangle side names remain compatible and numeric edge settings override the old names', () => {
  const points = rectangle(100, 100, 1000, 1000);
  const edges = getPanelEdges(points, { left: { width: 7 }, 3: { width: 12 } });
  assert.deepEqual(edges.map(e => e.key), ['bottom', 'right', 'top', 'left']);
  close(edges.find(e => e.key === 'left')!.config!.width, 12);
  const inset = insetPanelEdges(points, { left: { width: 10 }, top: { width: 20 } });
  assert.deepEqual(inset, rectangle(110, 100, 990, 980));
});

test('a nonexistent named triangle side never produces a phantom profile or moves a vertex', () => {
  const w = wall();
  w.panels![0].edges = { top: { width: 7, profileArticle: 'MC-06' } };
  const layout = LayoutEngine.calculateWallLayout(w, sheet, [sheet]);
  assert.deepEqual(layout.panels[0].polygonPoints, triangle);
  assert.equal(layout.joints.filter(j => j.profileArticle).length, 0);
});

test('diagonal edge profile follows its endpoints and is counted once even with a reversed cut line', () => {
  const w = wall();
  w.panels![0].edges = { 2: { width: 3, profileArticle: 'MC-06', profileColor: '#123456' } };
  w.joints = [{ id: 'cut', p1: triangle[0], p2: triangle[2], width: 0, isLED: false }];
  const layout = LayoutEngine.calculateWallLayout(w, sheet, [sheet]);
  const joints = layout.joints.filter(j => !j.isOuterEdge);
  assert.equal(joints.length, 1);
  assert.equal(joints[0].orientation, 'DIAGONAL');
  assert.deepEqual(joints[0].p1, triangle[2]);
  close(joints[0].p2!.x, triangle[0].x); close(joints[0].p2!.y, triangle[0].y);
  assert.deepEqual(joints[0].panelEdge, { panelId: 'panel-1', edge: 2 });
  close(joints[0].length, Math.sqrt(2) * 1000);
  const report = ProfileSpecificationEngine.calculateWallProfiles(w, sheet, [sheet]);
  close(report.items[0].totalLengthMm, Math.round(Math.sqrt(2) * 1000), 1);
  assert.equal(report.items[0].segmentsCount, 1);
});

test('clipped diagonal edge fragments keep their original editable edge', () => {
  const w = wall();
  w.panels![0].edges = { 2: { width: 0, profileArticle: 'MC-06' } };
  w.openings = [{ ...createDefaultOpening('WINDOW', 1500, 1500), x: 400, y: 400, width: 200, height: 200 }];
  const joints = LayoutEngine.calculateWallLayout(w, sheet, [sheet]).joints.filter(j => j.profileArticle);
  assert.equal(joints.length, 2);
  assert.ok(joints.every(j => j.panelEdge?.edge === 2 && j.panelEdge.panelId === 'panel-1'));
  close(joints.reduce((n, j) => n + j.length, 0), Math.sqrt(2) * 800);
});

test('editing an inherited rectangle edge retains its profile and removes a stale numeric override', () => {
  const original = useProjectStore.getState();
  try {
    const w = wallWithPanel(1000, 1000);
    w.panels![0].edges = { 3: { width: 3, profileArticle: 'MC-06' } };
    useProjectStore.setState({ project: { ...createDefaultProject(), materials: [sheet], walls: [w] } });
    useProjectStore.getState().setPanelEdgeWidth(w.id, 'panel-1', 'left', 8);
    const edges = useProjectStore.getState().project.walls[0].panels![0].edges!;
    assert.equal(edges[3], undefined);
    assert.equal(edges.left!.width, 8);
    assert.equal(edges.left!.profileArticle, 'MC-06');
  } finally { useProjectStore.setState(original); }
});

test('excessive inset removes a collapsed panel without infinite layout dimensions', () => {
  const w = wall();
  w.panels![0].edges = { 2: { width: 1000 } };
  assert.deepEqual(insetPanelEdges(triangle, w.panels![0].edges), []);
  assert.equal(LayoutEngine.calculateWallLayout(w, sheet, [sheet]).panels.length, 0);
});

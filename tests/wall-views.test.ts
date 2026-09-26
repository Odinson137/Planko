import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { useProjectStore } from '../src/application/stores/useProjectStore';
import { createDefaultProject } from '../src/core/models/Project';
import { DEFAULT_WALL_CAMERA, normalizeWallCamera, planWallViewPages, savedWallViews } from '../src/core/models/WallView';
import { LocalSQLiteRepository } from '../src/infrastructure/repositories/LocalSQLiteRepository';
import { wallViewPngNames } from '../src/application/services/WallViewExport';
import { createWall3DProjection, prepareWall3DScene, renderWall3DScene } from '../src/application/services/Wall3DScene';
import { PdfExportService } from '../src/application/services/PdfExportService';
import { sheet, wallWithPanel } from './helpers/business';

const original = useProjectStore.getState();
const storage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
beforeEach(() => {
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
  } });
  useProjectStore.setState({ ...original, isDirty: false, project: { ...createDefaultProject(),
    id: 'saved-views-project', selectedWallId: 'first', materials: [sheet],
    walls: [wallWithPanel(2000, 2500, 'first'), wallWithPanel(1000, 2500, 'second')] } });
});
afterEach(() => {
  useProjectStore.setState(original);
  if (storage) Object.defineProperty(globalThis, 'localStorage', storage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
});
const wall = (index = 0) => useProjectStore.getState().project.walls[index];

test('views belong to their wall, have unique names and IDs, and capture a camera snapshot', () => {
  const state = useProjectStore.getState();
  const camera = { angleDeg: -14, elevationDeg: 16 };
  const first = state.saveWallView('first', camera);
  camera.angleDeg = 99;
  const second = state.saveWallView('first', camera);
  state.saveWallView('second', { angleDeg: 45, elevationDeg: 35 });
  assert.notEqual(first, second);
  assert.deepEqual(savedWallViews(wall()).map(v => [v.name, v.angleDeg, v.elevationDeg]), [['Ракурс 1', -14, 16], ['Ракурс 2', 99, 16]]);
  assert.deepEqual(savedWallViews(wall(1)).map(v => v.name), ['Ракурс 1']);
  assert.equal(useProjectStore.getState().isDirty, true);
});

test('rename and delete preserve other views, angles and the collection of another wall', () => {
  const state = useProjectStore.getState();
  const first = state.saveWallView('first', DEFAULT_WALL_CAMERA)!;
  const second = state.saveWallView('first', { angleDeg: 70, elevationDeg: 20 })!;
  const third = state.saveWallView('first', { angleDeg: 90, elevationDeg: 0 })!;
  state.saveWallView('second', DEFAULT_WALL_CAMERA);
  const other = structuredClone(wall(1).savedViews);
  state.renameWallView('first', first, '  Общий вид  ');
  state.removeWallView('first', second);
  state.saveWallView('first', { angleDeg: 0, elevationDeg: 85 });
  assert.deepEqual(savedWallViews(wall()).map(v => v.name), ['Общий вид', 'Ракурс 3', 'Ракурс 4']);
  assert.deepEqual(savedWallViews(wall()).find(v => v.id === first), { id: first, name: 'Общий вид', ...DEFAULT_WALL_CAMERA });
  assert.ok(savedWallViews(wall()).some(v => v.id === third));
  assert.deepEqual(wall(1).savedViews, other);
});

test('invalid cameras and missing targets do not dirty or mutate the project', () => {
  const state = useProjectStore.getState();
  const before = structuredClone(state.project);
  assert.equal(state.saveWallView('first', { angleDeg: NaN, elevationDeg: 0 }), null);
  assert.equal(state.saveWallView('missing', DEFAULT_WALL_CAMERA), null);
  state.renameWallView('first', 'missing', 'Name');
  state.removeWallView('first', 'missing');
  assert.deepEqual(useProjectStore.getState().project, before);
  assert.equal(useProjectStore.getState().isDirty, false);
  assert.deepEqual(normalizeWallCamera({ angleDeg: 399.14, elevationDeg: -100 }), { angleDeg: 39.1, elevationDeg: -89 });
});

test('save/load, JSON import and duplication preserve both wall collections', async () => {
  const state = useProjectStore.getState();
  state.saveWallView('first', { angleDeg: -14, elevationDeg: 16 });
  state.saveWallView('first', { angleDeg: 135, elevationDeg: 29.5 });
  state.saveWallView('second', { angleDeg: 0, elevationDeg: 85 });
  const project = useProjectStore.getState().project;
  const repository = new LocalSQLiteRepository();
  await repository.saveProject(project);
  const saved = (await repository.getProject(project.id))!;
  const imported = await repository.importProjectFromJson(JSON.stringify(project));
  const duplicate = (await repository.duplicateProject(project.id))!;
  for (const restored of [saved, imported, duplicate]) {
    assert.deepEqual(restored.walls.map(savedWallViews), project.walls.map(savedWallViews));
  }
  duplicate.walls[0].savedViews!.pop();
  assert.equal(savedWallViews(project.walls[0]).length, 2);
});

test('export plans include every saved view in wall order and one default for legacy or empty collections', () => {
  const state = useProjectStore.getState();
  const first = state.saveWallView('first', { angleDeg: -14, elevationDeg: 16 })!;
  const second = state.saveWallView('first', { angleDeg: 90, elevationDeg: 0 })!;
  let pages = planWallViewPages(useProjectStore.getState().project.walls);
  assert.deepEqual(pages.map(p => [p.wall.id, p.view.id, p.wallNumber]), [['first', first, 1], ['first', second, 1], ['second', 'default', 2]]);
  assert.deepEqual({ angleDeg: pages[2].view.angleDeg, elevationDeg: pages[2].view.elevationDeg }, DEFAULT_WALL_CAMERA);
  state.removeWallView('first', first); state.removeWallView('first', second);
  pages = planWallViewPages(useProjectStore.getState().project.walls);
  assert.equal(pages.length, 2);
  assert.ok(pages.every(p => p.view.id === 'default'));
});

test('archive names are safe and unique even when view names repeat', () => {
  const state = useProjectStore.getState();
  const first = state.saveWallView('first', DEFAULT_WALL_CAMERA)!;
  const second = state.saveWallView('first', DEFAULT_WALL_CAMERA)!;
  for (const id of [first, second]) state.renameWallView('first', id, '../Фасад: общий\\вид');
  const names = wallViewPngNames(wall());
  assert.equal(new Set(names).size, 2);
  assert.ok(names.every(name => !/[\\/:]/.test(name) && name.endsWith('.png')));
});

test('PDF export renders each saved camera and numbers actual pages, including a wall without views', async t => {
  const state = useProjectStore.getState();
  state.saveWallView('first', { angleDeg: -14, elevationDeg: 16 });
  const second = state.saveWallView('first', { angleDeg: 39, elevationDeg: 26 })!;
  const rendered: { wall: string; angle: number; elevation: number; page: number; total: number }[] = [];
  t.mock.method(PdfExportService as any, 'renderAxonometric3DPage', (_ctx: unknown, _w: number, _h: number,
    _project: unknown, source: { id: string }, page: number, total: number, camera: { angleDeg: number; elevationDeg: number }) => {
    rendered.push({ wall: source.id, angle: camera.angleDeg, elevation: camera.elevationDeg, page, total });
  });
  t.mock.method(console, 'warn', () => undefined); // Photo loading is exercised by the browser fixture.
  const { jsPDF } = await import('jspdf');
  const api = jsPDF.API as unknown as { addImage: () => unknown };
  t.mock.method(api, 'addImage', function(this: unknown) { return this; });
  const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement: () => ({ getContext: () => ({}), toDataURL: () => '' }),
  } });
  try {
    const pdf = await PdfExportService.createAxonometric3DPdf(useProjectStore.getState().project);
    assert.equal(pdf.getNumberOfPages(), 3);
    assert.deepEqual(rendered, [
      { wall: 'first', angle: -14, elevation: 16, page: 1, total: 3 },
      { wall: 'first', angle: 39, elevation: 26, page: 2, total: 3 },
      { wall: 'second', angle: 34, elevation: 26, page: 3, total: 3 },
    ]);
    state.removeWallView('first', second); rendered.length = 0;
    const afterDelete = await PdfExportService.createAxonometric3DPdf(useProjectStore.getState().project);
    assert.equal(afterDelete.getNumberOfPages(), 2);
    assert.equal(rendered.length, 2);
    assert.ok(rendered.every(p => p.total === 2));
  } finally {
    if (documentDescriptor) Object.defineProperty(globalThis, 'document', documentDescriptor);
    else Reflect.deleteProperty(globalThis, 'document');
  }
});

test('exporting an empty project reports the missing wall instead of creating a blank page', async () => {
  await assert.rejects(PdfExportService.createAxonometric3DPdf({ ...createDefaultProject(), walls: [] }), /Добавьте стену/);
});

test('fitted camera keeps an entire bent wall in frame at extreme and saved angles', () => {
  const source = wallWithPanel(6570, 2750);
  source.planPose = { x: 5000, z: -3000, heading: 0.3 };
  source.bends = [{ id: 'a', x: 2000, radius: 500, angleDeg: 90, type: 'INNER_CORNER' },
    { id: 'b', x: 3785, radius: 500, angleDeg: 90, type: 'OUTER_CORNER' }];
  const scene = prepareWall3DScene(source, [sheet]);
  for (const angleDeg of [-180, -141, -14, 0, 39, 90, 180]) for (const elevationDeg of [-89, 0, 16, 26, 89]) {
    const projection = createWall3DProjection(scene, { angleDeg, elevationDeg }, 2400, 1800);
    assert.ok(projection.scale > 0 && Number.isFinite(projection.scale));
    for (const vertex of scene.boundsPoints) {
      const p = projection.project(vertex);
      assert.ok(p.x >= 0 && p.x <= 2400 && p.y >= 0 && p.y <= 1800);
    }
  }
});

test('rendering arbitrary views reuses the prepared scene and does not change saved angles', () => {
  const source = wall();
  source.savedViews = [{ id: 'a', name: 'Общий', angleDeg: 39, elevationDeg: 26 }];
  const before = structuredClone(source);
  const scene = prepareWall3DScene(source, [sheet]);
  let moves = 0;
  const ctx = new Proxy({ canvas: { width: 800, height: 600 } }, { get: (target, key) =>
    key === 'canvas' ? target.canvas : key === 'moveTo' ? () => { moves++; } : () => undefined,
    set: () => true }) as unknown as CanvasRenderingContext2D;
  renderWall3DScene(ctx, scene, source.savedViews[0], { textures: false });
  renderWall3DScene(ctx, scene, { angleDeg: -14, elevationDeg: 16 }, { textures: false });
  assert.ok(moves > 0);
  assert.deepEqual(source, before);
});

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { createDefaultOpening, ensureOpeningSlopes } from '../src/core/models/Opening';
import { createDefaultProject } from '../src/core/models/Project';
import { calculateSlopeGeometry, patchSlopeJoints, resolveSlopeJoints } from '../src/core/geometry/SlopeJointGeometry';
import { LayoutEngine } from '../src/core/layout/LayoutEngine';
import { ProfileSpecificationEngine } from '../src/core/layout/ProfileSpecificationEngine';
import { slopeFaceVertices, drawOpeningSlopes } from '../src/application/services/SlopeDrawing';
import { useProjectStore } from '../src/application/stores/useProjectStore';
import { useSlopeJointStore } from '../src/application/stores/useSlopeJointStore';
import { LocalSQLiteRepository } from '../src/infrastructure/repositories/LocalSQLiteRepository';
import { sheet, wallWithPanel, close } from './helpers/business';

const windowOpening = () => ({ ...createDefaultOpening('WINDOW', 2000, 2500), x: 100, y: 400, width: 1200, height: 1400, depth: 300 });
const originalProject = useProjectStore.getState(), originalEditor = useSlopeJointStore.getState();
afterEach(() => { useProjectStore.setState(originalProject); useSlopeJointStore.setState(originalEditor); });

test('each corner preserves the full independent set of panel profile settings', () => {
  const before = windowOpening();
  const op = patchSlopeJoints(before, 'top-left', { width: .8, takeSide: 'FIRST', profileArticle: 'MC-06-7', profileColor: '#c9a25b' });
  const selected = resolveSlopeJoints(op)['top-left'];
  assert.deepEqual(selected, { width: .8, takeSide: 'FIRST', profileArticle: 'MC-06-7', profileColor: '#c9a25b', isLED: false });
  assert.equal(resolveSlopeJoints(op)['top-right'].profileArticle, undefined);
  assert.equal(before.slopes!.joints, undefined);
  assert.equal(calculateSlopeGeometry(op).joints[0].visibleWidth, 7);
  assert.equal(ensureOpeningSlopes(op).joints?.['top-left']?.profileArticle, 'MC-06-7');
});

test('model changes, clearing and explicit LED preserve gap and take side', () => {
  let op = patchSlopeJoints(windowOpening(), 'top-left', { width: 2.5, takeSide: 'SECOND' });
  op = patchSlopeJoints(op, 'top-left', { profileArticle: 'DL-13' });
  assert.equal(resolveSlopeJoints(op)['top-left'].isLED, true);
  op = patchSlopeJoints(op, 'top-left', { profileArticle: '' });
  assert.equal(resolveSlopeJoints(op)['top-left'].isLED, false);
  op = patchSlopeJoints(op, 'top-left', { isLED: true });
  assert.equal(resolveSlopeJoints(op)['top-left'].width, 2.5);
  assert.equal(resolveSlopeJoints(op)['top-left'].takeSide, 'SECOND');
  assert.equal(resolveSlopeJoints(op)['top-left'].isLED, true);
});

test('symmetric and one-sided allowances cut the actual slope parts without cumulative drift', () => {
  const source = windowOpening();
  const one = patchSlopeJoints(source, 'top-left', { width: 8 });
  const both = calculateSlopeGeometry(one);
  assert.equal(both.faces.top.length, 1196);
  assert.equal(both.faces.left.length, 1396);
  assert.equal(both.faces.left.endInset, 4);
  const first = patchSlopeJoints(one, 'top-left', { takeSide: 'FIRST' });
  assert.equal(calculateSlopeGeometry(first).faces.top.length, 1192);
  assert.equal(calculateSlopeGeometry(first).faces.left.length, 1400);
  const wall = wallWithPanel(); wall.openings = [first];
  const layout = LayoutEngine.calculateWallLayout(wall, sheet, [sheet]);
  const top = layout.slopes!.find(s => s.side === 'TOP')!;
  assert.equal(top.width, 1192);
  close(top.areaSqM, 1192 * 300 / 1e6);
  const vertices = slopeFaceVertices(first, top);
  assert.equal(vertices[0].x, first.x + 8);
  assert.equal(vertices[1].x - vertices[0].x, top.width);
  assert.equal(vertices[3].z - vertices[0].z, top.depth);
  const reset = patchSlopeJoints(first, 'top-left', { width: 0 });
  assert.equal(calculateSlopeGeometry(reset).faces.top.length, source.width);
});

test('both ends and all corners apply exactly once and preserve the opening contour', () => {
  const op = patchSlopeJoints(windowOpening(), 'top-left', { width: 8, profileArticle: 'MC-02' }, true);
  const faces = calculateSlopeGeometry(op).faces;
  assert.equal(faces.top.length, 1192);
  assert.equal(faces.bottom.length, 1192);
  assert.equal(faces.left.length, 1392);
  assert.equal(op.width, 1200);
  assert.equal(op.height, 1400);
  assert.equal(patchSlopeJoints(op, 'top-left', {}, true).width, op.width);
});

test('different depths use their physical overlap, including protruding sides', () => {
  const op = windowOpening();
  Object.assign(op.slopes!, { fitToOpeningDepth: false, depthMode: 'CUSTOM' });
  op.slopes!.top.depth = 200;
  op.slopes!.left.depth = 450;
  const j = calculateSlopeGeometry(patchSlopeJoints(op, 'top-left', { profileArticle: 'MC-02' })).joints[0];
  assert.equal(j.zStart, 0);
  assert.equal(j.zEnd, 200);
  assert.equal(j.length, 200);
  op.slopes!.top.depth = 400;
  const protruding = calculateSlopeGeometry(op).joints[0];
  assert.equal(protruding.zStart, -100);
  assert.equal(protruding.zEnd, 300);
  assert.equal(protruding.length, 400);
});

test('disabled and zero-depth sides cannot receive or contribute profiles', () => {
  let op = patchSlopeJoints(windowOpening(), 'top-left', { profileArticle: 'MC-02' }, true);
  op.slopes!.left.enabled = false;
  assert.equal(calculateSlopeGeometry(op).joints.filter(j => j.available).length, 2);
  assert.equal(patchSlopeJoints(op, 'top-left', { width: 10 }), op);
  op = patchSlopeJoints(op, 'top-right', { profileArticle: 'DL-13' }, true);
  assert.equal(resolveSlopeJoints(op)['top-left'].profileArticle, 'MC-02');
  op.depth = 0;
  assert.equal(calculateSlopeGeometry(op).joints.filter(j => j.available).length, 0);
  const wall = wallWithPanel(); wall.openings = [op];
  assert.equal(ProfileSpecificationEngine.calculateWallProfiles(wall, sheet, [sheet]).totalStockBars, 0);
});

test('doors have only two corner joints and settings survive depth/size/position edits', () => {
  const door = createDefaultOpening('DOOR', 2000, 2500);
  let op = patchSlopeJoints(door, 'top-left', { profileArticle: 'MC-02', width: 1.5 }, true);
  assert.deepEqual(calculateSlopeGeometry(op).joints.filter(j => j.available).map(j => j.corner), ['top-left', 'top-right']);
  const ids = calculateSlopeGeometry(op).joints.map(j => j.id);
  op = { ...op, x: 400, y: 20, width: 1300, depth: 250 };
  const result = calculateSlopeGeometry(op);
  assert.deepEqual(result.joints.map(j => j.id), ids);
  assert.equal(result.joints[0].length, 250);
  assert.equal(result.joints[0].x, 400);
  assert.equal(result.faces.top.length, 1298.5);
});

test('invalid gaps and destructive allowances are rejected atomically', () => {
  const op = windowOpening(), before = structuredClone(op);
  for (const width of [-1, 101, NaN, Infinity]) assert.throws(() => patchSlopeJoints(op, 'top-left', { width }));
  op.width = 8;
  assert.throws(() => patchSlopeJoints(op, 'top-left', { width: 8 }, true), /полностью/);
  assert.deepEqual({ ...op, width: before.width }, before);
});

test('legacy settings migrate to individual articles without silently cutting existing parts', () => {
  const op = windowOpening(); op.slopes!.jointProfileType = 'JOINT_3';
  const before = structuredClone(op);
  assert.ok(Object.values(resolveSlopeJoints(op)).every(j => j.profileArticle === 'MC-06' && j.width === 0));
  assert.equal(calculateSlopeGeometry(op).faces.top.length, op.width);
  assert.deepEqual(op, before);
  const edited = patchSlopeJoints(op, 'top-left', { profileArticle: '' });
  assert.equal(resolveSlopeJoints(edited)['top-left'].profileArticle, undefined);
  assert.equal(resolveSlopeJoints(edited)['top-right'].profileArticle, 'MC-06');
});

test('shrinking a configured opening excludes impossible parts and tracks until its gaps are repaired', () => {
  let op = patchSlopeJoints(windowOpening(), 'top-left', { width: 20, takeSide: 'FIRST', profileArticle: 'MC-02' });
  op = { ...op, width: 15 };
  const wall = wallWithPanel(); wall.openings = [op];
  const layout = LayoutEngine.calculateWallLayout(wall, sheet, [sheet]);
  assert.equal(layout.slopes!.some(s => s.side === 'TOP'), false);
  assert.equal(layout.slopeJoints!.some(j => j.corner === 'top-left'), false);
  assert.equal(ProfileSpecificationEngine.calculateWallProfiles(wall, sheet, [sheet]).items.some(i => i.article === 'MC-02'), false);
  const repaired = patchSlopeJoints(op, 'top-left', { width: 2 });
  assert.equal(calculateSlopeGeometry(repaired).faces.top.length, 13);
  assert.equal(resolveSlopeJoints(repaired)['top-left'].profileArticle, 'MC-02');
});

test('specification separates variants and colors and never depends on facade framing presence', () => {
  let op = patchSlopeJoints(windowOpening(), 'top-left', { profileArticle: 'MC-06-7', profileColor: '#c9a25b', width: .8 });
  op = patchSlopeJoints(op, 'top-right', { profileArticle: 'MC-06-7', profileColor: '#212529', width: 0 });
  delete op.framing;
  const wall = wallWithPanel(); wall.openings = [op];
  const layout = LayoutEngine.calculateWallLayout(wall, sheet, [sheet]);
  const report = ProfileSpecificationEngine.calculateWallProfiles(wall, sheet, [sheet]);
  const profiles = report.items.filter(i => i.article === 'MC-06-7');
  assert.equal(profiles.length, 2);
  assert.ok(profiles.every(i => i.visibleWidth === 7 && i.metalThickness === .8 && i.totalLengthMm === 300));
  close(layout.summary.slopeProfileLinearMeters!, .6);
});

test('3D renderer uses depth-directed tracks and matching trimmed faces', () => {
  const op = patchSlopeJoints(windowOpening(), 'top-left', { width: 8, profileArticle: 'DL-13' });
  const wall = wallWithPanel(); wall.openings = [op];
  const layout = LayoutEngine.calculateWallLayout(wall, sheet, [sheet]);
  const projected: Array<{ x: number; y: number; z: number }> = [];
  const ctx = new Proxy({}, { get: () => () => {}, set: () => true }) as CanvasRenderingContext2D;
  drawOpeningSlopes(ctx, op, layout.slopes!, layout.slopeJoints!, p => { projected.push(p); return { x: p.x + p.z, y: p.y }; }, { textures: false, profiles: true });
  const a = projected[projected.length - 2], b = projected[projected.length - 1];
  assert.equal(a.x, b.x); assert.equal(a.y, b.y);
  assert.equal(b.z - a.z, 300);
});

test('batch edit is one undo step, preserves later dimensions, and redo restores all settings', () => {
  const wall = wallWithPanel(), op = windowOpening(); wall.openings = [op];
  useProjectStore.setState({ project: { ...createDefaultProject(), walls: [wall], materials: [sheet] }, isDirty: false });
  const editor = useSlopeJointStore.getState();
  editor.change(wall.id, op.id, 'top-left', { width: 8, profileArticle: 'MC-02', profileColor: '#c9a25b', takeSide: 'FIRST' }, true);
  assert.equal(useSlopeJointStore.getState().past.length, 1);
  assert.equal(useProjectStore.getState().isDirty, true);
  useProjectStore.getState().updateOpening(wall.id, { id: op.id, width: 1500 });
  editor.undo();
  const undone = useProjectStore.getState().project.walls[0].openings[0];
  assert.equal(undone.width, 1500);
  assert.ok(Object.values(resolveSlopeJoints(undone)).every(j => !j.profileArticle));
  editor.redo();
  const redone = useProjectStore.getState().project.walls[0].openings[0];
  assert.ok(Object.values(resolveSlopeJoints(redone)).every(j => j.profileColor === '#c9a25b' && j.width === 8 && j.takeSide === 'FIRST'));
});

test('selecting a corner does not dirty the project; failed batch leaves geometry and history intact', () => {
  const wall = wallWithPanel(), op = { ...windowOpening(), width: 8 }; wall.openings = [op];
  useProjectStore.setState({ project: { ...createDefaultProject(), walls: [wall], materials: [sheet] }, isDirty: false });
  useSlopeJointStore.getState().select(wall.id, op.id, 'top-right');
  assert.equal(useProjectStore.getState().isDirty, false);
  useSlopeJointStore.getState().change(wall.id, op.id, 'top-right', { width: 8 }, true);
  assert.match(useSlopeJointStore.getState().error!, /полностью/);
  assert.equal(useSlopeJointStore.getState().past.length, 0);
  assert.equal(useProjectStore.getState().isDirty, false);
});

test('repository save/load and JSON import retain all corner settings', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key), key: (i: number) => [...data.keys()][i], get length() { return data.size; },
  } });
  try {
    const repository = new LocalSQLiteRepository(), wall = wallWithPanel();
    wall.openings = [patchSlopeJoints(windowOpening(), 'bottom-right', { profileArticle: 'MC-06-7', profileColor: '#b76e79', width: 2.5, takeSide: 'SECOND' })];
    const project = { ...createDefaultProject(), walls: [wall], materials: [sheet] };
    await repository.saveProject(project);
    const loaded = await repository.getProject(project.id);
    const imported = await repository.importProjectFromJson(JSON.stringify(project));
    assert.deepEqual(resolveSlopeJoints(loaded!.walls[0].openings[0]), resolveSlopeJoints(wall.openings[0]));
    assert.deepEqual(resolveSlopeJoints(imported.walls[0].openings[0]), resolveSlopeJoints(wall.openings[0]));
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

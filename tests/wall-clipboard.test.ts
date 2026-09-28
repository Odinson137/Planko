import assert from 'node:assert/strict';
import { beforeEach, afterEach, test } from 'node:test';
import { copyWallObjects, clipboardAt, pasteWallObjects, clipboardPlacementError } from '../src/application/services/WallClipboard';
import { useClipboardStore } from '../src/application/stores/useClipboardStore';
import { useProjectStore } from '../src/application/stores/useProjectStore';
import { createDefaultProject } from '../src/core/models/Project';
import { createDefaultOpening } from '../src/core/models/Opening';
import { cutPanelOnWall } from '../src/core/geometry/PanelCutEngine';
import { PolygonSlicingEngine as Geometry } from '../src/core/geometry/PolygonSlicingEngine';
import { polygonsSeparated } from '../src/core/geometry/PolygonCollision';
import { clipboardShortcut } from '../src/application/commands/ClipboardShortcut';
import { MATERIAL_NONE_ID } from '../src/core/models/Material';
import { rectangle, sheet, wallWithPanel, close } from './helpers/business';

const original = useProjectStore.getState();
const originalClipboard = useClipboardStore.getState();
const wall = () => useProjectStore.getState().project.walls[0];
beforeEach(() => {
  useProjectStore.setState(original);
  const w = wallWithPanel();
  useProjectStore.getState().setProject({ ...createDefaultProject(), walls: [w], materials: [sheet], selectedWallId: w.id });
  useClipboardStore.setState({ ...originalClipboard, content: null, preview: null });
});
afterEach(() => { useProjectStore.setState(original); useClipboardStore.setState(originalClipboard); });

for (const type of ['DOOR', 'WINDOW'] as const) {
  test(`${type} apply uses the physical cut and can be repeated without changing the result`, () => {
    const store = useProjectStore.getState();
    store.addOpening(wall().id, type);
    const id = wall().openings[0].id;
    store.updateOpening(wall().id, { id, x: 100, y: type === 'DOOR' ? 0 : 600, width: 400, height: 500 });
    store.applyOpening(wall().id, id);
    close(wall().panels!.reduce((sum, panel) => sum + Geometry.calculatePolygonArea(panel.points), 0), 4_800_000);
    const once = structuredClone(wall()), history = useProjectStore.getState().history.past.length;
    store.applyOpening(wall().id, id);
    assert.deepEqual(wall(), once);
    assert.equal(useProjectStore.getState().history.past.length, history);
  });
}

test('apply cuts material even when an opening is already marked applied and preserves existing joints', () => {
  const store = useProjectStore.getState();
  store.addOpening(wall().id, 'DOOR');
  const id = wall().openings[0].id;
  store.updateOpening(wall().id, { id, x: 100, y: 0, width: 400, height: 500, isApplied: true });
  const joints = [{ id: 'joint-op-other-top', p1: { x: 1000, y: 2000 }, p2: { x: 1400, y: 2000 }, width: 10,
    orientation: 'HORIZONTAL' as const, isLED: false, profileArticle: 'MC-05' }];
  store.updateWall(wall().id, { joints });
  store.applyOpening(wall().id, id);
  close(wall().panels!.reduce((sum, panel) => sum + Geometry.calculatePolygonArea(panel.points), 0), 4_800_000);
  assert.deepEqual(wall().joints, joints);
});
function addWindow() {
  const store = useProjectStore.getState();
  store.addOpening(wall().id, 'WINDOW');
  const id = wall().openings[0].id;
  store.updateOpening(wall().id, { id, x: 100, y: 600, width: 400, height: 500 });
  store.applyOpening(wall().id, id);
  return id;
}

test('copy is a snapshot; paste regenerates identity, preserves settings and cannot overlap the source', () => {
  const id = addWindow(), store = useProjectStore.getState();
  store.updateOpening(wall().id, { id, depth: 345 });
  const content = copyWallObjects('p', wall(), [sheet], [id], [])!;
  store.updateOpening(wall().id, { id, depth: 100 });
  assert.ok(clipboardPlacementError(wall(), content, [sheet]));
  const placed = clipboardAt(content, { x: 1100, y: 600 });
  const pasted = pasteWallObjects(wall(), placed, [sheet]);
  const op = pasted.wall.openings[1];
  assert.notEqual(op.id, id); assert.equal(op.depth, 345); assert.equal(op.isApplied, false);
  assert.notEqual(op.slopes, wall().openings[0].slopes);
});

test('clipboard preview and Escape do not alter project or history; paste and undo are atomic', () => {
  const id = addWindow(), store = useProjectStore.getState(), clipboard = useClipboardStore.getState();
  store.selectOpening(id);
  assert.ok(clipboard.copy());
  const snapshot = structuredClone(useProjectStore.getState().project), history = useProjectStore.getState().history.past.length;
  clipboard.beginPaste(); clipboard.move({ x: 1100, y: 600 }); clipboard.cancel();
  assert.deepEqual(useProjectStore.getState().project, snapshot);
  assert.equal(useProjectStore.getState().history.past.length, history);
  clipboard.beginPaste(); clipboard.move({ x: 1100, y: 600 }); assert.ok(clipboard.place());
  assert.equal(wall().openings.length, 2); assert.equal(useProjectStore.getState().history.past.length, history + 1);
  store.undo(); assert.equal(wall().openings.length, 1);
  store.redo(); assert.equal(wall().openings.length, 2);
});

test('group copy keeps relative positions on another wall and rejects an undersized wall', () => {
  const a = { ...createDefaultOpening('WINDOW', 2000, 2500), x: 100, y: 500, width: 300, height: 400 };
  const b = { ...a, id: 'second', x: 700, y: 800 };
  const source = { ...wall(), openings: [a, b] };
  const content = copyWallObjects('p', source, [sheet], [a.id, b.id], [])!;
  const moved = clipboardAt(content, { x: 500, y: 1000 });
  const target = pasteWallObjects({ ...wall(), id: 'other' }, moved, [sheet]).wall;
  assert.deepEqual(target.openings.map(op => [op.x, op.y]), [[500, 1000], [1100, 1300]]);
  assert.ok(clipboardPlacementError({ ...wall(), width: 500 }, moved, [sheet]));
});

test('multiple selected openings paste onto another wall as one undo action', () => {
  const store = useProjectStore.getState(), clipboard = useClipboardStore.getState();
  const a = { ...createDefaultOpening('WINDOW', 2000, 2500), x: 100, y: 500, width: 300, height: 400 };
  const b = { ...a, id: 'second', x: 700, y: 800 };
  const source = { ...wall(), openings: [a, b] }, target = { ...wall(), id: 'other', openings: [] };
  store.setProject({ ...store.project, walls: [source, target], selectedWallId: source.id });
  store.selectOpening(a.id); store.selectOpening(b.id, true);
  assert.deepEqual(useProjectStore.getState().selectedOpeningIds, [a.id, b.id]);
  assert.ok(clipboard.copy());
  store.selectWall(target.id);
  const beforePanels = structuredClone(useProjectStore.getState().project.walls[1].panels);
  const history = useProjectStore.getState().history.past.length;
  clipboard.beginPaste(); clipboard.move({ x: 500, y: 1000 }); assert.ok(clipboard.place());
  const inserted = useProjectStore.getState().project.walls[1];
  assert.deepEqual(inserted.openings.map(op => [op.x, op.y, op.isApplied]), [[500, 1000, false], [1100, 1300, false]]);
  assert.deepEqual(inserted.panels, beforePanels, 'placement waits for the manual Apply button');
  assert.equal(useProjectStore.getState().history.past.length, history + 1);
  store.undo(); assert.equal(useProjectStore.getState().project.walls[1].openings.length, 0);
  store.redo(); assert.equal(useProjectStore.getState().project.walls[1].openings.length, 2);
});

test('panel groups preserve their relative geometry and create independent joint groups on another wall', () => {
  const source = cutPanelOnWall(wallWithPanel(800, 500), [sheet], wall().panels![0].id, { x: 400, y: 0 }, { x: 400, y: 500 })!;
  source.joints!.forEach(joint => { joint.groupId = 'source-group'; joint.profileArticle = 'MC-05'; });
  const content = copyWallObjects('p', source, [sheet], [], source.panels!.map(panel => panel.id))!;
  const target = { ...wall(), id: 'target', panels: [{ ...wall().panels![0], materialId: MATERIAL_NONE_ID, isVoid: true }] };
  const result = pasteWallObjects(target, clipboardAt(content, { x: 900, y: 600 }), [sheet]);
  const inserted = result.wall.panels!.filter(panel => result.ids.includes(panel.id));
  assert.equal(inserted.length, 2);
  assert.deepEqual(inserted.map(panel => panel.points), source.panels!.map(panel => panel.points.map(p => ({ x: p.x + 900, y: p.y + 600 }))));
  assert.equal(result.wall.joints!.length, 1);
  assert.notEqual(result.wall.joints![0].groupId, 'source-group');
  assert.equal(result.wall.joints![0].profileArticle, 'MC-05');
  assert.deepEqual(source.panels!.map(panel => panel.materialId), [sheet.id, sheet.id]);
});

test('panel paste cuts only void cells, preserves total area, material, shape and source independence', () => {
  const source = { ...wallWithPanel(), panels: [{ ...wall().panels![0], points: rectangle(0, 0, 400, 500), note: 'copy me' }] };
  const content = copyWallObjects('p', source, [sheet], [], [source.panels![0].id])!;
  const target = { ...wallWithPanel(), panels: [{ ...wall().panels![0], materialId: MATERIAL_NONE_ID, isVoid: true }] };
  const result = pasteWallObjects(target, clipboardAt(content, { x: 900, y: 600 }), [sheet]);
  const pasted = result.wall.panels!.find(p => result.ids.includes(p.id))!;
  assert.equal(pasted.note, 'copy me'); assert.equal(pasted.materialId, sheet.id);
  assert.deepEqual(pasted.points, rectangle(900, 600, 400, 500));
  close(result.wall.panels!.reduce((sum, p) => sum + Geometry.calculatePolygonArea(p.points), 0), 5_000_000);
  close(result.wall.panels!.filter(p => p.isVoid).reduce((sum, p) => sum + Geometry.calculatePolygonArea(p.points), 0), 4_800_000);
  assert.ok(clipboardPlacementError(source, content, [sheet]));
});

test('physical clipboard shortcuts work with Cyrillic, preserve text modifiers and ignore handled events', () => {
  const event = { code: 'KeyC', key: 'с', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false, isComposing: false, defaultPrevented: false };
  assert.equal(clipboardShortcut(event), 'copy');
  assert.equal(clipboardShortcut({ ...event, code: 'KeyV', key: 'м' }), 'paste');
  assert.equal(clipboardShortcut({ ...event, code: 'KeyD', key: 'в' }), 'duplicate');
  assert.equal(clipboardShortcut({ ...event, shiftKey: true }), null);
  assert.equal(clipboardShortcut({ ...event, defaultPrevented: true }), null);
});

for (const shape of [
  [{ x: 0, y: 0 }, { x: 500, y: 0 }, { x: 200, y: 500 }],
  [{ x: 0, y: 0 }, { x: 500, y: 0 }, { x: 500, y: 200 }, { x: 200, y: 200 }, { x: 200, y: 500 }, { x: 0, y: 500 }],
]) {
  test(`pasting a ${shape.length}-vertex panel preserves free space without overlaps`, () => {
    const source = { ...wall(), panels: [{ ...wall().panels![0], points: shape }] };
    const content = copyWallObjects('p', source, [sheet], [], [source.panels[0].id])!;
    const target = { ...wall(), panels: [{ ...wall().panels![0], materialId: MATERIAL_NONE_ID, isVoid: true }] };
    const result = pasteWallObjects(target, clipboardAt(content, { x: 800, y: 900 }), [sheet]).wall;
    const pasted = result.panels!.find(p => !p.isVoid)!;
    close(result.panels!.reduce((sum, p) => sum + Geometry.calculatePolygonArea(p.points), 0), 5_000_000);
    assert.ok(result.panels!.filter(p => p.isVoid).every(p => polygonsSeparated(p.points, pasted.points, 0)));
  });
}


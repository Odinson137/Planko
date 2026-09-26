import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { HISTORY_LIMIT, projectContent } from '../src/application/commands/ProjectHistory';
import { historyShortcut } from '../src/application/commands/HistoryShortcut';
import { useProjectStore } from '../src/application/stores/useProjectStore';
import { useWallEditorStore } from '../src/application/stores/useWallEditorStore';
import { useSlopeJointStore } from '../src/application/stores/useSlopeJointStore';
import { usePanelCutStore } from '../src/application/stores/usePanelCutStore';
import { useEditorStore } from '../src/application/stores/useEditorStore';
import { createDefaultProject } from '../src/core/models/Project';
import { createDefaultOpening } from '../src/core/models/Opening';
import { localProjectRepository } from '../src/infrastructure/repositories/LocalSQLiteRepository';
import { localCatalogRepository } from '../src/infrastructure/repositories/LocalCatalogRepository';
import { sheet, wallWithPanel } from './helpers/business';

const original = useProjectStore.getState();
const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const store = () => useProjectStore.getState();
const content = () => structuredClone(projectContent(store().project));
beforeEach(() => {
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() { return data.size; },
  } });
  const wall = wallWithPanel(1000, 1000, 'wall');
  wall.openings = [{ ...createDefaultOpening('WINDOW', 1000, 1000), id: 'opening', width: 300, height: 300, x: 100, y: 100 }];
  store().setProject({ ...createDefaultProject('History'), id: 'history-project',
    walls: [wall, wallWithPanel(2000, 2500, 'other-wall')], materials: [sheet] });
});
afterEach(() => {
  store().endHistoryGroup();
  useProjectStore.setState(original);
  if (storageDescriptor) Object.defineProperty(globalThis, 'localStorage', storageDescriptor);
  else Reflect.deleteProperty(globalThis, 'localStorage');
});

test('mixed edits across modes and walls undo and redo exactly in chronological order', () => {
  const snapshots = [content()];
  const wallEditor = useWallEditorStore.getState();
  wallEditor.syncTarget(store().project.id, 'wall');
  wallEditor.begin('end');
  assert.equal(wallEditor.extend(1000, 0), true);
  snapshots.push(content());
  const cut = usePanelCutStore.getState();
  cut.begin('wall', 'panel-1');
  cut.setPoint('p1', { x: 600, y: 0 }); cut.setPoint('p2', { x: 600, y: 1000 });
  assert.equal(cut.apply(), true);
  snapshots.push(content());
  useSlopeJointStore.getState().change('wall', 'opening', 'top-left', { width: 3, profileArticle: 'MC-02' }, true);
  snapshots.push(content());
  store().updateOpening('wall', { id: 'opening', x: 200 });
  snapshots.push(content());
  store().selectWall('other-wall');
  useEditorStore.getState().setViewMode('3D');
  store().updateWallName('other-wall', 'Second wall');
  snapshots.push(content());
  assert.equal(store().history.past.length, snapshots.length - 1);
  for (let i = snapshots.length - 2; i >= 0; i--) {
    assert.equal(store().undo(), true);
    assert.deepEqual(content(), snapshots[i]);
  }
  assert.equal(store().undo(), false);
  assert.equal(store().isDirty, false);
  for (const snapshot of snapshots.slice(1)) {
    assert.equal(store().redo(), true);
    assert.deepEqual(content(), snapshot);
  }
  assert.equal(store().redo(), false);
});

test('selection, camera, no-op and invalid operations keep redo available', () => {
  store().setProjectName('Edited'); store().undo();
  store().selectWall('other-wall'); store().selectOpening(null);
  useEditorStore.getState().setZoom(2); useEditorStore.getState().setEditMode('WALLS');
  store().updateWall('other-wall', { name: store().project.walls[1].name });
  store().setProjectName('History'); store().addOpening('missing', 'DOOR');
  assert.equal(store().canUndo, false);
  assert.equal(store().canRedo, true);
  assert.equal(store().isDirty, false);
  store().redo(); assert.equal(store().project.name, 'Edited');
  store().undo(); store().setProjectName('Different');
  assert.equal(store().canRedo, false);
});

test('continuous inputs and a multi-action edit each make one undo step', () => {
  const before = content();
  store().beginHistoryGroup();
  for (const x of [1, 12, 123]) store().updateOpening('wall', { id: 'opening', x });
  store().endHistoryGroup();
  assert.equal(store().history.past.length, 1);
  store().withHistoryGroup(() => {
    store().updateWallName('wall', 'First');
    store().updateWallName('other-wall', 'Second');
  });
  assert.equal(store().history.past.length, 2);
  store().undo();
  assert.equal(store().project.walls[0].openings[0].x, 123);
  store().undo(); assert.deepEqual(content(), before);
  store().redo(); store().redo();
  assert.deepEqual(store().project.walls.map(wall => wall.name), ['First', 'Second']);
});

test('a gesture returning to its starting value leaves no empty history step', () => {
  store().beginHistoryGroup();
  store().setProjectName('Temporary'); store().setProjectName('History');
  store().endHistoryGroup();
  assert.equal(store().canUndo, false);
  assert.equal(store().isDirty, false);
});

test('nested batch operations stay one action', () => {
  const before = content();
  store().withHistoryGroup(() => {
    store().setProjectName('Batch');
    store().withHistoryGroup(() => store().updateWallName('wall', 'Nested'));
    store().updateWallName('other-wall', 'Last');
  });
  assert.equal(store().history.past.length, 1);
  store().undo(); assert.deepEqual(content(), before);
});

test('saving during focused input separates later typing into a new complete step', async () => {
  store().beginHistoryGroup();
  store().setProjectName('Saved input');
  await store().saveCurrentProject();
  store().setProjectName('Saved input a');
  store().setProjectName('Saved input ab');
  store().endHistoryGroup();
  assert.equal(store().history.past.length, 2);
  store().undo();
  assert.equal(store().project.name, 'Saved input');
  assert.equal(store().isDirty, false);
});

test('save keeps both history directions and tracks the saved content through undo/redo', async () => {
  store().setProjectName('Saved');
  await store().saveCurrentProject();
  assert.equal(store().canUndo, true);
  store().undo(); assert.equal(store().isDirty, true);
  store().redo(); assert.equal(store().isDirty, false);
  store().setProjectName('Later'); store().undo();
  await store().saveCurrentProject();
  assert.equal(store().canRedo, true);
  store().redo(); assert.equal(store().isDirty, true);
  store().undo(); assert.equal(store().isDirty, false);
});

test('undo during asynchronous save marks the saved snapshot rather than the current state', async t => {
  let finish!: () => void;
  t.mock.method(localProjectRepository, 'saveProject', () => new Promise<void>(resolve => { finish = resolve; }));
  store().setProjectName('Being saved');
  const pending = store().saveCurrentProject();
  store().undo(); finish(); await pending;
  assert.equal(store().project.name, 'History');
  assert.equal(store().isDirty, true);
  store().redo(); assert.equal(store().isDirty, false);
});

test('reloading even the same project resets history and ignores an earlier pending save', async t => {
  let finish!: () => void;
  t.mock.method(localProjectRepository, 'saveProject', () => new Promise<void>(resolve => { finish = resolve; }));
  store().setProjectName('Old edit'); const pending = store().saveCurrentProject();
  store().setProject({ ...store().project, name: 'Reloaded' });
  finish(); await pending;
  assert.equal(store().project.name, 'Reloaded');
  assert.equal(store().savedProject.name, 'Reloaded');
  assert.equal(store().isDirty, false);
  assert.equal(store().canUndo, false); assert.equal(store().canRedo, false);
});

test('opening, importing and creating projects reset undo and redo', async () => {
  const saved = structuredClone(store().project);
  await localProjectRepository.saveProject(saved);
  store().setProjectName('Edit');
  await store().loadProjectById(saved.id);
  assert.equal(store().canUndo, false);
  store().setProjectName('Edit'); store().undo();
  await store().importProjectFromFile(JSON.stringify(saved));
  assert.equal(store().canRedo, false);
  store().setProjectName('Edit');
  store().createNewProject('New');
  assert.equal(store().undo(), false);
});

test('undo clears stale selection and drawing previews and restores a deleted wall in place', () => {
  const before = content();
  store().replaceWall('wall', null);
  store().selectJoint('stale');
  usePanelCutStore.setState({ panelId: 'stale', p1: { x: 0, y: 0 }, p2: { x: 1, y: 1 } });
  useEditorStore.getState().setActiveTool('CUT_PANEL');
  useWallEditorStore.getState().syncTarget(store().project.id, 'wall');
  useWallEditorStore.getState().begin('end');
  store().undo();
  assert.deepEqual(content(), before);
  assert.equal(store().project.selectedWallId, 'wall');
  assert.equal(store().selectedJointId, null);
  assert.equal(usePanelCutStore.getState().p1, null);
  assert.equal(useWallEditorStore.getState().drawEnd, null);
  assert.equal(useEditorStore.getState().activeTool, 'SELECT');
});

test('history is bounded and cannot undo past its oldest retained state', () => {
  for (let i = 0; i < HISTORY_LIMIT + 5; i++) store().setProjectName(`Edit ${i}`);
  assert.equal(store().history.past.length, HISTORY_LIMIT);
  for (let i = 0; i < HISTORY_LIMIT; i++) assert.equal(store().undo(), true);
  assert.equal(store().project.name, 'Edit 4');
  assert.equal(store().undo(), false);
});

test('catalog undo restores shared definitions and project copies without removing unrelated entries', () => {
  const custom = { ...sheet, id: 'custom' }, unrelated = { ...sheet, id: 'unrelated' };
  store().addCustomCatalogPanel(custom);
  store().updateCatalogPanel(custom.id, { height: 3000 });
  localCatalogRepository.savePanel(unrelated);
  store().undo();
  assert.equal(localCatalogRepository.getPanels().find(panel => panel.id === custom.id)?.height, sheet.height);
  store().undo();
  assert.deepEqual(localCatalogRepository.getPanels(), [unrelated]);
  assert.equal(store().project.materials.some(panel => panel.id === custom.id), false);
  store().redo(); store().redo();
  assert.equal(localCatalogRepository.getPanels().find(panel => panel.id === custom.id)?.height, 3000);
  assert.equal(store().project.materials.find(panel => panel.id === custom.id)?.height, 3000);
});

test('failed catalog restoration leaves project and history intact and can be retried', t => {
  store().addCustomCatalogPanel({ ...sheet, id: 'custom' });
  const before = content(), history = store().history;
  const mock = t.mock.method(localCatalogRepository, 'restorePanels', () => { throw new Error('Storage full'); });
  assert.equal(store().undo(), false);
  assert.deepEqual(content(), before); assert.equal(store().history, history);
  assert.equal(store().historyError, 'Storage full');
  mock.mock.restore();
  assert.equal(store().undo(), true); assert.equal(store().historyError, null);
});

test('shortcuts support Ctrl, Cmd and Russian layout while ignoring composition and handled keys', () => {
  const key = { code: 'KeyZ', key: 'z', ctrlKey: true, metaKey: false, shiftKey: false,
    altKey: false, isComposing: false, defaultPrevented: false };
  assert.equal(historyShortcut(key), 'undo');
  assert.equal(historyShortcut({ ...key, key: 'я' }), 'undo');
  assert.equal(historyShortcut({ ...key, code: '', key: 'Я' }), 'undo');
  assert.equal(historyShortcut({ ...key, shiftKey: true }), 'redo');
  assert.equal(historyShortcut({ ...key, code: 'KeyY', key: 'н' }), 'redo');
  assert.equal(historyShortcut({ ...key, ctrlKey: false, metaKey: true }), 'undo');
  for (const patch of [{ altKey: true }, { isComposing: true }, { defaultPrevented: true }, { ctrlKey: false }])
    assert.equal(historyShortcut({ ...key, ...patch }), null);
});

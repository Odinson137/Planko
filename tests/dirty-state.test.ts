import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { useProjectStore } from '../src/application/stores/useProjectStore';
import { createDefaultProject } from '../src/core/models/Project';
import { createDefaultOpening } from '../src/core/models/Opening';
import { localProjectRepository } from '../src/infrastructure/repositories/LocalSQLiteRepository';
import { localCatalogRepository } from '../src/infrastructure/repositories/LocalCatalogRepository';
import { LayoutEngine } from '../src/core/layout/LayoutEngine';
import { sheet, wallWithPanel } from './helpers/business';

const original = useProjectStore.getState();
beforeEach(() => {
  const wall = wallWithPanel(2000, 2500, 'dirty-wall');
  wall.openings = [{ ...createDefaultOpening('WINDOW', 2000, 2500), id: 'opening' }];
  wall.bends = [{ id: 'bend', type: 'OUTER_CORNER', x: 1000, radius: 300, angleDeg: 90 }];
  wall.joints = [{ id: 'joint', p1: { x: 0, y: 0 }, p2: { x: 2000, y: 2000 },
    width: 3, isLED: false, profileArticle: 'MC-06', orientation: 'DIAGONAL' }];
  useProjectStore.setState({ ...original, isDirty: false, project: {
    ...createDefaultProject(), id: 'dirty-project', walls: [wall], materials: [sheet], selectedWallId: wall.id,
  } });
});
afterEach(() => useProjectStore.setState(original));

type Store = ReturnType<typeof useProjectStore.getState>;
const edits: Array<[string, (store: Store) => unknown]> = [
  ['add opening', s => s.addOpening('dirty-wall', 'DOOR')],
  ['move opening', s => s.updateOpening('dirty-wall', { id: 'opening', x: 100 })],
  ['change wall material', s => s.setWallMaterial('dirty-wall', sheet.id)],
  ['add bend', s => s.addWallBend('dirty-wall', 'INNER_CORNER', 500, 200, 90)],
  ['edit bend', s => s.updateWallBend('dirty-wall', 'bend', { radius: 500 })],
  ['delete bend', s => s.deleteWallBend('dirty-wall', 'bend')],
  ['change joint width', s => s.setJointWidth('dirty-wall', 'joint', 7)],
  ['change joint LED', s => s.setJointLED('dirty-wall', 'joint', true)],
  ['change joint color', s => s.setJointColor('dirty-wall', 'joint', '#c9a25b')],
  ['change panel edge', s => s.setPanelEdgeWidth('dirty-wall', 'panel-1', 'left', 7)],
  ['change panel note', s => s.updateWallPanelNote('dirty-wall', 'panel-1', 'Cut first')],
  ['split panel', s => s.slicePanelToSheetFormat('dirty-wall', 'panel-1')],
  ['change catalog', s => s.updateCatalogPanel(sheet.id, { height: 3000 })],
  ['rename project', s => s.setProjectName('Changed')],
];
for (const [name, edit] of edits) {
  test(`unsaved indicator turns on after ${name}`, t => {
    t.mock.method(localCatalogRepository, 'savePanel', () => undefined);
    edit(useProjectStore.getState());
    assert.equal(useProjectStore.getState().isDirty, true);
  });
}

test('selection and editor-only actions preserve both clean and dirty status', () => {
  for (const dirty of [false, true]) {
    useProjectStore.setState({ isDirty: dirty });
    const state = useProjectStore.getState();
    for (const select of [
      () => state.selectWall('dirty-wall'), () => state.selectOpening('opening'),
      () => state.selectPanel('panel-1', 0, 0), () => state.selectJoint('joint'),
      () => state.selectWallBend('bend'), () => state.selectSubPiece('panel-1'),
      () => state.openSlicingModal('dirty-wall', 0, 0, 'panel-1'), () => state.closeSlicingModal(),
      () => state.toggleCellSelection('panel-1', 0, 0, false),
    ]) {
      select();
      assert.equal(useProjectStore.getState().isDirty, dirty);
    }
  }
});

test('ignored operation does not mark an unchanged project as dirty', () => {
  useProjectStore.getState().addOpening('missing-wall', 'DOOR');
  assert.equal(useProjectStore.getState().isDirty, false);
});

test('successful save clears dirty status and the next edit turns it on again', async t => {
  t.mock.method(localProjectRepository, 'saveProject', async () => undefined);
  useProjectStore.getState().addOpening('dirty-wall', 'DOOR');
  await useProjectStore.getState().saveCurrentProject();
  assert.equal(useProjectStore.getState().isDirty, false);
  useProjectStore.getState().updateOpening('dirty-wall', { id: 'opening', x: 200 });
  assert.equal(useProjectStore.getState().isDirty, true);
});

test('failed save preserves the unsaved indicator', async t => {
  t.mock.method(localProjectRepository, 'saveProject', async () => { throw new Error('Storage full'); });
  useProjectStore.getState().addOpening('dirty-wall', 'DOOR');
  await assert.rejects(useProjectStore.getState().saveCurrentProject(), /Storage full/);
  assert.equal(useProjectStore.getState().isDirty, true);
});

test('loading a saved project clears the previous dirty status', async t => {
  const saved = structuredClone(useProjectStore.getState().project);
  t.mock.method(localProjectRepository, 'getProject', async () => saved);
  useProjectStore.getState().setProjectName('Unsaved name');
  assert.equal(await useProjectStore.getState().loadProjectById(saved.id), true);
  assert.equal(useProjectStore.getState().isDirty, false);
  useProjectStore.getState().addWallBend('dirty-wall', 'INNER_CORNER', 100, 100, 90);
  assert.equal(useProjectStore.getState().isDirty, true);
});

test('an edit during saving is preserved and remains unsaved', async t => {
  let finish!: () => void;
  t.mock.method(localProjectRepository, 'saveProject', () => new Promise<void>(resolve => { finish = resolve; }));
  const pending = useProjectStore.getState().saveCurrentProject();
  useProjectStore.getState().updateOpening('dirty-wall', { id: 'opening', x: 123 });
  finish();
  await pending;
  assert.equal(useProjectStore.getState().project.walls[0].openings[0].x, 123);
  assert.equal(useProjectStore.getState().isDirty, true);
});

test('selection during saving is preserved and does not leave a clean project dirty', async t => {
  let finish!: () => void;
  t.mock.method(localProjectRepository, 'saveProject', () => new Promise<void>(resolve => { finish = resolve; }));
  const pending = useProjectStore.getState().saveCurrentProject();
  useProjectStore.getState().selectOpening('opening');
  finish();
  await pending;
  assert.equal(useProjectStore.getState().project.selectedOpeningId, 'opening');
  assert.equal(useProjectStore.getState().isDirty, false);
});

test('finishing a save does not replace another project opened in the meantime', async t => {
  let finish!: () => void;
  t.mock.method(localProjectRepository, 'saveProject', () => new Promise<void>(resolve => { finish = resolve; }));
  const pending = useProjectStore.getState().saveCurrentProject();
  useProjectStore.getState().setProject({ ...createDefaultProject('Other project'), id: 'other-project' });
  useProjectStore.getState().setProjectName('Other project edited');
  finish();
  await pending;
  assert.equal(useProjectStore.getState().project.id, 'other-project');
  assert.equal(useProjectStore.getState().project.name, 'Other project edited');
  assert.equal(useProjectStore.getState().isDirty, true);
});

test('selecting a clipped fragment edits its source profile and updates all visible fragments', () => {
  const before = LayoutEngine.calculateWallLayout(useProjectStore.getState().project.walls[0], sheet, [sheet]);
  const fragment = before.joints.find(j => j.id === 'joint-part-1')!;
  assert.ok(fragment);
  useProjectStore.getState().selectJoint(fragment.sourceJointId!);
  useProjectStore.getState().setJointColor('dirty-wall', useProjectStore.getState().selectedJointId!, '#c9a25b');
  const after = LayoutEngine.calculateWallLayout(useProjectStore.getState().project.walls[0], sheet, [sheet]);
  const fragments = after.joints.filter(j => j.sourceJointId === 'joint');
  assert.equal(fragments.length, 2);
  assert.ok(fragments.every(j => j.profileColor === '#c9a25b'));
  assert.equal(useProjectStore.getState().isDirty, true);
});

import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { useProjectStore } from '../src/application/stores/useProjectStore';
import { createDefaultProject } from '../src/core/models/Project';
import { DEFAULT_MATERIALS, Material } from '../src/core/models/Material';
import { LocalCatalogRepository, localCatalogRepository } from '../src/infrastructure/repositories/LocalCatalogRepository';
import { localProjectRepository } from '../src/infrastructure/repositories/LocalSQLiteRepository';
import { sheet, wallWithPanel } from './helpers/business';

const original = useProjectStore.getState();
const savedStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const slat: Material = { ...sheet, id: 'custom-slat', name: 'Рейка 145', type: 'SLAT',
  width: 145, height: 3000, thickness: 15, thicknessOptions: [15, 16] };

function useEmptyComputerStorage() {
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    get length() { return data.size; },
    key: (index: number) => [...data.keys()][index] ?? null,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  } });
}

beforeEach(() => {
  useEmptyComputerStorage();
  useProjectStore.setState({ ...original, project: { ...createDefaultProject(), id: 'current-project' }, isDirty: false });
});

afterEach(() => {
  useProjectStore.setState(original);
  if (savedStorage) Object.defineProperty(globalThis, 'localStorage', savedStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
});

test('shared panel persists independently and appears in new projects', async () => {
  useProjectStore.getState().addCustomCatalogPanel(slat);
  assert.equal(useProjectStore.getState().isDirty, true);
  assert.deepEqual(new LocalCatalogRepository().getPanels(), [slat]);
  const next = useProjectStore.getState().createNewProject('New');
  assert.deepEqual(next.materials.find(m => m.id === slat.id), slat);
  assert.deepEqual((await localProjectRepository.getProject(next.id))!.materials.find(m => m.id === slat.id), slat);
});

test('legacy project-only stock remains available after opening and is shared when edited', async () => {
  useProjectStore.getState().setProject({ ...createDefaultProject(), id: 'legacy', materials: [slat] });
  await useProjectStore.getState().saveCurrentProject();
  const current = useProjectStore.getState().project.id;
  assert.deepEqual(localCatalogRepository.getPanels(), []);
  assert.equal(useProjectStore.getState().createNewProject('Other').materials.some(m => m.id === slat.id), false);
  await useProjectStore.getState().loadProjectById(current);
  assert.deepEqual(useProjectStore.getState().project.materials.find(m => m.id === slat.id), slat);
  useProjectStore.getState().updateCatalogPanel(slat.id, { width: 150 });
  assert.equal(useProjectStore.getState().createNewProject('With edited stock').materials.find(m => m.id === slat.id)!.width, 150);
});

test('editing standard stock globally updates new defaults without mutating built-in or saved projects', async () => {
  const stock = DEFAULT_MATERIALS[0];
  const before = structuredClone(DEFAULT_MATERIALS);
  const old = { ...createDefaultProject('Old'), id: 'old-project' };
  await localProjectRepository.saveProject(old);
  useProjectStore.getState().updateCatalogPanel(stock.id, { width: 145, height: 3000, thickness: 16 });
  const next = useProjectStore.getState().createNewProject('New');
  assert.equal(next.materials.find(m => m.id === stock.id)!.width, 145);
  assert.equal(next.materials.filter(m => m.id === stock.id).length, 1);
  assert.deepEqual(DEFAULT_MATERIALS, before);
  await useProjectStore.getState().loadProjectById(old.id);
  assert.deepEqual(useProjectStore.getState().project.materials.find(m => m.id === stock.id), stock);
  assert.deepEqual((await localProjectRepository.getProject(old.id))!.materials, before);
});

test('editing shared stock always updates the global version and persists across reopening', async () => {
  useProjectStore.getState().addCustomCatalogPanel(slat);
  useProjectStore.getState().updateCatalogPanel(slat.id, { height: 2700 });
  await useProjectStore.getState().saveCurrentProject();
  const current = useProjectStore.getState().project.id;
  assert.equal(localCatalogRepository.getPanels()[0].height, 2700);
  assert.equal(useProjectStore.getState().createNewProject('Other').materials.find(m => m.id === slat.id)!.height, 2700);
  await useProjectStore.getState().loadProjectById(current);
  assert.equal(useProjectStore.getState().project.materials.find(m => m.id === slat.id)!.height, 2700);
});

test('repeated edits replace rather than duplicate the shared entry', () => {
  useProjectStore.getState().addCustomCatalogPanel(slat);
  useProjectStore.getState().updateCatalogPanel(slat.id, { thickness: 16 });
  useProjectStore.getState().updateCatalogPanel(slat.id, { name: 'Updated slat' });
  assert.deepEqual(localCatalogRepository.getPanels(), [{ ...slat, thickness: 16, name: 'Updated slat' }]);
});

test('opening existing projects adds missing shared panels without changing their saved dimensions or geometry', async () => {
  const old = { ...createDefaultProject('Old'), id: 'old-project' };
  await localProjectRepository.saveProject(old);
  useProjectStore.getState().addCustomCatalogPanel(slat);
  await useProjectStore.getState().loadProjectById(old.id);
  assert.deepEqual(useProjectStore.getState().project.materials.find(m => m.id === slat.id), slat);
  assert.deepEqual(useProjectStore.getState().project.walls, JSON.parse(JSON.stringify(old.walls)));
  assert.deepEqual((await localProjectRepository.getProject(old.id))!.materials, old.materials);
  assert.equal(useProjectStore.getState().isDirty, false);
});

test('import keeps local stock sizes, adds missing shared panels, and never publishes imported stock', async () => {
  localCatalogRepository.savePanel(slat);
  localCatalogRepository.savePanel(sheet);
  const imported = { ...createDefaultProject('External'), materials: [{ ...slat, width: 153 }] };
  await useProjectStore.getState().importProjectFromFile(JSON.stringify(imported));
  assert.equal(useProjectStore.getState().project.materials.find(m => m.id === slat.id)!.width, 153);
  assert.deepEqual(useProjectStore.getState().project.materials.find(m => m.id === sheet.id), sheet);
  assert.equal(localCatalogRepository.getPanels().find(m => m.id === slat.id)!.width, 145);
});

test('deleting shared stock from this project remains effective after reopening and leaves it available elsewhere', async () => {
  useProjectStore.getState().addCustomCatalogPanel(slat);
  useProjectStore.getState().deleteCatalogPanel(slat.id);
  await useProjectStore.getState().saveCurrentProject();
  const current = useProjectStore.getState().project.id;
  assert.equal(useProjectStore.getState().createNewProject('Other').materials.some(m => m.id === slat.id), true);
  await useProjectStore.getState().loadProjectById(current);
  assert.equal(useProjectStore.getState().project.materials.some(m => m.id === slat.id), false);
  useProjectStore.getState().addCustomCatalogPanel(slat);
  assert.equal(useProjectStore.getState().project.excludedCatalogPanelIds!.includes(slat.id), false);
});

test('clearing saved projects preserves the shared catalog', async () => {
  useProjectStore.getState().addCustomCatalogPanel(slat);
  await useProjectStore.getState().saveCurrentProject();
  await localProjectRepository.clearAllProjects();
  assert.deepEqual(await localProjectRepository.listProjects(), []);
  assert.deepEqual(new LocalCatalogRepository().getPanels(), [slat]);
});

test('storage failure leaves both catalogs unchanged and a retry saves to both', t => {
  const before = useProjectStore.getState().project;
  const failingWrite = t.mock.method(localStorage, 'setItem', () => { throw new Error('Storage full'); });
  assert.throws(() => useProjectStore.getState().addCustomCatalogPanel(slat), /Storage full/);
  assert.equal(useProjectStore.getState().project, before);
  assert.equal(useProjectStore.getState().isDirty, false);
  assert.throws(() => useProjectStore.getState().updateCatalogPanel(before.materials[0].id, { width: 145 }), /Storage full/);
  assert.equal(useProjectStore.getState().project, before);
  failingWrite.mock.restore();
  assert.deepEqual(localCatalogRepository.getPanels(), []);
  useProjectStore.getState().addCustomCatalogPanel(slat);
  assert.deepEqual(useProjectStore.getState().project.materials.find(m => m.id === slat.id), slat);
  assert.deepEqual(localCatalogRepository.getPanels(), [slat]);
});

test('exported project carries custom stock and geometry to an empty computer without replacing its shared catalog', async t => {
  const wall = wallWithPanel(145, 2500);
  wall.zone.materialId = slat.id;
  wall.panels![0].materialId = slat.id;
  useProjectStore.getState().setProject({ ...createDefaultProject('Portable'), id: 'source-project', walls: [wall] });
  useProjectStore.getState().addCustomCatalogPanel(slat);
  const source = structuredClone(useProjectStore.getState().project);
  let exportedBlob: Blob | undefined;
  const anchor = { href: '', download: '', click: t.mock.fn() };
  const savedDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement: () => anchor,
    body: { appendChild: () => undefined, removeChild: () => undefined },
  } });
  t.after(() => {
    if (savedDocument) Object.defineProperty(globalThis, 'document', savedDocument);
    else Reflect.deleteProperty(globalThis, 'document');
  });
  t.mock.method(URL, 'createObjectURL', (blob: Blob) => { exportedBlob = blob; return 'blob:test-export'; });
  t.mock.method(URL, 'revokeObjectURL', () => undefined);
  useProjectStore.getState().exportProjectFile();
  assert.ok(exportedBlob);
  assert.equal(anchor.click.mock.callCount(), 1);
  assert.equal(anchor.download, 'Portable.planko.json');
  const file = await exportedBlob.text();
  assert.deepEqual(JSON.parse(file).materials.find((m: Material) => m.id === slat.id), slat);

  // Another computer starts with its own empty storage and built-in catalog.
  useEmptyComputerStorage();
  useProjectStore.setState(original);
  const imported = await useProjectStore.getState().importProjectFromFile(file);
  assert.notEqual(imported.id, source.id);
  assert.deepEqual(useProjectStore.getState().project.materials.find(m => m.id === slat.id), slat);
  assert.deepEqual(useProjectStore.getState().project.walls, JSON.parse(JSON.stringify(source.walls)));
  assert.deepEqual(localCatalogRepository.getPanels(), []);
  await useProjectStore.getState().loadProjectById(imported.id);
  assert.deepEqual(useProjectStore.getState().project.materials.find(m => m.id === slat.id), slat);
  assert.equal(useProjectStore.getState().createNewProject('Unrelated').materials.some(m => m.id === slat.id), false);
});

test('corrupt shared data does not prevent opening a project or leak invalid materials into the editor', () => {
  for (const value of ['{bad', '{}', '[null, {"id":"bad"}]']) {
    localStorage.setItem('planko_shared_material_catalog', value);
    const project = createDefaultProject();
    useProjectStore.getState().setProject(project);
    assert.deepEqual(useProjectStore.getState().project.materials, DEFAULT_MATERIALS);
  }
  localStorage.setItem('planko_shared_material_catalog', JSON.stringify([slat, { ...sheet, width: -1 }]));
  assert.deepEqual(localCatalogRepository.getPanels(), [slat]);
});

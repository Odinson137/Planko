import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { LocalSQLiteRepository } from '../src/infrastructure/repositories/LocalSQLiteRepository';
import { createDefaultProject, CURRENT_PROJECT_FORMAT_VERSION, getProjectMetadata } from '../src/core/models/Project';
import { createDefaultOpening, getOpeningTypeLabel } from '../src/core/models/Opening';
import { sheet, wallWithPanel } from './helpers/business';

const savedStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
let repository: LocalSQLiteRepository;
beforeEach(() => {
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    get length() { return data.size; },
    key: (index: number) => [...data.keys()][index] ?? null,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  } });
  repository = new LocalSQLiteRepository();
});
afterEach(() => {
  if (savedStorage) Object.defineProperty(globalThis, 'localStorage', savedStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
});

test('save/load preserves custom stock, openings, profiles and bend settings without mutating the input', async () => {
  const wall = wallWithPanel();
  wall.roomName = 'Living room';
  wall.openings = [createDefaultOpening('WINDOW', wall.width, wall.height)];
  wall.bends = [{ id: 'bend', x: 200, type: 'INNER_CORNER', radius: 300, angleDeg: 90 }];
  wall.panels![0].edges = { left: { width: 0.8, profileArticle: 'MC-06-7', profileColor: '#212529' } };
  const project = { ...createDefaultProject('Local'), id: 'saved-project', walls: [wall],
    materials: [{ ...sheet, width: 1200, height: 600 }], updatedAt: '2020-01-01T00:00:00.000Z' };
  const before = structuredClone(project);
  await repository.saveProject(project);
  const saved = await repository.getProject(project.id);
  assert.ok(saved);
  assert.deepEqual(saved.walls, JSON.parse(JSON.stringify(project.walls)));
  assert.deepEqual(saved.materials, project.materials);
  assert.notEqual(saved.updatedAt, project.updatedAt);
  assert.deepEqual(project, before);
});

test('import gets a new project identity while preserving custom material and wall geometry', async () => {
  const project = { ...createDefaultProject('Customer'), id: 'external-id',
    materials: [{ ...sheet, width: 1200, height: 600 }], walls: [wallWithPanel()] };
  const imported = await repository.importProjectFromJson(JSON.stringify(project));
  assert.notEqual(imported.id, project.id);
  assert.equal(imported.name, 'Customer (Импорт)');
  assert.deepEqual(imported.walls, JSON.parse(JSON.stringify(project.walls)));
  assert.deepEqual(imported.materials, project.materials);
  assert.ok(await repository.getProject(imported.id));
  assert.equal(await repository.getProject(project.id), null);
});

test('separate portals and legacy portal mode survive saving and JSON import alongside doors', async () => {
  const wall = wallWithPanel();
  const door = createDefaultOpening('DOOR', wall.width, wall.height);
  wall.openings = [door, createDefaultOpening('PORTAL', wall.width, wall.height),
    { ...door, id: 'legacy-portal', name: 'Портал', isPortal: true }];
  const project = { ...createDefaultProject('Portals'), id: 'portal-project', walls: [wall] };
  await repository.saveProject(project);
  const saved = (await repository.getProject(project.id))!;
  const imported = await repository.importProjectFromJson(JSON.stringify(saved));
  for (const restored of [saved, imported]) {
    assert.deepEqual(restored.walls[0].openings, JSON.parse(JSON.stringify(wall.openings)));
    assert.deepEqual(restored.walls[0].openings.map(getOpeningTypeLabel), ['Дверь', 'Портал', 'Портал']);
  }
});

test('malformed JSON and projects without a walls array are rejected before saving', async () => {
  for (const json of ['{', '{}', '{"walls":{}}']) {
    await assert.rejects(repository.importProjectFromJson(json));
  }
  assert.equal(localStorage.length, 0);
});

test('duplicate is independent of the original and deleting it preserves the original', async () => {
  const project = { ...createDefaultProject('Original'), id: 'original' };
  await repository.saveProject(project);
  const duplicate = await repository.duplicateProject(project.id);
  assert.ok(duplicate);
  assert.notEqual(duplicate.id, project.id);
  duplicate.walls[0].width = 999;
  await repository.saveProject(duplicate);
  assert.equal((await repository.getProject(project.id))!.walls[0].width, 3600);
  await repository.deleteProject(duplicate.id);
  assert.equal(await repository.getProject(duplicate.id), null);
  assert.ok(await repository.getProject(project.id));
});

test('project list skips corrupt records, sorts newest first, and clearing keeps unrelated settings', async () => {
  for (const [id, updatedAt] of [['old', '2020-01-01'], ['new', '2026-09-19']]) {
    localStorage.setItem(`planko_projects_db_${id}`, JSON.stringify({ ...createDefaultProject(id), id, updatedAt }));
  }
  localStorage.setItem('planko_projects_db_corrupt', '{broken');
  localStorage.setItem('planko-theme', 'dark');
  assert.deepEqual((await repository.listProjects()).map(p => p.id), ['new', 'old']);
  assert.equal(await repository.getProject('corrupt'), null);
  await repository.clearAllProjects();
  assert.deepEqual(await repository.listProjects(), []);
  assert.equal(localStorage.getItem('planko-theme'), 'dark');
});

test('new projects keep their current format through saving, copying and JSON import', async () => {
  const project = { ...createDefaultProject('Current'), id: 'current-format', createdAt: '2000-01-01' };
  assert.equal(project.formatVersion, CURRENT_PROJECT_FORMAT_VERSION);
  await repository.saveProject(project);
  const copied = await repository.duplicateProject(project.id);
  const imported = await repository.importProjectFromJson(JSON.stringify(project));
  for (const restored of [await repository.getProject(project.id), copied, imported]) {
    assert.ok(restored);
    assert.equal(restored.formatVersion, CURRENT_PROJECT_FORMAT_VERSION);
    assert.equal(getProjectMetadata(restored).isLegacy, false);
  }
  assert.ok((await repository.listProjects()).every(item => !item.isLegacy));
});

for (const formatVersion of [undefined, CURRENT_PROJECT_FORMAT_VERSION - 1]) {
  test(`legacy format ${formatVersion ?? 'unversioned'} stays marked after save, rename, copy and import`, async () => {
    const project = { ...createDefaultProject('Legacy'), id: 'legacy-format', formatVersion,
      createdAt: '2099-01-01', updatedAt: '2099-01-01' };
    const raw = JSON.stringify(project);
    localStorage.setItem(`planko_projects_db_${project.id}`, raw);

    assert.equal((await repository.listProjects())[0].isLegacy, true);
    assert.equal(localStorage.getItem(`planko_projects_db_${project.id}`), raw);
    const loaded = await repository.getProject(project.id);
    assert.ok(loaded);
    await repository.saveProject(loaded);
    await repository.renameProject(project.id, 'Renamed legacy');
    const copied = await repository.duplicateProject(project.id);
    const imported = await repository.importProjectFromJson(JSON.stringify(loaded));
    for (const restored of [await repository.getProject(project.id), copied, imported]) {
      assert.ok(restored);
      assert.equal(restored.formatVersion, formatVersion);
      assert.deepEqual(restored.walls, JSON.parse(raw).walls);
      assert.equal(getProjectMetadata(restored).isLegacy, true);
    }
    assert.ok((await repository.listProjects()).every(item => item.isLegacy));
  });
}

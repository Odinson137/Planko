import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { PolygonSlicingEngine as Geometry } from '../src/core/geometry/PolygonSlicingEngine';
import { panelBounds } from '../src/core/geometry/PanelCutEngine';
import { getJointGapOwners, getResolvedPanelEdges } from '../src/core/geometry/PanelJointBinding';
import { LayoutEngine } from '../src/core/layout/LayoutEngine';
import { createDefaultProject } from '../src/core/models/Project';
import { MATERIAL_NONE_ID, panelMaterialDefaults, type Material } from '../src/core/models/Material';
import { useProjectStore } from '../src/application/stores/useProjectStore';
import { close, panel, sheet, wallWithPanel } from './helpers/business';

const original = useProjectStore.getState();
beforeEach(() => {
  const wall = wallWithPanel(3600, 2600);
  useProjectStore.setState({ ...original, isDirty: false,
    project: { ...createDefaultProject(), walls: [wall], materials: [sheet], selectedWallId: wall.id } });
});
afterEach(() => useProjectStore.setState(original));
const currentWall = () => useProjectStore.getState().project.walls[0];

for (const gap of [0, 0.8, 3, 7, 60]) {
  test(`sheet slicing keeps full 1220 mm panels and takes the ${gap} mm gaps from the rightmost remainder`, () => {
    const source = panel('source', 200, 300, 3600, 2600);
    const before = structuredClone(source);
    const cut = Geometry.slicePanelByMaxSheetDimensions(source, 1220, 2800, gap === 0.8 ? undefined : gap);
    const bounds = cut.newPanels.map(p => panelBounds(p.points));
    assert.equal(bounds.length, 3);
    close(bounds[0].x, 200);
    close(bounds[0].width, 1220);
    close(bounds[1].width, 1220);
    close(bounds[2].width, 1160 - 2 * gap);
    for (let i = 1; i < bounds.length; i++) close(bounds[i].x - (bounds[i - 1].x + bounds[i - 1].width), gap);
    close(bounds[2].x + bounds[2].width, 3800);
    assert.equal(cut.joints.length, 2);
    cut.joints.forEach((joint, index) => {
      close(joint.p1.x, bounds[index].x + bounds[index].width + gap / 2);
      assert.equal(joint.width, gap);
      assert.equal(joint.takeSide, 'RIGHT');
      const owners = getJointGapOwners(cut.newPanels, joint);
      assert.equal(owners.length, 1);
      assert.equal(owners[0].panel.id, cut.newPanels[index + 1].id);
    });
    close(cut.newPanels.reduce((sum, p) => sum + Geometry.calculatePolygonArea(p.points), 0), (3600 - gap * 2) * 2600);
    assert.deepEqual(source, before);
  });
}

test('both axes obey the material format, including fractional last rows', () => {
  const cut = Geometry.slicePanelByMaxSheetDimensions(panel('source', 50, 70, 3500, 6100), 1220, 2800, 2.35);
  assert.equal(cut.newPanels.length, 9);
  const bounds = cut.newPanels.map(p => panelBounds(p.points));
  assert.ok(bounds.every(p => p.width <= 1220 + 1e-5 && p.height <= 2800 + 1e-5));
  const firstColumn = bounds.filter(p => p.x === 50).sort((a, b) => a.y - b.y);
  close(firstColumn[0].height, 2800);
  close(firstColumn[1].height, 2800);
  close(firstColumn[2].height, 495.3);
  close(firstColumn[1].y - firstColumn[0].y - firstColumn[0].height, 2.35);
  close(cut.newPanels.reduce((sum, p) => sum + Geometry.calculatePolygonArea(p.points), 0), (3500 - 4.7) * (6100 - 4.7));
  for (const joint of cut.joints) {
    const owners = getJointGapOwners(cut.newPanels, joint);
    assert.ok(owners.length > 0);
    for (const { panel: owner } of owners) {
      const bounds = panelBounds(owner.points);
      assert.ok(joint.orientation === 'VERTICAL' ? bounds.x > joint.p1.x : bounds.y > joint.p1.y);
    }
  }
});

test('a sloped panel retains its contour when the gap is cut out', () => {
  const source = { ...panel('triangle', 0, 0, 3600, 2400),
    points: [{ x: 0, y: 0 }, { x: 3600, y: 0 }, { x: 0, y: 2400 }] };
  const cut = Geometry.slicePanelByMaxSheetDimensions(source, 1220, 2800, 7);
  assert.equal(cut.newPanels.length, 3);
  for (const child of cut.newPanels) for (const point of child.points) {
    assert.ok(point.x >= 0 && point.y >= 0 && point.y <= 2400 - point.x * 2 / 3 + 1e-5);
    if (point.y > 0) close(point.y, 2400 - point.x * 2 / 3);
  }
  const removedArea = [1220, 2447].reduce((sum, x) => sum + 7 * (2400 - (x + 3.5) * 2 / 3), 0);
  close(cut.newPanels.reduce((sum, p) => sum + Geometry.calculatePolygonArea(p.points), 0), 4320000 - removedArea);
});

test('sheet slicing keeps exterior profiles off the newly created internal edges', () => {
  const source = { ...panel('source', 0, 0, 3600, 2600), edges: {
    left: { width: 0, profileArticle: 'MC-06' }, right: { width: 0, profileArticle: 'MC-06-7' },
    top: { width: 0, profileArticle: 'DL-13' },
  } };
  const cut = Geometry.slicePanelByMaxSheetDimensions(source, 1220, 2800, 3);
  assert.deepEqual(cut.newPanels[0].edges?.left, source.edges.left);
  assert.deepEqual(cut.newPanels[2].edges?.right, source.edges.right);
  assert.equal(cut.newPanels[0].edges?.right, undefined);
  assert.equal(cut.newPanels[1].edges?.left, undefined);
  assert.equal(cut.newPanels[1].edges?.right, undefined);
  assert.ok(cut.newPanels.every(p => p.edges?.top?.profileArticle === 'DL-13'));
});

test('an exact stock size is unchanged and a small real remainder is not ignored', () => {
  const exact = panel('exact', 0, 0, 1220, 2800);
  assert.deepEqual(Geometry.slicePanelByMaxSheetDimensions(exact, 1220, 2800, 3), { newPanels: [exact], joints: [] });
  const cut = Geometry.slicePanelByMaxSheetDimensions(panel('thin', 0, 0, 1222, 2600), 1220, 2800, 0.8);
  assert.equal(cut.newPanels.length, 2);
  close(panelBounds(cut.newPanels[1].points).width, 1.2);
});

test('invalid gaps and an exhausted remainder fail without altering the project', () => {
  const before = structuredClone(useProjectStore.getState().project);
  for (const gap of [-1, NaN, Infinity, 580, 600]) {
    assert.throws(() => useProjectStore.getState().slicePanelToSheetFormat(currentWall().id, 'panel-1', 0, 0, { gap }), /Зазор/);
    assert.deepEqual(useProjectStore.getState().project, before);
  }
  assert.equal(useProjectStore.getState().canUndo, original.canUndo);
});

for (const profileArticle of [undefined, 'MC-06-7']) {
  test(`store applies ${profileArticle ?? 'no profile'} independently of the gap and supports undo/redo`, () => {
    const before = structuredClone(currentWall());
    const store = useProjectStore.getState();
    store.slicePanelToSheetFormat(before.id, 'panel-1', 0, 0, { gap: 0.8, profileArticle, profileColor: '#c9a25b' });
    const after = structuredClone(currentWall());
    assert.equal(after.panels!.length, 3);
    assert.equal(after.joints!.length, 2);
    assert.ok(after.joints!.every(j => j.width === 0.8 && j.profileArticle === profileArticle && j.profileColor === '#c9a25b' && !j.isLED));
    const layout = LayoutEngine.calculateWallLayout(after, sheet, [sheet]);
    const widths = layout.panels.sort((a, b) => a.x - b.x).map(p => p.width);
    widths.forEach((width, i) => close(width, [1220, 1220, 1158.4][i]));
    assert.equal(useProjectStore.getState().isDirty, true);
    assert.equal(store.undo(), true);
    assert.deepEqual(currentWall(), before);
    assert.equal(store.redo(), true);
    assert.deepEqual(currentWall(), after);
  });
}

test('LED is inferred from the chosen profile and survives layout and later joint editing', () => {
  const store = useProjectStore.getState();
  store.slicePanelToSheetFormat(currentWall().id, 'panel-1', 0, 0, {
    gap: 0, profileArticle: 'DL-13', profileColor: '#b76e79',
  });
  assert.ok(currentWall().joints!.every(j => j.width === 0 && j.profileArticle === 'DL-13' && j.isLED));
  for (const joint of currentWall().joints!) store.setJointWidth(currentWall().id, joint.id, 7);
  const bounds = currentWall().panels!.map(p => panelBounds(p.points)).sort((a, b) => a.x - b.x);
  // Each auto-created joint has a fixed adjacent owner; later edits resize that panel only.
  bounds.forEach((p, i) => close(p.width, [1220, 1213, 1153][i]));
  const layout = LayoutEngine.calculateWallLayout(currentWall(), sheet, [sheet]);
  assert.equal(layout.joints.filter(j => j.profileArticle === 'DL-13' && j.isLED).length, 2);
});

test('automatic cutting fixes the owner before either panel is edited and refresh transfers the whole gap', () => {
  const store = useProjectStore.getState();
  store.slicePanelToSheetFormat(currentWall().id, 'panel-1', 0, 0, { gap: 0.8, profileArticle: 'MC-06' });
  const [left, middle, right] = currentWall().panels!;
  const joint = currentWall().joints![0];
  assert.equal(getJointGapOwners(currentWall().panels!, joint)[0].panel.id, middle.id);
  const fixedRight = structuredClone(right);
  store.setPanelEdgeWidth(currentWall().id, left.id, 'right', 15);
  close(panelBounds(currentWall().panels![0].points).width, 1220);
  close(panelBounds(currentWall().panels![1].points).width, 1205.8);
  store.switchJointGapOwner(currentWall().id, joint.id);
  close(panelBounds(currentWall().panels![0].points).width, 1205);
  close(panelBounds(currentWall().panels![1].points).width, 1220.8);
  assert.equal(getJointGapOwners(currentWall().panels!, currentWall().joints![0])[0].panel.id, left.id);
  assert.deepEqual(currentWall().panels![2], fixedRight);
  for (const p of currentWall().panels!.slice(0, 2)) {
    assert.equal(getResolvedPanelEdges(currentWall(), p).find(e => e.joint?.id === joint.id)!.config!.width, 15);
  }
});

test('slicing targets only the selected panel, including an opening fragment selection', () => {
  const wall = currentWall();
  wall.width = 5000;
  wall.panels = [panel('untouched', 0, 0, 1000, 2600), panel('target', 1200, 0, 3600, 2600)];
  wall.joints = [{ id: 'existing', p1: { x: 1100, y: 0 }, p2: { x: 1100, y: 2600 }, width: 200,
    profileArticle: 'MC-06', profileColor: '#c9a25b', isLED: false }];
  const untouched = structuredClone(wall.panels[0]), existing = structuredClone(wall.joints[0]);
  useProjectStore.getState().slicePanelToSheetFormat(wall.id, 'target-part-1', 1, 0, { gap: 3 });
  assert.equal(currentWall().panels!.length, 4);
  assert.deepEqual(currentWall().panels![0], untouched);
  assert.deepEqual(currentWall().joints![0], existing);
  close(panelBounds(currentWall().panels![1].points).x, 1200);
});

const alternateMaterial: Material = {
  ...sheet, id: 'alternate-sheet', width: 1000, height: 1400, thickness: 8, thicknessOptions: [5, 8],
  textureCategory: 'STONE', reliefType: 'FLAT',
  availableDecors: [{ code: 'new-decor', name: 'Новый декор', color: '#aabbcc', category: 'STONE' }],
};
function addAlternateMaterial(material = alternateMaterial) {
  useProjectStore.setState(state => ({ project: { ...state.project, materials: [...state.project.materials, material] } }));
  return panelMaterialDefaults(material);
}

test('material selection and sheet slicing use the chosen stock and undo together', () => {
  const selection = { ...addAlternateMaterial(), thickness: 5, color: '#112233' };
  const wall = currentWall();
  // Assigning a material to an empty surface must also make the resulting pieces visible.
  wall.panels![0].materialId = MATERIAL_NONE_ID;
  wall.panels![0].isVoid = true;
  wall.panels![0].partLabel = 'ПУСТО';
  wall.panels![0].note = 'Keep note';
  const before = structuredClone(wall);
  const store = useProjectStore.getState();
  const previousSteps = store.history.past.length;
  store.slicePanelToSheetFormat(wall.id, 'panel-1', 0, 0, { gap: 0.8, material: selection, profileArticle: 'DL-13' });
  const after = structuredClone(currentWall());
  assert.equal(after.panels!.length, 8);
  for (const piece of after.panels!) {
    assert.equal(piece.materialId, alternateMaterial.id);
    assert.equal(piece.thickness, 5);
    assert.equal(piece.color, '#112233');
    assert.equal(piece.decorCode, 'new-decor');
    assert.equal(piece.decorName, 'Новый декор');
    assert.equal(piece.textureCategory, 'STONE');
    assert.equal(piece.note, 'Keep note');
    assert.equal(piece.isVoid, false);
    assert.ok(!piece.partLabel.startsWith('ПУСТО'));
    const bounds = panelBounds(piece.points);
    assert.ok(bounds.width <= 1000 + 1e-5 && bounds.height <= 1400 + 1e-5);
  }
  const bottomRow = after.panels!.map(p => panelBounds(p.points)).filter(p => p.y === 0).sort((a, b) => a.x - b.x);
  bottomRow.forEach((p, i) => close(p.width, [1000, 1000, 1000, 597.6][i]));
  assert.ok(after.joints!.every(j => j.width === 0.8 && j.profileArticle === 'DL-13' && j.isLED));
  assert.equal(useProjectStore.getState().history.past.length, previousSteps + 1);
  assert.equal(store.undo(), true);
  assert.deepEqual(currentWall(), before);
  assert.equal(store.redo(), true);
  assert.deepEqual(currentWall(), after);
});

test('choosing a larger sheet applies material without unnecessary cuts and preserves adjacent panels', () => {
  const selection = addAlternateMaterial({ ...alternateMaterial, width: 4000, height: 3000 });
  const wall = currentWall();
  wall.width = 4600;
  wall.panels!.push({ ...panel('neighbor', 3600, 0, 1000, 2600), partLabel: '1.2' });
  const before = structuredClone(wall);
  useProjectStore.getState().slicePanelToSheetFormat(wall.id, 'panel-1', 0, 0, { gap: 0.8, material: selection });
  const after = currentWall();
  assert.equal(after.panels!.length, 2);
  assert.equal(after.panels![0].id, before.panels![0].id);
  assert.equal(after.panels![0].materialId, alternateMaterial.id);
  assert.deepEqual(after.panels![0].points, before.panels![0].points);
  assert.deepEqual(after.panels![1], before.panels![1]);
  assert.deepEqual(after.joints, before.joints);
});

test('a failed cut or missing material does not partially assign the new material', () => {
  const selection = addAlternateMaterial({ ...alternateMaterial, width: 3599 });
  const before = structuredClone(useProjectStore.getState().project);
  const store = useProjectStore.getState();
  assert.throws(() => store.slicePanelToSheetFormat(currentWall().id, 'panel-1', 0, 0, { gap: 3, material: selection }), /Зазор/);
  assert.deepEqual(useProjectStore.getState().project, before);
  assert.throws(() => store.slicePanelToSheetFormat(currentWall().id, 'panel-1', 0, 0, {
    gap: 0.8, material: { ...selection, materialId: 'missing' },
  }), /материал/);
  assert.deepEqual(useProjectStore.getState().project, before);
});

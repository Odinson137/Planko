import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cutPanelOnWall, panelBounds } from '../src/core/geometry/PanelCutEngine';
import { PolygonSlicingEngine } from '../src/core/geometry/PolygonSlicingEngine';
import { LayoutEngine } from '../src/core/layout/LayoutEngine';
import { NestingEngine } from '../src/core/layout/NestingEngine';
import { resolveTextureMapping, textureMappingError } from '../src/core/textures/TextureMapping';
import { panel, sheet, wallWithPanel } from './helpers/business';

const photoMaterial = { ...sheet, textureCategory: 'WOOD' as const, decorCode: '5189' };
const origin = { offsetX: 0, offsetY: 0, angleDeg: 0 };
const nesting = (wall: ReturnType<typeof wallWithPanel>, material = photoMaterial) => {
  const pieces = LayoutEngine.calculateWallLayout(wall, material, [material]).panels;
  return NestingEngine.optimizeProjectNesting(pieces.map(p => ({ ...p, materialType: material.type, wallId: wall.id, wallName: wall.name })),
    material.width, material.height, [material]);
};

for (const scenario of [
  { name: '3600 × 2750 wall', width: 3600, height: 2750, angle: 0, axis: 'x', cuts: [1200, 2400], material: photoMaterial },
  { name: 'rotated tall wall', width: 2750, height: 3600, angle: 90, axis: 'y', cuts: [1200, 2400], material: photoMaterial },
  { name: 'custom stock', width: 2700, height: 2000, angle: 0, axis: 'x', cuts: [900, 1800],
    material: { ...photoMaterial, width: 900, height: 2100 } },
]) {
  test(`photo cuts of ${scenario.name} start independent sheet crops that also fit nesting`, () => {
    const { width, height, angle, axis, cuts, material } = scenario;
    let wall = wallWithPanel(width, height);
    wall.panels![0].patternAngleDeg = angle;
    if (material === photoMaterial) {
      wall.panels![0].textureCategory = material.textureCategory;
      wall.panels![0].decorCode = material.decorCode;
    }
    const uncut = LayoutEngine.calculateWallLayout(wall, material, [material]).panels[0];
    assert.ok(textureMappingError(uncut), 'the uncut surface still exceeds stock');
    assert.throws(() => nesting(wall, material), /границы листа/);
    for (const coordinate of cuts) {
      const target = wall.panels!.find(p => {
        const b = panelBounds(p.points);
        return axis === 'x' ? b.x < coordinate && b.x + b.width > coordinate
          : b.y < coordinate && b.y + b.height > coordinate;
      })!;
      wall = cutPanelOnWall(wall, [material], target.id,
        axis === 'x' ? { x: coordinate, y: 0 } : { x: 0, y: coordinate },
        axis === 'x' ? { x: coordinate, y: height } : { x: width, y: coordinate })!;
    }
    const pieces = LayoutEngine.calculateWallLayout(wall, material, [material]).panels;
    assert.equal(pieces.length, 3);
    for (const piece of pieces) {
      const mapping = resolveTextureMapping(piece);
      assert.equal(mapping.offsetX, 0);
      assert.equal(mapping.offsetY, 0);
      assert.equal(mapping.angleDeg, angle);
      assert.equal(textureMappingError(piece), undefined);
    }
    assert.equal(nesting(wall, material).totalSheetsCount, 3);
  });
}

test('saved photo pieces with an impossible automatic wall anchor recover without editing project data', () => {
  const wall = wallWithPanel(3600, 2750);
  wall.panels = [0, 1200, 2400].map((x, i) => ({ ...panel(`piece-${i}`, x, 0, 1200, 2750),
    textureMapping: { ...origin, anchor: { x: 0, y: 0, width: 3600, height: 2750 } } }));
  const saved = JSON.parse(JSON.stringify(wall));
  const before = structuredClone(saved);
  const pieces = LayoutEngine.calculateWallLayout(saved, photoMaterial, [photoMaterial]).panels;
  for (const piece of pieces) {
    assert.equal(textureMappingError(piece), undefined);
    assert.equal(resolveTextureMapping(piece).offsetX, 0);
  }
  assert.equal(nesting(saved).totalSheetsCount, 3);
  assert.deepEqual(saved, before);

  // A further cut of the repaired, sheet-sized part preserves its local grain.
  const cut = cutPanelOnWall(saved, [photoMaterial], 'piece-2', { x: 3000, y: 0 }, { x: 3000, y: 2750 })!;
  const children = LayoutEngine.calculateWallLayout(cut, photoMaterial, [photoMaterial]).panels
    .filter(p => p.x >= 2400).sort((a, b) => a.x - b.x);
  assert.deepEqual(children.map(p => resolveTextureMapping(p).offsetX), [0, 600]);
  assert.ok(children.every(p => textureMappingError(p) === undefined));
  assert.equal(nesting(cut).totalSheetsCount, 3);
});

test('sheet-format slicing also recovers an old oversized photo anchor', () => {
  const wall = wallWithPanel(3600, 2750);
  const source = { ...panel('remainder', 1200, 0, 2400, 2750),
    textureMapping: { ...origin, anchor: { x: 0, y: 0, width: 3600, height: 2750 } } };
  wall.panels = PolygonSlicingEngine.slicePanelByMaxSheetDimensions(source, 1220, 2800, 0.8).newPanels;
  const pieces = LayoutEngine.calculateWallLayout(wall, photoMaterial, [photoMaterial]).panels;
  assert.equal(pieces.length, 2);
  assert.ok(pieces.every(p => textureMappingError(p) === undefined));
  assert.equal(nesting(wall).totalSheetsCount, 2);
});

test('valid photo anchors and explicit invalid offsets are not reset', () => {
  const piece = { ...photoMaterial, x: 3000, y: 0, width: 600, height: 2750,
    textureStockWidth: 1220, textureStockHeight: 2800,
    textureMapping: { ...origin, anchor: { x: 2400, y: 0, width: 1200, height: 2750 } } };
  assert.equal(resolveTextureMapping(piece).offsetX, 600);
  assert.equal(textureMappingError(piece), undefined);
  const invalid = { ...piece, textureMapping: { ...origin, offsetX: 50,
    anchor: { x: 0, y: 0, width: 3600, height: 2750 } } };
  assert.equal(resolveTextureMapping(invalid).offsetX, 3050);
  assert.ok(textureMappingError(invalid));
});

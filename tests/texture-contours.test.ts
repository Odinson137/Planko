import assert from 'node:assert/strict';
import { test } from 'node:test';
import { texturePieceOutline, textureSheetOutline, pointOnSheet, slopeTexturePiece } from '../src/core/textures/TextureMapping';
import { cutPanelOnWall } from '../src/core/geometry/PanelCutEngine';
import { LayoutEngine } from '../src/core/layout/LayoutEngine';
import { close, sheet, wallWithPanel, rectangle } from './helpers/business';

test('triangle preview uses its three vertices in top-left image coordinates', () => {
  const piece = { x: 100, y: 200, width: 600, height: 400,
    polygonPoints: [{ x: 100, y: 200 }, { x: 700, y: 200 }, { x: 700, y: 600 }] };
  assert.deepEqual(texturePieceOutline(piece), [{ x: 0, y: 400 }, { x: 600, y: 400 }, { x: 600, y: 0 }]);
  assert.deepEqual(textureSheetOutline({ ...piece, textureMapping: { offsetX: 30, offsetY: 50, angleDeg: 90 } }),
    [{ x: 430, y: 650 }, { x: 430, y: 50 }, { x: 30, y: 50 }]);
});

test('concave contours retain the notch instead of the bounding rectangle', () => {
  const piece = { x: 100, y: 200, width: 600, height: 400, polygonPoints: [
    { x: 100, y: 200 }, { x: 700, y: 200 }, { x: 700, y: 400 },
    { x: 400, y: 400 }, { x: 400, y: 600 }, { x: 100, y: 600 },
  ] };
  assert.deepEqual(texturePieceOutline(piece), [
    { x: 0, y: 400 }, { x: 600, y: 400 }, { x: 600, y: 200 },
    { x: 300, y: 200 }, { x: 300, y: 0 }, { x: 0, y: 0 },
  ]);
});

test('rectangular panels and vertical slopes retain rectangular previews', () => {
  assert.deepEqual(texturePieceOutline({ width: 600, height: 400 }), rectangle(0, 0, 600, 400));
  assert.deepEqual(texturePieceOutline(slopeTexturePiece({ width: 800, depth: 150, side: 'LEFT' })), rectangle(0, 0, 150, 800));
});

test('diagonal and repeated cuts keep each contour at its original position on the rotated sheet', () => {
  for (const angleDeg of [0, 27.5, 90, 135, 180, 270, -30]) {
    const wall = wallWithPanel(900, 1200);
    wall.panels![0].points = rectangle(100, 200, 600, 800);
    wall.panels![0].textureMapping = { offsetX: 30, offsetY: 50, angleDeg };
    const cut = cutPanelOnWall(wall, [sheet], 'panel-1', { x: 100, y: 200 }, { x: 700, y: 1000 })!;
    const triangles = LayoutEngine.calculateWallLayout(cut, sheet, [sheet]).panels;
    assert.equal(triangles.length, 2);
    assert.ok(triangles.every(p => textureSheetOutline(p).length === 3));
    const repeated = cutPanelOnWall(cut, [sheet], cut.panels![0].id, { x: 100, y: 600 }, { x: 700, y: 600 })!;
    const children = LayoutEngine.calculateWallLayout(repeated, sheet, [sheet]).panels;
    assert.equal(children.length, 3);
    for (const child of [...triangles, ...children]) {
      const outline = textureSheetOutline(child);
      child.polygonPoints!.forEach((p, i) => {
        const expected = pointOnSheet(p.x - 100, 1000 - p.y, 600, 800, angleDeg);
        close(outline[i].x, 30 + expected.x);
        close(outline[i].y, 50 + expected.y);
      });
    }
  }
});

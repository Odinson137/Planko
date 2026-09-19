import assert from 'node:assert/strict';
import type { Material } from '../../src/core/models/Material';
import { createDefaultWall, type WallPanelPiece } from '../../src/core/models/Wall';
import type { Point2D } from '../../src/core/geometry/PolygonSlicingEngine';

// A plain, custom stock keeps these tests independent of the photo/decor catalog.
export const sheet: Material = {
  id: 'test-sheet', name: 'Test sheet', type: 'SHEET',
  width: 1220, height: 2800, thickness: 5, color: '#cccccc', isCustom: true,
};

export function rectangle(x: number, y: number, width: number, height: number): Point2D[] {
  return [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }];
}

export function panel(id: string, x: number, y: number, width: number, height: number): WallPanelPiece {
  return { id, points: rectangle(x, y, width, height), materialId: sheet.id, partLabel: '1.1', isVoid: false };
}

export function wallWithPanel(width = 2000, height = 2500, id = 'test-wall') {
  const wall = createDefaultWall(id);
  wall.width = width;
  wall.height = height;
  wall.zone.materialId = sheet.id;
  wall.panels = [panel('panel-1', 0, 0, width, height)];
  return wall;
}

export function close(actual: number, expected: number, tolerance = 1e-6) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${expected}, got ${actual}`);
}

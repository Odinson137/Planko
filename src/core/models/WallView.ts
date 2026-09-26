import type { Wall } from './Wall';

export interface WallCamera { angleDeg: number; elevationDeg: number }
export interface WallView extends WallCamera { id: string; name: string }
export const DEFAULT_WALL_CAMERA: Readonly<WallCamera> = { angleDeg: 34, elevationDeg: 26 };

export function normalizeWallCamera(camera: WallCamera): WallCamera | null {
  if (!Number.isFinite(camera.angleDeg) || !Number.isFinite(camera.elevationDeg)) return null;
  const angle = ((camera.angleDeg + 180) % 360 + 360) % 360 - 180;
  return { angleDeg: Math.round(angle * 10) / 10,
    elevationDeg: Math.round(Math.max(-89, Math.min(89, camera.elevationDeg)) * 10) / 10 };
}

/** Optional data keeps existing projects compatible; malformed imported views are ignored. */
export function savedWallViews(wall: Pick<Wall, 'savedViews'>): WallView[] {
  if (!Array.isArray(wall.savedViews)) return [];
  const ids = new Set<string>();
  return wall.savedViews.flatMap(view => {
    if (!view || typeof view.id !== 'string' || !view.id || ids.has(view.id) || typeof view.name !== 'string') return [];
    const camera = normalizeWallCamera(view);
    if (!camera) return [];
    ids.add(view.id);
    return [{ id: view.id, name: view.name.trim() || 'Ракурс', ...camera }];
  });
}

export function nextWallViewName(views: WallView[]): string {
  const number = views.reduce((max, view) => {
    const match = /^Ракурс (\d+)$/.exec(view.name);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0) + 1;
  return `Ракурс ${number}`;
}

export function wallExportViews(wall: Pick<Wall, 'savedViews'>): WallView[] {
  const views = savedWallViews(wall);
  return views.length ? views : [{ id: 'default', name: 'Стандартный ракурс', ...DEFAULT_WALL_CAMERA }];
}

export function planWallViewPages(walls: Wall[]): { wall: Wall; wallNumber: number; view: WallView }[] {
  return walls.flatMap((wall, index) => wallExportViews(wall).map(view => ({ wall, wallNumber: index + 1, view })));
}

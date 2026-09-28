import { isDoorOrPortal, type Opening } from '../models/Opening';
import type { Wall } from '../models/Wall';

export function openingBounds(opening: Opening) {
  const frame = opening.isCutout === false ? undefined : opening.framing;
  const bottom = isDoorOrPortal(opening) ? 0 : frame?.bottom?.width ?? 0;
  return { x: opening.x - (frame?.left?.width ?? 0), y: opening.y - bottom,
    width: opening.width + (frame?.left?.width ?? 0) + (frame?.right?.width ?? 0),
    height: opening.height + bottom + (frame?.top?.width ?? 0) };
}

export function openingPlacementError(wall: Wall, items: Opening[], checkOverlap = true): string | null {
  for (const item of items) {
    if (![item.x, item.y, item.width, item.height].every(Number.isFinite) || item.width <= 0 || item.height <= 0)
      return 'Размеры объекта должны быть больше нуля.';
    // Framing may terminate at the floor or wall boundary; the object itself must fit.
    if (item.x < 0 || item.y < 0 || item.x + item.width > wall.width + 0.01 || item.y + item.height > wall.height + 0.01)
      return 'Объект не помещается в границах стены.';
    if (!checkOverlap || item.isCutout === false) continue;
    const a = openingBounds(item);
    const others = [...wall.openings.filter(other => !items.some(next => next.id === other.id)), ...items];
    for (const other of others) {
      if (other.id === item.id || other.isCutout === false) continue;
      const b = openingBounds(other);
      if (Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 0.01 &&
          Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 0.01)
        return `Проём пересекается с объектом «${other.name}».`;
    }
  }
  return null;
}


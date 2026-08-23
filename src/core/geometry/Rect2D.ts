export interface Rect2D {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Проверка пересечения двух прямоугольников
 */
export function intersects(a: Rect2D, b: Rect2D): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

/**
 * Вычитание прямоугольника выреза (B) из исходного прямоугольника (A).
 * Возвращает до 4 оставшихся фрагментов.
 */
export function subtractRect(a: Rect2D, b: Rect2D): Rect2D[] {
  if (!intersects(a, b)) {
    return [{ ...a }];
  }

  const result: Rect2D[] = [];

  // 1. Левая вертикальная часть (на всю высоту исходного фрагмента)
  if (b.x > a.x) {
    const leftW = Math.min(b.x - a.x, a.width);
    if (leftW > 0.5) {
      result.push({
        x: a.x,
        y: a.y,
        width: leftW,
        height: a.height,
      });
    }
  }

  // 2. Правая вертикальная часть (на всю высоту исходного фрагмента)
  if (b.x + b.width < a.x + a.width) {
    const rightX = Math.max(a.x, b.x + b.width);
    const rightW = a.x + a.width - rightX;
    if (rightW > 0.5) {
      result.push({
        x: rightX,
        y: a.y,
        width: rightW,
        height: a.height,
      });
    }
  }

  // Область по ширине между левой и правой стойками (зона проема)
  const midMinX = Math.max(a.x, b.x);
  const midMaxX = Math.min(a.x + a.width, b.x + b.width);
  const midW = midMaxX - midMinX;

  if (midW > 0.5) {
    // 3. Верхняя часть (над вырезом/фрамуга, строго над проемом)
    if (b.y + b.height < a.y + a.height) {
      const topY = Math.max(a.y, b.y + b.height);
      const topH = a.y + a.height - topY;
      if (topH > 0.5) {
        result.push({
          x: midMinX,
          y: topY,
          width: midW,
          height: topH,
        });
      }
    }

    // 4. Нижняя часть (под вырезом, например под окном)
    if (b.y > a.y) {
      const bottomH = Math.min(b.y - a.y, a.height);
      if (bottomH > 0.5) {
        result.push({
          x: midMinX,
          y: a.y,
          width: midW,
          height: bottomH,
        });
      }
    }
  }

  return result;
}

export interface Point2D {
  x: number;
  y: number;
}

export interface CutLine {
  id: string;
  p1: Point2D;
  p2: Point2D;
  dimensionOffset?: number; // опциональный фиксированный отступ в мм
  axis?: 'HORIZONTAL' | 'VERTICAL' | 'DIAGONAL';
}

export interface SnapResult {
  point: Point2D;
  snapped: boolean;
  snapType?: 'CORNER' | 'MIDPOINT' | 'FRACTION' | 'EDGE' | 'INTERSECTION' | 'ANGLE_45' | 'ANGLE_90';
  label?: string;
  edgeSegment?: {
    p1: Point2D;
    p2: Point2D;
    dist1: number;
    dist2: number;
    totalLen: number;
  };
}

export interface PolygonSubPiece {
  id: string;
  points: Point2D[];
  materialId: string;
  decorCode?: string;
  decorName?: string;
  color?: string;
  thickness?: number;
  reliefType?: 'FLAT' | 'FLUTED' | 'MICRO' | 'WAVE' | 'CHEVRON' | 'PANEL_ACCENT';
  textureCategory?: 'WOOD' | 'MARBLE' | 'CONCRETE' | 'METAL' | 'FABRIC' | 'LEATHER' | 'SOLID' | 'MIRROR' | 'GLASS' | 'SLAT';
  partLabel?: string;
  patternAngleDeg?: number;
  patternFlipX?: boolean;
  isVoid?: boolean;
  areaSqM?: number;
}

/**
 * Модуль математики и геометрического рассечения 2D-полигонов для CAD-ножа
 */
export class PolygonSlicingEngine {
  /**
   * Вычисление площади произвольного 2D-многоугольника (формула Гаусса / Shoelace formula)
   */
  public static calculatePolygonArea(points: Point2D[]): number {
    if (!points || points.length < 3) return 0;
    let sum = 0;
    const n = points.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      sum += points[i].x * points[j].y;
      sum -= points[j].x * points[i].y;
    }
    return Math.abs(sum) / 2;
  }

  /**
   * Вычисление центра масс (центроида) многоугольника
   */
  public static calculateCentroid(points: Point2D[]): Point2D {
    if (!points || points.length === 0) return { x: 0, y: 0 };
    if (points.length === 1) return { ...points[0] };
    if (points.length === 2) {
      return { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };
    }

    let cx = 0;
    let cy = 0;
    let totalA = 0;
    const n = points.length;

    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const factor = points[i].x * points[j].y - points[j].x * points[i].y;
      cx += (points[i].x + points[j].x) * factor;
      cy += (points[i].y + points[j].y) * factor;
      totalA += factor;
    }

    const a6 = totalA * 3;
    if (Math.abs(a6) < 0.0001) {
      const avgX = points.reduce((s, p) => s + p.x, 0) / n;
      const avgY = points.reduce((s, p) => s + p.y, 0) / n;
      return { x: avgX, y: avgY };
    }

    return { x: cx / a6, y: cy / a6 };
  }

  /**
   * Точка пересечения двух отрезков AB и CD
   */
  public static lineIntersection(a: Point2D, b: Point2D, c: Point2D, d: Point2D): Point2D | null {
    const denom = (d.y - c.y) * (b.x - a.x) - (d.x - c.x) * (b.y - a.y);
    if (Math.abs(denom) < 1e-9) return null;

    const ua = ((d.x - c.x) * (a.y - c.y) - (d.y - c.y) * (a.x - c.x)) / denom;
    const ub = ((b.x - a.x) * (a.y - c.y) - (b.y - a.y) * (a.x - c.x)) / denom;

    if (ua >= -1e-5 && ua <= 1 + 1e-5 && ub >= -1e-5 && ub <= 1 + 1e-5) {
      return {
        x: a.x + ua * (b.x - a.x),
        y: a.y + ua * (b.y - a.y),
      };
    }
    return null;
  }

  /**
   * Точка пересечения бесконечной прямой через P1-P2 с отрезком AB
   */
  public static infiniteLineWithSegmentIntersection(
    p1: Point2D,
    p2: Point2D,
    a: Point2D,
    b: Point2D
  ): Point2D | null {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const denom = dy * (b.x - a.x) - dx * (b.y - a.y);
    if (Math.abs(denom) < 1e-9) return null;

    const u = (dx * (a.y - p1.y) - dy * (a.x - p1.x)) / denom;
    if (u >= -1e-5 && u <= 1 + 1e-5) {
      return {
        x: a.x + u * (b.x - a.x),
        y: a.y + u * (b.y - a.y),
      };
    }
    return null;
  }

  /**
   * Проверка нахождения точки внутри многоугольника (Ray casting)
   */
  public static isPointInPolygon(pt: Point2D, polygon: Point2D[]): boolean {
    if (!polygon || polygon.length < 3) return false;
    let inside = false;
    const n = polygon.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = polygon[i].x;
      const yi = polygon[i].y;
      const xj = polygon[j].x;
      const yj = polygon[j].y;
      const intersect =
        yi > pt.y !== yj > pt.y &&
        pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi + 1e-12) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }

  /**
   * Проверяет, пересекает ли конечный отрезок p1-p2 данный многоугольник
   */
  public static doesSegmentCrossPolygon(polygon: Point2D[], p1: Point2D, p2: Point2D): boolean {
    if (!polygon || polygon.length < 3) return false;

    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-4) return false;

    const vx = dx / len;
    const vy = dy / len;

    // Небольшой запас 2 мм на концах отрезка для гарантированного пересечения примагниченных границ
    const eps = 2.0;
    const e1: Point2D = { x: p1.x - vx * eps, y: p1.y - vy * eps };
    const e2: Point2D = { x: p2.x + vx * eps, y: p2.y + vy * eps };

    let interCount = 0;
    const n = polygon.length;

    for (let i = 0; i < n; i++) {
      const a = polygon[i];
      const b = polygon[(i + 1) % n];
      const inter = this.lineIntersection(e1, e2, a, b);
      if (inter) {
        interCount++;
      }
    }

    if (interCount >= 2) return true;

    // Также проверяем, находится ли середина отрезка внутри полигона
    const mid: Point2D = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    if (this.isPointInPolygon(mid, polygon)) {
      return true;
    }

    if (interCount >= 1 && (this.isPointInPolygon(p1, polygon) || this.isPointInPolygon(p2, polygon))) {
      return true;
    }

    return false;
  }

  /**
   * Рассечение многоугольника конечным отрезком ножа p1-p2.
   */
  public static splitPolygonByLine(
    polygon: Point2D[],
    p1: Point2D,
    p2: Point2D,
    seamGap: number = 0
  ): { pieceA: Point2D[]; pieceB: Point2D[] } | null {
    if (!polygon || polygon.length < 3) return null;

    // Проверяем, пересекает ли данный отрезок ножа этот конкретный полигон
    if (!this.doesSegmentCrossPolygon(polygon, p1, p2)) {
      return null;
    }

    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-4) return null;

    const nx = -dy / len;
    const ny = dx / len;

    const halfGap = seamGap / 2;

    const p1A: Point2D = { x: p1.x + nx * halfGap, y: p1.y + ny * halfGap };
    const p2A: Point2D = { x: p2.x + nx * halfGap, y: p2.y + ny * halfGap };

    const p1B: Point2D = { x: p1.x - nx * halfGap, y: p1.y - ny * halfGap };
    const p2B: Point2D = { x: p2.x - nx * halfGap, y: p2.y - ny * halfGap };

    const pieceA = this.clipPolygonByHalfPlane(polygon, p1A, p2A, true);
    const pieceB = this.clipPolygonByHalfPlane(polygon, p1B, p2B, false);

    const areaA = this.calculatePolygonArea(pieceA);
    const areaB = this.calculatePolygonArea(pieceB);

    if (areaA < 10 || areaB < 10) {
      return null;
    }

    return { pieceA, pieceB };
  }

  /**
   * Автоматическое разбиение полигона на вертикальные ламели/полосы заданной ширины (например, ширина рейки 158 мм или листа 1220 мм)
   */
  public static slicePolygonIntoVerticalStrips(
    polygon: Point2D[],
    stripWidth: number,
    baseSubPiece: PolygonSubPiece,
    baseLabel: string = '1.1',
    seamGap: number = 0
  ): PolygonSubPiece[] {
    if (!polygon || polygon.length < 3 || stripWidth <= 0) {
      return [baseSubPiece];
    }

    const xs = polygon.map((p) => p.x);
    const ys = polygon.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys) - 100;
    const maxY = Math.max(...ys) + 100;
    const totalW = maxX - minX;

    if (totalW <= stripWidth + 5) {
      return [baseSubPiece];
    }

    // Собираем координаты вертикальных линий реза
    const cutXs: number[] = [];
    let curX = minX + stripWidth;
    while (curX < maxX - 5) {
      cutXs.push(curX);
      curX += stripWidth;
    }

    let pieces: PolygonSubPiece[] = [{ ...baseSubPiece, points: polygon }];

    cutXs.forEach((cutX) => {
      const nextPieces: PolygonSubPiece[] = [];
      const p1: Point2D = { x: cutX, y: minY };
      const p2: Point2D = { x: cutX, y: maxY };

      pieces.forEach((piece) => {
        const split = this.splitPolygonByLine(piece.points, p1, p2, seamGap);
        if (split) {
          nextPieces.push({
            ...piece,
            id: `piece-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            points: split.pieceA,
          });
          nextPieces.push({
            ...piece,
            id: `piece-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            points: split.pieceB,
          });
        } else {
          nextPieces.push(piece);
        }
      });

      pieces = nextPieces;
    });

    // Сортируем полученные ламели слева направо
    pieces.sort((a, b) => {
      const minXA = Math.min(...a.points.map((p) => p.x));
      const minXB = Math.min(...b.points.map((p) => p.x));
      return minXA - minXB;
    });

    // Присваиваем площади и понятные маркировки
    return pieces.map((piece, idx) => {
      const areaSqM =
        Math.round((this.calculatePolygonArea(piece.points) / 1_000_000) * 1000) / 1000;
      return {
        ...piece,
        id: `piece-${Date.now()}-${idx + 1}`,
        partLabel: pieces.length > 1 ? `${baseLabel}.${idx + 1}` : baseLabel,
        areaSqM,
      };
    });
  }

  /**
   * Отсечение многоугольника полуплоскостью прямой P1-P2 (алгоритм Сазерленда-Ходжмана)
   */
  public static clipPolygonByHalfPlane(
    polygon: Point2D[],
    p1: Point2D,
    p2: Point2D,
    keepPositiveSide: boolean
  ): Point2D[] {
    const result: Point2D[] = [];
    const n = polygon.length;
    if (n < 3) return [];

    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;

    const isInside = (pt: Point2D): boolean => {
      const cross = (pt.x - p1.x) * dy - (pt.y - p1.y) * dx;
      return keepPositiveSide ? cross >= -1e-5 : cross <= 1e-5;
    };

    for (let i = 0; i < n; i++) {
      const cur = polygon[i];
      const prev = polygon[(i - 1 + n) % n];

      const curInside = isInside(cur);
      const prevInside = isInside(prev);

      if (curInside) {
        if (!prevInside) {
          const inter = this.infiniteLineWithSegmentIntersection(p1, p2, prev, cur);
          if (inter) result.push(inter);
        }
        result.push(cur);
      } else if (prevInside) {
        const inter = this.infiniteLineWithSegmentIntersection(p1, p2, prev, cur);
        if (inter) result.push(inter);
      }
    }

    return this.cleanCollinearPoints(result);
  }

  /**
   * Очистка дублирующихся или строго коллинеарных соседних вершин
   */
  public static cleanCollinearPoints(points: Point2D[]): Point2D[] {
    if (points.length <= 3) return points;
    const cleaned: Point2D[] = [];
    const n = points.length;

    for (let i = 0; i < n; i++) {
      const pPrev = points[(i - 1 + n) % n];
      const pCur = points[i];
      const pNext = points[(i + 1) % n];

      if (Math.hypot(pCur.x - pPrev.x, pCur.y - pPrev.y) < 0.5) {
        continue;
      }

      const v1x = pCur.x - pPrev.x;
      const v1y = pCur.y - pPrev.y;
      const v2x = pNext.x - pCur.x;
      const v2y = pNext.y - pCur.y;
      const cross = v1x * v2y - v1y * v2x;
      const dot = v1x * v2x + v1y * v2y;

      if (Math.abs(cross) < 1e-4 && dot > 0) {
        continue;
      }

      cleaned.push(pCur);
    }

    return cleaned;
  }

  /**
   * Точка пересечения луча rayOrigin + t * rayDir (t >= 0) с отрезком p1-p2
   */
  public static raySegmentIntersection(
    rayOrigin: Point2D,
    rayDir: Point2D,
    p1: Point2D,
    p2: Point2D
  ): Point2D | null {
    const v1x = rayOrigin.x - p1.x;
    const v1y = rayOrigin.y - p1.y;
    const v2x = p2.x - p1.x;
    const v2y = p2.y - p1.y;
    const v3x = -rayDir.y;
    const v3y = rayDir.x;

    const dot = v2x * v3x + v2y * v3y;
    if (Math.abs(dot) < 1e-9) return null;

    const t1 = (v2x * v1y - v2y * v1x) / dot;
    const t2 = (v1x * v3x + v1y * v3y) / dot;

    if (t1 >= 1e-4 && t2 >= -1e-5 && t2 <= 1 + 1e-5) {
      return {
        x: rayOrigin.x + t1 * rayDir.x,
        y: rayOrigin.y + t1 * rayDir.y,
      };
    }
    return null;
  }

  /**
   * Смарт-магнит (Snapping): строгая привязка курсора к внешним/внутренним граням, вершинам и серединам.
   * Курсор НИКОГДА не повисает в центре — всегда прилипает к грани или вершине!
   */
  public static snapPoint(
    rawPoint: Point2D,
    existingPolygons: Point2D[][],
    _existingCutLines: CutLine[] = [],
    _panelWidth: number = 0,
    _panelHeight: number = 0,
    startPoint: Point2D | null = null,
    _snapRadius: number = 24
  ): SnapResult {
    // 1. Если протягиваем линию разреза от startPoint:
    if (startPoint) {
      const dx = rawPoint.x - startPoint.x;
      const dy = rawPoint.y - startPoint.y;
      const dist = Math.hypot(dx, dy);

      if (dist < 10) {
        return {
          point: { ...startPoint },
          snapped: true,
          snapType: 'EDGE',
          label: 'Точка старта',
        };
      }

      let angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
      if (angleDeg < 0) angleDeg += 360;

      // Проверяем угловой замок (0°, 45°, 90°, 135°, 180°, 225°, 270°, 315°)
      let isAngleSnapped = false;
      let targetAngle = angleDeg;
      let angleLabel = '';
      const snapAngles = [0, 45, 90, 135, 180, 225, 270, 315, 360];
      for (const sa of snapAngles) {
        if (Math.abs(angleDeg - sa) <= 6.0 || Math.abs(angleDeg - (sa - 360)) <= 6.0) {
          isAngleSnapped = true;
          targetAngle = sa % 360;
          angleLabel = `Угол ${sa % 180}°`;
          break;
        }
      }

      const rad = (targetAngle * Math.PI) / 180;
      const dirX = Math.cos(rad);
      const dirY = Math.sin(rad);

      // Ищем точку пересечения луча с противоположной гранью полигонов
      let bestInter: Point2D | null = null;
      let bestInterDist = Infinity;
      let hitEdge: { p1: Point2D; p2: Point2D } | null = null;

      existingPolygons.forEach((poly) => {
        const n = poly.length;
        for (let i = 0; i < n; i++) {
          const p1 = poly[i];
          const p2 = poly[(i + 1) % n];
          const inter = this.raySegmentIntersection(startPoint, { x: dirX, y: dirY }, p1, p2);
          if (inter) {
            const d = Math.hypot(inter.x - startPoint.x, inter.y - startPoint.y);
            if (d > 5 && d < bestInterDist) {
              bestInterDist = d;
              bestInter = inter;
              hitEdge = { p1, p2 };
            }
          }
        }
      });

      if (bestInter !== null) {
        const foundInter: Point2D = bestInter;
        let snapType: SnapResult['snapType'] = isAngleSnapped
          ? targetAngle % 90 === 0
            ? 'ANGLE_90'
            : 'ANGLE_45'
          : 'EDGE';
        let label = isAngleSnapped ? angleLabel : 'Грань';
        let finalPoint: Point2D = { x: foundInter.x, y: foundInter.y };

        // Приоритетная доводка до вершины/угла или середины
        existingPolygons.forEach((poly) => {
          poly.forEach((v) => {
            if (Math.hypot(finalPoint.x - v.x, finalPoint.y - v.y) < 22) {
              finalPoint = { ...v };
              snapType = 'CORNER';
              label = 'Угол';
            }
          });
          const n = poly.length;
          for (let i = 0; i < n; i++) {
            const p1 = poly[i];
            const p2 = poly[(i + 1) % n];
            const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
            if (Math.hypot(finalPoint.x - mid.x, finalPoint.y - mid.y) < 18) {
              finalPoint = { ...mid };
              snapType = 'MIDPOINT';
              label = 'Середина 50%';
            }
          }
        });

        let edgeSegment: SnapResult['edgeSegment'] = undefined;
        if (hitEdge) {
          const p1 = (hitEdge as { p1: Point2D; p2: Point2D }).p1;
          const p2 = (hitEdge as { p1: Point2D; p2: Point2D }).p2;
          const d1 = Math.round(Math.hypot(finalPoint.x - p1.x, finalPoint.y - p1.y));
          const d2 = Math.round(Math.hypot(p2.x - finalPoint.x, p2.y - finalPoint.y));
          const tLen = Math.round(Math.hypot(p2.x - p1.x, p2.y - p1.y));
          edgeSegment = { p1, p2, dist1: d1, dist2: d2, totalLen: tLen };
        }

        return {
          point: finalPoint,
          snapped: true,
          snapType,
          label,
          edgeSegment,
        };
      }

      return {
        point: { x: startPoint.x + dist * dirX, y: startPoint.y + dist * dirY },
        snapped: isAngleSnapped,
        snapType: isAngleSnapped ? 'ANGLE_90' : 'EDGE',
        label: isAngleSnapped ? angleLabel : 'Грань',
      };
    }

    // 2. Если стартовая точка ещё не выбрана: КУРСОР ВСЕГДА ПРИЛИПАЕТ К ГРАНЯМ / ВЕРШИНАМ
    let bestDist = Infinity;
    let bestPoint = { ...rawPoint };
    let snapType: SnapResult['snapType'] = undefined;
    let label = 'Грань';
    let selectedEdge: { p1: Point2D; p2: Point2D } | null = null;

    // 2.1 Проверяем вершины и углы
    existingPolygons.forEach((poly) => {
      const n = poly.length;
      for (let i = 0; i < n; i++) {
        const v = poly[i];
        const d = Math.hypot(rawPoint.x - v.x, rawPoint.y - v.y);
        if (d < 24 && d < bestDist) {
          bestDist = d;
          bestPoint = { ...v };
          snapType = 'CORNER';
          label = 'Угол';
          selectedEdge = { p1: poly[(i - 1 + n) % n], p2: v };
        }
      }
    });

    // 2.2 Проверяем середины граней (50%)
    if (snapType === undefined) {
      existingPolygons.forEach((poly) => {
        const n = poly.length;
        for (let i = 0; i < n; i++) {
          const p1 = poly[i];
          const p2 = poly[(i + 1) % n];
          const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
          const dm = Math.hypot(rawPoint.x - mid.x, rawPoint.y - mid.y);
          if (dm < 20 && dm < bestDist) {
            bestDist = dm;
            bestPoint = { ...mid };
            snapType = 'MIDPOINT';
            label = 'Середина 50%';
            selectedEdge = { p1, p2 };
          }
        }
      });
    }

    // 2.3 ВСЕГДА проецируем на ближайшую грань (не разрешаем висеть в центре)
    if (snapType === undefined) {
      let closestEdgeDist = Infinity;
      let closestEdgePoint = { ...rawPoint };

      existingPolygons.forEach((poly) => {
        const n = poly.length;
        for (let i = 0; i < n; i++) {
          const p1 = poly[i];
          const p2 = poly[(i + 1) % n];
          const ex = p2.x - p1.x;
          const ey = p2.y - p1.y;
          const lenSq = ex * ex + ey * ey;
          if (lenSq < 1) continue;

          const t = Math.max(0, Math.min(1, ((rawPoint.x - p1.x) * ex + (rawPoint.y - p1.y) * ey) / lenSq));
          const proj: Point2D = { x: p1.x + t * ex, y: p1.y + t * ey };
          const distToEdge = Math.hypot(rawPoint.x - proj.x, rawPoint.y - proj.y);

          if (distToEdge < closestEdgeDist) {
            closestEdgeDist = distToEdge;
            closestEdgePoint = proj;
            selectedEdge = { p1, p2 };
          }
        }
      });

      bestPoint = closestEdgePoint;
      snapType = 'EDGE';
      label = 'Грань';
    }

    let edgeSegment: SnapResult['edgeSegment'] = undefined;
    if (selectedEdge) {
      const p1 = (selectedEdge as { p1: Point2D; p2: Point2D }).p1;
      const p2 = (selectedEdge as { p1: Point2D; p2: Point2D }).p2;
      const d1 = Math.round(Math.hypot(bestPoint.x - p1.x, bestPoint.y - p1.y));
      const d2 = Math.round(Math.hypot(p2.x - bestPoint.x, p2.y - bestPoint.y));
      const tLen = Math.round(Math.hypot(p2.x - p1.x, p2.y - p1.y));
      edgeSegment = { p1, p2, dist1: d1, dist2: d2, totalLen: tLen };
    }

    return {
      point: bestPoint,
      snapped: true,
      snapType: snapType || 'EDGE',
      label,
      edgeSegment,
    };
  }
}

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
    const split = this.splitPolygonByLine(polygon, p1, p2, 0);
    return split !== null;
  }

  /**
   * Рассечение многоугольника прямой p1-p2 с разделением на независимые многоугольники (поддерживает вогнутые формы и вырезы)
   */
  public static splitPolygonByLine(
    polygon: Point2D[],
    p1: Point2D,
    p2: Point2D,
    seamGap: number = 0
  ): {
    pieceA: Point2D[];
    pieceB: Point2D[];
    piecesA?: Point2D[][];
    piecesB?: Point2D[][];
    allPieces?: Point2D[][];
  } | null {
    if (!polygon || polygon.length < 3) return null;
    const ccw = this.ensureCCW(this.cleanCollinearPoints(polygon));
    const n = ccw.length;
    if (n < 3) return null;

    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-4) return null;

    const halfGap = seamGap / 2;
    const shiftX = (dy / len) * halfGap;
    const shiftY = (-dx / len) * halfGap;

    const dist = (pt: Point2D) => (pt.x - p1.x) * dy - (pt.y - p1.y) * dx;
    const EPS = 1e-4;

    const d = ccw.map((pt) => dist(pt));

    // Проверяем, есть ли вершины по обе стороны линии
    let hasPos = false;
    let hasNeg = false;
    for (let i = 0; i < n; i++) {
      if (d[i] > EPS) hasPos = true;
      if (d[i] < -EPS) hasNeg = true;
    }
    // Если все вершины строго с одной стороны (или на линии), линия не разрезает полигон
    if (!hasPos || !hasNeg) {
      return null;
    }

    interface AugNode {
      pt: Point2D;
      isInter: boolean;
      d?: number;
      t?: number;
      enteringA?: boolean;
      next?: AugNode;
      prev?: AugNode;
      linePartner?: AugNode;
      visited?: boolean;
    }

    const augPoly: AugNode[] = [];
    const intersections: AugNode[] = [];

    // 1. Построение расширенного списка вершин с учетом пересечений граней и прохождения через вершины/углы
    for (let i = 0; i < n; i++) {
      const curPt = ccw[i];
      const curD = d[i];

      if (Math.abs(curD) <= EPS) {
        // Вершина лежит на линии реза
        // Ищем предыдущую и следующую вершины, не лежащие на линии
        let prevNonZeroD = 0;
        for (let step = 1; step < n; step++) {
          const pd = d[(i - step + n) % n];
          if (Math.abs(pd) > EPS) {
            prevNonZeroD = pd;
            break;
          }
        }

        let nextNonZeroD = 0;
        for (let step = 1; step < n; step++) {
          const nd = d[(i + step) % n];
          if (Math.abs(nd) > EPS) {
            nextNonZeroD = nd;
            break;
          }
        }

        // Проверяем, не была ли предыдущая вершина уже на линии
        const prevIdx = (i - 1 + n) % n;
        const prevIsOnLine = Math.abs(d[prevIdx]) <= EPS;

        // Если знаки по обе стороны разные, контур пересекает линию в этой вершине
        if (prevNonZeroD * nextNonZeroD < 0 && !prevIsOnLine) {
          const t = (curPt.x - p1.x) * dx + (curPt.y - p1.y) * dy;
          const enteringA = prevNonZeroD < 0 && nextNonZeroD > 0;
          const node: AugNode = {
            pt: { ...curPt },
            isInter: true,
            t,
            d: 0,
            enteringA,
          };
          augPoly.push(node);
          intersections.push(node);
        } else {
          // Линия касается вершины, не пересекая (локальный экстремум или продолжение коллинеарного ребра)
          augPoly.push({
            pt: { ...curPt },
            isInter: false,
            d: 0,
          });
        }
      } else {
        augPoly.push({
          pt: { ...curPt },
          isInter: false,
          d: curD,
        });
      }

      // Проверяем строгое пересечение ребра (i, i+1)
      const nextIdx = (i + 1) % n;
      const nextD = d[nextIdx];
      if ((curD < -EPS && nextD > EPS) || (curD > EPS && nextD < -EPS)) {
        const nextPt = ccw[nextIdx];
        const u = curD / (curD - nextD);
        const interPt: Point2D = {
          x: curPt.x + u * (nextPt.x - curPt.x),
          y: curPt.y + u * (nextPt.y - curPt.y),
        };
        const t = (interPt.x - p1.x) * dx + (interPt.y - p1.y) * dy;
        const enteringA = curD < 0 && nextD > 0;
        const node: AugNode = {
          pt: interPt,
          isInter: true,
          t,
          d: 0,
          enteringA,
        };
        augPoly.push(node);
        intersections.push(node);
      }
    }

    if (intersections.length < 2 || intersections.length % 2 !== 0) {
      return null;
    }

    // Связываем соседей по кольцу
    const numAug = augPoly.length;
    for (let i = 0; i < numAug; i++) {
      augPoly[i].next = augPoly[(i + 1) % numAug];
      augPoly[i].prev = augPoly[(i - 1 + numAug) % numAug];
    }

    // Сортируем точки пересечения вдоль линии
    intersections.sort((a, b) => (a.t || 0) - (b.t || 0));

    // Проверяем, что отрезок ножа [p1, p2] реально рассекает полигон (не уходит бесконечно дальше точки p2)
    // Допуск 3.0 мм на примагничивание к граням и округление координат
    const tol = 3.0;
    const validPairs: { n1: AugNode; n2: AugNode }[] = [];

    for (let i = 0; i < intersections.length - 1; i += 2) {
      const n1 = intersections[i];
      const n2 = intersections[i + 1];
      const d1 = (n1.t || 0) / len;
      const d2 = (n2.t || 0) / len;

      if (d1 >= -tol && d2 <= len + tol) {
        n1.linePartner = n2;
        n2.linePartner = n1;
        validPairs.push({ n1, n2 });
      } else {
        // Линия ножа не дошла до этого участка или началась позже
        n1.isInter = false;
        n2.isInter = false;
      }
    }

    if (validPairs.length === 0) {
      return null;
    }

    const activeIntersections = intersections.filter((node) => node.linePartner !== undefined);

    // 2. Сборка замкнутых полигонов для каждой стороны
    const buildSidePolygons = (targetSideA: boolean): Point2D[][] => {
      const resultPolys: Point2D[][] = [];
      activeIntersections.forEach((node) => (node.visited = false));

      for (const startNode of activeIntersections) {
        const isStart = targetSideA ? startNode.enteringA : !startNode.enteringA;
        if (!isStart || startNode.visited) continue;

        const polyPts: Point2D[] = [];
        let cur: AugNode | undefined = startNode;
        let safety = 0;

        while (cur && safety++ < numAug * 4) {
          cur.visited = true;

          if (cur.isInter && seamGap > 0) {
            const sign = targetSideA ? 1 : -1;
            polyPts.push({
              x: cur.pt.x + shiftX * sign,
              y: cur.pt.y + shiftY * sign,
            });
          } else {
            polyPts.push({ ...cur.pt });
          }

          if (cur.isInter) {
            const isExit = targetSideA ? !cur.enteringA : cur.enteringA;
            if (isExit && cur !== startNode) {
              const partner: AugNode | undefined = cur.linePartner;
              if (partner) {
                partner.visited = true;
                if (partner === startNode) {
                  break;
                }
                cur = partner;
              } else {
                break;
              }
            } else {
              cur = cur.next;
            }
          } else {
            cur = cur.next;
          }

          if (cur === startNode) {
            break;
          }
        }

        const cleaned = this.cleanCollinearPoints(polyPts);
        const area = this.calculatePolygonArea(cleaned);
        if (area >= 10 && cleaned.length >= 3) {
          resultPolys.push(cleaned);
        }
      }

      return resultPolys;
    };

    const piecesA = buildSidePolygons(true);
    const piecesB = buildSidePolygons(false);

    if (piecesA.length === 0 || piecesB.length === 0) {
      return null;
    }

    return {
      pieceA: piecesA[0],
      pieceB: piecesB[0],
      piecesA,
      piecesB,
      allPieces: [...piecesA, ...piecesB],
    };
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

    const finalPolys: Point2D[][] = [];
    let remainingPolys: Point2D[][] = [polygon];

    let curX = minX + stripWidth;
    while (curX < maxX - 5) {
      const nextRemaining: Point2D[][] = [];
      const p1: Point2D = { x: curX, y: minY };
      const p2: Point2D = { x: curX, y: maxY };

      for (const piece of remainingPolys) {
        const pieceMinX = Math.min(...piece.map((p) => p.x));
        const pieceMaxX = Math.max(...piece.map((p) => p.x));

        if (pieceMaxX <= curX + 1e-4) {
          finalPolys.push(piece);
          continue;
        }
        if (pieceMinX >= curX - 1e-4) {
          nextRemaining.push(piece);
          continue;
        }

        const split = this.splitPolygonByLine(piece, p1, p2, seamGap);
        if (split) {
          if (split.piecesB) {
            split.piecesB.forEach((p) => {
              if (this.calculatePolygonArea(p) >= 10) finalPolys.push(p);
            });
          }
          if (split.piecesA) {
            split.piecesA.forEach((p) => {
              if (this.calculatePolygonArea(p) >= 10) nextRemaining.push(p);
            });
          }
        } else {
          nextRemaining.push(piece);
        }
      }

      remainingPolys = nextRemaining;
      curX += stripWidth;
    }

    remainingPolys.forEach((p) => {
      if (this.calculatePolygonArea(p) >= 10) finalPolys.push(p);
    });

    // Сортируем полученные ламели слева направо, снизу вверх
    finalPolys.sort((a, b) => {
      const minXA = Math.min(...a.map((p) => p.x));
      const minXB = Math.min(...b.map((p) => p.x));
      if (Math.abs(minXA - minXB) > 1) return minXA - minXB;
      const minYA = Math.min(...a.map((p) => p.y));
      const minYB = Math.min(...b.map((p) => p.y));
      return minYA - minYB;
    });

    // Присваиваем площади и понятные маркировки
    const cleanBaseLabel = (!baseLabel || baseLabel.startsWith('ПУСТО'))
      ? (baseLabel && baseLabel.startsWith('ПУСТО.') ? baseLabel.replace(/^ПУСТО/, '1.1') : '1.1')
      : baseLabel;

    return finalPolys.map((polyPts, idx) => {
      const areaSqM =
        Math.round((this.calculatePolygonArea(polyPts) / 1_000_000) * 1000) / 1000;
      return {
        ...baseSubPiece,
        id: `piece-${Date.now()}-${idx + 1}-${Math.random().toString(36).substring(2, 6)}`,
        points: polyPts,
        partLabel: finalPolys.length > 1 ? `${cleanBaseLabel}.${idx + 1}` : cleanBaseLabel,
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
   * Ориентация полигона: возвращает массив точек в порядке против часовой стрелки (CCW)
   */
  public static ensureCCW(points: Point2D[]): Point2D[] {
    if (!points || points.length < 3) return points;
    let sum = 0;
    const n = points.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      sum += points[i].x * points[j].y - points[j].x * points[i].y;
    }
    return sum < 0 ? [...points].reverse() : points;
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
      const len1 = Math.hypot(v1x, v1y);
      const len2 = Math.hypot(v2x, v2y);
      if (len1 < 1e-4 || len2 < 1e-4) continue;

      const cross = (v1x * v2y - v1y * v2x) / (len1 * len2);
      const dot = (v1x * v2x + v1y * v2y) / (len1 * len2);

      if (Math.abs(cross) < 1e-3 && dot > 0.99) {
        continue;
      }

      cleaned.push(pCur);
    }

    return cleaned;
  }

  /**
   * Объединение массива 2D-многоугольников в единый сплошной полигон (с устранением внутренних швов)
   */
  public static unionPolygons(polygons: Point2D[][], seamTolerance: number = 16): Point2D[] {
    if (!polygons || polygons.length === 0) return [];
    if (polygons.length === 1) return polygons[0];

    let current = polygons[0];
    for (let i = 1; i < polygons.length; i++) {
      const nextPoly = polygons[i];
      const united = this.unionTwoPolygons(current, nextPoly, seamTolerance);
      if (united && united.length >= 3) {
        current = united;
      }
    }
    return current;
  }

  /**
   * Геометрическое объединение двух смежных или пересекающихся 2D-многоугольников
   */
  public static unionTwoPolygons(
    polyA: Point2D[],
    polyB: Point2D[],
    seamTolerance: number = 16
  ): Point2D[] | null {
    if (!polyA || polyA.length < 3) return polyB ? [...polyB] : null;
    if (!polyB || polyB.length < 3) return polyA ? [...polyA] : null;

    const ccwA = this.ensureCCW(this.cleanCollinearPoints(polyA));
    const ccwB = this.ensureCCW(this.cleanCollinearPoints(polyB));

    interface DirectedEdge {
      p1: Point2D;
      p2: Point2D;
      polyIdx: number;
    }

    const distToSegment = (p: Point2D, a: Point2D, b: Point2D) => {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const lenSq = dx * dx + dy * dy;
      if (lenSq < 1e-6) {
        return { dist: Math.hypot(p.x - a.x, p.y - a.y), proj: { ...a }, t: 0 };
      }
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
      const proj = { x: a.x + t * dx, y: a.y + t * dy };
      return { dist: Math.hypot(p.x - proj.x, p.y - proj.y), proj, t };
    };

    // 1. Разбиваем рёбра каждого полигона в точках пересечения и проекций вершин
    const splitPolyEdges = (poly1: Point2D[], poly2: Point2D[], pIdx: number): DirectedEdge[] => {
      const edges: DirectedEdge[] = [];
      const n1 = poly1.length;
      const n2 = poly2.length;

      for (let i = 0; i < n1; i++) {
        const a = poly1[i];
        const b = poly1[(i + 1) % n1];
        const splits: { t: number; pt: Point2D }[] = [
          { t: 0, pt: a },
          { t: 1, pt: b },
        ];

        for (let j = 0; j < n2; j++) {
          const c = poly2[j];
          const d = poly2[(j + 1) % n2];
          const inter = this.lineIntersection(a, b, c, d);
          if (inter) {
            const t = distToSegment(inter, a, b).t;
            if (t > 1e-4 && t < 1 - 1e-4) {
              splits.push({ t, pt: inter });
            }
          }
        }

        for (let j = 0; j < n2; j++) {
          const v = poly2[j];
          const projInfo = distToSegment(v, a, b);
          if (projInfo.dist <= seamTolerance && projInfo.t > 1e-3 && projInfo.t < 1 - 1e-3) {
            splits.push({ t: projInfo.t, pt: projInfo.proj });
          }
        }

        splits.sort((s1, s2) => s1.t - s2.t);

        const uniqueSplits: Point2D[] = [splits[0].pt];
        for (let k = 1; k < splits.length; k++) {
          const prev = uniqueSplits[uniqueSplits.length - 1];
          const cur = splits[k].pt;
          if (Math.hypot(cur.x - prev.x, cur.y - prev.y) > 0.5) {
            uniqueSplits.push(cur);
          }
        }

        for (let k = 0; k < uniqueSplits.length - 1; k++) {
          edges.push({
            p1: uniqueSplits[k],
            p2: uniqueSplits[k + 1],
            polyIdx: pIdx,
          });
        }
      }

      return edges;
    };

    const edgesA = splitPolyEdges(ccwA, ccwB, 0);
    const edgesB = splitPolyEdges(ccwB, ccwA, 1);

    // 2. Фильтруем внутренние и противоположные швы
    const isOppositeEdge = (e1: DirectedEdge, e2: DirectedEdge): boolean => {
      const d1 = Math.hypot(e1.p1.x - e2.p2.x, e1.p1.y - e2.p2.y);
      const d2 = Math.hypot(e1.p2.x - e2.p1.x, e1.p2.y - e2.p1.y);
      if (d1 <= seamTolerance && d2 <= seamTolerance) return true;

      const mid1 = { x: (e1.p1.x + e1.p2.x) / 2, y: (e1.p1.y + e1.p2.y) / 2 };
      const mid2 = { x: (e2.p1.x + e2.p2.x) / 2, y: (e2.p1.y + e2.p2.y) / 2 };
      const dMid = Math.hypot(mid1.x - mid2.x, mid1.y - mid2.y);
      const dot =
        (e1.p2.x - e1.p1.x) * (e2.p2.x - e2.p1.x) +
        (e1.p2.y - e1.p1.y) * (e2.p2.y - e2.p1.y);

      if (dMid <= seamTolerance && dot < 0) return true;
      return false;
    };

    const keepEdgesA = edgesA.filter((ea) => {
      const mid = { x: (ea.p1.x + ea.p2.x) / 2, y: (ea.p1.y + ea.p2.y) / 2 };
      if (this.isPointInPolygon(mid, ccwB)) return false;
      if (edgesB.some((eb) => isOppositeEdge(ea, eb))) return false;
      return true;
    });

    const keepEdgesB = edgesB.filter((eb) => {
      const mid = { x: (eb.p1.x + eb.p2.x) / 2, y: (eb.p1.y + eb.p2.y) / 2 };
      if (this.isPointInPolygon(mid, ccwA)) return false;
      if (edgesA.some((ea) => isOppositeEdge(eb, ea))) return false;
      return true;
    });

    const allOuterEdges = [...keepEdgesA, ...keepEdgesB];
    if (allOuterEdges.length < 3) return null;

    // 3. Сшиваем внешние рёбра в замкнутый контур
    const used = new Array(allOuterEdges.length).fill(false);
    const resultPoints: Point2D[] = [];

    let currentEdgeIdx = 0;
    used[currentEdgeIdx] = true;
    resultPoints.push(allOuterEdges[currentEdgeIdx].p1);
    resultPoints.push(allOuterEdges[currentEdgeIdx].p2);

    for (let step = 1; step < allOuterEdges.length; step++) {
      const lastPt = resultPoints[resultPoints.length - 1];
      let bestNextIdx = -1;
      let bestDist = Infinity;

      for (let i = 0; i < allOuterEdges.length; i++) {
        if (used[i]) continue;
        const d = Math.hypot(allOuterEdges[i].p1.x - lastPt.x, allOuterEdges[i].p1.y - lastPt.y);
        if (d < bestDist) {
          bestDist = d;
          bestNextIdx = i;
        }
      }

      if (bestNextIdx !== -1 && bestDist <= seamTolerance * 3) {
        used[bestNextIdx] = true;
        resultPoints.push(allOuterEdges[bestNextIdx].p2);
      } else {
        break;
      }
    }

    const startPt = resultPoints[0];
    const endPt = resultPoints[resultPoints.length - 1];
    if (Math.hypot(startPt.x - endPt.x, startPt.y - endPt.y) < seamTolerance * 3) {
      resultPoints.pop();
    }

    const cleaned = this.cleanCollinearPoints(resultPoints);
    const area = this.calculatePolygonArea(cleaned);
    const areaA = this.calculatePolygonArea(polyA);
    const areaB = this.calculatePolygonArea(polyB);

    if (area < Math.max(areaA, areaB) * 0.7) {
      return null;
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

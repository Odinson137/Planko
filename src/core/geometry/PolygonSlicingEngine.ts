import type { WallPanelPiece, WallJointLine } from '../models/Wall';
import type { SlatProfileShape } from '../models/AllWallCatalog';
import type { Opening } from '../models/Opening';
import { MATERIAL_NONE_ID } from '../models/Material';

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
  reliefType?: SlatProfileShape;
  textureCategory?: string;
  partLabel?: string;
  patternAngleDeg?: number;
  patternFlipX?: boolean;
  isVoid?: boolean;
  note?: string;
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
    cutSegments?: { p1: Point2D; p2: Point2D }[];
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

        const nextIdx = (i + 1) % n;
        const nextIsOnLine = Math.abs(d[nextIdx]) <= EPS;

        // Вершина является точкой пересечения линии с контуром, если:
        // 1. Контур переходит с одной стороны линии на другую (prevNonZeroD * nextNonZeroD < 0)
        // 2. При наличии коллинеарного ребра на линии точка выхода создается на его конце (!nextIsOnLine)
        const isCrossingVertex = prevNonZeroD * nextNonZeroD < 0 && !nextIsOnLine;

        if (isCrossingVertex) {
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

    // Проверяем, что отрезок ножа [p1, p2] реально рассекает полигон
    const tol = Math.max(25.0, 0.05 * len);
    const validPairs: { n1: AugNode; n2: AugNode }[] = [];

    for (let i = 0; i < intersections.length - 1; i += 2) {
      const n1 = intersections[i];
      const n2 = intersections[i + 1];
      const t1 = n1.t || 0;
      const t2 = n2.t || 0;
      const minT = Math.min(t1, t2);
      const maxT = Math.max(t1, t2);

      const s1 = minT / len;
      const s2 = maxT / len;

      if (s2 >= -tol && s1 <= len + tol) {
        n1.linePartner = n2;
        n2.linePartner = n1;
        validPairs.push({ n1, n2 });
      } else {
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

    const cutSegments: { p1: Point2D; p2: Point2D }[] = validPairs.map((pair) => ({
      p1: { ...pair.n1.pt },
      p2: { ...pair.n2.pt },
    }));

    return {
      pieceA: piecesA[0],
      pieceB: piecesB[0],
      piecesA,
      piecesB,
      allPieces: [...piecesA, ...piecesB],
      cutSegments,
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
        if (split && split.allPieces && split.allPieces.length > 0) {
          split.allPieces.forEach((p) => {
            if (this.calculatePolygonArea(p) < 10) return;
            const pXs = p.map((pt) => pt.x);
            const pMidX = (Math.min(...pXs) + Math.max(...pXs)) / 2;
            if (pMidX < curX) {
              finalPolys.push(p);
            } else {
              nextRemaining.push(p);
            }
          });
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
  /**
   * Проверяет, примыкают ли два полигона друг к другу (расстояние между ними <= seamTolerance)
   */
  public static arePolygonsAdjacent(
    polyA: Point2D[],
    polyB: Point2D[],
    seamTolerance: number = 20
  ): boolean {
    if (!polyA || !polyB || polyA.length < 3 || polyB.length < 3) return false;

    const xsA = polyA.map((p) => p.x);
    const ysA = polyA.map((p) => p.y);
    const minXA = Math.min(...xsA);
    const maxXA = Math.max(...xsA);
    const minYA = Math.min(...ysA);
    const maxYA = Math.max(...ysA);

    const xsB = polyB.map((p) => p.x);
    const ysB = polyB.map((p) => p.y);
    const minXB = Math.min(...xsB);
    const maxXB = Math.max(...xsB);
    const minYB = Math.min(...ysB);
    const maxYB = Math.max(...ysB);

    // Быстрая проверка габаритных прямоугольников с допуском
    if (
      maxXA < minXB - seamTolerance ||
      minXA > maxXB + seamTolerance ||
      maxYA < minYB - seamTolerance ||
      minYA > maxYB + seamTolerance
    ) {
      return false;
    }

    // Проверка расстояния от вершин A до рёбер B и наоборот
    const distToSeg = (p: Point2D, a: Point2D, b: Point2D) => {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const lenSq = dx * dx + dy * dy;
      if (lenSq < 1e-6) return Math.hypot(p.x - a.x, p.y - a.y);
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
      return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
    };

    const nA = polyA.length;
    const nB = polyB.length;

    for (let i = 0; i < nA; i++) {
      const p = polyA[i];
      for (let j = 0; j < nB; j++) {
        const d = distToSeg(p, polyB[j], polyB[(j + 1) % nB]);
        if (d <= seamTolerance) return true;
      }
    }

    for (let j = 0; j < nB; j++) {
      const p = polyB[j];
      for (let i = 0; i < nA; i++) {
        const d = distToSeg(p, polyA[i], polyA[(i + 1) % nA]);
        if (d <= seamTolerance) return true;
      }
    }

    return false;
  }

  /**
   * Проверяет, что все выбранные полигоны образуют единую непрерывную смежную группу (связный граф)
   */
  public static areAllPolygonsConnected(
    polygons: Point2D[][],
    seamTolerance: number = 20
  ): boolean {
    if (!polygons || polygons.length <= 1) return true;
    const n = polygons.length;

    // Построение графа смежности
    const adj: number[][] = Array.from({ length: n }, () => []);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (this.arePolygonsAdjacent(polygons[i], polygons[j], seamTolerance)) {
          adj[i].push(j);
          adj[j].push(i);
        }
      }
    }

    // Обход в ширину (BFS) для проверки связности
    const visited = new Set<number>();
    const queue: number[] = [0];
    visited.add(0);

    while (queue.length > 0) {
      const u = queue.shift()!;
      for (const v of adj[u]) {
        if (!visited.has(v)) {
          visited.add(v);
          queue.push(v);
        }
      }
    }

    return visited.size === n;
  }

  /**
   * Объединяет массив многоугольников в единый внешний контур
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
    snapRadius: number = 10
  ): SnapResult {
    const cornerSnapRadius = snapRadius;
    const midSnapRadius = Math.max(6, Math.round(snapRadius * 0.8));
    const angleToleranceDeg = 1.8;

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

      // Мягкий угловой замок (0°, 45°, 90°, 135°, 180°, 225°, 270°, 315°)
      let isAngleSnapped = false;
      let targetAngle = angleDeg;
      let angleLabel = '';
      const snapAngles = [0, 45, 90, 135, 180, 225, 270, 315, 360];
      for (const sa of snapAngles) {
        if (Math.abs(angleDeg - sa) <= angleToleranceDeg || Math.abs(angleDeg - (sa - 360)) <= angleToleranceDeg) {
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

        // Деликатная доводка до вершины/угла или середины
        existingPolygons.forEach((poly) => {
          poly.forEach((v) => {
            if (Math.hypot(finalPoint.x - v.x, finalPoint.y - v.y) < cornerSnapRadius) {
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
            if (Math.hypot(finalPoint.x - mid.x, finalPoint.y - mid.y) < midSnapRadius) {
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

    // 2. Если стартовая точка ещё не выбрана: привязка к граням / вершинам / серединам
    let bestDist = Infinity;
    let bestPoint = { ...rawPoint };
    let snapType: SnapResult['snapType'] = undefined;
    let label = 'Грань';
    let selectedEdge: { p1: Point2D; p2: Point2D } | null = null;

    // 2.1 Проверяем вершины и углы с мягким радиусом
    existingPolygons.forEach((poly) => {
      const n = poly.length;
      for (let i = 0; i < n; i++) {
        const v = poly[i];
        const d = Math.hypot(rawPoint.x - v.x, rawPoint.y - v.y);
        if (d < cornerSnapRadius && d < bestDist) {
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
          if (dm < midSnapRadius && dm < bestDist) {
            bestDist = dm;
            bestPoint = { ...mid };
            snapType = 'MIDPOINT';
            label = 'Середина 50%';
            selectedEdge = { p1, p2 };
          }
        }
      });
    }

    // 2.3 Проецируем на ближайшую грань
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

  /**
   * Разрезает отдельный WallPanelPiece произвольной линией p1-p2
   */
  public static splitWallPanel(
    panel: WallPanelPiece,
    p1: Point2D,
    p2: Point2D,
    seamGap: number = 8
  ): { newPanels: WallPanelPiece[]; joint: WallJointLine } | null {
    const splitResult = this.splitPolygonByLine(panel.points, p1, p2, seamGap);
    if (!splitResult) return null;

    const allPolys = splitResult.allPieces || (
      splitResult.piecesA && splitResult.piecesB
        ? [...splitResult.piecesA, ...splitResult.piecesB]
        : [splitResult.pieceA, splitResult.pieceB].filter(Boolean)
    );

    if (allPolys.length < 2) return null;

    const newPanels: WallPanelPiece[] = allPolys.map((poly, idx) => ({
      ...panel,
      id: `panel-${Date.now()}-${idx + 1}-${Math.random().toString(36).substring(2, 6)}`,
      points: poly,
      partLabel: `${panel.partLabel}.${idx + 1}`,
    }));

    const isVert = Math.abs(p1.x - p2.x) < 1e-4;
    const isHoriz = Math.abs(p1.y - p2.y) < 1e-4;
    const orientation = isVert ? 'VERTICAL' : (isHoriz ? 'HORIZONTAL' : 'DIAGONAL');

    const cutSegments = splitResult.cutSegments || [];
    const jointP1 = cutSegments[0]?.p1 || p1;
    const jointP2 = cutSegments[0]?.p2 || p2;

    const joint: WallJointLine = {
      id: `joint-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      p1: jointP1,
      p2: jointP2,
      width: seamGap,
      isLED: false,
      orientation,
    };

    return { newPanels, joint };
  }

  /**
   * Умный расчет направления взятия зазора стыка (takeSide):
   * Автоматически определяет, примыкает ли стык к стене (границе) или проему двери/окна,
   * и выбирает сторону забора размера так, чтобы внешние границы стены и проемы не смещались.
   */
  public static getSmartJointTakeSide(
    joint: WallJointLine | { id: string; p1?: Point2D; p2?: Point2D; x?: number; y?: number; orientation?: string },
    wallWidth: number,
    wallHeight: number,
    openings: Opening[] = []
  ): 'BOTH' | 'LEFT' | 'RIGHT' | 'TOP' | 'BOTTOM' {
    const p1 = joint.p1 || { x: (joint as any).x || 0, y: (joint as any).y || 0 };
    const p2 = joint.p2 || { x: (joint as any).x || 0, y: (joint as any).y || 0 };
    const isVert = joint.orientation === 'VERTICAL' || Math.abs(p1.x - p2.x) <= Math.abs(p1.y - p2.y);

    const cutoutOpenings = (openings || []).filter((op) => op.isCutout !== false);
    const isInsideOpening = (pt: Point2D) =>
      cutoutOpenings.some(
        (op) =>
          pt.x >= op.x - 2 &&
          pt.x <= op.x + op.width + 2 &&
          pt.y >= op.y - 2 &&
          pt.y <= op.y + op.height + 2
      );

    if (isVert) {
      const jX = (p1.x + p2.x) / 2;
      const midY = (p1.y + p2.y) / 2;

      // 1. Примыкание к левой или правой стене (краю стены)
      const nearLeftWall = jX <= 15;
      const nearRightWall = jX >= wallWidth - 15;

      // 2. Проверка прилегания к проемам слева и справа
      const ptLeft = { x: jX - 25, y: midY };
      const ptRight = { x: jX + 25, y: midY };
      const leftIsOpening = isInsideOpening(ptLeft);
      const rightIsOpening = isInsideOpening(ptRight);

      if ((nearLeftWall || leftIsOpening) && !(nearRightWall || rightIsOpening)) {
        return 'RIGHT'; // Забирать только справа, левая стена/проем зафиксирована
      }
      if ((nearRightWall || rightIsOpening) && !(nearLeftWall || leftIsOpening)) {
        return 'LEFT'; // Забирать только слева, правая стена/проем зафиксирована
      }
      return 'BOTH';
    } else {
      const jY = (p1.y + p2.y) / 2;
      const midX = (p1.x + p2.x) / 2;

      // 1. Примыкание к полу или потолку (краю стены)
      const nearBottomWall = jY <= 15;
      const nearTopWall = jY >= wallHeight - 15;

      // 2. Проверка прилегания к проемам снизу и сверху
      const ptBottom = { x: midX, y: jY - 25 };
      const ptTop = { x: midX, y: jY + 25 };
      const bottomIsOpening = isInsideOpening(ptBottom);
      const topIsOpening = isInsideOpening(ptTop);

      if ((nearBottomWall || bottomIsOpening) && !(nearTopWall || topIsOpening)) {
        return 'TOP'; // Забирать только сверху, пол/проем снизу зафиксирован
      }
      if ((nearTopWall || topIsOpening) && !(nearBottomWall || bottomIsOpening)) {
        return 'BOTTOM'; // Забирать только снизу, потолок/проем сверху зафиксирован
      }
      return 'BOTH';
    }
  }

  /**
   * Корректирует геометрию полигонов панелей при изменении толщины шва между ними.
   * Учитывает параметр takeSide (BOTH, LEFT, RIGHT, TOP, BOTTOM) или авто-определение примыканий.
   */
  public static adjustPanelsForJointWidthChange(
    panels: WallPanelPiece[],
    joint: WallJointLine,
    oldWidth: number,
    newWidth: number,
    wallWidth: number,
    wallHeight: number,
    openings: Opening[] = [],
    takeSideOverride?: 'BOTH' | 'LEFT' | 'RIGHT' | 'TOP' | 'BOTTOM'
  ): WallPanelPiece[] {
    const delta = newWidth - oldWidth;
    if (Math.abs(delta) < 1e-4) return panels;

    let p1 = joint.p1;
    let p2 = joint.p2;
    if (!p1 || !p2) return panels;

    // Нормализуем направление отрезка: ориентируем вверх (dy > 0) или вправо (dx > 0)
    let dx = p2.x - p1.x;
    let dy = p2.y - p1.y;
    if (dy < -1e-4 || (Math.abs(dy) <= 1e-4 && dx < -1e-4)) {
      const temp = p1;
      p1 = p2;
      p2 = temp;
      dx = p2.x - p1.x;
      dy = p2.y - p1.y;
    }

    const len = Math.hypot(dx, dy);
    if (len < 1e-4) return panels;

    const halfDelta = delta / 2;
    const nx = -dy / len;
    const ny = dx / len;

    // Определяем эффективную сторону взятия зазора
    const effTakeSide =
      takeSideOverride ||
      joint.takeSide ||
      this.getSmartJointTakeSide(joint, wallWidth, wallHeight, openings);

    const isVert = Math.abs(dx) <= Math.abs(dy);

    // Максимальное расстояние от линии шва, на котором точка считается принадлежащей стыку
    const maxThreshold = Math.max(35, Math.max(oldWidth, newWidth) / 2 + 15);

    return panels.map((panel) => {
      const centroid = this.calculateCentroid(panel.points);
      const hCentroid = (centroid.x - p1.x) * nx + (centroid.y - p1.y) * ny;

      const nextPoints = panel.points.map((pt) => {
        // Проекция на отрезок шва
        const t = ((pt.x - p1.x) * dx + (pt.y - p1.y) * dy) / len;
        // Расстояние со знаком от линии шва
        const h = (pt.x - p1.x) * nx + (pt.y - p1.y) * ny;

        // Точка лежит вдоль отрезка шва и прилегает к зазору
        if (t >= -5 && t <= len + 5 && Math.abs(h) <= maxThreshold) {
          const isPosSide = Math.abs(h) > 1e-3 ? h > 0 : hCentroid >= 0;

          let shift = 0;
          if (isVert) {
            // Для вертикального шва: PosSide (nx=-1) это СЛЕВА, NegSide это СПРАВА
            if (effTakeSide === 'LEFT') {
              // Берем только с левой панели (левая сдвигается на полный delta, правая на месте)
              shift = isPosSide ? delta : 0;
            } else if (effTakeSide === 'RIGHT') {
              // Берем только с правой панели (правая сдвигается на полный delta, левая на месте)
              shift = isPosSide ? 0 : -delta;
            } else {
              // Симметрично
              shift = isPosSide ? halfDelta : -halfDelta;
            }
          } else {
            // Для горизонтального шва: PosSide (ny=1) это СВЕРХУ, NegSide это СНИЗУ
            if (effTakeSide === 'TOP') {
              // Берем только с верхней панели
              shift = isPosSide ? delta : 0;
            } else if (effTakeSide === 'BOTTOM') {
              // Берем только с нижней панели
              shift = isPosSide ? 0 : -delta;
            } else {
              // Симметрично
              shift = isPosSide ? halfDelta : -halfDelta;
            }
          }

          const newX = Math.max(0, Math.min(wallWidth, Math.round((pt.x + shift * nx) * 10) / 10));
          const newY = Math.max(0, Math.min(wallHeight, Math.round((pt.y + shift * ny) * 10) / 10));

          return { x: newX, y: newY };
        }

        return pt;
      });

      return {
        ...panel,
        points: nextPoints,
      };
    });
  }

  /**
   * Корректирует геометрию полигонов панелей при переключении направления забора зазора (takeSide),
   * сохраняя общую ширину стыка неизменной, но смещая границу панелей мгновенно.
   * Например: при ширине 8 мм переход с BOTH в RIGHT смещает границу на +4 мм (левая панель получает +4 мм, правая теряет 4 мм).
   */
  public static adjustPanelsForJointTakeSideChange(
    panels: WallPanelPiece[],
    joint: WallJointLine,
    jointWidth: number,
    oldTakeSide: 'BOTH' | 'LEFT' | 'RIGHT' | 'TOP' | 'BOTTOM',
    newTakeSide: 'BOTH' | 'LEFT' | 'RIGHT' | 'TOP' | 'BOTTOM',
    wallWidth: number,
    wallHeight: number
  ): WallPanelPiece[] {
    if (oldTakeSide === newTakeSide || jointWidth <= 0) return panels;

    let p1 = joint.p1;
    let p2 = joint.p2;
    if (!p1 || !p2) return panels;

    // Нормализуем направление отрезка: ориентируем вверх (dy > 0) или вправо (dx > 0)
    let dx = p2.x - p1.x;
    let dy = p2.y - p1.y;
    if (dy < -1e-4 || (Math.abs(dy) <= 1e-4 && dx < -1e-4)) {
      const temp = p1;
      p1 = p2;
      p2 = temp;
      dx = p2.x - p1.x;
      dy = p2.y - p1.y;
    }

    const len = Math.hypot(dx, dy);
    if (len < 1e-4) return panels;

    const nx = -dy / len;
    const ny = dx / len;
    const isVert = Math.abs(dx) <= Math.abs(dy);

    // Вычисляем смещение центра зазора вдоль нормали n
    const getNormalOffset = (side: 'BOTH' | 'LEFT' | 'RIGHT' | 'TOP' | 'BOTTOM') => {
      const half = jointWidth / 2;
      if (isVert) {
        if (side === 'LEFT') return half;   // сдвиг шва влево (+n)
        if (side === 'RIGHT') return -half; // сдвиг шва вправо (-n)
        return 0;
      } else {
        if (side === 'TOP') return half;     // сдвиг шва вверх (+n)
        if (side === 'BOTTOM') return -half; // сдвиг шва вниз (-n)
        return 0;
      }
    };

    const deltaOffset = getNormalOffset(newTakeSide) - getNormalOffset(oldTakeSide);
    if (Math.abs(deltaOffset) < 1e-4) return panels;

    const maxThreshold = Math.max(35, jointWidth + 15);

    return panels.map((panel) => {
      const nextPoints = panel.points.map((pt) => {
        const t = ((pt.x - p1.x) * dx + (pt.y - p1.y) * dy) / len;
        const h = (pt.x - p1.x) * nx + (pt.y - p1.y) * ny;

        if (t >= -5 && t <= len + 5 && Math.abs(h) <= maxThreshold) {
          // Обе стороны стыка смещаются на один и тот же deltaOffset вдоль нормали
          const newX = Math.max(0, Math.min(wallWidth, Math.round((pt.x + deltaOffset * nx) * 10) / 10));
          const newY = Math.max(0, Math.min(wallHeight, Math.round((pt.y + deltaOffset * ny) * 10) / 10));

          return { x: newX, y: newY };
        }

        return pt;
      });

      return {
        ...panel,
        points: nextPoints,
      };
    });
  }

  /**
   * Автоматически нарезает WallPanelPiece на вертикальные ламели заданной ширины
   */
  public static sliceWallPanelIntoStrips(
    panel: WallPanelPiece,
    stripWidth: number,
    seamGap: number = 8
  ): { newPanels: WallPanelPiece[]; joints: WallJointLine[] } {
    const xs = panel.points.map((p) => p.x);
    const ys = panel.points.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const totalW = maxX - minX;

    if (totalW <= stripWidth + 2 || stripWidth <= 0) {
      return { newPanels: [panel], joints: [] };
    }

    const isSlat =
      panel.reliefType !== 'FLAT' ||
      panel.materialId?.includes('slat') ||
      panel.decorName?.toLowerCase().includes('рейка');
    const effSeamGap = isSlat ? 0 : seamGap;

    const dummySubPiece: PolygonSubPiece = {
      ...panel,
      areaSqM: Math.round((this.calculatePolygonArea(panel.points) / 1_000_000) * 1000) / 1000,
    };

    const strips = this.slicePolygonIntoVerticalStrips(
      panel.points,
      stripWidth,
      dummySubPiece,
      panel.partLabel || '1.1',
      effSeamGap
    );

    const newPanels: WallPanelPiece[] = strips.map((sp, idx) => ({
      ...panel,
      id: `panel-${Date.now()}-${idx + 1}-${Math.random().toString(36).substring(2, 6)}`,
      points: sp.points,
      partLabel: sp.partLabel || `${panel.partLabel}.${idx + 1}`,
      materialId: sp.materialId || panel.materialId,
      color: sp.color || panel.color,
      decorCode: sp.decorCode || panel.decorCode,
      decorName: sp.decorName || panel.decorName,
      thickness: sp.thickness || panel.thickness,
      reliefType: sp.reliefType || panel.reliefType,
      textureCategory: sp.textureCategory || panel.textureCategory,
      patternAngleDeg: sp.patternAngleDeg !== undefined ? sp.patternAngleDeg : panel.patternAngleDeg,
      patternFlipX: sp.patternFlipX !== undefined ? sp.patternFlipX : panel.patternFlipX,
      isVoid: sp.isVoid !== undefined ? sp.isVoid : panel.isVoid,
    }));

    const joints: WallJointLine[] = [];
    let curX = minX + stripWidth;
    while (curX < maxX - 5) {
      const cutP1 = { x: curX, y: minY - 10 };
      const cutP2 = { x: curX, y: maxY + 10 };
      const cutRes = this.splitPolygonByLine(panel.points, cutP1, cutP2, 0);
      if (cutRes && cutRes.cutSegments && cutRes.cutSegments.length > 0) {
        cutRes.cutSegments.forEach((seg, sIdx) => {
          joints.push({
            id: `joint-${Date.now()}-${joints.length + 1}-${sIdx}`,
            p1: seg.p1,
            p2: seg.p2,
            width: effSeamGap,
            isLED: false,
            orientation: 'VERTICAL',
          });
        });
      } else {
        joints.push({
          id: `joint-${Date.now()}-${joints.length + 1}`,
          p1: { x: curX, y: minY },
          p2: { x: curX, y: maxY },
          width: effSeamGap,
          isLED: false,
          orientation: 'VERTICAL',
        });
      }
      curX += stripWidth;
    }

    return { newPanels, joints };
  }

  /**
   * Вычитает прямоугольник выреза (проем двери, окна, ниши) из полигона без повреждения смежных областей
   */
  public static subtractRectangleFromPolygon(
    polygon: Point2D[],
    rect: { x: number; y: number; width: number; height: number }
  ): Point2D[][] {
    if (!polygon || polygon.length < 3) return [];

    const opLeft = rect.x;
    const opRight = rect.x + rect.width;
    const opBottom = rect.y;
    const opTop = rect.y + rect.height;

    const xs = polygon.map((p) => p.x);
    const ys = polygon.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    // 1. Если полигон вообще не пересекается с вырезом -> возвращаем неизменным
    if (maxX <= opLeft + 0.1 || minX >= opRight - 0.1 || maxY <= opBottom + 0.1 || minY >= opTop - 0.1) {
      return [polygon];
    }

    // 2. Если полигон полностью лежит внутри выреза -> удаляем
    if (minX >= opLeft - 0.1 && maxX <= opRight + 0.1 && minY >= opBottom - 0.1 && maxY <= opTop + 0.1) {
      return [];
    }

    // 3. Отсекаем левую область (x <= opLeft) — она полностью вне проема
    let leftPieces: Point2D[][] = [];
    let remAfterLeft: Point2D[][] = [polygon];

    if (opLeft > minX + 0.1 && opLeft < maxX - 0.1) {
      const split = this.splitPolygonByLine(polygon, { x: opLeft, y: -10000 }, { x: opLeft, y: 10000 }, 0);
      if (split && split.allPieces && split.allPieces.length >= 2) {
        leftPieces = split.allPieces.filter((p) => this.calculateCentroid(p).x <= opLeft + 0.05);
        remAfterLeft = split.allPieces.filter((p) => this.calculateCentroid(p).x > opLeft + 0.05);
      }
    } else if (maxX <= opLeft + 0.1) {
      return [polygon];
    }

    // 4. Из оставшейся части отсекаем правую область (x >= opRight) — она полностью вне проема
    let rightPieces: Point2D[][] = [];
    let centerColPieces: Point2D[][] = [];

    for (const poly of remAfterLeft) {
      const polyXs = poly.map((p) => p.x);
      const polyMinX = Math.min(...polyXs);
      const polyMaxX = Math.max(...polyXs);

      if (opRight > polyMinX + 0.1 && opRight < polyMaxX - 0.1) {
        const split = this.splitPolygonByLine(poly, { x: opRight, y: -10000 }, { x: opRight, y: 10000 }, 0);
        if (split && split.allPieces && split.allPieces.length >= 2) {
          centerColPieces.push(...split.allPieces.filter((p) => this.calculateCentroid(p).x <= opRight + 0.05));
          rightPieces.push(...split.allPieces.filter((p) => this.calculateCentroid(p).x > opRight + 0.05));
        } else {
          centerColPieces.push(poly);
        }
      } else if (polyMinX >= opRight - 0.1) {
        rightPieces.push(poly);
      } else {
        centerColPieces.push(poly);
      }
    }

    // 5. Только центральную колонку (opLeft <= x <= opRight) рассекаем по горизонтали (верх и низ проема)
    let centerTopPieces: Point2D[][] = [];
    let centerBottomPieces: Point2D[][] = [];

    for (const poly of centerColPieces) {
      let currentSub = [poly];

      const polyYs = poly.map((p) => p.y);
      const polyMinY = Math.min(...polyYs);
      const polyMaxY = Math.max(...polyYs);

      // Рез по верху проема opTop
      if (opTop > polyMinY + 0.1 && opTop < polyMaxY - 0.1) {
        const nextSub: Point2D[][] = [];
        for (const sp of currentSub) {
          const split = this.splitPolygonByLine(sp, { x: -10000, y: opTop }, { x: 10000, y: opTop }, 0);
          if (split && split.allPieces && split.allPieces.length >= 2) {
            nextSub.push(...split.allPieces);
          } else {
            nextSub.push(sp);
          }
        }
        currentSub = nextSub;
      }

      // Рез по низу проема opBottom
      if (opBottom > polyMinY + 0.1 && opBottom < polyMaxY - 0.1) {
        const nextSub: Point2D[][] = [];
        for (const sp of currentSub) {
          const split = this.splitPolygonByLine(sp, { x: -10000, y: opBottom }, { x: 10000, y: opBottom }, 0);
          if (split && split.allPieces && split.allPieces.length >= 2) {
            nextSub.push(...split.allPieces);
          } else {
            nextSub.push(sp);
          }
        }
        currentSub = nextSub;
      }

      // Удаляем кусок строго внутри выреза
      for (const sp of currentSub) {
        const c = this.calculateCentroid(sp);
        const isInsideCutout =
          c.x >= opLeft - 0.5 &&
          c.x <= opRight + 0.5 &&
          c.y >= opBottom - 0.5 &&
          c.y <= opTop + 0.5;

        if (!isInsideCutout && this.calculatePolygonArea(sp) >= 10) {
          if (c.y >= opTop - 0.1) {
            centerTopPieces.push(sp);
          } else if (c.y <= opBottom + 0.1) {
            centerBottomPieces.push(sp);
          }
        }
      }
    }

    // 6. Собираем все сохраненные детали: leftPieces, centerTopPieces, centerBottomPieces, rightPieces
    const allKept = [...leftPieces, ...centerTopPieces, ...centerBottomPieces, ...rightPieces].filter(
      (p) => this.calculatePolygonArea(p) >= 10
    );

    if (allKept.length <= 1) {
      return allKept;
    }

    // 7. Объединяем смежные примыкающие детали одной панели
    let clusters: Point2D[][] = [...allKept];
    let merged = true;
    let iterations = 0;
    while (merged && iterations++ < 15 && clusters.length > 1) {
      merged = false;
      for (let i = 0; i < clusters.length; i++) {
        for (let j = i + 1; j < clusters.length; j++) {
          if (this.arePolygonsAdjacent(clusters[i], clusters[j], 16)) {
            const united = this.unionTwoPolygons(clusters[i], clusters[j], 16);
            if (united && united.length >= 3) {
              clusters.splice(j, 1);
              clusters[i] = united;
              merged = true;
              break;
            }
          }
        }
        if (merged) break;
      }
    }

    return clusters;
  }

  /**
   * Вырезает прямоугольный проем (дверь, окно, нишу) из набора WallPanelPiece без создания искусственных блоков над проемом
   */
  public static cutOpeningFromWallPanels(
    panels: WallPanelPiece[],
    opening: { id: string; name?: string; x: number; y: number; width: number; height: number },
    _seamGap: number = 8
  ): { newPanels: WallPanelPiece[]; joints: WallJointLine[] } {
    const resultPanels: WallPanelPiece[] = [];

    const opLeft = opening.x;
    const opRight = opening.x + opening.width;
    const opBottom = opening.y;
    const opTop = opening.y + opening.height;

    for (const panel of panels) {
      // 1. Пустые поверхности (ПУСТОТА / MATERIAL_NONE_ID) не должны разрезаться на куски
      if (panel.isVoid || panel.materialId === MATERIAL_NONE_ID) {
        resultPanels.push(panel);
        continue;
      }

      // 2. Проверяем пересечение с проемом по bounding box
      const xs = panel.points.map((p) => p.x);
      const ys = panel.points.map((p) => p.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);

      if (maxX <= opLeft + 0.1 || minX >= opRight - 0.1 || maxY <= opBottom + 0.1 || minY >= opTop - 0.1) {
        // Панель не пересекается с проемом - оставляем её в исходном виде
        resultPanels.push(panel);
        continue;
      }

      // 3. Вырезаем проем только из той панели, куда он вставляется
      const remainingPolys = this.subtractRectangleFromPolygon(panel.points, opening);
      if (remainingPolys.length === 0) {
        continue;
      }
      remainingPolys.forEach((poly, kIdx) => {
        resultPanels.push({
          ...panel,
          id: remainingPolys.length === 1 && kIdx === 0
            ? panel.id
            : `panel-${Date.now()}-${resultPanels.length + 1}-${kIdx + 1}-${Math.random().toString(36).substring(2, 5)}`,
          points: poly,
          partLabel: remainingPolys.length > 1 ? `${panel.partLabel}.${kIdx + 1}` : panel.partLabel,
        });
      });
    }

    return { newPanels: resultPanels, joints: [] };
  }
}

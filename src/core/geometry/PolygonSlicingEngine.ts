import type { WallPanelPiece, WallJointLine, Wall, PanelEdgesConfig } from '../models/Wall';
import type { SlatProfileShape } from '../models/AllWallCatalog';
import type { Opening } from '../models/Opening';
import { MATERIAL_NONE_ID, Material } from '../models/Material';

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
  edges?: PanelEdgesConfig;
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
   * Формат заполнения: [максимальная ширина] + [стык seamGap] + [максимальная ширина] + ...
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

    if (totalW <= stripWidth + 2) {
      return [baseSubPiece];
    }

    const finalPolys: Point2D[][] = [];
    let remainingPolys: Point2D[][] = [polygon];

    let curStart = minX;
    while (curStart + stripWidth < maxX - 5) {
      const cutLeft = curStart + stripWidth;
      const cutRight = cutLeft + seamGap;
      const nextRemaining: Point2D[][] = [];

      for (const piece of remainingPolys) {
        const pieceMinX = Math.min(...piece.map((p) => p.x));
        const pieceMaxX = Math.max(...piece.map((p) => p.x));

        if (pieceMaxX <= cutLeft + 1e-4) {
          finalPolys.push(piece);
          continue;
        }
        if (pieceMinX >= cutRight - 1e-4) {
          nextRemaining.push(piece);
          continue;
        }

        // 1. Отрезаем панель полной ширины stripWidth (1200 мм)
        const splitLeft = this.splitPolygonByLine(piece, { x: cutLeft, y: minY }, { x: cutLeft, y: maxY }, 0);
        if (splitLeft && splitLeft.allPieces && splitLeft.allPieces.length > 0) {
          splitLeft.allPieces.forEach((p) => {
            if (this.calculatePolygonArea(p) < 10) return;
            const pXs = p.map((pt) => pt.x);
            const pMidX = (Math.min(...pXs) + Math.max(...pXs)) / 2;
            if (pMidX <= cutLeft + 1e-4) {
              finalPolys.push(p);
            } else {
              // 2. Вычитаем зазор шва seamGap (если он > 0)
              if (seamGap > 0) {
                const splitRight = this.splitPolygonByLine(p, { x: cutRight, y: minY }, { x: cutRight, y: maxY }, 0);
                if (splitRight && splitRight.allPieces && splitRight.allPieces.length > 0) {
                  splitRight.allPieces.forEach((pr) => {
                    if (this.calculatePolygonArea(pr) < 10) return;
                    const prMidX = (Math.min(...pr.map((pt) => pt.x)) + Math.max(...pr.map((pt) => pt.x))) / 2;
                    if (prMidX >= cutRight - 1e-4) {
                      nextRemaining.push(pr);
                    }
                  });
                }
              } else {
                nextRemaining.push(p);
              }
            }
          });
        } else {
          nextRemaining.push(piece);
        }
      }

      remainingPolys = nextRemaining;
      curStart += stripWidth + seamGap;
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
    if (!points || points.length <= 3) return points || [];
    let current = [...points];
    let changed = true;
    let iterations = 0;

    while (changed && iterations++ < 5 && current.length > 3) {
      changed = false;
      const cleaned: Point2D[] = [];
      const n = current.length;

      for (let i = 0; i < n; i++) {
        const pPrev = current[(i - 1 + n) % n];
        const pCur = current[i];
        const pNext = current[(i + 1) % n];

        if (Math.hypot(pCur.x - pPrev.x, pCur.y - pPrev.y) < 0.5) {
          changed = true;
          continue;
        }

        const v1x = pCur.x - pPrev.x;
        const v1y = pCur.y - pPrev.y;
        const v2x = pNext.x - pCur.x;
        const v2y = pNext.y - pCur.y;
        const len1 = Math.hypot(v1x, v1y);
        const len2 = Math.hypot(v2x, v2y);
        if (len1 < 1e-4 || len2 < 1e-4) {
          changed = true;
          continue;
        }

        const cross = (v1x * v2y - v1y * v2x) / (len1 * len2);
        const dot = (v1x * v2x + v1y * v2y) / (len1 * len2);

        if (Math.abs(cross) < 1e-3 && dot > 0.99) {
          changed = true;
          continue;
        }

        cleaned.push(pCur);
      }

      if (cleaned.length >= 3) {
        current = cleaned;
      }
    }

    return current;
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
    seamGap: number = 0
  ): { newPanels: WallPanelPiece[]; joint?: WallJointLine } | null {
    const splitResult = this.splitPolygonByLine(panel.points, p1, p2, seamGap);
    if (!splitResult) return null;

    const allPolys = splitResult.allPieces || (
      splitResult.piecesA && splitResult.piecesB
        ? [...splitResult.piecesA, ...splitResult.piecesB]
        : [splitResult.pieceA, splitResult.pieceB].filter(Boolean)
    );

    if (allPolys.length < 2) return null;

    const isVert = Math.abs(p1.x - p2.x) < 1e-4;
    const isHoriz = Math.abs(p1.y - p2.y) < 1e-4;

    // Сортируем полигоны: по X если вертикальный разрез, по Y если горизонтальный
    const sortedPolys = [...allPolys].sort((a, b) => {
      if (isVert) {
        const minXa = Math.min(...a.map((p) => p.x));
        const minXb = Math.min(...b.map((p) => p.x));
        return minXa - minXb;
      } else {
        const minYa = Math.min(...a.map((p) => p.y));
        const minYb = Math.min(...b.map((p) => p.y));
        return minYa - minYb;
      }
    });

    const parentEdges = panel.edges || {};

    const newPanels: WallPanelPiece[] = sortedPolys.map((poly, idx) => {
      const isFirst = idx === 0;
      const isLast = idx === sortedPolys.length - 1;

      const pieceEdges: any = {};
      if (isVert) {
        if (parentEdges.top) pieceEdges.top = { ...parentEdges.top };
        if (parentEdges.bottom) pieceEdges.bottom = { ...parentEdges.bottom };
        if (isFirst && parentEdges.left) pieceEdges.left = { ...parentEdges.left };
        if (isLast && parentEdges.right) pieceEdges.right = { ...parentEdges.right };
      } else if (isHoriz) {
        if (parentEdges.left) pieceEdges.left = { ...parentEdges.left };
        if (parentEdges.right) pieceEdges.right = { ...parentEdges.right };
        if (isFirst && parentEdges.bottom) pieceEdges.bottom = { ...parentEdges.bottom };
        if (isLast && parentEdges.top) pieceEdges.top = { ...parentEdges.top };
      }

      return {
        ...panel,
        id: `panel-${Date.now()}-${idx + 1}-${Math.random().toString(36).substring(2, 6)}`,
        points: poly,
        partLabel: `${panel.partLabel}.${idx + 1}`,
        edges: pieceEdges,
      };
    });

    let joint: WallJointLine | undefined = undefined;
    if (seamGap > 0) {
      const orientation = isVert ? 'VERTICAL' : (isHoriz ? 'HORIZONTAL' : 'DIAGONAL');
      const cutSegments = splitResult.cutSegments || [];
      const jointP1 = cutSegments[0]?.p1 || p1;
      const jointP2 = cutSegments[0]?.p2 || p2;

      joint = {
        id: `joint-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        p1: jointP1,
        p2: jointP2,
        width: seamGap,
        isLED: false,
        orientation,
      };
    }

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
    const isVert =
      joint.orientation === 'VERTICAL'
        ? true
        : joint.orientation === 'HORIZONTAL'
        ? false
        : Math.abs(p1.x - p2.x) < Math.abs(p1.y - p2.y);

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

      // 1. Примыкание к правой стене (краю) или к левому косяку проема (проем справа)
      const nearRightWall = jX >= wallWidth - 15;
      const ptRight = { x: jX + 25, y: midY };
      const rightIsOpening = isInsideOpening(ptRight);

      // 2. Примыкание к левой стене (краю) или к правому косяку проема (проем слева)
      const nearLeftWall = jX <= 15;
      const ptLeft = { x: jX - 25, y: midY };
      const leftIsOpening = isInsideOpening(ptLeft);

      if ((nearRightWall || rightIsOpening) && !(nearLeftWall || leftIsOpening)) {
        return 'LEFT'; // Забирать только слева, правая стена/проем зафиксирована
      }
      if ((nearLeftWall || leftIsOpening) && !(nearRightWall || rightIsOpening)) {
        return 'RIGHT'; // Забирать только справа, левая стена/проем зафиксирована
      }
      // По умолчанию для вертикальных стыков активна правая стрелка (RIGHT)
      return 'RIGHT';
    } else {
      const jY = (p1.y + p2.y) / 2;
      const midX = (p1.x + p2.x) / 2;

      // 1. Примыкание к полу (краю стены) или к верху проема (проем снизу)
      const nearBottomWall = jY <= 15;
      const ptBottom = { x: midX, y: jY - 25 };
      const bottomIsOpening = isInsideOpening(ptBottom);

      // 2. Примыкание к потолку (краю стены) или к низу проема (проем сверху)
      const nearTopWall = jY >= wallHeight - 15;
      const ptTop = { x: midX, y: jY + 25 };
      const topIsOpening = isInsideOpening(ptTop);

      if ((nearBottomWall || bottomIsOpening) && !(nearTopWall || topIsOpening)) {
        return 'TOP'; // Забирать только сверху, пол/проем снизу зафиксирован
      }
      if ((nearTopWall || topIsOpening) && !(nearBottomWall || bottomIsOpening)) {
        return 'BOTTOM'; // Забирать только снизу, потолок/проем сверху зафиксирован
      }
      // По умолчанию для горизонтальных стыков активна нижняя стрелка (BOTTOM)
      return 'BOTTOM';
    }
  }

  /**
   * Выполняет физическое каскадное перемещение цепочки элементов в строке/столбце при изменении ширины стыка.
   * Поддерживает внутренние стыки, краевые стыки стены (edge-v-left/right, edge-h-bot/top) и жесткие границы проемов.
   * Элементы сдвигаются только внутри непрерывного отрезка между стенами и проемами.
   */
  public static cascadeChainJointWidthChange(
    panels: WallPanelPiece[],
    joints: WallJointLine[],
    _targetJoint: WallJointLine,
    _oldWidth: number,
    _newWidth: number,
    _wallWidth: number,
    _wallHeight: number,
    _openings: Opening[] = [],
    _takeSideOverride?: 'BOTH' | 'LEFT' | 'RIGHT' | 'TOP' | 'BOTTOM'
  ): { panels: WallPanelPiece[]; joints: WallJointLine[] } {
    // Временно отключено автоматическое смещение соседних панелей при смене ширины стыков
    return { panels, joints };
  }

  /**
   * Выполняет физическое каскадное перемещение цепочки при смене активной стрелки направления зазора (takeSide).
   * Промежуточные панели сохраняют свою точную ширину, крайние подгоняются по стенам и проемам.
   */
  public static cascadeChainJointTakeSideChange(
    panels: WallPanelPiece[],
    joints: WallJointLine[],
    targetJoint: WallJointLine,
    jointWidth: number,
    oldTakeSide: 'BOTH' | 'LEFT' | 'RIGHT' | 'TOP' | 'BOTTOM',
    newTakeSide: 'BOTH' | 'LEFT' | 'RIGHT' | 'TOP' | 'BOTTOM',
    wallWidth: number,
    wallHeight: number,
    openings: Opening[] = []
  ): { panels: WallPanelPiece[]; joints: WallJointLine[] } {
    if (oldTakeSide === newTakeSide || jointWidth <= 0) return { panels, joints };

    const p1 = targetJoint.p1 || { x: (targetJoint as any).x || 0, y: (targetJoint as any).y || 0 };
    const p2 = targetJoint.p2 || { x: (targetJoint as any).x || 0, y: (targetJoint as any).y || 0 };
    const isVert =
      targetJoint.orientation === 'VERTICAL'
        ? true
        : targetJoint.orientation === 'HORIZONTAL'
        ? false
        : Math.abs(p1.x - p2.x) < Math.abs(p1.y - p2.y);

    const half = jointWidth / 2;
    const cutoutOpenings = (openings || []).filter((op) => op.isCutout !== false);

    if (isVert) {
      const getSideShift = (side: 'BOTH' | 'LEFT' | 'RIGHT' | 'TOP' | 'BOTTOM') => {
        if (side === 'RIGHT') return half; // сдвиг шва вправо
        if (side === 'LEFT') return -half; // сдвиг шва влево
        return 0;
      };

      const shiftDelta = getSideShift(newTakeSide) - getSideShift(oldTakeSide);
      if (Math.abs(shiftDelta) < 1e-4) return { panels, joints };

      const yMin = Math.min(p1.y, p2.y);
      const yMax = Math.max(p1.y, p2.y);
      const jX = (p1.x + p2.x) / 2;

      const bands: { yMin: number; yMax: number }[] = [];
      panels.forEach((p) => {
        const ys = p.points.map((pt) => pt.y);
        const pMinY = Math.min(...ys);
        const pMaxY = Math.max(...ys);
        if (!bands.some((b) => Math.abs(b.yMin - pMinY) <= 15 && Math.abs(b.yMax - pMaxY) <= 15)) {
          bands.push({ yMin: pMinY, yMax: pMaxY });
        }
      });

      const affectedBands = bands.filter((b) => Math.max(b.yMin, yMin) < Math.min(b.yMax, yMax) - 5);
      const bandsToProcess = affectedBands.length > 0 ? affectedBands : bands;

      let nextPanels = [...panels];
      let nextJoints = [...joints];

      bandsToProcess.forEach((b) => {
        const isPanelInBand = (p: WallPanelPiece) => {
          const ys = p.points.map((pt) => pt.y);
          return Math.max(...ys) > b.yMin + 5 && Math.min(...ys) < b.yMax - 5;
        };

        const openingsInBand = cutoutOpenings.filter(
          (op) => Math.max(op.y, b.yMin) < Math.min(op.y + op.height, b.yMax) - 5
        );

        const rightObstacles = [
          wallWidth,
          ...openingsInBand.filter((op) => op.x > jX + 5).map((op) => op.x),
        ];
        const nextObstacleX = Math.min(...rightObstacles);

        const leftObstacles = [
          0,
          ...openingsInBand.filter((op) => op.x + op.width < jX - 5).map((op) => op.x + op.width),
        ];
        const prevObstacleX = Math.max(...leftObstacles);

        // Сдвигаем сам targetJoint и стыки правее jX
        nextJoints = nextJoints.map((j) => {
          if (j.id === targetJoint.id) {
            return {
              ...j,
              takeSide: newTakeSide,
              p1: { x: Math.max(prevObstacleX, Math.min(nextObstacleX, Math.round((j.p1.x + shiftDelta) * 10) / 10)), y: j.p1.y },
              p2: { x: Math.max(prevObstacleX, Math.min(nextObstacleX, Math.round((j.p2.x + shiftDelta) * 10) / 10)), y: j.p2.y },
            };
          }
          const currX = (j.p1.x + j.p2.x) / 2;
          const jyMin = Math.min(j.p1.y, j.p2.y);
          const jyMax = Math.max(j.p1.y, j.p2.y);
          const jIsVert = j.orientation === 'VERTICAL' || (j.orientation !== 'HORIZONTAL' && Math.abs(j.p1.x - j.p2.x) < Math.abs(j.p1.y - j.p2.y));
          const overlapsJoint = Math.max(jyMin, yMin) < Math.min(jyMax, yMax) - 5;

          if (jIsVert && overlapsJoint && currX > jX + 5 && currX < nextObstacleX - 5) {
            return {
              ...j,
              p1: { x: Math.max(prevObstacleX, Math.min(nextObstacleX, Math.round((j.p1.x + shiftDelta) * 10) / 10)), y: j.p1.y },
              p2: { x: Math.max(prevObstacleX, Math.min(nextObstacleX, Math.round((j.p2.x + shiftDelta) * 10) / 10)), y: j.p2.y },
            };
          }
          return j;
        });

        const rightPanels = nextPanels
          .filter(isPanelInBand)
          .filter((p) => {
            const minX = Math.min(...p.points.map((pt) => pt.x));
            const maxX = Math.max(...p.points.map((pt) => pt.x));
            return minX >= jX - 5 && maxX <= nextObstacleX + 15;
          })
          .sort((a, b) => Math.min(...a.points.map((pt) => pt.x)) - Math.min(...b.points.map((pt) => pt.x)));

        const leftPanels = nextPanels
          .filter(isPanelInBand)
          .filter((p) => {
            const minX = Math.min(...p.points.map((pt) => pt.x));
            const maxX = Math.max(...p.points.map((pt) => pt.x));
            return maxX <= jX + 5 && minX >= prevObstacleX - 15;
          })
          .sort((a, b) => Math.min(...a.points.map((pt) => pt.x)) - Math.min(...b.points.map((pt) => pt.x)));

        const immediateLeftPanel = leftPanels.length > 0 ? leftPanels[leftPanels.length - 1] : null;
        if (immediateLeftPanel) {
          const maxX = Math.max(...immediateLeftPanel.points.map((pt) => pt.x));
          nextPanels = nextPanels.map((p) => {
            if (p.id !== immediateLeftPanel.id) return p;
            return {
              ...p,
              points: p.points.map((pt) => {
                if (pt.x >= maxX - 15) {
                  return { x: Math.max(prevObstacleX, Math.min(nextObstacleX, Math.round((pt.x + shiftDelta) * 10) / 10)), y: pt.y };
                }
                return pt;
              }),
            };
          });
        }

        if (rightPanels.length > 0) {
          const lastPanelId = rightPanels[rightPanels.length - 1].id;
          const rightPanelIds = new Set(rightPanels.map((p) => p.id));

          nextPanels = nextPanels.map((p) => {
            if (!rightPanelIds.has(p.id)) return p;

            if (p.id === lastPanelId) {
              const minX = Math.min(...p.points.map((pt) => pt.x));
              return {
                ...p,
                points: p.points.map((pt) => {
                  if (pt.x <= minX + 15) {
                    return { x: Math.max(prevObstacleX, Math.min(nextObstacleX, Math.round((pt.x + shiftDelta) * 10) / 10)), y: pt.y };
                  }
                  return pt;
                }),
              };
            } else {
              return {
                ...p,
                points: p.points.map((pt) => ({
                  x: Math.max(prevObstacleX, Math.min(nextObstacleX, Math.round((pt.x + shiftDelta) * 10) / 10)),
                  y: pt.y,
                })),
              };
            }
          });
        }
      });

      return this.subtractOpeningsFromWallPanels(nextPanels, nextJoints, openings);
    } else {
      // Горизонтальный стык
      const getSideShift = (side: 'BOTH' | 'LEFT' | 'RIGHT' | 'TOP' | 'BOTTOM') => {
        if (side === 'TOP') return half;    // сдвиг шва вверх
        if (side === 'BOTTOM') return -half; // сдвиг шва вниз
        return 0;
      };

      const shiftDelta = getSideShift(newTakeSide) - getSideShift(oldTakeSide);
      if (Math.abs(shiftDelta) < 1e-4) return { panels, joints };

      const xMin = Math.min(p1.x, p2.x);
      const xMax = Math.max(p1.x, p2.x);
      const jY = (p1.y + p2.y) / 2;

      const cols: { xMin: number; xMax: number }[] = [];
      panels.forEach((p) => {
        const xs = p.points.map((pt) => pt.x);
        const pMinX = Math.min(...xs);
        const pMaxX = Math.max(...xs);
        if (!cols.some((c) => Math.abs(c.xMin - pMinX) <= 15 && Math.abs(c.xMax - pMaxX) <= 15)) {
          cols.push({ xMin: pMinX, xMax: pMaxX });
        }
      });

      const affectedCols = cols.filter((c) => Math.max(c.xMin, xMin) < Math.min(c.xMax, xMax) - 5);
      const colsToProcess = affectedCols.length > 0 ? affectedCols : cols;

      let nextPanels = [...panels];
      let nextJoints = [...joints];

      colsToProcess.forEach((c) => {
        const isPanelInCol = (p: WallPanelPiece) => {
          const xs = p.points.map((pt) => pt.x);
          return Math.max(...xs) > c.xMin + 5 && Math.min(...xs) < c.xMax - 5;
        };

        const openingsInCol = cutoutOpenings.filter(
          (op) => Math.max(op.x, c.xMin) < Math.min(op.x + op.width, c.xMax) - 5
        );

        const topObstacles = [
          wallHeight,
          ...openingsInCol.filter((op) => op.y > jY + 5).map((op) => op.y),
        ];
        const nextObstacleY = Math.min(...topObstacles);

        const bottomObstacles = [
          0,
          ...openingsInCol.filter((op) => op.y + op.height < jY - 5).map((op) => op.y + op.height),
        ];
        const prevObstacleY = Math.max(...bottomObstacles);

        // Сдвигаем сам targetJoint и стыки сверху
        nextJoints = nextJoints.map((j) => {
          if (j.id === targetJoint.id) {
            return {
              ...j,
              takeSide: newTakeSide,
              p1: { x: j.p1.x, y: Math.max(prevObstacleY, Math.min(nextObstacleY, Math.round((j.p1.y + shiftDelta) * 10) / 10)) },
              p2: { x: j.p2.x, y: Math.max(prevObstacleY, Math.min(nextObstacleY, Math.round((j.p2.y + shiftDelta) * 10) / 10)) },
            };
          }
          const currY = (j.p1.y + j.p2.y) / 2;
          const jxMin = Math.min(j.p1.x, j.p2.x);
          const jxMax = Math.max(j.p1.x, j.p2.x);
          const jIsHoriz = j.orientation === 'HORIZONTAL' || (j.orientation !== 'VERTICAL' && Math.abs(j.p1.y - j.p2.y) < Math.abs(j.p1.x - j.p2.x));
          const overlapsJoint = Math.max(jxMin, xMin) < Math.min(jxMax, xMax) - 5;

          if (jIsHoriz && overlapsJoint && currY > jY + 5 && currY < nextObstacleY - 5) {
            return {
              ...j,
              p1: { x: j.p1.x, y: Math.max(prevObstacleY, Math.min(nextObstacleY, Math.round((j.p1.y + shiftDelta) * 10) / 10)) },
              p2: { x: j.p2.x, y: Math.max(prevObstacleY, Math.min(nextObstacleY, Math.round((j.p2.y + shiftDelta) * 10) / 10)) },
            };
          }
          return j;
        });

        const topPanels = nextPanels
          .filter(isPanelInCol)
          .filter((p) => {
            const minY = Math.min(...p.points.map((pt) => pt.y));
            const maxY = Math.max(...p.points.map((pt) => pt.y));
            return minY >= jY - 5 && maxY <= nextObstacleY + 15;
          })
          .sort((a, b) => Math.min(...a.points.map((pt) => pt.y)) - Math.min(...b.points.map((pt) => pt.y)));

        const bottomPanels = nextPanels
          .filter(isPanelInCol)
          .filter((p) => {
            const minY = Math.min(...p.points.map((pt) => pt.y));
            const maxY = Math.max(...p.points.map((pt) => pt.y));
            return maxY <= jY + 5 && minY >= prevObstacleY - 15;
          })
          .sort((a, b) => Math.min(...a.points.map((pt) => pt.y)) - Math.min(...b.points.map((pt) => pt.y)));

        const immediateTopPanel = topPanels.length > 0 ? topPanels[0] : null;
        if (immediateTopPanel) {
          const minY = Math.min(...immediateTopPanel.points.map((pt) => pt.y));
          nextPanels = nextPanels.map((p) => {
            if (p.id !== immediateTopPanel.id) return p;
            return {
              ...p,
              points: p.points.map((pt) => {
                if (pt.y <= minY + 15) {
                  return { x: pt.x, y: Math.max(prevObstacleY, Math.min(nextObstacleY, Math.round((pt.y + shiftDelta) * 10) / 10)) };
                }
                return pt;
              }),
            };
          });
        }

        if (bottomPanels.length > 0) {
          const firstPanelId = bottomPanels[0].id;
          const bottomPanelIds = new Set(bottomPanels.map((p) => p.id));

          nextPanels = nextPanels.map((p) => {
            if (!bottomPanelIds.has(p.id)) return p;

            if (p.id === firstPanelId) {
              const maxY = Math.max(...p.points.map((pt) => pt.y));
              return {
                ...p,
                points: p.points.map((pt) => {
                  if (pt.y >= maxY - 15) {
                    return { x: pt.x, y: Math.max(prevObstacleY, Math.min(nextObstacleY, Math.round((pt.y + shiftDelta) * 10) / 10)) };
                  }
                  return pt;
                }),
              };
            } else {
              return {
                ...p,
                points: p.points.map((pt) => ({
                  x: pt.x,
                  y: Math.max(prevObstacleY, Math.min(nextObstacleY, Math.round((pt.y + shiftDelta) * 10) / 10)),
                })),
              };
            }
          });
        }
      });

      return this.subtractOpeningsFromWallPanels(nextPanels, nextJoints, openings);
    }
  }

  /**
   * Физически вычитает сквозные проемы (двери, окна, ниши) из плоского массива WallPanelPiece и WallJointLine.
   * Гарантирует, что ни одна панель и ни один внутренний шов не перекрывают дверной/оконный проем.
   */
  public static subtractOpeningsFromWallPanels(
    panels: WallPanelPiece[],
    joints: WallJointLine[],
    openings: Opening[] = []
  ): { panels: WallPanelPiece[]; joints: WallJointLine[] } {
    const cutoutOpenings = (openings || []).filter((op) => op.isCutout !== false);
    if (cutoutOpenings.length === 0 || !panels || panels.length === 0) {
      return { panels: panels || [], joints: joints || [] };
    }

    const nextPanels: WallPanelPiece[] = [];
    const openingFramingJoints: WallJointLine[] = [];

    panels.forEach((p) => {
      let currentPolys: Point2D[][] = [p.points];

      cutoutOpenings.forEach((op) => {
        const dL = op.framing?.left?.width ?? 0;
        const dR = op.framing?.right?.width ?? 0;
        const dT = op.framing?.top?.width ?? 0;
        const dB = op.framing?.bottom?.width ?? 0;

        const rectWithFraming = {
          x: op.x - dL,
          y: op.y - dB,
          width: op.width + dL + dR,
          height: op.height + dB + dT,
        };

        const nextPolys: Point2D[][] = [];
        currentPolys.forEach((poly) => {
          const polyXs = poly.map((pt) => pt.x);
          const polyYs = poly.map((pt) => pt.y);
          const minX = Math.min(...polyXs);
          const maxX = Math.max(...polyXs);
          const minY = Math.min(...polyYs);
          const maxY = Math.max(...polyYs);

          if (
            maxX <= rectWithFraming.x + 0.1 ||
            minX >= rectWithFraming.x + rectWithFraming.width - 0.1 ||
            maxY <= rectWithFraming.y + 0.1 ||
            minY >= rectWithFraming.y + rectWithFraming.height - 0.1
          ) {
            nextPolys.push(poly);
            return;
          }

          const remaining = this.subtractRectangleFromPolygon(poly, rectWithFraming);
          nextPolys.push(...remaining);
        });
        currentPolys = nextPolys;
      });

      if (currentPolys.length === 1) {
        nextPanels.push({ ...p, points: currentPolys[0] });
      } else if (currentPolys.length > 1) {
        currentPolys.forEach((poly, idx) => {
          nextPanels.push({
            ...p,
            id: `${p.id}-cut-${idx + 1}-${Math.random().toString(36).substring(2, 5)}`,
            points: poly,
            partLabel:
              p.isVoid || p.materialId === MATERIAL_NONE_ID
                ? 'ПУСТО'
                : `${p.partLabel}.${idx + 1}`,
          });
        });
      }
    });

    // Формируем швы обрамления проемов при наличии зазоров или подсветки
    cutoutOpenings.forEach((op) => {
      const dL = op.framing?.left?.width ?? 0;
      const dR = op.framing?.right?.width ?? 0;
      const dT = op.framing?.top?.width ?? 0;
      const dB = op.framing?.bottom?.width ?? 0;

      if (dL > 0 || op.framing?.left?.isLED || op.framing?.left?.profileArticle) {
        openingFramingJoints.push({
          id: `joint-op-${op.id}-left`,
          p1: { x: op.x - dL / 2, y: op.y },
          p2: { x: op.x - dL / 2, y: op.y + op.height },
          width: dL > 0 ? dL : 8,
          orientation: 'VERTICAL',
          isLED: !!op.framing?.left?.isLED,
          profileArticle: op.framing?.left?.profileArticle,
          profileColor: op.framing?.left?.profileColor,
        });
      }

      if (dT > 0 || op.framing?.top?.isLED || op.framing?.top?.profileArticle) {
        openingFramingJoints.push({
          id: `joint-op-${op.id}-top`,
          p1: { x: op.x - dL, y: op.y + op.height + dT / 2 },
          p2: { x: op.x + op.width + dR, y: op.y + op.height + dT / 2 },
          width: dT > 0 ? dT : 8,
          orientation: 'HORIZONTAL',
          isLED: !!op.framing?.top?.isLED,
          profileArticle: op.framing?.top?.profileArticle,
          profileColor: op.framing?.top?.profileColor,
        });
      }

      if (dR > 0 || op.framing?.right?.isLED || op.framing?.right?.profileArticle) {
        openingFramingJoints.push({
          id: `joint-op-${op.id}-right`,
          p1: { x: op.x + op.width + dR / 2, y: op.y },
          p2: { x: op.x + op.width + dR / 2, y: op.y + op.height },
          width: dR > 0 ? dR : 8,
          orientation: 'VERTICAL',
          isLED: !!op.framing?.right?.isLED,
          profileArticle: op.framing?.right?.profileArticle,
          profileColor: op.framing?.right?.profileColor,
        });
      }

      if (op.type !== 'DOOR' && (dB > 0 || op.framing?.bottom?.isLED || op.framing?.bottom?.profileArticle)) {
        openingFramingJoints.push({
          id: `joint-op-${op.id}-bottom`,
          p1: { x: op.x - dL, y: op.y - dB / 2 },
          p2: { x: op.x + op.width + dR, y: op.y - dB / 2 },
          width: dB > 0 ? dB : 8,
          orientation: 'HORIZONTAL',
          isLED: !!op.framing?.bottom?.isLED,
          profileArticle: op.framing?.bottom?.profileArticle,
          profileColor: op.framing?.bottom?.profileColor,
        });
      }
    });

    const isInsideOpening = (pt: Point2D) =>
      cutoutOpenings.some(
        (op) =>
          pt.x >= op.x - 1 &&
          pt.x <= op.x + op.width + 1 &&
          pt.y >= op.y - 1 &&
          pt.y <= op.y + op.height + 1
      );

    const filteredBaseJoints = (joints || []).filter((j) => {
      if (j.id.startsWith('joint-op-')) return false;
      const p1 = j.p1 || { x: (j as any).x || 0, y: (j as any).y || 0 };
      const p2 = j.p2 || { x: (j as any).x || 0, y: (j as any).y || 0 };
      const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      return !isInsideOpening(mid);
    });

    return { panels: nextPanels, joints: [...filteredBaseJoints, ...openingFramingJoints] };
  }

  /**
   * Разрезает панель вокруг проема на фрамугу и боковины (только по явной команде пользователя).
   */
  public static splitPanelAroundOpening(
    panel: WallPanelPiece,
    opening: Opening
  ): WallPanelPiece[] {
    const opLeft = opening.x;
    const opRight = opening.x + opening.width;
    const opTop = opening.y + opening.height;
    const opBottom = opening.y;

    const xs = panel.points.map((p) => p.x);
    const ys = panel.points.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    if (maxX <= opLeft + 0.1 || minX >= opRight - 0.1 || maxY <= opBottom + 0.1 || minY >= opTop - 0.1) {
      return [panel];
    }

    const pieces: WallPanelPiece[] = [];
    let idx = 1;

    if (opLeft > minX + 0.5) {
      pieces.push({
        ...panel,
        id: `${panel.id}-split-left-${Date.now()}`,
        points: [
          { x: minX, y: minY },
          { x: minX, y: maxY },
          { x: opLeft, y: maxY },
          { x: opLeft, y: minY },
        ],
        partLabel: `${panel.partLabel}.${idx++}`,
      });
    }

    if (opTop < maxY - 0.5) {
      pieces.push({
        ...panel,
        id: `${panel.id}-split-top-${Date.now()}`,
        points: [
          { x: Math.max(minX, opLeft), y: opTop },
          { x: Math.max(minX, opLeft), y: maxY },
          { x: Math.min(maxX, opRight), y: maxY },
          { x: Math.min(maxX, opRight), y: opTop },
        ],
        partLabel: `${panel.partLabel}.${idx++}`,
      });
    }

    if (opBottom > minY + 0.5 && opening.type !== 'DOOR') {
      pieces.push({
        ...panel,
        id: `${panel.id}-split-bottom-${Date.now()}`,
        points: [
          { x: Math.max(minX, opLeft), y: minY },
          { x: Math.max(minX, opLeft), y: opBottom },
          { x: Math.min(maxX, opRight), y: opBottom },
          { x: Math.min(maxX, opRight), y: minY },
        ],
        partLabel: `${panel.partLabel}.${idx++}`,
      });
    }

    if (opRight < maxX - 0.5) {
      pieces.push({
        ...panel,
        id: `${panel.id}-split-right-${Date.now()}`,
        points: [
          { x: opRight, y: minY },
          { x: opRight, y: maxY },
          { x: maxX, y: maxY },
          { x: maxX, y: minY },
        ],
        partLabel: `${panel.partLabel}.${idx++}`,
      });
    }

    return pieces.length > 0 ? pieces : [panel];
  }

  /**
   * Корректирует геометрию полигонов панелей при изменении толщины шва между ними (обертка для совместимости).
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
    const res = this.cascadeChainJointWidthChange(
      panels,
      [],
      joint,
      oldWidth,
      newWidth,
      wallWidth,
      wallHeight,
      openings,
      takeSideOverride
    );
    return res.panels;
  }

  /**
   * Корректирует геометрию полигонов панелей при переключении направления забора зазора (обертка для совместимости).
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
    const res = this.cascadeChainJointTakeSideChange(
      panels,
      [],
      joint,
      jointWidth,
      oldTakeSide,
      newTakeSide,
      wallWidth,
      wallHeight
    );
    return res.panels;
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
    let curStart = minX;
    while (curStart + stripWidth < maxX - 5) {
      const cutLeft = curStart + stripWidth;
      const seamCenterX = cutLeft + effSeamGap / 2;

      const cutP1 = { x: seamCenterX, y: minY - 10 };
      const cutP2 = { x: seamCenterX, y: maxY + 10 };
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
            takeSide: 'RIGHT',
          });
        });
      } else {
        joints.push({
          id: `joint-${Date.now()}-${joints.length + 1}`,
          p1: { x: seamCenterX, y: minY },
          p2: { x: seamCenterX, y: maxY },
          width: effSeamGap,
          isLED: false,
          orientation: 'VERTICAL',
          takeSide: 'RIGHT',
        });
      }
      curStart += stripWidth + effSeamGap;
    }

    return { newPanels, joints };
  }

  /**
   * Проверяет все детали стены на превышение максимальных габаритов листа материала.
   * Если панель превышает ширину листа (например, при уменьшении стыка или заполнении пространства),
   * она автоматически нарезается на допустимые листы: [макс. ширина] + [стык 8мм] + ...
   */
  public static ensureValidPanelDimensions(
    wall: Wall,
    materials: Material[],
    defaultSeamGap: number = 8
  ): { panels: WallPanelPiece[]; joints: WallJointLine[] } {
    if (!wall.panels || wall.panels.length === 0) {
      return { panels: wall.panels || [], joints: wall.joints || [] };
    }

    const nextPanels: WallPanelPiece[] = [];
    const nextJoints: WallJointLine[] = wall.joints ? [...wall.joints] : [];

    wall.panels.forEach((p) => {
      const mat = materials.find((m) => m.id === p.materialId);
      const isVoid = p.isVoid || mat?.isVoid || p.materialId === MATERIAL_NONE_ID;
      const maxW = mat?.width && mat.width > 0 ? mat.width : 1220;

      const xs = p.points.map((pt) => pt.x);
      const pieceW = Math.max(...xs) - Math.min(...xs);

      if (!isVoid && maxW > 0 && pieceW > maxW + 2) {
        const isSlat =
          p.reliefType !== 'FLAT' ||
          p.materialId?.includes('slat') ||
          p.decorName?.toLowerCase().includes('рейка');
        const seam = isSlat ? 0 : defaultSeamGap;

        const sliced = this.sliceWallPanelIntoStrips(p, maxW, seam);
        nextPanels.push(...sliced.newPanels);
        nextJoints.push(...sliced.joints);
      } else {
        nextPanels.push(p);
      }
    });

    return { panels: nextPanels, joints: nextJoints };
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

    // 3. Быстрый и точный расчет для прямоугольных панелей (без нарезки на куски!)
    const isAxisAlignedRect =
      polygon.length === 4 &&
      xs.every((x) => Math.abs(x - minX) < 1.5 || Math.abs(x - maxX) < 1.5) &&
      ys.every((y) => Math.abs(y - minY) < 1.5 || Math.abs(y - maxY) < 1.5);

    if (isAxisAlignedRect) {
      const cL = Math.max(minX, opLeft);
      const cR = Math.min(maxX, opRight);
      const cB = Math.max(minY, opBottom);
      const cT = Math.min(maxY, opTop);

      const touchesLeft = cL <= minX + 0.5;
      const touchesRight = cR >= maxX - 0.5;
      const touchesBottom = cB <= minY + 0.5;
      const touchesTop = cT >= maxY - 0.5;

      // 3.1. Сквозной вырез по вертикали (рассекает панель на левую и правую части)
      if (touchesBottom && touchesTop) {
        const pieces: Point2D[][] = [];
        if (!touchesLeft && cL > minX + 0.5) {
          pieces.push([
            { x: minX, y: minY },
            { x: minX, y: maxY },
            { x: cL, y: maxY },
            { x: cL, y: minY },
          ]);
        }
        if (!touchesRight && cR < maxX - 0.5) {
          pieces.push([
            { x: cR, y: minY },
            { x: cR, y: maxY },
            { x: maxX, y: maxY },
            { x: maxX, y: minY },
          ]);
        }
        return pieces;
      }

      // 3.2. Сквозной вырез по горизонтали (рассекает панель на нижнюю и верхнюю части)
      if (touchesLeft && touchesRight) {
        const pieces: Point2D[][] = [];
        if (!touchesBottom && cB > minY + 0.5) {
          pieces.push([
            { x: minX, y: minY },
            { x: minX, y: cB },
            { x: maxX, y: cB },
            { x: maxX, y: minY },
          ]);
        }
        if (!touchesTop && cT < maxY - 0.5) {
          pieces.push([
            { x: minX, y: cT },
            { x: minX, y: maxY },
            { x: maxX, y: maxY },
            { x: maxX, y: cT },
          ]);
        }
        return pieces;
      }

      // 3.3. Дверной проем снизу (касается только низа) -> ЕДИНАЯ П-ОБРАЗНАЯ ПАНЕЛЬ!
      if (touchesBottom && !touchesTop) {
        if (!touchesLeft && !touchesRight) {
          return [[
            { x: minX, y: minY },
            { x: minX, y: maxY },
            { x: maxX, y: maxY },
            { x: maxX, y: minY },
            { x: cR, y: minY },
            { x: cR, y: cT },
            { x: cL, y: cT },
            { x: cL, y: minY },
          ]];
        } else if (touchesLeft && !touchesRight) {
          return [[
            { x: minX, y: cT },
            { x: minX, y: maxY },
            { x: maxX, y: maxY },
            { x: maxX, y: minY },
            { x: cR, y: minY },
            { x: cR, y: cT },
          ]];
        } else if (!touchesLeft && touchesRight) {
          return [[
            { x: minX, y: minY },
            { x: minX, y: maxY },
            { x: maxX, y: maxY },
            { x: maxX, y: cT },
            { x: cL, y: cT },
            { x: cL, y: minY },
          ]];
        }
      }

      // 3.4. Вырез сверху (касается только верха) -> ЕДИНАЯ U-ОБРАЗНАЯ ПАНЕЛЬ!
      if (touchesTop && !touchesBottom) {
        if (!touchesLeft && !touchesRight) {
          return [[
            { x: minX, y: minY },
            { x: minX, y: maxY },
            { x: cL, y: maxY },
            { x: cL, y: cB },
            { x: cR, y: cB },
            { x: cR, y: maxY },
            { x: maxX, y: maxY },
            { x: maxX, y: minY },
          ]];
        } else if (touchesLeft && !touchesRight) {
          return [[
            { x: minX, y: minY },
            { x: minX, y: cB },
            { x: cR, y: cB },
            { x: cR, y: maxY },
            { x: maxX, y: maxY },
            { x: maxX, y: minY },
          ]];
        } else if (!touchesLeft && touchesRight) {
          return [[
            { x: minX, y: minY },
            { x: minX, y: maxY },
            { x: cL, y: maxY },
            { x: cL, y: cB },
            { x: maxX, y: cB },
            { x: maxX, y: minY },
          ]];
        }
      }

      // 3.5. Вырез слева (боковой вырез) -> ЕДИНАЯ С-ОБРАЗНАЯ ПАНЕЛЬ!
      if (touchesLeft && !touchesRight && !touchesTop && !touchesBottom) {
        return [[
          { x: minX, y: minY },
          { x: minX, y: cB },
          { x: cR, y: cB },
          { x: cR, y: cT },
          { x: minX, y: cT },
          { x: minX, y: maxY },
          { x: maxX, y: maxY },
          { x: maxX, y: minY },
        ]];
      }

      // 3.6. Вырез справа (боковой вырез) -> ЕДИНАЯ С-ОБРАЗНАЯ ПАНЕЛЬ!
      if (touchesRight && !touchesLeft && !touchesTop && !touchesBottom) {
        return [[
          { x: minX, y: minY },
          { x: minX, y: maxY },
          { x: maxX, y: maxY },
          { x: maxX, y: cT },
          { x: cL, y: cT },
          { x: cL, y: cB },
          { x: maxX, y: cB },
          { x: maxX, y: minY },
        ]];
      }

      // 3.7. Вырез строго внутри (Окно / Ниша) -> цельная панель со щелевым мостиком 0-толщины
      if (!touchesLeft && !touchesRight && !touchesTop && !touchesBottom) {
        return [[
          { x: minX, y: minY },
          { x: minX, y: cB },
          { x: cL, y: cB },
          { x: cR, y: cB },
          { x: cR, y: cT },
          { x: cL, y: cT },
          { x: cL, y: cB },
          { x: minX, y: cB },
          { x: minX, y: maxY },
          { x: maxX, y: maxY },
          { x: maxX, y: minY },
        ]];
      }
    }

    // 4. Для произвольных непрямоугольных полигонов — отсечение по линиям
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

    let centerTopPieces: Point2D[][] = [];
    let centerBottomPieces: Point2D[][] = [];

    for (const poly of centerColPieces) {
      let currentSub = [poly];

      const polyYs = poly.map((p) => p.y);
      const polyMinY = Math.min(...polyYs);
      const polyMaxY = Math.max(...polyYs);

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

    const allKept = [...leftPieces, ...centerTopPieces, ...centerBottomPieces, ...rightPieces].filter(
      (p) => this.calculatePolygonArea(p) >= 10
    );

    if (allKept.length <= 1) {
      return allKept;
    }

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
      // 1. Проверяем пересечение с проемом по bounding box
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

      // 2. Вырезаем проем только из той панели, куда он вставляется
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
          partLabel:
            panel.isVoid || panel.materialId === MATERIAL_NONE_ID
              ? 'ПУСТО'
              : (remainingPolys.length > 1 ? `${panel.partLabel}.${kIdx + 1}` : panel.partLabel),
        });
      });
    }

    return { newPanels: resultPanels, joints: [] };
  }

      /**
   * Применяет торцевые зазоры (Edge Insets / Откосы) к полигону детали.
   * Работает для ВСЕХ типов полигонов (прямоугольники, трапеции, сложные срезы, П- и Г-образные детали вокруг проемов).
   * Сдвигает только внешние грани полигона, сохраняя внутренние вырезы и сложную форму деталей.
   */
  public static applyPanelEdgesInsets(
    polygon: Point2D[],
    edges?: PanelEdgesConfig
  ): Point2D[] {
    if (!polygon || polygon.length < 3 || !edges) {
      return polygon;
    }

    const dLeft = Math.max(0, edges.left?.width ?? 0);
    const dRight = Math.max(0, edges.right?.width ?? 0);
    const dTop = Math.max(0, edges.top?.width ?? 0);
    const dBottom = Math.max(0, edges.bottom?.width ?? 0);

    if (dLeft <= 0 && dRight <= 0 && dTop <= 0 && dBottom <= 0) {
      return polygon;
    }

    const xs = polygon.map((p) => p.x);
    const ys = polygon.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    const targetMinX = minX + dLeft;
    const targetMaxX = Math.max(targetMinX, maxX - dRight);
    const targetMinY = minY + dBottom;
    const targetMaxY = Math.max(targetMinY, maxY - dTop);

    // 1. Быстрый путь для стандартных прямоугольников
    const isAxisAlignedRect =
      polygon.length === 4 &&
      xs.every((x) => Math.abs(x - minX) < 1.5 || Math.abs(x - maxX) < 1.5) &&
      ys.every((y) => Math.abs(y - minY) < 1.5 || Math.abs(y - maxY) < 1.5);

    if (isAxisAlignedRect) {
      return [
        { x: Math.round(targetMinX * 10) / 10, y: Math.round(targetMinY * 10) / 10 },
        { x: Math.round(targetMaxX * 10) / 10, y: Math.round(targetMinY * 10) / 10 },
        { x: Math.round(targetMaxX * 10) / 10, y: Math.round(targetMinY * 10) / 10 },
        { x: Math.round(targetMinX * 10) / 10, y: Math.round(targetMinY * 10) / 10 },
      ];
    }

    // 2. Универсальный сдвиг внешних границ для любых сложных полигонов (включая П- и Г-образные)
    return polygon.map((pt) => {
      let newX = pt.x;
      let newY = pt.y;

      if (dLeft > 0 && Math.abs(pt.x - minX) < 1.5) {
        newX = targetMinX;
      } else if (dRight > 0 && Math.abs(pt.x - maxX) < 1.5) {
        newX = targetMaxX;
      } else if (dLeft > 0 && newX < targetMinX && Math.abs(pt.x - minX) < (maxX - minX) * 0.4) {
        newX = targetMinX;
      } else if (dRight > 0 && newX > targetMaxX && Math.abs(pt.x - maxX) < (maxX - minX) * 0.4) {
        newX = targetMaxX;
      }

      if (dBottom > 0 && Math.abs(pt.y - minY) < 1.5) {
        newY = targetMinY;
      } else if (dTop > 0 && Math.abs(pt.y - maxY) < 1.5) {
        newY = targetMaxY;
      } else if (dBottom > 0 && newY < targetMinY && Math.abs(pt.y - minY) < (maxY - minY) * 0.4) {
        newY = targetMinY;
      } else if (dTop > 0 && newY > targetMaxY && Math.abs(pt.y - maxY) < (maxY - minY) * 0.4) {
        newY = targetMaxY;
      }

      return {
        x: Math.round(newX * 10) / 10,
        y: Math.round(newY * 10) / 10,
      };
    });
  }

}

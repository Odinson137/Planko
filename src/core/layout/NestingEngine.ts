import { Point2D } from '../geometry/PolygonSlicingEngine';
import { PanelBendInfo } from '../models/Wall';

export interface NestingCutout {
  x: number;          // смещение выреза от левого края детали в мм
  y: number;          // смещение выреза от нижнего края детали в мм
  width: number;      // ширина выреза в мм
  height: number;     // высота выреза в мм
  type?: string;      // 'DOOR' | 'WINDOW' | 'NICHE'
  label?: string;
}

export interface NestingPartInput {
  id: string;
  wallId: string;
  wallName: string;
  partLabel: string;
  width: number;
  height: number;
  areaSqM?: number;
  materialId: string;
  materialName?: string;
  decorCode?: string;
  color?: string;
  thickness?: number;
  polygonPoints?: Point2D[];
  cutouts?: NestingCutout[];
  bendsInfo?: PanelBendInfo[];
  note?: string;
}

export interface PlacedNestingPart {
  part: NestingPartInput;
  x: number;          // mm от левого края листа
  y: number;          // mm от нижнего края листа
  width: number;      // фактическая ширина на листе
  height: number;     // фактическая высота на листе
  rotated: boolean;
}

export interface NestingCutLine {
  p1: Point2D;
  p2: Point2D;
  length: number;
  orientation: 'VERTICAL' | 'HORIZONTAL' | 'DIAGONAL';
  label?: string;
}

export interface NestingOffcut {
  x: number;
  y: number;
  width: number;
  height: number;
  areaSqM: number;
}

export interface NestingSheet {
  sheetIndex: number;
  sheetLabel: string;          // 'Лист 1', 'Лист 2'
  materialId: string;
  materialName: string;
  decorCode?: string;
  color?: string;
  thickness?: number;
  sheetWidth: number;          // 1220 мм
  sheetHeight: number;         // 2800 мм
  placedParts: PlacedNestingPart[];
  cutLines: NestingCutLine[];
  offcuts: NestingOffcut[];
  usedAreaSqM: number;
  totalAreaSqM: number;
  efficiencyPct: number;
}

export interface MaterialNestingResult {
  materialId: string;
  materialName: string;
  totalSheets: number;
  totalParts: number;
  totalPartsAreaSqM: number;
  totalSheetsAreaSqM: number;
  overallEfficiencyPct: number;
  sheets: NestingSheet[];
}

export interface ProjectNestingResult {
  totalSheetsCount: number;
  totalPartsCount: number;
  materialResults: MaterialNestingResult[];
  allSheets: NestingSheet[];
}

interface FreeRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export class NestingEngine {
  public static readonly DEFAULT_SHEET_WIDTH = 1220;
  public static readonly DEFAULT_SHEET_HEIGHT = 2800;
  public static readonly SAW_KERF = 4; // Пропил пилы в мм

  /**
   * Вычисляет реальную полезную нетто-площадь детали (с вычетом проемов / по полигону)
   */
  public static getPartNetAreaSqM(part: NestingPartInput): number {
    if (part.areaSqM !== undefined && part.areaSqM > 0) {
      return part.areaSqM;
    }
    const rawArea = (part.width * part.height) / 1_000_000;
    if (part.cutouts && part.cutouts.length > 0) {
      const cutoutsArea = part.cutouts.reduce(
        (acc, c) => acc + (c.width * c.height) / 1_000_000,
        0
      );
      return Math.max(0.01, Math.round((rawArea - cutoutsArea) * 1000) / 1000);
    }
    return Math.round(rawArea * 1000) / 1000;
  }

  /**
   * Выполняет 2D-раскрой всех переданных деталей по листам с приоритетом порядка стен
   */
  public static optimizeProjectNesting(
    parts: NestingPartInput[],
    sheetW: number = NestingEngine.DEFAULT_SHEET_WIDTH,
    sheetH: number = NestingEngine.DEFAULT_SHEET_HEIGHT
  ): ProjectNestingResult {
    // 1. Фильтруем пустые элементы и нулевые размеры
    const validParts = parts.filter(
      (p) => p.width > 5 && p.height > 5 && p.materialId !== 'mat-none' && !p.partLabel.includes('ПУСТО')
    );

    // 2. Группировка по физическому материалу (декор / артикул / толщина)
    // Детали с одинаковым декором / названием / толщиной должны раскраиваться на одних и тех же листах
    const getMaterialGroupKey = (p: NestingPartInput): string => {
      if (p.decorCode && p.decorCode.trim()) {
        return `DECOR_${p.decorCode.trim()}_${p.thickness || 5}`;
      }
      if (p.materialName && p.materialName.trim() && p.materialName !== 'Панель AllWall') {
        return `NAME_${p.materialName.trim()}_${p.thickness || 5}`;
      }
      if (p.color && p.color.trim()) {
        return `COLOR_${p.color.trim()}_${p.thickness || 5}`;
      }
      if (p.materialId && p.materialId !== 'mat-none') {
        return `MAT_${p.materialId}_${p.thickness || 5}`;
      }
      return `DEFAULT_SHEET_${p.thickness || 5}`;
    };

    const groupsByMaterial = new Map<string, NestingPartInput[]>();
    validParts.forEach((p) => {
      const key = getMaterialGroupKey(p);
      const list = groupsByMaterial.get(key) || [];
      list.push(p);
      groupsByMaterial.set(key, list);
    });

    const materialResults: MaterialNestingResult[] = [];
    const rawSheets: NestingSheet[] = [];

    groupsByMaterial.forEach((matParts) => {
      const firstPart = matParts[0];
      const matId = firstPart?.materialId || 'mat-sheet-1220';
      const matName = firstPart?.materialName || (firstPart?.decorCode ? `AllWall декор ${firstPart.decorCode}` : 'Панель AllWall');
      const matResult = this.packMaterialParts(matParts, matId, matName, sheetW, sheetH);

      materialResults.push(matResult);
      rawSheets.push(...matResult.sheets);
    });

    // Сортируем все сформированные листы по порядку стен, на которых они впервые нужны
    rawSheets.sort((sA, sB) => {
      const getMinWall = (s: NestingSheet) => {
        const wallNums = s.placedParts.map((p) => parseInt(p.part.partLabel?.split('.')[0] || '1', 10));
        return Math.min(...wallNums, 1);
      };
      return getMinWall(sA) - getMinWall(sB);
    });

    // Перенумеровываем все листы строго последовательно 1, 2, 3, 4, 5...
    const allSheets: NestingSheet[] = rawSheets.map((sheet, sIdx) => {
      const sheetIndex = sIdx + 1;
      return {
        ...sheet,
        sheetIndex,
        sheetLabel: `Лист ${sheetIndex}`,
      };
    });

    const totalSheetsCount = allSheets.length;
    const totalPartsCount = validParts.length;

    return {
      totalSheetsCount,
      totalPartsCount,
      materialResults,
      allSheets,
    };
  }

  /**
   * Упаковка деталей одного материала методом многокритериального MaxRects Best-Fit 2D Bin Packing
   * Прогоняет несколько стратегий сортировки и правил размещения (BSSF, BAF, BLSF, Bottom-Left)
   * с полной поддержкой вращения 90° и выбирает вариант с минимальным количеством листов и максимальной эффективностью.
   */
  private static packMaterialParts(
    parts: NestingPartInput[],
    materialId: string,
    materialName: string,
    sheetW: number,
    sheetH: number
  ): MaterialNestingResult {
    if (parts.length === 0) {
      return {
        materialId,
        materialName,
        totalSheets: 0,
        totalParts: 0,
        totalPartsAreaSqM: 0,
        totalSheetsAreaSqM: 0,
        overallEfficiencyPct: 100,
        sheets: [],
      };
    }

    type SortStrategy = {
      name: string;
      fn: (a: NestingPartInput, b: NestingPartInput) => number;
    };

    const strategies: SortStrategy[] = [
      // 1. По максимальному габариту (длинные детали и панели в первую очередь)
      {
        name: 'MAX_SIDE_DESC',
        fn: (a, b) => {
          const maxA = Math.max(a.width, a.height);
          const maxB = Math.max(b.width, b.height);
          if (Math.abs(maxB - maxA) > 1) return maxB - maxA;
          return b.width * b.height - a.width * a.height;
        },
      },
      // 2. По площади детали
      {
        name: 'AREA_DESC',
        fn: (a, b) => {
          const areaA = a.width * a.height;
          const areaB = b.width * b.height;
          if (Math.abs(areaB - areaA) > 100) return areaB - areaA;
          return Math.max(b.width, b.height) - Math.max(a.width, a.height);
        },
      },
      // 3. По периметру детали
      {
        name: 'PERIMETER_DESC',
        fn: (a, b) => {
          const pA = a.width + a.height;
          const pB = b.width + b.height;
          if (Math.abs(pB - pA) > 1) return pB - pA;
          return b.width * b.height - a.width * a.height;
        },
      },
      // 4. По минимальной стороне (толщине/ширине)
      {
        name: 'MIN_SIDE_DESC',
        fn: (a, b) => {
          const minA = Math.min(a.width, a.height);
          const minB = Math.min(b.width, b.height);
          if (Math.abs(minB - minA) > 1) return minB - minA;
          return b.width * b.height - a.width * a.height;
        },
      },
      // 5. По стенам и габариту
      {
        name: 'WALL_THEN_SIZE',
        fn: (a, b) => {
          const wallA = parseInt(a.partLabel?.split('.')[0] || '1', 10);
          const wallB = parseInt(b.partLabel?.split('.')[0] || '1', 10);
          if (wallA !== wallB) return wallA - wallB;
          return Math.max(b.width, b.height) - Math.max(a.width, a.height);
        },
      },
    ];

    const fitModes: ('BSSF' | 'BAF' | 'BLSF' | 'BOTTOM_LEFT')[] = ['BSSF', 'BAF', 'BLSF', 'BOTTOM_LEFT'];

    let bestResult: MaterialNestingResult | null = null;
    let bestScore = Number.MAX_VALUE;

    for (const strat of strategies) {
      for (const fitMode of fitModes) {
        const sorted = [...parts].sort(strat.fn);
        const res = NestingEngine.runSinglePackingPass(
          sorted,
          fitMode,
          materialId,
          materialName,
          sheetW,
          sheetH
        );

        // Оценка качества раскроя:
        // 1. Чем меньше листов — тем лучше (главный фактор: weight 1 000 000)
        // 2. Чем выше процент использования плит — тем лучше (weight 1 000)
        // 3. Чем лучше заполнен последний лист — тем лучше (weight 10)
        const lastSheetEff = res.sheets.length > 0 ? res.sheets[res.sheets.length - 1].efficiencyPct : 100;
        const score = res.sheets.length * 1_000_000 - res.overallEfficiencyPct * 1_000 - lastSheetEff * 10;

        if (score < bestScore) {
          bestScore = score;
          bestResult = res;
        }
      }
    }

    return bestResult!;
  }

  private static runSinglePackingPass(
    sortedParts: NestingPartInput[],
    fitMode: 'BSSF' | 'BAF' | 'BLSF' | 'BOTTOM_LEFT',
    materialId: string,
    materialName: string,
    sheetW: number,
    sheetH: number
  ): MaterialNestingResult {
    const sheets: NestingSheet[] = [];
    const unplaced = [...sortedParts];

    while (unplaced.length > 0) {
      let freeRects: FreeRect[] = [{ x: 0, y: 0, w: sheetW, h: sheetH }];
      const placedOnSheet: PlacedNestingPart[] = [];

      let itemIdx = 0;
      while (itemIdx < unplaced.length) {
        const item = unplaced[itemIdx];
        const itemW = Math.round(item.width);
        const itemH = Math.round(item.height);

        let bestRectIdx = -1;
        let bestFitScore = Number.MAX_VALUE;
        let bestRotated = false;

        for (let r = 0; r < freeRects.length; r++) {
          const rect = freeRects[r];

          // 1. Проверяем без вращения
          if (itemW <= rect.w && itemH <= rect.h) {
            const leftoverW = rect.w - itemW;
            const leftoverH = rect.h - itemH;
            let score = 0;
            if (fitMode === 'BSSF') {
              score = Math.min(leftoverW, leftoverH) * 1000 + Math.max(leftoverW, leftoverH);
            } else if (fitMode === 'BLSF') {
              score = Math.max(leftoverW, leftoverH) * 1000 + Math.min(leftoverW, leftoverH);
            } else if (fitMode === 'BAF') {
              score = rect.w * rect.h - itemW * itemH;
            } else {
              score = rect.y * 10000 + rect.x;
            }

            if (score < bestFitScore) {
              bestFitScore = score;
              bestRectIdx = r;
              bestRotated = false;
            }
          }

          // 2. Проверяем с поворотом на 90 градусов
          if (itemH <= rect.w && itemW <= rect.h) {
            const leftoverW = rect.w - itemH;
            const leftoverH = rect.h - itemW;
            let score = 0;
            if (fitMode === 'BSSF') {
              score = Math.min(leftoverW, leftoverH) * 1000 + Math.max(leftoverW, leftoverH);
            } else if (fitMode === 'BLSF') {
              score = Math.max(leftoverW, leftoverH) * 1000 + Math.min(leftoverW, leftoverH);
            } else if (fitMode === 'BAF') {
              score = rect.w * rect.h - itemH * itemW;
            } else {
              score = rect.y * 10000 + rect.x;
            }

            if (score < bestFitScore) {
              bestFitScore = score;
              bestRectIdx = r;
              bestRotated = true;
            }
          }
        }

        if (bestRectIdx !== -1) {
          const targetRect = freeRects[bestRectIdx];
          const placedW = bestRotated ? itemH : itemW;
          const placedH = bestRotated ? itemW : itemH;
          const px = targetRect.x;
          const py = targetRect.y;

          placedOnSheet.push({
            part: item,
            x: px,
            y: py,
            width: placedW,
            height: placedH,
            rotated: bestRotated,
          });

          unplaced.splice(itemIdx, 1);
          freeRects = NestingEngine.splitMaxRects(freeRects, px, py, placedW, placedH);

          if (item.cutouts && item.cutouts.length > 0) {
            item.cutouts.forEach((cut) => {
              const cutX = px + (bestRotated ? cut.y : cut.x);
              const cutY = py + (bestRotated ? cut.x : cut.y);
              const cutW = bestRotated ? cut.height : cut.width;
              const cutH = bestRotated ? cut.width : cut.height;
              if (cutW >= 80 && cutH >= 80) {
                freeRects.push({
                  x: cutX,
                  y: cutY,
                  w: cutW,
                  h: cutH,
                });
              }
            });
          }

          NestingEngine.cleanFreeRects(freeRects);
        } else {
          itemIdx++;
        }
      }

      if (placedOnSheet.length > 0) {
        const cutLines = NestingEngine.generateSheetCutLines(placedOnSheet, sheetW, sheetH);
        const offcuts: NestingOffcut[] = NestingEngine.calculateDisjointOffcuts(placedOnSheet, sheetW, sheetH);

        const usedAreaSqM = placedOnSheet.reduce(
          (acc, p) => acc + NestingEngine.getPartNetAreaSqM(p.part),
          0
        );
        const totalAreaSqM = (sheetW * sheetH) / 1_000_000;
        const efficiencyPct = Math.min(100, Math.round((usedAreaSqM / totalAreaSqM) * 100));

        const dummyIdx = sheets.length + 1;
        const firstPart = placedOnSheet[0]?.part;
        sheets.push({
          sheetIndex: dummyIdx,
          sheetLabel: `Лист ${dummyIdx}`,
          materialId,
          materialName: firstPart?.materialName || materialName,
          decorCode: firstPart?.decorCode,
          color: firstPart?.color,
          thickness: firstPart?.thickness,
          sheetWidth: sheetW,
          sheetHeight: sheetH,
          placedParts: placedOnSheet,
          cutLines,
          offcuts,
          usedAreaSqM: Math.round(usedAreaSqM * 1000) / 1000,
          totalAreaSqM: Math.round(totalAreaSqM * 1000) / 1000,
          efficiencyPct,
        });
      } else if (unplaced.length > 0) {
        const oversized = unplaced.shift()!;
        const netArea = NestingEngine.getPartNetAreaSqM(oversized);
        const dummyIdx = sheets.length + 1;
        const totalAreaSqM = Math.round(((sheetW * sheetH) / 1_000_000) * 1000) / 1000;
        const efficiencyPct = Math.min(100, Math.round((netArea / totalAreaSqM) * 100));

        sheets.push({
          sheetIndex: dummyIdx,
          sheetLabel: `Лист ${dummyIdx}`,
          materialId,
          materialName: oversized.materialName || materialName,
          decorCode: oversized.decorCode,
          color: oversized.color,
          thickness: oversized.thickness,
          sheetWidth: Math.max(sheetW, oversized.width),
          sheetHeight: Math.max(sheetH, oversized.height),
          placedParts: [{
            part: oversized,
            x: 0,
            y: 0,
            width: oversized.width,
            height: oversized.height,
            rotated: false,
          }],
          cutLines: [],
          offcuts: [],
          usedAreaSqM: netArea,
          totalAreaSqM,
          efficiencyPct,
        });
      }
    }

    const totalPartsAreaSqM = sortedParts.reduce((acc, p) => acc + NestingEngine.getPartNetAreaSqM(p), 0);
    const totalSheetsAreaSqM = sheets.length * ((sheetW * sheetH) / 1_000_000);
    const overallEfficiencyPct = totalSheetsAreaSqM > 0
      ? Math.min(100, Math.round((totalPartsAreaSqM / totalSheetsAreaSqM) * 100))
      : 100;

    return {
      materialId,
      materialName,
      totalSheets: sheets.length,
      totalParts: sortedParts.length,
      totalPartsAreaSqM: Math.round(totalPartsAreaSqM * 100) / 100,
      totalSheetsAreaSqM: Math.round(totalSheetsAreaSqM * 100) / 100,
      overallEfficiencyPct,
      sheets,
    };
  }

  /**
   * Разделение всех свободных прямоугольников при размещении новой детали (Maximal Rectangles)
   */
  private static splitMaxRects(
    freeRects: FreeRect[],
    px: number,
    py: number,
    pw: number,
    ph: number
  ): FreeRect[] {
    const nextRects: FreeRect[] = [];

    for (const r of freeRects) {
      // Проверяем пересечение
      if (px >= r.x + r.w || px + pw <= r.x || py >= r.y + r.h || py + ph <= r.y) {
        nextRects.push(r);
        continue;
      }

      // 1. Левая свободная зона
      if (px > r.x && px < r.x + r.w) {
        nextRects.push({
          x: r.x,
          y: r.y,
          w: px - r.x,
          h: r.h,
        });
      }

      // 2. Правая свободная зона
      if (px + pw > r.x && px + pw < r.x + r.w) {
        nextRects.push({
          x: px + pw,
          y: r.y,
          w: r.x + r.w - (px + pw),
          h: r.h,
        });
      }

      // 3. Нижняя свободная зона
      if (py > r.y && py < r.y + r.h) {
        nextRects.push({
          x: r.x,
          y: r.y,
          w: r.w,
          h: py - r.y,
        });
      }

      // 4. Верхняя свободная зона
      if (py + ph > r.y && py + ph < r.y + r.h) {
        nextRects.push({
          x: r.x,
          y: py + ph,
          w: r.w,
          h: r.y + r.h - (py + ph),
        });
      }
    }

    return nextRects;
  }

  /**
   * Вычисление неперекрывающихся деловых обрезков для понятной визуализации остатков на листе
   */
  private static calculateDisjointOffcuts(
    placed: PlacedNestingPart[],
    sheetW: number,
    sheetH: number
  ): NestingOffcut[] {
    const offcuts: NestingOffcut[] = [];
    if (placed.length === 0) {
      offcuts.push({ x: 0, y: 0, width: sheetW, height: sheetH, areaSqM: (sheetW * sheetH) / 1_000_000 });
      return offcuts;
    }

    // Находим максимальную занятую координату X и Y
    const maxX = Math.max(...placed.map((p) => p.x + p.width));
    const maxY = Math.max(...placed.map((p) => p.y + p.height));

    // 1. Правый сплошной остаток листа
    if (sheetW - maxX >= 60) {
      offcuts.push({
        x: maxX,
        y: 0,
        width: sheetW - maxX,
        height: sheetH,
        areaSqM: Math.round((((sheetW - maxX) * sheetH) / 1_000_000) * 1000) / 1000,
      });
    }

    // 2. Верхний сплошной остаток листа (над деталями)
    if (sheetH - maxY >= 60) {
      offcuts.push({
        x: 0,
        y: maxY,
        width: maxX > 0 ? maxX : sheetW,
        height: sheetH - maxY,
        areaSqM: Math.round((((maxX > 0 ? maxX : sheetW) * (sheetH - maxY)) / 1_000_000) * 1000) / 1000,
      });
    }

    // 3. Локальные свободные карманы внутри листа (если есть детали разной высоты в колонке)
    placed.forEach((p) => {
      if (p.x + p.width < maxX && p.y + p.height < maxY) {
        const pocketW = maxX - (p.x + p.width);
        const pocketH = p.height;
        // Проверяем, не занята ли эта зона другой деталью
        const isOccupied = placed.some(
          (other) =>
            other !== p &&
            other.x < p.x + p.width + pocketW &&
            other.x + other.width > p.x + p.width &&
            other.y < p.y + pocketH &&
            other.y + other.height > p.y
        );
        if (!isOccupied && pocketW >= 80 && pocketH >= 80) {
          offcuts.push({
            x: p.x + p.width,
            y: p.y,
            width: pocketW,
            height: pocketH,
            areaSqM: Math.round(((pocketW * pocketH) / 1_000_000) * 1000) / 1000,
          });
        }
      }
    });

    return offcuts;
  }

  /**
   * Генерация линий распила на листе
   */
  private static generateSheetCutLines(
    placed: PlacedNestingPart[],
    sheetW: number,
    sheetH: number
  ): NestingCutLine[] {
    const lines: NestingCutLine[] = [];

    placed.forEach((p) => {
      // 1. Верхний рез
      if (p.y + p.height < sheetH - 1) {
        lines.push({
          p1: { x: p.x, y: p.y + p.height },
          p2: { x: p.x + p.width, y: p.y + p.height },
          length: p.width,
          orientation: 'HORIZONTAL',
          label: `${p.width}`,
        });
      }

      // 2. Правый рез
      if (p.x + p.width < sheetW - 1) {
        lines.push({
          p1: { x: p.x + p.width, y: p.y },
          p2: { x: p.x + p.width, y: p.y + p.height },
          length: p.height,
          orientation: 'VERTICAL',
          label: `${p.height}`,
        });
      }

      // 3. Если у детали есть наклонные полигональные линии реза
      if (p.part.polygonPoints && p.part.polygonPoints.length > 2) {
        const poly = p.part.polygonPoints;
        const n = poly.length;
        const xs = poly.map((pt) => pt.x);
        const ys = poly.map((pt) => pt.y);
        const minX = Math.min(...xs);
        const minY = Math.min(...ys);

        for (let i = 0; i < n; i++) {
          const pt1 = poly[i];
          const pt2 = poly[(i + 1) % n];
          const isVert = Math.abs(pt1.x - pt2.x) < 1e-2;
          const isHoriz = Math.abs(pt1.y - pt2.y) < 1e-2;

          if (!isVert && !isHoriz) {
            lines.push({
              p1: { x: p.x + (pt1.x - minX), y: p.y + (pt1.y - minY) },
              p2: { x: p.x + (pt2.x - minX), y: p.y + (pt2.y - minY) },
              length: Math.round(Math.hypot(pt2.x - pt1.x, pt2.y - pt1.y)),
              orientation: 'DIAGONAL',
              label: 'Наклонный рез',
            });
          }
        }
      }
    });

    return lines;
  }

  private static cleanFreeRects(rects: FreeRect[]): void {
    for (let i = 0; i < rects.length; i++) {
      // Удаляем слишком мелкие прямоугольники
      if (rects[i].w < 15 || rects[i].h < 15) {
        rects.splice(i, 1);
        i--;
        continue;
      }

      for (let j = i + 1; j < rects.length; j++) {
        const r1 = rects[i];
        const r2 = rects[j];

        // Если r1 полностью содержит r2
        if (
          r1.x <= r2.x &&
          r1.y <= r2.y &&
          r1.x + r1.w >= r2.x + r2.w &&
          r1.y + r1.h >= r2.y + r2.h
        ) {
          rects.splice(j, 1);
          j--;
          continue;
        }

        // Если r2 полностью содержит r1
        if (
          r2.x <= r1.x &&
          r2.y <= r1.y &&
          r2.x + r2.w >= r1.x + r1.w &&
          r2.y + r2.h >= r1.y + r1.h
        ) {
          rects.splice(i, 1);
          i--;
          break;
        }
      }
    }
  }
}


import { Point2D } from '../geometry/PolygonSlicingEngine';

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
   * Выполняет 2D-раскрой всех переданных деталей по листам с группировкой по материалам
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

    // 2. Группировка по материалу
    const groupsByMaterial = new Map<string, NestingPartInput[]>();
    validParts.forEach((p) => {
      const list = groupsByMaterial.get(p.materialId) || [];
      list.push(p);
      groupsByMaterial.set(p.materialId, list);
    });

    const materialResults: MaterialNestingResult[] = [];
    const allSheets: NestingSheet[] = [];
    let globalSheetCounter = 1;

    groupsByMaterial.forEach((matParts, matId) => {
      const matName = matParts[0]?.materialName || 'Панель AllWall';
      const matResult = this.packMaterialParts(matParts, matId, matName, sheetW, sheetH, globalSheetCounter);
      
      globalSheetCounter += matResult.sheets.length;
      materialResults.push(matResult);
      allSheets.push(...matResult.sheets);
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
   * Упаковка деталей одного материала методом MaxRects Best-Fit 2D Bin Packing
   */
  private static packMaterialParts(
    parts: NestingPartInput[],
    materialId: string,
    materialName: string,
    sheetW: number,
    sheetH: number,
    startingSheetIndex: number
  ): MaterialNestingResult {
    // Сортировка деталей по высоте/площади (Max height first)
    const sortedParts = [...parts].sort((a, b) => {
      const maxA = Math.max(a.width, a.height);
      const maxB = Math.max(b.width, b.height);
      if (Math.abs(maxB - maxA) > 10) return maxB - maxA;
      return b.width * b.height - a.width * a.height;
    });

    const sheets: NestingSheet[] = [];
    const unplaced = [...sortedParts];

    while (unplaced.length > 0) {
      const currentSheetIndex = startingSheetIndex + sheets.length;
      const freeRects: FreeRect[] = [{ x: 0, y: 0, w: sheetW, h: sheetH }];
      const placedOnSheet: PlacedNestingPart[] = [];

      let itemIdx = 0;
      while (itemIdx < unplaced.length) {
        const item = unplaced[itemIdx];
        const itemW = Math.round(item.width);
        const itemH = Math.round(item.height);

        // Ищем наилучший свободный прямоугольник
        let bestRectIdx = -1;
        let bestFitScore = Number.MAX_VALUE;
        let bestRotated = false;

        for (let r = 0; r < freeRects.length; r++) {
          const rect = freeRects[r];

          // 1. Попытка без вращения
          if (itemW <= rect.w && itemH <= rect.h) {
            const leftoverW = rect.w - itemW;
            const leftoverH = rect.h - itemH;
            const score = Math.min(leftoverW, leftoverH) * 1000 + Math.max(leftoverW, leftoverH);
            if (score < bestFitScore) {
              bestFitScore = score;
              bestRectIdx = r;
              bestRotated = false;
            }
          }

          // 2. Попытка с поворотом на 90 градусов (если помещается)
          if (itemH <= rect.w && itemW <= rect.h) {
            const leftoverW = rect.w - itemH;
            const leftoverH = rect.h - itemW;
            const score = Math.min(leftoverW, leftoverH) * 1000 + Math.max(leftoverW, leftoverH);
            if (score < bestFitScore) {
              bestFitScore = score;
              bestRectIdx = r;
              bestRotated = true;
            }
          }
        }

        if (bestRectIdx !== -1) {
          // Размещаем деталь
          const targetRect = freeRects[bestRectIdx];
          const placedW = bestRotated ? itemH : itemW;
          const placedH = bestRotated ? itemW : itemH;

          placedOnSheet.push({
            part: item,
            x: targetRect.x,
            y: targetRect.y,
            width: placedW,
            height: placedH,
            rotated: bestRotated,
          });

          // Удаляем деталь из неразмещенных
          unplaced.splice(itemIdx, 1);

          // Делим свободное пространство по принципу гильотинного распила
          const px = targetRect.x;
          const py = targetRect.y;
          const pw = placedW;
          const ph = placedH;

          // Удаляем старый прямоугольник
          freeRects.splice(bestRectIdx, 1);

          // Новые свободные прямоугольники
          const rightW = targetRect.w - pw;
          const topH = targetRect.h - ph;

          if (rightW > 10) {
            freeRects.push({
              x: px + pw,
              y: py,
              w: rightW,
              h: ph,
            });
          }

          if (topH > 10) {
            freeRects.push({
              x: px,
              y: py + ph,
              w: targetRect.w,
              h: topH,
            });
          }

          // Добавляем деловой остаток от выреза проемов (двери, окна, ниши) в список свободных зон
          if (item.cutouts && item.cutouts.length > 0) {
            item.cutouts.forEach((cut) => {
              const cutX = px + (bestRotated ? cut.y : cut.x);
              const cutY = py + (bestRotated ? cut.x : cut.y);
              const cutW = bestRotated ? cut.height : cut.width;
              const cutH = bestRotated ? cut.width : cut.height;
              if (cutW > 50 && cutH > 50) {
                freeRects.push({
                  x: cutX,
                  y: cutY,
                  w: cutW,
                  h: cutH,
                });
              }
            });
          }

          // Сливаем / очищаем дубликаты
          NestingEngine.cleanFreeRects(freeRects);
        } else {
          // Не поместился на этот лист, пробуем следующий
          itemIdx++;
        }
      }

      // Генерация линий распила для листа
      const cutLines = NestingEngine.generateSheetCutLines(placedOnSheet, sheetW, sheetH);

      // Оставшиеся деловые обрезки
      const offcuts: NestingOffcut[] = freeRects
        .filter((r) => r.w >= 100 && r.h >= 100)
        .map((r) => ({
          x: r.x,
          y: r.y,
          width: r.w,
          height: r.h,
          areaSqM: Math.round(((r.w * r.h) / 1_000_000) * 1000) / 1000,
        }));

      const usedAreaSqM = placedOnSheet.reduce(
        (acc, p) => acc + (p.width * p.height) / 1_000_000,
        0
      );
      const totalAreaSqM = (sheetW * sheetH) / 1_000_000;
      const efficiencyPct = Math.round((usedAreaSqM / totalAreaSqM) * 100);

      sheets.push({
        sheetIndex: currentSheetIndex,
        sheetLabel: `Лист ${currentSheetIndex}`,
        materialId,
        materialName,
        sheetWidth: sheetW,
        sheetHeight: sheetH,
        placedParts: placedOnSheet,
        cutLines,
        offcuts,
        usedAreaSqM: Math.round(usedAreaSqM * 1000) / 1000,
        totalAreaSqM: Math.round(totalAreaSqM * 1000) / 1000,
        efficiencyPct,
      });

      // Предохранитель от бесконечного цикла, если деталь больше стандартного листа
      if (placedOnSheet.length === 0 && unplaced.length > 0) {
        // Принудительно размещаем превышающую деталь в отдельный лист
        const oversized = unplaced.shift()!;
        sheets.push({
          sheetIndex: currentSheetIndex,
          sheetLabel: `Лист ${currentSheetIndex}`,
          materialId,
          materialName,
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
          usedAreaSqM: Math.round(((oversized.width * oversized.height) / 1_000_000) * 1000) / 1000,
          totalAreaSqM: Math.round(((sheetW * sheetH) / 1_000_000) * 1000) / 1000,
          efficiencyPct: 100,
        });
      }
    }

    const totalPartsAreaSqM = parts.reduce((acc, p) => acc + (p.width * p.height) / 1_000_000, 0);
    const totalSheetsAreaSqM = sheets.length * ((sheetW * sheetH) / 1_000_000);
    const overallEfficiencyPct = totalSheetsAreaSqM > 0
      ? Math.round((totalPartsAreaSqM / totalSheetsAreaSqM) * 100)
      : 100;

    return {
      materialId,
      materialName,
      totalSheets: sheets.length,
      totalParts: parts.length,
      totalPartsAreaSqM: Math.round(totalPartsAreaSqM * 100) / 100,
      totalSheetsAreaSqM: Math.round(totalSheetsAreaSqM * 100) / 100,
      overallEfficiencyPct,
      sheets,
    };
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

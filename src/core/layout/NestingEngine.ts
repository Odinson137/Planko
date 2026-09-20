import { TextureMapping, hasPhotoTexture, resolveTextureMapping, textureMappingError, textureFootprint, pointOnSheet } from '../textures/TextureMapping';
import { Point2D } from '../geometry/PolygonSlicingEngine';
import { subtractRectangles } from '../geometry/Rect2D';
import { polygonsSeparated } from '../geometry/PolygonCollision';
import { PanelBendInfo } from '../models/Wall';
import type { Material, MaterialType } from '../models/Material';

export interface NestingCutout {
  x: number;          // смещение выреза от левого края детали в мм
  y: number;          // смещение выреза от нижнего края детали в мм
  width: number;      // ширина выреза в мм
  height: number;     // высота выреза в мм
  type?: string;      // 'DOOR' | 'WINDOW' | 'NICHE'
  label?: string;
}

export interface NestingPartInput {
  /** Wall-space origin used to resolve an inherited source-sheet anchor. */
  x?: number;
  y?: number;
  textureMapping?: TextureMapping;
  textureCategory?: string;
  patternAngleDeg?: number;
  patternFlipX?: boolean;
  id: string;
  wallId: string;
  wallName: string;
  partLabel: string;
  width: number;
  height: number;
  areaSqM?: number;
  materialId: string;
  materialType?: MaterialType;
  stockWidth?: number;
  stockHeight?: number;
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
  textureAngleDeg?: number;
  /** Pieces split from this same source crop may share nominal cut boundaries. */
  sourceBlankKey?: string;
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
  commonCutPartLabels?: string[];
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

  public static fitsStock(width: number, height: number, stockWidth = this.DEFAULT_SHEET_WIDTH, stockHeight = this.DEFAULT_SHEET_HEIGHT, type?: MaterialType): boolean {
    // Polygon intersections can produce 1220.0000000000002 for a 1220 mm edge.
    // Absorb numerical noise without rounding the contour or allowing real oversize parts.
    const epsilon = 1e-7;
    return (width <= stockWidth + epsilon && height <= stockHeight + epsilon) ||
      (type !== 'SLAT' && height <= stockWidth + epsilon && width <= stockHeight + epsilon);
  }

  /**
   * Вычисляет реальную полезную нетто-площадь детали (с вычетом проемов / по полигону)
   */
  public static getPartNetAreaSqM(part: NestingPartInput): number {
    if (part.areaSqM !== undefined && part.areaSqM > 0) {
      return part.areaSqM;
    }
    const polygon = part.polygonPoints;
    const rawArea = polygon && polygon.length >= 3
      ? Math.abs(polygon.reduce((sum, p, i) => {
        const next = polygon[(i + 1) % polygon.length];
        return sum + p.x * next.y - next.x * p.y;
      }, 0)) / 2_000_000
      : (part.width * part.height) / 1_000_000;
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
    sheetH: number = NestingEngine.DEFAULT_SHEET_HEIGHT,
    materials: Material[] = []
  ): ProjectNestingResult {
    // 1. Фильтруем пустые элементы и нулевые размеры
    const validParts = parts.map((part) => {
      const material = materials.find((m) => m.id === part.materialId);
      return { ...part, textureCategory: part.textureCategory ?? material?.textureCategory, materialType: material?.type ?? part.materialType,
        stockWidth: material?.width ?? part.stockWidth ?? sheetW,
        stockHeight: material?.height ?? part.stockHeight ?? sheetH };
    }).filter(
      (p) => p.width > 5 && p.height > 5 && p.materialId !== 'mat-none' && !p.partLabel.includes('ПУСТО')
    );

    // 2. Группировка по физическому материалу (декор / артикул / толщина)
    // Детали с одинаковым декором / названием / толщиной должны раскраиваться на одних и тех же листах
    const getMaterialGroupKey = (p: NestingPartInput): string => {
      const thickness = p.thickness || 5;
      if (p.decorCode && p.decorCode.trim()) {
        return `DECOR_${p.textureCategory ?? ""}_${p.decorCode.trim()}_${thickness}`;
      }
      if (p.materialId && p.materialId !== 'mat-none') {
        return `MAT_${p.materialId}_${thickness}`;
      }
      if (p.materialName && p.materialName.trim() && p.materialName !== 'Панель AllWall') {
        return `NAME_${p.materialName.trim()}_${thickness}`;
      }
      if (p.color && p.color.trim()) {
        return `COLOR_${p.color.trim()}_${thickness}`;
      }
      return `DEFAULT_SHEET_${thickness}`;
    };

    const groupsByMaterial = new Map<string, NestingPartInput[]>();
    validParts.forEach((p) => {
      const distinctModel = p.materialType === 'SLAT' || materials.some((m) => m.id === p.materialId && m.isCustom);
      const key = `${getMaterialGroupKey(p)}_${p.materialType ?? 'SHEET'}_${p.stockWidth}_${p.stockHeight}_${distinctModel ? p.materialId : ''}`;
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
      const matResult = this.packMaterialParts(matParts, matId, matName, firstPart.stockWidth ?? sheetW, firstPart.stockHeight ?? sheetH);

      materialResults.push(matResult);
      rawSheets.push(...matResult.sheets);
    });

    // Сортируем все сформированные листы по порядку стен, на которых они впервые нужны
    rawSheets.sort((sA, sB) => {
      const getMinWall = (s: NestingSheet) => {
        const wallNums = s.placedParts
          .map((p) => {
            const m = p.part.partLabel?.match(/^(\d+)/);
            return m ? parseInt(m[1], 10) : 9999;
          })
          .filter((n) => !isNaN(n));
        return wallNums.length > 0 ? Math.min(...wallNums) : 9999;
      };
      return getMinWall(sA) - getMinWall(sB);
    });

    // Перенумеровываем все листы строго последовательно 1, 2, 3, 4, 5...
    const allSheets: NestingSheet[] = rawSheets.map((sheet, sIdx) => {
      const sheetIndex = sIdx + 1;
      return {
        ...sheet,
        sheetIndex,
        sheetLabel: `${sheet.placedParts[0]?.part.materialType === 'SLAT' ? 'Рейка' : 'Лист'} ${sheetIndex}`,
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
  /** Fixed source regions are physical constraints, not optional packing hints. */
  private static packTextureParts(parts: NestingPartInput[], materialId: string, materialName: string,
    sheetW: number, sheetH: number): MaterialNestingResult {
    const sheets: NestingSheet[] = [];
    for (const input of parts) {
      const part = { ...input };
      // Layout labels round dimensions to tenths. Source contours need their exact
      // bounds, otherwise adjacent pieces acquire artificial overlaps after rotation.
      if (part.polygonPoints && part.polygonPoints.length >= 3) {
        const xs = part.polygonPoints.map(p => p.x), ys = part.polygonPoints.map(p => p.y);
        part.x = Math.min(...xs);
        part.y = Math.min(...ys);
        part.width = Math.max(...xs) - part.x;
        part.height = Math.max(...ys) - part.y;
      }
      const piece = { ...part, textureStockWidth: sheetW, textureStockHeight: sheetH };
      const error = textureMappingError(piece);
      if (error) throw new Error(`Деталь ${part.partLabel}: ${error}`);
      const mapping = resolveTextureMapping(piece);
      part.textureMapping = mapping;
      if (mapping.angleDeg % 90 !== 0 && !part.polygonPoints?.length) {
        part.polygonPoints = [{x:0,y:0},{x:part.width,y:0},{x:part.width,y:part.height},{x:0,y:part.height}];
      }
      const footprint = textureFootprint(part.width, part.height, mapping.angleDeg);
      if (part.materialType === 'SLAT' && (mapping.angleDeg % 180 !== 0 || Math.abs(mapping.offsetX) > 0.01)) {
        throw new Error(`Деталь ${part.partLabel}: рейку нельзя поворачивать поперёк профиля или смещать по ширине.`);
      }
      const source = input.textureMapping;
      const sourceBlankKey = source?.anchor ? JSON.stringify([input.wallId, source.anchor.x, source.anchor.y,
        source.anchor.width, source.anchor.height, source.offsetX, source.offsetY, ((source.angleDeg % 360) + 360) % 360]) : undefined;
      const placed: PlacedNestingPart = { part, x: mapping.offsetX, y: sheetH - mapping.offsetY - footprint.height,
        width: footprint.width, height: footprint.height, rotated: mapping.angleDeg % 180 !== 0,
        textureAngleDeg: mapping.angleDeg, sourceBlankKey };
      let sheet = sheets.find(s => s.placedParts.every(p => this.partsSeparated(placed, p, sheetW)));
      if (!sheet) {
        sheet = { sheetIndex: sheets.length + 1, sheetLabel: `Лист ${sheets.length + 1}`, materialId, materialName,
          decorCode: part.decorCode, color: part.color, thickness: part.thickness, sheetWidth: sheetW, sheetHeight: sheetH,
          placedParts: [], cutLines: [], offcuts: [], usedAreaSqM: 0, totalAreaSqM: sheetW * sheetH / 1e6, efficiencyPct: 0 };
        sheets.push(sheet);
      }
      sheet.placedParts.push(placed);
    }
    for (const sheet of sheets) {
      const commonCuts = new Set<string>();
      sheet.placedParts.forEach((a, i) => sheet.placedParts.slice(i + 1).forEach(b => {
        // Contact tolerance identifies a shared boundary; it does not reserve stock.
        if (a.sourceBlankKey && a.sourceBlankKey === b.sourceBlankKey &&
          !polygonsSeparated(this.placedPolygon(a), this.placedPolygon(b), 0.01)) {
          commonCuts.add(a.part.partLabel);
          commonCuts.add(b.part.partLabel);
        }
      }));
      if (commonCuts.size) sheet.commonCutPartLabels = [...commonCuts].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      sheet.cutLines = this.generateSheetCutLines(sheet.placedParts, sheetW, sheetH);
      sheet.offcuts = this.calculateDisjointOffcuts(sheet.placedParts, sheetW, sheetH);
      sheet.usedAreaSqM = sheet.placedParts.reduce((n, p) => n + this.getPartNetAreaSqM(p.part), 0);
      sheet.efficiencyPct = Math.round(sheet.usedAreaSqM / sheet.totalAreaSqM * 100);
    }
    const totalPartsAreaSqM = parts.reduce((n, p) => n + this.getPartNetAreaSqM(p), 0);
    const totalSheetsAreaSqM = sheets.length * sheetW * sheetH / 1e6;
    return { materialId, materialName, sheets, totalSheets: sheets.length, totalParts: parts.length,
      totalPartsAreaSqM, totalSheetsAreaSqM, overallEfficiencyPct: totalSheetsAreaSqM ? Math.round(totalPartsAreaSqM / totalSheetsAreaSqM * 100) : 0 };
  }

  private static partsSeparated(a: PlacedNestingPart, b: PlacedNestingPart, sheetW: number): boolean {
    const widthA = a.part.materialType === 'SLAT' ? sheetW : a.width;
    const widthB = b.part.materialType === 'SLAT' ? sheetW : b.width;
    if (a.x >= b.x + widthB || b.x >= a.x + widthA ||
      a.y >= b.y + b.height || b.y >= a.y + a.height) return true;
    if (a.part.materialType === 'SLAT' || b.part.materialType === 'SLAT') return false;
    return polygonsSeparated(this.placedPolygon(a), this.placedPolygon(b), 0);
  }

  /** Actual contour in sheet coordinates; bounding boxes may overlap. */
  public static placedPolygon(p: PlacedNestingPart): Point2D[] {
    const polygon = p.part.polygonPoints;
    if (polygon && polygon.length >= 3) {
      const minX = Math.min(...polygon.map(q => q.x)), minY = Math.min(...polygon.map(q => q.y));
      return polygon.map(q => this.placedPoint(p, q.x - minX, q.y - minY));
    }
    return [[0, 0], [p.part.width, 0], [p.part.width, p.part.height], [0, p.part.height]]
      .map(([x, y]) => this.placedPoint(p, x, y));
  }

  private static packMaterialParts(
    parts: NestingPartInput[],
    materialId: string,
    materialName: string,
    sheetW: number,
    sheetH: number
  ): MaterialNestingResult {
    const fixed = parts.filter(p => p.textureMapping || hasPhotoTexture(p.textureCategory, p.decorCode));
    if (fixed.length && fixed.length < parts.length) {
      // Unconfigured parts remain freely optimizable; do not silently fix them at the origin.
      const a = this.packTextureParts(fixed, materialId, materialName, sheetW, sheetH);
      const b = this.packMaterialParts(parts.filter(p => !fixed.includes(p)), materialId, materialName, sheetW, sheetH);
      const totalSheetsAreaSqM = a.totalSheetsAreaSqM + b.totalSheetsAreaSqM;
      const totalPartsAreaSqM = a.totalPartsAreaSqM + b.totalPartsAreaSqM;
      return { materialId, materialName, sheets: [...a.sheets, ...b.sheets], totalSheets: a.totalSheets+b.totalSheets,
        totalParts: parts.length, totalPartsAreaSqM, totalSheetsAreaSqM,
        overallEfficiencyPct: totalSheetsAreaSqM ? Math.round(totalPartsAreaSqM/totalSheetsAreaSqM*100) : 0 };
    }
    if (fixed.length) {
      return this.packTextureParts(parts, materialId, materialName, sheetW, sheetH);
    }
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
          const minA = Math.min(a.width, a.height);
          const minB = Math.min(b.width, b.height);
          if (Math.abs(minB - minA) > 1) return minB - minA;
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
      // 3. Сначала крупные панели, узкие рейки/откосы в последнюю очередь (для заполнения остатков)
      {
        name: 'SLENDER_LAST',
        fn: (a, b) => {
          const ratioA = Math.max(a.width, a.height) / Math.max(1, Math.min(a.width, a.height));
          const ratioB = Math.max(b.width, b.height) / Math.max(1, Math.min(b.width, b.height));
          const isSlenderA = ratioA > 3.5 || Math.min(a.width, a.height) <= 250;
          const isSlenderB = ratioB > 3.5 || Math.min(b.width, b.height) <= 250;
          if (isSlenderA !== isSlenderB) return isSlenderA ? 1 : -1;
          return (b.width * b.height) - (a.width * a.height);
        },
      },
      // 4. По периметру детали
      {
        name: 'PERIMETER_DESC',
        fn: (a, b) => {
          const pA = a.width + a.height;
          const pB = b.width + b.height;
          if (Math.abs(pB - pA) > 1) return pB - pA;
          return b.width * b.height - a.width * a.height;
        },
      },
      // 5. По минимальной стороне (толщине/ширине)
      {
        name: 'MIN_SIDE_DESC',
        fn: (a, b) => {
          const minA = Math.min(a.width, a.height);
          const minB = Math.min(b.width, b.height);
          if (Math.abs(minB - minA) > 1) return minB - minA;
          return b.width * b.height - a.width * a.height;
        },
      },
      // 6. По стенам и габариту
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
        const itemW = item.width;
        const itemH = item.height;

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
          if (item.materialType !== 'SLAT' && itemH <= rect.w && itemW <= rect.h) {
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
          // A ripped slat still consumes its entire profile width at this length.
          // Reserve only the nominal dimensions: no saw allowance has been specified.
          freeRects = NestingEngine.splitMaxRects(freeRects, px, py,
            item.materialType === 'SLAT' ? sheetW : placedW, placedH);

          if (item.materialType !== 'SLAT' && item.cutouts && item.cutouts.length > 0) {
            item.cutouts.forEach((cut) => {
              const cutX = px + (bestRotated ? cut.y : cut.x);
              const cutY = py + (bestRotated ? item.width - cut.x - cut.width : cut.y);
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
        const offcuts = NestingEngine.calculateDisjointOffcuts(placedOnSheet, sheetW, sheetH);

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
          sheetWidth: sheetW,
          sheetHeight: sheetH,
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
    // Subtract nominal occupied stock. Rectangle subtraction produces
    // disjoint remnants, so the same offcut cannot be offered more than once.
    const occupied = placed.map(p => ({
      x: p.x,
      y: p.y,
      width: p.part.materialType === 'SLAT' ? sheetW : p.width,
      height: p.height,
    }));
    return subtractRectangles({ x: 0, y: 0, width: sheetW, height: sheetH }, occupied)
      .filter(rect => rect.width >= 60 && rect.height >= 60)
      .map(rect => ({ ...rect, areaSqM: Math.round(rect.width * rect.height / 1000) / 1000 }));
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

    const seen = new Set<string>();
    placed.forEach(p => {
      // A bounding-box cut can run through a neighboring triangle. Cut only
      // actual contour edges and count an inherited common edge once.
      const polygon = this.placedPolygon(p);
      polygon.forEach((p1, i) => {
        const p2 = polygon[(i + 1) % polygon.length];
        const isVert = Math.abs(p1.x - p2.x) < 0.01;
        const isHoriz = Math.abs(p1.y - p2.y) < 0.01;
        if (isVert && (Math.abs(p1.x) < 0.01 || Math.abs(p1.x - sheetW) < 0.01)) return;
        if (isHoriz && (Math.abs(p1.y) < 0.01 || Math.abs(p1.y - sheetH) < 0.01)) return;
        const key = [p1, p2].map(q => `${q.x.toFixed(4)},${q.y.toFixed(4)}`).sort().join('|');
        if (seen.has(key)) return;
        seen.add(key);
        const length = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        if (length < 0.01) return;
        lines.push({ p1, p2, length, orientation: isVert ? 'VERTICAL' : isHoriz ? 'HORIZONTAL' : 'DIAGONAL',
          label: !isVert && !isHoriz ? 'Наклонный рез' : `${Math.round(length)}` });
      });
    });

    return lines;
  }

  public static placedPoint(p: PlacedNestingPart, x: number, y: number): Point2D {
    if (p.textureAngleDeg !== undefined) {
      const mapped = pointOnSheet(x, p.part.height-y, p.part.width, p.part.height, p.textureAngleDeg);
      return { x: p.x+mapped.x, y: p.y+p.height-mapped.y };
    }
    return p.rotated ? { x: p.x+y, y: p.y+p.part.width-x } : { x: p.x+x, y: p.y+y };
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

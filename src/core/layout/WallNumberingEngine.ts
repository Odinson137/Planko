import { Wall, WallPanelPiece } from '../models/Wall';
import { MATERIAL_NONE_ID } from '../models/Material';
import { Point2D } from '../geometry/PolygonSlicingEngine';
import { Project } from '../models/Project';

export interface PanelBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  cx: number;
  cy: number;
}

/**
 * Вычисляет габариты и центр детали (по вершинам полигона или по прямоугольнику x,y,w,h)
 */
export function getPanelBounds(p: {
  points?: Point2D[];
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}): PanelBounds {
  if (p.points && p.points.length > 0) {
    const xs = p.points.map((pt) => pt.x);
    const ys = p.points.map((pt) => pt.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    return {
      minX,
      maxX,
      minY,
      maxY,
      cx: (minX + maxX) / 2,
      cy: (minY + maxY) / 2,
    };
  }
  const minX = p.x ?? 0;
  const minY = p.y ?? 0;
  const maxX = minX + (p.width ?? 0);
  const maxY = minY + (p.height ?? 0);
  return {
    minX,
    maxX,
    minY,
    maxY,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
  };
}

/**
 * Геометрический компаратор панелей/деталей:
 * 1. Слева направо (по возрастанию координаты X).
 * 2. Если элементы находятся в одной вертикальной полосе/колонке (перекрываются по X) —
 *    сверху вниз (по убыванию координаты Y от потолка к полу).
 */
export function comparePanelsLeftToRightTopToBottom(
  a: { points?: Point2D[]; x?: number; y?: number; width?: number; height?: number },
  b: { points?: Point2D[]; x?: number; y?: number; width?: number; height?: number }
): number {
  const bA = getPanelBounds(a);
  const bB = getPanelBounds(b);

  const overlapX = Math.min(bA.maxX, bB.maxX) - Math.max(bA.minX, bB.minX);
  const minW = Math.min(bA.maxX - bA.minX, bB.maxX - bB.minX);

  // Считаем, что элементы в одной вертикальной колонке/полосе, если они существенно перекрываются по X
  const isSameColumn =
    (minW > 0 && overlapX > 0.25 * minW) ||
    Math.abs(bA.minX - bB.minX) < 5 ||
    Math.abs(bA.cx - bB.cx) < 10;

  if (isSameColumn) {
    // В одной колонке: сверху вниз (больший maxY / cy идет раньше)
    if (Math.abs(bA.maxY - bB.maxY) > 2) {
      return bB.maxY - bA.maxY;
    }
    if (Math.abs(bA.cy - bB.cy) > 2) {
      return bB.cy - bA.cy;
    }
    // Если по высоте одинаковы, то слева направо
    return bA.minX - bB.minX;
  }

  // В разных колонках: слева направо (меньший minX / cx идет раньше)
  if (Math.abs(bA.minX - bB.minX) > 2) {
    return bA.minX - bB.minX;
  }
  if (Math.abs(bA.cx - bB.cx) > 2) {
    return bA.cx - bB.cx;
  }

  // При прочих равных: сверху вниз
  return bB.maxY - bA.maxY;
}

/**
 * Пересчитывает маркировку всех деталей стены:
 * Первая цифра — номер стены (1-based, wallNumber).
 * Вторая цифра — порядковый номер элемента на стене (1, 2, 3...) слева направо и сверху вниз.
 * Для пустых зон: partLabel = 'ПУСТО'.
 */
export function renumberWallPanels(wall: Wall, wallIndexOrNumber: number = 1): Wall {
  const wallNumber = wallIndexOrNumber >= 1 ? Math.floor(wallIndexOrNumber) : 1;

  // 1. Полигональная модель wall.panels
  let nextPanels = wall.panels ? [...wall.panels] : undefined;

  if (nextPanels && nextPanels.length > 0) {
    const nonVoidPanels: { panel: WallPanelPiece; originalIdx: number }[] = [];

    nextPanels.forEach((p, idx) => {
      const isVoid = Boolean(p.isVoid || p.materialId === MATERIAL_NONE_ID || p.partLabel === 'ПУСТО');
      if (!isVoid) {
        nonVoidPanels.push({ panel: p, originalIdx: idx });
      }
    });

    // Сортируем непустые детали: слева направо, сверху вниз
    nonVoidPanels.sort((a, b) => comparePanelsLeftToRightTopToBottom(a.panel, b.panel));

    // Создаем карту id -> новый partLabel
    const labelMap = new Map<string, string>();
    nonVoidPanels.forEach((item, seqIdx) => {
      const newLabel = `${wallNumber}.${seqIdx + 1}`;
      labelMap.set(item.panel.id, newLabel);
    });

    nextPanels = nextPanels.map((p) => {
      const isVoid = Boolean(p.isVoid || p.materialId === MATERIAL_NONE_ID || (!labelMap.has(p.id) && p.partLabel === 'ПУСТО'));
      if (isVoid) {
        return { ...p, isVoid: true, partLabel: 'ПУСТО' };
      }
      const newLabel = labelMap.get(p.id) || `${wallNumber}.1`;
      return { ...p, isVoid: false, partLabel: newLabel };
    });
  }

  // 2. Сеточная модель wall.customPanels
  let nextCustomPanels = wall.customPanels ? { ...wall.customPanels } : wall.customPanels;
  if (nextCustomPanels) {
    const updatedCustom: typeof nextCustomPanels = {};

    // Собираем все непустые ячейки / сегменты
    const itemsToSort: {
      colIdx: number;
      segIdx: number | null;
      subPieceId?: string;
      bounds: PanelBounds;
      isVoid: boolean;
    }[] = [];

    let currentX = 0;
    const colKeys = Object.keys(nextCustomPanels).map(Number).sort((a, b) => a - b);

    for (const colIdx of colKeys) {
      const colConfig = nextCustomPanels[colIdx];
      const colWidth = colConfig.customWidth || 1220;

      if (colConfig.subPieces && colConfig.subPieces.length > 0) {
        colConfig.subPieces.forEach((sp) => {
          const isVoid = Boolean(sp.isVoid || sp.materialId === MATERIAL_NONE_ID || sp.partLabel === 'ПУСТО');
          const pts = sp.points.map((pt) => ({ x: currentX + pt.x, y: pt.y }));
          const bounds = getPanelBounds({ points: pts });
          itemsToSort.push({
            colIdx,
            segIdx: null,
            subPieceId: sp.id,
            bounds,
            isVoid,
          });
        });
      } else if (colConfig.segments && colConfig.segments.length > 0) {
        let currentY = 0;
        colConfig.segments.forEach((seg, sIdx) => {
          const segHeight = seg.height || wall.height;
          if (seg.subPieces && seg.subPieces.length > 0) {
            seg.subPieces.forEach((sp) => {
              const isVoid = Boolean(sp.isVoid || sp.materialId === MATERIAL_NONE_ID || sp.partLabel === 'ПУСТО');
              const pts = sp.points.map((pt) => ({ x: currentX + pt.x, y: currentY + pt.y }));
              const bounds = getPanelBounds({ points: pts });
              itemsToSort.push({
                colIdx,
                segIdx: sIdx,
                subPieceId: sp.id,
                bounds,
                isVoid,
              });
            });
          } else {
            const isVoid = Boolean(seg.customMaterialId === MATERIAL_NONE_ID || seg.partLabel === 'ПУСТО');
            const bounds = getPanelBounds({ x: currentX, y: currentY, width: colWidth, height: segHeight });
            itemsToSort.push({
              colIdx,
              segIdx: sIdx,
              bounds,
              isVoid,
            });
          }
          currentY += segHeight;
        });
      } else {
        const isVoid = Boolean(colConfig.customMaterialId === MATERIAL_NONE_ID);
        const bounds = getPanelBounds({ x: currentX, y: 0, width: colWidth, height: wall.height });
        itemsToSort.push({
          colIdx,
          segIdx: null,
          bounds,
          isVoid,
        });
      }

      currentX += colWidth;
    }

    const nonVoidItems = itemsToSort.filter((it) => !it.isVoid);
    nonVoidItems.sort((a, b) => comparePanelsLeftToRightTopToBottom({ x: a.bounds.minX, y: a.bounds.minY, width: a.bounds.maxX - a.bounds.minX, height: a.bounds.maxY - a.bounds.minY }, { x: b.bounds.minX, y: b.bounds.minY, width: b.bounds.maxX - b.bounds.minX, height: b.bounds.maxY - b.bounds.minY }));

    const itemLabelMap = new Map<string, string>();
    nonVoidItems.forEach((it, seqIdx) => {
      const key = `${it.colIdx}_${it.segIdx ?? 'null'}_${it.subPieceId ?? 'none'}`;
      itemLabelMap.set(key, `${wallNumber}.${seqIdx + 1}`);
    });

    for (const colIdx of colKeys) {
      const colConfig = { ...nextCustomPanels[colIdx] };
      if (colConfig.subPieces && colConfig.subPieces.length > 0) {
        colConfig.subPieces = colConfig.subPieces.map((sp) => {
          const key = `${colIdx}_null_${sp.id}`;
          const isVoid = Boolean(sp.isVoid || sp.materialId === MATERIAL_NONE_ID);
          return {
            ...sp,
            isVoid,
            partLabel: isVoid ? 'ПУСТО' : (itemLabelMap.get(key) || `${wallNumber}.1`),
          };
        });
      }
      if (colConfig.segments && colConfig.segments.length > 0) {
        colConfig.segments = colConfig.segments.map((seg, sIdx) => {
          const segCopy = { ...seg };
          if (segCopy.subPieces && segCopy.subPieces.length > 0) {
            segCopy.subPieces = segCopy.subPieces.map((sp) => {
              const key = `${colIdx}_${sIdx}_${sp.id}`;
              const isVoid = Boolean(sp.isVoid || sp.materialId === MATERIAL_NONE_ID);
              return {
                ...sp,
                isVoid,
                partLabel: isVoid ? 'ПУСТО' : (itemLabelMap.get(key) || `${wallNumber}.1`),
              };
            });
          } else {
            const key = `${colIdx}_${sIdx}_none`;
            const isVoid = Boolean(segCopy.customMaterialId === MATERIAL_NONE_ID || segCopy.partLabel === 'ПУСТО');
            segCopy.partLabel = isVoid ? 'ПУСТО' : (itemLabelMap.get(key) || `${wallNumber}.${colIdx + 1}.${sIdx + 1}`);
          }
          return segCopy;
        });
      }
      updatedCustom[colIdx] = colConfig;
    }
    nextCustomPanels = updatedCustom;
  }

  return {
    ...wall,
    panels: nextPanels,
    customPanels: nextCustomPanels,
  };
}

/**
 * Пересчитывает маркировку панелей для всех стен проекта:
 * Каждая стена нумеруется в соответствии с её позицией в массиве project.walls (1-я стена -> 1.x, 2-я -> 2.x и т.д.)
 */
export function renumberProjectWalls(project: Project): Project {
  if (!project.walls || project.walls.length === 0) return project;
  const updatedWalls = project.walls.map((wall, wallIdx) => {
    return renumberWallPanels(wall, wallIdx + 1);
  });
  return {
    ...project,
    walls: updatedWalls,
  };
}

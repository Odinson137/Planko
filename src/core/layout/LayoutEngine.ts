import { Wall } from '../models/Wall';
import { Material, DEFAULT_MATERIALS, MATERIAL_NONE_ID } from '../models/Material';

export interface CalculatedPanelPiece {
  id: string;
  x: number;          // мм от левого края
  y: number;          // мм от пола
  width: number;      // мм
  height: number;     // мм
  isCut: boolean;     // является ли кусок подрезанным
  isVoid: boolean;    // true если это пустое пространство без материала
  originalColumnIndex: number;
  originalSegmentIndex: number;
  materialId: string;
  materialColor: string;
  materialType: string;
  partLabel: string;  // метка '1.1', '1.2' или 'ПУСТО'
}

export interface CalculatedJointLine {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;      // толщина шва на чертеже в мм
  length: number;     // длина линии шва в мм
  orientation: 'VERTICAL' | 'HORIZONTAL';
  isLED: boolean;     // true если включена светодиодная подсветка
  isOuterEdge: boolean; // true если это внешний край стены
  columnIndex?: number;
  segmentIndex?: number;
  groupId?: string;
}

export interface LayoutCalculationResult {
  panels: CalculatedPanelPiece[];
  joints: CalculatedJointLine[];
  summary: {
    totalPanelsNeeded: number;
    profileLinearMeters: number;
    wallAreaSqM: number;
    grossCoveredAreaSqM: number;
    coveredAreaSqM: number;
    voidAreaSqM: number;
    cutoutsAreaSqM: number;
  };
}


interface Interval1D {
  start: number;
  end: number;
}

function subtractInterval(intervals: Interval1D[], removeStart: number, removeEnd: number): Interval1D[] {
  const result: Interval1D[] = [];
  for (const inv of intervals) {
    if (removeEnd <= inv.start + 0.1 || removeStart >= inv.end - 0.1) {
      result.push(inv);
      continue;
    }
    if (removeStart > inv.start + 0.1) {
      result.push({ start: inv.start, end: removeStart });
    }
    if (removeEnd < inv.end - 0.1) {
      result.push({ start: removeEnd, end: inv.end });
    }
  }
  return result;
}

export class LayoutEngine {
  public static calculateWallLayout(
    wall: Wall,
    defaultMaterial: Material,
    allMaterials: Material[] = DEFAULT_MATERIALS
  ): LayoutCalculationResult {
    const panels: CalculatedPanelPiece[] = [];
    const rawJoints: CalculatedJointLine[] = [];

    const materialsMap = new Map<string, Material>();
    allMaterials.forEach((m) => materialsMap.set(m.id, m));

    // Параметры внешних краев стены
    const leftEdgeConfig = wall.customJoints['edge-v-left'];
    const leftEdgeWidth = leftEdgeConfig?.width ?? 0;

    const rightEdgeConfig = wall.customJoints['edge-v-right'] || wall.customJoints['edge-v-end'];
    const rightEdgeWidth = rightEdgeConfig?.width ?? 0;

    const botEdgeConfig = wall.customJoints['edge-h-bot'];
    const botEdgeWidth = botEdgeConfig?.width ?? 0;

    const topEdgeConfig = wall.customJoints['edge-h-top'];
    const topEdgeWidth = topEdgeConfig?.width ?? 0;

    let currentX = wall.zone.startOffsetX + leftEdgeWidth;
    const maxX = Math.max(currentX, wall.width - rightEdgeWidth);
    const maxY = Math.max(botEdgeWidth, wall.height - topEdgeWidth);

    // 1. Собираем и настраиваем швы вокруг ВСЕХ проемов (двери, окна, ниши)
    wall.openings.forEach((op) => {
      const leftJointId = `joint-op-left-${op.id}`;
      const rightJointId = `joint-op-right-${op.id}`;
      const topJointId = `joint-op-top-${op.id}`;
      const botJointId = `joint-op-bot-${op.id}`;

      const customLeft = wall.customJoints[leftJointId];
      const customRight = wall.customJoints[rightJointId];
      const customTop = wall.customJoints[topJointId];
      const customBot = wall.customJoints[botJointId];

      const leftGap = customLeft !== undefined ? customLeft.width : 8;
      const rightGap = customRight !== undefined ? customRight.width : 8;
      const topGap = customTop !== undefined ? customTop.width : 8;
      const botGap = op.y > 0 ? (customBot !== undefined ? customBot.width : 8) : 0;

      // 1.1 Шов слева от проема
      rawJoints.push({
        id: leftJointId,
        name: `Стык слева от: ${op.name}`,
        x: op.x - leftGap,
        y: op.y,
        width: leftGap,
        length: op.height,
        orientation: 'VERTICAL',
        isLED: customLeft?.isLED ?? false,
        isOuterEdge: false,
      });

      // 1.2 Шов справа от проема
      rawJoints.push({
        id: rightJointId,
        name: `Стык справа от: ${op.name}`,
        x: op.x + op.width,
        y: op.y,
        width: rightGap,
        length: op.height,
        orientation: 'VERTICAL',
        isLED: customRight?.isLED ?? false,
        isOuterEdge: false,
      });

      // 1.3 Шов сверху над проемом
      rawJoints.push({
        id: topJointId,
        name: `Стык сверху от: ${op.name}`,
        x: op.x,
        y: op.y + op.height,
        width: topGap,
        length: op.width,
        orientation: 'HORIZONTAL',
        isLED: customTop?.isLED ?? false,
        isOuterEdge: false,
      });

      // 1.4 Шов снизу под проемом
      if (op.y > 0) {
        rawJoints.push({
          id: botJointId,
          name: `Стык снизу от: ${op.name}`,
          x: op.x,
          y: op.y - botGap,
          width: botGap,
          length: op.width,
          orientation: 'HORIZONTAL',
          isLED: customBot?.isLED ?? false,
          isOuterEdge: false,
        });
      }
    });

    let columnIndex = 0;
    let materialPiecesCount = 0;

    const columnBoundaries: {
      columnIndex: number;
      x: number;
      width: number;
      vertJointId: string;
      vertJointWidth: number;
      isVertLED: boolean;
      isVertInner: boolean;
    }[] = [];

    const horizJointCandidates: {
      columnIndex: number;
      segmentIndex: number;
      horizJointId: string;
      x: number;
      y: number;
      width: number;
      panelWidth: number;
      horizJointWidth: number;
      isHorizLED: boolean;
      isHorizInner: boolean;
    }[] = [];

    // 2. Генерация панелей стены
    while (currentX < maxX) {
      const customConfig = wall.customPanels?.[columnIndex];
      const columnMaterial =
        (customConfig?.customMaterialId && materialsMap.get(customConfig.customMaterialId)) ||
        defaultMaterial;

      const baseWidth = customConfig?.customWidth ?? (columnMaterial.isVoid ? 1220 : columnMaterial.width);
      const panelWidth = Math.min(baseWidth, Math.max(0, maxX - currentX));

      if (panelWidth <= 0.5) {
        break;
      }

      const vertJointId = `edge-v-${columnIndex}`;
      const customVertJoint = wall.customJoints?.[vertJointId];
      const isVertInner = currentX + panelWidth < maxX - 1;
      const vertJointWidth = isVertInner
        ? (customVertJoint !== undefined ? customVertJoint.width : 8)
        : rightEdgeWidth;
      const isVertLED = customVertJoint?.isLED ?? false;

      columnBoundaries.push({
        columnIndex,
        x: currentX + panelWidth,
        width: vertJointWidth,
        vertJointId,
        vertJointWidth,
        isVertLED,
        isVertInner,
      });

      const segmentsConfig = customConfig?.segments || [];
      let currentY = botEdgeWidth;
      let segmentIndex = 0;

      while (currentY < maxY) {
        const segConfig = segmentsConfig[segmentIndex];
        const segMaterial =
          (segConfig?.customMaterialId && materialsMap.get(segConfig.customMaterialId)) ||
          columnMaterial;

        const isVoid = segMaterial.id === MATERIAL_NONE_ID || segMaterial.isVoid === true;
        const rawHeight = segConfig?.height ?? Math.min(segMaterial.height, maxY - currentY);
        const segmentHeight = Math.min(rawHeight, Math.max(0, maxY - currentY));

        if (segmentHeight <= 0.5) {
          break;
        }

        const horizJointId = `edge-h-${columnIndex}-${segmentIndex}`;
        const customHorizJoint = wall.customJoints?.[horizJointId];
        const isHorizInner = currentY + segmentHeight < maxY - 1;
        const horizJointWidth = isHorizInner
          ? (customHorizJoint !== undefined ? customHorizJoint.width : 8)
          : topEdgeWidth;
        const isHorizLED = customHorizJoint?.isLED ?? false;

        horizJointCandidates.push({
          columnIndex,
          segmentIndex,
          horizJointId,
          x: currentX,
          y: currentY + segmentHeight,
          width: panelWidth,
          panelWidth,
          horizJointWidth,
          isHorizLED,
          isHorizInner,
        });

        if (!isVoid) {
          materialPiecesCount++;
        }

        const defaultLabel = isVoid
          ? 'ПУСТО'
          : segConfig?.partLabel ||
            (segmentsConfig.length > 1
              ? `1.${columnIndex + 1}.${segmentIndex + 1}`
              : `1.${columnIndex + 1}`);

        panels.push({
          id: `panel-${columnIndex}-${segmentIndex}`,
          x: Math.round(currentX * 10) / 10,
          y: Math.round(currentY * 10) / 10,
          width: Math.round(panelWidth * 10) / 10,
          height: Math.round(segmentHeight * 10) / 10,
          isCut: !isVoid && (panelWidth < baseWidth || segmentHeight < segMaterial.height),
          isVoid,
          originalColumnIndex: columnIndex,
          originalSegmentIndex: segmentIndex,
          materialId: segMaterial.id,
          materialColor: isVoid ? 'rgba(30, 31, 35, 0.45)' : segMaterial.color,
          materialType: segMaterial.type,
          partLabel: defaultLabel,
        });

        currentY += segmentHeight + (isHorizInner ? horizJointWidth : 0);
        segmentIndex++;

        if (segmentIndex >= segmentsConfig.length && currentY < maxY && !segConfig) {
          break;
        }
      }

      currentX += panelWidth + (isVertInner ? vertJointWidth : 0);
      columnIndex++;
    }

    // 3. Умное вычисление вертикальных швов: швы НЕ должны рассекать цельные плиты и проемы
    columnBoundaries.forEach((col) => {
      if (!col.isVertInner) return;

      const jointX = col.x;
      let intervals: Interval1D[] = [{ start: 0, end: wall.height }];

      // 3.1 Вычитаем вырезы проемов (только если шов проходит СТРОГО внутри выреза)
      wall.openings.forEach((op) => {
        if (op.isCutout !== false && jointX > op.x + 2 && jointX < op.x + op.width - 2) {
          intervals = subtractInterval(intervals, op.y, op.y + op.height);
        }
      });

      // 3.2 Вычитаем цельные панели, которые перекрывают этот вертикальный шов (например, фрамуга над дверью)
      panels.forEach((p) => {
        if (p.x < jointX - 2 && p.x + p.width > jointX + 2) {
          intervals = subtractInterval(intervals, p.y, p.y + p.height);
        }
      });

      // Отрисовываем оставшиеся отрезки шва
      intervals.forEach((inv, i) => {
        const len = inv.end - inv.start;
        if (len > 5) {
          rawJoints.push({
            id: i === 0 ? col.vertJointId : `${col.vertJointId}-part-${i}`,
            name: `Вертикальный стык К#${col.columnIndex + 1}`,
            x: jointX,
            y: inv.start,
            width: col.vertJointWidth,
            length: len,
            orientation: 'VERTICAL',
            isLED: col.isVertLED,
            isOuterEdge: false,
            columnIndex: col.columnIndex,
          });
        }
      });
    });

    // 4. Умное вычисление горизонтальных швов
    horizJointCandidates.forEach((cand) => {
      if (!cand.isHorizInner && cand.horizJointWidth <= 0) return;

      const jointY = cand.y;
      let intervals: Interval1D[] = [{ start: cand.x, end: cand.x + cand.panelWidth }];

      // Вычитаем вырезы проемов (только если шов проходит СТРОГО внутри выреза, а не по его верху/низу)
      wall.openings.forEach((op) => {
        if (op.isCutout !== false && jointY > op.y + 2 && jointY < op.y + op.height - 2) {
          intervals = subtractInterval(intervals, op.x, op.x + op.width);
        }
      });

      // Вычитаем цельные панели, которые вертикально перекрывают этот шов
      panels.forEach((p) => {
        if (p.y < jointY - 2 && p.y + p.height > jointY + 2 && p.x < cand.x + cand.panelWidth && p.x + p.width > cand.x) {
          intervals = subtractInterval(intervals, Math.max(cand.x, p.x), Math.min(cand.x + cand.panelWidth, p.x + p.width));
        }
      });

      intervals.forEach((inv, i) => {
        const len = inv.end - inv.start;
        if (len > 5) {
          rawJoints.push({
            id: i === 0 ? cand.horizJointId : `${cand.horizJointId}-part-${i}`,
            name: cand.isHorizInner ? `Горизонтальный стык К#${cand.columnIndex + 1}` : 'Верхний край стены',
            x: inv.start,
            y: jointY,
            width: cand.horizJointWidth,
            length: len,
            orientation: 'HORIZONTAL',
            isLED: cand.isHorizLED,
            isOuterEdge: !cand.isHorizInner,
            columnIndex: cand.columnIndex,
            segmentIndex: cand.segmentIndex,
          });
        }
      });
    });

    // 5. Внешние края периметра стены
    rawJoints.push({
      id: 'edge-v-left',
      name: 'Левый край стены',
      x: 0,
      y: 0,
      width: leftEdgeWidth,
      length: wall.height,
      orientation: 'VERTICAL',
      isLED: leftEdgeConfig?.isLED ?? false,
      isOuterEdge: true,
    });

    rawJoints.push({
      id: 'edge-v-right',
      name: 'Правый край стены',
      x: wall.width - rightEdgeWidth,
      y: 0,
      width: rightEdgeWidth,
      length: wall.height,
      orientation: 'VERTICAL',
      isLED: rightEdgeConfig?.isLED ?? false,
      isOuterEdge: true,
    });

    rawJoints.push({
      id: 'edge-h-bot',
      name: 'Нижний край стены (плинтус/пол)',
      x: 0,
      y: 0,
      width: botEdgeWidth,
      length: wall.width,
      orientation: 'HORIZONTAL',
      isLED: botEdgeConfig?.isLED ?? false,
      isOuterEdge: true,
    });

    rawJoints.push({
      id: 'edge-h-top',
      name: 'Верхний край стены (потолок)',
      x: 0,
      y: wall.height - topEdgeWidth,
      width: topEdgeWidth,
      length: wall.width,
      orientation: 'HORIZONTAL',
      isLED: topEdgeConfig?.isLED ?? false,
      isOuterEdge: true,
    });

    // 6. Слияние объединенных коллинеарных швов (groupId) в единые непрерывные линии
    const finalJoints: CalculatedJointLine[] = [];
    const groupedJoints = new Map<string, CalculatedJointLine[]>();
    const unmergedJoints: CalculatedJointLine[] = [];

    rawJoints.forEach((joint) => {
      const baseId = joint.id.split('-part-')[0];
      const customConfig = wall.customJoints[joint.id] || wall.customJoints[baseId];

      if (customConfig?.groupId) {
        const list = groupedJoints.get(customConfig.groupId) || [];
        list.push(joint);
        groupedJoints.set(customConfig.groupId, list);
      } else {
        unmergedJoints.push(joint);
      }
    });

    groupedJoints.forEach((jointsInGroup, groupId) => {
      if (jointsInGroup.length === 0) return;
      const first = jointsInGroup[0];
      const isHoriz = first.orientation === 'HORIZONTAL';

      if (isHoriz) {
        const minX = Math.min(...jointsInGroup.map((j) => j.x));
        const maxX = Math.max(...jointsInGroup.map((j) => j.x + j.length));

        let intervals: Interval1D[] = [{ start: minX, end: maxX }];
        wall.openings.forEach((op) => {
          if (op.isCutout !== false && first.y > op.y + 2 && first.y < op.y + op.height - 2) {
            intervals = subtractInterval(intervals, op.x, op.x + op.width);
          }
        });

        intervals.forEach((inv, idx) => {
          const len = inv.end - inv.start;
          if (len > 2) {
            finalJoints.push({
              id: idx === 0 ? jointsInGroup[0].id : `${jointsInGroup[0].id}-merged-${idx}`,
              name: `Горизонтальный стык (${Math.round(len)} мм)`,
              x: inv.start,
              y: first.y,
              width: first.width,
              length: len,
              orientation: 'HORIZONTAL',
              isLED: first.isLED,
              isOuterEdge: false,
              groupId,
            });
          }
        });
      } else {
        const minY = Math.min(...jointsInGroup.map((j) => j.y));
        const maxY = Math.max(...jointsInGroup.map((j) => j.y + j.length));

        let intervals: Interval1D[] = [{ start: minY, end: maxY }];
        wall.openings.forEach((op) => {
          if (op.isCutout !== false && first.x > op.x + 2 && first.x < op.x + op.width - 2) {
            intervals = subtractInterval(intervals, op.y, op.y + op.height);
          }
        });

        intervals.forEach((inv, idx) => {
          const len = inv.end - inv.start;
          if (len > 2) {
            finalJoints.push({
              id: idx === 0 ? jointsInGroup[0].id : `${jointsInGroup[0].id}-merged-${idx}`,
              name: `Вертикальный стык (${Math.round(len)} мм)`,
              x: first.x,
              y: inv.start,
              width: first.width,
              length: len,
              orientation: 'VERTICAL',
              isLED: first.isLED,
              isOuterEdge: false,
              groupId,
            });
          }
        });
      }
    });

    finalJoints.push(...unmergedJoints);

    // Расчет площадей и расхода
    const wallAreaSqM = (wall.width * wall.height) / 1_000_000;
    const cutoutOpenings = wall.openings.filter((op) => op.isCutout !== false);
    const cutoutsAreaSqM = cutoutOpenings.reduce(
      (acc, op) => acc + (op.width * op.height) / 1_000_000,
      0
    );

    const coveredPanels = panels.filter((p) => !p.isVoid);
    const grossCoveredAreaSqM = coveredPanels.reduce(
      (acc, p) => acc + (p.width * p.height) / 1_000_000,
      0
    );

    // Вычисляем площадь пересечения вырезов (дверей/окон) с панелями материала
    let cutoutsInCoveredAreaSqM = 0;
    coveredPanels.forEach((p) => {
      cutoutOpenings.forEach((op) => {
        const interMinX = Math.max(p.x, op.x);
        const interMaxX = Math.min(p.x + p.width, op.x + op.width);
        const interMinY = Math.max(p.y, op.y);
        const interMaxY = Math.min(p.y + p.height, op.y + op.height);

        if (interMaxX > interMinX && interMaxY > interMinY) {
          cutoutsInCoveredAreaSqM +=
            ((interMaxX - interMinX) * (interMaxY - interMinY)) / 1_000_000;
        }
      });
    });

    const netCoveredAreaSqM = Math.max(0, grossCoveredAreaSqM - cutoutsInCoveredAreaSqM);

    const voidPanels = panels.filter((p) => p.isVoid);
    const voidAreaSqM = voidPanels.reduce(
      (acc, p) => acc + (p.width * p.height) / 1_000_000,
      0
    );

    const profileLinearMeters = finalJoints
      .filter((j) => j.width > 0 || j.isLED)
      .reduce((acc, j) => acc + j.length / 1000, 0);

    return {
      panels,
      joints: finalJoints,
      summary: {
        totalPanelsNeeded: coveredPanels.length,
        profileLinearMeters: Math.round(profileLinearMeters * 10) / 10,
        wallAreaSqM: Math.round(wallAreaSqM * 100) / 100,
        grossCoveredAreaSqM: Math.round(grossCoveredAreaSqM * 100) / 100,
        coveredAreaSqM: Math.round(netCoveredAreaSqM * 100) / 100,
        voidAreaSqM: Math.round(voidAreaSqM * 100) / 100,
        cutoutsAreaSqM: Math.round(cutoutsAreaSqM * 100) / 100,
      },
    };
  }
}


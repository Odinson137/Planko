import { Wall, RadiusConfig, PanelBendInfo } from '../models/Wall';
import { Material, DEFAULT_MATERIALS, MATERIAL_NONE_ID } from '../models/Material';
import { ensureOpeningSlopes } from '../models/Opening';
import { Point2D, PolygonSlicingEngine } from '../geometry/PolygonSlicingEngine';

export interface CalculatedSlopePiece {
  id: string;
  openingId: string;
  openingName: string;
  side: 'TOP' | 'BOTTOM' | 'LEFT' | 'RIGHT';
  sideLabel: string;
  width: number;
  depth: number;
  areaSqM: number;
  materialId: string;
  materialName: string;
  materialColor: string;
  partLabel: string;
}

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
  decorCode?: string;
  decorName?: string;
  thickness?: number;
  reliefType?: string;
  textureCategory?: string;
  partLabel: string;  // метка '1.1', '1.2' или 'ПУСТО'
  radiusConfig?: RadiusConfig; // обратная совместимость
  arcLength?: number;          // длина развертки дуги в мм
  bendsInfo?: PanelBendInfo[]; // информация обо всех сгибах, попадающих на этот лист
  polygonPoints?: Point2D[];   // абсолютные координаты вершин на стене в мм (если полигон)
  patternAngleDeg?: number;    // угол поворота рисунка (0, 45, 90)
  patternFlipX?: boolean;      // зеркалирование рисунка
  subPieceId?: string;         // ID под-фрагмента
  areaSqM?: number;            // площадь куска в кв.м
}

export interface CalculatedJointLine {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;      // толщина шва на чертеже в мм
  length: number;     // длина линии шва в мм
  orientation: 'VERTICAL' | 'HORIZONTAL' | 'DIAGONAL';
  p1?: Point2D;
  p2?: Point2D;
  isLED: boolean;     // true если включена светодиодная подсветка
  isOuterEdge: boolean; // true если это внешний край стены
  columnIndex?: number;
  segmentIndex?: number;
  groupId?: string;
}

export interface LayoutCalculationResult {
  panels: CalculatedPanelPiece[];
  joints: CalculatedJointLine[];
  slopes?: CalculatedSlopePiece[];
  summary: {
    totalPanelsNeeded: number;
    profileLinearMeters: number;
    slopeProfileLinearMeters?: number;
    wallAreaSqM: number;
    grossCoveredAreaSqM: number;
    coveredAreaSqM: number;
    slopeAreaSqM?: number;
    totalCoveredWithSlopesSqM?: number;
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

    let currentX = leftEdgeWidth;
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

      let baseWidth = columnMaterial.isVoid ? (maxX - currentX) : columnMaterial.width;
      let arcLength: number | undefined = undefined;

      if (customConfig?.radiusConfig) {
        const rad = customConfig.radiusConfig.radius;
        const angle = customConfig.radiusConfig.angleDeg ?? 90;
        arcLength = Math.round((Math.PI * rad * angle) / 180);
        baseWidth = columnMaterial.isVoid ? arcLength : Math.min(arcLength, columnMaterial.width);
      } else if (customConfig?.customWidth !== undefined) {
        // Для пустоты (isVoid) нет ограничений по максимальной ширине материала
        baseWidth = columnMaterial.isVoid
          ? customConfig.customWidth
          : Math.min(customConfig.customWidth, columnMaterial.width);
      }

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
        const maxAllowedH = isVoid ? (maxY - currentY) : segMaterial.height;
        const rawHeight = segConfig?.height !== undefined
          ? Math.min(segConfig.height, maxAllowedH, maxY - currentY)
          : Math.min(maxAllowedH, maxY - currentY);
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

        const pLeft = Math.round(currentX * 10) / 10;
        const pRight = Math.round((currentX + panelWidth) * 10) / 10;
        const panelBendsInfo: PanelBendInfo[] = [];

        if (wall.bends && wall.bends.length > 0) {
          wall.bends.forEach((bend) => {
            const bendArcLen = Math.round((Math.PI * bend.radius * (bend.angleDeg || 90)) / 180);
            const bendLeft = bend.x;
            const bendRight = bend.x + bendArcLen;

            if (bend.radius <= 0 || bendArcLen <= 0) {
              if (bend.x >= pLeft - 0.5 && bend.x <= pRight + 0.5) {
                const flatLeft = Math.max(0, bend.x - pLeft);
                const flatRight = Math.max(0, pRight - bend.x);
                panelBendsInfo.push({
                  bendId: bend.id,
                  type: bend.type,
                  radius: 0,
                  angleDeg: bend.angleDeg || 90,
                  flatLeft: Math.round(flatLeft * 10) / 10,
                  bendWidth: 0,
                  flatRight: Math.round(flatRight * 10) / 10,
                  bendOffsetInSheet: Math.round(flatLeft * 10) / 10,
                });
              }
            } else {
              // Проверка пересечения отрезка панели [pLeft, pRight] и зоны изгиба [bendLeft, bendRight]
              const overlapStart = Math.max(pLeft, bendLeft);
              const overlapEnd = Math.min(pRight, bendRight);

              if (overlapEnd > overlapStart + 0.5) {
                const flatLeft = Math.max(0, bendLeft - pLeft);
                const bendWidth = overlapEnd - overlapStart;
                const flatRight = Math.max(0, pRight - bendRight);
                const bendOffsetInSheet = Math.max(0, bendLeft - pLeft);

                panelBendsInfo.push({
                  bendId: bend.id,
                  type: bend.type,
                  radius: bend.radius,
                  angleDeg: bend.angleDeg || 90,
                  flatLeft: Math.round(flatLeft * 10) / 10,
                  bendWidth: Math.round(bendWidth * 10) / 10,
                  flatRight: Math.round(flatRight * 10) / 10,
                  bendOffsetInSheet: Math.round(bendOffsetInSheet * 10) / 10,
                });
              }
            }
          });
        }

        // Обратная совместимость с кастомным радиусом колонки
        if (panelBendsInfo.length === 0 && customConfig?.radiusConfig) {
          panelBendsInfo.push({
            bendId: `legacy-col-${columnIndex}`,
            type: customConfig.radiusConfig.type,
            radius: customConfig.radiusConfig.radius,
            angleDeg: customConfig.radiusConfig.angleDeg || 90,
            flatLeft: 0,
            bendWidth: panelWidth,
            flatRight: 0,
            bendOffsetInSheet: 0,
          });
        }

        let bendLabelStr = '';
        if (panelBendsInfo.length > 0) {
          const b = panelBendsInfo[0];
          const typeStr = b.type === 'INNER_CORNER' ? 'ВНУТР' : 'ВНЕШН';
          if (b.radius === 0) {
            bendLabelStr = ` 📐 ${typeStr} ${b.angleDeg || 90}°`;
          } else if (b.flatLeft > 10 || b.flatRight > 10) {
            bendLabelStr = ` ⌒ ${typeStr} (${Math.round(b.flatLeft)}|${Math.round(b.bendWidth)}|${Math.round(b.flatRight)})`;
          } else {
            bendLabelStr = ` ⌒ ${typeStr} R=${b.radius}`;
          }
        }

        const defaultLabel = isVoid
          ? 'ПУСТО'
          : segConfig?.partLabel ||
            (segmentsConfig.length > 1
              ? `1.${columnIndex + 1}.${segmentIndex + 1}${bendLabelStr}`
              : `1.${columnIndex + 1}${bendLabelStr}`);

        const effectiveSubPieces = segConfig?.subPieces || (segmentsConfig.length === 0 ? customConfig?.subPieces : undefined);
        const hasSubPieces = effectiveSubPieces && effectiveSubPieces.length > 0;

        if (hasSubPieces) {
          effectiveSubPieces.forEach((sub, subIdx) => {
            const subMat = (sub.materialId && materialsMap.get(sub.materialId)) || segMaterial;
            const isSubVoid = sub.isVoid || subMat.id === MATERIAL_NONE_ID || subMat.isVoid === true;

            const polyPoints: Point2D[] = sub.points.map((pt) => ({
              x: Math.round((currentX + pt.x) * 10) / 10,
              y: Math.round((currentY + pt.y) * 10) / 10,
            }));

            const xs = polyPoints.map((p) => p.x);
            const ys = polyPoints.map((p) => p.y);
            const minX = Math.min(...xs);
            const maxXPt = Math.max(...xs);
            const minY = Math.min(...ys);
            const maxYPt = Math.max(...ys);
            const pieceW = Math.round((maxXPt - minX) * 10) / 10;
            const pieceH = Math.round((maxYPt - minY) * 10) / 10;

            const areaSqM = Math.round((PolygonSlicingEngine.calculatePolygonArea(polyPoints) / 1_000_000) * 1000) / 1000;
            const subLabel = isSubVoid
              ? 'ПУСТО'
              : (sub.partLabel || `${columnIndex + 1}.${segmentIndex + 1}.${subIdx + 1}`);

            panels.push({
              id: `panel-${columnIndex}-${segmentIndex}-${sub.id}`,
              subPieceId: sub.id,
              x: minX,
              y: minY,
              width: pieceW,
              height: pieceH,
              isCut: true,
              isVoid: isSubVoid,
              originalColumnIndex: columnIndex,
              originalSegmentIndex: segmentIndex,
              materialId: subMat.id,
              materialColor: isSubVoid
                ? 'rgba(30, 31, 35, 0.45)'
                : (sub.color || subMat.color),
              materialType: subMat.type,
              decorCode: sub.decorCode || subMat.decorCode,
              thickness: isSubVoid ? 0 : (sub.thickness || subMat.thickness),
              reliefType: sub.reliefType || subMat.reliefType || 'FLAT',
              textureCategory: sub.textureCategory || subMat.textureCategory || 'WOOD',
              partLabel: subLabel,
              polygonPoints: polyPoints,
              patternAngleDeg: sub.patternAngleDeg !== undefined ? sub.patternAngleDeg : (segConfig?.patternAngleDeg || customConfig?.patternAngleDeg || 0),
              patternFlipX: sub.patternFlipX !== undefined ? sub.patternFlipX : (segConfig?.patternFlipX || customConfig?.patternFlipX || false),
              areaSqM,
            });
          });

          // Генерация интерактивных стыков раскроя между соседними полигонами
          for (let i = 0; i < effectiveSubPieces.length; i++) {
            for (let j = i + 1; j < effectiveSubPieces.length; j++) {
              const subA = effectiveSubPieces[i];
              const subB = effectiveSubPieces[j];

              const ptsA = subA.points;
              const ptsB = subB.points;
              const nA = ptsA.length;
              const nB = ptsB.length;

              for (let a = 0; a < nA; a++) {
                const a1 = ptsA[a];
                const a2 = ptsA[(a + 1) % nA];
                for (let b = 0; b < nB; b++) {
                  const b1 = ptsB[b];
                  const b2 = ptsB[(b + 1) % nB];

                  const d1 = Math.hypot(a1.x - b2.x, a1.y - b2.y) + Math.hypot(a2.x - b1.x, a2.y - b1.y);
                  const d2 = Math.hypot(a1.x - b1.x, a1.y - b1.y) + Math.hypot(a2.x - b2.x, a2.y - b2.y);
                  if (d1 < 1.5 || d2 < 1.5) {
                    const worldP1: Point2D = {
                      x: Math.round((currentX + a1.x) * 10) / 10,
                      y: Math.round((currentY + a1.y) * 10) / 10,
                    };
                    const worldP2: Point2D = {
                      x: Math.round((currentX + a2.x) * 10) / 10,
                      y: Math.round((currentY + a2.y) * 10) / 10,
                    };

                    const edgeLen = Math.round(Math.hypot(worldP2.x - worldP1.x, worldP2.y - worldP1.y) * 10) / 10;
                    if (edgeLen > 5) {
                      const cutJointId = `edge-cut-${columnIndex}-${segmentIndex}-${subA.id}-${subB.id}`;
                      const customJointCfg = wall.customJoints[cutJointId];
                      const isCutLED = customJointCfg?.isLED ?? false;
                      const jWidth = customJointCfg?.width ?? 8;

                      const isPureVert = Math.abs(worldP1.x - worldP2.x) < 0.5;
                      const isPureHoriz = Math.abs(worldP1.y - worldP2.y) < 0.5;

                      rawJoints.push({
                        id: cutJointId,
                        name: `Стык раскроя (${subA.partLabel || 'A'} / ${subB.partLabel || 'B'})`,
                        x: Math.min(worldP1.x, worldP2.x),
                        y: Math.min(worldP1.y, worldP2.y),
                        width: jWidth,
                        length: edgeLen,
                        orientation: isPureVert ? 'VERTICAL' : (isPureHoriz ? 'HORIZONTAL' : 'DIAGONAL'),
                        p1: worldP1,
                        p2: worldP2,
                        isLED: isCutLED,
                        isOuterEdge: false,
                        columnIndex,
                        segmentIndex,
                      });
                    }
                  }
                }
              }
            }
          }
        } else {
          const patternAngle = segConfig?.patternAngleDeg || customConfig?.patternAngleDeg || 0;
          const patternFlip = segConfig?.patternFlipX || customConfig?.patternFlipX || false;

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
            materialColor: isVoid
              ? 'rgba(30, 31, 35, 0.45)'
              : (segConfig?.customColor || customConfig?.customColor || segMaterial.color),
            materialType: segMaterial.type,
            decorCode: segConfig?.customDecorCode || customConfig?.customDecorCode || segMaterial.decorCode,
            decorName: segMaterial.decorName,
            thickness: isVoid ? 0 : (segConfig?.customThickness || customConfig?.customThickness || segMaterial.thickness),
            reliefType: segConfig?.customReliefType || customConfig?.customReliefType || segMaterial.reliefType || 'FLAT',
            textureCategory: segConfig?.customTextureCategory || customConfig?.customTextureCategory || segMaterial.textureCategory || 'FABRIC',
            partLabel: defaultLabel,
            radiusConfig: customConfig?.radiusConfig || (panelBendsInfo[0] ? { type: panelBendsInfo[0].type, radius: panelBendsInfo[0].radius, angleDeg: panelBendsInfo[0].angleDeg } : undefined),
            arcLength: arcLength ? Math.round(arcLength * 10) / 10 : undefined,
            bendsInfo: panelBendsInfo.length > 0 ? panelBendsInfo : undefined,
            patternAngleDeg: patternAngle,
            patternFlipX: patternFlip,
            areaSqM: Math.round(((panelWidth * segmentHeight) / 1_000_000) * 1000) / 1000,
          });
        }

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

    let profileLinearMeters = finalJoints
      .filter((j) => j.width > 0 || j.isLED)
      .reduce((acc, j) => acc + j.length / 1000, 0);

    // =========================================================================
    // Расчет параметров и деталей откосов
    // =========================================================================
    const slopePieces: CalculatedSlopePiece[] = [];
    let slopeProfileLinearMeters = 0;

    cutoutOpenings.forEach((op, opIdx) => {
      const slopes = ensureOpeningSlopes(op);
      if (!slopes.enabled) return;

      const opDepth = op.depth ?? (op.type === 'DOOR' ? 150 : op.type === 'WINDOW' ? 200 : op.type === 'NICHE' ? 150 : 150);

      const getSideDepth = (sideDepthConfig: number) => {
        if (slopes.fitToOpeningDepth) return opDepth;
        return slopes.depthMode === 'SAME' ? slopes.depth : sideDepthConfig;
      };

      const getSideMat = (sideMatId?: string | null) => {
        const targetId =
          slopes.materialMode === 'SAME'
            ? slopes.materialId || wall.zone.materialId
            : sideMatId || slopes.materialId || wall.zone.materialId;
        const found = allMaterials.find((m) => m.id === targetId) || defaultMaterial;
        return found;
      };

      // 1. Верхний откос
      if (slopes.top.enabled) {
        const d = getSideDepth(slopes.top.depth);
        if (d > 0) {
          const mat = getSideMat(slopes.top.materialId);
          slopePieces.push({
            id: `slope-${op.id}-top`,
            openingId: op.id,
            openingName: op.name || `Проем ${opIdx + 1}`,
            side: 'TOP',
            sideLabel: 'Верхний откос',
            width: op.width,
            depth: d,
            areaSqM: (op.width * d) / 1_000_000,
            materialId: mat.id,
            materialName: mat.name,
            materialColor: mat.color,
            partLabel: `ОТК-В.${opIdx + 1}`,
          });
        }
      }

      // 2. Нижний откос / Подоконник
      if (slopes.bottom.enabled) {
        const d = getSideDepth(slopes.bottom.depth);
        if (d > 0) {
          const mat = getSideMat(slopes.bottom.materialId);
          slopePieces.push({
            id: `slope-${op.id}-bottom`,
            openingId: op.id,
            openingName: op.name || `Проем ${opIdx + 1}`,
            side: 'BOTTOM',
            sideLabel: op.type === 'WINDOW' ? 'Подоконник' : 'Нижний откос',
            width: op.width,
            depth: d,
            areaSqM: (op.width * d) / 1_000_000,
            materialId: mat.id,
            materialName: mat.name,
            materialColor: mat.color,
            partLabel: `ОТК-Н.${opIdx + 1}`,
          });
        }
      }

      // 3. Левый откос
      if (slopes.left.enabled) {
        const d = getSideDepth(slopes.left.depth);
        if (d > 0) {
          const mat = getSideMat(slopes.left.materialId);
          slopePieces.push({
            id: `slope-${op.id}-left`,
            openingId: op.id,
            openingName: op.name || `Проем ${opIdx + 1}`,
            side: 'LEFT',
            sideLabel: 'Левый откос',
            width: op.height,
            depth: d,
            areaSqM: (op.height * d) / 1_000_000,
            materialId: mat.id,
            materialName: mat.name,
            materialColor: mat.color,
            partLabel: `ОТК-Л.${opIdx + 1}`,
          });
        }
      }

      // 4. Правый откос
      if (slopes.right.enabled) {
        const d = getSideDepth(slopes.right.depth);
        if (d > 0) {
          const mat = getSideMat(slopes.right.materialId);
          slopePieces.push({
            id: `slope-${op.id}-right`,
            openingId: op.id,
            openingName: op.name || `Проем ${opIdx + 1}`,
            side: 'RIGHT',
            sideLabel: 'Правый откос',
            width: op.height,
            depth: d,
            areaSqM: (op.height * d) / 1_000_000,
            materialId: mat.id,
            materialName: mat.name,
            materialColor: mat.color,
            partLabel: `ОТК-П.${opIdx + 1}`,
          });
        }
      }

      // Расчет погонажа профиля между откосами (внутренние углы коробки)
      if (slopes.jointProfileType && slopes.jointProfileType !== 'NONE') {
        const topD = getSideDepth(slopes.top.depth);
        const bottomD = getSideDepth(slopes.bottom.depth);
        const leftD = getSideDepth(slopes.left.depth);
        const rightD = getSideDepth(slopes.right.depth);

        // Внутренние углы:
        if (slopes.top.enabled && slopes.left.enabled) slopeProfileLinearMeters += Math.max(topD, leftD) / 1000;
        if (slopes.top.enabled && slopes.right.enabled) slopeProfileLinearMeters += Math.max(topD, rightD) / 1000;
        if (slopes.bottom.enabled && slopes.left.enabled) slopeProfileLinearMeters += Math.max(bottomD, leftD) / 1000;
        if (slopes.bottom.enabled && slopes.right.enabled) slopeProfileLinearMeters += Math.max(bottomD, rightD) / 1000;
      }
    });

    const totalSlopeAreaSqM = slopePieces.reduce((acc, p) => acc + p.areaSqM, 0);

    return {
      panels,
      joints: finalJoints,
      slopes: slopePieces,
      summary: {
        totalPanelsNeeded: coveredPanels.length,
        profileLinearMeters: Math.round((profileLinearMeters + slopeProfileLinearMeters) * 10) / 10,
        slopeProfileLinearMeters: Math.round(slopeProfileLinearMeters * 10) / 10,
        wallAreaSqM: Math.round(wallAreaSqM * 100) / 100,
        grossCoveredAreaSqM: Math.round(grossCoveredAreaSqM * 100) / 100,
        coveredAreaSqM: Math.round(netCoveredAreaSqM * 100) / 100,
        slopeAreaSqM: Math.round(totalSlopeAreaSqM * 100) / 100,
        totalCoveredWithSlopesSqM: Math.round((netCoveredAreaSqM + totalSlopeAreaSqM) * 100) / 100,
        voidAreaSqM: Math.round(voidAreaSqM * 100) / 100,
        cutoutsAreaSqM: Math.round(cutoutsAreaSqM * 100) / 100,
      },
    };
  }
}


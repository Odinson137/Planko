import { getPanelEdges } from '../geometry/PanelEdges';
import type { TextureMapping } from '../textures/TextureMapping';
import { findProfileByArticle } from '../models/Profile';
import { Wall, RadiusConfig, PanelBendInfo, WallPanelPiece, WallJointLine } from '../models/Wall';
import { Material, DEFAULT_MATERIALS, MATERIAL_NONE_ID } from '../models/Material';
import { Opening, ensureOpeningSlopes } from '../models/Opening';
import { calculateSlopeGeometry, slopeJointHasProfile, type CalculatedSlopeJoint } from '../geometry/SlopeJointGeometry';
import { Point2D, PolygonSlicingEngine } from '../geometry/PolygonSlicingEngine';
import { comparePanelsLeftToRightTopToBottom, renumberWallPanels } from './WallNumberingEngine';

export interface CalculatedSlopePiece {
  startInset?: number;
  endInset?: number;
  zStart?: number;
  zEnd?: number;
  textureMapping?: TextureMapping;
  textureCategory?: string;
  textureStockWidth?: number;
  textureStockHeight?: number;
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
  decorCode?: string;
  thickness?: number;
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
  textureMapping?: TextureMapping;
  textureStockWidth?: number;
  textureStockHeight?: number;
  patternAngleDeg?: number;    // угол поворота рисунка (0, 45, 90)
  patternFlipX?: boolean;      // зеркалирование рисунка
  subPieceId?: string;         // ID под-фрагмента
  areaSqM?: number;            // площадь куска в кв.м
  note?: string;               // комментарий к детали
}

export interface CalculatedJointLine {
  id: string;
  panelEdge?: { panelId: string; edge: import('../models/Wall').PanelEdgeSide | number };
  sourceJointId?: string; // Editable source of a visible fragment clipped by an opening.
  name: string;
  x: number;
  y: number;
  width: number;      // монтажный зазор в мм (не толщина металла)
  visibleWidth?: number; // ширина лицевой планки для отрисовки
  metalThickness?: number;
  length: number;     // длина линии шва в мм
  orientation: 'VERTICAL' | 'HORIZONTAL' | 'DIAGONAL';
  p1?: Point2D;
  p2?: Point2D;
  isLED: boolean;     // true если включена светодиодная подсветка
  isOuterEdge: boolean; // true если это внешний край стены
  profileArticle?: string; // Артикул AllWall профиля (DL-13, MC-06 и др.)
  profileColor?: string;   // HEX цвет профиля
  columnIndex?: number;
  segmentIndex?: number;
  groupId?: string;
  takeSide?: 'BOTH' | 'LEFT' | 'RIGHT' | 'TOP' | 'BOTTOM';
}

export interface LayoutCalculationResult {
  panels: CalculatedPanelPiece[];
  joints: CalculatedJointLine[];
  slopes?: CalculatedSlopePiece[];
  slopeJoints?: CalculatedSlopeJoint[];
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

// Return the distances along the segment that lie strictly inside the opening.
// Distances are in mm so subtractInterval uses the same tolerance for all orientations.
function segmentOpeningInterval(p1: Point2D, p2: Point2D, opening: Opening): Interval1D | null {
  if (opening.width <= 0 || opening.height <= 0) return null;
  const length = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  if (length < 1e-6) return null;
  let start = 0;
  let end = length;
  for (const [origin, direction, min, max] of [
    [p1.x, (p2.x - p1.x) / length, opening.x, opening.x + opening.width],
    [p1.y, (p2.y - p1.y) / length, opening.y, opening.y + opening.height],
  ]) {
    if (Math.abs(direction) < 1e-9) {
      if (origin <= min || origin >= max) return null;
      continue;
    }
    const a = (min - origin) / direction;
    const b = (max - origin) / direction;
    start = Math.max(start, Math.min(a, b));
    end = Math.min(end, Math.max(a, b));
    if (end - start <= 1e-6) return null; // A tangent touch must not remove material.
  }
  return { start, end };
}

/**
 * Проверяет, закрывает ли полигон pts вертикальный шов jointX, и вычитает участки перекрытия.
 * Шов считается перекрытым только если полигон сплошной поперек шва (точки слева и справа лежат внутри полигона).
 */
function subtractPolygonCoverageFromVerticalSeam(
  intervals: Interval1D[],
  jointX: number,
  pts: Point2D[]
): Interval1D[] {
  if (!pts || pts.length < 3 || intervals.length === 0) return intervals;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  if (minX >= jointX - 1.5 || maxX <= jointX + 1.5) {
    return intervals; // Полигон целиком слева или справа от шва
  }

  const yIntersections: number[] = [Math.min(...ys), Math.max(...ys)];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    if ((p1.x <= jointX && p2.x >= jointX) || (p1.x >= jointX && p2.x <= jointX)) {
      if (Math.abs(p2.x - p1.x) > 1e-4) {
        const t = (jointX - p1.x) / (p2.x - p1.x);
        const y = p1.y + t * (p2.y - p1.y);
        yIntersections.push(y);
      } else {
        yIntersections.push(p1.y, p2.y);
      }
    }
  }

  const sortedY = Array.from(new Set(yIntersections.map((y) => Math.round(y * 10) / 10))).sort((a, b) => a - b);
  let result = intervals;

  for (let i = 0; i < sortedY.length - 1; i++) {
    const y1 = sortedY[i];
    const y2 = sortedY[i + 1];
    if (y2 - y1 <= 1) continue;
    const yMid = (y1 + y2) / 2;

    if (
      PolygonSlicingEngine.isPointInPolygon({ x: jointX - 2, y: yMid }, pts) &&
      PolygonSlicingEngine.isPointInPolygon({ x: jointX + 2, y: yMid }, pts)
    ) {
      result = subtractInterval(result, y1, y2);
    }
  }

  return result;
}

/**
 * Проверяет, закрывает ли полигон pts горизонтальный шов jointY, и вычитает участки перекрытия.
 */
function subtractPolygonCoverageFromHorizontalSeam(
  intervals: Interval1D[],
  jointY: number,
  pts: Point2D[]
): Interval1D[] {
  if (!pts || pts.length < 3 || intervals.length === 0) return intervals;
  const ys = pts.map((p) => p.y);
  const xs = pts.map((p) => p.x);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  if (minY >= jointY - 1.5 || maxY <= jointY + 1.5) {
    return intervals; // Полигон целиком снизу или сверху от шва
  }

  const xIntersections: number[] = [Math.min(...xs), Math.max(...xs)];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    if ((p1.y <= jointY && p2.y >= jointY) || (p1.y >= jointY && p2.y <= jointY)) {
      if (Math.abs(p2.y - p1.y) > 1e-4) {
        const t = (jointY - p1.y) / (p2.y - p1.y);
        const x = p1.x + t * (p2.x - p1.x);
        xIntersections.push(x);
      } else {
        xIntersections.push(p1.x, p2.x);
      }
    }
  }

  const sortedX = Array.from(new Set(xIntersections.map((x) => Math.round(x * 10) / 10))).sort((a, b) => a - b);
  let result = intervals;

  for (let i = 0; i < sortedX.length - 1; i++) {
    const x1 = sortedX[i];
    const x2 = sortedX[i + 1];
    if (x2 - x1 <= 1) continue;
    const xMid = (x1 + x2) / 2;

    if (
      PolygonSlicingEngine.isPointInPolygon({ x: xMid, y: jointY - 2 }, pts) &&
      PolygonSlicingEngine.isPointInPolygon({ x: xMid, y: jointY + 2 }, pts)
    ) {
      result = subtractInterval(result, x1, x2);
    }
  }

  return result;
}

export class LayoutEngine {
  public static calculateWallLayout(
    wall: Wall,
    defaultMaterial: Material,
    allMaterials: Material[] = DEFAULT_MATERIALS,
    wallIndexOrNumber: number = 1
  ): LayoutCalculationResult {
    let panels: CalculatedPanelPiece[] = [];
    const rawJoints: CalculatedJointLine[] = [];

    const wallNumber = wallIndexOrNumber >= 1 ? Math.floor(wallIndexOrNumber) : 1;
    const renumberedWall = renumberWallPanels(wall, wallNumber);

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

    let columnIndex = 0;

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

    if (renumberedWall.panels && renumberedWall.panels.length > 0) {
      // 2. ПРЯМАЯ ПОЛИГОНАЛЬНАЯ МОДЕЛЬ (Pure 2D Polygon Mesh)
      renumberedWall.panels.forEach((p, pIdx) => {
        let points = p.points;
        if (!points || points.length < 3) {
          // Если координаты отсутствуют, строим прямоугольник с учетом внешних отступов
          points = [
            { x: leftEdgeWidth, y: botEdgeWidth },
            { x: wall.width - rightEdgeWidth, y: botEdgeWidth },
            { x: wall.width - rightEdgeWidth, y: wall.height - topEdgeWidth },
            { x: leftEdgeWidth, y: wall.height - topEdgeWidth },
          ];
        } else {
          // Для всех деталей гарантируем, что координаты вершин не вылезают за пределы стены
          points = points.map((pt) => ({
            x: Math.max(0, Math.min(wall.width, pt.x)),
            y: Math.max(0, Math.min(wall.height, pt.y)),
          }));
        }

        const mat = (p.materialId && materialsMap.get(p.materialId)) || defaultMaterial;
        const isVoid = p.isVoid || mat.id === MATERIAL_NONE_ID || mat.isVoid === true;

        // Применяем торцевые зазоры детали (Edge Insets)
        const cleanPoints = PolygonSlicingEngine.applyPanelEdgesInsets(points, p.edges);
        if (cleanPoints.length < 3) return;

        const xs = cleanPoints.map((pt) => pt.x);
        const ys = cleanPoints.map((pt) => pt.y);
        const minX = Math.min(...xs);
        const maxXPt = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxYPt = Math.max(...ys);
        const pieceW = Math.round((maxXPt - minX) * 10) / 10;
        const pieceH = Math.round((maxYPt - minY) * 10) / 10;
        const areaSqM = Math.round((PolygonSlicingEngine.calculatePolygonArea(cleanPoints) / 1_000_000) * 1000) / 1000;

        const defaultLabel = isVoid ? 'ПУСТО' : (p.partLabel || `${wallNumber}.${pIdx + 1}`);

        panels.push({
          id: p.id,
          subPieceId: p.id,
          x: minX,
          y: minY,
          width: pieceW,
          height: pieceH,
          isCut: true,
          isVoid,
          originalColumnIndex: 0,
          originalSegmentIndex: pIdx,
          materialId: mat.id,
          materialColor: isVoid ? 'rgba(30, 31, 35, 0.45)' : (p.color || mat.color),
          materialType: mat.type,
          decorCode: p.decorCode || mat.decorCode,
          decorName: p.decorName || mat.decorName,
          thickness: isVoid ? 0 : (p.thickness || mat.thickness || 5),
          reliefType: p.reliefType || mat.reliefType || 'FLAT',
          textureCategory: p.textureCategory || mat.textureCategory || 'WOOD',
          partLabel: defaultLabel,
          polygonPoints: cleanPoints,
          radiusConfig: p.radiusConfig,
          arcLength: p.radiusConfig
            ? Math.round(Math.PI * p.radiusConfig.radius * (p.radiusConfig.angleDeg ?? 90) / 180)
            : undefined,
          textureMapping: p.textureMapping,
          patternAngleDeg: p.patternAngleDeg ?? 0,
          patternFlipX: p.patternFlipX || false,
          areaSqM,
          note: p.note,
        });

        // Profiles follow the actual polygon boundary, including inclined edges.
        getPanelEdges(points, p.edges).forEach(edge => {
          const config = edge.config;
          if (!config || !(config.width > 0 || config.profileArticle || config.isLED)) return;
          const orientation = Math.abs(edge.p1.x - edge.p2.x) < 1e-5 ? 'VERTICAL'
            : Math.abs(edge.p1.y - edge.p2.y) < 1e-5 ? 'HORIZONTAL' : 'DIAGONAL';
          rawJoints.push({
            id: `edge-${p.id}-${edge.key}`,
            panelEdge: { panelId: p.id, edge: edge.key },
            name: `${edge.label} (${p.partLabel || defaultLabel})`,
            x: Math.min(edge.p1.x, edge.p2.x), y: Math.min(edge.p1.y, edge.p2.y),
            p1: edge.p1, p2: edge.p2, width: config.width, length: edge.length,
            orientation, isLED: config.isLED ?? false, isOuterEdge: false,
            profileArticle: config.profileArticle, profileColor: config.profileColor,
            takeSide: edge.side === 'left' ? 'RIGHT' : edge.side === 'right' ? 'LEFT'
              : edge.side === 'top' ? 'BOTTOM' : edge.side === 'bottom' ? 'TOP' : 'BOTH',
          });
        });
      });

      if (wall.joints && wall.joints.length > 0) {
        wall.joints.forEach((j) => {
          const p1 = {
            x: Math.max(0, Math.min(wall.width, j.p1.x)),
            y: Math.max(0, Math.min(wall.height, j.p1.y)),
          };
          const p2 = {
            x: Math.max(0, Math.min(wall.width, j.p2.x)),
            y: Math.max(0, Math.min(wall.height, j.p2.y)),
          };
          const len = Math.round(Math.hypot(p2.x - p1.x, p2.y - p1.y));
          if (len <= 2) return;

          const isVert = Math.abs(p1.x - p2.x) < 1e-3;
          const isHoriz = Math.abs(p1.y - p2.y) < 1e-3;
          const orientation =
            j.orientation || (isVert ? 'VERTICAL' : isHoriz ? 'HORIZONTAL' : 'DIAGONAL');

          const baseId = j.id.split('-part-')[0].split('-merged-')[0];
          const customConfig = wall.customJoints?.[j.id] || wall.customJoints?.[baseId];
          const effWidth = customConfig !== undefined && customConfig.width !== undefined ? customConfig.width : j.width;
          const effLED = customConfig !== undefined && customConfig.isLED !== undefined ? customConfig.isLED : (j.isLED || false);
          const effArticle = customConfig?.profileArticle !== undefined ? customConfig.profileArticle : j.profileArticle;
          const effColor = customConfig?.profileColor || j.profileColor;
          const effGroupId = customConfig?.groupId || j.groupId;
          const effTakeSide = customConfig?.takeSide || j.takeSide;

          // A zero-gap cut remains selectable so a profile can be assigned later.

          // Исключаем дублирование со швами торцов панелей
          const samePoint = (a: Point2D, b: Point2D) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-5;
          const isDup = rawJoints.some(
            (rj) =>
              rj.p1 &&
              rj.p2 &&
              ((samePoint(rj.p1, p1) && samePoint(rj.p2, p2)) ||
                (samePoint(rj.p1, p2) && samePoint(rj.p2, p1)))
          );
          if (isDup) return;

          const defaultName =
            orientation === 'HORIZONTAL'
              ? `Горизонтальный стык (${len} мм)`
              : orientation === 'VERTICAL'
              ? `Вертикальный стык (${len} мм)`
              : `Диагональный стык (${len} мм)`;

          rawJoints.push({
            id: j.id,
            name: defaultName,
            x: Math.min(p1.x, p2.x),
            y: Math.min(p1.y, p2.y),
            p1,
            p2,
            width: effWidth,
            length: len,
            orientation,
            isLED: effLED,
            isOuterEdge: j.isOuterEdge || false,
            profileArticle: effArticle,
            profileColor: effColor,
            groupId: effGroupId,
            takeSide: effTakeSide,
          });
        });
      }
    } else {
      // 2. Генерация панелей стены (Legacy сетка колонок и сегментов)
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
          baseWidth = columnMaterial.isVoid
            ? (rad > 0 ? arcLength : (customConfig?.customWidth !== undefined ? customConfig.customWidth : columnMaterial.width))
            : (rad > 0 ? Math.min(arcLength, columnMaterial.width) : (customConfig?.customWidth !== undefined ? customConfig.customWidth : columnMaterial.width));
        } else if (customConfig?.customWidth !== undefined) {
          baseWidth = customConfig.customWidth;
        }

        const panelWidth = Math.min(baseWidth, Math.max(0, maxX - currentX));

        if (panelWidth <= 0.5) {
          break;
        }

        const vertJointId = `edge-v-${columnIndex}`;
        const customVertJoint = wall.customJoints?.[vertJointId];
        const isVertInner = currentX + panelWidth < maxX - 1;
        const vertJointWidth = isVertInner
          ? (customVertJoint !== undefined ? customVertJoint.width : 0)
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
            ? (customHorizJoint !== undefined ? customHorizJoint.width : 0)
            : topEdgeWidth;
          const isHorizLED = customHorizJoint?.isLED ?? false;

          horizJointCandidates.push({
            columnIndex,
            segmentIndex,
            horizJointId,
            x: currentX,
            y: currentY + segmentHeight,
            width: horizJointWidth,
            panelWidth,
            horizJointWidth,
            isHorizLED,
            isHorizInner,
          });

          // Подсчет изгибов внутри листа
          const panelLeftOnWall = currentX;
          const panelRightOnWall = currentX + panelWidth;
          const panelBendsInfo: PanelBendInfo[] = [];

          if (wall.bends && wall.bends.length > 0) {
            wall.bends.forEach((bend) => {
              const bendArcLength = Math.round((Math.PI * bend.radius * bend.angleDeg) / 180);
              const bendStart = bend.x;
              const bendEnd = bend.x + bendArcLength;

              if (bendStart < panelRightOnWall && bendEnd > panelLeftOnWall) {
                const overlapStart = Math.max(bendStart, panelLeftOnWall);
                const overlapEnd = Math.min(bendEnd, panelRightOnWall);
                const insideBendWidth = Math.round(overlapEnd - overlapStart);

                const flatLeft = Math.max(0, Math.round(bendStart - panelLeftOnWall));
                const flatRight = Math.max(0, Math.round(panelRightOnWall - bendEnd));
                const bendOffsetInSheet = Math.max(0, Math.round(overlapStart - panelLeftOnWall));

                panelBendsInfo.push({
                  bendId: bend.id,
                  type: bend.type,
                  radius: bend.radius,
                  angleDeg: bend.angleDeg,
                  flatLeft,
                  bendWidth: insideBendWidth,
                  flatRight,
                  bendOffsetInSheet,
                });
              }
            });
          }

          const effectiveSubPieces =
            segConfig?.subPieces && segConfig.subPieces.length > 0
              ? segConfig.subPieces
              : (customConfig?.subPieces && customConfig.subPieces.length > 0 ? customConfig.subPieces : null);

          if (effectiveSubPieces && effectiveSubPieces.length > 0) {
            effectiveSubPieces.forEach((sub, subIdx) => {
              const subMat =
                (sub.materialId && materialsMap.get(sub.materialId)) ||
                segMaterial;
              const isSubVoid = sub.isVoid || subMat.id === MATERIAL_NONE_ID || subMat.isVoid === true;

              const polyPoints: Point2D[] = sub.points.map((p) => ({
                x: currentX + p.x,
                y: currentY + p.y,
              }));

              const xs = polyPoints.map((p) => p.x);
              const ys = polyPoints.map((p) => p.y);
              const minX = Math.min(...xs);
              const maxXPt = Math.max(...xs);
              const minY = Math.min(...ys);
              const maxYPt = Math.max(...ys);
              const subW = Math.round(maxXPt - minX);
              const subH = Math.round(maxYPt - minY);
              const areaSqM = Math.round((PolygonSlicingEngine.calculatePolygonArea(sub.points) / 1_000_000) * 1000) / 1000;

              const subLabel = isSubVoid
                ? 'ПУСТО'
                : (sub.partLabel || (segmentsConfig.length > 1
                    ? `1.${columnIndex + 1}.${segmentIndex + 1}.${subIdx + 1}`
                    : `1.${columnIndex + 1}.${subIdx + 1}`));

              panels.push({
                id: `${columnIndex}-${segmentIndex}-${sub.id}`,
                subPieceId: sub.id,
                x: minX,
                y: minY,
                width: subW,
                height: subH,
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
                textureMapping: sub.textureMapping ?? segConfig?.textureMapping ?? customConfig?.textureMapping,
                patternAngleDeg: sub.patternAngleDeg !== undefined ? sub.patternAngleDeg : (segConfig?.patternAngleDeg || customConfig?.patternAngleDeg || 0),
                patternFlipX: sub.patternFlipX !== undefined ? sub.patternFlipX : (segConfig?.patternFlipX || customConfig?.patternFlipX || false),
                areaSqM,
                note: sub.note || segConfig?.note,
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

                    const dxB = b2.x - b1.x;
                    const dyB = b2.y - b1.y;
                    const lenB = Math.hypot(dxB, dyB);
                    if (lenB < 1e-3) continue;

                    const ux = dxB / lenB;
                    const uy = dyB / lenB;

                    const distA1 = Math.abs((a1.x - b1.x) * uy - (a1.y - b1.y) * ux);
                    const distA2 = Math.abs((a2.x - b1.x) * uy - (a2.y - b1.y) * ux);

                    if (distA1 <= 2.5 && distA2 <= 2.5) {
                      const tA1 = (a1.x - b1.x) * ux + (a1.y - b1.y) * uy;
                      const tA2 = (a2.x - b1.x) * ux + (a2.y - b1.y) * uy;
                      const minTA = Math.min(tA1, tA2);
                      const maxTA = Math.max(tA1, tA2);

                      const overlapMin = Math.max(0, minTA);
                      const overlapMax = Math.min(lenB, maxTA);
                      const overlapLen = overlapMax - overlapMin;

                      if (overlapLen > 10) {
                        const cutJointKey = `cut-joint-${columnIndex}-${segmentIndex}-${subA.id}-${subB.id}`;
                        const customCut = wall.customJoints?.[cutJointKey];
                        const seamW = customCut !== undefined ? customCut.width : 0;

                        const seamP1 = {
                          x: currentX + b1.x + ux * overlapMin,
                          y: currentY + b1.y + uy * overlapMin,
                        };
                        const seamP2 = {
                          x: currentX + b1.x + ux * overlapMax,
                          y: currentY + b1.y + uy * overlapMax,
                        };

                        const isVertCut = Math.abs(ux) < 0.05;
                        const isHorizCut = Math.abs(uy) < 0.05;

                        rawJoints.push({
                          id: cutJointKey,
                          name: `Стык раскроя: ${subA.partLabel || '1.1'} / ${subB.partLabel || '1.2'}`,
                          x: Math.min(seamP1.x, seamP2.x),
                          y: Math.min(seamP1.y, seamP2.y),
                          p1: seamP1,
                          p2: seamP2,
                          width: seamW,
                          length: Math.round(overlapLen),
                          orientation: isVertCut ? 'VERTICAL' : (isHorizCut ? 'HORIZONTAL' : 'DIAGONAL'),
                          isLED: customCut?.isLED ?? false,
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
            const isCut = false;
            const defaultLabel = isVoid
              ? 'ПУСТО'
              : (segConfig?.partLabel || (segmentsConfig.length > 1
                  ? `1.${columnIndex + 1}.${segmentIndex + 1}`
                  : `1.${columnIndex + 1}`));

            const patternAngle = segConfig?.patternAngleDeg !== undefined
              ? segConfig.patternAngleDeg
              : (customConfig?.patternAngleDeg !== undefined ? customConfig.patternAngleDeg : 0);

            const patternFlip = segConfig?.patternFlipX !== undefined
              ? segConfig.patternFlipX
              : (customConfig?.patternFlipX !== undefined ? customConfig.patternFlipX : false);

            panels.push({
              id: `${columnIndex}-${segmentIndex}`,
              x: currentX,
              y: currentY,
              width: panelWidth,
              height: segmentHeight,
              isCut,
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
              textureMapping: segConfig?.textureMapping ?? customConfig?.textureMapping,
              patternAngleDeg: patternAngle,
              patternFlipX: patternFlip,
              areaSqM: Math.round(((panelWidth * segmentHeight) / 1_000_000) * 1000) / 1000,
              note: segConfig?.note,
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
          const pts = (p as any).polygonPoints || (p as any).points;
          if (pts && pts.length >= 3) {
            intervals = subtractPolygonCoverageFromVerticalSeam(intervals, jointX, pts);
          } else if (p.x < jointX - 2 && p.x + p.width > jointX + 2) {
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
        const pts = (p as any).polygonPoints || (p as any).points;
        if (pts && pts.length >= 3) {
          intervals = subtractPolygonCoverageFromHorizontalSeam(intervals, jointY, pts);
        } else if (p.y < jointY - 2 && p.y + p.height > jointY + 2 && p.x < cand.x + cand.panelWidth && p.x + p.width > cand.x) {
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
    }

    // 5. Внешние края периметра стены
    rawJoints.push({
      id: 'edge-v-left',
      name: 'Левый край стены',
      x: 0,
      y: 0,
      p1: { x: 0, y: 0 },
      p2: { x: 0, y: wall.height },
      width: leftEdgeWidth,
      length: wall.height,
      orientation: 'VERTICAL',
      isLED: leftEdgeConfig?.isLED ?? false,
      isOuterEdge: true,
      profileArticle: leftEdgeConfig?.profileArticle,
      profileColor: leftEdgeConfig?.profileColor,
      takeSide: leftEdgeConfig?.takeSide ?? 'RIGHT',
    });

    rawJoints.push({
      id: 'edge-v-right',
      name: 'Правый край стены',
      x: wall.width - rightEdgeWidth,
      y: 0,
      p1: { x: wall.width, y: 0 },
      p2: { x: wall.width, y: wall.height },
      width: rightEdgeWidth,
      length: wall.height,
      orientation: 'VERTICAL',
      isLED: rightEdgeConfig?.isLED ?? false,
      isOuterEdge: true,
      profileArticle: rightEdgeConfig?.profileArticle,
      profileColor: rightEdgeConfig?.profileColor,
      takeSide: rightEdgeConfig?.takeSide ?? 'LEFT',
    });

    rawJoints.push({
      id: 'edge-h-bot',
      name: 'Нижний край стены (плинтус/пол)',
      x: 0,
      y: 0,
      p1: { x: 0, y: 0 },
      p2: { x: wall.width, y: 0 },
      width: botEdgeWidth,
      length: wall.width,
      orientation: 'HORIZONTAL',
      isLED: botEdgeConfig?.isLED ?? false,
      isOuterEdge: true,
      profileArticle: botEdgeConfig?.profileArticle,
      profileColor: botEdgeConfig?.profileColor,
      takeSide: botEdgeConfig?.takeSide ?? 'TOP',
    });

    rawJoints.push({
      id: 'edge-h-top',
      name: 'Верхний край стены (потолок)',
      x: 0,
      y: wall.height - topEdgeWidth,
      p1: { x: 0, y: wall.height },
      p2: { x: wall.width, y: wall.height },
      width: topEdgeWidth,
      length: wall.width,
      orientation: 'HORIZONTAL',
      isLED: topEdgeConfig?.isLED ?? false,
      isOuterEdge: true,
      profileArticle: topEdgeConfig?.profileArticle,
      profileColor: topEdgeConfig?.profileColor,
      takeSide: topEdgeConfig?.takeSide ?? 'BOTTOM',
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
      if (first.orientation === 'DIAGONAL') {
        // Keep the actual endpoints for clipping; the axis-aligned merge below
        // would turn a diagonal group into a vertical line.
        finalJoints.push(...jointsInGroup);
        return;
      }
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
              profileArticle: first.profileArticle,
              profileColor: first.profileColor,
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
              profileArticle: first.profileArticle,
              profileColor: first.profileColor,
              groupId,
            });
          }
        });
      }
    });

    finalJoints.push(...unmergedJoints);

    // 2.9. Автоматическое физическое вычитание проемов (двери, окна, ниши) из панелей для раскроя и производства
    const isPolygonMesh = Boolean(wall.panels && wall.panels.length > 0);
    panels = this.subtractOpeningsFromPanels(panels, wall.openings, wallNumber, isPolygonMesh);

    // Resolve bend offsets against the final part bounds, including pieces cut by openings.
    // The polygon model and the legacy grid must carry the same manufacturing metadata.
    if (wall.bends?.length) {
      panels = panels.map((panel) => {
        const bendsInfo: PanelBendInfo[] = [];
        for (const bend of wall.bends!) {
          const bendEnd = bend.x + Math.round(Math.PI * bend.radius * bend.angleDeg / 180);
          const overlapStart = Math.max(bend.x, panel.x);
          const overlapEnd = Math.min(bendEnd, panel.x + panel.width);
          if (overlapEnd <= overlapStart) continue;
          bendsInfo.push({
            bendId: bend.id, type: bend.type, radius: bend.radius, angleDeg: bend.angleDeg,
            flatLeft: Math.max(0, Math.round(bend.x - panel.x)),
            flatRight: Math.max(0, Math.round(panel.x + panel.width - bendEnd)),
            bendWidth: Math.round(overlapEnd - overlapStart),
            bendOffsetInSheet: Math.round(overlapStart - panel.x),
          });
        }
        return { ...panel, bendsInfo: bendsInfo.length ? bendsInfo : undefined };
      });
    }

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

    const netCoveredAreaSqM = wall.panels && wall.panels.length > 0
      ? coveredPanels.reduce((acc, p) => acc + (p.areaSqM || ((p.width * p.height) / 1_000_000)), 0)
      : Math.max(0, grossCoveredAreaSqM - cutoutsInCoveredAreaSqM);

    const voidPanels = panels.filter((p) => p.isVoid);
    const voidAreaSqM = voidPanels.reduce(
      (acc, p) => acc + (p.areaSqM || ((p.width * p.height) / 1_000_000)),
      0
    );

    // =========================================================================
    // Расчет параметров и деталей откосов
    // =========================================================================
    const slopePieces: CalculatedSlopePiece[] = [];
    const slopeJoints: CalculatedSlopeJoint[] = [];
    let slopeSeq = panels.filter((p) => !p.isVoid).length + 1;
    cutoutOpenings.forEach((op, opIdx) => {
      const slopes = ensureOpeningSlopes(op);
      const geometry = calculateSlopeGeometry(op);
      slopeJoints.push(...geometry.joints.filter(j => j.available && j.sides.every(side => geometry.faces[side].length > 0)));
      for (const side of ['top', 'left', 'right', 'bottom'] as const) {
        const face = geometry.faces[side];
        if (!face.enabled || face.length <= 0) continue;
        const materialId = (slopes.materialMode === 'CUSTOM' ? slopes[side].materialId : null) || slopes.materialId || wall.zone.materialId;
        const mat = allMaterials.find(m => m.id === materialId) || defaultMaterial;
        const labels = { top: 'Верхний откос', left: 'Левый откос', right: 'Правый откос', bottom: op.type === 'WINDOW' ? 'Подоконник' : 'Нижний откос' };
        slopePieces.push({
          id: `slope-${op.id}-${side}`, openingId: op.id, openingName: op.name || `Проем ${opIdx + 1}`,
          side: side.toUpperCase() as CalculatedSlopePiece['side'], sideLabel: labels[side],
          width: face.length, depth: face.depth, startInset: face.startInset, endInset: face.endInset, zStart: face.zStart, zEnd: face.zEnd,
          areaSqM: face.length * face.depth / 1_000_000, materialId: mat.id, materialName: mat.name, materialColor: mat.color,
          decorCode: mat.decorCode, thickness: mat.thickness, textureCategory: mat.textureCategory,
          textureMapping: slopes[side].textureMapping, textureStockWidth: mat.width, textureStockHeight: mat.height,
          partLabel: `${wallNumber}.${slopeSeq++}`,
        });
      }
    });
    const slopeProfileLinearMeters = slopeJoints.filter(slopeJointHasProfile).reduce((sum, joint) => sum + joint.length, 0) / 1000;

    const totalSlopeAreaSqM = slopePieces.reduce((acc, p) => acc + p.areaSqM, 0);

    const cleanFinalJoints: CalculatedJointLine[] = [];

    finalJoints.forEach((j) => {
      if (j.isOuterEdge) {
        cleanFinalJoints.push(j);
        return;
      }

      const isVert =
        j.orientation === 'VERTICAL' ||
        (j.p1 && j.p2 && Math.abs(j.p1.x - j.p2.x) < 1e-3);
      const isHoriz =
        j.orientation === 'HORIZONTAL' ||
        (j.p1 && j.p2 && Math.abs(j.p1.y - j.p2.y) < 1e-3);
      const isDiag = j.orientation === 'DIAGONAL' || (!isVert && !isHoriz);

      // 1. Диагональные / наклонные швы (гипотенузы, наклонные резы)
      if (isDiag && j.p1 && j.p2) {
        const start = j.p1;
        const dx = j.p2.x - start.x;
        const dy = j.p2.y - start.y;
        const length = Math.hypot(dx, dy);
        if (length <= 3) return;
        let intervals: Interval1D[] = [{ start: 0, end: length }];
        for (const opening of wall.openings) {
          if (opening.isCutout === false) continue;
          const cut = segmentOpeningInterval(start, j.p2, opening);
          if (cut) intervals = subtractInterval(intervals, cut.start, cut.end);
        }
        const pointAt = (distance: number): Point2D => ({
          x: start.x + dx * distance / length,
          y: start.y + dy * distance / length,
        });
        intervals.filter(interval => interval.end - interval.start > 3).forEach((interval, index) => {
          const p1 = pointAt(interval.start);
          const p2 = pointAt(interval.end);
          cleanFinalJoints.push({
            ...j,
            id: index === 0 ? j.id : `${j.id}-part-${index}`,
            sourceJointId: j.sourceJointId ?? j.id,
            x: Math.min(p1.x, p2.x),
            y: Math.min(p1.y, p2.y),
            p1,
            p2,
            length: interval.end - interval.start,
            orientation: 'DIAGONAL',
          });
        });
        return;
      }

      const allPanelsToCheck = (wall.panels && wall.panels.length > 0) ? wall.panels : panels;

      // 2. Горизонтальные швы
      if (isHoriz) {
        const startX = j.p1 ? Math.min(j.p1.x, j.p2!.x) : j.x;
        const endX = j.p1 ? Math.max(j.p1.x, j.p2!.x) : j.x + j.length;
        const jointY = j.p1 ? j.p1.y : j.y;

        let intervals: Interval1D[] = [{ start: startX, end: endX }];

        // Вычитаем вырезы проемов (только если шов проходит СТРОГО внутри выреза)
        wall.openings.forEach((op) => {
          if (op.isCutout !== false && jointY > op.y + 0.5 && jointY < op.y + op.height - 0.5) {
            intervals = subtractInterval(intervals, op.x, op.x + op.width);
          }
        });

        // Вычитаем цельные панели, которые вертикально перекрывают этот шов
        for (const p of allPanelsToCheck) {
          const pts = (p as any).polygonPoints || (p as any).points;
          if (pts && pts.length >= 3) {
            intervals = subtractPolygonCoverageFromHorizontalSeam(intervals, jointY, pts);
          } else if ((p as any).y !== undefined && (p as any).y < jointY - 2 && (p as any).y + (p as any).height > jointY + 2) {
            intervals = subtractInterval(intervals, (p as any).x, (p as any).x + (p as any).width);
          }
        }

        intervals.forEach((inv, idx) => {
          const len = inv.end - inv.start;
          if (len > 3) {
            cleanFinalJoints.push({
              ...j,
              id: idx === 0 ? j.id : `${j.id}-seg-${idx}`,
              sourceJointId: j.sourceJointId ?? j.id,
              x: inv.start,
              length: len,
              p1: { x: inv.start, y: jointY },
              p2: { x: inv.end, y: jointY },
              orientation: 'HORIZONTAL',
            });
          }
        });
      } else {
        // 3. Вертикальные швы
        const startY = j.p1 ? Math.min(j.p1.y, j.p2!.y) : j.y;
        const endY = j.p1 ? Math.max(j.p1.y, j.p2!.y) : j.y + j.length;
        const jointX = j.p1 ? j.p1.x : j.x;

        let intervals: Interval1D[] = [{ start: startY, end: endY }];

        // Вычитаем вырезы проемов (только если шов проходит СТРОГО внутри выреза)
        wall.openings.forEach((op) => {
          if (op.isCutout !== false && jointX > op.x + 0.5 && jointX < op.x + op.width - 0.5) {
            intervals = subtractInterval(intervals, op.y, op.y + op.height);
          }
        });

        // Вычитаем цельные панели, которые горизонтально перекрывают этот шов
        for (const p of allPanelsToCheck) {
          const pts = (p as any).polygonPoints || (p as any).points;
          if (pts && pts.length >= 3) {
            intervals = subtractPolygonCoverageFromVerticalSeam(intervals, jointX, pts);
          } else if ((p as any).x !== undefined && (p as any).x < jointX - 2 && (p as any).x + (p as any).width > jointX + 2) {
            intervals = subtractInterval(intervals, (p as any).y, (p as any).y + (p as any).height);
          }
        }

        intervals.forEach((inv, idx) => {
          const len = inv.end - inv.start;
          if (len > 3) {
            cleanFinalJoints.push({
              ...j,
              id: idx === 0 ? j.id : `${j.id}-seg-${idx}`,
              sourceJointId: j.sourceJointId ?? j.id,
              y: inv.start,
              length: len,
              p1: { x: jointX, y: inv.start },
              p2: { x: jointX, y: inv.end },
              orientation: 'VERTICAL',
            });
          }
        });
      }
    });

    const profileLinearMeters = cleanFinalJoints
      .filter((j) => j.width > 0 || j.isLED || j.profileArticle)
      .reduce((acc, j) => acc + j.length / 1000, 0);

    return {
      panels: panels.map(p => {
        const mat = materialsMap.get(p.materialId) || defaultMaterial;
        return { ...p, textureStockWidth: mat.width, textureStockHeight: mat.height };
      }),
      joints: cleanFinalJoints.map((joint) => {
        const profile = joint.profileArticle ? findProfileByArticle(joint.profileArticle) : undefined;
        return { ...joint, visibleWidth: profile?.visibleWidth ?? joint.width, metalThickness: profile?.metalThickness };
      }),
      slopes: slopePieces,
      slopeJoints,
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

  /**
   * Конвертирует стену из Legacy формата (customPanels/segments) в единый плоский массив WallPanelPiece[] и WallJointLine[]
   */
  public static convertLegacyWallToPanels(
    wall: Wall,
    defaultMaterial: Material,
    allMaterials: Material[] = DEFAULT_MATERIALS
  ): { panels: WallPanelPiece[]; joints: WallJointLine[] } {
    const legacyWall: Wall = {
      ...wall,
      panels: undefined,
      joints: undefined,
    };
    const layout = this.calculateWallLayout(legacyWall, defaultMaterial, allMaterials);

    const panels: WallPanelPiece[] = layout.panels.map((p) => ({
      id: p.id,
      points: p.polygonPoints && p.polygonPoints.length >= 3 ? p.polygonPoints : [
        { x: p.x, y: p.y },
        { x: p.x + p.width, y: p.y },
        { x: p.x + p.width, y: p.y + p.height },
        { x: p.x, y: p.y + p.height },
      ],
      materialId: p.materialId,
      decorCode: p.decorCode,
      decorName: p.decorName,
      color: p.materialColor,
      thickness: p.thickness,
      reliefType: p.reliefType as any,
      textureCategory: p.textureCategory,
      partLabel: p.partLabel,
      textureMapping: p.textureMapping,
      patternAngleDeg: p.patternAngleDeg,
      patternFlipX: p.patternFlipX,
      isVoid: p.isVoid,
      note: p.note,
    }));

    const joints: WallJointLine[] = layout.joints.map((j) => ({
      id: j.id,
      p1: j.p1 || { x: j.x, y: j.y },
      p2: j.p2 || (j.orientation === 'VERTICAL' ? { x: j.x, y: j.y + j.length } : { x: j.x + j.length, y: j.y }),
      width: j.width,
      isLED: j.isLED,
      orientation: j.orientation,
      groupId: j.groupId,
      isOuterEdge: j.isOuterEdge,
      takeSide: j.takeSide,
      profileArticle: j.profileArticle ?? wall.customJoints[j.id.split('-part-')[0]]?.profileArticle,
      profileColor: j.profileColor ?? wall.customJoints[j.id.split('-part-')[0]]?.profileColor,
    }));

    return { panels, joints };
  }

  /**
   * Физическое вычитание сквозных проемов (двери, окна, ниши) из панелей (как прямоугольных, так и полигональных) для раскроя и производства
   */
  private static subtractOpeningsFromPanels(
    panels: CalculatedPanelPiece[],
    openings: Opening[],
    wallNumber: number = 1,
    isPolygonMesh: boolean = false
  ): CalculatedPanelPiece[] {
    const cutoutOpenings = openings.filter((op) => op.isCutout !== false && (!isPolygonMesh || !op.isApplied));
    if (cutoutOpenings.length === 0 || panels.length === 0) return panels;

    const resultPanels: CalculatedPanelPiece[] = [];

    panels.forEach((p) => {
      const initialPoly: Point2D[] =
        p.polygonPoints && p.polygonPoints.length >= 3
          ? p.polygonPoints
          : [
              { x: p.x, y: p.y },
              { x: p.x + p.width, y: p.y },
              { x: p.x + p.width, y: p.y + p.height },
              { x: p.x, y: p.y + p.height },
            ];

      let currentPolys: Point2D[][] = [initialPoly];

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

          // Если проем не пересекается с bounding box полигона
          if (
            maxX <= rectWithFraming.x + 0.1 ||
            minX >= rectWithFraming.x + rectWithFraming.width - 0.1 ||
            maxY <= rectWithFraming.y + 0.1 ||
            minY >= rectWithFraming.y + rectWithFraming.height - 0.1
          ) {
            nextPolys.push(poly);
            return;
          }

          const remaining = PolygonSlicingEngine.subtractRectangleFromPolygon(poly, rectWithFraming);
          nextPolys.push(...remaining);
        });

        currentPolys = nextPolys;
      });

      if (currentPolys.length === 0) {
        return;
      }

      currentPolys.forEach((poly, subIdx) => {
        const xs = poly.map((pt) => pt.x);
        const ys = poly.map((pt) => pt.y);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);
        const w = Math.round((maxX - minX) * 10) / 10;
        const h = Math.round((maxY - minY) * 10) / 10;
        const area = Math.round((PolygonSlicingEngine.calculatePolygonArea(poly) / 1_000_000) * 1000) / 1000;

        if (w < 2 || h < 2 || area < 0.001) return;

        const subId = currentPolys.length === 1 ? p.id : `${p.id}-part-${subIdx + 1}`;
        const subPieceId = p.subPieceId
          ? (currentPolys.length === 1 ? p.subPieceId : `${p.subPieceId}-part-${subIdx + 1}`)
          : subId;

        resultPanels.push({
          ...p,
          id: subId,
          subPieceId,
          x: minX,
          y: minY,
          width: w,
          height: h,
          isCut: true,
          polygonPoints: poly,
          areaSqM: area,
        });
      });
    });

    // Последовательная маркировка непустых деталей слева направо и сверху вниз
    const nonVoid = resultPanels.filter((p) => !p.isVoid && p.materialId !== MATERIAL_NONE_ID);
    nonVoid.sort(comparePanelsLeftToRightTopToBottom);

    nonVoid.forEach((p, idx) => {
      p.partLabel = `${wallNumber}.${idx + 1}`;
    });

    return resultPanels;
  }
}


import { ensureOpeningSlopes } from '../../core/models/Opening';
import { TextureMapping, slopeTexturePiece, textureMappingError } from '../../core/textures/TextureMapping';
import { create } from 'zustand';
import { Project, createDefaultProject } from '../../core/models/Project';
import { Wall, createDefaultWall, CustomPanelConfig, PanelSegmentConfig, JointEdgeConfig, RadiusConfig, RadiusType, WallBend, WallPanelPiece, WallJointLine, PanelEdgeJointConfig, PanelEdgeSide } from '../../core/models/Wall';
import { Opening, createDefaultOpening, OpeningType, OpeningEdgeConfig, OpeningFramingConfig, ensureOpeningFraming, getOpeningTypeLabel, isDoorOrPortal, isPortalOpening } from '../../core/models/Opening';
import { ProfileType, findProfileByArticle, DEFAULT_PROFILES, DEFAULT_JOINT_GAP_MM } from '../../core/models/Profile';
import { Material, MATERIAL_NONE_ID, DEFAULT_MATERIALS } from '../../core/models/Material';
import { SlatProfileShape, AllWallDecor } from '../../core/models/AllWallCatalog';
import { LayoutEngine } from '../../core/layout/LayoutEngine';
import { PolygonSlicingEngine, PolygonSubPiece, Point2D } from '../../core/geometry/PolygonSlicingEngine';
import { getPanelEdges } from '../../core/geometry/PanelEdges';
import { getPanelEdgeJoint, getResolvedPanelEdges } from '../../core/geometry/PanelJointBinding';
import { resizePanelEdgeGap } from '../../core/geometry/PanelEdgeGapGeometry';
import { renumberProjectWalls } from '../../core/layout/WallNumberingEngine';
import { localProjectRepository } from '../../infrastructure/repositories/LocalSQLiteRepository';
import { localCatalogRepository } from '../../infrastructure/repositories/LocalCatalogRepository';

export type GridPresetType = 'STANDARD_1220' | 'SLATS_145' | 'TIERS_900_1800' | 'CENTER_TV_NICHE';
export type JointPreset = 'NONE' | '0.8' | '3' | '7' | '5' | '8' | '10' | 'LED_10';

export interface SelectedCellCoord {
  columnIndex: number;
  segmentIndex: number;
}

export interface SelectedPanelEdgeTarget {
  wallId: string;
  panelId: string;
  edge: PanelEdgeSide | number;
}

export interface JointValidationResult {
  canMerge: boolean;
  isCollinear: boolean;
  sameOrientation: boolean;
  sameWidth: boolean;
  sameLED: boolean;
  orientation?: 'VERTICAL' | 'HORIZONTAL' | 'DIAGONAL';
  widths: number[];
  ledStates: boolean[];
  positions: number[];
  errorMessage?: string;
}

interface ProjectState {
  project: Project;
  selectedColumnIndex: number | null;
  selectedSegmentIndex: number | null;
  selectedCellKeys: string[];
  selectedPieceIds: string[];
  selectedJointId: string | null;
  selectedJointIds: string[];
  selectedWallBendId: string | null;
  selectedSubPieceId: string | null;
  selectedPanelEdge: SelectedPanelEdgeTarget | null;
  isSlicingModalOpen: boolean;
  slicingTarget: { wallId: string; columnIndex: number; segmentIndex?: number | null; panelId?: string | null } | null;
  isDirty?: boolean;
  lastSavedAt?: string | null;

  // Выбор
  selectWall: (wallId: string) => void;
  selectOpening: (openingId: string | null) => void;
  selectPanel: (
    panelId: string | null,
    columnIndex: number | null,
    segmentIndex?: number | null,
    subPieceId?: string | null
  ) => void;
  selectSubPiece: (subPieceId: string | null) => void;
  openSlicingModal: (wallId: string, columnIndex: number, segmentIndex?: number | null, panelId?: string | null) => void;
  closeSlicingModal: () => void;
  toggleCellSelection: (panelId: string, columnIndex: number, segmentIndex: number, isShift: boolean) => void;
  selectJoint: (jointId: string | null, isShift?: boolean) => void;
  selectWallBend: (bendId: string | null) => void;

  // Сохранение и проекты
  saveCurrentProject: () => Promise<void>;
  loadProjectById: (id: string) => Promise<boolean>;
  createNewProject: (name?: string, wallWidth?: number, wallHeight?: number, roomName?: string) => Project;
  setProject: (project: Project) => void;
  setProjectName: (name: string) => void;
  duplicateProject: (id: string, newName?: string) => Promise<Project | null>;
  deleteProjectById: (id: string) => Promise<void>;
  exportProjectFile: () => void;
  importProjectFromFile: (jsonString: string) => Promise<Project>;

  // Объединение и массовое редактирование панелей через Shift
  mergeSelectedCells: (wallId: string) => void;
  setMaterialForSelectedCells: (wallId: string, materialId: string) => void;

  // Объединение и массовое редактирование стыков через Shift
  validateSelectedJoints: (wallId: string) => JointValidationResult;
  mergeSelectedJoints: (wallId: string) => { success: boolean; error?: string };
  unmergeJoints: (wallId: string, jointId: string) => void;
  syncSelectedJointsParams: (wallId: string, targetJointId?: string) => void;
  setJointPresetForSelected: (wallId: string, preset: JointPreset) => void;
  setJointWidthForSelected: (wallId: string, width: number) => void;
  setJointTakeSideForSelected: (wallId: string, takeSide: 'BOTH' | 'LEFT' | 'RIGHT' | 'TOP' | 'BOTTOM') => void;
  setJointLEDForSelected: (wallId: string, isLED: boolean) => void;
  setJointProfileForSelected: (wallId: string, article: string, colorHex?: string) => void;
  setJointColorForSelected: (wallId: string, colorHex: string) => void;

  // Управление стенами
  addWall: (name?: string, roomName?: string) => void;
  updateWallName: (wallId: string, name: string) => void;
  updateWallRoom: (wallId: string, roomName: string) => void;
  updateWall: (wallId: string, updates: Partial<Wall>) => void;
  updateWallDimensions: (wallId: string, width: number, height: number) => void;
  setWallMaterial: (
    wallId: string,
    materialId: string,
    decor?: AllWallDecor | { code?: string; color?: string; name?: string; category?: any }
  ) => void;
  setWallJointProfile: (wallId: string, profileType: ProfileType) => void;

  // Управление каталогом материалов AllWall
  addCustomCatalogPanel: (panel: Material) => void;
  updateCatalogPanel: (panelId: string, updates: Partial<Material>) => void;
  deleteCatalogPanel: (panelId: string) => void;

  // Управление кликабельными стыками и краями
  setJointWidth: (wallId: string, jointId: string, width: number) => void;
  setJointTakeSide: (wallId: string, jointId: string, takeSide: 'BOTH' | 'LEFT' | 'RIGHT' | 'TOP' | 'BOTTOM') => void;
  setJointLED: (wallId: string, jointId: string, isLED: boolean) => void;
  setJointPreset: (wallId: string, jointId: string, preset: JointPreset) => void;
  setJointProfile: (wallId: string, jointId: string, article: string, colorHex?: string) => void;
  setJointColor: (wallId: string, jointId: string, colorHex: string) => void;

  // Управление стыками торцов деталей (Edge-Centric Model)
  setSelectedPanelEdge: (target: SelectedPanelEdgeTarget | null) => void;
  setPanelEdgeJoint: (
    wallId: string,
    panelId: string,
    edge: PanelEdgeSide | number,
    config: Partial<PanelEdgeJointConfig>
  ) => void;
  setPanelEdgeWidth: (
    wallId: string,
    panelId: string,
    edge: PanelEdgeSide | number,
    width: number
  ) => void;
  setPanelEdgeProfile: (
    wallId: string,
    panelId: string,
    edge: PanelEdgeSide | number,
    article: string,
    colorHex?: string
  ) => void;
  setPanelEdgeLED: (
    wallId: string,
    panelId: string,
    edge: PanelEdgeSide | number,
    isLED: boolean
  ) => void;
  setPanelEdgeColor: (
    wallId: string,
    panelId: string,
    edge: PanelEdgeSide | number,
    colorHex: string
  ) => void;

  // Управление ячейками сетки (материалы, размеры, пустоты)
  setCellMaterial: (wallId: string, columnIndex: number, segmentIndex: number, materialId: string) => void;
  setCellProperties: (
    wallId: string,
    columnIndex: number,
    segmentIndex: number,
    properties: {
      materialId?: string;
      customThickness?: number;
      customColor?: string;
      customDecorCode?: string;
      customTextureCategory?: string;
      customReliefType?: SlatProfileShape;
    }
  ) => void;
  clearCellMaterial: (wallId: string, columnIndex: number, segmentIndex: number) => void;
  updatePanelConfig: (wallId: string, columnIndex: number, config: Partial<CustomPanelConfig>) => void;
  updatePanelSegment: (wallId: string, columnIndex: number, segmentIndex: number, config: Partial<PanelSegmentConfig>) => void;
  splitPanelHorizontally: (wallId: string, columnIndex: number, segmentIndex: number, firstHeight: number) => void;
  splitColumnVertically: (wallId: string, columnIndex: number, firstWidth: number) => void;
  splitPanelDiagonally: (wallId: string, columnIndex: number, segmentIndex: number | null, direction: 'BL_TR' | 'TL_BR') => void;
  applyPanelSlicingResult: (wallId: string, columnIndex: number, segmentIndex: number | null, subPieces: PolygonSubPiece[], panelId?: string | null) => void;
  setTextureMappings: (wallId: string, updates: { id: string; mapping: TextureMapping }[]) => void;
  setSubPieceMaterial: (wallId: string, columnIndex: number, segmentIndex: number | null, subPieceId: string, materialId: string, decorCode?: string, decorName?: string, color?: string) => void;
  deleteSubPiece: (wallId: string, columnIndex: number, segmentIndex: number | null, subPieceId: string) => void;
  updateSubPieceLabel: (wallId: string, columnIndex: number, segmentIndex: number | null, subPieceId: string, partLabel: string) => void;
  updateSubPieceNote: (wallId: string, columnIndex: number, segmentIndex: number | null, subPieceId: string, note: string) => void;
  updateWallPanelNote: (wallId: string, panelId: string, note: string) => void;
  resetPanelConfig: (wallId: string, columnIndex: number) => void;
  applyGridPreset: (wallId: string, preset: GridPresetType) => void;

  // Управление радиусными элементами (изгибы, углы)
  addWallBend: (wallId: string, type?: RadiusType, x?: number, radius?: number, angleDeg?: number) => string;
  updateWallBend: (wallId: string, bendId: string, updates: Partial<WallBend>) => void;
  deleteWallBend: (wallId: string, bendId: string) => void;
  addRadiusColumn: (wallId: string, type?: RadiusType, radius?: number, angleDeg?: number) => void;
  setPanelRadiusConfig: (wallId: string, columnIndex: number, config: RadiusConfig | undefined) => void;

  // Управление проемами
  addOpening: (wallId: string, type: OpeningType) => void;
  updateOpening: (wallId: string, opening: Partial<Opening> & { id: string }) => void;
  applyOpening: (wallId: string, openingId: string) => void;
  removeOpening: (wallId: string, openingId: string) => void;
  setOpeningFramingSide: (
    wallId: string,
    openingId: string,
    side: 'left' | 'right' | 'top' | 'bottom',
    config: Partial<OpeningEdgeConfig>
  ) => void;
  setOpeningFramingPreset: (
    wallId: string,
    openingId: string,
    preset: 'NONE' | '8' | 'LED_10' | 'CUSTOM',
    profileArticle?: string,
    profileColor?: string
  ) => void;
  splitPanelAroundOpening: (wallId: string, openingId: string) => void;
  slicePanelToSheetFormat: (
    wallId: string,
    panelId?: string,
    columnIndex?: number,
    segmentIndex?: number
  ) => void;
}



/**
 * Автоматически разделяет слишком широкую колонку на несколько колонок стандартной ширины листа (100 мм <= W <= maxSheetWidth)
 * При превышении максимального размера (например, 1210 при max 1200) первая плита получает 1200, а справа создается плита мин. 100 мм.
 */
function splitOversizedColumn(
  customPanels: Record<number, CustomPanelConfig>,
  customJoints: Record<string, JointEdgeConfig>,
  columnIndex: number,
  requestedWidth: number,
  maxSheetWidth: number = 1220,
  jointGap: number = 0,
  minPieceWidth: number = 100
): { customPanels: Record<number, CustomPanelConfig>; customJoints: Record<string, JointEdgeConfig> } {
  const pieceWidths: number[] = [];
  let rem = requestedWidth;

  while (rem > 0) {
    if (rem <= maxSheetWidth) {
      pieceWidths.push(Math.max(minPieceWidth, Math.round(rem)));
      break;
    } else {
      pieceWidths.push(maxSheetWidth);
      rem -= maxSheetWidth + jointGap;
      if (rem <= 0) {
        pieceWidths.push(minPieceWidth);
        break;
      }
    }
  }

  if (pieceWidths.length <= 1) {
    pieceWidths.length = 0;
    pieceWidths.push(Math.max(minPieceWidth, Math.min(maxSheetWidth, requestedWidth)));
  }

  const numNew = pieceWidths.length;
  const numAdded = numNew - 1;

  const resultPanels: Record<number, CustomPanelConfig> = {};
  const resultJoints: Record<string, JointEdgeConfig> = {};

  const origCustom = customPanels[columnIndex] || { columnIndex };

  // 1. Копируем колонки левее columnIndex и сдвигаем правее
  Object.entries(customPanels).forEach(([kStr, conf]) => {
    const k = Number(kStr);
    if (k < columnIndex) {
      resultPanels[k] = { ...conf, columnIndex: k };
    } else if (k > columnIndex) {
      resultPanels[k + numAdded] = {
        ...conf,
        columnIndex: k + numAdded,
      };
    }
  });

  // 2. Добавляем новые нарезанные колонки
  pieceWidths.forEach((w, idx) => {
    const targetIdx = columnIndex + idx;
    resultPanels[targetIdx] = {
      ...origCustom,
      columnIndex: targetIdx,
      customWidth: w,
      segments: origCustom.segments
        ? origCustom.segments.map((s) => ({ ...s, id: `seg-${Date.now()}-${targetIdx}-${s.id}` }))
        : undefined,
    };
  });

  // 3. Сдвигаем вертикальные и горизонтальные стыки
  Object.entries(customJoints).forEach(([jKey, jConfig]) => {
    if (jKey.startsWith('edge-v-') && !jKey.includes('left') && !jKey.includes('right') && !jKey.includes('end')) {
      const cIdx = Number(jKey.replace('edge-v-', ''));
      if (!isNaN(cIdx)) {
        if (cIdx < columnIndex) {
          resultJoints[jKey] = jConfig;
        } else if (cIdx >= columnIndex) {
          const newKey = `edge-v-${cIdx + numAdded}`;
          resultJoints[newKey] = {
            ...jConfig,
            id: newKey,
          };
        }
        return;
      }
    }

    if (jKey.startsWith('edge-h-') && !jKey.includes('top') && !jKey.includes('bot')) {
      const parts = jKey.replace('edge-h-', '').split('-');
      if (parts.length === 2) {
        const cIdx = Number(parts[0]);
        const sIdx = Number(parts[1]);
        if (!isNaN(cIdx) && !isNaN(sIdx)) {
          if (cIdx < columnIndex) {
            resultJoints[jKey] = jConfig;
          } else if (cIdx === columnIndex) {
            resultJoints[jKey] = jConfig;
            for (let i = 1; i <= numAdded; i++) {
              const rightKey = `edge-h-${columnIndex + i}-${sIdx}`;
              resultJoints[rightKey] = { ...jConfig, id: rightKey };
            }
          } else if (cIdx > columnIndex) {
            const newKey = `edge-h-${cIdx + numAdded}-${sIdx}`;
            resultJoints[newKey] = {
              ...jConfig,
              id: newKey,
            };
          }
          return;
        }
      }
    }

    resultJoints[jKey] = jConfig;
  });

  // 4. Создаем швы между новыми нарезанными колонками
  for (let idx = 0; idx < numAdded; idx++) {
    const targetIdx = columnIndex + idx;
    const jointKey = `edge-v-${targetIdx}`;
    resultJoints[jointKey] = {
      id: jointKey,
      orientation: 'VERTICAL',
      width: jointGap,
      isLED: false,
    };
  }

  return { customPanels: resultPanels, customJoints: resultJoints };
}

/**
 * Автоматически разделяет слишком высокий сегмент на несколько рядов (100 мм <= H <= maxSheetHeight)
 * При превышении максимального размера (например, 2810 при max 2800) первый сегмент получает 2800, а сверху создается сегмент мин. 100 мм.
 */
function splitOversizedSegment(
  customJoints: Record<string, JointEdgeConfig>,
  columnIndex: number,
  segments: PanelSegmentConfig[],
  segmentIndex: number,
  requestedHeight: number,
  maxSheetHeight: number = 2800,
  jointGap: number = 0,
  minPieceHeight: number = 100
): { segments: PanelSegmentConfig[]; customJoints: Record<string, JointEdgeConfig> } {
  const pieceHeights: number[] = [];
  let rem = requestedHeight;

  while (rem > 0) {
    if (rem <= maxSheetHeight) {
      pieceHeights.push(Math.max(minPieceHeight, Math.round(rem)));
      break;
    } else {
      pieceHeights.push(maxSheetHeight);
      rem -= maxSheetHeight + jointGap;
      if (rem <= 0) {
        pieceHeights.push(minPieceHeight);
        break;
      }
    }
  }

  if (pieceHeights.length <= 1) {
    pieceHeights.length = 0;
    pieceHeights.push(Math.max(minPieceHeight, Math.min(maxSheetHeight, requestedHeight)));
  }

  const numNew = pieceHeights.length;
  const numAdded = numNew - 1;

  const resultSegments: PanelSegmentConfig[] = [];
  const resultJoints: Record<string, JointEdgeConfig> = { ...customJoints };

  const origSeg = segments[segmentIndex] || { id: `seg-${Date.now()}-0` };

  // 1. Копируем сегменты ниже segmentIndex
  for (let i = 0; i < segmentIndex; i++) {
    if (segments[i]) resultSegments.push(segments[i]);
  }

  // 2. Вставляем новые нарезанные сегменты
  pieceHeights.forEach((h, idx) => {
    resultSegments.push({
      ...origSeg,
      id: idx === 0 ? origSeg.id : `seg-${Date.now()}-${segmentIndex + idx}`,
      height: h,
    });
  });

  // 3. Копируем сегменты выше segmentIndex
  for (let i = segmentIndex + 1; i < segments.length; i++) {
    if (segments[i]) resultSegments.push(segments[i]);
  }

  // 4. Сдвигаем горизонтальные стыки этого столбца
  for (let sIdx = segments.length - 1; sIdx >= segmentIndex; sIdx--) {
    const oldKey = `edge-h-${columnIndex}-${sIdx}`;
    const newKey = `edge-h-${columnIndex}-${sIdx + numAdded}`;
    if (resultJoints[oldKey]) {
      resultJoints[newKey] = {
        ...resultJoints[oldKey],
        id: newKey,
      };
      delete resultJoints[oldKey];
    }
  }

  // 5. Создаем швы между новыми нарезанными сегментами
  for (let idx = 0; idx < numAdded; idx++) {
    const targetIdx = segmentIndex + idx;
    const jointKey = `edge-h-${columnIndex}-${targetIdx}`;
    resultJoints[jointKey] = {
      id: jointKey,
      orientation: 'HORIZONTAL',
      width: jointGap,
      isLED: false,
    };
  }

  return { segments: resultSegments, customJoints: resultJoints };
}

/**
 * Находит существующий стык в wall.joints или синтезирует его для краевых стыков (edge-v-left/right, edge-h-bot/top) и стыков проемов.
 */
function findOrSynthesizeJoint(w: Wall, jId: string): WallJointLine | undefined {
  const baseId = jId.split('-part-')[0].split('-merged-')[0];
  const customConfig = w.customJoints[jId] || w.customJoints[baseId];

  // 1. Краевые стыки периметра стены - всегда проверяем первыми с точными координатами по всей стене
  if (jId === 'edge-v-left') {
    return {
      id: 'edge-v-left',
      p1: { x: 0, y: 0 },
      p2: { x: 0, y: w.height },
      width: customConfig?.width ?? 0,
      orientation: 'VERTICAL',
      isLED: customConfig?.isLED ?? false,
      isOuterEdge: true,
      takeSide: customConfig?.takeSide ?? 'RIGHT',
      profileArticle: customConfig?.profileArticle,
      profileColor: customConfig?.profileColor,
    };
  }
  if (jId === 'edge-v-right' || jId === 'edge-v-end') {
    return {
      id: jId,
      p1: { x: w.width, y: 0 },
      p2: { x: w.width, y: w.height },
      width: customConfig?.width ?? 0,
      orientation: 'VERTICAL',
      isLED: customConfig?.isLED ?? false,
      isOuterEdge: true,
      takeSide: customConfig?.takeSide ?? 'LEFT',
      profileArticle: customConfig?.profileArticle,
      profileColor: customConfig?.profileColor,
    };
  }
  if (jId === 'edge-h-bot') {
    return {
      id: 'edge-h-bot',
      p1: { x: 0, y: 0 },
      p2: { x: w.width, y: 0 },
      width: customConfig?.width ?? 0,
      orientation: 'HORIZONTAL',
      isLED: customConfig?.isLED ?? false,
      isOuterEdge: true,
      takeSide: customConfig?.takeSide ?? 'TOP',
      profileArticle: customConfig?.profileArticle,
      profileColor: customConfig?.profileColor,
    };
  }
  if (jId === 'edge-h-top') {
    return {
      id: 'edge-h-top',
      p1: { x: 0, y: w.height },
      p2: { x: w.width, y: w.height },
      width: customConfig?.width ?? 0,
      orientation: 'HORIZONTAL',
      isLED: customConfig?.isLED ?? false,
      isOuterEdge: true,
      takeSide: customConfig?.takeSide ?? 'BOTTOM',
      profileArticle: customConfig?.profileArticle,
      profileColor: customConfig?.profileColor,
    };
  }

  const existing = w.joints?.find((j) => j.id === jId);
  if (existing) {
    const isVert = existing.orientation === 'VERTICAL' || (existing.orientation !== 'HORIZONTAL' && Math.abs((existing.p1?.x ?? 0) - (existing.p2?.x ?? 0)) < Math.abs((existing.p1?.y ?? 0) - (existing.p2?.y ?? 0)));
    return {
      ...existing,
      orientation: existing.orientation || (isVert ? 'VERTICAL' : 'HORIZONTAL'),
      p1: existing.p1 || { x: (existing as any).x || 0, y: (existing as any).y || 0 },
      p2: existing.p2 || {
        x: (existing as any).x + (isVert ? 0 : ((existing as any).length || w.width)),
        y: (existing as any).y + (isVert ? ((existing as any).length || w.height) : 0),
      },
    };
  }

  // 2. Периметр проемов: joint-op-${opId}-left / right / top
  if (jId.startsWith('joint-op-')) {
    const match = jId.match(/^joint-op-(.+)-(left|right|top)$/);
    if (match) {
      const opId = match[1];
      const side = match[2];
      const op = w.openings?.find((o) => o.id === opId);
      if (op) {
        if (side === 'left') {
          return {
            id: jId,
            p1: { x: op.x, y: op.y },
            p2: { x: op.x, y: op.y + op.height },
            width: customConfig?.width ?? DEFAULT_JOINT_GAP_MM,
            orientation: 'VERTICAL',
            isLED: customConfig?.isLED ?? false,
            takeSide: customConfig?.takeSide ?? 'LEFT',
          };
        }
        if (side === 'right') {
          return {
            id: jId,
            p1: { x: op.x + op.width, y: op.y },
            p2: { x: op.x + op.width, y: op.y + op.height },
            width: customConfig?.width ?? DEFAULT_JOINT_GAP_MM,
            orientation: 'VERTICAL',
            isLED: customConfig?.isLED ?? false,
            takeSide: customConfig?.takeSide ?? 'RIGHT',
          };
        }
        if (side === 'top') {
          return {
            id: jId,
            p1: { x: op.x, y: op.y + op.height },
            p2: { x: op.x + op.width, y: op.y + op.height },
            width: customConfig?.width ?? DEFAULT_JOINT_GAP_MM,
            orientation: 'HORIZONTAL',
            isLED: customConfig?.isLED ?? false,
            takeSide: customConfig?.takeSide ?? 'TOP',
          };
        }
      }
    }
  }

  return undefined;
}

// Preserve the actual gap and geometry when assigning or removing a product.
function jointParameters(wall: Wall, id: string): JointEdgeConfig {
  const source = findOrSynthesizeJoint(wall, id);
  const custom: Partial<JointEdgeConfig> = wall.customJoints[id] ?? {};
  return {
    id, width: source?.width ?? DEFAULT_PROFILES[wall.zone.jointProfileType].width,
    orientation: source?.orientation ?? (id.includes('-v-') ? 'VERTICAL' : 'HORIZONTAL'),
    isLED: source?.isLED ?? false, profileArticle: source?.profileArticle,
    profileColor: source?.profileColor, groupId: source?.groupId, takeSide: source?.takeSide,
    ...custom,
  };
}

function assignJointProfile(wall: Wall, ids: string[], article: string, colorHex?: string): Wall {
  const selected = new Set(ids);
  const groups = new Set(ids.map(id => jointParameters(wall, id).groupId).filter(Boolean));
  const allIds = new Set([...Object.keys(wall.customJoints), ...(wall.joints ?? []).map(j => j.id)]);
  allIds.forEach(id => { if (groups.has(jointParameters(wall, id).groupId)) selected.add(id); });
  const profile = findProfileByArticle(article);
  const customJoints = { ...wall.customJoints };
  selected.forEach(id => {
    const current = jointParameters(wall, id);
    customJoints[id] = { ...current, profileArticle: article,
      isLED: profile?.isLEDCompatible ?? false,
      profileColor: colorHex ?? current.profileColor ?? profile?.defaultColorHex ?? '#212529' };
  });
  return { ...wall, customJoints, joints: wall.joints?.map(j => selected.has(j.id)
    ? { ...j, profileArticle: article, isLED: customJoints[j.id].isLED, profileColor: customJoints[j.id].profileColor } : j) };
}

// Store actions update these fields immutably. Selection and save timestamps
// do not change the design and must not turn on the unsaved indicator.
function projectContentChanged(previous: Project, next: Project): boolean {
  return previous.id !== next.id || previous.name !== next.name ||
    previous.walls !== next.walls || previous.materials !== next.materials ||
    previous.excludedCatalogPanelIds !== next.excludedCatalogPanelIds;
}

export const useProjectStore = create<ProjectState>((setRaw, get) => {
  const set: typeof setRaw = (partial, replace) => {
    setRaw((state) => {
      const nextState = typeof partial === 'function' ? (partial as any)(state) : partial;
      if (nextState === state) return state;
      if (nextState && nextState.project && nextState.project.walls) {
        return {
          ...nextState,
          isDirty: nextState.isDirty ?? (state.isDirty || projectContentChanged(state.project, nextState.project)),
          project: nextState.project.walls === state.project.walls
            ? nextState.project
            : renumberProjectWalls(nextState.project),
        };
      }
      return nextState;
    }, replace);
  };

  return {
    project: renumberProjectWalls({
      ...createDefaultProject(),
      materials: localCatalogRepository.mergePanels(DEFAULT_MATERIALS, true),
    }),
    isDirty: false,
    selectedColumnIndex: null,
    selectedSegmentIndex: null,
    selectedCellKeys: [],
    selectedPieceIds: [],
    selectedJointId: null,
    selectedJointIds: [],
    selectedWallBendId: null,
    selectedSubPieceId: null,
    selectedPanelEdge: null,
    isSlicingModalOpen: false,
    slicingTarget: null,

  selectWall: (wallId: string) =>
    set((state) => ({
      selectedPanelEdge: null,
      selectedColumnIndex: null,
      selectedSegmentIndex: null,
      selectedCellKeys: [],
      selectedPieceIds: [],
      selectedJointId: null,
      selectedJointIds: [],
      selectedWallBendId: null,
      selectedSubPieceId: null,
      project: {
        ...state.project,
        selectedWallId: wallId,
        selectedOpeningId: null,
      },
    })),

  selectOpening: (openingId: string | null) =>
    set((state) => ({
      selectedPanelEdge: null,
      selectedColumnIndex: null,
      selectedSegmentIndex: null,
      selectedCellKeys: [],
      selectedPieceIds: [],
      selectedJointId: null,
      selectedJointIds: [],
      selectedWallBendId: null,
      selectedSubPieceId: null,
      project: {
        ...state.project,
        selectedOpeningId: openingId,
      },
    })),

  selectWallBend: (bendId: string | null) =>
    set((state) => ({
      selectedPanelEdge: null,
      selectedColumnIndex: null,
      selectedSegmentIndex: null,
      selectedCellKeys: [],
      selectedPieceIds: [],
      selectedJointId: null,
      selectedJointIds: [],
      selectedWallBendId: bendId,
      selectedSubPieceId: null,
      project: {
        ...state.project,
        selectedOpeningId: null,
      },
    })),

  selectPanel: (
    panelId: string | null,
    columnIndex: number | null,
    segmentIndex: number | null = 0,
    subPieceId: string | null = null
  ) =>
    set((state) => {
      let effectiveSubPieceId = subPieceId;
      if (!effectiveSubPieceId && panelId && panelId.startsWith('panel-')) {
        const parts = panelId.split('-');
        if (parts.length >= 4) {
          effectiveSubPieceId = parts.slice(3).join('-');
        }
      }

      return {
        selectedPanelEdge: null,
        selectedColumnIndex: columnIndex,
        selectedSegmentIndex: segmentIndex ?? 0,
        selectedCellKeys: columnIndex !== null ? [`${columnIndex}-${segmentIndex ?? 0}`] : [],
        selectedPieceIds: panelId ? [panelId] : [],
        selectedJointId: null,
        selectedJointIds: [],
        selectedWallBendId: null,
        selectedSubPieceId: effectiveSubPieceId || null,
        project: {
          ...state.project,
          selectedOpeningId: null,
        },
      };
    }),

  selectSubPiece: (subPieceId: string | null) =>
    set(() => ({
      selectedPanelEdge: null,
      selectedSubPieceId: subPieceId,
    })),

  openSlicingModal: (
    wallId: string,
    columnIndex: number,
    segmentIndex: number | null = null,
    panelId: string | null = null
  ) =>
    set(() => ({
      isSlicingModalOpen: true,
      slicingTarget: { wallId, columnIndex, segmentIndex, panelId },
    })),

  closeSlicingModal: () =>
    set(() => ({
      isSlicingModalOpen: false,
      slicingTarget: null,
    })),

  toggleCellSelection: (panelId: string, columnIndex: number, segmentIndex: number, isShift: boolean) =>
    set((state) => {
      let effectiveSubPieceId: string | null = null;
      if (panelId && panelId.startsWith('panel-')) {
        const parts = panelId.split('-');
        if (parts.length >= 4) {
          effectiveSubPieceId = parts.slice(3).join('-');
        }
      }

      const key = `${columnIndex}-${segmentIndex}`;

      if (!isShift) {
        return {
          selectedPanelEdge: null,
          selectedColumnIndex: columnIndex,
          selectedSegmentIndex: segmentIndex,
          selectedCellKeys: [key],
          selectedPieceIds: [panelId],
          selectedJointId: null,
          selectedJointIds: [],
          selectedWallBendId: null,
          selectedSubPieceId: effectiveSubPieceId,
          project: {
            ...state.project,
            selectedOpeningId: null,
          },
        };
      }

      // Режим мульти-выбора через Shift
      const isAlreadySelected = state.selectedPieceIds.includes(panelId);
      const nextPieceIds = isAlreadySelected
        ? state.selectedPieceIds.filter((p) => p !== panelId)
        : [...state.selectedPieceIds, panelId];

      // Вычисляем задействованные cellKeys на основе всех оставшихся pieceIds
      const nextKeysSet = new Set<string>();
      nextPieceIds.forEach((pid) => {
        if (pid.startsWith('panel-')) {
          const parts = pid.split('-');
          if (parts.length >= 3) {
            nextKeysSet.add(`${parts[1]}-${parts[2]}`);
          }
        }
      });
      const nextKeys = Array.from(nextKeysSet);

      let nextSubPieceId: string | null = null;
      if (nextPieceIds.length === 1) {
        const parts = nextPieceIds[0].split('-');
        if (parts.length >= 4) {
          nextSubPieceId = parts.slice(3).join('-');
        }
      }

      return {
        selectedPanelEdge: null,
        selectedCellKeys: nextKeys,
        selectedPieceIds: nextPieceIds,
        selectedColumnIndex: nextKeys.length === 1 ? Number(nextKeys[0].split('-')[0]) : null,
        selectedSegmentIndex: nextKeys.length === 1 ? Number(nextKeys[0].split('-')[1]) : null,
        selectedSubPieceId: nextSubPieceId,
        selectedJointId: null,
        selectedJointIds: [],
        selectedWallBendId: null,
      };
    }),

  selectJoint: (jointId: string | null, isShift: boolean = false) =>
    set((state) => {
      if (!jointId) {
        return {
          selectedJointId: null,
          selectedJointIds: [],
          selectedColumnIndex: null,
          selectedSegmentIndex: null,
          selectedCellKeys: [],
          selectedPieceIds: [],
          selectedPanelEdge: null,
        };
      }

      if (!isShift) {
        return {
          selectedJointId: jointId,
          selectedJointIds: [jointId],
          selectedColumnIndex: null,
          selectedSegmentIndex: null,
          selectedCellKeys: [],
          selectedPieceIds: [],
          selectedPanelEdge: null,
          project: {
            ...state.project,
            selectedOpeningId: null,
          },
        };
      }

      // Мульти-выбор швов через Shift
      const exists = state.selectedJointIds.includes(jointId);
      const nextJointIds = exists
        ? state.selectedJointIds.filter((id) => id !== jointId)
        : [...state.selectedJointIds, jointId];

      return {
        selectedJointId: nextJointIds[0] || null,
        selectedJointIds: nextJointIds,
        selectedColumnIndex: null,
        selectedSegmentIndex: null,
        selectedCellKeys: [],
        selectedPieceIds: [],
        selectedPanelEdge: null,
        project: {
          ...state.project,
          selectedOpeningId: null,
        },
      };
    }),

  // ПРОВЕРКА ВОЗМОЖНОСТИ СОЕДИНЕНИЯ ШВОВ
  validateSelectedJoints: (wallId: string): JointValidationResult => {
    const state = get();
    const wall = state.project.walls.find((w) => w.id === wallId);
    if (!wall || state.selectedJointIds.length < 2) {
      return {
        canMerge: false,
        isCollinear: false,
        sameOrientation: false,
        sameWidth: false,
        sameLED: false,
        widths: [],
        ledStates: [],
        positions: [],
        errorMessage: 'Выберите не менее 2 швов через Shift',
      };
    }

    const material = state.project.materials.find(
      (m) => m.id === (wall.zone.materialId || MATERIAL_NONE_ID)
    ) || state.project.materials.find((m) => m.id === MATERIAL_NONE_ID) || state.project.materials[0];
    if (!material) {
      return {
        canMerge: false,
        isCollinear: false,
        sameOrientation: false,
        sameWidth: false,
        sameLED: false,
        widths: [],
        ledStates: [],
        positions: [],
        errorMessage: 'Материал стены не найден',
      };
    }

    const layout = LayoutEngine.calculateWallLayout(wall, material, state.project.materials);
    const selectedJointObjects = layout.joints.filter((j) => state.selectedJointIds.includes(j.id));

    if (selectedJointObjects.length < 2) {
      return {
        canMerge: false,
        isCollinear: false,
        sameOrientation: false,
        sameWidth: false,
        sameLED: false,
        widths: [],
        ledStates: [],
        positions: [],
        errorMessage: 'Не удалось определить геометрические параметры всех выбранных швов',
      };
    }

    const orientations = Array.from(new Set(selectedJointObjects.map((j) => j.orientation)));
    const sameOrientation = orientations.length === 1;
    const orientation = orientations[0];

    const widths = selectedJointObjects.map((j) => {
      const cfg = wall.customJoints[j.id];
      return cfg !== undefined ? cfg.width : j.width;
    });
    const uniqueWidths = Array.from(new Set(widths));
    const sameWidth = uniqueWidths.length === 1;

    const ledStates = selectedJointObjects.map((j) => {
      const cfg = wall.customJoints[j.id];
      return cfg !== undefined ? cfg.isLED : j.isLED;
    });
    const uniqueLED = Array.from(new Set(ledStates));
    const sameLED = uniqueLED.length === 1;

    // Проверка коллинеарности: лежат ли швы на одной прямой (в продолжении друг друга)
    let isCollinear = false;
    const positions = selectedJointObjects.map((j) => (orientation === 'HORIZONTAL' ? j.y : j.x));

    if (sameOrientation) {
      if (orientation === 'HORIZONTAL') {
        const baseCoord = selectedJointObjects[0].y;
        isCollinear = selectedJointObjects.every((j) => Math.abs(j.y - baseCoord) <= 3);
      } else {
        const baseCoord = selectedJointObjects[0].x;
        isCollinear = selectedJointObjects.every((j) => Math.abs(j.x - baseCoord) <= 3);
      }
    }

    let errorMessage: string | undefined = undefined;
    if (!sameOrientation) {
      errorMessage = 'Выбраны швы разной ориентации (горизонтальный и вертикальный). Объединять можно только продолжения одной линии.';
    } else if (!isCollinear) {
      errorMessage = orientation === 'HORIZONTAL'
        ? `Швы находятся на разной высоте (Y = ${positions.map(Math.round).join(' мм, ')} мм). Они должны находиться на одной высоте.`
        : `Швы находятся на разных расстояниях (X = ${positions.map(Math.round).join(' мм, ')} мм). Они должны находиться на одной вертикальной линии.`;
    } else if (!sameWidth) {
      errorMessage = `Швы имеют разную толщину (${widths.join(' мм, ')} мм). Для объединения они должны иметь одинаковую толщину.`;
    } else if (!sameLED) {
      errorMessage = 'Швы имеют разный тип (у одного включена LED-подсветка, у другого — нет). Тип подсветки должен совпадать.';
    }

    const canMerge = sameOrientation && isCollinear && sameWidth && sameLED;

    return {
      canMerge,
      isCollinear,
      sameOrientation,
      sameWidth,
      sameLED,
      orientation,
      widths,
      ledStates,
      positions,
      errorMessage,
    };
  },

  // СОЕДИНЕНИЕ ВЫБРАННЫХ КОЛЛИНЕАРНЫХ ШВОВ В ЕДИНУЮ ЛИНИЮ
  mergeSelectedJoints: (wallId: string) => {
    const validation = get().validateSelectedJoints(wallId);
    if (!validation.canMerge) {
      return { success: false, error: validation.errorMessage };
    }

    set((state) => {
      const wall = state.project.walls.find((w) => w.id === wallId);
      if (!wall) return state;

      const nextCustomJoints = { ...wall.customJoints };
      const groupId = `group-joint-${Date.now()}`;
      const targetWidth = validation.widths[0] ?? DEFAULT_JOINT_GAP_MM;
      const targetLED = validation.ledStates[0] ?? false;
      const orientation = validation.orientation || 'HORIZONTAL';

      state.selectedJointIds.forEach((jId) => {
        const baseId = jId.split('-part-')[0].split('-merged-')[0];
        const currentTakeSide = nextCustomJoints[jId]?.takeSide || wall.joints?.find(j => j.id === jId)?.takeSide || 'BOTH';
        nextCustomJoints[jId] = {
          id: jId,
          orientation,
          width: targetWidth,
          isLED: targetLED,
          groupId,
          takeSide: currentTakeSide,
        };
        nextCustomJoints[baseId] = {
          id: baseId,
          orientation,
          width: targetWidth,
          isLED: targetLED,
          groupId,
          takeSide: currentTakeSide,
        };
      });

      return {
        selectedJointId: state.selectedJointIds[0] || null,
        project: {
          ...state.project,
          walls: state.project.walls.map((w) =>
            w.id === wallId ? { ...w, customJoints: nextCustomJoints } : w
          ),
        },
      };
    });

    return { success: true };
  },

  // РАЗЪЕДИНЕНИЕ ШВОВ ОБРАТНО НА ОТДЕЛЬНЫЕ СЕГМЕНТЫ
  unmergeJoints: (wallId: string, jointId: string) =>
    set((state) => {
      const wall = state.project.walls.find((w) => w.id === wallId);
      if (!wall) return state;

      const baseId = jointId.split('-part-')[0].split('-merged-')[0];
      const targetGroupId = wall.customJoints[jointId]?.groupId || wall.customJoints[baseId]?.groupId;
      const nextCustomJoints = { ...wall.customJoints };

      if (targetGroupId) {
        Object.keys(nextCustomJoints).forEach((k) => {
          if (nextCustomJoints[k]?.groupId === targetGroupId) {
            const { groupId: _, ...rest } = nextCustomJoints[k];
            nextCustomJoints[k] = rest as any;
          }
        });
      }

      return {
        selectedJointId: jointId,
        selectedJointIds: [jointId],
        project: {
          ...state.project,
          walls: state.project.walls.map((w) =>
            w.id === wallId ? { ...w, customJoints: nextCustomJoints } : w
          ),
        },
      };
    }),

  // СИНХРОНИЗАЦИЯ ПАРАМЕТРОВ ДЛЯ ВСЕХ ВЫБРАННЫХ ШВОВ
  syncSelectedJointsParams: (wallId: string, targetJointId?: string) =>
    set((state) => {
      const wall = state.project.walls.find((w) => w.id === wallId);
      if (!wall || state.selectedJointIds.length === 0) return state;

      const baseId = targetJointId || state.selectedJointIds[0];
      const baseConfig = wall.customJoints[baseId] || {
        id: baseId,
        orientation: baseId.includes('-v-') ? 'VERTICAL' : 'HORIZONTAL',
        width: 3,
        isLED: false,
        takeSide: 'BOTH',
      };

      const nextCustomJoints = { ...wall.customJoints };
      state.selectedJointIds.forEach((id) => {
        nextCustomJoints[id] = {
          ...(nextCustomJoints[id] || { id, orientation: baseConfig.orientation }),
          width: baseConfig.width,
          isLED: baseConfig.isLED,
          takeSide: baseConfig.takeSide,
        };
      });

      let nextWallJoints = wall.joints;
      if (nextWallJoints && nextWallJoints.length > 0) {
        nextWallJoints = nextWallJoints.map((j) => {
          if (state.selectedJointIds.includes(j.id)) {
            return {
              ...j,
              takeSide: baseConfig.takeSide,
            };
          }
          return j;
        });
      }

      return {
        project: {
          ...state.project,
          walls: state.project.walls.map((w) =>
            w.id === wallId ? { ...w, customJoints: nextCustomJoints, joints: nextWallJoints } : w
          ),
        },
      };
    }),

  setJointPresetForSelected: (wallId: string, preset: JointPreset) =>
    set((state) => {
      const wall = state.project.walls.find((w) => w.id === wallId);
      if (!wall || state.selectedJointIds.length === 0) return state;

      let width = DEFAULT_JOINT_GAP_MM;
      let isLED = false;
      let defaultProfileArticle: string | undefined = undefined;

      switch (preset) {
        case 'NONE':
          width = 0;
          isLED = false;
          defaultProfileArticle = undefined;
          break;
        case '7':
          width = 7;
          defaultProfileArticle = 'MC-06-7';
          break;
        case '3':
        case '0.8': // Legacy preset refers to metal thickness, not visible width.
          width = 3;
          isLED = false;
          defaultProfileArticle = 'MC-06';
          break;
        case '5':
          width = 5;
          isLED = false;
          defaultProfileArticle = 'EC-08';
          break;
        case '8':
          width = 8;
          isLED = false;
          defaultProfileArticle = 'MC-05';
          break;
        case '10':
          width = 10;
          isLED = false;
          defaultProfileArticle = 'DL-13';
          break;
        case 'LED_10':
          width = 10;
          isLED = true;
          defaultProfileArticle = 'DL-13';
          break;
      }

      const nextCustomJoints = { ...wall.customJoints };
      state.selectedJointIds.forEach((id) => {
        const orientation = id.includes('-v-') ? 'VERTICAL' : 'HORIZONTAL';
        nextCustomJoints[id] = {
          ...(nextCustomJoints[id] || { id }),
          orientation,
          width,
          isLED,
          profileArticle: defaultProfileArticle,
        };
      });

      let nextWallJoints = wall.joints;
      if (nextWallJoints && nextWallJoints.length > 0) {
        nextWallJoints = nextWallJoints.map((j) => {
          if (state.selectedJointIds.includes(j.id)) {
            return {
              ...j,
              width,
              isLED,
              profileArticle: defaultProfileArticle,
            };
          }
          return j;
        });
      }

      let nextPanels = wall.panels;
      if (nextPanels && nextPanels.length > 0) {
        state.selectedJointIds.forEach((jId) => {
          const targetJoint = findOrSynthesizeJoint({ ...wall, joints: nextWallJoints }, jId);
          const oldW = jointParameters(wall, jId).width;
          const currentTakeSide = nextCustomJoints[jId]?.takeSide || targetJoint?.takeSide;
          if (targetJoint) {
            const cascadeRes = PolygonSlicingEngine.cascadeChainJointWidthChange(
              nextPanels!,
              nextWallJoints || [],
              { ...targetJoint, takeSide: currentTakeSide },
              oldW,
              width,
              wall.width,
              wall.height,
              wall.openings
            );
            nextPanels = cascadeRes.panels;
            nextWallJoints = cascadeRes.joints;
          }
        });

        const valid = PolygonSlicingEngine.ensureValidPanelDimensions(
          { ...wall, panels: nextPanels, joints: nextWallJoints },
          state.project.materials
        );
        nextPanels = valid.panels;
        nextWallJoints = valid.joints;
      }

      return {
        project: {
          ...state.project,
          walls: state.project.walls.map((w) =>
            w.id === wallId ? { ...w, customJoints: nextCustomJoints, joints: nextWallJoints, panels: nextPanels } : w
          ),
        },
      };
    }),

  setJointProfileForSelected: (wallId: string, article: string, colorHex?: string) =>
    set(state => ({ project: { ...state.project, walls: state.project.walls.map(w => w.id === wallId
      ? assignJointProfile(w, state.selectedJointIds, article, colorHex) : w) } })),

  setJointColorForSelected: (wallId: string, colorHex: string) =>
    set((state) => {
      const wall = state.project.walls.find((w) => w.id === wallId);
      if (!wall || state.selectedJointIds.length === 0) return state;

      const nextCustomJoints = { ...wall.customJoints };
      state.selectedJointIds.forEach((id) => {
        if (nextCustomJoints[id]) {
          nextCustomJoints[id] = {
            ...nextCustomJoints[id],
            profileColor: colorHex,
          };
        }
      });

      let nextWallJoints = wall.joints;
      if (nextWallJoints && nextWallJoints.length > 0) {
        nextWallJoints = nextWallJoints.map((j) => {
          if (state.selectedJointIds.includes(j.id)) {
            return {
              ...j,
              profileColor: colorHex,
            };
          }
          return j;
        });
      }

      return {
        project: {
          ...state.project,
          walls: state.project.walls.map((w) =>
            w.id === wallId ? { ...w, customJoints: nextCustomJoints, joints: nextWallJoints } : w
          ),
        },
      };
    }),

  setJointWidthForSelected: (wallId: string, width: number) =>
    set((state) => {
      const wall = state.project.walls.find((w) => w.id === wallId);
      if (!wall || state.selectedJointIds.length === 0) return state;

      const clampedW = Math.max(0, width);
      const nextCustomJoints = { ...wall.customJoints };

      state.selectedJointIds.forEach((id) => {
        nextCustomJoints[id] = { ...jointParameters(wall, id), width: clampedW };
      });

      let nextWallJoints = wall.joints;
      if (nextWallJoints && nextWallJoints.length > 0) {
        nextWallJoints = nextWallJoints.map((j) => {
          if (state.selectedJointIds.includes(j.id)) {
            return { ...j, width: clampedW };
          }
          return j;
        });
      }

      let nextPanels = wall.panels;
      if (nextPanels && nextPanels.length > 0) {
        state.selectedJointIds.forEach((jId) => {
          const targetJoint = findOrSynthesizeJoint({ ...wall, joints: nextWallJoints }, jId);
          const oldW = jointParameters(wall, jId).width;
          const currentTakeSide = nextCustomJoints[jId]?.takeSide || targetJoint?.takeSide;
          if (targetJoint) {
            const cascadeRes = PolygonSlicingEngine.cascadeChainJointWidthChange(
              nextPanels!,
              nextWallJoints || [],
              { ...targetJoint, takeSide: currentTakeSide },
              oldW,
              clampedW,
              wall.width,
              wall.height,
              wall.openings
            );
            nextPanels = cascadeRes.panels;
            nextWallJoints = cascadeRes.joints;
          }
        });

        const valid = PolygonSlicingEngine.ensureValidPanelDimensions(
          { ...wall, panels: nextPanels, joints: nextWallJoints },
          state.project.materials
        );
        nextPanels = valid.panels;
        nextWallJoints = valid.joints;
      }

      return {
        project: {
          ...state.project,
          walls: state.project.walls.map((w) =>
            w.id === wallId ? { ...w, customJoints: nextCustomJoints, joints: nextWallJoints, panels: nextPanels } : w
          ),
        },
      };
    }),

  setJointTakeSideForSelected: (wallId: string, takeSide: 'BOTH' | 'LEFT' | 'RIGHT' | 'TOP' | 'BOTTOM') =>
    set((state) => {
      const wall = state.project.walls.find((w) => w.id === wallId);
      if (!wall || state.selectedJointIds.length === 0) return state;

      const nextCustomJoints = { ...wall.customJoints };
      state.selectedJointIds.forEach((id) => {
        const current = nextCustomJoints[id];
        nextCustomJoints[id] = {
          ...(current || {
            id,
            orientation: id.includes('-v-') ? 'VERTICAL' : 'HORIZONTAL',
            width: 3,
            isLED: false,
          }),
          takeSide,
        };
      });

      let nextWallJoints = wall.joints;
      if (nextWallJoints && nextWallJoints.length > 0) {
        nextWallJoints = nextWallJoints.map((j) => {
          if (state.selectedJointIds.includes(j.id)) {
            return {
              ...j,
              takeSide,
            };
          }
          return j;
        });
      }

      let nextPanels = wall.panels;
      if (nextPanels && nextPanels.length > 0) {
        state.selectedJointIds.forEach((jId) => {
          const targetJoint = findOrSynthesizeJoint(wall, jId);
          const jointW = wall.customJoints[jId]?.width ?? targetJoint?.width ?? 3;
          const oldTakeSide =
            wall.customJoints[jId]?.takeSide ||
            targetJoint?.takeSide ||
            (targetJoint
              ? PolygonSlicingEngine.getSmartJointTakeSide(targetJoint, wall.width, wall.height, wall.openings)
              : 'BOTH');

          if (targetJoint && oldTakeSide !== takeSide && jointW > 0) {
            const cascadeRes = PolygonSlicingEngine.cascadeChainJointTakeSideChange(
              nextPanels!,
              nextWallJoints || [],
              targetJoint,
              jointW,
              oldTakeSide,
              takeSide,
              wall.width,
              wall.height,
              wall.openings
            );
            nextPanels = cascadeRes.panels;
            nextWallJoints = cascadeRes.joints;
          }
        });

        const valid = PolygonSlicingEngine.ensureValidPanelDimensions(
          { ...wall, panels: nextPanels, joints: nextWallJoints },
          state.project.materials
        );
        nextPanels = valid.panels;
        nextWallJoints = valid.joints;
      }

      return {
        project: {
          ...state.project,
          walls: state.project.walls.map((w) =>
            w.id === wallId ? { ...w, customJoints: nextCustomJoints, joints: nextWallJoints, panels: nextPanels } : w
          ),
        },
      };
    }),

  setJointLEDForSelected: (wallId: string, isLED: boolean) =>
    set((state) => {
      const wall = state.project.walls.find((w) => w.id === wallId);
      if (!wall || state.selectedJointIds.length === 0) return state;

      const nextCustomJoints = { ...wall.customJoints };

      state.selectedJointIds.forEach((id) => {
        const current = nextCustomJoints[id] || {
          id,
          orientation: id.includes('-v-') ? 'VERTICAL' : 'HORIZONTAL',
          width: 3,
          isLED: false,
        };
        nextCustomJoints[id] = {
          ...current,
          width: isLED && current.width === 0 ? 10 : current.width,
          isLED,
        };
      });

      return {
        project: {
          ...state.project,
          walls: state.project.walls.map((w) =>
            w.id === wallId ? { ...w, customJoints: nextCustomJoints } : w
          ),
        },
      };
    }),

  // ОБЪЕДИНЕНИЕ ВЫБРАННЫХ ЧЕРЕЗ SHIFT ПАНЕЛЕЙ (С УЧЕТОМ МАКСИМУМА ЛИСТА + ОСТАТОК)
  mergeSelectedCells: (wallId: string) =>
    set((state) => {
      const wall = state.project.walls.find((w) => w.id === wallId);
      if (!wall || (state.selectedCellKeys.length < 2 && state.selectedPieceIds.length < 2)) return state;

      if (wall.panels && wall.panels.length > 0) {
        let targetIds = state.selectedPieceIds.length > 0
          ? state.selectedPieceIds
          : ([state.selectedSubPieceId].filter(Boolean) as string[]);

        if (targetIds.length < 2 && state.selectedCellKeys.length >= 2) {
          targetIds = state.selectedCellKeys;
        }

        if (targetIds.length >= 2) {
          const mergingPanels = wall.panels.filter((p) =>
            targetIds.some((tid) => p.id === tid || p.id.includes(tid))
          );

          if (mergingPanels.length >= 2) {
            // ПРАВИЛО: объединение работает ТОЛЬКО если все выбранные элементы примыкают друг к другу
            const areConnected = PolygonSlicingEngine.areAllPolygonsConnected(
              mergingPanels.map((p) => p.points),
              20
            );
            if (!areConnected) {
              return state;
            }

            const remainingPanels = wall.panels.filter(
              (p) => !mergingPanels.some((mp) => mp.id === p.id)
            );
            const mergedPoints = PolygonSlicingEngine.unionPolygons(
              mergingPanels.map((p) => p.points)
            );

            const baseMat = mergingPanels[0];
            const allSameMat = mergingPanels.every((p) => p.materialId === baseMat.materialId);

            const mergedPanel: WallPanelPiece = {
              ...baseMat,
              id: `panel-${Date.now()}-merged`,
              points: mergedPoints,
              materialId: allSameMat ? baseMat.materialId : (wall.zone.materialId || MATERIAL_NONE_ID),
              partLabel: allSameMat ? baseMat.partLabel : '1.1',
            };

            const nextPanels = [...remainingPanels, mergedPanel];

            // Bounding box объединенной панели
            const mXs = mergedPoints.map((p) => p.x);
            const mYs = mergedPoints.map((p) => p.y);
            const mMinX = Math.min(...mXs);
            const mMaxX = Math.max(...mXs);
            const mMinY = Math.min(...mYs);
            const mMaxY = Math.max(...mYs);

            const nextJoints = (wall.joints || []).filter((j) => {
              const midX = (j.p1.x + j.p2.x) / 2;
              const midY = (j.p1.y + j.p2.y) / 2;
              const isVert = Math.abs(j.p1.x - j.p2.x) < 1e-3;

              // 1. Проверяем, находятся ли точки по обе стороны шва внутри объединенного полигона
              let isInternal = false;

              if (isVert) {
                const inLeft =
                  PolygonSlicingEngine.isPointInPolygon({ x: midX - 3, y: midY }, mergedPoints) ||
                  mergingPanels.some((p) =>
                    PolygonSlicingEngine.isPointInPolygon({ x: midX - 3, y: midY }, p.points)
                  );
                const inRight =
                  PolygonSlicingEngine.isPointInPolygon({ x: midX + 3, y: midY }, mergedPoints) ||
                  mergingPanels.some((p) =>
                    PolygonSlicingEngine.isPointInPolygon({ x: midX + 3, y: midY }, p.points)
                  );
                if (inLeft && inRight) {
                  isInternal = true;
                }
              } else {
                const inBot =
                  PolygonSlicingEngine.isPointInPolygon({ x: midX, y: midY - 3 }, mergedPoints) ||
                  mergingPanels.some((p) =>
                    PolygonSlicingEngine.isPointInPolygon({ x: midX, y: midY - 3 }, p.points)
                  );
                const inTop =
                  PolygonSlicingEngine.isPointInPolygon({ x: midX, y: midY + 3 }, mergedPoints) ||
                  mergingPanels.some((p) =>
                    PolygonSlicingEngine.isPointInPolygon({ x: midX, y: midY + 3 }, p.points)
                  );
                if (inBot && inTop) {
                  isInternal = true;
                }
              }

              // 2. Проверяем, лежит ли шов строго внутри bounding box объединенной детали
              if (!isInternal) {
                if (isVert) {
                  if (midX > mMinX + 5 && midX < mMaxX - 5 && midY >= mMinY - 2 && midY <= mMaxY + 2) {
                    isInternal = true;
                  }
                } else {
                  if (midY > mMinY + 5 && midY < mMaxY - 5 && midX >= mMinX - 2 && midX <= mMaxX + 2) {
                    isInternal = true;
                  }
                }
              }

              return !isInternal;
            });

            return {
              selectedPieceIds: [mergedPanel.id],
              selectedSubPieceId: mergedPanel.id,
              selectedCellKeys: [],
              project: {
                ...state.project,
                walls: state.project.walls.map((w) =>
                  w.id === wallId ? { ...w, panels: nextPanels, joints: nextJoints } : w
                ),
              },
            };
          }
        }
      }

      const standardSeam = DEFAULT_PROFILES[wall.zone.jointProfileType]?.width ?? DEFAULT_JOINT_GAP_MM;

      // 0. ПРОВЕРЯЕМ, ВЫБРАНЫ ЛИ РАЗРЕЗАННЫЕ ДЕТАЛИ (subPieces)
      const selectedSubPieceIds = state.selectedPieceIds.filter(
        (pid) => pid.startsWith('panel-') && pid.split('-').length >= 4
      );

      if (selectedSubPieceIds.length >= 2 || (selectedSubPieceIds.length >= 1 && state.selectedPieceIds.length >= 2)) {
        // Группируем выбранные subPieces по ячейкам [columnIndex, segmentIndex]
        const cellMap = new Map<string, { colIdx: number; segIdx: number; subIds: string[] }>();
        selectedSubPieceIds.forEach((pid) => {
          const parts = pid.split('-');
          const cIdx = Number(parts[1]);
          const sIdx = Number(parts[2]);
          const subId = parts.slice(3).join('-');
          const key = `${cIdx}-${sIdx}`;
          if (!cellMap.has(key)) {
            cellMap.set(key, { colIdx: cIdx, segIdx: sIdx, subIds: [] });
          }
          cellMap.get(key)!.subIds.push(subId);
        });

        let didMergeAnySubs = false;
        const nextCustomPanels = { ...wall.customPanels };
        const nextCustomJoints = { ...wall.customJoints };
        let firstMergedSubId: string | null = null;

        cellMap.forEach(({ colIdx, segIdx, subIds }) => {
          const colConfig = nextCustomPanels[colIdx] || { columnIndex: colIdx, segments: [] };
          const segConfig = colConfig.segments?.[segIdx];
          const currentSubs = (segConfig?.subPieces || colConfig.subPieces || []);

          if (currentSubs.length > 0 && subIds.length >= 2) {
            didMergeAnySubs = true;
            // Если выбраны ВСЕ subPieces этой ячейки (или их осталось 0 после слияния) -> сбрасываем subPieces полностью!
            const remainingSubs = currentSubs.filter((s) => !subIds.includes(s.id));

            // Определяем материал/декор объединяемых деталей
            const mergingSubs = currentSubs.filter((s) => subIds.includes(s.id));
            const firstMatId = mergingSubs[0]?.materialId || colConfig.customMaterialId || wall.zone.materialId || MATERIAL_NONE_ID;
            const allSameMat = mergingSubs.every((s) => s.materialId === firstMatId && !s.isVoid);

            if (remainingSubs.length === 0) {
              // Полный сброс ячейки к монолитной панели
              if (colConfig.segments && colConfig.segments[segIdx]) {
                const nextSegs = [...colConfig.segments];
                nextSegs[segIdx] = {
                  ...nextSegs[segIdx],
                  subPieces: undefined,
                  customMaterialId: allSameMat ? firstMatId : nextSegs[segIdx].customMaterialId,
                  customColor: allSameMat ? mergingSubs[0]?.color : nextSegs[segIdx].customColor,
                  customDecorCode: allSameMat ? mergingSubs[0]?.decorCode : nextSegs[segIdx].customDecorCode,
                };
                nextCustomPanels[colIdx] = { ...colConfig, segments: nextSegs };
              } else {
                nextCustomPanels[colIdx] = {
                  ...colConfig,
                  subPieces: undefined,
                  customMaterialId: allSameMat ? firstMatId : colConfig.customMaterialId,
                  customColor: allSameMat ? mergingSubs[0]?.color : colConfig.customColor,
                  customDecorCode: allSameMat ? mergingSubs[0]?.decorCode : colConfig.customDecorCode,
                };
              }
            } else {
              // Если выбрана часть subPieces: ОБЪЕДИНЯЕМ ВЫБРАННЫЕ ПОЛИГОНЫ В ОДИН subPiece!
              const mergedPoints = PolygonSlicingEngine.unionPolygons(
                mergingSubs.map((s) => s.points)
              );
              const mergedArea =
                Math.round(
                  (PolygonSlicingEngine.calculatePolygonArea(mergedPoints) / 1_000_000) * 1000
                ) / 1000;
              const mergedSubPieceId = `sub-${Date.now()}-merged`;
              if (!firstMergedSubId) firstMergedSubId = mergedSubPieceId;

              const baseMat = mergingSubs[0];
              const mergedPiece: PolygonSubPiece = {
                id: mergedSubPieceId,
                points: mergedPoints,
                materialId: allSameMat ? firstMatId : baseMat.materialId,
                decorCode: allSameMat ? baseMat.decorCode : baseMat.decorCode,
                decorName: allSameMat ? baseMat.decorName : baseMat.decorName,
                color: allSameMat ? baseMat.color : baseMat.color,
                thickness: baseMat.thickness,
                reliefType: baseMat.reliefType,
                textureCategory: baseMat.textureCategory,
                textureMapping: baseMat.textureMapping,
                patternAngleDeg: baseMat.patternAngleDeg,
                patternFlipX: baseMat.patternFlipX,
                isVoid: allSameMat && baseMat.isVoid,
                areaSqM: mergedArea,
              };

              const combinedSubs = [...remainingSubs, mergedPiece];
              const baseLabel = `${colIdx + 1}.${segIdx + 1}`;
              const updatedSubPieces = combinedSubs.map((sp, idx) => ({
                ...sp,
                partLabel: sp.isVoid || sp.materialId === MATERIAL_NONE_ID
                  ? 'ПУСТО'
                  : (combinedSubs.length > 1 ? `${baseLabel}.${idx + 1}` : baseLabel),
              }));

              if (colConfig.segments && colConfig.segments[segIdx]) {
                const nextSegs = [...colConfig.segments];
                nextSegs[segIdx] = {
                  ...nextSegs[segIdx],
                  subPieces: updatedSubPieces,
                };
                nextCustomPanels[colIdx] = { ...colConfig, segments: nextSegs };
              } else {
                nextCustomPanels[colIdx] = {
                  ...colConfig,
                  subPieces: updatedSubPieces,
                };
              }
            }

            // Удаляем все стыки раскроя между объединяемыми деталями
            Object.keys(nextCustomJoints).forEach((jKey) => {
              if (jKey.startsWith(`edge-cut-${colIdx}-${segIdx}-`)) {
                delete nextCustomJoints[jKey];
              }
            });
          }
        });

        if (didMergeAnySubs) {
          const firstKey = Array.from(cellMap.keys())[0] || '0-0';
          const [c, s] = firstKey.split('-').map(Number);
          const newPieceId = firstMergedSubId
            ? `panel-${c}-${s}-${firstMergedSubId}`
            : `panel-${c}-${s}`;

          return {
            selectedSubPieceId: firstMergedSubId,
            selectedColumnIndex: c,
            selectedSegmentIndex: s,
            selectedCellKeys: [firstKey],
            selectedPieceIds: [newPieceId],
            project: {
              ...state.project,
              walls: state.project.walls.map((w) =>
                w.id === wallId
                  ? { ...w, customPanels: nextCustomPanels, customJoints: nextCustomJoints }
                  : w
              ),
            },
          };
        }
      }

      // 1. Парсим координаты всех выбранных ячеек
      const coords: SelectedCellCoord[] = state.selectedCellKeys.map((k) => {
        const [c, s] = k.split('-').map(Number);
        return { columnIndex: c, segmentIndex: s };
      });

      // 2. Определяем материал каждой выбранной ячейки
      const cellMaterials = coords.map((c) => {
        const colConfig = wall.customPanels[c.columnIndex];
        const segConfig = colConfig?.segments?.[c.segmentIndex];
        return (
          segConfig?.customMaterialId ||
          colConfig?.customMaterialId ||
          wall.zone.materialId ||
          MATERIAL_NONE_ID
        );
      });

      const uniqueMaterials = Array.from(new Set(cellMaterials));
      const areMaterialsIdentical = uniqueMaterials.length === 1 && uniqueMaterials[0] !== MATERIAL_NONE_ID;
      const resultMaterialId = areMaterialsIdentical ? uniqueMaterials[0] : MATERIAL_NONE_ID;
      const isVoidResult = resultMaterialId === MATERIAL_NONE_ID || uniqueMaterials.every((m) => m === MATERIAL_NONE_ID || m === 'mat-none');

      // Габариты материала (для пустоты ограничений нет)
      const material = state.project.materials.find((m) => m.id === resultMaterialId);
      const maxMatWidth = isVoidResult ? Infinity : (material && !material.isVoid ? material.width : 1220);
      const maxMatHeight = isVoidResult ? Infinity : (material && !material.isVoid ? material.height : 2800);

      const uniqueColumns = Array.from(new Set(coords.map((c) => c.columnIndex))).sort((a, b) => a - b);
      const nextCustomPanels = { ...wall.customPanels };
      const nextCustomJoints = { ...wall.customJoints };

      // =========================================================================
      // СЛУЧАЙ 1: Все выбранные ячейки в ОДНОЙ колонке (объединение по вертикали)
      // =========================================================================
      if (uniqueColumns.length === 1) {
        const colIdx = uniqueColumns[0];
        const panelConfig = nextCustomPanels[colIdx] || { columnIndex: colIdx, segments: [] };
        const segments = [...(panelConfig.segments || [])];

        const selectedSegIndices = coords.map((c) => c.segmentIndex).sort((a, b) => a - b);
        const minSegIdx = selectedSegIndices[0];

        // Суммируем высоты выбранных сегментов + промежуточные швы
        let combinedHeight = 0;
        selectedSegIndices.forEach((sIdx, i) => {
          const segH = segments[sIdx]?.height ?? Math.round(wall.height / Math.max(1, segments.length));
          const jointKey = `edge-h-${colIdx}-${sIdx}`;
          const seamH = i < selectedSegIndices.length - 1 ? (nextCustomJoints[jointKey]?.width ?? standardSeam) : 0;
          combinedHeight += segH + seamH;

          // Удаляем промежуточный горизонтальный шов
          delete nextCustomJoints[jointKey];
        });

        if (isVoidResult || combinedHeight <= maxMatHeight) {
          // Пустота или укладывается в один лист: 1 цельный сегмент
          segments.splice(minSegIdx, selectedSegIndices.length, {
            id: `seg-${Date.now()}-merged`,
            height: combinedHeight >= wall.height ? undefined : combinedHeight,
            customMaterialId: isVoidResult ? MATERIAL_NONE_ID : resultMaterialId,
            partLabel: isVoidResult ? 'ПУСТО' : undefined,
          });
        } else {
          // Материал превышает maxMatHeight: пакуем полные высоты + остаток
          const newSegments: PanelSegmentConfig[] = [];
          let remH = combinedHeight;
          let segCount = 0;

          while (remH > 0) {
            const isLast = remH <= maxMatHeight;
            const currentH = isLast ? remH : maxMatHeight;
            const segId = `seg-${Date.now()}-${segCount}`;

            newSegments.push({
              id: segId,
              height: currentH,
              customMaterialId: resultMaterialId,
            });

            remH -= currentH;
            if (remH > 0) {
              remH -= standardSeam;
              const jointKey = `edge-h-${colIdx}-${minSegIdx + segCount}`;
              nextCustomJoints[jointKey] = {
                id: jointKey,
                orientation: 'HORIZONTAL',
                width: standardSeam,
                isLED: false,
              };
            }
            segCount++;
          }

          segments.splice(minSegIdx, selectedSegIndices.length, ...newSegments);
        }

        nextCustomPanels[colIdx] = {
          ...panelConfig,
          segments: segments.length <= 1 && segments[0]?.height === undefined ? undefined : segments,
        };

        return {
          selectedColumnIndex: colIdx,
          selectedSegmentIndex: minSegIdx,
          selectedCellKeys: [`${colIdx}-${minSegIdx}`],
          selectedPieceIds: [`panel-${colIdx}-${minSegIdx}`],
          project: {
            ...state.project,
            walls: state.project.walls.map((w) =>
              w.id === wallId ? { ...w, customPanels: nextCustomPanels, customJoints: nextCustomJoints } : w
            ),
          },
        };
      }

      // =========================================================================
      // СЛУЧАЙ 2: Выбраны смежные колонки (объединение по горизонтали)
      // =========================================================================
      const minColIdx = uniqueColumns[0];
      const maxColIdx = uniqueColumns[uniqueColumns.length - 1];
      const numRemoved = uniqueColumns.length - 1;
      let combinedWidth = 0;

      uniqueColumns.forEach((cIdx, i) => {
        const colConfig = wall.customPanels[cIdx];
        const colW = colConfig?.customWidth ?? 1220;
        const seamW = i < uniqueColumns.length - 1 ? (wall.customJoints[`edge-v-${cIdx}`]?.width ?? standardSeam) : 0;
        combinedWidth += colW + seamW;
      });

      if (isVoidResult || combinedWidth <= maxMatWidth) {
        // Пустота или укладывается в 1 лист: сдвигаем все последующие колонки
        const shiftedPanels: Record<number, CustomPanelConfig> = {};
        const shiftedJoints: Record<string, JointEdgeConfig> = {};

        // 1. Колонки до minColIdx
        Object.entries(wall.customPanels).forEach(([kStr, conf]) => {
          const k = Number(kStr);
          if (k < minColIdx) {
            shiftedPanels[k] = conf;
          } else if (k > maxColIdx) {
            shiftedPanels[k - numRemoved] = {
              ...conf,
              columnIndex: k - numRemoved,
            };
          }
        });

        // 2. Новая объединенная колонка
        shiftedPanels[minColIdx] = {
          columnIndex: minColIdx,
          customWidth: combinedWidth,
          customMaterialId: isVoidResult ? MATERIAL_NONE_ID : resultMaterialId,
          segments: undefined,
        };

        // 3. Вертикальные стыки
        Object.entries(wall.customJoints).forEach(([jKey, jConfig]) => {
          if (jKey.startsWith('edge-v-') && !jKey.includes('left') && !jKey.includes('right') && !jKey.includes('end')) {
            const cIdx = Number(jKey.replace('edge-v-', ''));
            if (!isNaN(cIdx)) {
              if (cIdx < minColIdx) {
                shiftedJoints[jKey] = jConfig;
              } else if (cIdx >= minColIdx && cIdx < maxColIdx) {
                // Внутренний стык между объединяемыми колонками удален
              } else if (cIdx >= maxColIdx) {
                const newKey = `edge-v-${cIdx - numRemoved}`;
                shiftedJoints[newKey] = {
                  ...jConfig,
                  id: newKey,
                };
              }
              return;
            }
          }
          shiftedJoints[jKey] = jConfig;
        });

        return {
          selectedColumnIndex: minColIdx,
          selectedSegmentIndex: 0,
          selectedCellKeys: [`${minColIdx}-0`],
          selectedPieceIds: [`panel-${minColIdx}-0`],
          project: {
            ...state.project,
            walls: state.project.walls.map((w) =>
              w.id === wallId ? { ...w, customPanels: shiftedPanels, customJoints: shiftedJoints } : w
            ),
          },
        };
      } else {
        // Материал превышает maxMatWidth (1220 мм): пакуем максимальные листы + остаток
        let remW = combinedWidth;
        let colOffset = 0;

        while (remW > 0) {
          const isLast = remW <= maxMatWidth;
          const currentW = isLast ? remW : maxMatWidth;
          const targetColIdx = minColIdx + colOffset;

          nextCustomPanels[targetColIdx] = {
            columnIndex: targetColIdx,
            customWidth: currentW,
            customMaterialId: resultMaterialId,
            segments: undefined,
          };

          remW -= currentW;
          if (remW > 0) {
            remW -= standardSeam;
            const jointKey = `edge-v-${targetColIdx}`;
            nextCustomJoints[jointKey] = {
              id: jointKey,
              orientation: 'VERTICAL',
              width: standardSeam,
              isLED: false,
            };
          }
          colOffset++;
        }

        return {
          selectedColumnIndex: minColIdx,
          selectedSegmentIndex: 0,
          selectedCellKeys: [`${minColIdx}-0`],
          selectedPieceIds: [`panel-${minColIdx}-0`],
          project: {
            ...state.project,
            walls: state.project.walls.map((w) =>
              w.id === wallId ? { ...w, customPanels: nextCustomPanels, customJoints: nextCustomJoints } : w
            ),
          },
        };
      }
    }),

  // МАССОВОЕ НАЗНАЧЕНИЕ МАТЕРИАЛА ВСЕМ ВЫБРАННЫМ БЛОКАМ
  setMaterialForSelectedCells: (wallId: string, materialId: string) =>
    set((state) => {
      const wall = state.project.walls.find((w) => w.id === wallId);
      if (!wall || state.selectedCellKeys.length === 0) return state;

      const targetMaterial = state.project.materials.find((m) => m.id === materialId);
      const isVoidMat = materialId === MATERIAL_NONE_ID || targetMaterial?.isVoid;

      if (wall.panels && wall.panels.length > 0) {
        let nextPanels = [...wall.panels];
        let nextJoints = [...(wall.joints || [])];

        const targetIds = state.selectedPieceIds.length > 0
          ? state.selectedPieceIds
          : ([state.selectedSubPieceId].filter(Boolean) as string[]);

        nextPanels = nextPanels.flatMap((p, idx) => {
          const isMatch =
            targetIds.includes(p.id) ||
            (targetIds.length === 0 && (state.selectedCellKeys.includes(`0-${idx}`) || state.selectedCellKeys.length === 0));
          if (!isMatch) return [p];

          let points = p.points;
          if (wall.panels && wall.panels.length === 1) {
            points = [
              { x: 0, y: 0 },
              { x: wall.width, y: 0 },
              { x: wall.width, y: wall.height },
              { x: 0, y: wall.height },
            ];
          }

          const updated: WallPanelPiece = {
            ...p,
            points,
            materialId,
            isVoid: isVoidMat,
            color: targetMaterial?.color || p.color,
            decorCode: targetMaterial?.decorCode || p.decorCode,
            decorName: isVoidMat ? 'Без материала' : (targetMaterial?.decorName || p.decorName),
            thickness: targetMaterial?.thickness || p.thickness,
            textureCategory: (targetMaterial?.textureCategory as any) || p.textureCategory,
            reliefType: (targetMaterial?.reliefType as any) || p.reliefType,
            partLabel: isVoidMat ? 'ПУСТО' : (p.partLabel === 'ПУСТО' ? '1.1' : p.partLabel),
          };

          return [updated];
        });

        if (wall.openings && wall.openings.length > 0) {
          const sanitized = PolygonSlicingEngine.subtractOpeningsFromWallPanels(
            nextPanels,
            nextJoints,
            wall.openings
          );
          nextPanels = sanitized.panels;
          nextJoints = sanitized.joints;
        }

        return {
          project: {
            ...state.project,
            walls: state.project.walls.map((w) =>
              w.id === wallId ? { ...w, panels: nextPanels, joints: nextJoints } : w
            ),
          },
        };
      }

      if (state.selectedSubPieceId) {
        const subId = state.selectedSubPieceId;
        const nextCustomPanels = { ...wall.customPanels };
        const updateSubs = (subs?: PolygonSubPiece[]) => {
          if (!subs) return subs;
          return subs.map((s) => {
            const isMatch =
              (subId && s.id === subId) ||
              state.selectedPieceIds.some((pId) => pId.includes(s.id));

            if (isMatch) {
              return {
                ...s,
                materialId,
                isVoid: isVoidMat,
                color: targetMaterial?.color || s.color,
                decorCode: targetMaterial?.decorCode || s.decorCode,
                decorName: isVoidMat ? 'Без материала' : (targetMaterial?.decorName || s.decorName),
                thickness: targetMaterial?.thickness || s.thickness,
                textureCategory: (targetMaterial?.textureCategory as any) || s.textureCategory,
                reliefType: (targetMaterial?.reliefType as any) || s.reliefType,
                partLabel: isVoidMat ? 'ПУСТО' : s.partLabel,
              };
            }
            return s;
          });
        };

        state.selectedCellKeys.forEach((key) => {
          const [cIdx, sIdx] = key.split('-').map(Number);
          const currentCustom = nextCustomPanels[cIdx] || { columnIndex: cIdx, segments: [] };
          if (currentCustom.segments && currentCustom.segments[sIdx]) {
            const nextSegs = [...currentCustom.segments];
            nextSegs[sIdx] = {
              ...nextSegs[sIdx],
              subPieces: updateSubs(nextSegs[sIdx].subPieces),
            };
            nextCustomPanels[cIdx] = { ...currentCustom, segments: nextSegs };
          } else {
            nextCustomPanels[cIdx] = { ...currentCustom, subPieces: updateSubs(currentCustom.subPieces) };
          }
        });

        return {
          project: {
            ...state.project,
            walls: state.project.walls.map((w) =>
              w.id === wallId ? { ...w, customPanels: nextCustomPanels } : w
            ),
          },
        };
      }

      const nextCustomPanels = { ...wall.customPanels };

      state.selectedCellKeys.forEach((key) => {
        const [cIdx, sIdx] = key.split('-').map(Number);
        const currentCustom = nextCustomPanels[cIdx] || { columnIndex: cIdx, segments: [] };
        const segments = [...(currentCustom.segments || [])];
        const hasSegments = segments.length > 0 || sIdx > 0;

        while (segments.length <= sIdx && hasSegments) {
          segments.push({ id: `seg-${Date.now()}-${segments.length}` });
        }

        if (!hasSegments) {
          nextCustomPanels[cIdx] = {
            ...currentCustom,
            customMaterialId: materialId,
          };
        } else {
          segments[sIdx] = {
            ...segments[sIdx],
            customMaterialId: materialId,
          };
          nextCustomPanels[cIdx] = {
            ...currentCustom,
            segments,
          };
        }
      });

      return {
        project: {
          ...state.project,
          walls: state.project.walls.map((w) =>
            w.id === wallId ? { ...w, customPanels: nextCustomPanels } : w
          ),
        },
      };
    }),

  addWall: (name?: string, roomName?: string) =>
    set((state) => {
      const nextIndex = state.project.walls.length + 1;
      const currentWall = state.project.walls.find((w) => w.id === state.project.selectedWallId);
      const defaultRoom = roomName !== undefined ? roomName : currentWall?.roomName;
      const newWall = createDefaultWall(`wall-${Date.now()}`, name || `Стена ${nextIndex}`, defaultRoom);
      return {
        selectedColumnIndex: null,
        selectedSegmentIndex: null,
        selectedCellKeys: [],
        selectedPieceIds: [],
        selectedJointId: null,
        selectedJointIds: [],
        isDirty: true,
        project: {
          ...state.project,
          walls: [...state.project.walls, newWall],
          selectedWallId: newWall.id,
          selectedOpeningId: null,
        },
      };
    }),

  updateWallName: (wallId: string, name: string) =>
    set((state) => ({
      isDirty: true,
      project: {
        ...state.project,
        walls: state.project.walls.map((w) =>
          w.id === wallId ? { ...w, name } : w
        ),
      },
    })),

  updateWallRoom: (wallId: string, roomName: string) =>
    set((state) => ({
      isDirty: true,
      project: {
        ...state.project,
        walls: state.project.walls.map((w) =>
          w.id === wallId ? { ...w, roomName } : w
        ),
      },
    })),

  updateWall: (wallId: string, updates: Partial<Wall>) =>
    set((state) => ({
      isDirty: true,
      project: {
        ...state.project,
        walls: state.project.walls.map((w) =>
          w.id === wallId ? { ...w, ...updates } : w
        ),
      },
    })),

  updateWallDimensions: (wallId: string, width: number, height: number) =>
    set((state) => ({
      isDirty: true,
      project: {
        ...state.project,
        walls: state.project.walls.map((w) => {
          if (w.id !== wallId) return w;
          const newW = typeof width === 'number' ? Math.max(0, width) : 0;
          const newH = typeof height === 'number' ? Math.max(0, height) : 0;
          const oldW = w.width || 3600;
          const oldH = w.height || 2750;

          let nextPanels = w.panels;
          if (nextPanels && nextPanels.length > 0) {
            if (nextPanels.length === 1) {
              // Если на стене 1 цельная панель (пустая или сплошная)
              nextPanels = [
                {
                  ...nextPanels[0],
                  points: [
                    { x: 0, y: 0 },
                    { x: newW, y: 0 },
                    { x: newW, y: newH },
                    { x: 0, y: newH },
                  ],
                },
              ];
            } else {
              // Множество нарезанных панелей: корректируем граничные точки
              nextPanels = nextPanels.map((p) => {
                const nextPoints = p.points.map((pt) => {
                  let px = pt.x;
                  let py = pt.y;
                  if (Math.abs(px - oldW) < 5) {
                    px = newW;
                  } else {
                    px = Math.min(newW, px);
                  }
                  if (Math.abs(py - oldH) < 5) {
                    py = newH;
                  } else {
                    py = Math.min(newH, py);
                  }
                  return { x: px, y: py };
                });
                return {
                  ...p,
                  points: nextPoints,
                };
              });
            }
          }

          let nextJoints = w.joints;
          if (nextJoints && nextJoints.length > 0) {
            nextJoints = nextJoints.map((j) => {
              const adjustPt = (pt: Point2D) => {
                let px = pt.x;
                let py = pt.y;
                if (Math.abs(px - oldW) < 5) px = newW;
                else px = Math.min(newW, px);
                if (Math.abs(py - oldH) < 5) py = newH;
                else py = Math.min(newH, py);
                return { x: px, y: py };
              };
              return {
                ...j,
                p1: adjustPt(j.p1),
                p2: adjustPt(j.p2),
              };
            });
          }

          return {
            ...w,
            width: newW,
            height: newH,
            panels: nextPanels,
            joints: nextJoints,
          };
        }),
      },
    })),

  setWallMaterial: (
    wallId: string,
    materialId: string,
    decor?: AllWallDecor | { code?: string; color?: string; name?: string; category?: any }
  ) =>
    set((state) => {
      const targetMat = state.project.materials.find((m) => m.id === materialId);
      const chosenDecor = decor || (targetMat?.availableDecors ? targetMat.availableDecors[0] : undefined);

      const nextMaterials = state.project.materials.map((m) => {
        if (m.id === materialId && chosenDecor) {
          return {
            ...m,
            color: chosenDecor.color || m.color,
            decorCode: chosenDecor.code || m.decorCode,
            decorName: chosenDecor.name || m.decorName,
            ...(chosenDecor.category ? { textureCategory: chosenDecor.category } : {}),
          };
        }
        return m;
      });

      const isVoid = targetMat?.isVoid ?? (materialId === MATERIAL_NONE_ID);

      return {
        selectedColumnIndex: null,
        selectedSegmentIndex: null,
        selectedCellKeys: [],
        selectedPieceIds: [],
        selectedJointId: null,
        selectedJointIds: [],
        project: {
          ...state.project,
          materials: nextMaterials,
          walls: state.project.walls.map((w) => {
            if (w.id !== wallId) return w;

            let nextPanels = w.panels;
            let nextJoints = w.joints ? [...w.joints] : [];

            if (isVoid) {
              nextPanels = [
                {
                  id: `panel-${w.id}-0`,
                  points: [
                    { x: 0, y: 0 },
                    { x: w.width, y: 0 },
                    { x: w.width, y: w.height },
                    { x: 0, y: w.height },
                  ],
                  materialId: MATERIAL_NONE_ID,
                  isVoid: true,
                  partLabel: 'ПУСТО',
                },
              ];
              nextJoints = [];
            } else if (nextPanels && nextPanels.length > 0) {
              nextPanels = nextPanels.map((p, pIdx) => ({
                ...p,
                materialId,
                decorCode: chosenDecor?.code || targetMat?.decorCode,
                decorName: chosenDecor?.name || targetMat?.decorName,
                color: chosenDecor?.color || targetMat?.color,
                thickness: targetMat?.thickness || 5,
                reliefType: targetMat?.reliefType || 'FLAT',
                textureCategory: chosenDecor?.category || targetMat?.textureCategory || 'WOOD',
                isVoid: false,
                partLabel: p.partLabel === 'ПУСТО' ? `1.${pIdx + 1}` : p.partLabel,
              }));
            } else {
              const basePanel: WallPanelPiece = {
                id: `panel-${w.id}-0`,
                points: [
                  { x: 0, y: 0 },
                  { x: w.width, y: 0 },
                  { x: w.width, y: w.height },
                  { x: 0, y: w.height },
                ],
                materialId,
                decorCode: chosenDecor?.code || targetMat?.decorCode,
                decorName: chosenDecor?.name || targetMat?.decorName,
                color: chosenDecor?.color || targetMat?.color,
                thickness: targetMat?.thickness || 5,
                reliefType: targetMat?.reliefType || 'FLAT',
                textureCategory: chosenDecor?.category || targetMat?.textureCategory || 'WOOD',
                isVoid: false,
                partLabel: '1.1',
              };
              nextPanels = [basePanel];
              nextJoints = [];
            }

            if (w.openings && w.openings.length > 0) {
              const sanitized = PolygonSlicingEngine.subtractOpeningsFromWallPanels(
                nextPanels,
                nextJoints,
                w.openings
              );
              nextPanels = sanitized.panels;
              nextJoints = sanitized.joints;
            }

            return {
              ...w,
              customPanels: {},
              customJoints: {},
              panels: nextPanels,
              joints: nextJoints,
              zone: { ...w.zone, materialId },
            };
          }),
        },
      };
    }),

  setWallJointProfile: (wallId: string, profileType: ProfileType) =>
    set((state) => ({
      project: {
        ...state.project,
        walls: state.project.walls.map((w) =>
          w.id === wallId ? { ...w, zone: { ...w.zone, jointProfileType: profileType } } : w
        ),
      },
    })),


  setJointTakeSide: (wallId: string, jointId: string, takeSide: 'BOTH' | 'LEFT' | 'RIGHT' | 'TOP' | 'BOTTOM') =>
    set((state) => ({
      project: {
        ...state.project,
        walls: state.project.walls.map((w) => {
          if (w.id !== wallId) return w;
          const baseId = jointId.split('-part-')[0].split('-merged-')[0];
          const targetGroupId = w.customJoints[jointId]?.groupId || w.customJoints[baseId]?.groupId;
          const nextJoints = { ...w.customJoints };

          if (targetGroupId) {
            Object.keys(nextJoints).forEach((k) => {
              if (nextJoints[k]?.groupId === targetGroupId) {
                nextJoints[k] = {
                  ...nextJoints[k],
                  takeSide,
                };
              }
            });
          } else {
            const current = nextJoints[jointId] || {
              id: jointId,
              orientation: jointId.includes('-v-') ? 'VERTICAL' : 'HORIZONTAL',
              width: 3,
              isLED: false,
            };
            nextJoints[jointId] = {
              ...current,
              takeSide,
            };
          }

          let nextWallJoints = w.joints;
          if (nextWallJoints && nextWallJoints.length > 0) {
            nextWallJoints = nextWallJoints.map((j) => {
              if (j.id === jointId || (targetGroupId && (w.customJoints[j.id]?.groupId === targetGroupId || j.groupId === targetGroupId))) {
                return {
                  ...j,
                  takeSide,
                };
              }
              return j;
            });
          }

          let nextPanels = w.panels;
          const targetJoint = findOrSynthesizeJoint(w, jointId);
          const jointW = w.customJoints[jointId]?.width ?? targetJoint?.width ?? DEFAULT_JOINT_GAP_MM;
          const oldTakeSide =
            w.customJoints[jointId]?.takeSide ||
            targetJoint?.takeSide ||
            (targetJoint
              ? PolygonSlicingEngine.getSmartJointTakeSide(targetJoint, w.width, w.height, w.openings)
              : 'BOTH');

          if (nextPanels && nextPanels.length > 0 && targetJoint && oldTakeSide !== takeSide && jointW > 0) {
            const cascadeRes = PolygonSlicingEngine.cascadeChainJointTakeSideChange(
              nextPanels,
              nextWallJoints || [],
              targetJoint,
              jointW,
              oldTakeSide,
              takeSide,
              w.width,
              w.height,
              w.openings
            );
            nextPanels = cascadeRes.panels;
            nextWallJoints = cascadeRes.joints;

            const valid = PolygonSlicingEngine.ensureValidPanelDimensions(
              { ...w, panels: nextPanels, joints: nextWallJoints },
              state.project.materials
            );
            nextPanels = valid.panels;
            nextWallJoints = valid.joints;
          }

          return { ...w, customJoints: nextJoints, joints: nextWallJoints, panels: nextPanels };
        }),
      },
    })),

  setJointWidth: (wallId: string, jointId: string, width: number) =>
    set((state) => ({
      project: {
        ...state.project,
        walls: state.project.walls.map((w) => {
          if (w.id !== wallId) return w;
          const baseId = jointId.split('-part-')[0].split('-merged-')[0];
          const targetGroupId = w.customJoints[jointId]?.groupId || w.customJoints[baseId]?.groupId;
          const nextJoints = { ...w.customJoints };
          const clamped = Math.max(0, width);

          const updateJointItem = (id: string) => ({ ...jointParameters(w, id), width: clamped });

          if (targetGroupId) {
            Object.keys(nextJoints).forEach((k) => {
              if (nextJoints[k]?.groupId === targetGroupId) {
                nextJoints[k] = updateJointItem(k);
              }
            });
          } else {
            nextJoints[jointId] = updateJointItem(jointId);
          }

          let nextWallJoints = w.joints;
          if (nextWallJoints && nextWallJoints.length > 0) {
            nextWallJoints = nextWallJoints.map((j) => {
              if (j.id === jointId || (targetGroupId && (w.customJoints[j.id]?.groupId === targetGroupId || j.groupId === targetGroupId))) {
                return { ...j, width: clamped };
              }
              return j;
            });
          }

          let nextPanels = w.panels;
          const targetJoint = findOrSynthesizeJoint(w, jointId);
          const oldW = w.customJoints[jointId]?.width ?? targetJoint?.width ?? DEFAULT_JOINT_GAP_MM;
          const currentTakeSide = nextJoints[jointId]?.takeSide || targetJoint?.takeSide;

          if (nextPanels && nextPanels.length > 0 && targetJoint) {
            const cascadeRes = PolygonSlicingEngine.cascadeChainJointWidthChange(
              nextPanels,
              nextWallJoints || [],
              { ...targetJoint, takeSide: currentTakeSide },
              oldW,
              clamped,
              w.width,
              w.height,
              w.openings
            );
            nextPanels = cascadeRes.panels;
            nextWallJoints = cascadeRes.joints;

            const valid = PolygonSlicingEngine.ensureValidPanelDimensions(
              { ...w, panels: nextPanels, joints: nextWallJoints },
              state.project.materials
            );
            nextPanels = valid.panels;
            nextWallJoints = valid.joints;
          }

          return { ...w, customJoints: nextJoints, joints: nextWallJoints, panels: nextPanels };
        }),
      },
    })),

  setJointLED: (wallId: string, jointId: string, isLED: boolean) =>
    set((state) => ({
      project: {
        ...state.project,
        walls: state.project.walls.map((w) => {
          if (w.id !== wallId) return w;
          const baseId = jointId.split('-part-')[0].split('-merged-')[0];
          const targetGroupId = w.customJoints[jointId]?.groupId || w.customJoints[baseId]?.groupId;
          const nextJoints = { ...w.customJoints };

          if (targetGroupId) {
            Object.keys(nextJoints).forEach((k) => {
              if (nextJoints[k]?.groupId === targetGroupId) {
                const cur = nextJoints[k];
                nextJoints[k] = {
                  ...cur,
                  width: isLED && cur.width === 0 ? 10 : cur.width,
                  isLED,
                };
              }
            });
          } else {
            const current = nextJoints[jointId] || {
              id: jointId,
              orientation: jointId.includes('-v-') ? 'VERTICAL' : 'HORIZONTAL',
              width: 3,
              isLED: false,
            };
            nextJoints[jointId] = {
              ...current,
              width: isLED && current.width === 0 ? 10 : current.width,
              isLED,
            };
          }

          let nextWallJoints = w.joints;
          if (nextWallJoints && nextWallJoints.length > 0) {
            nextWallJoints = nextWallJoints.map((j) => {
              if (j.id === jointId || (targetGroupId && (w.customJoints[j.id]?.groupId === targetGroupId || j.groupId === targetGroupId))) {
                return {
                  ...j,
                  width: isLED && j.width === 0 ? 10 : j.width,
                  isLED,
                };
              }
              return j;
            });
          }

          return { ...w, customJoints: nextJoints, joints: nextWallJoints };
        }),
      },
    })),

  setJointPreset: (wallId: string, jointId: string, preset: JointPreset) =>
    set((state) => ({
      project: {
        ...state.project,
        walls: state.project.walls.map((w) => {
          if (w.id !== wallId) return w;
          const baseId = jointId.split('-part-')[0].split('-merged-')[0];
          const targetGroupId = w.customJoints[jointId]?.groupId || w.customJoints[baseId]?.groupId;
          const orientation = jointId.includes('-v-') ? 'VERTICAL' : 'HORIZONTAL';

          let width = DEFAULT_JOINT_GAP_MM;
          let isLED = false;
          let defaultProfileArticle: string | undefined = undefined;

          switch (preset) {
            case 'NONE':
              width = 0;
              isLED = false;
              defaultProfileArticle = undefined;
              break;
            case '7':
              width = 7;
              defaultProfileArticle = 'MC-06-7';
              break;
            case '3':
            case '0.8': // Legacy metal-thickness preset.
              width = 3;
              isLED = false;
              defaultProfileArticle = 'MC-06';
              break;
            case '5':
              width = 5;
              isLED = false;
              defaultProfileArticle = 'EC-08';
              break;
            case '8':
              width = 8;
              isLED = false;
              defaultProfileArticle = 'MC-05';
              break;
            case '10':
              width = 10;
              isLED = false;
              defaultProfileArticle = 'DL-13';
              break;
            case 'LED_10':
              width = 10;
              isLED = true;
              defaultProfileArticle = 'DL-13';
              break;
          }

          const nextJoints = { ...w.customJoints };

          if (targetGroupId) {
            Object.keys(nextJoints).forEach((k) => {
              if (nextJoints[k]?.groupId === targetGroupId) {
                nextJoints[k] = {
                  ...nextJoints[k],
                  orientation,
                  width,
                  isLED,
                  profileArticle: defaultProfileArticle,
                };
              }
            });
          } else {
            nextJoints[jointId] = {
              ...(nextJoints[jointId] || { id: jointId }),
              orientation,
              width,
              isLED,
              profileArticle: defaultProfileArticle,
            };
          }

          let nextWallJoints = w.joints;
          if (nextWallJoints && nextWallJoints.length > 0) {
            nextWallJoints = nextWallJoints.map((j) => {
              if (j.id === jointId || (targetGroupId && (w.customJoints[j.id]?.groupId === targetGroupId || j.groupId === targetGroupId))) {
                return {
                  ...j,
                  width,
                  isLED,
                  profileArticle: defaultProfileArticle,
                };
              }
              return j;
            });
          }

          let nextPanels = w.panels;
          const targetJoint = findOrSynthesizeJoint(w, jointId);
          const oldW = w.customJoints[jointId]?.width ?? targetJoint?.width ?? DEFAULT_JOINT_GAP_MM;
          const currentTakeSide = nextJoints[jointId]?.takeSide || targetJoint?.takeSide;

          if (nextPanels && nextPanels.length > 0 && targetJoint) {
            const cascadeRes = PolygonSlicingEngine.cascadeChainJointWidthChange(
              nextPanels,
              nextWallJoints || [],
              { ...targetJoint, takeSide: currentTakeSide },
              oldW,
              width,
              w.width,
              w.height,
              w.openings
            );
            nextPanels = cascadeRes.panels;
            nextWallJoints = cascadeRes.joints;

            const valid = PolygonSlicingEngine.ensureValidPanelDimensions(
              { ...w, panels: nextPanels, joints: nextWallJoints },
              state.project.materials
            );
            nextPanels = valid.panels;
            nextWallJoints = valid.joints;
          }

          return { ...w, customJoints: nextJoints, joints: nextWallJoints, panels: nextPanels };
        }),
      },
    })),

  setJointProfile: (wallId: string, jointId: string, article: string, colorHex?: string) =>
    set(state => ({ project: { ...state.project, walls: state.project.walls.map(w => w.id === wallId
      ? assignJointProfile(w, [jointId], article, colorHex) : w) } })),

  setJointColor: (wallId: string, jointId: string, colorHex: string) =>
    set((state) => ({
      project: {
        ...state.project,
        walls: state.project.walls.map((w) => {
          if (w.id !== wallId) return w;
          const baseId = jointId.split('-part-')[0].split('-merged-')[0];
          const targetGroupId = w.customJoints[jointId]?.groupId || w.customJoints[baseId]?.groupId;

          const nextJoints = { ...w.customJoints };

          if (targetGroupId) {
            Object.keys(nextJoints).forEach((k) => {
              if (nextJoints[k]?.groupId === targetGroupId) {
                nextJoints[k] = {
                  ...nextJoints[k],
                  profileColor: colorHex,
                };
              }
            });
          } else if (nextJoints[jointId]) {
            nextJoints[jointId] = {
              ...nextJoints[jointId],
              profileColor: colorHex,
            };
          } else {
            const orientation = jointId.includes('-v-') ? 'VERTICAL' : 'HORIZONTAL';
            nextJoints[jointId] = {
              id: jointId,
              orientation,
              width: 3,
              isLED: false,
              profileColor: colorHex,
            };
          }

          let nextWallJoints = w.joints;
          if (nextWallJoints && nextWallJoints.length > 0) {
            nextWallJoints = nextWallJoints.map((j) => {
              if (j.id === jointId || (targetGroupId && (w.customJoints[j.id]?.groupId === targetGroupId || j.groupId === targetGroupId))) {
                return {
                  ...j,
                  profileColor: colorHex,
                };
              }
              return j;
            });
          }

          return { ...w, customJoints: nextJoints, joints: nextWallJoints };
        }),
      },
    })),

  setSelectedPanelEdge: (selectedPanelEdge: SelectedPanelEdgeTarget | null) =>
    set((state) => ({
      selectedPanelEdge,
      selectedJointId: null,
      selectedJointIds: [],
      ...(selectedPanelEdge ? {
        selectedPieceIds: [selectedPanelEdge.panelId],
        selectedSubPieceId: null,
        selectedWallBendId: null,
        project: { ...state.project, selectedWallId: selectedPanelEdge.wallId, selectedOpeningId: null },
      } : {}),
    })),

  setPanelEdgeJoint: (
    wallId: string,
    panelId: string,
    edge: PanelEdgeSide | number,
    config: Partial<PanelEdgeJointConfig>
  ) =>
    set((state) => {
      let selectedPanelEdge = state.selectedPanelEdge;
      const walls = state.project.walls.map((w) => {
          if (w.id !== wallId) return w;
          const panel = w.panels?.find(p => p.id === panelId);
          const edgeInfo = panel && getPanelEdges(panel.points, panel.edges)
            .find(e => e.key === edge || e.index === edge || e.side === edge);
          const joint = edgeInfo && getPanelEdgeJoint(w, edgeInfo);
          if (joint && edgeInfo && panel && (config.width !== undefined || !(edgeInfo.config?.width))) {
            // One shared gap, edited by moving only the selected panel boundary.
            let updated = { ...joint, ...edgeInfo.config, ...config,
              width: config.width !== undefined ? Math.max(0, config.width) : joint.width,
              isLED: config.isLED ?? edgeInfo.config?.isLED ?? joint.isLED };
            let nextPanel = panel;
            if (config.width !== undefined) {
              const resized = resizePanelEdgeGap(w, panel, edgeInfo.index, joint, updated.width);
              nextPanel = resized.panel;
              updated = { ...updated, p1: resized.joint.p1, p2: resized.joint.p2 };
              if (selectedPanelEdge?.wallId === wallId && selectedPanelEdge.panelId === panelId &&
                (selectedPanelEdge.edge === edgeInfo.key || selectedPanelEdge.edge === edgeInfo.index)) {
                selectedPanelEdge = { ...selectedPanelEdge, edge: resized.edgeKey };
              }
            } else if (panel.edges) {
              const edges = { ...panel.edges };
              delete edges[edgeInfo.index];
              if (edgeInfo.side) delete edges[edgeInfo.side];
              nextPanel = { ...panel, edges };
            }
            return { ...w, panels: w.panels?.map(p => p.id === panelId ? nextPanel : p),
              joints: w.joints?.map(j => j.id === joint.id ? updated : j), customJoints: { ...w.customJoints,
              [joint.id]: { ...jointParameters(w, joint.id), width: updated.width, isLED: updated.isLED,
                profileArticle: updated.profileArticle, profileColor: updated.profileColor,
                orientation: updated.orientation ?? (Math.abs(updated.p1.x - updated.p2.x) < 1e-5 ? 'VERTICAL'
                  : Math.abs(updated.p1.y - updated.p2.y) < 1e-5 ? 'HORIZONTAL' : 'DIAGONAL') } } };
          }
          const nextPanels = (w.panels || []).map((p) => {
            if (p.id !== panelId) return p;
            const currentEdges = p.edges || {};
            const target = getPanelEdges(p.points, currentEdges).find(e => e.key === edge || e.index === edge || e.side === edge);
            if (!target) return p;
            const currentEdgeConfig = target.config || { width: 0, isLED: false };
            const nextEdgeConfig: PanelEdgeJointConfig = {
              ...currentEdgeConfig,
              ...config,
            };
            const nextEdges: NonNullable<WallPanelPiece['edges']> = { ...currentEdges, [target.key]: nextEdgeConfig };
            // A named rectangle edge and its numeric index refer to the same contour line.
            if (typeof target.key === 'string') delete nextEdges[target.index];
            return {
              ...p,
              edges: nextEdges,
            };
          });
          return { ...w, panels: nextPanels };
        });
      return { selectedPanelEdge, project: { ...state.project, walls } };
    }),

  setPanelEdgeWidth: (wallId, panelId, edge, width) => {
    get().setPanelEdgeJoint(wallId, panelId, edge, { width: Math.max(0, width) });
  },

  setPanelEdgeProfile: (
    wallId: string,
    panelId: string,
    edge: PanelEdgeSide | number,
    article: string,
    colorHex?: string
  ) => {
    const profile = findProfileByArticle(article);
    const isLED = profile ? (profile.isLEDCompatible ?? false) : false;
    const profileColor = colorHex || profile?.defaultColorHex || '#212529';

    get().setPanelEdgeJoint(wallId, panelId, edge, {
      isLED,
      profileArticle: article,
      profileColor,
    });
  },

  setPanelEdgeLED: (
    wallId: string,
    panelId: string,
    edge: PanelEdgeSide | number,
    isLED: boolean
  ) => {
    const wall = get().project.walls.find(w => w.id === wallId);
    const panel = wall?.panels?.find(p => p.id === panelId);
    const currentW = (wall && panel && getResolvedPanelEdges(wall, panel)
      .find(e => e.key === edge || e.index === edge || e.side === edge)?.config?.width) ?? 0;
    const width = isLED && currentW === 0 ? 10 : currentW;
    get().setPanelEdgeJoint(wallId, panelId, edge, {
      isLED,
      width,
    });
  },

  setPanelEdgeColor: (
    wallId: string,
    panelId: string,
    edge: PanelEdgeSide | number,
    colorHex: string
  ) => {
    get().setPanelEdgeJoint(wallId, panelId, edge, {
      profileColor: colorHex,
    });
  },

  setCellMaterial: (wallId: string, columnIndex: number, segmentIndex: number, materialId: string) =>
    set((state) => {
      const wall = state.project.walls.find((w) => w.id === wallId);
      if (!wall) return state;

      const targetMaterial = state.project.materials.find((m) => m.id === materialId);
      const isVoidMat = materialId === MATERIAL_NONE_ID || targetMaterial?.isVoid;

      if (wall.panels && wall.panels.length > 0) {
        let nextPanels = [...wall.panels];
        let nextJoints = [...(wall.joints || [])];
        const targetId =
          state.selectedSubPieceId ||
          state.selectedPieceIds[0] ||
          (state.selectedCellKeys[0] ? state.selectedCellKeys[0] : null);

        let pIdx = -1;
        if (targetId) {
          pIdx = nextPanels.findIndex((p) => p.id === targetId || p.id.includes(targetId));
        }
        if (pIdx === -1) {
          pIdx = Math.min(segmentIndex, nextPanels.length - 1);
        }

        if (pIdx >= 0 && nextPanels[pIdx]) {
          const p = nextPanels[pIdx];
          let points = p.points;
          if (nextPanels.length === 1) {
            points = [
              { x: 0, y: 0 },
              { x: wall.width, y: 0 },
              { x: wall.width, y: wall.height },
              { x: 0, y: wall.height },
            ];
          }

          const updated: WallPanelPiece = {
            ...p,
            points,
            materialId,
            isVoid: isVoidMat,
            color: targetMaterial?.color || p.color,
            decorCode: targetMaterial?.decorCode || p.decorCode,
            decorName: isVoidMat ? 'Без материала' : (targetMaterial?.decorName || p.decorName),
            thickness: targetMaterial?.thickness || p.thickness,
            textureCategory: (targetMaterial?.textureCategory as any) || p.textureCategory,
            reliefType: (targetMaterial?.reliefType as any) || p.reliefType,
            partLabel: isVoidMat ? 'ПУСТО' : (p.partLabel === 'ПУСТО' ? '1.1' : p.partLabel),
          };

          nextPanels[pIdx] = updated;
          if (wall.openings && wall.openings.length > 0) {
            const sanitized = PolygonSlicingEngine.subtractOpeningsFromWallPanels(
              nextPanels,
              nextJoints,
              wall.openings
            );
            nextPanels = sanitized.panels;
            nextJoints = sanitized.joints;
          }
          return {
            project: {
              ...state.project,
              walls: state.project.walls.map((w) =>
                w.id === wallId ? { ...w, panels: nextPanels, joints: nextJoints } : w
              ),
            },
          };
        }
      }

      // 1. ЕСЛИ ВЫБРАНА КОНКРЕТНАЯ ДЕТАЛЬ РАСКРОЯ (subPiece) — МЕНЯЕМ ТОЛЬКО ЕЁ!
      if (state.selectedSubPieceId) {
        const subId = state.selectedSubPieceId;
        const nextCustomPanels = { ...wall.customPanels };
        const updateSubs = (subs?: PolygonSubPiece[]) => {
          if (!subs) return subs;
          return subs.map((s) => {
            if (s.id === subId) {
              return {
                ...s,
                materialId,
                isVoid: isVoidMat,
                color: targetMaterial?.color || s.color,
                decorCode: targetMaterial?.decorCode || s.decorCode,
                decorName: isVoidMat ? 'Без материала' : (targetMaterial?.decorName || s.decorName),
                thickness: targetMaterial?.thickness || s.thickness,
                textureCategory: (targetMaterial?.textureCategory as any) || s.textureCategory,
                reliefType: (targetMaterial?.reliefType as any) || s.reliefType,
                partLabel: isVoidMat ? 'ПУСТО' : (s.partLabel === 'ПУСТО' ? `1.${columnIndex + 1}.${segmentIndex + 1}` : s.partLabel),
              };
            }
            return s;
          });
        };

        const currentCustom = wall.customPanels[columnIndex] || { columnIndex, segments: [] };
        if (currentCustom.segments && currentCustom.segments[segmentIndex]) {
          const nextSegs = [...currentCustom.segments];
          nextSegs[segmentIndex] = {
            ...nextSegs[segmentIndex],
            subPieces: updateSubs(nextSegs[segmentIndex].subPieces),
          };
          nextCustomPanels[columnIndex] = {
            ...currentCustom,
            segments: nextSegs,
          };
        } else {
          nextCustomPanels[columnIndex] = {
            ...currentCustom,
            subPieces: updateSubs(currentCustom.subPieces),
          };
        }

        return {
          project: {
            ...state.project,
            walls: state.project.walls.map((w) =>
              w.id === wallId ? { ...w, customPanels: nextCustomPanels } : w
            ),
          },
        };
      }

      const currentCustom = wall.customPanels[columnIndex] || { columnIndex, segments: [] };
      const segments = [...(currentCustom.segments || [])];
      const hasSegments = segments.length > 0 || segmentIndex > 0;

      while (segments.length <= segmentIndex && hasSegments) {
        segments.push({
          id: `seg-${Date.now()}-${segments.length}`,
          height: undefined,
        });
      }

      if (!hasSegments) {
        return {
          project: {
            ...state.project,
            walls: state.project.walls.map((w) =>
              w.id === wallId
                ? {
                    ...w,
                    customPanels: {
                      ...w.customPanels,
                      [columnIndex]: {
                        ...currentCustom,
                        customMaterialId: materialId,
                      },
                    },
                  }
                : w
            ),
          },
        };
      }

      segments[segmentIndex] = {
        ...segments[segmentIndex],
        customMaterialId: materialId,
      };

      return {
        project: {
          ...state.project,
          walls: state.project.walls.map((w) =>
            w.id === wallId
              ? {
                  ...w,
                  customPanels: {
                    ...w.customPanels,
                    [columnIndex]: {
                      ...currentCustom,
                      segments,
                    },
                  },
                }
              : w
          ),
        },
      };
    }),

  addCustomCatalogPanel: (panel: Material) => {
    localCatalogRepository.savePanel(panel);
    set((state) => ({
      isDirty: true,
      project: {
        ...state.project,
        materials: [...state.project.materials, panel],
        excludedCatalogPanelIds: state.project.excludedCatalogPanelIds?.filter(id => id !== panel.id),
      },
    }));
  },

  updateCatalogPanel: (panelId: string, updates: Partial<Material>) => {
    const current = get().project.materials.find(panel => panel.id === panelId);
    if (!current) return;
    const updated = { ...current, ...updates, id: panelId };
    localCatalogRepository.savePanel(updated);
    set((state) => ({
      isDirty: true,
      project: {
        ...state.project,
        materials: state.project.materials.map((m) =>
          m.id === panelId ? updated : m
        ),
      },
    }));
  },

  deleteCatalogPanel: (panelId: string) =>
    set((state) => ({
      isDirty: true,
      project: {
        ...state.project,
        materials: state.project.materials.filter((m) => m.id !== panelId),
        excludedCatalogPanelIds: [...new Set([...(state.project.excludedCatalogPanelIds || []), panelId])],
      },
    })),

  setCellProperties: (
    wallId: string,
    columnIndex: number,
    segmentIndex: number,
    properties: {
      materialId?: string;
      customThickness?: number;
      customColor?: string;
      customDecorCode?: string;
      customTextureCategory?: string;
      customReliefType?: SlatProfileShape;
    }
  ) =>
    set((state) => {
      const wall = state.project.walls.find((w) => w.id === wallId);
      if (!wall) return state;

      const currentCustom = wall.customPanels[columnIndex];
      const targetMaterial = properties.materialId
        ? state.project.materials.find((m) => m.id === properties.materialId)
        : undefined;

      if (wall.panels && wall.panels.length > 0) {
        let nextPanels = [...wall.panels];
        const nextJoints = [...(wall.joints || [])];
        const targetId =
          state.selectedSubPieceId ||
          state.selectedPieceIds[0] ||
          (state.selectedCellKeys[0] ? state.selectedCellKeys[0] : null);

        let pIdx = -1;
        if (targetId) {
          pIdx = nextPanels.findIndex((p) => p.id === targetId || p.id.includes(targetId));
        }
        if (pIdx === -1) {
          pIdx = Math.min(segmentIndex, nextPanels.length - 1);
        }

        if (pIdx >= 0 && nextPanels[pIdx]) {
          const p = nextPanels[pIdx];
          const isVoidMat = properties.materialId === MATERIAL_NONE_ID || targetMaterial?.isVoid;
          const updated: WallPanelPiece = {
            ...p,
            ...(properties.materialId ? {
              materialId: properties.materialId,
              isVoid: isVoidMat,
              decorName: isVoidMat ? 'Без материала' : (targetMaterial?.decorName || p.decorName),
              partLabel: isVoidMat ? 'ПУСТО' : (p.partLabel === 'ПУСТО' ? `1.${columnIndex + 1}.${segmentIndex + 1}` : p.partLabel),
            } : {}),
            ...(properties.customColor !== undefined ? { color: properties.customColor } : (targetMaterial?.color ? { color: targetMaterial.color } : {})),
            ...(properties.customDecorCode !== undefined ? { decorCode: properties.customDecorCode } : (targetMaterial?.decorCode ? { decorCode: targetMaterial.decorCode } : {})),
            ...(properties.customThickness !== undefined ? { thickness: properties.customThickness } : (targetMaterial?.thickness ? { thickness: targetMaterial.thickness } : {})),
            ...(properties.customTextureCategory !== undefined ? { textureCategory: properties.customTextureCategory as any } : (targetMaterial?.textureCategory ? { textureCategory: targetMaterial.textureCategory as any } : {})),
            ...(properties.customReliefType !== undefined ? { reliefType: properties.customReliefType as any } : (targetMaterial?.reliefType ? { reliefType: targetMaterial.reliefType as any } : {})),
          };

          nextPanels[pIdx] = updated;

          const nextCustomPanels = { ...wall.customPanels };
          if (nextCustomPanels[columnIndex]) {
            const curConf = nextCustomPanels[columnIndex];
            if (curConf.segments && curConf.segments[segmentIndex]) {
              const segs = [...curConf.segments];
              segs[segmentIndex] = {
                ...segs[segmentIndex],
                ...(properties.materialId ? { customMaterialId: properties.materialId } : {}),
                ...(properties.customColor !== undefined ? { customColor: properties.customColor } : {}),
                ...(properties.customDecorCode !== undefined ? { customDecorCode: properties.customDecorCode } : {}),
                ...(properties.customThickness !== undefined ? { customThickness: properties.customThickness } : {}),
                ...(properties.customTextureCategory !== undefined ? { customTextureCategory: properties.customTextureCategory as any } : {}),
                ...(properties.customReliefType !== undefined ? { customReliefType: properties.customReliefType as any } : {}),
              };
              nextCustomPanels[columnIndex] = { ...curConf, segments: segs };
            } else {
              nextCustomPanels[columnIndex] = {
                ...curConf,
                ...(properties.materialId ? { customMaterialId: properties.materialId } : {}),
                ...(properties.customColor !== undefined ? { customColor: properties.customColor } : {}),
                ...(properties.customDecorCode !== undefined ? { customDecorCode: properties.customDecorCode } : {}),
                ...(properties.customThickness !== undefined ? { customThickness: properties.customThickness } : {}),
                ...(properties.customTextureCategory !== undefined ? { customTextureCategory: properties.customTextureCategory as any } : {}),
                ...(properties.customReliefType !== undefined ? { customReliefType: properties.customReliefType as any } : {}),
              };
            }
          }

          return {
            project: {
              ...state.project,
              walls: state.project.walls.map((w) =>
                w.id === wallId ? { ...w, panels: nextPanels, joints: nextJoints, customPanels: nextCustomPanels } : w
              ),
            },
          };
        }
      }

      // 1. ЕСЛИ ВЫБРАНА КОНКРЕТНАЯ ДЕТАЛЬ РАСКРОЯ (subPiece) — МЕНЯЕМ ТОЛЬКО ЕЁ!
      if (state.selectedSubPieceId) {
        const subId = state.selectedSubPieceId;
        const nextCustomPanels = { ...wall.customPanels };
        const isVoidMat = properties.materialId === MATERIAL_NONE_ID || targetMaterial?.isVoid;

        const updateSubs = (subs?: PolygonSubPiece[]) => {
          if (!subs) return subs;
          return subs.map((s) => {
            if (s.id === subId) {
              return {
                ...s,
                ...(properties.materialId ? {
                  materialId: properties.materialId,
                  isVoid: isVoidMat,
                  decorName: isVoidMat ? 'Без материала' : (targetMaterial?.decorName || s.decorName),
                  partLabel: isVoidMat ? 'ПУСТО' : (s.partLabel === 'ПУСТО' ? `1.${columnIndex + 1}.${segmentIndex + 1}` : s.partLabel),
                } : {}),
                ...(properties.customColor !== undefined ? { color: properties.customColor } : (targetMaterial?.color ? { color: targetMaterial.color } : {})),
                ...(properties.customDecorCode !== undefined ? { decorCode: properties.customDecorCode } : (targetMaterial?.decorCode ? { decorCode: targetMaterial.decorCode } : {})),
                ...(properties.customThickness !== undefined ? { thickness: properties.customThickness } : (targetMaterial?.thickness ? { thickness: targetMaterial.thickness } : {})),
                ...(properties.customTextureCategory !== undefined ? { textureCategory: properties.customTextureCategory as any } : (targetMaterial?.textureCategory ? { textureCategory: targetMaterial.textureCategory as any } : {})),
                ...(properties.customReliefType !== undefined ? { reliefType: properties.customReliefType as any } : (targetMaterial?.reliefType ? { reliefType: targetMaterial.reliefType as any } : {})),
              };
            }
            return s;
          });
        };

        const currentCustom = wall.customPanels[columnIndex] || { columnIndex, segments: [] };
        if (currentCustom.segments && currentCustom.segments[segmentIndex]) {
          const nextSegs = [...currentCustom.segments];
          nextSegs[segmentIndex] = {
            ...nextSegs[segmentIndex],
            subPieces: updateSubs(nextSegs[segmentIndex].subPieces),
          };
          nextCustomPanels[columnIndex] = {
            ...currentCustom,
            segments: nextSegs,
          };
        } else {
          nextCustomPanels[columnIndex] = {
            ...currentCustom,
            subPieces: updateSubs(currentCustom.subPieces),
          };
        }

        return {
          project: {
            ...state.project,
            walls: state.project.walls.map((w) =>
              w.id === wallId ? { ...w, customPanels: nextCustomPanels } : w
            ),
          },
        };
      }

      const segments = [...(currentCustom?.segments || [])];
      const hasSegments = segments.length > 0 || segmentIndex > 0;

      while (segments.length <= segmentIndex && hasSegments) {
        segments.push({
          id: `seg-${Date.now()}-${segments.length}`,
          height: undefined,
        });
      }

      const existingSubs = hasSegments ? segments[segmentIndex]?.subPieces : currentCustom?.subPieces;

      // Если в элементе уже есть subPieces
      if (existingSubs && existingSubs.length > 0) {
        const isVoidMat = properties.materialId === MATERIAL_NONE_ID || targetMaterial?.isVoid;
        const nextSubs = existingSubs.map((s) => {
          return {
            ...s,
            ...(properties.materialId ? {
              materialId: properties.materialId,
              isVoid: isVoidMat,
              decorName: isVoidMat ? 'Без материала' : (targetMaterial?.decorName || s.decorName),
              partLabel: isVoidMat ? 'ПУСТО' : (s.partLabel === 'ПУСТО' ? `1.${columnIndex + 1}.${segmentIndex + 1}` : s.partLabel),
            } : {}),
            ...(properties.customColor !== undefined ? { color: properties.customColor } : (targetMaterial?.color ? { color: targetMaterial.color } : {})),
            ...(properties.customDecorCode !== undefined ? { decorCode: properties.customDecorCode } : (targetMaterial?.decorCode ? { decorCode: targetMaterial.decorCode } : {})),
            ...(properties.customThickness !== undefined ? { thickness: properties.customThickness } : (targetMaterial?.thickness ? { thickness: targetMaterial.thickness } : {})),
            ...(properties.customTextureCategory !== undefined ? { textureCategory: properties.customTextureCategory as any } : (targetMaterial?.textureCategory ? { textureCategory: targetMaterial.textureCategory as any } : {})),
            ...(properties.customReliefType !== undefined ? { reliefType: properties.customReliefType as any } : (targetMaterial?.reliefType ? { reliefType: targetMaterial.reliefType as any } : {})),
          };
        });

        if (hasSegments) {
          segments[segmentIndex] = {
            ...segments[segmentIndex],
            subPieces: nextSubs,
            ...(properties.materialId ? { customMaterialId: properties.materialId } : {}),
            ...(properties.customThickness !== undefined ? { customThickness: properties.customThickness } : {}),
            ...(properties.customColor !== undefined ? { customColor: properties.customColor } : {}),
            ...(properties.customDecorCode !== undefined ? { customDecorCode: properties.customDecorCode } : {}),
            ...(properties.customTextureCategory !== undefined ? { customTextureCategory: properties.customTextureCategory } : {}),
            ...(properties.customReliefType !== undefined ? { customReliefType: properties.customReliefType } : {}),
          };

          return {
            project: {
              ...state.project,
              walls: state.project.walls.map((w) =>
                w.id === wallId
                  ? {
                      ...w,
                      customPanels: {
                        ...w.customPanels,
                        [columnIndex]: {
                          ...(currentCustom || { columnIndex }),
                          segments,
                        },
                      },
                    }
                  : w
              ),
            },
          };
        } else {
          return {
            project: {
              ...state.project,
              walls: state.project.walls.map((w) =>
                w.id === wallId
                  ? {
                      ...w,
                      customPanels: {
                        ...w.customPanels,
                        [columnIndex]: {
                          ...(currentCustom || { columnIndex }),
                          subPieces: nextSubs,
                          ...(properties.materialId ? { customMaterialId: properties.materialId } : {}),
                          ...(properties.customThickness !== undefined ? { customThickness: properties.customThickness } : {}),
                          ...(properties.customColor !== undefined ? { customColor: properties.customColor } : {}),
                          ...(properties.customDecorCode !== undefined ? { customDecorCode: properties.customDecorCode } : {}),
                          ...(properties.customTextureCategory !== undefined ? { customTextureCategory: properties.customTextureCategory } : {}),
                          ...(properties.customReliefType !== undefined ? { customReliefType: properties.customReliefType } : {}),
                        },
                      },
                    }
                  : w
              ),
            },
          };
        }
      }

      if (!hasSegments) {
        return {
          project: {
            ...state.project,
            walls: state.project.walls.map((w) =>
              w.id === wallId
                ? {
                    ...w,
                    customPanels: {
                      ...w.customPanels,
                      [columnIndex]: {
                        ...(currentCustom || { columnIndex }),
                        ...(properties.materialId ? { customMaterialId: properties.materialId } : {}),
                        ...(properties.customThickness !== undefined ? { customThickness: properties.customThickness } : {}),
                        ...(properties.customColor !== undefined ? { customColor: properties.customColor } : {}),
                        ...(properties.customDecorCode !== undefined ? { customDecorCode: properties.customDecorCode } : {}),
                        ...(properties.customTextureCategory !== undefined ? { customTextureCategory: properties.customTextureCategory } : {}),
                        ...(properties.customReliefType !== undefined ? { customReliefType: properties.customReliefType } : {}),
                      },
                    },
                  }
                : w
            ),
          },
        };
      }

      segments[segmentIndex] = {
        ...segments[segmentIndex],
        ...(properties.materialId ? { customMaterialId: properties.materialId } : {}),
        ...(properties.customThickness !== undefined ? { customThickness: properties.customThickness } : {}),
        ...(properties.customColor !== undefined ? { customColor: properties.customColor } : {}),
        ...(properties.customDecorCode !== undefined ? { customDecorCode: properties.customDecorCode } : {}),
        ...(properties.customTextureCategory !== undefined ? { customTextureCategory: properties.customTextureCategory } : {}),
        ...(properties.customReliefType !== undefined ? { customReliefType: properties.customReliefType } : {}),
      };

      return {
        project: {
          ...state.project,
          walls: state.project.walls.map((w) =>
            w.id === wallId
              ? {
                  ...w,
                  customPanels: {
                    ...w.customPanels,
                    [columnIndex]: {
                      ...(currentCustom || { columnIndex }),
                      segments,
                    },
                  },
                }
              : w
          ),
        },
      };
    }),

  clearCellMaterial: (wallId: string, columnIndex: number, segmentIndex: number) =>
    set((state) => ({
      project: {
        ...state.project,
        walls: state.project.walls.map((w) => {
          if (w.id !== wallId) return w;
          const currentCustom = w.customPanels[columnIndex] || { columnIndex, segments: [] };

          if (state.selectedSubPieceId) {
            const subId = state.selectedSubPieceId;
            const updateSubs = (subs?: PolygonSubPiece[]) =>
              subs?.map((s) =>
                s.id === subId ? { ...s, materialId: MATERIAL_NONE_ID, isVoid: true } : s
              );

            const nextCustom = { ...currentCustom };
            if (currentCustom.segments && currentCustom.segments[segmentIndex]) {
              const nextSegs = [...currentCustom.segments];
              nextSegs[segmentIndex] = {
                ...nextSegs[segmentIndex],
                subPieces: updateSubs(nextSegs[segmentIndex].subPieces),
              };
              nextCustom.segments = nextSegs;
            } else {
              nextCustom.subPieces = updateSubs(currentCustom.subPieces);
            }

            return {
              ...w,
              customPanels: {
                ...w.customPanels,
                [columnIndex]: nextCustom,
              },
            };
          }

          const segments = [...(currentCustom.segments || [])];

          while (segments.length <= segmentIndex) {
            segments.push({
              id: `seg-${Date.now()}-${segments.length}`,
              height: undefined,
            });
          }

          segments[segmentIndex] = {
            ...segments[segmentIndex],
            customMaterialId: MATERIAL_NONE_ID,
          };

          return {
            ...w,
            customPanels: {
              ...w.customPanels,
              [columnIndex]: {
                ...currentCustom,
                segments,
              },
            },
          };
        }),
      },
    })),

  updatePanelConfig: (wallId: string, columnIndex: number, config: Partial<CustomPanelConfig>) =>
    set((state) => {
      const wall = state.project.walls.find((w) => w.id === wallId);
      if (!wall) return state;

      const currentCustom = wall.customPanels[columnIndex] || { columnIndex };
      const colMaterialId = config.customMaterialId || currentCustom.customMaterialId || wall.zone.materialId || MATERIAL_NONE_ID;
      const material = state.project.materials.find((m) => m.id === colMaterialId) || state.project.materials.find((m) => m.id === MATERIAL_NONE_ID);
      const isVoid = material?.isVoid === true || colMaterialId === MATERIAL_NONE_ID;
      const maxSheetWidth = isVoid ? 10000 : (material?.width || 1220);

      let nextCustomPanels = { ...wall.customPanels };
      let nextCustomJoints = { ...wall.customJoints };

      if (config.customWidth !== undefined && !isVoid && config.customWidth > maxSheetWidth) {
        const res = splitOversizedColumn(
          wall.customPanels,
          wall.customJoints,
          columnIndex,
          config.customWidth,
          maxSheetWidth,
          0,
          100
        );
        nextCustomPanels = res.customPanels;
        nextCustomJoints = res.customJoints;
      } else {
        nextCustomPanels[columnIndex] = {
          ...currentCustom,
          ...config,
        };
      }

      return {
        project: {
          ...state.project,
          walls: state.project.walls.map((w) =>
            w.id === wallId
              ? { ...w, customPanels: nextCustomPanels, customJoints: nextCustomJoints }
              : w
          ),
        },
      };
    }),

  updatePanelSegment: (
    wallId: string,
    columnIndex: number,
    segmentIndex: number,
    config: Partial<PanelSegmentConfig>
  ) =>
    set((state) => {
      const wall = state.project.walls.find((w) => w.id === wallId);
      if (!wall) return state;

      const currentCustom = wall.customPanels[columnIndex] || { columnIndex, segments: [] };
      const segments = [...(currentCustom.segments || [])];

      while (segments.length <= segmentIndex) {
        segments.push({
          id: `seg-${Date.now()}-${segments.length}`,
          height: undefined,
        });
      }

      const segMaterialId =
        config.customMaterialId ||
        segments[segmentIndex]?.customMaterialId ||
        currentCustom.customMaterialId ||
        wall.zone.materialId ||
        MATERIAL_NONE_ID;
      const material = state.project.materials.find((m) => m.id === segMaterialId) || state.project.materials.find((m) => m.id === MATERIAL_NONE_ID);
      const isVoid = material?.isVoid === true || segMaterialId === MATERIAL_NONE_ID;
      const maxSheetHeight = isVoid ? 10000 : (material?.height || 2800);

      let nextSegments: PanelSegmentConfig[];
      let nextCustomJoints = { ...wall.customJoints };

      if (config.height !== undefined && !isVoid && config.height > maxSheetHeight) {
        const res = splitOversizedSegment(
          wall.customJoints,
          columnIndex,
          segments,
          segmentIndex,
          config.height,
          maxSheetHeight,
          0,
          100
        );
        nextSegments = res.segments;
        nextCustomJoints = res.customJoints;
      } else {
        segments[segmentIndex] = {
          ...segments[segmentIndex],
          ...config,
        };
        nextSegments = segments;
      }

      let nextPanels = wall.panels;
      if (wall.panels && wall.panels.length > 0) {
        const targetId = state.selectedPieceIds[0] || state.selectedSubPieceId;
        nextPanels = wall.panels.map((p, idx) => {
          if (targetId && (p.id === targetId || p.id.includes(targetId))) {
            return {
              ...p,
              note: config.note !== undefined ? config.note : p.note,
              partLabel: config.partLabel !== undefined ? config.partLabel : p.partLabel,
            };
          }
          if (idx === columnIndex) {
            return {
              ...p,
              note: config.note !== undefined ? config.note : p.note,
              partLabel: config.partLabel !== undefined ? config.partLabel : p.partLabel,
            };
          }
          return p;
        });
      }

      return {
        project: {
          ...state.project,
          walls: state.project.walls.map((w) =>
            w.id === wallId
              ? {
                  ...w,
                  panels: nextPanels,
                  customJoints: nextCustomJoints,
                  customPanels: {
                    ...w.customPanels,
                    [columnIndex]: {
                      ...currentCustom,
                      segments: nextSegments,
                    },
                  },
                }
              : w
          ),
        },
      };
    }),

  splitPanelHorizontally: (
    wallId: string,
    columnIndex: number,
    segmentIndex: number,
    firstHeight: number
  ) =>
    set((state) => {
      const wall = state.project.walls.find((w) => w.id === wallId);
      if (!wall) return state;

      if (wall.panels && wall.panels.length > 0) {
        const nextPanels = [...wall.panels];
        const nextJoints = [...(wall.joints || [])];
        const targetId =
          state.selectedSubPieceId ||
          state.selectedPieceIds[0] ||
          (state.selectedCellKeys[0] ? state.selectedCellKeys[0] : null);

        let pIdx = -1;
        if (targetId) {
          pIdx = nextPanels.findIndex((p) => p.id === targetId || p.id.includes(targetId));
        }
        if (pIdx === -1) {
          pIdx = Math.min(segmentIndex, nextPanels.length - 1);
        }

        if (pIdx >= 0 && nextPanels[pIdx]) {
          const targetPanel = nextPanels[pIdx];
          const xs = targetPanel.points.map((p) => p.x);
          const minX = Math.min(...xs);
          const maxX = Math.max(...xs);
          const ys = targetPanel.points.map((p) => p.y);
          const minY = Math.min(...ys);
          const maxY = Math.max(...ys);
          const cutY = firstHeight > 0 ? minY + firstHeight : (minY + maxY) / 2;

          const p1: Point2D = { x: minX - 10, y: cutY };
          const p2: Point2D = { x: maxX + 10, y: cutY };

          const splitRes = PolygonSlicingEngine.splitWallPanel(targetPanel, p1, p2, 0);
          if (splitRes) {
            nextPanels.splice(pIdx, 1, ...splitRes.newPanels);
            if (splitRes.joint && splitRes.joint.width > 0) nextJoints.push(splitRes.joint);

            return {
              selectedPieceIds: [splitRes.newPanels[0].id],
              selectedSubPieceId: splitRes.newPanels[0].id,
              project: {
                ...state.project,
                walls: state.project.walls.map((w) =>
                  w.id === wallId ? { ...w, panels: nextPanels, joints: nextJoints } : w
                ),
              },
            };
          }
        }
      }

      const currentCustom = wall.customPanels[columnIndex] || { columnIndex, segments: [] };
      const currentSegments = currentCustom.segments || [];

      // Если в ячейке уже есть subPieces (нарезанные треугольники/полигоны), рассекаем выбранный горизонтально
      const existingSubPieces = (currentSegments.length > 0 ? currentSegments[segmentIndex]?.subPieces : currentCustom.subPieces) || [];
      if (existingSubPieces.length > 0) {
        const targetSubId = state.selectedSubPieceId;
        const nextSubPieces: PolygonSubPiece[] = [];
        let didSplit = false;

        existingSubPieces.forEach((sub, subIdx) => {
          if (targetSubId && sub.id !== targetSubId) {
            nextSubPieces.push(sub);
            return;
          }

          const xs = sub.points.map((p) => p.x);
          const ys = sub.points.map((p) => p.y);
          const minX = Math.min(...xs);
          const maxX = Math.max(...xs);
          const minY = Math.min(...ys);
          const maxY = Math.max(...ys);
          const midY = (minY + maxY) / 2;

          const p1: Point2D = { x: minX - 100, y: midY };
          const p2: Point2D = { x: maxX + 100, y: midY };

          const splitResult = PolygonSlicingEngine.splitPolygonByLine(sub.points, p1, p2, 0);
          if (splitResult) {
            didSplit = true;
            const allPolys = splitResult.allPieces || [splitResult.pieceA, splitResult.pieceB];
            allPolys.forEach((polyPts, pIdx) => {
              nextSubPieces.push({
                ...sub,
                id: `sub-${Date.now()}-${subIdx}-${pIdx + 1}`,
                points: polyPts,
                partLabel: `${sub.partLabel || `${columnIndex + 1}.${segmentIndex + 1}`}.${pIdx + 1}`,
              });
            });
          } else {
            nextSubPieces.push(sub);
          }
        });

        if (didSplit) {
          const nextCustomPanels = { ...wall.customPanels };
          if (currentSegments.length > 0) {
            const nextSegments = [...currentSegments];
            nextSegments[segmentIndex] = {
              ...nextSegments[segmentIndex],
              subPieces: nextSubPieces,
            };
            nextCustomPanels[columnIndex] = {
              ...currentCustom,
              segments: nextSegments,
            };
          } else {
            nextCustomPanels[columnIndex] = {
              ...currentCustom,
              subPieces: nextSubPieces,
            };
          }

          return {
            selectedSubPieceId: nextSubPieces[0]?.id || null,
            project: {
              ...state.project,
              walls: state.project.walls.map((w) =>
                w.id === wallId ? { ...w, customPanels: nextCustomPanels } : w
              ),
            },
          };
        }
      }

      const nextCustomPanels = { ...wall.customPanels };
      const nextCustomJoints = { ...wall.customJoints };

      if (currentSegments.length === 0) {
        // Колонка была сплошной на всю высоту стены
        const totalH = wall.height;
        const h1 = firstHeight > 0 && firstHeight < totalH ? firstHeight : Math.round(totalH / 2);
        const h2 = Math.max(10, totalH - h1);

        const baseProps = {
          customMaterialId: currentCustom.customMaterialId,
          customThickness: currentCustom.customThickness,
          customColor: currentCustom.customColor,
          customDecorCode: currentCustom.customDecorCode,
          customTextureCategory: currentCustom.customTextureCategory,
          customReliefType: currentCustom.customReliefType,
        };

        nextCustomPanels[columnIndex] = {
          ...currentCustom,
          segments: [
            { id: `seg-${Date.now()}-0`, height: h1, ...baseProps },
            { id: `seg-${Date.now()}-1`, height: h2, ...baseProps },
          ],
        };

        nextCustomJoints[`edge-h-${columnIndex}-0`] = {
          id: `edge-h-${columnIndex}-0`,
          orientation: 'HORIZONTAL',
          width: 0,
          isLED: false,
        };
      } else {
        // В колонке уже были сегменты, делим только конкретный сегмент segmentIndex
        const targetSeg = currentSegments[segmentIndex];
        const segH = targetSeg?.height ?? Math.round(wall.height / currentSegments.length);
        const h1 = firstHeight > 0 && firstHeight < segH ? firstHeight : Math.round(segH / 2);
        const h2 = Math.max(10, segH - h1);

        const seg1 = {
          ...targetSeg,
          id: targetSeg?.id || `seg-${Date.now()}-${segmentIndex}`,
          height: h1,
        };

        const seg2 = {
          ...targetSeg,
          id: `seg-${Date.now()}-${segmentIndex + 1}`,
          height: h2,
        };

        const newSegments = [...currentSegments];
        newSegments.splice(segmentIndex, 1, seg1, seg2);

        nextCustomPanels[columnIndex] = {
          ...currentCustom,
          segments: newSegments,
        };

        // Сдвигаем горизонтальные стыки этого столбца: sIdx >= segmentIndex сдвигаются на +1
        for (let sIdx = currentSegments.length - 1; sIdx >= segmentIndex; sIdx--) {
          const oldKey = `edge-h-${columnIndex}-${sIdx}`;
          const newKey = `edge-h-${columnIndex}-${sIdx + 1}`;
          if (nextCustomJoints[oldKey]) {
            nextCustomJoints[newKey] = {
              ...nextCustomJoints[oldKey],
              id: newKey,
            };
            delete nextCustomJoints[oldKey];
          }
        }

        // Вставляем новый горизонтальный стык между половинками
        nextCustomJoints[`edge-h-${columnIndex}-${segmentIndex}`] = {
          id: `edge-h-${columnIndex}-${segmentIndex}`,
          orientation: 'HORIZONTAL',
          width: 0,
          isLED: false,
        };
      }

      return {
        selectedColumnIndex: columnIndex,
        selectedSegmentIndex: segmentIndex,
        selectedCellKeys: [`${columnIndex}-${segmentIndex}`],
        selectedPieceIds: [`panel-${columnIndex}-${segmentIndex}`],
        project: {
          ...state.project,
          walls: state.project.walls.map((w) =>
            w.id === wallId
              ? {
                  ...w,
                  customPanels: nextCustomPanels,
                  customJoints: nextCustomJoints,
                }
              : w
          ),
        },
      };
    }),

  splitColumnVertically: (wallId: string, columnIndex: number, firstWidth: number) =>
    set((state) => {
      const wall = state.project.walls.find((w) => w.id === wallId);
      if (!wall) return state;

      if (wall.panels && wall.panels.length > 0) {
        const nextPanels = [...wall.panels];
        const nextJoints = [...(wall.joints || [])];
        const targetId =
          state.selectedSubPieceId ||
          state.selectedPieceIds[0] ||
          (state.selectedCellKeys[0] ? state.selectedCellKeys[0] : null);

        let pIdx = -1;
        if (targetId) {
          pIdx = nextPanels.findIndex((p) => p.id === targetId || p.id.includes(targetId));
        }
        if (pIdx === -1) {
          pIdx = Math.min(columnIndex, nextPanels.length - 1);
        }

        if (pIdx >= 0 && nextPanels[pIdx]) {
          const targetPanel = nextPanels[pIdx];
          const xs = targetPanel.points.map((p) => p.x);
          const minX = Math.min(...xs);
          const maxX = Math.max(...xs);
          const ys = targetPanel.points.map((p) => p.y);
          const minY = Math.min(...ys);
          const maxY = Math.max(...ys);
          const cutX = firstWidth > 0 ? minX + firstWidth : (minX + maxX) / 2;

          const p1: Point2D = { x: cutX, y: minY - 10 };
          const p2: Point2D = { x: cutX, y: maxY + 10 };

          const splitRes = PolygonSlicingEngine.splitWallPanel(targetPanel, p1, p2, 0);
          if (splitRes) {
            nextPanels.splice(pIdx, 1, ...splitRes.newPanels);
            if (splitRes.joint && splitRes.joint.width > 0) nextJoints.push(splitRes.joint);

            return {
              selectedPieceIds: [splitRes.newPanels[0].id],
              selectedSubPieceId: splitRes.newPanels[0].id,
              project: {
                ...state.project,
                walls: state.project.walls.map((w) =>
                  w.id === wallId ? { ...w, panels: nextPanels, joints: nextJoints } : w
                ),
              },
            };
          }
        }
      }

      const currentCustom = wall.customPanels[columnIndex] || { columnIndex };
      const currentSegments = currentCustom.segments || [];
      const sIdx = state.selectedSegmentIndex ?? 0;
      const existingSubPieces = (currentSegments.length > 0 ? currentSegments[sIdx]?.subPieces : currentCustom.subPieces) || [];

      // Если в ячейке есть subPieces, рассекаем выбранный полигон вертикально
      if (existingSubPieces.length > 0) {
        const targetSubId = state.selectedSubPieceId;
        const nextSubPieces: PolygonSubPiece[] = [];
        let didSplit = false;

        existingSubPieces.forEach((sub, subIdx) => {
          if (targetSubId && sub.id !== targetSubId) {
            nextSubPieces.push(sub);
            return;
          }

          const xs = sub.points.map((p) => p.x);
          const ys = sub.points.map((p) => p.y);
          const minX = Math.min(...xs);
          const maxX = Math.max(...xs);
          const minY = Math.min(...ys);
          const maxY = Math.max(...ys);
          const midX = (minX + maxX) / 2;

          const p1: Point2D = { x: midX, y: minY - 100 };
          const p2: Point2D = { x: midX, y: maxY + 100 };

          const splitResult = PolygonSlicingEngine.splitPolygonByLine(sub.points, p1, p2, 0);
          if (splitResult) {
            didSplit = true;
            const allPolys = splitResult.allPieces || [splitResult.pieceA, splitResult.pieceB];
            allPolys.forEach((polyPts, pIdx) => {
              nextSubPieces.push({
                ...sub,
                id: `sub-${Date.now()}-${subIdx}-${pIdx + 1}`,
                points: polyPts,
                partLabel: `${sub.partLabel || `${columnIndex + 1}.${sIdx + 1}`}.${pIdx + 1}`,
              });
            });
          } else {
            nextSubPieces.push(sub);
          }
        });

        if (didSplit) {
          const nextCustomPanels = { ...wall.customPanels };
          if (currentSegments.length > 0) {
            const nextSegments = [...currentSegments];
            nextSegments[sIdx] = {
              ...nextSegments[sIdx],
              subPieces: nextSubPieces,
            };
            nextCustomPanels[columnIndex] = {
              ...currentCustom,
              segments: nextSegments,
            };
          } else {
            nextCustomPanels[columnIndex] = {
              ...currentCustom,
              subPieces: nextSubPieces,
            };
          }

          return {
            selectedSubPieceId: nextSubPieces[0]?.id || null,
            project: {
              ...state.project,
              walls: state.project.walls.map((w) =>
                w.id === wallId ? { ...w, customPanels: nextCustomPanels } : w
              ),
            },
          };
        }
      }
      const wallMaterial =
        state.project.materials.find((m) => m.id === wall.zone.materialId) || DEFAULT_MATERIALS[0];
      const currentWidth =
        currentCustom.customWidth ?? (wallMaterial.isVoid ? wall.width : wallMaterial.width);

      // Если в колонке есть несколько сегментов, делим ТОЛЬКО выбранный сегмент (ячейку)
      if (currentSegments.length > 0) {
        const targetSeg = currentSegments[sIdx];
        const segH = targetSeg.height || Math.round(wall.height / currentSegments.length);

        const splitW = firstWidth > 0 && firstWidth < currentWidth ? firstWidth : Math.round(currentWidth / 2);
        const secondW = currentWidth - splitW;

        const leftPoly: Point2D[] = [
          { x: 0, y: 0 },
          { x: splitW, y: 0 },
          { x: splitW, y: segH },
          { x: 0, y: segH },
        ];

        const rightPoly: Point2D[] = [
          { x: splitW, y: 0 },
          { x: currentWidth, y: 0 },
          { x: currentWidth, y: segH },
          { x: splitW, y: segH },
        ];

        const baseLabel = `${columnIndex + 1}.${sIdx + 1}`;
        const baseProps = {
          materialId: targetSeg.customMaterialId || currentCustom.customMaterialId || wallMaterial.id,
          thickness: targetSeg.customThickness || currentCustom.customThickness || wallMaterial.thickness,
          color: targetSeg.customColor || currentCustom.customColor || wallMaterial.color,
          decorCode: targetSeg.customDecorCode || currentCustom.customDecorCode || wallMaterial.decorCode,
          textureCategory: (targetSeg.customTextureCategory || currentCustom.customTextureCategory || wallMaterial.textureCategory || 'WOOD') as any,
          reliefType: (targetSeg.customReliefType || currentCustom.customReliefType || wallMaterial.reliefType || 'FLAT') as any,
        };

        const subPieces: PolygonSubPiece[] = [
          {
            id: `sub-${Date.now()}-1`,
            points: leftPoly,
            partLabel: `${baseLabel}.1`,
            areaSqM: Math.round(((splitW * segH) / 1_000_000) * 1000) / 1000,
            ...baseProps,
          },
          {
            id: `sub-${Date.now()}-2`,
            points: rightPoly,
            partLabel: `${baseLabel}.2`,
            areaSqM: Math.round(((secondW * segH) / 1_000_000) * 1000) / 1000,
            ...baseProps,
          },
        ];

        const nextSegments = [...currentSegments];
        nextSegments[sIdx] = {
          ...targetSeg,
          subPieces,
        };

        const nextCustomPanels = {
          ...wall.customPanels,
          [columnIndex]: {
            ...currentCustom,
            segments: nextSegments,
          },
        };

        return {
          selectedSubPieceId: subPieces[0].id,
          project: {
            ...state.project,
            walls: state.project.walls.map((w) =>
              w.id === wallId ? { ...w, customPanels: nextCustomPanels } : w
            ),
          },
        };
      }

      const splitW = firstWidth > 0 && firstWidth < currentWidth ? firstWidth : Math.round(currentWidth / 2);
      const secondWidth = Math.max(10, currentWidth - splitW);

      const nextPanels: Record<number, CustomPanelConfig> = {};
      const nextJoints: Record<string, JointEdgeConfig> = {};

      // 1. Копируем колонки левее columnIndex
      Object.entries(wall.customPanels).forEach(([kStr, conf]) => {
        const k = Number(kStr);
        if (k < columnIndex) {
          nextPanels[k] = { ...conf, columnIndex: k };
        } else if (k > columnIndex) {
          nextPanels[k + 1] = {
            ...conf,
            columnIndex: k + 1,
          };
        }
      });

      // 2. Создаем левую колонку [columnIndex] с сохранением всех свойств и сегментов
      nextPanels[columnIndex] = {
        ...currentCustom,
        columnIndex,
        customWidth: splitW,
        segments: currentCustom.segments
          ? currentCustom.segments.map((s) => ({ ...s, id: `seg-${Date.now()}-L-${s.id}` }))
          : undefined,
      };

      // 3. Создаем правую колонку [columnIndex + 1] с точной копией всех свойств и сегментов
      nextPanels[columnIndex + 1] = {
        ...currentCustom,
        columnIndex: columnIndex + 1,
        customWidth: secondWidth,
        segments: currentCustom.segments
          ? currentCustom.segments.map((s) => ({ ...s, id: `seg-${Date.now()}-R-${s.id}` }))
          : undefined,
      };

      // 4. Сдвигаем вертикальные и горизонтальные стыки
      Object.entries(wall.customJoints).forEach(([jKey, jConfig]) => {
        // Вертикальные швы колонок: edge-v-{cIdx}
        if (jKey.startsWith('edge-v-') && !jKey.includes('left') && !jKey.includes('right') && !jKey.includes('end')) {
          const cIdx = Number(jKey.replace('edge-v-', ''));
          if (!isNaN(cIdx)) {
            if (cIdx < columnIndex) {
              nextJoints[jKey] = jConfig;
            } else if (cIdx >= columnIndex) {
              const newKey = `edge-v-${cIdx + 1}`;
              nextJoints[newKey] = {
                ...jConfig,
                id: newKey,
              };
            }
            return;
          }
        }

        // Горизонтальные швы сегментов: edge-h-{cIdx}-{sIdx}
        if (jKey.startsWith('edge-h-') && !jKey.includes('top') && !jKey.includes('bot')) {
          const parts = jKey.replace('edge-h-', '').split('-');
          if (parts.length === 2) {
            const cIdx = Number(parts[0]);
            const sIdx = Number(parts[1]);
            if (!isNaN(cIdx) && !isNaN(sIdx)) {
              if (cIdx < columnIndex) {
                nextJoints[jKey] = jConfig;
              } else if (cIdx === columnIndex) {
                // Левая колонка оставляет шов, а правая колонка дублирует его
                nextJoints[jKey] = jConfig;
                const rightKey = `edge-h-${columnIndex + 1}-${sIdx}`;
                nextJoints[rightKey] = {
                  ...jConfig,
                  id: rightKey,
                };
              } else if (cIdx > columnIndex) {
                const newKey = `edge-h-${cIdx + 1}-${sIdx}`;
                nextJoints[newKey] = {
                  ...jConfig,
                  id: newKey,
                };
              }
              return;
            }
          }
        }

        nextJoints[jKey] = jConfig;
      });

      // 5. Создаем вертикальный шов между левой и правой половинками
      nextJoints[`edge-v-${columnIndex}`] = {
        id: `edge-v-${columnIndex}`,
        orientation: 'VERTICAL',
        width: 0,
        isLED: false,
      };

      return {
        selectedColumnIndex: columnIndex,
        selectedSegmentIndex: 0,
        selectedCellKeys: [`${columnIndex}-0`],
        selectedPieceIds: [`panel-${columnIndex}-0`],
        project: {
          ...state.project,
          walls: state.project.walls.map((w) =>
            w.id === wallId
              ? {
                  ...w,
                  customPanels: nextPanels,
                  customJoints: nextJoints,
                }
              : w
          ),
        },
      };
    }),

  splitPanelDiagonally: (
    wallId: string,
    columnIndex: number,
    segmentIndex: number | null = 0,
    direction: 'BL_TR' | 'TL_BR' = 'BL_TR'
  ) =>
    set((state) => {
      const wall = state.project.walls.find((w) => w.id === wallId);
      if (!wall) return state;

      // 0. ПОЛИГОНАЛЬНАЯ МОДЕЛЬ (wall.panels)
      if (wall.panels && wall.panels.length > 0) {
        const targetPanel =
          wall.panels.find(
            (p) =>
              p.id === state.selectedSubPieceId ||
              state.selectedPieceIds.includes(p.id)
          ) ||
          wall.panels[columnIndex] ||
          wall.panels[0];

        if (targetPanel) {
          const remainingPanels = wall.panels.filter((p) => p.id !== targetPanel.id);
          const xs = targetPanel.points.map((p) => p.x);
          const ys = targetPanel.points.map((p) => p.y);
          const minX = Math.min(...xs);
          const maxX = Math.max(...xs);
          const minY = Math.min(...ys);
          const maxY = Math.max(...ys);

          const p1: Point2D = direction === 'BL_TR' ? { x: minX, y: minY } : { x: minX, y: maxY };
          const p2: Point2D = direction === 'BL_TR' ? { x: maxX, y: maxY } : { x: maxX, y: minY };

          const splitResult = PolygonSlicingEngine.splitPolygonByLine(targetPanel.points, p1, p2, 0);
          if (!splitResult) return state;

          const allPolys = splitResult.allPieces || [splitResult.pieceA, splitResult.pieceB];
          const newPanels: WallPanelPiece[] = allPolys.map((polyPts, pIdx) => ({
            ...targetPanel,
            id: `panel-${Date.now()}-${pIdx + 1}-${Math.random().toString(36).substring(2, 6)}`,
            points: polyPts,
            partLabel: `${targetPanel.partLabel}.${pIdx + 1}`,
          }));

          return {
            selectedPieceIds: [newPanels[0].id],
            selectedSubPieceId: newPanels[0].id,
            project: {
              ...state.project,
              walls: state.project.walls.map((w) =>
                w.id === wallId
                  ? {
                      ...w,
                      panels: [...remainingPanels, ...newPanels],
                    }
                  : w
              ),
            },
          };
        }
      }

      const currentCustom = wall.customPanels[columnIndex] || { columnIndex, segments: [] };
      const currentSegments = currentCustom.segments || [];
      const sIdx = segmentIndex ?? 0;

      const defaultMat = state.project.materials.find((m) => m.id === wall.zone.materialId) || DEFAULT_MATERIALS[0];
      const colMat = (currentCustom.customMaterialId && state.project.materials.find((m) => m.id === currentCustom.customMaterialId)) || defaultMat;
      const width = currentCustom.customWidth ?? colMat.width;

      let height = wall.height;
      const targetSeg = currentSegments[sIdx];
      if (currentSegments.length > 0 && targetSeg?.height) {
        height = targetSeg.height;
      }

      const existingSubPieces = (currentSegments.length > 0 ? targetSeg?.subPieces : currentCustom.subPieces) || [];
      let nextSubPieces: PolygonSubPiece[] = [];

      if (existingSubPieces.length > 0) {
        const targetSubId = state.selectedSubPieceId;
        let didSplit = false;

        existingSubPieces.forEach((sub, subIdx) => {
          if (targetSubId && sub.id !== targetSubId) {
            nextSubPieces.push(sub);
            return;
          }

          const xs = sub.points.map((p) => p.x);
          const ys = sub.points.map((p) => p.y);
          const subMinX = Math.min(...xs);
          const subMaxX = Math.max(...xs);
          const subMinY = Math.min(...ys);
          const subMaxY = Math.max(...ys);

          const p1: Point2D = direction === 'BL_TR' ? { x: subMinX, y: subMinY } : { x: subMinX, y: subMaxY };
          const p2: Point2D = direction === 'BL_TR' ? { x: subMaxX, y: subMaxY } : { x: subMaxX, y: subMinY };

          const splitResult = PolygonSlicingEngine.splitPolygonByLine(sub.points, p1, p2, 0);
          if (splitResult) {
            didSplit = true;
            const allPolys = splitResult.allPieces || [splitResult.pieceA, splitResult.pieceB];
            allPolys.forEach((polyPts, pIdx) => {
              nextSubPieces.push({
                ...sub,
                id: `sub-${Date.now()}-${subIdx}-${pIdx + 1}`,
                points: polyPts,
                partLabel: `${sub.partLabel || `${columnIndex + 1}.${sIdx + 1}`}.${pIdx + 1}`,
              });
            });
          } else {
            nextSubPieces.push(sub);
          }
        });

        if (!didSplit) {
          return state;
        }
      } else {
        const rectPoly: Point2D[] = [
          { x: 0, y: 0 },
          { x: width, y: 0 },
          { x: width, y: height },
          { x: 0, y: height },
        ];

        const p1: Point2D = direction === 'BL_TR' ? { x: 0, y: 0 } : { x: 0, y: height };
        const p2: Point2D = direction === 'BL_TR' ? { x: width, y: height } : { x: width, y: 0 };

        const splitResult = PolygonSlicingEngine.splitPolygonByLine(rectPoly, p1, p2, 0);
        if (!splitResult) return state;

        const baseMatId = targetSeg?.customMaterialId || currentCustom.customMaterialId || colMat.id;
        const baseColor = targetSeg?.customColor || currentCustom.customColor || colMat.color;
        const baseDecorCode = targetSeg?.customDecorCode || currentCustom.customDecorCode || colMat.decorCode;

        const allPolys = splitResult.allPieces || [splitResult.pieceA, splitResult.pieceB];
        nextSubPieces = allPolys.map((polyPts, pIdx) => ({
          id: `sub-${Date.now()}-${pIdx + 1}`,
          points: polyPts,
          materialId: baseMatId,
          color: baseColor,
          decorCode: baseDecorCode,
          partLabel: `${columnIndex + 1}.${sIdx + 1}.${pIdx + 1}`,
          patternAngleDeg: 0,
        }));
      }

      const nextCustomPanels = { ...wall.customPanels };

      if (currentSegments.length > 0) {
        const nextSegments = [...currentSegments];
        nextSegments[sIdx] = {
          ...nextSegments[sIdx],
          subPieces: nextSubPieces,
        };
        nextCustomPanels[columnIndex] = {
          ...currentCustom,
          segments: nextSegments,
        };
      } else {
        nextCustomPanels[columnIndex] = {
          ...currentCustom,
          subPieces: nextSubPieces,
        };
      }

      return {
        selectedSubPieceId: nextSubPieces[0]?.id || null,
        project: {
          ...state.project,
          walls: state.project.walls.map((w) =>
            w.id === wallId
              ? {
                  ...w,
                  customPanels: nextCustomPanels,
                }
              : w
          ),
        },
      };
    }),

  updateSubPieceLabel: (
    wallId: string,
    columnIndex: number,
    segmentIndex: number | null = 0,
    subPieceId: string,
    partLabel: string
  ) =>
    set((state) => {
      const wall = state.project.walls.find((w) => w.id === wallId);
      if (!wall) return state;

      if (wall.panels && wall.panels.length > 0) {
        const targetId = subPieceId || state.selectedPieceIds[0] || state.selectedSubPieceId;
        const nextPanels = wall.panels.map((p) =>
          p.id === targetId || (targetId && p.id.includes(targetId))
            ? { ...p, partLabel }
            : p
        );
        return {
          project: {
            ...state.project,
            walls: state.project.walls.map((w) =>
              w.id === wallId ? { ...w, panels: nextPanels } : w
            ),
          },
        };
      }

      const currentCustom = wall.customPanels[columnIndex] || { columnIndex, segments: [] };
      const currentSegments = currentCustom.segments || [];
      const sIdx = segmentIndex ?? 0;

      const updateSubs = (subs: PolygonSubPiece[] | undefined) =>
        subs?.map((sub) =>
          sub.id === subPieceId ? { ...sub, partLabel } : sub
        );

      const nextCustomPanels = { ...wall.customPanels };
      if (currentSegments.length > 0 && currentSegments[sIdx]) {
        const nextSegs = [...currentSegments];
        nextSegs[sIdx] = {
          ...nextSegs[sIdx],
          subPieces: updateSubs(nextSegs[sIdx].subPieces),
        };
        nextCustomPanels[columnIndex] = { ...currentCustom, segments: nextSegs };
      } else {
        nextCustomPanels[columnIndex] = {
          ...currentCustom,
          subPieces: updateSubs(currentCustom.subPieces),
        };
      }

      return {
        project: {
          ...state.project,
          walls: state.project.walls.map((w) =>
            w.id === wallId ? { ...w, customPanels: nextCustomPanels } : w
          ),
        },
      };
    }),

  updateSubPieceNote: (
    wallId: string,
    columnIndex: number,
    segmentIndex: number | null = 0,
    subPieceId: string,
    note: string
  ) =>
    set((state) => {
      const wall = state.project.walls.find((w) => w.id === wallId);
      if (!wall) return state;

      if (wall.panels && wall.panels.length > 0) {
        const targetId = subPieceId || state.selectedPieceIds[0] || state.selectedSubPieceId;
        const nextPanels = wall.panels.map((p) =>
          p.id === targetId || (targetId && p.id.includes(targetId))
            ? { ...p, note }
            : p
        );
        return {
          project: {
            ...state.project,
            walls: state.project.walls.map((w) =>
              w.id === wallId ? { ...w, panels: nextPanels } : w
            ),
          },
        };
      }

      const currentCustom = wall.customPanels[columnIndex] || { columnIndex, segments: [] };
      const currentSegments = currentCustom.segments || [];
      const sIdx = segmentIndex ?? 0;

      const updateSubs = (subs: PolygonSubPiece[] | undefined) =>
        subs?.map((sub) =>
          sub.id === subPieceId ? { ...sub, note } : sub
        );

      const nextCustomPanels = { ...wall.customPanels };
      if (currentSegments.length > 0 && currentSegments[sIdx]) {
        const nextSegs = [...currentSegments];
        nextSegs[sIdx] = {
          ...nextSegs[sIdx],
          note,
          subPieces: updateSubs(nextSegs[sIdx].subPieces),
        };
        nextCustomPanels[columnIndex] = { ...currentCustom, segments: nextSegs };
      } else {
        nextCustomPanels[columnIndex] = {
          ...currentCustom,
          note,
          subPieces: updateSubs(currentCustom.subPieces),
        };
      }

      return {
        project: {
          ...state.project,
          walls: state.project.walls.map((w) =>
            w.id === wallId ? { ...w, customPanels: nextCustomPanels } : w
          ),
        },
      };
    }),

  updateWallPanelNote: (wallId: string, panelId: string, note: string) =>
    set((state) => {
      const wall = state.project.walls.find((w) => w.id === wallId);
      if (!wall) return state;

      let nextPanels = wall.panels;
      if (wall.panels && wall.panels.length > 0) {
        nextPanels = wall.panels.map((p) =>
          p.id === panelId || (panelId && p.id.includes(panelId))
            ? { ...p, note }
            : p
        );
      }

      return {
        project: {
          ...state.project,
          walls: state.project.walls.map((w) =>
            w.id === wallId ? { ...w, panels: nextPanels } : w
          ),
        },
      };
    }),

  applyPanelSlicingResult: (
    wallId: string,
    columnIndex: number,
    segmentIndex: number | null = 0,
    subPieces: PolygonSubPiece[],
    panelId?: string | null
  ) =>
    set((state) => {
      const wall = state.project.walls.find((w) => w.id === wallId);
      if (!wall) return state;

      if (!subPieces || subPieces.length <= 1) {
        return { isSlicingModalOpen: false, slicingTarget: null };
      }

      // 0. ПОЛИГОНАЛЬНАЯ МОДЕЛЬ (wall.panels)
      if (wall.panels && wall.panels.length > 0) {
        const targetPanel =
          wall.panels.find(
            (p) =>
              p.id === panelId ||
              p.id === state.slicingTarget?.panelId ||
              p.id === state.selectedSubPieceId ||
              state.selectedPieceIds.includes(p.id)
          ) ||
          wall.panels[columnIndex] ||
          wall.panels[0];

        if (targetPanel) {
          const remainingPanels = wall.panels.filter((p) => p.id !== targetPanel.id);
          const xs = targetPanel.points.map((p) => p.x);
          const ys = targetPanel.points.map((p) => p.y);
          const minX = Math.min(...xs);
          const minY = Math.min(...ys);

          const newPanels: WallPanelPiece[] = subPieces.map((sp, idx) => ({
            ...targetPanel,
            id: `panel-${Date.now()}-${idx + 1}-${Math.random().toString(36).substring(2, 6)}`,
            points: sp.points.map((pt) => ({ x: Math.round(pt.x + minX), y: Math.round(pt.y + minY) })),
            materialId: sp.materialId || targetPanel.materialId,
            color: sp.color || targetPanel.color,
            decorCode: sp.decorCode || targetPanel.decorCode,
            decorName: sp.decorName || targetPanel.decorName,
            isVoid: sp.isVoid || false,
            thickness: sp.thickness || targetPanel.thickness,
            reliefType: sp.reliefType || targetPanel.reliefType,
            textureCategory: sp.textureCategory || targetPanel.textureCategory,
            textureMapping: sp.textureMapping ?? targetPanel.textureMapping,
            patternAngleDeg: sp.patternAngleDeg ?? targetPanel.patternAngleDeg,
            patternFlipX: sp.patternFlipX || targetPanel.patternFlipX,
            partLabel:
              subPieces.length > 1
                ? `${targetPanel.partLabel}.${idx + 1}`
                : targetPanel.partLabel,
          }));

          // Формируем швы между всеми разрезанными деталями (включая вертикальные, горизонтальные и диагональные)
          const newJoints: WallJointLine[] = [];
          for (let i = 0; i < newPanels.length; i++) {
            for (let j = i + 1; j < newPanels.length; j++) {
              const pA = newPanels[i];
              const pB = newPanels[j];
              const nA = pA.points.length;
              const nB = pB.points.length;

              for (let eA = 0; eA < nA; eA++) {
                const a1 = pA.points[eA];
                const a2 = pA.points[(eA + 1) % nA];
                const dxA = a2.x - a1.x;
                const dyA = a2.y - a1.y;
                const lenSqA = dxA * dxA + dyA * dyA;
                if (lenSqA < 1) continue;

                for (let eB = 0; eB < nB; eB++) {
                  const b1 = pB.points[eB];
                  const b2 = pB.points[(eB + 1) % nB];

                  // Проекция b1 и b2 на отрезок a1-a2
                  const distToSeg = (p: Point2D) => {
                    const t = ((p.x - a1.x) * dxA + (p.y - a1.y) * dyA) / lenSqA;
                    const proj = { x: a1.x + t * dxA, y: a1.y + t * dyA };
                    const d = Math.hypot(p.x - proj.x, p.y - proj.y);
                    return { t, d, proj };
                  };

                  const pr1 = distToSeg(b1);
                  const pr2 = distToSeg(b2);

                  // Если оба конца ребра b1-b2 лежат близко к линии ребра a1-a2 (<= 16 мм)
                  if (pr1.d <= 16 && pr2.d <= 16) {
                    const tMin = Math.max(0, Math.min(pr1.t, pr2.t));
                    const tMax = Math.min(1, Math.max(pr1.t, pr2.t));

                    if (tMax - tMin > 0.005) {
                      const segP1 = {
                        x: Math.round(a1.x + tMin * dxA),
                        y: Math.round(a1.y + tMin * dyA),
                      };
                      const segP2 = {
                        x: Math.round(a1.x + tMax * dxA),
                        y: Math.round(a1.y + tMax * dyA),
                      };
                      const segLen = Math.hypot(segP2.x - segP1.x, segP2.y - segP1.y);

                      if (segLen > 5) {
                        const isVert = Math.abs(segP1.x - segP2.x) < 2;
                        const isHoriz = Math.abs(segP1.y - segP2.y) < 2;
                        const orientation = isVert
                          ? 'VERTICAL'
                          : isHoriz
                          ? 'HORIZONTAL'
                          : 'DIAGONAL';

                        // Избегаем дубликатов швов
                        const isDup = newJoints.some(
                          (nj) =>
                            Math.hypot(nj.p1.x - segP1.x, nj.p1.y - segP1.y) < 5 &&
                            Math.hypot(nj.p2.x - segP2.x, nj.p2.y - segP2.y) < 5
                        );

                        if (!isDup) {
                          newJoints.push({
                            id: `joint-cut-${Date.now()}-${newJoints.length + 1}`,
                            p1: segP1,
                            p2: segP2,
                            width: 3,
                            isLED: false,
                            orientation,
                          });
                        }
                      }
                    }
                  }
                }
              }
            }
          }

          return {
            isSlicingModalOpen: false,
            slicingTarget: null,
            selectedPieceIds: [newPanels[0].id],
            selectedSubPieceId: newPanels[0].id,
            project: {
              ...state.project,
              walls: state.project.walls.map((w) =>
                w.id === wallId
                  ? {
                      ...w,
                      panels: [...remainingPanels, ...newPanels],
                      joints: [...(w.joints || []), ...newJoints],
                    }
                  : w
              ),
            },
          };
        }
      }

      const currentCustom = wall.customPanels[columnIndex] || { columnIndex, segments: [] };
      const currentSegments = currentCustom.segments || [];
      const sIdx = segmentIndex ?? 0;

      // 1. Проверяем геометрию кусочков
      const piecesBounds = subPieces.map((p) => {
        const xs = p.points.map((pt) => pt.x);
        const ys = p.points.map((pt) => pt.y);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);
        const isRect =
          p.points.length === 4 &&
          xs.every((x) => Math.abs(x - minX) < 1.5 || Math.abs(x - maxX) < 1.5) &&
          ys.every((y) => Math.abs(y - minY) < 1.5 || Math.abs(y - maxY) < 1.5);
        return { p, minX, maxX, minY, maxY, isRect, w: maxX - minX, h: maxY - minY };
      });

      const allRects = piecesBounds.every((b) => b.isRect);

      // 1.1 Чисто вертикальный разрез на всю высоту сплошной колонки -> превращаем в настоящие колонки со стыками
      if (allRects && currentSegments.length === 0) {
        const sortedByX = [...piecesBounds].sort((a, b) => a.minX - b.minX);
        const isPureVert = sortedByX.every(
          (b) => Math.abs(b.minY) < 2 && Math.abs(b.maxY - wall.height) < 2
        );

        if (isPureVert && sortedByX.length >= 2) {
          const numNew = sortedByX.length;
          const numAdded = numNew - 1;
          const nextCustomPanels: Record<number, CustomPanelConfig> = {};
          const nextCustomJoints: Record<string, JointEdgeConfig> = {};

          Object.entries(wall.customPanels).forEach(([kStr, conf]) => {
            const k = Number(kStr);
            if (k < columnIndex) {
              nextCustomPanels[k] = { ...conf, columnIndex: k };
            } else if (k > columnIndex) {
              nextCustomPanels[k + numAdded] = {
                ...conf,
                columnIndex: k + numAdded,
              };
            }
          });

          sortedByX.forEach((b, idx) => {
            const targetIdx = columnIndex + idx;
            nextCustomPanels[targetIdx] = {
              columnIndex: targetIdx,
              customWidth: Math.round(b.w),
              customMaterialId: b.p.materialId || currentCustom.customMaterialId,
              customThickness: b.p.thickness || currentCustom.customThickness,
              customColor: b.p.color || currentCustom.customColor,
              customDecorCode: b.p.decorCode || currentCustom.customDecorCode,
              customTextureCategory: b.p.textureCategory || currentCustom.customTextureCategory,
              customReliefType: (b.p.reliefType || currentCustom.customReliefType) as any,
              segments: [],
            };
          });

          Object.entries(wall.customJoints).forEach(([jKey, jConfig]) => {
            if (jKey.startsWith('edge-v-') && !jKey.includes('left') && !jKey.includes('right') && !jKey.includes('end')) {
              const cIdx = Number(jKey.replace('edge-v-', ''));
              if (!isNaN(cIdx)) {
                if (cIdx < columnIndex) {
                  nextCustomJoints[jKey] = jConfig;
                } else if (cIdx > columnIndex) {
                  const newKey = `edge-v-${cIdx + numAdded}`;
                  nextCustomJoints[newKey] = {
                    ...jConfig,
                    id: newKey,
                  };
                }
                return;
              }
            }
            nextCustomJoints[jKey] = jConfig;
          });

          for (let idx = 0; idx < numAdded; idx++) {
            const targetIdx = columnIndex + idx;
            const jointKey = `edge-v-${targetIdx}`;
            nextCustomJoints[jointKey] = {
              id: jointKey,
              orientation: 'VERTICAL',
              width: 3,
              isLED: false,
            };
          }

          return {
            isSlicingModalOpen: false,
            slicingTarget: null,
            selectedColumnIndex: columnIndex,
            selectedSegmentIndex: 0,
            selectedCellKeys: [`${columnIndex}-0`],
            selectedPieceIds: [`panel-${columnIndex}-0`],
            project: {
              ...state.project,
              walls: state.project.walls.map((w) =>
                w.id === wallId
                  ? {
                      ...w,
                      customPanels: nextCustomPanels,
                      customJoints: nextCustomJoints,
                    }
                  : w
              ),
            },
          };
        }
      }

      // 1.2 Чисто горизонтальный разрез -> превращаем в настоящие сегменты со стыками
      if (allRects) {
        const sortedByY = [...piecesBounds].sort((a, b) => a.minY - b.minY);
        const isPureHoriz = sortedByY.every(
          (b) => Math.abs(b.minX) < 2 && Math.abs(b.maxX - (currentCustom.customWidth || 1220)) < 2
        );

        if (isPureHoriz && sortedByY.length >= 2) {
          const nextCustomPanels = { ...wall.customPanels };
          const nextCustomJoints = { ...wall.customJoints };

          const newSegments: PanelSegmentConfig[] = sortedByY.map((b, idx) => ({
            id: `seg-${Date.now()}-${idx}`,
            height: Math.round(b.h),
            customMaterialId: b.p.materialId || currentCustom.customMaterialId,
            customThickness: b.p.thickness || currentCustom.customThickness,
            customColor: b.p.color || currentCustom.customColor,
            customDecorCode: b.p.decorCode || currentCustom.customDecorCode,
            customTextureCategory: b.p.textureCategory || currentCustom.customTextureCategory,
            customReliefType: (b.p.reliefType || currentCustom.customReliefType) as any,
          }));

          if (currentSegments.length === 0) {
            nextCustomPanels[columnIndex] = {
              ...currentCustom,
              segments: newSegments,
            };

            for (let idx = 0; idx < newSegments.length - 1; idx++) {
              const jKey = `edge-h-${columnIndex}-${idx}`;
              nextCustomJoints[jKey] = {
                id: jKey,
                orientation: 'HORIZONTAL',
                width: 3,
                isLED: false,
              };
            }
          } else {
            const nextSegs = [...currentSegments];
            nextSegs.splice(sIdx, 1, ...newSegments);
            nextCustomPanels[columnIndex] = {
              ...currentCustom,
              segments: nextSegs,
            };

            const numAdded = newSegments.length - 1;
            Object.entries(wall.customJoints).forEach(([jKey, jConfig]) => {
              if (jKey.startsWith(`edge-h-${columnIndex}-`)) {
                const segNum = Number(jKey.replace(`edge-h-${columnIndex}-`, ''));
                if (!isNaN(segNum) && segNum >= sIdx) {
                  const newKey = `edge-h-${columnIndex}-${segNum + numAdded}`;
                  nextCustomJoints[newKey] = { ...jConfig, id: newKey };
                }
              }
            });

            for (let idx = 0; idx < newSegments.length - 1; idx++) {
              const jKey = `edge-h-${columnIndex}-${sIdx + idx}`;
              nextCustomJoints[jKey] = {
                id: jKey,
                orientation: 'HORIZONTAL',
                width: 3,
                isLED: false,
              };
            }
          }

          return {
            isSlicingModalOpen: false,
            slicingTarget: null,
            selectedColumnIndex: columnIndex,
            selectedSegmentIndex: sIdx,
            selectedCellKeys: [`${columnIndex}-${sIdx}`],
            selectedPieceIds: [`panel-${columnIndex}-${sIdx}`],
            project: {
              ...state.project,
              walls: state.project.walls.map((w) =>
                w.id === wallId
                  ? {
                      ...w,
                      customPanels: nextCustomPanels,
                      customJoints: nextCustomJoints,
                    }
                  : w
              ),
            },
          };
        }
      }

      // 1.3 Диагональные / произвольные раскрои -> переводим стену в полигональную модель (wall.panels)
      const defaultMat =
        state.project.materials.find((m) => m.id === wall.zone.materialId) ||
        state.project.materials[0];
      const layout = LayoutEngine.calculateWallLayout(wall, defaultMat, state.project.materials);

      const targetLayoutPiece =
        layout.panels.find(
          (p) =>
            p.id === panelId ||
            p.subPieceId === panelId ||
            p.id === state.slicingTarget?.panelId ||
            p.id === state.selectedSubPieceId ||
            state.selectedPieceIds.includes(p.id)
        ) ||
        layout.panels.find(
          (p) => p.originalColumnIndex === columnIndex && (segmentIndex === null || p.originalSegmentIndex === segmentIndex)
        ) ||
        layout.panels[0];

      if (targetLayoutPiece) {
        const targetPts = targetLayoutPiece.polygonPoints || [
          { x: targetLayoutPiece.x, y: targetLayoutPiece.y },
          { x: targetLayoutPiece.x + targetLayoutPiece.width, y: targetLayoutPiece.y },
          { x: targetLayoutPiece.x + targetLayoutPiece.width, y: targetLayoutPiece.y + targetLayoutPiece.height },
          { x: targetLayoutPiece.x, y: targetLayoutPiece.y + targetLayoutPiece.height },
        ];
        const xs = targetPts.map((p) => p.x);
        const ys = targetPts.map((p) => p.y);
        const minX = Math.min(...xs);
        const minY = Math.min(...ys);

        const newPanels: WallPanelPiece[] = subPieces.map((sp, idx) => ({
          id: `panel-${Date.now()}-${idx + 1}-${Math.random().toString(36).substring(2, 6)}`,
          points: sp.points.map((pt) => ({ x: Math.round(pt.x + minX), y: Math.round(pt.y + minY) })),
          materialId: sp.materialId || targetLayoutPiece.materialId,
          color: sp.color || targetLayoutPiece.materialColor,
          decorCode: sp.decorCode || targetLayoutPiece.decorCode,
          decorName: sp.decorName || targetLayoutPiece.decorName,
          isVoid: sp.isVoid || false,
          thickness: sp.thickness || targetLayoutPiece.thickness,
          reliefType: (sp.reliefType || targetLayoutPiece.reliefType) as any,
          textureCategory: (sp.textureCategory || targetLayoutPiece.textureCategory) as any,
          textureMapping: sp.textureMapping ?? targetLayoutPiece.textureMapping,
          patternAngleDeg: sp.patternAngleDeg ?? targetLayoutPiece.patternAngleDeg,
          patternFlipX: sp.patternFlipX || targetLayoutPiece.patternFlipX,
          partLabel: subPieces.length > 1 ? `${targetLayoutPiece.partLabel}.${idx + 1}` : targetLayoutPiece.partLabel,
        }));

        const remainingPanels: WallPanelPiece[] = layout.panels
          .filter((p) => p.id !== targetLayoutPiece.id)
          .map((p) => ({
            id: p.id,
            points: p.polygonPoints || [
              { x: p.x, y: p.y },
              { x: p.x + p.width, y: p.y },
              { x: p.x + p.width, y: p.y + p.height },
              { x: p.x, y: p.y + p.height },
            ],
            materialId: p.materialId,
            color: p.materialColor,
            decorCode: p.decorCode,
            decorName: p.decorName,
            isVoid: p.isVoid,
            thickness: p.thickness,
            reliefType: p.reliefType as any,
            textureCategory: p.textureCategory as any,
            textureMapping: p.textureMapping,
          patternAngleDeg: p.patternAngleDeg,
            patternFlipX: p.patternFlipX,
            partLabel: p.partLabel,
          }));

        const initialJoints: WallJointLine[] = (
          (wall.joints && wall.joints.length > 0 ? wall.joints : layout.joints) || []
        ).map((j: any) => ({
          id: j.id,
          p1: j.p1 || { x: j.x, y: j.y },
          p2:
            j.p2 ||
            (j.orientation === 'HORIZONTAL'
              ? { x: j.x + (j.length || 0), y: j.y }
              : { x: j.x, y: j.y + (j.length || 0) }),
          width: j.width,
          orientation: j.orientation,
          isLED: j.isLED,
        }));

        return {
          isSlicingModalOpen: false,
          slicingTarget: null,
          selectedPieceIds: [newPanels[0].id],
          selectedSubPieceId: newPanels[0].id,
          project: {
            ...state.project,
            walls: state.project.walls.map((w) =>
              w.id === wallId
                ? {
                    ...w,
                    panels: [...remainingPanels, ...newPanels],
                    joints: initialJoints,
                  }
                : w
            ),
          },
        };
      }

      const nextCustomPanels = { ...wall.customPanels };

      if (currentSegments.length > 0) {
        const nextSegments = [...currentSegments];
        nextSegments[sIdx] = {
          ...nextSegments[sIdx],
          subPieces,
        };
        nextCustomPanels[columnIndex] = {
          ...currentCustom,
          segments: nextSegments,
        };
      } else {
        nextCustomPanels[columnIndex] = {
          ...currentCustom,
          subPieces,
        };
      }

      return {
        isSlicingModalOpen: false,
        slicingTarget: null,
        selectedSubPieceId: subPieces[0]?.id || null,
        project: {
          ...state.project,
          walls: state.project.walls.map((w) =>
            w.id === wallId
              ? {
                  ...w,
                  customPanels: nextCustomPanels,
                }
              : w
          ),
        },
      };
    }),

  setTextureMappings: (wallId, updates) => set((state) => {
    const wall = state.project.walls.find(w => w.id === wallId);
    if (!wall) return state;
    const mat = state.project.materials.find(m => m.id === wall.zone.materialId) || state.project.materials[0];
    const layout = LayoutEngine.calculateWallLayout(wall, mat, state.project.materials);
    const targets = [...layout.panels, ...(layout.slopes ?? []).map(slopeTexturePiece)];
    for (const update of updates) {
      const target = targets.find(t => t.id === update.id);
      if (!target) throw new Error('Деталь была изменена. Выберите её заново.');
      const error = textureMappingError({ ...target, textureMapping: { ...update.mapping, anchor: undefined }, patternFlipX: false });
      if (error) throw new Error(`${target.partLabel}: ${error}`);
    }
    const converted = wall.panels?.length ? { panels: wall.panels, joints: wall.joints } : LayoutEngine.convertLegacyWallToPanels(wall, mat, state.project.materials);
    const nextPanels = converted.panels.map(p => {
      const update = updates.find(u => u.id === p.id);
      if (!update) return p;
      const xs = p.points.map(pt => pt.x), ys = p.points.map(pt => pt.y);
      const bounds = layout.panels.find(t => t.id === p.id);
      const anchor = bounds ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
        : { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs)-Math.min(...xs), height: Math.max(...ys)-Math.min(...ys) };
      return { ...p, textureMapping: { ...update.mapping, anchor }, patternAngleDeg: update.mapping.angleDeg, patternFlipX: false };
    });
    const openings = wall.openings.map(op => {
      const slopes = ensureOpeningSlopes(op);
      let changed = false;
      for (const side of ['top', 'bottom', 'left', 'right'] as const) {
        const update = updates.find(u => u.id === `slope-${op.id}-${side}`);
        if (update) { slopes[side] = { ...slopes[side], textureMapping: { ...update.mapping, anchor: undefined } }; changed = true; }
      }
      return changed ? { ...op, slopes } : op;
    });
    return { isDirty: true, project: { ...state.project, updatedAt: new Date().toISOString(),
      walls: state.project.walls.map(w => w.id === wallId ? { ...w, panels: nextPanels, joints: converted.joints, openings } : w) } };
  }),

  setSubPieceMaterial: (
    wallId: string,
    columnIndex: number,
    segmentIndex: number | null = 0,
    subPieceId: string,
    materialId: string,
    decorCode?: string,
    decorName?: string,
    color?: string
  ) =>
    set((state) => {
      const wall = state.project.walls.find((w) => w.id === wallId);
      if (!wall) return state;

      if (wall.panels && wall.panels.length > 0) {
        const targetId = subPieceId || state.selectedPieceIds[0] || state.selectedSubPieceId;
        const nextPanels = wall.panels.map((p) =>
          p.id === targetId || (targetId && p.id.includes(targetId))
            ? {
                ...p,
                materialId,
                isVoid: materialId === MATERIAL_NONE_ID,
                decorCode: decorCode || p.decorCode,
                decorName: decorName || p.decorName,
                color: color || p.color,
              }
            : p
        );
        return {
          project: {
            ...state.project,
            walls: state.project.walls.map((w) =>
              w.id === wallId ? { ...w, panels: nextPanels } : w
            ),
          },
        };
      }

      const currentCustom = wall.customPanels[columnIndex] || { columnIndex, segments: [] };
      const currentSegments = currentCustom.segments || [];
      const sIdx = segmentIndex ?? 0;

      const isVoid = materialId === MATERIAL_NONE_ID;
      const updateSubs = (subs: PolygonSubPiece[] | undefined) =>
        subs?.map((sub) =>
          sub.id === subPieceId
            ? {
                ...sub,
                materialId,
                decorCode: decorCode || sub.decorCode,
                decorName: decorName || sub.decorName,
                color: color || sub.color,
                isVoid,
              }
            : sub
        );

      const nextCustomPanels = { ...wall.customPanels };
      if (currentSegments.length > 0 && currentSegments[sIdx]) {
        const nextSegs = [...currentSegments];
        nextSegs[sIdx] = {
          ...nextSegs[sIdx],
          subPieces: updateSubs(nextSegs[sIdx].subPieces),
        };
        nextCustomPanels[columnIndex] = { ...currentCustom, segments: nextSegs };
      } else {
        nextCustomPanels[columnIndex] = {
          ...currentCustom,
          subPieces: updateSubs(currentCustom.subPieces),
        };
      }

      return {
        project: {
          ...state.project,
          walls: state.project.walls.map((w) =>
            w.id === wallId ? { ...w, customPanels: nextCustomPanels } : w
          ),
        },
      };
    }),

  deleteSubPiece: (
    wallId: string,
    columnIndex: number,
    segmentIndex: number | null = 0,
    subPieceId: string
  ) =>
    set((state) => {
      const wall = state.project.walls.find((w) => w.id === wallId);
      if (!wall) return state;

      if (wall.panels && wall.panels.length > 0) {
        const targetId = subPieceId || state.selectedPieceIds[0] || state.selectedSubPieceId;
        const nextPanels = wall.panels.map((p) =>
          p.id === targetId || (targetId && p.id.includes(targetId))
            ? { ...p, materialId: MATERIAL_NONE_ID, isVoid: true, partLabel: 'ПУСТО' }
            : p
        );
        return {
          project: {
            ...state.project,
            walls: state.project.walls.map((w) =>
              w.id === wallId ? { ...w, panels: nextPanels } : w
            ),
          },
        };
      }

      const currentCustom = wall.customPanels[columnIndex] || { columnIndex, segments: [] };
      const currentSegments = currentCustom.segments || [];
      const sIdx = segmentIndex ?? 0;

      const updateSubs = (subs: PolygonSubPiece[] | undefined) =>
        subs?.map((sub) =>
          sub.id === subPieceId
            ? {
                ...sub,
                materialId: MATERIAL_NONE_ID,
                isVoid: true,
                partLabel: 'ПУСТО',
              }
            : sub
        );

      const nextCustomPanels = { ...wall.customPanels };
      if (currentSegments.length > 0 && currentSegments[sIdx]) {
        const nextSegs = [...currentSegments];
        nextSegs[sIdx] = {
          ...nextSegs[sIdx],
          subPieces: updateSubs(nextSegs[sIdx].subPieces),
        };
        nextCustomPanels[columnIndex] = { ...currentCustom, segments: nextSegs };
      } else {
        nextCustomPanels[columnIndex] = {
          ...currentCustom,
          subPieces: updateSubs(currentCustom.subPieces),
        };
      }

      return {
        project: {
          ...state.project,
          walls: state.project.walls.map((w) =>
            w.id === wallId ? { ...w, customPanels: nextCustomPanels } : w
          ),
        },
      };
    }),

  resetPanelConfig: (wallId: string, columnIndex: number) =>
    set((state) => ({
      selectedSegmentIndex: 0,
      selectedCellKeys: [`${columnIndex}-0`],
      selectedPieceIds: [`panel-${columnIndex}-0`],
      project: {
        ...state.project,
        walls: state.project.walls.map((w) => {
          if (w.id !== wallId) return w;
          const nextCustom = { ...w.customPanels };
          delete nextCustom[columnIndex];
          return {
            ...w,
            customPanels: nextCustom,
          };
        }),
      },
    })),

  applyGridPreset: (wallId: string, preset: GridPresetType) =>
    set((state) => ({
      selectedColumnIndex: null,
      selectedSegmentIndex: null,
      selectedCellKeys: [],
      selectedPieceIds: [],
      selectedJointId: null,
      selectedJointIds: [],
      project: {
        ...state.project,
        walls: state.project.walls.map((w) => {
          if (w.id !== wallId) return w;
          const customPanels: Record<number, CustomPanelConfig> = {};
          const customJoints: Record<string, JointEdgeConfig> = {};

          switch (preset) {
            case 'STANDARD_1220': {
              const mat = state.project.materials.find((m) => m.id === 'mat-sheet-1220') || DEFAULT_MATERIALS[0];
              const basePanel: WallPanelPiece = {
                id: `panel-${w.id}-0`,
                points: [
                  { x: 0, y: 0 },
                  { x: w.width, y: 0 },
                  { x: w.width, y: w.height },
                  { x: 0, y: w.height },
                ],
                materialId: 'mat-sheet-1220',
                color: mat.color,
                decorCode: mat.decorCode,
                decorName: mat.decorName,
                thickness: mat.thickness || 5,
                reliefType: 'FLAT',
                textureCategory: mat.textureCategory || 'WOOD',
                isVoid: false,
                partLabel: '1.1',
              };
              const sliced = PolygonSlicingEngine.sliceWallPanelIntoStrips(basePanel, 1220, DEFAULT_JOINT_GAP_MM);
              const sanitized = PolygonSlicingEngine.subtractOpeningsFromWallPanels(
                sliced.newPanels,
                sliced.joints,
                w.openings
              );
              return {
                ...w,
                customPanels: {},
                customJoints: {},
                panels: sanitized.panels,
                joints: sanitized.joints,
                zone: { ...w.zone, materialId: 'mat-sheet-1220', jointProfileType: 'JOINT_3' },
              };
            }

            case 'SLATS_145': {
              const mat = state.project.materials.find((m) => m.id === 'mat-slat-16') || DEFAULT_MATERIALS[1];
              const basePanel: WallPanelPiece = {
                id: `panel-${w.id}-0`,
                points: [
                  { x: 0, y: 0 },
                  { x: w.width, y: 0 },
                  { x: w.width, y: w.height },
                  { x: 0, y: w.height },
                ],
                materialId: 'mat-slat-16',
                color: mat.color,
                decorCode: mat.decorCode,
                decorName: mat.decorName,
                thickness: mat.thickness || 16,
                reliefType: 'STEP_SLAT',
                textureCategory: mat.textureCategory || 'WOOD',
                isVoid: false,
                partLabel: '1.1',
              };
              const sliced = PolygonSlicingEngine.sliceWallPanelIntoStrips(basePanel, 145, 0);
              const sanitized = PolygonSlicingEngine.subtractOpeningsFromWallPanels(
                sliced.newPanels,
                sliced.joints,
                w.openings
              );
              return {
                ...w,
                customPanels: {},
                customJoints: {},
                panels: sanitized.panels,
                joints: sanitized.joints,
                zone: { ...w.zone, materialId: 'mat-slat-16', jointProfileType: 'JOINT_3' },
              };
            }

            case 'TIERS_900_1800': {
              const totalCols = Math.ceil(w.width / 1228) + 2;
              for (let i = 0; i < totalCols; i++) {
                customPanels[i] = {
                  columnIndex: i,
                  customWidth: 1220,
                  segments: [
                    { id: `seg-${i}-0`, height: 900 },
                    { id: `seg-${i}-1`, height: 1000 },
                    { id: `seg-${i}-2`, height: undefined },
                  ],
                };
                customJoints[`edge-h-${i}-1`] = {
                  id: `edge-h-${i}-1`,
                  orientation: 'HORIZONTAL',
                  width: 10,
                  isLED: true,
                };
              }
              return { ...w, customPanels, customJoints };
            }

            case 'CENTER_TV_NICHE': {
              const colWidth = 800;
              const totalCols = Math.ceil(w.width / colWidth);
              for (let i = 0; i < totalCols; i++) {
                const isCenter = i >= 1 && i <= totalCols - 2;
                customPanels[i] = {
                  columnIndex: i,
                  customWidth: colWidth,
                  customMaterialId: isCenter ? MATERIAL_NONE_ID : 'mat-slat-16',
                };
                if (isCenter) {
                  customJoints[`edge-v-${i}`] = {
                    id: `edge-v-${i}`,
                    orientation: 'VERTICAL',
                    width: 10,
                    isLED: true,
                  };
                }
              }
              return { ...w, customPanels, customJoints };
            }
          }
        }),
      },
    })),

  addRadiusColumn: (wallId: string, type: RadiusType = 'OUTER_CORNER', radius: number = 0, angleDeg?: number) =>
    set((state) => {
      const wall = state.project.walls.find((w) => w.id === wallId);
      if (!wall) return state;

      const targetCol = state.selectedColumnIndex !== null ? state.selectedColumnIndex : 0;
      const actualAngle = angleDeg ?? 90;
      const radiusConfig: RadiusConfig = {
        type,
        radius,
        angleDeg: actualAngle,
      };

      const currentCustom = wall.customPanels[targetCol] || { columnIndex: targetCol };
      const nextCustomPanels = {
        ...wall.customPanels,
        [targetCol]: {
          ...currentCustom,
          radiusConfig,
          customWidth: undefined, // ширина теперь рассчитывается по формуле дуги
        },
      };

      return {
        selectedColumnIndex: targetCol,
        selectedSegmentIndex: 0,
        selectedCellKeys: [`${targetCol}-0`],
        selectedPieceIds: [`panel-${targetCol}-0`],
        selectedJointId: null,
        selectedJointIds: [],
        project: {
          ...state.project,
          selectedOpeningId: null,
          walls: state.project.walls.map((w) =>
            w.id === wallId ? { ...w, customPanels: nextCustomPanels } : w
          ),
        },
      };
    }),

  addWallBend: (
    wallId: string,
    type: RadiusType = 'OUTER_CORNER',
    x?: number,
    radius: number = 0,
    angleDeg: number = 90
  ) => {
    const bendId = `bend-${Date.now()}`;
    set((state) => {
      const wall = state.project.walls.find((w) => w.id === wallId);
      if (!wall) return state;

      const arcLen = Math.round((Math.PI * radius * angleDeg) / 180);
      const defaultX = x !== undefined ? x : Math.min(wall.width - arcLen, Math.max(0, Math.round((wall.width - arcLen) / 2)));

      const newBend: WallBend = {
        id: bendId,
        x: defaultX,
        type,
        radius,
        angleDeg,
        name: type === 'INNER_CORNER' ? 'Внутренний угол' : 'Внешний угол',
      };

      const currentBends = wall.bends || [];
      return {
        selectedColumnIndex: null,
        selectedSegmentIndex: null,
        selectedCellKeys: [],
        selectedPieceIds: [],
        selectedJointId: null,
        selectedJointIds: [],
        selectedWallBendId: bendId,
        project: {
          ...state.project,
          selectedOpeningId: null,
          walls: state.project.walls.map((w) =>
            w.id === wallId ? { ...w, bends: [...currentBends, newBend] } : w
          ),
        },
      };
    });
    return bendId;
  },

  updateWallBend: (wallId: string, bendId: string, updates: Partial<WallBend>) =>
    set((state) => ({
      project: {
        ...state.project,
        walls: state.project.walls.map((w) => {
          if (w.id !== wallId) return w;
          const currentBends = w.bends || [];
          return {
            ...w,
            bends: currentBends.map((b) => (b.id === bendId ? { ...b, ...updates } : b)),
          };
        }),
      },
    })),

  deleteWallBend: (wallId: string, bendId: string) =>
    set((state) => ({
      selectedWallBendId: state.selectedWallBendId === bendId ? null : state.selectedWallBendId,
      project: {
        ...state.project,
        walls: state.project.walls.map((w) => {
          if (w.id !== wallId) return w;
          return {
            ...w,
            bends: (w.bends || []).filter((b) => b.id !== bendId),
          };
        }),
      },
    })),

  setPanelRadiusConfig: (wallId: string, columnIndex: number, config: RadiusConfig | undefined) =>
    set((state) => ({
      project: {
        ...state.project,
        walls: state.project.walls.map((w) => {
          if (w.id !== wallId) return w;
          const currentCustom = w.customPanels[columnIndex] || { columnIndex };
          const nextCustomPanels = { ...w.customPanels };
          if (!config) {
            const { radiusConfig: _, ...rest } = currentCustom;
            nextCustomPanels[columnIndex] = rest;
          } else {
            nextCustomPanels[columnIndex] = {
              ...currentCustom,
              radiusConfig: config,
              customWidth: undefined,
            };
          }
          return {
            ...w,
            customPanels: nextCustomPanels,
          };
        }),
      },
    })),

  addOpening: (wallId: string, type: OpeningType) =>
    set((state) => {
      const wall = state.project.walls.find((w) => w.id === wallId);
      if (!wall) return state;

      const newOpening = createDefaultOpening(type, wall.width, wall.height);
      return {
        selectedColumnIndex: null,
        selectedSegmentIndex: null,
        selectedCellKeys: [],
        selectedPieceIds: [],
        selectedJointId: null,
        selectedJointIds: [],
        project: {
          ...state.project,
          walls: state.project.walls.map((w) =>
            w.id === wallId ? { ...w, openings: [...w.openings, newOpening] } : w
          ),
          selectedOpeningId: newOpening.id,
        },
      };
    }),

  updateOpening: (wallId: string, updated: Partial<Opening> & { id: string }) =>
    set((state) => ({
      project: {
        ...state.project,
        walls: state.project.walls.map((w) =>
          w.id === wallId
            ? {
                ...w,
                openings: w.openings.map((op) => {
                  if (op.id !== updated.id) return op;
                  const next = { ...op, ...updated };
                  if (op.type === 'DOOR' && updated.isPortal !== undefined) {
                    if (updated.name === undefined && op.name === getOpeningTypeLabel(op)) {
                      next.name = getOpeningTypeLabel(next);
                    }
                  }
                  if (isPortalOpening(next)) next.isCutout = true;
                  return next;
                }),
              }
            : w
        ),
      },
    })),

  applyOpening: (wallId: string, openingId: string) =>
    set((state) => {
      const wall = state.project.walls.find((w) => w.id === wallId);
      if (!wall) return state;

      const opening = wall.openings.find((op) => op.id === openingId);
      if (!opening || opening.isApplied) return state;

      let nextPanels = wall.panels;
      let nextJoints = (wall.joints || []).filter((j) => !j.id.startsWith('joint-op-'));

      // Если в стене еще нет wall.panels, инициализируем их из текущего layout'а
      if ((!nextPanels || nextPanels.length === 0) && opening.isCutout !== false) {
        const defaultMat =
          state.project.materials.find((m) => m.id === wall.zone.materialId) ||
          state.project.materials[0];
        const layout = LayoutEngine.calculateWallLayout(
          wall,
          defaultMat,
          state.project.materials
        );
        nextPanels = layout.panels.map((p) => ({
          id: p.id,
          points: p.polygonPoints || [
            { x: p.x, y: p.y },
            { x: p.x + p.width, y: p.y },
            { x: p.x + p.width, y: p.y + p.height },
            { x: p.x, y: p.y + p.height },
          ],
          materialId: p.materialId,
          color: p.materialColor,
          decorCode: p.decorCode,
          decorName: p.decorName,
          partLabel: p.partLabel,
          isVoid: p.isVoid,
          thickness: p.thickness,
          reliefType: p.reliefType as any,
          textureCategory: p.textureCategory as any,
          textureMapping: p.textureMapping,
          patternAngleDeg: p.patternAngleDeg,
          patternFlipX: p.patternFlipX,
        }));
        nextJoints = layout.joints.map((j) => ({
          id: j.id,
          p1: j.p1 || { x: j.x, y: j.y },
          p2:
            j.p2 ||
            (j.orientation === 'HORIZONTAL'
              ? { x: j.x + j.length, y: j.y }
              : { x: j.x, y: j.y + j.length }),
          width: j.width,
          orientation: j.orientation,
          isLED: j.isLED,
        }));
      }

      else if (nextPanels && nextPanels.length > 0 && opening.isCutout !== false) {
        const cutResult = PolygonSlicingEngine.cutOpeningFromWallPanels(nextPanels, opening, DEFAULT_JOINT_GAP_MM);
        nextPanels = cutResult.newPanels;
        nextJoints = [...nextJoints, ...(cutResult.joints || [])];
      }

      const updatedOpenings = wall.openings.map((op) =>
        op.id === openingId ? { ...op, isApplied: true } : op
      );

      return {
        isDirty: true,
        project: {
          ...state.project,
          walls: state.project.walls.map((w) =>
            w.id === wallId
              ? {
                  ...w,
                  openings: updatedOpenings,
                  panels: nextPanels,
                  joints: nextJoints,
                }
              : w
          ),
        },
      };
    }),

  removeOpening: (wallId: string, openingId: string) =>
    set((state) => ({
      isDirty: true,
      project: {
        ...state.project,
        selectedOpeningId:
          state.project.selectedOpeningId === openingId ? null : state.project.selectedOpeningId,
        walls: state.project.walls.map((w) =>
          w.id === wallId
            ? {
                ...w,
                openings: w.openings.filter((op) => op.id !== openingId),
                joints: (w.joints || []).filter((j) => !j.id.includes(openingId)),
              }
            : w
        ),
      },
    })),

  setOpeningFramingSide: (
    wallId: string,
    openingId: string,
    side: 'left' | 'right' | 'top' | 'bottom',
    config: Partial<OpeningEdgeConfig>
  ) =>
    set((state) => {
      const wall = state.project.walls.find((w) => w.id === wallId);
      if (!wall) return state;

      const opening = wall.openings.find((op) => op.id === openingId);
      if (!opening) return state;

      const currentFraming = ensureOpeningFraming(opening);
      const updatedSide = { ...currentFraming[side], ...config };
      const updatedFraming: OpeningFramingConfig = { ...currentFraming, [side]: updatedSide };

      const updatedOpenings = wall.openings.map((op) =>
        op.id === openingId ? { ...op, framing: updatedFraming } : op
      );

      let nextPanels = wall.panels;
      let nextJoints = wall.joints || [];
      if (nextPanels && nextPanels.length > 0) {
        const sanitized = PolygonSlicingEngine.subtractOpeningsFromWallPanels(
          nextPanels,
          nextJoints,
          updatedOpenings
        );
        nextPanels = sanitized.panels;
        nextJoints = sanitized.joints;
      }

      return {
        isDirty: true,
        project: {
          ...state.project,
          walls: state.project.walls.map((w) =>
            w.id === wallId
              ? {
                  ...w,
                  openings: updatedOpenings,
                  panels: nextPanels,
                  joints: nextJoints,
                }
              : w
          ),
        },
      };
    }),

  setOpeningFramingPreset: (
    wallId: string,
    openingId: string,
    preset: 'NONE' | '8' | 'LED_10' | 'CUSTOM',
    profileArticle?: string,
    profileColor?: string
  ) =>
    set((state) => {
      const wall = state.project.walls.find((w) => w.id === wallId);
      if (!wall) return state;

      const opening = wall.openings.find((op) => op.id === openingId);
      if (!opening) return state;

      let edgeConf: OpeningEdgeConfig = { width: 0, isLED: false };
      if (preset === '8') {
        edgeConf = { width: 8, isLED: false, profileArticle, profileColor };
      } else if (preset === 'LED_10') {
        edgeConf = { width: 10, isLED: true, profileArticle, profileColor };
      }

      const isDoorway = isDoorOrPortal(opening);
      const updatedFraming: OpeningFramingConfig = {
        left: { ...edgeConf },
        right: { ...edgeConf },
        top: { ...edgeConf },
        bottom: isDoorway ? { width: 0, isLED: false } : { ...edgeConf },
      };

      const updatedOpenings = wall.openings.map((op) =>
        op.id === openingId ? { ...op, framing: updatedFraming } : op
      );

      let nextPanels = wall.panels;
      let nextJoints = wall.joints || [];
      if (nextPanels && nextPanels.length > 0) {
        const sanitized = PolygonSlicingEngine.subtractOpeningsFromWallPanels(
          nextPanels,
          nextJoints,
          updatedOpenings
        );
        nextPanels = sanitized.panels;
        nextJoints = sanitized.joints;
      }

      return {
        isDirty: true,
        project: {
          ...state.project,
          walls: state.project.walls.map((w) =>
            w.id === wallId
              ? {
                  ...w,
                  openings: updatedOpenings,
                  panels: nextPanels,
                  joints: nextJoints,
                }
              : w
          ),
        },
      };
    }),

  splitPanelAroundOpening: (wallId: string, openingId: string) =>
    set((state) => {
      const wall = state.project.walls.find((w) => w.id === wallId);
      if (!wall) return state;

      const opening = wall.openings.find((op) => op.id === openingId);
      if (!opening) return state;

      let nextPanels = wall.panels;
      if (!nextPanels || nextPanels.length === 0) {
        const defaultMat =
          state.project.materials.find((m) => m.id === wall.zone.materialId) ||
          state.project.materials[0];
        const layout = LayoutEngine.calculateWallLayout(
          wall,
          defaultMat,
          state.project.materials
        );
        nextPanels = layout.panels.map((p) => ({
          id: p.id,
          points: p.polygonPoints || [
            { x: p.x, y: p.y },
            { x: p.x + p.width, y: p.y },
            { x: p.x + p.width, y: p.y + p.height },
            { x: p.x, y: p.y + p.height },
          ],
          materialId: p.materialId,
          color: p.materialColor,
          decorCode: p.decorCode,
          decorName: p.decorName,
          partLabel: p.partLabel,
          isVoid: p.isVoid,
          thickness: p.thickness,
          reliefType: p.reliefType as any,
          textureCategory: p.textureCategory as any,
        }));
      }

      const splitPanels: WallPanelPiece[] = [];
      nextPanels.forEach((p) => {
        const result = PolygonSlicingEngine.splitPanelAroundOpening(p, opening);
        splitPanels.push(...result);
      });

      return {
        isDirty: true,
        project: {
          ...state.project,
          walls: state.project.walls.map((w) =>
            w.id === wallId
              ? {
                  ...w,
                  panels: splitPanels,
                }
              : w
          ),
        },
      };
    }),

  // Сохранение и управление проектами
  saveCurrentProject: async () => {
    const currentProject = get().project;
    const updated = {
      ...currentProject,
      updatedAt: new Date().toISOString(),
    };
    await localProjectRepository.saveProject(updated);
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    set((state) => {
      if (state.project.id !== currentProject.id) return state;
      const changedWhileSaving = projectContentChanged(currentProject, state.project);
      return {
        project: changedWhileSaving ? state.project : { ...state.project, updatedAt: updated.updatedAt },
        isDirty: changedWhileSaving,
        lastSavedAt: timeStr,
      };
    });
  },

  loadProjectById: async (id: string) => {
    const loaded = await localProjectRepository.getProject(id);
    if (!loaded) return false;
    const initialWallId = loaded.walls[0]?.id || null;
    const timeStr = new Date(loaded.updatedAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    set({
      project: {
        ...loaded,
        materials: localCatalogRepository.mergePanels(loaded.materials, false, loaded.excludedCatalogPanelIds),
        selectedWallId: initialWallId,
        selectedOpeningId: null,
      },
      selectedColumnIndex: null,
      selectedSegmentIndex: null,
      selectedCellKeys: [],
      selectedPieceIds: [],
      selectedJointId: null,
      selectedJointIds: [],
      selectedWallBendId: null,
      selectedSubPieceId: null,
      isDirty: false,
      lastSavedAt: timeStr,
    });
    return true;
  },

  createNewProject: (name?: string, wallWidth?: number, wallHeight?: number, roomName?: string) => {
    const newProj = createDefaultProject(name || 'Новый проект', wallWidth || 3600, wallHeight || 2750, roomName);
    newProj.materials = localCatalogRepository.mergePanels(newProj.materials, true);
    localProjectRepository.saveProject(newProj);
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    set({
      project: newProj,
      selectedColumnIndex: null,
      selectedSegmentIndex: null,
      selectedCellKeys: [],
      selectedPieceIds: [],
      selectedJointId: null,
      selectedJointIds: [],
      selectedWallBendId: null,
      selectedSubPieceId: null,
      isDirty: false,
      lastSavedAt: timeStr,
    });
    return newProj;
  },

  setProject: (project: Project) => {
    const initialWallId = project.walls[0]?.id || null;
    const timeStr = new Date(project.updatedAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    set({
      project: {
        ...project,
        materials: localCatalogRepository.mergePanels(project.materials, false, project.excludedCatalogPanelIds),
        selectedWallId: initialWallId,
        selectedOpeningId: null,
      },
      selectedColumnIndex: null,
      selectedSegmentIndex: null,
      selectedCellKeys: [],
      selectedPieceIds: [],
      selectedJointId: null,
      selectedJointIds: [],
      selectedWallBendId: null,
      selectedSubPieceId: null,
      isDirty: false,
      lastSavedAt: timeStr,
    });
  },

  setProjectName: (name: string) => {
    set((state) => ({
      isDirty: true,
      project: {
        ...state.project,
        name,
        updatedAt: new Date().toISOString(),
      },
    }));
  },

  duplicateProject: async (id: string, newName?: string) => {
    return await localProjectRepository.duplicateProject(id, newName);
  },

  deleteProjectById: async (id: string) => {
    await localProjectRepository.deleteProject(id);
  },

  exportProjectFile: () => {
    localProjectRepository.exportProjectAsJson(get().project);
  },

  slicePanelToSheetFormat: (
    wallId: string,
    panelId?: string,
    columnIndex?: number,
    _segmentIndex?: number
  ) =>
    set((state) => {
      const wall = state.project.walls.find((w) => w.id === wallId);
      if (!wall) return state;

      let nextPanels = wall.panels;
      let nextJoints = wall.joints ? [...wall.joints] : [];

      // Если в стене еще нет wall.panels, инициализируем их из текущего layout'а
      if (!nextPanels || nextPanels.length === 0) {
        const defaultMat =
          state.project.materials.find((m) => m.id === wall.zone.materialId) ||
          state.project.materials[0];
        const layout = LayoutEngine.calculateWallLayout(
          wall,
          defaultMat,
          state.project.materials
        );
        nextPanels = layout.panels.map((p) => ({
          id: p.id,
          points: p.polygonPoints || [
            { x: p.x, y: p.y },
            { x: p.x + p.width, y: p.y },
            { x: p.x + p.width, y: p.y + p.height },
            { x: p.x, y: p.y + p.height },
          ],
          materialId: p.materialId,
          color: p.materialColor,
          decorCode: p.decorCode,
          decorName: p.decorName,
          partLabel: p.partLabel,
          isVoid: p.isVoid,
          thickness: p.thickness,
          reliefType: p.reliefType as any,
          textureCategory: p.textureCategory as any,
          textureMapping: p.textureMapping,
          patternAngleDeg: p.patternAngleDeg,
          patternFlipX: p.patternFlipX,
        }));
        nextJoints = layout.joints.map((j) => ({
          id: j.id,
          p1: j.p1 || { x: j.x, y: j.y },
          p2:
            j.p2 ||
            (j.orientation === 'HORIZONTAL'
              ? { x: j.x + j.length, y: j.y }
              : { x: j.x, y: j.y + j.length }),
          width: j.width,
          orientation: j.orientation,
          isLED: j.isLED,
        }));
      }

      if (!nextPanels || nextPanels.length === 0) return state;

      // Находим целевую деталь
      const targetPanel =
        (panelId && nextPanels.find((p) => p.id === panelId || (p as any).subPieceId === panelId)) ||
        (columnIndex !== null && columnIndex !== undefined
          ? nextPanels.find((p) => (p as any).originalColumnIndex === columnIndex)
          : null) ||
        nextPanels[0];

      if (!targetPanel) return state;

      const mat =
        state.project.materials.find((m) => m.id === targetPanel.materialId) ||
        state.project.materials.find((m) => m.id === wall.zone.materialId) ||
        state.project.materials[0];

      const maxW = mat?.width && mat.width > 50 ? mat.width : 1220;
      const maxH = mat?.height && mat.height > 50 ? mat.height : 2800;

      const sliced = PolygonSlicingEngine.slicePanelByMaxSheetDimensions(targetPanel, maxW, maxH, DEFAULT_PROFILES[wall.zone.jointProfileType]?.width ?? DEFAULT_JOINT_GAP_MM);
      if (!sliced.newPanels || sliced.newPanels.length <= 1) {
        return state;
      }

      const remainingPanels = nextPanels.filter((p) => p.id !== targetPanel.id);
      const updatedPanels = [...remainingPanels, ...sliced.newPanels];
      const cutProfile = wall.zone.jointProfileType === 'JOINT_7' ? 'MC-06-7'
        : wall.zone.jointProfileType === 'JOINT_3' || wall.zone.jointProfileType === 'H_JOINT' ? 'MC-06' : undefined;
      const updatedJoints = [...nextJoints, ...sliced.joints.map((joint) => ({ ...joint, profileArticle: cutProfile }))];

      return {
        selectedPieceIds: [sliced.newPanels[0].id],
        selectedSubPieceId: sliced.newPanels[0].id,
        project: {
          ...state.project,
          walls: state.project.walls.map((w) =>
            w.id === wallId
              ? {
                  ...w,
                  panels: updatedPanels,
                  joints: updatedJoints,
                }
              : w
          ),
        },
      };
    }),

  importProjectFromFile: async (jsonString: string) => {
    const imported = await localProjectRepository.importProjectFromJson(jsonString);
    get().setProject(imported);
    return imported;
  },
};
});

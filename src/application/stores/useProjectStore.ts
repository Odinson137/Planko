import { create } from 'zustand';
import { Project, createDefaultProject } from '../../core/models/Project';
import { createDefaultWall, CustomPanelConfig, PanelSegmentConfig, JointEdgeConfig, RadiusConfig, RadiusType, WallBend } from '../../core/models/Wall';
import { Opening, createDefaultOpening, OpeningType } from '../../core/models/Opening';
import { ProfileType } from '../../core/models/Profile';
import { Material, MATERIAL_NONE_ID, DEFAULT_MATERIALS } from '../../core/models/Material';
import { SlatProfileShape } from '../../core/models/AllWallCatalog';
import { LayoutEngine } from '../../core/layout/LayoutEngine';

export type GridPresetType = 'STANDARD_1220' | 'SLATS_145' | 'TIERS_900_1800' | 'CENTER_TV_NICHE';
export type JointPreset = 'NONE' | '5' | '8' | '10' | 'LED_10';

export interface SelectedCellCoord {
  columnIndex: number;
  segmentIndex: number;
}

export interface JointValidationResult {
  canMerge: boolean;
  isCollinear: boolean;
  sameOrientation: boolean;
  sameWidth: boolean;
  sameLED: boolean;
  orientation?: 'VERTICAL' | 'HORIZONTAL';
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

  // Выбор
  selectWall: (wallId: string) => void;
  selectOpening: (openingId: string | null) => void;
  selectPanel: (panelId: string | null, columnIndex: number | null, segmentIndex?: number | null) => void;
  toggleCellSelection: (panelId: string, columnIndex: number, segmentIndex: number, isShift: boolean) => void;
  selectJoint: (jointId: string | null, isShift?: boolean) => void;
  selectWallBend: (bendId: string | null) => void;

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
  setJointLEDForSelected: (wallId: string, isLED: boolean) => void;

  // Управление стенами
  addWall: () => void;
  updateWallDimensions: (wallId: string, width: number, height: number) => void;
  setWallMaterial: (wallId: string, materialId: string) => void;
  setWallJointProfile: (wallId: string, profileType: ProfileType) => void;

  // Управление каталогом материалов AllWall
  addCustomCatalogPanel: (panel: Material) => void;
  updateCatalogPanel: (panelId: string, updates: Partial<Material>) => void;
  deleteCatalogPanel: (panelId: string) => void;

  // Управление кликабельными стыками и краями
  setJointWidth: (wallId: string, jointId: string, width: number) => void;
  setJointLED: (wallId: string, jointId: string, isLED: boolean) => void;
  setJointPreset: (wallId: string, jointId: string, preset: JointPreset) => void;

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
  resetPanelConfig: (wallId: string, columnIndex: number) => void;
  applyGridPreset: (wallId: string, preset: GridPresetType) => void;

  // Управление радиусными элементами (изгибы, углы, своды)
  addWallBend: (wallId: string, type?: RadiusType, x?: number, radius?: number, angleDeg?: number) => string;
  updateWallBend: (wallId: string, bendId: string, updates: Partial<WallBend>) => void;
  deleteWallBend: (wallId: string, bendId: string) => void;
  addRadiusColumn: (wallId: string, type?: RadiusType, radius?: number, angleDeg?: number) => void;
  setPanelRadiusConfig: (wallId: string, columnIndex: number, config: RadiusConfig | undefined) => void;

  // Управление проемами
  addOpening: (wallId: string, type: OpeningType) => void;
  updateOpening: (wallId: string, opening: Partial<Opening> & { id: string }) => void;
  removeOpening: (wallId: string, openingId: string) => void;
}

/**
 * Автоматически разделяет широкую колонку (или пустоту) на отдельные панели заданной ширины материала (например, 3000 -> 3 по 1000, 1000 -> 10 по 100)
 */
function splitColumnIntoPieces(
  customPanels: Record<number, CustomPanelConfig>,
  customJoints: Record<string, JointEdgeConfig>,
  columnIndex: number,
  columnWidth: number,
  targetMaterial: Material,
  decorCode?: string,
  customColor?: string,
  customTextureCategory?: string,
  customReliefType?: SlatProfileShape,
  jointGap: number = 8
): {
  customPanels: Record<number, CustomPanelConfig>;
  customJoints: Record<string, JointEdgeConfig>;
} {
  const stepWidth = targetMaterial.width;
  if (!stepWidth || stepWidth <= 0 || columnWidth <= stepWidth + 5) {
    const resultPanels = { ...customPanels };
    resultPanels[columnIndex] = {
      ...(customPanels[columnIndex] || { columnIndex }),
      customMaterialId: targetMaterial.id,
      customWidth: columnWidth,
      customThickness: targetMaterial.thickness,
      customColor: customColor || targetMaterial.color,
      customDecorCode: decorCode || targetMaterial.decorCode,
      customTextureCategory: customTextureCategory || targetMaterial.textureCategory,
      customReliefType: customReliefType || targetMaterial.reliefType,
    };
    return {
      customPanels: resultPanels,
      customJoints,
    };
  }

  // 1. Рассчитываем количество и ширины нарезанных панелей
  const pieceWidths: number[] = [];
  let remainingW = columnWidth;

  while (remainingW > 0.5) {
    const w = Math.min(stepWidth, remainingW);
    pieceWidths.push(Math.round(w));
    remainingW -= w;
    if (remainingW > 0) {
      remainingW -= jointGap;
    }
  }

  if (pieceWidths.length <= 1) {
    pieceWidths.length = 0;
    pieceWidths.push(columnWidth);
  }

  const numNew = pieceWidths.length;
  const numAdded = numNew - 1;

  const resultPanels: Record<number, CustomPanelConfig> = {};
  const resultJoints: Record<string, JointEdgeConfig> = {};

  // 2. Копируем колонки до columnIndex и сдвигаем колонки после columnIndex
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

  // 3. Добавляем новые нарезанные панели
  pieceWidths.forEach((w, idx) => {
    const targetIdx = columnIndex + idx;
    resultPanels[targetIdx] = {
      columnIndex: targetIdx,
      customWidth: w,
      customMaterialId: targetMaterial.id,
      customThickness: targetMaterial.thickness,
      customColor: customColor || targetMaterial.color,
      customDecorCode: decorCode || targetMaterial.decorCode,
      customTextureCategory: customTextureCategory || targetMaterial.textureCategory,
      customReliefType: customReliefType || targetMaterial.reliefType,
      segments: [],
    };
  });

  // 4. Сдвигаем вертикальные стыки
  Object.entries(customJoints).forEach(([jKey, jConfig]) => {
    if (jKey.startsWith('edge-v-') && !jKey.includes('left') && !jKey.includes('right') && !jKey.includes('end')) {
      const cIdx = Number(jKey.replace('edge-v-', ''));
      if (!isNaN(cIdx)) {
        if (cIdx < columnIndex) {
          resultJoints[jKey] = jConfig;
        } else if (cIdx > columnIndex) {
          const newKey = `edge-v-${cIdx + numAdded}`;
          resultJoints[newKey] = {
            ...jConfig,
            id: newKey,
          };
        }
        return;
      }
    }
    resultJoints[jKey] = jConfig;
  });

  // 5. Создаем швы между новыми нарезанными колонками
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
 * Автоматически разделяет слишком широкую колонку на несколько колонок стандартной ширины листа (100 мм <= W <= maxSheetWidth)
 * При превышении максимального размера (например, 1210 при max 1200) первая плита получает 1200, а справа создается плита мин. 100 мм.
 */
function splitOversizedColumn(
  customPanels: Record<number, CustomPanelConfig>,
  customJoints: Record<string, JointEdgeConfig>,
  columnIndex: number,
  requestedWidth: number,
  maxSheetWidth: number = 1220,
  jointGap: number = 8,
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
  jointGap: number = 8,
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

export const useProjectStore = create<ProjectState>((set, get) => ({
  project: createDefaultProject(),
  selectedColumnIndex: null,
  selectedSegmentIndex: null,
  selectedCellKeys: [],
  selectedPieceIds: [],
  selectedJointId: null,
  selectedJointIds: [],
  selectedWallBendId: null,

  selectWall: (wallId: string) =>
    set((state) => ({
      selectedColumnIndex: null,
      selectedSegmentIndex: null,
      selectedCellKeys: [],
      selectedPieceIds: [],
      selectedJointId: null,
      selectedJointIds: [],
      selectedWallBendId: null,
      project: {
        ...state.project,
        selectedWallId: wallId,
        selectedOpeningId: null,
      },
    })),

  selectOpening: (openingId: string | null) =>
    set((state) => ({
      selectedColumnIndex: null,
      selectedSegmentIndex: null,
      selectedCellKeys: [],
      selectedPieceIds: [],
      selectedJointId: null,
      selectedJointIds: [],
      selectedWallBendId: null,
      project: {
        ...state.project,
        selectedOpeningId: openingId,
      },
    })),

  selectWallBend: (bendId: string | null) =>
    set((state) => ({
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
      },
    })),

  selectPanel: (panelId: string | null, columnIndex: number | null, segmentIndex: number | null = 0) =>
    set((state) => ({
      selectedColumnIndex: columnIndex,
      selectedSegmentIndex: segmentIndex ?? 0,
      selectedCellKeys: columnIndex !== null ? [`${columnIndex}-${segmentIndex ?? 0}`] : [],
      selectedPieceIds: panelId ? [panelId] : [],
      selectedJointId: null,
      selectedJointIds: [],
      selectedWallBendId: null,
      project: {
        ...state.project,
        selectedOpeningId: null,
      },
    })),

  toggleCellSelection: (panelId: string, columnIndex: number, segmentIndex: number, isShift: boolean) =>
    set((state) => {
      const key = `${columnIndex}-${segmentIndex}`;
      if (!isShift) {
        return {
          selectedColumnIndex: columnIndex,
          selectedSegmentIndex: segmentIndex,
          selectedCellKeys: [key],
          selectedPieceIds: [panelId],
          selectedJointId: null,
          selectedJointIds: [],
          selectedWallBendId: null,
          project: {
            ...state.project,
            selectedOpeningId: null,
          },
        };
      }

      // Режим мульти-выбора через Shift
      const isAlreadySelected = state.selectedCellKeys.includes(key);
      const nextKeys = isAlreadySelected
        ? state.selectedCellKeys.filter((k) => k !== key)
        : [...state.selectedCellKeys, key];

      const nextPieceIds = isAlreadySelected
        ? state.selectedPieceIds.filter((p) => p !== panelId)
        : [...state.selectedPieceIds, panelId];

      const firstKey = nextKeys[0]?.split('-') || [];
      const firstCol = firstKey.length > 0 ? Number(firstKey[0]) : null;
      const firstSeg = firstKey.length > 1 ? Number(firstKey[1]) : null;

      return {
        selectedColumnIndex: firstCol,
        selectedSegmentIndex: firstSeg,
        selectedCellKeys: nextKeys,
        selectedPieceIds: nextPieceIds,
        selectedJointId: null,
        selectedJointIds: [],
        project: {
          ...state.project,
          selectedOpeningId: null,
        },
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
      (m) => m.id === (wall.zone.materialId || 'mat-sheet-1220')
    );
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
      const targetWidth = validation.widths[0] ?? 8;
      const targetLED = validation.ledStates[0] ?? false;
      const orientation = validation.orientation || 'HORIZONTAL';

      state.selectedJointIds.forEach((jId) => {
        const baseId = jId.split('-part-')[0].split('-merged-')[0];
        nextCustomJoints[jId] = {
          id: jId,
          orientation,
          width: targetWidth,
          isLED: targetLED,
          groupId,
        };
        nextCustomJoints[baseId] = {
          id: baseId,
          orientation,
          width: targetWidth,
          isLED: targetLED,
          groupId,
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
        width: 8,
        isLED: false,
      };

      const nextCustomJoints = { ...wall.customJoints };
      state.selectedJointIds.forEach((id) => {
        nextCustomJoints[id] = {
          ...(nextCustomJoints[id] || { id, orientation: baseConfig.orientation }),
          width: baseConfig.width,
          isLED: baseConfig.isLED,
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

  setJointPresetForSelected: (wallId: string, preset: JointPreset) =>
    set((state) => {
      const wall = state.project.walls.find((w) => w.id === wallId);
      if (!wall || state.selectedJointIds.length === 0) return state;

      let width = 8;
      let isLED = false;

      switch (preset) {
        case 'NONE':
          width = 0;
          isLED = false;
          break;
        case '5':
          width = 5;
          isLED = false;
          break;
        case '8':
          width = 8;
          isLED = false;
          break;
        case '10':
          width = 10;
          isLED = false;
          break;
        case 'LED_10':
          width = 10;
          isLED = true;
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

  setJointWidthForSelected: (wallId: string, width: number) =>
    set((state) => {
      const wall = state.project.walls.find((w) => w.id === wallId);
      if (!wall || state.selectedJointIds.length === 0) return state;

      const clampedW = Math.max(0, width);
      const nextCustomJoints = { ...wall.customJoints };

      state.selectedJointIds.forEach((id) => {
        const current = nextCustomJoints[id] || {
          id,
          orientation: id.includes('-v-') ? 'VERTICAL' : 'HORIZONTAL',
          width: 8,
          isLED: false,
        };
        nextCustomJoints[id] = {
          ...current,
          width: clampedW,
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

  setJointLEDForSelected: (wallId: string, isLED: boolean) =>
    set((state) => {
      const wall = state.project.walls.find((w) => w.id === wallId);
      if (!wall || state.selectedJointIds.length === 0) return state;

      const nextCustomJoints = { ...wall.customJoints };

      state.selectedJointIds.forEach((id) => {
        const current = nextCustomJoints[id] || {
          id,
          orientation: id.includes('-v-') ? 'VERTICAL' : 'HORIZONTAL',
          width: 8,
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

      const standardSeam = 8;

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
      const wallMaterial =
        state.project.materials.find((m) => m.id === wall.zone.materialId) || DEFAULT_MATERIALS[0];

      let nextCustomPanels = { ...wall.customPanels };
      let nextCustomJoints = { ...wall.customJoints };

      if (targetMaterial && !targetMaterial.isVoid && targetMaterial.width > 0) {
        const selectedColIndices = Array.from(
          new Set(state.selectedCellKeys.map((k) => Number(k.split('-')[0])))
        ).sort((a, b) => b - a); // Справа налево, чтобы сдвиги не сбивали индексы

        selectedColIndices.forEach((colIdx) => {
          const currentCustom = nextCustomPanels[colIdx];
          const currentWidth =
            currentCustom?.customWidth ?? (wallMaterial.isVoid ? wall.width : wallMaterial.width);

          if (currentWidth > targetMaterial.width + 10) {
            const res = splitColumnIntoPieces(
              nextCustomPanels,
              nextCustomJoints,
              colIdx,
              currentWidth,
              targetMaterial,
              undefined,
              undefined,
              undefined,
              undefined,
              8
            );
            nextCustomPanels = res.customPanels;
            nextCustomJoints = res.customJoints;
          } else {
            nextCustomPanels[colIdx] = {
              ...(currentCustom || { columnIndex: colIdx }),
              customMaterialId: materialId,
            };
          }
        });

        return {
          selectedCellKeys: [],
          selectedPieceIds: [],
          selectedColumnIndex: null,
          selectedSegmentIndex: null,
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

      state.selectedCellKeys.forEach((key) => {
        const [cIdx, sIdx] = key.split('-').map(Number);
        const currentCustom = nextCustomPanels[cIdx] || { columnIndex: cIdx, segments: [] };
        const segments = [...(currentCustom.segments || [])];

        if (segments.length === 0) {
          nextCustomPanels[cIdx] = {
            ...currentCustom,
            customMaterialId: materialId,
          };
        } else {
          while (segments.length <= sIdx) {
            segments.push({ id: `seg-${Date.now()}-${segments.length}` });
          }
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

  addWall: () =>
    set((state) => {
      const nextIndex = state.project.walls.length + 1;
      const newWall = createDefaultWall(`wall-${Date.now()}`, `Стена ${nextIndex}`);
      return {
        selectedColumnIndex: null,
        selectedSegmentIndex: null,
        selectedCellKeys: [],
        selectedPieceIds: [],
        selectedJointId: null,
        selectedJointIds: [],
        project: {
          ...state.project,
          walls: [...state.project.walls, newWall],
          selectedWallId: newWall.id,
          selectedOpeningId: null,
        },
      };
    }),

  updateWallDimensions: (wallId: string, width: number, height: number) =>
    set((state) => ({
      project: {
        ...state.project,
        walls: state.project.walls.map((w) =>
          w.id === wallId
            ? {
                ...w,
                width: typeof width === 'number' ? Math.max(0, width) : 0,
                height: typeof height === 'number' ? Math.max(0, height) : 0,
              }
            : w
        ),
      },
    })),

  setWallMaterial: (wallId: string, materialId: string) =>
    set((state) => ({
      selectedColumnIndex: null,
      selectedSegmentIndex: null,
      selectedCellKeys: [],
      selectedPieceIds: [],
      selectedJointId: null,
      selectedJointIds: [],
      project: {
        ...state.project,
        walls: state.project.walls.map((w) =>
          w.id === wallId
            ? {
                ...w,
                customPanels: {},
                customJoints: {},
                zone: { ...w.zone, materialId },
              }
            : w
        ),
      },
    })),

  setWallJointProfile: (wallId: string, profileType: ProfileType) =>
    set((state) => ({
      project: {
        ...state.project,
        walls: state.project.walls.map((w) =>
          w.id === wallId ? { ...w, zone: { ...w.zone, jointProfileType: profileType } } : w
        ),
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

          if (targetGroupId) {
            Object.keys(nextJoints).forEach((k) => {
              if (nextJoints[k]?.groupId === targetGroupId) {
                nextJoints[k] = { ...nextJoints[k], width: clamped };
              }
            });
          } else {
            const current = nextJoints[jointId] || {
              id: jointId,
              orientation: jointId.includes('-v-') ? 'VERTICAL' : 'HORIZONTAL',
              width: 8,
              isLED: false,
            };
            nextJoints[jointId] = { ...current, width: clamped };
          }

          return { ...w, customJoints: nextJoints };
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
              width: 8,
              isLED: false,
            };
            nextJoints[jointId] = {
              ...current,
              width: isLED && current.width === 0 ? 10 : current.width,
              isLED,
            };
          }

          return { ...w, customJoints: nextJoints };
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

          let width = 8;
          let isLED = false;

          switch (preset) {
            case 'NONE':
              width = 0;
              isLED = false;
              break;
            case '5':
              width = 5;
              isLED = false;
              break;
            case '8':
              width = 8;
              isLED = false;
              break;
            case '10':
              width = 10;
              isLED = false;
              break;
            case 'LED_10':
              width = 10;
              isLED = true;
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
                };
              }
            });
          } else {
            nextJoints[jointId] = {
              ...(nextJoints[jointId] || { id: jointId }),
              orientation,
              width,
              isLED,
            };
          }

          return { ...w, customJoints: nextJoints };
        }),
      },
    })),

  setCellMaterial: (wallId: string, columnIndex: number, segmentIndex: number, materialId: string) =>
    set((state) => {
      const wall = state.project.walls.find((w) => w.id === wallId);
      if (!wall) return state;

      const targetMaterial = state.project.materials.find((m) => m.id === materialId);
      const wallMaterial =
        state.project.materials.find((m) => m.id === wall.zone.materialId) || DEFAULT_MATERIALS[0];
      const currentCustom = wall.customPanels[columnIndex];
      const currentWidth =
        currentCustom?.customWidth ?? (wallMaterial.isVoid ? wall.width : wallMaterial.width);

      if (
        targetMaterial &&
        !targetMaterial.isVoid &&
        targetMaterial.width > 0 &&
        currentWidth > targetMaterial.width + 10
      ) {
        const { customPanels: nextCustomPanels, customJoints: nextCustomJoints } = splitColumnIntoPieces(
          wall.customPanels,
          wall.customJoints,
          columnIndex,
          currentWidth,
          targetMaterial,
          undefined,
          undefined,
          undefined,
          undefined,
          8
        );

        return {
          selectedColumnIndex: columnIndex,
          selectedSegmentIndex: 0,
          selectedCellKeys: [`${columnIndex}-0`],
          selectedPieceIds: [`panel-${columnIndex}-0`],
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

      // Обычная установка материала
      const segments = [...(currentCustom?.segments || [])];
      while (segments.length <= segmentIndex) {
        segments.push({
          id: `seg-${Date.now()}-${segments.length}`,
          height: undefined,
        });
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
                      ...(currentCustom || { columnIndex }),
                      customMaterialId: materialId,
                      segments,
                    },
                  },
                }
              : w
          ),
        },
      };
    }),

  addCustomCatalogPanel: (panel: Material) =>
    set((state) => ({
      project: {
        ...state.project,
        materials: [...state.project.materials, panel],
      },
    })),

  updateCatalogPanel: (panelId: string, updates: Partial<Material>) =>
    set((state) => ({
      project: {
        ...state.project,
        materials: state.project.materials.map((m) =>
          m.id === panelId ? { ...m, ...updates } : m
        ),
      },
    })),

  deleteCatalogPanel: (panelId: string) =>
    set((state) => ({
      project: {
        ...state.project,
        materials: state.project.materials.filter((m) => m.id !== panelId),
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
      const wallMaterial =
        state.project.materials.find((m) => m.id === wall.zone.materialId) || DEFAULT_MATERIALS[0];
      const currentWidth =
        currentCustom?.customWidth ?? (wallMaterial.isVoid ? wall.width : wallMaterial.width);

      const targetMaterial = properties.materialId
        ? state.project.materials.find((m) => m.id === properties.materialId)
        : undefined;

      // Если новый материал имеет меньшую ширину, чем колонка (например, пустота 3000 -> плита 1000, или плита 1000 -> рейка 100) — автоматически разделяем колонку на плиты!
      if (
        targetMaterial &&
        !targetMaterial.isVoid &&
        targetMaterial.width > 0 &&
        currentWidth > targetMaterial.width + 10
      ) {
        const { customPanels: nextPanels, customJoints: nextJoints } = splitColumnIntoPieces(
          wall.customPanels,
          wall.customJoints,
          columnIndex,
          currentWidth,
          targetMaterial,
          properties.customDecorCode,
          properties.customColor,
          properties.customTextureCategory,
          properties.customReliefType,
          8
        );

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
      }

      const segments = [...(currentCustom?.segments || [])];
      while (segments.length <= segmentIndex) {
        segments.push({
          id: `seg-${Date.now()}-${segments.length}`,
          height: undefined,
        });
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
                      ...(properties.materialId ? { customMaterialId: properties.materialId } : {}),
                      ...(properties.customThickness !== undefined ? { customThickness: properties.customThickness } : {}),
                      ...(properties.customColor !== undefined ? { customColor: properties.customColor } : {}),
                      ...(properties.customDecorCode !== undefined ? { customDecorCode: properties.customDecorCode } : {}),
                      ...(properties.customTextureCategory !== undefined ? { customTextureCategory: properties.customTextureCategory } : {}),
                      ...(properties.customReliefType !== undefined ? { customReliefType: properties.customReliefType } : {}),
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
      const colMaterialId = config.customMaterialId || currentCustom.customMaterialId || wall.zone.materialId || 'mat-sheet-1220';
      const material = state.project.materials.find((m) => m.id === colMaterialId);
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
          8,
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
        'mat-sheet-1220';
      const material = state.project.materials.find((m) => m.id === segMaterialId);
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
          8,
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

      return {
        project: {
          ...state.project,
          walls: state.project.walls.map((w) =>
            w.id === wallId
              ? {
                  ...w,
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

      const currentCustom = wall.customPanels[columnIndex] || { columnIndex, segments: [] };
      const currentSegments = currentCustom.segments || [];

      const nextCustomPanels = { ...wall.customPanels };
      const nextCustomJoints = { ...wall.customJoints };

      if (currentSegments.length === 0) {
        // Колонка была сплошной на всю высоту стены
        const totalH = wall.height;
        const h1 = firstHeight > 0 && firstHeight < totalH - 8 ? firstHeight : Math.round((totalH - 8) / 2);
        const h2 = Math.max(10, totalH - h1 - 8);

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
          width: 8,
          isLED: false,
        };
      } else {
        // В колонке уже были сегменты, делим только конкретный сегмент segmentIndex
        const targetSeg = currentSegments[segmentIndex];
        const segH = targetSeg?.height ?? Math.round(wall.height / currentSegments.length);
        const h1 = firstHeight > 0 && firstHeight < segH - 8 ? firstHeight : Math.round((segH - 8) / 2);
        const h2 = Math.max(10, segH - h1 - 8);

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
          width: 8,
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

      const currentCustom = wall.customPanels[columnIndex] || { columnIndex };
      const wallMaterial =
        state.project.materials.find((m) => m.id === wall.zone.materialId) || DEFAULT_MATERIALS[0];
      const currentWidth =
        currentCustom.customWidth ?? (wallMaterial.isVoid ? wall.width : wallMaterial.width);

      const splitW = firstWidth > 0 && firstWidth < currentWidth - 8 ? firstWidth : Math.round((currentWidth - 8) / 2);
      const secondWidth = Math.max(10, currentWidth - splitW - 8);

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
        width: 8,
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
            case 'STANDARD_1220':
              return {
                ...w,
                customPanels: {},
                customJoints: {},
                zone: { ...w.zone, materialId: 'mat-sheet-1220', jointProfileType: 'JOINT_8' },
              };

            case 'SLATS_145':
              return {
                ...w,
                customPanels: {},
                customJoints: {},
                zone: { ...w.zone, materialId: 'mat-slat-16', jointProfileType: 'JOINT_8' },
              };

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

  addRadiusColumn: (wallId: string, type: RadiusType = 'OUTER_CORNER', radius: number = 300, angleDeg?: number) =>
    set((state) => {
      const wall = state.project.walls.find((w) => w.id === wallId);
      if (!wall) return state;

      const targetCol = state.selectedColumnIndex !== null ? state.selectedColumnIndex : 0;
      const actualAngle = angleDeg ?? (type === 'ARCH_VAULT' ? 180 : 90);
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
    radius: number = 300,
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
        name: type === 'ARCH_VAULT' ? 'Арочный свод' : type === 'INNER_CORNER' ? 'Внутренний угол' : 'Внешний угол',
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
                openings: w.openings.map((op) =>
                  op.id === updated.id ? { ...op, ...updated } : op
                ),
              }
            : w
        ),
      },
    })),

  removeOpening: (wallId: string, openingId: string) =>
    set((state) => ({
      project: {
        ...state.project,
        selectedOpeningId:
          state.project.selectedOpeningId === openingId ? null : state.project.selectedOpeningId,
        walls: state.project.walls.map((w) =>
          w.id === wallId
            ? { ...w, openings: w.openings.filter((op) => op.id !== openingId) }
            : w
        ),
      },
    })),
}));

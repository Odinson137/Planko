import { create } from 'zustand';
import { Project, createDefaultProject } from '../../core/models/Project';
import { createDefaultWall, CustomPanelConfig, PanelSegmentConfig, JointEdgeConfig, RadiusConfig, RadiusType, WallBend } from '../../core/models/Wall';
import { Opening, createDefaultOpening, OpeningType } from '../../core/models/Opening';
import { ProfileType } from '../../core/models/Profile';
import { MATERIAL_NONE_ID, DEFAULT_MATERIALS } from '../../core/models/Material';
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
  selectedJointIds: string[]; // Поддержка мульти-выбора швов через Shift
  selectedWallBendId: string | null; // Выбранная зона изгиба на стене

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

  // Управление кликабельными стыками и краями
  setJointWidth: (wallId: string, jointId: string, width: number) => void;
  setJointLED: (wallId: string, jointId: string, isLED: boolean) => void;
  setJointPreset: (wallId: string, jointId: string, preset: JointPreset) => void;

  // Управление ячейками сетки (материалы, размеры, пустоты)
  setCellMaterial: (wallId: string, columnIndex: number, segmentIndex: number, materialId: string) => void;
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
 * Разделяет широкую колонку на отдельные колонки-рейки заданной ширины (по умолчанию 145 мм).
 */
function splitColumnIntoSlats(
  customPanels: Record<number, CustomPanelConfig>,
  columnIndex: number,
  columnWidth: number,
  slatMaterialId: string,
  slatWidth: number = 145,
  jointGap: number = 8
): Record<number, CustomPanelConfig> {
  const result: Record<number, CustomPanelConfig> = {};

  // 1. Копируем все колонки левее выбранной
  for (let i = 0; i < columnIndex; i++) {
    if (customPanels[i]) {
      result[i] = { ...customPanels[i], columnIndex: i };
    }
  }

  // 2. Рассчитываем количество и ширины реек, помещающихся в ширину исходной колонки
  const slatColumns: CustomPanelConfig[] = [];
  let remainingW = columnWidth;
  while (remainingW > 0.5) {
    const w = Math.min(slatWidth, remainingW);
    slatColumns.push({
      columnIndex: 0,
      customWidth: Math.round(w),
      customMaterialId: slatMaterialId,
      segments: [],
    });
    remainingW -= w + (remainingW > slatWidth ? jointGap : 0);
  }

  if (slatColumns.length === 0) {
    slatColumns.push({
      columnIndex: 0,
      customWidth: slatWidth,
      customMaterialId: slatMaterialId,
      segments: [],
    });
  }

  slatColumns.forEach((col, idx) => {
    result[columnIndex + idx] = {
      ...col,
      columnIndex: columnIndex + idx,
    };
  });

  // 3. Сдвигаем все колонки правее выбранной
  const shiftAmount = Math.max(0, slatColumns.length - 1);
  const oldCols = Object.keys(customPanels)
    .map(Number)
    .filter((k) => k > columnIndex)
    .sort((a, b) => a - b);

  for (const oldIdx of oldCols) {
    result[oldIdx + shiftAmount] = {
      ...customPanels[oldIdx],
      columnIndex: oldIdx + shiftAmount,
    };
  }

  return result;
}

/**
 * Автоматически разделяет слишком широкую колонку на несколько колонок стандартной ширины листа (100 мм <= W <= maxSheetWidth)
 */
function splitOversizedColumn(
  customPanels: Record<number, CustomPanelConfig>,
  columnIndex: number,
  requestedWidth: number,
  maxSheetWidth: number = 1220,
  jointGap: number = 8,
  minPieceWidth: number = 100
): Record<number, CustomPanelConfig> {
  const result: Record<number, CustomPanelConfig> = {};

  // 1. Копируем все колонки левее выбранной
  for (let i = 0; i < columnIndex; i++) {
    if (customPanels[i]) {
      result[i] = { ...customPanels[i], columnIndex: i };
    }
  }

  // 2. Рассчитываем количество и ширины листов с гарантией мин. размера >= 100 мм
  const totalW = Math.max(minPieceWidth, requestedWidth);
  const sheetColumns: CustomPanelConfig[] = [];
  const origCustom = customPanels[columnIndex] || { columnIndex };

  let numPieces = Math.ceil((totalW + jointGap) / (maxSheetWidth + jointGap));
  if (numPieces < 1) numPieces = 1;

  let remainingW = totalW;
  const pieceWidths: number[] = [];

  for (let p = 0; p < numPieces; p++) {
    const piecesLeft = numPieces - p;
    if (piecesLeft === 1) {
      pieceWidths.push(Math.max(minPieceWidth, Math.round(remainingW)));
    } else {
      const minNeededForRest = (piecesLeft - 1) * (minPieceWidth + jointGap);
      let w = Math.min(maxSheetWidth, remainingW - minNeededForRest);
      w = Math.max(minPieceWidth, Math.round(w));
      pieceWidths.push(w);
      remainingW -= w + jointGap;
    }
  }

  pieceWidths.forEach((w) => {
    sheetColumns.push({
      ...origCustom,
      columnIndex: 0,
      customWidth: w,
      segments: origCustom.segments ? [...origCustom.segments] : undefined,
    });
  });

  sheetColumns.forEach((col, idx) => {
    result[columnIndex + idx] = {
      ...col,
      columnIndex: columnIndex + idx,
    };
  });

  // 3. Сдвигаем все последующие колонки вправо на shiftAmount
  const shiftAmount = Math.max(0, sheetColumns.length - 1);
  const oldCols = Object.keys(customPanels)
    .map(Number)
    .filter((k) => k > columnIndex)
    .sort((a, b) => a - b);

  for (const oldIdx of oldCols) {
    result[oldIdx + shiftAmount] = {
      ...customPanels[oldIdx],
      columnIndex: oldIdx + shiftAmount,
    };
  }

  return result;
}

/**
 * Автоматически разделяет слишком высокий сегмент на несколько рядов (100 мм <= H <= maxSheetHeight)
 */
function splitOversizedSegment(
  segments: PanelSegmentConfig[],
  segmentIndex: number,
  requestedHeight: number,
  maxSheetHeight: number = 2800,
  jointGap: number = 8,
  minPieceHeight: number = 100
): PanelSegmentConfig[] {
  const result: PanelSegmentConfig[] = [];

  // 1. Копируем все сегменты ниже выбранного
  for (let i = 0; i < segmentIndex; i++) {
    if (segments[i]) {
      result.push(segments[i]);
    }
  }

  // 2. Рассчитываем высоты новых сегментов с гарантией мин. размера >= 100 мм
  const totalH = Math.max(minPieceHeight, requestedHeight);
  let numPieces = Math.ceil((totalH + jointGap) / (maxSheetHeight + jointGap));
  if (numPieces < 1) numPieces = 1;

  let remainingH = totalH;
  const pieceHeights: number[] = [];

  for (let p = 0; p < numPieces; p++) {
    const piecesLeft = numPieces - p;
    if (piecesLeft === 1) {
      pieceHeights.push(Math.max(minPieceHeight, Math.round(remainingH)));
    } else {
      const minNeededForRest = (piecesLeft - 1) * (minPieceHeight + jointGap);
      let h = Math.min(maxSheetHeight, remainingH - minNeededForRest);
      h = Math.max(minPieceHeight, Math.round(h));
      pieceHeights.push(h);
      remainingH -= h + jointGap;
    }
  }

  const origSeg = segments[segmentIndex] || { id: `seg-${Date.now()}-0` };

  // 3. Вставляем новые сегменты
  pieceHeights.forEach((h, offset) => {
    result.push({
      ...origSeg,
      id: offset === 0 ? origSeg.id : `seg-${Date.now()}-${segmentIndex + offset}`,
      height: h,
    });
  });

  // 4. Добавляем последующие сегменты выше выбранного
  for (let i = segmentIndex + 1; i < segments.length; i++) {
    if (segments[i]) {
      result.push(segments[i]);
    }
  }

  return result;
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
          'mat-sheet-1220'
        );
      });

      const uniqueMaterials = Array.from(new Set(cellMaterials));
      const areMaterialsIdentical = uniqueMaterials.length === 1 && uniqueMaterials[0] !== MATERIAL_NONE_ID;
      const resultMaterialId = areMaterialsIdentical ? uniqueMaterials[0] : MATERIAL_NONE_ID;
      const isVoidResult = resultMaterialId === MATERIAL_NONE_ID;

      // Габариты материала (для пустоты ограничений нет)
      const material = state.project.materials.find((m) => m.id === resultMaterialId);
      const maxMatWidth = material && !material.isVoid ? material.width : 1220;
      const maxMatHeight = material && !material.isVoid ? material.height : 2800;

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
            customMaterialId: resultMaterialId,
            partLabel: isVoidResult ? 'ПУСТО' : undefined,
          });
        } else {
          // Материал превышает maxMatHeight (2800 мм): пакуем полные высоты + остаток
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
      let combinedWidth = 0;

      uniqueColumns.forEach((cIdx, i) => {
        const colConfig = nextCustomPanels[cIdx];
        const colW = colConfig?.customWidth ?? maxMatWidth;
        const seamW = i < uniqueColumns.length - 1 ? (nextCustomJoints[`edge-v-${cIdx}`]?.width ?? standardSeam) : 0;
        combinedWidth += colW + seamW;

        // Удаляем промежуточный вертикальный стык
        delete nextCustomJoints[`edge-v-${cIdx}`];
      });

      // Удаляем остальные объединенные колонки
      for (let i = 1; i < uniqueColumns.length; i++) {
        delete nextCustomPanels[uniqueColumns[i]];
      }

      if (isVoidResult || combinedWidth <= maxMatWidth) {
        // Пустота или укладывается в один лист: 1 целая колонка
        nextCustomPanels[minColIdx] = {
          columnIndex: minColIdx,
          customWidth: combinedWidth,
          customMaterialId: resultMaterialId,
          segments: undefined,
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

      if (targetMaterial?.type === 'SLAT') {
        const selectedColIndices = Array.from(
          new Set(state.selectedCellKeys.map((k) => Number(k.split('-')[0])))
        ).sort((a, b) => b - a); // Справа налево, чтобы сдвиги не сбивали индексы

        selectedColIndices.forEach((colIdx) => {
          const currentCustom = nextCustomPanels[colIdx];
          const currentWidth =
            currentCustom?.customWidth ?? (wallMaterial.isVoid ? 1220 : wallMaterial.width);

          if (currentWidth > 150) {
            nextCustomPanels = splitColumnIntoSlats(
              nextCustomPanels,
              colIdx,
              currentWidth,
              materialId,
              targetMaterial.width,
              8
            );
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
              w.id === wallId ? { ...w, customPanels: nextCustomPanels } : w
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
        currentCustom?.customWidth ?? (wallMaterial.isVoid ? 1220 : wallMaterial.width);

      // Если выбран реечный материал, а колонка широкая (> 150 мм) — разделяем колонку на отдельные рейки по 145 мм
      if (targetMaterial?.type === 'SLAT' && currentWidth > 150) {
        const nextCustomPanels = splitColumnIntoSlats(
          wall.customPanels,
          columnIndex,
          currentWidth,
          materialId,
          targetMaterial.width,
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
              w.id === wallId ? { ...w, customPanels: nextCustomPanels } : w
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
      const maxSheetWidth = material?.width || 1220;

      let nextCustomPanels = { ...wall.customPanels };

      if (config.customWidth !== undefined && config.customWidth > maxSheetWidth) {
        nextCustomPanels = splitOversizedColumn(
          wall.customPanels,
          columnIndex,
          config.customWidth,
          maxSheetWidth,
          8
        );
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
            w.id === wallId ? { ...w, customPanels: nextCustomPanels } : w
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
      const maxSheetHeight = material?.height || 2800;

      let nextSegments: PanelSegmentConfig[];

      if (config.height !== undefined && config.height > maxSheetHeight) {
        nextSegments = splitOversizedSegment(
          segments,
          segmentIndex,
          config.height,
          maxSheetHeight,
          8
        );
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
    set((state) => ({
      project: {
        ...state.project,
        walls: state.project.walls.map((w) => {
          if (w.id !== wallId) return w;
          const currentCustom = w.customPanels[columnIndex] || { columnIndex, segments: [] };
          const segments = [...(currentCustom.segments || [])];

          if (segments.length === 0) {
            segments.push(
              { id: `seg-${Date.now()}-0`, height: firstHeight },
              { id: `seg-${Date.now()}-1`, height: undefined }
            );
          } else {
            segments[segmentIndex] = {
              ...segments[segmentIndex],
              height: firstHeight,
            };
            segments.splice(segmentIndex + 1, 0, {
              id: `seg-${Date.now()}-${segmentIndex + 1}`,
              height: undefined,
            });
          }

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

  splitColumnVertically: (wallId: string, columnIndex: number, firstWidth: number) =>
    set((state) => ({
      project: {
        ...state.project,
        walls: state.project.walls.map((w) => {
          if (w.id !== wallId) return w;
          const currentCustom = w.customPanels[columnIndex] || { columnIndex };
          const currentWidth = currentCustom.customWidth || 1220;
          const secondWidth = Math.max(100, currentWidth - firstWidth - 8);

          return {
            ...w,
            customPanels: {
              ...w.customPanels,
              [columnIndex]: {
                ...currentCustom,
                customWidth: firstWidth,
              },
              [columnIndex + 1]: {
                columnIndex: columnIndex + 1,
                customWidth: secondWidth,
              },
            },
          };
        }),
      },
    })),

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

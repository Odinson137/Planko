import { Opening } from './Opening';
import { ProfileType } from './Profile';
import { SlatProfileShape } from './AllWallCatalog';
import { MATERIAL_NONE_ID } from './Material';
import { PolygonSubPiece } from '../geometry/PolygonSlicingEngine';

export type LayoutOrientation = 'VERTICAL' | 'HORIZONTAL';

export interface PanelSegmentConfig {
  id: string;
  height?: number;             // высота конкретной ячейки в мм
  customMaterialId?: string;   // материал этой ячейки ('mat-none' для пустоты)
  customThickness?: number;    // толщина конкретной ячейки в мм (например 5, 8, 15)
  customColor?: string;        // цвет конкретной ячейки (#HEX)
  customDecorCode?: string;    // код декора AllWall (например '7029', '5134')
  customTextureCategory?: string; // категория текстуры (FABRIC, WOOD, STONE, etc.)
  customReliefType?: SlatProfileShape; // форма рельефа реек
  partLabel?: string;          // метка детали (например '1.1', '1.2' или 'ПУСТО')
  patternAngleDeg?: number;    // угол поворота рисунка/волокон (0, 45, 90, etc.)
  patternFlipX?: boolean;      // зеркалирование текстуры по горизонтали
  subPieces?: PolygonSubPiece[]; // массив полигональных частей, если панель была фигурно разрезана
}

export type RadiusType = 'OUTER_CORNER' | 'INNER_CORNER';

export interface RadiusConfig {
  type: RadiusType;
  radius: number;                  // радиус скругления в мм (например 300)
  angleDeg?: number;               // угол дуги в градусах (по умолчанию 90° для угла)
}

/**
 * Геометрическая зона изгиба на самой стене
 */
export interface WallBend {
  id: string;
  x: number;                       // отступ начала изгиба от левого края стены в мм
  type: RadiusType;                // Внешний, внутренний угол
  radius: number;                  // радиус скругления в мм
  angleDeg: number;                // угол дуги в градусах (по умолчанию 90°)
  name?: string;                   // метка угла
}

/**
 * Детализация сгиба, попадающего на конкретный лист материала
 */
export interface PanelBendInfo {
  bendId: string;
  type: RadiusType;
  radius: number;
  angleDeg: number;
  flatLeft: number;                // длина плоского участка слева от сгиба (в мм)
  bendWidth: number;               // ширина дуги внутри этого листа (в мм)
  flatRight: number;               // длина плоского участка справа от сгиба (в мм)
  bendOffsetInSheet: number;       // отступ начала сгиба от левого края данного листа (в мм)
}

export interface CustomPanelConfig {
  columnIndex: number;
  customWidth?: number;            // ширина всей колонки в мм
  customMaterialId?: string;       // материал по умолчанию для колонки
  customThickness?: number;
  customColor?: string;
  customDecorCode?: string;
  customTextureCategory?: string;
  customReliefType?: SlatProfileShape;
  patternAngleDeg?: number;
  patternFlipX?: boolean;
  subPieces?: PolygonSubPiece[];
  segments?: PanelSegmentConfig[]; // вертикальные ячейки в этой колонке
  radiusConfig?: RadiusConfig;     // обратная совместимость
}

export interface JointEdgeConfig {
  id: string;
  orientation: 'VERTICAL' | 'HORIZONTAL' | 'DIAGONAL';
  width: number;                   // ширина шва в мм (0, 5, 8, 10, или любое введенное число)
  isLED: boolean;                  // true ТОЛЬКО если пользователь явно включил LED
  groupId?: string;                // идентификатор группы объединенных швов
}

export interface WallZone {
  id: string;
  materialId: string;
  orientation: LayoutOrientation;
  jointProfileType: ProfileType;   // тип шва по умолчанию (8 мм)
}

export interface Wall {
  id: string;
  name: string;
  width: number;                   // ширина стены в мм
  height: number;                  // высота стены в мм
  openings: Opening[];             // проемы на стене
  bends?: WallBend[];              // зоны изгиба и углы стены
  zone: WallZone;                  // зона раскладки материала
  customPanels: Record<number, CustomPanelConfig>; // настройки ячеек сетки
  customJoints: Record<string, JointEdgeConfig>;   // настройки каждого стыка/края
}

export function createDefaultWall(id: string, name: string = 'Стена 1'): Wall {
  return {
    id,
    name,
    width: 3600,
    height: 2750,
    openings: [],
    bends: [],
    customPanels: {},
    customJoints: {},
    zone: {
      id: `zone-${id}`,
      materialId: MATERIAL_NONE_ID,
      orientation: 'VERTICAL',
      jointProfileType: 'JOINT_8',
    },
  };
}

import { Opening } from './Opening';
import { ProfileType } from './Profile';
import { SlatProfileShape } from './AllWallCatalog';
import { MATERIAL_NONE_ID } from './Material';
import { Point2D, PolygonSubPiece } from '../geometry/PolygonSlicingEngine';

export type LayoutOrientation = 'VERTICAL' | 'HORIZONTAL';

export interface PanelEdgeJointConfig {
  width: number;            // 0 (по умолчанию встык), 5, 8, 10, 16 мм...
  profileArticle?: string;  // Артикул AllWall профиля (например 'MC-05')
  profileColor?: string;    // HEX цвет профиля
  isLED?: boolean;          // LED-подсветка
}

export type PanelEdgeSide = 'left' | 'right' | 'top' | 'bottom';

export interface PanelEdgesConfig {
  left?: PanelEdgeJointConfig;
  right?: PanelEdgeJointConfig;
  top?: PanelEdgeJointConfig;
  bottom?: PanelEdgeJointConfig;
  [edgeIndex: number]: PanelEdgeJointConfig | undefined;
}

export interface WallPanelPiece {
  id: string;                       // Уникальный идентификатор детали
  points: Point2D[];                // Абсолютные координаты вершин [ {x, y}, ... ] в мм от (0,0) стены
  materialId: string;               // ID материала ('mat-none' для пустоты, 'RY8085' и т.д.)
  decorCode?: string;               // Код декора ('7029', '5134')
  decorName?: string;
  color?: string;                   // HEX-цвет заливки
  thickness?: number;               // Толщина детали в мм (например 5, 8, 15)
  reliefType?: SlatProfileShape;    // Форма рельефа ('FLAT', 'FLUTED', 'WAVE' и др.)
  textureCategory?: string;         // Категория текстуры ('WOOD', 'MARBLE', 'FABRIC' и др.)
  partLabel: string;                // Производственная маркировка ('1.1', '1.2.1', 'ПУСТО')
  patternAngleDeg?: number;         // Угол поворота рисунка/волокон (0°, 45°, 90°)
  patternFlipX?: boolean;           // Зеркалирование текстуры по горизонтали
  isVoid?: boolean;                 // true для пустоты
  radiusConfig?: RadiusConfig;      // Радиус изгиба (если попадает на угол)
  note?: string;                    // Комментарий/назначение детали (например, 'Для барной стойки')
  edges?: PanelEdgesConfig;         // Конфигурация зазоров и профилей торцов детали
}

export interface WallJointLine {
  id: string;                       // Уникальный идентификатор шва
  p1: Point2D;                      // Начальная точка отрезка
  p2: Point2D;                      // Конечная точка отрезка
  width: number;                    // Толщина шва в мм (0, 0.8, 5, 8, 10...)
  isLED: boolean;                   // Включена ли LED-подсветка
  profileArticle?: string;          // Артикул AllWall (DL-13, MC-06 и т.д.)
  profileColor?: string;            // HEX цвет профиля
  orientation?: 'VERTICAL' | 'HORIZONTAL' | 'DIAGONAL';
  groupId?: string;                 // Идентификатор группы объединенных швов
  isOuterEdge?: boolean;            // Внешний край стены
  takeSide?: 'BOTH' | 'LEFT' | 'RIGHT' | 'TOP' | 'BOTTOM'; // Сторона, откуда забирается размер при расширении
}

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
  note?: string;               // комментарий/назначение детали
  patternAngleDeg?: number;    // угол поворота рисунка/волокон (0, 45, 90, etc.)
  patternFlipX?: boolean;      // зеркалирование текстуры по горизонтали
  subPieces?: PolygonSubPiece[]; // массив полигональных частей, если панель была фигурно разрезана
  edges?: PanelEdgesConfig;    // конфигурация зазоров торцов детали
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
  note?: string;
  subPieces?: PolygonSubPiece[];
  segments?: PanelSegmentConfig[]; // вертикальные ячейки в этой колонке
  radiusConfig?: RadiusConfig;     // обратная совместимость
}

export interface JointEdgeConfig {
  id: string;
  orientation: 'VERTICAL' | 'HORIZONTAL' | 'DIAGONAL';
  width: number;                   // ширина шва в мм (0, 0.8, 5, 8, 10, или любое введенное число)
  isLED: boolean;                  // true ТОЛЬКО если пользователь явно включил LED
  profileArticle?: string;         // Артикул AllWall (DL-13, MC-06 и т.д.)
  profileColor?: string;           // HEX цвет профиля
  groupId?: string;                // идентификатор группы объединенных швов
  takeSide?: 'BOTH' | 'LEFT' | 'RIGHT' | 'TOP' | 'BOTTOM'; // сторона, откуда забирается зазор
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
  roomName?: string;               // Название помещения (например, 'Гостиная', 'Спальня', 'Кухня')
  width: number;                   // ширина стены в мм
  height: number;                  // высота стены в мм
  openings: Opening[];             // проемы на стене
  bends?: WallBend[];              // зоны изгиба и углы стены
  zone: WallZone;                  // зона раскладки материала
  panels?: WallPanelPiece[];       // Единый плоский массив всех деталей стены
  joints?: WallJointLine[];        // Единый список всех швов стены
  customPanels: Record<number, CustomPanelConfig>; // настройки ячеек сетки (обратная совместимость)
  customJoints: Record<string, JointEdgeConfig>;   // настройки каждого стыка/края (обратная совместимость)
}

export function createDefaultWall(id: string, name: string = 'Стена 1', roomName?: string): Wall {
  const width = 3600;
  const height = 2750;
  return {
    id,
    name,
    roomName,
    width,
    height,
    openings: [],
    bends: [],
    panels: [
      {
        id: `panel-${id}-0`,
        points: [
          { x: 0, y: 0 },
          { x: width, y: 0 },
          { x: width, y: height },
          { x: 0, y: height },
        ],
        materialId: MATERIAL_NONE_ID,
        isVoid: true,
        partLabel: 'ПУСТО',
      },
    ],
    joints: [],
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

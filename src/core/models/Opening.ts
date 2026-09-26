import type { TextureMapping } from '../textures/TextureMapping';
export type OpeningType = 'DOOR' | 'PORTAL' | 'WINDOW' | 'TV_ZONE' | 'NICHE';

export type SlopeJointProfileType = 'NONE' | 'CORNER' | 'LED_10' | 'JOINT_3' | 'JOINT_7' | 'JOINT_8';

export type SlopeSide = 'top' | 'bottom' | 'left' | 'right';
export type SlopeJointId = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
export interface SlopeJointConfig {
  width: number; // Монтажный зазор; не зависит от видимой ширины профиля.
  takeSide: 'BOTH' | 'FIRST' | 'SECOND'; // Первый / второй откос в паре.
  profileArticle?: string;
  profileColor?: string;
  isLED: boolean;
}
export type SlopeJoints = Record<SlopeJointId, SlopeJointConfig>;

export interface SlopeSideConfig {
  textureMapping?: TextureMapping;
  enabled: boolean;          // Включена ли данная грань откоса
  depth: number;             // Ширина/глубина грани (мм)
  materialId?: string | null;// ID материала (null = как у стены / общий)
}

export interface SlopeConfig {
  enabled: boolean;                  // Включена ли облицовка откосов
  fitToOpeningDepth?: boolean;       // Откосы под глубину проема (автоматически равны глубине проема)
  depthMode: 'SAME' | 'CUSTOM';      // Одинаковая ширина для всех или раздельная
  depth: number;                     // Общая ширина откоса (при SAME, мм)
  materialMode: 'SAME' | 'CUSTOM';   // Одинаковый материал для всех или раздельный
  materialId?: string | null;        // Общий материал откосов (null = материал стены)
  jointProfileType?: SlopeJointProfileType; // Профиль внутренних стыков между откосами
  joints?: Partial<SlopeJoints>; // Индивидуальные настройки устойчивых пар откосов.
  showUnfold2D?: boolean;            // Показывать ли интерактивную развертку на 2D-чертеже

  top: SlopeSideConfig;              // Верхний откос
  bottom: SlopeSideConfig;           // Нижний откос / Подоконник
  left: SlopeSideConfig;             // Левый откос
  right: SlopeSideConfig;            // Правый откос
}

export interface OpeningEdgeConfig {
  width: number;           // 0 = встык (без зазора), 5, 8, 10 мм и т.д.
  isLED?: boolean;         // Светодиодная подсветка
  profileArticle?: string; // Артикул профиля AllWall
  profileColor?: string;   // Цвет покрытия профиля
}

export interface OpeningFramingConfig {
  left?: OpeningEdgeConfig;
  right?: OpeningEdgeConfig;
  top?: OpeningEdgeConfig;
  bottom?: OpeningEdgeConfig;
}

export function ensureOpeningFraming(op: Opening): OpeningFramingConfig {
  return {
    left: { width: op.framing?.left?.width ?? 0, isLED: !!op.framing?.left?.isLED, profileArticle: op.framing?.left?.profileArticle, profileColor: op.framing?.left?.profileColor },
    right: { width: op.framing?.right?.width ?? 0, isLED: !!op.framing?.right?.isLED, profileArticle: op.framing?.right?.profileArticle, profileColor: op.framing?.right?.profileColor },
    top: { width: op.framing?.top?.width ?? 0, isLED: !!op.framing?.top?.isLED, profileArticle: op.framing?.top?.profileArticle, profileColor: op.framing?.top?.profileColor },
    bottom: { width: op.framing?.bottom?.width ?? 0, isLED: !!op.framing?.bottom?.isLED, profileArticle: op.framing?.bottom?.profileArticle, profileColor: op.framing?.bottom?.profileColor },
  };
}

export interface Opening {
  id: string;
  name: string;
  type: OpeningType;
  isPortal?: boolean; // Совместимость со старыми порталами, сохранёнными с типом DOOR.
  x: number;          // расстояние от левого края стены (мм)
  y: number;          // расстояние от пола (мм)
  width: number;      // ширина проема/декора (мм)
  height: number;     // высота проема/декора (мм)
  depth?: number;     // глубина проема в стене (мм)
  slopeDepth?: number;// глубина/ширина откоса (мм) (для обратной совместимости)
  isCutout: boolean;  // true - вырез в плитах (дверь/окно), false - декор поверх плит (ТВ/зеркало)
  isApplied?: boolean; // false - черновик (можно свободно двигать и менять размеры), true - встроено в панели стены
  slopes?: SlopeConfig;
  framing?: OpeningFramingConfig; // Примыкание/стыки по контуру проема
}

export function isPortalOpening(op: Opening): boolean {
  return op.type === 'PORTAL' || (op.type === 'DOOR' && op.isPortal === true);
}

export function isDoorOrPortal(op: Opening): boolean {
  return op.type === 'DOOR' || op.type === 'PORTAL';
}

export function getOpeningTypeLabel(op: Opening): string {
  switch (op.type) {
    case 'DOOR': return op.isPortal ? 'Портал' : 'Дверь';
    case 'PORTAL': return 'Портал';
    case 'WINDOW': return 'Окно';
    case 'TV_ZONE': return 'ТВ-зона';
    case 'NICHE': return 'Ниша';
  }
}

export function ensureOpeningSlopes(op: Opening): SlopeConfig {
  const defaultOpeningDepth = op.depth ?? (isDoorOrPortal(op) ? 150 : op.type === 'WINDOW' ? 200 : op.type === 'NICHE' ? 150 : 0);
  const baseDepth = op.slopes?.depth ?? op.slopeDepth ?? defaultOpeningDepth;
  const isDoorway = isDoorOrPortal(op);

  if (!op.slopes) {
    return {
      enabled: op.isCutout && baseDepth > 0,
      fitToOpeningDepth: true,
      depthMode: 'SAME',
      depth: baseDepth,
      materialMode: 'SAME',
      materialId: null,
      jointProfileType: 'NONE',
      showUnfold2D: false,
      top: { enabled: true, depth: baseDepth, materialId: null },
      bottom: { enabled: !isDoorway, depth: baseDepth, materialId: null },
      left: { enabled: true, depth: baseDepth, materialId: null },
      right: { enabled: true, depth: baseDepth, materialId: null },
    };
  }

  return {
    enabled: op.slopes.enabled ?? (op.isCutout && baseDepth > 0),
    fitToOpeningDepth: op.slopes.fitToOpeningDepth ?? true,
    depthMode: op.slopes.depthMode || 'SAME',
    depth: op.slopes.depth ?? baseDepth,
    materialMode: op.slopes.materialMode || 'SAME',
    materialId: op.slopes.materialId ?? null,
    jointProfileType: op.slopes.jointProfileType || 'NONE',
    joints: op.slopes.joints && Object.fromEntries(Object.entries(op.slopes.joints).map(([id, joint]) => [id, { ...joint }])),
    showUnfold2D: !!op.slopes.showUnfold2D,
    top: {
      textureMapping: op.slopes.top?.textureMapping,
      enabled: op.slopes.top?.enabled ?? true,
      depth: op.slopes.top?.depth ?? baseDepth,
      materialId: op.slopes.top?.materialId ?? null,
    },
    bottom: {
      textureMapping: op.slopes.bottom?.textureMapping,
      enabled: op.slopes.bottom?.enabled ?? !isDoorway,
      depth: op.slopes.bottom?.depth ?? baseDepth,
      materialId: op.slopes.bottom?.materialId ?? null,
    },
    left: {
      textureMapping: op.slopes.left?.textureMapping,
      enabled: op.slopes.left?.enabled ?? true,
      depth: op.slopes.left?.depth ?? baseDepth,
      materialId: op.slopes.left?.materialId ?? null,
    },
    right: {
      textureMapping: op.slopes.right?.textureMapping,
      enabled: op.slopes.right?.enabled ?? true,
      depth: op.slopes.right?.depth ?? baseDepth,
      materialId: op.slopes.right?.materialId ?? null,
    },
  };
}

export function createDefaultOpening(type: OpeningType, wallWidth: number, _wallHeight: number): Opening {
  const id = `op-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  switch (type) {
    case 'DOOR':
    case 'PORTAL':
      return {
        id,
        name: type === 'PORTAL' ? 'Портал' : 'Дверь',
        type,
        x: Math.max(100, Math.round(wallWidth / 2 - 450)),
        y: 0,
        width: 900,
        height: 2100,
        depth: 150,
        slopeDepth: 150,
        isCutout: true,
        isApplied: false,
        slopes: {
          enabled: true,
          fitToOpeningDepth: true,
          depthMode: 'SAME',
          depth: 150,
          materialMode: 'SAME',
          materialId: null,
          jointProfileType: 'NONE',
          showUnfold2D: false,
          top: { enabled: true, depth: 150, materialId: null },
          bottom: { enabled: false, depth: 150, materialId: null },
          left: { enabled: true, depth: 150, materialId: null },
          right: { enabled: true, depth: 150, materialId: null },
        },
        framing: {
          left: { width: 0, isLED: false },
          right: { width: 0, isLED: false },
          top: { width: 0, isLED: false },
          bottom: { width: 0, isLED: false },
        },
      };
    case 'WINDOW':
      return {
        id,
        name: 'Окно',
        type: 'WINDOW',
        x: Math.max(100, Math.round(wallWidth / 2 - 700)),
        y: 800,
        width: 1400,
        height: 1500,
        depth: 200,
        slopeDepth: 200,
        isCutout: true,
        isApplied: false,
        slopes: {
          enabled: true,
          fitToOpeningDepth: true,
          depthMode: 'SAME',
          depth: 200,
          materialMode: 'SAME',
          materialId: null,
          jointProfileType: 'NONE',
          showUnfold2D: false,
          top: { enabled: true, depth: 200, materialId: null },
          bottom: { enabled: true, depth: 200, materialId: null },
          left: { enabled: true, depth: 200, materialId: null },
          right: { enabled: true, depth: 200, materialId: null },
        },
        framing: {
          left: { width: 0, isLED: false },
          right: { width: 0, isLED: false },
          top: { width: 0, isLED: false },
          bottom: { width: 0, isLED: false },
        },
      };
    case 'TV_ZONE':
      return {
        id,
        name: 'ТВ-зона (Декор)',
        type: 'TV_ZONE',
        x: Math.max(100, Math.round(wallWidth / 2 - 600)),
        y: 1000,
        width: 1200,
        height: 700,
        depth: 0,
        slopeDepth: 0,
        isCutout: false, // по умолчанию поверх плит
        isApplied: false,
        slopes: {
          enabled: false,
          fitToOpeningDepth: true,
          depthMode: 'SAME',
          depth: 0,
          materialMode: 'SAME',
          materialId: null,
          jointProfileType: 'NONE',
          showUnfold2D: false,
          top: { enabled: false, depth: 0, materialId: null },
          bottom: { enabled: false, depth: 0, materialId: null },
          left: { enabled: false, depth: 0, materialId: null },
          right: { enabled: false, depth: 0, materialId: null },
        },
        framing: {
          left: { width: 0, isLED: false },
          right: { width: 0, isLED: false },
          top: { width: 0, isLED: false },
          bottom: { width: 0, isLED: false },
        },
      };
    case 'NICHE':
      return {
        id,
        name: 'Ниша',
        type: 'NICHE',
        x: Math.max(100, Math.round(wallWidth / 2 - 300)),
        y: 900,
        width: 600,
        height: 1200,
        depth: 150,
        slopeDepth: 150,
        isCutout: true,
        isApplied: false,
        slopes: {
          enabled: true,
          fitToOpeningDepth: true,
          depthMode: 'SAME',
          depth: 150,
          materialMode: 'SAME',
          materialId: null,
          jointProfileType: 'NONE',
          showUnfold2D: false,
          top: { enabled: true, depth: 150, materialId: null },
          bottom: { enabled: true, depth: 150, materialId: null },
          left: { enabled: true, depth: 150, materialId: null },
          right: { enabled: true, depth: 150, materialId: null },
        },
        framing: {
          left: { width: 0, isLED: false },
          right: { width: 0, isLED: false },
          top: { width: 0, isLED: false },
          bottom: { width: 0, isLED: false },
        },
      };
  }
}

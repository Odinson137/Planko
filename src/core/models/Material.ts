import { SlatProfileShape, ALLWALL_CATALOG_MODELS, AllWallDecor } from './AllWallCatalog';

export type MaterialType = 'SHEET' | 'SLAT' | 'HQ' | 'NONE';

export interface Material {
  id: string;
  name: string;
  type: MaterialType;
  width: number;            // мм (например 1220 или 158)
  height: number;           // мм (например 2800 или 3000)
  thickness: number;        // мм (например 5, 8, 15, 16)
  color: string;            // HEX цвет (#c4b5a2, #a0784a)
  decorCode?: string;       // Заводской артикул AllWall (например '7029', '5134', 'RY8056')
  decorName?: string;       // Название декора (например 'Лен Песочный 7029')
  thicknessOptions?: number[]; // Допустимые толщины [5, 8]
  reliefType?: SlatProfileShape; // 'FLAT', 'WAVE_GW90', 'CONCAVE_GW30', 'STEP_SLAT'
  textureCategory?: 'FABRIC' | 'WOOD' | 'STONE' | 'MIRROR' | 'METAL' | 'SOFT_TOUCH' | 'MARBLE_HQ' | 'GOLD_HQ';
  textureName?: string;
  modelId?: string;         // ID модели в каталоге AllWall
  availableDecors?: AllWallDecor[];
  isVoid?: boolean;         // true если это пустое пространство без материала
  isCustom?: boolean;
}

export const MATERIAL_NONE_ID = 'mat-none';

/** Material appearance selected for a panel, independently of its joint profile. */
export interface PanelMaterialSelection {
  materialId: string;
  thickness: number;
  color: string;
  decorCode: string;
  decorName?: string;
  textureCategory?: string;
  reliefType?: SlatProfileShape;
}

export function panelMaterialDefaults(material: Material): PanelMaterialSelection {
  const decor = material.availableDecors?.[0];
  return {
    materialId: material.id,
    thickness: material.thickness || material.thicknessOptions?.[0] || 5,
    color: decor?.color || material.color || '#d6cbbe',
    decorCode: decor?.code || material.decorCode || '',
    decorName: decor?.name || material.decorName || '',
    textureCategory: decor?.category || material.textureCategory || 'WOOD',
    reliefType: material.reliefType || 'FLAT',
  };
}

export function materialSheetFormat(material?: Material) {
  return {
    width: material && material.width > 50 ? material.width : 1220,
    height: material && material.height > 50 ? material.height : 2800,
  };
}

export const MATERIAL_NONE: Material = {
  id: MATERIAL_NONE_ID,
  name: '⭕ Без материала (Пустота / Зеркало / Покраска)',
  type: 'NONE',
  width: 1220,
  height: 2800,
  thickness: 0,
  color: 'rgba(30, 31, 35, 0.45)',
  isVoid: true,
};

// Преобразование моделей AllWall в базовый список материалов проекта
export const ALLWALL_DEFAULT_MATERIALS: Material[] = ALLWALL_CATALOG_MODELS.map((model) => {
  const firstDecor = model.decors[0];
  return {
    id: model.id,
    name: model.name,
    type: model.category,
    width: model.width,
    height: model.height,
    thickness: model.defaultThickness,
    color: firstDecor?.color || '#d6cbbe',
    decorCode: firstDecor?.code || '',
    decorName: firstDecor?.name || '',
    thicknessOptions: model.thicknessOptions,
    reliefType: model.reliefType,
    textureCategory: model.textureCategory,
    modelId: model.id,
    availableDecors: model.decors,
  };
});

// Список материалов по умолчанию (Каталог AllWall + Пустота + обратная совместимость)
export const DEFAULT_MATERIALS: Material[] = [
  ...ALLWALL_DEFAULT_MATERIALS,
  MATERIAL_NONE,
];

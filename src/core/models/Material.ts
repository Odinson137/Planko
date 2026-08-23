export type MaterialType = 'SHEET' | 'SLAT' | 'NONE';

export interface Material {
  id: string;
  name: string;
  type: MaterialType;
  width: number;       // мм (например 1220 или 145)
  height: number;      // мм (например 2800 или 3000)
  thickness: number;   // мм (например 5, 15, 16)
  color: string;       // HEX цвет или базовый оттенок
  textureName?: string;
  isVoid?: boolean;    // true если это пустое пространство без материала
}

export const MATERIAL_NONE_ID = 'mat-none';

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

// 3 базовых материала компании + слот пустого пространства
export const DEFAULT_MATERIALS: Material[] = [
  {
    id: 'mat-sheet-1220',
    name: 'Листовая панель (1220 × 2800 × 5 мм)',
    type: 'SHEET',
    width: 1220,
    height: 2800,
    thickness: 5,
    color: '#d6cbbe',
  },
  {
    id: 'mat-slat-16',
    name: 'Реечная панель (145 × 3000 × 16 мм)',
    type: 'SLAT',
    width: 145,
    height: 3000,
    thickness: 16,
    color: '#b89772',
  },
  {
    id: 'mat-slat-15',
    name: 'Реечная панель (145 × 3000 × 15 мм)',
    type: 'SLAT',
    width: 145,
    height: 3000,
    thickness: 15,
    color: '#967451',
  },
  MATERIAL_NONE,
];

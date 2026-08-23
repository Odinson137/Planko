export type OpeningType = 'DOOR' | 'WINDOW' | 'TV_ZONE' | 'NICHE';

export interface Opening {
  id: string;
  name: string;
  type: OpeningType;
  x: number;          // расстояние от левого края стены (мм)
  y: number;          // расстояние от пола (мм)
  width: number;      // ширина проема/декора (мм)
  height: number;     // высота проема/декора (мм)
  slopeDepth?: number;// глубина откоса (мм)
  isCutout: boolean;  // true - вырез в плитах (дверь/окно), false - декор поверх плит (ТВ/зеркало)
}

export function createDefaultOpening(type: OpeningType, wallWidth: number, _wallHeight: number): Opening {
  const id = `op-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  switch (type) {
    case 'DOOR':
      return {
        id,
        name: 'Дверь',
        type: 'DOOR',
        x: Math.max(100, Math.round(wallWidth / 2 - 450)),
        y: 0,
        width: 900,
        height: 2100,
        slopeDepth: 150,
        isCutout: true,
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
        slopeDepth: 200,
        isCutout: true,
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
        slopeDepth: 0,
        isCutout: false, // по умолчанию поверх плит
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
        slopeDepth: 100,
        isCutout: true,
      };
  }
}

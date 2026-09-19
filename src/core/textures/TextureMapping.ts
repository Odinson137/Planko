export const PHOTO_ARTICLES: Record<string, string> = {
  'WOOD:5007': '5007', 'WOOD:5189': '5189', 'FABRIC:7112': '7112',
  'STONE:8016-3': '8016-3', 'MIRROR:8812-15': '8812-15', 'MIRROR:2223-30': '2223-30',
};

export interface TextureMapping {
  /** Millimetres from the top-left of the original sheet. */
  offsetX: number;
  offsetY: number;
  angleDeg: number;
  /** Original wall-space bounds, retained when a polygon is split. */
  anchor?: { x: number; y: number; width: number; height: number };
}

export interface TexturedPiece {
  width: number;
  height: number;
  x?: number;
  y?: number;
  textureCategory?: string;
  decorCode?: string;
  materialColor?: string;
  materialType?: string;
  patternAngleDeg?: number;
  patternFlipX?: boolean;
  textureMapping?: TextureMapping;
  textureStockWidth?: number;
  textureStockHeight?: number;
}

export const hasPhotoTexture = (category?: string, code?: string): boolean =>
  !!PHOTO_ARTICLES[`${category}:${code}`];

export function textureFootprint(width: number, height: number, angle: number) {
  const radians = angle * Math.PI / 180;
  const c = Math.round(Math.abs(Math.cos(radians))*1e12)/1e12, s = Math.round(Math.abs(Math.sin(radians))*1e12)/1e12;
  return { width: width * c + height * s, height: width * s + height * c };
}

/** Convert a point on the displayed part (top-left origin) back to the sheet crop. */
export function pointOnSheet(x: number, y: number, width: number, height: number, angle: number) {
  switch (((angle % 360) + 360) % 360) {
    case 90: return { x: y, y: width - x };
    case 180: return { x: width - x, y: height - y };
    case 270: return { x: height - y, y: x };
    default: {
      const radians = angle * Math.PI / 180;
      const c = Math.cos(radians), s = Math.sin(radians);
      return { x: x*c + y*s + Math.max(0,-width*c) + Math.max(0,-height*s),
        y: -x*s + y*c + Math.max(0,width*s) + Math.max(0,-height*c) };
    }
  }
}

export function resolveTextureMapping(piece: TexturedPiece): TextureMapping {
  const mapping = piece.textureMapping ?? { offsetX: 0, offsetY: 0, angleDeg: piece.patternAngleDeg ?? 0 };
  const a = mapping.anchor;
  if (!a || piece.x === undefined || piece.y === undefined) return { ...mapping, anchor: undefined };
  const dx = piece.x - a.x;
  const dy = a.y + a.height - piece.y - piece.height;
  const corners = [[dx, dy], [dx + piece.width, dy], [dx, dy + piece.height], [dx + piece.width, dy + piece.height]]
    .map(([x, y]) => pointOnSheet(x, y, a.width, a.height, mapping.angleDeg));
  return { offsetX: mapping.offsetX + Math.min(...corners.map(p => p.x)),
    offsetY: mapping.offsetY + Math.min(...corners.map(p => p.y)), angleDeg: mapping.angleDeg };
}

export function textureMappingError(piece: TexturedPiece): string | undefined {
  const m = resolveTextureMapping(piece);
  if (![m.offsetX, m.offsetY, m.angleDeg, piece.width, piece.height,
    piece.textureStockWidth ?? 1220, piece.textureStockHeight ?? 2800].every(Number.isFinite)) return 'Некорректные параметры текстуры.';
  if (piece.patternFlipX) return 'Зеркальный рисунок требует отдельного заводского варианта. Сбросьте зеркалирование.';
  if (piece.width <= 0 || piece.height <= 0 || (piece.textureStockWidth ?? 1220) <= 0 || (piece.textureStockHeight ?? 2800) <= 0) return 'Размеры детали и листа должны быть положительными.';
  if (piece.materialType === 'SLAT' && (m.angleDeg % 180 !== 0 || Math.abs(m.offsetX) > 0.01)) return 'Рейку нельзя поворачивать поперёк профиля или смещать по ширине.';
  const f = textureFootprint(piece.width, piece.height, m.angleDeg);
  if (m.offsetX < -0.01 || m.offsetY < -0.01 || m.offsetX + f.width > (piece.textureStockWidth ?? 1220) + 0.01 ||
    m.offsetY + f.height > (piece.textureStockHeight ?? 2800) + 0.01) return 'Участок выходит за границы листа. Измените поворот, смещение или разделите деталь.';
}

/** Slope side faces are displayed vertically; their length/depth storage stays compatible. */
export function slopeTexturePiece<T extends { width: number; depth: number; side: string }>(slope: T) {
  return { ...slope, width: slope.side === 'LEFT' || slope.side === 'RIGHT' ? slope.depth : slope.width,
    height: slope.side === 'LEFT' || slope.side === 'RIGHT' ? slope.width : slope.depth };
}

// Exact category + article matches only. These are appearance samples, not calibrated sheet scans.
import { PHOTO_ARTICLES, TexturedPiece, resolveTextureMapping, pointOnSheet } from './TextureMapping';
const articles = PHOTO_ARTICLES;
const sheets = new Map<string, HTMLCanvasElement>();
const pieceCache = new Map<string, HTMLCanvasElement>();
const previewCache = new Map<string, string>();
const photos = new Map<string, HTMLCanvasElement>();
let loading: Promise<void> | undefined;

export function photoTextureUrl(category: string, code?: string): string | undefined {
  const article = articles[`${category}:${code}`];
  return article ? `./textures/warehouse/${article}.jpg` : undefined;
}

export function getPhotoTexture(category: string, code?: string): HTMLCanvasElement | undefined {
  return photos.get(`${category}:${code}`);
}

export function preloadPhotoTextures(): Promise<void> {
  return loading ??= (async () => {
    // Decode sequentially to avoid keeping six full resolution photos in memory at once.
    for (const [key, article] of Object.entries(articles)) {
      try {
        const img = new Image();
        img.src = `./textures/warehouse/${article}.jpg`;
        await img.decode();
        const canvas = document.createElement('canvas');
        const scale = Math.min(1, 2048 / Math.max(img.width, img.height));
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) continue;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        photos.set(key, canvas);
        const sheet = new Image();
        sheet.src = `./textures/warehouse/${article}-sheet.jpg`;
        await sheet.decode();
        // Explicit measured rectangle of the panel on the original photograph.
        const crop = article === '8812-15' ? [1315, 827, 3587, 6045] : [1320, 839, 3594, 6041];
        const cropped = document.createElement('canvas');
        cropped.width = Math.round((crop[2] - crop[0]) / (crop[3] - crop[1]) * 2048);
        cropped.height = 2048;
        cropped.getContext('2d')?.drawImage(sheet, crop[0], crop[1], crop[2]-crop[0], crop[3]-crop[1], 0, 0, cropped.width, cropped.height);
        sheets.set(key, cropped);
      } catch (error) {
        console.warn(`Не удалось загрузить фото текстуры ${article}`, error);
      }
    }
  })();
}

type Point = { x: number; y: number };

/** Project the image onto an affine face: bottom-left, bottom-right, top-right, top-left. */
export function drawTextureFace(ctx: CanvasRenderingContext2D, texture: HTMLCanvasElement,
  p0: Point, p1: Point, p2: Point, p3: Point,
  region = { x: 0, y: 0, width: 1, height: 1 }): void {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y); ctx.lineTo(p3.x, p3.y);
  ctx.closePath(); ctx.clip();
  ctx.transform((p2.x - p3.x) / texture.width, (p2.y - p3.y) / texture.width,
    (p0.x - p3.x) / texture.height, (p0.y - p3.y) / texture.height, p3.x, p3.y);
  ctx.drawImage(texture, region.x * texture.width, region.y * texture.height,
    region.width * texture.width, region.height * texture.height, 0, 0, texture.width, texture.height);
  ctx.restore();
}

export function sheetTexturePreview(category?: string, code?: string): string | undefined {
  const key = `${category}:${code}`;
  const canvas = sheets.get(key);
  if (!canvas) return undefined;
  if (!previewCache.has(key)) previewCache.set(key, canvas.toDataURL('image/jpeg', 0.85));
  return previewCache.get(key);
}

/** One physical mapping used by 2D, 3D, the editor and PDF. No repeating outside stock. */
export function getPiecePhotoTexture(piece: TexturedPiece): HTMLCanvasElement | undefined {
  const sheet = sheets.get(`${piece.textureCategory}:${piece.decorCode}`);
  return sheet ? renderPieceTexture(piece, sheet, 'photo') : undefined;
}

export function renderPieceTexture(piece: TexturedPiece, sheet: HTMLCanvasElement, sourceKey: string): HTMLCanvasElement | undefined {
  if (piece.width <= 0 || piece.height <= 0) return undefined;
  const m = resolveTextureMapping(piece);
  const sw = piece.textureStockWidth ?? 1220, sh = piece.textureStockHeight ?? 2800;
  const key = JSON.stringify([sourceKey, piece.textureCategory, piece.decorCode, piece.width, piece.height, m, sw, sh, piece.patternFlipX]);
  const cached = pieceCache.get(key);
  if (cached) return cached;
  const out = document.createElement('canvas');
  const scale = Math.min(1, 2048 / Math.max(piece.width, piece.height));
  out.width = Math.max(1, Math.round(piece.width * scale));
  out.height = Math.max(1, Math.round(piece.height * scale));
  const ctx = out.getContext('2d');
  if (!ctx) return undefined;
  ctx.fillStyle = '#ffd8df';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.scale(out.width / piece.width, out.height / piece.height);
  if (piece.patternFlipX) { ctx.translate(piece.width, 0); ctx.scale(-1, 1); }
  const radians = m.angleDeg * Math.PI / 180;
  const c = Math.cos(radians), s = Math.sin(radians);
  const origin = pointOnSheet(0, 0, piece.width, piece.height, m.angleDeg);
  const ox = m.offsetX + origin.x, oy = m.offsetY + origin.y;
  ctx.transform(c, s, -s, c, -c*ox+s*oy, -s*ox-c*oy);
  ctx.drawImage(sheet, 0, 0, sw, sh);
  // Bound retained canvases during dragging and large projects.
  if (pieceCache.size >= 32) pieceCache.delete(pieceCache.keys().next().value!);
  pieceCache.set(key, out);
  return out;
}

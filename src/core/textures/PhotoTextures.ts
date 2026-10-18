// Exact category + article matches only. These are appearance samples, not calibrated sheet scans.
import { PHOTO_ARTICLES, TexturedPiece, resolveTextureMapping, pointOnSheet } from './TextureMapping';
const articles = PHOTO_ARTICLES;
const sheets = new Map<string, HTMLCanvasElement>();
const pieceCache = new Map<string, HTMLCanvasElement>();
const previewCache = new Map<string, string>();
const photos = new Map<string, HTMLCanvasElement>();
let loading: Promise<void> | undefined;

export interface TextureLoadProgress {
  completed: number;
  total: number;
  failed: number;
}

const progress: TextureLoadProgress = { completed: 0, total: Object.keys(articles).length * 2, failed: 0 };
const progressListeners = new Set<(progress: TextureLoadProgress) => void>();

async function loadPreparedTexture(url: string): Promise<HTMLCanvasElement> {
  const img = new Image();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    img.src = url;
    await Promise.race([
      img.decode(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`Texture loading timed out: ${url}`)), 15000);
      }),
    ]);
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context is unavailable');
    ctx.drawImage(img, 0, 0);
    return canvas;
  } finally {
    clearTimeout(timeout);
    img.src = '';
  }
}

export function photoTextureUrl(category: string, code?: string): string | undefined {
  const article = articles[`${category}:${code}`];
  return article ? `./textures/warehouse/ready/${article}.webp` : undefined;
}

export function getPhotoTexture(category: string, code?: string): HTMLCanvasElement | undefined {
  return photos.get(`${category}:${code}`);
}

export function preloadPhotoTextures(onProgress?: (progress: TextureLoadProgress) => void): Promise<void> {
  if (onProgress) {
    progressListeners.add(onProgress);
    onProgress({ ...progress });
  }
  loading ??= (async () => {
    // Two small, prepared images at a time. No full-resolution decoding or cropping at startup.
    for (const [key, article] of Object.entries(articles)) {
      await Promise.all([false, true].map(async sheet => {
        try {
          const canvas = await loadPreparedTexture(`./textures/warehouse/ready/${article}${sheet ? '-sheet' : ''}.webp`);
          (sheet ? sheets : photos).set(key, canvas);
        } catch (error) {
          progress.failed++;
          console.warn(`Не удалось загрузить ${sheet ? 'лист' : 'фото'} текстуры ${article}`, error);
        } finally {
          progress.completed++;
          for (const listener of progressListeners) listener({ ...progress });
        }
      }));
    }
  })();
  return loading.finally(() => {
    if (onProgress) progressListeners.delete(onProgress);
  });
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

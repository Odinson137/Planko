// Exact category + article matches only. These are appearance samples, not calibrated sheet scans.
const articles: Record<string, string> = {
  'WOOD:5007': '5007', 'WOOD:5189': '5189', 'FABRIC:7112': '7112',
  'STONE:8016-3': '8016-3', 'MIRROR:8812-15': '8812-15', 'MIRROR:2223-30': '2223-30',
};
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
      } catch (error) {
        console.warn(`Не удалось загрузить фото текстуры ${article}`, error);
      }
    }
  })();
}

type Point = { x: number; y: number };

/** Project the image onto an affine face: bottom-left, bottom-right, top-right, top-left. */
export function drawTextureFace(ctx: CanvasRenderingContext2D, texture: HTMLCanvasElement,
  p0: Point, p1: Point, p2: Point, p3: Point): void {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y); ctx.lineTo(p3.x, p3.y);
  ctx.closePath(); ctx.clip();
  ctx.transform((p2.x - p3.x) / texture.width, (p2.y - p3.y) / texture.width,
    (p0.x - p3.x) / texture.height, (p0.y - p3.y) / texture.height, p3.x, p3.y);
  ctx.drawImage(texture, 0, 0);
  ctx.restore();
}

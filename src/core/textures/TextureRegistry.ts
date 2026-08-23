import { SlatProfileShape } from '../models/AllWallCatalog';

/**
 * TextureRegistry: генератор процедурных текстур и светотеневых карт рельефа для 2D CAD и 3D
 */

export class TextureRegistry {
  private static canvasCache: Map<string, HTMLCanvasElement> = new Map();
  private static imageCache: Map<string, HTMLImageElement> = new Map();

  /**
   * Получить кэшированный процедурный Canvas с текстурой и рельефом
   */
  public static getPatternCanvas(
    category: string,
    baseColor: string,
    reliefType: SlatProfileShape = 'FLAT',
    decorCode?: string
  ): HTMLCanvasElement {
    const cacheKey = `${category}_${baseColor}_${reliefType}_${decorCode || ''}`;
    const cached = this.canvasCache.get(cacheKey);
    if (cached) return cached;

    const width = 256;
    const height = 256;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    if (!ctx) return canvas;

    // 1. Базовая заливка цветом
    ctx.fillStyle = baseColor;
    ctx.fillRect(0, 0, width, height);

    // 2. Наложение микротекстуры материала
    this.drawMicroTexture(ctx, category, width, height);

    // 3. Наложение 3D светотеневого рельефа (для реек GW90, GW30, STEP)
    if (reliefType && reliefType !== 'FLAT') {
      this.drawReliefShading(ctx, reliefType, width, height);
    }

    this.canvasCache.set(cacheKey, canvas);
    return canvas;
  }

  /**
   * Получить Image объект для Konva fillPatternImage
   */
  public static getPatternImage(
    category: string,
    baseColor: string,
    reliefType: SlatProfileShape = 'FLAT',
    decorCode?: string
  ): HTMLImageElement | null {
    const cacheKey = `${category}_${baseColor}_${reliefType}_${decorCode || ''}`;
    const cached = this.imageCache.get(cacheKey);
    if (cached) return cached;

    const canvas = this.getPatternCanvas(category, baseColor, reliefType, decorCode);
    const img = new Image();
    img.src = canvas.toDataURL();
    this.imageCache.set(cacheKey, img);
    return img;
  }

  /**
   * Отрисовка микроструктуры материала
   */
  private static drawMicroTexture(
    ctx: CanvasRenderingContext2D,
    category: string,
    w: number,
    h: number
  ) {
    ctx.save();

    switch (category) {
      case 'FABRIC': {
        // Переплетение нитей (Рогожка / Лен)
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.09)';
        ctx.lineWidth = 1;
        for (let x = 0; x < w; x += 4) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, h);
          ctx.stroke();
        }
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.12)';
        for (let y = 0; y < h; y += 4) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(w, y);
          ctx.stroke();
        }
        break;
      }

      case 'WOOD': {
        // Продольные волокна дерева
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.08)';
        for (let y = 0; y < h; y += 6) {
          ctx.lineWidth = 1 + (y % 4 === 0 ? 1 : 0);
          ctx.beginPath();
          ctx.moveTo(0, y);
          // Небольшой плавный изгиб волокна
          ctx.bezierCurveTo(w * 0.3, y + Math.sin(y) * 2, w * 0.7, y - Math.cos(y) * 2, w, y);
          ctx.stroke();
        }
        // Светлые прожилки
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
        for (let y = 3; y < h; y += 12) {
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(w, y);
          ctx.stroke();
        }
        break;
      }

      case 'STONE': {
        // Микрозернистость бетона / микроцемента
        const numDots = 1500;
        for (let i = 0; i < numDots; i++) {
          const x = Math.random() * w;
          const y = Math.random() * h;
          const isLight = Math.random() > 0.5;
          ctx.fillStyle = isLight ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)';
          ctx.fillRect(x, y, 1.5, 1.5);
        }
        break;
      }

      case 'MIRROR': {
        // Диагональный зеркальный градиентный блик
        const grad = ctx.createLinearGradient(0, 0, w, h);
        grad.addColorStop(0, 'rgba(255, 255, 255, 0.02)');
        grad.addColorStop(0.4, 'rgba(255, 255, 255, 0.22)');
        grad.addColorStop(0.5, 'rgba(255, 255, 255, 0.35)');
        grad.addColorStop(0.6, 'rgba(255, 255, 255, 0.15)');
        grad.addColorStop(1, 'rgba(0, 0, 0, 0.08)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
        break;
      }

      case 'METAL': {
        // Тонкий брашинг (вертикальные царапины шлифовки)
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
        for (let x = 0; x < w; x += 2) {
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, h);
          ctx.stroke();
        }
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.06)';
        for (let x = 1; x < w; x += 3) {
          ctx.lineWidth = 0.6;
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, h);
          ctx.stroke();
        }
        break;
      }

      case 'MARBLE_HQ':
      case 'GOLD_HQ': {
        // Мраморные вены и золотые нити
        const isGold = category === 'GOLD_HQ';
        ctx.strokeStyle = isGold ? 'rgba(218, 165, 32, 0.45)' : 'rgba(70, 70, 75, 0.25)';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(0, h * 0.15);
        ctx.bezierCurveTo(w * 0.4, h * 0.25, w * 0.6, h * 0.65, w, h * 0.85);
        ctx.stroke();

        ctx.strokeStyle = isGold ? 'rgba(255, 215, 0, 0.3)' : 'rgba(255, 255, 255, 0.35)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(0, h * 0.18);
        ctx.bezierCurveTo(w * 0.38, h * 0.28, w * 0.62, h * 0.62, w, h * 0.82);
        ctx.stroke();
        break;
      }

      case 'SOFT_TOUCH':
      default: {
        // Мягкий матовый градиент
        const softGrad = ctx.createLinearGradient(0, 0, 0, h);
        softGrad.addColorStop(0, 'rgba(255, 255, 255, 0.04)');
        softGrad.addColorStop(1, 'rgba(0, 0, 0, 0.04)');
        ctx.fillStyle = softGrad;
        ctx.fillRect(0, 0, w, h);
        break;
      }
    }

    ctx.restore();
  }

  /**
   * Отрисовка 3D светотеневого рельефа для реек
   */
  private static drawReliefShading(
    ctx: CanvasRenderingContext2D,
    reliefType: SlatProfileShape,
    w: number,
    h: number
  ) {
    ctx.save();

    if (reliefType === 'WAVE_GW90') {
      // 1. Волна GW90: 4 полукруглые дуги с плавным цилиндрическим бликом и глубокой тенью в ложбинках
      const waveWidth = w / 4;
      for (let i = 0; i < 4; i++) {
        const startX = i * waveWidth;
        const grad = ctx.createLinearGradient(startX, 0, startX + waveWidth, 0);
        grad.addColorStop(0.0, 'rgba(0, 0, 0, 0.65)');       // Глубокая тень в ложбинке слева
        grad.addColorStop(0.2, 'rgba(0, 0, 0, 0.15)');
        grad.addColorStop(0.5, 'rgba(255, 255, 255, 0.40)'); // Центральный яркий блик на вершине полусферы
        grad.addColorStop(0.8, 'rgba(0, 0, 0, 0.25)');
        grad.addColorStop(1.0, 'rgba(0, 0, 0, 0.65)');       // Глубокая тень в ложбинке справа

        ctx.fillStyle = grad;
        ctx.fillRect(startX, 0, waveWidth, h);

        // Тонкая линия разделения волн
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(startX, 0);
        ctx.lineTo(startX, h);
        ctx.stroke();
      }
    } else if (reliefType === 'CONCAVE_GW30') {
      // 2. Комбинированный профиль GW30: боковые прямоугольные рейки + центральный вогнутый желоб
      const sideSlatW = w * 0.22;
      const centerGrooveW = w * 0.56;

      // Левая боковая прямоугольная рейка (свет слева, тень на ребре)
      const leftGrad = ctx.createLinearGradient(0, 0, sideSlatW, 0);
      leftGrad.addColorStop(0, 'rgba(255, 255, 255, 0.25)');
      leftGrad.addColorStop(0.8, 'rgba(255, 255, 255, 0.05)');
      leftGrad.addColorStop(1, 'rgba(0, 0, 0, 0.55)');
      ctx.fillStyle = leftGrad;
      ctx.fillRect(0, 0, sideSlatW, h);

      // Центральный вогнутый желоб (затемнение в глубине по центру)
      const grooveGrad = ctx.createLinearGradient(sideSlatW, 0, sideSlatW + centerGrooveW, 0);
      grooveGrad.addColorStop(0.0, 'rgba(0, 0, 0, 0.65)');   // Падающая тень от левой рейки
      grooveGrad.addColorStop(0.4, 'rgba(0, 0, 0, 0.35)');   // Глубокий желоб
      grooveGrad.addColorStop(0.7, 'rgba(255, 255, 255, 0.15)'); // Мягкий свет
      grooveGrad.addColorStop(1.0, 'rgba(0, 0, 0, 0.55)');   // Стык с правой рейкой
      ctx.fillStyle = grooveGrad;
      ctx.fillRect(sideSlatW, 0, centerGrooveW, h);

      // Правая боковая прямоугольная рейка
      const rightX = sideSlatW + centerGrooveW;
      const rightGrad = ctx.createLinearGradient(rightX, 0, w, 0);
      rightGrad.addColorStop(0, 'rgba(0, 0, 0, 0.45)');
      rightGrad.addColorStop(0.2, 'rgba(255, 255, 255, 0.2)');
      rightGrad.addColorStop(1, 'rgba(0, 0, 0, 0.3)');
      ctx.fillStyle = rightGrad;
      ctx.fillRect(rightX, 0, sideSlatW, h);
    } else {
      // 3. Стандартная прямоугольная рейка STEP_SLAT
      const slatW = w / 3;
      for (let i = 0; i < 3; i++) {
        const startX = i * slatW;
        const grad = ctx.createLinearGradient(startX, 0, startX + slatW, 0);
        grad.addColorStop(0.0, 'rgba(255, 255, 255, 0.18)');
        grad.addColorStop(0.85, 'rgba(255, 255, 255, 0.02)');
        grad.addColorStop(1.0, 'rgba(0, 0, 0, 0.65)'); // Теневой паз между рейками
        ctx.fillStyle = grad;
        ctx.fillRect(startX, 0, slatW, h);
      }
    }

    ctx.restore();
  }
}

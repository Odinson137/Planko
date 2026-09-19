import { getPhotoTexture } from './PhotoTextures';
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

    const width = 512;
    const height = 1024;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    if (!ctx) return canvas;

    // 1. Базовая заливка цветом
    ctx.fillStyle = baseColor;
    ctx.fillRect(0, 0, width, height);

    // 2. Наложение непрерывной текстуры материала во всю высоту панели
    const photo = getPhotoTexture(category, decorCode);
    if (photo) {
      ctx.drawImage(photo, 0, 0, width, height);
    } else {
      this.drawMicroTexture(ctx, category, width, height);
    }

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
    decorCode?: string,
    angleDeg: number = 0,
    flipX: boolean = false
  ): HTMLImageElement | null {
    const cacheKey = `${category}_${baseColor}_${reliefType}_${decorCode || ''}_rot_${angleDeg}_flip_${flipX}`;
    const cached = this.imageCache.get(cacheKey);
    if (cached) return cached;

    const canvas = this.getPatternCanvasWithTransform(category, baseColor, reliefType, decorCode, angleDeg, flipX);
    const img = new Image();
    img.src = canvas.toDataURL();
    this.imageCache.set(cacheKey, img);
    return img;
  }

  /**
   * Получить процедурный Canvas с учетом поворота рисунка и зеркалирования
   */
  public static getPatternCanvasWithTransform(
    category: string,
    baseColor: string,
    reliefType: SlatProfileShape = 'FLAT',
    decorCode?: string,
    angleDeg: number = 0,
    flipX: boolean = false
  ): HTMLCanvasElement {
    const baseCanvas = this.getPatternCanvas(category, baseColor, reliefType, decorCode);
    if (angleDeg === 0 && !flipX) return baseCanvas;

    const cacheKey = `${category}_${baseColor}_${reliefType}_${decorCode || ''}_rot_${angleDeg}_flip_${flipX}`;
    const cached = this.canvasCache.get(cacheKey);
    if (cached) return cached;

    const w = baseCanvas.width;
    const h = baseCanvas.height;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return baseCanvas;

    ctx.save();
    ctx.translate(w / 2, h / 2);
    if (flipX) {
      ctx.scale(-1, 1);
    }
    if (angleDeg !== 0) {
      ctx.rotate((angleDeg * Math.PI) / 180);
    }
    // Заливаем базовым холстом с запасом для покрытия повернутых углов
    const diag = Math.hypot(w, h);
    ctx.drawImage(baseCanvas, -diag / 2, -diag / 2, diag, diag);
    ctx.restore();

    this.canvasCache.set(cacheKey, canvas);
    return canvas;
  }

  /**
   * Отрисовка непрерывной текстуры материала на всю панель
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
        // Ткань / Лен / Рогожка: тонкое переплетение нитей
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
        ctx.lineWidth = 1;
        for (let x = 0; x < w; x += 5) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, h);
          ctx.stroke();
        }
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.12)';
        for (let y = 0; y < h; y += 5) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(w, y);
          ctx.stroke();
        }
        // Мягкая диагональная глубина
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.04)';
        for (let i = -h; i < w + h; i += 12) {
          ctx.beginPath();
          ctx.moveTo(i, 0);
          ctx.lineTo(i + h, h);
          ctx.stroke();
        }
        break;
      }

      case 'WOOD': {
        // Натуральные вертикальные древесные волокна (дуб / ясень / бук / орех)
        // 1. Основные вертикальные органические волокна с плавным течением
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.09)';
        for (let x = 0; x < w; x += 4) {
          const wavePhase = (x / w) * Math.PI * 3.5;
          const curveOffset = Math.sin(wavePhase) * 6;
          ctx.lineWidth = x % 16 === 0 ? 2 : (x % 8 === 0 ? 1.2 : 0.6);
          ctx.beginPath();
          ctx.moveTo(x + curveOffset, 0);
          ctx.bezierCurveTo(
            x - curveOffset * 1.5,
            h * 0.3,
            x + curveOffset * 1.8,
            h * 0.68,
            x + curveOffset * 0.4,
            h
          );
          ctx.stroke();
        }

        // 2. Годовые кольца спила (органические овальные кольца волокон)
        const knotCenters = [
          { x: w * 0.35, y: h * 0.32, rx: 18, ry: 60 },
          { x: w * 0.72, y: h * 0.76, rx: 22, ry: 75 },
        ];

        knotCenters.forEach((knot) => {
          for (let r = 1; r <= 4; r++) {
            ctx.strokeStyle = `rgba(0, 0, 0, ${0.08 - r * 0.015})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.ellipse(knot.x, knot.y, knot.rx * r * 0.4, knot.ry * r * 0.4, 0, 0, Math.PI * 2);
            ctx.stroke();
          }
        });

        // 3. Капиллярные поры древесины
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.06)';
        ctx.lineWidth = 0.6;
        for (let i = 0; i < 90; i++) {
          const rx = (i * 23) % w;
          const ry = (i * 37) % h;
          const len = 15 + ((i * 13) % 35);
          ctx.beginPath();
          ctx.moveTo(rx, ry);
          ctx.lineTo(rx + Math.sin(ry * 0.05) * 2, ry + len);
          ctx.stroke();
        }

        // 4. Светлые блики волокон (эффект натурального шпона)
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        for (let x = 3; x < w; x += 12) {
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.bezierCurveTo(x + 4, h * 0.38, x - 4, h * 0.62, x + 2, h);
          ctx.stroke();
        }

        // 5. Мягкая продольная игра полутонов древесного спила
        const woodGrad = ctx.createLinearGradient(0, 0, w, 0);
        woodGrad.addColorStop(0, 'rgba(0, 0, 0, 0.03)');
        woodGrad.addColorStop(0.2, 'rgba(255, 255, 255, 0.04)');
        woodGrad.addColorStop(0.5, 'rgba(0, 0, 0, 0.04)');
        woodGrad.addColorStop(0.8, 'rgba(255, 255, 255, 0.03)');
        woodGrad.addColorStop(1, 'rgba(0, 0, 0, 0.04)');
        ctx.fillStyle = woodGrad;
        ctx.fillRect(0, 0, w, h);
        break;
      }

      case 'STONE': {
        // Микрозернистость камня / бетона + натуральные прожилки
        const numDots = 2500;
        for (let i = 0; i < numDots; i++) {
          const x = Math.random() * w;
          const y = Math.random() * h;
          const isLight = Math.random() > 0.5;
          ctx.fillStyle = isLight ? 'rgba(255, 255, 255, 0.07)' : 'rgba(0, 0, 0, 0.07)';
          ctx.fillRect(x, y, 1.5, 1.5);
        }

        // Минеральные прожилки на всю высоту
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.09)';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(0, h * 0.2);
        ctx.bezierCurveTo(w * 0.4, h * 0.35, w * 0.6, h * 0.55, w, h * 0.78);
        ctx.stroke();
        break;
      }

      case 'MIRROR': {
        // Единый плавный зеркальный глянцевый блик на всю панель (БЕЗ разбиения на квадраты)
        const grad = ctx.createLinearGradient(0, 0, w, h);
        grad.addColorStop(0, 'rgba(255, 255, 255, 0.02)');
        grad.addColorStop(0.35, 'rgba(255, 255, 255, 0.12)');
        grad.addColorStop(0.5, 'rgba(255, 255, 255, 0.32)');
        grad.addColorStop(0.65, 'rgba(255, 255, 255, 0.12)');
        grad.addColorStop(1, 'rgba(0, 0, 0, 0.08)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
        break;
      }

      case 'METAL': {
        // Тонкий вертикальный брашинг шлифованного металла на всю высоту панели
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.09)';
        for (let x = 0; x < w; x += 2) {
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, h);
          ctx.stroke();
        }
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.07)';
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
        // Мраморные жилы и золотые нити на всю высоту плиты
        const isGold = category === 'GOLD_HQ';
        ctx.strokeStyle = isGold ? 'rgba(218, 165, 32, 0.55)' : 'rgba(50, 50, 55, 0.28)';
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.moveTo(0, h * 0.15);
        ctx.bezierCurveTo(w * 0.35, h * 0.22, w * 0.55, h * 0.68, w, h * 0.88);
        ctx.stroke();

        ctx.strokeStyle = isGold ? 'rgba(255, 215, 0, 0.45)' : 'rgba(255, 255, 255, 0.40)';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(0, h * 0.18);
        ctx.bezierCurveTo(w * 0.33, h * 0.25, w * 0.57, h * 0.65, w, h * 0.85);
        ctx.stroke();
        break;
      }

      case 'SOFT_TOUCH':
      default: {
        // Мягкий матовый градиент с микропорами кожи
        const softGrad = ctx.createLinearGradient(0, 0, 0, h);
        softGrad.addColorStop(0, 'rgba(255, 255, 255, 0.05)');
        softGrad.addColorStop(1, 'rgba(0, 0, 0, 0.05)');
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

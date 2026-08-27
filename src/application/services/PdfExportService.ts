import { jsPDF } from 'jspdf';
import { Project } from '../../core/models/Project';
import { Wall, RadiusType } from '../../core/models/Wall';
import { LayoutEngine, LayoutCalculationResult } from '../../core/layout/LayoutEngine';
import { NestingEngine, NestingPartInput, ProjectNestingResult, NestingSheet, NestingCutout } from '../../core/layout/NestingEngine';
import { ProfileSpecificationEngine, ProjectProfilesReport, WallProfilesReport, PROFILE_CATEGORIES_INFO } from '../../core/layout/ProfileSpecificationEngine';
import { MATERIAL_NONE_ID } from '../../core/models/Material';
import { Point2D, PolygonSlicingEngine } from '../../core/geometry/PolygonSlicingEngine';

export class PdfExportService {
  /**
   * 1. Экспорт клиентской раскладки панелей и карт раскроя листов 1220x2800
   */
  public static async exportPanelsLayoutPdf(project: Project): Promise<void> {
    const pdf = new jsPDF({
      orientation: 'landscape',
      unit: 'mm',
      format: 'a4', // 297 x 210 mm
    });

    const allPartsForNesting: NestingPartInput[] = [];

    // Собираем детали со всех стен
    project.walls.forEach((wall, wallIdx) => {
      const wallNumber = wallIdx + 1;
      const defMat = project.materials.find((m) => m.id === wall.zone.materialId) || project.materials[0];
      const layout = LayoutEngine.calculateWallLayout(wall, defMat, project.materials, wallNumber);

      layout.panels.forEach((p, pIdx) => {
        if (!p.isVoid && p.materialId !== MATERIAL_NONE_ID) {
          const mat = project.materials.find((m) => m.id === p.materialId);

          // Находим вырезы проемов (двери, окна, ниши), попадающие в пределы этой детали
          const panelCutouts: NestingCutout[] = [];
          wall.openings.forEach((op) => {
            if (op.isCutout === false) return;
            const interX1 = Math.max(p.x, op.x);
            const interX2 = Math.min(p.x + p.width, op.x + op.width);
            const interY1 = Math.max(p.y, op.y);
            const interY2 = Math.min(p.y + p.height, op.y + op.height);

            if (interX2 > interX1 + 1 && interY2 > interY1 + 1) {
              panelCutouts.push({
                x: Math.round((interX1 - p.x) * 10) / 10,
                y: Math.round((interY1 - p.y) * 10) / 10,
                width: Math.round((interX2 - interX1) * 10) / 10,
                height: Math.round((interY2 - interY1) * 10) / 10,
                type: op.type,
                label: op.type === 'DOOR' ? `Вырез двери ${op.width}×${op.height}` : `Вырез ${op.width}×${op.height}`,
              });
            }
          });

          allPartsForNesting.push({
            id: p.id,
            wallId: wall.id,
            wallName: wall.name,
            partLabel: p.partLabel || `${wallNumber}.${pIdx + 1}`,
            width: p.width,
            height: p.height,
            areaSqM: p.areaSqM,
            materialId: p.materialId,
            materialName: mat?.name || p.decorName || 'Панель AllWall',
            decorCode: p.decorCode,
            color: p.materialColor,
            thickness: p.thickness,
            polygonPoints: p.polygonPoints,
            cutouts: panelCutouts.length > 0 ? panelCutouts : undefined,
            bendsInfo: p.bendsInfo,
            note: p.note,
          });
        }
      });

      // Добавляем детали откосов
      if (layout.slopes && layout.slopes.length > 0) {
        layout.slopes.forEach((sl) => {
          const slMat = project.materials.find((m) => m.id === sl.materialId);
          allPartsForNesting.push({
            id: sl.id,
            wallId: wall.id,
            wallName: wall.name,
            partLabel: sl.partLabel,
            width: sl.width,
            height: sl.depth,
            areaSqM: sl.areaSqM,
            materialId: sl.materialId,
            materialName: sl.materialName || slMat?.name,
            decorCode: sl.decorCode || slMat?.decorCode,
            color: sl.materialColor || slMat?.color,
            thickness: sl.thickness || slMat?.thickness || 5,
            note: `${sl.openingName} (${sl.sideLabel})`,
          });
        });
      }
    });

    // Рассчитываем оптимальный раскрой
    const nestingResult: ProjectNestingResult = NestingEngine.optimizeProjectNesting(allPartsForNesting);

    // Генерируем страницу для каждой стены с умной адаптивной компоновкой
    for (let wIdx = 0; wIdx < project.walls.length; wIdx++) {
      const wall = project.walls[wIdx];
      if (wIdx > 0) {
        pdf.addPage('a4', 'landscape');
      }

      const canvas = document.createElement('canvas');
      canvas.width = 2970; // 300 DPI (297mm * 10)
      canvas.height = 2100;
      const ctx = canvas.getContext('2d')!;

      // Рендерим адаптивную страницу раскладки стены и карт раскроя
      this.renderPanelLayoutPage(
        ctx,
        canvas.width,
        canvas.height,
        project,
        wall,
        nestingResult,
        wIdx + 1,
        project.walls.length
      );

      const imgData = canvas.toDataURL('image/jpeg', 0.95);
      pdf.addImage(imgData, 'JPEG', 0, 0, 297, 210);
    }

    // Сохраняем файл
    const filename = `${project.name || 'Проект'}_Раскладка_Панелей.pdf`;
    pdf.save(filename);
  }

  /**
   * 2. Экспорт 3D аксонометрического альбома каждой стены (Чистая белая тема)
   */
  public static async exportAxonometric3DPdf(project: Project): Promise<void> {
    const pdf = new jsPDF({
      orientation: 'landscape',
      unit: 'mm',
      format: 'a4',
    });

    for (let wIdx = 0; wIdx < project.walls.length; wIdx++) {
      const wall = project.walls[wIdx];
      if (wIdx > 0) {
        pdf.addPage('a4', 'landscape');
      }

      const canvas = document.createElement('canvas');
      canvas.width = 2970;
      canvas.height = 2100;
      const ctx = canvas.getContext('2d')!;

      this.renderAxonometric3DPage(ctx, canvas.width, canvas.height, project, wall, wIdx + 1, project.walls.length);

      const imgData = canvas.toDataURL('image/jpeg', 0.95);
      pdf.addImage(imgData, 'JPEG', 0, 0, 297, 210);
    }

    const filename = `${project.name || 'Проект'}_3D_Аксонометрия.pdf`;
    pdf.save(filename);
  }

  /**
   * 3. Экспорт инженерной документации для монтажников (сводка + 2D стыки + 3м профили)
   */
  public static async exportInstallerPdf(project: Project): Promise<void> {
    const pdf = new jsPDF({
      orientation: 'landscape',
      unit: 'mm',
      format: 'a4',
    });

    const projectProfiles: ProjectProfilesReport = ProfileSpecificationEngine.calculateProjectProfiles(
      project.walls,
      project.materials
    );

    // Сбор данных для сводной таблицы панелей на первой странице
    const allParts: NestingPartInput[] = [];
    project.walls.forEach((wall, wallIdx) => {
      const wallNumber = wallIdx + 1;
      const defMat = project.materials.find((m) => m.id === wall.zone.materialId) || project.materials[0];
      const layout = LayoutEngine.calculateWallLayout(wall, defMat, project.materials, wallNumber);
      layout.panels.forEach((p) => {
        if (!p.isVoid && p.materialId !== MATERIAL_NONE_ID) {
          const mat = project.materials.find((m) => m.id === p.materialId);
          allParts.push({
            id: p.id,
            wallId: wall.id,
            wallName: wall.name,
            partLabel: p.partLabel,
            width: p.width,
            height: p.height,
            areaSqM: p.areaSqM,
            materialId: p.materialId,
            materialName: mat?.name || p.decorName || 'Панель AllWall',
            decorCode: p.decorCode || mat?.decorCode,
            thickness: p.thickness || mat?.thickness || 5,
            color: p.materialColor || mat?.color,
            polygonPoints: p.polygonPoints,
            bendsInfo: p.bendsInfo,
          });
        }
      });

      if (layout.slopes && layout.slopes.length > 0) {
        layout.slopes.forEach((sl) => {
          const slMat = project.materials.find((m) => m.id === sl.materialId);
          allParts.push({
            id: sl.id,
            wallId: wall.id,
            wallName: wall.name,
            partLabel: sl.partLabel,
            width: sl.width,
            height: sl.depth,
            areaSqM: sl.areaSqM,
            materialId: sl.materialId,
            materialName: sl.materialName || slMat?.name,
            decorCode: sl.decorCode || slMat?.decorCode,
            thickness: sl.thickness || slMat?.thickness || 5,
            color: sl.materialColor || slMat?.color,
            note: `${sl.openingName} (${sl.sideLabel})`,
          });
        });
      }
    });

    const nestingResult: ProjectNestingResult = NestingEngine.optimizeProjectNesting(allParts);

    // --- СТРАНИЦА 1: Сводная ведомость панелей и профилей проекта ---
    const canvas1 = document.createElement('canvas');
    canvas1.width = 2970;
    canvas1.height = 2100;
    const ctx1 = canvas1.getContext('2d')!;
    this.renderInstallerCoverPage(ctx1, canvas1.width, canvas1.height, project, nestingResult, projectProfiles);
    pdf.addImage(canvas1.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, 297, 210);

    // --- ПОСЛЕДУЮЩИЕ СТРАНИЦЫ: 2D чертежи каркаса и профилей каждой стены ---
    for (let wIdx = 0; wIdx < project.walls.length; wIdx++) {
      pdf.addPage('a4', 'landscape');

      const wall = project.walls[wIdx];
      const wallReport = projectProfiles.wallReports.find((r) => r.wallId === wall.id) || projectProfiles.wallReports[wIdx];

      const canvasWall = document.createElement('canvas');
      canvasWall.width = 2970;
      canvasWall.height = 2100;
      const ctxWall = canvasWall.getContext('2d')!;

      this.renderInstallerWallPage(ctxWall, canvasWall.width, canvasWall.height, project, wall, wallReport, wIdx + 2, project.walls.length + 1);

      pdf.addImage(canvasWall.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, 297, 210);
    }

    const filename = `${project.name || 'Проект'}_Монтажная_Спецификация.pdf`;
    pdf.save(filename);
  }

  // ===========================================================================
  // ГРАФИЧЕСКИЙ РЕНДЕРИНГ СТРАНИЦ (Умная адаптивная компоновка для максимального размера)
  // ===========================================================================

  /**
   * Отрисовка страницы плана раскладки стены и карт раскроя с умной адаптивной компоновкой
   */
  private static renderPanelLayoutPage(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    project: Project,
    wall: Wall,
    nesting: ProjectNestingResult,
    pageNumber: number,
    totalPages: number
  ): void {
    // 1. Белый чистый фон
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);

    const marginX = 70;
    const totalAvailW = w - marginX * 2; // 2830 px

    // 2. Шапка страницы
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 38px "Segoe UI", Arial, sans-serif';
    ctx.fillText(`Раскладка панелей (${wall.name})`, marginX, 68);

    ctx.font = '22px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#475569';
    ctx.fillText(
      `Проект: ${project.name || 'Без названия'}   •   Габариты стены: ${wall.width} × ${wall.height} мм`,
      marginX,
      106
    );
    ctx.restore();

    // 3. Расчет раскладки стены
    const wallIndex = project.walls.findIndex((w) => w.id === wall.id);
    const wallNumber = wallIndex >= 0 ? wallIndex + 1 : 1;
    const defMat = project.materials.find((m) => m.id === wall.zone.materialId) || project.materials[0];
    const layout = LayoutEngine.calculateWallLayout(wall, defMat, project.materials, wallNumber);

    // 4. Фильтруем листы раскроя для этой стены
    const sheetsForThisWall: { sheet: NestingSheet; otherWallNames: string[] }[] = [];
    const borrowedSheets: NestingSheet[] = [];

    nesting.allSheets.forEach((sheet) => {
      const wallsOnSheet = Array.from(new Set(sheet.placedParts.map((p) => p.part.wallId)));
      if (!wallsOnSheet.includes(wall.id)) return;

      const firstWallOnSheet = project.walls.find((w) => wallsOnSheet.includes(w.id));
      if (firstWallOnSheet?.id === wall.id) {
        const otherWallNames = Array.from(
          new Set(sheet.placedParts.filter((p) => p.part.wallId !== wall.id).map((p) => p.part.wallName))
        );
        sheetsForThisWall.push({ sheet, otherWallNames });
      } else {
        borrowedSheets.push(sheet);
      }
    });

    // Определяем геометрию стены: если стена узкая/средняя (<= 2600 мм), размещаем Стену слева, а Листы справа во всю высоту!
    const isNarrowWall = (wall.width / wall.height) <= 1.25 || wall.width <= 2600;

    if (isNarrowWall) {
      // =========================================================================
      // АДАПТИВНЫЙ РЕЖИМ 1: СТЕНА СЛЕВА (ВЫСОТА ДО 1750px), ЛИСТЫ СПРАВА
      // =========================================================================
      const wallColW = Math.min(1250, Math.max(950, Math.round(totalAvailW * 0.40)));
      const wallAreaX = marginX;
      const wallAreaY = 130;
      const wallAreaW = wallColW;
      const wallAreaH = 1790;

      // Отрисовка крупного 2D-чертежа стены
      this.drawWall2DOnCanvas(ctx, wall, layout, wallAreaX, wallAreaY, wallAreaW, wallAreaH, true);

      // Вертикальная разделительная линия
      const sepX = marginX + wallColW + 28;
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sepX, 135);
      ctx.lineTo(sepX, 1920);
      ctx.stroke();

      // Зона карт раскроя справа
      const sheetsAreaX = sepX + 28;
      const sheetsAreaY = 175;
      const sheetsAreaW = w - sheetsAreaX - marginX;
      const sheetsAreaH = 1745;

      // Заголовок блока раскроя
      ctx.save();
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 26px "Segoe UI", Arial, sans-serif';
      ctx.fillText('Карта оптимального раскроя материала (Листы 1220 × 2800 мм)', sheetsAreaX, 160);
      ctx.restore();

      this.drawNestingSheetsOnCanvas(
        ctx,
        sheetsForThisWall.length > 0 ? sheetsForThisWall : nesting.allSheets.map((s) => ({ sheet: s, otherWallNames: [] })),
        borrowedSheets,
        wall.id,
        sheetsAreaX,
        sheetsAreaY,
        sheetsAreaW,
        sheetsAreaH,
        0
      );
    } else {
      // =========================================================================
      // АДАПТИВНЫЙ РЕЖИМ 2: ДЛЯ ШИРОКИХ СТЕН (> 2600 мм) - СТЕНА СВЕРХУ, ЛИСТЫ СНИЗУ
      // =========================================================================
      const wallAreaX = marginX;
      const wallAreaY = 130;
      const wallAreaW = totalAvailW;
      const wallAreaH = 840;

      this.drawWall2DOnCanvas(ctx, wall, layout, wallAreaX, wallAreaY, wallAreaW, wallAreaH, true);

      // Горизонтальная разделительная черта
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(marginX, 990);
      ctx.lineTo(w - marginX, 990);
      ctx.stroke();

      // Зона карт раскроя снизу
      const sheetsAreaX = marginX;
      const sheetsAreaY = 1050;
      const sheetsAreaW = totalAvailW;
      const sheetsAreaH = 870;

      ctx.save();
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 26px "Segoe UI", Arial, sans-serif';
      ctx.fillText('Карта оптимального раскроя материала (Листы 1220 × 2800 мм)', marginX, 1038);
      ctx.restore();

      this.drawNestingSheetsOnCanvas(
        ctx,
        sheetsForThisWall.length > 0 ? sheetsForThisWall : nesting.allSheets.map((s) => ({ sheet: s, otherWallNames: [] })),
        borrowedSheets,
        wall.id,
        sheetsAreaX,
        sheetsAreaY,
        sheetsAreaW,
        sheetsAreaH,
        0
      );
    }

    // 5. ТЕХНИЧЕСКИЕ ПРИМЕЧАНИЯ ВНИЗУ (Сноски)
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#dc2626'; // Красный акцент для монтажных примечаний
    ctx.font = 'bold 20px "Segoe UI", Arial, sans-serif';
    ctx.fillText('! Подрезку брать с запасом на 5 мм, перед началом монтажа сделать условную разметку для удобства монтажа панелей.', marginX, 1955);
    ctx.fillText('! Высоту подсветки регулировать по месту монтажа профилей.', marginX, 1985);

    // Спецификация откосов в сносках
    if (layout.slopes && layout.slopes.length > 0) {
      const slopeSpecs = layout.slopes
        .map((sl) => `[${sl.partLabel}] ${sl.sideLabel.toLowerCase()} ${Math.round(sl.width)} × ${Math.round(sl.depth)} мм (${sl.materialName || 'AllWall'})`)
        .join('; ');
      ctx.fillStyle = '#0369a1';
      ctx.fillText(`! Откосы проемов (деталировка): ${slopeSpecs}.`, marginX, 2015);
    } else {
      ctx.fillStyle = '#334155';
      ctx.fillText('! Углы в ТВ зоне брать одного градуса иначе будет высокая вероятность смещения швов.', marginX, 2015);
    }

    // Спецификация стыков и зазоров в сносках
    const wallJoints = layout.joints.filter((j) => (j.width > 0) || j.isLED || j.id.startsWith('joint-op-'));
    const sharedSheets = sheetsForThisWall.filter((item) => item.otherWallNames.length > 0);

    if (wallJoints.length > 0) {
      const meaningfulJoint = wallJoints.find((j) => j.width >= 6) || wallJoints.find((j) => j.width > 0) || { width: 8 };
      const jointGap = Math.round(meaningfulJoint.width || 8);
      ctx.fillStyle = '#334155';
      ctx.fillText(`! Стыки и зазоры обрамления: ширина швов ${jointGap} мм (профиль AllWall / теневой открытый паз).`, marginX, 2045);
    } else if (sharedSheets.length > 0) {
      const sharedLabels = sharedSheets.map((item) => item.sheet.sheetLabel).join(', ');
      const targetWalls = Array.from(new Set(sharedSheets.flatMap((item) => item.otherWallNames))).join(', ');
      ctx.fillStyle = '#b45309';
      ctx.fillText(`! Остатки от ${sharedLabels} использовать на других стенах: ${targetWalls} (указано на картах раскроя).`, marginX, 2045);
    } else if (borrowedSheets.length > 0) {
      const borrowedLabels = borrowedSheets.map((s) => s.sheetLabel).join(', ');
      ctx.fillStyle = '#1d4ed8';
      ctx.fillText(`! Детали для этой стены берутся из остатков ${borrowedLabels} (см. предыдущие листы раскроя).`, marginX, 2045);
    } else {
      ctx.fillStyle = '#475569';
      ctx.fillText('! Перед монтажом панелей выполнить контрольные замеры уровней стен.', marginX, 2045);
    }
    ctx.restore();

    // Штамп / номер страницы
    ctx.save();
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#64748b';
    ctx.font = '20px "Segoe UI", Arial, sans-serif';
    ctx.fillText(`Лист ${pageNumber} из ${totalPages}`, w - marginX, 2045);
    ctx.fillText(`AllWall CAD Engine • ${new Date().toLocaleDateString('ru-RU')}`, w - marginX, 2015);
    ctx.restore();
  }

  /**
   * Отрисовка 2D чертежа стены на Canvas (с детализированными размерными цепочками)
   */
  private static drawWall2DOnCanvas(
    ctx: CanvasRenderingContext2D,
    wall: Wall,
    layout: LayoutCalculationResult,
    boxX: number,
    boxY: number,
    boxW: number,
    boxH: number,
    showMaterials: boolean = true
  ): void {
    const padX = 80;
    const padY = 45;
    const availW = boxW - padX * 2;
    const availH = boxH - padY * 2;

    const scale = Math.min(availW / wall.width, availH / wall.height, 0.65);
    const originX = boxX + (boxW - wall.width * scale) / 2;
    const originY = boxY + padY + (availH - wall.height * scale) / 2;

    const toC = (x: number, y: number) => ({
      x: originX + x * scale,
      y: originY + (wall.height - y) * scale,
    });

    // 1. Контур несущей стены
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(originX, originY, wall.width * scale, wall.height * scale);
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 4;
    ctx.strokeRect(originX, originY, wall.width * scale, wall.height * scale);

    // 2. Панели стены
    layout.panels.forEach((p, pIdx) => {
      const isVoid = p.isVoid || p.materialId === MATERIAL_NONE_ID;
      const pts = p.polygonPoints && p.polygonPoints.length >= 3
        ? p.polygonPoints.map((pt) => toC(pt.x, pt.y))
        : [
            toC(p.x, p.y),
            toC(p.x + p.width, p.y),
            toC(p.x + p.width, p.y + p.height),
            toC(p.x, p.y + p.height),
          ];

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();

      if (isVoid) {
        ctx.fillStyle = 'rgba(241, 245, 249, 0.7)';
      } else if (showMaterials) {
        ctx.fillStyle = p.materialColor || '#e2e8f0';
      } else {
        ctx.fillStyle = '#ffffff'; // Чистый белый для монтажного чертежа
      }
      ctx.fill();

      ctx.strokeStyle = '#475569';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();

      // Маркировка детали (1.1, 1.2...) с размерами
      if (!isVoid) {
        // Проверяем, не перекрыт ли центр проемом (например, дверью)
        let labelYCenter = p.y + p.height / 2;
        const coveringOpening = wall.openings.find(
          (op) =>
            op.isCutout !== false &&
            p.x + p.width > op.x &&
            p.x < op.x + op.width &&
            labelYCenter > op.y &&
            labelYCenter < op.y + op.height
        );

        if (coveringOpening) {
          // Если центр перекрыт дверью, смещаем подпись в верхнюю видимую фрамугу
          labelYCenter = (coveringOpening.y + coveringOpening.height + (p.y + p.height)) / 2;
        }

        let midX = originX + (p.x + p.width / 2) * scale;
        let midY = originY + (wall.height - labelYCenter) * scale;

        if (p.polygonPoints && p.polygonPoints.length >= 3) {
          const centroid = PolygonSlicingEngine.calculateCentroid(p.polygonPoints);
          midX = originX + centroid.x * scale;
          midY = originY + (wall.height - centroid.y) * scale;
        }

        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // Формируем маркировку 1.1, 1.2, 6.2, 7.3...
        const label = p.partLabel && p.partLabel !== 'ПУСТО'
          ? p.partLabel
          : `${wall.name.match(/\d+/)?.[0] || '1'}.${pIdx + 1}`;

        ctx.font = 'bold 22px "Segoe UI", Arial, sans-serif';
        const labelW = Math.max(54, ctx.measureText(label).width + 20);
        const badgeH = 34;

        // Прямоугольная аккуратная рамка с белым фоном как на скрине 2
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(midX - labelW / 2, midY - badgeH / 2, labelW, badgeH);
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 1.8;
        ctx.strokeRect(midX - labelW / 2, midY - badgeH / 2, labelW, badgeH);

        ctx.fillStyle = '#000000';
        ctx.fillText(label, midX, midY);
        ctx.restore();
      }
    });

    // 2.2. Размеры и углы диагональных срезов на чертеже стены
    layout.panels.forEach((p) => {
      if (p.isVoid || !p.polygonPoints || p.polygonPoints.length < 3) return;
      const pts = p.polygonPoints;
      for (let i = 0; i < pts.length; i++) {
        const pt1 = pts[i];
        const pt2 = pts[(i + 1) % pts.length];
        const dx = pt2.x - pt1.x;
        const dy = pt2.y - pt1.y;

        // Показываем размер для диагональных линий (не строго горизонтальных и не вертикальных)
        if (Math.abs(dx) > 10 && Math.abs(dy) > 10 && (pt1.x < pt2.x || (pt1.x === pt2.x && pt1.y < pt2.y))) {
          const cutLen = Math.round(Math.sqrt(dx * dx + dy * dy));
          const cutAngle = Math.round((Math.atan2(Math.abs(dy), Math.abs(dx)) * 180) / Math.PI);
          const c1 = toC(pt1.x, pt1.y);
          const c2 = toC(pt2.x, pt2.y);
          const midEdgeX = (c1.x + c2.x) / 2;
          const midEdgeY = (c1.y + c2.y) / 2;

          ctx.save();
          ctx.font = 'bold 12px "Segoe UI", Arial, sans-serif';
          const badgeText = `✂️ ${cutLen} мм (∠${cutAngle}°)`;
          const bw = ctx.measureText(badgeText).width + 12;
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.roundRect(midEdgeX - bw / 2, midEdgeY - 10, bw, 20, 4);
          ctx.fill();
          ctx.strokeStyle = '#0f172a';
          ctx.lineWidth = 1.2;
          ctx.stroke();

          ctx.fillStyle = '#0f172a';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(badgeText, midEdgeX, midEdgeY);
          ctx.restore();
        }
      }
    });

    // 2.3. Зоны сгибов и углы стены (WallBend)
    if (wall.bends && wall.bends.length > 0) {
      wall.bends.forEach((bend) => {
        const arcLen = Math.round((Math.PI * bend.radius * (bend.angleDeg || 90)) / 180);
        const bendX = originX + bend.x * scale;
        const bendW = arcLen * scale;

        ctx.save();
        if (bend.radius <= 0 || arcLen <= 0) {
          // Острый угол (R = 0): вертикальная пунктирная линия перегиба и бейдж
          ctx.strokeStyle = '#0284c7';
          ctx.lineWidth = 2.5;
          ctx.setLineDash([8, 6]);
          ctx.beginPath();
          ctx.moveTo(bendX, originY);
          ctx.lineTo(bendX, originY + wall.height * scale);
          ctx.stroke();
          ctx.setLineDash([]);

          // Бейдж угла
          const angleLabel = `📐 ${bend.name || (bend.type === 'INNER_CORNER' ? 'Внутр' : 'Внешн')} ${bend.angleDeg || 90}° (${Math.round(bend.x)} мм)`;
          ctx.font = 'bold 13px "Segoe UI", Arial, sans-serif';
          const bw = ctx.measureText(angleLabel).width + 16;
          const bh = 24;
          const bx = bendX - bw / 2;
          const by = originY + 12;

          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.roundRect(bx, by, bw, bh, 4);
          ctx.fill();
          ctx.strokeStyle = '#0284c7';
          ctx.lineWidth = 1.5;
          ctx.stroke();

          ctx.fillStyle = '#0284c7';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(angleLabel, bendX, by + bh / 2);

          // Сноска с указателем снизу
          ctx.font = 'bold 11px "Segoe UI", Arial, sans-serif';
          ctx.fillStyle = '#0369a1';
          ctx.fillText(`▲ Линия угла: ${Math.round(bend.x)} мм`, bendX, originY + wall.height * scale - 14);
        } else {
          // Радиусный сгиб (R > 0): зона скругления, керф-пропилы и бейджи
          ctx.fillStyle = bend.type === 'INNER_CORNER' ? 'rgba(0, 0, 0, 0.08)' : 'rgba(2, 132, 199, 0.08)';
          ctx.fillRect(bendX, originY, bendW, wall.height * scale);

          ctx.strokeStyle = '#0284c7';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([6, 4]);
          ctx.beginPath();
          ctx.moveTo(bendX, originY);
          ctx.lineTo(bendX, originY + wall.height * scale);
          ctx.moveTo(bendX + bendW, originY);
          ctx.lineTo(bendX + bendW, originY + wall.height * scale);
          ctx.stroke();

          // Пропилы керф-бендинга
          const numLines = Math.min(8, Math.max(3, Math.floor(bend.radius / 30)));
          ctx.strokeStyle = 'rgba(2, 132, 199, 0.35)';
          ctx.lineWidth = 1;
          for (let l = 1; l < numLines; l++) {
            const lx = bendX + (l / numLines) * bendW;
            ctx.beginPath();
            ctx.moveTo(lx, originY);
            ctx.lineTo(lx, originY + wall.height * scale);
            ctx.stroke();
          }
          ctx.setLineDash([]);

          // Бейдж радиуса
          const radLabel = `⌒ ${bend.name || (bend.type === 'INNER_CORNER' ? 'Внутр' : 'Внешн')} R=${bend.radius} (${arcLen} мм, ${bend.angleDeg || 90}°)`;
          ctx.font = 'bold 13px "Segoe UI", Arial, sans-serif';
          const bw = ctx.measureText(radLabel).width + 16;
          const bh = 24;
          const bx = bendX + bendW / 2 - bw / 2;
          const by = originY + 12;

          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.roundRect(bx, by, bw, bh, 4);
          ctx.fill();
          ctx.strokeStyle = '#0284c7';
          ctx.lineWidth = 1.5;
          ctx.stroke();

          ctx.fillStyle = '#0284c7';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(radLabel, bendX + bendW / 2, by + bh / 2);

          // Размерные сноски начала и конца изгиба
          ctx.font = 'bold 11px "Segoe UI", Arial, sans-serif';
          ctx.fillStyle = '#0284c7';
          ctx.textAlign = 'center';
          ctx.fillText(`▲ Начало: ${Math.round(bend.x)} мм`, bendX, originY + wall.height * scale - 28);
          ctx.fillText(`▲ Конец: ${Math.round(bend.x + arcLen)} мм`, bendX + bendW, originY + wall.height * scale - 14);

          // Размерная стрелка развертки дуги
          if (bendW > 40) {
            const arrY = originY + 44;
            ctx.strokeStyle = '#0284c7';
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.moveTo(bendX, arrY);
            ctx.lineTo(bendX + bendW, arrY);
            ctx.moveTo(bendX, arrY - 4);
            ctx.lineTo(bendX, arrY + 4);
            ctx.moveTo(bendX + bendW, arrY - 4);
            ctx.lineTo(bendX + bendW, arrY + 4);
            ctx.stroke();

            ctx.fillStyle = '#0369a1';
            ctx.font = 'bold 10px "Segoe UI", Arial, sans-serif';
            ctx.fillText(`Развертка ${arcLen} мм`, bendX + bendW / 2, arrY + 11);
          }
        }
        ctx.restore();
      });
    }

    // 3. Проемы (окна, двери, ТВ-зона, ниши)
    wall.openings.forEach((op) => {
      const opTopLeft = toC(op.x, op.y + op.height);
      const opW = op.width * scale;
      const opH = op.height * scale;

      ctx.save();
      if (op.type === 'DOOR') {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(opTopLeft.x, opTopLeft.y, opW, opH);
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 3.5;
        ctx.strokeRect(opTopLeft.x, opTopLeft.y, opW, opH);

        // Внутренний дверной контур
        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = 2;
        ctx.strokeRect(opTopLeft.x + 8, opTopLeft.y + 8, opW - 16, opH - 8);
      } else if (op.type === 'WINDOW') {
        ctx.fillStyle = '#f0f9ff';
        ctx.fillRect(opTopLeft.x, opTopLeft.y, opW, opH);
        ctx.strokeStyle = '#0284c7';
        ctx.lineWidth = 3;
        ctx.strokeRect(opTopLeft.x, opTopLeft.y, opW, opH);

        // Рама окна (импост)
        ctx.strokeStyle = '#bae6fd';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(opTopLeft.x + opW / 2, opTopLeft.y);
        ctx.lineTo(opTopLeft.x + opW / 2, opTopLeft.y + opH);
        ctx.stroke();
      } else if (op.type === 'TV_ZONE') {
        ctx.fillStyle = 'rgba(238, 242, 255, 0.9)';
        ctx.fillRect(opTopLeft.x, opTopLeft.y, opW, opH);
        ctx.strokeStyle = '#6366f1';
        ctx.lineWidth = 3;
        ctx.strokeRect(opTopLeft.x, opTopLeft.y, opW, opH);
      } else {
        // Ниша
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(opTopLeft.x, opTopLeft.y, opW, opH);
        ctx.strokeStyle = '#475569';
        ctx.lineWidth = 2.5;
        ctx.setLineDash([8, 6]);
        ctx.strokeRect(opTopLeft.x, opTopLeft.y, opW, opH);
        ctx.setLineDash([]);
      }

      const typeLabel = op.type === 'DOOR' ? 'Дверь' : op.type === 'WINDOW' ? 'Окно' : op.type === 'TV_ZONE' ? 'ТВ-зона' : 'Ниша';
      const opTitle = op.name || typeLabel;

      ctx.save();
      ctx.font = 'bold 22px "Segoe UI", Arial, sans-serif';
      const opLabelW = Math.max(76, ctx.measureText(opTitle).width + 24);
      const opBadgeH = 36;
      const opMidX = opTopLeft.x + opW / 2;
      const opMidY = opTopLeft.y + opH / 2;

      // Белая плашка с четкой рамкой как на скрине 2
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(opMidX - opLabelW / 2, opMidY - opBadgeH / 2, opLabelW, opBadgeH);
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 1.8;
      ctx.strokeRect(opMidX - opLabelW / 2, opMidY - opBadgeH / 2, opLabelW, opBadgeH);

      ctx.fillStyle = '#000000';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(opTitle, opMidX, opMidY);
      ctx.restore();

      // ВЫНОСКИ ОТКОСОВ (Указатель со стрелкой + плашка [1.4] / [ОТКОС: 150 мм])
      if (op.isCutout !== false && layout.slopes && layout.slopes.length > 0) {
        const topSlope = layout.slopes.find((s) => s.openingId === op.id && s.side === 'TOP');
        const leftSlope = layout.slopes.find((s) => s.openingId === op.id && s.side === 'LEFT');
        const rightSlope = layout.slopes.find((s) => s.openingId === op.id && s.side === 'RIGHT');
        const bottomSlope = layout.slopes.find((s) => s.openingId === op.id && s.side === 'BOTTOM');

        const drawSlopeBadge = (
          partLabel: string,
          sideText: string,
          boxCenterX: number,
          boxCenterY: number,
          targetEdgeX: number,
          targetEdgeY: number,
          dir: 'TOP' | 'LEFT' | 'RIGHT' | 'BOTTOM'
        ) => {
          ctx.save();
          ctx.font = 'bold 11px "Segoe UI", Arial, sans-serif';
          const subTextW = ctx.measureText(sideText).width;
          const bw = Math.max(80, subTextW + 16);
          const bh = 44;
          const bx = boxCenterX - bw / 2;
          const by = boxCenterY - bh / 2;

          // Фон плашки
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(bx, by, bw, bh);
          ctx.strokeStyle = '#0f172a';
          ctx.lineWidth = 1.8;
          ctx.strokeRect(bx, by, bw, bh);

          // Разделитель
          ctx.beginPath();
          ctx.moveTo(bx, by + 22);
          ctx.lineTo(bx + bw, by + 22);
          ctx.stroke();

          // Верхний текст: Номер откоса (например 1.4)
          ctx.fillStyle = '#0f172a';
          ctx.font = 'bold 15px "Segoe UI", Arial, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(partLabel, boxCenterX, by + 11);

          // Нижний текст: ОТКОС: 150 мм
          ctx.font = 'bold 11px "Segoe UI", Arial, sans-serif';
          ctx.fillText(sideText, boxCenterX, by + 33);

          // Линия-указатель к грани
          ctx.strokeStyle = '#0f172a';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          if (dir === 'TOP') {
            ctx.moveTo(boxCenterX, by);
            ctx.lineTo(targetEdgeX, targetEdgeY);
            ctx.moveTo(targetEdgeX - 6, targetEdgeY);
            ctx.lineTo(targetEdgeX + 6, targetEdgeY);
          } else if (dir === 'LEFT') {
            ctx.moveTo(bx, boxCenterY);
            ctx.lineTo(targetEdgeX, targetEdgeY);
            ctx.moveTo(targetEdgeX, targetEdgeY - 6);
            ctx.lineTo(targetEdgeX, targetEdgeY + 6);
          } else if (dir === 'RIGHT') {
            ctx.moveTo(bx + bw, boxCenterY);
            ctx.lineTo(targetEdgeX, targetEdgeY);
            ctx.moveTo(targetEdgeX, targetEdgeY - 6);
            ctx.lineTo(targetEdgeX, targetEdgeY + 6);
          } else {
            ctx.moveTo(boxCenterX, by + bh);
            ctx.lineTo(targetEdgeX, targetEdgeY);
            ctx.moveTo(targetEdgeX - 6, targetEdgeY);
            ctx.lineTo(targetEdgeX + 6, targetEdgeY);
          }
          ctx.stroke();
          ctx.restore();
        };

        if (topSlope) {
          drawSlopeBadge(
            topSlope.partLabel,
            `ОТКОС: ${Math.round(topSlope.depth)} мм`,
            opTopLeft.x + opW / 2,
            opTopLeft.y + 60,
            opTopLeft.x + opW / 2,
            opTopLeft.y,
            'TOP'
          );
        }

        if (leftSlope) {
          const targetY = opTopLeft.y + opH * 0.38;
          drawSlopeBadge(
            leftSlope.partLabel,
            `ОТКОС: ${Math.round(leftSlope.depth)} мм`,
            opTopLeft.x + 65,
            targetY,
            opTopLeft.x,
            targetY,
            'LEFT'
          );
        }

        if (rightSlope) {
          const targetY = opTopLeft.y + opH * 0.62;
          drawSlopeBadge(
            rightSlope.partLabel,
            `ОТКОС: ${Math.round(rightSlope.depth)} мм`,
            opTopLeft.x + opW - 65,
            targetY,
            opTopLeft.x + opW,
            targetY,
            'RIGHT'
          );
        }

        if (bottomSlope) {
          drawSlopeBadge(
            bottomSlope.partLabel,
            op.type === 'WINDOW' ? `ПОДОК.: ${Math.round(bottomSlope.depth)} мм` : `ОТКОС: ${Math.round(bottomSlope.depth)} мм`,
            opTopLeft.x + opW / 2,
            opTopLeft.y + opH - 60,
            opTopLeft.x + opW / 2,
            opTopLeft.y + opH,
            'BOTTOM'
          );
        }
      }
    });

    // 4. Стыки и профили
    layout.joints.forEach((j) => {
      if (j.width <= 0 && !j.isLED) return;
      const p1 = toC(j.p1 ? j.p1.x : j.x, j.p1 ? j.p1.y : j.y);
      const p2 = toC(
        j.p2 ? j.p2.x : (j.orientation === 'VERTICAL' ? j.x : j.x + j.length),
        j.p2 ? j.p2.y : (j.orientation === 'VERTICAL' ? j.y + j.length : j.y)
      );

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);

      if (j.isLED) {
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 6;
      } else {
        ctx.strokeStyle = '#2563eb';
        ctx.lineWidth = 3.5;
      }
      ctx.stroke();
      ctx.restore();
    });

    // 5. Архитектурные размерные цепочки (с четкими засечками под 45°)
    ctx.save();

    // 5.1. Левый габарит стены (Общая высота 2800):
    const leftOverallX = originX - 65;
    this.drawArchitecturalDimLine(
      ctx,
      originX,
      originY,
      originX,
      originY + wall.height * scale,
      leftOverallX,
      'VERTICAL',
      `${Math.round(wall.height)}`
    );

    // 5.2. Нижний ярус: Детальная непрерывная размерная цепочка по низу (панели, проемы, швы)
    interface BottomSegmentItem {
      start: number;
      end: number;
      label: string;
      isJoint?: boolean;
    }

    const rawIntervals: { start: number; end: number; isOpening?: boolean }[] = [];

    // Панели в нижней части стены (Y <= 50)
    layout.panels
      .filter((p) => !p.isVoid && p.y <= 50)
      .forEach((p) => {
        const xs = (p.polygonPoints && p.polygonPoints.length >= 3 ? p.polygonPoints : [{ x: p.x, y: p.y }, { x: p.x + p.width, y: p.y }]).map((pt) => pt.x);
        const minX = Math.round(Math.min(...xs));
        const maxX = Math.round(Math.max(...xs));
        if (maxX > minX + 5) {
          rawIntervals.push({ start: minX, end: maxX, isOpening: false });
        }
      });

    // Проемы в нижней части стены (двери Y <= 50)
    wall.openings
      .filter((op) => op.isCutout !== false && op.y <= 50)
      .forEach((op) => {
        const opLeft = Math.round(op.x);
        const opRight = Math.round(op.x + op.width);
        rawIntervals.push({ start: opLeft, end: opRight, isOpening: true });
      });

    rawIntervals.sort((a, b) => a.start - b.start);

    const bottomSegments: BottomSegmentItem[] = [];
    let curX = 0;

    rawIntervals.forEach((item) => {
      // Если между предыдущей точкой и началом текущего элемента есть зазор шва (например 8 мм)
      if (item.start > curX + 2) {
        const gap = item.start - curX;
        bottomSegments.push({
          start: curX,
          end: item.start,
          label: `${Math.round(gap)}`,
          isJoint: true,
        });
      }

      // Сам элемент (панель или проем)
      const w = item.end - item.start;
      bottomSegments.push({
        start: item.start,
        end: item.end,
        label: `${Math.round(w)}`,
        isJoint: false,
      });

      curX = item.end;
    });

    // Зазор шва у правого края стены
    if (wall.width > curX + 2) {
      const gap = wall.width - curX;
      bottomSegments.push({
        start: curX,
        end: wall.width,
        label: `${Math.round(gap)}`,
        isJoint: true,
      });
    }

    if (bottomSegments.length > 0) {
      const bottomChainY = originY + wall.height * scale + 45;
      this.drawArchitecturalChain(
        ctx,
        originX,
        originY,
        scale,
        wall.height,
        bottomSegments,
        'HORIZONTAL',
        bottomChainY,
        originY + wall.height * scale
      );
    }

    // 5.3. Размеры у проемов (дверь, окно, фрамуга над дверью)
    wall.openings
      .filter((op) => op.isCutout !== false)
      .forEach((op) => {
        // 1. Горизонтальный размер проема прямо над ним (как 900 на скрине 2)
        const opTopY = originY + (wall.height - (op.y + op.height)) * scale;
        const opLeftX = originX + op.x * scale;
        const opRightX = originX + (op.x + op.width) * scale;

        this.drawArchitecturalDimLine(
          ctx,
          opLeftX,
          opTopY,
          opRightX,
          opTopY,
          opTopY - 14,
          'HORIZONTAL',
          `${Math.round(op.width)}`
        );

        // 2. Вертикальные размеры фрамуги и зазора над дверью (как 506 и 8 на скрине 2)
        const transomHeight = wall.height - (op.y + op.height);
        if (transomHeight > 25) {
          const topFramingGap = op.framing?.top?.width ?? 0;
          const transomDimX = opLeftX - 18;
          const transomSegments: { start: number; end: number; label: string; isJoint?: boolean }[] = [];

          if (topFramingGap > 0) {
            transomSegments.push({
              start: op.y + op.height,
              end: op.y + op.height + topFramingGap,
              label: `${Math.round(topFramingGap)}`,
              isJoint: true,
            });
            transomSegments.push({
              start: op.y + op.height + topFramingGap,
              end: wall.height,
              label: `${Math.round(wall.height - (op.y + op.height + topFramingGap))}`,
              isJoint: false,
            });
          } else {
            transomSegments.push({
              start: op.y + op.height,
              end: wall.height,
              label: `${Math.round(transomHeight)}`,
              isJoint: false,
            });
          }

          this.drawArchitecturalChain(
            ctx,
            originX,
            originY,
            scale,
            wall.height,
            transomSegments,
            'VERTICAL',
            transomDimX,
            opLeftX
          );
        }
      });

    ctx.restore();
  }

  /**
   * Отрисовка непрерывной архитектурной цепочки размеров с засечками под 45°
   */
  private static drawArchitecturalChain(
    ctx: CanvasRenderingContext2D,
    originX: number,
    originY: number,
    scale: number,
    wallHeight: number,
    segments: { start: number; end: number; label: string; isJoint?: boolean }[],
    orientation: 'HORIZONTAL' | 'VERTICAL',
    offsetCoord: number,
    refCoord?: number
  ): void {
    if (segments.length === 0) return;

    ctx.save();
    ctx.strokeStyle = '#000000';
    ctx.fillStyle = '#000000';
    ctx.lineWidth = 1.8;
    const tick = 9;

    if (orientation === 'HORIZONTAL') {
      const dimY = offsetCoord;
      const minVal = Math.min(...segments.map((s) => s.start));
      const maxVal = Math.max(...segments.map((s) => s.end));

      // Общая линия цепочки
      ctx.beginPath();
      ctx.moveTo(originX + minVal * scale - 8, dimY);
      ctx.lineTo(originX + maxVal * scale + 8, dimY);
      ctx.stroke();

      segments.forEach((seg) => {
        const sx = originX + seg.start * scale;
        const ex = originX + seg.end * scale;
        const midX = (sx + ex) / 2;
        const segW = ex - sx;

        // Выносные линии к стене
        const refY = refCoord !== undefined ? refCoord : (dimY < originY ? originY : originY + wallHeight * scale);
        ctx.beginPath();
        ctx.moveTo(sx, refY);
        ctx.lineTo(sx, dimY + (dimY < refY ? -6 : 6));
        ctx.moveTo(ex, refY);
        ctx.lineTo(ex, dimY + (dimY < refY ? -6 : 6));
        ctx.stroke();

        // Засечки 45°
        ctx.beginPath();
        ctx.moveTo(sx - tick, dimY + tick);
        ctx.lineTo(sx + tick, dimY - tick);
        ctx.moveTo(ex - tick, dimY + tick);
        ctx.lineTo(ex + tick, dimY - tick);
        ctx.stroke();

        // Размерный текст
        ctx.font = 'bold 18px "Segoe UI", Arial, sans-serif';
        const isJoint = seg.isJoint ?? (segW < 30);

        ctx.textAlign = 'center';
        if (isJoint) {
          // Зазоры стыков (например 8 мм) выводим под засечками
          ctx.textBaseline = 'top';
          ctx.fillText(seg.label, midX, dimY + 12);
        } else {
          // Размеры деталей и проемов выводим над линией
          ctx.textBaseline = 'bottom';
          ctx.fillText(seg.label, midX, dimY - 4);
        }
      });
    } else {
      // VERTICAL chain
      const dimX = offsetCoord;
      const minVal = Math.min(...segments.map((s) => s.start));
      const maxVal = Math.max(...segments.map((s) => s.end));

      const topY = originY + (wallHeight - maxVal) * scale;
      const botY = originY + (wallHeight - minVal) * scale;

      // Общая линия цепочки
      ctx.beginPath();
      ctx.moveTo(dimX, topY - 8);
      ctx.lineTo(dimX, botY + 8);
      ctx.stroke();

      const refX = refCoord !== undefined ? refCoord : (dimX < originX ? originX : originX + scale * 100);

      segments.forEach((seg) => {
        const sy = originY + (wallHeight - seg.start) * scale;
        const ey = originY + (wallHeight - seg.end) * scale;
        const midY = (sy + ey) / 2;

        // Выносные линии ТОЛЬКО от refX до dimX (без ухода в бесконечность!)
        ctx.beginPath();
        ctx.moveTo(refX, sy);
        ctx.lineTo(dimX + (dimX < refX ? -4 : 4), sy);
        ctx.moveTo(refX, ey);
        ctx.lineTo(dimX + (dimX < refX ? -4 : 4), ey);
        ctx.stroke();

        // Засечки 45°
        ctx.beginPath();
        ctx.moveTo(dimX - tick, sy + tick);
        ctx.lineTo(dimX + tick, sy - tick);
        ctx.moveTo(dimX - tick, ey + tick);
        ctx.lineTo(dimX + tick, ey - tick);
        ctx.stroke();

        // Текст
        ctx.save();
        ctx.translate(dimX - 16, midY);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.font = 'bold 18px "Segoe UI", Arial, sans-serif';
        ctx.fillText(seg.label, 0, 0);
        ctx.restore();
      });
    }

    ctx.restore();
  }

  /**
   * Отрисовка размерной линии с засечками по ГОСТ / Архитектурному стандарту
   */
  private static drawArchitecturalDimLine(
    ctx: CanvasRenderingContext2D,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    offsetCoord: number,
    orientation: 'HORIZONTAL' | 'VERTICAL',
    label: string
  ): void {
    ctx.save();
    ctx.strokeStyle = '#000000';
    ctx.fillStyle = '#000000';
    ctx.lineWidth = 1.8;
    const tick = 9;

    if (orientation === 'HORIZONTAL') {
      const dimY = offsetCoord;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x1, dimY - 6);
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2, dimY - 6);
      ctx.moveTo(x1 - 8, dimY);
      ctx.lineTo(x2 + 8, dimY);
      ctx.moveTo(x1 - tick, dimY + tick);
      ctx.lineTo(x1 + tick, dimY - tick);
      ctx.moveTo(x2 - tick, dimY + tick);
      ctx.lineTo(x2 + tick, dimY - tick);
      ctx.stroke();

      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.font = 'bold 18px "Segoe UI", Arial, sans-serif';
      ctx.fillText(label, (x1 + x2) / 2, dimY - 4);
    } else {
      const dimX = offsetCoord;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(dimX + (dimX < x1 ? -6 : 6), y1);
      ctx.moveTo(x2, y2);
      ctx.lineTo(dimX + (dimX < x2 ? -6 : 6), y2);
      const minY = Math.min(y1, y2);
      const maxY = Math.max(y1, y2);
      ctx.moveTo(dimX, minY - 8);
      ctx.lineTo(dimX, maxY + 8);
      ctx.moveTo(dimX - tick, y1 + tick);
      ctx.lineTo(dimX + tick, y1 - tick);
      ctx.moveTo(dimX - tick, y2 + tick);
      ctx.lineTo(dimX + tick, y2 - tick);
      ctx.stroke();

      ctx.save();
      ctx.translate(dimX - 18, (y1 + y2) / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.font = 'bold 18px "Segoe UI", Arial, sans-serif';
      ctx.fillText(label, 0, 0);
      ctx.restore();
    }
    ctx.restore();
  }

  /**
   * Отрисовка карт раскроя на листах 1220х2800 в нижней половине страницы
   */
  private static drawNestingSheetsOnCanvas(
    ctx: CanvasRenderingContext2D,
    sheetsWithNotes: { sheet: NestingSheet; otherWallNames: string[] }[],
    borrowedSheets: NestingSheet[],
    currentWallId: string,
    boxX: number,
    boxY: number,
    boxW: number,
    boxH: number,
    startIndex: number = 0
  ): void {
    if (sheetsWithNotes.length === 0) {
      // Информационная плашка, если на этой стене нет новых листов
      ctx.save();
      ctx.fillStyle = '#f8fafc';
      ctx.beginPath();
      ctx.roundRect(boxX, boxY + 20, boxW, boxH - 40, 16);
      ctx.fill();
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 26px "Segoe UI", Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(
        'ℹ️ Для данной стены не требуется нарезка новых листов материала.',
        boxX + boxW / 2,
        boxY + boxH / 2 - 35
      );

      ctx.font = '22px "Segoe UI", Arial, sans-serif';
      ctx.fillStyle = '#475569';
      ctx.fillText(
        'Все детали раскраиваются из деловых остатков плит, показанных на предыдущих чертежах проекта:',
        boxX + boxW / 2,
        boxY + boxH / 2 + 10
      );

      if (borrowedSheets.length > 0) {
        const borrowedLabels = borrowedSheets
          .map((s) => `${s.sheetLabel} (чертеж "${s.placedParts[0]?.part.wallName || 'Стена'}")`)
          .join('  •  ');
        ctx.font = 'bold 22px "Segoe UI", Arial, sans-serif';
        ctx.fillStyle = '#2563eb';
        ctx.fillText(`📄 ${borrowedLabels}`, boxX + boxW / 2, boxY + boxH / 2 + 55);
      }
      ctx.restore();
      return;
    }

    const count = sheetsWithNotes.length;
    // Количество колонок
    const cols = Math.min(count, 8);
    const rows = Math.ceil(count / cols);

    const cellW = boxW / cols;
    const cellH = boxH / rows;

    sheetsWithNotes.forEach((item, idx) => {
      const sheet = item.sheet;
      const otherWallNames = item.otherWallNames;

      const col = idx % cols;
      const row = Math.floor(idx / cols);

      const cellX = boxX + col * cellW;
      const cellY = boxY + row * cellH;

      ctx.save();
      // 1. Заголовок листа: Лист N: [Арт. XXXX] Название материала
      const firstPart = sheet.placedParts[0]?.part;
      const decorCode = sheet.decorCode || firstPart?.decorCode || '';
      const matName = sheet.materialName || firstPart?.materialName || 'Панель AllWall';
      const thickness = sheet.thickness || firstPart?.thickness || 5;

      const sheetNumber = startIndex + idx + 1;
      const decorBadge = decorCode ? `[${decorCode}] ` : '';
      const titleText = `Лист ${sheetNumber}: ${decorBadge}${matName}`;

      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 20px "Segoe UI", Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';

      const maxTitleW = cellW - 16;
      let displayTitle = titleText;
      while (displayTitle.length > 8 && ctx.measureText(displayTitle).width > maxTitleW) {
        displayTitle = displayTitle.slice(0, -2);
      }
      if (displayTitle !== titleText) displayTitle += '…';
      ctx.fillText(displayTitle, cellX + cellW / 2, cellY + 24);

      // 2. Подзаголовок: Габариты листа (1220×2800×5 мм) + Код AllWall + Исп. %
      ctx.font = '14px "Segoe UI", Arial, sans-serif';
      ctx.fillStyle = '#475569';
      const subText = `${sheet.sheetWidth} × ${sheet.sheetHeight} × ${thickness} мм${decorCode ? ` • Арт: ${decorCode}` : ''} • Исп: ${sheet.efficiencyPct}%`;
      let displaySub = subText;
      while (displaySub.length > 10 && ctx.measureText(displaySub).width > maxTitleW) {
        displaySub = displaySub.slice(0, -2);
      }
      if (displaySub !== subText) displaySub += '…';
      ctx.fillText(displaySub, cellX + cellW / 2, cellY + 46);

      // Масштабирование листа в ячейку (отступ сверху 84px исключает любые наложения)
      const pad = 18;
      const sAvailW = cellW - pad * 2;
      const sAvailH = cellH - 125;

      const scale = Math.min(sAvailW / sheet.sheetWidth, sAvailH / sheet.sheetHeight, 0.48);
      const sheetOriginX = cellX + (cellW - sheet.sheetWidth * scale) / 2;
      const sheetOriginY = cellY + 84;

      // Тело листа (чистый нейтральный фон листа)
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(sheetOriginX, sheetOriginY, sheet.sheetWidth * scale, sheet.sheetHeight * scale);
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 1.6;
      ctx.strokeRect(sheetOriginX, sheetOriginY, sheet.sheetWidth * scale, sheet.sheetHeight * scale);

      // Габаритные размеры листа (1220 сверху и 2800 слева с засечками)
      this.drawArchitecturalDimLine(
        ctx,
        sheetOriginX,
        sheetOriginY,
        sheetOriginX + sheet.sheetWidth * scale,
        sheetOriginY,
        sheetOriginY - 14,
        'HORIZONTAL',
        `${sheet.sheetWidth}`
      );

      this.drawArchitecturalDimLine(
        ctx,
        sheetOriginX,
        sheetOriginY,
        sheetOriginX,
        sheetOriginY + sheet.sheetHeight * scale,
        sheetOriginX - 16,
        'VERTICAL',
        `${sheet.sheetHeight}`
      );

      // Размещенные детали на листе
      sheet.placedParts.forEach((p) => {
        const px = sheetOriginX + p.x * scale;
        const py = sheetOriginY + (sheet.sheetHeight - (p.y + p.height)) * scale;
        const pw = p.width * scale;
        const ph = p.height * scale;

        const isCurrentWall = p.part.wallId === currentWallId;
        const rawPts = p.part.polygonPoints;
        const isPolygon = Boolean(rawPts && rawPts.length >= 3);

        const xs = isPolygon ? rawPts!.map((pt) => pt.x) : [];
        const ys = isPolygon ? rawPts!.map((pt) => pt.y) : [];
        const minX = isPolygon ? Math.min(...xs) : 0;
        const maxX = isPolygon ? Math.max(...xs) : 0;
        const minY = isPolygon ? Math.min(...ys) : 0;
        const origW = maxX - minX;

        const isDiagonalCut =
          isPolygon &&
          rawPts!.some((pt, i) => {
            const next = rawPts![(i + 1) % rawPts!.length];
            return Math.abs(pt.x - next.x) > 5 && Math.abs(pt.y - next.y) > 5;
          });

        let polyCanvasPts: { x: number; y: number }[] = [];

        if (isDiagonalCut) {
          // 1. Преобразуем полигон детали в координаты листа раскроя
          polyCanvasPts = rawPts!.map((pt) => {
            const localX = pt.x - minX;
            const localY = pt.y - minY;
            const sheetLocalX = p.rotated ? localY : localX;
            const sheetLocalY = p.rotated ? origW - localX : localY;
            return {
              x: sheetOriginX + (p.x + sheetLocalX) * scale,
              y: sheetOriginY + (sheet.sheetHeight - (p.y + sheetLocalY)) * scale,
            };
          });

          // Отрисовываем сам полигон детали
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(polyCanvasPts[0].x, polyCanvasPts[0].y);
          for (let i = 1; i < polyCanvasPts.length; i++) {
            ctx.lineTo(polyCanvasPts[i].x, polyCanvasPts[i].y);
          }
          ctx.closePath();
          ctx.fillStyle = isCurrentWall ? (p.part.color || '#fde68a') : '#e0e7ff';
          ctx.fill();
          ctx.strokeStyle = isCurrentWall ? '#b45309' : '#4338ca';
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.restore();

          // 2. Размеры и углы диагонального реза на листе
          for (let i = 0; i < rawPts!.length; i++) {
            const pt1 = rawPts![i];
            const pt2 = rawPts![(i + 1) % rawPts!.length];
            const dx = pt2.x - pt1.x;
            const dy = pt2.y - pt1.y;

            if (Math.abs(dx) > 5 && Math.abs(dy) > 5) {
              const cutLen = Math.round(Math.sqrt(dx * dx + dy * dy));
              const cutAngle = Math.round((Math.atan2(Math.abs(dy), Math.abs(dx)) * 180) / Math.PI);
              const cp1 = polyCanvasPts[i];
              const cp2 = polyCanvasPts[(i + 1) % polyCanvasPts.length];
              const midCutX = (cp1.x + cp2.x) / 2;
              const midCutY = (cp1.y + cp2.y) / 2;

              // Линия реза (пунктир)
              ctx.save();
              ctx.strokeStyle = '#0f172a';
              ctx.lineWidth = 1.8;
              ctx.setLineDash([4, 3]);
              ctx.beginPath();
              ctx.moveTo(cp1.x, cp1.y);
              ctx.lineTo(cp2.x, cp2.y);
              ctx.stroke();

              // Бейдж с длиной реза и углом
              ctx.font = 'bold 10px "Segoe UI", Arial, sans-serif';
              const cutBadge = `✂️ ${cutLen} мм (∠${cutAngle}°)`;
              const cbw = ctx.measureText(cutBadge).width + 10;
              ctx.fillStyle = '#ffffff';
              ctx.beginPath();
              ctx.roundRect(midCutX - cbw / 2, midCutY - 9, cbw, 18, 4);
              ctx.fill();
              ctx.strokeStyle = '#0f172a';
              ctx.lineWidth = 1;
              ctx.stroke();

              ctx.fillStyle = '#0f172a';
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText(cutBadge, midCutX, midCutY);
              ctx.restore();
            }
          }
        } else {
          // Обычная прямоугольная деталь
          ctx.fillStyle = isCurrentWall ? (p.part.color || '#fde68a') : '#e0e7ff';
          ctx.fillRect(px, py, pw, ph);
          ctx.strokeStyle = isCurrentWall ? '#b45309' : '#4338ca';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(px, py, pw, ph);
        }

        // Вырезы внутри детали (проемы: двери, окна, ниши) - чистое белое пустое пространство
        let hasBottomDoorCutout = false;
        let doorCutoutTopCanvasY = 0;

        if (p.part.cutouts && p.part.cutouts.length > 0) {
          p.part.cutouts.forEach((cut) => {
            const cutX = px + cut.x * scale;
            const cutY = py + (p.height - (cut.y + cut.height)) * scale;
            const cutW = cut.width * scale;
            const cutH = cut.height * scale;

            if (cut.y <= 10) {
              hasBottomDoorCutout = true;
              doorCutoutTopCanvasY = cutY;
            }

            // Очищаем область выреза белым фоном листа без линий, рамок, остатков и выносок
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(cutX, cutY, cutW, cutH);
          });
        }

        // ЗОНЫ СГИБОВ И КЕРФ-БЕНДИНГА НА ДЕТАЛИ ЛИСТА РАСКРОЯ
        if (p.part.bendsInfo && p.part.bendsInfo.length > 0) {
          p.part.bendsInfo.forEach((bend) => {
            const isRot = p.rotated;
            const bOffset = bend.bendOffsetInSheet;
            const bW = bend.bendWidth;

            const bCanvasX = isRot ? px : px + bOffset * scale;
            const bCanvasY = isRot ? py + (p.height - (bOffset + bW)) * scale : py;
            const bCanvasW = isRot ? pw : bW * scale;
            const bCanvasH = isRot ? bW * scale : ph;

            ctx.save();
            // 1. Заливка зоны изгиба
            ctx.fillStyle = 'rgba(2, 132, 199, 0.14)';
            ctx.fillRect(bCanvasX, bCanvasY, bCanvasW, bCanvasH);

            // 2. Граничные пунктирные линии начала и конца сгиба
            ctx.strokeStyle = '#0284c7';
            ctx.lineWidth = 1.8;
            ctx.setLineDash([5, 3]);
            if (!isRot) {
              ctx.beginPath();
              ctx.moveTo(bCanvasX, bCanvasY);
              ctx.lineTo(bCanvasX, bCanvasY + bCanvasH);
              ctx.moveTo(bCanvasX + bCanvasW, bCanvasY);
              ctx.lineTo(bCanvasX + bCanvasW, bCanvasY + bCanvasH);
              ctx.stroke();
            } else {
              ctx.beginPath();
              ctx.moveTo(bCanvasX, bCanvasY);
              ctx.lineTo(bCanvasX + bCanvasW, bCanvasY);
              ctx.moveTo(bCanvasX, bCanvasY + bCanvasH);
              ctx.lineTo(bCanvasX + bCanvasW, bCanvasY + bCanvasH);
              ctx.stroke();
            }

            // 3. Линии пропилов керф-бендинга
            const numLines = Math.min(8, Math.max(3, Math.floor(bend.radius / 30)));
            ctx.strokeStyle = 'rgba(2, 132, 199, 0.45)';
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 3]);
            for (let l = 1; l < numLines; l++) {
              if (!isRot) {
                const lx = bCanvasX + (l / numLines) * bCanvasW;
                ctx.beginPath();
                ctx.moveTo(lx, bCanvasY);
                ctx.lineTo(lx, bCanvasY + bCanvasH);
                ctx.stroke();
              } else {
                const ly = bCanvasY + (l / numLines) * bCanvasH;
                ctx.beginPath();
                ctx.moveTo(bCanvasX, ly);
                ctx.lineTo(bCanvasX + bCanvasW, ly);
                ctx.stroke();
              }
            }
            ctx.setLineDash([]);

            // 4. Бейдж угла/радиуса в зоне сгиба
            const radBadge = bend.radius > 0
              ? `⌒ ${bend.type === 'INNER_CORNER' ? 'ВНУТР' : 'ВНЕШН'} R=${bend.radius} (${Math.round(bW)} мм, ∠${bend.angleDeg || 90}°)`
              : `📐 ${bend.type === 'INNER_CORNER' ? 'ВНУТР' : 'ВНЕШН'} ${bend.angleDeg || 90}°`;
            ctx.font = 'bold 10.5px "Segoe UI", Arial, sans-serif';
            const bbw = ctx.measureText(radBadge).width + 12;
            const bbh = 20;
            const bbx = isRot ? bCanvasX + (bCanvasW - bbw) / 2 : bCanvasX + bCanvasW / 2 - bbw / 2;
            const bby = isRot ? bCanvasY + bCanvasH / 2 - bbh / 2 : bCanvasY + 12;

            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.roundRect(bbx, bby, bbw, bbh, 3);
            ctx.fill();
            ctx.strokeStyle = '#0284c7';
            ctx.lineWidth = 1.2;
            ctx.stroke();

            ctx.fillStyle = '#0284c7';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(radBadge, bbx + bbw / 2, bby + bbh / 2);

            // 5. ВЫНОСКИ РАЗМЕРОВ ДЛЯ ЦЕХА: (Плоский слева | Зона гибки | Плоский справа)
            const flatLeft = Math.round(bend.flatLeft);
            const flatRight = Math.round(bend.flatRight);
            const bendDimY = hasBottomDoorCutout ? py - 20 : py + ph + 16;

            if (!isRot) {
              ctx.strokeStyle = '#0284c7';
              ctx.fillStyle = '#0284c7';
              ctx.lineWidth = 1.2;

              // Цепочка размеров под/над деталью
              // Отрезок 1 (слева):
              if (flatLeft > 5) {
                ctx.beginPath();
                ctx.moveTo(px, bendDimY);
                ctx.lineTo(bCanvasX, bendDimY);
                ctx.moveTo(px, bendDimY - 4);
                ctx.lineTo(px, bendDimY + 4);
                ctx.moveTo(bCanvasX, bendDimY - 4);
                ctx.lineTo(bCanvasX, bendDimY + 4);
                ctx.stroke();

                ctx.font = 'bold 10px "Segoe UI", Arial, sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'top';
                ctx.fillText(`${flatLeft}`, px + (bCanvasX - px) / 2, bendDimY + 2);
              }

              // Отрезок 2 (зона сгиба):
              ctx.beginPath();
              ctx.moveTo(bCanvasX, bendDimY);
              ctx.lineTo(bCanvasX + bCanvasW, bendDimY);
              ctx.moveTo(bCanvasX, bendDimY - 4);
              ctx.lineTo(bCanvasX, bendDimY + 4);
              ctx.moveTo(bCanvasX + bCanvasW, bendDimY - 4);
              ctx.lineTo(bCanvasX + bCanvasW, bendDimY + 4);
              ctx.stroke();

              ctx.font = 'bold 10px "Segoe UI", Arial, sans-serif';
              ctx.textAlign = 'center';
              ctx.textBaseline = 'top';
              ctx.fillText(`${Math.round(bW)} (сгиб)`, bCanvasX + bCanvasW / 2, bendDimY + 2);

              // Отрезок 3 (справа):
              if (flatRight > 5) {
                ctx.beginPath();
                ctx.moveTo(bCanvasX + bCanvasW, bendDimY);
                ctx.lineTo(px + pw, bendDimY);
                ctx.moveTo(bCanvasX + bCanvasW, bendDimY - 4);
                ctx.lineTo(bCanvasX + bCanvasW, bendDimY + 4);
                ctx.moveTo(px + pw, bendDimY - 4);
                ctx.lineTo(px + pw, bendDimY + 4);
                ctx.stroke();

                ctx.font = 'bold 10px "Segoe UI", Arial, sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'top';
                ctx.fillText(`${flatRight}`, bCanvasX + bCanvasW + (px + pw - (bCanvasX + bCanvasW)) / 2, bendDimY + 2);
              }

              // Сноски с указателями на начало и конец гибки:
              ctx.font = 'bold 9px "Segoe UI", Arial, sans-serif';
              ctx.fillStyle = '#0369a1';
              ctx.fillText(`▲ Начало гибки (${Math.round(bOffset)} мм)`, bCanvasX, py + ph - 24);
              if (bW > 20) {
                ctx.fillText(`▲ Конец гибки (${Math.round(bOffset + bW)} мм)`, bCanvasX + bCanvasW, py + ph - 12);
              }
            }

            ctx.restore();
          });
        }

        // Метка детали
        if (pw > 15 && ph > 15) {
          ctx.fillStyle = isCurrentWall ? '#111827' : '#312e81';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';

          const isSlope = Boolean(p.part.note?.toLowerCase().includes('откос') || p.part.id.startsWith('slope-'));
          const label = isCurrentWall
            ? (p.part.partLabel || '1.1') + (isSlope ? ' (Откос)' : '')
            : `${p.part.partLabel}${isSlope ? ' Откос' : ''} (${p.part.wallName})`;

          // Если деталь узкая и вытянутая (например, планки откосов), пишем текст вертикально чтобы не было наложения
          if (pw < 55 && ph > 60) {
            ctx.save();
            ctx.translate(px + pw / 2, py + ph / 2);
            ctx.rotate(-Math.PI / 2);

            ctx.font = 'bold 13px "Segoe UI", Arial, sans-serif';
            ctx.fillText(label, 0, -6);

            ctx.font = '11px "Segoe UI", Arial, sans-serif';
            ctx.fillStyle = isCurrentWall ? '#4b5563' : '#4338ca';
            ctx.fillText(`${Math.round(p.width)}×${Math.round(p.height)}`, 0, 8);
            ctx.restore();
          } else {
            // Если есть зона сгиба, сдвигаем метку детали в плоскую зону
            let labelCenterX = px + pw / 2;
            if (p.part.bendsInfo && p.part.bendsInfo.length > 0 && !p.rotated) {
              const firstBend = p.part.bendsInfo[0];
              if (firstBend.flatLeft > 150) {
                labelCenterX = px + (firstBend.bendOffsetInSheet * scale) / 2;
              }
            } else if (isDiagonalCut && polyCanvasPts.length >= 3) {
              labelCenterX = polyCanvasPts.reduce((s, pt) => s + pt.x, 0) / polyCanvasPts.length;
            }

            const labelCenterY = isDiagonalCut && polyCanvasPts.length >= 3
              ? polyCanvasPts.reduce((s, pt) => s + pt.y, 0) / polyCanvasPts.length
              : (hasBottomDoorCutout && doorCutoutTopCanvasY > py + 25
                  ? py + (doorCutoutTopCanvasY - py) / 2
                  : py + ph / 2);

            ctx.font = 'bold 15px "Segoe UI", Arial, sans-serif';
            ctx.fillText(label, labelCenterX, labelCenterY - 8);

            // Размер детали
            ctx.font = '12px "Segoe UI", Arial, sans-serif';
            ctx.fillStyle = isCurrentWall ? '#4b5563' : '#4338ca';
            ctx.fillText(`${Math.round(p.width)}×${Math.round(p.height)}`, labelCenterX, labelCenterY + 12);
          }
        }
      });

      // Линии реза
      sheet.cutLines.forEach((cl) => {
        const cl1 = {
          x: sheetOriginX + cl.p1.x * scale,
          y: sheetOriginY + (sheet.sheetHeight - cl.p1.y) * scale,
        };
        const cl2 = {
          x: sheetOriginX + cl.p2.x * scale,
          y: sheetOriginY + (sheet.sheetHeight - cl.p2.y) * scale,
        };

        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 1.4;
        ctx.setLineDash([5, 3]);
        ctx.beginPath();
        ctx.moveTo(cl1.x, cl1.y);
        ctx.lineTo(cl2.x, cl2.y);
        ctx.stroke();
        ctx.setLineDash([]);
      });

      // СТРУКТУРИРОВАННЫЙ ПОДВАЛ ЛИСТА: ПРИМЕЧАНИЯ И ОСТАТКИ (БЕЗ ПЕРЕСЕЧЕНИЙ И НАЛОЖЕНИЙ)
      let footerY = sheetOriginY + sheet.sheetHeight * scale + 34;

      if (otherWallNames.length > 0) {
        const noteText = `📌 Остаток: ${otherWallNames.join(', ')}`;
        ctx.font = 'bold 12px "Segoe UI", Arial, sans-serif';
        const noteW = Math.min(cellW - 20, ctx.measureText(noteText).width + 16);

        ctx.fillStyle = '#fef3c7';
        ctx.beginPath();
        ctx.roundRect(cellX + cellW / 2 - noteW / 2, footerY - 10, noteW, 20, 5);
        ctx.fill();
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillStyle = '#92400e';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(noteText, cellX + cellW / 2, footerY);

        footerY += 24;
      }

      const commentedParts = sheet.placedParts.filter(
        (p) =>
          p.part.note &&
          p.part.note.trim().length > 0 &&
          !p.part.note.toLowerCase().includes('откос') &&
          !p.part.note.toLowerCase().startsWith('проем')
      );

      if (commentedParts.length > 0) {
        commentedParts.forEach((p) => {
          const badge = p.part.partLabel || '1.1';
          const noteText = p.part.note!.trim();
          const pillText = `💬 [${badge}] ${noteText}`;

          ctx.font = 'bold 12px "Segoe UI", Arial, sans-serif';
          const maxTextW = cellW - 32;
          let displayText = pillText;
          while (displayText.length > 6 && ctx.measureText(displayText).width > maxTextW) {
            displayText = displayText.slice(0, -2);
          }
          if (displayText !== pillText) displayText += '…';

          const textW = Math.min(maxTextW, ctx.measureText(displayText).width);
          const pillW = textW + 16;
          const pillX = cellX + (cellW - pillW) / 2;
          const pillH = 22;

          ctx.save();
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.roundRect(pillX, footerY, pillW, pillH, 5);
          ctx.fill();
          ctx.strokeStyle = '#b45309';
          ctx.lineWidth = 1.2;
          ctx.stroke();

          ctx.fillStyle = '#92400e';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(displayText, pillX + pillW / 2, footerY + pillH / 2);
          ctx.restore();

          footerY += pillH + 6;
        });
      }

      ctx.restore();
    });
  }

  /**
   * Отрисовка страницы 3D аксонометрии стены (Чистая белая презентационная тема)
   */
  private static renderAxonometric3DPage(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    project: Project,
    wall: Wall,
    pageNumber: number,
    totalPages: number
  ): void {
    const marginX = 90;

    // 1. Белый фон страницы
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);

    // Шапка
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 44px "Segoe UI", Arial, sans-serif';
    ctx.fillText(`3D Аксонометрия • ${wall.name}`, marginX, 95);

    ctx.font = '24px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#475569';
    ctx.fillText(`Проект: ${project.name || 'Без названия'}   •   Размеры стены: ${wall.width} × ${wall.height} мм`, marginX, 140);
    ctx.restore();

    // 2. Зона 3D сцены (Светлый чистый фон с тонкой рамкой)
    const sceneX = marginX;
    const sceneY = 175;
    const sceneW = w - marginX * 2;
    const sceneH = 1680;

    ctx.save();
    ctx.fillStyle = '#f8fafc';
    ctx.beginPath();
    ctx.roundRect(sceneX, sceneY, sceneW, sceneH, 20);
    ctx.fill();
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    // Рендерим 3D проекцию стены со светлым окружением и текстурами
    this.drawWall3DScene(ctx, wall, project, sceneX, sceneY, sceneW, sceneH);

    // 3. Нижний информационный блок
    const wallIndex = project.walls.findIndex((w) => w.id === wall.id);
    const wallNumber = wallIndex >= 0 ? wallIndex + 1 : 1;
    const defMat = project.materials.find((m) => m.id === wall.zone.materialId) || project.materials[0];
    const layout = LayoutEngine.calculateWallLayout(wall, defMat, project.materials, wallNumber);

    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 24px "Segoe UI", Arial, sans-serif';
    ctx.fillText(`Площадь покрытия: ${layout.summary.coveredAreaSqM} м²   •   Панелей: ${layout.summary.totalPanelsNeeded} шт.   •   Погонаж профилей: ${layout.summary.profileLinearMeters} м`, marginX, 1935);

    // Штамп
    ctx.textAlign = 'right';
    ctx.fillStyle = '#64748b';
    ctx.font = '22px "Segoe UI", Arial, sans-serif';
    ctx.fillText(`Лист ${pageNumber} из ${totalPages}`, w - marginX, 2040);
    ctx.fillText(`AllWall CAD 3D Visualization • ${new Date().toLocaleDateString('ru-RU')}`, w - marginX, 2005);
    ctx.restore();
  }

  private static adjustBrightness(hex: string, percent: number): string {
    if (!hex || !hex.startsWith('#')) return hex || '#888';
    let num = parseInt(hex.slice(1), 16);
    let r = Math.min(255, Math.max(0, Math.round(((num >> 16) & 255) * percent)));
    let g = Math.min(255, Math.max(0, Math.round(((num >> 8) & 255) * percent)));
    let b = Math.min(255, Math.max(0, Math.round((num & 255) * percent)));
    return `rgb(${r}, ${g}, ${b})`;
  }

  private static clipPolygonByXRange(points: Point2D[], xMin: number, xMax: number): Point2D[] {
    if (!points || points.length < 3) return [];
    let outputList = points;

    const clipLeft = (pts: Point2D[]) => {
      const res: Point2D[] = [];
      for (let i = 0; i < pts.length; i++) {
        const p1 = pts[i];
        const p2 = pts[(i + 1) % pts.length];
        const p1In = p1.x >= xMin - 0.001;
        const p2In = p2.x >= xMin - 0.001;

        if (p1In && p2In) {
          res.push(p2);
        } else if (p1In && !p2In) {
          const t = Math.abs(p2.x - p1.x) > 0.0001 ? (xMin - p1.x) / (p2.x - p1.x) : 0;
          res.push({ x: xMin, y: p1.y + t * (p2.y - p1.y) });
        } else if (!p1In && p2In) {
          const t = Math.abs(p2.x - p1.x) > 0.0001 ? (xMin - p1.x) / (p2.x - p1.x) : 0;
          res.push({ x: xMin, y: p1.y + t * (p2.y - p1.y) });
          res.push(p2);
        }
      }
      return res;
    };

    const clipRight = (pts: Point2D[]) => {
      const res: Point2D[] = [];
      for (let i = 0; i < pts.length; i++) {
        const p1 = pts[i];
        const p2 = pts[(i + 1) % pts.length];
        const p1In = p1.x <= xMax + 0.001;
        const p2In = p2.x <= xMax + 0.001;

        if (p1In && p2In) {
          res.push(p2);
        } else if (p1In && !p2In) {
          const t = Math.abs(p2.x - p1.x) > 0.0001 ? (xMax - p1.x) / (p2.x - p1.x) : 0;
          res.push({ x: xMax, y: p1.y + t * (p2.y - p1.y) });
        } else if (!p1In && p2In) {
          const t = Math.abs(p2.x - p1.x) > 0.0001 ? (xMax - p1.x) / (p2.x - p1.x) : 0;
          res.push({ x: xMax, y: p1.y + t * (p2.y - p1.y) });
          res.push(p2);
        }
      }
      return res;
    };

    outputList = clipLeft(outputList);
    outputList = clipRight(outputList);
    return outputList;
  }

  /**
   * Отрисовка фотореалистичной 3D-сцены стены (Светлая презентационная тема с полной поддержкой сгибов и углов)
   */
  private static drawWall3DScene(
    ctx: CanvasRenderingContext2D,
    wall: Wall,
    project: Project,
    boxX: number,
    boxY: number,
    boxW: number,
    boxH: number
  ): void {
    const angleDeg = 34;
    const elevationDeg = 26;
    const radA = (angleDeg * Math.PI) / 180;
    const radE = (elevationDeg * Math.PI) / 180;

    interface Point3D {
      x: number;
      y: number;
      z: number;
    }

    interface Interval1D {
      start: number;
      end: number;
    }

    const subtractInterval = (intervals: Interval1D[], cutStart: number, cutEnd: number): Interval1D[] => {
      const result: Interval1D[] = [];
      intervals.forEach((inv) => {
        if (cutEnd <= inv.start || cutStart >= inv.end) {
          result.push(inv);
        } else {
          if (cutStart > inv.start) result.push({ start: inv.start, end: cutStart });
          if (cutEnd < inv.end) result.push({ start: cutEnd, end: inv.end });
        }
      });
      return result;
    };

    const wallIndex = project.walls.findIndex((w) => w.id === wall.id);
    const wallNumber = wallIndex >= 0 ? wallIndex + 1 : 1;
    const defMat = project.materials.find((m) => m.id === wall.zone.materialId) || project.materials[0];
    const layout = LayoutEngine.calculateWallLayout(wall, defMat, project.materials, wallNumber);

    const wallW = wall.width;
    const wallH = wall.height;
    const wallThick = 150;
    const panelThick = 8;

    // 1. Построение 3D траектории стены (с поворотами на WallBend)
    interface ActiveBend3D {
      id: string;
      sStart: number;
      sEnd: number;
      arcLen: number;
      radius: number;
      angleDeg: number;
      type: RadiusType;
    }

    const activeBends: ActiveBend3D[] = [];
    if (wall.bends && wall.bends.length > 0) {
      wall.bends.forEach((b) => {
        const arcLen = Math.round((Math.PI * b.radius * (b.angleDeg || 90)) / 180);
        activeBends.push({
          id: b.id,
          sStart: b.x,
          sEnd: b.x + arcLen,
          arcLen,
          radius: b.radius,
          angleDeg: b.angleDeg || 90,
          type: b.type,
        });
      });
    } else {
      layout.panels.forEach((p) => {
        if (p.radiusConfig && !activeBends.some((b) => b.sStart === p.x)) {
          const arcLen = p.arcLength || Math.round((Math.PI * p.radiusConfig.radius * (p.radiusConfig.angleDeg || 90)) / 180);
          activeBends.push({
            id: `legacy-${p.id}`,
            sStart: p.x,
            sEnd: p.x + arcLen,
            arcLen,
            radius: p.radiusConfig.radius,
            angleDeg: p.radiusConfig.angleDeg || 90,
            type: p.radiusConfig.type,
          });
        }
      });
    }

    activeBends.sort((a, b) => a.sStart - b.sStart);

    interface PathSection3D {
      sStart: number;
      sEnd: number;
      isBend: boolean;
      bend?: ActiveBend3D;
      startPoint: Point3D;
      endPoint: Point3D;
      startHeading: number;
      endHeading: number;
      centerPoint?: Point3D;
      totalTurn?: number;
      getPoint: (s: number, y: number, depthOffset: number) => Point3D;
    }

    const computeMiterVector = (psi1: number, psi2: number, d: number): { x: number; z: number } => {
      const n1x = -Math.sin(psi1);
      const n1z = -Math.cos(psi1);
      const n2x = -Math.sin(psi2);
      const n2z = -Math.cos(psi2);

      const sumX = n1x + n2x;
      const sumZ = n1z + n2z;
      const len = Math.sqrt(sumX * sumX + sumZ * sumZ);

      if (len < 0.001) {
        return { x: n1x * d, z: n1z * d };
      }

      const mX = sumX / len;
      const mZ = sumZ / len;
      const dot = n1x * mX + n1z * mZ;
      const scale = Math.abs(dot) > 0.05 ? d / dot : d;

      return { x: mX * scale, z: mZ * scale };
    };

    const pathSections: PathSection3D[] = [];
    let curS = 0;
    let curPt: Point3D = { x: 0, y: 0, z: 0 };
    let curHeading = 0;
    const allPathPoints: Point3D[] = [{ x: 0, y: 0, z: 0 }];

    activeBends.forEach((bend) => {
      if (bend.sStart > curS + 0.5) {
        const straightLen = bend.sStart - curS;
        const straightStartPt = { ...curPt };
        const straightHeading = curHeading;
        const sStart = curS;
        const sEnd = bend.sStart;
        const straightEndPt = {
          x: straightStartPt.x + Math.cos(straightHeading) * straightLen,
          y: 0,
          z: straightStartPt.z - Math.sin(straightHeading) * straightLen,
        };

        pathSections.push({
          sStart,
          sEnd,
          isBend: false,
          startPoint: straightStartPt,
          endPoint: straightEndPt,
          startHeading: straightHeading,
          endHeading: straightHeading,
          getPoint: (s: number, y: number, depthOffset = 0) => {
            const dist = Math.max(0, Math.min(straightLen, s - sStart));
            const normX = -Math.sin(straightHeading) * depthOffset;
            const normZ = -Math.cos(straightHeading) * depthOffset;
            return {
              x: straightStartPt.x + Math.cos(straightHeading) * dist + normX,
              y,
              z: straightStartPt.z - Math.sin(straightHeading) * dist + normZ,
            };
          },
        });

        curPt = { ...straightEndPt };
        curS = sEnd;
        allPathPoints.push({ ...curPt });
      }

      const R = bend.radius;
      const totalTurn = ((bend.angleDeg || 90) * Math.PI) / 180;
      const psi = curHeading;
      const bendStartPt = { ...curPt };

      if (R <= 0 || bend.arcLen <= 0) {
        if (bend.type === 'INNER_CORNER') {
          curHeading = psi - totalTurn;
        } else {
          curHeading = psi + totalTurn;
        }
        curS = bend.sStart;
        allPathPoints.push({ ...curPt });
      } else {
        const sStart = curS;
        const sEnd = curS + bend.arcLen;

        if (bend.type === 'INNER_CORNER') {
          const cX = bendStartPt.x + Math.sin(psi) * R;
          const cZ = bendStartPt.z + Math.cos(psi) * R;
          const centerPt = { x: cX, y: 0, z: cZ };
          const endPhi = psi + Math.PI / 2 - totalTurn;
          const bendEndPt = {
            x: cX + Math.cos(endPhi) * R,
            y: 0,
            z: cZ - Math.sin(endPhi) * R,
          };
          const endHeading = psi - totalTurn;

          pathSections.push({
            sStart,
            sEnd,
            isBend: true,
            bend,
            startPoint: bendStartPt,
            endPoint: bendEndPt,
            startHeading: psi,
            endHeading,
            centerPoint: centerPt,
            totalTurn,
            getPoint: (s: number, y: number, depthOffset = 0) => {
              const u = Math.max(0, Math.min(1, (s - sStart) / bend.arcLen));
              const alpha = u * totalTurn;
              const phi = psi + Math.PI / 2 - alpha;
              const effR = Math.max(5, R + depthOffset);
              return {
                x: cX + Math.cos(phi) * effR,
                y,
                z: cZ - Math.sin(phi) * effR,
              };
            },
          });

          curPt = { ...bendEndPt };
          curHeading = endHeading;
        } else {
          const cX = bendStartPt.x - Math.sin(psi) * R;
          const cZ = bendStartPt.z - Math.cos(psi) * R;
          const centerPt = { x: cX, y: 0, z: cZ };
          const endPhi = psi - Math.PI / 2 + totalTurn;
          const bendEndPt = {
            x: cX + Math.cos(endPhi) * R,
            y: 0,
            z: cZ - Math.sin(endPhi) * R,
          };
          const endHeading = psi + totalTurn;

          pathSections.push({
            sStart,
            sEnd,
            isBend: true,
            bend,
            startPoint: bendStartPt,
            endPoint: bendEndPt,
            startHeading: psi,
            endHeading,
            centerPoint: centerPt,
            totalTurn,
            getPoint: (s: number, y: number, depthOffset = 0) => {
              const u = Math.max(0, Math.min(1, (s - sStart) / bend.arcLen));
              const alpha = u * totalTurn;
              const phi = psi - Math.PI / 2 + alpha;
              const effR = Math.max(5, R - depthOffset);
              return {
                x: cX + Math.cos(phi) * effR,
                y,
                z: cZ - Math.sin(phi) * effR,
              };
            },
          });

          curPt = { ...bendEndPt };
          curHeading = endHeading;
        }

        curS = sEnd;
        allPathPoints.push({ ...curPt });
      }
    });

    if (curS < wallW) {
      const straightLen = wallW - curS;
      const straightStartPt = { ...curPt };
      const straightHeading = curHeading;
      const sStart = curS;
      const sEnd = wallW;
      const straightEndPt = {
        x: straightStartPt.x + Math.cos(straightHeading) * straightLen,
        y: 0,
        z: straightStartPt.z - Math.sin(straightHeading) * straightLen,
      };

      pathSections.push({
        sStart,
        sEnd,
        isBend: false,
        startPoint: straightStartPt,
        endPoint: straightEndPt,
        startHeading: straightHeading,
        endHeading: straightHeading,
        getPoint: (s: number, y: number, depthOffset = 0) => {
          const dist = Math.max(0, Math.min(straightLen, s - sStart));
          const normX = -Math.sin(straightHeading) * depthOffset;
          const normZ = -Math.cos(straightHeading) * depthOffset;
          return {
            x: straightStartPt.x + Math.cos(straightHeading) * dist + normX,
            y,
            z: straightStartPt.z - Math.sin(straightHeading) * dist + normZ,
          };
        },
      });

      curPt = { ...straightEndPt };
      allPathPoints.push({ ...curPt });
    }

    const getPointAtS = (s: number, y: number, depthOffset = 0): Point3D => {
      const clampedS = Math.max(0, Math.min(wallW, s));
      const section = pathSections.find((sec) => clampedS >= sec.sStart && clampedS <= sec.sEnd) || pathSections[pathSections.length - 1];
      if (!section) return { x: 0, y, z: 0 };
      return section.getPoint(clampedS, y, depthOffset);
    };

    // Динамический расчет масштаба и центрирования
    const minX = Math.min(...allPathPoints.map((p) => p.x), 0) - 600;
    const maxX = Math.max(...allPathPoints.map((p) => p.x), 0) + 600;
    const minZ = Math.min(...allPathPoints.map((p) => p.z), 0) - wallThick - 600;
    const maxZ = Math.max(...allPathPoints.map((p) => p.z), 0) + 1600;

    const spanX = Math.max(1000, maxX - minX);
    const spanZ = Math.max(1000, maxZ - minZ);
    const scale = Math.min(boxW / (spanX * 1.3), boxH / (wallH * 1.8 + spanZ * 0.4), 0.52);

    const midX = (minX + maxX) / 2;
    const midZ = (minZ + maxZ) / 2;
    const xRotMid = midX * Math.cos(radA) - midZ * Math.sin(radA);
    const zRotMid = midX * Math.sin(radA) + midZ * Math.cos(radA);

    const cx = boxX + boxW / 2 - xRotMid * scale;
    const cy = boxY + boxH * 0.72 + (wallH / 2 * Math.cos(radE) - zRotMid * Math.sin(radE)) * scale * 0.4;

    const project3D = (p: Point3D) => {
      const xRot = p.x * Math.cos(radA) - p.z * Math.sin(radA);
      const zRot = p.x * Math.sin(radA) + p.z * Math.cos(radA);
      const screenX = cx + xRot * scale;
      const screenY = cy - (p.y * Math.cos(radE) - zRot * Math.sin(radE)) * scale;
      return { x: screenX, y: screenY };
    };

    // 2. Светлый плиточный пол
    const floorPoints = [
      project3D({ x: minX, y: 0, z: minZ }),
      project3D({ x: maxX, y: 0, z: minZ }),
      project3D({ x: maxX, y: 0, z: maxZ }),
      project3D({ x: minX, y: 0, z: maxZ }),
    ];

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(floorPoints[0].x, floorPoints[0].y);
    floorPoints.forEach((p) => ctx.lineTo(p.x, p.y));
    ctx.closePath();
    ctx.fillStyle = '#f1f5f9';
    ctx.fill();

    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1.8;
    for (let x = Math.floor(minX / 500) * 500; x <= maxX; x += 500) {
      const pA = project3D({ x, y: 0, z: minZ });
      const pB = project3D({ x, y: 0, z: maxZ });
      ctx.beginPath();
      ctx.moveTo(pA.x, pA.y);
      ctx.lineTo(pB.x, pB.y);
      ctx.stroke();
    }
    for (let z = Math.floor(minZ / 500) * 500; z <= maxZ; z += 500) {
      const pA = project3D({ x: minX, y: 0, z });
      const pB = project3D({ x: maxX, y: 0, z });
      ctx.beginPath();
      ctx.moveTo(pA.x, pA.y);
      ctx.lineTo(pB.x, pB.y);
      ctx.stroke();
    }
    ctx.restore();

    // 3. Несущая стена (Задняя грань, Верхний срез с Miter Joint и торцы)
    pathSections.forEach((sec) => {
      const steps = sec.isBend ? 14 : 1;
      const len = sec.sEnd - sec.sStart;
      for (let i = 0; i < steps; i++) {
        const s0 = sec.sStart + (i / steps) * len;
        const s1 = sec.sStart + ((i + 1) / steps) * len;

        let intervals: Interval1D[] = [{ start: 0, end: wallH }];
        wall.openings.forEach((op) => {
          if (op.isCutout !== false && (op.type === 'WINDOW' || op.type === 'DOOR') && s1 > op.x + 0.1 && s0 < op.x + op.width - 0.1) {
            intervals = subtractInterval(intervals, op.y, op.y + op.height);
          }
        });

        for (const inv of intervals) {
          if (inv.end - inv.start <= 1) continue;
          const b0_bot = project3D(sec.getPoint(s0, inv.start, wallThick));
          const b1_bot = project3D(sec.getPoint(s1, inv.start, wallThick));
          const b1_top = project3D(sec.getPoint(s1, inv.end, wallThick));
          const b0_top = project3D(sec.getPoint(s0, inv.end, wallThick));

          ctx.fillStyle = '#cbd5e1';
          ctx.strokeStyle = '#94a3b8';
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(b0_bot.x, b0_bot.y);
          ctx.lineTo(b1_bot.x, b1_bot.y);
          ctx.lineTo(b1_top.x, b1_top.y);
          ctx.lineTo(b0_top.x, b0_top.y);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
      }
    });

    pathSections.forEach((sec, idx) => {
      if (sec.isBend) {
        const steps = 14;
        const len = sec.sEnd - sec.sStart;
        for (let i = 0; i < steps; i++) {
          const s0 = sec.sStart + (i / steps) * len;
          const s1 = sec.sStart + ((i + 1) / steps) * len;

          const topF0 = project3D(sec.getPoint(s0, wallH, 0));
          const topF1 = project3D(sec.getPoint(s1, wallH, 0));
          const topB1 = project3D(sec.getPoint(s1, wallH, wallThick));
          const topB0 = project3D(sec.getPoint(s0, wallH, wallThick));

          ctx.fillStyle = '#94a3b8';
          ctx.strokeStyle = '#64748b';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(topF0.x, topF0.y);
          ctx.lineTo(topF1.x, topF1.y);
          ctx.lineTo(topB1.x, topB1.y);
          ctx.lineTo(topB0.x, topB0.y);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
      } else {
        const psiBefore = idx > 0 ? pathSections[idx - 1].endHeading : sec.startHeading;
        const psiAfter = idx < pathSections.length - 1 ? pathSections[idx + 1].startHeading : sec.endHeading;
        const vMiterStart = computeMiterVector(psiBefore, sec.startHeading, wallThick);
        const vMiterEnd = computeMiterVector(sec.endHeading, psiAfter, wallThick);

        const topF0 = project3D({ x: sec.startPoint.x, y: wallH, z: sec.startPoint.z });
        const topF1 = project3D({ x: sec.endPoint.x, y: wallH, z: sec.endPoint.z });
        const topB1 = project3D({ x: sec.endPoint.x + vMiterEnd.x, y: wallH, z: sec.endPoint.z + vMiterEnd.z });
        const topB0 = project3D({ x: sec.startPoint.x + vMiterStart.x, y: wallH, z: sec.startPoint.z + vMiterStart.z });

        ctx.fillStyle = '#94a3b8';
        ctx.strokeStyle = '#64748b';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(topF0.x, topF0.y);
        ctx.lineTo(topF1.x, topF1.y);
        ctx.lineTo(topB1.x, topB1.y);
        ctx.lineTo(topB0.x, topB0.y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    });

    // Левый торец стены
    const tL0 = project3D(getPointAtS(0, 0, 0));
    const tL1 = project3D(getPointAtS(0, wallH, 0));
    const tL2 = project3D(getPointAtS(0, wallH, wallThick));
    const tL3 = project3D(getPointAtS(0, 0, wallThick));

    ctx.fillStyle = '#94a3b8';
    ctx.beginPath();
    ctx.moveTo(tL0.x, tL0.y);
    ctx.lineTo(tL1.x, tL1.y);
    ctx.lineTo(tL2.x, tL2.y);
    ctx.lineTo(tL3.x, tL3.y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Правый торец стены
    const tR0 = project3D(getPointAtS(wallW, 0, 0));
    const tR1 = project3D(getPointAtS(wallW, wallH, 0));
    const tR2 = project3D(getPointAtS(wallW, wallH, wallThick));
    const tR3 = project3D(getPointAtS(wallW, 0, wallThick));

    ctx.fillStyle = '#cbd5e1';
    ctx.beginPath();
    ctx.moveTo(tR0.x, tR0.y);
    ctx.lineTo(tR1.x, tR1.y);
    ctx.lineTo(tR2.x, tR2.y);
    ctx.lineTo(tR3.x, tR3.y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // 4. Отрисовка декоративных панелей
    layout.panels.forEach((p) => {
      const isVoid = p.isVoid || p.materialId === MATERIAL_NONE_ID;
      const baseColor = isVoid ? '#f8fafc' : (p.materialColor || '#d6cbbe');
      const thick = isVoid ? 0 : (p.thickness || 8);
      const pStartS = p.x;
      const pEndS = p.x + p.width;
      const yBot = p.y;
      const yTop = p.y + p.height;

      if (p.polygonPoints && p.polygonPoints.length >= 3) {
        const polySliceBoundaries: number[] = [pStartS];
        pathSections.forEach((sec) => {
          if (sec.sEnd > pStartS && sec.sStart < pEndS) {
            const overlapStart = Math.max(pStartS, sec.sStart);
            const overlapEnd = Math.min(pEndS, sec.sEnd);
            if (sec.isBend) {
              const bendSlices = 14;
              for (let k = 1; k <= bendSlices; k++) {
                polySliceBoundaries.push(overlapStart + (k / bendSlices) * (overlapEnd - overlapStart));
              }
            } else {
              polySliceBoundaries.push(overlapEnd);
            }
          }
        });
        activeBends.forEach((b) => {
          if (b.sStart > pStartS && b.sStart < pEndS) polySliceBoundaries.push(b.sStart);
          if (b.sEnd > pStartS && b.sEnd < pEndS) polySliceBoundaries.push(b.sEnd);
        });
        polySliceBoundaries.push(pEndS);
        const sortedPolySlices = Array.from(new Set(polySliceBoundaries.map((s) => Math.round(s * 10) / 10))).sort((a, b) => a - b);

        for (let i = 0; i < sortedPolySlices.length - 1; i++) {
          const s0 = sortedPolySlices[i];
          const s1 = sortedPolySlices[i + 1];
          if (s1 - s0 <= 0.5) continue;

          const clippedPoly = PdfExportService.clipPolygonByXRange(p.polygonPoints, s0, s1);
          if (clippedPoly.length < 3) continue;

          const poly3D = clippedPoly.map((pt) => project3D(getPointAtS(pt.x, pt.y, -thick)));

          ctx.save();
          ctx.beginPath();
          ctx.moveTo(poly3D[0].x, poly3D[0].y);
          for (let pi = 1; pi < poly3D.length; pi++) ctx.lineTo(poly3D[pi].x, poly3D[pi].y);
          ctx.closePath();
          ctx.fillStyle = baseColor;
          ctx.fill();
          ctx.strokeStyle = isVoid ? '#e2e8f0' : '#475569';
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.restore();
        }
        return;
      }

      const slicePoints: number[] = [pStartS];
      pathSections.forEach((sec) => {
        if (sec.sEnd > pStartS && sec.sStart < pEndS) {
          const overlapStart = Math.max(pStartS, sec.sStart);
          const overlapEnd = Math.min(pEndS, sec.sEnd);
          if (sec.isBend) {
            const bendSlices = 14;
            for (let k = 1; k <= bendSlices; k++) {
              slicePoints.push(overlapStart + (k / bendSlices) * (overlapEnd - overlapStart));
            }
          } else {
            slicePoints.push(overlapEnd);
          }
        }
      });
      activeBends.forEach((b) => {
        if (b.sStart > pStartS && b.sStart < pEndS) slicePoints.push(b.sStart);
        if (b.sEnd > pStartS && b.sEnd < pEndS) slicePoints.push(b.sEnd);
      });
      wall.openings.forEach((op) => {
        if (op.isCutout !== false) {
          if (op.x > pStartS && op.x < pEndS) slicePoints.push(op.x);
          if (op.x + op.width > pStartS && op.x + op.width < pEndS) slicePoints.push(op.x + op.width);
        }
      });
      slicePoints.push(pEndS);
      const sortedSlices = Array.from(new Set(slicePoints.map((s) => Math.round(s * 10) / 10))).sort((a, b) => a - b);

      for (let i = 0; i < sortedSlices.length - 1; i++) {
        const s0 = sortedSlices[i];
        const s1 = sortedSlices[i + 1];
        if (s1 - s0 <= 0.5) continue;

        let intervals: Interval1D[] = [{ start: yBot, end: yTop }];
        wall.openings.forEach((op) => {
          if (op.isCutout !== false && s1 > op.x + 0.1 && s0 < op.x + op.width - 0.1) {
            intervals = subtractInterval(intervals, op.y, op.y + op.height);
          }
        });

        for (const inv of intervals) {
          if (inv.end - inv.start <= 1) continue;
          const segYBot = inv.start;
          const segYTop = inv.end;

          const p0 = project3D(getPointAtS(s0, segYBot, -thick));
          const p1 = project3D(getPointAtS(s1, segYBot, -thick));
          const p2 = project3D(getPointAtS(s1, segYTop, -thick));
          const p3 = project3D(getPointAtS(s0, segYTop, -thick));

          const inBend = pathSections.find((sec) => sec.isBend && s0 >= sec.sStart - 1 && s1 <= sec.sEnd + 1);
          let lightFactor = 0.96;
          if (inBend) {
            const u = (s0 - inBend.sStart) / (inBend.sEnd - inBend.sStart);
            lightFactor = inBend.bend?.type === 'INNER_CORNER' ? 0.75 + 0.25 * Math.abs(u - 0.5) * 2 : 0.85 + 0.15 * Math.sin(u * Math.PI);
          } else {
            const sec = pathSections.find((s) => s0 >= s.sStart - 0.1 && s1 <= s.sEnd + 0.1);
            if (sec) {
              const sunAngle = -Math.PI / 4;
              const angleDiff = sec.startHeading - sunAngle;
              lightFactor = 0.90 + 0.10 * Math.cos(angleDiff);
            }
          }

          ctx.save();
          ctx.beginPath();
          ctx.moveTo(p0.x, p0.y);
          ctx.lineTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.lineTo(p3.x, p3.y);
          ctx.closePath();

          ctx.fillStyle = isVoid ? '#f8fafc' : PdfExportService.adjustBrightness(baseColor, lightFactor);
          ctx.fill();
          ctx.strokeStyle = isVoid ? '#e2e8f0' : '#475569';
          ctx.lineWidth = inBend ? 0.5 : 1.5;
          ctx.stroke();

          // Текстурные волокна для дерева
          if (!isVoid && p.textureCategory === 'WOOD') {
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.08)';
            ctx.lineWidth = 1.5;
            for (let f = 1; f < 5; f++) {
              const u = f / 5;
              const bX = p0.x + (p1.x - p0.x) * u;
              const bY = p0.y + (p1.y - p0.y) * u;
              const tX = p3.x + (p2.x - p3.x) * u;
              const tY = p3.y + (p2.y - p3.y) * u;
              ctx.beginPath();
              ctx.moveTo(bX, bY);
              ctx.lineTo(tX, tY);
              ctx.stroke();
            }
          }

          // Верхний торец панели
          const pt0 = p3;
          const pt1 = p2;
          const pt2 = project3D(getPointAtS(s1, segYTop, 0));
          const pt3 = project3D(getPointAtS(s0, segYTop, 0));

          ctx.fillStyle = PdfExportService.adjustBrightness(baseColor, 1.08);
          ctx.beginPath();
          ctx.moveTo(pt0.x, pt0.y);
          ctx.lineTo(pt1.x, pt1.y);
          ctx.lineTo(pt2.x, pt2.y);
          ctx.lineTo(pt3.x, pt3.y);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        }
      }
    });

    // 5. Светодиодные линии LED
    layout.joints.forEach((j) => {
      if (j.isLED) {
        const p1 = project3D(getPointAtS(j.p1 ? j.p1.x : j.x, j.p1 ? j.p1.y : j.y, -panelThick - 3));
        const p2 = project3D(
          getPointAtS(
            j.p2 ? j.p2.x : (j.orientation === 'VERTICAL' ? j.x : j.x + j.length),
            j.p2 ? j.p2.y : (j.orientation === 'VERTICAL' ? j.y + j.length : j.y),
            -panelThick - 3
          )
        );

        ctx.save();
        ctx.strokeStyle = 'rgba(245, 158, 11, 0.4)';
        ctx.lineWidth = 14;
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();

        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
        ctx.restore();
      }
    });

    // 6. Проемы (Двери, Окна, ТВ, Ниши)
    wall.openings.forEach((op) => {
      const opDepth = op.depth || 150;

      if (op.type === 'DOOR') {
        const jL0 = project3D(getPointAtS(op.x, op.y, -panelThick - 2));
        const jL1 = project3D(getPointAtS(op.x, op.y, opDepth));
        const jL2 = project3D(getPointAtS(op.x, op.y + op.height, opDepth));
        const jL3 = project3D(getPointAtS(op.x, op.y + op.height, -panelThick - 2));

        ctx.save();
        ctx.fillStyle = '#cbd5e1';
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(jL0.x, jL0.y);
        ctx.lineTo(jL1.x, jL1.y);
        ctx.lineTo(jL2.x, jL2.y);
        ctx.lineTo(jL3.x, jL3.y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        const jT2 = project3D(getPointAtS(op.x + op.width, op.y + op.height, opDepth));
        const jT3 = project3D(getPointAtS(op.x + op.width, op.y + op.height, -panelThick - 2));

        ctx.fillStyle = '#94a3b8';
        ctx.strokeStyle = '#64748b';
        ctx.beginPath();
        ctx.moveTo(jL3.x, jL3.y);
        ctx.lineTo(jL2.x, jL2.y);
        ctx.lineTo(jT2.x, jT2.y);
        ctx.lineTo(jT3.x, jT3.y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        const jR2 = project3D(getPointAtS(op.x + op.width, op.y, opDepth));
        const jR3 = project3D(getPointAtS(op.x + op.width, op.y, -panelThick - 2));

        ctx.fillStyle = '#cbd5e1';
        ctx.strokeStyle = '#94a3b8';
        ctx.beginPath();
        ctx.moveTo(jT3.x, jT3.y);
        ctx.lineTo(jT2.x, jT2.y);
        ctx.lineTo(jR2.x, jR2.y);
        ctx.lineTo(jR3.x, jR3.y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        const doorZ = 60;
        const d0 = project3D(getPointAtS(op.x + 20, op.y, doorZ));
        const d1 = project3D(getPointAtS(op.x + op.width - 20, op.y, doorZ));
        const d2 = project3D(getPointAtS(op.x + op.width - 20, op.y + op.height - 20, doorZ));
        const d3 = project3D(getPointAtS(op.x + 20, op.y + op.height - 20, doorZ));

        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#64748b';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(d0.x, d0.y);
        ctx.lineTo(d1.x, d1.y);
        ctx.lineTo(d2.x, d2.y);
        ctx.lineTo(d3.x, d3.y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        const hStart = project3D(getPointAtS(op.x + op.width - 90, op.y + 1000, doorZ - 10));
        const hEnd = project3D(getPointAtS(op.x + op.width - 45, op.y + 1000, doorZ - 10));
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(hStart.x, hStart.y);
        ctx.lineTo(hEnd.x, hEnd.y);
        ctx.stroke();

        ctx.restore();
      } else if (op.type === 'WINDOW') {
        ctx.save();
        const winDepth = 200;
        const wL0 = project3D(getPointAtS(op.x, op.y, -panelThick - 2));
        const wL1 = project3D(getPointAtS(op.x, op.y, winDepth));
        const wL2 = project3D(getPointAtS(op.x, op.y + op.height, winDepth));
        const wL3 = project3D(getPointAtS(op.x, op.y + op.height, -panelThick - 2));

        ctx.fillStyle = '#cbd5e1';
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(wL0.x, wL0.y);
        ctx.lineTo(wL1.x, wL1.y);
        ctx.lineTo(wL2.x, wL2.y);
        ctx.lineTo(wL3.x, wL3.y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        const wT1 = project3D(getPointAtS(op.x + op.width, op.y + op.height, winDepth));
        const wT2 = project3D(getPointAtS(op.x + op.width, op.y + op.height, -panelThick - 2));
        ctx.fillStyle = '#94a3b8';
        ctx.beginPath();
        ctx.moveTo(wL3.x, wL3.y);
        ctx.lineTo(wL2.x, wL2.y);
        ctx.lineTo(wT1.x, wT1.y);
        ctx.lineTo(wT2.x, wT2.y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        const g0 = project3D(getPointAtS(op.x + 20, op.y + 15, 100));
        const g1 = project3D(getPointAtS(op.x + op.width - 20, op.y + 15, 100));
        const g2 = project3D(getPointAtS(op.x + op.width - 20, op.y + op.height - 20, 100));
        const g3 = project3D(getPointAtS(op.x + 20, op.y + op.height - 20, 100));
        ctx.fillStyle = 'rgba(224, 242, 254, 0.6)';
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(g0.x, g0.y);
        ctx.lineTo(g1.x, g1.y);
        ctx.lineTo(g2.x, g2.y);
        ctx.lineTo(g3.x, g3.y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        const imp0 = project3D(getPointAtS(op.x + op.width / 2, op.y + 15, 100));
        const imp1 = project3D(getPointAtS(op.x + op.width / 2, op.y + op.height - 20, 100));
        ctx.strokeStyle = '#0284c7';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(imp0.x, imp0.y);
        ctx.lineTo(imp1.x, imp1.y);
        ctx.stroke();

        ctx.restore();
      } else if (op.type === 'TV_ZONE') {
        ctx.save();
        const tvZ = -30;
        const t0 = project3D(getPointAtS(op.x, op.y, tvZ));
        const t1 = project3D(getPointAtS(op.x + op.width, op.y, tvZ));
        const t2 = project3D(getPointAtS(op.x + op.width, op.y + op.height, tvZ));
        const t3 = project3D(getPointAtS(op.x, op.y + op.height, tvZ));

        ctx.fillStyle = '#0f172a';
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(t0.x, t0.y);
        ctx.lineTo(t1.x, t1.y);
        ctx.lineTo(t2.x, t2.y);
        ctx.lineTo(t3.x, t3.y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.beginPath();
        ctx.moveTo(t0.x, t0.y);
        ctx.lineTo(t1.x, t1.y);
        ctx.lineTo(t3.x, t3.y);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      } else {
        ctx.save();
        const nDepth = opDepth;
        const nL0 = project3D(getPointAtS(op.x, op.y, -panelThick - 2));
        const nL1 = project3D(getPointAtS(op.x, op.y, nDepth));
        const nL2 = project3D(getPointAtS(op.x, op.y + op.height, nDepth));
        const nL3 = project3D(getPointAtS(op.x, op.y + op.height, -panelThick - 2));

        ctx.fillStyle = '#94a3b8';
        ctx.strokeStyle = '#64748b';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(nL0.x, nL0.y);
        ctx.lineTo(nL1.x, nL1.y);
        ctx.lineTo(nL2.x, nL2.y);
        ctx.lineTo(nL3.x, nL3.y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        const nBack1 = project3D(getPointAtS(op.x + op.width, op.y, nDepth));
        const nBack2 = project3D(getPointAtS(op.x + op.width, op.y + op.height, nDepth));

        ctx.fillStyle = '#e2e8f0';
        ctx.beginPath();
        ctx.moveTo(nL1.x, nL1.y);
        ctx.lineTo(nBack1.x, nBack1.y);
        ctx.lineTo(nBack2.x, nBack2.y);
        ctx.lineTo(nL2.x, nL2.y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    });
  }

  /**
   * Отрисовка титульной / сводной страницы документации монтажников
   */
  private static renderInstallerCoverPage(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    project: Project,
    nesting: ProjectNestingResult,
    profiles: ProjectProfilesReport
  ): void {
    const marginX = 90;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);

    // Заголовок
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 44px "Segoe UI", Arial, sans-serif';
    ctx.fillText('Спецификация материалов и профилей (Для монтажников)', marginX, 95);

    ctx.font = '24px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#475569';
    ctx.fillText(`Проект: ${project.name || 'Без названия'}   •   Стен в проекте: ${project.walls.length}   •   Дата: ${new Date().toLocaleDateString('ru-RU')}`, marginX, 140);
    ctx.restore();

    // 1. Блок общей сводки (KPI карточки)
    const kpiY = 175;
    const totalAvailW = w - marginX * 2;
    const cardGap = 24;
    const cardW = (totalAvailW - cardGap * 3) / 4;
    const cardH = 145;

    const cards = [
      { title: 'ВСЕГО ПАНЕЛЕЙ', val: `${nesting.totalPartsCount} шт.`, sub: `Листов 1220×2800: ${nesting.totalSheetsCount} шт.` },
      { title: 'ПОГОНАЖ ПРОФИЛЕЙ', val: `${profiles.totalLinearMeters} м`, sub: `Хлыстов 3м: ${profiles.totalStockBars} шт.` },
      { title: 'ПЛОЩАДЬ ОТДЕЛКИ', val: `${nesting.materialResults.reduce((acc, m) => acc + m.totalPartsAreaSqM, 0).toFixed(1)} м²`, sub: `Эффективность: ${nesting.materialResults[0]?.overallEfficiencyPct || 92}%` },
      { title: 'КОЛИЧЕСТВО СТЕН', val: `${project.walls.length}`, sub: `Проемов: ${project.walls.reduce((acc, w) => acc + w.openings.length, 0)}` },
    ];

    cards.forEach((card, idx) => {
      const cx = marginX + idx * (cardW + cardGap);
      ctx.save();
      ctx.fillStyle = '#f8fafc';
      ctx.beginPath();
      ctx.roundRect(cx, kpiY, cardW, cardH, 14);
      ctx.fill();
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#64748b';
      ctx.font = 'bold 17px "Segoe UI", Arial, sans-serif';
      ctx.fillText(card.title, cx + 24, kpiY + 36);

      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 34px "Segoe UI", Arial, sans-serif';
      ctx.fillText(card.val, cx + 24, kpiY + 84);

      ctx.fillStyle = '#475569';
      ctx.font = '17px "Segoe UI", Arial, sans-serif';
      ctx.fillText(card.sub, cx + 24, kpiY + 120);
      ctx.restore();
    });

    // 2. Таблица материалов и панелей
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 28px "Segoe UI", Arial, sans-serif';
    ctx.fillText('1. Сводная ведомость панелей и материалов', marginX, 380);
    ctx.restore();

    const tbl1Y = 405;
    const colW1 = [
      Math.round(totalAvailW * 0.32),
      Math.round(totalAvailW * 0.16),
      Math.round(totalAvailW * 0.16),
      Math.round(totalAvailW * 0.12),
      Math.round(totalAvailW * 0.12),
      Math.round(totalAvailW * 0.12),
    ];

    this.drawTable(
      ctx,
      marginX,
      tbl1Y,
      totalAvailW,
      ['Материал / Декор', 'Артикул', 'Тип', 'Деталей', 'Площадь', 'Листов 1220×2800'],
      nesting.materialResults.map((m) => [
        m.materialName,
        m.materialId,
        'Листовая панель',
        `${m.totalParts} шт.`,
        `${m.totalPartsAreaSqM} м²`,
        `${m.totalSheets} шт.`,
      ]),
      colW1
    );

    // 3. Таблица профилей и комплектующих
    const tbl2Y = 930;
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 28px "Segoe UI", Arial, sans-serif';
    ctx.fillText('2. Спецификация профилей и фурнитуры (Стандарт 3000 мм)', marginX, tbl2Y - 25);
    ctx.restore();

    const colW2 = [
      Math.round(totalAvailW * 0.38),
      Math.round(totalAvailW * 0.22),
      Math.round(totalAvailW * 0.16),
      Math.round(totalAvailW * 0.12),
      Math.round(totalAvailW * 0.12),
    ];

    this.drawTable(
      ctx,
      marginX,
      tbl2Y,
      totalAvailW,
      ['Тип профиля', 'Артикул AllWall', 'Видимая ширина', 'Погонаж', 'Хлыстов 3м'],
      profiles.byCategorySummary.map((p) => [
        p.name,
        p.article,
        `${PROFILE_CATEGORIES_INFO[p.category].defaultWidth} мм`,
        `${p.totalLinearMeters} м`,
        `${p.stockBarsCount} шт.`,
      ]),
      colW2
    );

    // Штамп
    ctx.save();
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#64748b';
    ctx.font = '22px "Segoe UI", Arial, sans-serif';
    ctx.fillText('Лист 1 (Сводный)', w - marginX, 2040);
    ctx.restore();
  }

  /**
   * Отрисовка страницы стены для монтажников (2D без текстур + цветные стыки + спецификация)
   */
  private static renderInstallerWallPage(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    project: Project,
    wall: Wall,
    report: WallProfilesReport,
    pageNumber: number,
    totalPages: number
  ): void {
    const marginX = 90;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);

    // Шапка
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 44px "Segoe UI", Arial, sans-serif';
    ctx.fillText(`Монтажная схема: ${wall.name}`, marginX, 95);

    ctx.font = '24px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#475569';
    ctx.fillText(`Габариты стены: ${wall.width} × ${wall.height} мм   •   Проект: ${project.name || 'Без названия'}`, marginX, 140);
    ctx.restore();

    const wallIndex = project.walls.findIndex((w) => w.id === wall.id);
    const wallNumber = wallIndex >= 0 ? wallIndex + 1 : 1;
    const defMat = project.materials.find((m) => m.id === wall.zone.materialId) || project.materials[0];
    const layout = LayoutEngine.calculateWallLayout(wall, defMat, project.materials, wallNumber);

    // 1. Зона 2D чертежа каркаса (слева)
    const sideW = 760;
    const drawAreaX = marginX;
    const drawAreaY = 175;
    const drawAreaW = w - marginX * 2 - sideW - 40;
    const drawAreaH = 1700;

    this.drawWall2DOnCanvas(ctx, wall, layout, drawAreaX, drawAreaY, drawAreaW, drawAreaH, false);

    // 2. Правая боковая колонка: Сводка по профилям на этой стене
    const sideX = w - marginX - sideW;
    const sideY = 175;
    const sideH = 1700;

    ctx.save();
    ctx.fillStyle = '#f8fafc';
    ctx.beginPath();
    ctx.roundRect(sideX, sideY, sideW, sideH, 18);
    ctx.fill();
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 28px "Segoe UI", Arial, sans-serif';
    ctx.fillText('Профили на этой стене', sideX + 32, sideY + 50);

    ctx.font = '18px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#64748b';
    ctx.fillText(`Всего погонажа: ${report.totalLinearMeters} м   •   Хлыстов 3м: ${report.totalStockBars} шт.`, sideX + 32, sideY + 86);

    // Список профилей (карточки с безопасными отступами)
    let curY = sideY + 120;
    const cardH = 135;
    const cardGap = 18;

    report.items.forEach((item) => {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.roundRect(sideX + 24, curY, sideW - 48, cardH, 12);
      ctx.fill();
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Цветовая полоса типа профиля слева
      ctx.fillStyle = item.colorHex;
      ctx.beginPath();
      ctx.roundRect(sideX + 24, curY, 10, cardH, [12, 0, 0, 12]);
      ctx.fill();

      // Название профиля
      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 20px "Segoe UI", Arial, sans-serif';
      ctx.fillText(item.name, sideX + 48, curY + 34);

      // Артикул и ширина
      ctx.fillStyle = '#64748b';
      ctx.font = '16px "Segoe UI", Arial, sans-serif';
      ctx.fillText(`Артикул: ${item.article}   •   Ширина: ${PROFILE_CATEGORIES_INFO[item.category].defaultWidth} мм`, sideX + 48, curY + 68);

      // Метраж
      ctx.fillStyle = '#1e293b';
      ctx.font = 'bold 18px "Segoe UI", Arial, sans-serif';
      ctx.fillText(`Погонаж: ${item.totalLinearMeters} м (${item.segmentsCount} сегм.)`, sideX + 48, curY + 104);

      // Количество хлыстов (справа)
      ctx.fillStyle = '#2563eb';
      ctx.font = 'bold 18px "Segoe UI", Arial, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(`${item.stockBarsCount} шт. (3м)`, sideX + sideW - 44, curY + 104);
      ctx.textAlign = 'left';

      curY += cardH + cardGap;
    });

    // Легенда цветовой маркировки стыков внизу сайдбара
    const legY = sideY + sideH - 240;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.roundRect(sideX + 24, legY, sideW - 48, 205, 12);
    ctx.fill();
    ctx.strokeStyle = '#e2e8f0';
    ctx.stroke();

    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 18px "Segoe UI", Arial, sans-serif';
    ctx.fillText('Легенда чертежа:', sideX + 44, legY + 34);

    const legendItems = [
      { color: '#f59e0b', label: 'LED подсветка (10 мм паз под RGB ленту)' },
      { color: '#2563eb', label: 'Соединительный профиль (0.8 мм)' },
      { color: '#ef4444', label: 'Торцевой закрывающий профиль' },
      { color: '#06b6d4', label: 'Угловой профиль (откосы/углы)' },
    ];

    legendItems.forEach((leg, lIdx) => {
      const ly = legY + 68 + lIdx * 32;
      ctx.fillStyle = leg.color;
      ctx.fillRect(sideX + 44, ly - 10, 24, 8);
      ctx.fillStyle = '#334155';
      ctx.font = '16px "Segoe UI", Arial, sans-serif';
      ctx.fillText(leg.label, sideX + 80, ly);
    });

    // Штамп
    ctx.textAlign = 'right';
    ctx.fillStyle = '#64748b';
    ctx.font = '22px "Segoe UI", Arial, sans-serif';
    ctx.fillText(`Лист ${pageNumber} из ${totalPages}`, w - marginX, 2040);
    ctx.restore();
  }

  /**
   * Вспомогательный метод отрисовки таблицы с идеальным выравниванием
   */
  private static drawTable(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    totalW: number,
    headers: string[],
    rows: string[][],
    colWidths: number[]
  ): void {
    const rowH = 64;
    const headerH = 60;

    ctx.save();
    // Шапка таблицы
    ctx.fillStyle = '#f1f5f9';
    ctx.fillRect(x, y, totalW, headerH);
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, totalW, headerH);

    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 20px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    let curX = x;
    headers.forEach((h, i) => {
      ctx.fillText(h, curX + 20, y + headerH / 2);
      curX += colWidths[i];
    });

    // Строки таблицы
    rows.forEach((row, rIdx) => {
      const ry = y + headerH + rIdx * rowH;
      ctx.fillStyle = rIdx % 2 === 0 ? '#ffffff' : '#f8fafc';
      ctx.fillRect(x, ry, totalW, rowH);
      ctx.strokeStyle = '#e2e8f0';
      ctx.strokeRect(x, ry, totalW, rowH);

      ctx.fillStyle = '#334155';
      ctx.font = '19px "Segoe UI", Arial, sans-serif';

      let rowX = x;
      row.forEach((val, cIdx) => {
        ctx.fillText(val, rowX + 20, ry + rowH / 2);
        rowX += colWidths[cIdx];
      });
    });

    ctx.restore();
  }
}

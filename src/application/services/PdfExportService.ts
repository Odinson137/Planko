import { jsPDF } from 'jspdf';
import { Project } from '../../core/models/Project';
import { Wall } from '../../core/models/Wall';
import { LayoutEngine, LayoutCalculationResult } from '../../core/layout/LayoutEngine';
import { NestingEngine, NestingPartInput, ProjectNestingResult, NestingSheet, NestingCutout } from '../../core/layout/NestingEngine';
import { ProfileSpecificationEngine, ProjectProfilesReport, WallProfilesReport, PROFILE_CATEGORIES_INFO } from '../../core/layout/ProfileSpecificationEngine';
import { MATERIAL_NONE_ID } from '../../core/models/Material';

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
    project.walls.forEach((wall) => {
      const defMat = project.materials.find((m) => m.id === wall.zone.materialId) || project.materials[0];
      const layout = LayoutEngine.calculateWallLayout(wall, defMat, project.materials);

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
            partLabel: `1.${pIdx + 1}`,
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
          });
        }
      });

      // Добавляем детали откосов
      if (layout.slopes && layout.slopes.length > 0) {
        layout.slopes.forEach((sl) => {
          allPartsForNesting.push({
            id: sl.id,
            wallId: wall.id,
            wallName: wall.name,
            partLabel: sl.partLabel,
            width: sl.width,
            height: sl.depth,
            areaSqM: sl.areaSqM,
            materialId: sl.materialId,
            materialName: sl.materialName,
            color: sl.materialColor,
            note: `${sl.openingName} (${sl.sideLabel})`,
          });
        });
      }
    });

    // Рассчитываем оптимальный раскрой
    const nestingResult: ProjectNestingResult = NestingEngine.optimizeProjectNesting(allPartsForNesting);

    // Генерируем страницу для каждой стены
    for (let wIdx = 0; wIdx < project.walls.length; wIdx++) {
      const wall = project.walls[wIdx];
      if (wIdx > 0) {
        pdf.addPage('a4', 'landscape');
      }

      const canvas = document.createElement('canvas');
      canvas.width = 2970; // 300 DPI (297mm * 10)
      canvas.height = 2100;
      const ctx = canvas.getContext('2d')!;

      // Рендерим страницу раскладки стены
      this.renderPanelLayoutPage(ctx, canvas.width, canvas.height, project, wall, nestingResult, wIdx + 1, project.walls.length);

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
    project.walls.forEach((wall) => {
      const defMat = project.materials.find((m) => m.id === wall.zone.materialId) || project.materials[0];
      const layout = LayoutEngine.calculateWallLayout(wall, defMat, project.materials);
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
            decorCode: p.decorCode,
            thickness: p.thickness,
          });
        }
      });
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
  // ГРАФИЧЕСКИЙ РЕНДЕРИНГ СТРАНИЦ (Clean Minimalist Engineering Style)
  // ===========================================================================

  /**
   * Отрисовка страницы плана раскладки панелей и карт раскроя на листах
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

    const marginX = 90;

    // 2. Шапка чертежа
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 44px "Segoe UI", Arial, sans-serif';
    ctx.fillText(`Раскладка панелей (${wall.name})`, marginX, 95);

    ctx.font = '24px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#475569';
    ctx.fillText(`Проект: ${project.name || 'Без названия'}   •   Габариты стены: ${wall.width} × ${wall.height} мм`, marginX, 140);
    ctx.restore();

    // 3. Расчет раскладки стены
    const defMat = project.materials.find((m) => m.id === wall.zone.materialId) || project.materials[0];
    const layout = LayoutEngine.calculateWallLayout(wall, defMat, project.materials);

    // Зона чертежа стены (верхняя половина)
    const wallAreaX = marginX;
    const wallAreaY = 175;
    const wallAreaW = w - marginX * 2;
    const wallAreaH = 780;

    this.drawWall2DOnCanvas(ctx, wall, layout, wallAreaX, wallAreaY, wallAreaW, wallAreaH, true);

    // Разделительная линия
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(marginX, 1010);
    ctx.lineTo(w - marginX, 1010);
    ctx.stroke();

    // 4. Карты раскроя листов (нижняя половина)
    const sheetsForThisWall: { sheet: NestingSheet; otherWallNames: string[] }[] = [];
    const borrowedSheets: NestingSheet[] = [];

    nesting.allSheets.forEach((sheet) => {
      const wallsOnSheet = Array.from(new Set(sheet.placedParts.map((p) => p.part.wallId)));
      if (!wallsOnSheet.includes(wall.id)) return;

      // Находим первую стену в порядке проекта, которая использует этот лист
      const firstWallOnSheet = project.walls.find((w) => wallsOnSheet.includes(w.id));

      if (firstWallOnSheet?.id === wall.id) {
        // Лист впервые появляется на этой стене!
        const otherWallNames = Array.from(
          new Set(sheet.placedParts.filter((p) => p.part.wallId !== wall.id).map((p) => p.part.wallName))
        );
        sheetsForThisWall.push({ sheet, otherWallNames });
      } else {
        // Лист был впервые показан на предыдущей стене
        borrowedSheets.push(sheet);
      }
    });

    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 30px "Segoe UI", Arial, sans-serif';
    ctx.fillText('Карта оптимального раскроя материала (Листы 1220 × 2800 мм)', marginX, 1060);
    ctx.restore();

    const sheetsAreaX = marginX;
    const sheetsAreaY = 1090;
    const sheetsAreaW = w - marginX * 2;
    const sheetsAreaH = 780;

    this.drawNestingSheetsOnCanvas(
      ctx,
      sheetsForThisWall,
      borrowedSheets,
      wall.id,
      sheetsAreaX,
      sheetsAreaY,
      sheetsAreaW,
      sheetsAreaH
    );

    // 5. Технические примечания внизу
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#dc2626';
    ctx.font = 'bold 22px "Segoe UI", Arial, sans-serif';
    ctx.fillText('! Подрезку брать с запасом на 5 мм, перед началом монтажа сделать условную разметку для удобства.', marginX, 1935);
    ctx.fillText('! Высоту подсветки регулировать по месту монтажа профилей. Углы в ТВ-зоне брать одного градуса.', marginX, 1970);

    // Динамические сноски об использовании остатков между стенами
    const sharedSheets = sheetsForThisWall.filter((item) => item.otherWallNames.length > 0);
    if (sharedSheets.length > 0) {
      const sharedLabels = sharedSheets.map((item) => item.sheet.sheetLabel).join(', ');
      const targetWalls = Array.from(new Set(sharedSheets.flatMap((item) => item.otherWallNames))).join(', ');
      ctx.fillStyle = '#b45309'; // Темно-янтарный
      ctx.fillText(`! Остатки от ${sharedLabels} использовать на других стенах: ${targetWalls} (указано на картах раскроя).`, marginX, 2005);
    } else if (borrowedSheets.length > 0) {
      const borrowedLabels = borrowedSheets.map((s) => s.sheetLabel).join(', ');
      ctx.fillStyle = '#1d4ed8'; // Синий
      ctx.fillText(`! Детали для этой стены берутся из остатков ${borrowedLabels} (см. предыдущие листы раскроя).`, marginX, 2005);
    } else {
      ctx.fillStyle = '#475569';
      ctx.fillText('! Перед монтажом панелей выполнить контрольные замеры уровней стен.', marginX, 2005);
    }
    ctx.restore();

    // Штамп / номер страницы
    ctx.save();
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#64748b';
    ctx.font = '22px "Segoe UI", Arial, sans-serif';
    ctx.fillText(`Лист ${pageNumber} из ${totalPages}`, w - marginX, 2040);
    ctx.fillText(`Planko CAD Engine • ${new Date().toLocaleDateString('ru-RU')}`, w - marginX, 2005);
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
    const padX = 120;
    const padY = 90;
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

        const midX = originX + (p.x + p.width / 2) * scale;
        const midY = originY + (wall.height - labelYCenter) * scale;

        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // Формируем чистую маркировку 1.1, 1.2...
        const label = p.partLabel && p.partLabel.split('.').length <= 2
          ? p.partLabel
          : `1.${pIdx + 1}`;
        const dimText = `${Math.round(p.width)}×${Math.round(p.height)}`;

        ctx.font = 'bold 20px "Segoe UI", Arial, sans-serif';
        const labelW = Math.max(ctx.measureText(label).width, ctx.measureText(dimText).width) + 20;

        // Белый бейдж
        ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
        ctx.fillRect(midX - labelW / 2, midY - 22, labelW, 44);
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(midX - labelW / 2, midY - 22, labelW, 44);

        ctx.fillStyle = '#0f172a';
        ctx.fillText(label, midX, midY - 8);

        ctx.font = '14px "Segoe UI", Arial, sans-serif';
        ctx.fillStyle = '#64748b';
        ctx.fillText(dimText, midX, midY + 12);
        ctx.restore();
      }
    });

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

      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 20px "Segoe UI", Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const typeLabel = op.type === 'DOOR' ? 'Дверь' : op.type === 'WINDOW' ? 'Окно' : op.type === 'TV_ZONE' ? 'ТВ-зона' : 'Ниша';
      ctx.fillText(`${op.name || typeLabel}`, opTopLeft.x + opW / 2, opTopLeft.y + opH / 2 - 10);
      ctx.font = '16px "Segoe UI", Arial, sans-serif';
      ctx.fillStyle = '#475569';
      ctx.fillText(`${op.width} × ${op.height} мм`, opTopLeft.x + opW / 2, opTopLeft.y + opH / 2 + 14);
      ctx.restore();

      // Выноски размеров простенков панели вокруг проемов
      const hostPanel = layout.panels.find(
        (p) => !p.isVoid && op.x >= p.x - 1 && op.x + op.width <= p.x + p.width + 1
      );
      if (hostPanel) {
        const leftStrip = Math.round(op.x - hostPanel.x);
        const rightStrip = Math.round((hostPanel.x + hostPanel.width) - (op.x + op.width));

        // Левый простенок на панели (расстояние от левого края панели до выреза)
        if (leftStrip > 15) {
          const cX1 = originX + hostPanel.x * scale;
          const cX2 = originX + op.x * scale;
          const midX = (cX1 + cX2) / 2;
          const midY = originY + (wall.height - (op.y + op.height / 2)) * scale;

          ctx.save();
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.roundRect(midX - 24, midY - 13, 48, 26, 6);
          ctx.fill();
          ctx.strokeStyle = '#b45309';
          ctx.lineWidth = 1.5;
          ctx.stroke();

          ctx.fillStyle = '#92400e';
          ctx.font = 'bold 14px "Segoe UI", Arial, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(`${leftStrip}`, midX, midY);
          ctx.restore();
        }

        // Правый простенок на панели
        if (rightStrip > 15) {
          const cX1 = originX + (op.x + op.width) * scale;
          const cX2 = originX + (hostPanel.x + hostPanel.width) * scale;
          const midX = (cX1 + cX2) / 2;
          const midY = originY + (wall.height - (op.y + op.height / 2)) * scale;

          ctx.save();
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.roundRect(midX - 24, midY - 13, 48, 26, 6);
          ctx.fill();
          ctx.strokeStyle = '#b45309';
          ctx.lineWidth = 1.5;
          ctx.stroke();

          ctx.fillStyle = '#92400e';
          ctx.font = 'bold 14px "Segoe UI", Arial, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(`${rightStrip}`, midX, midY);
          ctx.restore();
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

    // 5. Архитектурные размерные цепочки (с засечками под 45°)
    ctx.save();

    // 5.1. Верхний ярус 1 (Общий габарит стены):
    const topOverallY = originY - 70;
    this.drawArchitecturalDimLine(
      ctx,
      originX,
      originY,
      originX + wall.width * scale,
      originY,
      topOverallY,
      'HORIZONTAL',
      `${wall.width} мм`
    );

    // 5.2. Верхний ярус 2 (Попанельная детальная цепочка):
    const topPanelSegments: { start: number; end: number; label: string }[] = [];
    const sortedPanels = [...layout.panels].filter((p) => !p.isVoid).sort((a, b) => a.x - b.x);

    const colMap = new Map<number, { minX: number; maxX: number; width: number }>();
    sortedPanels.forEach((p) => {
      const xKey = Math.round(p.x);
      const existing = colMap.get(xKey);
      if (!existing) {
        colMap.set(xKey, { minX: p.x, maxX: p.x + p.width, width: p.width });
      } else {
        existing.maxX = Math.max(existing.maxX, p.x + p.width);
        existing.width = existing.maxX - existing.minX;
      }
    });

    const uniqueCols = Array.from(colMap.values()).sort((a, b) => a.minX - b.minX);
    uniqueCols.forEach((col) => {
      topPanelSegments.push({
        start: col.minX,
        end: col.maxX,
        label: `${Math.round(col.width)}`,
      });
    });

    if (topPanelSegments.length > 1) {
      const topDetailY = originY - 30;
      this.drawArchitecturalChain(
        ctx,
        originX,
        originY,
        scale,
        wall.height,
        topPanelSegments,
        'HORIZONTAL',
        topDetailY
      );
    }

    // 5.3. Нижний ярус: Цепочка привязки проемов (двери, окна, ниши)
    if (wall.openings && wall.openings.length > 0) {
      const bottomOpeningSegments: { start: number; end: number; label: string; subLabel?: string }[] = [];
      const sortedOpenings = [...wall.openings].sort((a, b) => a.x - b.x);

      let currX = 0;
      sortedOpenings.forEach((op) => {
        if (op.x > currX + 5) {
          bottomOpeningSegments.push({
            start: currX,
            end: op.x,
            label: `${Math.round(op.x - currX)}`,
          });
        }
        const opLabel = op.type === 'DOOR' ? 'Дверь' : op.type === 'WINDOW' ? 'Окно' : op.type === 'TV_ZONE' ? 'ТВ-зона' : 'Ниша';
        bottomOpeningSegments.push({
          start: op.x,
          end: op.x + op.width,
          label: `${Math.round(op.width)}`,
          subLabel: opLabel,
        });
        currX = op.x + op.width;
      });

      if (currX < wall.width - 5) {
        bottomOpeningSegments.push({
          start: currX,
          end: wall.width,
          label: `${Math.round(wall.width - currX)}`,
        });
      }

      const bottomChainY = originY + wall.height * scale + 45;
      this.drawArchitecturalChain(
        ctx,
        originX,
        originY,
        scale,
        wall.height,
        bottomOpeningSegments,
        'HORIZONTAL',
        bottomChainY
      );
    }

    // 5.4. Правый габарит стены (Общая высота)
    const rightOverallX = originX + wall.width * scale + 65;
    this.drawArchitecturalDimLine(
      ctx,
      originX + wall.width * scale,
      originY,
      originX + wall.width * scale,
      originY + wall.height * scale,
      rightOverallX,
      'VERTICAL',
      `${wall.height} мм`
    );

    // 5.5. Левый ярус: Высотные отметки и уровни проемов / горизонтальных сегментов
    const leftHeightSegments: { start: number; end: number; label: string }[] = [];
    const mainOpening = wall.openings.find((op) => op.isCutout !== false);

    if (mainOpening) {
      if (mainOpening.y > 5) {
        leftHeightSegments.push({
          start: 0,
          end: mainOpening.y,
          label: `${Math.round(mainOpening.y)}`,
        });
      }
      leftHeightSegments.push({
        start: mainOpening.y,
        end: mainOpening.y + mainOpening.height,
        label: `${Math.round(mainOpening.height)}`,
      });
      if (wall.height - (mainOpening.y + mainOpening.height) > 5) {
        leftHeightSegments.push({
          start: mainOpening.y + mainOpening.height,
          end: wall.height,
          label: `${Math.round(wall.height - (mainOpening.y + mainOpening.height))}`,
        });
      }
    } else {
      const horizJoints = layout.joints.filter((j) => j.orientation === 'HORIZONTAL' && (j.width > 0 || j.isLED));
      if (horizJoints.length > 0) {
        let lastY = 0;
        const sortedY = Array.from(new Set(horizJoints.map((j) => Math.round(j.y)))).sort((a, b) => a - b);
        sortedY.forEach((hy) => {
          if (hy > lastY + 5) {
            leftHeightSegments.push({
              start: lastY,
              end: hy,
              label: `${Math.round(hy - lastY)}`,
            });
            lastY = hy;
          }
        });
        if (wall.height > lastY + 5) {
          leftHeightSegments.push({
            start: lastY,
            end: wall.height,
            label: `${Math.round(wall.height - lastY)}`,
          });
        }
      }
    }

    if (leftHeightSegments.length > 1) {
      const leftChainX = originX - 55;
      this.drawArchitecturalChain(
        ctx,
        originX,
        originY,
        scale,
        wall.height,
        leftHeightSegments,
        'VERTICAL',
        leftChainX
      );
    }

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
    segments: { start: number; end: number; label: string; subLabel?: string }[],
    orientation: 'HORIZONTAL' | 'VERTICAL',
    offsetCoord: number
  ): void {
    if (segments.length === 0) return;

    ctx.save();
    ctx.strokeStyle = '#475569';
    ctx.fillStyle = '#0f172a';
    ctx.lineWidth = 1.6;
    const tick = 8;

    if (orientation === 'HORIZONTAL') {
      const dimY = offsetCoord;
      const minVal = Math.min(...segments.map((s) => s.start));
      const maxVal = Math.max(...segments.map((s) => s.end));

      // Общая линия цепочки
      ctx.beginPath();
      ctx.moveTo(originX + minVal * scale - 10, dimY);
      ctx.lineTo(originX + maxVal * scale + 10, dimY);
      ctx.stroke();

      segments.forEach((seg) => {
        const sx = originX + seg.start * scale;
        const ex = originX + seg.end * scale;

        // Выносные линии
        ctx.beginPath();
        if (dimY < originY) {
          ctx.moveTo(sx, originY - 6);
          ctx.lineTo(sx, dimY - 8);
          ctx.moveTo(ex, originY - 6);
          ctx.lineTo(ex, dimY - 8);
        } else {
          ctx.moveTo(sx, originY + wallHeight * scale + 6);
          ctx.lineTo(sx, dimY + 8);
          ctx.moveTo(ex, originY + wallHeight * scale + 6);
          ctx.lineTo(ex, dimY + 8);
        }
        ctx.stroke();

        // Засечки 45°
        ctx.beginPath();
        ctx.moveTo(sx - tick, dimY + tick);
        ctx.lineTo(sx + tick, dimY - tick);
        ctx.moveTo(ex - tick, dimY + tick);
        ctx.lineTo(ex + tick, dimY - tick);
        ctx.stroke();

        // Размерный текст
        ctx.textAlign = 'center';
        if (dimY < originY) {
          ctx.textBaseline = 'bottom';
          ctx.font = 'bold 18px "Segoe UI", Arial, sans-serif';
          ctx.fillText(seg.label, (sx + ex) / 2, dimY - 4);
          if (seg.subLabel) {
            ctx.font = '13px "Segoe UI", Arial, sans-serif';
            ctx.fillStyle = '#64748b';
            ctx.fillText(seg.subLabel, (sx + ex) / 2, dimY - 24);
            ctx.fillStyle = '#0f172a';
          }
        } else {
          ctx.textBaseline = 'top';
          ctx.font = 'bold 18px "Segoe UI", Arial, sans-serif';
          ctx.fillText(seg.label, (sx + ex) / 2, dimY + 4);
          if (seg.subLabel) {
            ctx.font = '13px "Segoe UI", Arial, sans-serif';
            ctx.fillStyle = '#64748b';
            ctx.fillText(seg.subLabel, (sx + ex) / 2, dimY + 24);
            ctx.fillStyle = '#0f172a';
          }
        }
      });
    } else {
      const dimX = offsetCoord;
      const minVal = Math.min(...segments.map((s) => s.start));
      const maxVal = Math.max(...segments.map((s) => s.end));

      const topY = originY + (wallHeight - maxVal) * scale;
      const botY = originY + (wallHeight - minVal) * scale;

      ctx.beginPath();
      ctx.moveTo(dimX, topY - 10);
      ctx.lineTo(dimX, botY + 10);
      ctx.stroke();

      segments.forEach((seg) => {
        const sy = originY + (wallHeight - seg.start) * scale;
        const ey = originY + (wallHeight - seg.end) * scale;

        // Выносные линии
        ctx.beginPath();
        if (dimX < originX) {
          ctx.moveTo(originX - 6, sy);
          ctx.lineTo(dimX - 8, sy);
          ctx.moveTo(originX - 6, ey);
          ctx.lineTo(dimX - 8, ey);
        } else {
          ctx.moveTo(originX + wallHeight * scale + 6, sy);
          ctx.lineTo(dimX + 8, sy);
          ctx.moveTo(originX + wallHeight * scale + 6, ey);
          ctx.lineTo(dimX + 8, ey);
        }
        ctx.stroke();

        // Засечки 45°
        ctx.beginPath();
        ctx.moveTo(dimX - tick, sy + tick);
        ctx.lineTo(dimX + tick, sy - tick);
        ctx.moveTo(dimX - tick, ey + tick);
        ctx.lineTo(dimX + tick, ey - tick);
        ctx.stroke();

        // Повернутый текст
        ctx.save();
        ctx.translate(dimX - 18, (sy + ey) / 2);
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
    ctx.strokeStyle = '#475569';
    ctx.fillStyle = '#0f172a';
    ctx.lineWidth = 1.8;

    const tick = 10;

    if (orientation === 'HORIZONTAL') {
      const dimY = offsetCoord;
      ctx.beginPath();
      ctx.moveTo(x1, y1 - 8);
      ctx.lineTo(x1, dimY - 10);
      ctx.moveTo(x2, y2 - 8);
      ctx.lineTo(x2, dimY - 10);
      ctx.moveTo(x1 - 10, dimY);
      ctx.lineTo(x2 + 10, dimY);
      ctx.moveTo(x1 - tick, dimY + tick);
      ctx.lineTo(x1 + tick, dimY - tick);
      ctx.moveTo(x2 - tick, dimY + tick);
      ctx.lineTo(x2 + tick, dimY - tick);
      ctx.stroke();

      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.font = 'bold 20px "Segoe UI", Arial, sans-serif';
      ctx.fillText(label, (x1 + x2) / 2, dimY - 5);
    } else {
      const dimX = offsetCoord;
      ctx.beginPath();
      ctx.moveTo(x1 + 8, y1);
      ctx.lineTo(dimX + 10, y1);
      ctx.moveTo(x2 + 8, y2);
      ctx.lineTo(dimX + 10, y2);
      ctx.moveTo(dimX, y1 - 10);
      ctx.lineTo(dimX, y2 + 10);
      ctx.moveTo(dimX - tick, y1 + tick);
      ctx.lineTo(dimX + tick, y1 - tick);
      ctx.moveTo(dimX - tick, y2 + tick);
      ctx.lineTo(dimX + tick, y2 - tick);
      ctx.stroke();

      ctx.translate(dimX + 24, (y1 + y2) / 2);
      ctx.rotate(Math.PI / 2);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.font = 'bold 20px "Segoe UI", Arial, sans-serif';
      ctx.fillText(label, 0, 0);
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
    boxH: number
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

    const count = Math.min(sheetsWithNotes.length, 6);
    const cols = Math.min(count, 5);
    const rows = Math.ceil(count / cols);

    const cellW = boxW / cols;
    const cellH = boxH / rows;

    sheetsWithNotes.slice(0, count).forEach((item, idx) => {
      const sheet = item.sheet;
      const otherWallNames = item.otherWallNames;

      const col = idx % cols;
      const row = Math.floor(idx / cols);

      const cellX = boxX + col * cellW;
      const cellY = boxY + row * cellH;

      ctx.save();
      // Заголовок листа
      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 22px "Segoe UI", Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(sheet.sheetLabel, cellX + cellW / 2, cellY + 28);

      ctx.font = '16px "Segoe UI", Arial, sans-serif';
      ctx.fillStyle = '#64748b';
      ctx.fillText(`1220 × 2800 • Исп: ${sheet.efficiencyPct}%`, cellX + cellW / 2, cellY + 52);

      // Масштабирование листа в ячейку (оставляем место снизу под пометку других стен)
      const pad = 25;
      const sAvailW = cellW - pad * 2;
      const sAvailH = cellH - 100;

      const scale = Math.min(sAvailW / sheet.sheetWidth, sAvailH / sheet.sheetHeight, 0.23);
      const sheetOriginX = cellX + (cellW - sheet.sheetWidth * scale) / 2;
      const sheetOriginY = cellY + 62;

      // Тело листа (благородный песочный цвет плиты AllWall)
      ctx.fillStyle = '#fef3c7';
      ctx.fillRect(sheetOriginX, sheetOriginY, sheet.sheetWidth * scale, sheet.sheetHeight * scale);
      ctx.strokeStyle = '#78350f';
      ctx.lineWidth = 2.5;
      ctx.strokeRect(sheetOriginX, sheetOriginY, sheet.sheetWidth * scale, sheet.sheetHeight * scale);

      // Размещенные детали на листе
      sheet.placedParts.forEach((p) => {
        const px = sheetOriginX + p.x * scale;
        const py = sheetOriginY + (sheet.sheetHeight - (p.y + p.height)) * scale;
        const pw = p.width * scale;
        const ph = p.height * scale;

        const isCurrentWall = p.part.wallId === currentWallId;

        // Если деталь относится к другой стене — подсвечиваем индиго-оттенком
        ctx.fillStyle = isCurrentWall ? (p.part.color || '#fde68a') : '#e0e7ff';
        ctx.fillRect(px, py, pw, ph);
        ctx.strokeStyle = isCurrentWall ? '#b45309' : '#4338ca';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(px, py, pw, ph);

        // ВЫРЕЗЫ ВНУТРИ ДЕТАЛИ (двери, окна, ниши) с подробными размерными выносками
        let hasBottomDoorCutout = false;
        let doorCutoutTopCanvasY = 0;

        if (p.part.cutouts && p.part.cutouts.length > 0) {
          p.part.cutouts.forEach((cut) => {
            const cutX = px + cut.x * scale;
            const cutY = py + (p.height - (cut.y + cut.height)) * scale;
            const cutW = cut.width * scale;
            const cutH = cut.height * scale;

            const leftStripW = cut.x;
            const rightStripW = Math.max(0, p.width - (cut.x + cut.width));
            const transomH = Math.max(0, p.height - (cut.y + cut.height));

            if (cut.y <= 10) {
              hasBottomDoorCutout = true;
              doorCutoutTopCanvasY = cutY;
            }

            // 1. Отрисовка отверстия выреза (светлый фон + штриховка)
            ctx.fillStyle = '#f8fafc';
            ctx.fillRect(cutX, cutY, cutW, cutH);
            ctx.strokeStyle = '#94a3b8';
            ctx.lineWidth = 1.2;
            ctx.strokeRect(cutX, cutY, cutW, cutH);

            // 2. Линии реза по периметру выреза (яркий красный пунктир)
            ctx.save();
            ctx.strokeStyle = '#dc2626';
            ctx.lineWidth = 1.8;
            ctx.setLineDash([5, 3]);
            ctx.strokeRect(cutX, cutY, cutW, cutH);
            ctx.restore();

            // 3. Подпись выреза и остатка
            if (cutW > 30 && cutH > 25) {
              ctx.fillStyle = '#1e293b';
              ctx.font = 'bold 12px "Segoe UI", Arial, sans-serif';
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText(cut.label || 'Вырез двери', cutX + cutW / 2, cutY + cutH / 2 - 8);

              ctx.font = '10px "Segoe UI", Arial, sans-serif';
              ctx.fillStyle = '#64748b';
              ctx.fillText(`${Math.round(cut.width)}×${Math.round(cut.height)} (Остаток)`, cutX + cutW / 2, cutY + cutH / 2 + 8);
            }

            // 4. ВЫНОСКИ РАЗМЕРОВ РАСПИЛА ДЛЯ ЦЕХА:
            // 4.1. Расстояние от левого края панели до начала выреза двери
            if (leftStripW > 5 && (px + cutX) / 2) {
              const leftDimX = px + (cutX - px) / 2;
              ctx.save();
              ctx.fillStyle = '#b45309';
              ctx.font = 'bold 11px "Segoe UI", Arial, sans-serif';
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText(`${Math.round(leftStripW)}`, leftDimX, cutY + cutH - 12);
              ctx.restore();
            }

            // 4.2. Расстояние от правого края выреза до правого края панели
            if (rightStripW > 5) {
              const rightDimX = cutX + cutW + (px + pw - (cutX + cutW)) / 2;
              ctx.save();
              ctx.fillStyle = '#b45309';
              ctx.font = 'bold 11px "Segoe UI", Arial, sans-serif';
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText(`${Math.round(rightStripW)}`, rightDimX, cutY + cutH - 12);
              ctx.restore();
            }

            // 4.3. Высота фрамуги над вырезом
            if (transomH > 10) {
              ctx.save();
              ctx.fillStyle = '#475569';
              ctx.font = 'bold 11px "Segoe UI", Arial, sans-serif';
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText(`Фрамуга: ${Math.round(transomH)} мм`, cutX + cutW / 2, py + (cutY - py) / 2 + 14);
              ctx.restore();
            }

            // 4.4. Горизонтальная цепочка размеров внизу выреза (Отступ | Вырез | Отступ)
            const chainY = py + ph + 16;
            ctx.save();
            ctx.strokeStyle = '#dc2626';
            ctx.fillStyle = '#dc2626';
            ctx.lineWidth = 1.2;

            // Стрелка/линия левого отступа
            ctx.beginPath();
            ctx.moveTo(px, chainY);
            ctx.lineTo(cutX, chainY);
            ctx.moveTo(px, chainY - 4);
            ctx.lineTo(px, chainY + 4);
            ctx.moveTo(cutX, chainY - 4);
            ctx.lineTo(cutX, chainY + 4);
            ctx.stroke();

            // Стрелка/линия ширины выреза
            ctx.beginPath();
            ctx.moveTo(cutX, chainY);
            ctx.lineTo(cutX + cutW, chainY);
            ctx.moveTo(cutX + cutW, chainY - 4);
            ctx.lineTo(cutX + cutW, chainY + 4);
            ctx.stroke();

            // Стрелка/линия правого отступа
            ctx.beginPath();
            ctx.moveTo(cutX + cutW, chainY);
            ctx.lineTo(px + pw, chainY);
            ctx.moveTo(px + pw, chainY - 4);
            ctx.lineTo(px + pw, chainY + 4);
            ctx.stroke();

            ctx.font = 'bold 10px "Segoe UI", Arial, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(`${Math.round(leftStripW)}`, px + (cutX - px) / 2, chainY + 2);
            ctx.fillText(`${Math.round(cut.width)}`, cutX + cutW / 2, chainY + 2);
            ctx.fillText(`${Math.round(rightStripW)}`, cutX + cutW + (px + pw - (cutX + cutW)) / 2, chainY + 2);

            ctx.restore();
          });
        }

        // Метка детали
        if (pw > 25 && ph > 20) {
          ctx.fillStyle = isCurrentWall ? '#111827' : '#312e81';
          ctx.font = 'bold 15px "Segoe UI", Arial, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';

          const label = isCurrentWall
            ? (p.part.partLabel || '1.1')
            : `${p.part.partLabel} (${p.part.wallName})`;

          // Если внизу есть вырез двери, размещаем подпись в верхней фрамуге
          const textY = hasBottomDoorCutout && doorCutoutTopCanvasY > py + 25
            ? py + (doorCutoutTopCanvasY - py) / 2 - 4
            : py + ph / 2;

          ctx.fillText(label, px + pw / 2, textY - 8);

          // Размер детали
          ctx.font = '12px "Segoe UI", Arial, sans-serif';
          ctx.fillStyle = isCurrentWall ? '#4b5563' : '#4338ca';
          ctx.fillText(`${Math.round(p.width)}×${Math.round(p.height)}`, px + pw / 2, textY + 12);
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

        ctx.strokeStyle = '#dc2626';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 3]);
        ctx.beginPath();
        ctx.moveTo(cl1.x, cl1.y);
        ctx.lineTo(cl2.x, cl2.y);
        ctx.stroke();
        ctx.setLineDash([]);
      });

      // Деловые обрезки
      sheet.offcuts.forEach((off) => {
        const ox = sheetOriginX + off.x * scale;
        const oy = sheetOriginY + (sheet.sheetHeight - (off.y + off.height)) * scale;
        const ow = off.width * scale;
        const oh = off.height * scale;

        if (ow > 30 && oh > 25) {
          ctx.fillStyle = 'rgba(203, 213, 225, 0.45)';
          ctx.fillRect(ox, oy, ow, oh);
          ctx.fillStyle = '#64748b';
          ctx.font = 'italic 12px "Segoe UI", Arial, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('Остаток', ox + ow / 2, oy + oh / 2);
        }
      });

      // Пометка под листом, если он используется на других стенах
      if (otherWallNames.length > 0) {
        const noteY = sheetOriginY + sheet.sheetHeight * scale + 22;
        const noteText = `📌 Остаток: ${otherWallNames.join(', ')}`;
        ctx.font = 'bold 13px "Segoe UI", Arial, sans-serif';
        const noteW = ctx.measureText(noteText).width;

        ctx.fillStyle = '#fef3c7';
        ctx.beginPath();
        ctx.roundRect(cellX + cellW / 2 - noteW / 2 - 10, noteY - 12, noteW + 20, 24, 6);
        ctx.fill();
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 1.2;
        ctx.stroke();

        ctx.fillStyle = '#92400e';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(noteText, cellX + cellW / 2, noteY);
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
    const defMat = project.materials.find((m) => m.id === wall.zone.materialId) || project.materials[0];
    const layout = LayoutEngine.calculateWallLayout(wall, defMat, project.materials);

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
    ctx.fillText(`Planko 3D Visualization • ${new Date().toLocaleDateString('ru-RU')}`, w - marginX, 2005);
    ctx.restore();
  }

  /**
   * Отрисовка фотореалистичной 3D-сцены стены (Светлая тема)
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

    const cx = boxX + boxW * 0.38;
    const cy = boxY + boxH * 0.72;

    const scale = Math.min(boxW / (wall.width * 1.5), boxH / (wall.height * 1.8), 0.55);

    const project3D = (p: { x: number; y: number; z: number }) => {
      const xRot = p.x * Math.cos(radA) - p.z * Math.sin(radA);
      const zRot = p.x * Math.sin(radA) + p.z * Math.cos(radA);
      const screenX = cx + xRot * scale;
      const screenY = cy - (p.y * Math.cos(radE) - zRot * Math.sin(radE)) * scale;
      return { x: screenX, y: screenY };
    };

    const defMat = project.materials.find((m) => m.id === wall.zone.materialId) || project.materials[0];
    const layout = LayoutEngine.calculateWallLayout(wall, defMat, project.materials);

    // 1. Светлый плиточный пол
    const minX = -600;
    const maxX = wall.width + 600;
    const minZ = -700;
    const maxZ = 1600;

    const f0 = project3D({ x: minX, y: 0, z: minZ });
    const f1 = project3D({ x: maxX, y: 0, z: minZ });
    const f2 = project3D({ x: maxX, y: 0, z: maxZ });
    const f3 = project3D({ x: minX, y: 0, z: maxZ });

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(f0.x, f0.y);
    ctx.lineTo(f1.x, f1.y);
    ctx.lineTo(f2.x, f2.y);
    ctx.lineTo(f3.x, f3.y);
    ctx.closePath();
    ctx.fillStyle = '#f1f5f9'; // Светло-серый чистый пол
    ctx.fill();

    // Сетка плитки пола
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

    // 2. Несущая стена (задняя грань и верхний срез в светлых тонах)
    const wallThick = 150;
    const topF0 = project3D({ x: 0, y: wall.height, z: 0 });
    const topF1 = project3D({ x: wall.width, y: wall.height, z: 0 });
    const topB1 = project3D({ x: wall.width, y: wall.height, z: wallThick });
    const topB0 = project3D({ x: 0, y: wall.height, z: wallThick });

    ctx.save();
    ctx.fillStyle = '#cbd5e1';
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(topF0.x, topF0.y);
    ctx.lineTo(topF1.x, topF1.y);
    ctx.lineTo(topB1.x, topB1.y);
    ctx.lineTo(topB0.x, topB0.y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // 3. Декоративные панели на лицевой грани
    layout.panels.forEach((p) => {
      const isVoid = p.isVoid || p.materialId === MATERIAL_NONE_ID;
      const baseColor = isVoid ? '#f8fafc' : (p.materialColor || '#d6cbbe');
      const thick = isVoid ? 0 : (p.thickness || 8);

      const p0 = project3D({ x: p.x, y: p.y, z: -thick });
      const p1 = project3D({ x: p.x + p.width, y: p.y, z: -thick });
      const p2 = project3D({ x: p.x + p.width, y: p.y + p.height, z: -thick });
      const p3 = project3D({ x: p.x, y: p.y + p.height, z: -thick });

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.lineTo(p3.x, p3.y);
      ctx.closePath();

      ctx.fillStyle = baseColor;
      ctx.fill();
      ctx.strokeStyle = isVoid ? '#e2e8f0' : '#475569';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Текстурные волокна для дерева
      if (!isVoid && p.textureCategory === 'WOOD') {
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.1)';
        ctx.lineWidth = 2;
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
      ctx.restore();
    });

    // 4. Светодиодные линии LED
    layout.joints.forEach((j) => {
      if (j.isLED) {
        const p1 = project3D({ x: j.p1 ? j.p1.x : j.x, y: j.p1 ? j.p1.y : j.y, z: -10 });
        const p2 = project3D({
          x: j.p2 ? j.p2.x : (j.orientation === 'VERTICAL' ? j.x : j.x + j.length),
          y: j.p2 ? j.p2.y : (j.orientation === 'VERTICAL' ? j.y + j.length : j.y),
          z: -10,
        });

        // Неоновое свечение в светлой теме
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

    // 5. Отрисовка проемов (Двери, Окна, ТВ-зоны, Ниши) в 3D
    wall.openings.forEach((op) => {
      const opDepth = op.depth || 150;

      if (op.type === 'DOOR') {
        // 5.1. ДВЕРНОЙ ПРОЕМ И ДВЕРЬ В 3D
        // Левый откос двери (z = -10..opDepth)
        const jL0 = project3D({ x: op.x, y: op.y, z: -10 });
        const jL1 = project3D({ x: op.x, y: op.y, z: opDepth });
        const jL2 = project3D({ x: op.x, y: op.y + op.height, z: opDepth });
        const jL3 = project3D({ x: op.x, y: op.y + op.height, z: -10 });

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

        // Верхний откос двери (соффит)
        const jT0 = jL3;
        const jT1 = jL2;
        const jT2 = project3D({ x: op.x + op.width, y: op.y + op.height, z: opDepth });
        const jT3 = project3D({ x: op.x + op.width, y: op.y + op.height, z: -10 });

        ctx.fillStyle = '#94a3b8';
        ctx.strokeStyle = '#64748b';
        ctx.beginPath();
        ctx.moveTo(jT0.x, jT0.y);
        ctx.lineTo(jT1.x, jT1.y);
        ctx.lineTo(jT2.x, jT2.y);
        ctx.lineTo(jT3.x, jT3.y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Правый откос двери
        const jR0 = jT3;
        const jR1 = jT2;
        const jR2 = project3D({ x: op.x + op.width, y: op.y, z: opDepth });
        const jR3 = project3D({ x: op.x + op.width, y: op.y, z: -10 });

        ctx.fillStyle = '#cbd5e1';
        ctx.strokeStyle = '#94a3b8';
        ctx.beginPath();
        ctx.moveTo(jR0.x, jR0.y);
        ctx.lineTo(jR1.x, jR1.y);
        ctx.lineTo(jR2.x, jR2.y);
        ctx.lineTo(jR3.x, jR3.y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Дверное полотно (в глубине проема z = 60)
        const doorZ = 60;
        const d0 = project3D({ x: op.x + 20, y: op.y, z: doorZ });
        const d1 = project3D({ x: op.x + op.width - 20, y: op.y, z: doorZ });
        const d2 = project3D({ x: op.x + op.width - 20, y: op.y + op.height - 20, z: doorZ });
        const d3 = project3D({ x: op.x + 20, y: op.y + op.height - 20, z: doorZ });

        ctx.fillStyle = '#ffffff'; // Светлое полотно двери скрытого монтажа
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

        // Дверная ручка (черный металл)
        const hStart = project3D({ x: op.x + op.width - 90, y: op.y + 1000, z: doorZ - 10 });
        const hEnd = project3D({ x: op.x + op.width - 45, y: op.y + 1000, z: doorZ - 10 });
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(hStart.x, hStart.y);
        ctx.lineTo(hEnd.x, hEnd.y);
        ctx.stroke();

        ctx.restore();
      } else if (op.type === 'WINDOW') {
        // 5.2. ОКОННЫЙ ПРОЕМ В 3D
        ctx.save();
        const winDepth = 200;
        const wL0 = project3D({ x: op.x, y: op.y, z: -10 });
        const wL1 = project3D({ x: op.x, y: op.y, z: winDepth });
        const wL2 = project3D({ x: op.x, y: op.y + op.height, z: winDepth });
        const wL3 = project3D({ x: op.x, y: op.y + op.height, z: -10 });

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

        // Верхний откос окна
        const wT1 = project3D({ x: op.x + op.width, y: op.y + op.height, z: winDepth });
        const wT2 = project3D({ x: op.x + op.width, y: op.y + op.height, z: -10 });
        ctx.fillStyle = '#94a3b8';
        ctx.beginPath();
        ctx.moveTo(wL3.x, wL3.y);
        ctx.lineTo(wL2.x, wL2.y);
        ctx.lineTo(wT1.x, wT1.y);
        ctx.lineTo(wT2.x, wT2.y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Подоконник
        const sill0 = project3D({ x: op.x - 20, y: op.y, z: -30 });
        const sill1 = project3D({ x: op.x + op.width + 20, y: op.y, z: -30 });
        const sill2 = project3D({ x: op.x + op.width + 20, y: op.y, z: winDepth });
        const sill3 = project3D({ x: op.x - 20, y: op.y, z: winDepth });
        ctx.fillStyle = '#f8fafc';
        ctx.strokeStyle = '#64748b';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(sill0.x, sill0.y);
        ctx.lineTo(sill1.x, sill1.y);
        ctx.lineTo(sill2.x, sill2.y);
        ctx.lineTo(sill3.x, sill3.y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Стеклопакет
        const g0 = project3D({ x: op.x + 20, y: op.y + 15, z: 100 });
        const g1 = project3D({ x: op.x + op.width - 20, y: op.y + 15, z: 100 });
        const g2 = project3D({ x: op.x + op.width - 20, y: op.y + op.height - 20, z: 100 });
        const g3 = project3D({ x: op.x + 20, y: op.y + op.height - 20, z: 100 });
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

        // Импост (рама окна)
        const imp0 = project3D({ x: op.x + op.width / 2, y: op.y + 15, z: 100 });
        const imp1 = project3D({ x: op.x + op.width / 2, y: op.y + op.height - 20, z: 100 });
        ctx.strokeStyle = '#0284c7';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(imp0.x, imp0.y);
        ctx.lineTo(imp1.x, imp1.y);
        ctx.stroke();

        ctx.restore();
      } else if (op.type === 'TV_ZONE') {
        // 5.3. ТВ-ЗОНА В 3D
        ctx.save();
        const tvZ = -30;
        const t0 = project3D({ x: op.x, y: op.y, z: tvZ });
        const t1 = project3D({ x: op.x + op.width, y: op.y, z: tvZ });
        const t2 = project3D({ x: op.x + op.width, y: op.y + op.height, z: tvZ });
        const t3 = project3D({ x: op.x, y: op.y + op.height, z: tvZ });

        // Корпус ТВ
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

        // Глянцевый экран с бликом
        ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.beginPath();
        ctx.moveTo(t0.x, t0.y);
        ctx.lineTo(t1.x, t1.y);
        ctx.lineTo(t3.x, t3.y);
        ctx.closePath();
        ctx.fill();

        ctx.restore();
      } else {
        // 5.4. НИША В 3D
        ctx.save();
        const nDepth = opDepth;
        const nL0 = project3D({ x: op.x, y: op.y, z: -10 });
        const nL1 = project3D({ x: op.x, y: op.y, z: nDepth });
        const nL2 = project3D({ x: op.x, y: op.y + op.height, z: nDepth });
        const nL3 = project3D({ x: op.x, y: op.y + op.height, z: -10 });

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

        // Задняя стенка ниши
        const nBack0 = nL1;
        const nBack1 = project3D({ x: op.x + op.width, y: op.y, z: nDepth });
        const nBack2 = project3D({ x: op.x + op.width, y: op.y + op.height, z: nDepth });
        const nBack3 = nL2;

        ctx.fillStyle = '#e2e8f0';
        ctx.beginPath();
        ctx.moveTo(nBack0.x, nBack0.y);
        ctx.lineTo(nBack1.x, nBack1.y);
        ctx.lineTo(nBack2.x, nBack2.y);
        ctx.lineTo(nBack3.x, nBack3.y);
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
      { title: 'ПОГОНАЖ ПРОФИЛЕЙ', val: `${profiles.totalLinearMeters} м`, sub: `Хлыстов 3м (+10%): ${profiles.totalStockBars} шт.` },
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
      Math.round(totalAvailW * 0.34),
      Math.round(totalAvailW * 0.18),
      Math.round(totalAvailW * 0.14),
      Math.round(totalAvailW * 0.11),
      Math.round(totalAvailW * 0.11),
      Math.round(totalAvailW * 0.12),
    ];

    this.drawTable(
      ctx,
      marginX,
      tbl2Y,
      totalAvailW,
      ['Тип профиля', 'Артикул AllWall', 'Видимая ширина', 'Погонаж', 'Запас 10%', 'Хлыстов 3м'],
      profiles.byCategorySummary.map((p) => [
        p.name,
        p.article,
        `${PROFILE_CATEGORIES_INFO[p.category].defaultWidth} мм`,
        `${p.totalLinearMeters} м`,
        `${(p.totalLinearMeters * 1.10).toFixed(1)} м`,
        `${p.stockBarsCount} шт.`,
      ]),
      colW2
    );

    // 4. Памятка монтажникам
    const noteY = 1600;
    ctx.save();
    ctx.fillStyle = '#eff6ff';
    ctx.beginPath();
    ctx.roundRect(marginX, noteY, totalAvailW, 300, 16);
    ctx.fill();
    ctx.strokeStyle = '#bfdbfe';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#1e40af';
    ctx.font = 'bold 24px "Segoe UI", Arial, sans-serif';
    ctx.fillText('ТЕХНИЧЕСКИЙ РЕГЛАМЕНТ МОНТАЖА ALLWALL:', marginX + 30, noteY + 50);

    ctx.fillStyle = '#1e3a8a';
    ctx.font = '20px "Segoe UI", Arial, sans-serif';
    ctx.fillText('• Стандартная длина всех металлических хлыстов профилей составляет 3000 мм (3 метра).', marginX + 30, noteY + 95);
    ctx.fillText('• Соединительный профиль (H-стык): видимая ширина 0.8 мм — обеспечивает тонкий эстетичный шов.', marginX + 30, noteY + 135);
    ctx.fillText('• Светодиодный LED-профиль: видимая ширина 10 мм — укомплектован светорассеивателем для RGB ленты.', marginX + 30, noteY + 175);
    ctx.fillText('• Торцевые профили устанавливаются по периметру открытых краев, дверных коробок и оконных порталов.', marginX + 30, noteY + 215);
    ctx.fillText('• Рекомендуемый запас на угловую подрезку и торцевание составляет 10% (учтен в колонке "Хлыстов 3м").', marginX + 30, noteY + 255);
    ctx.restore();

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

    const defMat = project.materials.find((m) => m.id === wall.zone.materialId) || project.materials[0];
    const layout = LayoutEngine.calculateWallLayout(wall, defMat, project.materials);

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

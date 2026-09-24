import { drawOpeningSlopes } from './SlopeDrawing';
import { slopeJointHasProfile } from '../../core/geometry/SlopeJointGeometry';
import { getPieceTexture } from '../../core/textures/PieceTextures';
import { drawTextureFace } from '../../core/textures/PhotoTextures';
import { slopeTexturePiece } from '../../core/textures/TextureMapping';
import { jsPDF } from 'jspdf';
import { Project } from '../../core/models/Project';
import { getOpeningTypeLabel } from '../../core/models/Opening';
import { Wall, RadiusType } from '../../core/models/Wall';
import { LayoutEngine, LayoutCalculationResult } from '../../core/layout/LayoutEngine';
import { NestingEngine, NestingPartInput, ProjectNestingResult, NestingSheet, NestingCutout } from '../../core/layout/NestingEngine';
import { ProfileSpecificationEngine, ProjectProfilesReport, WallProfilesReport } from '../../core/layout/ProfileSpecificationEngine';
import { MATERIAL_NONE_ID, Material } from '../../core/models/Material';
import { Point2D } from '../../core/geometry/PolygonSlicingEngine';
import { dimensionText } from './PartDrawing';
import { packStocks, planPanelPages, PanelPageLayout, STOCK_PADDING, WALL_PADDING } from './PanelPageLayout';
import { boxPolygon, drawPartBadges, PartBadge } from './PartBadges';
import { buildCuttingDetails, CuttingDetailPage, planCuttingDetailPages, renderCuttingDetailPage } from './CuttingDetails';

export class PdfExportService {
  private static fitsMaterial(width: number, height: number, material?: Material): boolean {
    return NestingEngine.fitsStock(width, height, material?.width, material?.height, material?.type);
  }

  private static collectCuttingParts(project: Project): NestingPartInput[] {
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
                label: op.type === 'DOOR' ? `Вырез ${op.isPortal ? 'портала' : 'двери'} ${op.width}×${op.height}` : `Вырез ${op.width}×${op.height}`,
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
            materialType: mat?.type,
            stockWidth: mat?.width,
            stockHeight: mat?.height,
            materialName: mat?.name || p.decorName || 'Панель AllWall',
            decorCode: p.decorCode,
            textureCategory: p.textureCategory,
            x: p.x,
            y: p.y,
            textureMapping: p.textureMapping,
            patternAngleDeg: p.patternAngleDeg,
            patternFlipX: p.patternFlipX,
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
            width: slopeTexturePiece(sl).width,
            height: slopeTexturePiece(sl).height,
            textureCategory: sl.textureCategory,
            textureMapping: sl.textureMapping,
            areaSqM: sl.areaSqM,
            materialId: sl.materialId,
            materialType: slMat?.type,
            stockWidth: slMat?.width,
            stockHeight: slMat?.height,
            materialName: sl.materialName || slMat?.name,
            decorCode: sl.decorCode || slMat?.decorCode,
            color: sl.materialColor || slMat?.color,
            thickness: sl.thickness || slMat?.thickness || 5,
            note: `${sl.openingName} (${sl.sideLabel})`,
          });
        });
      }
    });

    return allPartsForNesting;
  }

  /**
   * 1. Экспорт клиентской раскладки панелей и карт раскроя листов 1220x2800
   */
  public static async exportPanelsLayoutPdf(project: Project): Promise<void> {
    const pdf = new jsPDF({
      orientation: 'landscape',
      unit: 'mm',
      format: 'a4', // 297 x 210 mm
    });

    const allPartsForNesting = this.collectCuttingParts(project);

    // Рассчитываем оптимальный раскрой
    const nestingResult: ProjectNestingResult = NestingEngine.optimizeProjectNesting(allPartsForNesting, undefined, undefined, project.materials);
    const pages = project.walls.flatMap(wall => {
      const sheets = this.sheetsForWall(project, wall, nestingResult).owned;
      return planPanelPages(wall, sheets.map(item => item.sheet)).map(composition => ({ wall, composition }));
    });
    const totalPages = pages.length;
    for (let index = 0; index < pages.length; index++) {
      if (index > 0) pdf.addPage('a4', 'landscape');
      const canvas = document.createElement('canvas');
      canvas.width = 2970;
      canvas.height = 2100;
      this.renderPanelLayoutPage(canvas.getContext('2d')!, canvas.width, canvas.height,
        project, pages[index].wall, nestingResult, index + 1, totalPages, pages[index].composition);
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, 297, 210);
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

    const allParts = this.collectCuttingParts(project);

    const nestingResult: ProjectNestingResult = NestingEngine.optimizeProjectNesting(allParts, undefined, undefined, project.materials);

    // Variants and finishes create more rows than the old category-only report.
    const coverPageCount = Math.max(1, Math.ceil(projectProfiles.byCategorySummary.length / 16));
    const wallPages = project.walls.flatMap((wall) => {
      const report = projectProfiles.wallReports.find((r) => r.wallId === wall.id)!;
      return Array.from({ length: Math.max(1, Math.ceil(report.items.length / 8)) }, (_, index) => ({
        wall, report: { ...report, items: report.items.slice(index * 8, (index + 1) * 8) },
      }));
    });
    const totalPages = coverPageCount + wallPages.length;
    for (let index = 0; index < coverPageCount; index++) {
      if (index > 0) pdf.addPage('a4', 'landscape');
      const canvas = document.createElement('canvas');
      canvas.width = 2970;
      canvas.height = 2100;
      this.renderInstallerCoverPage(canvas.getContext('2d')!, canvas.width, canvas.height, project, nestingResult, {
        ...projectProfiles, byCategorySummary: projectProfiles.byCategorySummary.slice(index * 16, (index + 1) * 16),
      }, index + 1, totalPages);
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, 297, 210);
    }
    wallPages.forEach(({ wall, report }, index) => {
      pdf.addPage('a4', 'landscape');
      const canvas = document.createElement('canvas');
      canvas.width = 2970;
      canvas.height = 2100;
      this.renderInstallerWallPage(canvas.getContext('2d')!, canvas.width, canvas.height, project, wall, report, coverPageCount + index + 1, totalPages);
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, 297, 210);
    });

    const filename = `${project.name || 'Проект'}_Монтажная_Спецификация.pdf`;
    pdf.save(filename);
  }

  /** 4. Отдельные чертежи деталей с размерами для изготовления. */
  public static async exportCuttingDetailsPdf(project: Project): Promise<void> {
    const parts = this.collectCuttingParts(project);
    if (!parts.length) throw new Error('Нет деталей для раскроя. Назначьте материал панелям или откосам.');
    const nesting = NestingEngine.optimizeProjectNesting(parts, undefined, undefined, project.materials);
    const pages = planCuttingDetailPages(buildCuttingDetails(parts, nesting));
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    pages.forEach((page, index) => {
      if (index > 0) pdf.addPage('a4', 'landscape');
      const canvas = document.createElement('canvas'); canvas.width = 2970; canvas.height = 2100;
      this.renderCuttingDetailsPage(canvas.getContext('2d')!, canvas.width, canvas.height, page, index + 1, pages.length);
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, 297, 210);
    });
    pdf.save(`${project.name || 'Проект'}_Детали_для_раскроя.pdf`);
  }

  private static renderCuttingDetailsPage(ctx: CanvasRenderingContext2D, w: number, h: number,
    page: CuttingDetailPage, number: number, total: number): void {
    renderCuttingDetailPage(ctx, w, h, page, number, total);
  }

  // ===========================================================================
  // ГРАФИЧЕСКИЙ РЕНДЕРИНГ СТРАНИЦ (Умная адаптивная компоновка для максимального размера)
  // ===========================================================================

  /**
   * Отрисовка страницы плана раскладки стены и карт раскроя с умной адаптивной компоновкой
   */
  private static sheetsForWall(project: Project, wall: Wall, nesting: ProjectNestingResult) {
    const owned: { sheet: NestingSheet; otherWallNames: string[] }[] = [];
    const borrowed: NestingSheet[] = [];
    nesting.allSheets.forEach(sheet => {
      const walls = new Set(sheet.placedParts.map(p => p.part.wallId));
      if (!walls.has(wall.id)) return;
      if (project.walls.find(w => walls.has(w.id))?.id === wall.id) {
        owned.push({ sheet, otherWallNames: [...new Set(sheet.placedParts.filter(p => p.part.wallId !== wall.id).map(p => p.part.wallName))] });
      } else borrowed.push(sheet);
    });
    return { owned, borrowed };
  }

  private static renderPanelLayoutPage(
    ctx: CanvasRenderingContext2D, w: number, h: number, project: Project, wall: Wall,
    nesting: ProjectNestingResult, pageNumber: number, totalPages: number, composition?: PanelPageLayout
  ): void {
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
    const { owned, borrowed } = this.sheetsForWall(project, wall, nesting);
    const page = composition ?? planPanelPages(wall, owned.map(item => item.sheet), w, h)[0];
    ctx.save();
    ctx.fillStyle = '#0f172a'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.font = '30px "Segoe UI", Arial, sans-serif';
    ctx.fillText(`${wall.name} — ${page.wall ? 'Раскладка панелей' : 'Раскрой'}`, 60, 53, w - 120);
    if (page.wall) {
      const wallNumber = Math.max(1, project.walls.findIndex(w => w.id === wall.id) + 1);
      const material = project.materials.find(m => m.id === wall.zone.materialId) || project.materials[0];
      const layout = LayoutEngine.calculateWallLayout(wall, material, project.materials, wallNumber);
      this.drawWall2DOnCanvas(ctx, wall, layout, page.wall.x, page.wall.y, page.wall.width, page.wall.height, true, project.materials, true);
    }
    // Explicit boxes preserve the shared stock scale and the ordering across pages.
    for (const stock of page.stocks) {
      this.drawNestingSheetsOnCanvas(ctx, [owned[stock.index]], [], wall.id,
        stock.x, stock.y, stock.width, stock.height);
    }
    ctx.fillStyle = '#64748b'; ctx.font = '18px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'left';
    const refs = borrowed.map(sheet => sheet.sheetLabel).join(', ');
    ctx.fillText(refs ? `${project.name || ''} · См. также: ${refs}` : project.name || '', 60, h - 32, w - 330);
    ctx.textAlign = 'right'; ctx.fillText(`${pageNumber} / ${totalPages}`, w - 60, h - 32);
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
    showMaterials: boolean = true,
    materials: Material[] = [],
    compact: boolean = false
  ): void {
    const padX = compact ? WALL_PADDING.x : 180;
    const padY = compact ? WALL_PADDING.y : 95;
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

    const panelBadges: PartBadge[] = [];
    let hasUnplaceableParts = false;
    const openingCutouts = wall.openings.filter(op => op.isCutout !== false).map(op => {
      const topLeft = toC(op.x, op.y + op.height);
      return boxPolygon({ ...topLeft, width: op.width * scale, height: op.height * scale });
    });
    // 2. Панели стены
    layout.panels.forEach((p, pIdx) => {
      const isVoid = p.isVoid || p.materialId === MATERIAL_NONE_ID;
      const cannotPlace = !isVoid && !this.fitsMaterial(p.width, p.height, materials.find((m) => m.id === p.materialId));
      hasUnplaceableParts ||= cannotPlace;
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
      if (cannotPlace) ctx.fillStyle = '#ffe4e6';
      ctx.fill();

      ctx.strokeStyle = cannotPlace ? '#e11d48' : '#475569';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();

      if (!isVoid) panelBadges.push({
        text: p.partLabel && p.partLabel !== 'ПУСТО' ? p.partLabel : `${wall.name.match(/\d+/)?.[0] || '1'}.${pIdx + 1}`,
        polygon: pts, cutouts: openingCutouts, invalid: cannotPlace,
      });
    });

    // 2.2. Размеры и углы диагональных срезов на чертеже стены
    if (!compact) layout.panels.forEach((p) => {
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
        if (compact) {
          ctx.fillStyle = 'rgba(2, 132, 199, 0.08)';
          if (bendW > 0) ctx.fillRect(bendX, originY, bendW, wall.height * scale);
          ctx.strokeStyle = '#0284c7'; ctx.lineWidth = 2; ctx.setLineDash([8, 6]);
          ctx.beginPath(); ctx.moveTo(bendX, originY); ctx.lineTo(bendX, originY + wall.height * scale);
          if (bendW > 0) { ctx.moveTo(bendX + bendW, originY); ctx.lineTo(bendX + bendW, originY + wall.height * scale); }
          ctx.stroke(); ctx.restore(); return;
        }
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
        if (op.isPortal) {
          ctx.beginPath();
          ctx.moveTo(opTopLeft.x, opTopLeft.y + opH);
          ctx.lineTo(opTopLeft.x, opTopLeft.y);
          ctx.lineTo(opTopLeft.x + opW, opTopLeft.y);
          ctx.lineTo(opTopLeft.x + opW, opTopLeft.y + opH);
          ctx.stroke();
        } else {
          ctx.strokeRect(opTopLeft.x, opTopLeft.y, opW, opH);

          // Внутренний дверной контур
          ctx.strokeStyle = '#cbd5e1';
          ctx.lineWidth = 2;
          ctx.strokeRect(opTopLeft.x + 8, opTopLeft.y + 8, opW - 16, opH - 8);
        }
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

      const typeLabel = getOpeningTypeLabel(op);
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
          const slope = layout.slopes?.find((s) => s.partLabel === partLabel);
          const cannotPlace = !!slope && !this.fitsMaterial(slope.width, slope.depth, materials.find((m) => m.id === slope.materialId));
          hasUnplaceableParts ||= cannotPlace;
          if (compact) {
            if (cannotPlace) {
              ctx.fillStyle = '#e11d48'; ctx.fillRect(boxCenterX - 85, boxCenterY - 26, 170, 52);
              ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
              ctx.font = 'bold 20px "Segoe UI", Arial, sans-serif'; ctx.fillText(partLabel, boxCenterX, boxCenterY - 10);
              ctx.font = '16px "Segoe UI", Arial, sans-serif'; ctx.fillText('Нельзя разместить', boxCenterX, boxCenterY + 12);
            } else {
              drawPartBadges(ctx, [{ text: partLabel, polygon: boxPolygon({ x: boxCenterX - 34, y: boxCenterY - 18, width: 68, height: 36 }) }],
                { x: boxCenterX - 40, y: boxCenterY - 25, width: 80, height: 50 });
            }
            ctx.strokeStyle = cannotPlace ? '#e11d48' : '#475569'; ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(boxCenterX + (dir === 'LEFT' ? -34 : dir === 'RIGHT' ? 34 : 0), boxCenterY + (dir === 'TOP' ? -18 : dir === 'BOTTOM' ? 18 : 0));
            ctx.lineTo(targetEdgeX, targetEdgeY); ctx.stroke(); ctx.restore(); return;
          }
          ctx.font = 'bold 11px "Segoe UI", Arial, sans-serif';
          const subTextW = ctx.measureText(sideText).width;
          const bw = Math.max(cannotPlace ? 132 : 80, subTextW + 16);
          const bh = cannotPlace ? 62 : 44;
          const bx = boxCenterX - bw / 2;
          const by = boxCenterY - bh / 2;

          // Фон плашки
          ctx.fillStyle = cannotPlace ? '#e11d48' : '#ffffff';
          ctx.fillRect(bx, by, bw, bh);
          ctx.strokeStyle = cannotPlace ? '#be123c' : '#0f172a';
          ctx.lineWidth = 1.8;
          ctx.strokeRect(bx, by, bw, bh);

          // Разделитель
          ctx.beginPath();
          ctx.moveTo(bx, by + 22);
          ctx.lineTo(bx + bw, by + 22);
          ctx.stroke();

          // Верхний текст: Номер откоса (например 1.4)
          ctx.fillStyle = cannotPlace ? '#ffffff' : '#0f172a';
          ctx.font = 'bold 15px "Segoe UI", Arial, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(partLabel, boxCenterX, by + 11);

          // Нижний текст: ОТКОС: 150 мм
          ctx.font = 'bold 11px "Segoe UI", Arial, sans-serif';
          ctx.fillText(sideText, boxCenterX, by + 33);
          if (cannotPlace) ctx.fillText('Нельзя разместить', boxCenterX, by + 51);

          // Линия-указатель к грани
          ctx.strokeStyle = cannotPlace ? '#e11d48' : '#0f172a';
          ctx.lineWidth = cannotPlace ? 4 : 1.5;
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

    for (const joint of layout.slopeJoints ?? []) {
      if (!slopeJointHasProfile(joint)) continue;
      const p = toC(joint.x, joint.y);
      const dx = joint.sides[1] === 'left' ? 1 : -1, dy = joint.sides[0] === 'top' ? 1 : -1;
      ctx.save(); ctx.strokeStyle = joint.isLED ? '#b7791f' : joint.profileColor ?? '#212529'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + dx * 22, p.y + dy * 22); ctx.stroke();
      if (!compact) {
        ctx.fillStyle = '#0f172a'; ctx.font = '11px "Segoe UI", Arial, sans-serif';
        ctx.textAlign = dx > 0 ? 'left' : 'right';
        ctx.fillText(`${joint.profileArticle || 'LED'} · ${joint.length.toLocaleString('ru-RU')} мм`, p.x + dx * 26, p.y + dy * 30);
      }
      ctx.restore();
    }

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
        ctx.lineWidth = Math.max(1.5, (j.visibleWidth ?? j.width) * scale);
      }
      ctx.stroke();
      ctx.restore();
    });

    drawPartBadges(ctx, panelBadges, { x: originX, y: originY, width: wall.width * scale, height: wall.height * scale });

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
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
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
      if (item.start > curX + 0.01) {
        const gap = item.start - curX;
        bottomSegments.push({
          start: curX,
          end: item.start,
          label: dimensionText(gap),
          isJoint: true,
        });
      }

      // Сам элемент (панель или проем)
      const w = item.end - item.start;
      bottomSegments.push({
        start: item.start,
        end: item.end,
        label: dimensionText(w),
        isJoint: false,
      });

      curX = item.end;
    });

    // Зазор шва у правого края стены
    if (wall.width > curX + 0.01) {
      const gap = wall.width - curX;
      bottomSegments.push({
        start: curX,
        end: wall.width,
        label: dimensionText(gap),
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

    if (compact) this.drawArchitecturalDimLine(ctx, originX, originY + wall.height * scale,
      originX + wall.width * scale, originY + wall.height * scale,
      originY + wall.height * scale + 98, 'HORIZONTAL', dimensionText(wall.width));

    // Additional architectural chains for widths above the floor and all split heights.
    const parts = layout.panels.filter(p => !p.isVoid && p.materialId !== MATERIAL_NONE_ID);
    const chainsFor = (axis: 'HORIZONTAL' | 'VERTICAL') => {
      const groups = new Map<string, {start:number;end:number;label:string;isJoint?:boolean}[]>();
      for (const p of parts) {
        const start = axis === 'HORIZONTAL' ? p.x : p.y;
        const end = start + (axis === 'HORIZONTAL' ? p.width : p.height);
        const key = axis === 'HORIZONTAL' ? dimensionText(p.y+p.height) : `${dimensionText(p.x)}:${dimensionText(p.width)}`;
        const items = groups.get(key) ?? [];
        if(!items.some(s=>Math.abs(s.start-start)<0.01 && Math.abs(s.end-end)<0.01))
          items.push({start,end,label:dimensionText(end-start)});
        groups.set(key,items);
      }
      const covered = new Set<string>(axis === 'HORIZONTAL' ? bottomSegments.filter(s=>!s.isJoint).map(s=>`${dimensionText(s.start)}:${dimensionText(s.end)}`) : [`0:${dimensionText(wall.height)}`]);
      return [...groups.values()].sort((a,b)=>b.length-a.length).flatMap(items=>{
        const fresh=items.filter(s=>!covered.has(`${dimensionText(s.start)}:${dimensionText(s.end)}`)).sort((a,b)=>a.start-b.start);
        fresh.forEach(s=>covered.add(`${dimensionText(s.start)}:${dimensionText(s.end)}`));
        // Keep disconnected intervals separate so no unlabelled line implies a measured gap.
        const runs: typeof items[] = [];
        fresh.forEach(s=>{const run=runs.at(-1);const last=run?.at(-1);
          if(last && s.start>=last.end-0.01 && s.start-last.end<=20){
            if(s.start-last.end>0.01) run!.push({start:last.end,end:s.start,label:dimensionText(s.start-last.end),isJoint:true});
            run!.push(s);
          }else runs.push([s]);
        });
        return runs;
      });
    };
    const horizontalChains = chainsFor('HORIZONTAL');
    const verticalChains = chainsFor('VERTICAL');
    (compact ? horizontalChains.slice(0, 2) : horizontalChains).forEach((segments,i)=>this.drawArchitecturalChain(ctx,originX,originY,scale,wall.height,
      segments,'HORIZONTAL',originY-40-i*45,originY));
    (compact ? verticalChains.slice(0, 2) : verticalChains).forEach((segments,i)=>this.drawArchitecturalChain(ctx,originX,originY,scale,wall.height,
      segments,'VERTICAL',originX+wall.width*scale+45+i*55,originX+wall.width*scale));

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
        if (!compact && transomHeight > 25) {
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
    if (hasUnplaceableParts) {
      ctx.save(); ctx.fillStyle = '#be123c'; ctx.font = '20px "Segoe UI", Arial, sans-serif';
      ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
      ctx.fillText('Красные номера: элементы нельзя разместить на выбранной заготовке.', boxX + 12, boxY + boxH - 8, boxW - 24);
      ctx.restore();
    }
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
          if (ctx.measureText(seg.label).width + 8 > Math.abs(segW)) {
            ctx.save();
            ctx.translate(midX, dimY - 12); ctx.rotate(-Math.PI / 2);
            ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
            ctx.fillText(seg.label, 0, 0); ctx.restore();
          } else {
            ctx.textBaseline = 'bottom';
            ctx.fillText(seg.label, midX, dimY - 4);
          }
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
    if (!sheetsWithNotes.length) return;
    // References are printed once in the page footer.
    void borrowedSheets;
    const packed = packStocks(sheetsWithNotes.map(item => item.sheet), { x: boxX, y: boxY, width: boxW, height: boxH });
    packed.boxes.forEach((cell, idx) => {
      const sheet = sheetsWithNotes[idx].sheet;
      const cellX = cell.x, cellY = cell.y, cellW = cell.width, cellH = cell.height;
      ctx.save();
      const invalidPart = sheet.placedParts.find((p) => !NestingEngine.fitsStock(p.part.width, p.part.height, sheet.sheetWidth, sheet.sheetHeight, p.part.materialType));
      if (invalidPart) {
        const part = invalidPart.part;
        ctx.fillStyle = '#ffe4e6';
        ctx.fillRect(cellX + 8, cellY + 8, cellW - 16, cellH - 16);
        ctx.strokeStyle = '#e11d48';
        ctx.lineWidth = 4;
        ctx.strokeRect(cellX + 8, cellY + 8, cellW - 16, cellH - 16);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#be123c';
        const centerX = cellX + cellW / 2;
        const centerY = cellY + cellH / 2;
        const fontSize = Math.min(24, (cellW - 32) / 12, (cellH - 32) / 7);
        const lineH = fontSize * 1.5;
        ctx.font = `bold ${fontSize}px "Segoe UI", Arial, sans-serif`;
        const lines = [
          `! Элемент ${part.partLabel}`,
          'Нельзя разместить',
          `на заготовке ${sheet.sheetWidth} × ${sheet.sheetHeight} мм`,
          `Деталь: ${Math.round(part.width)} × ${Math.round(part.height)} мм`,
          part.note || 'Требуется разделение детали',
        ];
        lines.forEach((line, i) => ctx.fillText(line, centerX, centerY + (i - 2) * lineH, cellW - 32));
        ctx.restore();
        return;
      }
      const sheetLabel = sheet.sheetLabel || `Лист ${sheet.sheetIndex || (startIndex + idx + 1)}`;
      ctx.fillStyle = '#0f172a';
      ctx.font = '24px "Segoe UI", Arial, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(sheetLabel, cellX + cellW / 2, cellY + 17, cellW - 8);
      const scale = cell.scale;
      const sheetOriginX = cellX + STOCK_PADDING.left + (cellW - STOCK_PADDING.left - STOCK_PADDING.right - sheet.sheetWidth * scale) / 2;
      const sheetOriginY = cellY + STOCK_PADDING.top;
      const partBadges: PartBadge[] = [];

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

        let polyCanvasPts: { x: number; y: number }[] = [];

        if (isPolygon) {
          // 1. Преобразуем полигон детали в координаты листа раскроя
          polyCanvasPts = NestingEngine.placedPolygon(p).map(pt => ({
            x: sheetOriginX + pt.x * scale,
            y: sheetOriginY + (sheet.sheetHeight - pt.y) * scale,
          }));

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

        } else {
          // Обычная прямоугольная деталь
          ctx.fillStyle = isCurrentWall ? (p.part.color || '#fde68a') : '#e0e7ff';
          ctx.fillRect(px, py, pw, ph);
          ctx.strokeStyle = isCurrentWall ? '#b45309' : '#4338ca';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(px, py, pw, ph);
        }

        // Вырезы внутри детали (проемы: двери, окна, ниши) - чистое белое пустое пространство
        const badgeCutouts: Point2D[][] = [];

        if (p.part.cutouts && p.part.cutouts.length > 0) {
          p.part.cutouts.forEach((cut) => {
            const corners = [[cut.x,cut.y],[cut.x+cut.width,cut.y],[cut.x+cut.width,cut.y+cut.height],[cut.x,cut.y+cut.height]].map(([x,y]) => NestingEngine.placedPoint(p,x,y));
            badgeCutouts.push(corners.map(c => ({ x: sheetOriginX + c.x * scale, y: sheetOriginY + (sheet.sheetHeight - c.y) * scale })));
            const cutX = sheetOriginX + Math.min(...corners.map(c=>c.x))*scale;
            const cutY = sheetOriginY + (sheet.sheetHeight-Math.max(...corners.map(c=>c.y)))*scale;
            const cutW = (Math.max(...corners.map(c=>c.x))-Math.min(...corners.map(c=>c.x)))*scale;
            const cutH = (Math.max(...corners.map(c=>c.y))-Math.min(...corners.map(c=>c.y)))*scale;


            // Очищаем область выреза белым фоном листа без линий, рамок, остатков и выносок
            ctx.fillStyle = '#ffffff';
            if (p.textureAngleDeg !== undefined && p.textureAngleDeg % 90 !== 0) {
              ctx.beginPath();
              corners.forEach((c,i) => { const x=sheetOriginX+c.x*scale, y=sheetOriginY+(sheet.sheetHeight-c.y)*scale;
                if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y); });
              ctx.closePath(); ctx.fill();
            } else ctx.fillRect(cutX, cutY, cutW, cutH);
          });
        }

        // ЗОНЫ СГИБОВ И КЕРФ-БЕНДИНГА НА ДЕТАЛИ ЛИСТА РАСКРОЯ
        if (p.part.bendsInfo && p.part.bendsInfo.length > 0) {
          p.part.bendsInfo.forEach((bend) => {
            const isRot = p.rotated;
            const bOffset = bend.bendOffsetInSheet;
            const bW = bend.bendWidth;

            const band = [[bOffset,0],[bOffset+bW,0],[bOffset,p.part.height],[bOffset+bW,p.part.height]].map(([x,y]) => NestingEngine.placedPoint(p,x,y));
            const bCanvasX = sheetOriginX + Math.min(...band.map(c=>c.x))*scale;
            const bCanvasY = sheetOriginY + (sheet.sheetHeight-Math.max(...band.map(c=>c.y)))*scale;
            const bCanvasW = (Math.max(...band.map(c=>c.x))-Math.min(...band.map(c=>c.x)))*scale;
            const bCanvasH = (Math.max(...band.map(c=>c.y))-Math.min(...band.map(c=>c.y)))*scale;

            if (p.textureAngleDeg !== undefined && p.textureAngleDeg % 90 !== 0) {
              const toCanvas = (x:number,y:number) => { const q=NestingEngine.placedPoint(p,x,y);
                return {x:sheetOriginX+q.x*scale,y:sheetOriginY+(sheet.sheetHeight-q.y)*scale}; };
              const points=[[bOffset,0],[bOffset+bW,0],[bOffset+bW,p.part.height],[bOffset,p.part.height]].map(([x,y])=>toCanvas(x,y));
              ctx.save(); ctx.fillStyle='rgba(2,132,199,0.14)'; ctx.strokeStyle='#0284c7'; ctx.setLineDash([5,3]);
              ctx.beginPath(); points.forEach((q,i)=>{if(i===0)ctx.moveTo(q.x,q.y);else ctx.lineTo(q.x,q.y);});
              ctx.closePath(); ctx.fill(); ctx.stroke();
              const lines=Math.min(8,Math.max(3,Math.floor(bend.radius/30)));
              for(let i=1;i<lines;i++){const a=toCanvas(bOffset+bW*i/lines,0),b=toCanvas(bOffset+bW*i/lines,p.part.height);
                ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();}
              ctx.restore();
              return;
            }
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

            ctx.restore();
          });
        }

        partBadges.push({ text: p.part.partLabel || '1.1',
          polygon: polyCanvasPts.length >= 3 ? polyCanvasPts : boxPolygon({ x: px, y: py, width: pw, height: ph }),
          cutouts: badgeCutouts });
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

      drawPartBadges(ctx, partBadges, { x: cellX + 4, y: sheetOriginY, width: cellW - 8, height: cellH - STOCK_PADDING.top });

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
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(sceneX, sceneY, sceneW, sceneH, 20);
    ctx.clip();
    this.drawWall3DScene(ctx, wall, project, sceneX, sceneY, sceneW, sceneH);
    ctx.restore();

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

    const projectUnscaled = (p: Point3D) => {
      const xRot = p.x * Math.cos(radA) - p.z * Math.sin(radA);
      const zRot = p.x * Math.sin(radA) + p.z * Math.cos(radA);
      return { x: xRot, y: zRot * Math.sin(radE) - p.y * Math.cos(radE) };
    };

    // Fit the projected scene, including the floor, instead of estimating its
    // screen size from world dimensions and anchoring it near the bottom.
    const boundsPoints = [
      { x: minX, y: 0, z: minZ }, { x: maxX, y: 0, z: minZ },
      { x: maxX, y: 0, z: maxZ }, { x: minX, y: 0, z: maxZ },
    ];
    const frontDepth = -Math.max(panelThick + 3, ...layout.panels.map((p) => p.thickness || panelThick));
    pathSections.forEach((section) => {
      const steps = section.isBend ? 32 : 1;
      for (let step = 0; step <= steps; step++) {
        const s = section.sStart + (section.sEnd - section.sStart) * step / steps;
        for (const y of [0, wallH]) {
          for (const depth of [frontDepth, wallThick]) {
            boundsPoints.push(section.getPoint(s, y, depth));
          }
        }
      }
    });
    const projectedBounds = boundsPoints.map(projectUnscaled);
    const left = Math.min(...projectedBounds.map((p) => p.x));
    const right = Math.max(...projectedBounds.map((p) => p.x));
    const top = Math.min(...projectedBounds.map((p) => p.y));
    const bottom = Math.max(...projectedBounds.map((p) => p.y));
    const padding = 80;
    const scale = Math.min((boxW - padding * 2) / Math.max(1, right - left),
      (boxH - padding * 2) / Math.max(1, bottom - top), 0.52);
    const cx = boxX + boxW / 2 - (left + right) / 2 * scale;
    const cy = boxY + boxH / 2 - (top + bottom) / 2 * scale;

    const project3D = (p: Point3D) => {
      const point = projectUnscaled(p);
      return { x: cx + point.x * scale, y: cy + point.y * scale };
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
    for (let x = Math.ceil(minX / 500) * 500; x <= maxX; x += 500) {
      const pA = project3D({ x, y: 0, z: minZ });
      const pB = project3D({ x, y: 0, z: maxZ });
      ctx.beginPath();
      ctx.moveTo(pA.x, pA.y);
      ctx.lineTo(pB.x, pB.y);
      ctx.stroke();
    }
    for (let z = Math.ceil(minZ / 500) * 500; z <= maxZ; z += 500) {
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
          const texture = !isVoid && getPieceTexture(p);
          if (texture) {
            ctx.clip();
            drawTextureFace(ctx, texture,
              project3D(getPointAtS(s0, yBot, -thick)), project3D(getPointAtS(s1, yBot, -thick)),
              project3D(getPointAtS(s1, yTop, -thick)), project3D(getPointAtS(s0, yTop, -thick)),
              { x: (s0-p.x)/p.width, y: 0, width: (s1-s0)/p.width, height: 1 });
          }
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
          const photo = !isVoid && getPieceTexture(p);
          if (photo) {
            drawTextureFace(ctx, photo, p0, p1, p2, p3, { x: (s0-p.x)/p.width, y: (p.y+p.height-inv.end)/p.height, width: (s1-s0)/p.width, height: (inv.end-inv.start)/p.height });
          }
          if (!photo && !isVoid && p.textureCategory === 'WOOD') {
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
      // Облицовка портала рисуется общим drawOpeningSlopes ниже, заполнение не требуется.
      if (op.type === 'DOOR' && op.isPortal) return;
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
    for (const op of wall.openings) {
      drawOpeningSlopes(ctx, op, layout.slopes ?? [], layout.slopeJoints ?? [],
        p => project3D(getPointAtS(p.x, p.y, p.z)), { textures: true, profiles: true });
    }

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
    profiles: ProjectProfilesReport,
    pageNumber: number = 1,
    totalPages: number = 1
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
      { title: 'ВСЕГО ПАНЕЛЕЙ', val: `${nesting.totalPartsCount} шт.`, sub: `Заготовок: ${nesting.totalSheetsCount} шт.` },
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
      ['Материал / Декор', 'Артикул', 'Тип', 'Деталей', 'Площадь', 'Заготовок'],
      nesting.materialResults.map((m) => [
        m.materialName,
        m.materialId,
        m.sheets[0]?.placedParts[0]?.part.materialType === 'SLAT' ? 'Рейка' : 'Листовая панель',
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
    ctx.fillText('2. Спецификация профилей и фурнитуры', marginX, tbl2Y - 25);
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
      ['Тип профиля', 'Артикул / цвет', 'Ширина / металл', 'Погонаж', 'Хлысты'],
      profiles.byCategorySummary.map((p) => [
        p.name,
        `${p.article}${p.profileColor ? ' / ' + p.profileColor : ''}`,
        `${p.visibleWidth} мм / ${p.metalThickness !== undefined ? p.metalThickness.toLocaleString('ru-RU') + ' мм' : '—'}`,
        `${p.totalLinearMeters} м`,
        `${p.stockBarsCount} × ${p.stockLengthMm / 1000} м`,
      ]),
      colW2
    );

    // Штамп
    ctx.save();
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#64748b';
    ctx.font = '22px "Segoe UI", Arial, sans-serif';
    ctx.fillText(`Лист ${pageNumber} / ${totalPages} (Сводный)`, w - marginX, 2040);
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

    this.drawWall2DOnCanvas(ctx, wall, layout, drawAreaX, drawAreaY, drawAreaW, drawAreaH, false, project.materials, true);

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
    ctx.fillText(`Всего погонажа: ${report.totalLinearMeters} м   •   Хлыстов: ${report.totalStockBars} шт.`, sideX + 32, sideY + 86);

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
      ctx.fillText(item.name, sideX + 48, curY + 34, sideW - 90);

      // Артикул и ширина
      ctx.fillStyle = '#64748b';
      ctx.font = '16px "Segoe UI", Arial, sans-serif';
      ctx.fillText(`${item.article} • Видимая: ${item.visibleWidth} мм • Металл: ${item.metalThickness !== undefined ? item.metalThickness.toLocaleString('ru-RU') + ' мм' : '—'}`, sideX + 48, curY + 62, sideW - 90);

      ctx.fillText(`Цвет: ${item.profileColor || 'Не указан'}`, sideX + 48, curY + 83);

      // Метраж
      ctx.fillStyle = '#1e293b';
      ctx.font = 'bold 18px "Segoe UI", Arial, sans-serif';
      ctx.fillText(`Погонаж: ${item.totalLinearMeters} м (${item.segmentsCount} сегм.)`, sideX + 48, curY + 104);

      // Количество хлыстов (справа)
      ctx.fillStyle = '#2563eb';
      ctx.font = 'bold 18px "Segoe UI", Arial, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(`${item.stockBarsCount} шт. (${item.stockLengthMm / 1000}м)`, sideX + sideW - 44, curY + 104);
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
      { color: '#2563eb', label: 'Соединительный профиль (3 мм / 7 мм)' },
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
      ctx.fillText(h, curX + 20, y + headerH / 2, colWidths[i] - 40);
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
        ctx.fillText(val, rowX + 20, ry + rowH / 2, colWidths[cIdx] - 40);
        rowX += colWidths[cIdx];
      });
    });

    ctx.restore();
  }
}

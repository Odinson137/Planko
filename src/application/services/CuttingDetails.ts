import { Point2D, PolygonSlicingEngine } from '../../core/geometry/PolygonSlicingEngine';
import { NestingEngine, NestingPartInput, ProjectNestingResult } from '../../core/layout/NestingEngine';
import { DrawingBox } from './PanelPageLayout';
import { dimensionText } from './PartDrawing';
import { boxesOverlap } from './PartBadges';

export interface CuttingEdge {
  start: Point2D; end: Point2D; length: number; angle: number;
  from: string; to: string; contour: string;
}
export interface CuttingDetail {
  part: NestingPartInput;
  stockLabels: string[];
  stockPlacements: { label: string; x: number; top: number; clockwiseAngle: number }[];
  width: number; height: number;
  contours: { name: string; points: Point2D[]; isCutout: boolean }[];
  edges: CuttingEdge[];
  leftHeight?: number; rightHeight?: number;
  cannotPlace: boolean;
}
export interface DetailDimension {
  start: Point2D; end: Point2D; label: string;
  kind: 'edge' | 'cutout' | 'bend';
  contour?: string;
}
export interface CuttingDetailCard { detail: CuttingDetail; dimensions: DetailDimension[]; continuation: number }
export interface CuttingDetailPage { wallId: string; wallName: string; cards: CuttingDetailCard[]; capacity: number }

const epsilon = 1e-7;
function cleanContour(points: Point2D[]): Point2D[] {
  const result = points.filter((p, i) => Math.hypot(p.x - points[(i + points.length - 1) % points.length].x,
    p.y - points[(i + points.length - 1) % points.length].y) > epsilon).map(p => ({ ...p }));
  // A consistent clockwise order, starting at the upper-left vertex in wall coordinates.
  const area = result.reduce((sum, p, i) => { const q = result[(i + 1) % result.length]; return sum + p.x * q.y - p.y * q.x; }, 0);
  if (area > 0) result.reverse();
  let first = 0;
  result.forEach((p, i) => {
    if (p.y > result[first].y + epsilon || (Math.abs(p.y - result[first].y) < epsilon && p.x < result[first].x)) first = i;
  });
  return [...result.slice(first), ...result.slice(0, first)];
}

/** Use the finished part in wall orientation, never its rotated stock bounding box. */
export function buildCuttingDetails(parts: NestingPartInput[], nesting: ProjectNestingResult): CuttingDetail[] {
  return parts.filter(part => part.width > 0 && part.height > 0).map(part => {
    const source = part.polygonPoints?.length && part.polygonPoints.length >= 3 ? part.polygonPoints
      : [{ x: part.x ?? 0, y: part.y ?? 0 }, { x: (part.x ?? 0) + part.width, y: part.y ?? 0 },
        { x: (part.x ?? 0) + part.width, y: (part.y ?? 0) + part.height }, { x: part.x ?? 0, y: (part.y ?? 0) + part.height }];
    const minX = Math.min(...source.map(p => p.x)), minY = Math.min(...source.map(p => p.y));
    const width = Math.max(...source.map(p => p.x)) - minX, height = Math.max(...source.map(p => p.y)) - minY;
    const outer = cleanContour(source.map(p => ({ x: p.x - minX, y: p.y - minY })));
    const cuts = (part.cutouts ?? []).map((cut, i) => {
      const x = cut.x + (part.x ?? minX) - minX, y = cut.y + (part.y ?? minY) - minY;
      return { name: `B${i + 1}`, isCutout: true, points: cleanContour([
        { x, y }, { x: x + cut.width, y }, { x: x + cut.width, y: y + cut.height }, { x, y: y + cut.height },
      ]) };
    }).filter(cut => {
      // Applied openings may already be notches in the outer polygon. Do not draw
      // a second, coincident cutout or duplicate its dimensions.
      let intersection = outer;
      cut.points.forEach((p, i) => {
        intersection = PolygonSlicingEngine.clipPolygonByHalfPlane(intersection, p, cut.points[(i + 1) % cut.points.length], true);
      });
      return PolygonSlicingEngine.calculatePolygonArea(intersection) > 0.01;
    });
    const contours = [{ name: 'A', points: outer, isCutout: false }, ...cuts];
    const edges = contours.flatMap(contour => contour.points.map((start, i) => {
      const end = contour.points[(i + 1) % contour.points.length];
      const dx = end.x - start.x, dy = end.y - start.y;
      return { start, end, from: `${contour.name}.${i + 1}`, to: `${contour.name}.${(i + 1) % contour.points.length + 1}`,
        contour: contour.name, length: Math.hypot(dx, dy), angle: Math.atan2(Math.abs(dy), Math.abs(dx)) * 180 / Math.PI };
    }));
    const sideHeight = (x: number) => {
      const side = edges.filter(edge => edge.contour === 'A' && Math.abs(edge.start.x - x) < epsilon && Math.abs(edge.end.x - x) < epsilon);
      return side.length === 1 ? side[0].length : undefined;
    };
    const stockPlacements = nesting.allSheets.flatMap(sheet => sheet.placedParts
      .filter(p => p.part.id === part.id && p.part.wallId === part.wallId)
      .map(p => ({ label: sheet.sheetLabel, x: p.x, top: sheet.sheetHeight - p.y - p.height,
        clockwiseAngle: (((p.textureAngleDeg ?? (p.rotated ? 90 : 0)) % 360) + 360) % 360 })));
    const placedPart = nesting.allSheets.flatMap(sheet => sheet.placedParts).find(p => p.part.id === part.id && p.part.wallId === part.wallId)?.part;
    const cannotPlace = !NestingEngine.fitsStock(width, height, part.stockWidth ?? placedPart?.stockWidth,
      part.stockHeight ?? placedPart?.stockHeight, part.materialType ?? placedPart?.materialType);
    return { part, width, height, contours, edges, leftHeight: sideHeight(0), rightHeight: sideHeight(width), cannotPlace,
      stockLabels: stockPlacements.map(p => p.label), stockPlacements };
  });
}

/** Each size belongs to a visible segment, never to a coordinate table. */
export function detailDimensions(detail: CuttingDetail): DetailDimension[] {
  const result: DetailDimension[] = detail.edges.map(edge => ({
    start: edge.start, end: edge.end, kind: 'edge', contour: edge.contour,
    label: dimensionText(edge.length) + (edge.angle > epsilon && edge.angle < 90 - epsilon ? ` мм; ${dimensionText(edge.angle)}°` : ''),
  }));
  detail.contours.filter(c => c.isCutout).forEach(cut => {
    const x = Math.min(...cut.points.map(p => p.x)), y = Math.min(...cut.points.map(p => p.y));
    if (x > epsilon) result.push({ start: { x: 0, y }, end: { x, y }, kind: 'cutout', label: `${dimensionText(x)} от левого края` });
    if (y > epsilon) result.push({ start: { x, y: 0 }, end: { x, y }, kind: 'cutout', label: `${dimensionText(y)} от низа` });
  });
  (detail.part.bendsInfo ?? []).forEach(bend => {
    const x = bend.bendOffsetInSheet;
    result.push({ start: { x, y: detail.height / 2 }, end: { x: x + bend.bendWidth, y: detail.height / 2 }, kind: 'bend',
      label: `${bend.type === 'INNER_CORNER' ? 'Внутренний' : 'Внешний'} сгиб: R ${dimensionText(bend.radius)}; ${dimensionText(bend.angleDeg)}°` });
    result.push({ start: { x: 0, y: detail.height / 2 }, end: { x, y: detail.height / 2 }, kind: 'bend',
      label: `Отступ ${dimensionText(x)}; полоса сгиба ${dimensionText(bend.bendWidth)}` });
  });
  return result;
}

function pageCapacity(card: CuttingDetailCard): number {
  if (card.dimensions.length > 10 || card.detail.part.bendsInfo?.length || (card.detail.part.note?.length ?? 0) > 100) return 2;
  const wideDiagonal = card.detail.width / card.detail.height > 0.65 && card.dimensions.some(d =>
    Math.abs(d.start.x - d.end.x) > epsilon && Math.abs(d.start.y - d.end.y) > epsilon);
  return card.dimensions.length > 8 || wideDiagonal ? 4 : 6;
}

/** Pack readable cards in order, keeping more room for complex contours and bends. */
export function planCuttingDetailPages(details: CuttingDetail[]): CuttingDetailPage[] {
  const groups = new Map<string, CuttingDetail[]>();
  details.forEach(detail => {
    const group = groups.get(detail.part.wallId) ?? []; group.push(detail); groups.set(detail.part.wallId, group);
  });
  const pages: CuttingDetailPage[] = [];
  for (const [wallId, group] of groups) {
    let page: CuttingDetailPage | undefined;
    for (const detail of [...group].sort((a, b) => a.part.partLabel.localeCompare(b.part.partLabel, 'ru', { numeric: true }))) {
      const dimensions = detailDimensions(detail);
      for (let offset = 0; offset < dimensions.length; offset += 12) {
        const card = { detail, dimensions: dimensions.slice(offset, offset + 12), continuation: offset / 12 };
        const capacity = pageCapacity(card);
        if (!page || page.cards.length >= Math.min(page.capacity, capacity)) {
          page = { wallId, wallName: detail.part.wallName, cards: [], capacity }; pages.push(page);
        }
        page.capacity = Math.min(page.capacity, capacity); page.cards.push(card);
      }
    }
  }
  return pages;
}

interface DimensionMark {
  dimension: DetailDimension;
  a: Point2D; b: Point2D; anchor: Point2D; normal: Point2D;
  angle: number; length: number;
}
export interface DimensionLabel extends DrawingBox {
  text: string; angle: number; center: Point2D; anchor: Point2D;
  leader: boolean; color: string; lines: string[];
}

const dimensionFont = 28;
const dimensionHeight = 40;
const dimensionOffset = 30;
function calloutRailWidth(dimensions: DetailDimension[], region: DrawingBox, measure: (text: string) => number): number {
  return Math.min(420, region.width * 0.3, Math.max(100, ...dimensions.map(d => measure(d.label) + 24)));
}
function textLines(text: string, width: number, measure: (text: string) => number): string[] {
  const lines: string[] = []; let line = '';
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && measure(next) > width) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

function dimensionMark(dimension: DetailDimension, toCanvas: (p: Point2D) => Point2D): DimensionMark {
  const a = toCanvas(dimension.start), b = toCanvas(dimension.end);
  const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
  const normal = length > epsilon ? { x: dy / length, y: -dx / length } : { x: 0, y: -1 };
  const offset = dimension.kind === 'edge' ? dimensionOffset : 0;
  const anchor = { x: (a.x + b.x) / 2 + normal.x * offset, y: (a.y + b.y) / 2 + normal.y * offset };
  let angle = Math.atan2(dy, dx);
  if (angle > Math.PI / 2 || angle < -Math.PI / 2) angle += Math.PI;
  return { dimension, a, b, anchor, normal, angle, length };
}

/** Reserve clear side rails for short edges and crowded notches. The same planner is tested and drawn. */
export function placeDimensionLabels(dimensions: DetailDimension[], toCanvas: (p: Point2D) => Point2D,
  region: DrawingBox, drawing: DrawingBox, measure: (text: string) => number): DimensionLabel[] {
  const labels: DimensionLabel[] = [];
  const pending: DimensionMark[] = [];
  const railWidth = calloutRailWidth(dimensions, region, measure);
  const color = (mark: DimensionMark) => mark.dimension.kind === 'edge' ? '#0f172a' : '#0369a1';
  for (const mark of dimensions.map(dimension => dimensionMark(dimension, toCanvas))) {
    const width = measure(mark.dimension.label) + 20, height = dimensionHeight;
    const center = { x: mark.anchor.x + mark.normal.x * 22, y: mark.anchor.y + mark.normal.y * 22 };
    const bw = Math.abs(Math.cos(mark.angle)) * width + Math.abs(Math.sin(mark.angle)) * height;
    const bh = Math.abs(Math.sin(mark.angle)) * width + Math.abs(Math.cos(mark.angle)) * height;
    const box = { x: center.x - bw / 2, y: center.y - bh / 2, width: bw, height: bh };
    const inside = box.x >= region.x + railWidth + 16 && box.x + bw <= region.x + region.width - railWidth - 16 &&
      box.y >= region.y && box.y + bh <= region.y + region.height;
    if (mark.dimension.kind === 'edge' && mark.length >= width + 30 && inside && !labels.some(other => boxesOverlap(box, other, 18))) {
      labels.push({ ...box, center, anchor: mark.anchor, text: mark.dimension.label, lines: [mark.dimension.label], angle: mark.angle, leader: false, color: color(mark) });
    } else pending.push(mark);
  }
  const middle = drawing.x + drawing.width / 2;
  for (const side of [-1, 1]) {
    const items = pending.filter(mark => (mark.anchor.x < middle ? -1 : 1) === side).sort((a, b) => a.anchor.y - b.anchor.y);
    const lines = items.map(mark => textLines(mark.dimension.label, railWidth - 24, measure));
    const heights = lines.map(lines => lines.length * 34 + 10);
    const positions = items.map((mark, i) => Math.max(region.y + heights[i] / 2, Math.min(region.y + region.height - heights[i] / 2, mark.anchor.y)));
    for (let i = 1; i < positions.length; i++) positions[i] = Math.max(positions[i], positions[i - 1] + (heights[i - 1] + heights[i]) / 2 + 12);
    if (positions.length && positions[positions.length - 1] > region.y + region.height - heights[heights.length - 1] / 2) {
      positions[positions.length - 1] = region.y + region.height - heights[heights.length - 1] / 2;
      for (let i = positions.length - 2; i >= 0; i--) positions[i] = Math.min(positions[i], positions[i + 1] - (heights[i + 1] + heights[i]) / 2 - 12);
    }
    if (positions.length && positions[0] - heights[0] / 2 < region.y - epsilon) throw new Error('Недостаточно места для размеров детали.');
    items.forEach((mark, i) => {
      const width = Math.max(...lines[i].map(line => measure(line))) + 24, height = heights[i];
      const center = { x: side < 0 ? region.x + railWidth - width / 2 : region.x + region.width - railWidth + width / 2, y: positions[i] };
      labels.push({ x: center.x - width / 2, y: center.y - height / 2, width, height, center, anchor: mark.anchor,
        text: mark.dimension.label, lines: lines[i], angle: 0, leader: true, color: color(mark) });
    });
  }
  return labels;
}

function drawDimensions(ctx: CanvasRenderingContext2D, dimensions: DetailDimension[], toCanvas: (p: Point2D) => Point2D,
  region: DrawingBox, drawing: DrawingBox): void {
  ctx.save(); ctx.font = `${dimensionFont}px "Segoe UI", Arial, sans-serif`;
  const labels = placeDimensionLabels(dimensions, toCanvas, region, drawing, text => ctx.measureText(text).width);
  for (const dimension of dimensions) {
    const mark = dimensionMark(dimension, toCanvas);
    const offset = dimension.kind === 'edge' ? dimensionOffset : 0;
    const a = { x: mark.a.x + mark.normal.x * offset, y: mark.a.y + mark.normal.y * offset };
    const b = { x: mark.b.x + mark.normal.x * offset, y: mark.b.y + mark.normal.y * offset };
    ctx.strokeStyle = dimension.kind === 'edge' ? '#64748b' : '#0284c7'; ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(mark.a.x, mark.a.y); ctx.lineTo(a.x + mark.normal.x * 10, a.y + mark.normal.y * 10);
    ctx.moveTo(mark.b.x, mark.b.y); ctx.lineTo(b.x + mark.normal.x * 10, b.y + mark.normal.y * 10);
    ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    for (const p of [a, b]) { ctx.moveTo(p.x - 7, p.y + 7); ctx.lineTo(p.x + 7, p.y - 7); }
    ctx.stroke();
  }
  // Leaders first, then opaque labels, so a later line never crosses a size.
  for (const label of labels.filter(label => label.leader)) {
    const endX = label.center.x < label.anchor.x ? label.x + label.width : label.x;
    ctx.strokeStyle = label.color; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(label.anchor.x, label.anchor.y); ctx.lineTo(endX, label.center.y); ctx.stroke();
    ctx.beginPath(); ctx.arc(label.anchor.x, label.anchor.y, 3.5, 0, Math.PI * 2); ctx.fillStyle = label.color; ctx.fill();
  }
  for (const label of labels) {
    ctx.save(); ctx.translate(label.center.x, label.center.y); ctx.rotate(label.angle);
    const width = label.leader ? label.width : ctx.measureText(label.text).width + 20;
    const height = label.leader ? label.height : dimensionHeight;
    ctx.fillStyle = '#fff'; ctx.fillRect(-width / 2, -height / 2, width, height);
    ctx.fillStyle = label.color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    label.lines.forEach((line, i) => ctx.fillText(line, 0, (i - (label.lines.length - 1) / 2) * 34)); ctx.restore();
  }
  ctx.restore();
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, width: number, lineHeight = 32): number {
  for (const line of textLines(text, width, text => ctx.measureText(text).width)) { ctx.fillText(line, x, y); y += lineHeight; }
  return y;
}

export function cuttingDetailCardBoxes(page: CuttingDetailPage, w: number, h: number): DrawingBox[] {
  const columns = page.cards.length > 4 ? 3 : page.cards.length > 1 ? 2 : 1;
  const rows = Math.ceil(page.cards.length / columns), gap = 24;
  const width = (w - 120 - gap * (columns - 1)) / columns, height = (h - 210 - gap * (rows - 1)) / rows;
  return page.cards.map((_, i) => ({ x: 60 + (i % columns) * (width + gap), y: 120 + Math.floor(i / columns) * (height + gap), width, height }));
}

function drawDetailCard(ctx: CanvasRenderingContext2D, card: CuttingDetailCard, box: DrawingBox): void {
  const { detail } = card, left = box.x + 24, textWidth = box.width - 48;
  ctx.save(); ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 1; ctx.strokeRect(box.x, box.y, box.width, box.height);
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillStyle = detail.cannotPlace ? '#be123c' : '#0f172a'; ctx.font = 'bold 32px "Segoe UI", Arial, sans-serif';
  ctx.fillText(`Деталь ${detail.part.partLabel}${card.continuation ? ` / продолжение ${card.continuation + 1}` : ''}`, left, box.y + 34);
  ctx.font = '24px "Segoe UI", Arial, sans-serif'; ctx.fillStyle = '#334155';
  const description = [detail.part.materialName, detail.part.decorCode ? `декор ${detail.part.decorCode}` : '',
    detail.part.thickness ? `толщина ${dimensionText(detail.part.thickness)} мм` : '', detail.part.note].filter(Boolean).join(' · ');
  let y = wrapText(ctx, description, left, box.y + 76, textWidth);
  ctx.fillText(`Габарит ${dimensionText(detail.width)} × ${dimensionText(detail.height)} мм`, left, y); y += 32;
  if (detail.cannotPlace) {
    ctx.fillStyle = '#be123c';
    y = wrapText(ctx, 'Нельзя разместить на выбранной заготовке: размеры детали превышают допустимые.', left, y, textWidth);
  } else if (detail.stockLabels.length) {
    y = wrapText(ctx, `Заготовка: ${detail.stockLabels.join(', ')}`, left, y, textWidth);
  }
  const placement = detail.stockPlacements[0];
  const placementText = placement && !detail.cannotPlace ? `На заготовке: слева ${dimensionText(placement.x)} мм; сверху ${dimensionText(placement.top)} мм; поворот по часовой ${dimensionText(placement.clockwiseAngle)}°.` : '';
  ctx.font = '22px "Segoe UI", Arial, sans-serif';
  const footerHeight = textLines(placementText, textWidth, text => ctx.measureText(text).width).length * 28 + 16;
  const region: DrawingBox = { x: left, y: y + 16, width: textWidth, height: box.y + box.height - footerHeight - 20 - y - 16 };
  ctx.font = `${dimensionFont}px "Segoe UI", Arial, sans-serif`;
  const railWidth = calloutRailWidth(card.dimensions, region, text => ctx.measureText(text).width);
  const scale = Math.min((region.width - 2 * (railWidth + 74)) / detail.width, (region.height - 160) / detail.height);
  const drawing: DrawingBox = { x: region.x + (region.width - detail.width * scale) / 2, y: region.y + (region.height - detail.height * scale) / 2,
    width: detail.width * scale, height: detail.height * scale };
  const toCanvas = (p: Point2D) => ({ x: drawing.x + p.x * scale, y: drawing.y + (detail.height - p.y) * scale });
  const trace = (points: Point2D[]) => {
    ctx.beginPath(); points.forEach((p, i) => { const c = toCanvas(p); if (i) ctx.lineTo(c.x, c.y); else ctx.moveTo(c.x, c.y); }); ctx.closePath();
  };
  trace(detail.contours[0].points); ctx.fillStyle = detail.cannotPlace ? '#fff1f2' : '#f1f5f9'; ctx.fill();
  ctx.strokeStyle = detail.cannotPlace ? '#be123c' : '#0f172a'; ctx.lineWidth = 3; ctx.stroke();
  ctx.save(); trace(detail.contours[0].points); ctx.clip();
  for (const contour of detail.contours.slice(1)) {
    trace(contour.points); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#0284c7'; ctx.setLineDash([8, 6]); ctx.stroke();
  }
  ctx.fillStyle = '#dbeafe'; ctx.strokeStyle = '#0284c7'; ctx.setLineDash([10, 6]);
  for (const bend of detail.part.bendsInfo ?? []) {
    const p = toCanvas({ x: bend.bendOffsetInSheet, y: detail.height });
    ctx.fillRect(p.x, p.y, bend.bendWidth * scale, drawing.height);
    ctx.strokeRect(p.x, p.y, bend.bendWidth * scale, drawing.height);
  }
  ctx.restore();
  drawDimensions(ctx, card.dimensions, toCanvas, region, drawing);
  ctx.font = '22px "Segoe UI", Arial, sans-serif'; ctx.fillStyle = '#475569'; ctx.textAlign = 'left';
  wrapText(ctx, placementText, left, box.y + box.height - footerHeight, textWidth, 28);
  ctx.restore();
}

export function renderCuttingDetailPage(ctx: CanvasRenderingContext2D, w: number, h: number,
  page: CuttingDetailPage, pageNumber: number, totalPages: number): void {
  ctx.save(); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#0f172a'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.font = '32px "Segoe UI", Arial, sans-serif';
  ctx.fillText(`${page.wallName} / Детали для раскроя`, 60, 48, w - 120);
  ctx.font = '22px "Segoe UI", Arial, sans-serif'; ctx.fillStyle = '#475569';
  ctx.fillText('Все размеры в мм. Вид как на стене. Угол косого реза указан к горизонтали.', 60, 87, w - 120);
  const boxes = cuttingDetailCardBoxes(page, w, h);
  page.cards.forEach((card, i) => drawDetailCard(ctx, card, boxes[i]));
  ctx.font = '22px "Segoe UI", Arial, sans-serif'; ctx.fillStyle = '#475569';
  ctx.fillText('Синим обозначены вырезы, их отступы и сгибы.', 60, h - 40, w - 300);
  ctx.textAlign = 'right'; ctx.fillText(`${pageNumber} / ${totalPages}`, w - 60, h - 40);
  ctx.restore();
}


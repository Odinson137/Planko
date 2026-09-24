export interface DrawingBox { x: number; y: number; width: number; height: number }
export interface StockSize { sheetWidth: number; sheetHeight: number }
export interface StockBox extends DrawingBox { index: number; scale: number }
export interface PanelPageLayout { wall?: DrawingBox; stocks: StockBox[] }

// Space for the stock title and architectural dimensions, in export canvas pixels.
export const STOCK_PADDING = { left: 54, right: 18, top: 70, bottom: 24 };
export const WALL_PADDING = { x: 145, y: 135 };

/** Pack actual stock widths in ordered shelves. Slats do not consume sheet-sized cells. */
export function packStocks(stocks: StockSize[], box: DrawingBox): { boxes: StockBox[]; scale: number } {
  if (!stocks.length) return { boxes: [], scale: 1 };
  const atScale = (scale: number): StockBox[] | undefined => {
    const rows: StockBox[][] = [[]];
    let x = 0, y = 0, rowHeight = 0;
    for (let index = 0; index < stocks.length; index++) {
      const stock = stocks[index];
      const width = Math.max(122, stock.sheetWidth * scale + STOCK_PADDING.left + STOCK_PADDING.right);
      const height = stock.sheetHeight * scale + STOCK_PADDING.top + STOCK_PADDING.bottom;
      if (width > box.width + 0.001 || height > box.height + 0.001) return;
      if (x + width > box.width + 0.001) {
        y += rowHeight + 18; x = 0; rowHeight = 0; rows.push([]);
      }
      if (y + height > box.height + 0.001) return;
      rows[rows.length - 1].push({ index, x, y, width, height, scale });
      x += width; rowHeight = Math.max(rowHeight, height);
    }
    const offsetY = (box.height - y - rowHeight) / 2;
    return rows.flatMap(row => {
      const offsetX = (box.width - row.reduce((sum, item) => sum + item.width, 0)) / 2;
      return row.map(item => ({ ...item, x: box.x + offsetX + item.x, y: box.y + offsetY + item.y }));
    });
  };
  let low = 0, high = 0.65;
  for (let i = 0; i < 32; i++) {
    const mid = (low + high) / 2;
    if (atScale(mid)) low = mid; else high = mid;
  }
  return { boxes: atScale(low) ?? [], scale: low };
}

/** Choose a composition by available drawing scale, not a fixed wall-width threshold. */
export function planPanelPages(wall: { width: number; height: number }, stocks: StockSize[], width = 2970, height = 2100): PanelPageLayout[] {
  const area: DrawingBox = { x: 60, y: 100, width: width - 120, height: height - 170 };
  if (!stocks.length) return [{ wall: area, stocks: [] }];
  const choose = (items: StockSize[]) => {
    let best: { page: PanelPageLayout; score: number; stockScale: number; wallScale: number } | undefined;
    for (const sideBySide of [false, true]) {
      for (let portion = 0.36; portion <= 0.66; portion += 0.025) {
        const wallBox = { ...area };
        const stockBox = { ...area };
        if (sideBySide) {
          wallBox.width = area.width * portion;
          stockBox.x += wallBox.width + 24; stockBox.width -= wallBox.width + 24;
        } else {
          wallBox.height = area.height * portion;
          stockBox.y += wallBox.height + 24; stockBox.height -= wallBox.height + 24;
        }
        const wallScale = Math.min((wallBox.width - WALL_PADDING.x * 2) / wall.width,
          (wallBox.height - WALL_PADDING.y * 2) / wall.height, 0.65);
        const packed = packStocks(items, stockBox);
        if (packed.boxes.length !== items.length) continue;
        const score = Math.min(wallScale, packed.scale) + Math.max(wallScale, packed.scale) * 0.12;
        if (!best || score > best.score) best = { page: { wall: wallBox, stocks: packed.boxes }, score, stockScale: packed.scale, wallScale };
      }
    }
    return best;
  };
  // Keep stock drawings legible; overflow receives full-sized continuation pages.
  const minimumWallScale = Math.min(0.28, (area.width - WALL_PADDING.x * 2) / wall.width * 0.8,
    (area.height - WALL_PADDING.y * 2) / wall.height * 0.8);
  let count = stocks.length;
  let first = choose(stocks);
  while (count > 1 && (!first || first.stockScale < 0.20 || first.wallScale < minimumWallScale)) first = choose(stocks.slice(0, --count));
  const pages: PanelPageLayout[] = [first?.page ?? { wall: area, stocks: [] }];
  let offset = first ? count : 0;
  while (offset < stocks.length) {
    let count = stocks.length - offset;
    let packed = packStocks(stocks.slice(offset), area);
    while (count > 1 && (packed.scale < 0.20 || !packed.boxes.length)) packed = packStocks(stocks.slice(offset, offset + --count), area);
    pages.push({ stocks: packed.boxes.map(item => ({ ...item, index: item.index + offset })) });
    offset += count;
  }
  return pages;
}

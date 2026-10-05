/** A rectangular subset of a preview sample, relative to its render region. */
export interface PtPreviewTile {
  firstColumn: number;
  firstRow: number;
  columns: number;
  rows: number;
}

const TILE_SIZE = 64;

/** Stable center-first ordering; timing may split a tile without changing sample coverage. */
export class PtPreviewTiles {
  private sizeKey = '';
  private tiles: Array<PtPreviewTile & { offset: number }> = [];

  plan(width: number, height: number, firstPixel: number, pixelBudget: number,
    dispatchPixels: number, maxDispatches: number): { bands: PtPreviewTile[]; nextPixel: number } {
    this.ensure(width, height);
    const bands: PtPreviewTile[] = [];
    let cursor = firstPixel, available = Math.max(1, Math.floor(pixelBudget));
    const limit = Math.max(1, Math.floor(dispatchPixels));
    for (const tile of this.tiles) {
      const end = tile.offset + tile.columns * tile.rows;
      if (cursor >= end) continue;
      while (cursor < end && available > 0 && bands.length < maxDispatches) {
        const local = cursor - tile.offset;
        const row = Math.floor(local / tile.columns), column = local % tile.columns;
        const pixels = Math.min(available, limit);
        const columns = Math.min(tile.columns - column, pixels);
        const rows = column === 0 && columns === tile.columns
          ? Math.min(tile.rows - row, Math.floor(pixels / columns)) : 1;
        bands.push({ firstColumn: tile.firstColumn + column, firstRow: tile.firstRow + row, columns, rows });
        cursor += columns * rows;
        available -= columns * rows;
      }
      if (available <= 0 || bands.length >= maxDispatches) break;
    }
    return { bands, nextPixel: cursor < width * height ? cursor : 0 };
  }

  private ensure(width: number, height: number): void {
    const key = `${width}:${height}`;
    if (key === this.sizeKey) return;
    this.sizeKey = key;
    const tiles: Array<PtPreviewTile & { offset: number; distance: number }> = [];
    // Center the grid itself, so even the first tile contains the image center.
    const centerX = Math.floor((width - Math.min(width, TILE_SIZE)) / 2);
    const centerY = Math.floor((height - Math.min(height, TILE_SIZE)) / 2);
    const startX = centerX - Math.ceil(centerX / TILE_SIZE) * TILE_SIZE;
    const startY = centerY - Math.ceil(centerY / TILE_SIZE) * TILE_SIZE;
    for (let y = startY; y < height; y += TILE_SIZE) {
      for (let x = startX; x < width; x += TILE_SIZE) {
        const firstColumn = Math.max(0, x), firstRow = Math.max(0, y);
        const columns = Math.min(width, x + TILE_SIZE) - firstColumn;
        const rows = Math.min(height, y + TILE_SIZE) - firstRow;
        const dx = x - centerX, dy = y - centerY;
        tiles.push({ firstColumn, firstRow, columns, rows, offset: 0, distance: dx * dx + dy * dy });
      }
    }
    this.tiles = tiles.toSorted((a, b) => a.distance - b.distance || a.firstRow - b.firstRow || a.firstColumn - b.firstColumn);
    let offset = 0;
    for (const tile of this.tiles) { tile.offset = offset; offset += tile.columns * tile.rows; }
  }
}

import { gzipSync, strToU8, zipSync } from 'fflate';
import type { CellGrid } from './cellGrid';

export interface CellGridSvgOptions {
  fontFamily?: string;
  trueShape?: boolean;
}

function xml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function buildCellGridSvg(grid: CellGrid, options: CellGridSvgOptions = {}): string {
  const cellWidth = grid.sourceWidth / grid.columns;
  const cellHeight = grid.sourceHeight / grid.rows;
  const fontSize = cellHeight * 0.9;
  const family = (options.fontFamily ?? 'ui-monospace, monospace').replace(/<\/style/gi, 'style');
  const nodes: string[] = [];
  for (let row = 0; row < grid.rows; row++) {
    for (let column = 0; column < grid.columns; column++) {
      const cell = grid.cells[row]?.[column];
      if (!cell || cell.char === ' ' || cell.alpha <= 0.001) continue;
      const sizing = options.trueShape
        ? ''
        : ` textLength="${cellWidth.toFixed(3)}" lengthAdjust="spacingAndGlyphs"`;
      nodes.push(
        `<text x="${((column + 0.5) * cellWidth).toFixed(3)}" y="${((row + 0.5) * cellHeight).toFixed(3)}" fill="${cell.color}" fill-opacity="${cell.alpha.toFixed(4)}"${sizing}>${xml(cell.char)}</text>`,
      );
    }
  }
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${grid.sourceWidth} ${grid.sourceHeight}" width="${grid.sourceWidth}" height="${grid.sourceHeight}">`,
    `<defs><style><![CDATA[text{font-family:${family};font-size:${fontSize.toFixed(3)}px;text-anchor:middle;dominant-baseline:central}]]></style></defs>`,
    ...nodes,
    '</svg>',
  ].join('\n');
}

export function buildCellGridText(grid: CellGrid): string {
  return `${grid.text}\n`;
}

export async function gzipJson(value: unknown): Promise<Uint8Array<ArrayBuffer>> {
  const encoded = new TextEncoder().encode(JSON.stringify(value));
  if (typeof CompressionStream === 'undefined' || typeof Blob.prototype.stream !== 'function') {
    const compressed = gzipSync(encoded);
    const copy = new Uint8Array(new ArrayBuffer(compressed.byteLength));
    copy.set(compressed);
    return copy;
  }
  const stream = new Blob([encoded]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function copyBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  copy.set(bytes);
  return copy;
}

export async function buildCellGridWebPack(options: {
  basename: string;
  grid: CellGrid;
  svgOptions?: CellGridSvgOptions;
  trackingSidecar?: unknown;
}): Promise<Blob> {
  const basename = options.basename || 'glyph-artifact';
  // Normalize fflate's byte arrays into this window's realm. In embedded
  // runtimes a cross-realm Uint8Array can otherwise be mistaken for a nested
  // ZIP directory because fflate intentionally accepts both shapes.
  const files: Record<string, Uint8Array<ArrayBuffer>> = {
    [`${basename}.svg`]: copyBytes(strToU8(buildCellGridSvg(options.grid, options.svgOptions))),
    [`${basename}.txt`]: copyBytes(strToU8(buildCellGridText(options.grid))),
    [`${basename}.manifest.json`]: copyBytes(strToU8(JSON.stringify({
      format: 'masterselects-cell-grid-v1',
      columns: options.grid.columns,
      rows: options.grid.rows,
      sourceWidth: options.grid.sourceWidth,
      sourceHeight: options.grid.sourceHeight,
    }, null, 2))),
  };
  if (options.trackingSidecar !== undefined) {
    files[`${basename}.tracking.json.gz`] = await gzipJson(options.trackingSidecar);
  }
  const zipped = zipSync(files, { level: 6 });
  return new Blob([copyBytes(zipped)], { type: 'application/zip' });
}

export function downloadArtifact(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

import { renderHostPort } from '../../services/render/renderHostPort';
import { resolveAsciiRamp } from './asciiRamps';

export interface CellGridCell {
  char: string;
  color: string;
  tone: number;
  alpha: number;
}
export interface CellGrid {
  cells: CellGridCell[][];
  columns: number;
  rows: number;
  aspectRatio: number;
  outputWidth: number;
  outputHeight: number;
  sourceWidth: number;
  sourceHeight: number;
  text: string;
}

export interface CellGridOptions {
  columns?: number;
  cellAspectRatio?: number;
  rampPreset?: string;
  customRamp?: string;
  invert?: boolean;
  transparentSpace?: boolean;
}

function channelHex(value: number): string {
  return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
}

export function buildCellGridFromPixels(
  pixels: Uint8ClampedArray,
  sourceWidth: number,
  sourceHeight: number,
  options: CellGridOptions = {},
): CellGrid {
  if (pixels.byteLength !== sourceWidth * sourceHeight * 4) {
    throw new Error('Cell grid pixel buffer does not match its source dimensions');
  }
  const columns = Math.max(1, Math.min(sourceWidth, Math.round(options.columns ?? 96)));
  const cellAspectRatio = Math.max(0.1, options.cellAspectRatio ?? 0.55);
  const rows = Math.max(1, Math.round(columns * (sourceHeight / sourceWidth) * cellAspectRatio));
  const ramp = Array.from(resolveAsciiRamp(options.rampPreset ?? 'standard', options.customRamp));
  const cells: CellGridCell[][] = [];

  for (let row = 0; row < rows; row++) {
    const gridRow: CellGridCell[] = [];
    const sourceY = Math.min(sourceHeight - 1, Math.floor((row + 0.5) / rows * sourceHeight));
    for (let column = 0; column < columns; column++) {
      const sourceX = Math.min(sourceWidth - 1, Math.floor((column + 0.5) / columns * sourceWidth));
      const offset = (sourceY * sourceWidth + sourceX) * 4;
      const red = pixels[offset];
      const green = pixels[offset + 1];
      const blue = pixels[offset + 2];
      const alpha = pixels[offset + 3] / 255;
      const tone = (red * 0.2126 + green * 0.7152 + blue * 0.0722) / 255;
      const mapped = options.invert ? 1 - tone : tone;
      const char = options.transparentSpace && alpha < 0.02
        ? ' '
        : ramp[Math.min(ramp.length - 1, Math.floor(mapped * ramp.length))] ?? ' ';
      gridRow.push({
        char,
        color: `#${channelHex(red)}${channelHex(green)}${channelHex(blue)}`,
        tone,
        alpha,
      });
    }
    cells.push(gridRow);
  }
  const outputWidth = columns;
  const outputHeight = rows / cellAspectRatio;
  return {
    cells,
    columns,
    rows,
    aspectRatio: outputWidth / outputHeight,
    outputWidth,
    outputHeight,
    sourceWidth,
    sourceHeight,
    text: cells.map((row) => row.map((cell) => cell.char).join('')).join('\n'),
  };
}

export async function readActiveCellGrid(options: CellGridOptions = {}): Promise<CellGrid | null> {
  const pixels = await renderHostPort.readPixels();
  const { width, height } = renderHostPort.getOutputDimensions();
  if (!pixels || width <= 0 || height <= 0) return null;
  return buildCellGridFromPixels(pixels, width, height, options);
}

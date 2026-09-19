export interface ScalarField {
  width: number;
  height: number;
  values: Float32Array;
}
export interface QuadtreeCell {
  x: number;
  y: number;
  width: number;
  height: number;
  mean: number;
  depth: number;
}

export interface LineSegment {
  from: [number, number];
  to: [number, number];
}

function sample(field: ScalarField, x: number, y: number): number {
  const px = Math.max(0, Math.min(field.width - 1, x));
  const py = Math.max(0, Math.min(field.height - 1, y));
  return field.values[py * field.width + px] ?? 0;
}

export function buildAdaptiveQuadtree(
  field: ScalarField,
  varianceThreshold = 0.04,
  maxDepth = 7,
): QuadtreeCell[] {
  const leaves: QuadtreeCell[] = [];
  const visit = (x: number, y: number, width: number, height: number, depth: number) => {
    let sum = 0;
    let sumSquares = 0;
    let count = 0;
    for (let py = y; py < Math.min(field.height, y + height); py++) {
      for (let px = x; px < Math.min(field.width, x + width); px++) {
        const value = sample(field, px, py);
        sum += value;
        sumSquares += value * value;
        count++;
      }
    }
    const mean = count ? sum / count : 0;
    const variance = count ? sumSquares / count - mean * mean : 0;
    if (depth >= maxDepth || width <= 1 || height <= 1 || variance <= varianceThreshold) {
      leaves.push({ x, y, width, height, mean, depth });
      return;
    }
    const leftWidth = Math.max(1, Math.floor(width / 2));
    const topHeight = Math.max(1, Math.floor(height / 2));
    visit(x, y, leftWidth, topHeight, depth + 1);
    visit(x + leftWidth, y, width - leftWidth, topHeight, depth + 1);
    visit(x, y + topHeight, leftWidth, height - topHeight, depth + 1);
    visit(x + leftWidth, y + topHeight, width - leftWidth, height - topHeight, depth + 1);
  };
  visit(0, 0, field.width, field.height, 0);
  return leaves;
}

export function marchingSquares(field: ScalarField, threshold: number): LineSegment[] {
  const segments: LineSegment[] = [];
  for (let y = 0; y < field.height - 1; y++) {
    for (let x = 0; x < field.width - 1; x++) {
      const mask = (sample(field, x, y) >= threshold ? 1 : 0)
        | (sample(field, x + 1, y) >= threshold ? 2 : 0)
        | (sample(field, x + 1, y + 1) >= threshold ? 4 : 0)
        | (sample(field, x, y + 1) >= threshold ? 8 : 0);
      const top: [number, number] = [x + 0.5, y];
      const right: [number, number] = [x + 1, y + 0.5];
      const bottom: [number, number] = [x + 0.5, y + 1];
      const left: [number, number] = [x, y + 0.5];
      const table: Partial<Record<number, Array<[typeof top, typeof top]>>> = {
        1: [[left, top]], 2: [[top, right]], 3: [[left, right]], 4: [[right, bottom]],
        5: [[left, top], [right, bottom]], 6: [[top, bottom]], 7: [[left, bottom]],
        8: [[bottom, left]], 9: [[top, bottom]], 10: [[top, right], [bottom, left]],
        11: [[right, bottom]], 12: [[left, right]], 13: [[top, right]], 14: [[left, top]],
      };
      for (const [from, to] of table[mask] ?? []) segments.push({ from, to });
    }
  }
  return segments;
}

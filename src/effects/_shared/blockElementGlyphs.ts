// Block Elements (U+2580–U+259F) as exact shapes that fill the whole atlas tile. A font draws them no
// wider than its advance, so a ramp of blocks showed narrow bars with gaps; drawn as shapes, neighbouring
// cells join into a solid mosaic, whatever font is picked.

/** A filled rectangle as fractions of the tile: [left, top, right, bottom]. */
export type BlockRect = readonly [number, number, number, number];

const FULL: BlockRect = [0, 0, 1, 1];
const QUADRANT = {
  upperLeft: [0, 0, 0.5, 0.5], upperRight: [0.5, 0, 1, 0.5], lowerLeft: [0, 0.5, 0.5, 1], lowerRight: [0.5, 0.5, 1, 1],
} as const satisfies Record<string, BlockRect>;

/** 4 × 4 ordered-dither thresholds: the shades fill the squares below 4 (░), 8 (▒) and 12 (▓) of 16. */
const BAYER_4 = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];

function shade(level: number): BlockRect[] {
  const rects: BlockRect[] = [];
  BAYER_4.forEach((row, y) => row.forEach((threshold, x) => {
    if (threshold < level) rects.push([x / 4, y / 4, (x + 1) / 4, (y + 1) / 4]);
  }));
  return rects;
}

const lower = (eighths: number): BlockRect => [0, 1 - eighths / 8, 1, 1];
const left = (eighths: number): BlockRect => [0, 0, eighths / 8, 1];

const SHAPES = new Map<string, readonly BlockRect[]>([
  ['▀', [[0, 0, 1, 0.5]]],
  ['▁', [lower(1)]], ['▂', [lower(2)]], ['▃', [lower(3)]], ['▄', [lower(4)]],
  ['▅', [lower(5)]], ['▆', [lower(6)]], ['▇', [lower(7)]], ['█', [FULL]],
  ['▉', [left(7)]], ['▊', [left(6)]], ['▋', [left(5)]], ['▌', [left(4)]],
  ['▍', [left(3)]], ['▎', [left(2)]], ['▏', [left(1)]],
  ['▐', [[0.5, 0, 1, 1]]],
  ['░', shade(4)], ['▒', shade(8)], ['▓', shade(12)],
  ['▔', [[0, 0, 1, 1 / 8]]], ['▕', [[7 / 8, 0, 1, 1]]],
  ['▖', [QUADRANT.lowerLeft]], ['▗', [QUADRANT.lowerRight]], ['▘', [QUADRANT.upperLeft]],
  ['▙', [QUADRANT.upperLeft, QUADRANT.lowerLeft, QUADRANT.lowerRight]],
  ['▚', [QUADRANT.upperLeft, QUADRANT.lowerRight]],
  ['▛', [QUADRANT.upperLeft, QUADRANT.upperRight, QUADRANT.lowerLeft]],
  ['▜', [QUADRANT.upperLeft, QUADRANT.upperRight, QUADRANT.lowerRight]],
  ['▝', [QUADRANT.upperRight]],
  ['▞', [QUADRANT.upperRight, QUADRANT.lowerLeft]],
  ['▟', [QUADRANT.upperRight, QUADRANT.lowerLeft, QUADRANT.lowerRight]],
]);

/** The rectangles a Block Element fills in its tile, or undefined for every other character (drawn from the font). */
export function blockElementRects(glyph: string): readonly BlockRect[] | undefined {
  return SHAPES.get(glyph);
}

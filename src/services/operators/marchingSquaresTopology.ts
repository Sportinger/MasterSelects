export type MarchingSquaresOccupancy = 0 | 1;
export type MarchingSquaresPoint = readonly [number, number];
export interface MarchingSquaresTopologyResult {
  readonly a: MarchingSquaresPoint; readonly b: MarchingSquaresPoint;
  readonly c: MarchingSquaresPoint; readonly d: MarchingSquaresPoint;
  readonly count: 0 | 1 | 2;
}

/** Pure reference for the shared fixed marching-squares topology lookup.
 * Inputs are binary classifications; tone sampling and edge interpolation are
 * intentionally owned by the surrounding generic graph. */
export function marchingSquaresTopology(
  occupancy: readonly [MarchingSquaresOccupancy, MarchingSquaresOccupancy, MarchingSquaresOccupancy, MarchingSquaresOccupancy],
  edges: { readonly top: MarchingSquaresPoint; readonly right: MarchingSquaresPoint;
    readonly bottom: MarchingSquaresPoint; readonly left: MarchingSquaresPoint },
): MarchingSquaresTopologyResult {
  if (occupancy.some(value => value !== 0 && value !== 1)) throw new Error('Marching-squares occupancy must be binary.');
  const mask = occupancy[0] | occupancy[1] << 1 | occupancy[2] << 2 | occupancy[3] << 3;
  let a = edges.top, b = edges.top, c = edges.top, d = edges.top, count: 0 | 1 | 2 = 0;
  switch (mask) {
    case 1: case 14: a = edges.left; b = edges.top; count = 1; break;
    case 2: case 13: a = edges.top; b = edges.right; count = 1; break;
    case 3: case 12: a = edges.left; b = edges.right; count = 1; break;
    case 4: case 11: a = edges.right; b = edges.bottom; count = 1; break;
    case 5: a = edges.left; b = edges.top; c = edges.right; d = edges.bottom; count = 2; break;
    case 6: case 9: a = edges.top; b = edges.bottom; count = 1; break;
    case 7: case 8: a = edges.left; b = edges.bottom; count = 1; break;
    case 10: a = edges.top; b = edges.right; c = edges.bottom; d = edges.left; count = 2; break;
  }
  return { a, b, c, d, count };
}

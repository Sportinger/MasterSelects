import type { SceneCutPoint } from '../../types/sceneCutAnalysis';

export function isSceneCutTimestampInSourceRange(
  timestamp: number,
  inPoint: number,
  outPoint: number,
): boolean {
  return Number.isFinite(timestamp) &&
    Number.isFinite(inPoint) &&
    Number.isFinite(outPoint) &&
    timestamp > inPoint &&
    timestamp < outPoint;
}

export function countSceneCutsInSourceRange(
  cuts: readonly SceneCutPoint[] | undefined,
  inPoint: number,
  outPoint: number,
): number {
  if (!cuts?.length || outPoint <= inPoint) return 0;
  return cuts.reduce(
    (count, cut) => count + (
      isSceneCutTimestampInSourceRange(cut.timestamp, inPoint, outPoint) ? 1 : 0
    ),
    0,
  );
}

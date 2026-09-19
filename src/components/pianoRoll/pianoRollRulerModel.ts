const RULER_LANE_HEIGHT = 30;

export const PART_BORDER_COLOR = '#3f7d6f';

export function pianoRollRulerHeight(laneCount: number): number {
  return RULER_LANE_HEIGHT * laneCount + (laneCount - 1);
}

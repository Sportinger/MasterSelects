const TRIM_ANCHOR_EPSILON = 0.0001;
const OPACITY_EDGE_EPSILON = 0.01;

export interface KeyframeTrimWindow {
  startTime: number;
  duration: number;
  inPoint: number;
  outPoint: number;
}

function getOpacityEdgeAnchorIndexes<T extends { time: number; property?: string }>(
  keyframes: readonly T[],
  duration: number,
  treatAllAsOpacity: boolean,
): { start: Set<number>; end: Set<number> } {
  const opacity = keyframes
    .map((keyframe, index) => ({ keyframe, index }))
    .filter(({ keyframe }) => treatAllAsOpacity || keyframe.property === 'opacity')
    .toSorted((left, right) => left.keyframe.time - right.keyframe.time);
  const start = new Set<number>();
  const end = new Set<number>();
  if (opacity.length < 2) return { start, end };

  if (Math.abs(opacity[0].keyframe.time) <= OPACITY_EDGE_EPSILON) {
    opacity.slice(0, opacity.length >= 4 ? 2 : 1).forEach(({ index }) => start.add(index));
  }
  if (Math.abs(opacity[opacity.length - 1].keyframe.time - duration) <= OPACITY_EDGE_EPSILON) {
    opacity.slice(opacity.length >= 4 ? -2 : -1).forEach(({ index }) => end.add(index));
  }
  return { start, end };
}

/**
 * Retimes keyframes for a clip edge trim. Ordinary keyframes and interior
 * opacity points stay at their composition time. The leading opacity pair
 * follows the clip start, while the trailing pair follows the clip end.
 */
export function retimeKeyframesForEdgeTrim<T extends { time: number; property?: string }>(
  keyframes: readonly T[],
  before: KeyframeTrimWindow,
  after: KeyframeTrimWindow,
  options: { treatAllAsOpacity?: boolean } = {},
): T[] {
  const durationDelta = after.duration - before.duration;
  const inPointDelta = after.inPoint - before.inPoint;
  const outPointDelta = after.outPoint - before.outPoint;
  const isEdgeTrim = Math.abs(durationDelta) > TRIM_ANCHOR_EPSILON && (
    Math.abs(inPointDelta) > TRIM_ANCHOR_EPSILON ||
    Math.abs(outPointDelta) > TRIM_ANCHOR_EPSILON
  );
  if (!isEdgeTrim) return [...keyframes];

  const startDelta = after.startTime - before.startTime;
  const opacityAnchors = getOpacityEdgeAnchorIndexes(
    keyframes,
    before.duration,
    options.treatAllAsOpacity === true,
  );
  return keyframes.map((keyframe, index) => {
    let time = keyframe.time - startDelta;
    if (opacityAnchors.start.has(index)) {
      time = keyframe.time;
    } else if (opacityAnchors.end.has(index)) {
      time = after.duration - (before.duration - keyframe.time);
    }
    return { ...keyframe, time };
  });
}

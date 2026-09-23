/** Size the idle source-frame neighborhood to fit its share of the CPU cache. */
export function getScrubPreloadWindow(options: {
  targetFrame: number;
  lastFrame: number;
  ramBytes: number;
  frameBytes: number;
  sourceCount: number;
  isDragging: boolean;
}): { start: number; end: number } {
  const { targetFrame, lastFrame, ramBytes, frameBytes, sourceCount, isDragging } = options;
  const baselineAhead = isDragging ? 48 : 24;
  const baselineBehind = isDragging ? 24 : 12;
  const capacity = frameBytes > 0 && ramBytes > 0 && !isDragging
    ? Math.max(0, Math.min(Math.floor(10000 / Math.max(1, sourceCount)),
      Math.floor(ramBytes / Math.max(1, sourceCount) / frameBytes) - 2))
    : 0;
  const count = Math.max(baselineAhead + baselineBehind + 1, capacity);
  const behind = capacity > baselineAhead + baselineBehind + 1
    ? Math.floor((count - 1) / 3) : baselineBehind;
  // Shift unused capacity at source boundaries into the remaining direction.
  const end = Math.min(lastFrame, Math.max(0, targetFrame - behind) + count - 1);
  const start = Math.max(0, Math.min(targetFrame - behind, end - count + 1));
  return { start, end };
}

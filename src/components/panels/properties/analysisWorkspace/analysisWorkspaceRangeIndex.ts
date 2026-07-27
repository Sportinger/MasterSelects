export interface AnalysisWorkspaceIndexedRange {
  start: number;
  end: number;
}

function overlaps(left: AnalysisWorkspaceIndexedRange, right: AnalysisWorkspaceIndexedRange): boolean {
  return left.start < right.end && right.start < left.end;
}

/**
 * Partitions sorted source-time events with one forward sweep.  An event that
 * legitimately crosses a scene boundary is returned for every overlapping
 * scene, but events that cannot overlap are discarded permanently.
 */
export function partitionIndexedRanges<T>(
  scenes: readonly AnalysisWorkspaceIndexedRange[],
  entries: readonly { value: T; range: AnalysisWorkspaceIndexedRange }[],
): readonly (readonly T[])[] {
  const orderedScenes = scenes.map((scene, index) => ({ scene, index }))
    .toSorted((left, right) => left.scene.start - right.scene.start || left.scene.end - right.scene.end);
  const output: T[][] = scenes.map(() => []);
  let cursor = 0;
  let active: readonly { value: T; range: AnalysisWorkspaceIndexedRange }[] = [];

  for (const { scene, index } of orderedScenes) {
    while (cursor < entries.length && entries[cursor].range.start < scene.end) {
      active = [...active, entries[cursor]];
      cursor += 1;
    }
    active = active.filter(entry => entry.range.end > scene.start);
    output[index] = active.filter(entry => overlaps(entry.range, scene)).map(entry => entry.value);
  }
  return output;
}

export function normalizedRanges(
  ranges: readonly AnalysisWorkspaceIndexedRange[] | undefined,
  bounds: AnalysisWorkspaceIndexedRange,
): readonly AnalysisWorkspaceIndexedRange[] {
  return (ranges ?? []).flatMap((range) => {
    if (!Number.isFinite(range.start) || !Number.isFinite(range.end)) return [];
    const start = Math.max(bounds.start, range.start);
    const end = Math.min(bounds.end, range.end);
    return end > start ? [{ start, end }] : [];
  }).toSorted((left, right) => left.start - right.start || left.end - right.end);
}

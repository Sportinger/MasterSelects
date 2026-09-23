interface Sample { at: number; time: number }
const samples = new Map<string, Sample[]>();

/** Count completed effect images, not merely advancing playheads or raw video frames. */
export function recordSlitScanPresentation(id: string, time: number) {
  const list = samples.get(id) ?? [];
  if (list.at(-1)?.time === time) return;
  list.push({ at: performance.now(), time });
  if (list.length > 120) list.shift();
  samples.delete(id); samples.set(id, list);
  if (samples.size > 32) samples.delete(samples.keys().next().value!);
}

export function slitScanPlaybackDiagnostics() {
  const now = performance.now();
  return [...samples].map(([effectId, list]) => {
    const recent = list.filter(sample => sample.at >= now - 5000);
    const last = list.at(-1)!;
    return { effectId, lastTimelineTime: last.time, ageMs: Math.round(now - last.at),
      completedImagesLast5s: recent.length };
  });
}

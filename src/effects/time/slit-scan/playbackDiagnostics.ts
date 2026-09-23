import { getTemporalStatus } from '../temporalResourcePreparation';

interface Sample { at: number; time: number }
const samples = new Map<string, Sample[]>();
const requested = new Map<string, number>();

export function recordSlitScanRequest(id: string, time: number) {
  requested.delete(id); requested.set(id, time);
  if (requested.size > 32) requested.delete(requested.keys().next().value!);
}

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
  return [...new Set([...requested.keys(), ...samples.keys()])].map(effectId => {
    const list = samples.get(effectId) ?? [];
    const recent = list.filter(sample => sample.at >= now - 5000);
    const last = list.at(-1);
    return { effectId, status: getTemporalStatus(effectId), requestedTime: requested.get(effectId),
      lastTimelineTime: last?.time, ageMs: last ? Math.round(now - last.at) : null,
      completedImagesLast5s: recent.length };
  });
}

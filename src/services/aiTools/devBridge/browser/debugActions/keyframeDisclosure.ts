import { flushSync } from 'react-dom';
import { useTimelineStore } from '../../../../../stores/timeline';
import { measureJsCpuProfile } from './jsCpuProfile';

/** Measure the disclosure store action, React commit and following paint, without
 * including bridge transport or tool preview capture in the reported duration. */
export async function measureKeyframeDisclosure(args: Record<string, unknown>) {
  if (document.visibilityState !== 'visible') return { success: false, error: 'Keep the editor visible for paint timing' };
  if (!document.querySelector('.track-header')) return { success: false, error: 'Wait for the timeline to mount' };
  const trackId = String(args.trackId ?? '');
  const state = useTimelineStore.getState();
  if (!state.tracks.some(track => track.id === trackId)) return { success: false, error: 'Unknown track' };
  const wasExpanded = state.expandedTracks.has(trackId);
  const clipId = typeof args.clipId === 'string' ? args.clipId : undefined;
  if (clipId && !state.clips.some(clip => clip.id === clipId && clip.trackId === trackId)) {
    return { success: false, error: 'Unknown clip on track' };
  }
  const selectedIds = [...state.selectedClipIds];
  const paint = () => new Promise<boolean>(resolve => {
    let frame = 0;
    const timeout = window.setTimeout(() => { cancelAnimationFrame(frame); resolve(false); }, 1500);
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => { clearTimeout(timeout); resolve(document.visibilityState === 'visible'); });
    });
  });
  const measurements: Array<{ expanded: boolean; commitMs: number; paintedMs: number | null; diamonds: number; selected: string[] }> = [];
  try {
    const cpuPromise = args.profile === true ? measureJsCpuProfile({ durationMs: 500 }) : null;
    let selectionMs = 0;
    if (clipId) {
      const selectionStart = performance.now();
      flushSync(() => useTimelineStore.getState().selectClips([clipId]));
      selectionMs = performance.now() - selectionStart;
      await paint();
    }
    for (const expanded of [false, true, false, true]) {
      const start = performance.now();
      flushSync(() => {
        if (useTimelineStore.getState().expandedTracks.has(trackId) !== expanded) {
          useTimelineStore.getState().toggleTrackExpanded(trackId);
        }
      });
      const commitMs = performance.now() - start;
      const painted = await paint();
      measurements.push({ expanded, commitMs, paintedMs: painted ? performance.now() - start : null,
        diamonds: document.querySelectorAll('.keyframe-diamond').length,
        selected: [...useTimelineStore.getState().selectedClipIds] });
    }
    return { success: true, data: { measurements, selectionMs, keyframeCount: clipId ? state.clipKeyframes.get(clipId)?.length : null,
      cpu: await cpuPromise, visibility: document.visibilityState } };
  } finally {
    if (useTimelineStore.getState().expandedTracks.has(trackId) !== wasExpanded) {
      useTimelineStore.getState().toggleTrackExpanded(trackId);
    }
    if (clipId) useTimelineStore.getState().selectClips(selectedIds);
  }
}

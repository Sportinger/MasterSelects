import type { ClipAudioAnalysisJobPhase } from '../../../types/audio';
import { updateClipAudioAnalysisJobState } from '../../../services/audio/clipAudioAnalysisJobs';
import { updateDerivedTimelineClips } from '../revisionMiddleware';

interface ProgressUpdate { jobId: string; progress: number; phase: ClipAudioAnalysisJobPhase; message?: string }
const state: { pending: Map<string, ProgressUpdate>; timer?: ReturnType<typeof setTimeout> } =
  import.meta.hot?.data?.progressState ?? { pending: new Map() };
if (import.meta.hot) {
  import.meta.hot.dispose(data => { data.progressState = state; });
  import.meta.hot.accept();
}

function flush(): void {
  state.timer = undefined;
  const updates = new Map(state.pending);
  state.pending.clear();
  updateDerivedTimelineClips(clips => {
    let changed = false;
    const next = clips.map(clip => {
      const update = updates.get(clip.id);
      const job = clip.audioAnalysisJob;
      if (!update || !job || job.jobId !== update.jobId) return clip;
      if (clip.waveformProgress === update.progress && job.phase === update.phase
        && (update.message === undefined || job.message === update.message)) return clip;
      changed = true;
      return { ...clip, waveformProgress: update.progress,
        audioAnalysisJob: updateClipAudioAnalysisJobState(job, update) };
    });
    return changed ? next : clips;
  });
}

/** Progress is tiny runtime state. Publish one shared update, rather than a
 * fresh multi-thousand-value preview and React render for every split clip.
 */
export function reportDerivedWaveformProgress(clipId: string, update: ProgressUpdate): void {
  state.pending.set(clipId, { ...update, progress: Math.round(update.progress) });
  if (state.timer === undefined) state.timer = setTimeout(flush, 250);
}

export function discardDerivedWaveformProgress(clipId: string, jobId: string): void {
  if (state.pending.get(clipId)?.jobId === jobId) state.pending.delete(clipId);
  if (!state.pending.size && state.timer !== undefined) {
    clearTimeout(state.timer);
    state.timer = undefined;
  }
}

// Moves clips from a memory-only waveform pyramid to the saved artifact once the project can
// store it again (after "Take over editing" or "Re-allow"). See deferredPyramidPersistence.
import { onDeferredPyramidPersisted } from '../../../services/audio/waveformPyramid/deferredPyramidPersistence';
import type { TimelineClip } from '../../../types/timeline';
import { updateDerivedTimelineClips } from '../revisionMiddleware';

let installed = false;

export function replaceSourceWaveformPyramidRef(
  clips: TimelineClip[],
  memoryRef: string,
  persistedRef: string,
): TimelineClip[] {
  let changed = false;
  const next = clips.map(clip => {
    const refs = clip.audioState?.sourceAnalysisRefs;
    if (!clip.audioState || refs?.waveformPyramidId !== memoryRef) return clip;
    changed = true;
    return { ...clip, audioState: { ...clip.audioState, sourceAnalysisRefs: { ...refs, waveformPyramidId: persistedRef } } };
  });
  return changed ? next : clips;
}

/** Installed when the first memory-only pyramid reaches a clip. */
export function ensureDeferredPyramidRefPatch(): void {
  if (installed) return;
  installed = true;
  onDeferredPyramidPersisted((memoryRef, persistedRef) => {
    updateDerivedTimelineClips(clips => replaceSourceWaveformPyramidRef(clips, memoryRef, persistedRef));
  });
}

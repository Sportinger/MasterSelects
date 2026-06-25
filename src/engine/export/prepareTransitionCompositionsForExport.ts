import { useMediaStore } from '../../stores/mediaStore';
import { useTimelineStore } from '../../stores/timeline';
import { compositionRenderer } from '../../services/compositionRenderer';

interface TransitionRefClip {
  transitionIn?: { compositionId?: string };
  transitionOut?: { compositionId?: string };
  nestedClips?: readonly TransitionRefClip[];
}

export async function prepareTransitionCompositionsForExport(): Promise<void> {
  const pending = new Set<string>();
  const seen = new Set<string>();
  const addClipRefs = (clips?: readonly TransitionRefClip[] | null) => {
    if (!clips) return;
    for (const clip of clips) {
      const outgoingId = clip.transitionOut?.compositionId;
      const incomingId = clip.transitionIn?.compositionId;
      if (outgoingId && !seen.has(outgoingId)) pending.add(outgoingId);
      if (incomingId && !seen.has(incomingId)) pending.add(incomingId);
      if (clip.nestedClips?.length) addClipRefs(clip.nestedClips);
    }
  };

  addClipRefs(useTimelineStore.getState().clips);
  const missing: string[] = [];
  while (pending.size > 0) {
    const compositionId = pending.values().next().value as string | undefined;
    if (!compositionId) continue;
    pending.delete(compositionId);
    if (seen.has(compositionId)) continue;
    seen.add(compositionId);

    const ready = await compositionRenderer.prepareComposition(compositionId);
    if (!ready) {
      missing.push(compositionId);
      continue;
    }

    const composition = useMediaStore.getState().compositions?.find((candidate) => candidate.id === compositionId);
    addClipRefs(composition?.timelineData?.clips);
  }

  if (missing.length > 0) {
    throw new Error(`Transition composition export preparation failed: ${missing.join(', ')}`);
  }
}

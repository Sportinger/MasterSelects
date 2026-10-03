import { useMediaStore } from '../../../../stores/mediaStore';
import { useTimelineStore } from '../../../../stores/timeline';

/** Use the existing switch queue and hydration promise before touching selection. */
export async function goToCompositionParentClip(compositionId: string, clipId: string): Promise<void> {
  if (!useMediaStore.getState().compositions.some(comp => comp.id === compositionId)) {
    throw new Error('The parent composition is no longer available.');
  }
  await useMediaStore.getState().openCompositionTab(compositionId, { skipAnimation: true });
  if (useMediaStore.getState().activeCompositionId !== compositionId) return;
  const timeline = useTimelineStore.getState();
  if (!timeline.clips.some(clip => clip.id === clipId)) {
    throw new Error('The parent clip is no longer available.');
  }
  timeline.selectClips([clipId], { revealProperties: false });
}

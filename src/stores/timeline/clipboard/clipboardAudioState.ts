import type { ClipboardClipData } from '../storeTypes/clipboardTypes';
import type { ClipAudioState } from '../../../types/audio';

/** Preserve audio edits while giving each pasted clip independent effect identities. */
export function createPastedClipAudioState(
  clip: ClipboardClipData,
  effectIdMap: Map<string, string>,
  createId: () => string,
  timeOffset: number,
): ClipAudioState | undefined {
  const source = clip.audioState ?? clip.audioAnalysisRefs;
  if (!source) return undefined;
  const state: ClipAudioState = structuredClone(source);
  for (const effect of state.effectStack ?? []) {
    const nextId = effectIdMap.get(effect.id) ?? createId();
    effectIdMap.set(effect.id, nextId);
    effect.id = nextId;
  }
  for (const edit of state.editStack ?? []) {
    edit.id = createId();
    for (const property of ['timelineStart', 'timelineEnd']) {
      if (typeof edit.params[property] === 'number') edit.params[property] += timeOffset;
    }
  }
  return state;
}

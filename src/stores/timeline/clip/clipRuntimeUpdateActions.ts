import { captureEditorAsyncMutation, type EditorAsyncMutation } from '../../../services/project/repository/transaction/editorAsyncMutation';
import { bindRuntimeToClip } from '../../../services/mediaRuntime/clipBindings';
import type { TimelineClip } from '../../../types/timeline';
import type { ClipActionContext } from './clipActionContext';

export function createClipRuntimeUpdateActions(context: ClipActionContext, options: { binding?: EditorAsyncMutation; file?: File } = {}) {
  const { get, set } = context;
  const timelineSessionId = get().timelineSessionId;
  const binding = options.binding ?? captureEditorAsyncMutation('Complete clip import', () => get().timelineSessionId === timelineSessionId);
  const updateClip = (id: string, updates: Partial<TimelineClip>) => {
    if (!binding.isCurrent()) return;
    const target = get().clips.find(clip => clip.id === id);
    if (!target || (options.file && target.file !== options.file)) return;
    binding.run(() => { set({
      clips: get().clips.map((clip) => {
        if (clip.id !== id) return clip;
        const updatedClip = { ...clip, ...updates };
        return updates.source
          ? bindRuntimeToClip(updatedClip, {
              file: updatedClip.file,
              mediaFileId: updatedClip.mediaFileId ?? updatedClip.source?.mediaFileId,
            })
          : updatedClip;
      }),
    });
    get().updateDuration(); });
  };
  const setClips = (updater: (clips: TimelineClip[]) => TimelineClip[]) => {
    if (!binding.isCurrent()) return;
    binding.run(() => {
      const clips = updater(get().clips);
      // A clip removed while it loads (the audio placeholder of a silent video) leaves the selection too.
      const ids = new Set(clips.map((clip) => clip.id));
      const selected = get().selectedClipIds;
      const kept = [...selected].filter((id) => ids.has(id));
      set(kept.length === selected.size ? { clips } : { clips, selectedClipIds: new Set(kept) });
    });
  };
  return { setClips, updateClip };
}

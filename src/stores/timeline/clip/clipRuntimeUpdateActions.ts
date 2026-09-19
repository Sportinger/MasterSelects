import { bindRuntimeToClip } from '../../../services/mediaRuntime/clipBindings';
import type { TimelineClip } from '../../../types/timeline';
import type { ClipActionContext } from './clipActionContext';

export function createClipRuntimeUpdateActions(context: ClipActionContext) {
  const { get, set } = context;
  const updateClip = (id: string, updates: Partial<TimelineClip>) => {
    set({
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
    get().updateDuration();
  };
  const setClips = (updater: (clips: TimelineClip[]) => TimelineClip[]) => {
    set({ clips: updater(get().clips) });
  };
  return { setClips, updateClip };
}

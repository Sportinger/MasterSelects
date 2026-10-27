import { captureEditorAsyncMutation, type EditorAsyncMutation } from '../../../services/project/repository/transaction/editorAsyncMutation';
import { bindRuntimeToClip } from '../../../services/mediaRuntime/clipBindings';
import type { TimelineClip } from '../../../types/timeline';
import type { ClipActionContext } from './clipActionContext';
import { Logger } from '../../../services/logger';

const log = Logger.create('ClipRuntimeUpdates');

export function createClipRuntimeUpdateActions(context: ClipActionContext, options: { binding?: EditorAsyncMutation; file?: File } = {}) {
  const { get, set } = context;
  const timelineSessionId = get().timelineSessionId;
  const binding = options.binding ?? captureEditorAsyncMutation('Complete clip import', () => get().timelineSessionId === timelineSessionId);
  // The import may run inside a caller's transaction (e.g. a phone sheet's edit session) that is
  // committed before background work such as the waveform finishes. Late runtime results for a clip
  // that is still there land in their own background revision (otherwise the clip kept
  // `waveformGenerating` forever and blocked every audio analysis of it). A system source keeps them
  // durable without forming an Undo step, cancelling a running Undo/Redo or replacing the redo branch,
  // so "Done = one undo step" still holds after the import.
  const detached = captureEditorAsyncMutation('Complete clip import', () => get().timelineSessionId === timelineSessionId,
    { joinTransaction: false, source: 'background' });
  const activeBinding = (): EditorAsyncMutation | null => (binding.isCurrent() ? binding : detached.isCurrent() ? detached : null);
  const updateClip = (id: string, updates: Partial<TimelineClip>) => {
    const active = activeBinding();
    if (!active) {
      log.debug('Runtime clip update dropped: the project or timeline changed', { id, fields: Object.keys(updates) });
      return;
    }
    const target = get().clips.find(clip => clip.id === id);
    if (!target || (options.file && target.file !== options.file)) {
      log.debug('Runtime clip update dropped: the clip is gone or holds another source', { id, fields: Object.keys(updates) });
      return;
    }
    active.run(() => { set({
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
    const active = activeBinding();
    if (!active) {
      log.debug('Runtime clip list update dropped: the project or timeline changed');
      return;
    }
    active.run(() => {
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

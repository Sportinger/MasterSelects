import type { TimelineClip, TimelineTrack } from '../../../../types/timeline';
import type { TimelineStore } from '../../../../stores/timeline/types';
import { bindRuntimeToClip } from '../../../mediaRuntime/clipBindings';
import { layerBuilder } from '../../../layerBuilder';
import { renderHostPort } from '../../../render/renderHostPort';
import { getRepositoryStore, withRepositoryHydration } from './storeMutationBoundary';

/** Reopen the same original without editing its authored source or invalidating audio analysis. */
export function restoreLinkedTimelineMedia(mediaFileId: string, file: File, url: string,
  media: { type?: string; hasAudio?: boolean } = {}): void {
  const store = getRepositoryStore('timeline');
  if (!store) return;
  const state = store.getState() as TimelineStore;
  const restoreTree = (clips: TimelineClip[], tracks: TimelineTrack[]): TimelineClip[] => {
    let changed = false;
    const restored = clips.map(clip => {
      let next = clip;
      if (clip.nestedClips) {
        const nestedClips = restoreTree(clip.nestedClips, clip.nestedTracks ?? []);
        if (nestedClips !== clip.nestedClips) next = { ...next, nestedClips };
      }
      if (clip.source?.mediaFileId === mediaFileId && (clip.needsReload || !clip.file || clip.file.size === 0)) {
        const type = tracks.find(track => track.id === clip.trackId)?.type === 'audio' ? 'audio' : clip.source.type;
        if (!(type === 'audio' && media.type === 'video' && media.hasAudio === false)) {
          next = bindRuntimeToClip({ ...next, file, needsReload: false, isLoading: false,
            source: { ...clip.source, type, ...(type === 'image' ? { imageUrl: url } : {}) } }, { file, mediaFileId });
        }
      }
      changed ||= next !== clip;
      return next;
    });
    return changed ? restored : clips;
  };
  const clips = restoreTree(state.clips, state.tracks);
  if (clips === state.clips) return;
  // One runtime patch per original, including nested and locked tracks. No user edit transaction.
  withRepositoryHydration(() => store.setState({ clips }));
  layerBuilder.invalidateCache();
  renderHostPort.requestNewFrameRender();
}

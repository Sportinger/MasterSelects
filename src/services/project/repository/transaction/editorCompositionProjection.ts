import type { TimelineStore } from '../../../../stores/timeline/types';
import type { MediaState } from '../../../../stores/mediaStore/types';
import { createSerializableTimelineState } from '../../../../stores/timeline/serialization/serializableTimelineState';
import { getRepositoryStore, withRepositoryHydration } from './storeMutationBoundary';

const FIELDS = ['tracks', 'duration', 'durationLocked', 'markers', 'masterAudioState', 'sharedSceneGraphs', 'tempoMap', 'rulerLanes', 'activeRulerLaneId', 'videoBakeRegions', 'inPoint', 'outPoint'] as const;
/** timelineData is a read projection of canonical edits, never a periodic second writer. */
export function projectTimelineMutationToComposition(before: TimelineStore, next: TimelineStore): void {
  const mediaStore = getRepositoryStore('media'), media = mediaStore?.getState() as MediaState | undefined;
  const owner = media?.compositions.find(comp => comp.id === media.activeCompositionId);
  if (!owner || !mediaStore || !media) return;
  const previousClips = new Map(before.clips.map(clip => [clip.id, clip]));
  const previousProjection = new Map((owner.timelineData?.clips ?? []).map(clip => [clip.id, clip]));
  const clips = next.clips.map(clip => {
    const unchanged = previousClips.get(clip.id) === clip && before.clipKeyframes.get(clip.id) === next.clipKeyframes.get(clip.id);
    const serial = previousProjection.get(clip.id);
    if (unchanged && serial) return serial;
    return createSerializableTimelineState({ ...next, tracks: [], clips: [clip], clipKeyframes: new Map([[clip.id, next.clipKeyframes.get(clip.id) ?? []]]), markers: [], videoBakeRegions: [], sharedSceneGraphs: undefined }).clips[0];
  });
  const shell = owner.timelineData ?? createSerializableTimelineState({ ...next, tracks: [], clips: [], markers: [], videoBakeRegions: [] });
  const timelineData = { ...shell, ...Object.fromEntries(FIELDS.map(field => [field, next[field]])), clips };
  withRepositoryHydration(() => mediaStore.setState({ compositions: media.compositions.map(comp => comp.id === owner.id ? { ...comp, duration: next.duration, timelineData } : comp) }));
}

import type { Composition, MediaState } from '../../../../stores/mediaStore/types';
import type { TimelineStore } from '../../../../stores/timeline/types';
import { createLoadStateGeneratedClip } from '../../../../stores/timeline/serialization/loadStateGeneratedClipRestore';
import { restoreLoadStateMediaClip } from '../../../../stores/timeline/serialization/loadStateMediaClipRestore';
import { restoreLoadStateCompositionClip } from '../../../../stores/timeline/serialization/loadStateCompositionClipRestore';
import { createLoadStateRestoreBuffer } from '../../../../stores/timeline/serialization/loadStateRestoreBuffer';
import { restoreLoadStateLinkedSpeedState } from '../../../../stores/timeline/serialization/loadStateLinkedSpeedRestore';
import { createDefaultRulerLaneState } from '../../../../timeline/tempo/rulerDefaults';
import { sanitizeTimelineParentRestoreTree } from '../../../motionDesign/structure/timelineParentRestoreAdapter';
import { getRepositoryStore } from './storeMutationBoundary';
import { RepositoryError } from '../contracts';
import { releaseClipTreeRuntimeBindings } from '../../../mediaRuntime/clipBindings';
import { isLinkedMediaDeferred } from '../../linkedMediaDemand';
import type { TimelineClip } from '../../../../types/timeline';

export interface StagedTimeline { state: Partial<TimelineStore>; activate(): void; abandon(): void; }
/** Fields derived from the clip's media only (source waveform, projected transcript, analysis, scenes). */
const MEDIA_DERIVED_CLIP_FIELDS = ['waveform', 'waveformChannels', 'transcript', 'transcriptStatus', 'transcriptProgress',
  'analysis', 'analysisStatus', 'analysisProgress', 'faceAnalysisStatus', 'faceAnalysisProgress', 'faceAnalysisMessage',
  'sceneDescriptions', 'sceneDescriptionStatus', 'sceneDescriptionProgress', 'sceneDescriptionMessage'] as const;

/** Keep media-derived fields across undo/redo and composition switches, so warmups and artifact projection do
 * not regenerate (and re-render) every clip after each revision. Only for the same clip on the same media. */
export function carryDerivedClipWaveforms(previousClips: readonly TimelineClip[], clips: TimelineClip[]): TimelineClip[] {
  const previous = new Map(previousClips.map(clip => [clip.id, clip]));
  const mediaOf = (clip: TimelineClip) => clip.mediaFileId ?? clip.source?.mediaFileId;
  return clips.map(clip => {
    const before = previous.get(clip.id);
    if (!before || clip.isComposition || !mediaOf(clip) || mediaOf(before) !== mediaOf(clip)) return clip;
    const carried: Partial<Record<(typeof MEDIA_DERIVED_CLIP_FIELDS)[number], unknown>> = {};
    for (const field of MEDIA_DERIVED_CLIP_FIELDS) if (clip[field] === undefined && before[field] !== undefined) carried[field] = before[field];
    return Object.keys(carried).length ? { ...clip, ...carried } as TimelineClip : clip;
  });
}
/** Existing parameterized restore codecs bind into a private buffer, never the visible store. */
export async function stageEditorTimeline(current: TimelineStore, media: MediaState, composition: Composition | undefined,
  signal: AbortSignal, publishRuntimePatch: (patch: Partial<TimelineStore>) => void, readRuntimeState: () => TimelineStore): Promise<StagedTimeline> {
  const data = composition?.timelineData;
  let active = false, valid = true;
  let state = {
    ...current, tracks: data?.tracks ?? [], clips: [], layers: [],
    clipKeyframes: new Map(), markers: data?.markers ?? [],
    duration: data?.duration ?? 60, durationLocked: data?.durationLocked ?? false,
    masterAudioState: data?.masterAudioState, sharedSceneGraphs: data?.sharedSceneGraphs, compositionGraph: data?.compositionGraph,
    ...createDefaultRulerLaneState(), tempoMap: data?.tempoMap ?? createDefaultRulerLaneState().tempoMap,
    rulerLanes: data?.rulerLanes ?? createDefaultRulerLaneState().rulerLanes,
    activeRulerLaneId: data?.activeRulerLaneId ?? createDefaultRulerLaneState().activeRulerLaneId,
    videoBakeRegions: data?.videoBakeRegions ?? [],
    isPlaying: false, isDraggingPlayhead: false,
    timelineSessionId: current.timelineSessionId + 1,
  } as TimelineStore;
  const pinnedSession = state.timelineSessionId;
  const isCurrentTimelineSession = () => valid && !signal.aborted && (!active || readRuntimeState().timelineSessionId === pinnedSession);
  const get = () => active ? readRuntimeState() : state;
  const set = (value: Partial<TimelineStore> | ((value: TimelineStore) => Partial<TimelineStore>)) => {
    if (!isCurrentTimelineSession()) return;
    const patch = typeof value === 'function' ? value(get()) : value;
    state = { ...state, ...patch };
    if (active) publishRuntimePatch(patch);
  };
  const buffer = createLoadStateRestoreBuffer(set);
  const mediaContext = { ...media, getActiveComposition: () => composition } as Parameters<typeof createLoadStateGeneratedClip>[0]['mediaStore'];
  try {
  for (const serializedClip of data?.clips ?? []) {
    if (!isCurrentTimelineSession()) throw new RepositoryError('cancelled', 'Timeline staging cancelled');
    if (serializedClip.keyframes?.length) state.clipKeyframes.set(serializedClip.id, serializedClip.keyframes);
    const clipIsCurrent = () => {
      if (!isCurrentTimelineSession()) return false;
      if (!active) return true;
      const clip = readRuntimeState().clips.find(value => value.id === serializedClip.id);
      const pinnedFile = media.files.find(file => file.id === serializedClip.mediaFileId)?.file;
      const liveFile = (getRepositoryStore('media')?.getState() as MediaState | undefined)?.files.find(file => file.id === serializedClip.mediaFileId)?.file;
      if (!serializedClip.isComposition && pinnedFile !== liveFile) return false;
      return !!clip && (serializedClip.isComposition ? clip.compositionId === serializedClip.compositionId :
        (clip.mediaFileId ?? clip.source?.mediaFileId) === serializedClip.mediaFileId && clip.source?.type === serializedClip.sourceType);
    };
    const compositionResult = await restoreLoadStateCompositionClip({ serializedClip, mediaStore: mediaContext,
      get, set, pushRestoredClip: buffer.push, flushRestoredClipBuffer: buffer.flush, patchRestoredClip: buffer.patch,
      pushRestoredNestedKeyframes: buffer.pushNestedKeyframes, isCurrentTimelineSession: clipIsCurrent,
      wakePreviewAfterRestore: () => {}, restoreSourceThumbnails: () => {} });
    if (compositionResult === 'stale') throw new RepositoryError('cancelled', 'Composition runtime staging became stale');
    if (compositionResult === 'handled') continue;
    const generated = await createLoadStateGeneratedClip({ serializedClip, mediaStore: mediaContext });
    if (generated) { buffer.push(generated); continue; }
    const result = await restoreLoadStateMediaClip({ serializedClip, mediaStore: mediaContext, set,
      pushRestoredClip: buffer.push, patchRestoredClip: buffer.patch, updateMediaFile: (id, patch) => {
        mediaContext.files = mediaContext.files.map(file => file.id === id ? { ...file, ...patch } : file);
      }, restoreSourceThumbnails: () => {}, isCurrentTimelineSession: clipIsCurrent, wakePreviewAfterRestore: () => {} });
    if (result === 'stale') throw new RepositoryError('cancelled', 'Media runtime staging became stale');
  }
  buffer.flush();
  const sanitized = sanitizeTimelineParentRestoreTree(composition?.id ?? 'timeline:active', state.clips);
  const deferTree = (clips: TimelineClip[]): TimelineClip[] => clips.map(clip => ({ ...clip,
    ...(isLinkedMediaDeferred(clip.source?.mediaFileId ?? clip.mediaFileId ?? '') ? { needsReload: false, isLoading: false } : {}),
    ...(clip.nestedClips ? { nestedClips: deferTree(clip.nestedClips) } : {}),
  }));
  set({ clips: carryDerivedClipWaveforms(current.clips, deferTree(sanitized.clips)) });
  set(restoreLoadStateLinkedSpeedState(state.clips, state.clipKeyframes));
  const clipIds = new Set(state.clips.map(clip => clip.id));
  const keyframeIds = new Set([...state.clipKeyframes.values()].flat().map(frame => frame.id));
  const selectedClipIds = new Set([...current.selectedClipIds].filter(id => clipIds.has(id)));
  const selectedKeyframeIds = new Set([...current.selectedKeyframeIds].filter(id => keyframeIds.has(id)));
  const content: Partial<TimelineStore> = { clips: state.clips, tracks: state.tracks, layers: [],
    clipKeyframes: state.clipKeyframes, markers: state.markers, duration: state.duration, durationLocked: state.durationLocked,
    masterAudioState: state.masterAudioState, sharedSceneGraphs: state.sharedSceneGraphs, compositionGraph: state.compositionGraph, tempoMap: state.tempoMap,
    rulerLanes: state.rulerLanes, activeRulerLaneId: state.activeRulerLaneId, videoBakeRegions: state.videoBakeRegions,
    inPoint: data?.inPoint ?? null, outPoint: data?.outPoint ?? null, selectedClipIds, selectedKeyframeIds,
    primarySelectedClipId: current.primarySelectedClipId && clipIds.has(current.primarySelectedClipId) ? current.primarySelectedClipId : null,
    propertiesSelection: null, timelineSessionId: pinnedSession, isPlaying: false };
  return { state: content, activate() { if (signal.aborted) throw new RepositoryError('cancelled', 'Timeline staging cancelled'); active = true; }, abandon() { valid = false; active = false; state.clips.forEach(releaseClipTreeRuntimeBindings); } };
  } catch (error) { valid = false; state.clips.forEach(releaseClipTreeRuntimeBindings); throw error; }
}

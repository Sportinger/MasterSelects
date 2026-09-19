import type { Composition, MediaFile } from '../../../stores/mediaStore/types';
import { DEFAULT_TRANSFORM } from '../../../stores/timeline/constants';
import {
  DEFAULT_TRANSITION_PLACEMENT,
  planTransition,
  type ActiveTransitionPlan,
} from '../../../stores/timeline/editOperations/transitionPlanner';
import type { TimelineClip, TimelineTrack } from '../../../stores/timeline/types';
import { hydrateTransitionCompositionTimeline } from '../../../services/layerBuilder/layerBuilderTransitionComposition';

function createPlaceholderFile(name: string): File {
  return typeof File !== 'undefined' ? new File([], name) : ({} as File);
}

function overlapsRange(start: number, duration: number, rangeStart: number, rangeEnd: number): boolean {
  return start < rangeEnd && start + duration > rangeStart;
}

/**
 * Creates preparation-only composition clips for baked transition media.
 * They are not added to the timeline; they only reserve and warm export decoders.
 */
export function collectBakedTransitionPreparationClips(input: {
  clips: readonly TimelineClip[];
  tracks: readonly TimelineTrack[];
  mediaFiles: readonly MediaFile[];
  mediaCompositions: readonly Composition[];
  rangeStart: number;
  rangeEnd: number;
}): TimelineClip[] {
  const {
    clips,
    tracks,
    mediaFiles,
    mediaCompositions,
    rangeStart,
    rangeEnd,
  } = input;
  const visibleVideoTrackIds = new Set(
    tracks
      .filter(track => track.type === 'video' && track.visible !== false)
      .map(track => track.id),
  );
  const mediaFileById = new Map(mediaFiles.map(file => [file.id, file]));
  const compositionById = new Map(mediaCompositions.map(composition => [composition.id, composition]));
  const preparationClips: TimelineClip[] = [];

  for (const outgoingClip of clips) {
    const transition = outgoingClip.transitionOut;
    if (!transition?.compositionId || !visibleVideoTrackIds.has(outgoingClip.trackId)) continue;

    const composition = compositionById.get(transition.compositionId);
    if (composition?.transitionComp?.templateType !== 'datamosh-baked') continue;
    const incomingClip = clips.find(candidate => candidate.id === transition.linkedClipId);
    if (!incomingClip || !visibleVideoTrackIds.has(incomingClip.trackId)) continue;

    const plan = planTransition({
      outgoingClip,
      incomingClip,
      transitionType: transition.type,
      requestedDuration: transition.duration,
      params: transition.params,
      placement: DEFAULT_TRANSITION_PLACEMENT,
      edgePolicy: 'hold',
      junctionTime: outgoingClip.startTime + outgoingClip.duration,
      bodyOffset: transition.offset ?? 0,
      getMediaDuration: mediaFileId => mediaFileById.get(mediaFileId)?.duration,
    });
    if (!plan || !overlapsRange(plan.bodyStart, plan.bodyEnd - plan.bodyStart, rangeStart, rangeEnd)) {
      continue;
    }

    const activeTransition: ActiveTransitionPlan = { outgoingClip, incomingClip, plan };
    const nestedTimeline = hydrateTransitionCompositionTimeline({
      composition,
      activeTransition,
      mediaFileById,
    });
    const duration = Math.max(0.0001, composition.timelineData?.duration ?? composition.duration);
    preparationClips.push({
      id: `transition-comp-export-preparation:${composition.id}`,
      trackId: outgoingClip.trackId,
      name: composition.name,
      file: createPlaceholderFile(composition.name),
      startTime: plan.bodyStart,
      duration,
      inPoint: 0,
      outPoint: duration,
      source: null,
      transform: structuredClone(DEFAULT_TRANSFORM),
      effects: [],
      isComposition: true,
      compositionId: composition.id,
      nestedClips: nestedTimeline.clips,
      nestedTracks: nestedTimeline.tracks,
      isLoading: false,
    });
  }

  return preparationClips;
}

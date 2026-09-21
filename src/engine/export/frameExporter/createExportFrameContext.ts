import type { useTimelineStore } from '../../../stores/timeline';
import type { useMediaStore } from '../../../stores/mediaStore';
import { createTransitionMediaDurationResolver } from '../../../stores/timeline/editOperations/transitionMediaDurationResolver';
import { createTransitionSourceClip, DEFAULT_TRANSITION_PLACEMENT, findActiveTransitionPlanForTrack,
  type ActiveTransitionPlan } from '../../../stores/timeline/editOperations/transitionPlanner';
import type { FrameContext } from '../types';

/** One immutable authored-state view and one set of lookup maps per exported frame. */
export function createExportFrameContext(time: number, fps: number, frameTolerance: number, width: number, height: number,
  state: ReturnType<typeof useTimelineStore.getState>, media: ReturnType<typeof useMediaStore.getState>): FrameContext {
  const clipsAtTime = state.getClipsAtTime(time);
  const trackMap = new Map(state.tracks.map(track => [track.id, track]));
  const clipsByTrack = new Map(clipsAtTime.map(clip => [clip.trackId, clip]));
  const transitionParticipantsByTrack = new Map<string, ActiveTransitionPlan>();
  const renderClipsById = new Map(clipsAtTime.map(clip => [clip.id, clip]));
  const getMediaDuration = createTransitionMediaDurationResolver(media.files);
  for (const track of state.tracks) {
    if (track.type !== 'video') continue;
    const transition = findActiveTransitionPlanForTrack({ clips: state.clips, trackId: track.id, time,
      placement: DEFAULT_TRANSITION_PLACEMENT, edgePolicy: 'hold', getMediaDuration });
    if (!transition) continue;
    transitionParticipantsByTrack.set(track.id, transition);
    const outgoing = createTransitionSourceClip(transition.outgoingClip, transition.plan.outgoing, time);
    const incoming = createTransitionSourceClip(transition.incomingClip, transition.plan.incoming, time);
    renderClipsById.set(outgoing.id, outgoing); renderClipsById.set(incoming.id, incoming);
  }
  return { time, fps, frameTolerance, outputWidth: width, outputHeight: height, clipsAtTime,
    renderClipsAtTime: [...renderClipsById.values()], compositionClips: state.clips,
    trackMap, clipsByTrack, transitionParticipantsByTrack, mediaFiles: media.files, mediaCompositions: media.compositions,
    getInterpolatedTransform: state.getInterpolatedTransform, getInterpolatedEffects: state.getInterpolatedEffects,
    getInterpolatedColorCorrection: state.getInterpolatedColorCorrection,
    getInterpolatedVectorAnimationSettings: state.getInterpolatedVectorAnimationSettings,
    getInterpolatedTextBounds: state.getInterpolatedTextBounds, getInterpolatedLightSettings: state.getInterpolatedLightSettings,
    getSourceTimeForClip: state.getSourceTimeForClip, getInterpolatedSpeed: state.getInterpolatedSpeed };
}

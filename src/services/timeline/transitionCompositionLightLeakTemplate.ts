import type { Keyframe } from '../../types/keyframes';
import type { CompositionTimelineData, SerializableClip, TimelineClip, TransitionOverlayClipDefinition } from '../../types/timeline';
import type { TimelineTransition, TransitionCompositionLink } from '../../types/timelineCore';
import type { TransitionPlan } from '../../stores/timeline/editOperations/transitionPlanner';
import { buildIncomingRevealMask } from './transitionCompositionMasks';
import { makeKeyframe, mergeGeneratedKeyframes, sliceGeneratedKeyframesForSegment } from './transitionCompositionKeyframes';
import { buildLinkedCoverageClips, getSerializableClip } from './transitionCompositionSourceClips';
import { getTransitionTemplateParamsKey, mergeTransitionMarkers } from './transitionCompositionRecipeTemplate';

const TRANSITION_TEMPLATE_VERSION = 2;

export function getTransitionColor(transition: TimelineTransition): string {
  const color = transition.params?.color;
  return typeof color === 'string' ? color : '#ffb36a';
}

export function buildMaterializedLightLeakTimelineData(input: {
  outgoingClip: TimelineClip;
  incomingClip: TimelineClip;
  transition: TimelineTransition;
  plan: TransitionPlan;
  serializableClips: readonly SerializableClip[];
}): { timelineData: CompositionTimelineData; link: Omit<TransitionCompositionLink, 'parentCompositionId'> } {
  const { outgoingClip, incomingClip, transition, plan, serializableClips } = input;
  const duration = Math.max(0.0001, transition.duration);
  const bodyStart = 0;
  const bodyEnd = duration;
  const outgoingTrackId = `transition-comp-track:${transition.id}:outgoing`;
  const incomingTrackId = `transition-comp-track:${transition.id}:incoming`;
  const overlayTrackId = `transition-comp-track:${transition.id}:overlay`;
  const outgoingClipId = `transition-comp:${transition.id}:outgoing`;
  const incomingClipId = `transition-comp:${transition.id}:incoming`;
  const overlayClipId = `transition-comp:${transition.id}:light-streak`;
  const baseOutgoing = getSerializableClip(outgoingClip, serializableClips);
  const baseIncoming = getSerializableClip(incomingClip, serializableClips);
  const overlayDefinition: TransitionOverlayClipDefinition = {
    pattern: 'light-leak',
    color: getTransitionColor(transition),
    widthRatio: 0.32,
    softness: 0.42,
    angle: 0.18,
  };
  const materializeOutgoingClip = (clip: SerializableClip): SerializableClip => {
    const outgoingKeyframes: Keyframe[] = [
      makeKeyframe(clip.id, 'opacity', 0, 1),
      makeKeyframe(clip.id, 'opacity', bodyStart, 1),
      makeKeyframe(clip.id, 'opacity', bodyEnd, 0.08, 'ease-in-out'),
    ];
    return {
      ...clip,
      keyframes: mergeGeneratedKeyframes(
        clip.keyframes,
        sliceGeneratedKeyframesForSegment(clip, outgoingKeyframes, clip.startTime, clip.duration),
      ),
    };
  };
  const materializeIncomingClip = (clip: SerializableClip): SerializableClip => {
    const revealMaskId = `${clip.id}:reveal-mask`;
    const revealMask = buildIncomingRevealMask(revealMaskId);
    const clipWithMask: SerializableClip = {
      ...clip,
      masks: [...(clip.masks ?? []), revealMask],
    };
    const incomingGeneratedKeyframes: Keyframe[] = [
      makeKeyframe(clip.id, 'opacity', 0, 0),
      makeKeyframe(clip.id, 'opacity', duration * 0.12, 0.18, 'ease-in'),
      makeKeyframe(clip.id, 'opacity', bodyEnd, 1, 'ease-out'),
      makeKeyframe(clip.id, `mask.${revealMaskId}.position.x` as Keyframe['property'], bodyStart, -0.62),
      makeKeyframe(clip.id, `mask.${revealMaskId}.position.x` as Keyframe['property'], bodyEnd, 0.78, 'ease-in-out'),
    ];
    return {
      ...clipWithMask,
      keyframes: mergeGeneratedKeyframes(
        clip.keyframes,
        sliceGeneratedKeyframesForSegment(
          clipWithMask,
          incomingGeneratedKeyframes,
          clip.startTime,
          clip.duration,
        ),
      ),
    };
  };
  const outgoingLinkedClips = buildLinkedCoverageClips({
    base: baseOutgoing,
    baseId: outgoingClipId,
    trackId: outgoingTrackId,
    nameSuffix: '[OUT linked]',
    participant: plan.outgoing,
    bodyStart: plan.bodyStart,
    duration,
    materialize: materializeOutgoingClip,
  });
  const incomingLinkedClips = buildLinkedCoverageClips({
    base: baseIncoming,
    baseId: incomingClipId,
    trackId: incomingTrackId,
    nameSuffix: '[IN linked]',
    participant: plan.incoming,
    bodyStart: plan.bodyStart,
    duration,
    materialize: materializeIncomingClip,
  });
  const overlayClip: SerializableClip = {
    id: overlayClipId,
    trackId: overlayTrackId,
    name: 'Light Streak',
    mediaFileId: '',
    startTime: 0,
    duration,
    inPoint: 0,
    outPoint: duration,
    sourceType: 'transition-overlay',
    naturalDuration: duration,
    transform: {
      opacity: 0,
      blendMode: 'screen',
      position: { x: -0.78, y: 0, z: 0 },
      scale: { x: 1.25, y: 1.25, z: 1 },
      rotation: { x: 0, y: 0, z: 0 },
    },
    effects: [],
    transitionOverlay: overlayDefinition,
    keyframes: [
      makeKeyframe(overlayClipId, 'opacity', 0, 0),
      makeKeyframe(overlayClipId, 'opacity', duration * 0.12, 0.35, 'ease-in'),
      makeKeyframe(overlayClipId, 'opacity', duration * 0.45, 0.85, 'ease-in-out'),
      makeKeyframe(overlayClipId, 'opacity', bodyEnd, 0.35, 'ease-out'),
      makeKeyframe(overlayClipId, 'opacity', duration, 0),
      makeKeyframe(overlayClipId, 'position.x', bodyStart, -0.78),
      makeKeyframe(overlayClipId, 'position.x', bodyEnd, 0.82, 'ease-in-out'),
    ],
  };

  return {
    link: {
      kind: 'transition-comp',
      parentTransitionId: transition.id,
      parentOutgoingClipId: outgoingClip.id,
      parentIncomingClipId: incomingClip.id,
      linkedOutgoingClipId: outgoingClipId,
      linkedIncomingClipId: incomingClipId,
      innerTransitionId: '',
      templateType: transition.type,
      templateVersion: TRANSITION_TEMPLATE_VERSION,
      templateParamsKey: getTransitionTemplateParamsKey(transition, outgoingClip, incomingClip),
      paddingBefore: 0,
      paddingAfter: 0,
      bodyStart,
      bodyEnd,
      materialized: true,
    },
    timelineData: {
      tracks: [
        { id: overlayTrackId, name: 'Light Streak', type: 'video', height: 72, muted: false, visible: true, solo: false },
        { id: incomingTrackId, name: 'Incoming masked', type: 'video', height: 96, muted: false, visible: true, solo: false },
        { id: outgoingTrackId, name: 'Outgoing', type: 'video', height: 96, muted: false, visible: true, solo: false },
      ],
      clips: [
        ...outgoingLinkedClips,
        ...incomingLinkedClips,
        overlayClip,
      ],
      playheadPosition: bodyStart,
      duration,
      durationLocked: true,
      zoom: 160,
      scrollX: 0,
      inPoint: bodyStart,
      outPoint: bodyEnd,
      loopPlayback: true,
      markers: mergeTransitionMarkers(undefined, transition.id, bodyStart, bodyEnd),
    },
  };
}

import type { Composition } from '../../stores/mediaStore/types';
import type {
  CompositionTimelineData,
  SerializableClip,
  SerializableMarker,
  TimelineClip,
  TransitionOverlayClipDefinition,
} from '../../types/timeline';
import type { ClipMask } from '../../types/masks';
import type { Keyframe } from '../../types/keyframes';
import type { TimelineTransition, TransitionCompositionLink } from '../../types/timelineCore';
import { getRuntimeTransition } from '../../transitions';
import {
  DEFAULT_TRANSITION_PLACEMENT,
  planTransition,
} from '../../stores/timeline/editOperations/transitionPlanner';
import { createTimelineTransitionMediaDurationResolver } from './timelineTransitionMediaDurations';
import { compositionRenderer } from '../compositionRenderer';

const WORK_PADDING_MIN_SECONDS = 0.35;
const WORK_PADDING_MAX_SECONDS = 1.5;
const WORK_PADDING_TRANSITION_RATIO = 0.35;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function getSourceType(clip: TimelineClip): SerializableClip['sourceType'] {
  return (clip.source?.type ?? 'video') as SerializableClip['sourceType'];
}

function serializeFallbackClip(clip: TimelineClip): SerializableClip {
  return {
    id: clip.id,
    trackId: clip.trackId,
    name: clip.name,
    mediaFileId: clip.source?.mediaFileId ?? clip.mediaFileId ?? '',
    signalAssetId: clip.signalAssetId,
    signalRefId: clip.signalRefId,
    signalRenderAdapterId: clip.signalRenderAdapterId,
    startTime: clip.startTime,
    duration: clip.duration,
    inPoint: clip.inPoint,
    outPoint: clip.outPoint,
    sourceType: getSourceType(clip),
    naturalDuration: clip.source?.naturalDuration,
    thumbnails: clip.thumbnails,
    linkedClipId: clip.linkedClipId,
    linkedGroupId: clip.linkedGroupId,
    videoState: clip.videoState ? clone(clip.videoState) : undefined,
    audioState: clip.audioState ? clone(clip.audioState) : undefined,
    waveform: clip.waveform,
    waveformChannels: clip.waveformChannels,
    transform: clone(clip.transform),
    effects: clone(clip.effects ?? []),
    colorCorrection: clip.colorCorrection ? clone(clip.colorCorrection) : undefined,
    nodeGraph: clip.nodeGraph ? clone(clip.nodeGraph) : undefined,
    masks: clip.masks ? clone(clip.masks) : undefined,
    transcript: clip.transcript ? clone(clip.transcript) : undefined,
    transcriptStatus: clip.transcriptStatus,
    analysis: clip.analysis ? clone(clip.analysis) : undefined,
    analysisStatus: clip.analysisStatus,
    reversed: clip.reversed,
    speed: clip.speed,
    preservesPitch: clip.preservesPitch,
    textProperties: clip.textProperties ? clone(clip.textProperties) : undefined,
    text3DProperties: clip.text3DProperties ? clone(clip.text3DProperties) : undefined,
    solidColor: clip.solidColor,
    transitionOverlay: clip.transitionOverlay ? clone(clip.transitionOverlay) : clip.source?.transitionOverlay ? clone(clip.source.transitionOverlay) : undefined,
    midiData: clip.midiData ? clone(clip.midiData) : undefined,
    vectorAnimationSettings: clip.source?.vectorAnimationSettings,
    mathScene: clip.mathScene ? clone(clip.mathScene) : undefined,
    motion: clip.motion ? clone(clip.motion) : undefined,
    transitionIn: clip.transitionIn ? clone(clip.transitionIn) : undefined,
    transitionOut: clip.transitionOut ? clone(clip.transitionOut) : undefined,
    is3D: clip.is3D,
    modelSequence: clip.source?.modelSequence,
    gaussianSplatSequence: clip.source?.gaussianSplatSequence,
    threeDEffectorsEnabled: clip.source?.threeDEffectorsEnabled,
    meshType: clip.meshType ?? clip.source?.meshType,
    cameraSettings: clip.source?.cameraSettings,
    splatEffectorSettings: clip.source?.splatEffectorSettings,
    gaussianBlendshapes: clip.source?.gaussianBlendshapes,
    gaussianSplatSettings: clip.source?.gaussianSplatSettings,
  };
}

function getSerializableClip(
  runtimeClip: TimelineClip,
  serializableClips: readonly SerializableClip[],
): SerializableClip {
  return clone(serializableClips.find((clip) => clip.id === runtimeClip.id) ?? serializeFallbackClip(runtimeClip));
}

function getWorkPadding(duration: number): number {
  return Math.min(
    WORK_PADDING_MAX_SECONDS,
    Math.max(WORK_PADDING_MIN_SECONDS, duration * WORK_PADDING_TRANSITION_RATIO),
  );
}

function getSourceDuration(clip: SerializableClip, fallbackClip: TimelineClip): number {
  const mediaDuration = clip.mediaFileId
    ? createTimelineTransitionMediaDurationResolver()(clip.mediaFileId)
    : undefined;
  return Math.max(
    clip.outPoint,
    clip.inPoint + clip.duration,
    fallbackClip.outPoint,
    mediaDuration ?? 0,
    clip.naturalDuration ?? 0,
  );
}

function buildInnerTransition(
  transition: TimelineTransition,
  linkedClipId: string,
  innerTransitionId: string,
): TimelineTransition {
  return {
    id: innerTransitionId,
    type: transition.type,
    duration: transition.duration,
    linkedClipId,
    ...(transition.params ? { params: clone(transition.params) } : {}),
  };
}

function retimeKeyframes(
  clip: SerializableClip,
  targetClipId: string,
  nextInPoint: number,
  nextDuration: number,
): SerializableClip['keyframes'] {
  const sourceShift = nextInPoint - clip.inPoint;
  return clip.keyframes
    ?.map((keyframe) => ({
      ...clone(keyframe),
      id: `${targetClipId}:${keyframe.id}`,
      clipId: targetClipId,
      time: keyframe.time - sourceShift,
    }))
    .filter((keyframe) => keyframe.time >= 0 && keyframe.time <= nextDuration);
}

function buildLinkedClip(input: {
  base: SerializableClip;
  id: string;
  trackId: string;
  nameSuffix: string;
  startTime: number;
  duration: number;
  inPoint: number;
  outPoint: number;
  transitionIn?: TimelineTransition;
  transitionOut?: TimelineTransition;
}): SerializableClip {
  const { base, id, trackId, nameSuffix, startTime, duration, inPoint, outPoint, transitionIn, transitionOut } = input;
  return {
    ...clone(base),
    id,
    trackId,
    name: `${base.name} ${nameSuffix}`,
    startTime,
    duration,
    inPoint,
    outPoint,
    linkedClipId: undefined,
    transitionIn,
    transitionOut,
    keyframes: retimeKeyframes(base, id, inPoint, duration),
  };
}

function getTransitionColor(transition: TimelineTransition): string {
  const color = transition.params?.color;
  return typeof color === 'string' ? color : '#ffb36a';
}

function makeKeyframe(
  clipId: string,
  property: Keyframe['property'],
  time: number,
  value: number,
  easing: Keyframe['easing'] = 'linear',
): Keyframe {
  return {
    id: `${clipId}:kf:${property}:${time}`,
    clipId,
    property,
    time,
    value,
    easing,
  };
}

function makeMaskVertex(maskId: string, index: number, x: number, y: number): ClipMask['vertices'][number] {
  return {
    id: `${maskId}:v:${index}`,
    x,
    y,
    handleIn: { x: 0, y: 0 },
    handleOut: { x: 0, y: 0 },
    handleMode: 'none',
  };
}

function mergeGeneratedKeyframes(
  base: SerializableClip['keyframes'],
  generated: readonly Keyframe[],
): Keyframe[] {
  const generatedProperties = new Set(generated.map((keyframe) => keyframe.property));
  return [
    ...(base ?? []).filter((keyframe) => !generatedProperties.has(keyframe.property)),
    ...generated,
  ];
}

function buildIncomingRevealMask(maskId: string): ClipMask {
  return {
    id: maskId,
    name: 'Light Leak Reveal',
    mode: 'add',
    inverted: false,
    opacity: 1,
    feather: 120,
    featherQuality: 80,
    enabled: true,
    visible: true,
    outlineColor: '#ffb36a',
    closed: true,
    expanded: true,
    position: { x: -0.62, y: 0 },
    vertices: [
      makeMaskVertex(maskId, 0, -2, -1),
      makeMaskVertex(maskId, 1, 0.22, -1),
      makeMaskVertex(maskId, 2, 0.58, 2),
      makeMaskVertex(maskId, 3, -2, 2),
    ],
  };
}

function mergeTransitionMarkers(
  existingMarkers: readonly SerializableMarker[] | undefined,
  transitionId: string,
  bodyStart: number,
  bodyEnd: number,
): SerializableMarker[] {
  const startId = `transition-comp:${transitionId}:body-start`;
  const endId = `transition-comp:${transitionId}:body-end`;
  const userMarkers = (existingMarkers ?? []).filter((marker) => marker.id !== startId && marker.id !== endId);
  return [
    ...userMarkers,
    { id: startId, time: bodyStart, label: 'Transition In', color: '#4a9eff' },
    { id: endId, time: bodyEnd, label: 'Transition Out', color: '#ff6b4a' },
  ];
}

function buildTransitionTimelineData(input: {
  outgoingClip: TimelineClip;
  incomingClip: TimelineClip;
  transition: TimelineTransition;
  serializableClips: readonly SerializableClip[];
}): { timelineData: CompositionTimelineData; link: Omit<TransitionCompositionLink, 'parentCompositionId'> } {
  const { outgoingClip, incomingClip, transition, serializableClips } = input;
  const duration = Math.max(0.0001, transition.duration);
  const padding = getWorkPadding(duration);
  const bodyStart = padding;
  const bodyEnd = padding + duration;
  const totalDuration = duration + padding * 2;
  const cutTime = padding + duration * 0.5;
  const trackId = `transition-comp-track:${transition.id}`;
  const outgoingClipId = `transition-comp:${transition.id}:outgoing`;
  const incomingClipId = `transition-comp:${transition.id}:incoming`;
  const innerTransitionId = `transition-comp-inner:${transition.id}`;
  const baseOutgoing = getSerializableClip(outgoingClip, serializableClips);
  const baseIncoming = getSerializableClip(incomingClip, serializableClips);
  const outgoingDuration = cutTime;
  const incomingDuration = totalDuration - cutTime;
  const outgoingInPoint = Math.max(baseOutgoing.inPoint, baseOutgoing.outPoint - outgoingDuration);
  const incomingOutPoint = Math.min(
    getSourceDuration(baseIncoming, incomingClip),
    baseIncoming.inPoint + incomingDuration,
  );
  const outgoingTransition = buildInnerTransition(transition, incomingClipId, innerTransitionId);
  const incomingTransition = buildInnerTransition(transition, outgoingClipId, innerTransitionId);
  const outgoingLinkedClip = buildLinkedClip({
    base: baseOutgoing,
    id: outgoingClipId,
    trackId,
    nameSuffix: '[OUT linked]',
    startTime: 0,
    duration: outgoingDuration,
    inPoint: outgoingInPoint,
    outPoint: baseOutgoing.outPoint,
    transitionOut: outgoingTransition,
  });
  const incomingLinkedClip = buildLinkedClip({
    base: baseIncoming,
    id: incomingClipId,
    trackId,
    nameSuffix: '[IN linked]',
    startTime: cutTime,
    duration: incomingDuration,
    inPoint: baseIncoming.inPoint,
    outPoint: incomingOutPoint,
    transitionIn: incomingTransition,
  });

  return {
    link: {
      kind: 'transition-comp',
      parentTransitionId: transition.id,
      parentOutgoingClipId: outgoingClip.id,
      parentIncomingClipId: incomingClip.id,
      linkedOutgoingClipId: outgoingClipId,
      linkedIncomingClipId: incomingClipId,
      innerTransitionId,
      paddingBefore: padding,
      paddingAfter: padding,
      bodyStart,
      bodyEnd,
    },
    timelineData: {
      tracks: [
        { id: trackId, name: 'Linked clips', type: 'video', height: 96, muted: false, visible: true, solo: false },
      ],
      clips: [outgoingLinkedClip, incomingLinkedClip],
      playheadPosition: bodyStart,
      duration: totalDuration,
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

function buildMaterializedLightLeakTimelineData(input: {
  outgoingClip: TimelineClip;
  incomingClip: TimelineClip;
  transition: TimelineTransition;
  serializableClips: readonly SerializableClip[];
}): { timelineData: CompositionTimelineData; link: Omit<TransitionCompositionLink, 'parentCompositionId'> } {
  const { outgoingClip, incomingClip, transition, serializableClips } = input;
  const duration = Math.max(0.0001, transition.duration);
  const padding = getWorkPadding(duration);
  const bodyStart = padding;
  const bodyEnd = padding + duration;
  const totalDuration = duration + padding * 2;
  const cutOffset = padding + duration * 0.5;
  const outgoingTrackId = `transition-comp-track:${transition.id}:outgoing`;
  const incomingTrackId = `transition-comp-track:${transition.id}:incoming`;
  const overlayTrackId = `transition-comp-track:${transition.id}:overlay`;
  const outgoingClipId = `transition-comp:${transition.id}:outgoing`;
  const incomingClipId = `transition-comp:${transition.id}:incoming`;
  const overlayClipId = `transition-comp:${transition.id}:light-streak`;
  const revealMaskId = `transition-comp:${transition.id}:reveal-mask`;
  const baseOutgoing = getSerializableClip(outgoingClip, serializableClips);
  const baseIncoming = getSerializableClip(incomingClip, serializableClips);
  const outgoingInPoint = Math.max(0, baseOutgoing.outPoint - cutOffset);
  const incomingInPoint = Math.max(0, baseIncoming.inPoint - cutOffset);
  const outgoingOutPoint = Math.min(getSourceDuration(baseOutgoing, outgoingClip), outgoingInPoint + totalDuration);
  const incomingOutPoint = Math.min(getSourceDuration(baseIncoming, incomingClip), incomingInPoint + totalDuration);
  const overlayDefinition: TransitionOverlayClipDefinition = {
    pattern: 'light-leak',
    color: getTransitionColor(transition),
    widthRatio: 0.32,
    softness: 0.42,
    angle: 0.18,
  };
  const outgoingLinkedClip = buildLinkedClip({
    base: baseOutgoing,
    id: outgoingClipId,
    trackId: outgoingTrackId,
    nameSuffix: '[OUT linked]',
    startTime: 0,
    duration: totalDuration,
    inPoint: outgoingInPoint,
    outPoint: outgoingOutPoint,
  });
  const revealMask = buildIncomingRevealMask(revealMaskId);
  const incomingGeneratedKeyframes: Keyframe[] = [
    makeKeyframe(incomingClipId, 'opacity', 0, 0),
    makeKeyframe(incomingClipId, 'opacity', bodyStart, 0.18, 'ease-in'),
    makeKeyframe(incomingClipId, 'opacity', bodyEnd, 1, 'ease-out'),
    makeKeyframe(incomingClipId, `mask.${revealMaskId}.position.x` as Keyframe['property'], bodyStart, -0.62),
    makeKeyframe(incomingClipId, `mask.${revealMaskId}.position.x` as Keyframe['property'], bodyEnd, 0.78, 'ease-in-out'),
  ];
  const incomingBaseClip = buildLinkedClip({
    base: baseIncoming,
    id: incomingClipId,
    trackId: incomingTrackId,
    nameSuffix: '[IN linked]',
    startTime: 0,
    duration: totalDuration,
    inPoint: incomingInPoint,
    outPoint: incomingOutPoint,
  });
  const incomingLinkedClip: SerializableClip = {
    ...incomingBaseClip,
    masks: [revealMask],
    keyframes: mergeGeneratedKeyframes(incomingBaseClip.keyframes, incomingGeneratedKeyframes),
  };
  const outgoingKeyframes: Keyframe[] = [
    makeKeyframe(outgoingClipId, 'opacity', 0, 1),
    makeKeyframe(outgoingClipId, 'opacity', bodyStart, 1),
    makeKeyframe(outgoingClipId, 'opacity', bodyEnd, 0.08, 'ease-in-out'),
  ];
  const overlayClip: SerializableClip = {
    id: overlayClipId,
    trackId: overlayTrackId,
    name: 'Light Streak',
    mediaFileId: '',
    startTime: 0,
    duration: totalDuration,
    inPoint: 0,
    outPoint: totalDuration,
    sourceType: 'transition-overlay',
    naturalDuration: totalDuration,
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
      makeKeyframe(overlayClipId, 'opacity', bodyStart, 0.35, 'ease-in'),
      makeKeyframe(overlayClipId, 'opacity', bodyStart + duration * 0.45, 0.85, 'ease-in-out'),
      makeKeyframe(overlayClipId, 'opacity', bodyEnd, 0.35, 'ease-out'),
      makeKeyframe(overlayClipId, 'opacity', totalDuration, 0),
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
      paddingBefore: padding,
      paddingAfter: padding,
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
        { ...outgoingLinkedClip, keyframes: mergeGeneratedKeyframes(outgoingLinkedClip.keyframes, outgoingKeyframes) },
        incomingLinkedClip,
        overlayClip,
      ],
      playheadPosition: bodyStart,
      duration: totalDuration,
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

function reuseExistingTimelineData(
  existing: Composition | undefined,
  generated: CompositionTimelineData,
  transitionId: string,
  materialized: boolean,
): CompositionTimelineData {
  if (!existing?.timelineData) return generated;
  if (materialized && !existing.transitionComp?.materialized) return generated;
  const hasLinkedClips = existing.timelineData.clips.some((clip) => clip.id.includes(`transition-comp:${transitionId}:outgoing`)) &&
    existing.timelineData.clips.some((clip) => clip.id.includes(`transition-comp:${transitionId}:incoming`));
  if (!hasLinkedClips) return generated;

  const bodyStart = existing.timelineData.inPoint ?? generated.inPoint;
  const bodyEnd = existing.timelineData.outPoint ?? generated.outPoint;
  return {
    ...existing.timelineData,
    markers: mergeTransitionMarkers(existing.timelineData.markers, transitionId, bodyStart ?? 0, bodyEnd ?? generated.duration),
  };
}

export interface TransitionCompositionAttachment {
  outgoingClipId: string;
  incomingClipId: string;
  transitionId: string;
  compositionId: string;
}

export interface OpenTransitionCompositionInput {
  outgoingClipId: string;
  transitionId: string;
  timelineClips: readonly TimelineClip[];
  serializableClips: readonly SerializableClip[];
  parentComposition: Composition | undefined;
  compositions: readonly Composition[];
  createComposition: (name: string, settings?: Partial<Composition>) => Composition;
  updateComposition: (id: string, updates: Partial<Composition>) => void;
  openCompositionTab: (id: string, options?: { skipAnimation?: boolean; playFromTime?: number }) => void;
  attachTransitionComposition: (attachment: TransitionCompositionAttachment) => void;
}

export function openTransitionComposition(input: OpenTransitionCompositionInput): string | null {
  const {
    outgoingClipId,
    transitionId,
    timelineClips,
    serializableClips,
    parentComposition,
    compositions,
    createComposition,
    updateComposition,
    openCompositionTab,
    attachTransitionComposition,
  } = input;
  if (!parentComposition) return null;
  if (parentComposition.transitionComp?.kind === 'transition-comp') return parentComposition.id;

  const outgoingClip = timelineClips.find((clip) => clip.id === outgoingClipId);
  const transition = outgoingClip?.transitionOut;
  if (!outgoingClip || !transition || transition.id !== transitionId) return null;

  const incomingClip = timelineClips.find((clip) => clip.id === transition.linkedClipId);
  if (!incomingClip) return null;

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
    getMediaDuration: createTimelineTransitionMediaDurationResolver(),
  });
  if (!plan) return null;

  const resolvedTransition = { ...transition, duration: plan.resolvedDuration };
  const generated = transition.type === 'light-leak'
    ? buildMaterializedLightLeakTimelineData({
        outgoingClip,
        incomingClip,
        transition: resolvedTransition,
        serializableClips,
      })
    : buildTransitionTimelineData({
        outgoingClip,
        incomingClip,
        transition: resolvedTransition,
        serializableClips,
      });
  const existingComposition = transition.compositionId
    ? compositions.find((composition) => composition.id === transition.compositionId)
    : undefined;
  const transitionDefinition = getRuntimeTransition(transition.type);
  const compositionName = existingComposition?.name ??
    `Transition - ${transitionDefinition?.name ?? transition.type}`;
  const timelineData = reuseExistingTimelineData(
    existingComposition,
    generated.timelineData,
    transition.id,
    generated.link.materialized === true,
  );
  const transitionComp = {
    ...generated.link,
    parentCompositionId: parentComposition.id,
    bodyStart: timelineData.inPoint ?? generated.link.bodyStart,
    bodyEnd: timelineData.outPoint ?? generated.link.bodyEnd,
    paddingBefore: timelineData.inPoint ?? generated.link.paddingBefore,
    paddingAfter: Math.max(0, timelineData.duration - (timelineData.outPoint ?? generated.link.bodyEnd)),
  } satisfies TransitionCompositionLink;

  const composition = existingComposition ?? createComposition(compositionName, {
    width: parentComposition.width,
    height: parentComposition.height,
    frameRate: parentComposition.frameRate,
    duration: timelineData.duration,
    timelineData,
    transitionComp,
  });

  if (existingComposition) {
    updateComposition(existingComposition.id, {
      width: parentComposition.width,
      height: parentComposition.height,
      frameRate: parentComposition.frameRate,
      duration: timelineData.duration,
      timelineData,
      transitionComp,
    });
  }

  attachTransitionComposition({
    outgoingClipId: outgoingClip.id,
    incomingClipId: incomingClip.id,
    transitionId: transition.id,
    compositionId: composition.id,
  });
  compositionRenderer.invalidateCompositionAndParents(composition.id);
  openCompositionTab(composition.id, {
    skipAnimation: true,
    playFromTime: transitionComp.bodyStart,
  });

  return composition.id;
}

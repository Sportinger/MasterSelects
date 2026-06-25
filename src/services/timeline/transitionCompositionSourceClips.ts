import type { Keyframe } from '../../types/keyframes';
import type { SerializableClip, TimelineClip } from '../../types/timeline';
import type { TimelineTransition } from '../../types/timelineCore';
import type { TransitionCoverageRange, TransitionParticipantPlan } from '../../stores/timeline/editOperations/transitionPlanner';
import { freezeClipKeyframes, sliceGeneratedKeyframesForSegment } from './transitionCompositionKeyframes';

export function clone<T>(value: T): T {
  return structuredClone(value);
}

export function getSourceType(clip: TimelineClip): SerializableClip['sourceType'] {
  return (clip.source?.type ?? 'video') as SerializableClip['sourceType'];
}

export function serializeFallbackClip(clip: TimelineClip): SerializableClip {
  const runtimeKeyframes = (clip as TimelineClip & { keyframes?: Keyframe[] }).keyframes;
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
    sourceRect: clip.sourceRect ? clone(clip.sourceRect) : undefined,
    effects: clone(clip.effects ?? []),
    keyframes: runtimeKeyframes ? clone(runtimeKeyframes) : undefined,
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
    transitionSourceTimeOverride: clip.transitionSourceTimeOverride,
    transitionSourceHold: clip.transitionSourceHold,
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

export function getSerializableClip(
  runtimeClip: TimelineClip,
  serializableClips: readonly SerializableClip[],
): SerializableClip {
  return clone(serializableClips.find((clip) => clip.id === runtimeClip.id) ?? serializeFallbackClip(runtimeClip));
}

export function retimeKeyframes(
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

export function buildLinkedClip(input: {
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
  transitionSourceTimeOverride?: number;
  transitionSourceHold?: boolean;
  freezeKeyframesAtSourceTime?: number;
}): SerializableClip {
  const {
    base,
    id,
    trackId,
    nameSuffix,
    startTime,
    duration,
    inPoint,
    outPoint,
    transitionIn,
    transitionOut,
    transitionSourceTimeOverride,
    transitionSourceHold,
    freezeKeyframesAtSourceTime,
  } = input;
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
    transitionSourceTimeOverride,
    transitionSourceHold,
    keyframes: Number.isFinite(freezeKeyframesAtSourceTime)
      ? freezeClipKeyframes(base, id, freezeKeyframesAtSourceTime!, duration)
      : retimeKeyframes(base, id, inPoint, duration),
  };
}

export function getSegmentClipId(baseId: string, index: number, total: number): string {
  return index === 0 || total <= 1 ? baseId : `${baseId}:seg:${index}`;
}

export function getCoverageCompRange(
  coverage: TransitionCoverageRange,
  bodyStart: number,
  duration: number,
): { startTime: number; duration: number; sourceStart: number; sourceEnd: number } | null {
  const rawStart = coverage.startTime - bodyStart;
  const rawEnd = coverage.endTime - bodyStart;
  const startTime = Math.max(0, Math.min(duration, rawStart));
  const endTime = Math.max(0, Math.min(duration, rawEnd));
  const segmentDuration = endTime - startTime;
  if (segmentDuration <= 0.000001) return null;

  const clippedStartOffset = Math.max(0, startTime - rawStart);
  if (coverage.kind === 'hold') {
    return {
      startTime,
      duration: segmentDuration,
      sourceStart: coverage.sourceStart,
      sourceEnd: coverage.sourceStart,
    };
  }

  const sourceStart = coverage.sourceStart + clippedStartOffset;
  return {
    startTime,
    duration: segmentDuration,
    sourceStart,
    sourceEnd: sourceStart + segmentDuration,
  };
}

export function buildLinkedCoverageClips(input: {
  base: SerializableClip;
  baseId: string;
  trackId: string;
  nameSuffix: string;
  participant: TransitionParticipantPlan;
  bodyStart: number;
  duration: number;
  splitBoundaries?: readonly number[];
  materialize: (clip: SerializableClip) => SerializableClip;
}): SerializableClip[] {
  const ranges = input.participant.coverage
    .map((coverage) => ({ coverage, range: getCoverageCompRange(coverage, input.bodyStart, input.duration) }))
    .filter((entry): entry is { coverage: TransitionCoverageRange; range: NonNullable<ReturnType<typeof getCoverageCompRange>> } =>
      entry.range !== null
    );
  const sourceRanges = ranges.length > 0
    ? ranges
    : [{
        coverage: {
          kind: 'visible' as const,
          startTime: input.bodyStart,
          endTime: input.bodyStart + input.duration,
          duration: input.duration,
          sourceStart: input.base.inPoint,
          sourceEnd: input.base.inPoint + input.duration,
        },
        range: {
          startTime: 0,
          duration: input.duration,
          sourceStart: input.base.inPoint,
          sourceEnd: input.base.inPoint + input.duration,
        },
      }];

  return sourceRanges.flatMap(({ coverage, range }, index) => {
    const clip = buildLinkedClip({
      base: input.base,
      id: getSegmentClipId(input.baseId, index, sourceRanges.length),
      trackId: input.trackId,
      nameSuffix: sourceRanges.length > 1 ? `${input.nameSuffix} ${index + 1}` : input.nameSuffix,
      startTime: range.startTime,
      duration: range.duration,
      inPoint: range.sourceStart,
      outPoint: Math.max(range.sourceStart + 0.0001, range.sourceEnd),
      transitionSourceTimeOverride: coverage.kind === 'hold' ? range.sourceStart : undefined,
      transitionSourceHold: coverage.kind === 'hold' || undefined,
      freezeKeyframesAtSourceTime: coverage.kind === 'hold' ? range.sourceStart - input.base.inPoint : undefined,
    });
    return splitClipAtBoundaries(clip, input.splitBoundaries ?? []).map(input.materialize);
  });
}

export function splitClipAtBoundaries(clip: SerializableClip, boundaries: readonly number[]): SerializableClip[] {
  const localBoundaries = boundaries
    .filter((time) => time > clip.startTime + 0.0001 && time < clip.startTime + clip.duration - 0.0001)
    .toSorted((a, b) => a - b);
  if (localBoundaries.length === 0) return [clip];

  const points = [clip.startTime, ...localBoundaries, clip.startTime + clip.duration];
  return points.slice(0, -1).map((start, index) => {
    const end = points[index + 1];
    const offset = start - clip.startTime;
    const duration = Math.max(0.0001, end - start);
    return {
      ...clone(clip),
      id: index === 0 ? clip.id : `${clip.id}:part:${index}`,
      name: index === 0 ? clip.name : `${clip.name} ${index + 1}`,
      startTime: start,
      duration,
      inPoint: clip.transitionSourceHold ? clip.inPoint : clip.inPoint + offset,
      outPoint: clip.transitionSourceHold ? clip.outPoint : clip.inPoint + offset + duration,
      keyframes: sliceGeneratedKeyframesForSegment(clip, clip.keyframes ?? [], offset, duration),
    };
  });
}

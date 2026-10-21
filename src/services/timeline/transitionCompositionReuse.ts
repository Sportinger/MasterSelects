import type { Composition } from '../../stores/mediaStore/types';
import type { CompositionTimelineData, SerializableClip } from '../../types/timeline';
import type { TransitionCompositionLink } from '../../types/timelineCore';
import { Logger } from '../logger';
import { mergeGeneratedKeyframes } from './transitionCompositionKeyframes';
import { mergeTransitionMarkers } from './transitionCompositionRecipeTemplate';
import {
  hasUserContentOnLinkedClip,
  mergeGeneratedEffects,
  mergeGeneratedMasks,
  upgradeGeneratedClipContent,
} from './transitionGeneratedContent';
import { compareTransitionTemplateParamsKeys } from './transitionTemplateParamsKey';

export {
  isGeneratedTransitionEffect,
  isGeneratedTransitionKeyframeId,
  isGeneratedTransitionMask,
  mergeGeneratedEffects,
  mergeGeneratedMasks,
} from './transitionGeneratedContent';

const log = Logger.create('TransitionCompositionReuse');

export function clone<T>(value: T): T {
  return structuredClone(value);
}

export function scaleKeyframes(
  keyframes: SerializableClip['keyframes'],
  scale: number,
): SerializableClip['keyframes'] {
  return keyframes?.map((keyframe) => ({
    ...clone(keyframe),
    time: keyframe.time * scale,
  }));
}

export function normalizeExistingTransitionTimelineData(
  existing: Composition,
  targetDuration: number,
): CompositionTimelineData {
  const timelineData = existing.timelineData!;
  const bodyStart = existing.transitionComp?.bodyStart ?? timelineData.inPoint ?? 0;
  const bodyEnd = existing.transitionComp?.bodyEnd ?? timelineData.outPoint ?? timelineData.duration ?? targetDuration;
  const bodyDuration = Math.max(0.0001, bodyEnd - bodyStart);
  const scale = targetDuration / bodyDuration;

  return {
    ...timelineData,
    duration: targetDuration,
    inPoint: 0,
    outPoint: targetDuration,
    clips: timelineData.clips.map((clip) => ({
      ...clone(clip),
      startTime: (clip.startTime - bodyStart) * scale,
      duration: Math.max(0.0001, clip.duration * scale),
      keyframes: scaleKeyframes(clip.keyframes, scale),
    })),
    markers: timelineData.markers
      ?.map((marker) => ({
        ...marker,
        time: (marker.time - bodyStart) * scale,
      }))
      .filter((marker) => marker.time >= 0 && marker.time <= targetDuration),
  };
}

/** Generated items the user edited, kept by a template upgrade (see upgradeGeneratedClipContent). */
type KeptEditedItems = string[];

export function refreshLinkedSourceClip(
  existing: SerializableClip,
  generated: SerializableClip,
  syncTiming: boolean,
  upgradeGeneratedContent: KeptEditedItems | false = false,
): SerializableClip {
  const sourceSignatureChanged = getLinkedSourceSignature(existing) !== getLinkedSourceSignature(generated);
  const refreshed: SerializableClip = {
    ...existing,
    ...(syncTiming ? {
      startTime: generated.startTime,
      duration: generated.duration,
    } : {}),
    mediaFileId: generated.mediaFileId,
    signalAssetId: generated.signalAssetId,
    signalRefId: generated.signalRefId,
    signalRenderAdapterId: generated.signalRenderAdapterId,
    sourceType: generated.sourceType,
    naturalDuration: generated.naturalDuration,
    thumbnails: generated.thumbnails,
    videoState: generated.videoState ? clone(generated.videoState) : undefined,
    audioState: generated.audioState ? clone(generated.audioState) : undefined,
    waveform: generated.waveform,
    waveformChannels: generated.waveformChannels,
    inPoint: generated.inPoint,
    outPoint: generated.outPoint,
    reversed: generated.reversed,
    speed: generated.speed,
    preservesPitch: generated.preservesPitch,
    transitionSourceTimeOverride: generated.transitionSourceTimeOverride,
    transitionSourceHold: generated.transitionSourceHold,
    transitionSourceMap: generated.transitionSourceMap ? clone(generated.transitionSourceMap) : undefined,
    transitionRecipeBlendWindows: generated.transitionRecipeBlendWindows
      ? clone(generated.transitionRecipeBlendWindows)
      : undefined,
  };
  if (upgradeGeneratedContent) return upgradeGeneratedClipContent(refreshed, existing, generated, upgradeGeneratedContent);
  if (!sourceSignatureChanged) return refreshed;

  return {
    ...refreshed,
    effects: mergeGeneratedEffects(existing.effects, generated.effects),
    masks: mergeGeneratedMasks(existing.masks, generated.masks),
    keyframes: generated.keyframes?.length
      ? mergeGeneratedKeyframes(existing.keyframes, generated.keyframes)
      : existing.keyframes,
  };
}

export function getLinkedSourceSignature(clip: SerializableClip): string {
  return JSON.stringify({
    startTime: clip.startTime,
    duration: clip.duration,
    inPoint: clip.inPoint,
    outPoint: clip.outPoint,
    mediaFileId: clip.mediaFileId,
    sourceType: clip.sourceType,
    hold: clip.transitionSourceHold === true,
    override: clip.transitionSourceTimeOverride,
    sourceMap: clip.transitionSourceMap,
    blendWindows: clip.transitionRecipeBlendWindows,
  });
}

export function isLinkedSourceClipId(clipId: string, link: Pick<TransitionCompositionLink, 'linkedOutgoingClipId' | 'linkedIncomingClipId'>): boolean {
  const matches = (baseId: string) =>
    clipId === baseId ||
    clipId.startsWith(`${baseId}:`);
  return matches(link.linkedOutgoingClipId) || matches(link.linkedIncomingClipId);
}

export function isTransitionCompositionForPair(
  composition: Composition,
  parentCompositionId: string,
  transitionId: string,
  outgoingClipId: string,
  incomingClipId: string,
): boolean {
  return composition.transitionComp?.kind === 'transition-comp' &&
    composition.transitionComp.parentCompositionId === parentCompositionId &&
    composition.transitionComp.parentTransitionId === transitionId &&
    composition.transitionComp.parentOutgoingClipId === outgoingClipId &&
    composition.transitionComp.parentIncomingClipId === incomingClipId;
}

export function refreshLinkedSourceWindows(
  existing: CompositionTimelineData,
  generated: { timelineData: CompositionTimelineData; link: Omit<TransitionCompositionLink, 'parentCompositionId'> },
  upgradeGeneratedContent: KeptEditedItems | false = false,
): CompositionTimelineData {
  const existingClipsById = new Map(existing.clips.map((clip) => [clip.id, clip]));
  const generatedLinkedClips = generated.timelineData.clips.filter((clip) =>
    isLinkedSourceClipId(clip.id, generated.link)
  );
  const firstLinkedClipIndex = existing.clips.findIndex((clip) =>
    isLinkedSourceClipId(clip.id, generated.link)
  );
  const insertAt = firstLinkedClipIndex >= 0 ? firstLinkedClipIndex : existing.clips.length;
  const retainedClips = existing.clips.filter((clip) => !isLinkedSourceClipId(clip.id, generated.link));
  const beforeLinked = retainedClips.slice(0, insertAt);
  const afterLinked = retainedClips.slice(insertAt);
  const refreshedLinkedClips = generatedLinkedClips.map((generatedClip) => {
    const existingClip = existingClipsById.get(generatedClip.id);
    return existingClip
      ? refreshLinkedSourceClip(existingClip, generatedClip, true, upgradeGeneratedContent)
      : generatedClip;
  });

  return {
    ...existing,
    clips: [...beforeLinked, ...refreshedLinkedClips, ...afterLinked],
  };
}

/** True when a stored composition holds changes the template would not recreate. */
function hasChangesInsideComposition(
  timelineData: CompositionTimelineData,
  generatedTimelineData: CompositionTimelineData,
  link: Pick<TransitionCompositionLink, 'linkedOutgoingClipId' | 'linkedIncomingClipId'>,
): boolean {
  const regeneratedById = new Map(generatedTimelineData.clips.map((clip) => [clip.id, clip]));
  return timelineData.clips.some((clip) => {
    if (!isLinkedSourceClipId(clip.id, link)) return !clip.id.startsWith('transition-comp:');
    return hasUserContentOnLinkedClip(clip, regeneratedById.get(clip.id));
  });
}

function rebuildFromTemplate(
  existing: Composition,
  generated: { timelineData: CompositionTimelineData; link: Omit<TransitionCompositionLink, 'parentCompositionId'> },
  reason: string,
): CompositionTimelineData {
  const details = { compositionId: existing.id, reason };
  if (existing.timelineData &&
    hasChangesInsideComposition(existing.timelineData, generated.timelineData, existing.transitionComp ?? generated.link)) {
    log.warn('Rebuilt a transition composition from its template; changes made inside it were replaced', details);
  } else {
    log.info('Rebuilt a transition composition from its template', details);
  }
  return generated.timelineData;
}

export function reuseExistingTimelineData(
  existing: Composition | undefined,
  generated: { timelineData: CompositionTimelineData; link: Omit<TransitionCompositionLink, 'parentCompositionId'> },
  materialized: boolean,
): CompositionTimelineData {
  if (!existing?.timelineData) return generated.timelineData;
  if (existing.transitionComp?.sourceLayout !== 'mapped-v3') return existing.timelineData;
  if (materialized && !existing.transitionComp?.materialized) return generated.timelineData;
  if (existing.transitionComp?.templateType !== generated.link.templateType) {
    return rebuildFromTemplate(existing, generated, 'transition type changed');
  }
  if (existing.transitionComp?.templateVersion !== generated.link.templateVersion) {
    return rebuildFromTemplate(existing, generated, 'template version changed');
  }
  const paramsChange = compareTransitionTemplateParamsKeys(
    existing.transitionComp?.templateParamsKey,
    generated.link.templateParamsKey,
    generated.link.templateType,
  );
  if (paramsChange === 'params') {
    return rebuildFromTemplate(existing, generated, 'transition parameters changed');
  }
  const hasLinkedClips = existing.timelineData.clips.some((clip) => isLinkedSourceClipId(clip.id, generated.link));
  if (!hasLinkedClips) return rebuildFromTemplate(existing, generated, 'the linked clips were removed');

  const needsTimelineNormalize =
    Math.abs((existing.timelineData.duration ?? 0) - generated.timelineData.duration) > 0.0001 ||
    (existing.transitionComp?.paddingBefore ?? 0) !== 0 ||
    (existing.transitionComp?.paddingAfter ?? 0) !== 0 ||
    (existing.timelineData.inPoint ?? 0) !== 0 ||
    Math.abs((existing.timelineData.outPoint ?? generated.timelineData.duration) - generated.timelineData.duration) > 0.0001;
  const timelineData = needsTimelineNormalize
    ? normalizeExistingTransitionTimelineData(existing, generated.timelineData.duration)
    : existing.timelineData;
  if (paramsChange !== 'revision') {
    return {
      ...refreshLinkedSourceWindows(timelineData, generated),
      markers: mergeTransitionMarkers(timelineData.markers, generated.link.parentTransitionId, 0, generated.timelineData.duration),
    };
  }

  const keptEditedItems: KeptEditedItems = [];
  const upgraded = refreshLinkedSourceWindows(timelineData, generated, keptEditedItems);
  const details = { compositionId: existing.id, templateType: generated.link.templateType };
  if (keptEditedItems.length > 0) {
    log.warn('Upgraded a stored transition composition to the current template; generated items edited inside it were kept as edited', {
      ...details,
      keptEditedItems,
    });
  } else {
    log.info('Upgraded a stored transition composition to the current template', details);
  }
  return {
    ...upgraded,
    markers: mergeTransitionMarkers(timelineData.markers, generated.link.parentTransitionId, 0, generated.timelineData.duration),
  };
}

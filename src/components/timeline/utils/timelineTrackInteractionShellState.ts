import type { AnimatableProperty, Keyframe } from '../../../types';
import { parseVectorAnimationStateProperty } from '../../../types/vectorAnimation';
import type { ClipKeyframeTimeGroup, TimelineTrackProps } from '../types';
import type {
  ClipInteractionShellModuleSlot,
  ClipInteractionShellMountReason,
  ClipInteractionShellMountState,
} from '../interactionShell';
import type { FadeCurveKeyframe } from './fadeCurvePath';

export type TimelineTrackShellClip = TimelineTrackProps['clips'][number];

export type TimelineTrackShellKeyframeState = {
  keyframes: Keyframe[];
  keyframeGroups: ClipKeyframeTimeGroup[];
  selectedKeyframeIds: string[];
  activeProperty?: AnimatableProperty;
};

export type TimelineTrackShellSpecialState = {
  audioRegionActive: boolean;
  spectralRegionActive: boolean;
  videoBakeActive: boolean;
  stemActive: boolean;
  stemJob?: TimelineTrackProps['clipStemSeparationJobs'][string];
};

export type TimelineTrackShellFadeState = {
  keyframes: readonly FadeCurveKeyframe[];
  clipDuration: number;
  isAudioClip: boolean;
  fadeInDuration: number;
  fadeOutDuration: number;
  curveKey: string;
};

const getClipShellKeyframeGroups = (
  keyframes: ReadonlyArray<Pick<Keyframe, 'id' | 'time' | 'property'>>,
): ClipKeyframeTimeGroup[] => {
  const groups = new Map<number, ClipKeyframeTimeGroup>();
  keyframes.forEach((keyframe) => {
    const bucket = Math.round(keyframe.time * 1000000) / 1000000;
    const group = groups.get(bucket);
    if (group) {
      group.keyframeIds.push(keyframe.id);
      group.properties = [...(group.properties ?? []), keyframe.property];
      group.hasStateChange = group.hasStateChange || Boolean(parseVectorAnimationStateProperty(keyframe.property));
      return;
    }
    groups.set(bucket, {
      time: keyframe.time,
      keyframeIds: [keyframe.id],
      properties: [keyframe.property],
      hasStateChange: Boolean(parseVectorAnimationStateProperty(keyframe.property)),
    });
  });
  return Array.from(groups.values()).toSorted((a, b) => a.time - b.time);
};

export const buildTimelineTrackShellKeyframeStateByClipId = ({
  allTrackClips,
  clipKeyframes,
  hoveredClipId,
  selectedKeyframeIds,
}: {
  allTrackClips: readonly TimelineTrackShellClip[];
  clipKeyframes: TimelineTrackProps['clipKeyframes'];
  hoveredClipId: string | null;
  selectedKeyframeIds: ReadonlySet<string>;
}): Map<string, TimelineTrackShellKeyframeState> => {
  const stateByClipId = new Map<string, TimelineTrackShellKeyframeState>();
  allTrackClips.forEach((clip) => {
    const keyframes = (clipKeyframes.get(clip.id) ?? []) as Keyframe[];
    if (keyframes.length === 0) return;
    const selectedKeyframes = keyframes.filter((keyframe) => selectedKeyframeIds.has(keyframe.id));
    if (clip.id !== hoveredClipId && selectedKeyframes.length === 0) return;
    stateByClipId.set(clip.id, {
      keyframes,
      keyframeGroups: getClipShellKeyframeGroups(keyframes),
      selectedKeyframeIds: selectedKeyframes.map((keyframe) => keyframe.id),
      activeProperty: selectedKeyframes[0]?.property,
    });
  });
  return stateByClipId;
};

export const buildTimelineTrackShellSpecialStateByClipId = ({
  allTrackClips,
  audioDisplayMode,
  audioRegionGainPreview,
  audioRegionSelection,
  audioSpectralRegionSelection,
  clipStemSeparationJobs,
  hoveredClipId,
  videoBakeRegionSelection,
}: Pick<
  TimelineTrackProps,
  | 'audioDisplayMode'
  | 'audioRegionGainPreview'
  | 'audioRegionSelection'
  | 'audioSpectralRegionSelection'
  | 'clipStemSeparationJobs'
  | 'videoBakeRegionSelection'
> & {
  allTrackClips: readonly TimelineTrackShellClip[];
  hoveredClipId: string | null;
}): Map<string, TimelineTrackShellSpecialState> => {
  const stateByClipId = new Map<string, TimelineTrackShellSpecialState>();
  allTrackClips.forEach((clip) => {
    const audioRegionActive = audioRegionSelection?.clipId === clip.id || audioRegionGainPreview?.clipId === clip.id;
    const spectralRegionActive = audioSpectralRegionSelection?.clipId === clip.id || (
      audioDisplayMode === 'spectral' &&
      (clip.audioState?.spectralLayers ?? []).some((layer) => layer.enabled !== false && layer.duration > 0)
    );
    const videoBakeActive = (
      videoBakeRegionSelection?.scope === 'clip' &&
      videoBakeRegionSelection.clipId === clip.id
    ) || (clip.videoState?.bakeRegions ?? []).length > 0;
    const stemJob = clipStemSeparationJobs[clip.id] ??
      (clip.linkedClipId ? clipStemSeparationJobs[clip.linkedClipId] : undefined);
    const stemActive = Boolean(stemJob) || (hoveredClipId === clip.id && Boolean(clip.audioState?.stemSeparation));
    if (!audioRegionActive && !spectralRegionActive && !videoBakeActive && !stemActive) return;
    stateByClipId.set(clip.id, { audioRegionActive, spectralRegionActive, videoBakeActive, stemActive, stemJob });
  });
  return stateByClipId;
};

export const buildTimelineTrackShellDomControlClipIds = ({
  allTrackClips,
  trackClips,
  clipDrag,
  clipTrim,
  clipFade,
  clipContextMenu,
  clipRenameId,
  hoveredClipId,
  keyframeStateByClipId,
  specialStateByClipId,
  parentingEnabled,
}: Pick<TimelineTrackProps, 'clipDrag' | 'clipTrim' | 'clipFade' | 'clipContextMenu'> & {
  allTrackClips: readonly TimelineTrackShellClip[];
  trackClips: readonly TimelineTrackShellClip[];
  clipRenameId: string | null;
  hoveredClipId: string | null;
  keyframeStateByClipId: ReadonlyMap<string, TimelineTrackShellKeyframeState>;
  specialStateByClipId: ReadonlyMap<string, TimelineTrackShellSpecialState>;
  parentingEnabled: boolean;
}): Set<string> => {
  const ids = new Set<string>();
  const trackClipIds = new Set(allTrackClips.map((clip) => clip.id));
  if (hoveredClipId) ids.add(hoveredClipId);
  if (clipDrag) {
    ids.add(clipDrag.clipId);
    clipDrag.multiSelectClipIds?.forEach((id) => ids.add(id));
  }
  if (clipTrim?.clipId) ids.add(clipTrim.clipId);
  if (clipFade?.clipId && trackClipIds.has(clipFade.clipId)) ids.add(clipFade.clipId);
  if (clipContextMenu?.clipId && trackClipIds.has(clipContextMenu.clipId)) ids.add(clipContextMenu.clipId);
  if (clipRenameId && trackClipIds.has(clipRenameId)) ids.add(clipRenameId);
  trackClips.forEach((clip) => {
    if (parentingEnabled) ids.add(clip.id);
    if (keyframeStateByClipId.has(clip.id)) ids.add(clip.id);
    if (specialStateByClipId.has(clip.id)) ids.add(clip.id);
  });
  return ids;
};

export const countTimelineTrackShellSlots = ({
  clips,
  clipTrim,
  clipFade,
  clipContextMenu,
  keyframeStateByClipId,
  specialStateByClipId,
  parentingEnabled,
}: Pick<TimelineTrackProps, 'clipTrim' | 'clipFade' | 'clipContextMenu'> & {
  clips: readonly TimelineTrackShellClip[];
  keyframeStateByClipId: ReadonlyMap<string, TimelineTrackShellKeyframeState>;
  specialStateByClipId: ReadonlyMap<string, TimelineTrackShellSpecialState>;
  parentingEnabled: boolean;
}): Partial<Record<ClipInteractionShellModuleSlot, number>> => {
  const counts: Partial<Record<ClipInteractionShellModuleSlot, number>> = {};
  const countSlot = (slot: ClipInteractionShellModuleSlot) => {
    counts[slot] = (counts[slot] ?? 0) + 1;
  };
  clips.forEach((clip) => {
    if (parentingEnabled) countSlot('parenting');
    if (clipTrim?.clipId === clip.id) countSlot('trim');
    if (clipFade?.clipId === clip.id) countSlot('fade');
    if (keyframeStateByClipId.has(clip.id)) countSlot('keyframe');
    if (clipContextMenu?.clipId === clip.id) countSlot('context-menu');
    const specialState = specialStateByClipId.get(clip.id);
    if (specialState?.audioRegionActive) countSlot('audio-region');
    if (specialState?.spectralRegionActive) countSlot('spectral-region');
    if (specialState?.videoBakeActive) countSlot('video-bake');
    if (specialState?.stemActive) countSlot('stem');
  });
  return counts;
};

export const buildTimelineTrackClipShellMountState = ({
  clipId,
  clipDrag,
  clipTrim,
  clipFade,
  clipContextMenu,
  hoveredClipId,
  keyframeStateByClipId,
  specialStateByClipId,
  parentingEnabled,
}: Pick<TimelineTrackProps, 'clipDrag' | 'clipTrim' | 'clipFade' | 'clipContextMenu'> & {
  clipId: string;
  hoveredClipId: string | null;
  keyframeStateByClipId: ReadonlyMap<string, TimelineTrackShellKeyframeState>;
  specialStateByClipId: ReadonlyMap<string, TimelineTrackShellSpecialState>;
  parentingEnabled: boolean;
}): ClipInteractionShellMountState => {
  const reasons: ClipInteractionShellMountReason[] = [];
  if (parentingEnabled) reasons.push('parenting');
  if (hoveredClipId === clipId) reasons.push('hover');
  if (clipDrag?.clipId === clipId) reasons.push('drag');
  if (clipDrag?.multiSelectClipIds?.includes(clipId)) reasons.push('multi-drag');
  if (clipTrim?.clipId === clipId) reasons.push('trim');
  if (clipFade?.clipId === clipId) reasons.push('fade');
  if (clipContextMenu?.clipId === clipId) reasons.push('context-menu-open');
  const keyframeState = keyframeStateByClipId.get(clipId);
  if (keyframeState) reasons.push('selected-keyframes');
  const specialState = specialStateByClipId.get(clipId);
  if (specialState?.audioRegionActive) reasons.push('audio-region-active');
  if (specialState?.spectralRegionActive) reasons.push('spectral-region-active');
  if (specialState?.videoBakeActive) reasons.push('video-bake-active');
  if (specialState?.stemActive) reasons.push('stem-active');
  return {
    clipId,
    shouldMount: reasons.length > 0,
    reasons,
    isHovered: hoveredClipId === clipId,
    isDragging: clipDrag?.clipId === clipId,
    isMultiDragging: clipDrag?.multiSelectClipIds?.includes(clipId) ?? false,
    isTrimming: clipTrim?.clipId === clipId,
    isFading: clipFade?.clipId === clipId,
    hasOpenContextMenu: clipContextMenu?.clipId === clipId,
    hasVisibleKeyframes: Boolean(keyframeState),
    hasActiveAudioRegion: specialState?.audioRegionActive,
    hasActiveSpectralRegion: specialState?.spectralRegionActive,
    hasActiveVideoBakeRegion: specialState?.videoBakeActive,
    hasActiveStemControls: specialState?.stemActive,
  };
};

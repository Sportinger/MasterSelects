import type { TimelineTrackProps } from '../types';
import type {
  ClipInteractionShellActiveModules,
  ClipInteractionShellSpectralImageMediaRef,
} from '../interactionShell';
import type {
  TimelineTrackShellClip,
  TimelineTrackShellFadeState,
  TimelineTrackShellKeyframeState,
  TimelineTrackShellSpecialState,
} from './timelineTrackInteractionShellState';

const SPECTRAL_AUDIO_EXTENSIONS = new Set(['wav', 'mp3', 'ogg', 'flac', 'aac', 'm4a', 'wma', 'aiff', 'opus']);

const isTimelineTrackShellAudioClip = (
  clip: Pick<TimelineTrackShellClip, 'name' | 'source'>,
  track: TimelineTrackProps['track'],
): boolean => {
  const sourceType = clip.source?.type;
  const fileExt = (clip.name || '').split('.').pop()?.toLowerCase() || '';
  return track.type === 'audio' || sourceType === 'audio' || SPECTRAL_AUDIO_EXTENSIONS.has(fileExt);
};

export const buildTimelineTrackClipShellActiveModules = ({
  clip,
  track,
  allTrackClips,
  activeTimelineToolId,
  audioDisplayMode,
  audioFocusMode,
  audioRegionGainPreview,
  audioRegionSelection,
  audioSpectralRegionSelection,
  clipContextMenu,
  clipFade,
  clipTrim,
  fadeVisualState,
  hasAudioRegionClipboard,
  hoveredClipId,
  keyframeState,
  selectedSpectralImageFile,
  showAudioRegionEditMarkers,
  specialState,
  spectralImageMediaRefs,
  videoBakeRegionSelection,
  parentingEnabled,
}: Pick<
  TimelineTrackProps,
  | 'activeTimelineToolId'
  | 'audioDisplayMode'
  | 'audioRegionGainPreview'
  | 'audioRegionSelection'
  | 'audioSpectralRegionSelection'
  | 'clipContextMenu'
  | 'clipFade'
  | 'clipTrim'
  | 'track'
  | 'videoBakeRegionSelection'
> & {
  clip: TimelineTrackShellClip;
  allTrackClips: readonly TimelineTrackShellClip[];
  audioFocusMode: boolean;
  fadeVisualState: TimelineTrackShellFadeState;
  hasAudioRegionClipboard: boolean;
  hoveredClipId: string | null;
  keyframeState?: TimelineTrackShellKeyframeState;
  selectedSpectralImageFile: ClipInteractionShellSpectralImageMediaRef | null;
  showAudioRegionEditMarkers: boolean;
  specialState?: TimelineTrackShellSpecialState;
  spectralImageMediaRefs: readonly ClipInteractionShellSpectralImageMediaRef[];
  parentingEnabled: boolean;
}): ClipInteractionShellActiveModules => {
  const clipId = clip.id;
  const audioRegionGainActive = audioRegionGainPreview?.clipId === clipId;
  const isTrimGestureActive = clipTrim?.clipId === clipId;
  const isFadeGestureActive = clipFade?.clipId === clipId;
  const canShowEditHandles = !track.locked && (hoveredClipId === clipId || isTrimGestureActive || isFadeGestureActive);
  const selectedStemKind = clip.audioState?.stemSeparation?.stems
    .find((stem) => stem.id === clip.audioState?.stemSeparation?.soloStemId)
    ?.kind;
  const stemSourceClip = specialState?.stemJob
    ? allTrackClips.find((candidate) => candidate.id === specialState.stemJob?.clipId) ?? null
    : null;
  const stemSourceMediaFileId = specialState?.stemJob?.sourceMediaFileId ??
    stemSourceClip?.source?.mediaFileId ??
    stemSourceClip?.mediaFileId ??
    clip.source?.mediaFileId ??
    clip.mediaFileId ??
    null;

  return {
    parenting: {
      enabled: parentingEnabled,
      slot: 'parenting',
      parentClipId: clip.parentClipId,
      locked: track.locked === true,
    },
    trim: { enabled: canShowEditHandles, slot: 'trim', state: isTrimGestureActive ? clipTrim : null, activeEdges: isTrimGestureActive ? [clipTrim.edge] : [] },
    fade: {
      enabled: canShowEditHandles,
      slot: 'fade',
      state: isFadeGestureActive ? clipFade : null,
      activeEdges: isFadeGestureActive ? [clipFade.edge] : [],
      fadeInDuration: fadeVisualState.fadeInDuration,
      fadeOutDuration: fadeVisualState.fadeOutDuration,
      curveKeyframes: fadeVisualState.keyframes,
      curveKey: fadeVisualState.curveKey,
      clipDuration: fadeVisualState.clipDuration,
      isAudioClip: fadeVisualState.isAudioClip,
    },
    keyframe: {
      enabled: Boolean(keyframeState),
      slot: 'keyframe',
      activeProperty: keyframeState?.activeProperty,
      keyframes: keyframeState?.keyframes ?? [],
      keyframeGroups: keyframeState?.keyframeGroups ?? [],
      selectedKeyframeIds: keyframeState?.selectedKeyframeIds ?? [],
    },
    audioRegion: {
      enabled: specialState?.audioRegionActive === true,
      slot: 'audio-region',
      selection: audioRegionSelection?.clipId === clipId ? audioRegionSelection : null,
      mode: audioRegionGainActive ? 'gain' : 'select',
      gainPreviewDb: audioRegionGainActive ? audioRegionGainPreview.gainDb : undefined,
      audioFocusMode,
      showEditMarkers: showAudioRegionEditMarkers,
      hasClipboard: hasAudioRegionClipboard,
    },
    spectralRegion: {
      enabled: specialState?.spectralRegionActive === true,
      slot: 'spectral-region',
      selection: audioSpectralRegionSelection?.clipId === clipId ? audioSpectralRegionSelection : null,
      imageLayers: clip.audioState?.spectralLayers ?? [],
      imageMediaFiles: spectralImageMediaRefs,
      selectedImageFile: selectedSpectralImageFile,
      canSelectRegion: audioFocusMode &&
        isTimelineTrackShellAudioClip(clip, track) &&
        audioDisplayMode === 'spectral' &&
        activeTimelineToolId === 'select' &&
        track.locked !== true,
    },
    videoBake: {
      enabled: specialState?.videoBakeActive === true,
      slot: 'video-bake',
      selection: (
        videoBakeRegionSelection?.scope === 'clip' &&
        videoBakeRegionSelection.clipId === clipId
      ) ? videoBakeRegionSelection : null,
      regions: clip.videoState?.bakeRegions ?? [],
    },
    stem: {
      enabled: specialState?.stemActive === true,
      slot: 'stem',
      stemState: clip.audioState?.stemSeparation ?? null,
      sourceClip: stemSourceClip,
      sourceMediaFileId: stemSourceMediaFileId,
      activeStemKind: selectedStemKind,
      job: specialState?.stemJob ?? null,
      jobPhase: specialState?.stemJob?.phase,
      progress: specialState?.stemJob?.progress,
    },
    contextMenu: {
      enabled: clipContextMenu?.clipId === clipId,
      slot: 'context-menu',
      state: clipContextMenu?.clipId === clipId ? clipContextMenu : null,
      isOpen: clipContextMenu?.clipId === clipId,
    },
  };
};

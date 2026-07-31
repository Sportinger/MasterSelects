import { createCaptionTextProperties, cloneDefaultCaptionProperties } from '../../services/captions/captionDefaults';
import { renderCaptionTextClipFrame } from '../../services/captions/captionTextRuntime';
import { getCaptionSourceCandidates } from '../../services/captions/captionRuntime';
import { layerBuilder } from '../../services/layerBuilder';
import { renderHostPort } from '../../services/render/renderHostPort';
import {
  createTimelineTextCanvasRuntime,
} from '../../services/timeline/timelineGeneratedCanvasRuntime';
import type { CaptionClipProperties } from '../../types/caption';
import type { TextClipProperties } from '../../types/text';
import type { TimelineClip } from '../../types/timeline';
import { useMediaStore } from '../mediaStore';
import { DEFAULT_TEXT_DURATION } from './constants';
import type { CaptionClipActions, CaptionPropertiesPatch, SliceCreator } from './types';

function getActiveCompositionResolution(): { width: number; height: number } {
  const mediaState = useMediaStore.getState();
  const activeComposition = mediaState.compositions.find(
    composition => composition.id === mediaState.activeCompositionId,
  );
  if (activeComposition?.width && activeComposition.height) {
    return {
      width: Math.max(1, Math.round(activeComposition.width)),
      height: Math.max(1, Math.round(activeComposition.height)),
    };
  }
  const output = renderHostPort.getOutputDimensions();
  return {
    width: Math.max(1, Math.round(output.width || 1920)),
    height: Math.max(1, Math.round(output.height || 1080)),
  };
}

function resolveDefaultDuration(clips: readonly TimelineClip[], startTime: number): number {
  const activeSource = getCaptionSourceCandidates(clips)
    .map(candidate => candidate.clip)
    .find(clip => startTime >= clip.startTime && startTime < clip.startTime + clip.duration);
  return activeSource
    ? Math.max(0.1, activeSource.startTime + activeSource.duration - startTime)
    : DEFAULT_TEXT_DURATION;
}

function mergeCaptionProperties(
  current: CaptionClipProperties,
  patch: CaptionPropertiesPatch,
): CaptionClipProperties {
  return {
    ...current,
    ...patch,
    background: patch.background ? { ...current.background, ...patch.background } : current.background,
    highlight: patch.highlight ? { ...current.highlight, ...patch.highlight } : current.highlight,
  };
}

function findLegacyCaptionTextProperties(clip: TimelineClip): TextClipProperties | undefined {
  const runtimeText = clip.nestedClips?.find(nested =>
    nested.captionLayerBinding?.role === 'text' || nested.source?.type === 'text'
  )?.textProperties;
  if (runtimeText) return structuredClone(runtimeText);
  if (!clip.compositionId) return undefined;
  const composition = useMediaStore.getState().compositions.find(
    candidate => candidate.id === clip.compositionId,
  );
  const serializedText = composition?.timelineData?.clips.find(nested =>
    nested.captionLayerBinding?.role === 'text' || nested.sourceType === 'text'
  )?.textProperties;
  return serializedText ? structuredClone(serializedText) : undefined;
}

export const createCaptionClipSlice: SliceCreator<CaptionClipActions> = (set, get) => ({
  addCaptionClip: async (trackId, startTime, duration, sourceClipId = null) => {
    const initialState = get();
    const track = initialState.tracks.find(candidate => candidate.id === trackId);
    if (!track || track.type !== 'video' || track.locked) return null;

    const resolvedDuration = Math.max(
      0.1,
      duration ?? resolveDefaultDuration(initialState.clips, startTime),
    );
    const clipId = await get().addTextClip(trackId, startTime, resolvedDuration, true);
    if (!clipId) return null;

    const captionProperties = cloneDefaultCaptionProperties();
    captionProperties.sourceClipId = sourceClipId;
    const state = get();
    const textClip = state.clips.find(clip => clip.id === clipId);
    if (!textClip?.textProperties) return null;
    const resolution = getActiveCompositionResolution();
    const textProperties = createCaptionTextProperties({
      caption: captionProperties,
      base: textClip.textProperties,
      ...resolution,
    });
    state.updateTextProperties(clipId, textProperties);
    const styledState = get();
    const styledClip = styledState.clips.find(clip => clip.id === clipId);
    if (!styledClip?.textProperties || styledClip.source?.type !== 'text') return null;
    const captionClip: TimelineClip = {
      ...styledClip,
      name: 'Captions',
      file: new File([], 'caption-clip.txt', { type: 'text/plain' }),
      source: { ...styledClip.source, naturalDuration: resolvedDuration },
      textProperties: styledClip.textProperties,
      captionProperties,
      captionLayerBinding: undefined,
      isComposition: false,
      compositionId: undefined,
      nestedClips: undefined,
      nestedTracks: undefined,
      nestedContentHash: undefined,
      isLoading: false,
    };
    const nextClips = styledState.clips.map(clip => clip.id === clipId ? captionClip : clip);
    set({
      clips: nextClips,
      selectedClipIds: new Set([clipId]),
      primarySelectedClipId: clipId,
      propertiesSelection: { kind: 'clip', clipId },
    });
    renderCaptionTextClipFrame({
      captionClip,
      clips: nextClips,
      tracks: styledState.tracks,
      timelineTime: startTime,
    });
    styledState.invalidateCache();
    layerBuilder.invalidateCache();
    renderHostPort.requestNewFrameRender();
    return clipId;
  },

  ensureCaptionTextClip: async (clipId) => {
    const state = get();
    const clip = state.clips.find(candidate => candidate.id === clipId);
    if (!clip?.captionProperties) return false;
    if (clip.source?.type === 'text' && clip.textProperties && !clip.isComposition) return true;

    const oldCompositionId = clip.compositionId;
    const resolution = getActiveCompositionResolution();
    const legacyProperties = findLegacyCaptionTextProperties(clip);
    const fallbackBase = legacyProperties ?? {
      text: 'Caption preview',
      fontFamily: clip.captionProperties.fontFamily,
      fontSize: clip.captionProperties.fontSize,
      fontWeight: clip.captionProperties.fontWeight,
      fontStyle: clip.captionProperties.fontStyle,
      color: clip.captionProperties.color,
      textAlign: clip.captionProperties.textAlign,
      verticalAlign: 'middle',
      lineHeight: clip.captionProperties.lineHeight,
      letterSpacing: clip.captionProperties.letterSpacing,
      strokeEnabled: clip.captionProperties.outlineEnabled,
      strokeColor: clip.captionProperties.outlineColor,
      strokeWidth: clip.captionProperties.outlineWidth,
      shadowEnabled: false,
      shadowColor: '#000000',
      shadowOffsetX: 0,
      shadowOffsetY: 0,
      shadowBlur: 0,
      pathEnabled: false,
      pathPoints: [],
    } satisfies TextClipProperties;
    const textProperties = legacyProperties ?? createCaptionTextProperties({
      caption: clip.captionProperties,
      base: fallbackBase,
      ...resolution,
    });
    const { canvas, textProperties: restoredProperties } = await createTimelineTextCanvasRuntime({
      textProperties,
      dimensions: resolution,
    });

    const refreshed = get();
    const currentClip = refreshed.clips.find(candidate => candidate.id === clipId);
    if (!currentClip?.captionProperties) return false;
    const migratedClip: TimelineClip = {
      ...currentClip,
      name: 'Captions',
      file: new File([], 'caption-clip.txt', { type: 'text/plain' }),
      source: { type: 'text', textCanvas: canvas, naturalDuration: currentClip.duration },
      textProperties: restoredProperties,
      captionLayerBinding: undefined,
      isComposition: false,
      compositionId: undefined,
      nestedClips: undefined,
      nestedTracks: undefined,
      nestedContentHash: undefined,
      isLoading: false,
    };
    const nextClips = refreshed.clips.map(candidate => candidate.id === clipId ? migratedClip : candidate);
    set({ clips: nextClips });

    if (oldCompositionId && !nextClips.some(candidate => candidate.compositionId === oldCompositionId)) {
      const mediaState = useMediaStore.getState();
      const oldComposition = mediaState.compositions.find(candidate => candidate.id === oldCompositionId);
      if (oldComposition?.captionComp?.kind === 'caption-comp') {
        mediaState.removeComposition(oldCompositionId);
      }
    }
    renderCaptionTextClipFrame({
      captionClip: migratedClip,
      clips: nextClips,
      tracks: refreshed.tracks,
      timelineTime: refreshed.playheadPosition,
    });
    refreshed.invalidateCache();
    layerBuilder.invalidateCache();
    renderHostPort.requestNewFrameRender();
    return true;
  },

  updateCaptionProperties: (clipId, patch) => {
    const state = get();
    const clip = state.clips.find(candidate => candidate.id === clipId);
    if (!clip?.captionProperties) return;
    if (clip.isComposition || clip.source?.type !== 'text' || !clip.textProperties) {
      void state.ensureCaptionTextClip(clipId).then(migrated => {
        if (migrated) get().updateCaptionProperties(clipId, patch);
      });
      return;
    }
    const nextClip = {
      ...clip,
      captionProperties: mergeCaptionProperties(clip.captionProperties, patch),
    };
    const nextClips = state.clips.map(candidate => candidate.id === clipId ? nextClip : candidate);
    set({ clips: nextClips });
    renderCaptionTextClipFrame({
      captionClip: nextClip,
      clips: nextClips,
      tracks: state.tracks,
      timelineTime: state.playheadPosition,
    });
    state.invalidateCache();
    layerBuilder.invalidateCache();
    renderHostPort.requestNewFrameRender();
  },
});

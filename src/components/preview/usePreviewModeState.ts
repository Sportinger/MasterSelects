import { useEffect, useMemo } from 'react';

import type { Layer } from '../../types/layers';
import type { TextBoundsPath } from '../../types/masks';
import type { TimelineClip, TimelineTrack } from '../../types/timeline';
import type { EditCameraOrthoFrame } from './usePreviewEditCameraConfig';
import type { EditCameraOrthoViewMode } from './previewSceneCameraMath';

const TIMELINE_TIME_EPSILON = 1e-4;

interface UsePreviewModeStateOptions {
  activeCameraClipAtPlayhead: TimelineClip | null;
  clips: TimelineClip[];
  editCameraModeActive: boolean;
  editCameraOrthoFrame: EditCameraOrthoFrame | null;
  editCameraOrthoMode: EditCameraOrthoViewMode | null;
  editCameraOrthoViewActive: boolean;
  editMode: boolean;
  getInterpolatedTextBounds: (clipId: string, clipLocalTime: number) => TextBoundsPath | undefined;
  isEditableSource: boolean;
  isPlaying: boolean;
  layers: Layer[];
  maskPanelActive: boolean;
  playheadPosition: number;
  sceneNavClipId: string | null;
  sceneObjectOverlayEnabled: boolean;
  sceneNavFpsMode: boolean;
  selectedClipId: string | null;
  selectedLayerId: string | null;
  selectLayer: (id: string) => void;
  setEditMode: (value: boolean) => void;
  setTextTyping: (value: boolean) => void;
  sourceMonitorActive: boolean;
  textTyping: boolean;
  tracks: TimelineTrack[];
}

function findActiveCameraClipAtTime(
  clips: TimelineClip[],
  tracks: TimelineTrack[],
  timelineTime: number,
): TimelineClip | null {
  const trackById = new Map(tracks.map((track, index) => [track.id, { track, index }]));
  const activeCameraClips = clips
    .filter((clip) => {
      const trackInfo = trackById.get(clip.trackId);
      if (trackInfo?.track.type === 'audio') return false;
      return (
        clip.source?.type === 'camera' &&
        timelineTime >= clip.startTime - TIMELINE_TIME_EPSILON &&
        timelineTime < clip.startTime + clip.duration + TIMELINE_TIME_EPSILON
      );
    })
    .toSorted((a, b) => (trackById.get(b.trackId)?.index ?? -1) - (trackById.get(a.trackId)?.index ?? -1));

  return (
    activeCameraClips.find((clip) => trackById.get(clip.trackId)?.track.visible !== false) ??
    activeCameraClips[0] ??
    null
  );
}

function isSharedSceneOverlayClip(clip: TimelineClip): boolean {
  const sourceType = clip.source?.type;
  return (
    sourceType === 'camera' ||
    sourceType === 'model' ||
    sourceType === 'gaussian-splat' ||
    sourceType === 'splat-effector' ||
    Boolean(clip.is3D && sourceType !== 'audio')
  );
}

function hasActiveSharedSceneOverlayContent(
  clips: TimelineClip[],
  tracks: TimelineTrack[],
  timelineTime: number,
): boolean {
  const trackById = new Map(tracks.map((track) => [track.id, track]));
  return clips.some((clip) => {
    const track = trackById.get(clip.trackId);
    if (!track || track.type === 'audio' || track.visible === false) return false;
    if (!isSharedSceneOverlayClip(clip)) return false;
    return (
      timelineTime >= clip.startTime - TIMELINE_TIME_EPSILON &&
      timelineTime < clip.startTime + clip.duration + TIMELINE_TIME_EPSILON
    );
  });
}

export function useActiveCameraClipAtPlayhead(
  clips: TimelineClip[],
  tracks: TimelineTrack[],
  playheadPosition: number,
): TimelineClip | null {
  return useMemo(
    () => findActiveCameraClipAtTime(clips, tracks, playheadPosition),
    [clips, playheadPosition, tracks],
  );
}

export function usePreviewModeState({
  activeCameraClipAtPlayhead,
  clips,
  editCameraModeActive,
  editCameraOrthoFrame,
  editCameraOrthoMode,
  editCameraOrthoViewActive,
  editMode,
  getInterpolatedTextBounds,
  isEditableSource,
  isPlaying,
  layers,
  maskPanelActive,
  playheadPosition,
  sceneNavClipId,
  sceneObjectOverlayEnabled,
  sceneNavFpsMode,
  selectedClipId,
  selectedLayerId,
  selectLayer,
  setEditMode,
  setTextTyping,
  sourceMonitorActive,
  textTyping,
  tracks,
}: UsePreviewModeStateOptions) {
  const activeSharedSceneOverlayContent = useMemo(
    () => hasActiveSharedSceneOverlayContent(clips, tracks, playheadPosition),
    [clips, playheadPosition, tracks],
  );
  const selectedClip = useMemo(
    () => (selectedClipId ? clips.find((clip) => clip.id === selectedClipId) ?? null : null),
    [clips, selectedClipId],
  );
  const selectedTextLayer = useMemo(
    () => (
      selectedClip?.source?.type === 'text'
        ? layers.find((layer) => layer?.sourceClipId === selectedClip.id && layer.source?.textCanvas) ?? null
        : null
    ),
    [layers, selectedClip],
  );
  const selectedTextBounds = useMemo(
    () => (
      selectedClip?.textProperties
        ? getInterpolatedTextBounds(selectedClip.id, playheadPosition - selectedClip.startTime)
        : undefined
    ),
    [getInterpolatedTextBounds, playheadPosition, selectedClip],
  );
  const selectedSceneNavClip = useMemo(
    () => (selectedClip?.source?.type === 'camera' ? selectedClip : null),
    [selectedClip],
  );
  const navigationSceneNavClip = editCameraModeActive ? activeCameraClipAtPlayhead : selectedSceneNavClip;
  const sceneNavEnabled = Boolean(
    isEditableSource &&
    navigationSceneNavClip &&
    (
      (editCameraModeActive && !editCameraOrthoViewActive) ||
      (!editMode && sceneNavClipId === navigationSceneNavClip.id)
    ),
  );
  const layerEditMode = editMode && !editCameraModeActive;
  const maskTabActive = isEditableSource && maskPanelActive;
  const maskNavigationMode = layerEditMode && maskTabActive;
  const textClipEditMode = Boolean(layerEditMode && !maskTabActive && selectedClip?.textProperties && selectedTextLayer);
  const textTypingActive = textClipEditMode && textTyping;
  const layerTransformMode = layerEditMode && !maskNavigationMode && (!textClipEditMode || !textTypingActive);
  const freeCanvasNavigationMode = layerTransformMode || maskNavigationMode || textClipEditMode;
  const effectiveSceneNavFpsMode = sceneNavFpsMode && !editCameraModeActive;
  const activeEditCameraOrthoFrame =
    editCameraOrthoMode &&
    activeCameraClipAtPlayhead &&
    editCameraOrthoFrame?.clipId === activeCameraClipAtPlayhead.id &&
    editCameraOrthoFrame.mode === editCameraOrthoMode
      ? editCameraOrthoFrame
      : null;
  const showSceneObjectOverlay = sceneObjectOverlayEnabled && activeSharedSceneOverlayContent && isEditableSource && !isPlaying;
  const textPreviewEditorEnabled = Boolean(
    isEditableSource &&
    !sourceMonitorActive &&
    !isPlaying &&
    textClipEditMode &&
    textTypingActive &&
    !sceneNavEnabled &&
    selectedClip?.textProperties &&
    selectedTextLayer,
  );
  const sceneObjectOverlaySelectedClipId =
    editCameraModeActive &&
    editCameraOrthoViewActive &&
    selectedClipId === activeCameraClipAtPlayhead?.id
      ? null
      : selectedClipId;

  useEffect(() => {
    if (!isEditableSource) {
      setEditMode(false);
    }
  }, [isEditableSource, setEditMode]);

  useEffect(() => {
    if (!selectedClipId || !layerEditMode) return;
    const clip = clips.find(candidate => candidate.id === selectedClipId);
    if (!clip) return;
    const layer = layers.find(candidate => candidate?.name === clip.name);
    if (layer && layer.id !== selectedLayerId) {
      selectLayer(layer.id);
    }
  }, [clips, layerEditMode, layers, selectLayer, selectedClipId, selectedLayerId]);

  useEffect(() => {
    setTextTyping(false);
  }, [selectedClipId, editMode, setTextTyping]);

  useEffect(() => {
    if (!textTyping) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setTextTyping(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [setTextTyping, textTyping]);

  return {
    activeEditCameraOrthoFrame,
    activeSharedSceneOverlayContent,
    effectiveSceneNavFpsMode,
    freeCanvasNavigationMode,
    layerTransformMode,
    maskNavigationMode,
    navigationSceneNavClip,
    sceneNavEnabled,
    sceneObjectOverlaySelectedClipId,
    selectedClip,
    selectedTextBounds,
    selectedTextLayer,
    showSceneObjectOverlay,
    textClipEditMode,
    textPreviewEditorEnabled,
    textTypingActive,
  };
}

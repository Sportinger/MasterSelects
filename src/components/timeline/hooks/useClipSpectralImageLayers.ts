import { useCallback, useMemo, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent } from 'react';
import type { TimelineClip } from '../../../types';
import { useMediaStore } from '../../../stores/mediaStore';
import type { MediaFile } from '../../../stores/mediaStore/types';
import type {
  AddClipSpectralImageLayerInput,
  TimelineSpectralRegionSelection,
} from '../../../stores/timeline/types';
import {
  frequencyHzFromSpectralY,
  resolveTimelineSpectralRegionSelection,
} from '../utils/spectralSelection';

type AddClipSpectralImageLayer = (
  clipId: string,
  layer: AddClipSpectralImageLayerInput,
) => string | null;

type TimelineTimeFromClientX = (
  clientX: number,
  drag: { rectLeft: number; rectWidth: number },
) => number;

export function useClipSpectralImageLayers(input: {
  clip: TimelineClip;
  mediaFiles: readonly MediaFile[];
  audioSpectralRegionSelection: TimelineSpectralRegionSelection | null;
  displayStartTime: number;
  displayDuration: number;
  displayInPoint: number;
  displayOutPoint: number;
  zoom: number;
  spectralMaxFrequencyHz: number;
  canSelectSpectralRegion: boolean;
  timelineTimeFromAudioRegionClientX: TimelineTimeFromClientX;
  addClipSpectralImageLayer: AddClipSpectralImageLayer;
  setAudioSpectralRegionSelection: (selection: TimelineSpectralRegionSelection) => void;
}) {
  const selectedSpectralImageFileId = useMediaStore(s => {
    for (const id of s.selectedIds) {
      const file = s.files.find(candidate => candidate.id === id);
      if (file?.type === 'image') return file.id;
    }
    return null;
  });

  const spectralImageFilesById = useMemo(() => {
    const entries = input.mediaFiles
      .filter(file => file.type === 'image')
      .map(file => [file.id, file] as const);
    return new Map(entries);
  }, [input.mediaFiles]);

  const selectedSpectralImageFile = selectedSpectralImageFileId
    ? spectralImageFilesById.get(selectedSpectralImageFileId) ?? null
    : null;

  const addSpectralImageLayerFromSelection = useCallback((imageMediaFileId: string) => {
    if (!input.audioSpectralRegionSelection) return null;
    const start = Math.min(
      input.audioSpectralRegionSelection.sourceInPoint,
      input.audioSpectralRegionSelection.sourceOutPoint,
    );
    const end = Math.max(
      input.audioSpectralRegionSelection.sourceInPoint,
      input.audioSpectralRegionSelection.sourceOutPoint,
    );
    if (end - start <= 0.0005) return null;

    return input.addClipSpectralImageLayer(input.clip.id, {
      imageMediaFileId,
      timeStart: start,
      duration: end - start,
      frequencyMin: input.audioSpectralRegionSelection.frequencyMinHz,
      frequencyMax: input.audioSpectralRegionSelection.frequencyMaxHz,
      opacity: 0.85,
      blendMode: 'attenuate',
      gainDb: -18,
      featherTime: 0.02,
      featherFrequency: 80,
    });
  }, [input]);

  const handleAddSelectedImageSpectralLayer = useCallback((e: ReactMouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!selectedSpectralImageFile) return;
    addSpectralImageLayerFromSelection(selectedSpectralImageFile.id);
  }, [addSpectralImageLayerFromSelection, selectedSpectralImageFile]);

  const getDroppedImageMediaFileId = useCallback((dataTransfer: DataTransfer): string | null => {
    const mediaFileId = dataTransfer.getData('application/x-media-file-id');
    if (!mediaFileId) return null;
    const file = useMediaStore.getState().files.find(candidate => candidate.id === mediaFileId);
    return file?.type === 'image' ? file.id : null;
  }, []);

  const handleSpectralImageLayerDragOver = useCallback((e: ReactDragEvent<HTMLDivElement>) => {
    if (!input.canSelectSpectralRegion || !getDroppedImageMediaFileId(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  }, [getDroppedImageMediaFileId, input.canSelectSpectralRegion]);

  const handleSpectralImageLayerDrop = useCallback((e: ReactDragEvent<HTMLDivElement>) => {
    if (!input.canSelectSpectralRegion) return;
    const imageMediaFileId = getDroppedImageMediaFileId(e.dataTransfer);
    if (!imageMediaFileId) return;

    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const centerTime = input.timelineTimeFromAudioRegionClientX(e.clientX, {
      rectLeft: rect.left,
      rectWidth: rect.width,
    });
    const layerDuration = Math.max(0.15, Math.min(input.displayDuration, Math.max(0.65, 160 / Math.max(1, input.zoom))));
    const centerFrequency = frequencyHzFromSpectralY(e.clientY - rect.top, rect.height, input.spectralMaxFrequencyHz);
    const frequencySpan = Math.max(120, input.spectralMaxFrequencyHz * 0.16);
    const selection = resolveTimelineSpectralRegionSelection({
      clip: {
        ...input.clip,
        startTime: input.displayStartTime,
        duration: input.displayDuration,
        inPoint: input.displayInPoint,
        outPoint: input.displayOutPoint,
        waveform: input.clip.waveform,
      },
      anchorTimelineTime: centerTime - layerDuration / 2,
      focusTimelineTime: centerTime + layerDuration / 2,
      anchorFrequencyHz: centerFrequency - frequencySpan / 2,
      focusFrequencyHz: centerFrequency + frequencySpan / 2,
      maxFrequencyHz: input.spectralMaxFrequencyHz,
    });

    input.addClipSpectralImageLayer(input.clip.id, {
      imageMediaFileId,
      timeStart: selection.sourceInPoint,
      duration: Math.max(0.001, selection.sourceOutPoint - selection.sourceInPoint),
      frequencyMin: selection.frequencyMinHz,
      frequencyMax: selection.frequencyMaxHz,
      opacity: 0.85,
      blendMode: 'attenuate',
      gainDb: -18,
      featherTime: 0.02,
      featherFrequency: 80,
    });
    input.setAudioSpectralRegionSelection(selection);
  }, [getDroppedImageMediaFileId, input]);

  return {
    spectralImageFilesById,
    selectedSpectralImageFile,
    handleAddSelectedImageSpectralLayer,
    handleSpectralImageLayerDragOver,
    handleSpectralImageLayerDrop,
  };
}

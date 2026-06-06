import type { MediaFile } from '../../../stores/mediaStore/types';
import type { TimelineSpectralRegionSelection } from '../../../stores/timeline/types';
import { spectralYFromFrequencyHz } from './spectralSelection';

export interface SpectralRegionOverlay {
  left: number;
  width: number;
  top: number;
  height: number;
}

export interface SpectralImageLayerOverlayLayer {
  id: string;
  imageMediaFileId: string;
  timeStart: number;
  duration: number;
  frequencyMin: number;
  frequencyMax: number;
  opacity?: number;
  enabled?: boolean;
  blendMode?: 'attenuate' | 'boost' | 'gate' | 'sidechain-mask' | 'replace';
  gainDb?: number;
}

export interface SpectralImageLayerOverlay extends SpectralRegionOverlay {
  id: string;
  layer: SpectralImageLayerOverlayLayer;
  mediaFile?: MediaFile;
}

function finiteNumberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function resolveSpectralLane(trackBaseHeight: number): { top: number; height: number } {
  const top = 18;
  return {
    top,
    height: Math.max(1, trackBaseHeight - top - 4),
  };
}

export function resolveSpectralRegionOverlay(input: {
  selection: TimelineSpectralRegionSelection | null;
  displayStartTime: number;
  displayDuration: number;
  width: number;
  trackBaseHeight: number;
  maxFrequencyHz: number;
}): SpectralRegionOverlay | null {
  const selection = input.selection;
  if (!selection) return null;
  if (selection.endTime - selection.startTime <= 0.001) return null;
  if (selection.frequencyMaxHz - selection.frequencyMinHz <= 1) return null;

  const regionStart = Math.max(input.displayStartTime, selection.startTime);
  const regionEnd = Math.min(input.displayStartTime + input.displayDuration, selection.endTime);
  if (regionEnd <= regionStart) return null;

  const lane = resolveSpectralLane(input.trackBaseHeight);
  const top = lane.top + spectralYFromFrequencyHz(
    selection.frequencyMaxHz,
    lane.height,
    input.maxFrequencyHz,
  );
  const bottom = lane.top + spectralYFromFrequencyHz(
    selection.frequencyMinHz,
    lane.height,
    input.maxFrequencyHz,
  );

  return {
    left: ((regionStart - input.displayStartTime) / Math.max(0.001, input.displayDuration)) * input.width,
    width: ((regionEnd - regionStart) / Math.max(0.001, input.displayDuration)) * input.width,
    top,
    height: Math.max(2, bottom - top),
  };
}

export function resolveSpectralImageLayerOverlays(input: {
  enabled: boolean;
  layers: readonly SpectralImageLayerOverlayLayer[];
  displayStartTime: number;
  displayDuration: number;
  width: number;
  trackBaseHeight: number;
  maxFrequencyHz: number;
  sourceTimeToDisplayTimelineTime: (sourceTime: number) => number;
  mediaFilesById: ReadonlyMap<string, MediaFile>;
}): SpectralImageLayerOverlay[] {
  if (!input.enabled || input.layers.length === 0) return [];

  const lane = resolveSpectralLane(input.trackBaseHeight);
  return input.layers.flatMap((layer) => {
    const layerDuration = finiteNumberOr(layer.duration, 0);
    if (layer.enabled === false || layerDuration <= 0) return [];

    const layerTimeStart = finiteNumberOr(layer.timeStart, 0);
    const layerFrequencyMin = finiteNumberOr(layer.frequencyMin, 0);
    const layerFrequencyMax = finiteNumberOr(layer.frequencyMax, input.maxFrequencyHz);
    const timelineStart = input.sourceTimeToDisplayTimelineTime(layerTimeStart);
    const timelineEnd = input.sourceTimeToDisplayTimelineTime(layerTimeStart + layerDuration);
    const regionStart = Math.max(input.displayStartTime, Math.min(timelineStart, timelineEnd));
    const regionEnd = Math.min(input.displayStartTime + input.displayDuration, Math.max(timelineStart, timelineEnd));
    if (regionEnd <= regionStart) return [];

    const top = lane.top + spectralYFromFrequencyHz(layerFrequencyMax, lane.height, input.maxFrequencyHz);
    const bottom = lane.top + spectralYFromFrequencyHz(layerFrequencyMin, lane.height, input.maxFrequencyHz);

    return [{
      id: layer.id,
      left: ((regionStart - input.displayStartTime) / Math.max(0.001, input.displayDuration)) * input.width,
      width: ((regionEnd - regionStart) / Math.max(0.001, input.displayDuration)) * input.width,
      top,
      height: Math.max(8, bottom - top),
      layer,
      mediaFile: input.mediaFilesById.get(layer.imageMediaFileId),
    }];
  });
}

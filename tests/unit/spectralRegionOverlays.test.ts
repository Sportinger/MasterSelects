import { describe, expect, it } from 'vitest';
import type { SpectralImageLayer } from '../../src/types';
import type { MediaFile } from '../../src/stores/mediaStore/types';
import type { TimelineSpectralRegionSelection } from '../../src/stores/timeline/types';
import {
  resolveSpectralImageLayerOverlays,
  resolveSpectralRegionOverlay,
} from '../../src/components/timeline/utils/spectralRegionOverlays';

const selection: TimelineSpectralRegionSelection = {
  clipId: 'clip-1',
  trackId: 'track-1',
  startTime: 12,
  endTime: 18,
  sourceInPoint: 2,
  sourceOutPoint: 8,
  frequencyMinHz: 0,
  frequencyMaxHz: 1000,
};

const layer: SpectralImageLayer = {
  id: 'layer-1',
  imageMediaFileId: 'image-1',
  timeStart: 2,
  duration: 4,
  frequencyMin: 0,
  frequencyMax: 1000,
  opacity: 0.85,
  blendMode: 'attenuate',
  gainDb: -18,
  featherTime: 0.02,
  featherFrequency: 80,
};

describe('spectral region overlays', () => {
  it('resolves a spectral selection overlay inside the visible clip window', () => {
    expect(resolveSpectralRegionOverlay({
      selection,
      displayStartTime: 10,
      displayDuration: 10,
      width: 1000,
      trackBaseHeight: 100,
      maxFrequencyHz: 1000,
    })).toEqual({
      left: 200,
      width: 600,
      top: 18,
      height: 78,
    });
  });

  it('returns null for empty time or frequency selections', () => {
    expect(resolveSpectralRegionOverlay({
      selection: { ...selection, endTime: 12 },
      displayStartTime: 10,
      displayDuration: 10,
      width: 1000,
      trackBaseHeight: 100,
      maxFrequencyHz: 1000,
    })).toBeNull();

    expect(resolveSpectralRegionOverlay({
      selection: { ...selection, frequencyMaxHz: 1 },
      displayStartTime: 10,
      displayDuration: 10,
      width: 1000,
      trackBaseHeight: 100,
      maxFrequencyHz: 1000,
    })).toBeNull();
  });

  it('resolves spectral image layer overlays and attaches media file metadata', () => {
    const mediaFile = { id: 'image-1', name: 'Mask', type: 'image' } as MediaFile;

    expect(resolveSpectralImageLayerOverlays({
      enabled: true,
      layers: [layer],
      displayStartTime: 10,
      displayDuration: 10,
      width: 1000,
      trackBaseHeight: 100,
      maxFrequencyHz: 1000,
      sourceTimeToDisplayTimelineTime: sourceTime => 10 + sourceTime,
      mediaFilesById: new Map([[mediaFile.id, mediaFile]]),
    })).toEqual([{
      id: 'layer-1',
      left: 200,
      width: 400,
      top: 18,
      height: 78,
      layer,
      mediaFile,
    }]);
  });

  it('skips disabled, zero-duration, or globally disabled layer overlays', () => {
    expect(resolveSpectralImageLayerOverlays({
      enabled: false,
      layers: [layer],
      displayStartTime: 10,
      displayDuration: 10,
      width: 1000,
      trackBaseHeight: 100,
      maxFrequencyHz: 1000,
      sourceTimeToDisplayTimelineTime: sourceTime => 10 + sourceTime,
      mediaFilesById: new Map(),
    })).toEqual([]);

    expect(resolveSpectralImageLayerOverlays({
      enabled: true,
      layers: [
        { ...layer, id: 'disabled', enabled: false },
        { ...layer, id: 'zero', duration: 0 },
      ],
      displayStartTime: 10,
      displayDuration: 10,
      width: 1000,
      trackBaseHeight: 100,
      maxFrequencyHz: 1000,
      sourceTimeToDisplayTimelineTime: sourceTime => 10 + sourceTime,
      mediaFilesById: new Map(),
    })).toEqual([]);
  });
});

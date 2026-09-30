import { describe, expect, it, vi } from 'vitest';
import { createTimelineClipCanvasWorkerWaveformResource } from '../../src/components/timeline/utils/timelineClipCanvasWaveformResource';
import { createTimelineClipCanvasWorkerPreparedResourcesByClipId } from '../../src/components/timeline/utils/timelineClipCanvasPreparedResources';
import type { TimelineWaveformPyramid } from '../../src/components/timeline/utils/waveformLod';
import { createTimelineClipCanvasWorkerPaintClipInput, getTimelineClipCanvasWorkerEligibility } from '../../src/components/timeline/utils/timelineClipCanvasWorkerModel';

vi.mock('../../src/services/timeline/timelineWaveformArtifactWarmup', () => ({
  getCachedTimelineWaveformArtifact: () => null,
}));
vi.mock('../../src/services/timeline/timelineSpectrogramArtifactWarmup', () => ({
  getCachedTimelineSpectrogramArtifact: () => null,
}));
vi.mock('../../src/services/thumbnailCacheService', () => ({
  thumbnailCacheService: { getThumbnailsForRange: () => [] },
}));

function createClip() {
  return {
    id: 'audio', name: 'Audio', trackId: 'audio-track', startTime: 0, duration: 8, inPoint: 0, outPoint: 8,
    trackType: 'audio' as const, source: { type: 'audio', naturalDuration: 8 },
    waveform: [0.1, 0.2, 0.8, 0.4, 0.1, 0.3, 0.7, 0.2],
  };
}

describe('prepared timeline waveform reuse', () => {
  it('reuses columns across scrolls even though the prepared clip geometry is recreated', () => {
    const clip = createClip();
    const input = {
      clips: [clip], waveformPyramids: undefined, spectrogramTileSets: undefined,
      waveformsEnabled: true, audioDisplayMode: 'detailed' as const, height: 62,
      cssWidth: 200, canvasOffsetX: 0, scrollX: 0, viewportWidth: 100,
      timeToPixel: (time: number) => time * 40, renderOverscanPx: 20,
      minThumbnailWidth: 24, thumbnailSlotPx: 71, maxThumbnailSlots: 48,
      showFaceRanges: false, resolveGeometry: () => ({ ...clip, visible: true }),
      getMediaStatus: () => undefined,
    };
    const before = createTimelineClipCanvasWorkerPreparedResourcesByClipId(input)?.get(clip.id)?.waveform;
    const after = createTimelineClipCanvasWorkerPreparedResourcesByClipId({
      ...input, canvasOffsetX: 50, scrollX: 100,
      timeToPixel: (time: number) => time * 40,
    })?.get(clip.id)?.waveform;

    expect(before?.columns.length).toBeGreaterThan(0);
    expect(after).toBe(before);
  });

  it('refreshes columns for trims, zoom, waveform edits and channel layout', () => {
    const clip = createClip();
    const zoom = (time: number) => time * 40;
    const original = createTimelineClipCanvasWorkerWaveformResource(clip, undefined, 'detailed', 62, zoom, clip);
    const trimmed = createTimelineClipCanvasWorkerWaveformResource({ ...clip, inPoint: 4 }, undefined, 'detailed', 62, zoom, clip);
    expect(trimmed).not.toBe(original);
    expect(trimmed?.columns).not.toEqual(original?.columns);

    const zoomed = createTimelineClipCanvasWorkerWaveformResource(clip, undefined, 'detailed', 62, (time) => time * 80, clip);
    expect(zoomed?.columnCount).toBe(640);
    const edited = createTimelineClipCanvasWorkerWaveformResource({ ...clip, waveform: [0, 0] }, undefined, 'detailed', 62, zoom, clip);
    expect(edited?.columns.every((value) => value === 0)).toBe(true);

    const stereoClip = { ...clip, waveformChannels: [clip.waveform, [0.2, 0.4]] };
    const stereo = createTimelineClipCanvasWorkerWaveformResource(stereoClip, undefined, 'detailed', 62, zoom, clip);
    const collapsed = createTimelineClipCanvasWorkerWaveformResource(stereoClip, undefined, 'detailed', 30, zoom, clip);
    expect(stereo?.channelCount).toBe(2);
    expect(collapsed?.channelCount).toBe(1);
  });

  it('reuses source columns when clip projections are replaced or stereo rows are resized', () => {
    const clip = createClip();
    const zoom = (time: number) => time * 40;
    const original = createTimelineClipCanvasWorkerWaveformResource(clip, undefined, 'detailed', 62, zoom, clip);
    const projection = { ...clip, id: 'new-projection', startTime: 20 };
    const resized = createTimelineClipCanvasWorkerWaveformResource(projection, undefined, 'detailed', 120, zoom, projection);
    expect(resized).toBe(original);
    const trimmed = createTimelineClipCanvasWorkerWaveformResource({ ...projection, inPoint: 4 }, undefined, 'detailed', 120, zoom, projection);
    expect(trimmed).not.toBe(original);
    expect(createTimelineClipCanvasWorkerWaveformResource(clip, undefined, 'detailed', 62, zoom, clip)).toBe(original);
  });

  it('prepares waveform columns only for clips inside the canvas and overscan', () => {
    const visible = createClip();
    const hidden = { ...createClip(), id: 'hidden', startTime: 100 };
    const input = {
      clips: [visible, hidden], waveformPyramids: undefined, spectrogramTileSets: undefined,
      waveformsEnabled: true, audioDisplayMode: 'detailed' as const, height: 62,
      cssWidth: 200, canvasOffsetX: 0, scrollX: 0, viewportWidth: 100,
      timeToPixel: (time: number) => time * 40, renderOverscanPx: 20,
      minThumbnailWidth: 24, thumbnailSlotPx: 71, maxThumbnailSlots: 48,
      showFaceRanges: false, resolveGeometry: (clip: typeof visible) => ({ ...clip, visible: true }),
      getMediaStatus: () => undefined,
    };
    const prepared = createTimelineClipCanvasWorkerPreparedResourcesByClipId(input);
    expect(prepared?.get(visible.id)?.waveform).toBeDefined();
    expect(prepared?.get(hidden.id)?.waveform).toBeUndefined();
    expect(getTimelineClipCanvasWorkerEligibility({
      clips: input.clips.map(clip => createTimelineClipCanvasWorkerPaintClipInput(clip)),
      preparedResourcesByClipId: prepared, waveformsEnabled: true, audioDisplayMode: 'detailed',
      canvasOffsetX: input.canvasOffsetX, cssWidth: input.cssWidth, timeToPixel: input.timeToPixel,
    }).eligible).toBe(true);
    const scrolled = createTimelineClipCanvasWorkerPreparedResourcesByClipId({
      ...input, canvasOffsetX: 4000, scrollX: 4000,
    });
    expect(scrolled?.get(hidden.id)?.waveform).toBeDefined();
  });

  it('refreshes when source analysis arrives and when the display mode changes', () => {
    const clip = { ...createClip(), audioState: { sourceAnalysisRefs: { waveformPyramidId: 'pyramid' } } };
    const zoom = (time: number) => time * 40;
    const legacy = createTimelineClipCanvasWorkerWaveformResource(clip, undefined, 'detailed', 62, zoom, clip);
    const pyramid: TimelineWaveformPyramid = {
      duration: 8, sampleRate: 8,
      levels: [{ samplesPerBucket: 1, bucketDuration: 1, bucketCount: 8, channels: [{
        channelIndex: 0, min: Array(8).fill(-0.5), max: Array(8).fill(0.5),
        rms: Array(8).fill(0.25), peak: Array(8).fill(0.5),
      }] }],
    };
    const pyramids = new Map([['pyramid', pyramid]]);
    const analyzed = createTimelineClipCanvasWorkerWaveformResource(clip, pyramids, 'detailed', 62, zoom, clip);
    expect(analyzed).not.toBe(legacy);
    expect(analyzed?.columns).not.toEqual(legacy?.columns);
    const compact = createTimelineClipCanvasWorkerWaveformResource(clip, pyramids, 'compact', 62, zoom, clip);
    expect(compact?.mode).toBe('compact');
    expect(compact?.columns).not.toEqual(analyzed?.columns);
    expect(createTimelineClipCanvasWorkerWaveformResource(clip, pyramids, 'spectral', 62, zoom, clip)).toBeUndefined();
  });
});

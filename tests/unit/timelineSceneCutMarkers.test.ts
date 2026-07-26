import { describe, expect, it, vi } from 'vitest';
import {
  createTimelineClipCanvasSceneCutMarkers,
  createTimelineClipCanvasWorkerPassiveDecorationsResource,
  hasTimelineClipCanvasPassiveDecorations,
} from '../../src/components/timeline/utils/timelineClipCanvasPassiveDecorations';
import { drawTimelineClipCanvasSceneCutMarkers } from '../../src/components/timeline/utils/timelineClipCanvasSceneCutPainter';
import { createTimelineClipCanvasMediaStatusMap } from '../../src/components/timeline/utils/timelineClipCanvasChromeOverlays';
import { estimateWorkerPayloadResourceBytes } from '../../src/components/timeline/workers/timelineClipCanvasWorkerPayloadMetrics';
import { timelinePaintResourceKinds } from '../../src/timeline';
import { countSceneCutsInSourceRange } from '../../src/services/sceneCutDetection/sceneCutRange';
import type { SceneCutPoint } from '../../src/types/sceneCutAnalysis';

const mediaStatus = {
  sceneCutTimestamps: [0, 5, 7.5, 10, 14, 15, 20],
};

describe('timeline scene-cut markers', () => {
  it('counts only cuts strictly inside a clip source range', () => {
    const cuts = [2, 3, 7, 8].map((timestamp) => ({ timestamp })) as SceneCutPoint[];

    expect(countSceneCutsInSourceRange(cuts, 2, 8)).toBe(2);
  });

  it('projects persisted media cuts into the canvas media-status map', () => {
    const statusMap = createTimelineClipCanvasMediaStatusMap([{
      id: 'media-1',
      sceneCutAnalysis: {
        cuts: [{ timestamp: 1.25 }, { timestamp: 4.5 }],
      },
    }]);

    expect(statusMap.get('media-1')?.sceneCutTimestamps).toEqual([1.25, 4.5]);
    expect(timelinePaintResourceKinds).toContain('scene-cut-markers');
  });

  it('maps only cuts inside the trimmed source window', () => {
    const clip = {
      duration: 10,
      inPoint: 5,
      outPoint: 15,
      trackType: 'video' as const,
      source: { type: 'video' },
    };

    const markers = createTimelineClipCanvasSceneCutMarkers({ clip, mediaStatus });

    expect(Array.from(markers ?? [])).toEqual([
      expect.closeTo(0.25),
      expect.closeTo(0.5),
      expect.closeTo(0.9),
    ]);
    expect(hasTimelineClipCanvasPassiveDecorations(clip, mediaStatus)).toBe(true);
  });

  it('mirrors marker positions for reversed clips and honors live trim geometry', () => {
    const clip = {
      duration: 10,
      inPoint: 5,
      outPoint: 15,
      reversed: true,
      trackType: 'video' as const,
      source: { type: 'video' },
    };

    const markers = createTimelineClipCanvasSceneCutMarkers({
      clip,
      mediaStatus,
      inPoint: 7,
      outPoint: 11,
    });

    expect(Array.from(markers ?? [])).toEqual([
      expect.closeTo(0.875),
      expect.closeTo(0.25),
    ]);
  });

  it('does not decorate linked audio clips', () => {
    const clip = {
      duration: 10,
      inPoint: 5,
      outPoint: 15,
      trackType: 'audio' as const,
      source: { type: 'audio' },
    };

    expect(createTimelineClipCanvasSceneCutMarkers({ clip, mediaStatus })).toBeUndefined();
    expect(hasTimelineClipCanvasPassiveDecorations(clip, mediaStatus)).toBe(false);
  });

  it('carries scene-cut ratios in the worker passive-decoration resource', () => {
    const resource = createTimelineClipCanvasWorkerPassiveDecorationsResource({
      clip: {
        duration: 10,
        inPoint: 5,
        outPoint: 15,
        trackType: 'video',
        source: { type: 'video' },
      },
      mediaStatus,
      clipWidth: 200,
    });

    expect(resource?.kind).toBe('passive-decorations');
    expect(Array.from(resource?.sceneCutMarkers ?? [])).toEqual([
      expect.closeTo(0.25),
      expect.closeTo(0.5),
      expect.closeTo(0.9),
    ]);
  });

  it('paints thin dashed black lines through the clip body', () => {
    const context = {
      strokeStyle: '',
      lineWidth: 0,
      lineCap: '',
      save: vi.fn(),
      beginPath: vi.fn(),
      roundRect: vi.fn(),
      clip: vi.fn(),
      setLineDash: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      restore: vi.fn(),
    } as unknown as CanvasRenderingContext2D;

    drawTimelineClipCanvasSceneCutMarkers(
      context,
      new Float32Array([0.25, 0.75]),
      10,
      2,
      200,
      40,
    );

    expect(context.strokeStyle).toBe('#050505');
    expect(context.lineWidth).toBe(1.5);
    expect(context.setLineDash).toHaveBeenCalledWith([3.75, 3]);
    expect(context.moveTo).toHaveBeenNthCalledWith(1, 60, 2);
    expect(context.lineTo).toHaveBeenNthCalledWith(1, 60, 42);
    expect(context.moveTo).toHaveBeenNthCalledWith(2, 160, 2);
    expect(context.lineTo).toHaveBeenNthCalledWith(2, 160, 42);
    expect(context.stroke).toHaveBeenCalledOnce();
  });

  it('reduces marker width when cuts become dense while zooming out', () => {
    const context = {
      strokeStyle: '',
      lineWidth: 0,
      lineCap: '',
      save: vi.fn(),
      beginPath: vi.fn(),
      roundRect: vi.fn(),
      clip: vi.fn(),
      setLineDash: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      restore: vi.fn(),
    } as unknown as CanvasRenderingContext2D;

    drawTimelineClipCanvasSceneCutMarkers(
      context,
      new Float32Array(100),
      0,
      0,
      200,
      40,
    );

    expect(context.lineWidth).toBeLessThan(1);
  });

  it('includes transferred scene-cut markers in worker resource metrics', () => {
    const markerBytes = new Float32Array([0.25, 0.75]).byteLength;
    const estimatedBytes = estimateWorkerPayloadResourceBytes({
      thumbnailStrips: [],
      waveforms: [],
      spectrograms: [],
      midiPreviews: [],
      fadeVisuals: [],
      trimVisuals: [],
      passiveDecorations: [{
        facetId: 'clip-1:passive-decorations:0',
        resource: {
          kind: 'passive-decorations',
          sceneCutMarkers: new Float32Array([0.25, 0.75]),
        },
      }],
      compositionVisuals: [],
    });

    expect(estimatedBytes).toBe(markerBytes);
  });
});

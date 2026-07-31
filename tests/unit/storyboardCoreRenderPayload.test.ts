import { describe, expect, it } from 'vitest';

import {
  createStoryboardCardRenderPayload,
  paintStoryboardCardMainThread,
  paintStoryboardCardWorker,
  StoryboardCardTextLayoutCache,
  type StoryboardCardCanvasContext,
} from '../../src/components/timeline/storyboard';
import { drawTimelineClipCanvasMainThread } from '../../src/components/timeline/utils/timelineClipCanvasMainThreadDraw';
import {
  buildTimelineClipCanvasWorkerDrawMessage,
  createTimelineClipCanvasWorkerPaintClipInput,
} from '../../src/components/timeline/utils/timelineClipCanvasWorkerModel';
import { createStoryboardTimelineClip } from '../../src/services/storyboard/core';

function createRecordingContext(): {
  context: StoryboardCardCanvasContext;
  calls: unknown[][];
} {
  const calls: unknown[][] = [];
  const context = {
    beginPath: () => calls.push(['beginPath']),
    clip: () => calls.push(['clip']),
    fill: () => calls.push(['fill']),
    fillRect: (...args: unknown[]) => calls.push(['fillRect', ...args]),
    fillText: (...args: unknown[]) => calls.push(['fillText', ...args]),
    roundRect: (...args: unknown[]) => calls.push(['roundRect', ...args]),
    save: () => calls.push(['save']),
    restore: () => calls.push(['restore']),
    stroke: () => calls.push(['stroke']),
  } as unknown as StoryboardCardCanvasContext;
  for (const property of [
    'fillStyle',
    'font',
    'lineWidth',
    'strokeStyle',
    'textBaseline',
  ] as const) {
    Object.defineProperty(context, property, {
      set: value => calls.push([property, value]),
    });
  }
  return { context, calls };
}

describe('storyboard render payload', () => {
  it('is the single serializable payload consumed identically by worker and fallback painters', () => {
    const clip = createStoryboardTimelineClip({
      trackId: 'video-1',
      planId: 'plan-1',
      sceneId: 'scene-1',
      clipId: 'clip-1',
      startTime: 0,
      durationSeconds: 6,
      targetDurationSeconds: 8,
      title: 'A readable opening title',
      description: 'The protagonist enters a crowded station and spots the signal.',
      status: 'ready',
      properties: {
        evidenceRefIds: ['evidence-1', 'evidence-2'],
        selectedCandidateId: 'candidate-1',
      },
    });
    const payload = createStoryboardCardRenderPayload({
      clip,
      x: 10,
      y: 1,
      width: 280,
      height: 70,
      dpr: 2,
    });
    expect(payload).not.toBeNull();
    expect(() => structuredClone(payload)).not.toThrow();

    const main = createRecordingContext();
    const worker = createRecordingContext();
    paintStoryboardCardMainThread(main.context, payload!);
    paintStoryboardCardWorker(worker.context, payload!);
    expect(worker.calls).toEqual(main.calls);
  });

  it('degrades narrow cards and caches text layout by content, dimensions, DPR, and font', () => {
    const clip = createStoryboardTimelineClip({
      trackId: 'video-1',
      planId: 'plan-1',
      title: 'Narrow card',
      description: 'Hidden body copy',
      startTime: 0,
    });
    const cache = new StoryboardCardTextLayoutCache();
    const narrow = createStoryboardCardRenderPayload({
      clip,
      x: 0,
      y: 0,
      width: 10,
      height: 60,
      dpr: 1,
      fontFamily: 'Inter',
      textLayoutCache: cache,
    });
    const repeat = createStoryboardCardRenderPayload({
      clip,
      x: 100,
      y: 0,
      width: 10,
      height: 60,
      dpr: 1,
      fontFamily: 'Inter',
      textLayoutCache: cache,
    });

    expect(narrow?.density).toBe('bar');
    expect(narrow?.titleLines).toEqual([]);
    expect(repeat?.textLayoutCacheKey).toBe(narrow?.textLayoutCacheKey);
    expect(cache.size).toBe(1);
  });

  it('carries the same card payload through the real worker model and paints it in fallback mode', () => {
    const clip = createStoryboardTimelineClip({
      trackId: 'video-1',
      planId: 'plan-1',
      sceneId: 'scene-worker',
      clipId: 'clip-worker',
      startTime: 2,
      durationSeconds: 6,
      targetDurationSeconds: 8,
      title: 'Worker parity title',
      description: 'Visible in both renderer paths.',
      status: 'ready',
    });
    const worker = buildTimelineClipCanvasWorkerDrawMessage({
      clips: [createTimelineClipCanvasWorkerPaintClipInput(clip)],
      height: 72,
      cssWidth: 600,
      canvasOffsetX: 0,
      dpr: 2,
      timeToPixel: time => time * 40,
      selectedClipIds: new Set(),
      trackColor: '#6657d9',
      requestId: 7,
    });
    expect(worker.eligibility.eligible).toBe(true);
    expect(worker.message?.clips[0].storyboardCard).toEqual(
      createStoryboardCardRenderPayload({
        clip,
        x: 80,
        y: 1,
        width: 240,
        height: 70,
        dpr: 2,
      }),
    );

    const calls: unknown[][] = [];
    const context = new Proxy({}, {
      get: (_target, property) => {
        if (property === 'createLinearGradient') {
          return () => ({ addColorStop: () => undefined });
        }
        return (...args: unknown[]) => {
          calls.push([String(property), ...args]);
        };
      },
      set: (_target, property, value) => {
        calls.push([String(property), value]);
        return true;
      },
    }) as CanvasRenderingContext2D;
    drawTimelineClipCanvasMainThread({
      ctx: context,
      clips: [clip],
      height: 72,
      dpr: 2,
      timeToPixel: time => time * 40,
      selectedClipIds: new Set(),
      trackColor: '#6657d9',
      scrollX: 0,
      viewportWidth: 600,
      cssWidth: 600,
      canvasOffsetX: 0,
      renderOverscanPx: 100,
      thumbnailViewportOverscanPx: 100,
      lodBarPx: 4,
      lodThumbnailPx: 80,
      maxThumbnailSlots: 8,
      thumbnailSlotPx: 80,
      resolveGeometry: candidate => ({
        startTime: candidate.startTime,
        duration: candidate.duration,
        inPoint: candidate.inPoint ?? 0,
        outPoint: candidate.outPoint ?? candidate.duration,
        visible: true,
        originalStartTime: candidate.startTime,
        originalEndTime: candidate.startTime + candidate.duration,
        sourceDuration: candidate.duration,
      }),
      getMediaStatus: () => undefined,
      requestRedraw: () => undefined,
    });
    expect(calls).toContainEqual(['fillText', 'Worker parity title', 88, 7]);
  });
});

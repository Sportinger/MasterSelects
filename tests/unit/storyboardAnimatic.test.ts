import { describe, expect, it } from 'vitest';

import {
  clampAnimaticProgress,
  createStoryboardNarrationPlan,
  resolveStillImageScale,
  resolveStoryboardAnimaticFramePayload,
  resolveStoryboardExportGuard,
  restoreStoryboardNarrationPlan,
} from '../../src/services/storyboard/animatic';
import { renderStoryboardAnimaticExportFrame } from '../../src/services/storyboard/animatic/exportAdapter';
import { renderStoryboardAnimaticPreviewFrame } from '../../src/services/storyboard/animatic/previewAdapter';
import { createStoryboardTimelineClip } from '../../src/services/storyboard/core';
import type { MediaFile } from '../../src/stores/mediaStore/types';
import type { TimelineClip, TimelineTrack } from '../../src/types/timeline';

const track: TimelineTrack = {
  id: 'storyboard-track',
  name: 'Storyboard',
  type: 'video',
  height: 80,
  muted: false,
  visible: true,
  solo: false,
};

function scene(filledClipIds: string[] = []): TimelineClip {
  return createStoryboardTimelineClip({
    trackId: track.id,
    planId: 'plan-animatic',
    sceneId: 'scene-opening',
    clipId: 'scene-card',
    startTime: 2,
    durationSeconds: 8,
    targetDurationSeconds: 6,
    title: 'Opening scene',
    description: 'A wide view introduces the location and the protagonist.',
    status: filledClipIds.length ? 'filled' : 'ready',
    properties: {
      filledClipIds,
      notes: 'Temporary narration for the opening.',
      audioDirection: 'Quiet room tone.',
    },
  });
}

function mediaClip(id: string, type: 'video' | 'image', mediaFileId: string): TimelineClip {
  return {
    id,
    trackId: track.id,
    name: id,
    file: new File([], `${id}.${type === 'image' ? 'png' : 'mp4'}`),
    startTime: 2,
    duration: 8,
    inPoint: 0,
    outPoint: 8,
    source: {
      type,
      mediaFileId,
      ...(type === 'image' ? { imageUrl: 'blob:still-image' } : {}),
    },
    mediaFileId,
    transform: {
      opacity: 1,
      blendMode: 'normal',
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: { x: 0, y: 0, z: 0 },
    },
    effects: [],
  };
}

const stillFile: MediaFile = {
  id: 'still-file',
  name: 'Still',
  type: 'image',
  parentId: null,
  createdAt: 1,
  url: 'blob:still-image',
};

function resolve(input: {
  clips: TimelineClip[];
  mode: 'preview' | 'animatic-export' | 'normal-export';
  time?: number;
}) {
  return resolveStoryboardAnimaticFramePayload({
    clips: input.clips,
    tracks: [track],
    mediaFiles: [stillFile],
    time: input.time ?? 6,
    width: 1920,
    height: 1080,
    mode: input.mode,
    cameraMove: 'push-in',
  });
}

function recordingContext() {
  const calls: unknown[][] = [];
  const gradient = { addColorStop: (...args: unknown[]) => calls.push(['addColorStop', ...args]) };
  const context = new Proxy({}, {
    get: (_target, property) => {
      if (property === 'createLinearGradient') {
        return (...args: unknown[]) => {
          calls.push(['createLinearGradient', ...args]);
          return gradient;
        };
      }
      if (property === 'measureText') {
        return (text: string) => ({ width: text.length * 10 });
      }
      return (...args: unknown[]) => calls.push([String(property), ...args]);
    },
    set: (_target, property, value) => {
      calls.push([String(property), value]);
      return true;
    },
  }) as CanvasRenderingContext2D;
  return { calls, context };
}

describe('storyboard animatic payload and playback', () => {
  it('keeps preview/export parity and never resolves unfilled slates for normal export', () => {
    const preview = resolve({ clips: [scene()], mode: 'preview' });
    const animatic = resolve({ clips: [scene()], mode: 'animatic-export' });
    const normal = resolve({ clips: [scene()], mode: 'normal-export' });

    expect(preview?.kind).toBe('slate');
    expect(animatic).toEqual({ ...preview, mode: 'animatic-export' });
    expect(normal).toBeNull();
    expect(() => structuredClone(animatic)).not.toThrow();
  });

  it('uses the same painter contract for explicit animatic export and preview', () => {
    const payload = resolve({ clips: [scene()], mode: 'animatic-export' });
    expect(payload?.kind).toBe('slate');
    const preview = recordingContext();
    const exportFrame = recordingContext();

    renderStoryboardAnimaticPreviewFrame(preview.context, payload!);
    renderStoryboardAnimaticExportFrame(exportFrame.context, payload!);

    expect(JSON.parse(JSON.stringify(exportFrame.calls)))
      .toEqual(JSON.parse(JSON.stringify(preview.calls)));
    expect(exportFrame.calls.some(call => call[0] === 'fillText' && call[1] === 'Opening scene')).toBe(true);
  });

  it('uses real filled video media and deterministic still-image timing', () => {
    const video = mediaClip('filled-video', 'video', 'video-file');
    const image = mediaClip('filled-image', 'image', stillFile.id);
    expect(resolve({ clips: [scene([video.id]), video], mode: 'preview' })?.kind).toBe('real-media');
    expect(resolve({ clips: [scene([video.id]), video], mode: 'animatic-export' })?.kind).toBe('real-media');
    expect(resolve({
      clips: [scene([image.id, video.id]), image, video],
      mode: 'preview',
    })?.kind).toBe('real-media');

    const previewStill = resolve({
      clips: [scene([image.id]), image],
      mode: 'preview',
      time: 6,
    });
    const exportStill = resolve({
      clips: [scene([image.id]), image],
      mode: 'animatic-export',
      time: 6,
    });
    expect(previewStill?.kind).toBe('still-image');
    expect(previewStill?.progress).toBe(0.5);
    expect(previewStill?.still?.scale).toBeCloseTo(1.04);
    expect(exportStill).toEqual({ ...previewStill, mode: 'animatic-export' });
    expect(clampAnimaticProgress(-2, 8)).toBe(0);
    expect(clampAnimaticProgress(12, 8)).toBe(1);
    expect(resolveStillImageScale(1, 'pull-out')).toBe(1);
  });

  it('blocks normal export visibly in policy but permits explicit animatic output', () => {
    const normal = resolveStoryboardExportGuard({
      mode: 'normal-export',
      clips: [scene()],
      tracks: [track],
      startTime: 0,
      endTime: 12,
    });
    const animatic = resolveStoryboardExportGuard({
      mode: 'animatic-export',
      clips: [scene()],
      tracks: [track],
      startTime: 0,
      endTime: 12,
    });

    expect(normal.blocked).toBe(true);
    expect(normal.warnings[0].message).toContain('Choose Animatic');
    expect(animatic.blocked).toBe(false);
    expect(animatic.warnings).toEqual(normal.warnings);

    const filledVideo = mediaClip('policy-video', 'video', 'video-file');
    expect(resolveStoryboardExportGuard({
      mode: 'normal-export',
      clips: [scene([filledVideo.id]), filledVideo],
      tracks: [track],
      startTime: 0,
      endTime: 12,
    }).blocked).toBe(false);
    expect(resolveStoryboardExportGuard({
      mode: 'normal-export',
      clips: [scene(['missing-clip'])],
      tracks: [track],
      startTime: 0,
      endTime: 12,
    }).blocked).toBe(true);
  });

  it('plans temporary narration as reload-safe data without provider submission', () => {
    const plan = createStoryboardNarrationPlan({ clips: [scene()], wordsPerMinute: 120 });
    const restored = restoreStoryboardNarrationPlan(JSON.parse(JSON.stringify(plan)));
    expect(plan.providerSubmission).toBe('none');
    expect(plan.cues).toHaveLength(1);
    expect(plan.cues[0].text).toContain('Temporary narration');
    expect(restored).toEqual(plan);
    expect(restoreStoryboardNarrationPlan({ ...plan, providerSubmission: 'submit' })).toBeNull();
  });
});

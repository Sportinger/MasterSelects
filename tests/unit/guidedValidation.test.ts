import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  validateGuidedCheck,
  waitForGuidedValidation,
} from '../../src/services/guidedActions';
import { useMediaStore } from '../../src/stores/mediaStore';
import { DEFAULT_TRANSFORM, useTimelineStore } from '../../src/stores/timeline';
import type { Effect, Keyframe, TimelineClip } from '../../src/types';

const initialTimelineState = useTimelineStore.getState();
const initialMediaState = useMediaStore.getState();

describe('guided action validation', () => {
  beforeEach(() => {
    vi.useRealTimers();
    useTimelineStore.setState(initialTimelineState);
    vi.mocked(useMediaStore.getState).mockReturnValue({
      ...initialMediaState,
      activeCompositionId: 'comp-1',
      compositions: [{ id: 'comp-1', width: 1920, height: 1080 } as never],
    });
  });

  it('validates selected clips and playhead position from timeline state', () => {
    useTimelineStore.setState({
      selectedClipIds: new Set(['clip-1']),
      playheadPosition: 4.005,
    });

    expect(validateGuidedCheck({ kind: 'clipSelected', clipId: 'clip-1' }).success).toBe(true);
    expect(validateGuidedCheck({ kind: 'playheadAtTime', time: 4 }).success).toBe(true);
    expect(validateGuidedCheck({ kind: 'clipSelected', clipId: 'missing' }).success).toBe(false);
  });

  it('validates transform checks in store and AI tool pixel value spaces', () => {
    const clip = createClip({
      transform: {
        ...structuredClone(DEFAULT_TRANSFORM),
        position: { x: 0.2, y: -0.2, z: 2 },
      },
    });
    useTimelineStore.setState({ clips: [clip] });

    expect(validateGuidedCheck({
      kind: 'clipTransformMatches',
      clipId: 'clip-1',
      property: 'position.x',
      value: 0.2,
    }).success).toBe(true);
    expect(validateGuidedCheck({
      kind: 'clipTransformMatches',
      clipId: 'clip-1',
      property: 'position.x',
      value: 192,
      valueSpace: 'toolPixels',
    }).success).toBe(true);
    expect(validateGuidedCheck({
      kind: 'clipTransformMatches',
      clipId: 'clip-1',
      property: 'position.x',
      value: 192,
    }).success).toBe(false);
  });

  it('validates masks, active masks, effects, keyframes, and imported media', () => {
    const effect: Effect = {
      id: 'effect-1',
      name: 'Blur',
      type: 'blur',
      enabled: true,
      params: {},
    };
    const keyframe: Keyframe = {
      id: 'keyframe-1',
      clipId: 'clip-1',
      time: 1,
      property: 'position.x',
      value: 0.2,
      easing: 'linear',
    };
    const clip = createClip({
      effects: [effect],
      masks: [{
        id: 'mask-1',
        name: 'Mask 1',
        vertices: [
          createMaskVertex(0, 0),
          createMaskVertex(1, 0),
          createMaskVertex(1, 1),
          createMaskVertex(0, 1),
        ],
        closed: true,
        opacity: 1,
        feather: 0,
        featherQuality: 1,
        inverted: false,
        mode: 'add',
        expanded: true,
        position: { x: 0, y: 0 },
        enabled: true,
        visible: true,
      }],
    });

    useTimelineStore.setState({
      clips: [clip],
      activeMaskId: 'mask-1',
      clipKeyframes: new Map([['clip-1', [keyframe]]]),
    });
    const mediaReaders = {
      media: () => ({
        ...useMediaStore.getState(),
        files: [{
          id: 'media-1',
          name: 'clip.mp4',
          type: 'video' as const,
          parentId: null,
          createdAt: 1,
          url: 'blob:clip',
        }],
      } as ReturnType<typeof useMediaStore.getState>),
    };

    expect(validateGuidedCheck({ kind: 'maskExists', clipId: 'clip-1', maskId: 'mask-1', vertexCount: 4 }).success).toBe(true);
    expect(validateGuidedCheck({ kind: 'activeMask', clipId: 'clip-1', maskId: 'mask-1' }).success).toBe(true);
    expect(validateGuidedCheck({ kind: 'effectExists', clipId: 'clip-1', effectType: 'blur' }).success).toBe(true);
    expect(validateGuidedCheck({ kind: 'keyframeExists', clipId: 'clip-1', property: 'position.x', time: 1 }).success).toBe(true);
    expect(validateGuidedCheck({ kind: 'mediaItemImported', name: 'clip.mp4' }, mediaReaders).success).toBe(true);
  });

  it('polls until validation succeeds', async () => {
    vi.useFakeTimers();
    const resultPromise = waitForGuidedValidation(
      { kind: 'clipSelected', clipId: 'clip-1' },
      { timeoutMs: 1000, pollIntervalMs: 50 },
    );

    await Promise.resolve();
    useTimelineStore.setState({ selectedClipIds: new Set(['clip-1']) });
    await vi.advanceTimersByTimeAsync(50);

    await expect(resultPromise).resolves.toEqual(expect.objectContaining({ success: true }));
  });
});

function createClip(overrides: Partial<TimelineClip> = {}): TimelineClip {
  return {
    id: 'clip-1',
    trackId: 'video-1',
    name: 'Clip',
    file: new File([], 'clip.mp4'),
    startTime: 0,
    duration: 5,
    inPoint: 0,
    outPoint: 5,
    source: { type: 'video' },
    transform: structuredClone(DEFAULT_TRANSFORM),
    effects: [],
    ...overrides,
  };
}

function createMaskVertex(x: number, y: number) {
  return {
    id: `vertex-${x}-${y}`,
    x,
    y,
    handleIn: { x: 0, y: 0 },
    handleOut: { x: 0, y: 0 },
  };
}

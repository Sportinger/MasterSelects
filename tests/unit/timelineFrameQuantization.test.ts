import { describe, expect, it } from 'vitest';

import { applyMoveClipsOperation } from '../../src/stores/timeline/editOperations/moveOperations';
import { applyTrimClipOperation } from '../../src/stores/timeline/editOperations/trimOperations';
import {
  isTimeOnFrameGrid,
  quantizeFrameLockedClipTiming,
} from '../../src/utils/timelineFrameQuantization';
import { createMockClip, createMockTrack } from '../helpers/mockData';
import { computeTrimTiming, trimOriginalsFromClip } from '../../src/components/timeline/utils/clipTrimTiming';
import { DEFAULT_VECTOR_ANIMATION_CLIP_SETTINGS } from '../../src/types/vectorAnimation';
import { getTrimHandleArrowDirections } from '../../src/components/timeline/utils/trimHandleDirections';

const videoTrack = createMockTrack({ id: 'video-1', type: 'video' });
const audioTrack = createMockTrack({ id: 'audio-1', type: 'audio' });

describe('timeline frame quantization', () => {
  it.each([
    'text', 'image', 'solid', 'camera', 'light', 'model', 'gaussian-avatar',
    'gaussian-splat', 'splat-effector', 'math-scene', 'transition-overlay',
    'storyboard', 'midi', 'motion-shape', 'motion-null', 'motion-adjustment',
  ] as const)(
    'keeps a right-edge extension past the creation duration for %s clips', (type) => {
      const clip = createMockClip({
        trackId: videoTrack.id,
        startTime: 2,
        duration: 5,
        inPoint: 0,
        outPoint: 5,
        source: { type, naturalDuration: 5 },
      });
      const timing = computeTrimTiming(clip, 'right', trimOriginalsFromClip(clip), 4);
      const result = applyTrimClipOperation({
        id: 'extend-procedural', type: 'trim-clip', clipId: clip.id,
        inPoint: timing.newInPoint, outPoint: timing.newOutPoint,
      }, [clip], [videoTrack]);

      expect(timing.newDuration).toBe(9);
      expect(result.clips[0].duration).toBe(9);
      expect(result.clips[0].outPoint).toBe(9);
      expect(quantizeFrameLockedClipTiming(result.clips[0], 30).duration).toBe(9);
      expect(getTrimHandleArrowDirections(clip, 'right')).toEqual(['left', 'right']);
      const left = computeTrimTiming(clip, 'left', trimOriginalsFromClip(clip), -1);
      expect(left.newStartTime).toBe(1);
      expect(left.newInPoint).toBe(-1);
    },
  );

  it.each(['model', 'gaussian-splat'] as const)('keeps recorded %s sequences bounded', (type) => {
    const sequence = { frames: [], frameRate: 30, duration: 5 };
    const clip = createMockClip({
      startTime: 2, duration: 5, inPoint: 0, outPoint: 5,
      source: {
        type, naturalDuration: 5,
        ...(type === 'model' ? { modelSequence: sequence } : { gaussianSplatSequence: sequence }),
      },
    });
    expect(computeTrimTiming(clip, 'right', trimOriginalsFromClip(clip), 4).newDuration).toBe(5);
    expect(getTrimHandleArrowDirections(clip, 'right')).toEqual(['left']);
    expect(quantizeFrameLockedClipTiming({ ...clip, duration: 9, outPoint: 9 }, 30).duration).toBe(5);
  });

  it.each(['lottie', 'rive'] as const)('extends %s only when loop playback is enabled', (type) => {
    for (const loop of [false, true]) {
      const clip = createMockClip({
        startTime: 0, duration: 5, inPoint: 0, outPoint: 5,
        source: {
          type, naturalDuration: 5,
          vectorAnimationSettings: { ...DEFAULT_VECTOR_ANIMATION_CLIP_SETTINGS, loop },
        },
      });
      const timing = computeTrimTiming(clip, 'right', trimOriginalsFromClip(clip), 4);
      const result = applyTrimClipOperation({
        id: 'extend-vector', type: 'trim-clip', clipId: clip.id,
        inPoint: timing.newInPoint, outPoint: timing.newOutPoint,
      }, [clip], [videoTrack]);
      expect(result.clips[0].duration).toBe(loop ? 9 : 5);
    }
  });

  it('preserves an extended text duration in flattened saved-project timing', () => {
    const clip = { startTime: 2, duration: 9, inPoint: 0, outPoint: 9,
      sourceType: 'text' as const, naturalDuration: 5 };
    expect(quantizeFrameLockedClipTiming(clip, 30)).toBe(clip);
  });

  it('still clamps recorded media to the available source frames', () => {
    const clip = createMockClip({
      startTime: 0, duration: 9, inPoint: 1, outPoint: 10,
      source: { type: 'video', naturalDuration: 5 },
    });
    const result = quantizeFrameLockedClipTiming(clip, 30);
    expect(result.duration).toBe(4);
    expect(result.outPoint).toBe(5);
  });

  it('migrates visual and linked-audio timing but preserves unlinked audio timing', () => {
    const video = createMockClip({
      id: 'video',
      startTime: 6.615,
      duration: 2.615,
      inPoint: 10,
      outPoint: 12.615,
      source: { type: 'video', naturalDuration: 30 },
    });
    const linkedAudio = createMockClip({
      id: 'linked-audio',
      startTime: 6.615,
      duration: 2.615,
      inPoint: 10,
      outPoint: 12.615,
      linkedClipId: 'video',
      source: { type: 'audio', naturalDuration: 30 },
    });
    const unlinkedAudio = createMockClip({
      id: 'unlinked-audio',
      startTime: 6.615,
      duration: 2.615,
      inPoint: 10,
      outPoint: 12.615,
      source: { type: 'audio', naturalDuration: 30 },
    });

    const migratedVideo = quantizeFrameLockedClipTiming(video, 30);
    const migratedLinkedAudio = quantizeFrameLockedClipTiming(linkedAudio, 30);
    const migratedUnlinkedAudio = quantizeFrameLockedClipTiming(unlinkedAudio, 30);

    expect(migratedVideo.startTime).toBe(6.6);
    expect(migratedVideo.duration).toBe(2.6);
    expect(migratedLinkedAudio.startTime).toBe(6.6);
    expect(migratedLinkedAudio.duration).toBe(2.6);
    expect(migratedUnlinkedAudio).toBe(unlinkedAudio);
  });

  it('uses the supplied composition frame rate instead of assuming 30 fps', () => {
    const clip = createMockClip({
      startTime: 6.615,
      duration: 2.615,
      inPoint: 0,
      outPoint: 2.615,
      source: { type: 'video', naturalDuration: 20 },
    });

    const migrated = quantizeFrameLockedClipTiming(clip, 24);

    expect(migrated.startTime).toBe(6.625);
    expect(migrated.duration).toBe(2.625);
    expect(isTimeOnFrameGrid(migrated.startTime, 24)).toBe(true);
    expect(isTimeOnFrameGrid(migrated.startTime + migrated.duration, 24)).toBe(true);
  });

  it('quantizes moves for video and still-linked audio, even when linked movement is disabled', () => {
    const video = createMockClip({
      id: 'video',
      trackId: videoTrack.id,
      startTime: 0,
      linkedClipId: 'linked-audio',
      source: { type: 'video' },
    });
    const linkedAudio = createMockClip({
      id: 'linked-audio',
      trackId: audioTrack.id,
      startTime: 0,
      linkedClipId: 'video',
      source: { type: 'audio' },
    });
    const unlinkedAudio = createMockClip({
      id: 'unlinked-audio',
      trackId: audioTrack.id,
      startTime: 0,
      source: { type: 'audio' },
    });

    const linkedResult = applyMoveClipsOperation({
      id: 'move-linked-audio-alone',
      type: 'move-clips',
      moves: [{ clipId: linkedAudio.id, startTime: 1.015 }],
      includeLinked: false,
    }, [video, linkedAudio], [videoTrack, audioTrack]);
    const unlinkedResult = applyMoveClipsOperation({
      id: 'move-unlinked-audio',
      type: 'move-clips',
      moves: [{ clipId: unlinkedAudio.id, startTime: 1.015 }],
      includeLinked: false,
    }, [unlinkedAudio], [audioTrack]);

    expect(linkedResult.clips.find((clip) => clip.id === linkedAudio.id)?.startTime).toBe(1);
    expect(unlinkedResult.clips[0].startTime).toBe(1.015);
  });

  it('quantizes trims for linked video/audio while leaving unlinked audio sample-accurate', () => {
    const video = createMockClip({
      id: 'video',
      trackId: videoTrack.id,
      duration: 8,
      inPoint: 0,
      outPoint: 8,
      linkedClipId: 'linked-audio',
      source: { type: 'video' },
    });
    const linkedAudio = createMockClip({
      id: 'linked-audio',
      trackId: audioTrack.id,
      duration: 8,
      inPoint: 0,
      outPoint: 8,
      linkedClipId: 'video',
      source: { type: 'audio' },
    });
    const unlinkedAudio = createMockClip({
      id: 'unlinked-audio',
      trackId: audioTrack.id,
      duration: 8,
      inPoint: 0,
      outPoint: 8,
      source: { type: 'audio' },
    });

    const linkedResult = applyTrimClipOperation({
      id: 'trim-linked',
      type: 'trim-clip',
      clipId: video.id,
      inPoint: 1,
      outPoint: 1.08,
      includeLinked: true,
    }, [video, linkedAudio], [videoTrack, audioTrack]);
    const unlinkedResult = applyTrimClipOperation({
      id: 'trim-unlinked-audio',
      type: 'trim-clip',
      clipId: unlinkedAudio.id,
      inPoint: 1,
      outPoint: 1.08,
      includeLinked: false,
    }, [unlinkedAudio], [audioTrack]);

    expect(linkedResult.clips.every((clip) => isTimeOnFrameGrid(clip.duration, 30))).toBe(true);
    expect(linkedResult.clips[0].duration).toBeCloseTo(2 / 30, 10);
    expect(unlinkedResult.clips[0].duration).toBeCloseTo(0.08, 10);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Layer } from '../../src/types';
import {
  clearMotionFrameRuntimeCache,
  createMotionFrameRuntimeAdmission,
} from '../../src/engine/motion/MotionFrameRuntime';
import {
  createDefaultMotionLayerDefinition,
  type MotionLayerDefinition,
  type TextureFillAppearance,
} from '../../src/types/motionDesign';
import { useMediaStore } from '../../src/stores/mediaStore';
import {
  MotionTextureAcquisition,
  buildTextureReuseKey,
} from '../../src/engine/motion/media/motionTextureAcquisition';

// tests/setup.ts globally mocks the media store (getState -> static empty
// state, setState -> no-op vi.fn). Installing a media file therefore means
// overriding the mocked getState, never calling setState.
const mockedGetState = vi.mocked(useMediaStore.getState);
const defaultGetState = mockedGetState.getMockImplementation();

function textureFill(time: number = 0): TextureFillAppearance {
  return {
    id: 'video-texture-fill',
    kind: 'texture-fill',
    name: 'Video Texture Fill',
    visible: true,
    opacity: 1,
    mediaFileId: 'video-alpha',
    fit: 'contain',
    transform: {
      position: { x: 0, y: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
    },
    time,
  };
}

function videoMotion(time: number, columns = 1, rows = 1): MotionLayerDefinition {
  const motion = createDefaultMotionLayerDefinition('shape', { size: { w: 20, h: 10 } });
  if (motion.replicator) {
    motion.replicator.enabled = true;
    motion.replicator.layout = {
      mode: 'grid',
      count: { columns, rows },
      spacing: { x: 0, y: 0 },
      patternOffset: { x: 0, y: 0 },
    };
  }
  motion.appearance = { version: 1, items: [textureFill(time)] };
  return motion;
}

function layerFor(id: string, motion: MotionLayerDefinition): Layer {
  return {
    id,
    sourceClipId: `${id}-clip`,
    visible: true,
    opacity: 1,
    source: { type: 'motion', motion },
  } as unknown as Layer;
}

function frame(motion: MotionLayerDefinition) {
  const admission = createMotionFrameRuntimeAdmission({
    consumer: 'preview',
    compositionId: 'md5-video-freeze',
    timelineTimeSeconds: 0.25,
    layers: [layerFor('video-layer', motion)],
  });
  if (!admission.ok) throw new Error(JSON.stringify(admission.failures));
  return admission.consumerInput.frameState;
}

function installVideoFile(): void {
  mockedGetState.mockReturnValue({
    files: [{
      id: 'video-alpha',
      name: 'video-alpha.mp4',
      type: 'video',
      parentId: null,
      createdAt: 0,
      url: '',
      duration: 10,
      width: 40,
      height: 20,
    }],
  } as never);
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  clearMotionFrameRuntimeCache();
  if (defaultGetState) mockedGetState.mockImplementation(defaultGetState);
  vi.unstubAllGlobals();
});

describe('MD5 video texture-fill freeze', () => {
  it('evaluates a video still at its frozen appearance time and changes identity from zero', () => {
    installVideoFile();
    const frozen = frame(videoMotion(2.5));
    clearMotionFrameRuntimeCache();
    const zero = frame(videoMotion(0));
    const entry = frozen.media.entries[0];

    expect(entry?.request.binding.intent).toMatchObject({
      kind: 'video',
      sourceId: 'motion-media-source/v1:video:video-alpha',
      durationSeconds: 10,
    });
    expect(entry?.request.timing.freezeTimeSeconds).toBe(2.5);
    expect(entry?.evaluation.resolvedTime).toEqual({
      ticks: 2_500_000,
      ticksPerSecond: 1_000_000,
      seconds: 2.5,
    });
    expect(entry?.evaluation.reuseKey).not.toBe(zero.media.entries[0]?.evaluation.reuseKey);
  });

  it('plans one unique frame for a video wall sharing a frozen time', () => {
    installVideoFile();
    const evaluated = frame(videoMotion(2.5, 3, 2));

    expect(evaluated.media.entries).toHaveLength(6);
    expect(new Set(evaluated.media.entries.map((entry) => entry.evaluation.reuseKey)).size).toBe(1);
    expect(evaluated.media.poolPlan.framePool.admittedFrames).toHaveLength(1);
    expect(evaluated.media.poolPlan.requests.slice(1).every((request) => request.reusesFrame)).toBe(true);
  });

  it('extracts a shared video reuse key once and releases retained extraction resources', async () => {
    vi.stubGlobal('GPUTextureUsage', { TEXTURE_BINDING: 1, COPY_DST: 2, RENDER_ATTACHMENT: 4 });
    const texture = { createView: vi.fn(() => ({ kind: 'view' })), destroy: vi.fn() };
    const release = vi.fn();
    const bitmap = { width: 40, height: 20, close: vi.fn() } as unknown as ImageBitmap;
    const extractVideoFrame = vi.fn(async () => ({ bitmap, release }));
    const file = new File(['video'], 'video.mp4', { type: 'video/mp4' });
    const acquisition = new MotionTextureAcquisition({
      createTexture: vi.fn(() => texture),
      queue: { copyExternalImageToTexture: vi.fn() },
    } as unknown as GPUDevice, {
      findMediaFile: () => ({
        id: 'video-alpha', type: 'video', duration: 10, width: 40, height: 20, file,
      } as never),
      resolveFile: vi.fn(async () => file),
      extractVideoFrame,
    });
    const fill = textureFill(2.5);

    expect(acquisition.acquire(fill, vi.fn()).status).toBe('pending');
    expect(acquisition.acquire(fill, vi.fn()).status).toBe('pending');
    await flush();

    const ready = acquisition.acquire(fill, vi.fn());
    expect(ready.status).toBe('ready');
    expect(extractVideoFrame).toHaveBeenCalledTimes(1);
    acquisition.release(ready.reuseKey!);
    expect(texture.destroy).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('falls back to zero for a non-finite authored time without a diagnostic', () => {
    installVideoFile();
    const evaluated = frame(videoMotion(Number.NaN));

    expect(evaluated.diagnostics).toEqual([]);
    expect(evaluated.media.entries[0]?.request.timing.freezeTimeSeconds).toBe(0);
    expect(evaluated.media.entries[0]?.evaluation.resolvedTime.seconds).toBe(0);
  });

  it('keeps image texture reuse keys byte-identical to the B1 zero-time form', () => {
    const appearance = textureFill(999);
    const sourceId = 'motion-media-source/v1:image:image-alpha';
    const legacy = buildTextureReuseKey(sourceId, appearance, { width: 40, height: 20 });
    const explicitZero = buildTextureReuseKey(sourceId, appearance, { width: 40, height: 20 }, {
      ticks: 0,
      ticksPerSecond: 1,
      seconds: 0,
    });

    expect(explicitZero).toBe(legacy);
  });
});

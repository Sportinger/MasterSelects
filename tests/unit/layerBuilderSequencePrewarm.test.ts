import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prewarmGaussianSplatRuntime } = vi.hoisted(() => ({
  prewarmGaussianSplatRuntime: vi.fn(),
}));

vi.mock('../../src/engine/three/splatRuntimeCache', () => ({
  prewarmGaussianSplatRuntime,
}));

import { LayerBuilderService } from '../../src/services/layerBuilder/LayerBuilderService';
import { useTimelineStore } from '../../src/stores/timeline';
import { useMediaStore } from '../../src/stores/mediaStore';
import { DEFAULT_TRANSFORM } from '../../src/stores/timeline/constants';

const initialTimelineState = useTimelineStore.getState();
const initialMediaState = useMediaStore.getState();

describe('LayerBuilderService gaussian splat sequence prewarm', () => {
  beforeEach(() => {
    prewarmGaussianSplatRuntime.mockReset();
    useTimelineStore.setState(initialTimelineState);
    useMediaStore.setState(initialMediaState);
  });

  it('prewarms upcoming gaussian splat sequence frames during playback', () => {
    const service = new LayerBuilderService();
    const frameFiles = [
      new File(['0'], 'scan000000.ply', { type: 'application/octet-stream' }),
      new File(['1'], 'scan000001.ply', { type: 'application/octet-stream' }),
      new File(['2'], 'scan000002.ply', { type: 'application/octet-stream' }),
    ];
    const gaussianSplatSequence = {
      fps: 2,
      frameCount: 3,
      playbackMode: 'clamp' as const,
      sequenceName: 'scan',
      frames: [
        { name: 'scan000000.ply', projectPath: 'Raw/scan000000.ply', file: frameFiles[0], splatUrl: 'blob:scan-0' },
        { name: 'scan000001.ply', projectPath: 'Raw/scan000001.ply', file: frameFiles[1], splatUrl: 'blob:scan-1' },
        { name: 'scan000002.ply', projectPath: 'Raw/scan000002.ply', file: frameFiles[2], splatUrl: 'blob:scan-2' },
      ],
    };

    useMediaStore.setState({
      activeCompositionId: null,
      activeLayerSlots: {},
      layerOpacities: {},
      files: [{
        id: 'media-splat-seq-1',
        name: 'scan (3f)',
        type: 'gaussian-splat',
        createdAt: 1,
        gaussianSplatSequence,
      }],
      compositions: [],
      proxyEnabled: false,
    } as any);

    useTimelineStore.setState({
      tracks: [
        {
          id: 'track-v1',
          name: 'Video 1',
          type: 'video',
          visible: true,
          muted: false,
          solo: false,
        },
      ],
      clips: [
        {
          id: 'clip-splat-seq-1',
          trackId: 'track-v1',
          name: 'Scan Sequence',
          mediaFileId: 'media-splat-seq-1',
          file: frameFiles[0],
          startTime: 0,
          duration: 2,
          inPoint: 0,
          outPoint: 2,
          effects: [],
          transform: { ...DEFAULT_TRANSFORM },
          source: {
            type: 'gaussian-splat',
            mediaFileId: 'media-splat-seq-1',
            gaussianSplatSequence,
            gaussianSplatSettings: {
              render: {
                useNativeRenderer: false,
                maxSplats: 4096,
                splatScale: 1,
                nearPlane: 0.1,
                farPlane: 1000,
                backgroundColor: 'transparent',
                sortFrequency: 8,
              },
            },
          },
          isLoading: false,
          is3D: true,
        },
      ],
      playheadPosition: 0,
      isPlaying: true,
      isDraggingPlayhead: false,
      playbackSpeed: 1,
    } as any);

    service.buildLayersFromStore();

    expect(prewarmGaussianSplatRuntime).toHaveBeenCalledTimes(3);
    expect(prewarmGaussianSplatRuntime.mock.calls.map(([options]) => options.cacheKey)).toEqual([
      'Raw/scan000000.ply',
      'Raw/scan000001.ply',
      'Raw/scan000002.ply',
    ]);
    expect(prewarmGaussianSplatRuntime.mock.calls.every(([options]) => options.gaussianSplatSequence === gaussianSplatSequence)).toBe(true);
  });
});

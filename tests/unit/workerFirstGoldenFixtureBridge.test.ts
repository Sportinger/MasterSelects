import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  collectCurrentBakeSignals,
  collectCurrentExportSignals,
  collectCurrentRamCacheSignals,
  collectCurrentTimelineSignals,
  collectCurrentRenderTargetSignals,
  handleCaptureWorkerFirstGoldenFixtureFingerprint,
  type WorkerFirstGoldenFixtureBridgeDeps,
} from '../../src/services/aiTools/workerFirstGoldenFixtureBridge';
import {
  clearWorkerFirstProofCapturesForTests,
  deriveWorkerFirstCapturedGoldenManifests,
  getWorkerFirstProofCaptures,
} from '../../src/services/aiTools/workerFirstProofCaptures';
import {
  WORKER_FIRST_GOLDEN_PROJECT_MANIFESTS,
} from '../../src/services/aiTools/workerFirstProofHarness';

function createCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 180;
  return canvas;
}

function mockCanvasReadback(luma = 128): void {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
    getImageData: vi.fn((_x: number, _y: number, width: number, height: number) => {
      const data = new Uint8ClampedArray(width * height * 4);
      for (let offset = 0; offset < data.length; offset += 4) {
        data[offset] = luma;
        data[offset + 1] = luma;
        data[offset + 2] = luma;
        data[offset + 3] = 255;
      }
      return { data, width, height } as ImageData;
    }),
  } as unknown as CanvasRenderingContext2D);
}

function createDeps(options: {
  readonly canvas?: HTMLCanvasElement | null;
  readonly signals?: readonly string[];
  readonly duration?: number;
} = {}): WorkerFirstGoldenFixtureBridgeDeps {
  const canvas = options.canvas === undefined ? createCanvas() : options.canvas;
  return {
    getCaptureCanvas: vi.fn(() => canvas ? { canvas, source: 'renderTarget:program' } : null),
    setPlayheadPosition: vi.fn(),
    ensureRender: vi.fn(async () => ({ requested: true, waitedMs: 4 })),
    getTimelineSignals: vi.fn(() => options.signals ?? ['image', 'solid', 'text']),
    getTimelineDuration: vi.fn(() => options.duration ?? 2),
  };
}

describe('worker-first golden fixture bridge', () => {
  afterEach(() => {
    clearWorkerFirstProofCapturesForTests();
    vi.restoreAllMocks();
  });

  it('requires a known golden fixture project id', async () => {
    const result = await handleCaptureWorkerFirstGoldenFixtureFingerprint({}, createDeps());

    expect(result.success).toBe(false);
    expect(result.error).toContain('valid worker-first golden fixture projectId');
    expect(result.data).toMatchObject({
      allowedProjectIds: expect.arrayContaining(['solid-text-image']),
    });
  });

  it('rejects caller-supplied source or fingerprint evidence', async () => {
    const result = await handleCaptureWorkerFirstGoldenFixtureFingerprint({
      projectId: 'solid-text-image',
      sampleTimeSeconds: 0,
      source: 'worker-shadow-main',
    }, createDeps());

    expect(result.success).toBe(false);
    expect(result.error).toContain('cannot be caller-supplied');
    expect(getWorkerFirstProofCaptures().goldenFixtures).toHaveLength(0);
  });

  it('derives universal 3D, gaussian, and CAD signals from clip and SignalAsset descriptors', () => {
    const transform = {
      opacity: 1,
      blendMode: 'normal' as const,
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: { x: 0, y: 0, z: 0 },
    };
    const signals = collectCurrentTimelineSignals([
      {
        id: 'clip-model',
        trackId: 'video-1',
        name: 'Model',
        file: new File([], 'model.dat'),
        startTime: 0,
        duration: 1,
        inPoint: 0,
        outPoint: 1,
        source: { type: 'model', meshType: 'cube', naturalDuration: 1 },
        transform,
        effects: [],
        is3D: true,
      },
      {
        id: 'clip-gaussian',
        trackId: 'video-1',
        name: 'Gaussian Signal',
        file: new File([], 'gaussian.txt'),
        startTime: 0,
        duration: 1,
        inPoint: 0,
        outPoint: 1,
        source: { type: 'text', naturalDuration: 1 },
        transform,
        effects: [],
        signalAssetId: 'signal-gaussian',
      },
      {
        id: 'clip-cad',
        trackId: 'video-1',
        name: 'CAD Signal',
        file: new File([], 'cad.txt'),
        startTime: 0,
        duration: 1,
        inPoint: 0,
        outPoint: 1,
        source: { type: 'text', naturalDuration: 1 },
        transform,
        effects: [],
        signalAssetId: 'signal-cad',
      },
    ], {
      signalAssets: [
        {
          id: 'signal-gaussian',
          signalKinds: ['point-cloud', 'geometry', 'metadata'],
          asset: {
            schemaVersion: 1,
            id: 'signal-gaussian',
            name: 'Gaussian',
            source: { kind: 'generated', fileName: 'fixture.splat', extension: 'splat', mimeType: 'application/octet-stream' },
            refs: [],
            artifacts: [],
            createdAt: '2026-06-16T00:00:00.000Z',
          },
        },
        {
          id: 'signal-cad',
          signalKinds: ['geometry', 'mesh', 'binary', 'metadata'],
          asset: {
            schemaVersion: 1,
            id: 'signal-cad',
            name: 'CAD',
            source: { kind: 'generated', fileName: 'fixture.dxf', extension: 'dxf', mimeType: 'image/vnd.dxf' },
            refs: [],
            artifacts: [],
            createdAt: '2026-06-16T00:00:00.000Z',
            metadata: { formatFamily: 'cad-technical' },
          },
        },
      ],
    });

    expect(signals).toEqual(['3d', 'cad', 'gaussian', 'model', 'text']);
  });

  it('requires the sample time to match the selected manifest', async () => {
    const result = await handleCaptureWorkerFirstGoldenFixtureFingerprint({
      projectId: 'solid-text-image',
      sampleTimeSeconds: 0.25,
    }, createDeps());

    expect(result.success).toBe(false);
    expect(result.error).toContain('sampleTimeSeconds must match');
    expect(result.data).toMatchObject({
      sampleTimesSeconds: [0, 0.5, 1],
    });
  });

  it('rejects non-finite settle times', async () => {
    const result = await handleCaptureWorkerFirstGoldenFixtureFingerprint({
      projectId: 'solid-text-image',
      sampleTimeSeconds: 0,
      settleMs: 'later',
    }, createDeps());

    expect(result.success).toBe(false);
    expect(result.error).toContain('settleMs must be a finite number');
  });

  it('requires the current timeline to satisfy manifest signals', async () => {
    const result = await handleCaptureWorkerFirstGoldenFixtureFingerprint({
      projectId: 'solid-text-image',
      sampleTimeSeconds: 0,
    }, createDeps({ signals: ['solid', 'text'] }));

    expect(result.success).toBe(false);
    expect(result.error).toContain('does not satisfy');
    expect(result.data).toMatchObject({
      missingRequiredSignals: ['image'],
    });
  });

  it('derives provider-specific signals from runtime video sources', () => {
    const signals = collectCurrentTimelineSignals([{
      id: 'clip-video',
      trackId: 'video-1',
      name: 'Video',
      file: new File([], 'video.webm'),
      startTime: 0,
      duration: 1,
      inPoint: 0,
      outPoint: 1,
      source: {
        type: 'video',
        naturalDuration: 1,
        videoElement: document.createElement('video'),
        webCodecsPlayer: {} as never,
      },
      transform: {
        opacity: 1,
        blendMode: 'normal',
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1 },
        rotation: { x: 0, y: 0, z: 0 },
      },
      effects: [],
    }]);

    expect(signals).toEqual(['audio-clock', 'html-video', 'video', 'webcodecs']);
  });

  it('derives proxy-image only from video clips with active JPEG proxy substitution state', () => {
    const clip = {
      id: 'clip-proxy',
      trackId: 'video-1',
      name: 'Proxy Video',
      file: new File([], 'video.mp4'),
      startTime: 0,
      duration: 2,
      inPoint: 0,
      outPoint: 2,
      source: {
        type: 'video' as const,
        naturalDuration: 2,
        mediaFileId: 'media-proxy',
      },
      transform: {
        opacity: 1,
        blendMode: 'normal',
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1 },
        rotation: { x: 0, y: 0, z: 0 },
      },
      effects: [],
    };

    expect(collectCurrentTimelineSignals([clip], {
      proxyEnabled: true,
      isDraggingPlayhead: true,
      proxyMediaRecords: [{
        id: 'media-proxy',
        proxyStatus: 'ready',
        proxyFps: 24,
        proxyFormat: 'jpeg-sequence',
      }],
    })).toEqual(['audio-clock', 'proxy-image', 'video']);

    expect(collectCurrentTimelineSignals([clip], {
      proxyEnabled: true,
      isDraggingPlayhead: false,
      proxyMediaRecords: [{
        id: 'media-proxy',
        proxyStatus: 'ready',
        proxyFps: 24,
        proxyFormat: 'jpeg-sequence',
      }],
    })).toEqual(['audio-clock', 'video']);
  });

  it('derives render-target and output-slice signals from serializable output routing snapshots', () => {
    expect(collectCurrentRenderTargetSignals({
      resolution: { width: 1280, height: 720 },
      targets: [{
        id: 'target-a',
        name: 'Target A',
        source: { type: 'activeComp' },
        destinationType: 'canvas',
        enabled: true,
        showTransparencyGrid: false,
        isFullscreen: false,
      }],
      activeCompositionTargetIds: ['target-a'],
      independentTargetIds: [],
      sliceConfigs: {
        'target-a': {
          targetId: 'target-a',
          selectedSliceId: 'slice-a',
          slices: [{
            id: 'slice-a',
            name: 'Slice A',
            type: 'slice',
            inverted: false,
            enabled: true,
            inputCorners: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
            warp: {
              mode: 'cornerPin',
              corners: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
            },
          }],
        },
      },
      outputPreview: { activeTab: 'output', previewingTargetId: 'target-a' },
    })).toEqual(['output-slice', 'render-target']);
  });

  it('derives ram-preview and composite-cache signals from serializable cache state', () => {
    expect(collectCurrentRamCacheSignals({
      ramPreviewRange: { start: 0, end: 1 },
      cachedFrameCount: 8,
      cachedRanges: [{ start: 0, end: 1.03 }],
      isRamPreviewing: false,
      ramPreviewProgress: null,
      compositeCacheStats: { count: 8 },
    })).toEqual(['composite-cache', 'ram-preview']);

    expect(collectCurrentRamCacheSignals({
      cachedFrameCount: 0,
      cachedRanges: [],
      compositeCacheStats: { count: 0 },
    })).toEqual([]);
  });

  it('derives clip-bake and composition-bake signals from baked video bake regions', () => {
    const signals = collectCurrentBakeSignals({
      clips: [{
        id: 'clip-baked',
        trackId: 'video-1',
        name: 'Clip Bake',
        file: new File([], 'clip.png'),
        startTime: 0,
        duration: 2,
        inPoint: 0,
        outPoint: 2,
        source: { type: 'image', naturalDuration: 2 },
        transform: {
          opacity: 1,
          blendMode: 'normal',
          position: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1 },
          rotation: { x: 0, y: 0, z: 0 },
        },
        effects: [],
        videoState: {
          bakeRegions: [{
            id: 'clip-bake-region',
            scope: 'clip',
            startTime: 0,
            endTime: 2,
            createdAt: 1,
            status: 'baked',
          }],
        },
      }],
      videoBakeRegions: [{
        id: 'composition-bake-region',
        scope: 'composition',
        startTime: 0,
        endTime: 1,
        createdAt: 1,
        status: 'baked',
      }],
    });

    expect(signals).toEqual(['clip-bake', 'composition-bake']);
    expect(collectCurrentBakeSignals({
      clips: [{
        id: 'clip-marked',
        trackId: 'video-1',
        name: 'Marked Bake',
        file: new File([], 'clip.png'),
        startTime: 0,
        duration: 2,
        inPoint: 0,
        outPoint: 2,
        source: { type: 'image', naturalDuration: 2 },
        transform: {
          opacity: 1,
          blendMode: 'normal',
          position: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1 },
          rotation: { x: 0, y: 0, z: 0 },
        },
        effects: [],
        videoState: {
          bakeRegions: [{
            id: 'clip-marked-region',
            scope: 'clip',
            startTime: 0,
            endTime: 2,
            createdAt: 1,
            status: 'marked',
          }],
        },
      }],
      videoBakeRegions: [{
        id: 'composition-marked-region',
        scope: 'composition',
        startTime: 0,
        endTime: 1,
        createdAt: 1,
        status: 'marked',
      }],
    })).toEqual([]);
  });

  it('derives export only from completed nonempty export preview parity evidence', () => {
    expect(collectCurrentExportSignals({
      completed: true,
      blobSize: 2048,
      previewSampleCount: 3,
      failures: [],
    })).toEqual(['export']);

    expect(collectCurrentExportSignals({
      completed: true,
      blobSize: 0,
      previewSampleCount: 3,
      failures: [],
    })).toEqual([]);

    expect(collectCurrentExportSignals({
      completed: true,
      blobSize: 2048,
      previewSampleCount: 0,
      failures: [],
    })).toEqual([]);

    expect(collectCurrentExportSignals({
      completed: true,
      blobSize: 2048,
      previewSampleCount: 3,
      failures: ['preview mismatch'],
    })).toEqual([]);
  });

  it('derives effects, masks, transitions, and blend-mode signals from clips', () => {
    const signals = collectCurrentTimelineSignals([{
      id: 'clip-effects',
      trackId: 'video-1',
      name: 'Effects',
      file: new File([], 'effects.png'),
      startTime: 0,
      duration: 1,
      inPoint: 0,
      outPoint: 1,
      source: {
        type: 'image',
        naturalDuration: 1,
      },
      transform: {
        opacity: 1,
        blendMode: 'screen',
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1 },
        rotation: { x: 0, y: 0, z: 0 },
      },
      effects: [{ id: 'brightness', name: 'Brightness', type: 'brightness', enabled: true, params: { amount: 0.1 } }],
      masks: [{
        id: 'mask-1',
        name: 'Mask',
        vertices: [],
        closed: true,
        opacity: 1,
        feather: 0,
        featherQuality: 1,
        inverted: false,
        mode: 'add',
        expanded: false,
        position: { x: 0, y: 0 },
        enabled: true,
        visible: true,
      }],
      transitionOut: {
        id: 'transition-1',
        type: 'crossfade',
        duration: 0.5,
        linkedClipId: 'clip-next',
      },
    }]);

    expect(signals).toEqual(['blend-mode', 'effect', 'image', 'mask', 'transition']);
  });

  it('records main-renderer fingerprints for every defined solid-text-image sample', async () => {
    mockCanvasReadback(160);
    const deps = createDeps();
    const sampleTimes = [0, 0.5, 1];

    for (const sampleTimeSeconds of sampleTimes) {
      const result = await handleCaptureWorkerFirstGoldenFixtureFingerprint({
        projectId: 'solid-text-image',
        sampleTimeSeconds,
      }, deps);

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        projectId: 'solid-text-image',
        manifestStatus: 'defined',
        sampleTimeSeconds,
        source: 'main-renderer',
        canvasSource: 'renderTarget:program',
        w5StartPermissionsRemainStatsGuarded: true,
        fingerprint: {
          sourceWidth: 16,
          sourceHeight: 16,
          sampleWidth: 16,
          sampleHeight: 16,
          nonBlankRatio: 1,
        },
      });
    }

    expect(deps.setPlayheadPosition).toHaveBeenCalledTimes(3);
    expect(deps.setPlayheadPosition).toHaveBeenNthCalledWith(1, 0);
    expect(deps.setPlayheadPosition).toHaveBeenNthCalledWith(2, 0.5);
    expect(deps.setPlayheadPosition).toHaveBeenNthCalledWith(3, 1);
    expect(deps.ensureRender).toHaveBeenCalledTimes(3);

    const captures = getWorkerFirstProofCaptures();
    expect(captures.goldenFixtures).toHaveLength(3);
    expect(captures.goldenFixtures.map((capture) => capture.source)).toEqual([
      'main-renderer',
      'main-renderer',
      'main-renderer',
    ]);

    const manifests = deriveWorkerFirstCapturedGoldenManifests(
      WORKER_FIRST_GOLDEN_PROJECT_MANIFESTS,
      captures.goldenFixtures,
    );
    expect(manifests.find((manifest) => manifest.id === 'solid-text-image')?.status).toBe('captured');
  });

  it('fails without recording when no render capture canvas is available after rendering', async () => {
    const deps = createDeps({ canvas: null });
    const result = await handleCaptureWorkerFirstGoldenFixtureFingerprint({
      projectId: 'solid-text-image',
      sampleTimeSeconds: 0,
    }, deps);

    expect(result.success).toBe(false);
    expect(result.error).toContain('No active render capture canvas');
    expect(deps.ensureRender).toHaveBeenCalledTimes(1);
    expect(getWorkerFirstProofCaptures().goldenFixtures).toHaveLength(0);
  });
});

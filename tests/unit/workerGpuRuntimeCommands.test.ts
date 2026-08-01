import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  WORKER_GPU_RUNTIME_COMMAND_TRANSFER_POLICY,
  WORKER_GPU_RUNTIME_COMMAND_TYPES,
  collectWorkerGpuRuntimeCommandTransferables,
  type WorkerGpuWebCodecsFrameSeekMode,
  type WorkerGpuRuntimeCommand,
} from '../../src/services/render/workerGpuRuntimeCommands';
import type {
  WorkerGpuLayer,
  WorkerGpuProjectRenderGraph,
  WorkerGpuRenderGraphDelta,
} from '../../src/services/render/workerGpuRenderGraph';

const repoRoot = process.cwd();

function readSource(repoPath: string): string {
  return readFileSync(path.join(repoRoot, repoPath), 'utf8');
}

const solidLayer = {
  id: 'solid-layer',
  trackId: 'track-0',
  order: 0,
  visible: true,
  opacity: 1,
  blendMode: 'normal',
  timing: {
    timelineStart: 0,
    timelineDuration: 10,
    sourceOffset: 0,
    playbackRate: 1,
  },
  transform: {
    anchor: { x: 0.5, y: 0.5 },
    position: { x: 0, y: 0 },
    scale: { x: 1, y: 1 },
    rotationRadians: 0,
  },
  sourceRect: { x: 0, y: 0, width: 1, height: 1 },
  masks: [],
  effects: [],
  source: {
    kind: 'solid',
    color: { r: 0.02, g: 0.04, b: 0.08, a: 1 },
  },
} as const satisfies WorkerGpuLayer;

const videoLayer = {
  ...solidLayer,
  id: 'video-layer',
  trackId: 'track-1',
  order: 1,
  source: {
    kind: 'video',
    providerId: 'provider-video-a',
    sourceId: 'source-video-a',
    assetId: 'asset-video-a',
    intrinsicSize: { x: 1920, y: 1080 },
    framePolicy: 'hold',
    colorSpace: 'rec709',
    alphaMode: 'opaque',
  },
} as const satisfies WorkerGpuLayer;

const graph = {
  id: 'project-a',
  version: 4,
  activeCompositionId: 'comp-a',
  compositions: {
    'comp-a': {
      id: 'comp-a',
      version: 9,
      name: 'Comp A',
      duration: 10,
      size: { x: 1920, y: 1080 },
      clearColor: { r: 0, g: 0, b: 0, a: 1 },
      layers: [solidLayer, videoLayer],
    },
  },
} as const satisfies WorkerGpuProjectRenderGraph;

const deadline = {
  requestId: 'render-1',
  targetId: 'preview',
  compositionId: 'comp-a',
  timelineTime: 1.25,
  frameIndex: 75,
  intent: 'playback',
  submitByMs: 1200,
  expireAfterMs: 1234,
  exact: false,
} as const;

function expectCloneable<T>(value: T): void {
  expect(structuredClone(value)).toEqual(value);
}

describe('worker GPU runtime command contracts', () => {
  it('reserves streaming for the worker-owned WebCodecs stream command', () => {
    const presentFrameMode: WorkerGpuWebCodecsFrameSeekMode = 'advance';
    // @ts-expect-error Normal streaming must use gpu.startWebCodecsStream, not per-frame presentation.
    const disallowedPresentFrameMode: WorkerGpuWebCodecsFrameSeekMode = 'stream';

    expect(presentFrameMode).toBe('advance');
    expect(disallowedPresentFrameMode).toBe('stream');
  });

  it('declares the GPU-only command list for the first target and graph path', () => {
    expect(WORKER_GPU_RUNTIME_COMMAND_TYPES).toEqual([
      'gpu.registerTarget',
      'gpu.unregisterTarget',
      'gpu.presentTestPattern',
      'gpu.presentWebCodecsFrame',
      'gpu.presentFrameStack',
      'gpu.startWebCodecsStream',
      'gpu.stopWebCodecsStream',
      'gpu.initGraph',
      'gpu.graphDelta',
      'gpu.setClock',
      'gpu.renderDeadline',
      'gpu.renderFrame',
      'gpu.readback',
      'gpu.dispose',
    ]);
  });

  it('keeps target, test-pattern, graph, clock, render, readback, and dispose commands cloneable', () => {
    const delta = {
      graphId: 'project-a',
      baseVersion: 4,
      nextVersion: 5,
      operations: [{
        type: 'upsertLayer',
        compositionId: 'comp-a',
        layer: videoLayer,
      }],
    } as const satisfies WorkerGpuRenderGraphDelta;

    const commands = [
      {
        type: 'gpu.registerTarget',
        commandId: 'target-1',
        target: {
          targetId: 'preview',
          compositionId: 'comp-a',
          size: { x: 1920, y: 1080 },
          devicePixelRatio: 1,
          presentation: 'worker-webgpu',
          colorSpace: 'srgb',
          alphaMode: 'opaque',
        },
      },
      {
        type: 'gpu.unregisterTarget',
        commandId: 'target-2',
        targetId: 'preview',
      },
      {
        type: 'gpu.presentTestPattern',
        commandId: 'pattern-1',
        targetId: 'preview',
        timelineTime: 0,
        frameIndex: 0,
        pattern: {
          kind: 'frame-index-gradient',
          frameIndex: 0,
          firstColor: { r: 1, g: 0, b: 0, a: 1 },
          secondColor: { r: 0, g: 0, b: 1, a: 1 },
        },
      },
      {
        type: 'gpu.presentWebCodecsFrame',
        commandId: 'video-frame-1',
        targetId: 'preview',
        sourceId: 'gpu-video:source-a',
        timelineTime: 1.25,
        mediaTime: 1.25,
        frameIndex: 75,
        mode: 'advance',
        timeoutMs: 80,
      },
      {
        type: 'gpu.startWebCodecsStream',
        commandId: 'video-stream-1',
        targetId: 'preview',
        sourceId: 'gpu-video:source-a',
        timelineTime: 1.25,
        mediaTime: 1.25,
        frameIndex: 75,
        playbackRate: 1,
        targetFps: 60,
        timeoutMs: 48,
      },
      {
        type: 'gpu.stopWebCodecsStream',
        commandId: 'video-stream-stop-1',
        targetId: 'preview',
        sourceId: 'gpu-video:source-a',
        reason: 'test stop',
      },
      {
        type: 'gpu.initGraph',
        commandId: 'graph-1',
        graph,
      },
      {
        type: 'gpu.graphDelta',
        commandId: 'graph-2',
        delta,
      },
      {
        type: 'gpu.setClock',
        commandId: 'clock-1',
        clock: {
          timelineTime: 1.25,
          wallClockTimeMs: 1000,
          playbackRate: 1,
          playing: true,
          loop: null,
          audioClockTime: 1.24,
          driftMs: 10,
        },
      },
      {
        type: 'gpu.renderDeadline',
        commandId: 'deadline-1',
        deadline,
      },
      {
        type: 'gpu.renderFrame',
        commandId: 'render-1',
        deadline,
        graphVersion: 5,
      },
      {
        type: 'gpu.readback',
        commandId: 'readback-1',
        request: {
          readbackId: 'readback-a',
          targetId: 'preview',
          compositionId: 'comp-a',
          timelineTime: 1.25,
          size: { x: 320, y: 180 },
          format: 'rgba8unorm',
          colorSpace: 'srgb',
        },
      },
      {
        type: 'gpu.dispose',
        commandId: 'dispose-1',
        reason: 'test cleanup',
      },
    ] as const satisfies readonly WorkerGpuRuntimeCommand[];

    for (const command of commands) {
      expectCloneable(command);
      expect(collectWorkerGpuRuntimeCommandTransferables(command)).toEqual([]);
    }
  });

  it('keeps graph DTOs limited to minimal solid and video source descriptors', () => {
    expectCloneable(graph);
    expect(graph.compositions['comp-a'].layers.map((layer) => layer.source.kind)).toEqual([
      'solid',
      'video',
    ]);
    expect(videoLayer.source).toEqual({
      kind: 'video',
      providerId: 'provider-video-a',
      sourceId: 'source-video-a',
      assetId: 'asset-video-a',
      intrinsicSize: { x: 1920, y: 1080 },
      framePolicy: 'hold',
      colorSpace: 'rec709',
      alphaMode: 'opaque',
    });
  });

  it('keeps legacy GPU commands data-only under the default transfer policy', () => {
    expect(WORKER_GPU_RUNTIME_COMMAND_TRANSFER_POLICY).toEqual({
      acceptsTransferables: false,
      transferableFields: [],
      payloadKind: 'structured-clone-data-only',
    });
  });

  it('keeps forbidden software, legacy, and runtime handle names out of GPU DTO sources', () => {
    const sourcePaths = [
      'src/services/render/workerGpuRuntimeCommands.ts',
      'src/services/render/workerGpuRenderGraph.ts',
    ];
    const forbiddenPatterns = [
      /\bWorkerRenderSoftwareFrame\b/,
      /\bWorkerRenderSoftwareLayer\b/,
      /\bWorkerRenderHostWebCodecsFrame\b/,
      /\bImageBitmap\b/,
      /\bVideoFrame\b/,
      /\bOffscreenCanvas\b/,
      /\bHTMLCanvasElement\b/,
      /\bHTMLVideoElement\b/,
      /\bHTMLImageElement\b/,
      /\bFile\b/,
      /\bBlob\b/,
      /\bAudioContext\b/,
      /\bGPUDevice\b/,
      /\bGPUTexture\b/,
      /\bGPUBuffer\b/,
      /\bGPUCanvasContext\b/,
      /\bGPURenderPipeline\b/,
      /\bWebCodecsPlayer\b/,
      /\bLayer\s*(?:\[\]|<)/,
      /from ['"][^'"]*types\/layers['"]/,
      /from ['"].*workerRenderHostRuntimeCommands['"]/,
      /from ['"].*workerSoftware/,
    ];

    for (const sourcePath of sourcePaths) {
      const source = readSource(sourcePath);
      for (const pattern of forbiddenPatterns) {
        expect(source, `${sourcePath} should not match ${pattern}`).not.toMatch(pattern);
      }
    }
  });
});

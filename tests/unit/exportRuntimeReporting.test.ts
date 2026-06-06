import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExportClipState, FullExportSettings } from '../../src/engine/export/types';
import {
  canRetainExportAudioBuffer,
  canRetainExportFrameProvider,
  canRetainExportOutputSurface,
  canRetainExportParallelFrameBuffer,
  canRetainExportPreviewFrame,
  canRetainExportRunJob,
  releaseExportRunResources,
  reportExportAudioBuffer,
  reportExportClipStates,
  reportExportOutputSurface,
  reportExportParallelDecodeResources,
  reportExportPreviewFrame,
  reportExportRunJob,
  reserveExportFrameProvider,
  reserveExportParallelDecoder,
  reserveExportParallelFrameBuffer,
  reserveExportRuntimeBinding,
} from '../../src/services/timeline/exportRuntimeReporting';
import { timelineRuntimeCoordinator } from '../../src/services/timeline/timelineRuntimeCoordinator';

const settings: FullExportSettings = {
  width: 1920,
  height: 1080,
  fps: 30,
  codec: 'h264',
  container: 'mp4',
  bitrate: 8_000_000,
  startTime: 0,
  endTime: 5,
  includeAudio: true,
};

function createAudioBufferLike(
  length: number,
  numberOfChannels: number,
  sampleRate: number
): AudioBuffer {
  return {
    numberOfChannels,
    sampleRate,
    length,
    duration: length / sampleRate,
    getChannelData: () => new Float32Array(length),
  } as unknown as AudioBuffer;
}

describe('exportRuntimeReporting', () => {
  beforeEach(() => {
    timelineRuntimeCoordinator.clearResources();
  });

  afterEach(() => {
    timelineRuntimeCoordinator.clearResources();
    vi.restoreAllMocks();
  });

  it('reports export job, output surface, preview frame, and releases the run owner', () => {
    reportExportRunJob({
      runId: 'run-export',
      settings,
      totalFrames: 150,
      exportMode: 'fast',
      requestedAudio: true,
      effectiveAudio: true,
    });
    reportExportOutputSurface({
      runId: 'run-export',
      width: settings.width,
      height: settings.height,
      zeroCopy: true,
    });
    reportExportPreviewFrame({
      runId: 'run-export',
      width: 320,
      height: 180,
      currentTime: 1,
    });

    const stats = timelineRuntimeCoordinator.getBridgeStats().policies.export;
    expect(stats.budgetReport.usage).toMatchObject({
      resources: 3,
      jobs: 1,
      gpuTextures: 1,
      imageBitmaps: 1,
      gpuBytes: settings.width * settings.height * 4,
      heapBytes: 320 * 180 * 4,
    });
    expect(stats.resources.map((resource) => resource.kind).toSorted()).toEqual([
      'gpu-texture',
      'image-canvas',
      'job',
    ]);

    releaseExportRunResources('run-export');
    expect(timelineRuntimeCoordinator.getBridgeStats().policies.export.resources).toHaveLength(0);
  });

  it('reports prepared export clip runtime, provider, and precise video resources', () => {
    vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockReturnValue(true);
    const video = document.createElement('video');
    const provider = {
      currentTime: 1,
      isPlaying: false,
      isFullMode: () => true,
      isSimpleMode: () => false,
      getCurrentFrame: () => null,
      seek: vi.fn(),
      pause: vi.fn(),
    };
    const state: ExportClipState = {
      clipId: 'clip-export',
      webCodecsPlayer: provider as never,
      lastSampleIndex: 0,
      isSequential: true,
      runtimeOwnerId: 'export:clip-export',
      runtimeSource: {
        type: 'video',
        runtimeSourceId: 'runtime-source',
        runtimeSessionKey: 'export:export:clip-export:runtime-source',
        mediaFileId: 'media-export',
      },
      preciseVideoElement: video,
      hasDedicatedPreciseVideoElement: true,
    };

    reportExportClipStates('run-export', new Map([[state.clipId, state]]));

    const stats = timelineRuntimeCoordinator.getBridgeStats().policies.export;
    expect(stats.budgetReport.usage).toMatchObject({
      resources: 3,
      sessions: 1,
      frameProviders: 1,
      htmlMediaElements: 1,
    });
    expect(stats.resources.map((resource) => resource.kind).toSorted()).toEqual([
      'html-media',
      'runtime-binding',
      'video-frame-provider',
    ]);
    expect(stats.resources[0].owner).toMatchObject({
      ownerId: 'export:run:run-export',
      ownerType: 'export',
      clipId: 'clip-export',
      mediaFileId: 'media-export',
    });
  });

  it('reports prepared export image resources', () => {
    const image = document.createElement('img');
    image.src = 'blob:export-image';
    const state: ExportClipState = {
      clipId: 'clip-image',
      webCodecsPlayer: null,
      lastSampleIndex: 0,
      isSequential: false,
      exportImageElement: image,
      hasDedicatedExportImageElement: true,
      runtimeSource: {
        type: 'image',
        runtimeSourceId: 'runtime-image',
        runtimeSessionKey: 'export:runtime-image',
        mediaFileId: 'media-image',
      },
    };

    reportExportClipStates('run-export', new Map([[state.clipId, state]]));

    const stats = timelineRuntimeCoordinator.getBridgeStats().policies.export;
    expect(stats.budgetReport.usage).toMatchObject({
      resources: 2,
      sessions: 1,
      imageBitmaps: 1,
    });
    expect(stats.resources.map((resource) => resource.kind).toSorted()).toEqual([
      'image-canvas',
      'runtime-binding',
    ]);
    expect(stats.resources.find((resource) => resource.kind === 'image-canvas')).toMatchObject({
      owner: {
        ownerId: 'export:run:run-export',
        ownerType: 'export',
        clipId: 'clip-image',
        mediaFileId: 'media-image',
      },
      source: {
        clipId: 'clip-image',
        mediaFileId: 'media-image',
        previewPath: 'blob:export-image',
      },
      imageKind: 'html-image',
      label: 'Export dedicated image element',
    });
  });

  it('reports parallel decode decoders and decoded VideoFrame buffer pressure', () => {
    const clipState: ExportClipState = {
      clipId: 'clip-parallel',
      webCodecsPlayer: null,
      lastSampleIndex: 0,
      isSequential: false,
      runtimeSource: {
        type: 'video',
        runtimeSourceId: 'runtime-parallel',
        runtimeSessionKey: 'export:runtime-parallel',
        mediaFileId: 'media-parallel',
      },
    };

    reportExportParallelDecodeResources(
      'run-export',
      {
        isActive: true,
        frameToleranceUs: 50_000,
        clipCount: 1,
        totalBufferedFrames: 3,
        estimatedBufferedFrameBytes: 1920 * 1080 * 4 * 3,
        clips: [
          {
            clipId: 'clip-parallel',
            clipName: 'Parallel Clip',
            codec: 'avc1.640028',
            decoderState: 'configured',
            decodeQueueSize: 2,
            hardwareAcceleration: 'prefer-software',
            dimensions: {
              width: 1920,
              height: 1080,
            },
            sampleCount: 120,
            sampleIndex: 30,
            isDecoding: true,
            hasPendingDecode: true,
            frameBufferSize: 3,
            estimatedBufferedFrameBytes: 1920 * 1080 * 4 * 3,
            oldestBufferedTimeSeconds: 1,
            newestBufferedTimeSeconds: 1.066,
            lastDecodedTimeSeconds: 1.066,
          },
        ],
      },
      new Map([[clipState.clipId, clipState]])
    );

    const stats = timelineRuntimeCoordinator.getBridgeStats().policies.export;
    expect(stats.budgetReport.usage).toMatchObject({
      resources: 2,
      nativeDecoders: 1,
      frameProviders: 1,
      heapBytes: 1920 * 1080 * 4 * 3,
      gpuTextures: 0,
      gpuBytes: 0,
    });
    expect(stats.resources.map((resource) => resource.kind).toSorted()).toEqual([
      'native-decoder',
      'video-frame-provider',
    ]);
    expect(stats.resources[0].owner).toMatchObject({
      ownerId: 'export:run:run-export',
      ownerType: 'export',
      clipId: 'clip-parallel',
      mediaFileId: 'media-parallel',
    });
  });

  it('reports export audio buffers as audio source resources and releases the run owner', () => {
    reportExportAudioBuffer({
      runId: 'run-export',
      stage: 'master-buffer',
      buffer: createAudioBufferLike(48_000, 2, 48_000),
      clipId: 'clip-audio',
      mediaFileId: 'media-audio',
      trackId: 'track-audio',
    });

    const stats = timelineRuntimeCoordinator.getBridgeStats().policies.export;
    expect(stats.budgetReport.usage).toMatchObject({
      resources: 1,
      audioSources: 1,
      heapBytes: 48_000 * 2 * 4,
    });
    expect(stats.resources[0]).toMatchObject({
      kind: 'audio-source-clock',
      dimensions: {
        sampleRate: 48_000,
        channelCount: 2,
        durationSeconds: 1,
      },
      owner: {
        ownerId: 'export:run:run-export',
        ownerType: 'export',
        clipId: 'clip-audio',
        mediaFileId: 'media-audio',
      },
      tags: ['export', 'audio', 'master-buffer'],
    });

    releaseExportRunResources('run-export');
    expect(timelineRuntimeCoordinator.getBridgeStats().policies.export.resources).toHaveLength(0);
  });

  it('checks export admissions without retaining denied resources', () => {
    reportExportRunJob({
      runId: 'existing-run',
      settings,
      totalFrames: 150,
      exportMode: 'fast',
    });

    const deniedJob = canRetainExportRunJob({
      runId: 'denied-run',
      settings,
      totalFrames: 150,
      exportMode: 'fast',
    });
    expect(deniedJob.admitted).toBe(false);
    expect(deniedJob.reason).toBe('budget-exceeded');
    expect(timelineRuntimeCoordinator.getBridgeStats().policies.export.budgetReport.usage.jobs).toBe(1);

    releaseExportRunResources('existing-run');
    const deniedOutput = canRetainExportOutputSurface({
      runId: 'denied-run',
      width: 50_000,
      height: 50_000,
      zeroCopy: true,
    });
    const deniedPreview = canRetainExportPreviewFrame({
      runId: 'denied-run',
      width: 25_000,
      height: 25_000,
      currentTime: 1,
    });
    const deniedAudio = canRetainExportAudioBuffer({
      runId: 'denied-run',
      stage: 'master-buffer',
      buffer: createAudioBufferLike(500_000_000, 1, 48_000),
    });
    const deniedParallelBuffer = canRetainExportParallelFrameBuffer({
      runId: 'denied-run',
      clip: {
        id: 'parallel-huge',
      },
      width: 1920,
      height: 1080,
      estimatedBufferedFrameBytes: 2 * 1024 * 1024 * 1024,
    });

    expect(deniedOutput.admitted).toBe(false);
    expect(deniedPreview.admitted).toBe(false);
    expect(deniedAudio.admitted).toBe(false);
    expect(deniedParallelBuffer.admitted).toBe(false);
    expect(timelineRuntimeCoordinator.getBridgeStats().policies.export.resources).toHaveLength(0);
  });

  it('reserves planned runtime, sequential provider, and parallel decoder resources', () => {
    const runtimeDecision = reserveExportRuntimeBinding({
      runId: 'planned-run',
      clip: {
        id: 'clip-planned',
        trackId: 'track-video',
        mediaFileId: 'media-planned',
        duration: 2,
      },
      runtimeSource: {
        type: 'video',
        runtimeSourceId: 'media:media-planned',
        runtimeSessionKey: 'export:export:clip-planned',
        mediaFileId: 'media-planned',
      },
    });
    expect(runtimeDecision.admitted).toBe(true);

    const providerCanRetain = canRetainExportFrameProvider({
      runId: 'planned-run',
      clip: {
        id: 'clip-planned',
        mediaFileId: 'media-planned',
      },
      runtimeSource: {
        runtimeSourceId: 'media:media-planned',
        runtimeSessionKey: 'export:export:clip-planned',
        mediaFileId: 'media-planned',
      },
      width: 1280,
      height: 720,
    });
    expect(providerCanRetain.admitted).toBe(true);

    const providerDecision = reserveExportFrameProvider({
      runId: 'planned-run',
      clip: {
        id: 'clip-planned',
        mediaFileId: 'media-planned',
      },
      runtimeSource: {
        runtimeSourceId: 'media:media-planned',
        runtimeSessionKey: 'export:export:clip-planned',
        mediaFileId: 'media-planned',
      },
      width: 1280,
      height: 720,
    });
    expect(providerDecision.admitted).toBe(true);

    const decoderDecision = reserveExportParallelDecoder({
      runId: 'planned-run',
      clip: {
        id: 'clip-parallel',
        mediaFileId: 'media-parallel',
      },
      width: 640,
      height: 360,
      codec: 'avc1.640028',
    });
    expect(decoderDecision.admitted).toBe(true);

    const frameBufferDecision = reserveExportParallelFrameBuffer({
      runId: 'planned-run',
      clip: {
        id: 'clip-parallel',
        mediaFileId: 'media-parallel',
      },
      width: 640,
      height: 360,
      codec: 'avc1.640028',
      estimatedBufferedFrameBytes: 640 * 360 * 4 * 5,
    });
    expect(frameBufferDecision.admitted).toBe(true);

    const stats = timelineRuntimeCoordinator.getBridgeStats().policies.export;
    expect(stats.budgetReport.usage).toMatchObject({
      resources: 4,
      sessions: 1,
      frameProviders: 2,
      nativeDecoders: 1,
      heapBytes: 640 * 360 * 4 * 5,
    });
    expect(stats.resources.map((resource) => resource.id).toSorted()).toEqual([
      'export:planned-run:clip:clip-planned:frame-provider',
      'export:planned-run:clip:clip-planned:runtime-binding:media:media-planned:export:export:clip-planned',
      'export:planned-run:parallel:clip-parallel:decoder',
      'export:planned-run:parallel:clip-parallel:frame-buffer',
    ]);

    releaseExportRunResources('planned-run');
    expect(timelineRuntimeCoordinator.getBridgeStats().policies.export.resources).toHaveLength(0);
  });
});

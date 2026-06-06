import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  canRetainRamPreviewCompositeCache,
  canRetainRamPreviewGpuFrame,
  canRetainRamPreviewRunJob,
  releaseRamPreviewCompositeCacheResource,
  releaseReservedRamPreviewImageElement,
  releaseRamPreviewGpuFrameCacheResources,
  releaseRamPreviewRunResources,
  reportRamPreviewClipSource,
  reportRamPreviewCompositeCache,
  reportRamPreviewGpuFrame,
  reportRamPreviewRunJob,
  reserveRamPreviewImageElement,
  reserveRamPreviewVideoSource,
} from '../../src/services/timeline/ramPreviewRuntimeReporting';
import { timelineRuntimeCoordinator } from '../../src/services/timeline/timelineRuntimeCoordinator';
import type { LayerSource, TimelineClip } from '../../src/types';

const clip = {
  id: 'clip-video',
  trackId: 'track-video',
  mediaFileId: 'media-video',
  duration: 5,
} as TimelineClip;

describe('ramPreviewRuntimeReporting', () => {
  beforeEach(() => {
    timelineRuntimeCoordinator.clearResources();
  });

  afterEach(() => {
    timelineRuntimeCoordinator.clearResources();
    vi.restoreAllMocks();
  });

  it('reports and releases a run-scoped render job plus video source resources', () => {
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
    const source: LayerSource = {
      type: 'video',
      videoElement: video,
      webCodecsPlayer: provider,
      runtimeSourceId: 'runtime-source',
      runtimeSessionKey: 'ram-preview:clip-video:runtime-source',
      mediaFileId: 'media-video',
    };

    reportRamPreviewRunJob({
      runId: 'run-1',
      start: 0,
      end: 2,
      centerTime: 1,
      frameCount: 60,
    });
    reportRamPreviewClipSource({
      runId: 'run-1',
      clip,
      source,
      sourceTime: 1,
    });

    const stats = timelineRuntimeCoordinator.getBridgeStats().policies['ram-preview'];
    expect(stats.budgetReport.usage).toMatchObject({
      resources: 4,
      jobs: 1,
      sessions: 1,
      frameProviders: 1,
      htmlMediaElements: 1,
    });
    expect(stats.resources.map((resource) => resource.kind).toSorted()).toEqual([
      'html-media',
      'job',
      'runtime-binding',
      'video-frame-provider',
    ]);

    releaseRamPreviewRunResources('run-1');
    expect(timelineRuntimeCoordinator.getBridgeStats().policies['ram-preview'].resources).toHaveLength(0);
  });

  it('reserves RAM preview video source resources before provider/session creation', () => {
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
    const source: LayerSource = {
      type: 'video',
      videoElement: video,
      webCodecsPlayer: provider,
      runtimeSourceId: 'runtime-source',
      runtimeSessionKey: 'ram-preview:clip-video:runtime-source',
      mediaFileId: 'media-video',
    };

    const admission = reserveRamPreviewVideoSource({
      runId: 'run-video-reserve',
      clip,
      source,
      sourceTime: 1,
    });

    expect(admission.admitted).toBe(true);
    expect(timelineRuntimeCoordinator.getBridgeStats().policies['ram-preview'].budgetReport.usage).toMatchObject({
      resources: 3,
      sessions: 1,
      frameProviders: 1,
      htmlMediaElements: 1,
    });

    admission.release();
    expect(timelineRuntimeCoordinator.getBridgeStats().policies['ram-preview'].resources).toHaveLength(0);
  });

  it('reports CPU composite and GPU frame cache resources under independent owners', () => {
    reportRamPreviewCompositeCache({
      frameCount: 3,
      maxFrames: 900,
      heapBytes: 3 * 100 * 50 * 4,
      width: 100,
      height: 50,
    });
    reportRamPreviewGpuFrame({
      frameKey: 1,
      time: 1,
      width: 100,
      height: 50,
      format: 'rgba8unorm',
      gpuBytes: 100 * 50 * 4,
    });

    const stats = timelineRuntimeCoordinator.getBridgeStats().policies['ram-preview'];
    expect(stats.budgetReport.usage).toMatchObject({
      resources: 2,
      imageBitmaps: 1,
      gpuTextures: 1,
      heapBytes: 3 * 100 * 50 * 4,
      gpuBytes: 100 * 50 * 4,
    });

    releaseRamPreviewCompositeCacheResource();
    expect(timelineRuntimeCoordinator.getBridgeStats().policies['ram-preview'].resources).toHaveLength(1);

    releaseRamPreviewGpuFrameCacheResources();
    expect(timelineRuntimeCoordinator.getBridgeStats().policies['ram-preview'].resources).toHaveLength(0);
  });

  it('checks RAM preview run-job and image admissions without mutating on denial', () => {
    for (let index = 0; index < 2; index += 1) {
      reportRamPreviewRunJob({
        runId: `existing-run-${index}`,
        start: 0,
        end: 1,
        centerTime: 0.5,
      });
    }

    const deniedJob = canRetainRamPreviewRunJob({
      runId: 'denied-run',
      start: 0,
      end: 1,
      centerTime: 0.5,
    });

    expect(deniedJob.admitted).toBe(false);
    expect(deniedJob.reason).toBe('budget-exceeded');
    expect(timelineRuntimeCoordinator.getBridgeStats().policies['ram-preview'].budgetReport.usage.jobs).toBe(2);

    releaseRamPreviewRunResources('existing-run-0');
    releaseRamPreviewRunResources('existing-run-1');
    for (let index = 0; index < 96; index += 1) {
      reserveRamPreviewImageElement({
        runId: `image-run-${index}`,
        clip: {
          ...clip,
          id: `clip-image-${index}`,
        },
      });
    }

    const deniedImage = reserveRamPreviewImageElement({
      runId: 'denied-image-run',
      clip: {
        ...clip,
        id: 'clip-image-denied',
      },
    });

    expect(deniedImage.admitted).toBe(false);
    expect(timelineRuntimeCoordinator.getBridgeStats().policies['ram-preview'].budgetReport.usage.resources).toBe(96);

    releaseReservedRamPreviewImageElement({
      runId: 'image-run-0',
      clip: {
        ...clip,
        id: 'clip-image-0',
      },
    });
    expect(timelineRuntimeCoordinator.getBridgeStats().policies['ram-preview'].budgetReport.usage.resources).toBe(95);
  });

  it('checks RAM preview cache admissions without retaining denied CPU or GPU cache resources', () => {
    const deniedComposite = canRetainRamPreviewCompositeCache({
      frameCount: 1,
      maxFrames: 900,
      heapBytes: 1024 * 1024 * 1024 + 1,
      width: 1920,
      height: 1080,
    });
    const deniedGpu = canRetainRamPreviewGpuFrame({
      frameKey: 1,
      time: 1,
      width: 1920,
      height: 1080,
      format: 'rgba8unorm',
      gpuBytes: 1536 * 1024 * 1024 + 1,
    });

    expect(deniedComposite.admitted).toBe(false);
    expect(deniedComposite.reason).toBe('budget-exceeded');
    expect(deniedGpu.admitted).toBe(false);
    expect(deniedGpu.reason).toBe('budget-exceeded');
    expect(timelineRuntimeCoordinator.getBridgeStats().policies['ram-preview'].resources).toHaveLength(0);
  });
});

import { describe, expect, it } from 'vitest';
import {
  buildPlaybackRunDiagnostics,
  buildPlaybackDebugStats,
  summarizeFrameCadence,
  summarizeWorkerGpuOnlyPlaybackPaths,
  type PlaybackPreviewFrameEvent,
} from '../../src/services/playbackDebugStats';
import type { PipelineEvent } from '../../src/services/wcPipelineMonitor';
import type { VFPipelineEvent } from '../../src/services/vfPipelineMonitor';

describe('playback debug stats', () => {
  it('summarizes frame cadence from recent frame timestamps', () => {
    const cadence = summarizeFrameCadence([0, 33, 66, 99, 132]);

    expect(cadence.frameEvents).toBe(5);
    expect(cadence.cadenceFps).toBeCloseTo(30.3, 1);
    expect(cadence.avgFrameGapMs).toBe(33);
    expect(cadence.p95FrameGapMs).toBe(33);
    expect(cadence.maxFrameGapMs).toBe(33);
  });

  it('builds a unified WebCodecs playback snapshot with health data', () => {
    const wcTimeline: PipelineEvent[] = [
      { type: 'decode_feed', t: 0 },
      { type: 'decode_output', t: 20, detail: { queueSize: 1 } },
      { type: 'decode_feed', t: 33 },
      { type: 'decode_output', t: 70, detail: { queueSize: 2 } },
      { type: 'decoder_reset', t: 74, detail: { reason: 'advance_seek' } },
      { type: 'queue_pressure', t: 75, detail: { queueSize: 4 } },
      { type: 'advance_seek', t: 80 },
      { type: 'pending_seek_start', t: 81, detail: { kind: 'advance', targetUs: 80000 } },
      { type: 'seek_start', t: 85 },
      { type: 'seek_end', t: 125, detail: { durationMs: 40 } },
      { type: 'pending_seek_end', t: 132, detail: { kind: 'advance', durationMs: 51, reason: 'resolved' } },
      { type: 'drift_correct', t: 130 },
      { type: 'collector_hold', t: 160, detail: { reason: 'same_provider_pending' } },
      { type: 'collector_drop', t: 170, detail: { reason: 'pending_unstable' } },
      { type: 'stall', t: 200, detail: { gapMs: 130 } },
    ];

    const stats = buildPlaybackDebugStats({
      decoder: 'WebCodecs',
      now: 250,
      windowMs: 500,
      wcTimeline,
      healthVideos: [
        {
          clipId: 'clip-1',
          src: 'demo.mp4',
          currentTime: 1.25,
          readyState: 1,
          seeking: true,
          paused: false,
          played: 1,
          warmingUp: true,
          gpuReady: false,
        },
      ],
      healthAnomalies: [
        {
          type: 'GPU_SURFACE_COLD',
          timestamp: 220,
          recovered: false,
        },
      ],
    });

    expect(stats.pipeline).toBe('webcodecs');
    expect(stats.frameEvents).toBe(2);
    expect(stats.stalls).toBe(1);
    expect(stats.seeks).toBe(2);
    expect(stats.advanceSeeks).toBe(1);
    expect(stats.queuePressureEvents).toBe(1);
    expect(stats.avgDecodeLatencyMs).toBe(28.5);
    expect(stats.avgSeekLatencyMs).toBe(40);
    expect(stats.maxQueueDepth).toBe(4);
    expect(stats.decoderResets).toBe(1);
    expect(stats.pendingSeekResolves).toBe(1);
    expect(stats.avgPendingSeekMs).toBe(51);
    expect(stats.collectorHolds).toBe(1);
    expect(stats.collectorDrops).toBe(1);
    expect(stats.healthAnomalies).toBe(1);
    expect(stats.seekingVideos).toBe(1);
    expect(stats.playingVideos).toBe(1);
    expect(stats.warmingUpVideos).toBe(1);
    expect(stats.coldVideos).toBe(1);
    expect(stats.lastAnomalyType).toBe('GPU_SURFACE_COLD');
    expect(stats.status).toBe('bad');
  });

  it('does not mark idle cold webcodecs videos as bad without playback activity', () => {
    const stats = buildPlaybackDebugStats({
      decoder: 'WebCodecs',
      now: 250,
      windowMs: 500,
      wcTimeline: [],
      healthVideos: [
        {
          clipId: 'clip-idle',
          src: 'idle.mp4',
          currentTime: 4,
          readyState: 4,
          seeking: false,
          paused: true,
          played: 1,
          warmingUp: false,
          gpuReady: false,
        },
      ],
    });

    expect(stats.activeVideos).toBe(1);
    expect(stats.playingVideos).toBe(0);
    expect(stats.coldVideos).toBe(1);
    expect(stats.status).toBe('ok');
  });

  it('does not mark cold seeking video elements bad when responsive proxy scrub preview is available', () => {
    const vfTimeline: VFPipelineEvent[] = [
      { type: 'vf_preview_frame', t: 0, detail: { changed: 'true', targetMoved: 'true', previewPath: 'proxy-image-frame', clipId: 'clip-proxy' } },
      { type: 'vf_preview_frame', t: 16, detail: { changed: 'true', targetMoved: 'true', previewPath: 'proxy-image-frame-nearest', clipId: 'clip-proxy' } },
      { type: 'vf_preview_frame', t: 33, detail: { changed: 'false', targetMoved: 'false', previewPath: 'not-ready-scrub-cache', clipId: 'clip-proxy' } },
      { type: 'vf_preview_frame', t: 50, detail: { changed: 'true', targetMoved: 'true', previewPath: 'scrub-cache', clipId: 'clip-proxy' } },
    ];

    const stats = buildPlaybackDebugStats({
      decoder: 'HTMLVideo',
      now: 80,
      windowMs: 200,
      vfTimeline,
      healthVideos: [
        {
          clipId: 'clip-proxy',
          src: 'demo.mp4',
          currentTime: 5.4,
          readyState: 1,
          seeking: true,
          paused: true,
          played: 0,
          warmingUp: false,
          gpuReady: false,
        },
      ],
    });

    expect(stats.coldVideos).toBe(1);
    expect(stats.seekingVideos).toBe(1);
    expect(stats.worstReadyState).toBe(1);
    expect(stats.previewPathCounts).toEqual({
      'proxy-image-frame': 1,
      'proxy-image-frame-nearest': 1,
      'not-ready-scrub-cache': 1,
      'scrub-cache': 1,
    });
    expect(stats.previewFreezeEvents).toBe(0);
    expect(stats.status).toBe('ok');
  });

  it('counts worker-presenting frames as responsive preview telemetry', () => {
    const stats = buildPlaybackDebugStats({
      decoder: 'HTMLVideo',
      now: 100,
      windowMs: 120,
      workerPreviewEvents: [
        { t: 0, frameId: 'preview:worker:1', targetId: 'preview', source: 'worker-presenting' },
        { t: 16, frameId: 'preview:worker:2', targetId: 'preview', source: 'worker-presenting' },
        { t: 33, frameId: 'preview:worker:3', targetId: 'preview', source: 'worker-presenting' },
      ],
      healthVideos: [
        {
          clipId: 'clip-worker-presenting',
          src: 'demo.mp4',
          currentTime: 5.4,
          readyState: 1,
          seeking: true,
          paused: true,
          played: 0,
          warmingUp: false,
          gpuReady: false,
        },
      ],
    });

    expect(stats.previewFrames).toBe(3);
    expect(stats.previewUpdates).toBe(3);
    expect(stats.previewRenderFps).toBeCloseTo(60.6, 1);
    expect(stats.previewPathCounts).toEqual({
      'worker-presenting': 3,
    });
    expect(stats.coldVideos).toBe(1);
    expect(stats.seekingVideos).toBe(1);
    expect(stats.status).toBe('ok');
  });

  it('counts worker-presenting decoder variants as responsive preview telemetry', () => {
    const stats = buildPlaybackDebugStats({
      decoder: 'HTMLVideo',
      now: 100,
      windowMs: 120,
      workerPreviewEvents: [
        { t: 0, frameId: 'preview:worker:1', targetId: 'preview', source: 'worker-presenting:HTMLVideo' },
        { t: 33, frameId: 'preview:worker:2', targetId: 'preview', source: 'worker-presenting:HTMLVideo' },
        { t: 67, frameId: 'preview:worker:3', targetId: 'preview', source: 'worker-presenting:HTMLVideo' },
      ],
      healthVideos: [
        {
          clipId: 'clip-worker-presenting',
          src: 'demo.mp4',
          currentTime: 5.4,
          readyState: 1,
          seeking: true,
          paused: false,
          played: 1,
          warmingUp: true,
          gpuReady: false,
        },
      ],
    });

    expect(stats.previewPathCounts).toEqual({
      'worker-presenting:HTMLVideo': 3,
    });
    expect(stats.status).toBe('ok');
  });

  it('classifies strict worker GPU-only preview path labels without affecting worker-only counts', () => {
    const empty = summarizeWorkerGpuOnlyPlaybackPaths(undefined);
    expect(empty).toMatchObject({
      frameState: 'no-gpu-frame',
      previewFrames: 0,
      testPatternFrames: 0,
      realSourceFrames: 0,
      unknownSourceFrames: 0,
    });

    const stats = buildPlaybackDebugStats({
      decoder: 'none',
      now: 100,
      windowMs: 120,
      workerPreviewEvents: [
        {
          t: 0,
          frameId: 'preview:gpu-test-pattern:1',
          targetId: 'preview',
          source: 'worker-gpu-only:gpu-test-pattern',
        },
        {
          t: 16,
          frameId: 'preview:video-frame:2',
          targetId: 'preview',
          source: 'worker-gpu-only:video-frame',
        },
        {
          t: 33,
          frameId: 'preview:solid:3',
          targetId: 'preview',
          source: 'worker-gpu-only:solid',
        },
        {
          t: 50,
          frameId: 'preview:image:4',
          targetId: 'preview',
          source: 'worker-gpu-only:image',
        },
        {
          t: 67,
          frameId: 'preview:text:5',
          targetId: 'preview',
          source: 'worker-gpu-only:text',
        },
        {
          t: 84,
          frameId: 'preview:nested:6',
          targetId: 'preview',
          source: 'worker-gpu-only:nested',
        },
        {
          t: 100,
          frameId: 'preview:readback:7',
          targetId: 'preview',
          source: 'worker-gpu-only:readback',
        },
        {
          t: 110,
          frameId: 'preview:worker-only:8',
          targetId: 'preview',
          source: 'worker-only:HTMLVideo',
        },
      ],
    });

    expect(stats.previewPathCounts).toMatchObject({
      'worker-gpu-only:gpu-test-pattern': 1,
      'worker-gpu-only:video-frame': 1,
      'worker-gpu-only:solid': 1,
      'worker-gpu-only:image': 1,
      'worker-gpu-only:text': 1,
      'worker-gpu-only:nested': 1,
      'worker-gpu-only:readback': 1,
      'worker-only:HTMLVideo': 1,
    });
    expect(stats.workerGpuOnly).toEqual({
      frameState: 'real-gpu-source',
      previewFrames: 7,
      testPatternFrames: 1,
      realSourceFrames: 6,
      unknownSourceFrames: 0,
      pathCounts: {
        'worker-gpu-only:gpu-test-pattern': 1,
        'worker-gpu-only:video-frame': 1,
        'worker-gpu-only:video-frame-compositor': 0,
        'worker-gpu-only:solid': 1,
        'worker-gpu-only:image': 1,
        'worker-gpu-only:text': 1,
        'worker-gpu-only:nested': 1,
        'worker-gpu-only:readback': 1,
      },
    });
    expect(summarizeWorkerGpuOnlyPlaybackPaths(stats.previewPathCounts)).toEqual(stats.workerGpuOnly);
    expect(stats.status).toBe('ok');
  });

  it('does not classify unchanged worker-presenting frames as moving-target freezes', () => {
    const stats = buildPlaybackDebugStats({
      decoder: 'HTMLVideo',
      now: 120,
      windowMs: 160,
      workerPreviewEvents: [
        {
          t: 0,
          frameId: 'preview:worker:1',
          targetId: 'preview',
          source: 'worker-presenting',
          changed: true,
          targetMoved: true,
        },
        {
          t: 16,
          frameId: 'preview:worker:2',
          targetId: 'preview',
          source: 'worker-presenting',
          changed: false,
          targetMoved: false,
        },
        {
          t: 33,
          frameId: 'preview:worker:3',
          targetId: 'preview',
          source: 'worker-presenting',
          changed: false,
          targetMoved: false,
        },
      ],
    });

    expect(stats.previewFrames).toBe(3);
    expect(stats.previewUpdates).toBe(1);
    expect(stats.stalePreviewFrames).toBe(2);
    expect(stats.stalePreviewWhileTargetMoved).toBe(0);
    expect(stats.previewFreezeEvents).toBe(0);
    expect(stats.status).toBe('ok');
  });

  it('treats active worker-presenting scrub preview as healthy while html videos seek', () => {
    const vfTimeline: VFPipelineEvent[] = [
      { type: 'vf_seek_precise', t: 8 },
      { type: 'vf_seek_precise', t: 24 },
      { type: 'vf_seek_precise', t: 40 },
    ];
    const stats = buildPlaybackDebugStats({
      decoder: 'HTMLVideo',
      now: 100,
      windowMs: 120,
      vfTimeline,
      workerPreviewEvents: [
        { t: 0, frameId: 'preview:worker:1', targetId: 'preview', source: 'worker-presenting' },
        { t: 20, frameId: 'preview:worker:2', targetId: 'preview', source: 'worker-presenting' },
        { t: 40, frameId: 'preview:worker:3', targetId: 'preview', source: 'worker-presenting' },
        { t: 60, frameId: 'preview:worker:4', targetId: 'preview', source: 'worker-presenting' },
      ],
      healthVideos: [
        {
          clipId: 'clip-worker-presenting',
          src: 'demo.mp4',
          currentTime: 5.4,
          readyState: 1,
          seeking: true,
          paused: false,
          played: 1,
          warmingUp: true,
          gpuReady: false,
        },
      ],
    });

    expect(stats.coldVideos).toBe(1);
    expect(stats.playingVideos).toBe(1);
    expect(stats.seekingVideos).toBe(1);
    expect(stats.previewPathCounts).toEqual({ 'worker-presenting': 4 });
    expect(stats.status).toBe('ok');
  });

  it('treats active worker-only preview as the responsive worker preview path', () => {
    const stats = buildPlaybackDebugStats({
      decoder: 'HTMLVideo',
      now: 100,
      windowMs: 120,
      vfTimeline: [
        { type: 'vf_seek_precise', t: 8 },
        { type: 'vf_seek_precise', t: 24 },
        { type: 'vf_seek_precise', t: 40 },
      ],
      workerPreviewEvents: [
        { t: 0, frameId: 'preview:worker-only:1', targetId: 'preview', source: 'worker-only:HTMLVideo' },
        { t: 20, frameId: 'preview:worker-only:2', targetId: 'preview', source: 'worker-only:HTMLVideo' },
        { t: 40, frameId: 'preview:worker-only:3', targetId: 'preview', source: 'worker-only:HTMLVideo' },
        { t: 60, frameId: 'preview:worker-only:4', targetId: 'preview', source: 'worker-only:HTMLVideo' },
      ],
      healthVideos: [
        {
          clipId: 'clip-worker-only',
          src: 'demo.mp4',
          currentTime: 5.4,
          readyState: 1,
          seeking: true,
          paused: false,
          played: 1,
          warmingUp: true,
          gpuReady: false,
        },
      ],
    });

    expect(stats.previewPathCounts).toEqual({ 'worker-only:HTMLVideo': 4 });
    expect(stats.status).toBe('ok');
  });

  it('does not mark responsive worker-only preview bad for an isolated health anomaly', () => {
    const stats = buildPlaybackDebugStats({
      decoder: 'HTMLVideo',
      now: 120,
      windowMs: 160,
      workerPreviewEvents: [
        { t: 0, frameId: 'preview:worker-only:1', targetId: 'preview', source: 'worker-only:HTMLVideo' },
        { t: 24, frameId: 'preview:worker-only:2', targetId: 'preview', source: 'worker-only:HTMLVideo' },
        { t: 48, frameId: 'preview:worker-only:3', targetId: 'preview', source: 'worker-only:HTMLVideo' },
        { t: 72, frameId: 'preview:worker-only:4', targetId: 'preview', source: 'worker-only:HTMLVideo' },
      ],
      healthVideos: [
        {
          clipId: 'clip-worker-only-health',
          src: 'demo.mp4',
          currentTime: 5.4,
          readyState: 4,
          seeking: false,
          paused: false,
          played: 1,
          warmingUp: false,
          gpuReady: true,
        },
      ],
      healthAnomalies: [
        {
          type: 'HIGH_DROP_RATE',
          timestamp: 80,
          detail: '15 drops/sec',
          recovered: false,
        },
      ],
    });

    expect(stats.healthAnomalies).toBe(1);
    expect(stats.previewPathCounts).toEqual({ 'worker-only:HTMLVideo': 4 });
    expect(stats.status).toBe('ok');
  });

  it('does not mark a responsive worker-only preview bad only because sparse WebCodecs events span multiple run segments', () => {
    const stats = buildPlaybackDebugStats({
      decoder: 'WebCodecs+HTMLVideo',
      now: 1200,
      windowMs: 1500,
      wcTimeline: [
        { type: 'decode_output', t: 0 },
        { type: 'decode_output', t: 420 },
        { type: 'decode_output', t: 900 },
      ],
      workerPreviewEvents: [
        { t: 920, frameId: 'preview:worker-only:1', targetId: 'preview', source: 'worker-only:WebCodecs+HTMLVideo' },
        { t: 940, frameId: 'preview:worker-only:2', targetId: 'preview', source: 'worker-only:WebCodecs+HTMLVideo' },
        { t: 960, frameId: 'preview:worker-only:3', targetId: 'preview', source: 'worker-only:WebCodecs+HTMLVideo' },
        { t: 980, frameId: 'preview:worker-only:4', targetId: 'preview', source: 'worker-only:WebCodecs+HTMLVideo' },
      ],
      healthVideos: [
        {
          clipId: 'clip-worker-only-webcodecs',
          src: 'demo.mp4',
          currentTime: 5.4,
          readyState: 1,
          seeking: true,
          paused: false,
          played: 1,
          warmingUp: true,
          gpuReady: false,
        },
      ],
    });

    expect(stats.frameEvents).toBe(3);
    expect(stats.maxFrameGapMs).toBeGreaterThan(140);
    expect(stats.previewPathCounts).toEqual({ 'worker-only:WebCodecs+HTMLVideo': 4 });
    expect(stats.previewFreezeEvents).toBe(0);
    expect(stats.stalePreviewWhileTargetMoved).toBe(0);
    expect(stats.status).toBe('ok');
  });

  it('warns instead of failing when worker-only preview is visible but slow without moving-target freezes', () => {
    const stats = buildPlaybackDebugStats({
      decoder: 'WebCodecs+HTMLVideo',
      now: 700,
      windowMs: 800,
      workerPreviewEvents: [
        { t: 0, frameId: 'preview:worker-only:1', targetId: 'preview', source: 'worker-only:WebCodecs+HTMLVideo' },
        { t: 180, frameId: 'preview:worker-only:2', targetId: 'preview', source: 'worker-only:WebCodecs+HTMLVideo' },
        { t: 360, frameId: 'preview:worker-only:3', targetId: 'preview', source: 'worker-only:WebCodecs+HTMLVideo' },
        { t: 540, frameId: 'preview:worker-only:4', targetId: 'preview', source: 'worker-only:WebCodecs+HTMLVideo' },
      ],
      healthVideos: [
        {
          clipId: 'clip-worker-only-slow',
          src: 'demo.mp4',
          currentTime: 5.4,
          readyState: 1,
          seeking: true,
          paused: false,
          played: 1,
          warmingUp: true,
          gpuReady: false,
        },
      ],
    });

    expect(stats.previewPathCounts).toEqual({ 'worker-only:WebCodecs+HTMLVideo': 4 });
    expect(stats.previewFreezeEvents).toBe(0);
    expect(stats.stalePreviewWhileTargetMoved).toBe(0);
    expect(stats.maxPreviewUpdateGapMs).toBeGreaterThan(100);
    expect(stats.status).toBe('warn');
  });

  it('marks worker-only WebCodecs preview bad when presented frames are far behind target time', () => {
    const stats = buildPlaybackDebugStats({
      decoder: 'WebCodecs+HTMLVideo',
      now: 120,
      windowMs: 160,
      workerPreviewEvents: [
        { t: 0, frameId: 'preview:worker-only:1', targetId: 'preview', source: 'worker-only:WebCodecs+HTMLVideo', driftMs: 420 },
        { t: 24, frameId: 'preview:worker-only:2', targetId: 'preview', source: 'worker-only:WebCodecs+HTMLVideo', driftMs: 440 },
        { t: 48, frameId: 'preview:worker-only:3', targetId: 'preview', source: 'worker-only:WebCodecs+HTMLVideo', driftMs: 460 },
        { t: 72, frameId: 'preview:worker-only:4', targetId: 'preview', source: 'worker-only:WebCodecs+HTMLVideo', driftMs: 480 },
      ],
      healthVideos: [
        {
          clipId: 'clip-worker-only-drift',
          src: 'demo.mp4',
          currentTime: 5.4,
          readyState: 4,
          seeking: false,
          paused: false,
          played: 1,
          warmingUp: false,
          gpuReady: true,
        },
      ],
    });

    expect(stats.previewFrames).toBe(4);
    expect(stats.maxPreviewDriftMs).toBe(480);
    expect(stats.status).toBe('bad');
  });

  it('warns instead of failing responsive worker-only preview for an isolated drift peak', () => {
    const stats = buildPlaybackDebugStats({
      decoder: 'WebCodecs+HTMLVideo',
      now: 140,
      windowMs: 180,
      workerPreviewEvents: [
        { t: 0, frameId: 'preview:worker-only:1', targetId: 'preview', source: 'worker-only:WebCodecs+HTMLVideo', driftMs: 28 },
        { t: 24, frameId: 'preview:worker-only:2', targetId: 'preview', source: 'worker-only:WebCodecs+HTMLVideo', driftMs: 360 },
        { t: 48, frameId: 'preview:worker-only:3', targetId: 'preview', source: 'worker-only:WebCodecs+HTMLVideo', driftMs: 32 },
        { t: 72, frameId: 'preview:worker-only:4', targetId: 'preview', source: 'worker-only:WebCodecs+HTMLVideo', driftMs: 24 },
        { t: 96, frameId: 'preview:worker-only:5', targetId: 'preview', source: 'worker-only:WebCodecs+HTMLVideo', driftMs: 20 },
      ],
      healthVideos: [
        {
          clipId: 'clip-worker-only-drift-peak',
          src: 'demo.mp4',
          currentTime: 5.4,
          readyState: 4,
          seeking: false,
          paused: false,
          played: 1,
          warmingUp: false,
          gpuReady: true,
        },
      ],
    });

    expect(stats.previewUpdateFps).toBeGreaterThan(20);
    expect(stats.maxPreviewDriftMs).toBe(360);
    expect(stats.avgPreviewDriftMs).toBeLessThan(180);
    expect(stats.status).toBe('warn');
  });

  it('does not fail responsive worker-only preview only because HTML video readiness dipped', () => {
    const stats = buildPlaybackDebugStats({
      decoder: 'HTMLVideo',
      now: 120,
      windowMs: 160,
      vfTimeline: [
        { type: 'vf_readystate_drop', t: 20 },
      ],
      workerPreviewEvents: [
        { t: 0, frameId: 'preview:worker-only:1', targetId: 'preview', source: 'worker-only:HTMLVideo' },
        { t: 24, frameId: 'preview:worker-only:2', targetId: 'preview', source: 'worker-only:HTMLVideo' },
        { t: 48, frameId: 'preview:worker-only:3', targetId: 'preview', source: 'worker-only:HTMLVideo' },
        { t: 72, frameId: 'preview:worker-only:4', targetId: 'preview', source: 'worker-only:HTMLVideo' },
      ],
      healthVideos: [
        {
          clipId: 'clip-worker-only-html',
          src: 'demo.mp4',
          currentTime: 5.4,
          readyState: 1,
          seeking: true,
          paused: true,
          played: 0,
          warmingUp: false,
          gpuReady: false,
        },
      ],
    });

    expect(stats.readyStateDrops).toBe(1);
    expect(stats.previewPathCounts).toEqual({ 'worker-only:HTMLVideo': 4 });
    expect(stats.p95PreviewUpdateGapMs).toBeLessThanOrEqual(100);
    expect(stats.status).toBe('ok');
  });

  it('still warns on repeated html video seeks without responsive preview fallback', () => {
    const vfTimeline: VFPipelineEvent[] = [
      { type: 'vf_seek_precise', t: 8 },
      { type: 'vf_seek_precise', t: 24 },
      { type: 'vf_seek_precise', t: 40 },
    ];
    const stats = buildPlaybackDebugStats({
      decoder: 'HTMLVideo',
      now: 100,
      windowMs: 120,
      vfTimeline,
      healthVideos: [
        {
          clipId: 'clip-html',
          src: 'demo.mp4',
          currentTime: 5.4,
          readyState: 4,
          seeking: false,
          paused: true,
          played: 1,
          warmingUp: false,
          gpuReady: true,
        },
      ],
    });

    expect(stats.seeks).toBe(3);
    expect(stats.previewFrames).toBe(0);
    expect(stats.status).toBe('warn');
  });

  it('still marks cold seeking video elements bad when proxy image scrub preview freezes', () => {
    const vfTimeline: VFPipelineEvent[] = [
      { type: 'vf_preview_frame', t: 0, detail: { changed: 'false', targetMoved: 'true', previewPath: 'proxy-image-frame-hold', clipId: 'clip-proxy' } },
      { type: 'vf_preview_frame', t: 40, detail: { changed: 'false', targetMoved: 'true', previewPath: 'proxy-image-frame-hold', clipId: 'clip-proxy' } },
      { type: 'vf_preview_frame', t: 80, detail: { changed: 'false', targetMoved: 'true', previewPath: 'proxy-image-frame-hold', clipId: 'clip-proxy' } },
    ];

    const stats = buildPlaybackDebugStats({
      decoder: 'HTMLVideo',
      now: 100,
      windowMs: 200,
      vfTimeline,
      healthVideos: [
        {
          clipId: 'clip-proxy',
          src: 'demo.mp4',
          currentTime: 5.4,
          readyState: 1,
          seeking: true,
          paused: true,
          played: 0,
          warmingUp: false,
          gpuReady: false,
        },
      ],
    });

    expect(stats.previewFreezeEvents).toBe(1);
    expect(stats.status).toBe('bad');
  });

  it('includes preview telemetry in the top-level snapshot for webcodecs playback', () => {
    const wcTimeline: PipelineEvent[] = [
      { type: 'decode_feed', t: 0 },
      { type: 'decode_output', t: 8, detail: { queueSize: 1 } },
      { type: 'queue_pressure', t: 12, detail: { queueSize: 3 } },
    ];
    const vfTimeline: VFPipelineEvent[] = [
      { type: 'vf_preview_frame', t: 0, detail: { changed: 'false', targetMoved: 'true', driftMs: 45, previewPath: 'video', clipId: 'clip-1' } },
      { type: 'vf_preview_frame', t: 16, detail: { changed: 'false', targetMoved: 'true', driftMs: 55, previewPath: 'video', clipId: 'clip-1' } },
      { type: 'vf_preview_frame', t: 33, detail: { changed: 'true', targetMoved: 'true', driftMs: 8, previewPath: 'live-import', clipId: 'clip-1' } },
      { type: 'vf_scrub_path', t: 40, detail: { path: 'video' } },
      { type: 'audio_drift', t: 44, detail: { driftMs: 72 } },
    ];

    const stats = buildPlaybackDebugStats({
      decoder: 'WebCodecs',
      now: 60,
      windowMs: 500,
      wcTimeline,
      vfTimeline,
      healthVideos: [
        {
          clipId: 'clip-1',
          src: 'demo.mp4',
          currentTime: 1,
          readyState: 4,
          seeking: false,
          paused: false,
          played: 1,
          warmingUp: false,
          gpuReady: true,
        },
      ],
    });

    expect(stats.pipeline).toBe('webcodecs');
    expect(stats.frameEvents).toBe(1);
    expect(stats.queuePressureEvents).toBe(1);
    expect(stats.previewFrames).toBe(3);
    expect(stats.previewUpdates).toBe(1);
    expect(stats.stalePreviewFrames).toBe(2);
    expect(stats.stalePreviewWhileTargetMoved).toBe(2);
    expect(stats.previewFreezeEvents).toBe(1);
    expect(stats.previewFreezeFrames).toBe(2);
    expect(stats.longestPreviewFreezeFrames).toBe(2);
    expect(stats.longestPreviewFreezeMs).toBe(16);
    expect(stats.lastPreviewFreezePath).toBe('video');
    expect(stats.lastPreviewFreezeClipId).toBe('clip-1');
    expect(stats.lastPreviewFreezeDurationMs).toBe(16);
    expect(stats.previewPathCounts).toEqual({
      video: 2,
      'live-import': 1,
    });
    expect(stats.scrubPathCounts).toEqual({
      video: 1,
    });
    expect(stats.avgPreviewDriftMs).toBe(36);
    expect(stats.maxPreviewDriftMs).toBe(55);
    expect(stats.avgAudioDriftMs).toBe(72);
  });

  it('marks severe target-moving preview freezes as bad without requiring decoder events', () => {
    const vfTimeline: VFPipelineEvent[] = Array.from({ length: 13 }, (_, index) => ({
      type: 'vf_preview_frame',
      t: index * 60,
      detail: {
        changed: 'false',
        targetMoved: 'true',
        previewPath: 'webcodecs',
        clipId: 'clip-freeze',
        targetTimeMs: index * 33,
        displayedTimeMs: 0,
        driftMs: index * 33,
      },
    }));

    const stats = buildPlaybackDebugStats({
      decoder: 'WebCodecs',
      now: 800,
      windowMs: 1000,
      vfTimeline,
      healthVideos: [
        {
          clipId: 'clip-freeze',
          src: 'demo.mp4',
          currentTime: 0,
          readyState: 4,
          seeking: false,
          paused: true,
          played: 1,
          warmingUp: false,
          gpuReady: true,
        },
      ],
    });

    expect(stats.previewFreezeEvents).toBe(1);
    expect(stats.stalePreviewWhileTargetMoved).toBe(13);
    expect(stats.longestPreviewFreezeMs).toBe(720);
    expect(stats.status).toBe('bad');
  });

  it('marks VF playback unhealthy when readyState drops and audio drift show up', () => {
    const vfTimeline: VFPipelineEvent[] = [
      { type: 'vf_capture', t: 0 },
      { type: 'vf_capture', t: 42 },
      { type: 'vf_seek_precise', t: 50 },
      { type: 'vf_seek_done', t: 82 },
      { type: 'vf_drift', t: 90 },
      { type: 'vf_readystate_drop', t: 95 },
      { type: 'audio_drift', t: 100, detail: { driftMs: 72 } },
    ];

    const stats = buildPlaybackDebugStats({
      decoder: 'HTMLVideo(VF)',
      now: 120,
      windowMs: 500,
      vfTimeline,
    });

    expect(stats.pipeline).toBe('vf');
    expect(stats.frameEvents).toBe(2);
    expect(stats.seeks).toBe(1);
    expect(stats.advanceSeeks).toBe(0);
    expect(stats.driftCorrections).toBe(1);
    expect(stats.readyStateDrops).toBe(1);
    expect(stats.avgSeekLatencyMs).toBe(32);
    expect(stats.avgAudioDriftMs).toBe(72);
    expect(stats.status).toBe('bad');
  });

  it('summarizes preview freeze streaks and scrub path counts for HTML/VF playback', () => {
    const vfTimeline: VFPipelineEvent[] = [
      { type: 'vf_capture', t: 0 },
      {
        type: 'vf_preview_frame',
        t: 0,
        detail: { changed: 'false', targetMoved: 'true', driftMs: 120, previewPath: 'same-clip-hold', clipId: 'clip-a' },
      },
      {
        type: 'vf_preview_frame',
        t: 33,
        detail: { changed: 'false', targetMoved: 'true', driftMs: 140, previewPath: 'same-clip-hold', clipId: 'clip-a' },
      },
      {
        type: 'vf_preview_frame',
        t: 66,
        detail: { changed: 'false', targetMoved: 'true', driftMs: 180, previewPath: 'same-clip-hold', clipId: 'clip-a' },
      },
      {
        type: 'vf_preview_frame',
        t: 99,
        detail: { changed: 'true', targetMoved: 'true', driftMs: 12, previewPath: 'live-import', clipId: 'clip-a' },
      },
      { type: 'vf_scrub_path', t: 110, detail: { path: 'same-clip-hold' } },
      { type: 'vf_scrub_path', t: 120, detail: { path: 'not-ready-scrub-cache' } },
      { type: 'vf_scrub_path', t: 130, detail: { path: 'same-clip-hold' } },
      {
        type: 'vf_preview_frame',
        t: 150,
        detail: { changed: 'false', targetMoved: 'true', driftMs: 200, previewPath: 'not-ready-scrub-cache', clipId: 'clip-b' },
      },
      {
        type: 'vf_preview_frame',
        t: 183,
        detail: { changed: 'false', targetMoved: 'true', driftMs: 210, previewPath: 'not-ready-scrub-cache', clipId: 'clip-b' },
      },
      {
        type: 'vf_preview_frame',
        t: 216,
        detail: { changed: 'false', targetMoved: 'true', driftMs: 220, previewPath: 'not-ready-scrub-cache', clipId: 'clip-b' },
      },
    ];

    const stats = buildPlaybackDebugStats({
      decoder: 'HTMLVideo',
      now: 240,
      windowMs: 500,
      vfTimeline,
    });

    expect(stats.pipeline).toBe('html');
    expect(stats.previewFrames).toBe(7);
    expect(stats.previewUpdates).toBe(1);
    expect(stats.stalePreviewFrames).toBe(6);
    expect(stats.stalePreviewWhileTargetMoved).toBe(6);
    expect(stats.previewFreezeEvents).toBe(2);
    expect(stats.previewFreezeFrames).toBe(6);
    expect(stats.longestPreviewFreezeFrames).toBe(3);
    expect(stats.longestPreviewFreezeMs).toBe(66);
    expect(stats.lastPreviewFreezePath).toBe('not-ready-scrub-cache');
    expect(stats.lastPreviewFreezeClipId).toBe('clip-b');
    expect(stats.lastPreviewFreezeDurationMs).toBe(66);
    expect(stats.previewPathCounts).toEqual({
      'same-clip-hold': 3,
      'live-import': 1,
      'not-ready-scrub-cache': 3,
    });
    expect(stats.scrubPathCounts).toEqual({
      'same-clip-hold': 2,
      'not-ready-scrub-cache': 1,
    });
    expect(stats.avgPreviewDriftMs).toBeCloseTo(154.6, 1);
    expect(stats.maxPreviewDriftMs).toBe(220);
  });

  it('builds run-scoped startup diagnostics so an initial preview catch-up is visible', () => {
    const wcTimeline: PipelineEvent[] = [
      { type: 'decode_feed', t: 1000 },
      { type: 'decode_output', t: 1030, detail: { queueSize: 1 } },
      { type: 'decode_feed', t: 1066 },
      { type: 'decode_output', t: 1098, detail: { queueSize: 1 } },
    ];
    const vfTimeline: VFPipelineEvent[] = [
      {
        type: 'vf_preview_frame',
        t: 1012,
        detail: { changed: 'false', targetMoved: 'true', driftMs: 240, previewPath: 'webcodecs', clipId: 'clip-1' },
      },
      {
        type: 'vf_preview_frame',
        t: 1045,
        detail: { changed: 'false', targetMoved: 'true', driftMs: 180, previewPath: 'webcodecs', clipId: 'clip-1' },
      },
      {
        type: 'vf_preview_frame',
        t: 1084,
        detail: { changed: 'true', targetMoved: 'true', driftMs: 12, previewPath: 'webcodecs', clipId: 'clip-1' },
      },
      {
        type: 'vf_preview_frame',
        t: 1120,
        detail: { changed: 'true', targetMoved: 'true', driftMs: 8, previewPath: 'webcodecs', clipId: 'clip-1' },
      },
    ];

    const diagnostics = buildPlaybackRunDiagnostics({
      decoder: 'WebCodecs',
      startMs: 1000,
      endMs: 1200,
      wcEvents: wcTimeline,
      vfEvents: vfTimeline,
      healthVideos: [
        {
          clipId: 'clip-1',
          src: 'demo.mp4',
          currentTime: 1.2,
          readyState: 4,
          seeking: false,
          paused: false,
          played: 1,
          warmingUp: false,
          gpuReady: true,
        },
      ],
    });

    expect(diagnostics.windowMs).toBe(200);
    expect(diagnostics.wcEventCount).toBe(4);
    expect(diagnostics.vfEventCount).toBe(4);
    expect(diagnostics.playback.previewFrames).toBe(4);
    expect(diagnostics.playback.previewFreezeEvents).toBe(1);
    expect(diagnostics.startup.firstDecodeOutputMs).toBe(30);
    expect(diagnostics.startup.firstPreviewFrameMs).toBe(12);
    expect(diagnostics.startup.firstPreviewUpdateMs).toBe(84);
    expect(diagnostics.startup.startupCatchUpMs).toBe(84);
    expect(diagnostics.startup.initialTargetMovedStaleFrames).toBe(2);
    expect(diagnostics.startup.initialTargetMovedStaleMs).toBe(72);
  });

  it('includes worker-presenting frames in run-scoped playback diagnostics', () => {
    const workerPreviewEvents: PlaybackPreviewFrameEvent[] = [
      { t: 1010, frameId: 'frame-1', targetId: 'preview', source: 'worker-presenting', changed: true },
      { t: 1030, frameId: 'frame-2', targetId: 'preview', source: 'worker-presenting', changed: true },
      { t: 1050, frameId: 'frame-3', targetId: 'preview', source: 'worker-presenting', changed: true },
      { t: 1300, frameId: 'outside', targetId: 'preview', source: 'worker-presenting', changed: true },
    ];

    const diagnostics = buildPlaybackRunDiagnostics({
      decoder: 'none',
      startMs: 1000,
      endMs: 1100,
      workerPreviewEvents,
    });

    expect(diagnostics.playback.status).toBe('ok');
    expect(diagnostics.playback.previewFrames).toBe(3);
    expect(diagnostics.playback.previewUpdates).toBe(3);
    expect(diagnostics.playback.previewRenderFps).toBe(50);
    expect(diagnostics.playback.previewPathCounts).toEqual({ 'worker-presenting': 3 });
  });
});

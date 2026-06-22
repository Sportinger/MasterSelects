export const WORKER_GPU_ONLY_PREVIEW_PATH_LABELS = [
  'worker-gpu-only:gpu-test-pattern',
  'worker-gpu-only:video-frame',
  'worker-gpu-only:video-frame-compositor',
  'worker-gpu-only:solid',
  'worker-gpu-only:image',
  'worker-gpu-only:text',
  'worker-gpu-only:nested',
  'worker-gpu-only:readback',
] as const;

export type WorkerGpuOnlyPreviewPathLabel = typeof WORKER_GPU_ONLY_PREVIEW_PATH_LABELS[number];

export type WorkerGpuOnlyFrameState =
  | 'no-gpu-frame'
  | 'gpu-test-pattern'
  | 'real-gpu-source';

export interface WorkerGpuOnlyPlaybackDiagnostics {
  readonly frameState: WorkerGpuOnlyFrameState;
  readonly previewFrames: number;
  readonly testPatternFrames: number;
  readonly realSourceFrames: number;
  readonly unknownSourceFrames: number;
  readonly pathCounts: Record<WorkerGpuOnlyPreviewPathLabel, number>;
}

export interface EngineStats {
  fps: number;
  frameTime: number;
  gpuMemory: number;
  // Detailed timing (ms)
  timing: {
    rafGap: number;        // Time between rAF callbacks (should be ~16.67ms for 60fps)
    importTexture: number; // Time to import video textures
    renderPass: number;    // Time for GPU render passes
    submit: number;        // Time for GPU queue submit
    total: number;         // Total render time
  };
  // Frame drop stats
  drops: {
    count: number;         // Total dropped frames this session
    lastSecond: number;    // Drops in last second
    reason: 'none' | 'slow_raf' | 'slow_render' | 'slow_import';
  };
  // Current frame info
  layerCount: number;
  targetFps: number;
  // Decoder info
  decoder: 'WebCodecs' | 'WebCodecs+HTMLVideo' | 'HTMLVideo(VF)' | 'HTMLVideo' | 'HTMLVideo(cached)' | 'HTMLVideo(paused-cache)' | 'HTMLVideo(seeking-cache)' | 'HTMLVideo(scrub-cache)' | 'NativeHelper' | 'ParallelDecode' | 'none';
  // WebCodecs debug info (only in full mode)
  webCodecsInfo?: {
    codec: string;
    hwAccel: string;
    decodeQueueSize: number;
    samplesLoaded: number;
    sampleIndex: number;
  };
  // Audio status
  audio: {
    playing: number;       // Number of audio elements currently playing
    drift: number;         // Max audio drift from expected time in ms
    status: 'sync' | 'drift' | 'silent' | 'error';
  };
  // Playback pipeline debug snapshot
  playback?: {
    windowMs: number;
    pipeline: 'webcodecs' | 'vf' | 'html' | 'native' | 'parallel' | 'none';
    status: 'ok' | 'warn' | 'bad';
    frameEvents: number;
    cadenceFps: number;
    avgFrameGapMs: number;
    p95FrameGapMs: number;
    maxFrameGapMs: number;
    previewFrames: number;
    previewUpdates: number;
    previewRenderFps: number;
    previewUpdateFps: number;
    avgPreviewRenderGapMs: number;
    p95PreviewRenderGapMs: number;
    maxPreviewRenderGapMs: number;
    avgPreviewUpdateGapMs: number;
    p95PreviewUpdateGapMs: number;
    maxPreviewUpdateGapMs: number;
    stalePreviewFrames: number;
    stalePreviewWhileTargetMoved: number;
    previewFreezeEvents: number;
    previewFreezeFrames: number;
    longestPreviewFreezeFrames: number;
    longestPreviewFreezeMs: number;
    avgPreviewDriftMs: number;
    maxPreviewDriftMs: number;
    stalls: number;
    seeks: number;
    advanceSeeks: number;
    driftCorrections: number;
    readyStateDrops: number;
    queuePressureEvents: number;
    healthAnomalies: number;
    activeVideos: number;
    playingVideos: number;
    seekingVideos: number;
    warmingUpVideos: number;
    coldVideos: number;
    worstReadyState: number;
    lastAnomalyType?: string;
    avgDecodeLatencyMs?: number;
    avgSeekLatencyMs?: number;
    avgQueueDepth?: number;
    maxQueueDepth?: number;
    avgAudioDriftMs?: number;
    decoderResets?: number;
    pendingSeekResolves?: number;
    avgPendingSeekMs?: number;
    maxPendingSeekMs?: number;
    collectorHolds?: number;
    collectorDrops?: number;
    lastPreviewFreezePath?: string;
    lastPreviewFreezeClipId?: string;
    lastPreviewFreezeDurationMs?: number;
    previewPathCounts?: Record<string, number>;
    scrubPathCounts?: Record<string, number>;
    workerGpuOnly?: WorkerGpuOnlyPlaybackDiagnostics;
  };
  // Render dispatcher debug snapshot, including non-video visual cadence.
  renderDispatcher?: {
    splatSequence?: {
      targetSceneKey?: string;
      renderedSceneKey?: string;
      mode: 'target' | 'held' | 'missing';
      visualFrameChangesLastSecond: number;
      backgroundLoads: number;
    };
  };
  // Main-thread frame phase breakdown
  mainThread?: {
    windowMs: number;
    samples: number;
    liveSamples: number;
    cachedSamples: number;
    skippedSamples: number;
    avgTotalMs: number;
    p95TotalMs: number;
    maxTotalMs: number;
    avgStatsMs: number;
    avgBuildMs: number;
    avgRenderMs: number;
    avgSyncVideoMs: number;
    avgSyncAudioMs: number;
    avgCacheMs: number;
    maxBuildMs: number;
    maxRenderMs: number;
    maxSyncVideoMs: number;
    maxSyncAudioMs: number;
    maxCacheMs: number;
  };
  // Idle mode - engine pauses rendering when nothing changes
  isIdle: boolean;
}

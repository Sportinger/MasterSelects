import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const defaultReportsDir = path.join(repoRoot, 'fixtures', 'timeline-canvas-reports');
const defaultManifestPath = path.join(repoRoot, 'fixtures', 'torture-media', 'manifest.local.json');
const defaultLiveCompositionId = process.env.TIMELINE_CANVAS_LIVE_COMP_ID || '1780705391680-ecu7panot';
const defaultLiveImportPaths = process.env.TIMELINE_CANVAS_LIVE_IMPORT_PATHS
  ? process.env.TIMELINE_CANVAS_LIVE_IMPORT_PATHS
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => path.resolve(entry))
  : [
    path.join(repoRoot, 'public', 'masterselects_github.mp4'),
    path.join(repoRoot, 'public', 'clippy.webm'),
    path.join(repoRoot, 'public', 'clippy-intro.webm'),
  ];

function parseArgs(argv) {
  const options = {
    baseUrl: 'http://localhost:5173',
    manifest: defaultManifestPath,
    out: defaultReportsDir,
    liveCompositionId: defaultLiveCompositionId,
    liveImportFallback: true,
    liveImportPaths: [...defaultLiveImportPaths],
    liveFixtureVideoTracks: 3,
    liveFixtureSegments: 54,
    liveFixtureDurationSeconds: 36,
    livePlaybackMs: 1500,
    liveMinVideoClips: 50,
    liveMinAudioClips: 50,
    reloadMaxFirstStatsMs: 5000,
    reloadMaxReadyMs: 8000,
    includePrecise: false,
    includeWorkerSmokes: true,
    checkWorkerDefaultOn: true,
    skipExport: false,
    skipExportPreviewParity: false,
    skipTorture: false,
    skipLarge: false,
    skipLiveComposition: false,
    skipRam: false,
    skipSpectral: false,
    skipPlayback: false,
    skipMarquee: false,
    skipPlayhead: false,
    skipThumbnailReload: false,
    requireLiveComposition: false,
    restoreLiveCompositionAtEnd: true,
    largeClipCount: 720,
    largeVideoTrackCount: 8,
    frameSampleMs: 750,
    largeMinEstimatedFps: 45,
    largeMaxDroppedFrameEstimate: 8,
    largeMaxSlowFrameCount: 4,
    largeMaxFrameDeltaMs: 70,
    largeMaxWorkerTrackCount: null,
    largeMaxWorkerResourceBytes: 96_000_000,
    largeMaxShellCount: 0,
    workerSyntheticTimeoutMs: 180000,
    skipWorkerPrewarm: false,
    fullReport: false,
  };

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--base-url') {
      options.baseUrl = argv[++index] ?? options.baseUrl;
    } else if (arg === '--manifest') {
      options.manifest = path.resolve(argv[++index] ?? options.manifest);
      options.skipTorture = false;
    } else if (arg === '--out') {
      options.out = path.resolve(argv[++index] ?? options.out);
    } else if (arg === '--live-composition-id') {
      options.liveCompositionId = argv[++index] ?? options.liveCompositionId;
    } else if (arg === '--live-import-path') {
      if (!options.customLiveImportPaths) {
        options.liveImportPaths = [];
        options.customLiveImportPaths = true;
      }
      const value = argv[++index];
      if (value) options.liveImportPaths.push(path.resolve(value));
    } else if (arg === '--live-import-paths') {
      const value = argv[++index] ?? '';
      options.liveImportPaths = value
        .split(';')
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => path.resolve(entry));
      options.customLiveImportPaths = true;
    } else if (arg === '--skip-live-import-fallback') {
      options.liveImportFallback = false;
    } else if (arg === '--live-fixture-video-tracks') {
      options.liveFixtureVideoTracks = Math.max(1, Number(argv[++index]) || options.liveFixtureVideoTracks);
    } else if (arg === '--live-fixture-segments') {
      options.liveFixtureSegments = Math.max(1, Number(argv[++index]) || options.liveFixtureSegments);
    } else if (arg === '--live-fixture-duration-seconds') {
      options.liveFixtureDurationSeconds = Math.max(1, Number(argv[++index]) || options.liveFixtureDurationSeconds);
    } else if (arg === '--live-playback-ms') {
      options.livePlaybackMs = Math.max(100, Number(argv[++index]) || options.livePlaybackMs);
    } else if (arg === '--live-min-video-clips') {
      const value = Number(argv[++index]);
      options.liveMinVideoClips = Number.isFinite(value) ? Math.max(0, value) : options.liveMinVideoClips;
    } else if (arg === '--live-min-audio-clips') {
      const value = Number(argv[++index]);
      options.liveMinAudioClips = Number.isFinite(value) ? Math.max(0, value) : options.liveMinAudioClips;
    } else if (arg === '--reload-max-first-stats-ms') {
      options.reloadMaxFirstStatsMs = Math.max(100, Number(argv[++index]) || options.reloadMaxFirstStatsMs);
    } else if (arg === '--reload-max-ready-ms') {
      options.reloadMaxReadyMs = Math.max(100, Number(argv[++index]) || options.reloadMaxReadyMs);
    } else if (arg === '--include-precise') {
      options.includePrecise = true;
    } else if (arg === '--include-worker-smokes') {
      options.includeWorkerSmokes = true;
    } else if (arg === '--skip-worker-smokes') {
      options.includeWorkerSmokes = false;
    } else if (arg === '--check-worker-default-on') {
      options.checkWorkerDefaultOn = true;
      options.includeWorkerSmokes = true;
    } else if (arg === '--skip-worker-default-on') {
      options.checkWorkerDefaultOn = false;
    } else if (arg === '--skip-export') {
      options.skipExport = true;
    } else if (arg === '--skip-export-preview-parity') {
      options.skipExportPreviewParity = true;
    } else if (arg === '--skip-torture') {
      options.skipTorture = true;
    } else if (arg === '--skip-large') {
      options.skipLarge = true;
    } else if (arg === '--skip-live-composition') {
      options.skipLiveComposition = true;
    } else if (arg === '--skip-ram') {
      options.skipRam = true;
    } else if (arg === '--skip-spectral') {
      options.skipSpectral = true;
    } else if (arg === '--skip-playback') {
      options.skipPlayback = true;
    } else if (arg === '--skip-marquee') {
      options.skipMarquee = true;
    } else if (arg === '--skip-playhead') {
      options.skipPlayhead = true;
    } else if (arg === '--skip-thumbnail-reload') {
      options.skipThumbnailReload = true;
    } else if (arg === '--require-live-composition') {
      options.requireLiveComposition = true;
    } else if (arg === '--no-restore-live-composition') {
      options.restoreLiveCompositionAtEnd = false;
    } else if (arg === '--large-clips') {
      options.largeClipCount = Math.max(1, Number(argv[++index]) || options.largeClipCount);
    } else if (arg === '--large-video-tracks') {
      options.largeVideoTrackCount = Math.max(1, Number(argv[++index]) || options.largeVideoTrackCount);
    } else if (arg === '--frame-sample-ms') {
      options.frameSampleMs = Math.max(100, Number(argv[++index]) || options.frameSampleMs);
    } else if (arg === '--large-min-fps') {
      options.largeMinEstimatedFps = Math.max(1, Number(argv[++index]) || options.largeMinEstimatedFps);
    } else if (arg === '--large-max-dropped-frames') {
      options.largeMaxDroppedFrameEstimate = Math.max(0, Number(argv[++index]) || options.largeMaxDroppedFrameEstimate);
    } else if (arg === '--large-max-slow-frames') {
      options.largeMaxSlowFrameCount = Math.max(0, Number(argv[++index]) || options.largeMaxSlowFrameCount);
    } else if (arg === '--large-max-frame-delta-ms') {
      options.largeMaxFrameDeltaMs = Math.max(1, Number(argv[++index]) || options.largeMaxFrameDeltaMs);
    } else if (arg === '--large-max-worker-tracks') {
      options.largeMaxWorkerTrackCount = Math.max(0, Number(argv[++index]) || options.largeMaxWorkerTrackCount);
    } else if (arg === '--large-max-worker-resource-bytes') {
      options.largeMaxWorkerResourceBytes = Math.max(0, Number(argv[++index]) || options.largeMaxWorkerResourceBytes);
    } else if (arg === '--large-max-shells') {
      options.largeMaxShellCount = Math.max(0, Number(argv[++index]) || options.largeMaxShellCount);
    } else if (arg === '--worker-synthetic-timeout-ms') {
      options.workerSyntheticTimeoutMs = Math.max(10000, Number(argv[++index]) || options.workerSyntheticTimeoutMs);
    } else if (arg === '--skip-worker-prewarm') {
      options.skipWorkerPrewarm = true;
    } else if (arg === '--full-report') {
      options.fullReport = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/run-timeline-canvas-verification.mjs [options]

Options:
  --base-url <url>             Dev server base URL. Default: http://localhost:5173
  --manifest <path>            Torture media manifest for nested export/RAM probes
  --out <dir>                  Report output directory
  --live-composition-id <id>   Real-media comp to verify. Default: TIMELINE_CANVAS_LIVE_COMP_ID or ${defaultLiveCompositionId}
  --live-import-path <path>    Add a local video for auto-created live fixture fallback. Repeatable.
  --live-import-paths <paths>  Semicolon-separated local videos for live fixture fallback.
  --skip-live-import-fallback  Do not auto-create a live fixture when --live-composition-id cannot be opened
  --live-fixture-video-tracks <n> Auto-created live fixture video track count. Default: 3
  --live-fixture-segments <n>  Auto-created live fixture segment count. Default: 54
  --live-fixture-duration-seconds <n> Auto-created live fixture duration. Default: 36
  --live-playback-ms <ms>      Live-comp playback smoke duration. Default: 1500
  --live-min-video-clips <n>   Minimum live-comp video clips. Default: 50
  --live-min-audio-clips <n>   Minimum live-comp audio clips. Default: 50
  --reload-max-first-stats-ms <ms> Max time until first post-reload stats response. Default: 5000
  --reload-max-ready-ms <ms>   Max time until project load is idle after reload. Default: 8000
  --skip-live-composition      Skip the real-media live composition verification
  --require-live-composition   Fail if the live composition cannot be opened or does not meet minimums
  --no-restore-live-composition Do not reopen the live composition before final stats
  --include-precise            Also run a precise debugExport probe
  --include-worker-smokes      Run forced timeline canvas worker synthetic/live smokes (default)
  --skip-worker-smokes         Skip forced timeline canvas worker synthetic/live smokes
  --check-worker-default-on    Run the default-on live worker smoke (default)
  --skip-worker-default-on     Skip the default-on live worker smoke
  --skip-export                Skip debugExport probes
  --skip-export-preview-parity Skip export-preview fingerprint parity smoke
  --skip-torture               Skip torture fixture even when manifest exists
  --skip-large                 Skip synthetic large-project scroll/zoom/select-all smoke
  --skip-ram                   Skip RAM preview smoke
  --skip-spectral              Skip spectral playback smoke
  --skip-playback              Skip simulateScrub/simulatePlayback/simulatePlaybackPath
  --skip-marquee               Skip synthetic marquee selection smoke
  --skip-playhead              Skip synthetic playhead smoothness smoke
  --skip-thumbnail-reload      Skip synthetic thumbnail-before-playback smoke
  --large-clips <count>        Synthetic large project clip count. Default: 720
  --large-video-tracks <count> Synthetic video track count. Default: 8
  --large-min-fps <fps>        Large-project frame-loop minimum estimated FPS. Default: 45
  --large-max-dropped-frames <n> Large-project max estimated dropped frames. Default: 8
  --large-max-slow-frames <n>  Large-project max slow frames. Default: 4
  --large-max-frame-delta-ms <ms> Large-project max frame delta. Default: 70
  --large-max-worker-tracks <n> Large-project max worker-rendered tracks. Default: synthetic video track count
  --large-max-worker-resource-bytes <n> Forced worker max resource bytes. Default: 96000000
  --large-max-shells <n>       Large-project max interaction shells after select-all. Default: 0
  --worker-synthetic-timeout-ms <ms> Forced worker 720/8 timeout. Default: 180000
  --skip-worker-prewarm        Skip the smaller forced-worker cold-start prewarm smoke
  --full-report                Also write report.full.json with raw tool payloads
`);
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function readBridgeToken() {
  const tokenPath = path.join(repoRoot, '.ai-bridge-token');
  const token = (await fs.readFile(tokenPath, 'utf8')).trim();
  if (!token) {
    throw new Error(`Bridge token file is empty: ${tokenPath}`);
  }
  return token;
}

function timestampForPath(date = new Date()) {
  return date.toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')
    .replace('T', '-');
}

function compactDataUrl(value) {
  if (typeof value !== 'string' || !value.startsWith('data:')) {
    return value;
  }
  const commaIndex = value.indexOf(',');
  const meta = commaIndex >= 0 ? value.slice(0, commaIndex) : 'data';
  const bytes = commaIndex >= 0
    ? Math.floor((value.length - commaIndex - 1) * 0.75)
    : value.length;
  return `[redacted ${meta}, approx ${bytes} bytes]`;
}

function compactReportValue(value) {
  if (Array.isArray(value)) {
    return value.map(compactReportValue);
  }
  if (!value || typeof value !== 'object') {
    return compactDataUrl(value);
  }
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
    key,
    key === 'dataUrl' ? compactDataUrl(entry) : compactReportValue(entry),
  ]));
}

function chooseTargetTabId(status) {
  const tabs = Array.isArray(status?.clientTabs) ? status.clientTabs : [];
  const liveTabs = tabs.filter((tab) => !tab.unresponsiveForMs || tab.unresponsiveForMs <= 0);
  if (liveTabs.length === 0) return null;
  const freshTabs = liveTabs.filter((tab) => (tab.lastSeenAgoMs ?? Number.MAX_SAFE_INTEGER) <= 10_000);
  const candidateTabs = freshTabs.length > 0 ? freshTabs : liveTabs;
  candidateTabs.sort((a, b) => {
    const visible = Number(b.visibilityState === 'visible') - Number(a.visibilityState === 'visible');
    if (visible !== 0) return visible;
    const focus = Number(Boolean(b.hasFocus)) - Number(Boolean(a.hasFocus));
    if (focus !== 0) return focus;
    return (a.lastSeenAgoMs ?? Number.MAX_SAFE_INTEGER) - (b.lastSeenAgoMs ?? Number.MAX_SAFE_INTEGER);
  });
  return typeof candidateTabs[0]?.tabId === 'string' ? candidateTabs[0].tabId : null;
}

async function fetchJson(url, init, label, timeoutMs = 35000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    let parsed;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`${label}: non-JSON response (${response.status}) ${text.slice(0, 240)}`);
    }
    if (!response.ok) {
      throw new Error(`${label}: HTTP ${response.status} ${parsed.error || response.statusText}`);
    }
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

function assertToolSuccess(label, result) {
  if (!result || result.success !== true) {
    throw new Error(`${label}: ${result?.error || 'tool failed'}`);
  }
  return result;
}

function assertLiveTimelineState(label, result) {
  if (!result || result.success !== true) {
    const videoClipCount = result?.videoClipCount ?? 0;
    const audioClipCount = result?.audioClipCount ?? 0;
    throw new Error(
      `${label}: live timeline did not become ready ` +
      `(video ${videoClipCount}/${result?.minVideoClips ?? '?'}, ` +
      `audio ${audioClipCount}/${result?.minAudioClips ?? '?'})`
    );
  }
  return result;
}

function assertWorkerDefaultOnProof(label, result) {
  assertToolSuccess(label, result);
  const workerFlag = result?.data?.workerFlag;
  const forced = workerFlag?.forced ?? null;
  const previous = workerFlag?.previous ?? null;
  if (forced !== null) {
    throw new Error(`${label}: expected unforced worker smoke, got forced=${String(forced)}`);
  }
  if (previous !== true) {
    throw new Error(`${label}: timelineCanvasWorker default was not true before smoke (previous=${String(previous)})`);
  }
  return result;
}

function getExportBlobSize(result) {
  const blob = result?.data?.blob;
  return typeof blob?.size === 'number' ? blob.size : 0;
}

function countArray(value) {
  return Array.isArray(value) ? value.length : 0;
}

function countTimelineTrackClips(tracks) {
  return Array.isArray(tracks)
    ? tracks.reduce((count, track) => count + countArray(track?.clips), 0)
    : 0;
}

function summarizeFingerprint(fingerprint) {
  if (!fingerprint) return null;
  return {
    sourceWidth: fingerprint.sourceWidth ?? null,
    sourceHeight: fingerprint.sourceHeight ?? null,
    hash: fingerprint.hash ?? null,
    nonBlankRatio: fingerprint.nonBlankRatio ?? null,
    avgRgb: fingerprint.avgRgb ?? null,
    meanLuma: fingerprint.meanLuma ?? null,
    colorRange: fingerprint.colorRange ?? null,
  };
}

function summarizeExportPreviewParityRun(run) {
  if (!run) return null;
  return {
    success: run.success ?? null,
    error: run.error ?? null,
    blobSize: run.blobSize ?? null,
    elapsedMs: run.elapsedMs ?? null,
    sampleCount: run.sampleCount ?? null,
    bestSample: run.bestSample
      ? {
        previewFrameTime: run.bestSample.previewFrameTime ?? null,
        exportCurrentTime: run.bestSample.exportCurrentTime ?? null,
        exportProgress: run.bestSample.exportProgress ?? null,
        fingerprint: summarizeFingerprint(run.bestSample.fingerprint),
      }
      : null,
    comparison: run.comparison
      ? {
        passed: run.comparison.passed ?? null,
        avgRgbDelta: run.comparison.avgRgbDelta ?? null,
        meanLumaDelta: run.comparison.meanLumaDelta ?? null,
        nonBlankRatioDelta: run.comparison.nonBlankRatioDelta ?? null,
        colorRangeDelta: run.comparison.colorRangeDelta ?? null,
        failures: run.comparison.failures ?? [],
      }
      : null,
    failures: run.failures ?? [],
  };
}

function summarizeExportPreviewParitySmoke(result) {
  const data = result?.data;
  return {
    success: result?.success === true,
    error: result?.error ?? null,
    synthetic: data?.synthetic ?? null,
    sampleTime: data?.sampleTime ?? null,
    exportDurationSeconds: data?.exportDurationSeconds ?? null,
    reference: data?.reference
      ? {
        capturedAt: data.reference.capturedAt ?? null,
        width: data.reference.width ?? null,
        height: data.reference.height ?? null,
        mode: data.reference.mode ?? null,
        canvasSource: data.reference.canvasSource ?? null,
        fingerprint: summarizeFingerprint(data.reference.fingerprint),
      }
      : null,
    referenceAttempts: Array.isArray(data?.referenceAttempts)
      ? data.referenceAttempts.map((attempt) => ({
        requestedTime: attempt.requestedTime ?? null,
        success: attempt.success ?? null,
        error: attempt.error ?? null,
        nonBlankRatio: attempt.fingerprint?.nonBlankRatio ?? null,
        hash: attempt.fingerprint?.hash ?? null,
      }))
      : [],
    fastRun: summarizeExportPreviewParityRun(data?.fastRun),
    preciseRun: summarizeExportPreviewParityRun(data?.preciseRun),
    previewSampleCount: data?.previewSampleCount ?? null,
    exportResourcesBefore: countArray(data?.runtimeBeforeExport?.policies?.export?.resources),
    exportResourcesAfter: countArray(data?.runtimeAfterExport?.policies?.export?.resources),
    restore: data?.restore ?? null,
    failures: data?.failures ?? [],
  };
}

function summarizeFrameLoop(frameLoop) {
  if (!frameLoop) return null;
  return {
    durationMs: frameLoop.durationMs,
    frameCount: frameLoop.frameCount,
    estimatedFps: frameLoop.estimatedFps,
    slowFrameCount: frameLoop.slowFrameCount,
    droppedFrameEstimate: frameLoop.droppedFrameEstimate,
    frameDeltaMs: frameLoop.frameDeltaMs,
  };
}

function summarizeCanvasSmoke(result) {
  const data = result?.data;
  const after = data?.after;
  const steps = Array.isArray(data?.steps) ? data.steps : [];
  const drawnCounts = steps
    .map((step) => Number(step?.canvasTotals?.drawnClipCount ?? 0))
    .filter((value) => Number.isFinite(value));
  const clipCount = Number(after?.timeline?.clipCount ?? 0);
  return {
    success: result?.success === true,
    error: result?.error ?? null,
    synthetic: data?.synthetic ?? null,
    clipCount,
    selectedClipCount: after?.timeline?.selectedClipCount ?? null,
    domClipBodyCount: after?.canvasDiagnostics?.totals?.domClipBodyCount ?? null,
    legacyClipBodyCount: after?.dom?.legacyClipBodyCount ?? null,
    worker: after?.canvasDiagnostics?.totals
      ? {
        workerTrackCount: after.canvasDiagnostics.totals.workerTrackCount ?? null,
        workerEligibleTrackCount: after.canvasDiagnostics.totals.workerEligibleTrackCount ?? null,
        workerFallbackTrackCount: after.canvasDiagnostics.totals.workerFallbackTrackCount ?? null,
        workerFallbackReasons: after.canvasDiagnostics.totals.workerFallbackReasons ?? null,
        workerPendingTrackCount: after.canvasDiagnostics.totals.workerPendingTrackCount ?? null,
        workerDrawReportCount: after.canvasDiagnostics.totals.workerDrawReportCount ?? null,
        workerDrawMsMax: after.canvasDiagnostics.totals.workerDrawMsMax ?? null,
        workerResourceBytes: after.canvasDiagnostics.totals.workerResourceBytes ?? null,
        workerErrorTrackCount: after.canvasDiagnostics.totals.workerErrorTrackCount ?? null,
        workerErrors: after.canvasDiagnostics.totals.workerErrors ?? null,
      }
      : null,
    workerFlag: data?.workerFlag ?? null,
    workerThumbnailWarmup: data?.workerThumbnailWarmup ?? null,
    drawCulling: drawnCounts.length > 0
      ? {
        minDrawn: Math.min(...drawnCounts),
        maxDrawn: Math.max(...drawnCounts),
        partialCullSteps: drawnCounts.filter((value) => value > 0 && value < clipCount).length,
        sampledSteps: drawnCounts.length,
      }
      : null,
    frameLoop: summarizeFrameLoop(data?.frameLoop),
    frameLoopBudget: data?.frameLoopBudget ?? null,
    phaseTimings: Array.isArray(data?.phaseTimings) ? data.phaseTimings : [],
    invariantBudget: data?.invariantBudget ?? null,
    steps: steps.map((step) => ({
      label: step.label ?? null,
      requestedZoom: step.requestedZoom ?? null,
      zoom: step.zoom ?? null,
      scrollFraction: step.scrollFraction ?? null,
      requestedScrollX: step.requestedScrollX ?? null,
      scrollX: step.scrollX ?? null,
      drawnClipCount: step.canvasTotals?.drawnClipCount ?? null,
      domClipBodyCount: step.canvasTotals?.domClipBodyCount ?? null,
      workerTrackCount: step.canvasTotals?.workerTrackCount ?? null,
      shellCount: step.canvasTotals?.shellCount ?? null,
      legacyClipBodyCount: step.dom?.legacyClipBodyCount ?? null,
    })),
    failures: data?.failures ?? [],
  };
}

function summarizeMarqueeSmoke(result) {
  const data = result?.data;
  const after = data?.after;
  return {
    success: result?.success === true,
    error: result?.error ?? null,
    synthetic: data?.synthetic ?? null,
    started: data?.drag?.started ?? null,
    selectedClipCount: after?.timeline?.selectedClipCount ?? null,
    minSelectedClipCount: data?.minSelectedClipCount ?? null,
    domClipBodyCount: after?.canvasDiagnostics?.totals?.domClipBodyCount ?? null,
    legacyClipBodyCount: after?.dom?.legacyClipBodyCount ?? null,
    failures: data?.failures ?? [],
  };
}

function summarizePlayheadSmoothnessSmoke(result) {
  const data = result?.data;
  const motion = data?.motion;
  return {
    success: result?.success === true,
    error: result?.error ?? null,
    synthetic: data?.synthetic ?? null,
    mediaSetup: data?.mediaSetup ?? null,
    sampleCount: motion?.sampleCount ?? null,
    forwardDistancePx: motion?.forwardDistancePx ?? null,
    backtrackCount: motion?.backtrackCount ?? null,
    maxBacktrackPx: motion?.maxBacktrackPx ?? null,
    backtrackDistancePx: motion?.backtrackDistancePx ?? null,
    frameDeltaMs: motion?.frameDeltaMs ?? null,
    thresholds: data?.thresholds ?? null,
    domClipBodyCount: data?.after?.canvasDiagnostics?.totals?.domClipBodyCount ?? null,
    legacyClipBodyCount: data?.after?.dom?.legacyClipBodyCount ?? null,
    failures: data?.failures ?? [],
  };
}

function summarizeSpectralSmoke(result) {
  return {
    success: result?.success === true,
    error: result?.error ?? null,
    playbackSuccess: result?.data?.playback?.success ?? null,
    failures: result?.data?.failures ?? [],
  };
}

function summarizeRamSmoke(result) {
  const data = result?.data;
  return {
    success: result?.success === true,
    error: result?.error ?? null,
    mode: data?.mode ?? null,
    completed: data?.completed ?? null,
    cachedRangeCount: countArray(data?.cachedRanges),
    cachedFrameCount: data?.after?.timeline?.cachedFrameCount ?? null,
    directFrameCount: data?.directResult?.frameCount ?? null,
    generationError: data?.generationError?.message ?? null,
    domClipBodyCount: data?.after?.canvasDiagnostics?.totals?.domClipBodyCount ?? null,
    legacyClipBodyCount: data?.after?.dom?.legacyClipBodyCount ?? null,
    failures: data?.failures ?? [],
  };
}

function summarizeThumbnailReloadSmoke(result) {
  const data = result?.data;
  const after = data?.after;
  return {
    success: result?.success === true,
    error: result?.error ?? null,
    synthetic: data?.synthetic ?? null,
    source: data?.source
      ? {
        mediaFileId: data.source.mediaFileId,
        mimeType: data.source.mimeType,
        durationSeconds: data.source.durationSeconds,
        generatedThumbnailCount: data.source.generatedThumbnailCount,
      }
      : null,
    thumbnailClipCount: data?.thumbnailClipCount ?? null,
    thumbnailDrawCount: data?.thumbnailDrawCount ?? null,
    minThumbnailClipCount: data?.minThumbnailClipCount ?? null,
    minThumbnailDrawCount: data?.minThumbnailDrawCount ?? null,
    workerTrackCount: data?.workerTrackCount ?? null,
    workerEligibleTrackCount: data?.workerEligibleTrackCount ?? null,
    workerFallbackTrackCount: data?.workerFallbackTrackCount ?? null,
    workerResourceBytes: data?.workerResourceBytes ?? null,
    workerFlag: data?.workerFlag ?? null,
    domClipBodyCount: after?.canvasDiagnostics?.totals?.domClipBodyCount ?? null,
    legacyClipBodyCount: after?.dom?.legacyClipBodyCount ?? null,
    failures: data?.failures ?? [],
  };
}

function summarizeBladeToolSmoke(result) {
  const data = result?.data;
  return {
    success: result?.success === true,
    error: result?.error ?? null,
    synthetic: data?.synthetic ?? null,
    gesture: data?.gesture
      ? {
        started: data.gesture.started,
        rowFound: data.gesture.rowFound,
        targetClipId: data.gesture.targetClipId,
        splitTime: data.gesture.splitTime,
        beforeClipCount: data.gesture.beforeClipCount,
        afterClipCount: data.gesture.afterClipCount,
        previewToolId: data.gesture.previewBeforeClick?.toolId ?? null,
        previewTime: data.gesture.previewBeforeClick?.time ?? null,
      }
      : null,
    restore: data?.restore ?? null,
    domClipBodyCount: data?.after?.canvasDiagnostics?.totals?.domClipBodyCount ?? null,
    legacyClipBodyCount: data?.after?.dom?.legacyClipBodyCount ?? null,
    failures: data?.failures ?? [],
  };
}

function summarizeScrubSmoke(result) {
  const data = result?.data;
  return {
    success: result?.success === true,
    error: result?.error ?? null,
    pattern: data?.pattern ?? null,
    speed: data?.speed ?? null,
    durationMs: data?.durationMs ?? null,
    requestedDurationMs: data?.requestedDurationMs ?? null,
    framesApplied: data?.framesApplied ?? null,
    initialPosition: data?.initialPosition ?? null,
    finalPosition: data?.finalPosition ?? null,
    minVisited: data?.minVisited ?? null,
    maxVisited: data?.maxVisited ?? null,
    runDiagnostics: data?.runDiagnostics
      ? {
        playbackStatus: data.runDiagnostics.playback?.status ?? null,
        previewFreezeEvents: data.runDiagnostics.playback?.previewFreezeEvents ?? null,
        stalePreviewWhileTargetMoved: data.runDiagnostics.playback?.stalePreviewWhileTargetMoved ?? null,
        longestPreviewFreezeMs: data.runDiagnostics.playback?.longestPreviewFreezeMs ?? null,
        stalls: data.runDiagnostics.playback?.stalls ?? null,
        healthAnomalies: data.runDiagnostics.playback?.healthAnomalies ?? null,
        coldVideos: data.runDiagnostics.playback?.coldVideos ?? null,
        warmingUpVideos: data.runDiagnostics.playback?.warmingUpVideos ?? null,
        seekingVideos: data.runDiagnostics.playback?.seekingVideos ?? null,
        worstReadyState: data.runDiagnostics.playback?.worstReadyState ?? null,
        previewPathCounts: data.runDiagnostics.playback?.previewPathCounts ?? null,
        healthStatus: data.runDiagnostics.health?.status ?? null,
      }
      : null,
  };
}

function summarizePlaybackSmoke(result) {
  const data = result?.data;
  return {
    success: result?.success === true,
    error: result?.error ?? null,
    requestedDurationMs: data?.requestedDurationMs ?? null,
    actualDurationMs: data?.actualDurationMs ?? null,
    playbackSpeed: data?.playbackSpeed ?? null,
    initialPosition: data?.initialPosition ?? null,
    finalPosition: data?.finalPosition ?? null,
    deltaSeconds: data?.deltaSeconds ?? null,
    driftSeconds: data?.driftSeconds ?? null,
    framesObserved: data?.framesObserved ?? null,
    movingFrames: data?.movingFrames ?? null,
    stalledFrames: data?.stalledFrames ?? null,
    longestStallMs: data?.longestStallMs ?? null,
    endedPlaying: data?.endedPlaying ?? null,
    restoredPlaybackState: data?.restoredPlaybackState ?? null,
    runDiagnostics: data?.runDiagnostics
      ? {
        playbackStatus: data.runDiagnostics.playback?.status ?? null,
        previewFreezeEvents: data.runDiagnostics.playback?.previewFreezeEvents ?? null,
        stalePreviewWhileTargetMoved: data.runDiagnostics.playback?.stalePreviewWhileTargetMoved ?? null,
        longestPreviewFreezeMs: data.runDiagnostics.playback?.longestPreviewFreezeMs ?? null,
        stalls: data.runDiagnostics.playback?.stalls ?? null,
        healthAnomalies: data.runDiagnostics.playback?.healthAnomalies ?? null,
        coldVideos: data.runDiagnostics.playback?.coldVideos ?? null,
        warmingUpVideos: data.runDiagnostics.playback?.warmingUpVideos ?? null,
        seekingVideos: data.runDiagnostics.playback?.seekingVideos ?? null,
        worstReadyState: data.runDiagnostics.playback?.worstReadyState ?? null,
        previewPathCounts: data.runDiagnostics.playback?.previewPathCounts ?? null,
        healthStatus: data.runDiagnostics.health?.status ?? null,
      }
      : null,
  };
}

function summarizePlaybackPathSmoke(result) {
  const data = result?.data;
  const steps = Array.isArray(data?.steps) ? data.steps : [];
  return {
    success: result?.success === true,
    error: result?.error ?? null,
    preset: data?.preset ?? null,
    diagnosticMode: data?.diagnosticMode ?? null,
    clipStartTime: data?.clipStartTime ?? null,
    requestedStartTime: data?.requestedStartTime ?? null,
    playableEndTime: data?.playableEndTime ?? null,
    totalDurationMs: data?.totalDurationMs ?? null,
    stepCount: steps.length,
    finalPosition: data?.finalPosition ?? null,
    endedPlaying: data?.endedPlaying ?? null,
    stepKinds: steps.map((step) => step.kind ?? null),
    scrubTargets: steps
      .filter((step) => step.kind === 'scrub')
      .map((step) => ({
        label: step.label ?? null,
        targetTime: step.targetTime ?? null,
        unclampedTargetTime: step.unclampedTargetTime ?? null,
        targetWasClamped: step.targetWasClamped ?? null,
        finalPosition: step.finalPosition ?? null,
      })),
    playSteps: steps
      .filter((step) => step.kind === 'play')
      .map((step) => ({
        label: step.label ?? null,
        deltaSeconds: step.deltaSeconds ?? null,
        movingFrames: step.movingFrames ?? null,
        stalledFrames: step.stalledFrames ?? null,
        skipped: step.skipped ?? null,
        skipReason: step.skipReason ?? null,
      })),
    runDiagnostics: data?.runDiagnostics
      ? {
        playbackStatus: data.runDiagnostics.playback?.status ?? null,
        previewFreezeEvents: data.runDiagnostics.playback?.previewFreezeEvents ?? null,
        stalePreviewWhileTargetMoved: data.runDiagnostics.playback?.stalePreviewWhileTargetMoved ?? null,
        longestPreviewFreezeMs: data.runDiagnostics.playback?.longestPreviewFreezeMs ?? null,
        healthAnomalies: data.runDiagnostics.playback?.healthAnomalies ?? null,
        previewPathCounts: data.runDiagnostics.playback?.previewPathCounts ?? null,
        stalls: data.runDiagnostics.playback?.stalls ?? null,
        healthStatus: data.runDiagnostics.health?.status ?? null,
      }
      : null,
  };
}

function summarizeStats(result) {
  const data = result?.data;
  return {
    success: result?.success === true,
    engineReady: data?.engineReady ?? null,
    document: data?.document ?? null,
    projectLoadProgress: data?.projectLoadProgress ?? null,
    playbackStatus: data?.playback?.status ?? null,
    renderLoop: data?.renderLoop
      ? {
        isRunning: data.renderLoop.isRunning,
        isIdle: data.renderLoop.isIdle,
        renderCount: data.renderLoop.renderCount,
      }
      : null,
    timelineCanvasTotals: data?.timelineCanvas?.totals ?? null,
    runtimeTotals: data?.timelineRuntimeCoordinator?.totals ?? null,
    gpu: data?.gpu ?? null,
  };
}

function summarizeLiveComposition(report) {
  const state = report.steps.liveCompositionState?.data;
  const playback = report.steps.liveCompositionPlayback;
  const stats = report.steps.liveCompositionStatsAfter ?? report.steps.liveCompositionStatsBefore;
  const openError = report.steps.liveCompositionOpen?.error ?? null;
  return {
    skipped: report.summary.liveCompositionSkipped ?? null,
    openSuccess: report.steps.liveCompositionOpen?.success ?? null,
    openError,
    composition: report.steps.liveCompositionOpen?.data
      ? {
        id: report.steps.liveCompositionOpen.data.compositionId,
        name: report.steps.liveCompositionOpen.data.name,
        duration: report.steps.liveCompositionOpen.data.duration,
        frameRate: report.steps.liveCompositionOpen.data.frameRate,
      }
      : null,
    totalClips: state?.totalClips ?? null,
    videoClipCount: countTimelineTrackClips(state?.videoTracks),
    audioClipCount: countTimelineTrackClips(state?.audioTracks),
    playback: summarizePlaybackSmoke(playback),
    scrub: summarizeScrubSmoke(report.steps.liveCompositionScrub),
    playbackPath: summarizePlaybackPathSmoke(report.steps.liveCompositionPlaybackPath),
    canvasTotals: stats?.data?.timelineCanvas?.totals ?? null,
    failures: report.summary.liveCompositionFailures ?? [],
  };
}

function prefixFailures(prefix, failures) {
  return Array.isArray(failures)
    ? failures.filter(Boolean).map((failure) => `${prefix}: ${failure}`)
    : [];
}

function collectToolFailures(result) {
  if (Array.isArray(result?.data?.failures) && result.data.failures.length > 0) {
    return result.data.failures;
  }
  if (result && result.success !== true && result.error) {
    return [result.error];
  }
  if (result && result.success !== true) {
    return ['tool failed'];
  }
  return [];
}

function collectVerificationFailures(report) {
  return [
    ...prefixFailures('reload', report.summary.reloadFailures),
    ...prefixFailures('live composition', report.summary.liveCompositionFailures),
    ...prefixFailures('export preview parity', report.summary.exportPreviewParityFailures),
    ...prefixFailures('worker prewarm', report.summary.workerPrewarmFailures),
    ...prefixFailures('worker synthetic', report.summary.workerSyntheticFailures),
    ...prefixFailures('worker thumbnail synthetic', report.summary.workerThumbnailSyntheticFailures),
    ...prefixFailures('worker live fallback', report.summary.workerFallbackLiveFailures),
    ...prefixFailures('worker live positive', report.summary.workerPositiveLiveFailures),
    ...prefixFailures('worker default live', report.summary.workerDefaultLiveFailures),
    ...prefixFailures('large project', report.summary.largeProjectFailures),
    ...prefixFailures('marquee', report.summary.marqueeFailures),
    ...prefixFailures('playhead smoothness', report.summary.playheadSmoothnessFailures),
    ...prefixFailures('thumbnail reload', report.summary.thumbnailReloadFailures),
    ...prefixFailures('RAM preview', report.summary.ramPreviewFailures),
    ...prefixFailures('spectral playback', report.summary.spectralPlaybackFailures),
  ];
}

function buildCompactReport(report) {
  return {
    name: report.name,
    generatedAt: report.generatedAt,
    baseUrl: report.baseUrl,
    targetTabId: report.targetTabId ?? null,
    runDir: report.runDir,
    summary: report.summary,
    bridge: {
      initialClients: report.steps.status?.clients ?? null,
      statusAfterReloadClients: report.steps.statusAfterReload?.clients ?? null,
      statusAfterStatsHistoryClients: report.steps.statusAfterStatsHistory?.clients ?? null,
    },
    reload: {
      success: report.steps.reloadApp?.success ?? null,
      readinessSuccess: report.steps.reloadReadiness?.success ?? null,
      firstStatsMs: report.steps.reloadReadiness?.firstStatsMs ?? null,
      readyMs: report.steps.reloadReadiness?.readyMs ?? null,
      readinessSamples: report.steps.reloadReadiness?.samples ?? [],
      readinessLastSample: report.steps.reloadReadiness?.lastSample ?? null,
      statsHistorySuccess: report.steps.statsHistoryAfterReload?.success ?? null,
      statsHistorySummary: report.steps.statsHistoryAfterReload?.data?.summary ?? null,
    },
    torture: {
      skipped: report.summary.tortureSkipped ?? null,
      fixtureSuccess: report.steps.createTortureProjectFixture?.success ?? null,
      exportFastBytes: report.summary.exportFastBytes ?? null,
      exportPreciseBytes: report.summary.exportPreciseBytes ?? null,
    },
    largeProject: summarizeCanvasSmoke(report.steps.largeProject),
    workerPrewarm: summarizeCanvasSmoke(report.steps.workerPrewarm),
    workerSynthetic: summarizeCanvasSmoke(report.steps.workerSynthetic),
    workerThumbnailSynthetic: summarizeThumbnailReloadSmoke(report.steps.workerThumbnailSynthetic),
    workerFallbackLive: summarizeCanvasSmoke(report.steps.workerFallbackLive),
    workerPositiveLive: summarizeCanvasSmoke(report.steps.workerPositiveLive),
    workerDefaultLive: summarizeCanvasSmoke(report.steps.workerDefaultLive),
    exportPreviewParity: summarizeExportPreviewParitySmoke(report.steps.exportPreviewParity),
    liveComposition: summarizeLiveComposition(report),
    marquee: summarizeMarqueeSmoke(report.steps.marquee),
    bladeTool: summarizeBladeToolSmoke(report.steps.bladeTool),
    playheadSmoothness: summarizePlayheadSmoothnessSmoke(report.steps.playheadSmoothness),
    thumbnailReload: summarizeThumbnailReloadSmoke(report.steps.thumbnailReload),
    scrub: summarizeScrubSmoke(
      report.steps.liveCompositionScrub ?? report.steps.simulateScrub ?? report.steps.simulateScrubSynthetic,
    ),
    playback: summarizePlaybackSmoke(
      report.steps.liveCompositionPlayback ?? report.steps.simulatePlayback ?? report.steps.simulatePlaybackSynthetic,
    ),
    playbackPath: summarizePlaybackPathSmoke(
      report.steps.liveCompositionPlaybackPath ?? report.steps.simulatePlaybackPath ?? report.steps.simulatePlaybackPathSynthetic,
    ),
    playbackContexts: {
      live: {
        scrub: summarizeScrubSmoke(report.steps.liveCompositionScrub),
        playback: summarizePlaybackSmoke(report.steps.liveCompositionPlayback),
        playbackPath: summarizePlaybackPathSmoke(report.steps.liveCompositionPlaybackPath),
      },
      torture: {
        scrub: summarizeScrubSmoke(report.steps.simulateScrub),
        playback: summarizePlaybackSmoke(report.steps.simulatePlayback),
        playbackPath: summarizePlaybackPathSmoke(report.steps.simulatePlaybackPath),
      },
      synthetic: {
        scrub: summarizeScrubSmoke(report.steps.simulateScrubSynthetic),
        playback: summarizePlaybackSmoke(report.steps.simulatePlaybackSynthetic),
        playbackPath: summarizePlaybackPathSmoke(report.steps.simulatePlaybackPathSynthetic),
      },
    },
    spectralPlayback: summarizeSpectralSmoke(
      report.steps.spectralPlayback ?? report.steps.spectralPlaybackSynthetic,
    ),
    ramPreview: summarizeRamSmoke(
      report.steps.ramPreview ?? report.steps.ramPreviewSynthetic,
    ),
    finalStats: summarizeStats(report.steps.finalStats),
    playbackTrace: {
      success: report.steps.playbackTrace?.success ?? null,
      eventCount: countArray(report.steps.playbackTrace?.data?.events),
      health: report.steps.playbackTrace?.data?.health ?? null,
    },
    runtimeDiagnostics: {
      success: report.steps.runtimeDiagnostics?.success ?? null,
      totalEntries: report.steps.runtimeDiagnostics?.data?.totalEntries ?? null,
      summary: report.steps.runtimeDiagnostics?.data?.summary ?? null,
    },
  };
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    printHelp();
    return;
  }

  const token = await readBridgeToken();
  const baseUrl = new URL(options.baseUrl);
  const apiUrl = new URL('/api/ai-tools', baseUrl);
  const runDir = path.join(options.out, `run-${timestampForPath()}`);
  await fs.mkdir(runDir, { recursive: true });

  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  let targetTabId = null;
  async function getBridgeStatus() {
    return fetchJson(apiUrl, { method: 'GET' }, 'bridge status', 5000);
  }
  async function postTool(tool, args = {}, timeoutMs = 35000) {
    return fetchJson(apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ tool, args, timeoutMs, targetTabId }),
    }, tool, timeoutMs + 5000);
  }
  async function postToolWithRetry(tool, args = {}, timeoutMs = 35000, attempts = 2) {
    let lastError = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await postTool(tool, args, timeoutMs);
      } catch (error) {
        lastError = error;
        if (attempt < attempts) {
          await new Promise((resolve) => setTimeout(resolve, 750));
          report.steps[`statusBeforeRetry_${tool}_${attempt}`] = await getBridgeStatus();
          targetTabId = chooseTargetTabId(report.steps[`statusBeforeRetry_${tool}_${attempt}`]) ?? targetTabId;
        }
      }
    }
    throw lastError;
  }
  async function postToolProbe(tool, args = {}, toolTimeoutMs = 900, fetchTimeoutMs = 1400) {
    return fetchJson(apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ tool, args, timeoutMs: toolTimeoutMs, targetTabId }),
    }, `${tool} probe`, fetchTimeoutMs);
  }
  async function pollReloadReadiness(startedAtMs) {
    const samples = [];
    const maxSamples = 40;
    const minInputClips = options.skipLiveComposition || options.liveImportFallback
      ? 0
      : options.liveMinVideoClips + options.liveMinAudioClips;
    let firstStatsMs = null;
    let readyMs = null;

    for (let index = 0; index < maxSamples; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      const elapsedMs = Date.now() - startedAtMs;
      try {
        const result = await postToolProbe('getStats', {}, 900, 1400);
        if (result?.success === true) {
          if (firstStatsMs === null) {
            firstStatsMs = elapsedMs;
          }
          const progress = result.data?.projectLoadProgress ?? null;
          const totals = result.data?.timelineCanvas?.totals ?? null;
          const sample = {
            elapsedMs,
            success: true,
            engineReady: result.data?.engineReady ?? null,
            fps: result.data?.fps ?? null,
            projectLoadProgress: progress,
            canvasTotals: totals
              ? {
                inputClipCount: totals.inputClipCount ?? null,
                domClipBodyCount: totals.domClipBodyCount ?? null,
                staleTrackCount: totals.staleTrackCount ?? null,
                orphanedTrackCount: totals.orphanedTrackCount ?? null,
              }
              : null,
          };
          samples.push(sample);

          const loadIdle = progress?.active === false;
          const clipCountReady = minInputClips <= 0 || Number(totals?.inputClipCount ?? 0) >= minInputClips;
          if (loadIdle && clipCountReady) {
            readyMs = elapsedMs;
            break;
          }
        } else {
          samples.push({
            elapsedMs,
            success: false,
            error: result?.error ?? 'tool failed',
          });
        }
      } catch (error) {
        samples.push({
          elapsedMs,
          success: false,
          error: error instanceof Error ? error.name || error.message : String(error),
        });
      }
    }

    return {
      success: readyMs !== null,
      firstStatsMs,
      readyMs,
      sampleCount: samples.length,
      samples: samples.slice(0, 20),
      lastSample: samples.at(-1) ?? null,
    };
  }
  async function createLiveCompositionFixture(reason) {
    const candidatePaths = [];
    for (const filePath of options.liveImportPaths) {
      const resolvedPath = path.resolve(filePath);
      if (await pathExists(resolvedPath)) {
        candidatePaths.push(resolvedPath);
      }
    }

    if (candidatePaths.length === 0) {
      return {
        success: false,
        error: `No live fixture import paths exist. Original open failure: ${reason}`,
        requestedPaths: options.liveImportPaths,
      };
    }

    const fixture = {
      success: false,
      reason,
      requestedPaths: options.liveImportPaths,
      importPaths: candidatePaths,
      compositionId: null,
      compositionName: null,
      imported: [],
      createdTrackIds: [],
      existingVideoTrackIds: [],
      segmentResults: [],
      failures: [],
      videoClipCount: 0,
      audioClipCount: 0,
    };

    const compositionName = `Timeline Canvas Live Proof ${timestampForPath()}`;
    const createComposition = assertToolSuccess(
      'createComposition live fixture',
      await postTool('createComposition', {
        name: compositionName,
        width: 1920,
        height: 1080,
        frameRate: 30,
        duration: options.liveFixtureDurationSeconds,
        openAfterCreate: true,
      }, 30000),
    );
    fixture.compositionId = createComposition.data?.compositionId ?? null;
    fixture.compositionName = createComposition.data?.name ?? compositionName;

    const importFiles = assertToolSuccess(
      'importLocalFiles live fixture',
      await postTool('importLocalFiles', {
        paths: candidatePaths,
        addToTimeline: false,
      }, 180000),
    );
    fixture.imported = Array.isArray(importFiles.data?.imported) ? importFiles.data.imported : [];
    const videoMedia = fixture.imported.filter((item) => item?.type === 'video' && typeof item.id === 'string');
    if (videoMedia.length === 0) {
      throw new Error('Live fixture import produced no video media files');
    }

    const initialTimeline = assertToolSuccess(
      'getTimelineState live fixture initial',
      await postTool('getTimelineState', {}, 20000),
    );
    const initialVideoTracks = Array.isArray(initialTimeline.data?.videoTracks)
      ? initialTimeline.data.videoTracks
      : [];
    const targetVideoTrackCount = Math.max(1, Math.round(options.liveFixtureVideoTracks));
    const trackIds = initialVideoTracks
      .map((track) => track?.id)
      .filter((id) => typeof id === 'string');
    fixture.existingVideoTrackIds = [...trackIds];

    while (trackIds.length < targetVideoTrackCount) {
      const created = assertToolSuccess(
        'createTrack live fixture',
        await postTool('createTrack', { type: 'video' }, 30000),
      );
      const nextTimeline = assertToolSuccess(
        'getTimelineState after live fixture createTrack',
        await postTool('getTimelineState', {}, 20000),
      );
      const nextTrackIds = (Array.isArray(nextTimeline.data?.videoTracks) ? nextTimeline.data.videoTracks : [])
        .map((track) => track?.id)
        .filter((id) => typeof id === 'string');
      const addedTrackId = nextTrackIds.find((id) => !trackIds.includes(id))
        ?? created.data?.trackId
        ?? null;
      if (!addedTrackId) {
        throw new Error('createTrack did not expose a new video track id');
      }
      trackIds.push(addedTrackId);
      fixture.createdTrackIds.push(addedTrackId);
    }

    const segmentCount = Math.max(options.liveMinVideoClips, Math.round(options.liveFixtureSegments));
    const clipDuration = Math.min(1.15, Math.max(0.4, options.liveFixtureDurationSeconds / Math.max(1, segmentCount / trackIds.length) * 0.7));
    const groupStride = Math.max(clipDuration + 0.2, options.liveFixtureDurationSeconds / Math.max(1, Math.ceil(segmentCount / trackIds.length)));
    for (let index = 0; index < segmentCount; index += 1) {
      const trackIndex = index % trackIds.length;
      const group = Math.floor(index / trackIds.length);
      const media = videoMedia[index % videoMedia.length];
      const maxSourceStart = Math.max(0, Math.min(4, Number(media.duration ?? 6) - clipDuration - 0.05));
      const sourceStart = Number((maxSourceStart > 0 ? (group * 0.37) % maxSourceStart : 0).toFixed(3));
      const startTime = Number(Math.min(
        Math.max(0, options.liveFixtureDurationSeconds - clipDuration),
        group * groupStride + trackIndex * 0.18,
      ).toFixed(3));
      const outPoint = Number((sourceStart + clipDuration).toFixed(3));
      const segment = await postTool('addClipSegment', {
        mediaFileId: media.id,
        trackId: trackIds[trackIndex],
        startTime,
        inPoint: sourceStart,
        outPoint,
      }, 60000);
      if (segment?.success === true) {
        fixture.segmentResults.push({
          index,
          mediaFileId: media.id,
          trackId: trackIds[trackIndex],
          startTime,
          inPoint: sourceStart,
          outPoint,
          clipCount: segment.data?.clipCount ?? null,
        });
      } else {
        fixture.failures.push({
          index,
          mediaFileId: media.id,
          trackId: trackIds[trackIndex],
          error: segment?.error ?? 'addClipSegment failed',
        });
      }
    }

    const finalTimeline = assertToolSuccess(
      'getTimelineState live fixture final',
      await postTool('getTimelineState', {}, 20000),
    );
    fixture.videoClipCount = countTimelineTrackClips(finalTimeline.data?.videoTracks);
    fixture.audioClipCount = countTimelineTrackClips(finalTimeline.data?.audioTracks);
    fixture.success = fixture.videoClipCount >= Math.min(segmentCount, options.liveMinVideoClips) && fixture.failures.length === 0;
    if (!fixture.success) {
      fixture.error = `Live fixture created ${fixture.videoClipCount}/${segmentCount} video clips with ${fixture.failures.length} segment failures`;
    }
    return fixture;
  }
  async function waitForLiveTimelineState(label, {
    minVideoClips = 1,
    minAudioClips = 0,
    timeoutMs = 20000,
  } = {}) {
    const startedAtMs = Date.now();
    const samples = [];
    let lastResult = null;

    while (Date.now() - startedAtMs < timeoutMs) {
      const elapsedMs = Date.now() - startedAtMs;
      const result = await postTool('getTimelineState', {}, 20000);
      lastResult = result;

      if (result?.success === true) {
        const state = result.data ?? {};
        const videoClipCount = countTimelineTrackClips(state.videoTracks);
        const audioClipCount = countTimelineTrackClips(state.audioTracks);
        samples.push({
          elapsedMs,
          success: true,
          totalClips: state.totalClips ?? null,
          videoClipCount,
          audioClipCount,
          duration: state.duration ?? null,
        });

        if (videoClipCount >= minVideoClips && audioClipCount >= minAudioClips) {
          return {
            success: true,
            label,
            elapsedMs,
            minVideoClips,
            minAudioClips,
            videoClipCount,
            audioClipCount,
            result,
            samples: samples.slice(0, 20),
            lastSample: samples.at(-1) ?? null,
          };
        }
      } else {
        samples.push({
          elapsedMs,
          success: false,
          error: result?.error ?? 'getTimelineState failed',
        });
      }

      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    const lastData = lastResult?.data ?? {};
    return {
      success: false,
      label,
      elapsedMs: Date.now() - startedAtMs,
      minVideoClips,
      minAudioClips,
      videoClipCount: countTimelineTrackClips(lastData.videoTracks),
      audioClipCount: countTimelineTrackClips(lastData.audioTracks),
      result: lastResult,
      samples: samples.slice(0, 20),
      lastSample: samples.at(-1) ?? null,
    };
  }
  async function runLiveCompositionVerification() {
    if (options.skipLiveComposition || !options.liveCompositionId) {
      report.summary.liveCompositionSkipped = options.skipLiveComposition
        ? 'skipped by option'
        : 'no live composition id configured';
      return;
    }

    const failures = [];
    console.log(`Running live composition smoke: ${options.liveCompositionId}`);
    report.steps.liveCompositionOpen = await postTool('openComposition', {
      compositionId: options.liveCompositionId,
    }, 30000);
    if (report.steps.liveCompositionOpen?.success !== true) {
      const message = report.steps.liveCompositionOpen?.error
        ?? `could not open live composition: ${options.liveCompositionId}`;
      if (options.liveImportFallback) {
        console.log(`Live composition not found; creating live fixture from local media (${message})...`);
        report.steps.liveCompositionFixture = await createLiveCompositionFixture(message);
        if (report.steps.liveCompositionFixture?.success === true && report.steps.liveCompositionFixture.compositionId) {
          options.liveCompositionId = report.steps.liveCompositionFixture.compositionId;
          report.summary.liveCompositionFixture = {
            compositionId: report.steps.liveCompositionFixture.compositionId,
            compositionName: report.steps.liveCompositionFixture.compositionName,
            importCount: report.steps.liveCompositionFixture.imported.length,
            videoClipCount: report.steps.liveCompositionFixture.videoClipCount,
            audioClipCount: report.steps.liveCompositionFixture.audioClipCount,
          };
          report.steps.liveCompositionOpen = await postTool('openComposition', {
            compositionId: options.liveCompositionId,
          }, 30000);
        }
      }
    }

    if (report.steps.liveCompositionOpen?.success !== true) {
      const message = report.steps.liveCompositionOpen?.error
        ?? report.steps.liveCompositionFixture?.error
        ?? `could not open live composition: ${options.liveCompositionId}`;
      report.summary.liveCompositionSkipped = message;
      report.summary.liveCompositionFailures = [message];
      if (options.requireLiveComposition) {
        throw new Error(message);
      }
      return;
    }

    report.steps.liveCompositionStateWait = await waitForLiveTimelineState('live composition', {
      minVideoClips: options.liveMinVideoClips,
      minAudioClips: options.liveMinAudioClips,
      timeoutMs: 20000,
    });
    report.steps.liveCompositionState = assertToolSuccess(
      'getTimelineState live composition',
      report.steps.liveCompositionStateWait.result,
    );
    const liveState = report.steps.liveCompositionState.data ?? {};
    const videoClipCount = countTimelineTrackClips(liveState.videoTracks);
    const audioClipCount = countTimelineTrackClips(liveState.audioTracks);
    if (videoClipCount < options.liveMinVideoClips) {
      failures.push(`live composition has ${videoClipCount} video clips, expected at least ${options.liveMinVideoClips}`);
    }
    if (audioClipCount < options.liveMinAudioClips) {
      failures.push(`live composition has ${audioClipCount} audio clips, expected at least ${options.liveMinAudioClips}`);
    }

    report.steps.liveCompositionStatsBefore = assertToolSuccess(
      'getStats live composition before playback',
      await postTool('getStats', {}, 10000),
    );
    const beforeTotals = report.steps.liveCompositionStatsBefore.data?.timelineCanvas?.totals ?? {};
    if (Number(beforeTotals.domClipBodyCount ?? 0) !== 0) {
      failures.push(`live composition DOM clip bodies before playback: ${beforeTotals.domClipBodyCount}`);
    }
    if (Number(beforeTotals.storeInputClipCount ?? 0) < options.liveMinVideoClips + options.liveMinAudioClips) {
      failures.push(`live composition storeInputClipCount before playback is ${beforeTotals.storeInputClipCount}`);
    }

    if (!options.skipPlayback) {
      report.steps.liveCompositionScrub = assertToolSuccess(
        'simulateScrub live composition',
        await postTool('simulateScrub', {
          pattern: 'custom',
          points: [0, 30, 120, 10],
          durationMs: 900,
          resetDiagnostics: true,
        }, 20000),
      );
      report.steps.liveCompositionPlayback = assertToolSuccess(
        'simulatePlayback live composition',
        await postTool('simulatePlayback', {
          startTime: 0,
          durationMs: options.livePlaybackMs,
          settleMs: 100,
          resetDiagnostics: true,
        }, Math.max(20000, options.livePlaybackMs + 10000)),
      );
      const playbackData = report.steps.liveCompositionPlayback.data ?? {};
      if (playbackData.endedPlaying !== false) {
        failures.push('live composition playback smoke did not leave playback paused');
      }
      if (playbackData.runDiagnostics?.playback?.previewFreezeEvents > 0) {
        failures.push(`live composition previewFreezeEvents=${playbackData.runDiagnostics.playback.previewFreezeEvents}`);
      }
      report.steps.liveCompositionPlaybackPath = assertToolSuccess(
        'simulatePlaybackPath live composition',
        await postTool('simulatePlaybackPath', {
          preset: 'play_scrub_stress_v1',
          startTime: 0,
          playbackSpeed: 1,
          resetDiagnostics: true,
        }, 45000),
      );
    }

    report.steps.liveCompositionStatsAfter = assertToolSuccess(
      'getStats live composition after playback',
      await postTool('getStats', {}, 10000),
    );
    const afterTotals = report.steps.liveCompositionStatsAfter.data?.timelineCanvas?.totals ?? {};
    if (Number(afterTotals.domClipBodyCount ?? 0) !== 0) {
      failures.push(`live composition DOM clip bodies after playback: ${afterTotals.domClipBodyCount}`);
    }
    if (Number(afterTotals.staleTrackCount ?? 0) !== 0) {
      failures.push(`live composition staleTrackCount after playback: ${afterTotals.staleTrackCount}`);
    }
    if (Number(afterTotals.orphanedTrackCount ?? 0) !== 0) {
      failures.push(`live composition orphanedTrackCount after playback: ${afterTotals.orphanedTrackCount}`);
    }

    report.summary.liveCompositionFailures = failures;
    if (failures.length > 0 && options.requireLiveComposition) {
      throw new Error(`Live composition verification failed: ${failures.join('; ')}`);
    }
  }

  console.log(`Bridge: ${baseUrl.origin}`);
  console.log(`Report dir: ${path.relative(repoRoot, runDir)}`);

  const report = {
    name: 'MasterSelects timeline canvas verification',
    generatedAt: new Date().toISOString(),
    baseUrl: baseUrl.origin,
    runDir,
    steps: {},
    summary: {},
  };
  async function refreshTargetTabId(stepName) {
    report.steps[stepName] = await getBridgeStatus();
    const nextTargetTabId = chooseTargetTabId(report.steps[stepName]);
    if (nextTargetTabId) {
      targetTabId = nextTargetTabId;
      report.targetTabId = nextTargetTabId;
    }
    return targetTabId;
  }

  report.steps.status = await getBridgeStatus();
  if (!report.steps.status.clients || report.steps.status.clients < 1) {
    throw new Error('No browser tab is connected to the dev bridge. Open the running dev server page first.');
  }
  targetTabId = chooseTargetTabId(report.steps.status);
  if (targetTabId) {
    report.targetTabId = targetTabId;
    console.log(`Target tab: ${targetTabId}`);
  }

  report.steps.clearRuntimeDiagnostics = await postTool('clearRuntimeDiagnostics', {}, 10000);
  const reloadStartedAtMs = Date.now();
  report.steps.reloadApp = assertToolSuccess('reloadApp', await postTool('reloadApp', { delayMs: 50 }, 10000));
  report.steps.reloadReadiness = await pollReloadReadiness(reloadStartedAtMs);
  report.summary.reloadFailures = [];
  if (report.steps.reloadReadiness.success !== true) {
    report.summary.reloadFailures.push('project did not become ready after reload polling');
  }
  if (
    typeof report.steps.reloadReadiness.firstStatsMs !== 'number' ||
    report.steps.reloadReadiness.firstStatsMs > options.reloadMaxFirstStatsMs
  ) {
    report.summary.reloadFailures.push(
      `first stats after reload ${report.steps.reloadReadiness.firstStatsMs ?? 'missing'}ms/${options.reloadMaxFirstStatsMs}ms`,
    );
  }
  if (
    typeof report.steps.reloadReadiness.readyMs !== 'number' ||
    report.steps.reloadReadiness.readyMs > options.reloadMaxReadyMs
  ) {
    report.summary.reloadFailures.push(
      `reload ready ${report.steps.reloadReadiness.readyMs ?? 'missing'}ms/${options.reloadMaxReadyMs}ms`,
    );
  }
  report.steps.statusAfterReload = await getBridgeStatus();
  targetTabId = chooseTargetTabId(report.steps.statusAfterReload) ?? targetTabId;
  try {
    report.steps.statsHistoryAfterReload = await postToolWithRetry(
      'getStatsHistory',
      { samples: 1, intervalMs: 250 },
      10000,
      2,
    );
  } catch (error) {
    report.steps.statsHistoryAfterReload = {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  report.steps.statusAfterStatsHistory = await getBridgeStatus();
  targetTabId = chooseTargetTabId(report.steps.statusAfterStatsHistory) ?? null;

  await runLiveCompositionVerification();

  if (!options.skipExport && !options.skipExportPreviewParity) {
    const useActiveLiveComposition = !options.skipLiveComposition && report.steps.liveCompositionOpen?.success === true;
    console.log(`Running export-preview parity smoke on ${useActiveLiveComposition ? 'live composition' : 'synthetic timeline'}...`);
    if (useActiveLiveComposition) {
      report.steps.exportPreviewParityWarmup = assertToolSuccess(
        'simulateScrub export-preview parity warmup',
        await postTool('simulateScrub', {
          pattern: 'custom',
          points: [2, 10, 14.8, 30, 42],
          durationMs: 900,
          resetDiagnostics: true,
        }, 20000),
      );
    }
    report.steps.exportPreviewParity = assertToolSuccess(
      'runTimelineCanvasExportPreviewParitySmoke',
      await postTool('runTimelineCanvasExportPreviewParitySmoke', {
        createSynthetic: !useActiveLiveComposition,
        restoreTimelineAfterRun: true,
        sampleTime: 0.35,
        sampleTimes: useActiveLiveComposition ? [14.8, 30, 42, 10, 2, 0.35] : [0.35, 2],
        exportDurationSeconds: options.includePrecise ? 0.5 : 0.75,
        width: 320,
        height: 180,
        fps: 8,
        includePrecise: options.includePrecise,
        requireTimelineDom: true,
        maxSampleTimeDeltaSeconds: 0.35,
      }, options.includePrecise ? 120000 : 60000),
    );
  }

  if (options.includeWorkerSmokes) {
    await refreshTargetTabId('statusBeforeWorkerSynthetic');
    if (!options.skipWorkerPrewarm) {
      console.log('Running forced worker prewarm smoke...');
      report.steps.workerPrewarm = assertToolSuccess(
        'runTimelineCanvasLargeProjectSmoke worker prewarm',
        await postTool('runTimelineCanvasLargeProjectSmoke', {
          createSynthetic: true,
          restoreTimelineAfterRun: true,
          forceTimelineCanvasWorker: true,
          compactResult: true,
          waveformsEnabled: false,
          clipCount: Math.min(options.largeClipCount, 72),
          videoTrackCount: Math.min(options.largeVideoTrackCount, 4),
          audioTrackCount: 0,
          durationSeconds: 360,
          initialZoom: 72,
          zoomLevels: [72],
          scrollFractions: [0],
          selectAll: false,
          frameSampleMs: 250,
          minEstimatedFps: 30,
          maxDroppedFrameEstimate: 20,
          maxSlowFrameCount: 10,
          maxFrameDeltaMs: 120,
          minWorkerTrackCount: Math.min(options.largeVideoTrackCount, 4),
          minWorkerEligibleTrackCount: Math.min(options.largeVideoTrackCount, 4),
          maxWorkerFallbackTrackCount: 0,
          maxWorkerPendingTrackCount: 0,
          maxWorkerErrorTrackCount: 0,
          maxWorkerResourceBytes: options.largeMaxWorkerResourceBytes,
          maxShellCount: options.largeMaxShellCount,
          requireTimelineDom: true,
          requireCulling: false,
        }, 60000),
      );
      await refreshTargetTabId('statusAfterWorkerPrewarm');
    }

    console.log('Running forced worker synthetic smoke...');
    report.steps.workerSynthetic = assertToolSuccess(
      'runTimelineCanvasLargeProjectSmoke worker synthetic',
      await postTool('runTimelineCanvasLargeProjectSmoke', {
        createSynthetic: true,
        restoreTimelineAfterRun: true,
        forceTimelineCanvasWorker: true,
        compactResult: true,
        waveformsEnabled: false,
        clipCount: Math.min(options.largeClipCount, 720),
        videoTrackCount: Math.min(options.largeVideoTrackCount, 8),
        audioTrackCount: 0,
        durationSeconds: 360,
        initialZoom: 72,
        zoomLevels: [72, 144],
        scrollFractions: [0, 0.5, 1],
        selectAll: true,
        frameSampleMs: options.frameSampleMs,
        minEstimatedFps: options.largeMinEstimatedFps,
        maxDroppedFrameEstimate: options.largeMaxDroppedFrameEstimate,
        maxSlowFrameCount: options.largeMaxSlowFrameCount,
        maxFrameDeltaMs: options.largeMaxFrameDeltaMs,
        minWorkerTrackCount: Math.min(options.largeVideoTrackCount, 8),
        minWorkerEligibleTrackCount: Math.min(options.largeVideoTrackCount, 8),
        maxWorkerFallbackTrackCount: 0,
        maxWorkerPendingTrackCount: 0,
        maxWorkerErrorTrackCount: 0,
        maxWorkerResourceBytes: options.largeMaxWorkerResourceBytes,
        maxShellCount: options.largeMaxShellCount,
        requireTimelineDom: true,
        requireCulling: true,
      }, options.workerSyntheticTimeoutMs),
    );

    await refreshTargetTabId('statusBeforeWorkerThumbnailSynthetic');
    console.log('Running forced worker thumbnail synthetic smoke...');
    report.steps.workerThumbnailSynthetic = assertToolSuccess(
      'runTimelineCanvasThumbnailReloadSmoke worker thumbnail synthetic',
      await postTool('runTimelineCanvasThumbnailReloadSmoke', {
        restoreTimelineAfterRun: true,
        useExistingMediaFile: true,
        forceTimelineCanvasWorker: true,
        compactResult: true,
        clipCount: 18,
        videoTrackCount: 2,
        durationSeconds: 24,
        clipDurationSeconds: 2,
        initialZoom: 72,
        sourceDurationSeconds: 4,
        sourceDurationMs: 1400,
        minThumbnailClipCount: 1,
        minThumbnailDrawCount: 1,
        minWorkerTrackCount: 1,
        minWorkerEligibleTrackCount: 1,
        maxWorkerFallbackTrackCount: 1,
        maxWorkerPendingTrackCount: 0,
        maxWorkerErrorTrackCount: 0,
        minWorkerResourceBytes: 1,
        maxWorkerResourceBytes: 12_000_000,
        timeoutMs: 12000,
        requireTimelineDom: true,
      }, 90000),
    );

    if (!options.skipLiveComposition && report.steps.liveCompositionOpen?.success === true) {
      await refreshTargetTabId('statusBeforeWorkerFallbackLive');
      console.log('Running forced worker compatibility smoke on live composition...');
      report.steps.workerFallbackLiveOpen = assertToolSuccess(
        'openComposition worker fallback live',
        await postTool('openComposition', {
          compositionId: options.liveCompositionId,
        }, 30000),
      );
      report.steps.workerFallbackLiveStateWait = assertLiveTimelineState(
        'worker fallback live state wait',
        await waitForLiveTimelineState('worker fallback live', {
        minVideoClips: options.liveMinVideoClips,
        minAudioClips: 0,
        timeoutMs: 20000,
        }),
      );
      report.steps.workerFallbackLive = assertToolSuccess(
        'runTimelineCanvasLargeProjectSmoke worker compatibility live',
        await postTool('runTimelineCanvasLargeProjectSmoke', {
        createSynthetic: false,
        restoreTimelineAfterRun: true,
        forceTimelineCanvasWorker: true,
        compactResult: true,
        selectAll: false,
        frameSampleMs: 500,
        zoomLevels: [72],
        scrollFractions: [0, 0.5, 1],
        minWorkerTrackCount: 1,
        minWorkerEligibleTrackCount: 1,
        maxWorkerPendingTrackCount: 0,
        maxWorkerErrorTrackCount: 0,
        allowedWorkerFallbackReasons: ['source-timing-visuals', 'audio-resource-visuals'],
        maxShellCount: 1000,
        requireTimelineDom: true,
        requireCulling: false,
        }, 90000),
      );

      await refreshTargetTabId('statusBeforeWorkerPositiveLive');
      console.log('Running forced worker positive smoke on live composition...');
      report.steps.workerPositiveLiveOpen = assertToolSuccess(
        'openComposition worker positive live',
        await postTool('openComposition', {
          compositionId: options.liveCompositionId,
        }, 30000),
      );
      report.steps.workerPositiveLiveStateWait = assertLiveTimelineState(
        'worker positive live state wait',
        await waitForLiveTimelineState('worker positive live', {
        minVideoClips: options.liveMinVideoClips,
        minAudioClips: 0,
        timeoutMs: 20000,
        }),
      );
      report.steps.workerPositiveLive = assertToolSuccess(
        'runTimelineCanvasLargeProjectSmoke worker positive live',
        await postTool('runTimelineCanvasLargeProjectSmoke', {
        createSynthetic: false,
        restoreTimelineAfterRun: true,
        forceTimelineCanvasWorker: true,
        compactResult: true,
        warmWorkerThumbnails: true,
        workerThumbnailWarmupTimeoutMs: 8000,
        workerThumbnailWarmupMaxSecondsPerSource: 240,
        minWorkerWarmThumbnailBitmapCount: 1,
        selectAll: false,
        frameSampleMs: 500,
        zoomLevels: [72],
        scrollFractions: [0, 0.5, 1],
        minWorkerTrackCount: 1,
        minWorkerEligibleTrackCount: 1,
        allowedWorkerFallbackReasons: ['audio-resource-visuals'],
        maxWorkerPendingTrackCount: 0,
        maxWorkerErrorTrackCount: 0,
        maxWorkerResourceBytes: options.largeMaxWorkerResourceBytes,
        maxShellCount: 1000,
        requireTimelineDom: true,
        requireCulling: false,
        }, 120000),
      );

      if (options.checkWorkerDefaultOn) {
        await refreshTargetTabId('statusBeforeWorkerDefaultLive');
        console.log('Running default-on worker smoke on live composition...');
        report.steps.workerDefaultLiveOpen = assertToolSuccess(
          'openComposition worker default live',
          await postTool('openComposition', {
            compositionId: options.liveCompositionId,
          }, 30000),
        );
        report.steps.workerDefaultLiveStateWait = assertLiveTimelineState(
          'worker default live state wait',
          await waitForLiveTimelineState('worker default live', {
          minVideoClips: options.liveMinVideoClips,
          minAudioClips: 0,
          timeoutMs: 20000,
          }),
        );
        report.steps.workerDefaultLive = assertWorkerDefaultOnProof(
          'runTimelineCanvasLargeProjectSmoke worker default live',
          await postTool('runTimelineCanvasLargeProjectSmoke', {
          createSynthetic: false,
          restoreTimelineAfterRun: true,
          compactResult: true,
          warmWorkerThumbnails: true,
          workerThumbnailWarmupTimeoutMs: 8000,
          workerThumbnailWarmupMaxSecondsPerSource: 240,
          minWorkerWarmThumbnailBitmapCount: 1,
          selectAll: false,
          frameSampleMs: 500,
          zoomLevels: [72],
          scrollFractions: [0, 0.5, 1],
          minWorkerTrackCount: 1,
          minWorkerEligibleTrackCount: 1,
          allowedWorkerFallbackReasons: ['audio-resource-visuals'],
          maxWorkerPendingTrackCount: 0,
          maxWorkerErrorTrackCount: 0,
          maxWorkerResourceBytes: options.largeMaxWorkerResourceBytes,
          maxShellCount: 1000,
          requireTimelineDom: true,
          requireCulling: false,
          }, 120000),
        );
      } else {
        report.summary.workerDefaultLiveSkipped = 'skipped because --skip-worker-default-on was set';
      }
    } else {
      report.summary.workerFallbackLiveSkipped = options.skipLiveComposition
        ? 'skipped because live composition verification is disabled'
        : 'skipped because live composition did not open';
      report.summary.workerPositiveLiveSkipped = report.summary.workerFallbackLiveSkipped;
      report.summary.workerDefaultLiveSkipped = report.summary.workerFallbackLiveSkipped;
    }
  }

  const hasManifest = await pathExists(options.manifest);
  const shouldRunTorture = !options.skipTorture && hasManifest;
  if (shouldRunTorture) {
    const manifest = await readJson(options.manifest);
    const importPaths = Array.isArray(manifest.importPaths) ? manifest.importPaths.slice(0, 3) : [];
    if (importPaths.length < 3) {
      throw new Error(`Manifest must contain at least three importPaths: ${options.manifest}`);
    }
    console.log('Creating torture fixture...');
    report.steps.createTortureProjectFixture = assertToolSuccess(
      'createTortureProjectFixture',
      await postTool('createTortureProjectFixture', {
        paths: importPaths,
        resetProject: true,
        projectName: `Timeline Canvas Verification ${new Date().toLocaleString('sv-SE')}`,
        durationSeconds: 6.2,
        width: 1920,
        height: 1080,
        frameRate: 24,
      }, 90000),
    );

    if (!options.skipPlayback) {
      console.log('Running scrub/playback bridge smokes...');
      report.steps.simulateScrub = assertToolSuccess(
        'simulateScrub',
        await postTool('simulateScrub', {
          pattern: 'custom',
          points: [0, 1.5, 4.5, 0.25],
          durationMs: 900,
          resetDiagnostics: true,
        }, 20000),
      );
      report.steps.simulatePlayback = assertToolSuccess(
        'simulatePlayback',
        await postTool('simulatePlayback', {
          startTime: 0,
          durationMs: 1200,
          settleMs: 100,
          resetDiagnostics: true,
        }, 20000),
      );
      report.steps.simulatePlaybackPath = assertToolSuccess(
        'simulatePlaybackPath',
        await postTool('simulatePlaybackPath', {
          preset: 'play_scrub_stress_v1',
          startTime: 0,
          playbackSpeed: 1,
          resetDiagnostics: true,
        }, 45000),
      );
    }

    if (!options.skipSpectral) {
      console.log('Running spectral playback smoke...');
      report.steps.spectralPlayback = assertToolSuccess(
        'runTimelineCanvasSpectralPlaybackSmoke',
        await postTool('runTimelineCanvasSpectralPlaybackSmoke', {
          durationMs: 1200,
          requireAudioLike: false,
          requireTimelineDom: true,
        }, 25000),
      );
    }

    if (!options.skipRam) {
      console.log('Running RAM preview smoke...');
      report.steps.ramPreview = assertToolSuccess(
        'runTimelineCanvasRamPreviewSmoke',
        await postTool('runTimelineCanvasRamPreviewSmoke', {
          startTime: 0,
          endTime: 0.4,
          requireNested: true,
          requireVideo: true,
          requireTimelineDom: true,
        }, 90000),
      );
    }

    if (!options.skipExport) {
      console.log('Running fast debugExport smoke...');
      report.steps.exportFast = assertToolSuccess('debugExport fast', await postTool('debugExport', {
        startTime: 0,
        durationSeconds: 1.2,
        width: 640,
        height: 360,
        fps: 12,
        includeAudio: false,
        exportMode: 'fast',
        download: false,
        maxRuntimeMs: 25000,
      }, 30000));
      const fastSize = getExportBlobSize(report.steps.exportFast);
      if (fastSize <= 0) {
        throw new Error('Fast export returned an empty blob');
      }
      report.summary.exportFastBytes = fastSize;

      if (options.includePrecise) {
        console.log('Running precise debugExport smoke...');
        report.steps.exportPrecise = assertToolSuccess('debugExport precise', await postTool('debugExport', {
          startTime: 2.8,
          durationSeconds: 0.5,
          width: 320,
          height: 180,
          fps: 8,
          includeAudio: false,
          exportMode: 'precise',
          download: false,
          maxRuntimeMs: 60000,
        }, 90000));
        const preciseSize = getExportBlobSize(report.steps.exportPrecise);
        if (preciseSize <= 0) {
          throw new Error('Precise export returned an empty blob');
        }
        report.summary.exportPreciseBytes = preciseSize;
      }
    }
  } else {
    report.summary.tortureSkipped = hasManifest
      ? 'skipped by option'
      : `manifest not found: ${path.relative(repoRoot, options.manifest)}`;
  }

  if (!options.skipLarge) {
    console.log('Running synthetic large-project scroll/zoom/select-all smoke...');
    const largeMaxWorkerTrackCount = options.largeMaxWorkerTrackCount ?? options.largeVideoTrackCount;
    report.steps.largeProject = assertToolSuccess(
      'runTimelineCanvasLargeProjectSmoke',
      await postTool('runTimelineCanvasLargeProjectSmoke', {
        createSynthetic: true,
        restoreTimelineAfterRun: true,
        compactResult: true,
        clipCount: options.largeClipCount,
        videoTrackCount: options.largeVideoTrackCount,
        durationSeconds: 360,
        initialZoom: 72,
        zoomLevels: [72, 144],
        scrollFractions: [0, 0.5, 1],
        selectAll: true,
        frameSampleMs: options.frameSampleMs,
        minEstimatedFps: options.largeMinEstimatedFps,
        maxDroppedFrameEstimate: options.largeMaxDroppedFrameEstimate,
        maxSlowFrameCount: options.largeMaxSlowFrameCount,
        maxFrameDeltaMs: options.largeMaxFrameDeltaMs,
        maxWorkerTrackCount: largeMaxWorkerTrackCount,
        maxWorkerPendingTrackCount: 0,
        maxWorkerErrorTrackCount: 0,
        maxWorkerResourceBytes: largeMaxWorkerTrackCount > 0 ? options.largeMaxWorkerResourceBytes : undefined,
        maxShellCount: options.largeMaxShellCount,
        requireTimelineDom: true,
        requireCulling: true,
      }, 90000),
    );

    if (!options.skipThumbnailReload) {
      console.log('Running synthetic thumbnail-before-playback reload smoke...');
      report.steps.thumbnailReload = assertToolSuccess(
        'runTimelineCanvasThumbnailReloadSmoke',
        await postTool('runTimelineCanvasThumbnailReloadSmoke', {
          restoreTimelineAfterRun: true,
          clipCount: 18,
          videoTrackCount: 2,
          durationSeconds: 24,
          minThumbnailClipCount: 1,
          minThumbnailDrawCount: 1,
          maxWorkerPendingTrackCount: 0,
          maxWorkerErrorTrackCount: 0,
          requireTimelineDom: true,
        }, 45000),
      );
    }

    if (!options.skipPlayback) {
      console.log('Running synthetic scrub/playback bridge smokes...');
      report.steps.simulateScrubSynthetic = assertToolSuccess(
        'simulateScrub synthetic',
        await postTool('simulateScrub', {
          pattern: 'custom',
          points: [0, 30, 180, 10],
          durationMs: 900,
          resetDiagnostics: true,
        }, 20000),
      );
      report.steps.simulatePlaybackSynthetic = assertToolSuccess(
        'simulatePlayback synthetic',
        await postTool('simulatePlayback', {
          startTime: 0,
          durationMs: 1200,
          settleMs: 100,
          resetDiagnostics: true,
        }, 20000),
      );
      report.steps.simulatePlaybackPathSynthetic = assertToolSuccess(
        'simulatePlaybackPath synthetic',
        await postTool('simulatePlaybackPath', {
          preset: 'play_scrub_stress_v1',
          startTime: 0,
          playbackSpeed: 1,
          resetDiagnostics: true,
        }, 45000),
      );
    }

    if (!options.skipPlayback && !options.skipPlayhead) {
      console.log('Running synthetic playhead smoothness smoke...');
      report.steps.playheadSmoothness = assertToolSuccess(
        'runTimelineCanvasPlayheadSmoothnessSmoke',
        await postTool('runTimelineCanvasPlayheadSmoothnessSmoke', {
          createSynthetic: true,
          restoreTimelineAfterRun: true,
          clipCount: 36,
          videoTrackCount: 3,
          durationSeconds: 18,
          durationMs: 1200,
          maxAllowedBacktrackPx: 2,
          maxAllowedBacktrackCount: 0,
          minForwardDistancePx: 20,
          requireTimelineDom: true,
        }, 30000),
      );
    }

    console.log('Running synthetic Blade tool canvas smoke...');
    report.steps.bladeTool = assertToolSuccess(
      'runTimelineCanvasBladeToolSmoke',
      await postTool('runTimelineCanvasBladeToolSmoke', {
        restoreTimelineAfterRun: true,
        clipCount: 1,
        videoTrackCount: 1,
        durationSeconds: 8,
        clipDurationSeconds: 6,
        splitTime: 3,
        requireTimelineDom: true,
      }, 30000),
    );

    if (!options.skipMarquee) {
      console.log('Running synthetic marquee selection smoke...');
      report.steps.marquee = assertToolSuccess(
        'runTimelineCanvasMarqueeSmoke',
        await postTool('runTimelineCanvasMarqueeSmoke', {
          createSynthetic: true,
          restoreTimelineAfterRun: true,
          clipCount: 160,
          videoTrackCount: 4,
          durationSeconds: 120,
          minSelectedClipCount: 1,
          requireTimelineDom: true,
        }, 30000),
      );
    }

    if (!shouldRunTorture && !options.skipSpectral) {
      console.log('Running synthetic spectral playback smoke...');
      report.steps.spectralPlaybackSynthetic = assertToolSuccess(
        'runTimelineCanvasSpectralPlaybackSmoke',
        await postTool('runTimelineCanvasSpectralPlaybackSmoke', {
          durationMs: 900,
          requireAudioLike: false,
          requireTimelineDom: true,
        }, 25000),
      );
    }

    if (!shouldRunTorture && !options.skipRam) {
      console.log('Running synthetic RAM preview smoke...');
      report.steps.ramPreviewSynthetic = assertToolSuccess(
        'runTimelineCanvasRamPreviewSmoke',
        await postTool('runTimelineCanvasRamPreviewSmoke', {
          createSynthetic: true,
          restoreTimelineAfterRun: true,
          startTime: 0,
          endTime: 0.35,
          requireNested: false,
          requireVideo: true,
          requireTimelineDom: true,
        }, 90000),
      );
    }
  }

  if (
    options.restoreLiveCompositionAtEnd &&
    !options.skipLiveComposition &&
    report.steps.liveCompositionOpen?.success === true
  ) {
    report.steps.restoreLiveComposition = await postTool('openComposition', {
      compositionId: options.liveCompositionId,
    }, 30000);
  }

  report.steps.finalStats = assertToolSuccess('getStats final', await postTool('getStats', {}, 10000));
  report.steps.playbackTrace = assertToolSuccess(
    'getPlaybackTrace final',
    await postTool('getPlaybackTrace', { windowMs: 15000, limit: 500 }, 10000),
  );
  report.steps.runtimeDiagnostics = assertToolSuccess(
    'getRuntimeDiagnostics final',
    await postTool('getRuntimeDiagnostics', { limit: 500 }, 10000),
  );
  report.summary.exportPreviewParityFailures = report.steps.exportPreviewParity?.data?.failures ?? [];
  report.summary.workerPrewarmFailures = collectToolFailures(report.steps.workerPrewarm);
  report.summary.workerSyntheticFailures = collectToolFailures(report.steps.workerSynthetic);
  report.summary.workerThumbnailSyntheticFailures = collectToolFailures(report.steps.workerThumbnailSynthetic);
  report.summary.workerFallbackLiveFailures = collectToolFailures(report.steps.workerFallbackLive);
  report.summary.workerPositiveLiveFailures = collectToolFailures(report.steps.workerPositiveLive);
  report.summary.workerDefaultLiveFailures = collectToolFailures(report.steps.workerDefaultLive);
  report.summary.largeProjectFailures = report.steps.largeProject?.data?.failures ?? [];
  report.summary.ramPreviewFailures = report.steps.ramPreview?.data?.failures
    ?? report.steps.ramPreviewSynthetic?.data?.failures
    ?? [];
  report.summary.spectralPlaybackFailures = report.steps.spectralPlayback?.data?.failures
    ?? report.steps.spectralPlaybackSynthetic?.data?.failures
    ?? [];
  report.summary.marqueeFailures = report.steps.marquee?.data?.failures ?? [];
  report.summary.playheadSmoothnessFailures = report.steps.playheadSmoothness?.data?.failures ?? [];
  report.summary.thumbnailReloadFailures = report.steps.thumbnailReload?.data?.failures ?? [];
  report.summary.scrubSuccess = Boolean(
    (report.steps.liveCompositionScrub ?? report.steps.simulateScrub ?? report.steps.simulateScrubSynthetic)?.success,
  );
  report.summary.playbackSuccess = Boolean(
    (report.steps.liveCompositionPlayback ?? report.steps.simulatePlayback ?? report.steps.simulatePlaybackSynthetic)?.success,
  );
  report.summary.playbackPathSuccess = Boolean(
    (report.steps.liveCompositionPlaybackPath ?? report.steps.simulatePlaybackPath ?? report.steps.simulatePlaybackPathSynthetic)?.success,
  );
  report.summary.liveCompositionSuccess = Boolean(
    report.steps.liveCompositionOpen?.success &&
    report.steps.liveCompositionState?.success &&
    report.steps.liveCompositionStatsAfter?.success &&
    (report.summary.liveCompositionFailures?.length ?? 0) === 0,
  );
  report.summary.verificationFailures = collectVerificationFailures(report);

  const reportPath = path.join(runDir, 'report.json');
  await fs.writeFile(reportPath, JSON.stringify(buildCompactReport(report), null, 2));
  let fullReportPath = null;
  if (options.fullReport) {
    fullReportPath = path.join(runDir, 'report.full.json');
    await fs.writeFile(fullReportPath, JSON.stringify(compactReportValue(report), null, 2));
  }

  console.log('');
  console.log('Timeline canvas verification complete.');
  console.log(`Report: ${path.relative(repoRoot, reportPath)}`);
  if (fullReportPath) {
    console.log(`Full report: ${path.relative(repoRoot, fullReportPath)}`);
  }
  console.log(`Fast export bytes: ${report.summary.exportFastBytes ?? 'skipped'}`);
  console.log(`Precise export bytes: ${report.summary.exportPreciseBytes ?? 'skipped'}`);
  console.log(`Export preview parity: ${report.steps.exportPreviewParity?.success === true ? 'passed' : 'skipped'}`);
  console.log(`Worker prewarm: ${report.steps.workerPrewarm?.success === true ? 'passed' : 'skipped'}`);
  console.log(`Worker synthetic: ${report.steps.workerSynthetic?.success === true ? 'passed' : 'skipped'}`);
  console.log(`Worker thumbnail synthetic: ${report.steps.workerThumbnailSynthetic?.success === true ? 'passed' : 'skipped'}`);
  console.log(`Worker live fallback: ${report.steps.workerFallbackLive?.success === true ? 'passed' : (report.summary.workerFallbackLiveSkipped ?? 'skipped')}`);
  console.log(`Worker live positive: ${report.steps.workerPositiveLive?.success === true ? 'passed' : (report.summary.workerPositiveLiveSkipped ?? 'skipped')}`);
  console.log(`Worker default live: ${report.steps.workerDefaultLive?.success === true ? 'passed' : (report.summary.workerDefaultLiveSkipped ?? 'skipped')}`);
  console.log(`Torture: ${report.summary.tortureSkipped ?? 'ran'}`);
  console.log(`Live composition: ${report.summary.liveCompositionSkipped ?? (report.summary.liveCompositionSuccess ? 'passed' : 'warnings')}`);

  if (report.summary.verificationFailures.length > 0) {
    throw new Error(`Timeline canvas verification failed: ${report.summary.verificationFailures.join('; ')}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
